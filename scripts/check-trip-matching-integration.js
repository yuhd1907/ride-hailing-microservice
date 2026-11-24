'use strict';
// Runs against the local Compose stack. Creates isolated test users/trips.
// Payment results come from the real Payment Service (TV3 Saga): Payment khoá tiền khi
// trip.requested, trả payment.authorized thì Trip mới phát trip.matching_requested cho Matching.
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
const context = { connection: null, channel: null, paused: new Set(), drivers: [] };
// Separate repeated runs from drivers left in GEO by earlier test runs.
const pickup = { lat: 12 + crypto.randomInt(0, 1000000) / 1000000, lng: 100 + crypto.randomInt(0, 1000000) / 1000000 };
const observed = [];
let passed = 0;
function pass(message) { passed++; console.log(`PASS ${passed}: ${message}`); }
async function request(url, { method = 'GET', body, token, correlationId = uuid() } = {}) {
    for (let attempt = 0; ; attempt++) {
        const response = await fetch(url, { method, signal: AbortSignal.timeout(15000), headers: { 'X-Correlation-ID': correlationId, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        const text = await response.text();
        if (response.status === 429 && attempt < 5) { await sleep(1100); continue; }
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        assert.ok(response.ok, `${method} ${url}: ${response.status} ${text}`);
        return { data, response };
    }
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
    for (const type of ['trip.completed', 'trip.compensated', 'trip.failed', 'trip.matching_requested', 'matching.driver_assigned', 'payment.authorized', 'payment.authorization_failed', 'payment.succeeded', 'payment.failed']) await context.channel.bindQueue(q.queue, 'rideflow.events', type);
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
        return (Array.isArray(status) ? status.includes(trip?.status) : trip?.status === status) && trip;
    });
}
// Đặt số dư ngân hàng ảo qua API nội bộ của Payment (cổng 8085, không qua Gateway).
async function setBalance(rider, amount) {
    const response = await fetch(`http://127.0.0.1:8085/internal/payments/bank/accounts/${rider.userId}/balance?amount=${amount}`, { method: 'PUT', signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, `set balance ${amount}: ${response.status}`);
}
// failed: sau khi Payment đã khoá tiền, hạ số dư về 0 để lần trừ tiền khi kết thúc chuyến thất bại
// (payment.failed → Trip bù trừ). beforeComplete chạy ngay trước khi tài xế hoàn thành chuyến.
async function pendingTrip(rider, driver, { failed = false, beforeComplete } = {}) {
    const correlationId = uuid();
    await setBalance(rider, 1000000);
    const destination = { lat: pickup.lat + 0.01, lng: pickup.lng + 0.01 };
    const { data: trip } = await request(`${gateway}/trips`, { method: 'POST', token: rider.token, correlationId, body: { pickup, destination } });
    const fare = Number(trip.fare);
    await tripStatus(trip.tripId, 'AWAITING_DRIVER');
    const authorized = await waitFor('payment.authorized', () => observed.find(item => item.event.eventType === 'payment.authorized' && item.event.payload?.tripId === trip.tripId));
    assert.equal(authorized.event.correlationId, correlationId);
    assert.equal(Number(authorized.event.payload.amount), fare);
    const { data: assigned } = await request(`${gateway}/drivers/${driver.userId}`, { token: rider.token });
    assert.equal(assigned.status, 'RESERVED');
    assert.equal(assigned.currentTripId, trip.tripId);
    const { rows: [matching] } = await matchingDb.query('SELECT * FROM matching_requests WHERE "tripId"=$1', [trip.tripId]);
    assert.equal(matching.status, 'ASSIGNED');
    assert.equal(matching.selectedDriverId, driver.userId);
    // Gửi lại đúng event Matching đã xử lý: Matching bỏ qua, không ghép thêm lần nữa.
    const { rows: [requested] } = await tripDb.query("SELECT envelope FROM event_outbox WHERE envelope->>'eventType'='trip.matching_requested' AND envelope->'payload'->>'tripId'=$1", [trip.tripId]);
    await publish(requested.envelope);
    await request(`${gateway}/trips/${trip.tripId}/start`, { method: 'POST', token: driver.token });
    if (failed) await setBalance(rider, 0);
    if (beforeComplete) await beforeComplete();
    await request(`${gateway}/trips/${trip.tripId}/complete`, { method: 'POST', token: driver.token, body: { fareAmount: fare } });
    await tripStatus(trip.tripId, ['PAYMENT_PENDING', 'CONFIRMED', 'CANCELLED']);
    const completed = await waitFor('trip.completed envelope', () => observed.find(item => item.event.eventType === 'trip.completed' && item.event.payload?.tripId === trip.tripId));
    assert.equal(completed.event.correlationId, correlationId);
    assert.equal(completed.event.payload.riderId, rider.userId);
    assert.equal(completed.event.payload.fareAmount, fare);
    assert.equal(completed.properties.messageId, completed.event.eventId);
    assert.equal(completed.properties.deliveryMode, 2);
    assert.equal(completed.properties.headers['x-correlation-id'], correlationId);
    const assignment = await waitFor('assignment event', () => observed.find(item => item.event.eventType === 'matching.driver_assigned' && item.event.payload?.tripId === trip.tripId));
    assert.equal(assignment.event.correlationId, correlationId);
    pass(`Gateway -> Payment hold -> Matching -> reserve -> start -> complete; tripId=${trip.tripId}; correlationId=${correlationId}`);
    return { ...trip, correlationId, fare };
}
async function paymentResult(trip, failed, timeout = 45000) {
    const type = failed ? 'payment.failed' : 'payment.succeeded';
    const item = await waitFor(`${type} from Payment Service`, () => observed.find(entry => entry.event.eventType === type && entry.event.payload?.tripId === trip.tripId), timeout);
    assert.equal(item.event.correlationId, trip.correlationId);
    assert.equal(Number(item.event.payload.amount), trip.fare);
    assert.equal(item.properties.messageId, item.event.eventId);
    if (failed) assert.equal(item.event.payload.reason, 'INSUFFICIENT_FUNDS');
    return item.event;
}
async function notifications(tripId, types) {
    return waitFor(`notifications ${types.join(', ')}`, async () => {
        const response = await fetch(`http://127.0.0.1:8086/internal/notifications?tripId=${tripId}`, { signal: AbortSignal.timeout(5000) });
        const items = await response.json();
        return types.every(type => items.some(item => item.type === type)) && items;
    });
}
async function result(event, driver, status) {
    const trip = await tripStatus(event.payload.tripId, status);
    assert.equal(trip.paymentId, event.payload.paymentId);
    const { data } = await request(`http://127.0.0.1:8082/drivers/${driver.userId}`);
    assert.equal(data.status, 'AVAILABLE');
    if (status === 'CANCELLED') {
        const compensated = await waitFor('trip.compensated', () => observed.find(item => item.event.eventType === 'trip.compensated' && item.event.payload?.tripId === trip.tripId));
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
    pass(`Payment Service ${event.eventType} -> ${status}, driver AVAILABLE; duplicate eventId and business result are idempotent`);
}
async function main() {
    console.log(`Integration run ${new Date().toISOString()}; real PostgreSQL/RabbitMQ/Eureka/Driver/Payment/Notification; faults=${faults}`);
    await broker();
    const rider = await user('ROLE_PASSENGER'), driver = await user('ROLE_DRIVER');
    context.drivers.push(driver);
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
    // Không đủ số dư lúc đặt: Payment từ chối khoá, chuyến FAILED trước khi tìm tài xế.
    {
        await setBalance(rider, 1000);
        const correlationId = uuid();
        const { data: trip } = await request(`${gateway}/trips`, { method: 'POST', token: rider.token, correlationId, body: { pickup, destination: { lat: pickup.lat + 0.01, lng: pickup.lng + 0.01 } } });
        const rejected = await waitFor('payment.authorization_failed', () => observed.find(item => item.event.eventType === 'payment.authorization_failed' && item.event.payload?.tripId === trip.tripId));
        assert.equal(rejected.event.payload.reason, 'INSUFFICIENT_FUNDS');
        const failedTrip = await tripStatus(trip.tripId, 'FAILED');
        assert.equal(failedTrip.driverId, null);
        const tripFailed = await waitFor('trip.failed', () => observed.find(item => item.event.eventType === 'trip.failed' && item.event.payload?.tripId === trip.tripId));
        assert.equal(tripFailed.event.correlationId, correlationId);
        assert.equal(tripFailed.event.payload.reason, 'INSUFFICIENT_FUNDS');
        assert.ok(!observed.some(item => item.event.eventType === 'trip.matching_requested' && item.event.payload?.tripId === trip.tripId));
        const { data } = await request(`http://127.0.0.1:8082/drivers/${driver.userId}`);
        assert.equal(data.status, 'AVAILABLE');
        await notifications(trip.tripId, ['TRIP_FAILED']);
        pass(`Insufficient funds at booking -> payment.authorization_failed -> Trip FAILED, trip.failed, TRIP_FAILED; no driver held; tripId=${trip.tripId}`);
    }
    for (const failed of [false, true]) {
        const trip = await pendingTrip(rider, driver, { failed });
        const event = await paymentResult(trip, failed);
        await result(event, driver, failed ? 'CANCELLED' : 'CONFIRMED');
        const expected = failed ? ['PAYMENT_FAILED', 'TRIP_COMPENSATED'] : ['PAYMENT_SUCCEEDED'];
        await notifications(trip.tripId, expected);
        pass(`Notification Service sent ${expected.join(' + ')} for tripId=${trip.tripId}`);
    }
    const dlq = 'trip-service.payment.failed.dlq';
    const before = await context.channel.checkQueue(dlq);
    await publish({ eventId: uuid(), eventType: 'payment.failed' });
    await waitFor('malformed message in DLQ', async () => (await context.channel.checkQueue(dlq)).messageCount > before.messageCount);
    pass('Malformed event is dead-lettered');
    if (faults) {
        // Payment is paused while the trip completes, then Trip goes down before Payment answers.
        const stopPayment = () => { compose('stop', 'payment_service'); context.paused.add('payment_service'); };
        const trip = await pendingTrip(rider, driver, { failed: true, beforeComplete: stopPayment });
        compose('stop', 'trip_service'); context.paused.add('trip_service');
        compose('start', 'payment_service'); context.paused.delete('payment_service');
        const event = await paymentResult(trip, true, 150000);
        await waitFor('payment.failed queued for Trip', async () => (await context.channel.checkQueue('trip-service.payment.failed')).messageCount > 0);
        compose('start', 'trip_service'); context.paused.delete('trip_service');
        await result(event, driver, 'CANCELLED');
        pass('Payment event survives Trip downtime and is consumed after restart');
        // Trip vừa khởi động lại: chờ Gateway thấy instance mới trên Eureka trước khi đặt chuyến tiếp
        // Gateway giữ danh sách instance cũ tới ~35s (cache LoadBalancer), có thể còn lẫn địa chỉ cũ của container:
        // chỉ đi tiếp khi 5 lần ping liên tiếp đều thành công.
        let streak = 0;
        await waitFor('Gateway routes to restarted trip-service', async () => {
            const ok = await fetch(`${gateway}/trips/ping`, { headers: { Authorization: `Bearer ${rider.token}` }, signal: AbortSignal.timeout(5000) }).then(r => r.ok, () => false);
            streak = ok ? streak + 1 : 0;
            return streak >= 5;
        }, 120000);
        const retryTrip = await pendingTrip(rider, driver, { failed: true, beforeComplete: stopPayment });
        const dlqBefore = (await context.channel.checkQueue(dlq)).messageCount;
        compose('stop', 'driver_service_1', 'driver_service_2');
        context.paused.add('driver_service_1'); context.paused.add('driver_service_2');
        compose('start', 'payment_service'); context.paused.delete('payment_service');
        const retryEvent = await paymentResult(retryTrip, true, 150000);
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
    console.log(`RESULT: ${passed} integration checks passed with the real Payment/Notification Saga.`);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
    if (context.paused.size) { try { compose('start', ...context.paused); } catch (error) { console.error(error.message); } }
    for (const driver of context.drivers) {
        try {
            const { data: state } = await request(`${gateway}/drivers/${driver.userId}`, { token: driver.token });
            if (state.status === 'AVAILABLE') await request(`${gateway}/drivers/me/go-offline`, { method: 'POST', token: driver.token });
        } catch (error) { console.error(`Driver cleanup failed: ${error.message}`); }
    }
    await Promise.allSettled([tripDb.end(), matchingDb.end(), context.connection?.close()]);
});
