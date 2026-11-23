'use strict';
// Real Gateway/Trip/Matching/Driver/Payment/Notification + PostgreSQL/Redis/RabbitMQ.
// Creates isolated accounts and fixture trips. Never changes shared pricing rules.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
require('../trip-service/node_modules/dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Pool } = require('../trip-service/node_modules/pg');
const { createClient } = require('../trip-service/node_modules/redis');
const amqp = require('../trip-service/node_modules/amqplib');
const { cellFor } = require('../trip-service/src/pricing-policy');
const uuid = () => crypto.randomUUID();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const gateway = `http://127.0.0.1:${process.env.GATEWAY_PORT || 8080}`;
const db = new Pool({ host: '127.0.0.1', port: Number(process.env.TRIP_DB_PORT || 5435), user: process.env.TRIP_DB_USER,
  password: process.env.TRIP_DB_PASSWORD, database: process.env.TRIP_DB_NAME, connectionTimeoutMillis: 5000, query_timeout: 10000 });
const cache = createClient({ url: `redis://127.0.0.1:${process.env.REDIS_PORT || 6379}`, socket: { connectTimeout: 3000, reconnectStrategy: false } });
cache.on('error', () => {});
const evidenceDir = path.resolve(__dirname, '../docs/evidence/dynamic-pricing');
const evidenceName = process.argv.includes('--quote-lock-only') ? 'quote-lock' : 'integration';
fs.mkdirSync(evidenceDir, { recursive: true });
const evidence = { startedAt: new Date().toISOString(), runtime: 'Docker Compose; real HTTP, PostgreSQL, Redis, RabbitMQ and Java services', checks: [] };
const log = message => { console.log(message); fs.appendFileSync(path.join(evidenceDir, `${evidenceName}.txt`), message + '\n'); };
fs.writeFileSync(path.join(evidenceDir, `${evidenceName}.txt`), '');
function pass(name, details) { evidence.checks.push({ name, status: 'PASS', details }); log(`PASS ${evidence.checks.length}: ${name}${details ? `; ${details}` : ''}`); }
const drivers = [], fixtures = [], observed = [], activeCells = new Set();
let broker, channel;

async function call(route, { actor, method = 'GET', body, correlationId = uuid() } = {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(gateway + route, { method, signal: AbortSignal.timeout(12000),
      headers: { 'X-Correlation-ID': correlationId, ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (response.status === 429 && attempt < 4) { await sleep(1100); continue; }
    return { status: response.status, data };
  }
}
async function ok(route, options) {
  const result = await call(route, options);
  assert.ok(result.status >= 200 && result.status < 300, `${options?.method || 'GET'} ${route}: ${result.status} ${JSON.stringify(result.data)}`);
  return result.data;
}
async function waitFor(label, check, timeout = 90000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const result = await check(); if (result) return result; } catch (error) { lastError = error; }
    await sleep(1200);
  }
  throw new Error(`Timeout: ${label}${lastError ? ` (${lastError.message})` : ''}`);
}
async function account(role) {
  const credentials = { email: `pricing-${uuid()}@rideflow.test`, password: 'Test@123456', fullName: 'Pricing integration',
    phone: `09${String(crypto.randomInt(0, 100000000)).padStart(8, '0')}`, role };
  await ok('/auth/register', { method: 'POST', body: credentials });
  return ok('/auth/login', { method: 'POST', body: { email: credentials.email, password: credentials.password } });
}
async function move(driver, point) {
  await ok('/drivers/me/location', { method: 'POST', actor: driver, body: { latitude: point.lat, longitude: point.lng } });
}
async function online(vehicleType, point) {
  const driver = await account('ROLE_DRIVER');
  drivers.push(driver);
  await ok('/drivers', { method: 'POST', actor: driver, body: { licensePlate: `DP-${uuid().slice(0, 8)}`, vehicleType } });
  await ok('/drivers/me/go-online', { method: 'POST', actor: driver });
  await move(driver, point);
  return driver;
}
const tripStatus = (trip, rider, expected, driver) => waitFor(`${trip.tripId} -> ${expected}`, async () => {
  const current = await ok(`/trips/${trip.tripId}`, { actor: rider });
  return current.status === expected && (!driver || current.driverId === driver.userId) && current;
});
async function finish(trip, rider, driver) {
  await ok(`/trips/${trip.tripId}/accept`, { method: 'POST', actor: driver });
  await ok(`/trips/${trip.tripId}/complete`, { method: 'POST', actor: driver, body: { fareAmount: 1 } });
  await ok(`/trips/${trip.tripId}/complete`, { method: 'POST', actor: driver, body: { fareAmount: 999999999 } });
  await tripStatus(trip, rider, 'CONFIRMED');
  const payment = await ok(`/payments/trips/${trip.tripId}`, { actor: rider });
  assert.equal(payment.status, 'SUCCESS');
  assert.equal(Number(payment.amount), Number(trip.fare));
  await waitFor('driver released after payment', async () => (await ok(`/drivers/${driver.userId}`, { actor: rider })).status === 'AVAILABLE');
  const { rows } = await db.query("SELECT envelope FROM event_outbox WHERE envelope->>'eventType'='trip.completed' AND envelope->'payload'->>'tripId'=$1", [trip.tripId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].envelope.payload.fareAmount, Number(trip.fare));
  await waitFor('payment notification', async () => (await ok('/notifications/me', { actor: rider })).some(n => n.tripId === trip.tripId && n.type === 'PAYMENT_SUCCEEDED'));
  return payment;
}

async function quoteLockExpiry(rider, body) {
  const quote = await ok('/trips/estimate', { method: 'POST', actor: rider, body });
  const locker = await db.connect();
  let booking;
  try {
    await locker.query('BEGIN');
    await locker.query("UPDATE fare_quotes SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE quote_id=$1", [quote.quoteId]);
    await locker.query('COMMIT');
    await locker.query('BEGIN');
    await locker.query('SELECT quote_id FROM fare_quotes WHERE quote_id=$1 FOR UPDATE', [quote.quoteId]);
    booking = call('/trips', { method: 'POST', actor: rider, body: { quoteId: quote.quoteId } });
    await waitFor('booking waiting on the PostgreSQL quote lock', async () => (await db.query(
      "SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT%fare_quotes%FOR UPDATE'"
    )).rows[0].n > 0, 5000);
    await sleep(2300);
    await locker.query('COMMIT');
    const result = await booking;
    if (result.status === 201) await call(`/trips/${result.data.tripId}/cancel`, { method: 'POST', actor: rider });
    assert.equal(result.status, 409, 'A quote that expires while waiting for a row lock must not create a trip');
    assert.equal((await db.query('SELECT trip_id FROM fare_quotes WHERE quote_id=$1', [quote.quoteId])).rows[0].trip_id, null);
    pass('Quote expiry is checked after PostgreSQL row-lock acquisition');
  } finally {
    await locker.query('ROLLBACK');
    locker.release();
    if (booking) await booking;
  }
}

async function main() {
  log(`Dynamic pricing integration: ${evidence.startedAt}; ${evidence.runtime}`);
  await cache.connect();
  broker = await amqp.connect({ hostname: '127.0.0.1', port: Number(process.env.RABBITMQ_PORT || 5672), username: process.env.RABBITMQ_DEFAULT_USER, password: process.env.RABBITMQ_DEFAULT_PASS });
  broker.on('error', () => {});
  channel = await broker.createConfirmChannel();
  channel.on('error', () => {});
  const queue = await channel.assertQueue('', { exclusive: true });
  await channel.bindQueue(queue.queue, 'rideflow.events', '#');
  await channel.consume(queue.queue, message => { if (message) observed.push(JSON.parse(message.content)); }, { noAck: true });
  await waitFor('Gateway ready', async () => (await call('/users/ping')).status === 200);
  const rider = await account('ROLE_PASSENGER'), other = await account('ROLE_PASSENGER');
  let readyStreak = 0;
  await waitFor('Trip ready through Gateway', async () => {
    readyStreak = (await call('/trips/ping', { actor: rider })).status === 200 ? readyStreak + 1 : 0;
    return readyStreak >= 5;
  });
  const pickup = { lat: 16.058 + crypto.randomInt(0, 500) / 1000000, lng: 108.221 + crypto.randomInt(0, 500) / 1000000 };
  const destination = { lat: pickup.lat + 0.01, lng: pickup.lng + 0.01 };
  const body = { pickup, destination, vehicleType: 'MOTORCYCLE' };
  if (process.argv.includes('--quote-lock-only')) {
    await quoteLockExpiry(rider, body);
    evidence.status = 'PASS';
    return;
  }
  const motorcycle = await online('MOTORCYCLE', pickup);
  const carA = await online('CAR_4_SEAT', { lat: pickup.lat + 0.001, lng: pickup.lng });
  const carB = await online('CAR_4_SEAT', { lat: pickup.lat + 0.002, lng: pickup.lng });
  const car7 = await online('CAR_7_SEAT', { lat: pickup.lat + 0.003, lng: pickup.lng });
  const quote = await ok('/trips/estimate', { method: 'POST', actor: rider, body: { ...body, fareAmount: 1, estimatedDistance: 999999, surgeMultiplier: 100 } });
  assert.equal(quote.pricingVersion, 'dynamic-v1');
  assert.ok(quote.fareAmount > 1);
  assert.equal(Date.parse(quote.expiresAt) - Date.parse(quote.createdAt), 120000);
  assert.ok(quote.estimatedDistance < 10);
  pass('Server quote uses DB rates, ignores forged client fare/distance/surge and has 120-second validity', `fare=${quote.fareAmount}; source=${quote.distanceSource}; weather=${quote.weather.status}`);
  for (const [payload, actor, expected] of [
    [{ quoteId: quote.quoteId }, other, 404], [{ quoteId: 'invalid' }, rider, 400], [{ quoteId: null }, rider, 400],
    [{ quoteId: quote.quoteId, destination: pickup }, rider, 409], [{ quoteId: quote.quoteId, vehicleType: 'CAR_7_SEAT' }, rider, 409],
  ]) assert.equal((await call('/trips', { method: 'POST', actor, body: payload })).status, expected);
  const expired = await ok('/trips/estimate', { method: 'POST', actor: rider, body });
  await db.query("UPDATE fare_quotes SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE quote_id=$1 AND passenger_id=$2", [expired.quoteId, rider.userId]);
  assert.equal((await call('/trips', { method: 'POST', actor: rider, body: { quoteId: expired.quoteId } })).status, 409);
  pass('Quote ownership, UUID, changed route/vehicle and expiration are enforced by real PostgreSQL');
  await quoteLockExpiry(rider, body);
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => call('/trips', { method: 'POST', actor: rider, body: { quoteId: quote.quoteId, fareAmount: 1 } })));
  concurrent.forEach(result => assert.equal(result.status, 201, JSON.stringify(result.data)));
  const trip = concurrent[0].data;
  assert.equal(new Set(concurrent.map(result => result.data.tripId)).size, 1);
  assert.equal(Number(trip.fare), quote.fareAmount);
  const { rows: [requested] } = await db.query("SELECT COUNT(*)::int AS n FROM event_outbox WHERE envelope->>'eventType'='trip.requested' AND envelope->'payload'->>'tripId'=$1", [trip.tripId]);
  assert.equal(requested.n, 1);
  await db.query("UPDATE fare_quotes SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE quote_id=$1", [quote.quoteId]);
  assert.equal((await ok('/trips', { method: 'POST', actor: rider, body: { quoteId: quote.quoteId } })).tripId, trip.tripId);
  await tripStatus(trip, rider, 'AWAITING_DRIVER', motorcycle);
  pass('Eight concurrent bookings commit one trip and one outbox event; retry after expiry returns the same trip', `tripId=${trip.tripId}`);
  const payment = await finish(trip, rider, motorcycle);
  const paid = await waitFor('RabbitMQ payment event', async () => observed.find(event => event.eventType === 'payment.succeeded' && event.payload.tripId === trip.tripId));
  assert.equal(paid.payload.amount, quote.fareAmount);
  // Actual broker redelivery, with both identical and new event identities.
  for (const event of [paid, { ...paid, eventId: uuid() }]) await new Promise((resolve, reject) => channel.publish('rideflow.events', event.eventType,
    Buffer.from(JSON.stringify(event)), { persistent: true, contentType: 'application/json', messageId: event.eventId, type: event.eventType, correlationId: event.correlationId }, error => error ? reject(error) : resolve()));
  await sleep(1500);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM trip_status_history WHERE "tripId"=$1 AND new_status=$2', [trip.tripId, 'CONFIRMED'])).rows[0].n, 1);
  pass('Locked price survives completion, payment, notification and broker redelivery', `paymentId=${payment.paymentId}; amount=${payment.amount}`);
  for (const [type, firstDriver, nextDriver] of [['CAR_4_SEAT', carA, carB], ['CAR_7_SEAT', car7, null]]) {
    const carQuote = await ok('/trips/estimate', { method: 'POST', actor: rider, body: { ...body, vehicleType: type } });
    const carTrip = await ok('/trips', { method: 'POST', actor: rider, body: { quoteId: carQuote.quoteId } });
    await tripStatus(carTrip, rider, 'AWAITING_DRIVER', firstDriver);
    let assigned = firstDriver;
    if (nextDriver) {
      await ok(`/trips/${carTrip.tripId}/reject`, { method: 'POST', actor: firstDriver });
      await tripStatus(carTrip, rider, 'AWAITING_DRIVER', nextDriver);
      assigned = nextDriver;
    }
    await finish(carTrip, rider, assigned);
    pass(`${type} price and matching preserve the vehicle type${nextDriver ? ' after driver rejection' : ''}`, `fare=${carQuote.fareAmount}; tripId=${carTrip.tripId}`);
  }
  const { rows: [rule] } = await db.query("SELECT config FROM pricing_rules WHERE id='default'");
  const config = rule.config;
  const surgePoint = { lat: 16.15 + crypto.randomInt(0, 1000) / 1000000, lng: 108.1 + crypto.randomInt(0, 1000) / 1000000 };
  const cell = cellFor(surgePoint, config.cellSizeKm);
  await move(motorcycle, cell.center);
  const secondMotorcycle = await online('MOTORCYCLE', cell.center);
  await move(carA, cell.center); // A third GEO member must not count as a motorcycle.
  const surgeBody = { pickup: cell.center, destination: { lat: cell.center.lat + 0.01, lng: cell.center.lng + 0.01 }, vehicleType: 'MOTORCYCLE' };
  async function fixture(type, status, point = cell.center) {
    const tripId = uuid(); fixtures.push(tripId);
    await db.query('INSERT INTO trips ("tripId","passengerId",pickup,destination,"estimatedDistance",fare,"vehicleType",status) VALUES ($1,$2,$3,$4,1,12000,$5,$6)',
      [tripId, rider.userId, point, surgeBody.destination, type, status]);
  }
  for (let i = 0; i < 6; i++) await fixture('MOTORCYCLE', i % 2 ? 'MATCHING' : 'REQUESTED');
  await fixture('MOTORCYCLE', 'AWAITING_DRIVER');
  await fixture('MOTORCYCLE', 'COMPLETED');
  await fixture('CAR_4_SEAT', 'REQUESTED');
  await fixture('MOTORCYCLE', 'REQUESTED', { lat: cell.center.lat + 1, lng: cell.center.lng });
  const initial = await ok('/trips/estimate', { method: 'POST', actor: rider, body: surgeBody });
  activeCells.add(JSON.stringify({ ...cell, vehicleType: 'MOTORCYCLE' }));
  const key = `pricing:surge:${initial.pricingRevision}:MOTORCYCLE:${initial.surge.cellId}`;
  log(`Waiting for the production surge worker (${config.surgeRefreshSeconds}s cycle).`);
  const snapshot = await waitFor('real worker counts demand=6 / motorcycle supply=2', async () => {
    const value = await cache.get(key), current = value && JSON.parse(value);
    return current?.demand === 6 && current.availableDrivers === 2 && current;
  }, config.surgeRefreshSeconds * 3000);
  const expectedSurge = Math.min(config.maxSurgeMultiplier, Math.max(...config.surgeTiers.filter(tier => tier.ratio <= 3).map(tier => tier.multiplier)));
  assert.equal(snapshot.multiplier, expectedSurge);
  const surged = await ok('/trips/estimate', { method: 'POST', actor: rider, body: surgeBody });
  assert.equal(surged.surge.status, 'available');
  assert.equal(surged.breakdown.multipliers.surge, expectedSurge);
  assert.ok(surged.breakdown.reasons.some(reason => reason.code === 'HIGH_DEMAND'));
  assert.ok(await cache.ttl(key) > 0);
  pass('Production background worker uses Redis GEO and real demand; excludes other vehicle/status/distant trips', `demand=6; supply=2; multiplier=${snapshot.multiplier}; Redis TTL=${await cache.ttl(key)}s`);
  const baseline = Number((surged.breakdown.subtotal * surged.breakdown.multipliers.time * surged.breakdown.multipliers.calendar * surged.breakdown.multipliers.weather).toFixed(6));
  const expectedFare = Math.ceil((Math.max(surged.breakdown.minimumFare, baseline * expectedSurge) + surged.breakdown.zoneSurcharge) / config.roundingVnd - 1e-9) * config.roundingVnd;
  assert.equal(surged.fareAmount, expectedFare);
  await ok('/drivers/me/go-offline', { method: 'POST', actor: motorcycle });
  await ok('/drivers/me/go-offline', { method: 'POST', actor: secondMotorcycle });
  await waitFor('surge with zero motorcycle supply', async () => {
    const value = await cache.get(key), current = value && JSON.parse(value);
    return current?.demand === 6 && current.availableDrivers === 0 && current.multiplier === config.maxSurgeMultiplier;
  }, config.surgeRefreshSeconds * 3000);
  pass('Demand with zero available motorcycles uses the configured surge ceiling');
  await db.query('UPDATE trips SET status=$2 WHERE "tripId"=ANY($1::uuid[])', [fixtures, 'COMPLETED']);
  await waitFor('surge returns to neutral with no demand', async () => {
    const value = await cache.get(key), current = value && JSON.parse(value);
    return current?.demand === 0 && current.multiplier === 1;
  }, config.surgeRefreshSeconds * 3000);
  pass('Surge returns to 1x after the waiting demand clears');
  evidence.status = 'PASS';
}

main().catch(error => { evidence.status = 'FAIL'; evidence.error = error.stack; log(`FAIL: ${error.stack}`); process.exitCode = 1; }).finally(async () => {
  // Remove only UUIDs created by this run, never reset shared data or queues.
  if (fixtures.length) await db.query('DELETE FROM trips WHERE "tripId"=ANY($1::uuid[])', [fixtures]).catch(error => log(`Cleanup failed: ${error.message}`));
  for (const driver of drivers) {
    try {
      const state = await ok(`/drivers/${driver.userId}`, { actor: driver });
      if (state.status === 'AVAILABLE') await ok('/drivers/me/go-offline', { method: 'POST', actor: driver });
    } catch (error) { log(`Driver cleanup: ${error.message}`); }
  }
  if (cache.isReady) for (const entry of activeCells) await cache.zRem('pricing:active-cells', entry).catch(() => {});
  evidence.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidenceDir, `${evidenceName}.json`), JSON.stringify(evidence, null, 2) + '\n');
  log(`RESULT: ${evidence.checks.length} checks ${evidence.status}; evidence=${path.relative(process.cwd(), evidenceDir)}`);
  await Promise.allSettled([db.end(), broker?.close(), cache.isOpen ? cache.quit() : undefined]);
});
