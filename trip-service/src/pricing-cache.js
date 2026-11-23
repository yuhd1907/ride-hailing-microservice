'use strict';
const { createClient } = require('redis');
const log = require('./logger');
const client = createClient({
  url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`,
  disableOfflineQueue: true,
  socket: { connectTimeout: 2000, reconnectStrategy: retries => Math.min(500 * (retries + 1), 5000) },
});
client.on('error', () => log('warn', 'Pricing Redis unavailable; surge will use neutral fallback'));
module.exports = client;
