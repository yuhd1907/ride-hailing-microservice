'use strict';
/**
 * DEMO 9 KỊCH BẢN BẮT BUỘC — RIDE-HAILING MICROSERVICE
 *
 * Mọi bước gọi API thật qua Gateway (hoặc API nội bộ của service khi kịch bản cần),
 * rồi kiểm tra kết quả thật: không in kết quả soạn sẵn, không sửa database.
 *
 * Phân vai (khoảng 4-6 phút ở chế độ tương tác):
 *   Thành viên A: 1 Khởi động · 2 Tài xế sẵn sàng · 3 Đặt chuyến
 *   Thành viên B: 4 Ghép tài xế · 5 Hoàn thành chuyến · 6 Hai khách giữ cùng tài xế
 *   Thành viên C: 7 Dừng service giữa luồng · 8 Retry/DLQ/Bù trừ · 9 Khởi động lại
 *
 * Chuẩn bị (tại thư mục gốc repo):
 *   npm ci --prefix trip-service
 *   docker compose -f deploy/docker-compose.yml --env-file .env --profile scale up -d --wait
 *
 * Chạy:
 *   node scripts/demo-walkthrough.js          dừng trước mỗi kịch bản, Enter để chạy, q để dừng
 *   node scripts/demo-walkthrough.js --auto   chạy liền một mạch (tập dượt, đo thời gian)
 *
 * Script tự tạo tài khoản riêng cho mỗi lần chạy, tạm dừng notification_service ở
 * kịch bản 7 và bật lỗi giả lập của Payment ở kịch bản 8; khi kết thúc, lỗi, hoặc
 * bấm Ctrl+C đều tự bật lại notification_service, tắt lỗi giả lập và cho tài xế demo offline.
 */
const path = require('node:path');
const fs = require('node:fs');
const root = path.join(__dirname, '..');
require('../trip-service/node_modules/dotenv').config({ path: path.join(root, '.env'), quiet: true });
const crypto = require('node:crypto');
const readline = require('node:readline');
const { execFileSync } = require('node:child_process');
const { Pool } = require('../trip-service/node_modules/pg');
const amqp = require('../trip-service/node_modules/amqplib');

const env = process.env;
const AUTO = process.argv.includes('--auto');
const HOST = '127.0.0.1';
const URLS = {
  gateway: env.GATEWAY_URL || `http://${HOST}:${env.GATEWAY_PORT || 8080}`,
  eureka: `http://${HOST}:${env.EUREKA_PORT || 8761}`,
  payment: `http://${HOST}:${env.PAYMENT_SERVICE_PORT || 8085}`,
  driver1: `http://${HOST}:${env.DRIVER_SERVICE_PORT_1 || 8082}`,
  driver2: `http://${HOST}:${env.DRIVER_SERVICE_PORT_2 || 18082}`,
};
const PAYMENT_MAX = Number(env.PAYMENT_MAX_AMOUNT || 2000000);
const COMPOSE_ARGS = ['compose', '-f', 'deploy/docker-compose.yml',
  ...(fs.existsSync(path.join(root, '.env')) ? ['--env-file', '.env'] : [])];
const REQUIRED_APPS = ['API-GATEWAY', 'USER-SERVICE', 'DRIVER-SERVICE', 'TRIP-SERVICE', 'MATCHING-SERVICE', 'PAYMENT-SERVICE', 'NOTIFICATION-SERVICE'];
const NOTIFICATION_QUEUES = ['matching.driver_assigned', 'payment.succeeded', 'payment.failed', 'trip.compensated', 'trip.failed']
  .map(type => `notification-service.${type}`);

// Điểm đón ngẫu nhiên trong nội thành TP.HCM để mỗi lần chạy không đụng tài xế của lần trước.
const PICKUP = { lat: round6(10.75 + crypto.randomInt(0, 60000) / 1e6), lng: round6(106.64 + crypto.randomInt(0, 80000) / 1e6) };
const NEAR = { lat: round6(PICKUP.lat + 0.018), lng: round6(PICKUP.lng + 0.012) }; // khoảng 2,4 km
const FAR = { lat: round6(PICKUP.lat + 2.0), lng: PICKUP.lng }; // khoảng 220 km, giá vượt hạn mức thanh toán
function round6(x) { return Math.round(x * 1e6) / 1e6; }

