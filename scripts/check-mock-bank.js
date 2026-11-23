'use strict';
// Kiểm thử tích hợp ngân hàng ảo của Payment Service trên hệ thống thật (Docker Compose).
// Event giả lập được gửi thẳng vào queue của Payment (không qua exchange) để Matching không
// nhận chuyến giả và giữ nhầm tài xế thật. Kết quả đọc từ event Payment phát ra, payment_db
// và API nội bộ cổng 8085.
// Chạy tại thư mục gốc: node scripts/check-mock-bank.js
const path = require('node:path');
require('../trip-service/node_modules/dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const crypto = require('node:crypto');
const { Pool } = require('../trip-service/node_modules/pg');
const amqp = require('../trip-service/node_modules/amqplib');

const env = process.env;
const PAYMENT = `http://127.0.0.1:${env.PAYMENT_SERVICE_PORT || 8085}`;
const uuid = () => crypto.randomUUID();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const db = new Pool({
  host: '127.0.0.1', port: Number(env.PAYMENT_DB_PORT || 5437), user: env.PAYMENT_DB_USER || 'postgres',
  password: env.PAYMENT_DB_PASSWORD || 'postgres_password', database: env.PAYMENT_DB_NAME || 'payment_db',
});
const observed = []; // event payment.* Payment phát ra
let connection, channel, passed = 0;
const heldTrips = new Set(); // các chuyến còn khoá tiền, dọn ở cuối

function check(condition, message) {
  if (!condition) throw new Error(`KHÔNG ĐẠT: ${message}`);
  console.log(`PASS ${++passed}: ${message}`);
}

async function waitFor(label, fn, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await fn();
    if (value) return value;
    await sleep(300);
  }
  throw new Error(`Hết thời gian chờ: ${label}`);
}

async function send(eventType, payload, eventId = uuid()) {
  const envelope = { eventId, eventType, correlationId: uuid(), occurredAt: new Date().toISOString(), payload };
  channel.sendToQueue(`payment-service.${eventType}`, Buffer.from(JSON.stringify(envelope)), {
    persistent: true, contentType: 'application/json', messageId: eventId, type: eventType,
    correlationId: envelope.correlationId, headers: { 'x-correlation-id': envelope.correlationId },
  });
  await channel.waitForConfirms();
  return envelope;
}

const eventsFor = (tripId, type) => observed.filter(e => e.eventType === type && e.payload.tripId === tripId);
const decisionOf = tripId => observed.find(e => e.payload.tripId === tripId
  && ['payment.authorized', 'payment.authorization_failed'].includes(e.eventType));

