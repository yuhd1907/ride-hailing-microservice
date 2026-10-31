'use strict';
const amqp = require('amqplib');
const crypto = require('crypto');
const identity = require('./identity');
const EXCHANGE = 'rideflow.events';
class RabbitMQ {
  constructor() { this.url = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672'; this.connection = null; this.channel = null; this.timer = null; this.stopping = false; }
  async connect() {
    if (this.channel) return this.channel;
    this.connection = await amqp.connect(this.url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    this.connection.on('close', () => this.reconnect());
    this.connection.on('error', (e) => this.log('error', `RabbitMQ: ${e.message}`));
    this.channel.on('close', () => { this.channel = null; this.reconnect(); });
    return this.channel;
  }
  reconnect() { this.channel = null; if (!this.stopping && !this.timer) this.timer = setTimeout(() => { this.timer = null; this.connect().catch(e => { this.log('error', `RabbitMQ reconnect: ${e.message}`); this.reconnect(); }); }, 3000); }
  log(level, message, correlationId = null) { console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, service: identity.service, instanceId: identity.instanceId, correlationId, method: null, url: null, message })); }
  async publish(routingKey, payload, correlationId) {
    if (!this.channel) throw new Error('RabbitMQ is not connected');
    correlationId = correlationId || crypto.randomUUID();
    return this.channel.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(payload)), { persistent: true, contentType: 'application/json', correlationId, headers: { 'x-correlation-id': correlationId } });
  }
  async close() { this.stopping = true; clearTimeout(this.timer); const c = this.connection; this.channel = null; this.connection = null; if (c) await c.close(); }
}
module.exports = new RabbitMQ(); module.exports.RabbitMQ = RabbitMQ; module.exports.EXCHANGE = EXCHANGE;
