'use strict';
// Loại xe, bảng giá fare_rates và các API đọc mà web RideFlow cần:
// GET /trips/fare-rates, POST /trips/estimate (options), POST /trips (vehicleType),
// GET /trips/me, GET /trips/{id}/history; Matching chỉ ghép tài xế đúng loại xe.
// Chạy: node --test scripts/trip-vehicle-fare.test.js (không cần Docker).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const uuid = () => crypto.randomUUID();
const fare = require('../trip-service/src/fare');

function load(service, file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', service, 'src', file);
  const mod = { exports: {} };
  const localRequire = require('node:module').createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: mod, exports: mod.exports, require: name => (name in mocks ? mocks[name] : localRequire(name)), console, process, Date }, { filename });
  return mod.exports;
}

const A = { lat: 0, lng: 0 };
const B = { lat: 1, lng: 0 }; // 111,19 km

test('fare: mỗi loại xe một giá; xe máy giữ đúng công thức cũ; loại xe sai bị từ chối', () => {
  const quote = fare.estimate(A, B);
  assert.equal(quote.vehicleType, 'MOTORCYCLE');
  assert.equal(quote.estimatedDistance, 111.19);
  assert.equal(quote.fareAmount, 1124000);
  assert.deepEqual(quote.options.map(o => [o.vehicleType, o.fareAmount, o.seats]), [['MOTORCYCLE', 1124000, 1], ['CAR_4_SEAT', 1688000, 4], ['CAR_7_SEAT', 2027000, 7]]);
  assert.ok(quote.options.every(o => o.displayName && o.currency === 'VND' && o.estimatedDistance === 111.19));
  assert.equal(fare.estimate(A, B, fare.DEFAULT_RATES, 'CAR_7_SEAT').fareAmount, 2027000);
  assert.throws(() => fare.estimate(A, B, fare.DEFAULT_RATES, 'BUS'), { status: 400 });
  const cheaper = fare.DEFAULT_RATES.map(r => (r.vehicleType === 'CAR_4_SEAT' ? { ...r, baseFare: 0, perKm: 1000 } : r));
  assert.equal(fare.estimate(A, B, cheaper, 'CAR_4_SEAT').fareAmount, 112000);
});

test('fare.point chỉ giữ lat, lng và địa chỉ đã làm sạch', () => {
  assert.deepEqual(fare.point({ lat: 10.5, lng: 106.7, address: '  12 Lê Lợi\u0000\n Q1  ', evil: 'x' }), { lat: 10.5, lng: 106.7, address: '12 Lê Lợi Q1' });
  assert.equal(fare.point({ lat: 1, lng: 2, address: 'a'.repeat(300) }).address.length, 200);
  assert.deepEqual(fare.point({ lat: 1, lng: 2, address: 42 }), { lat: 1, lng: 2 });
  assert.deepEqual(fare.point({ lat: 1, lng: 2, address: '   ' }), { lat: 1, lng: 2 });
  assert.throws(() => fare.point({ lat: 91, lng: 0 }), { status: 400 });
});

test('rates: đọc bảng fare_rates, đổi kiểu số, cache 30 giây, bảng trống hoặc dòng lạ thì dùng giá mặc định', async () => {
  let clock = 0, queries = 0, rows = [{ vehicleType: 'CAR_4_SEAT', displayName: 'Ô tô 4 chỗ', seats: 4, baseFare: '21000.00', perKm: '16000.00' }];
  const db = { query: async () => { queries++; return { rows }; } };
  const rates = require('../trip-service/src/rates')(db, { now: () => clock });
  assert.deepEqual(await rates.list(), [{ vehicleType: 'CAR_4_SEAT', displayName: 'Ô tô 4 chỗ', seats: 4, baseFare: 21000, perKm: 16000 }]);
  clock = 29999;
  await rates.list();
  assert.equal(queries, 1);
  clock = 30000;
  rows = [];
  assert.deepEqual(await rates.list(), fare.DEFAULT_RATES);
  assert.equal(queries, 2);
  const junk = require('../trip-service/src/rates')({ query: async () => ({ rows: [{ tripId: uuid(), status: 'REQUESTED' }] }) });
  assert.deepEqual(await junk.list(), fare.DEFAULT_RATES);
});