async function holdsOf(tripId) {
  return (await db.query('SELECT status, amount FROM fund_holds WHERE trip_id = $1', [tripId])).rows;
}
async function heldTotal(userId) {
  const { rows } = await db.query("SELECT COALESCE(SUM(amount), 0)::float8 AS total FROM fund_holds WHERE user_id = $1 AND status = 'HELD'", [userId]);
  return rows[0].total;
}
async function balanceOf(userId) {
  const { rows } = await db.query('SELECT balance::float8 AS balance FROM bank_accounts WHERE user_id = $1', [userId]);
  return rows[0]?.balance;
}
async function paymentsOf(tripId) {
  const response = await fetch(`${PAYMENT}/internal/payments?tripId=${tripId}`);
  return response.json();
}
async function cashConfirm(tripId, driverId) {
  const response = await fetch(`${PAYMENT}/payments/trips/${tripId}/cash-confirm`, {
    method: 'POST', headers: { 'X-User-Id': driverId, 'X-User-Roles': 'ROLE_DRIVER', 'X-Correlation-ID': uuid() },
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  connection = await amqp.connect({ hostname: '127.0.0.1', port: Number(env.RABBITMQ_PORT || 5672), username: env.RABBITMQ_DEFAULT_USER || 'guest', password: env.RABBITMQ_DEFAULT_PASS || 'guest' });
  connection.on('error', () => {});
  channel = await connection.createConfirmChannel();
  channel.on('error', () => {});
  const tap = await channel.assertQueue('', { exclusive: true });
  await channel.bindQueue(tap.queue, 'rideflow.events', 'payment.#');
  await channel.consume(tap.queue, message => { if (message) observed.push(JSON.parse(message.content)); }, { noAck: true });
  const driverId = uuid();

  // 1. Khoá đồng thời: khách mới 500.000 đ, 8 chuyến 100.000 đ cùng lúc → đúng 5 thành công
  const rider = uuid();
  const trips = Array.from({ length: 8 }, () => uuid());
  await Promise.all(trips.map(tripId => send('trip.requested', { tripId, riderId: rider, fareAmount: 100000, paymentMethod: 'BANK' })));
  await waitFor('Payment trả lời đủ 8 chuyến', () => trips.every(decisionOf));
  const authorized = trips.filter(t => decisionOf(t).eventType === 'payment.authorized');
  authorized.forEach(t => heldTrips.add(t));
  check(authorized.length === 5 && trips.length - authorized.length === 3, `8 lần khoá đồng thời với 500.000 đ: ${authorized.length} thành công, ${trips.length - authorized.length} thiếu tiền`);
  check(await heldTotal(rider) === 500000, `Tổng đang khoá của khách = ${await heldTotal(rider)} đ, không vượt số dư`);
  const accounts = (await db.query('SELECT count(*)::int AS n FROM bank_accounts WHERE user_id = $1', [rider])).rows[0].n;
  check(accounts === 1, 'Tài khoản khách mới được tạo đúng một lần dù nhiều lần khoá cùng lúc');

  // 2. Trùng tripId: gửi lại trip.requested của chuyến đã khoá với eventId mới
  const [t0, t1] = authorized;
  await send('trip.requested', { tripId: t0, riderId: rider, fareAmount: 100000, paymentMethod: 'BANK' });
  await sleep(3000);
  check((await holdsOf(t0)).length === 1 && eventsFor(t0, 'payment.authorized').length === 1, 'Gửi lại trip.requested cùng chuyến: vẫn một khoản khoá, không phát payment.authorized lần hai');

  // 3. Hủy chuyến thì mở khoá
  await send('trip.cancelled', { tripId: t0, riderId: rider, cancelledAt: new Date().toISOString() });
  await waitFor('khoản khoá được mở', async () => (await holdsOf(t0))[0]?.status === 'RELEASED');
  heldTrips.delete(t0);
  check(await heldTotal(rider) === 400000, 'trip.cancelled mở khoá: tổng đang khoá giảm còn 400.000 đ');

  // 4. Hủy tới trước yêu cầu: không khoá về sau
  const early = uuid();
  await send('trip.cancelled', { tripId: early, riderId: rider, cancelledAt: new Date().toISOString() });
  await waitFor('chuyến được ghi vào closed_trips', async () => (await db.query('SELECT 1 FROM closed_trips WHERE trip_id = $1', [early])).rowCount === 1);
  await send('trip.requested', { tripId: early, riderId: rider, fareAmount: 100000, paymentMethod: 'BANK' });
  await sleep(3000);
  check((await holdsOf(early)).length === 0 && !decisionOf(early), 'trip.cancelled tới trước trip.requested: không khoá tiền, không phát event');

  // 5. Kết thúc chuyến ngân hàng: trừ đúng khoản đã khoá
  await send('trip.completed', { tripId: t1, riderId: rider, driverId, fareAmount: 100000, completedAt: new Date().toISOString(), paymentMethod: 'BANK' });
  const [bankPayment] = await waitFor('payment của chuyến ngân hàng', async () => { const list = await paymentsOf(t1); return list.length && list; });
  heldTrips.delete(t1);
  check(bankPayment.status === 'SUCCESS' && bankPayment.method === 'BANK', `trip.completed BANK → payment ${bankPayment.status}, ${bankPayment.method}`);
  check((await holdsOf(t1))[0].status === 'CAPTURED' && await balanceOf(rider) === 400000, `Khoản khoá CAPTURED, số dư còn ${await balanceOf(rider)} đ`);

  // 6. Tiền mặt: không khoá, chờ đúng tài xế xác nhận
  const cashRider = uuid(), cashTrip = uuid();
  await send('trip.requested', { tripId: cashTrip, riderId: cashRider, fareAmount: 50000, paymentMethod: 'CASH' });
  const cashAuth = await waitFor('payment.authorized cho chuyến tiền mặt', () => decisionOf(cashTrip));
  check(cashAuth.eventType === 'payment.authorized' && cashAuth.payload.paymentMethod === 'CASH' && cashAuth.payload.holdId === null && (await holdsOf(cashTrip)).length === 0, 'trip.requested CASH → payment.authorized không khoá tiền');
  await send('trip.completed', { tripId: cashTrip, riderId: cashRider, driverId, fareAmount: 50000, completedAt: new Date().toISOString(), paymentMethod: 'CASH' });
  const [pending] = await waitFor('payment tiền mặt', async () => { const list = await paymentsOf(cashTrip); return list.length && list; });
  check(pending.status === 'PENDING' && pending.method === 'CASH', 'trip.completed CASH → payment PENDING, chờ tài xế');
  check((await cashConfirm(cashTrip, uuid())).status === 403, 'Tài xế khác xác nhận tiền mặt → 403');
  const confirmed = await cashConfirm(cashTrip, driverId);
  const again = await cashConfirm(cashTrip, driverId);
  await waitFor('payment.succeeded của chuyến tiền mặt', () => eventsFor(cashTrip, 'payment.succeeded').length > 0);
  check(confirmed.status === 200 && confirmed.body.status === 'SUCCESS' && again.status === 200 && (await paymentsOf(cashTrip)).length === 1, 'Đúng tài xế xác nhận → SUCCESS; gọi lại vẫn 200 và chỉ một payment');
  check(eventsFor(cashTrip, 'payment.succeeded').length === 1 && eventsFor(cashTrip, 'payment.succeeded')[0].payload.paymentMethod === 'CASH', 'payment.succeeded phát đúng một lần, paymentMethod CASH');

  console.log(`RESULT: ${passed} mock bank checks PASS`);
}

main()
  .catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(async () => {
    for (const tripId of heldTrips) await send('trip.cancelled', { tripId, cancelledAt: new Date().toISOString() }).catch(() => {});
    await sleep(500);
    await connection?.close().catch(() => {});
    await db.end();
  });
