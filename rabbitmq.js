'use strict';

require('dotenv').config();
const amqp = require('amqplib');

class RabbitMQ {
  constructor({ url = process.env.RABBITMQ_URL, reconnectDelayMs = 3000 } = {}) {
    this.url = url;
    this.reconnectDelayMs = reconnectDelayMs;
    this.connection = null;
    this.channel = null;
    this.connecting = null;
    this.stopping = false;
    this.reconnectTimer = null;
  }

  async connect() {
    if (!this.url) throw new Error('RABBITMQ_URL is required');
    if (this.channel && this.connection) return this.channel;
    if (this.connecting) return this.connecting;

    this.stopping = false;
    this.connecting = (async () => {
      try {
        const connection = await amqp.connect(this.url);
        const channel = await connection.createChannel();
        this.connection = connection;
        this.channel = channel;
        console.info('[RabbitMQ] Connected');

        connection.on('error', (error) => {
          console.error('[RabbitMQ] Connection error:', error.message);
        });
        connection.on('close', () => {
          console.warn('[RabbitMQ] Connection closed');
          this._scheduleReconnect();
        });
        channel.on('error', (error) => {
          console.error('[RabbitMQ] Channel error:', error.message);
        });
        channel.on('close', () => {
          this.channel = null;
          this._scheduleReconnect();
        });
        return channel;
      } catch (error) {
        this.connection = null;
        this.channel = null;
        console.error('[RabbitMQ] Connect failed:', error.message);
        this._scheduleReconnect();
        throw error;
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  getChannel() {
    if (!this.channel) throw new Error('RabbitMQ channel is not connected; call connect() first');
    return this.channel;
  }

  async publish(exchange, routingKey, content, { idempotencyKey, correlationId, ...options } = {}) {
    const channel = this.getChannel();
    const headers = { ...(options.headers || {}) };
    if (idempotencyKey) headers.idempotencyKey = idempotencyKey;
    return channel.publish(exchange, routingKey, Buffer.isBuffer(content) ? content : Buffer.from(JSON.stringify(content)), {
      persistent: true,
      ...options,
      headers,
      ...(correlationId ? { correlationId } : {}),
    });
  }

  _scheduleReconnect() {
    this.connection = null;
    this.channel = null;
    if (this.stopping || this.reconnectTimer) return;
    console.info(`[RabbitMQ] Reconnecting in ${this.reconnectDelayMs}ms`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (_) {
        // connect() logs the error and schedules the next attempt.
      }
    }, this.reconnectDelayMs);
  }

  async close() {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const connection = this.connection;
    this.channel = null;
    this.connection = null;
    if (connection) {
      try {
        await connection.close();
      } catch (error) {
        console.error('[RabbitMQ] Error while closing connection:', error.message);
      }
    }
    console.info('[RabbitMQ] Disconnected');
  }
}

module.exports = new RabbitMQ();
module.exports.RabbitMQ = RabbitMQ;