// ---------------------------------------------------------------- Hiển thị
const useColor = process.stdout.isTTY && !env.NO_COLOR;
const paint = code => text => (useColor ? `\x1b[${code}m${text}\x1b[0m` : String(text));
const col = { bold: paint('1'), dim: paint('2'), red: paint('31'), green: paint('32'), yellow: paint('33'), magenta: paint('35'), cyan: paint('36') };
const WIDTH = 78;
const out = (text = '') => console.log(text);
const act = text => out(`\n  ${col.cyan('▶')} ${text}`);
const pass = text => out(`  ${col.green('✔')} ${text}`);
const note = text => out(`  ${col.yellow('•')} ${text}`);
const field = (label, value) => out(`      ${col.dim(label.padEnd(24))} ${value}`);
const short = id => (id ? `${String(id).slice(0, 8)}…` : '—');
const vnd = n => `${Number(n).toLocaleString('vi-VN')} đ`;
const startedAt = Date.now();
const elapsed = () => {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

function expect(condition, okText, failText) {
  if (!condition) throw new Error(failText);
  pass(okText);
}

function logHint(services, id) {
  const filter = process.platform === 'win32' ? `Select-String ${id}` : `grep ${id}`;
  out(`\n  ${col.magenta('Tra log')}  docker ${COMPOSE_ARGS.join(' ')} logs ${services.join(' ')} | ${filter}`);
}

// ---------------------------------------------------------------- Trạng thái demo
const state = { drivers: [], notificationStopped: false, faultsSet: false };
const results = [];
let tripDb;
let mq;
const uuid = () => crypto.randomUUID();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------- HTTP
async function http(base, route, { method = 'GET', actor, body, cid = uuid(), headers = {} } = {}) {
  const response = await fetch(base + route, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      'X-Correlation-ID': cid,
      ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}

async function httpOk(base, route, options = {}) {
  const result = await http(base, route, options);
  if (result.status < 200 || result.status >= 300) {
    const detail = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
    throw new Error(`${options.method || 'GET'} ${route} → HTTP ${result.status} ${detail ?? ''}`.trim());
  }
  return result.data;
}
const api = (route, options) => http(URLS.gateway, route, options);
const apiOk = (route, options) => httpOk(URLS.gateway, route, options);

async function waitFor(label, check, timeoutMs = 30000, intervalMs = 400) {
  const until = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < until) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { lastError = error; }
    await sleep(intervalMs);
  }
  throw new Error(`Hết ${timeoutMs / 1000} giây vẫn chưa thấy: ${label}${lastError ? ` (${lastError.message})` : ''}`);
}

// ---------------------------------------------------------------- Nghiệp vụ dùng chung
async function account(role, label) {
  const credentials = {
    email: `demo-${role === 'ROLE_DRIVER' ? 'driver' : 'rider'}-${uuid().slice(0, 8)}@rideflow.test`,
    password: 'Demo@123456',
    fullName: `Demo ${label}`,
    phone: `09${String(crypto.randomInt(0, 1e8)).padStart(8, '0')}`,
    role,
  };
  await apiOk('/auth/register', { method: 'POST', body: credentials });
  const login = await apiOk('/auth/login', { method: 'POST', body: { email: credentials.email, password: credentials.password } });
  return { ...login, label };
}

async function onlineDriver(label, location) {
  const driver = await account('ROLE_DRIVER', label);
  await apiOk('/drivers', { method: 'POST', actor: driver, body: { licensePlate: `59D-${crypto.randomInt(10000, 99999)}`, vehicleType: 'MOTORCYCLE' } });
  state.drivers.push(driver);
  await apiOk('/drivers/me/go-online', { method: 'POST', actor: driver });
  await apiOk('/drivers/me/location', { method: 'POST', actor: driver, body: { latitude: location.lat, longitude: location.lng } });
  return driver;
}

const driverInfo = driver => apiOk(`/drivers/${driver.userId}`);
const waitDriver = (driver, status) => waitFor(`tài xế ${driver.label} → ${status}`, async () => (await driverInfo(driver)).status === status);
const getTrip = (trip, rider) => apiOk(`/trips/${trip.tripId}`, { actor: rider });
const waitTrip = (trip, rider, status, timeoutMs = 30000) => waitFor(`chuyến ${short(trip.tripId)} → ${status}`,
  async () => { const current = await getTrip(trip, rider); return current.status === status && current; }, timeoutMs);
const tripAction = (trip, name, driver) => apiOk(`/trips/${trip.tripId}/${name}`, { method: 'POST', actor: driver, cid: trip.sagaId });
const bookTrip = (rider, destination) => apiOk('/trips', { method: 'POST', actor: rider, cid: uuid(), body: { pickup: PICKUP, destination } });

// Đặt chuyến, chờ ghép, tài xế nhận rồi hoàn thành; trả về chuyến và tài xế được ghép.
async function rideToCompletion(rider, destination) {
  const trip = await bookTrip(rider, destination);
  const assigned = await waitTrip(trip, rider, 'AWAITING_DRIVER');
  const driver = state.drivers.find(d => d.userId === assigned.driverId);
  if (!driver) throw new Error(`Chuyến được ghép với tài xế lạ ${assigned.driverId}, không phải tài xế demo`);
  await tripAction(trip, 'accept', driver);
  await tripAction(trip, 'complete', driver);
  return { trip, driver };
}

