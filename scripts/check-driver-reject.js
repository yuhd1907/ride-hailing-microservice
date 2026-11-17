'use strict';
// Chạy trên stack Compose thật: tài xế từ chối chuyến -> sẵn sàng ngay -> Matching ghép tài xế khác.
// Tạo user/tài xế/chuyến riêng cho mỗi lần chạy. Cần `npm ci` trong trip-service (dùng pg, dotenv).
const path = require('node:path');
require('../trip-service/node_modules/dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('../trip-service/node_modules/pg');
const gateway = `http://127.0.0.1:${process.env.GATEWAY_PORT || 8080}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uuid = () => crypto.randomUUID();
const pool = prefix => new Pool({ host: '127.0.0.1', port: Number(process.env[`${prefix}_DB_PORT`]), user: process.env[`${prefix}_DB_USER`], password: process.env[`${prefix}_DB_PASSWORD`], database: process.env[`${prefix}_DB_NAME`] });
const tripDb = pool('TRIP'), matchingDb = pool('MATCHING');
// Toạ độ ngẫu nhiên để không dính tài xế còn sót trong GEO từ các lần chạy trước.
const pickup = { lat: 12 + crypto.randomInt(0, 1000000) / 1000000, lng: 100 + crypto.randomInt(0, 1000000) / 1000000 };
let passed = 0;
function pass(message) { passed++; console.log(`PASS ${passed}: ${message}`); }
async function call(url, { method = 'GET', body, token, correlationId = uuid() } = {}) {
  const response = await fetch(gateway + url, { method, signal: AbortSignal.timeout(15000), headers: { 'X-Correlation-ID': correlationId, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}
async function ok(url, options) {
  const result = await call(url, options);
  assert.ok(result.status >= 200 && result.status < 300, `${options?.method || 'GET'} ${url}: ${result.status} ${JSON.stringify(result.data)}`);
  return result.data;
}
async function waitFor(label, check, timeout = 45000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await sleep(500);
  }
  throw new Error(`Timeout: ${label}`);
}
async function user(role) {
  const suffix = uuid().replaceAll('-', '').slice(0, 12);
  const account = { email: `reject-${suffix}@rideflow.test`, password: 'Test@123456', fullName: `Reject ${role}`, phone: `09${String(crypto.randomInt(0, 100000000)).padStart(8, '0')}`, role };
  await ok('/auth/register', { method: 'POST', body: account });
  return ok('/auth/login', { method: 'POST', body: { email: account.email, password: account.password } });
}
async function onlineDriver(offsetLat) {
  const driver = await user('ROLE_DRIVER');
  await ok('/drivers', { method: 'POST', token: driver.token, body: { licensePlate: `REJ-${uuid().slice(0, 8)}`, vehicleType: 'MOTORCYCLE' } });
  await ok('/drivers/me/go-online', { method: 'POST', token: driver.token });
  await ok('/drivers/me/location', { method: 'POST', token: driver.token, body: { latitude: pickup.lat + offsetLat, longitude: pickup.lng } });
  return driver;
}
const driverState = async driver => ok(`/drivers/${driver.userId}`);
const tripWith = (tripId, token, status, driverId) => waitFor(`trip ${tripId} => ${status}`, async () => {
  const trip = await ok(`/trips/${tripId}`, { token });
  return trip.status === status && (driverId === undefined || trip.driverId === driverId) && trip;
});
async function main() {
  console.log(`Driver reject run ${new Date().toISOString()}; gateway=${gateway}; pickup=${pickup.lat},${pickup.lng}`);
  const rider = await user('ROLE_PASSENGER');
  // A đứng ngay điểm đón nên luôn gần nhất; B cách khoảng 220 m.
  const driverA = await onlineDriver(0), driverB = await onlineDriver(0.002);
  const correlationId = uuid();
  const trip = await ok('/trips', { method: 'POST', token: rider.token, correlationId, body: { riderId: rider.userId, pickup, destination: { lat: pickup.lat + 0.01, lng: pickup.lng + 0.01 }, estimatedDistance: 3, fareAmount: 125000 } });
  await tripWith(trip.tripId, rider.token, 'AWAITING_DRIVER', driverA.userId);
  let stateA = await driverState(driverA);
  assert.deepEqual([stateA.status, stateA.currentTripId], ['RESERVED', trip.tripId]);
  pass(`Matching giữ tài xế gần nhất A=${driverA.userId} cho tripId=${trip.tripId} (A: RESERVED)`);

  assert.equal((await call(`/trips/${trip.tripId}/reject`, { method: 'POST', token: driverB.token })).status, 403);
  assert.equal((await call(`/trips/${trip.tripId}/reject`, { method: 'POST', token: rider.token })).status, 403);
  assert.equal((await call(`/trips/${trip.tripId}/reject`, { method: 'POST' })).status, 401);
  assert.equal((await driverState(driverA)).status, 'RESERVED');
  pass('Chỉ tài xế đang được ghép mới từ chối được: tài xế khác/khách -> 403, không token -> 401; A vẫn RESERVED');

  const started = Date.now();
  const rejected = await ok(`/trips/${trip.tripId}/reject`, { method: 'POST', token: driverA.token });
  const elapsed = Date.now() - started;
  stateA = await driverState(driverA);
  assert.deepEqual([rejected.status, rejected.driverId], ['MATCHING', null]);
  assert.deepEqual([stateA.status, stateA.currentTripId, stateA.reservationId], ['AVAILABLE', null, null]);
  pass(`A từ chối: request trả về sau ${elapsed} ms, A đã AVAILABLE ngay (không chờ 60s hết hạn giữ chỗ); chuyến về MATCHING`);

  const reassigned = await tripWith(trip.tripId, rider.token, 'AWAITING_DRIVER', driverB.userId);
  const stateB = await driverState(driverB);
  assert.deepEqual([stateB.status, stateB.currentTripId], ['RESERVED', trip.tripId]);
  assert.equal((await driverState(driverA)).status, 'AVAILABLE');
  pass(`Matching tìm được tài xế khác B=${driverB.userId} sau ${Date.now() - started} ms kể từ lúc từ chối (B: RESERVED, A: AVAILABLE)`);

  const nearby = await ok(`/drivers/available?lat=${pickup.lat}&lng=${pickup.lng}&radius=5`);
  assert.ok(nearby.some(driver => driver.id === driverA.userId), 'A phải xuất hiện lại trong tìm kiếm GEO');
  assert.ok(!nearby.some(driver => driver.id === driverB.userId), 'B đang RESERVED nên không được xuất hiện');
  pass('A xuất hiện lại trong tìm kiếm tài xế gần (Redis GEO), sẵn sàng nhận chuyến khác');

  const { rows: history } = await tripDb.query('SELECT previous_status, new_status, reason FROM trip_status_history WHERE "tripId"=$1 ORDER BY "createdAt"', [trip.tripId]);
  assert.deepEqual(history.map(row => `${row.previous_status || '-'}>${row.new_status}`), ['->REQUESTED', 'REQUESTED>AWAITING_DRIVER', 'AWAITING_DRIVER>MATCHING', 'MATCHING>AWAITING_DRIVER']);
  assert.equal(history[2].reason, 'driver rejected');
  const { rows: [matching] } = await matchingDb.query('SELECT * FROM matching_requests WHERE "tripId"=$1', [trip.tripId]);
  assert.deepEqual([matching.status, matching.selectedDriverId], ['ASSIGNED', driverB.userId]);
  assert.deepEqual(matching.attemptedDriverIds, [driverA.userId, driverB.userId]);
  const { rows: events } = await tripDb.query("SELECT envelope FROM event_outbox WHERE envelope->>'eventType'='trip.driver_rejected' AND envelope->'payload'->>'tripId'=$1", [trip.tripId]);
  assert.equal(events.length, 1);
  assert.equal(events[0].envelope.correlationId, correlationId);
  assert.equal(events[0].envelope.payload.driverId, driverA.userId);
  pass(`DB: lịch sử ${history.map(row => row.new_status).join(' -> ')}; attemptedDriverIds=[A,B]; đúng 1 event trip.driver_rejected, correlationId=${correlationId}`);

  assert.equal((await call(`/trips/${trip.tripId}/reject`, { method: 'POST', token: driverA.token })).status, 403);
  assert.equal((await driverState(driverB)).status, 'RESERVED');
  pass('A gọi từ chối lần nữa -> 403, không ảnh hưởng lượt giữ của B');

  await ok(`/trips/${trip.tripId}/start`, { method: 'POST', token: driverB.token });
  assert.equal((await call(`/trips/${trip.tripId}/reject`, { method: 'POST', token: driverB.token })).status, 409);
  await ok(`/trips/${trip.tripId}/complete`, { method: 'POST', token: driverB.token, body: { fareAmount: 125000 } });
  await tripWith(trip.tripId, rider.token, 'CONFIRMED', driverB.userId);
  await waitFor('B available after payment', async () => (await driverState(driverB)).status === 'AVAILABLE');
  pass('Chuyến chạy tiếp bình thường với B: start -> (từ chối lúc này bị 409) -> complete -> thanh toán -> CONFIRMED; B AVAILABLE');
  assert.equal(reassigned.tripId, trip.tripId);

  for (const driver of [driverA, driverB]) await ok('/drivers/me/go-offline', { method: 'POST', token: driver.token });
  console.log(`RESULT: ${passed} driver-reject checks passed on the real stack.`);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => Promise.allSettled([tripDb.end(), matchingDb.end()]));
