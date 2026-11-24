'use strict';
// Phương thức thanh toán, voucher và Saga khoá tiền phía Trip/Matching (bản thiết kế mục 9.1, 9.2):
// - vouchers.js: tính giảm giá, mỗi khách dùng mỗi mã một lần, trả mã khi chuyến không thành.
// - routes.js: paymentMethod/voucherCode khi báo giá và đặt chuyến, GET /trips/vouchers,
//   trip.accepted khi tài xế nhận chuyến, trip.completed mang paymentMethod.
// - saga.js: payment.authorized → MATCHING + trip.matching_requested;
//   payment.authorization_failed → FAILED + trả voucher + trip.failed (INSUFFICIENT_FUNDS).
// Chạy: node --test scripts/trip-payment-voucher.test.js (không cần Docker).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require('../trip-service/node_modules/@electric-sql/pglite');
const vouchers = require('../trip-service/src/vouchers');
const fakePricing = require('./helpers/pricing-stub');
const uuid = () => crypto.randomUUID();

function load(service, file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', service, 'src', file);
  const mod = { exports: {} };
  const localRequire = require('node:module').createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: mod, exports: mod.exports, require: name => (name in mocks ? mocks[name] : localRequire(name)), console, process, Date }, { filename });
  return mod.exports;
}

const NOW = new Date('2026-11-23T05:00:00Z');
const voucher = (overrides = {}) => ({ code: 'GIAM20', description: 'x', discountType: 'PERCENT', value: 20, maxDiscount: 30000, minFare: 0, vehicleType: null, validFrom: '2026-01-01T00:00:00Z', validTo: '2027-12-31T16:59:59Z', active: true, ...overrides });

test('vouchers.discountFor: phần trăm có trần, số tiền cố định có giá tối thiểu, đúng loại xe, làm tròn xuống 1.000 đ', () => {
  assert.deepEqual(vouchers.discountFor(voucher(), 48000, 'MOTORCYCLE', NOW), { applicable: true, discountAmount: 9000, reason: null });
  assert.equal(vouchers.discountFor(voucher(), 500000, 'CAR_4_SEAT', NOW).discountAmount, 30000, 'trần 30.000 đ');
  const fixed = voucher({ code: 'GIAM10K', discountType: 'FIXED', value: 10000, maxDiscount: null, minFare: 30000 });
  assert.equal(vouchers.discountFor(fixed, 48000, 'MOTORCYCLE', NOW).discountAmount, 10000);
  assert.deepEqual(vouchers.discountFor(fixed, 25000, 'MOTORCYCLE', NOW), { applicable: false, discountAmount: 0, reason: 'FARE_TOO_LOW' });
  const bike = voucher({ code: 'XEMAY50', value: 50, maxDiscount: 20000, vehicleType: 'MOTORCYCLE' });
  assert.equal(vouchers.discountFor(bike, 48000, 'MOTORCYCLE', NOW).discountAmount, 20000);
  assert.equal(vouchers.discountFor(bike, 48000, 'CAR_4_SEAT', NOW).reason, 'VEHICLE_NOT_ELIGIBLE');
  assert.equal(vouchers.discountFor(voucher({ validTo: '2026-11-01T00:00:00Z' }), 48000, 'MOTORCYCLE', NOW).reason, 'EXPIRED');
  assert.equal(vouchers.discountFor(voucher({ active: false }), 48000, 'MOTORCYCLE', NOW).reason, 'EXPIRED');
  assert.equal(vouchers.discountFor(null, 48000, 'MOTORCYCLE', NOW).reason, 'UNAVAILABLE');
  const huge = voucher({ discountType: 'FIXED', value: 50000, maxDiscount: null });
  assert.equal(vouchers.discountFor(huge, 20000, 'MOTORCYCLE', NOW).discountAmount, 19000, 'giá cuối tối thiểu 1.000 đ');
  assert.equal(vouchers.discountFor(voucher(), 3000, 'MOTORCYCLE', NOW).reason, 'FARE_TOO_LOW', 'giảm dưới 1.000 đ thì không áp dụng');
});

