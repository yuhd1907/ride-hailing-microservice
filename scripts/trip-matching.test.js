'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const id = () => crypto.randomUUID();
const validation = require('../trip-service/src/validation');
function load(service, file, mocks = {}, globals = {}) {
  const filename = path.join(root, service, 'src', file);
  const mod = { exports: {} };
  const localRequire = require('node:module').createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: mod, exports: mod.exports, require: name => name in mocks ? mocks[name] : localRequire(name), Buffer, console, process, setTimeout, clearTimeout, fetch, AbortSignal, ...globals }, { filename });
  return mod.exports;
}
function envelope(type = 'payment.failed') {
  return { eventId: id(), eventType: type, correlationId: id(), occurredAt: new Date().toISOString(), payload: { tripId: id(), riderId: id(), driverId: id(), paymentId: id(), amount: 125000, reason: 'INSUFFICIENT_FUNDS', failedAt: new Date().toISOString(), paidAt: new Date().toISOString() } };
}
const quiet = () => {};
for (const service of ['trip-service', 'matching-service']) {
  test(`${service}: envelope, AMQP metadata and broker confirmation`, async () => {
    let sent;
    const { RabbitMQ } = load(service, 'rabbitmq.js', { './logger': quiet, './identity': { service }, amqplib: {} });
    const mq = new RabbitMQ();
    mq.channel = { publish: (...args) => { sent = args; args[4](null); } };
    const correlationId = id();
    const eventId = await mq.publishEvent('trip.completed', { tripId: id() }, correlationId);
    const event = JSON.parse(sent[2].toString());
    assert.equal(event.eventId, eventId);
    assert.equal(event.correlationId, correlationId);
    assert.equal(sent[0], 'rideflow.events');
    assert.equal(sent[3].messageId, eventId);
    assert.equal(sent[3].persistent, true);
    assert.equal(sent[3].type, event.eventType);
    assert.equal(sent[3].headers['x-correlation-id'], correlationId);
    mq.channel.publish = (...args) => args[4](new Error('broker nack'));
    await assert.rejects(mq.publishEnvelope(event), /broker nack/);
  });
  test(`${service}: malformed events DLQ immediately; transient errors retry three times`, async () => {
    const waits = [];
    const { RabbitMQ } = load(service, 'rabbitmq.js', { './logger': quiet, './identity': { service }, amqplib: {} }, { setTimeout: (fn, delay) => { waits.push(delay); queueMicrotask(fn); } });
    const mq = new RabbitMQ();
    let ack = 0, nack = 0, attempts = 0;
    const channel = { ack: () => ack++, nack: (msg, multiple, requeue) => { assert.equal(requeue, false); nack++; } };
    await mq.handle(channel, { content: Buffer.from('{'), properties: {} }, 'payment.failed', async () => attempts++);
    assert.equal(attempts, 0);
    assert.equal(nack, 1);
    const event = envelope();
    const msg = { content: Buffer.from(JSON.stringify(event)), properties: {} };
    await mq.handle(channel, msg, event.eventType, async () => { attempts++; throw new Error('database unavailable'); });
    assert.equal(attempts, 3);
    assert.equal(nack, 2);
    assert.deepEqual(waits, [1000, 2000]);
    await mq.handle(channel, msg, event.eventType, async () => {});
    assert.equal(ack, 1);
  });
  test(`${service}: durable queues, DLX, manual acknowledgements`, async () => {
    const { RabbitMQ } = load(service, 'rabbitmq.js', { './logger': quiet, './identity': { service }, amqplib: {} });
    const queues = [], bindings = [];
    const channel = { assertQueue: async (...args) => queues.push(args), bindQueue: async (...args) => bindings.push(args), consume: async (queue, handler, options) => assert.equal(options.noAck, false) };
    await new RabbitMQ().subscribe(channel, 'payment.failed', quiet);
    assert.equal(queues[0][0], `${service}.payment.failed.dlq`);
    assert.equal(queues[1][1].arguments['x-dead-letter-exchange'], 'rideflow.dlx');
    assert.equal(bindings[1][2], 'payment.failed');
  });
}
test('validation rejects missing fields, invalid UUIDs, amounts and timestamps', () => {
  validation.validate(envelope(), 'payment.failed');
  for (const mutate of [e => delete e.payload.tripId, e => e.correlationId = 'abc', e => e.payload.amount = -1, e => e.payload.amount = 1.234, e => e.payload.failedAt = 'yesterday', e => e.payload.reason = 'UNKNOWN']) {
    const event = envelope(); mutate(event);
    assert.throws(() => validation.validate(event, 'payment.failed'), validation.InvalidEvent);
  }
});
function sagaHarness() {
  let trip, releases = 0, completes = 0;
  const processed = new Set(), outbox = [], histories = [];
  const client = { query: async (sql, args) => {
    if (sql.startsWith('SELECT')) return { rows: trip ? [{ ...trip }] : [] };
    if (sql.startsWith('UPDATE trips')) Object.assign(trip, { status: args[1], paymentId: args[2], driverId: args[3] });
    if (sql.startsWith('INSERT INTO trip_status_history')) histories.push(args);
    return { rows: [], rowCount: 1 };
  } };
  const events = {
    once: async (event, work) => {
      if (processed.has(event.eventId)) return;
      const snapshot = { ...trip }, length = outbox.length, historyLength = histories.length;
      try { await work(client); processed.add(event.eventId); }
      catch (error) { trip = snapshot; outbox.length = length; histories.length = historyLength; throw error; }
    },
    enqueue: async (client, type, payload, correlationId) => outbox.push({ type, payload, correlationId }),
  };
  const driver = { release: async () => releases++, request: async () => completes++ };
  const saga = load('trip-service', 'saga.js', { './events': events, './service-client': driver, './logger': quiet });
  return { saga, driver, outbox, histories, processed, setTrip: value => trip = value, get trip() { return trip; }, get releases() { return releases; }, get completes() { return completes; } };
}
function tripFor(event) { return { tripId: event.payload.tripId, passengerId: event.payload.riderId, driverId: event.payload.driverId, fare: event.payload.amount, status: 'PAYMENT_PENDING' }; }
test('payment success confirms once, persists paymentId and history', async () => {
  const h = sagaHarness(), event = envelope('payment.succeeded');
  h.setTrip(tripFor(event));
  await h.saga.payment(event);
  await h.saga.payment(event);
  await h.saga.payment({ ...event, eventId: id() });
  assert.equal(h.trip.status, 'CONFIRMED');
  assert.equal(h.trip.paymentId, event.payload.paymentId);
  assert.equal(h.histories.length, 1);
  assert.equal(h.completes, 1);
});
test('compensation releases once and preserves correlation across duplicate events', async () => {
  const h = sagaHarness(), event = envelope();
  h.setTrip(tripFor(event));
  await h.saga.payment(event);
  await h.saga.payment(event);
  await h.saga.payment({ ...event, eventId: id() });
  assert.equal(h.trip.status, 'CANCELLED');
  assert.equal(h.releases, 1);
  assert.equal(h.outbox.length, 1);
  assert.equal(h.outbox[0].type, 'trip.compensated');
  assert.equal(h.outbox[0].correlationId, event.correlationId);
  assert.equal(h.histories[0][3], event.payload.reason);
});
test('release failure rolls back deduplication and permits retry', async () => {
  const h = sagaHarness(), event = envelope();
  h.setTrip(tripFor(event));
  h.driver.release = async () => { throw new Error('network'); };
  await assert.rejects(h.saga.payment(event), /network/);
  assert.equal(h.trip.status, 'PAYMENT_PENDING');
  assert.equal(h.processed.size, 0);
  assert.equal(h.outbox.length, 0);
  h.driver.release = async () => {};
  await h.saga.payment(event);
  assert.equal(h.trip.status, 'CANCELLED');
});
test('late or mismatched payment cannot cancel a confirmed trip', async () => {
  const h = sagaHarness(), event = envelope();
  h.setTrip({ ...tripFor(event), status: 'CONFIRMED' });
  await assert.rejects(h.saga.payment(event), /Cannot compensate/);
  h.setTrip({ ...tripFor(event), fare: 1 });
  await assert.rejects(h.saga.payment(event), /does not match/);
  assert.equal(h.releases, 0);
});
test('service discovery uses UP instances, correlation and no release body', async () => {
  const requests = [];
  const service = load('trip-service', 'service-client.js', { './eureka': { getInstancesByAppId: () => [{ status: 'DOWN' }, { status: 'UP', ipAddr: '10.0.0.1', port: { $: 8082 } }] } }, {
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, text: async () => '' }; },
  });
  const correlationId = id(), driverId = id();
  await service.release(driverId, correlationId);
  assert.equal(requests[0].url, `http://10.0.0.1:8082/internal/drivers/${driverId}/release`);
  assert.equal(requests[0].options.headers['X-Correlation-ID'], correlationId);
  assert.equal(requests[0].options.body, undefined);
});
test('release treats state conflicts as complete and retries network/server failures', async () => {
  let status = 409;
  const service = load('trip-service', 'service-client.js', { './eureka': { getInstancesByAppId: () => [{ status: 'UP', ipAddr: 'localhost', port: { $: 8082 } }] } }, { fetch: async () => ({ ok: false, status }) });
  await service.release(id(), id());
  status = 400;
  await service.release(id(), id());
  status = 500;
  await assert.rejects(service.release(id(), id()), /HTTP 500/);
  status = 401;
  await assert.rejects(service.release(id(), id()), /HTTP 401/);
});
test('outbox is committed before publish and retains unconfirmed events', async () => {
  const calls = [];
  let pending = [];
  const client = { query: async (sql, args) => {
    calls.push(sql);
    if (sql.startsWith('INSERT INTO event_outbox')) pending.push({ event_id: args[0], envelope: args[1] });
    if (sql.startsWith('SELECT')) return { rows: pending };
    if (sql.startsWith('UPDATE')) pending = [];
    return { rows: [] };
  }, release: quiet };
  const rabbit = { channel: {}, publishEnvelope: async () => { calls.push('PUBLISH'); throw new Error('broker unavailable'); } };
  const events = load('trip-service', 'events.js', { './db': { connect: async () => client }, './rabbitmq': rabbit, './logger': quiet });
  await events.transaction(client => events.enqueue(client, 'trip.completed', { tripId: id() }, id()));
  assert.equal(calls.includes('PUBLISH'), false);
  await events.flush();
  assert.ok(calls.indexOf('COMMIT') < calls.indexOf('PUBLISH'));
  assert.equal(pending.length, 1);
  rabbit.publishEnvelope = async () => calls.push('PUBLISH');
  await events.flush();
  assert.equal(pending.length, 0);
});
test('matching reserves with durable identity, emits once, and retries same reservation', async () => {
  const event = envelope('trip.requested');
  event.payload.pickup = { lat: 10.77, lng: 106.7 };
  const row = { status: 'PENDING', reservationId: id(), selectedDriverId: null, attemptedDriverIds: [] };
  const driverId = id(), calls = [], outbox = [], processed = new Set();
  let failReserve = true;
  const client = { query: async (sql, args) => {
    if (sql.startsWith('SELECT')) return { rows: [row] };
    if (sql.includes('SET "selectedDriverId"=$2')) row.selectedDriverId = args[1];
    if (sql.includes('SET status=$2')) row.status = args[1];
    return { rows: [] };
  } };
  const matching = load('matching-service', 'matching.js', {
    './events': {
      transaction: work => work(client),
      once: async (event, work) => { if (!processed.has(event.eventId)) { await work(client); processed.add(event.eventId); } },
      enqueue: async (client, type, payload, correlationId) => outbox.push({ type, payload, correlationId }),
    },
    './service-client': { request: async (app, url, correlationId, body) => {
      if (url.includes('available')) return [{ id: driverId }];
      calls.push({ url, body });
      if (failReserve) throw new Error('timeout after reserve');
    } },
  });
  await assert.rejects(matching.handle(event), /timeout/);
  assert.equal(row.selectedDriverId, driverId);
  assert.equal(outbox.length, 0);
  failReserve = false;
  await matching.handle(event);
  await matching.handle(event);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.reservationId, calls[1].body.reservationId);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].type, 'matching.driver_assigned');
  assert.equal(outbox[0].correlationId, event.correlationId);
  assert.equal(row.status, 'ASSIGNED');
});
test('HTTP create, complete, duplicate complete and invalid amount', async () => {
  const express = require('../trip-service/node_modules/express');
  const app = express();
  app.use(express.json());
  const correlationId = id(), riderId = id(), driverId = id();
  app.use((req, res, next) => { req.correlationId = correlationId; next(); });
  let trip;
  const order = [], outbox = [];
  const client = { query: async (sql, args) => {
    if (sql.startsWith('INSERT INTO trips')) { trip = { tripId: args[0], passengerId: args[1], fare: args[5], sagaId: args[6], status: 'REQUESTED' }; return { rows: [{ ...trip }] }; }
    if (sql.startsWith('SELECT')) return { rows: trip ? [{ ...trip }] : [] };
    if (sql.startsWith('UPDATE trips SET fare')) trip.fare = args[1];
    return { rows: [] };
  } };
  const routes = load('trip-service', 'routes.js', {
    './db': client,
    './events': { transaction: async work => { const result = await work(client); order.push('COMMIT'); return result; }, enqueue: async (client, type, payload, correlationId) => { outbox.push({ type, payload, correlationId }); order.push('OUTBOX'); } },
    './saga': { history: async (client, row, status) => trip.status = status },
    './service-client': { request: async () => {} },
  });
  // Bridge VM promises to the native Promise realm used by Express.
  routes(Object.fromEntries(['get', 'post'].map(method => [method, (path, handler) => app[method](path, (req, res, next) => Promise.resolve(handler(req, res)).catch(next))])));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    let response = await post('/trips', { riderId, pickup: { lat: 10, lng: 106 }, destination: { lat: 11, lng: 106 }, estimatedDistance: 3, fareAmount: 125000 });
    assert.equal(response.status, 201);
    assert.equal(outbox[0].type, 'trip.requested');
    assert.deepEqual(order, ['OUTBOX', 'COMMIT']);
    trip.driverId = driverId;
    trip.status = 'IN_PROGRESS';
    response = await post(`/trips/${trip.tripId}/complete`, { fareAmount: 1.234 });
    assert.equal(response.status, 400);
    response = await post(`/trips/${trip.tripId}/complete`, { fareAmount: 5000000 });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'PAYMENT_PENDING');
    assert.equal(outbox[1].type, 'trip.completed');
    assert.equal(outbox[1].payload.fareAmount, 5000000);
    assert.equal(outbox[1].payload.riderId, riderId);
    assert.equal(outbox[1].correlationId, correlationId);
    await post(`/trips/${trip.tripId}/complete`, {});
    assert.equal(outbox.length, 2);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('processed_events and business update share transaction; duplicate skips business logic', async () => {
  const queries = [];
  let inserted = true, worked = 0;
  const client = { query: async sql => { queries.push(sql); return { rowCount: inserted ? 1 : 0 }; }, release: quiet };
  const events = load('trip-service', 'events.js', { './db': { connect: async () => client }, './rabbitmq': {}, './logger': quiet });
  const event = envelope();
  await events.once(event, async () => { worked++; queries.push('BUSINESS'); });
  assert.equal(queries[0], 'BEGIN');
  assert.ok(queries[1].startsWith('INSERT INTO processed_events'));
  assert.equal(queries[2], 'BUSINESS');
  assert.equal(queries[3], 'COMMIT');
  inserted = false;
  await events.once(event, async () => worked++);
  assert.equal(worked, 1);
  inserted = true;
  await assert.rejects(events.once(event, async () => { throw new Error('db failure'); }), /db failure/);
  assert.equal(queries.at(-1), 'ROLLBACK');
});
