'use strict';
require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const rabbitmq = require('./rabbitmq');
const eureka = require('./eureka');
const identity = require('./identity');
const app = express();
const events = require('./events');
const saga = require('./saga');
const pricing = require('./pricing');
const vouchers = require('./vouchers');
const { uuid } = require('./validation');
const port = Number(process.env.TRIP_SERVICE_PORT || process.env.PORT || 8083);
const log = (level, correlationId, method, url, message) => console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, service: identity.service, instanceId: identity.instanceId, correlationId, tripId: null, eventId: null, method, url, message }));
const errorDetails = (error) => error?.message || error?.code || error?.stack || String(error);
// Prometheus scrape /metrics mỗi 15s: đặt trước middleware ghi log để không làm nhiễu log.
const metrics = require('./metrics');
app.get('/metrics', metrics.endpoint);
app.use(metrics.middleware);
app.use((req, res, next) => { req.correlationId = req.get('x-correlation-id') || crypto.randomUUID(); res.setHeader('X-Correlation-Id', req.correlationId); const started = Date.now(); res.on('finish', () => log(res.statusCode >= 500 ? 'error' : 'info', req.correlationId, req.method, req.originalUrl, `request completed (${res.statusCode}) in ${Date.now() - started}ms`)); next(); });
app.get('/ping', async (req, res) => { try { await db.query('SELECT 1'); if (!rabbitmq.channel) throw new Error('RabbitMQ is disconnected'); await rabbitmq.channel.checkExchange(rabbitmq.EXCHANGE); res.status(200).json({ status: 'UP', service: 'trip-service' }); } catch (e) { log('error', req.correlationId, req.method, req.originalUrl, `health check failed: ${e.message}`); res.status(503).json({ status: 'DOWN', service: 'trip-service' }); } });
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => { if (!uuid(req.correlationId)) return res.status(400).json({ error: 'X-Correlation-ID must be a UUID' }); next(); });
require('./features')(app); // đường dẫn cố định (demand-map, drivers/me/stats, support/tickets) phải đứng trước /trips/:id
require('./routes')(app);
app.use((error, req, res, next) => { log('error', req.correlationId, req.method, req.originalUrl, errorDetails(error)); res.status(error.status || 503).json({ error: error.status && error.status < 500 ? error.message : 'Service temporarily unavailable' }); });
rabbitmq.consume('payment.succeeded', saga.payment);
rabbitmq.consume('payment.failed', saga.payment);
rabbitmq.consume('matching.driver_assigned', saga.assigned);
rabbitmq.consume('matching.failed', saga.failed);
rabbitmq.consume('payment.authorized', saga.authorized);
rabbitmq.consume('payment.authorization_failed', saga.authorizationFailed);
let outboxTimer, offerTimer;
let server;
(async () => { for (; ;) { try { await events.initialize(); await pricing.initialize(); await vouchers.initialize(db); await rabbitmq.connect(); pricing.start(); outboxTimer = setInterval(events.flush, 1000); offerTimer = setInterval(() => saga.expireOffers().catch(e => log('error', null, null, null, `Offer sweep failed: ${errorDetails(e)}`)), 5000); server = app.listen(port, () => log('info', null, null, null, `trip-service listening on ${port}`)); log('info', null, null, null, 'RabbitMQ connected'); break; } catch (e) { log('error', null, null, null, `Startup failed: ${errorDetails(e)}`); await new Promise(r => setTimeout(r, 3000)); } } try { eureka.start(); } catch (e) { log('error', null, null, null, `Eureka startup failed: ${errorDetails(e)}`); } })();
let shuttingDown = false;
async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(outboxTimer);
    clearInterval(offerTimer);
    log('info', null, null, null, 'shutting down, deregistering from Eureka');
    await new Promise((resolve) => {
        const timer = setTimeout(resolve, 3000);
        try {
            eureka.stop(() => { clearTimeout(timer); resolve(); });
        } catch (_) {
            clearTimeout(timer);
            resolve();
        }
    });
    server?.close();
    await Promise.allSettled([pricing.close(), db.end(), rabbitmq.close()]);
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