test('vouchers trên PostgreSQL: mã mẫu, mỗi khách dùng một lần, trả mã thì dùng lại được', async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(fs.readFileSync(path.resolve(__dirname, '../trip-service/trip_db.sql'), 'utf8'));
  const db = { query: (sql, args) => (args === undefined && sql.includes(';') ? pg.exec(sql).then(r => r.at(-1)) : pg.query(sql, args)) };
  await vouchers.initialize(db);
  await vouchers.initialize(db); // khởi động lại không lỗi, không nhân đôi mã mẫu
  const rider = uuid(), other = uuid(), trip = uuid();
  assert.deepEqual((await vouchers.available(db, rider, NOW)).map(v => v.code), ['GIAM10K', 'GIAM20', 'XEMAY50']);
  const columns = (await pg.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'trips' AND column_name IN ('paymentMethod','originalFare','discountAmount','voucherCode') ORDER BY 1`)).rows.map(r => r.column_name);
  assert.deepEqual(columns, ['discountAmount', 'originalFare', 'paymentMethod', 'voucherCode']);
  await vouchers.redeem(db, 'GIAM20', rider, trip);
  assert.deepEqual((await vouchers.available(db, rider, NOW)).map(v => v.code), ['GIAM10K', 'XEMAY50']);
  assert.equal((await vouchers.available(db, other, NOW)).length, 3, 'khách khác vẫn dùng được');
  await assert.rejects(vouchers.redeem(db, 'GIAM20', rider, uuid()), { status: 409 });
  await vouchers.release(db, trip);
  assert.equal((await vouchers.available(db, rider, NOW)).length, 3, 'chuyến không thành thì trả mã');
  await vouchers.redeem(db, 'GIAM20', rider, uuid());
});

async function harness({ available = [voucher(), voucher({ code: 'GIAM10K', discountType: 'FIXED', value: 10000, maxDiscount: null, minFare: 30000 })] } = {}) {
  const express = require('../trip-service/node_modules/express');
  const trips = new Map(), outbox = [], redeemed = [], released = [];
  const client = { query: async (sql, args = []) => {
    if (sql.startsWith('INSERT INTO trips')) {
      const [tripId, passengerId, pickup, destination, estimatedDistance, fare, sagaId, vehicleType, quoteId, estimatedDuration, pricingSnapshot, paymentMethod, originalFare, discountAmount, voucherCode] = args;
      const trip = { tripId, passengerId, pickup, destination, estimatedDistance, fare, sagaId, vehicleType, quoteId, estimatedDuration, pricingSnapshot, paymentMethod, originalFare, discountAmount, voucherCode, status: 'REQUESTED', driverId: null, paymentId: null, version: 0, rejectedDriverIds: [] };
      trips.set(tripId, trip);
      return { rows: [{ ...trip }], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE trips')) {
      const trip = trips.get(args[0]);
      if (trip.version !== args[4]) return { rows: [], rowCount: 0 };
      Object.assign(trip, { status: args[1], paymentId: args[2], driverId: args[3], rejectedDriverIds: args[5], version: trip.version + 1 });
      return { rows: [{ ...trip }], rowCount: 1 };
    }
    if (sql.includes('FROM trips WHERE "tripId"')) return { rows: trips.has(args[0]) ? [{ ...trips.get(args[0]) }] : [] };
    return { rows: [], rowCount: 1 };
  } };
  const events = {
    transaction: async work => work(client),
    once: async (event, work) => work(client),
    enqueue: async (c, eventType, payload, correlationId) => outbox.push({ eventType, payload, correlationId }),
  };
  const fakeVouchers = {
    discountFor: vouchers.discountFor,
    normalize: vouchers.normalize,
    available: async () => available,
    redeem: async (c, code, passengerId, tripId) => redeemed.push({ code, passengerId, tripId }),
    release: async (c, tripId) => released.push(tripId),
  };
  const driver = { request: async () => {}, release: async () => {} };
  const saga = load('trip-service', 'saga.js', { './events': events, './service-client': driver, './logger': () => {}, './vouchers': fakeVouchers });
  const routes = load('trip-service', 'routes.js', { './db': client, './events': events, './saga': saga, './service-client': driver, './pricing': fakePricing(), './vouchers': fakeVouchers });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.correlationId = uuid(); next(); });
  routes(Object.fromEntries(['get', 'post'].map(method => [method, (route, handler) => app[method](route, (req, res, next) => Promise.resolve(handler(req, res)).catch(next))])));
  app.use((error, req, res, next) => res.status(error.status || 503).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const call = async (route, actor, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-User-Id': actor.id, 'X-User-Roles': actor.role, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  const envelope = (eventType, payload) => ({ eventId: uuid(), eventType, correlationId: uuid(), occurredAt: new Date().toISOString(), payload });
  return { trips, outbox, redeemed, released, saga, call, envelope, close: () => new Promise(resolve => server.close(resolve)) };
}

const rider = () => ({ id: uuid(), role: 'ROLE_PASSENGER' });
const pickup = { lat: 10.77, lng: 106.7 };
const destination = { lat: 10.78, lng: 106.71 };

test('HTTP: báo giá kèm voucher trả giá gốc, số tiền giảm và giá cuối cho từng loại xe', async () => {
  const h = await harness();
  try {
    const quote = await h.call('/trips/estimate', rider(), { pickup, destination, voucherCode: 'giam20' });
    assert.equal(quote.status, 200);
    const option = quote.data.options[0];
    assert.equal(option.originalFare, 48000);
    assert.equal(option.discountAmount, 9000);
    assert.equal(option.fareAmount, 39000);
    assert.equal(option.voucherApplicable, true);
    const missing = await h.call('/trips/estimate', rider(), { pickup, destination, voucherCode: 'KHONGCO' });
    assert.equal(missing.data.options[0].voucherReason, 'UNAVAILABLE');
    assert.equal(missing.data.options[0].fareAmount, 48000);
    const list = await h.call('/trips/vouchers', rider());
    assert.deepEqual(list.data.map(v => v.code), ['GIAM20', 'GIAM10K']);
  } finally { await h.close(); }
});

test('HTTP: đặt chuyến lưu phương thức và voucher, giá cuối đã giảm, trip.requested mang đủ thông tin', async () => {
  const h = await harness();
  const passenger = rider();
  try {
    const created = await h.call('/trips', passenger, { pickup, destination, paymentMethod: 'CASH', voucherCode: 'GIAM20' });
    assert.equal(created.status, 201);
    assert.equal(created.data.paymentMethod, 'CASH');
    assert.equal(created.data.originalFare, 48000);
    assert.equal(created.data.discountAmount, 9000);
    assert.equal(created.data.fare, 39000);
    assert.equal(created.data.voucherCode, 'GIAM20');
    assert.deepEqual(h.redeemed, [{ code: 'GIAM20', passengerId: passenger.id, tripId: created.data.tripId }]);
    const requested = h.outbox.find(e => e.eventType === 'trip.requested');
    assert.equal(requested.payload.paymentMethod, 'CASH');
    assert.equal(requested.payload.fareAmount, 39000);
    assert.equal(requested.payload.originalFare, 48000);
    assert.equal(requested.payload.discountAmount, 9000);
    assert.equal(requested.payload.voucherCode, 'GIAM20');
    const plain = await h.call('/trips', rider(), { pickup, destination });
    assert.equal(plain.data.paymentMethod, 'BANK', 'mặc định thanh toán ngân hàng');
    assert.equal(plain.data.discountAmount, 0);
    assert.equal((await h.call('/trips', rider(), { pickup, destination, paymentMethod: 'CARD' })).status, 400);
    assert.equal((await h.call('/trips', rider(), { pickup, destination, voucherCode: 'GIAM10K' })).status, 201, '48.000 đ ≥ 30.000 đ');
    const tooLow = await harness({ available: [voucher({ code: 'GIAM10K', discountType: 'FIXED', value: 10000, minFare: 100000 })] });
    try { assert.equal((await tooLow.call('/trips', rider(), { pickup, destination, voucherCode: 'GIAM10K' })).status, 409); }
    finally { await tooLow.close(); }
  } finally { await h.close(); }
});

test('HTTP: hủy chuyến trả voucher; nhận chuyến phát trip.accepted đúng một lần; hoàn thành mang paymentMethod', async () => {
  const h = await harness();
  const passenger = rider(), driver = { id: uuid(), role: 'ROLE_DRIVER' };
  try {
    const cancelled = (await h.call('/trips', passenger, { pickup, destination, voucherCode: 'GIAM20' })).data;
    assert.equal((await h.call(`/trips/${cancelled.tripId}/cancel`, passenger, {})).status, 200);
    assert.deepEqual(h.released, [cancelled.tripId]);

    const trip = (await h.call('/trips', passenger, { pickup, destination, paymentMethod: 'CASH' })).data;
    Object.assign(h.trips.get(trip.tripId), { status: 'AWAITING_DRIVER', driverId: driver.id });
    assert.equal((await h.call(`/trips/${trip.tripId}/accept`, driver, {})).data.status, 'IN_PROGRESS');
    await h.call(`/trips/${trip.tripId}/start`, driver, {});
    const accepted = h.outbox.filter(e => e.eventType === 'trip.accepted');
    assert.equal(accepted.length, 1);
    assert.deepEqual(Object.keys(accepted[0].payload).sort(), ['acceptedAt', 'driverId', 'riderId', 'tripId']);
    assert.equal(accepted[0].payload.riderId, passenger.id);
    await h.call(`/trips/${trip.tripId}/complete`, driver, {});
    assert.equal(h.outbox.find(e => e.eventType === 'trip.completed').payload.paymentMethod, 'CASH');
  } finally { await h.close(); }
});

test('Saga: payment.authorized cho phép ghép tài xế; thiếu tiền thì chuyến FAILED, trả voucher, báo khách', async () => {
  const h = await harness();
  const passenger = rider();
  try {
    const trip = (await h.call('/trips', passenger, { pickup, destination, voucherCode: 'GIAM20' })).data;
    const authorized = h.envelope('payment.authorized', { tripId: trip.tripId, riderId: passenger.id, amount: 39000, paymentMethod: 'BANK', holdId: uuid(), authorizedAt: new Date().toISOString() });
    await h.saga.authorized(authorized);
    assert.equal(h.trips.get(trip.tripId).status, 'MATCHING');
    const matching = h.outbox.filter(e => e.eventType === 'trip.matching_requested');
    assert.equal(matching.length, 1);
    assert.equal(matching[0].payload.vehicleType, 'MOTORCYCLE');
    assert.equal(matching[0].correlationId, authorized.correlationId);
    await h.saga.authorized(h.envelope('payment.authorized', authorized.payload));
    assert.equal(h.outbox.filter(e => e.eventType === 'trip.matching_requested').length, 1, 'chuyến đã MATCHING thì bỏ qua');

    const poor = (await h.call('/trips', passenger, { pickup, destination, voucherCode: 'GIAM10K' })).data;
    await h.saga.authorizationFailed(h.envelope('payment.authorization_failed', { tripId: poor.tripId, riderId: passenger.id, amount: 38000, reason: 'INSUFFICIENT_FUNDS', failedAt: new Date().toISOString() }));
    assert.equal(h.trips.get(poor.tripId).status, 'FAILED');
    assert.deepEqual(h.released, [poor.tripId]);
    const failed = h.outbox.find(e => e.eventType === 'trip.failed');
    assert.equal(failed.payload.reason, 'INSUFFICIENT_FUNDS');
    assert.equal(failed.payload.riderId, passenger.id);
    assert.equal(h.outbox.filter(e => e.eventType === 'trip.matching_requested').length, 1, 'chuyến thiếu tiền không được ghép');
  } finally { await h.close(); }
});

test('validation: event mới của Saga thanh toán hợp lệ ở cả Trip và Matching', () => {
  for (const service of ['trip-service', 'matching-service']) {
    const { validate, InvalidEvent } = require(`../${service}/src/validation`);
    const base = (eventType, payload) => ({ eventId: uuid(), eventType, correlationId: uuid(), occurredAt: new Date().toISOString(), payload: { tripId: uuid(), riderId: uuid(), ...payload } });
    assert.ok(validate(base('payment.authorized', { amount: 39000, paymentMethod: 'CASH', holdId: null, authorizedAt: '2026-11-23T05:00:00.123456Z' }), 'payment.authorized'));
    assert.throws(() => validate(base('payment.authorized', { amount: 39000, paymentMethod: 'CARD', authorizedAt: '2026-11-23T05:00:00Z' }), 'payment.authorized'), InvalidEvent);
    assert.ok(validate(base('payment.authorization_failed', { amount: 39000, reason: 'INSUFFICIENT_FUNDS', failedAt: '2026-11-23T05:00:00Z' }), 'payment.authorization_failed'));
    assert.ok(validate(base('trip.failed', { reason: 'INSUFFICIENT_FUNDS', failedAt: '2026-11-23T05:00:00Z' }), 'trip.failed'));
    assert.throws(() => validate(base('matching.failed', { reason: 'INSUFFICIENT_FUNDS', failedAt: '2026-11-23T05:00:00Z' }), 'matching.failed'), InvalidEvent);
    assert.ok(validate(base('trip.matching_requested', { pickup: { lat: 10.7, lng: 106.6 }, vehicleType: 'MOTORCYCLE' }), 'trip.matching_requested'));
  }
  assert.match(fs.readFileSync(path.resolve(__dirname, '../matching-service/src/server.js'), 'utf8'), /consume\('trip\.matching_requested', matching\.handle\)/, 'Matching ghép tài xế khi Trip đã được xác nhận thanh toán');
});
