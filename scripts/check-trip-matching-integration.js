'use strict';
// Runs against the local Compose stack. Creates isolated test users/trips.
// Payment results are simulated until TV3's Saga implementation is merged.
require('../trip-service/node_modules/dotenv').config({ path: require('node:path').join(__dirname, '../.env') });
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('../trip-service/node_modules/pg');
const amqp = require('../trip-service/node_modules/amqplib');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.join(__dirname, '..');
const gateway = 'http://127.0.0.1:8080';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uuid = () => crypto.randomUUID();
const faults = process.argv.includes('--faults');
const compose = (...args) => execFileSync('docker', ['compose', '-f', 'deploy/docker-compose.yml', '--env-file', '.env', '--profile', 'scale', ...args], { cwd: root, timeout: 90000, stdio: 'pipe' });
const pool = prefix => new Pool({ host: '127.0.0.1', port: Number(process.env[`${prefix}_DB_PORT`]), user: process.env[`${prefix}_DB_USER`], password: process.env[`${prefix}_DB_PASSWORD`], database: process.env[`${prefix}_DB_NAME`] });
const tripDb = pool('TRIP'), matchingDb = pool('MATCHING');
const context = { connection: null, channel: null, paused: new Set() };
// Separate repeated runs from drivers left in GEO by earlier test runs.
const pickup = { lat: 12 + crypto.randomInt(0, 1000000) / 1000000, lng: 100 + crypto.randomInt(0, 1000000) / 1000000 };
const observed = [];
let passed = 0;
function pass(message) { passed++; console.log(`PASS ${passed}: ${message}`); }
async function request(url, { method = 'GET', body, token, correlationId = uuid() } = {}) {
    const response = await fetch(url, { method, signal: AbortSignal.timeout(15000), headers: { 'X-Correlation-ID': correlationId, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    assert.ok(response.ok, `${method} ${url}: ${response.status} ${text}`);
    return { data, response };
}
async function waitFor(label, check, timeout = 45000) {
    const deadline = Date.now() + timeout;
    let lastError;
    while (Date.now() < deadline) {
        try { const result = await check(); if (result) return result; } catch (error) { lastError = error; }
        await sleep(500);
    }
    throw new Error(`Timeout: ${label}${lastError ? `: ${lastError.message}` : ''}`);
}
async function broker() {
    context.connection = await amqp.connect({ hostname: '127.0.0.1', port: Number(process.env.RABBITMQ_PORT), username: process.env.RABBITMQ_DEFAULT_USER, password: process.env.RABBITMQ_DEFAULT_PASS });
    context.connection.on('error', () => {});
    context.channel = await context.connection.createConfirmChannel();
    context.channel.on('error', () => {});
    const q = await context.channel.assertQueue('', { exclusive: true });
    for (const type of ['trip.completed', 'trip.compensated', 'matching.driver_assigned']) await context.channel.bindQueue(q.queue, 'rideflow.events', type);
    await context.channel.consume(q.queue, msg => { if (msg) observed.push({ event: JSON.parse(msg.content.toString()), properties: msg.properties }); }, { noAck: true });
}
async function publish(event) {
    const properties = { persistent: true, contentType: 'application/json', messageId: event.eventId, type: event.eventType, correlationId: event.correlationId, headers: { 'x-correlation-id': event.correlationId } };
    await new Promise((resolve, reject) => context.channel.publish('rideflow.events', event.eventType, Buffer.from(JSON.stringify(event)), properties, error => error ? reject(error) : resolve()));
}
async function user(role) {
    const suffix = uuid().replaceAll('-', '').slice(0, 12);
    const account = { email: `integration-${suffix}@rideflow.test`, password: 'Test@123456', fullName: `Integration ${role}`, phone: `09${String(crypto.randomInt(0, 100000000)).padStart(8, '0')}`, role };
    await request(`${gateway}/auth/register`, { method: 'POST', body: account });
    return (await request(`${gateway}/auth/login`, { method: 'POST', body: { email: account.email, password: account.password } })).data;
}
async function tripStatus(tripId, status) {
    return waitFor(`${tripId} => ${status}`, async () => {
        const { rows: [trip] } = await tripDb.query('SELECT * FROM trips WHERE "tripId"=$1', [tripId]);
        return trip?.status === status && trip;
    });
}
async function pendingTrip(rider, driver, fare) {
    const correlationId = uuid();
    const { data: trip } = await request(`${gateway}/trips`, { method: 'POST', token: rider.token, correlationId, body: { riderId: rider.userId, pickup, destination: { lat: pickup.lat + 0.01, lng: pickup.lng + 0.01 }, estimatedDistance: 3, fareAmount: fare } });
    await tripStatus(trip.tripId, 'AWAITING_DRIVER');
    const { data: assigned } = await request(`${gateway}/drivers/${driver.userId}`, { token: rider.token });
    assert.equal(assigned.status, 'RESERVED');
    assert.equal(assigned.currentTripId, trip.tripId);
    const { rows: [matching] } = await matchingDb.query('SELECT * FROM matching_requests WHERE "tripId"=$1', [trip.tripId]);
    assert.equal(matching.status, 'ASSIGNED');
    assert.equal(matching.selectedDriverId, driver.userId);
    const { rows: [requested] } = await tripDb.query("SELECT envelope FROM event_outbox WHERE envelope->>'eventType'='trip.requested' AND envelope->'payload'->>'tripId'=$1", [trip.tripId]);
    await publish(requested.envelope);
    await request(`${gateway}/trips/${trip.tripId}/start`, { method: 'POST', token: driver.token });
    await request(`${gateway}/trips/${trip.tripId}/complete`, { method: 'POST', token: driver.token, body: { fareAmount: fare } });
    await tripStatus(trip.tripId, 'PAYMENT_PENDING');
    const completed = await waitFor('trip.completed envelope', () => observed.find(item => item.event.eventType === 'trip.completed' && item.event.payload.tripId === trip.tripId));
    assert.equal(completed.event.correlationId, correlationId);
    assert.equal(completed.event.payload.riderId, rider.userId);
    assert.equal(completed.event.payload.fareAmount, fare);
    assert.equal(completed.properties.messageId, completed.event.eventId);
    assert.equal(completed.properties.deliveryMode, 2);
    assert.equal(completed.properties.headers['x-correlation-id'], correlationId);
    const assignment = await waitFor('assignment event', () => observed.find(item => item.event.eventType === 'matching.driver_assigned' && item.event.payload.tripId === trip.tripId));
    assert.equal(assignment.event.correlationId, correlationId);
    pass(`Gateway -> Matching -> reserve -> start -> complete; tripId=${trip.tripId}; correlationId=${correlationId}`);
    return { ...trip, correlationId, fare };
}
function payment(trip, rider, driver, failed) {
    const time = new Date().toISOString();
    return { eventId: uuid(), eventType: failed ? 'payment.failed' : 'payment.succeeded', correlationId: trip.correlationId, occurredAt: time, payload: { paymentId: uuid(), tripId: trip.tripId, riderId: rider.userId, driverId: driver.userId, amount: trip.fare, ...(failed ? { reason: 'INSUFFICIENT_FUNDS', failedAt: time } : { paidAt: time }) } };
}
async function result(event, driver, status) {
    const trip = await tripStatus(event.payload.tripId, status);
    assert.equal(trip.paymentId, event.payload.paymentId);
    const { data } = await request(`http://127.0.0.1:8082/drivers/${driver.userId}`);
    assert.equal(data.status, 'AVAILABLE');
    if (status === 'CANCELLED') {
        const compensated = await waitFor('trip.compensated', () => observed.find(item => item.event.eventType === 'trip.compensated' && item.event.payload.tripId === trip.tripId));
        assert.equal(compensated.event.correlationId, event.correlationId);
        assert.equal(compensated.event.payload.reason, event.payload.reason);
    }
    await publish(event);
    await publish({ ...event, eventId: uuid() });
    await sleep(1500);
    const { rows: [history] } = await tripDb.query('SELECT count(*)::int AS total FROM trip_status_history WHERE "tripId"=$1 AND new_status=$2', [trip.tripId, status]);
    assert.equal(history.total, 1);
    const { rows: [matching] } = await matchingDb.query("SELECT count(*)::int AS total FROM event_outbox WHERE envelope->>'eventType'='matching.driver_assigned' AND envelope->'payload'->>'tripId'=$1", [trip.tripId]);
    assert.equal(matching.total, 1);
    if (status === 'CANCELLED') {
        const { rows: [compensation] } = await tripDb.query("SELECT count(*)::int AS total FROM event_outbox WHERE envelope->>'eventType'='trip.compensated' AND envelope->'payload'->>'tripId'=$1", [trip.tripId]);
        assert.equal(compensation.total, 1);
    }
    pass(`Simulated ${event.eventType} -> ${status}, driver AVAILABLE; duplicate eventId and business result are idempotent`);
}
async function main() {
    console.log(`Integration run ${new Date().toISOString()}; real PostgreSQL/RabbitMQ/Eureka/Driver; simulated Payment results; faults=${faults}`);
    await broker();
    const rider = await user('ROLE_PASSENGER'), driver = await user('ROLE_DRIVER');
    await request(`${gateway}/drivers`, { method: 'POST', token: driver.token, body: { licensePlate: `TEST-${uuid().slice(0, 8)}`, vehicleType: 'MOTORCYCLE' } });
    await request(`${gateway}/drivers/me/go-online`, { method: 'POST', token: driver.token });
    await request(`${gateway}/drivers/me/location`, { method: 'POST', token: driver.token, body: { latitude: pickup.lat, longitude: pickup.lng } });
    const instances = new Set();
    for (let i = 0; i < 10; i++) instances.add((await request(`${gateway}/drivers/${driver.userId}`, { token: rider.token })).response.headers.get('x-handled-by-instance').split(',')[0].trim());
    assert.equal(instances.size, 2);
    pass(`Driver load balancing: ${[...instances].join(', ')}`);
    const denied = await fetch(`${gateway}/internal/drivers/${driver.userId}/release`, { method: 'POST', headers: { Authorization: `Bearer ${rider.token}` } });
    assert.equal(denied.status, 403);
    pass('Gateway blocks /internal');
    for (const [fare, failed] of [[125000, false], [5000000, true]]) {
        const trip = await pendingTrip(rider, driver, fare);
        const event = payment(trip, rider, driver, failed);
        await publish(event);
        await result(event, driver, failed ? 'CANCELLED' : 'CONFIRMED');
    }
    const dlq = 'trip-service.payment.failed.dlq';
    const before = await context.channel.checkQueue(dlq);
    await publish({ eventId: uuid(), eventType: 'payment.failed' });
    await waitFor('malformed message in DLQ', async () => (await context.channel.checkQueue(dlq)).messageCount > before.messageCount);
    pass('Malformed event is dead-lettered');
    if (faults) {
        const trip = await pendingTrip(rider, driver, 5000000);
        const event = payment(trip, rider, driver, true);
        compose('stop', 'trip_service'); context.paused.add('trip_service');
        await publish(event);
        const queued = await context.channel.checkQueue('trip-service.payment.failed');
        assert.ok(queued.messageCount > 0);
        compose('start', 'trip_service'); context.paused.delete('trip_service');
        await result(event, driver, 'CANCELLED');
        pass('Payment event survives Trip downtime and is consumed after restart');
        const retryTrip = await pendingTrip(rider, driver, 5000000);
        const retryEvent = payment(retryTrip, rider, driver, true);
        const dlqBefore = (await context.channel.checkQueue(dlq)).messageCount;
        compose('stop', 'driver_service_1', 'driver_service_2');
        context.paused.add('driver_service_1'); context.paused.add('driver_service_2');
        await publish(retryEvent);
        await waitFor('driver failure retried then DLQ', async () => (await context.channel.checkQueue(dlq)).messageCount > dlqBefore);
        const { rows: [unchanged] } = await tripDb.query('SELECT status FROM trips WHERE "tripId"=$1', [retryTrip.tripId]);
        assert.equal(unchanged.status, 'PAYMENT_PENDING');
        const { rows: [dedup] } = await tripDb.query('SELECT count(*)::int AS total FROM processed_events WHERE event_id=$1', [retryEvent.eventId]);
        assert.equal(dedup.total, 0);
        compose('start', 'driver_service_1', 'driver_service_2');
        context.paused.delete('driver_service_1'); context.paused.delete('driver_service_2');
        await waitFor('driver back online', async () => (await request('http://127.0.0.1:8082/ping')).response.ok, 90000);
        // HTTP readiness precedes Eureka's registry cache refresh. Wait until
        // both instances are visible in the full registry before republishing.
        await waitFor('both drivers registered in Eureka', async () => {
            const response = await fetch('http://127.0.0.1:8761/eureka/apps', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
            const registry = await response.json();
            const application = registry.applications.application.find(app => app.name === 'DRIVER-SERVICE');
            return application?.instance.filter(instance => instance.status === 'UP').length === 2;
        }, 90000);
        await sleep(6000);
        await publish(retryEvent);
        await result(retryEvent, driver, 'CANCELLED');
        pass('Driver outage rolls back DB/dedup, exhausts retry into DLQ, same event succeeds after recovery');
    }
    await request(`${gateway}/drivers/me/go-offline`, { method: 'POST', token: driver.token });
    console.log(`RESULT: ${passed} integration checks passed. Payment/Notification automatic Saga remains unavailable in this branch.`);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
    if (context.paused.size) { try { compose('start', ...context.paused); } catch (error) { console.error(error.message); } }
    await Promise.allSettled([tripDb.end(), matchingDb.end(), context.connection?.close()]);
});