async function outboxEvent(type, tripId) {
  const { rows } = await tripDb.query(
    "SELECT event_id, envelope, published_at FROM event_outbox WHERE envelope->>'eventType'=$1 AND envelope->'payload'->>'tripId'=$2 ORDER BY created_at LIMIT 1",
    [type, tripId]);
  return rows[0];
}

async function notificationsFor(rider, tripId) {
  const list = await apiOk('/notifications/me?limit=50', { actor: rider });
  return list.filter(n => n.tripId === tripId);
}

async function queueInfo(name) {
  const channel = await mq.createChannel();
  channel.on('error', () => {});
  try {
    const q = await channel.checkQueue(name);
    return { name, messages: q.messageCount, consumers: q.consumerCount };
  } finally {
    await channel.close().catch(() => {});
  }
}

function compose(...args) {
  return execFileSync('docker', [...COMPOSE_ARGS, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function containerHealth(service) {
  const id = compose('ps', '-q', service).trim();
  if (!id) return 'stopped';
  return execFileSync('docker', ['inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', id], { encoding: 'utf8' }).trim();
}

// Đọc log console của Payment kể từ một thời điểm, lọc theo correlationId và nội dung.
// Mẫu dòng (logback-spring.xml): "2026-11-23 03:36:13.219 [thread] [instance] [correlationId] INFO  logger - message"
const PAYMENT_LOG_LINE = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}) \[[^\]]*\] \[[^\]]*\] \[([^\]]*)\] \S+\s+\S+ - (.*)$/;
function paymentLogs(correlationId, sinceIso, pattern) {
  return compose('logs', '--no-log-prefix', '--since', sinceIso, 'payment_service')
    .split(/\r?\n/)
    .map(line => line.match(PAYMENT_LOG_LINE))
    .filter(m => m && m[2] === correlationId && pattern.test(m[3]))
    .map(m => ({ time: m[1], at: Date.parse(`${m[1].replace(' ', 'T')}Z`), message: m[3] }));
}

async function eurekaApps() {
  const { data } = await http(URLS.eureka, '/eureka/apps', { headers: { Accept: 'application/json' } });
  return [].concat(data?.applications?.application ?? []).map(app => ({
    name: app.name,
    instances: [].concat(app.instance ?? []).map(i => ({ id: i.instanceId, status: i.status })),
  }));
}

// ---------------------------------------------------------------- Khung kịch bản
async function pause() {
  if (AUTO) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // Không có listener thì readline chỉ tạm dừng khi bấm Ctrl+C; chuyển tiếp để dọn dẹp.
  rl.on('SIGINT', () => { rl.close(); process.emit('SIGINT'); });
  const answer = await new Promise(resolve => rl.question(col.bold('  Enter để chạy · q để dừng › '), resolve));
  rl.close();
  if (answer.trim().toLowerCase() === 'q') throw Object.assign(new Error('Dừng theo yêu cầu'), { stopped: true });
}

async function scenario(n, title, speaker, goal, run) {
  out(`\n${col.cyan('━'.repeat(WIDTH))}`);
  out(` ${col.bold(col.yellow(`KỊCH BẢN ${n}/9`))}  ${col.bold(title)}${col.dim(`   ⏱ ${elapsed()}`)}`);
  out(` ${col.dim('Trình bày')}  ${speaker}`);
  out(` ${col.dim('Mục tiêu ')}  ${goal}`);
  out(col.cyan('━'.repeat(WIDTH)));
  await pause();
  const begin = Date.now();
  try {
    await run();
    const seconds = ((Date.now() - begin) / 1000).toFixed(1);
    results.push({ n, title, ok: true, seconds });
    out(`\n  ${col.green(col.bold(`ĐẠT  kịch bản ${n}`))} ${col.dim(`(${seconds} giây)`)}`);
  } catch (error) {
    results.push({ n, title, ok: false, seconds: ((Date.now() - begin) / 1000).toFixed(1) });
    if (!error.stopped) out(`\n  ${col.red(col.bold('✘ KHÔNG ĐẠT'))} ${error.message}`);
    throw error;
  }
}

// ---------------------------------------------------------------- 9 kịch bản
const ctx = {};

async function scenario1() {
  act('Đọc danh sách service đã đăng ký trên Eureka (http://localhost:8761)');
  const apps = await eurekaApps();
  const missing = [];
  for (const name of REQUIRED_APPS) {
    const app = apps.find(a => a.name === name);
    const up = app ? app.instances.filter(i => i.status === 'UP').length : 0;
    field(name, up ? col.green(`${up} instance UP`) : col.red('chưa đăng ký'));
    if (!up) missing.push(name);
  }
  expect(!missing.length, `Đủ ${REQUIRED_APPS.length} service đã đăng ký và UP`, `Chưa đăng ký: ${missing.join(', ')}`);
  act('Gọi GET /ping qua API Gateway');
  const cid = uuid();
  const ping = await api('/ping', { cid });
  expect(ping.status === 200 && ping.data === 'UP', `Gateway trả "${ping.data}", X-Correlation-ID: ${ping.headers.get('x-correlation-id')}`, `Gateway trả HTTP ${ping.status}`);
  logHint(['api_gateway'], cid);
}

