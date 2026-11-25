'use strict';
// Loại xe và các API mà web RideFlow cần, trên nền dynamic pricing (pricing.js):
// GET /trips/fare-rates, POST /trips/estimate (options), POST /trips (vehicleType),
// GET /trips/me, GET /trips/{id}/history; Matching chỉ ghép tài xế đúng loại xe.
// Công thức giá, khóa quote và SQL của pricing được kiểm thử ở dynamic-pricing.test.js.
// Chạy: node --test scripts/trip-vehicle-fare.test.js (không cần Docker).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const uuid = () => crypto.randomUUID();
const fare = require('../trip-service/src/fare');
const { createPricing } = require('../trip-service/src/pricing');
const { PGlite } = require('../trip-service/node_modules/@electric-sql/pglite');

function load(service, file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', service, 'src', file);
  const mod = { exports: {} };
  const localRequire = require('node:module').createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: mod, exports: mod.exports, require: name => (name in mocks ? mocks[name] : localRequire(name)), console, process, Date }, { filename });
  return mod.exports;
}

const pickup = { lat: 10.77, lng: 106.7, address: '1 Lê Lợi, Quận 1' };
const destination = { lat: 10.78, lng: 106.71, address: '2 Hàm Nghi' };

test('fare.point chỉ giữ lat, lng và địa chỉ đã làm sạch', () => {
  assert.deepEqual(fare.point({ lat: 10.5, lng: 106.7, address: '  12 Lê Lợi\u0000\n Q1  ', evil: 'x' }), { lat: 10.5, lng: 106.7, address: '12 Lê Lợi Q1' });
  assert.equal(fare.point({ lat: 1, lng: 2, address: 'a'.repeat(300) }).address.length, 200);
  assert.deepEqual(fare.point({ lat: 1, lng: 2, address: 42 }), { lat: 1, lng: 2 });
  assert.deepEqual(fare.point({ lat: 1, lng: 2, address: '   ' }), { lat: 1, lng: 2 });
  assert.throws(() => fare.point({ lat: 91, lng: 0 }), { status: 400 });
});

test('pricing: volume cũ có fare_rates của rates.js được đổi tên; bảng giá web lấy từ fare_rates mới', async t => {
  // PGlite chạy PostgreSQL thật trong WASM, như dynamic-pricing.test.js.
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(fs.readFileSync(path.resolve(__dirname, '../trip-service/trip_db.sql'), 'utf8'));
  // Cấu trúc mà rates.js (đã bỏ khi gộp dynamic pricing) tạo trên volume cũ.
  await pg.exec(`CREATE TABLE fare_rates ("vehicleType" VARCHAR(20) PRIMARY KEY, "displayName" VARCHAR(50) NOT NULL, seats INTEGER NOT NULL,
      "baseFare" NUMERIC(12, 2) NOT NULL, "perKm" NUMERIC(12, 2) NOT NULL, "sortOrder" INTEGER NOT NULL DEFAULT 0);
    INSERT INTO fare_rates VALUES ('MOTORCYCLE', 'Xe máy', 1, 12000, 10000, 0);
    ALTER TABLE trips ADD COLUMN IF NOT EXISTS "vehicleType" VARCHAR(20) NOT NULL DEFAULT 'MOTORCYCLE';`);
  const db = { query: async (sql, args) => (args === undefined && sql.includes(';') ? (await pg.exec(sql)).at(-1) : pg.query(sql, args)) };
  const providers = { route: async () => ({ distanceKm: 5, durationMinutes: 10, source: 'google_routes_traffic' }), weather: async () => ({ raining: false, status: 'disabled' }) };
  const pricing = createPricing({ db, cache: { isReady: false }, driver: {}, providers });
  await pricing.initialize();
  await pricing.initialize(); // Khởi động lại không đổi tên lần nữa.
  const legacy = await pg.query('SELECT "vehicleType" FROM fare_rates_legacy');
  assert.deepEqual(legacy.rows, [{ vehicleType: 'MOTORCYCLE' }], 'dữ liệu cũ được giữ trong fare_rates_legacy');
  assert.deepEqual(await pricing.rates(), [
    { vehicleType: 'MOTORCYCLE', displayName: 'Xe máy', seats: 1, baseFare: 12000, perKm: 10000, perMinute: 300, minimumFare: 12000 },
    { vehicleType: 'CAR_4_SEAT', displayName: 'Ô tô 4 chỗ', seats: 4, baseFare: 20000, perKm: 14000, perMinute: 500, minimumFare: 25000 },
    { vehicleType: 'CAR_7_SEAT', displayName: 'Ô tô 7 chỗ', seats: 7, baseFare: 25000, perKm: 17000, perMinute: 600, minimumFare: 30000 },
  ]);
  const car = await pricing.quote(uuid(), { pickup, destination, vehicleType: 'CAR_4_SEAT' });
  assert.equal(car.vehicleType, 'CAR_4_SEAT');
  assert.ok(car.quoteId && car.fareAmount > 0);
  await assert.rejects(pricing.quote(uuid(), { pickup, destination, vehicleType: 'BUS' }), { status: 400 });
});

