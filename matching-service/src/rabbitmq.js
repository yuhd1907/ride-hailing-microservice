'use strict';
const amqp = require('amqplib');
const crypto = require('crypto');
const log = require('./logger');
const identity = require('./identity');
const { validate, InvalidEvent } = require('./validation');
const EXCHANGE = 'rideflow.events';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
class RabbitMQ {
  constructor() { this.url = process.env.RABBITMQ_URL || 'amqp://localhost:5672'; this.channel = null; this.connection = null; this.handlers = new Map(); this.stopping = false; this.timer = null; }
  async connect() {
    if (this.channel) return this.channel;
    const connection = await amqp.connect(this.url);
    this.connection = connection;
    connection.on('error', error => log('error', error.message));
    connection.on('close', () => { if (this.connection === connection) { this.channel = null; this.reconnect(); } });
    try {
      const channel = await connection.createConfirmChannel();
      channel.on('error', error => log('error', error.message));
      channel.on('close', () => { if (this.channel === channel) { this.channel = null; connection.close().catch(() => {}); this.reconnect(); } });
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      await channel.assertExchange('rideflow.dlx', 'direct', { durable: true });
      await channel.prefetch(10);
      for (const [type, handler] of this.handlers) await this.subscribe(channel, type, handler);
      this.channel = channel;
      return channel;
    } catch (error) { await connection.close().catch(() => {}); throw error; }
  }
  reconnect() {
    if (!this.stopping && !this.timer) this.timer = setTimeout(() => {
      this.timer = null;
      this.connect().catch(error => { log('error', `RabbitMQ reconnect: ${error.message}`); this.reconnect(); });
    }, 3000);
  }
  consume(type, handler) { this.handlers.set(type, handler); }
  async subscribe(channel, type, handler) {
    const queue = `${identity.service}.${type}`;
    await channel.assertQueue(`${queue}.dlq`, { durable: true });
    await channel.bindQueue(`${queue}.dlq`, 'rideflow.dlx', `${queue}.dlq`);
    await channel.assertQueue(queue, { durable: true, arguments: { 'x-dead-letter-exchange': 'rideflow.dlx', 'x-dead-letter-routing-key': `${queue}.dlq` } });
    await channel.bindQueue(queue, EXCHANGE, type);
    await channel.consume(queue, msg => this.handle(channel, msg, type, handler).catch(error => log('error', `Consumer channel failed: ${error.message}`)), { noAck: false });
  }
  async handle(channel, msg, type, handler) {
    if (!msg) return;
    let event;
    try { event = validate(JSON.parse(msg.content.toString('utf8')), type); }
    catch (error) { log('error', `Invalid message: ${error.message}`, { correlationId: msg.properties?.correlationId, eventId: msg.properties?.messageId }); channel.nack(msg, false, false); return; }
    const context = { correlationId: event.correlationId, eventId: event.eventId, tripId: event.payload.tripId };
    for (let attempt = 1; attempt <= 3; attempt++) {
      log('info', `Nhận ${type} (lần thử ${attempt})`, context);
      try { await handler(event); channel.ack(msg); return; }
      catch (error) {
        log('error', error.message, context);
        if (error instanceof InvalidEvent || attempt === 3) { channel.nack(msg, false, false); return; }
        await sleep(attempt * 1000);
      }
    }
  }
  async publishEnvelope(event) {
    const channel = this.channel;
    if (!channel) throw new Error('RabbitMQ is not connected');
    await new Promise((resolve, reject) => channel.publish(EXCHANGE, event.eventType, Buffer.from(JSON.stringify(event)), {
      persistent: true, contentType: 'application/json', messageId: event.eventId, type: event.eventType,
      correlationId: event.correlationId, headers: { 'x-correlation-id': event.correlationId },
    }, error => error ? reject(error) : resolve()));
    log('info', `Published ${event.eventType}`, { correlationId: event.correlationId, eventId: event.eventId, tripId: event.payload.tripId });
    return event.eventId;
  }
  async publishEvent(eventType, payload, correlationId = crypto.randomUUID()) {
    return this.publishEnvelope({ eventId: crypto.randomUUID(), eventType, correlationId, occurredAt: new Date().toISOString(), payload });
  }
  async publish(type, payload, correlationId) { return this.publishEvent(type, payload, correlationId); }
  async close() { this.stopping = true; clearTimeout(this.timer); this.channel = null; if (this.connection) await this.connection.close(); }
}
module.exports = new RabbitMQ();
module.exports.RabbitMQ = RabbitMQ;
module.exports.EXCHANGE = EXCHANGE;