async function scenario2() {
  act(`Đăng ký tài khoản tài xế, tạo hồ sơ xe, bật nhận chuyến và gửi GPS tại điểm đón ${PICKUP.lat}, ${PICKUP.lng}`);
  ctx.driverA = await onlineDriver('Tài xế A', PICKUP);
  const info = await driverInfo(ctx.driverA);
  field('Tài xế A', ctx.driverA.userId);
  field('Biển số', info.licensePlate);
  expect(info.status === 'AVAILABLE', 'Trạng thái tài xế: AVAILABLE', `Trạng thái tài xế là ${info.status}`);
  act('Tìm tài xế trong bán kính 1 km quanh điểm đón (Redis GEO): GET /drivers/available');
  const nearby = await apiOk(`/drivers/available?lat=${PICKUP.lat}&lng=${PICKUP.lng}&radius=1`);
  expect(nearby.some(d => d.id === ctx.driverA.userId), `Tài xế A có trong kết quả tìm kiếm (${nearby.length} tài xế gần đó)`, 'Không tìm thấy tài xế A trong Redis GEO');
}

async function scenario3() {
  act('Đăng ký tài khoản hành khách A');
  ctx.riderA = await account('ROLE_PASSENGER', 'Khách A');
  field('Khách A', ctx.riderA.userId);
  act('Khách xem giá trước: POST /trips/estimate');
  const quote = await apiOk('/trips/estimate', { method: 'POST', actor: ctx.riderA, body: { pickup: PICKUP, destination: NEAR } });
  field('Quãng đường', `${quote.estimatedDistance} km (${quote.pricingVersion})`);
  field('Giá', vnd(quote.fareAmount));
  field('Giữ giá đến', quote.expiresAt);
  for (const reason of quote.breakdown.reasons) field(reason.label, reason.multiplier ? `×${String(reason.multiplier).replace('.', ',')}` : vnd(reason.amount));
  act('Khách đặt chuyến: POST /trips');
  ctx.trip1 = await apiOk('/trips', { method: 'POST', actor: ctx.riderA, body: { quoteId: quote.quoteId } });
  field('Mã chuyến', ctx.trip1.tripId);
  field('Correlation ID', ctx.trip1.sagaId);
  expect(ctx.trip1.status === 'REQUESTED', 'Chuyến được tạo với trạng thái REQUESTED', `Trạng thái chuyến là ${ctx.trip1.status}`);
  expect(Number(ctx.trip1.fare) === quote.fareAmount, `Giá do server tính và lưu: ${vnd(ctx.trip1.fare)}`, `Giá lưu ${ctx.trip1.fare} khác giá báo ${quote.fareAmount}`);
  const event = await waitFor('trip.requested được publish', async () => { const row = await outboxEvent('trip.requested', ctx.trip1.tripId); return row?.published_at && row; });
  pass(`Event trip.requested ${short(event.event_id)} ghi vào outbox cùng transaction và đã publish lên RabbitMQ`);
  logHint(['trip_service', 'matching_service'], ctx.trip1.sagaId);
}

async function scenario4() {
  act(`Matching nhận trip.requested, tìm tài xế gần nhất và giữ tài xế; chờ chuyến ${short(ctx.trip1.tripId)} có tài xế`);
  const begin = Date.now();
  const trip = await waitTrip(ctx.trip1, ctx.riderA, 'AWAITING_DRIVER');
  field('Thời gian ghép', `${Date.now() - begin} ms`);
  expect(trip.driverId === ctx.driverA.userId, `Chuyến AWAITING_DRIVER, ghép với Tài xế A (${short(trip.driverId)})`, `Chuyến ghép với tài xế khác: ${trip.driverId}`);
  const info = await driverInfo(ctx.driverA);
  expect(info.status === 'RESERVED', 'Tài xế A chuyển sang RESERVED cho chuyến này', `Tài xế A đang ${info.status}`);
  logHint(['matching_service', 'driver_service_1', 'driver_service_2'], ctx.trip1.sagaId);
}

