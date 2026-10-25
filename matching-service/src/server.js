'use strict';
require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const rabbitmq = require('./rabbitmq');
const eureka = require('./eureka');
const identity = require('./identity');
const app = express();
const port = Number(process.env.MATCHING_SERVICE_PORT || process.env.PORT || 8084);
const log = (level, correlationId, method, url, message) => console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, service: identity.service, instanceId: identity.instanceId, correlationId, method, url, message }));
app.use((req, res, next) => { req.correlationId = req.get('x-correlation-id') || crypto.randomUUID(); res.setHeader('X-Correlation-Id', req.correlationId); const started = Date.now(); res.on('finish', () => log(res.statusCode >= 500 ? 'error' : 'info', req.correlationId, req.method, req.originalUrl, `request completed (${res.statusCode}) in ${Date.now() - started}ms`)); next(); });
app.get('/ping', async (req, res) => { try { await db.query('SELECT 1'); if (!rabbitmq.channel) throw new Error('RabbitMQ is disconnected'); await rabbitmq.channel.checkExchange(rabbitmq.EXCHANGE); res.status(200).json({ status: 'UP', service: 'matching-service' }); } catch (e) { log('error', req.correlationId, req.method, req.originalUrl, `health check failed: ${e.message}`); res.status(503).json({ status: 'DOWN', service: 'matching-service' }); } });
const server = app.listen(port, () => log('info', null, null, null, `matching-service listening on ${port}`));
(async () => { for (;;) { try { await rabbitmq.connect(); log('info', null, null, null, 'RabbitMQ connected'); break; } catch (e) { log('error', null, null, null, `RabbitMQ connection failed: ${e.message}`); await new Promise(r => setTimeout(r, 3000)); } } try { eureka.start(); } catch (e) { log('error', null, null, null, `Eureka startup failed: ${e.message}`); } })();
async function shutdown() { server.close(); try { eureka.stop(); } catch (_) {} await Promise.allSettled([db.end(), rabbitmq.close()]); process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