async function tripHarness(rateList = fare.DEFAULT_RATES) {
  const express = require('../trip-service/node_modules/express');
  const trips = new Map(), history = [], outbox = [], driverCalls = [];
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 23, 0, 0, tick++)).toISOString();
  const client = { query: async (sql, args = []) => {
    // Như PostgreSQL: số placeholder $n phải khớp số tham số truyền vào.
    const placeholders = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1])));
    assert.equal(placeholders, args.length, `Câu SQL có ${placeholders} placeholder nhưng truyền ${args.length} tham số: ${sql}`);
    if (sql.startsWith('INSERT INTO trips')) {
      const trip = { tripId: args[0], passengerId: args[1], pickup: args[2], destination: args[3], estimatedDistance: args[4], fare: args[5], sagaId: args[6], vehicleType: args[7], status: 'REQUESTED', driverId: null, paymentId: null, version: 0, rejectedDriverIds: [], createdAt: stamp() };
      trips.set(trip.tripId, trip);
      return { rows: [{ ...trip }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO trip_status_history')) {
      const [tripId, a, b, c] = args;
      history.push(args.length === 3 ? { tripId, previousStatus: null, status: a, reason: b, createdAt: stamp() } : { tripId, previousStatus: a, status: b, reason: c, createdAt: stamp() });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE trips')) {
      const trip = trips.get(args[0]);
      if (trip.version !== args[4]) return { rows: [], rowCount: 0 };
      Object.assign(trip, { status: args[1], paymentId: args[2], driverId: args[3], rejectedDriverIds: args[5], version: trip.version + 1 });
      return { rows: [{ ...trip }], rowCount: 1 };
    }
    if (sql.includes('FROM trip_status_history')) {
      assert.match(sql, /previous_status AS "previousStatus"/);
      assert.match(sql, /new_status AS status/);
      return { rows: history.filter(h => h.tripId === args[0]).map(({ tripId, ...row }) => row) };
    }
    if (/FROM trips WHERE "(passengerId|driverId)"/.test(sql)) {
      const column = sql.includes('"passengerId"') ? 'passengerId' : 'driverId';
      const status = sql.includes('status=$2') ? args[1] : null;
      const limit = args.at(-1);
      assert.match(sql, /ORDER BY "createdAt" DESC/);
      const rows = [...trips.values()].filter(t => t[column] === args[0] && (!status || t.status === status)).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, limit);
      return { rows: rows.map(t => ({ ...t })) };
    }
    if (sql.includes('FROM trips WHERE "tripId"')) return { rows: trips.has(args[0]) ? [{ ...trips.get(args[0]) }] : [] };
    throw new Error(`Câu SQL chưa giả lập: ${sql}`);
  } };
  const events = {
    transaction: async work => work(client),
    once: async (event, work) => work(client),
    enqueue: async (c, eventType, payload, correlationId) => outbox.push({ eventType, payload, correlationId }),
  };
  const driver = { request: async (...args) => driverCalls.push(args), release: async () => {} };
  const saga = load('trip-service', 'saga.js', { './events': events, './service-client': driver, './logger': () => {} });
  const routes = load('trip-service', 'routes.js', { './db': client, './events': events, './saga': saga, './service-client': driver, './rates': () => ({ list: async () => rateList }) });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.correlationId = uuid(); next(); });
  routes(Object.fromEntries(['get', 'post'].map(method => [method, (route, handler) => app[method](route, (req, res, next) => Promise.resolve(handler(req, res)).catch(next))])));
  app.use((error, req, res, next) => res.status(error.status || 503).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const call = async (route, actor, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method,
      headers: { ...(actor ? { 'X-User-Id': actor.id, 'X-User-Roles': actor.role } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  return { trips, history, outbox, driverCalls, call, close: () => new Promise(resolve => server.close(resolve)) };
}

const passenger = () => ({ id: uuid(), role: 'ROLE_PASSENGER' });
const driverActor = () => ({ id: uuid(), role: 'ROLE_DRIVER' });
const pickup = { lat: 10.77, lng: 106.7, address: '1 Lê Lợi, Quận 1' };
const destination = { lat: 10.78, lng: 106.71, address: '2 Hàm Nghi' };

test('HTTP: bảng giá và báo giá theo loại xe', async () => {
  const custom = [{ vehicleType: 'MOTORCYCLE', displayName: 'Xe máy', seats: 1, baseFare: 15000, perKm: 10000 }, { vehicleType: 'CAR_4_SEAT', displayName: 'Ô tô 4 chỗ', seats: 4, baseFare: 30000, perKm: 20000 }];
  const h = await tripHarness(custom);
  const rider = passenger();
  try {
    assert.equal((await h.call('/trips/fare-rates', null)).status, 401);
    const rates = await h.call('/trips/fare-rates', rider);
    assert.equal(rates.status, 200);
    assert.deepEqual(rates.data, custom);
    assert.equal((await h.call('/trips/fare-rates', driverActor())).status, 200);
    const quote = await h.call('/trips/estimate', rider, { pickup: A, destination: B });
    assert.equal(quote.status, 200);
    assert.deepEqual(quote.data.options.map(o => [o.vehicleType, o.fareAmount]), [['MOTORCYCLE', 1127000], ['CAR_4_SEAT', 2254000]]);
    assert.equal(quote.data.fareAmount, 1127000);
    assert.equal((await h.call('/trips/estimate', rider, { pickup: A, destination: B, vehicleType: 'CAR_4_SEAT' })).data.fareAmount, 2254000);
    assert.equal((await h.call('/trips/estimate', rider, { pickup: A, destination: B, vehicleType: 'CAR_7_SEAT' })).status, 400);
  } finally { await h.close(); }
});

test('HTTP: đặt chuyến lưu loại xe, giá đúng loại xe, địa chỉ đã làm sạch và phát vehicleType', async () => {
  const h = await tripHarness();
  const rider = passenger();
  try {
    const car = await h.call('/trips', rider, { pickup: { ...pickup, extra: 'x' }, destination, vehicleType: 'CAR_4_SEAT', fareAmount: 1 });
    assert.equal(car.status, 201);
    const expected = fare.estimate(pickup, destination, fare.DEFAULT_RATES, 'CAR_4_SEAT');
    assert.equal(car.data.vehicleType, 'CAR_4_SEAT');
    assert.equal(car.data.fare, expected.fareAmount);
    assert.deepEqual(car.data.pickup, pickup);
    const requested = h.outbox.find(e => e.eventType === 'trip.requested' && e.payload.tripId === car.data.tripId);
    assert.equal(requested.payload.vehicleType, 'CAR_4_SEAT');
    assert.equal(requested.payload.fareAmount, expected.fareAmount);
    const bike = await h.call('/trips', rider, { pickup, destination });
    assert.equal(bike.data.vehicleType, 'MOTORCYCLE');
    assert.equal(bike.data.fare, fare.estimate(pickup, destination).fareAmount);
    assert.equal((await h.call('/trips', rider, { pickup, destination, vehicleType: 'BUS' })).status, 400);
  } finally { await h.close(); }
});

test('HTTP: GET /trips/me — chỉ chuyến của mình, mới nhất trước, lọc trạng thái, tối đa 100', async () => {
  const h = await tripHarness();
  const rider = passenger(), other = passenger(), driver = driverActor();
  try {
    const first = (await h.call('/trips', rider, { pickup, destination })).data;
    const second = (await h.call('/trips', rider, { pickup, destination })).data;
    await h.call('/trips', other, { pickup, destination });
    Object.assign(h.trips.get(first.tripId), { status: 'CONFIRMED', driverId: driver.id });
    assert.equal((await h.call('/trips/me', null)).status, 401);
    const mine = await h.call('/trips/me', rider);
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.data.map(t => t.tripId), [second.tripId, first.tripId]);
    assert.deepEqual((await h.call('/trips/me?status=CONFIRMED', rider)).data.map(t => t.tripId), [first.tripId]);
    assert.deepEqual((await h.call('/trips/me?limit=1', rider)).data.map(t => t.tripId), [second.tripId]);
    assert.equal((await h.call('/trips/me?limit=500', rider)).data.length, 2);
    assert.equal((await h.call('/trips/me?status=FLYING', rider)).status, 400);
    assert.deepEqual((await h.call('/trips/me', driver)).data.map(t => t.tripId), [first.tripId]);
    assert.equal((await h.call('/trips/me', { id: uuid(), role: 'ROLE_ADMIN' })).status, 403);
  } finally { await h.close(); }
});

test('HTTP: GET /trips/{id}/history — cùng quyền đọc như chi tiết chuyến, theo thứ tự thời gian', async () => {
  const h = await tripHarness();
  const rider = passenger(), driver = driverActor();
  try {
    const trip = (await h.call('/trips', rider, { pickup, destination })).data;
    Object.assign(h.trips.get(trip.tripId), { status: 'AWAITING_DRIVER', driverId: driver.id });
    await h.call(`/trips/${trip.tripId}/accept`, driver, {});
    const history = await h.call(`/trips/${trip.tripId}/history`, rider);
    assert.equal(history.status, 200);
    assert.deepEqual(history.data.map(x => [x.previousStatus, x.status]), [[null, 'REQUESTED'], ['AWAITING_DRIVER', 'IN_PROGRESS']]);
    assert.ok(history.data.every(x => 'reason' in x && x.createdAt));
    assert.equal((await h.call(`/trips/${trip.tripId}/history`, driver)).status, 200);
    assert.equal((await h.call(`/trips/${trip.tripId}/history`, passenger())).status, 403);
    assert.equal((await h.call(`/trips/${trip.tripId}/history`, null)).status, 401);
    assert.equal((await h.call('/trips/not-a-uuid/history', rider)).status, 400);
  } finally { await h.close(); }
});

test('HTTP: tài xế từ chối thì trip.driver_rejected mang vehicleType để ghép lại đúng loại xe', async () => {
  const h = await tripHarness();
  const rider = passenger(), driver = driverActor();
  try {
    const trip = (await h.call('/trips', rider, { pickup, destination, vehicleType: 'CAR_7_SEAT' })).data;
    Object.assign(h.trips.get(trip.tripId), { status: 'AWAITING_DRIVER', driverId: driver.id });
    assert.equal((await h.call(`/trips/${trip.tripId}/reject`, driver, {})).status, 200);
    const rejected = h.outbox.find(e => e.eventType === 'trip.driver_rejected');
    assert.equal(rejected.payload.vehicleType, 'CAR_7_SEAT');
  } finally { await h.close(); }
});

function matchingHarness(candidates) {
  const updates = [], outbox = [];
  const row = { status: 'PENDING', selectedDriverId: null, attemptedDriverIds: [], reservationId: uuid() };
  const client = { query: async (sql, args) => {
    if (sql.startsWith('SELECT')) return { rows: [{ ...row }] };
    if (sql.startsWith('UPDATE')) updates.push(args);
    return { rows: [], rowCount: 1 };
  } };
  const events = { transaction: async work => work(client), enqueue: async (c, eventType, payload) => outbox.push({ eventType, payload }) };
  const service = { request: async () => candidates };
  const matching = load('matching-service', 'matching.js', { './events': events, './service-client': service });
  const requested = vehicleType => ({ eventId: uuid(), eventType: 'trip.requested', correlationId: uuid(), occurredAt: new Date().toISOString(), payload: { tripId: uuid(), riderId: uuid(), pickup: { lat: 10.77, lng: 106.7 }, ...(vehicleType ? { vehicleType } : {}) } });
  return { matching, updates, outbox, requested };
}

test('Matching chỉ chọn tài xế đúng loại xe, bỏ qua tài xế khác loại dù gần hơn', async () => {
  const bike = { id: uuid(), vehicleType: 'MOTORCYCLE' }, car = { id: uuid(), vehicleType: 'CAR_4_SEAT' };
  const h = matchingHarness([bike, car]);
  await h.matching.prepare(h.requested('CAR_4_SEAT'));
  assert.equal(h.updates.at(-1)[1], car.id);
  await h.matching.prepare(h.requested());
  assert.equal(h.updates.at(-1)[1], bike.id, 'event cũ không có vehicleType vẫn ghép tài xế gần nhất');
  await h.matching.prepare(h.requested('CAR_7_SEAT'));
  assert.equal(h.updates.at(-1)[1], 'FAILED');
  assert.equal(h.outbox.at(-1).eventType, 'matching.failed');
});

test('validation: vehicleType trong trip.requested và trip.driver_rejected là tùy chọn nhưng phải hợp lệ', () => {
  for (const service of ['trip-service', 'matching-service']) {
    const { validate, InvalidEvent } = require(`../${service}/src/validation`);
    const base = { eventId: uuid(), eventType: 'trip.requested', correlationId: uuid(), occurredAt: new Date().toISOString(), payload: { tripId: uuid(), riderId: uuid(), pickup: { lat: 1, lng: 2 } } };
    assert.ok(validate(base, 'trip.requested'));
    assert.ok(validate({ ...base, payload: { ...base.payload, vehicleType: 'CAR_7_SEAT' } }, 'trip.requested'));
    assert.throws(() => validate({ ...base, payload: { ...base.payload, vehicleType: 'BUS' } }, 'trip.requested'), InvalidEvent);
  }
});