async function scenario5() {
  act('Tài xế A nhận chuyến: POST /trips/{id}/accept');
  const started = await tripAction(ctx.trip1, 'accept', ctx.driverA);
  expect(started.status === 'IN_PROGRESS', 'Chuyến IN_PROGRESS', `Chuyến đang ${started.status}`);
  const onTrip = (await driverInfo(ctx.driverA)).status;
  expect(onTrip === 'ON_TRIP', 'Tài xế A ON_TRIP', `Tài xế A đang ${onTrip}`);
  act('Tài xế A hoàn thành chuyến: POST /trips/{id}/complete');
  const completed = await tripAction(ctx.trip1, 'complete', ctx.driverA);
  expect(completed.status === 'PAYMENT_PENDING', 'Chuyến PAYMENT_PENDING, Trip phát trip.completed cho Payment', `Chuyến đang ${completed.status}`);
  act('Chờ Saga thanh toán: Payment thu tiền → payment.succeeded → Trip xác nhận');
  await waitTrip(ctx.trip1, ctx.riderA, 'CONFIRMED');
  pass('Chuyến CONFIRMED');
  const payment = await apiOk(`/payments/trips/${ctx.trip1.tripId}`, { actor: ctx.riderA });
  expect(payment.status === 'SUCCESS' && Number(payment.amount) === Number(ctx.trip1.fare),
    `Payment ${short(payment.paymentId)}: SUCCESS, ${vnd(payment.amount)}`, `Payment ${payment.status}, ${payment.amount}`);
  await waitDriver(ctx.driverA, 'AVAILABLE');
  pass('Tài xế A trở lại AVAILABLE');
  const list = await waitFor('thông báo thanh toán cho khách', async () => {
    const items = await notificationsFor(ctx.riderA, ctx.trip1.tripId);
    return items.some(n => n.type === 'PAYMENT_SUCCEEDED') && items;
  });
  for (const n of list) field(n.type, n.content);
  pass('Notification đã gửi thông báo cho khách');
  logHint(['trip_service', 'payment_service', 'notification_service'], ctx.trip1.sagaId);
}

async function scenario6() {
  act('Tạo Tài xế B (AVAILABLE, đặt xa điểm đón để không bị ghép nhầm)');
  ctx.driverB = await onlineDriver('Tài xế B', { lat: round6(PICKUP.lat + 0.3), lng: PICKUP.lng });
  field('Tài xế B', ctx.driverB.userId);
  act('Thử giữ tài xế từ bên ngoài qua Gateway: POST /internal/drivers/{id}/reserve');
  const blocked = await api(`/internal/drivers/${ctx.driverB.userId}/reserve`, { method: 'POST', body: { tripId: uuid(), reservationId: uuid() } });
  expect(blocked.status === 403, 'Gateway chặn /internal/** với HTTP 403', `Gateway trả HTTP ${blocked.status}`);
  const second = await http(URLS.driver2, '/ping').then(r => r.status === 200, () => false);
  const targets = second ? [URLS.driver1, URLS.driver2] : [URLS.driver1, URLS.driver1];
  act(`Gửi đồng thời 2 yêu cầu giữ Tài xế B cho 2 chuyến khác nhau${second ? ' tới 2 instance Driver (8082, 18082)' : ' (chỉ có 1 instance Driver)'}`);
  const cid = uuid();
  const requests = targets.map(base => ({ base, tripId: uuid(), reservationId: uuid() }));
  const responses = await Promise.all(requests.map(r => http(r.base, `/internal/drivers/${ctx.driverB.userId}/reserve`,
    { method: 'POST', cid, body: { tripId: r.tripId, reservationId: r.reservationId } })));
  responses.forEach((r, i) => field(`Yêu cầu ${i + 1}`, `HTTP ${r.status === 200 ? col.green(r.status) : col.red(r.status)}  instance: ${(r.headers.get('x-handled-by-instance') || requests[i].base).split(',')[0].trim()}`));
  const statuses = responses.map(r => r.status).sort();
  expect(statuses[0] === 200 && statuses[1] === 409, 'Đúng 1 yêu cầu thắng (200), yêu cầu còn lại bị từ chối (409 Conflict)', `Kết quả ${statuses.join(', ')} thay vì 200 và 409`);
  const winner = requests[responses.findIndex(r => r.status === 200)];
  const info = await driverInfo(ctx.driverB);
  expect(info.status === 'RESERVED' && (info.currentTripId === winner.tripId || info.reservationId === winner.reservationId),`Tài xế B chỉ được giữ cho chuyến ${short(winner.tripId)}`, `Tài xế B: ${info.status}, chuyến ${info.currentTripId}`);
  await httpOk(URLS.driver1, `/internal/drivers/${ctx.driverB.userId}/release`, { method: 'POST', body: { tripId: winner.tripId } });
  await apiOk('/drivers/me/go-offline', { method: 'POST', actor: ctx.driverB });
  note('Đã giải phóng và cho Tài xế B offline để không ảnh hưởng các kịch bản sau');
  logHint(['driver_service_1', 'driver_service_2'], cid);
}