// Giả lập pricing.js theo đúng giao diện quote/lockQuote/rates, giá cố định theo loại xe,
// để kiểm thử phần route của Trip mà không cần PostgreSQL.
const PRICES = { MOTORCYCLE: 48000, CAR_4_SEAT: 72000, CAR_7_SEAT: 90000 };
const RATES = fare.VEHICLES.map(v => ({ ...v, baseFare: 1, perKm: 2, perMinute: 3, minimumFare: 4 }));
function fakePricing() {
  const quotes = new Map(), bodies = [];
  return {
    bodies,
    async quote(owner, body) {
      bodies.push(body);
      const vehicleType = body.vehicleType ?? 'MOTORCYCLE';
      const snapshot = { quoteId: uuid(), pickup: body.pickup, destination: body.destination, vehicleType, estimatedDistance: 1.5, estimatedDuration: 6, fareAmount: PRICES[vehicleType], currency: 'VND', pricingVersion: 'dynamic-v1' };
      quotes.set(snapshot.quoteId, snapshot);
      return snapshot;
    },
    async lockQuote(client, quoteId) { return { snapshot: quotes.get(quoteId) }; },
    async rates() { return RATES; },
  };
}

async function tripHarness() {
  const express = require('../trip-service/node_modules/express');
  const trips = new Map(), history = [], outbox = [], driverCalls = [];
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 23, 0, 0, tick++)).toISOString();
  const client = { query: async (sql, args = []) => {
    // Như PostgreSQL: số placeholder $n phải khớp số tham số truyền vào.
    const placeholders = Math.max(0, ...[...sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1])));
    assert.equal(placeholders, args.length, `Câu SQL có ${placeholders} placeholder nhưng truyền ${args.length} tham số: ${sql}`);
    if (sql.startsWith('INSERT INTO trips')) {
      const trip = { tripId: args[0], passengerId: args[1], pickup: args[2], destination: args[3], estimatedDistance: args[4], fare: args[5], sagaId: args[6], vehicleType: args[7], paymentMethod: args[11], noteForDriver: args[15], status: 'REQUESTED', driverId: null, paymentId: null, version: 0, rejectedDriverIds: [], createdAt: stamp() };
      trips.set(trip.tripId, trip);
      return { rows: [{ ...trip }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO trip_status_history')) {
      const [tripId, a, b, c] = args;
      history.push(args.length === 3 ? { tripId, previousStatus: null, status: a, reason: b, createdAt: stamp() } : { tripId, previousStatus: a, status: b, reason: c, createdAt: stamp() });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE fare_quotes')) return { rows: [], rowCount: 1 };
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
  const pricing = fakePricing();
  const routes = load('trip-service', 'routes.js', { './db': client, './events': events, './saga': saga, './service-client': driver, './pricing': pricing });
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
  return { trips, history, outbox, driverCalls, pricing, call, close: () => new Promise(resolve => server.close(resolve)) };
}

const passenger = () => ({ id: uuid(), role: 'ROLE_PASSENGER' });
const driverActor = () => ({ id: uuid(), role: 'ROLE_DRIVER' });

test('HTTP: bảng giá và báo giá theo loại xe', async () => {
  const h = await tripHarness();
  const rider = passenger();
  try {
    assert.equal((await h.call('/trips/fare-rates', null)).status, 401);
    const rates = await h.call('/trips/fare-rates', rider);
    assert.equal(rates.status, 200);
    assert.deepEqual(rates.data, RATES);
    assert.equal((await h.call('/trips/fare-rates', driverActor())).status, 200);
    // Không có vehicleType: mỗi loại xe một quote trong options; phần ngoài là quote xe máy.
    const quote = await h.call('/trips/estimate', rider, { pickup: { ...pickup, address: '  1 Lê Lợi,\n Quận 1 ', evil: 'x' }, destination });
    assert.equal(quote.status, 200);
    assert.deepEqual(quote.data.options.map(o => [o.vehicleType, o.fareAmount, o.seats, o.displayName]), [['MOTORCYCLE', 48000, 1, 'Xe máy'], ['CAR_4_SEAT', 72000, 4, 'Ô tô 4 chỗ'], ['CAR_7_SEAT', 90000, 7, 'Ô tô 7 chỗ']]);
    assert.equal(new Set(quote.data.options.map(o => o.quoteId)).size, 3);
    assert.equal(quote.data.vehicleType, 'MOTORCYCLE');
    assert.equal(quote.data.quoteId, quote.data.options[0].quoteId);
    assert.ok(h.pricing.bodies.every(b => JSON.stringify(b.pickup) === JSON.stringify(pickup)), 'quote chỉ nhận tọa độ và địa chỉ đã làm sạch');
    // Có vehicleType: một quote, không kèm options.
    const car = await h.call('/trips/estimate', rider, { pickup, destination, vehicleType: 'CAR_4_SEAT' });
    assert.equal(car.data.fareAmount, 72000);
    assert.equal(car.data.options, undefined);
    assert.equal((await h.call('/trips/estimate', rider, { pickup: { lat: 91, lng: 0 }, destination })).status, 400);
  } finally { await h.close(); }
});

test('HTTP: đặt chuyến lưu loại xe, giá do server báo, địa chỉ đã làm sạch và phát vehicleType', async () => {
  const h = await tripHarness();
  const rider = passenger();
  try {
    const car = await h.call('/trips', rider, { pickup: { ...pickup, extra: 'x' }, destination, vehicleType: 'CAR_4_SEAT', fareAmount: 1 });
    assert.equal(car.status, 201);
    assert.equal(car.data.vehicleType, 'CAR_4_SEAT');
    assert.equal(car.data.fare, PRICES.CAR_4_SEAT);
    assert.deepEqual(car.data.pickup, pickup);
    const requested = h.outbox.find(e => e.eventType === 'trip.requested' && e.payload.tripId === car.data.tripId);
    assert.equal(requested.payload.vehicleType, 'CAR_4_SEAT');
    assert.equal(requested.payload.fareAmount, PRICES.CAR_4_SEAT);
    const bike = await h.call('/trips', rider, { pickup, destination });
    assert.equal(bike.data.vehicleType, 'MOTORCYCLE');
    assert.equal(bike.data.fare, PRICES.MOTORCYCLE);
    // Đặt bằng quoteId đã hiển thị: dùng đúng quote đó, không báo giá lại.
    const quoted = (await h.call('/trips/estimate', rider, { pickup, destination, vehicleType: 'CAR_7_SEAT' })).data;
    const quoteCount = h.pricing.bodies.length;
    const locked = await h.call('/trips', rider, { quoteId: quoted.quoteId });
    assert.equal(locked.status, 201);
    assert.deepEqual([locked.data.vehicleType, locked.data.fare], ['CAR_7_SEAT', PRICES.CAR_7_SEAT]);
    assert.equal(h.pricing.bodies.length, quoteCount);
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
  // Đã tìm 4 phút (quá hạn 3 phút): không có xe đúng loại thì báo matching.failed ngay.
  const row = { status: 'PENDING', selectedDriverId: null, attemptedDriverIds: [], reservationId: uuid(), searchStartedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString() };
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

test('HTTP: đặt chuyến lưu phương thức thanh toán (mặc định BANK) và phát trong trip.requested, trip.completed', async () => {
  const h = await tripHarness();
  const rider = passenger(), driver = driverActor();
  try {
    assert.equal((await h.call('/trips', rider, { pickup, destination, paymentMethod: 'CARD' })).status, 400);
    const bank = await h.call('/trips', rider, { pickup, destination });
    assert.equal(bank.data.paymentMethod, 'BANK');
    const cash = await h.call('/trips', rider, { pickup, destination, paymentMethod: 'CASH' });
    assert.equal(cash.status, 201);
    assert.equal(cash.data.paymentMethod, 'CASH');
    const requested = h.outbox.filter(e => e.eventType === 'trip.requested');
    assert.deepEqual(requested.map(e => e.payload.paymentMethod), ['BANK', 'CASH']);
    // Hoàn thành chuyến tiền mặt: trip.completed mang CASH để Payment chờ tài xế xác nhận.
    Object.assign(h.trips.get(cash.data.tripId), { driverId: driver.id, status: 'AWAITING_DRIVER' });
    assert.equal((await h.call(`/trips/${cash.data.tripId}/accept`, driver, {})).status, 200);
    assert.equal((await h.call(`/trips/${cash.data.tripId}/complete`, driver, {})).status, 200);
    const completed = h.outbox.find(e => e.eventType === 'trip.completed');
    assert.equal(completed.payload.paymentMethod, 'CASH');
  } finally { await h.close(); }
});

test('HTTP: ghi chú cho tài xế được làm sạch, tối đa 200 ký tự', async () => {
  const h = await tripHarness();
  const rider = passenger();
  try {
    const noted = await h.call('/trips', rider, { pickup, destination, note: '  Đứng cổng số 2,\n áo xanh  ' });
    assert.equal(noted.status, 201);
    assert.equal(noted.data.noteForDriver, 'Đứng cổng số 2, áo xanh');
    assert.equal((await h.call('/trips', rider, { pickup, destination })).data.noteForDriver, null);
    assert.equal((await h.call('/trips', rider, { pickup, destination, note: 'x'.repeat(201) })).data.error, 'Note is too long');
    assert.equal((await h.call('/trips', rider, { pickup, destination, note: 42 })).status, 400);
  } finally { await h.close(); }
});

const authorizationFailed = trip => ({ eventId: uuid(), eventType: 'payment.authorization_failed', correlationId: uuid(), occurredAt: new Date().toISOString(),
  payload: { tripId: trip.tripId, riderId: trip.passengerId, amount: 120000, reason: 'INSUFFICIENT_FUNDS', failedAt: new Date().toISOString() } });

// saga.authorizationFailed (khóa tiền trước khi ghép tài xế) được kiểm thử ở trip-payment-voucher.test.js.

test('validation: payment.authorization_failed và paymentMethod trong trip.requested', () => {
  const { validate, InvalidEvent } = require('../trip-service/src/validation');
  const trip = { tripId: uuid(), passengerId: uuid() };
  const ok = authorizationFailed(trip);
  assert.ok(validate(ok, 'payment.authorization_failed'));
  assert.throws(() => validate({ ...ok, payload: { ...ok.payload, reason: 'NOPE' } }, 'payment.authorization_failed'), InvalidEvent);
  const requested = { eventId: uuid(), eventType: 'trip.requested', correlationId: uuid(), occurredAt: new Date().toISOString(), payload: { tripId: uuid(), riderId: uuid(), pickup: { lat: 1, lng: 2 }, paymentMethod: 'CASH' } };
  assert.ok(validate(requested, 'trip.requested'));
  assert.throws(() => validate({ ...requested, payload: { ...requested.payload, paymentMethod: 'CARD' } }, 'trip.requested'), InvalidEvent);
});

test('saga: tài xế không xác nhận cuốc quá 60 giây thì chuyến về MATCHING, loại tài xế đó và phát trip.driver_rejected để ghép tiếp', async () => {
  const trip = { tripId: uuid(), passengerId: uuid(), driverId: uuid(), status: 'AWAITING_DRIVER', version: 3, rejectedDriverIds: [], pickup: { lat: 21, lng: 105 }, sagaId: uuid(), vehicleType: 'MOTORCYCLE', paymentId: null };
  const firstDriver = trip.driverId;
  const client = { query: async (sql, args) => {
    if (sql.startsWith('SELECT "tripId" FROM trips')) return { rows: trip.status === 'AWAITING_DRIVER' ? [{ tripId: trip.tripId }] : [] };
    if (sql.startsWith('SELECT * FROM trips')) return { rows: trip.status === 'AWAITING_DRIVER' ? [{ ...trip }] : [] };
    if (sql.startsWith('UPDATE trips')) {
      if (args[4] !== trip.version) return { rows: [], rowCount: 0 };
      Object.assign(trip, { status: args[1], driverId: args[3], rejectedDriverIds: args[5], version: trip.version + 1 });
      return { rows: [{ ...trip }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  } };
  const outbox = [], calls = [];
  const events = { transaction: work => work(client), enqueue: async (c, eventType, payload, correlationId) => outbox.push({ eventType, payload, correlationId }) };
  const saga = load('trip-service', 'saga.js', { './events': events, './service-client': { request: async (...args) => calls.push(args), release: async () => {} }, './logger': () => {} });
  await saga.expireOffers(60);
  assert.equal(trip.status, 'MATCHING');
  assert.equal(trip.driverId, null);
  assert.equal(JSON.stringify(trip.rejectedDriverIds), JSON.stringify([firstDriver]));
  assert.ok(calls[0][1].endsWith(`/internal/drivers/${firstDriver}/reject`));
  assert.deepEqual(outbox.map(e => [e.eventType, e.payload.vehicleType]), [['trip.driver_rejected', 'MOTORCYCLE']]);
  assert.equal(outbox[0].correlationId, trip.sagaId);
  await saga.expireOffers(60);
  assert.equal(outbox.length, 1, 'chạy lại không phát thêm');
});
