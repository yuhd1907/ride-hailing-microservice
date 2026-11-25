'use strict';
// Tính năng tài xế trong Trip Service (features.js) trên PostgreSQL thật (PGlite, WASM):
// bước Đã đến / Đã đón, tài xế hủy khi khách không xuất hiện, đánh giá sao, chỉ số tài xế,
// bản đồ nhu cầu và phiếu hỗ trợ.
// Chạy: node --test scripts/trip-driver-features.test.js (không cần Docker).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createPricing } = require('../trip-service/src/pricing');
const { PGlite } = require('../trip-service/node_modules/@electric-sql/pglite');
const express = require('../trip-service/node_modules/express');

const uuid = () => crypto.randomUUID();
const PTIT = { lat: 20.980913, lng: 105.787417 };
const MYDINH = { lat: 21.0205, lng: 105.764 };

function load(file, mocks) {
  const filename = path.resolve(__dirname, '../trip-service/src', file);
  const mod = { exports: {} };
  const localRequire = require('node:module').createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: mod, exports: mod.exports, require: name => (name in mocks ? mocks[name] : localRequire(name)), console, process, Date, URL }, { filename });
  return mod.exports;
}

async function harness({ available = [], driverDown = false, location = null } = {}) {
  const pg = new PGlite();
  await pg.exec(fs.readFileSync(path.resolve(__dirname, '../trip-service/trip_db.sql'), 'utf8'));
  const db = { query: async (sql, args) => (args === undefined && sql.includes(';') ? (await pg.exec(sql)).at(-1) : pg.query(sql, args)) };
  const providers = { route: async () => ({ distanceKm: 5, durationMinutes: 10, source: 'google_routes_traffic' }), weather: async () => ({ raining: false, status: 'disabled' }) };
  const pricing = createPricing({ db, cache: { isReady: false }, driver: {}, providers });
  await pricing.initialize(); // tạo cả bảng của features-schema.sql
  await require('../trip-service/src/vouchers').initialize(db); // bảng voucher (tài xế hủy thì trả voucher)
  const outbox = [], driverCalls = [];
  const events = {
    transaction: work => pg.transaction(tx => work({ query: (sql, args) => tx.query(sql, args) })),
    enqueue: async (client, eventType, payload, correlationId) => outbox.push({ eventType, payload, correlationId }),
  };
  const driver = {
    request: async (app, route, correlationId, body, method) => {
      driverCalls.push([route, method]);
      if (driverDown) throw Object.assign(new Error('down'), { status: 503 });
      if (route.endsWith('/location')) {
        if (!location) throw Object.assign(new Error('no location'), { status: 404 });
        return location;
      }
      return available;
    },
    release: async (driverId, correlationId, tripId) => driverCalls.push(['release', driverId, tripId]),
  };
  const saga = load('saga.js', { './events': events, './service-client': driver, './logger': () => {} });
  const features = load('features.js', { './db': db, './events': events, './saga': saga, './service-client': driver, './pricing': { policy: () => pricing.getPolicy() } });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.correlationId = uuid(); next(); });
  features(app);
  app.use((error, req, res, next) => res.status(error.status || 503).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const call = async (route, actor, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-User-Id': actor.id, 'X-User-Roles': actor.role, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  // Tạo chuyến trực tiếp trong DB; accepted = có mốc AWAITING_DRIVER → IN_PROGRESS như khi tài xế bấm nhận.
  const trip = async ({ passengerId = uuid(), driverId = null, status = 'IN_PROGRESS', pickup = PTIT, vehicleType = 'MOTORCYCLE', rejected = [], accepted = status !== 'REQUESTED' && status !== 'MATCHING', paymentMethod = 'CASH' } = {}) => {
    const tripId = uuid();
    await pg.query(`INSERT INTO trips ("tripId", "passengerId", "driverId", pickup, destination, "estimatedDistance", fare, status, "vehicleType", "paymentMethod", "rejectedDriverIds")
      VALUES ($1,$2,$3,$4,$5,7.5,117000,$6,$7,$8,$9)`, [tripId, passengerId, driverId, pickup, MYDINH, status, vehicleType, paymentMethod, rejected]);
    if (accepted && driverId) await pg.query(`INSERT INTO trip_status_history ("tripId", previous_status, new_status, reason) VALUES ($1,'AWAITING_DRIVER','IN_PROGRESS','driver accepted; trip started')`, [tripId]);
    return tripId;
  };
  const row = async tripId => (await pg.query('SELECT * FROM trips WHERE "tripId"=$1', [tripId])).rows[0];
  const close = async () => { await new Promise(resolve => server.close(resolve)); await pg.close(); };
  return { pg, call, trip, row, outbox, driverCalls, close };
}

const driverActor = () => ({ id: uuid(), role: 'ROLE_DRIVER' });
const passengerActor = () => ({ id: uuid(), role: 'ROLE_PASSENGER' });

test('các bước trong chuyến: Đã đến điểm đón → Đã đón khách, ghi lịch sử, chỉ tài xế được giao', async () => {
  const h = await harness();
  try {
    const me = driverActor();
    const id = await h.trip({ driverId: me.id });
    assert.equal((await h.call(`/trips/${id}/arrived`, driverActor(), {})).status, 403);
    const arrived = await h.call(`/trips/${id}/arrived`, me, {});
    assert.equal(arrived.status, 200);
    assert.equal(arrived.data.tripPhase, 'ARRIVED');
    assert.ok(arrived.data.arrivedAt);
    assert.equal((await h.call(`/trips/${id}/arrived`, me, {})).data.version, arrived.data.version, 'bấm lại không đổi gì');
    const onboard = await h.call(`/trips/${id}/pickup`, me, {});
    assert.equal(onboard.data.tripPhase, 'ON_BOARD');
    assert.equal(onboard.data.status, 'IN_PROGRESS');
    assert.ok(onboard.data.pickedUpAt);
    const reasons = (await h.pg.query('SELECT reason FROM trip_status_history WHERE "tripId"=$1 ORDER BY "createdAt", id', [id])).rows.map(r => r.reason);
    assert.ok(reasons.includes('driver arrived at pickup') && reasons.includes('passenger picked up'));
    const waiting = await h.trip({ driverId: me.id, status: 'AWAITING_DRIVER', accepted: false });
    assert.equal((await h.call(`/trips/${waiting}/arrived`, me, {})).status, 409, 'phải nhận cuốc trước');
  } finally { await h.close(); }
});

test('tài xế hủy: khách không xuất hiện chỉ sau khi đã đến và chờ đủ 2 phút; nhả tài xế và phát trip.cancelled', async () => {
  const h = await harness();
  try {
    const me = driverActor();
    const id = await h.trip({ driverId: me.id });
    assert.equal((await h.call(`/trips/${id}/driver-cancel`, me, { reason: 'BAD' })).status, 400);
    assert.equal((await h.call(`/trips/${id}/driver-cancel`, me, { reason: 'PASSENGER_NO_SHOW' })).data.error, 'Mark arrival at pickup first');
    await h.call(`/trips/${id}/arrived`, me, {});
    assert.equal((await h.call(`/trips/${id}/driver-cancel`, me, { reason: 'PASSENGER_NO_SHOW' })).data.error, 'Wait at pickup before reporting no-show');
    await h.pg.query(`UPDATE trips SET "arrivedAt" = CURRENT_TIMESTAMP - INTERVAL '3 minutes' WHERE "tripId"=$1`, [id]);
    const cancelled = await h.call(`/trips/${id}/driver-cancel`, me, { reason: 'PASSENGER_NO_SHOW' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.status, 'CANCELLED');
    assert.equal(cancelled.data.cancelledBy, 'DRIVER');
    assert.equal(cancelled.data.cancelReason, 'PASSENGER_NO_SHOW');
    assert.deepEqual(h.driverCalls.at(-1), ['release', me.id, id]);
    assert.equal(h.outbox.at(-1).eventType, 'trip.cancelled');
    assert.equal(h.outbox.at(-1).payload.driverId, me.id);
    assert.equal((await h.call(`/trips/${id}/driver-cancel`, me, { reason: 'PASSENGER_NO_SHOW' })).status, 200, 'gọi lại idempotent');
    // Khách đã lên xe thì không hủy được nữa.
    const onboard = await h.trip({ driverId: me.id });
    await h.call(`/trips/${onboard}/pickup`, me, {});
    assert.equal((await h.call(`/trips/${onboard}/driver-cancel`, me, { reason: 'VEHICLE_PROBLEM' })).status, 409);
  } finally { await h.close(); }
});

test('đánh giá: chỉ khách của chuyến, sau khi chuyến kết thúc, mỗi chuyến một lần', async () => {
  const h = await harness();
  try {
    const rider = passengerActor(), me = driverActor();
    const running = await h.trip({ passengerId: rider.id, driverId: me.id });
    assert.equal((await h.call(`/trips/${running}/rating`, rider, { stars: 5 })).status, 409, 'chưa xong chuyến');
    const done = await h.trip({ passengerId: rider.id, driverId: me.id, status: 'CONFIRMED' });
    assert.equal((await h.call(`/trips/${done}/rating`, me, { stars: 5 })).status, 403, 'tài xế không tự chấm');
    assert.equal((await h.call(`/trips/${done}/rating`, passengerActor(), { stars: 5 })).status, 403);
    assert.equal((await h.call(`/trips/${done}/rating`, rider, { stars: 6 })).status, 400);
    assert.equal((await h.call(`/trips/${done}/rating`, rider, { stars: 4, tags: ['HACK'] })).status, 400);
    const rated = await h.call(`/trips/${done}/rating`, rider, { stars: 4, tags: ['FRIENDLY', 'ON_TIME'], comment: '  Tài xế\nthân thiện  ' });
    assert.equal(rated.status, 201);
    assert.equal(rated.data.comment, 'Tài xế thân thiện');
    assert.equal((await h.call(`/trips/${done}/rating`, rider, { stars: 1 })).data.error, 'Trip already rated');
    assert.equal((await h.call(`/trips/${done}/rating`, me)).data.stars, 4, 'tài xế của chuyến xem được');
    const other = await h.trip({ passengerId: uuid(), driverId: me.id, status: 'COMPLETED' });
    await h.pg.query(`INSERT INTO trip_ratings ("tripId", "passengerId", "driverId", stars) VALUES ($1,$2,$3,5)`, [other, uuid(), me.id]);
    assert.deepEqual((await h.call(`/trips/drivers/${me.id}/rating`, rider)).data, { driverId: me.id, average: 4.5, count: 2 });
  } finally { await h.close(); }
});

test('chỉ số tài xế: tỷ lệ nhận cuốc, tỷ lệ hủy, phân bố sao', async () => {
  const h = await harness();
  try {
    const me = driverActor();
    for (let i = 0; i < 3; i++) await h.trip({ driverId: me.id, status: 'CONFIRMED' });
    const cancelledByMe = await h.trip({ driverId: me.id });
    await h.call(`/trips/${cancelledByMe}/driver-cancel`, me, { reason: 'VEHICLE_PROBLEM' });
    await h.trip({ status: 'MATCHING', rejected: [me.id] }); // từ chối hoặc không phản hồi
    await h.trip({ driverId: me.id, status: 'CANCELLED', accepted: false }); // khách hủy khi đang chờ tài xế: không tính
    const stats = await h.call('/trips/drivers/me/stats', me);
    assert.equal(stats.status, 200);
    assert.equal(stats.data.accepted, 4);
    assert.equal(stats.data.declined, 1);
    assert.equal(stats.data.driverCancelled, 1);
    assert.equal(stats.data.completed, 3);
    assert.equal(stats.data.acceptanceRate, 0.8);
    assert.equal(stats.data.cancellationRate, 0.25);
    assert.deepEqual(stats.data.rating.distribution, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    assert.equal((await h.call('/trips/drivers/me/stats', passengerActor())).status, 403);
  } finally { await h.close(); }
});

test('bản đồ nhu cầu: hệ số theo đúng công thức giá động quanh từng ô', async () => {
  const me = driverActor();
  // 1 tài xế xe máy rảnh ngay tại PTIT, 1 tài xế ô tô (không tính cho xe máy).
  const h = await harness({ available: [
    { id: uuid(), vehicleType: 'MOTORCYCLE', latitude: PTIT.lat, longitude: PTIT.lng },
    { id: uuid(), vehicleType: 'CAR_4_SEAT', latitude: PTIT.lat, longitude: PTIT.lng },
  ] });
  try {
    await h.trip({ status: 'MATCHING' });
    await h.trip({ status: 'REQUESTED' });
    await h.trip({ status: 'MATCHING', pickup: { lat: 21.2, lng: 105.9 } }); // ngoài vùng
    assert.equal((await h.call(`/trips/demand-map?lat=${PTIT.lat}&lng=${PTIT.lng}`, passengerActor())).status, 403);
    assert.equal((await h.call(`/trips/demand-map?lat=abc&lng=1`, me)).status, 400);
    const map = await h.call(`/trips/demand-map?lat=${PTIT.lat}&lng=${PTIT.lng}&vehicleType=MOTORCYCLE`, me);
    assert.equal(map.status, 200);
    assert.equal(map.data.cells.length, 49);
    const here = map.data.cells.reduce((best, c) => (Math.hypot(c.center.lat - PTIT.lat, c.center.lng - PTIT.lng) < Math.hypot(best.center.lat - PTIT.lat, best.center.lng - PTIT.lng) ? c : best));
    // 2 yêu cầu / 1 tài xế = tỉ lệ 2 → ×1,5 (pricing_rules mặc định).
    assert.deepEqual([here.demand, here.availableDrivers, here.multiplier, here.recentRequests], [2, 1, 1.5, 2]);
    assert.ok(here.bounds.north > here.bounds.south && here.bounds.east > here.bounds.west);
    const car = await h.call(`/trips/demand-map?lat=${PTIT.lat}&lng=${PTIT.lng}&vehicleType=CAR_4_SEAT`, me);
    assert.ok(car.data.cells.every(c => c.demand === 0 && c.multiplier === 1), 'yêu cầu xe máy không làm tăng giá ô tô');
  } finally { await h.close(); }
  const down = await harness({ driverDown: true });
  try {
    await down.trip({ status: 'MATCHING' });
    const map = await down.call(`/trips/demand-map?lat=${PTIT.lat}&lng=${PTIT.lng}`, me);
    assert.equal(map.status, 200);
    assert.equal(map.data.supplyKnown, false, 'Driver Service lỗi vẫn trả nhu cầu');
  } finally { await down.close(); }
});

test('trung tâm trợ giúp: gửi phiếu kèm chuyến của mình, xem phiếu của mình', async () => {
  const h = await harness();
  try {
    const me = driverActor(), rider = passengerActor();
    const mine = await h.trip({ passengerId: rider.id, driverId: me.id, status: 'CONFIRMED' });
    const notMine = await h.trip({ driverId: uuid(), status: 'CONFIRMED' });
    const body = { category: 'PASSENGER_NO_SHOW', subject: 'Khách bom', description: 'Đợi 10 phút khách không ra, không liên lạc được.', tripId: mine };
    assert.equal((await h.call('/trips/support/tickets', me, { ...body, category: 'X' })).status, 400);
    assert.equal((await h.call('/trips/support/tickets', me, { ...body, description: 'ngắn' })).status, 400);
    assert.equal((await h.call('/trips/support/tickets', me, { ...body, tripId: notMine })).status, 403);
    const created = await h.call('/trips/support/tickets', me, body);
    assert.equal(created.status, 201);
    assert.equal(created.data.role, 'DRIVER');
    assert.equal(created.data.status, 'OPEN');
    await h.call('/trips/support/tickets', rider, { category: 'LOST_ITEM', subject: 'Quên ví', description: 'Tôi để quên ví trên xe máy.' });
    const list = await h.call('/trips/support/tickets', me);
    assert.deepEqual(list.data.map(t => t.subject), ['Khách bom']);
  } finally { await h.close(); }
});

test('vị trí tài xế: chỉ khách của chuyến (hoặc tài xế) xem được, khi đang chờ / đang chạy; kèm quãng còn lại và ETA', async () => {
  const at = { lat: 20.99, lng: 105.79 };
  const h = await harness({ location: { driverId: 'x', latitude: at.lat, longitude: at.lng, updatedAt: '2026-11-24T08:00:00', stale: false } });
  try {
    const rider = passengerActor(), me = driverActor();
    const id = await h.trip({ passengerId: rider.id, driverId: me.id, status: 'AWAITING_DRIVER', accepted: false });
    assert.equal((await h.call(`/trips/${id}/driver-location`, passengerActor())).status, 403, 'khách khác không xem được');
    const toPickup = await h.call(`/trips/${id}/driver-location`, rider);
    assert.equal(toPickup.status, 200);
    assert.deepEqual(toPickup.data.position, at);
    assert.equal(toPickup.data.target, 'PICKUP');
    assert.ok(toPickup.data.remainingKm > 0.9 && toPickup.data.remainingKm < 1.2, `còn ${toPickup.data.remainingKm} km tới điểm đón`);
    assert.ok(toPickup.data.etaMinutes >= 1);
    assert.equal(h.driverCalls.at(-1)[0], `/internal/drivers/${me.id}/location`);
    await h.pg.query(`UPDATE trips SET status='IN_PROGRESS', "tripPhase"='ON_BOARD' WHERE "tripId"=$1`, [id]);
    assert.equal((await h.call(`/trips/${id}/driver-location`, me)).data.target, 'DESTINATION', 'khách đã lên xe: tính tới điểm đến');
    const done = await h.trip({ passengerId: rider.id, driverId: me.id, status: 'CONFIRMED' });
    assert.equal((await h.call(`/trips/${done}/driver-location`, rider)).status, 409, 'chuyến đã xong không còn theo dõi');
  } finally { await h.close(); }
  const none = await harness();
  try {
    const rider = passengerActor();
    const id = await none.trip({ passengerId: rider.id, driverId: uuid(), status: 'IN_PROGRESS' });
    assert.equal((await none.call(`/trips/${id}/driver-location`, rider)).status, 404, 'tài xế chưa gửi GPS');
  } finally { await none.close(); }
});
