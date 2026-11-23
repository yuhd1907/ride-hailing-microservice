'use strict';
// Real Gateway -> Trip -> RabbitMQ -> Matching -> Driver -> Payment/Notification.
// Run from repo root after npm ci in trip-service and Compose --profile scale up.
const path = require('node:path');
require('../trip-service/node_modules/dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { Pool } = require('../trip-service/node_modules/pg');
const amqp = require('../trip-service/node_modules/amqplib');
const root = path.resolve(__dirname, '..');
const gateway = `http://127.0.0.1:${process.env.GATEWAY_PORT || 8080}`;
const demo = process.argv.includes('--demo');
const evidence = path.join(root, 'docs/evidence/phase3', demo ? 'trip-matching-demo.txt' : 'trip-matching-integration.txt');
fs.mkdirSync(path.dirname(evidence), { recursive: true });
fs.writeFileSync(evidence, '');
const log = message => { console.log(message); fs.appendFileSync(evidence, message + '\n'); };
const uuid = () => crypto.randomUUID();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pool = prefix => new Pool({ host: '127.0.0.1', port: Number(process.env[`${prefix}_DB_PORT`]), user: process.env[`${prefix}_DB_USER`], password: process.env[`${prefix}_DB_PASSWORD`], database: process.env[`${prefix}_DB_NAME`] });
const tripDb = pool('TRIP'), matchingDb = pool('MATCHING');
const pickup = { lat: 12 + crypto.randomInt(0, 1000000) / 1000000, lng: 100 + crypto.randomInt(0, 1000000) / 1000000 };
const destination = { lat: pickup.lat + 0.01, lng: pickup.lng + 0.01 };
const drivers = [], observed = [];
let connection, channel, passed = 0;
const pass = message => log(`PASS ${++passed}: ${message}`);

async function call(route, { method = 'GET', actor, body, headers = {}, correlationId = uuid() } = {}) {
  const response = await fetch(gateway + route, { method, signal: AbortSignal.timeout(15000), headers: { 'X-Correlation-ID': correlationId, ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}
async function ok(route, options) {
  const result = await call(route, options);
  assert.ok(result.status >= 200 && result.status < 300, `${options?.method || 'GET'} ${route}: ${result.status} ${JSON.stringify(result.data)}`);
  return result.data;
}
async function waitFor(label, check, timeout = 60000) {
  const until = Date.now() + timeout;
  let lastError;
  while (Date.now() < until) {
    try { const result = await check(); if (result) return result; } catch (error) { lastError = error; }
    await sleep(400);
  }
  throw new Error(`Timeout: ${label}${lastError ? ': ' + lastError.message : ''}`);
}
async function user(role) {
  const account = { email: `phase3-${uuid()}@rideflow.test`, password: 'Test@123456', fullName: `Phase3 ${role}`, phone: `09${String(crypto.randomInt(0, 100000000)).padStart(8, '0')}`, role };
  await ok('/auth/register', { method: 'POST', body: account });
  return ok('/auth/login', { method: 'POST', body: { email: account.email, password: account.password } });
}
async function onlineDriver(offset) {
  const driver = await user('ROLE_DRIVER');
  drivers.push(driver);
  await ok('/drivers', { method: 'POST', actor: driver, body: { licensePlate: `P3-${uuid().slice(0, 8)}`, vehicleType: 'MOTORCYCLE' } });
  await ok('/drivers/me/go-online', { method: 'POST', actor: driver });
  await ok('/drivers/me/location', { method: 'POST', actor: driver, body: { latitude: pickup.lat + offset, longitude: pickup.lng } });
  return driver;
}
const driverState = driver => ok(`/drivers/${driver.userId}`);
const action = (trip, name, actor, body, headers) => call(`/trips/${trip.tripId}/${name}`, { method: 'POST', actor, body, headers });
const perform = async (...args) => { const result = await action(...args); assert.equal(result.status, 200, JSON.stringify(result)); return result.data; };
const status = (trip, actor, expected, driverId) => waitFor(`${trip.tripId} -> ${expected}`, async () => {
  const current = await ok(`/trips/${trip.tripId}`, { actor });
  return current.status === expected && (driverId === undefined || current.driverId === driverId) && current;
});
async function requested(rider) {
  return ok('/trips', { method: 'POST', actor: rider, body: { pickup, destination, fareAmount: 1, estimatedDistance: 99999 } });
}
async function outbox(type, tripId, db = tripDb) {
  const { rows } = await db.query("SELECT envelope FROM event_outbox WHERE envelope->>'eventType'=$1 AND envelope->'payload'->>'tripId'=$2 ORDER BY created_at", [type, tripId]);
  return rows.map(row => row.envelope);
}
async function publish(event) {
  await new Promise((resolve, reject) => channel.publish('rideflow.events', event.eventType, Buffer.from(JSON.stringify(event)), { persistent: true, contentType: 'application/json', messageId: event.eventId, type: event.eventType, correlationId: event.correlationId }, error => error ? reject(error) : resolve()));
}
async function finish(trip, rider, driver) {
  await perform(trip, 'complete', driver, { fareAmount: 999999999 });
  const confirmed = await status(trip, rider, 'CONFIRMED');
  const payment = await ok(`/payments/trips/${trip.tripId}`, { actor: rider });
  assert.equal(Number(payment.amount), Number(trip.fare));
  assert.equal(payment.status, 'SUCCESS');
  await waitFor('driver AVAILABLE', async () => (await driverState(driver)).status === 'AVAILABLE');
  return confirmed;
}

async function main() {
  log(`Phase3 ${demo ? 'demo' : 'integration'}: ${new Date().toISOString()}; gateway=${gateway}; real PostgreSQL/RabbitMQ/Eureka/Java services; runtime=${process.env.PHASE3_RUNTIME || 'Docker Compose'}`);
  connection = await amqp.connect({ hostname: '127.0.0.1', port: Number(process.env.RABBITMQ_PORT || 5672), username: process.env.RABBITMQ_DEFAULT_USER, password: process.env.RABBITMQ_DEFAULT_PASS });
  connection.on('error', () => {});
  channel = await connection.createConfirmChannel();
  channel.on('error', () => {});
  const queue = await channel.assertQueue('', { exclusive: true });
  await channel.bindQueue(queue.queue, 'rideflow.events', '#');
  await channel.consume(queue.queue, message => { if (message) observed.push({ event: JSON.parse(message.content), properties: message.properties }); }, { noAck: true });
  await waitFor('Gateway/User readiness', async () => (await call('/users/ping')).status === 200, 120000);
  const rider = await user('ROLE_PASSENGER'), other = await user('ROLE_PASSENGER');
  await waitFor('Gateway/Trip readiness', async () => (await call('/trips/ping', { actor: rider })).status === 200, 120000);
  const driverA = await onlineDriver(0), driverB = await onlineDriver(0.002);
  const body = { pickup, destination };
  const quote = await ok('/trips/estimate', { method: 'POST', actor: rider, body });
  assert.deepEqual(quote, await ok('/trips/estimate', { method: 'POST', actor: rider, body }));
  assert.equal((await call('/trips', { method: 'POST', actor: driverA, body })).status, 403);
  assert.equal((await call('/trips', { method: 'POST', actor: rider, body: { ...body, riderId: other.userId } })).status, 403);
  assert.equal((await call('/trips', { method: 'POST', body })).status, 401);
  pass(`Server quote is deterministic: distance=${quote.estimatedDistance} km; fare=${quote.fareAmount} VND; driver/forged passenger/anonymous bookings denied`);

  const trip = await requested(rider);
  assert.equal(trip.passengerId, rider.userId);
  assert.equal(Number(trip.fare), quote.fareAmount);
  assert.equal(Number(trip.estimatedDistance), quote.estimatedDistance);
  await status(trip, rider, 'AWAITING_DRIVER', driverA.userId);
  assert.equal((await driverState(driverA)).status, 'RESERVED');
  assert.equal((await call(`/trips/${trip.tripId}`, { actor: other })).status, 403);
  for (const name of ['accept', 'reject', 'start', 'complete']) {
    assert.equal((await action(trip, name, rider)).status, 403);
    assert.equal((await action(trip, name, driverB)).status, 403);
  }
  assert.equal((await action(trip, 'accept', rider, {}, { 'X-User-Id': driverA.userId, 'X-User-Roles': 'ROLE_DRIVER' })).status, 403);
  assert.equal((await call(`/trips/${trip.tripId}`, { actor: other, headers: { 'X-User-Id': rider.userId, 'X-User-Roles': 'ROLE_PASSENGER' } })).status, 403);
  pass(`Nearest A assigned; client fare=1 ignored; owner reads enforced; all four driver actions and spoofed Gateway headers denied for unauthorized users; tripId=${trip.tripId}`);

  await perform(trip, 'reject', driverA);
  assert.equal((await driverState(driverA)).status, 'AVAILABLE');
  await status(trip, rider, 'AWAITING_DRIVER', driverB.userId);
  assert.equal((await driverState(driverB)).status, 'RESERVED');
  assert.equal((await action(trip, 'accept', driverA)).status, 403);
  const rejected = (await outbox('trip.driver_rejected', trip.tripId))[0];
  const oldAssignment = (await outbox('matching.driver_assigned', trip.tripId, matchingDb))[0];
  await publish(rejected);
  await publish({ ...oldAssignment, eventId: uuid() });
  await status(trip, rider, 'AWAITING_DRIVER', driverB.userId);
  pass(`A rejected -> AVAILABLE; Matching selected B and excluded A; duplicate rejection/stale assignment cannot restore A; A=${driverA.userId}; B=${driverB.userId}`);

  const accepted = await perform(trip, 'accept', driverB);
  assert.equal(accepted.status, 'IN_PROGRESS');
  await perform(trip, 'start', driverB);
  assert.equal((await action(trip, 'cancel', rider)).status, 409);
  assert.equal((await action(trip, 'reject', driverB)).status, 409);
  await finish(trip, rider, driverB);
  await perform(trip, 'complete', driverB, { fareAmount: -1 });
  const completed = await outbox('trip.completed', trip.tripId);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].payload.fareAmount, quote.fareAmount);
  const delivered = await waitFor('confirmed trip.completed envelope', () => observed.find(item => item.event.eventId === completed[0].eventId));
  assert.equal(delivered.properties.messageId, completed[0].eventId);
  assert.equal(delivered.properties.deliveryMode, 2);
  assert.equal(delivered.event.correlationId, trip.sagaId);
  pass(`B accepted -> IN_PROGRESS -> complete -> CONFIRMED; Payment charged stored fare ${quote.fareAmount}; repeated start/complete produced one payment event; persistent AMQP eventId/correlationId verified`);
  if (demo) { log(`RESULT: ${passed} demo checks PASS. Fare=${quote.fareAmount} VND; tripId=${trip.tripId}`); return; }

  const exhausted = await requested(rider);
  await status(exhausted, rider, 'AWAITING_DRIVER', driverA.userId);
  await perform(exhausted, 'reject', driverA);
  await status(exhausted, rider, 'AWAITING_DRIVER', driverB.userId);
  await perform(exhausted, 'reject', driverB);
  await status(exhausted, rider, 'FAILED');
  const failure = (await outbox('matching.failed', exhausted.tripId, matchingDb))[0];
  await publish(failure);
  await publish({ ...failure, eventId: uuid() });
  await waitFor('passenger TRIP_FAILED notification', async () => (await ok('/notifications/me', { actor: rider })).some(item => item.tripId === exhausted.tripId && item.type === 'TRIP_FAILED'));
  assert.equal((await outbox('trip.failed', exhausted.tripId)).length, 1);
  assert.equal((await driverState(driverA)).status, 'AVAILABLE');
  assert.equal((await driverState(driverB)).status, 'AVAILABLE');
  pass(`Both drivers rejected -> FAILED -> passenger received TRIP_FAILED; duplicate failure did not create duplicate trip.failed; tripId=${exhausted.tripId}`);

  const cancelled = await requested(rider);
  await status(cancelled, rider, 'AWAITING_DRIVER', driverA.userId);
  assert.equal((await action(cancelled, 'cancel', other)).status, 403);
  await perform(cancelled, 'cancel', rider);
  await perform(cancelled, 'cancel', rider);
  await status(cancelled, rider, 'CANCELLED');
  assert.equal((await driverState(driverA)).status, 'AVAILABLE');
  await waitFor('Matching cancellation persisted', async () => (await matchingDb.query('SELECT status FROM matching_requests WHERE "tripId"=$1', [cancelled.tripId])).rows[0]?.status === 'CANCELLED');
  assert.equal((await outbox('trip.cancelled', cancelled.tripId)).length, 1);
  pass(`Passenger cancellation before acceptance -> CANCELLED; reserved driver freed; duplicate cancel emitted one event; other passenger denied; tripId=${cancelled.tripId}`);

  // Deterministic ordering: a test-owned REQUESTED fixture has no requested
  // event yet. Deliver cancellation first, then a late requested event.
  const early = { tripId: uuid() }, earlyCorrelation = uuid();
  await tripDb.query('INSERT INTO trips ("tripId","passengerId",pickup,destination,"estimatedDistance",fare,"sagaId") VALUES ($1,$2,$3,$4,$5,$6,$7)', [early.tripId, rider.userId, pickup, destination, quote.estimatedDistance, quote.fareAmount, earlyCorrelation]);
  await perform(early, 'cancel', rider);
  await waitFor('early cancellation reaches Matching', async () => (await matchingDb.query('SELECT status FROM matching_requests WHERE "tripId"=$1', [early.tripId])).rows[0]?.status === 'CANCELLED');
  const lateRequest = { eventId: uuid(), eventType: 'trip.requested', correlationId: earlyCorrelation, occurredAt: new Date().toISOString(), payload: { tripId: early.tripId, riderId: rider.userId, pickup } };
  await publish(lateRequest);
  await waitFor('late requested event consumed', async () => (await matchingDb.query('SELECT event_id FROM processed_events WHERE event_id=$1', [lateRequest.eventId])).rowCount === 1);
  await status(early, rider, 'CANCELLED');
  assert.equal((await driverState(driverA)).status, 'AVAILABLE');
  assert.equal((await driverState(driverB)).status, 'AVAILABLE');
  assert.equal((await outbox('matching.driver_assigned', early.tripId, matchingDb)).length, 0);
  pass('Cancellation delivered before trip.requested; terminal tombstone blocks late request without assignment or leaked reservation');

  const racing = await requested(rider);
  await status(racing, rider, 'AWAITING_DRIVER', driverA.userId);
  const winners = await Promise.all([action(racing, 'accept', driverA), action(racing, 'cancel', rider)]);
  assert.deepEqual(winners.map(result => result.status).sort(), [200, 409]);
  const current = await ok(`/trips/${racing.tripId}`, { actor: rider });
  if (current.status === 'IN_PROGRESS') await finish(racing, rider, driverA);
  else { assert.equal(current.status, 'CANCELLED'); assert.equal((await driverState(driverA)).status, 'AVAILABLE'); }
  pass('Concurrent accept/cancel: exactly one succeeds, the loser gets 409, driver state matches the winning transition');

  // Two real PostgreSQL snapshots, one CAS winner and one stale-version loser.
  const first = await tripDb.connect(), second = await tripDb.connect();
  const fixtureId = uuid();
  try {
    await tripDb.query('INSERT INTO trips ("tripId","passengerId",pickup,destination,"estimatedDistance",fare) VALUES ($1,$2,$3,$4,0,12000)', [fixtureId, rider.userId, pickup, destination]);
    await first.query('BEGIN'); await second.query('BEGIN');
    const snapshotA = (await first.query('SELECT * FROM trips WHERE "tripId"=$1', [fixtureId])).rows[0];
    const snapshotB = (await second.query('SELECT * FROM trips WHERE "tripId"=$1', [fixtureId])).rows[0];
    const { history } = require('../trip-service/src/saga');
    await history(first, snapshotA, 'CANCELLED', 'phase3 optimistic winner');
    await first.query('COMMIT');
    await assert.rejects(history(second, snapshotB, 'FAILED', 'phase3 stale loser'), { status: 409 });
    await second.query('ROLLBACK');
    assert.equal((await tripDb.query('SELECT version FROM trips WHERE "tripId"=$1', [fixtureId])).rows[0].version, 1);
    pass('Real PostgreSQL optimistic version check: stale snapshot rejected, one version increment and no stale history committed');
  } finally {
    await first.query('ROLLBACK'); await second.query('ROLLBACK'); first.release(); second.release();
    await tripDb.query('DELETE FROM trips WHERE "tripId"=$1', [fixtureId]);
  }
  log(`RESULT: ${passed} integration checks PASS; real PostgreSQL, RabbitMQ and application services; runtime=${process.env.PHASE3_RUNTIME || 'Docker Compose'}.`);
}

main().catch(error => { log(`RESULT: FAIL\n${error.stack}`); process.exitCode = 1; }).finally(async () => {
  for (const driver of drivers) {
    try { if ((await driverState(driver)).status === 'AVAILABLE') await ok('/drivers/me/go-offline', { method: 'POST', actor: driver }); } catch {}
  }
  await Promise.allSettled([tripDb.end(), matchingDb.end(), connection?.close()]);
});