async function scenario7() {
  act('Khách B đặt chuyến; Tài xế A được ghép và nhận chuyến');
  ctx.riderB = await account('ROLE_PASSENGER', 'Khách B');
  ctx.trip2 = await bookTrip(ctx.riderB, NEAR);
  await waitTrip(ctx.trip2, ctx.riderB, 'AWAITING_DRIVER');
  await tripAction(ctx.trip2, 'accept', ctx.driverA);
  field('Mã chuyến', ctx.trip2.tripId);
  act('Sự cố: dừng container notification_service giữa luồng');
  compose('stop', 'notification_service');
  state.notificationStopped = true;
  expect(containerHealth('notification_service') !== 'healthy', 'notification_service đã dừng', 'notification_service vẫn chạy');
  act('Tài xế A hoàn thành chuyến trong lúc Notification đang dừng');
  await tripAction(ctx.trip2, 'complete', ctx.driverA);
  await waitTrip(ctx.trip2, ctx.riderB, 'CONFIRMED');
  pass('Thanh toán và xác nhận chuyến vẫn chạy: chuyến CONFIRMED (Notification dừng không chặn Saga)');
  const queue = await waitFor('thông báo chờ trong queue', async () => { const q = await queueInfo('notification-service.payment.succeeded'); return q.messages > 0 && q; });
  expect(queue.consumers === 0, `Queue ${queue.name}: ${queue.messages} message đang chờ, 0 consumer — không mất`, `Queue vẫn có ${queue.consumers} consumer`);
  logHint(['trip_service', 'payment_service'], ctx.trip2.sagaId);
}

