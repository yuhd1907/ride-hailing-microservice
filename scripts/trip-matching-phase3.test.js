'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { estimate } = require('../trip-service/src/fare');
const uuid = () => crypto.randomUUID();

function load(file, mocks) {
  const filename = path.resolve(__dirname, '../trip-service/src', file);
  const mod = { exports: {} };
  const localRequire = require('node:module').createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: mod, require: name => mocks[name] || localRequire(name), console, process }, { filename });
  return mod.exports;
}

test('pricing: known Haversine distance, zero distance, symmetry, same distance and invalid coordinates', () => {
  const quote = estimate({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.equal(quote.estimatedDistance, 111.19);
  assert.equal(quote.fareAmount, 1124000);
  assert.deepEqual(quote, estimate({ lat: 20, lng: 0 }, { lat: 21, lng: 0 }));
  assert.deepEqual(quote, estimate({ lat: 1, lng: 0 }, { lat: 0, lng: 0 }));
  assert.equal(estimate({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }).fareAmount, 12000);
  for (const point of [null, {}, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: '1', lng: 2 }, { lat: NaN, lng: 0 }]) {
    assert.throws(() => estimate(point, { lat: 0, lng: 0 }), { status: 400 });
  }
  assert.ok(Number.isFinite(estimate({ lat: 90, lng: 180 }, { lat: -90, lng: -180 }).fareAmount));
});

test('optimistic locking rejects a stale version before history or external side effects', async () => {
  const queries = [];
  const saga = load('saga.js', { './events': {}, './service-client': {}, './logger': () => {} });
  const client = { query: async (sql, values) => { queries.push({ sql, values }); return { rowCount: 0, rows: [] }; } };
  await assert.rejects(saga.history(client, { tripId: uuid(), version: 7, status: 'AWAITING_DRIVER' }, 'IN_PROGRESS', 'accept'), { status: 409 });
  assert.equal(queries.length, 1);
  assert.ok(queries[0].sql.includes('AND version=$5'));
  assert.equal(queries[0].values[4], 7);
});

async function harness() {
  const express = require('../trip-service/node_modules/express');
  const trips = new Map(), outbox = [], calls = [], history = [], processed = new Set();
  const client = { query: async (sql, args) => {
    if (sql.startsWith('SELECT')) return { rows: trips.has(args[0]) ? [{ ...trips.get(args[0]) }] : [] };
    if (sql.startsWith('INSERT INTO trips')) {
      const trip = { tripId: args[0], passengerId: args[1], pickup: args[2], destination: args[3], estimatedDistance: args[4], fare: args[5], sagaId: args[6], status: 'REQUESTED', driverId: null, version: 0, rejectedDriverIds: [] };
      trips.set(trip.tripId, trip);
      return { rows: [{ ...trip }], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE trips')) {
      const trip = trips.get(args[0]);
      if (trip.version !== args[4]) return { rows: [], rowCount: 0 };
      Object.assign(trip, { status: args[1], paymentId: args[2], driverId: args[3], rejectedDriverIds: args[5], version: trip.version + 1 });
      return { rows: [{ ...trip }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO trip_status_history')) history.push(args);
    return { rows: [], rowCount: 1 };
  } };
  const events = {
    transaction: async work => {
      const snapshot = JSON.stringify([...trips]), eventLength = outbox.length, historyLength = history.length;
      try { return await work(client); }
      catch (error) { trips.clear(); for (const [key, value] of JSON.parse(snapshot)) trips.set(key, value); outbox.length = eventLength; history.length = historyLength; throw error; }
    },
    once: async (event, work) => { if (!processed.has(event.eventId)) { await events.transaction(work); processed.add(event.eventId); } },
    enqueue: async (client, eventType, payload, correlationId) => outbox.push({ eventType, payload, correlationId }),
  };
  const driver = { request: async (...args) => calls.push(args) };
  const saga = load('saga.js', { './events': events, './service-client': driver, './logger': () => {} });
  const routes = load('routes.js', { './db': client, './events': events, './saga': saga, './service-client': driver });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.correlationId = uuid(); next(); });
  routes(Object.fromEntries(['get', 'post'].map(method => [method, (route, handler) => app[method](route, (req, res, next) => Promise.resolve(handler(req, res)).catch(next))])));
  app.use((error, req, res, next) => res.status(error.status || 503).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return {
    trips, outbox, calls, history, saga,
    call: async (route, actor, body, method = 'POST') => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method, headers: { ...(actor ? { 'X-User-Id': actor.id, 'X-User-Roles': actor.role } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json() };
    },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

test('Trip HTTP: Gateway identity, owner reads, driver action matrix, immutable fare and idempotent completion', async () => {
  const h = await harness();
  const rider = { id: uuid(), role: 'ROLE_PASSENGER' }, other = { id: uuid(), role: 'ROLE_PASSENGER' };
  const driver = { id: uuid(), role: 'ROLE_DRIVER' }, stranger = { id: uuid(), role: 'ROLE_DRIVER' };
  const body = { pickup: { lat: 10.77, lng: 106.7 }, destination: { lat: 10.78, lng: 106.71 }, fareAmount: 1, estimatedDistance: 999999 };
  try {
    assert.equal((await h.call('/trips', null, body)).status, 401);
    assert.equal((await h.call('/trips', driver, body)).status, 403);
    assert.equal((await h.call('/trips', rider, { ...body, riderId: other.id })).status, 403);
    const quote = await h.call('/trips/estimate', rider, body);
    const created = await h.call('/trips', rider, body);
    assert.equal(created.status, 201);
    assert.equal(created.data.passengerId, rider.id);
    assert.equal(created.data.fare, quote.data.fareAmount);
    assert.equal(created.data.estimatedDistance, quote.data.estimatedDistance);
    const trip = h.trips.get(created.data.tripId), route = `/trips/${trip.tripId}`;
    assert.equal((await h.call(route, rider, undefined, 'GET')).status, 200);
    assert.equal((await h.call(route, other, undefined, 'GET')).status, 403);
    Object.assign(trip, { driverId: driver.id, status: 'AWAITING_DRIVER' });
    assert.equal((await h.call(route, driver, undefined, 'GET')).status, 200);
    assert.equal((await h.call(route, stranger, undefined, 'GET')).status, 403);
    for (const action of ['accept', 'reject', 'start', 'complete']) {
      assert.equal((await h.call(`${route}/${action}`, rider)).status, 403);
      assert.equal((await h.call(`${route}/${action}`, stranger)).status, 403);
    }
    assert.equal((await h.call(`${route}/complete`, driver)).status, 409);
    assert.equal((await h.call(`${route}/accept`, driver)).data.status, 'IN_PROGRESS');
    assert.equal((await h.call(`${route}/start`, driver)).data.status, 'IN_PROGRESS');
    assert.equal(h.calls.length, 1);
    assert.equal((await h.call(`${route}/cancel`, rider)).status, 409);
    assert.equal((await h.call(`${route}/reject`, driver)).status, 409);
    const completed = await h.call(`${route}/complete`, driver, { fareAmount: 9999999 });
    assert.equal(completed.data.status, 'PAYMENT_PENDING');
    assert.equal(completed.data.fare, quote.data.fareAmount);
    await h.call(`${route}/complete`, driver, { fareAmount: -10 });
    const events = h.outbox.filter(event => event.eventType === 'trip.completed');
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.fareAmount, quote.data.fareAmount);
  } finally { await h.close(); }
});

test('cancel before acceptance releases assigned reservation once; late assignment cannot revive cancellation', async () => {
  const h = await harness(), rider = { id: uuid(), role: 'ROLE_PASSENGER' };
  try {
    const created = await h.call('/trips', rider, { pickup: { lat: 10, lng: 106 }, destination: { lat: 10.01, lng: 106 } });
    const trip = h.trips.get(created.data.tripId), driverId = uuid();
    Object.assign(trip, { driverId, status: 'AWAITING_DRIVER' });
    const route = `/trips/${trip.tripId}/cancel`;
    assert.equal((await h.call(route, { id: uuid(), role: 'ROLE_PASSENGER' })).status, 403);
    assert.equal((await h.call(route, rider)).data.status, 'CANCELLED');
    assert.equal((await h.call(route, rider)).data.status, 'CANCELLED');
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0][3].tripId, trip.tripId);
    assert.equal(h.outbox.filter(event => event.eventType === 'trip.cancelled').length, 1);
    await h.saga.assigned({ eventId: uuid(), correlationId: uuid(), payload: { tripId: trip.tripId, riderId: rider.id, driverId } });
    assert.equal(h.trips.get(trip.tripId).status, 'CANCELLED');
    assert.equal(h.calls.length, 2);
  } finally { await h.close(); }
});

test('matching exhaustion fails and emits one passenger event despite duplicates', async () => {
  const h = await harness(), rider = { id: uuid(), role: 'ROLE_PASSENGER' };
  try {
    const created = await h.call('/trips', rider, { pickup: { lat: 10, lng: 106 }, destination: { lat: 11, lng: 106 } });
    const event = { eventId: uuid(), correlationId: uuid(), payload: { tripId: created.data.tripId, riderId: rider.id, reason: 'NO_AVAILABLE_DRIVERS' } };
    await h.saga.failed(event);
    await h.saga.failed(event);
    await h.saga.failed({ ...event, eventId: uuid() });
    assert.equal(h.trips.get(created.data.tripId).status, 'FAILED');
    assert.equal(h.outbox.filter(event => event.eventType === 'trip.failed').length, 1);
  } finally { await h.close(); }
});