async function scenario8() {
  act('Bật lỗi giả lập cho 3 lần gọi cổng thanh toán tiếp theo: POST :8085/internal/payments/faults?failNext=3');
  const dlqBefore = (await httpOk(URLS.payment, '/internal/payments/dlq')).messages;
  await httpOk(URLS.payment, '/internal/payments/faults?failNext=3', { method: 'POST' });
  state.faultsSet = true;
  const since = new Date(Date.now() - 1000).toISOString();
  act('Chạy một chuyến bình thường tới bước hoàn thành');
  const { trip: trip3 } = await rideToCompletion(ctx.riderA, NEAR);
  ctx.trip3 = trip3;
  field('Mã chuyến', trip3.tripId);
  await waitFor('message vào DLQ', async () => (await httpOk(URLS.payment, '/internal/payments/dlq')).messages > dlqBefore, 20000);
  const attempts = paymentLogs(trip3.sagaId, since, /^Nhận trip\.completed \(lần thử/);
  attempts.forEach((a, i) => {
    const gap = i ? `  (+${((a.at - attempts[i - 1].at) / 1000).toFixed(1)} giây)` : '';
    field(`Lần thử ${i + 1}`, `${a.time.slice(11)} UTC — lỗi giả lập${gap}`);
  });
  expect(attempts.length >= 3, `Payment thử lại 3 lần với backoff 1 giây, 2 giây`, `Chỉ thấy ${attempts.length} lần thử trong log Payment`);
  pass('Hết lượt thử: message vào DLQ payment-service.trip.completed.dlq, chưa thu tiền');
  expect((await getTrip(trip3, ctx.riderA)).status === 'PAYMENT_PENDING', 'Chuyến vẫn PAYMENT_PENDING, không mất', 'Chuyến đổi trạng thái bất thường');
  act('Sửa lỗi rồi xử lý lại DLQ: DELETE faults, POST :8085/internal/payments/dlq/replay');
  await httpOk(URLS.payment, '/internal/payments/faults', { method: 'DELETE' });
  state.faultsSet = false;
  const replay = await httpOk(URLS.payment, `/internal/payments/dlq/replay?max=${dlqBefore + 1}`, { method: 'POST' });
  await waitTrip(trip3, ctx.riderA, 'CONFIRMED');
  pass(`Đã replay ${replay.replayed} message; chuyến CONFIRMED`);

  act('Bù trừ Saga: chuyến dài có giá vượt hạn mức thanh toán giả lập');
  const quote = await apiOk('/trips/estimate', { method: 'POST', actor: ctx.riderA, body: { pickup: PICKUP, destination: FAR } });
  expect(quote.fareAmount > PAYMENT_MAX, `Giá ${vnd(quote.fareAmount)} > hạn mức ${vnd(PAYMENT_MAX)}`, `Giá ${quote.fareAmount} không vượt hạn mức ${PAYMENT_MAX}`);
  const { trip: trip4, driver } = await rideToCompletion(ctx.riderA, FAR);
  ctx.trip4 = trip4;
  field('Mã chuyến', trip4.tripId);
  await waitTrip(trip4, ctx.riderA, 'CANCELLED');
  const payment = await apiOk(`/payments/trips/${trip4.tripId}`, { actor: ctx.riderA });
  expect(payment.status === 'FAILED', `Payment FAILED (${payment.failureReason}) → Trip chạy bước bù trừ: chuyến CANCELLED`, `Payment ${payment.status}`);
  await waitDriver(driver, 'AVAILABLE');
  pass(`${driver.label} được giải phóng về AVAILABLE`);
  const compensated = await waitFor('trip.compensated được publish', async () => { const row = await outboxEvent('trip.compensated', trip4.tripId); return row?.published_at && row; });
  pass(`Trip phát trip.compensated ${short(compensated.event_id)} (cùng correlationId với payment.failed)`);
  logHint(['payment_service', 'trip_service'], trip4.sagaId);
}

async function scenario9() {
  act('Thông báo đang chờ trong các queue của Notification');
  let waiting = 0;
  for (const name of NOTIFICATION_QUEUES) {
    const q = await queueInfo(name);
    waiting += q.messages;
    if (q.messages) field(name.replace('notification-service.', ''), `${q.messages} message`);
  }
  pass(`Tổng ${waiting} message chờ xử lý`);
  act('Khởi động lại notification_service');
  compose('start', 'notification_service');
  await waitFor('notification_service healthy', async () => containerHealth('notification_service') === 'healthy', 150000, 2000);
  state.notificationStopped = false;
  pass('notification_service healthy, kết nối lại RabbitMQ');
  await waitFor('các queue được xử lý hết', async () => {
    for (const name of NOTIFICATION_QUEUES) if ((await queueInfo(name)).messages) return false;
    return true;
  }, 60000, 1000);
  pass('Đã xử lý hết message tồn trong queue');
  const forB = await waitFor('thông báo của chuyến bị gián đoạn', async () => { const items = await notificationsFor(ctx.riderB, ctx.trip2.tripId); return items.some(n => n.type === 'PAYMENT_SUCCEEDED') && items; });
  for (const n of forB) field(n.type, n.content);
  pass('Khách B nhận thông báo thanh toán của chuyến ở kịch bản 7 — xử lý bù sau khi service chạy lại');
  const forA = await waitFor('thông báo bù trừ', async () => { const items = await notificationsFor(ctx.riderA, ctx.trip4.tripId); return items.some(n => n.type === 'TRIP_COMPENSATED') && items; });
  for (const n of forA) field(n.type, n.content);
  pass('Khách A nhận thông báo thanh toán thất bại và chuyến bị hủy của kịch bản 8');

  act(`Chống trùng: gửi lại đúng event trip.completed của chuyến ${short(ctx.trip1.tripId)} (cùng eventId)`);
  const original = await outboxEvent('trip.completed', ctx.trip1.tripId);
  const envelope = original.envelope;
  const since = new Date(Date.now() - 1000).toISOString();
  const channel = await mq.createConfirmChannel();
  channel.publish('rideflow.events', envelope.eventType, Buffer.from(JSON.stringify(envelope)), {
    persistent: true, contentType: 'application/json', messageId: envelope.eventId, type: envelope.eventType,
    correlationId: envelope.correlationId, headers: { 'x-correlation-id': envelope.correlationId },
  });
  await channel.waitForConfirms();
  await channel.close();
  field('eventId', envelope.eventId);
  await waitFor('Payment bỏ qua event trùng', async () => paymentLogs(envelope.correlationId, since, /event trùng/).length > 0, 15000, 1000);
  pass('Payment nhận lại event, tra processed_events và bỏ qua: "Bỏ qua event trùng"');
  const payments = await httpOk(URLS.payment, `/internal/payments?tripId=${ctx.trip1.tripId}`);
  expect(payments.length === 1, 'Chuyến vẫn chỉ có 1 payment — khách không bị trừ tiền hai lần', `Chuyến có ${payments.length} payment`);
  logHint(['payment_service'], envelope.correlationId);
}

// ---------------------------------------------------------------- Dọn dẹp và tổng kết
let cleaned;
function cleanup() {
  cleaned ??= (async () => {
    const lines = [];
    if (state.notificationStopped) {
      try { compose('start', 'notification_service'); state.notificationStopped = false; lines.push('Đã bật lại notification_service'); }
      catch (error) { lines.push(`Không bật lại được notification_service: ${error.message}`); }
    }
    if (state.faultsSet) {
      await http(URLS.payment, '/internal/payments/faults', { method: 'DELETE' }).then(() => lines.push('Đã tắt lỗi giả lập của Payment'), () => {});
    }
    for (const driver of state.drivers) await api('/drivers/me/go-offline', { method: 'POST', actor: driver }).catch(() => {});
    if (state.drivers.length) lines.push(`Đã cho ${state.drivers.length} tài xế demo offline`);
    await Promise.allSettled([tripDb?.end(), mq?.close()]);
    if (lines.length) {
      out(`\n${col.dim('Dọn dẹp:')}`);
      lines.forEach(line => out(`  ${col.dim('·')} ${line}`));
    }
  })();
  return cleaned;
}

function summary() {
  out(`\n${col.bold('═'.repeat(WIDTH))}`);
  out(` ${col.bold('KẾT QUẢ DEMO')}`);
  out(col.bold('═'.repeat(WIDTH)));
  for (const r of results) out(`  ${r.ok ? col.green('✔') : col.red('✘')} ${String(r.n).padStart(2)}. ${r.title.padEnd(44)} ${col.dim(`${r.seconds} giây`)}`);
  const okCount = results.filter(r => r.ok).length;
  const verdict = okCount === 9 ? col.green(col.bold('ĐẠT CẢ 9 KỊCH BẢN')) : col.red(col.bold(`ĐẠT ${okCount}/9 KỊCH BẢN`));
  out(`\n  ${verdict}   ${col.dim(`tổng thời gian ${elapsed()}`)}\n`);
}

async function main() {
  out(col.bold(col.green('╔' + '═'.repeat(WIDTH - 2) + '╗')));
  const title = 'RIDE-HAILING MICROSERVICE · DEMO 9 KỊCH BẢN BẮT BUỘC';
  const left = Math.floor((WIDTH - 2 - title.length) / 2);
  out(col.bold(col.green(`║${' '.repeat(left)}${title}${' '.repeat(WIDTH - 2 - left - title.length)}║`)));
  out(col.bold(col.green('╚' + '═'.repeat(WIDTH - 2) + '╝')));
  out(col.dim(`  Gateway ${URLS.gateway} · điểm đón ${PICKUP.lat}, ${PICKUP.lng} · ${AUTO ? 'chế độ tự động' : 'chế độ tương tác'}`));

  const ready = await http(URLS.gateway, '/ping').then(r => r.status === 200, () => false);
  if (!ready) {
    out(`\n  ${col.red('✘')} Không gọi được Gateway tại ${URLS.gateway}. Khởi động hệ thống trước:`);
    out(`    docker compose -f deploy/docker-compose.yml --env-file .env --profile scale up -d --wait\n`);
    process.exitCode = 1;
    return;
  }
  tripDb = new Pool({ host: HOST, port: Number(env.TRIP_DB_PORT || 5435), user: env.TRIP_DB_USER || 'postgres', password: env.TRIP_DB_PASSWORD || 'postgres_password', database: env.TRIP_DB_NAME || 'trip_db' });
  mq = await amqp.connect({ hostname: HOST, port: Number(env.RABBITMQ_PORT || 5672), username: env.RABBITMQ_DEFAULT_USER || 'guest', password: env.RABBITMQ_DEFAULT_PASS || 'guest' });
  mq.on('error', () => {});
  process.once('SIGINT', async () => {
    out(`\n${col.yellow('Nhận Ctrl+C, đang dọn dẹp...')}`);
    await cleanup();
    summary();
    process.exit(130);
  });

  const A = 'Thành viên A';
  const B = 'Thành viên B';
  const C = 'Thành viên C';
  try {
    await scenario(1, 'Khởi động service', A, 'Mọi service đã đăng ký với Eureka, Gateway nhận request và gắn Correlation ID', scenario1);
    await scenario(2, 'Tài xế sẵn sàng', A, 'Tài xế bật nhận chuyến, vị trí GPS được lưu vào Redis GEO và tìm thấy được', scenario2);
    await scenario(3, 'Khách đặt chuyến', A, 'Server tính giá, lưu chuyến và ghi event trip.requested vào outbox cùng transaction', scenario3);
    await scenario(4, 'Ghép tài xế', B, 'Matching tìm tài xế gần nhất qua Redis GEO và giữ tài xế nguyên tử', scenario4);
    await scenario(5, 'Nhận và hoàn thành chuyến', B, 'Nhận → hoàn thành → Payment thu tiền → Trip xác nhận → Notification báo khách', scenario5);
    await scenario(6, 'Hai khách cùng giữ một tài xế', B, 'Hai yêu cầu đồng thời trên 2 instance: đúng một bên thắng, bên kia nhận 409', scenario6);
    await scenario(7, 'Dừng service giữa luồng', C, 'Notification dừng giữa chuyến: Saga vẫn chạy, thông báo nằm chờ trong queue', scenario7);
    await scenario(8, 'Retry, DLQ và bù trừ', C, 'Lỗi tạm thời được thử lại rồi vào DLQ và replay; thanh toán thất bại thì hủy chuyến, trả tài xế', scenario8);
    await scenario(9, 'Khởi động lại và xử lý tiếp', C, 'Notification chạy lại xử lý bù message tồn; event gửi lại không bị xử lý hai lần', scenario9);
  } catch (error) {
    if (!results.length || results.at(-1).ok) out(`\n  ${col.red('✘')} ${error.message}`);
    process.exitCode = 1;
  } finally {
    await cleanup();
    summary();
  }
}

main();
