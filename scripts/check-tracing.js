'use strict';
// Chạy trên stack Compose thật: gửi request qua Gateway rồi hỏi Zipkin xem trace có nối đúng các service không.
// Chỉ dùng Node built-in. Tạo user/tài xế/chuyến riêng cho mỗi lần chạy.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const env = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
const port = (name, fallback) => env.match(new RegExp(`^${name}=(\\d+)`, 'm'))?.[1] || fallback;
const gateway = `http://127.0.0.1:${port('GATEWAY_PORT', 8080)}`;
const zipkin = `http://127.0.0.1:${port('ZIPKIN_PORT', 9411)}`;
const TAG = 'correlationId';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uuid = () => crypto.randomUUID();
let passed = 0;
function pass(message) { passed++; console.log(`PASS ${passed}: ${message}`); }
async function call(url, { method = 'GET', body, token, correlationId = uuid() } = {}) {
  const response = await fetch(gateway + url, { method, signal: AbortSignal.timeout(15000), headers: { 'X-Correlation-ID': correlationId, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  assert.ok(response.ok, `${method} ${url}: ${response.status} ${text}`);
  return data;
}
async function waitFor(label, check, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(1000);
  }
  throw new Error(`Timeout: ${label}`);
}
// Mọi trace có ít nhất một span mang tag X-Correlation-ID = correlationId.
async function tracesFor(correlationId) {
  const query = new URLSearchParams({ annotationQuery: `${TAG}=${correlationId}`, lookback: String(15 * 60 * 1000), limit: '50' });
  const response = await fetch(`${zipkin}/api/v2/traces?${query}`, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  return response.json();
}
const services = traces => [...new Set(traces.flat().map(span => span.localEndpoint?.serviceName))].sort();
function describe(trace) {
  const byId = new Map(trace.map(span => [span.id, span]));
  const depth = span => { let d = 0; for (let s = span; s.parentId && byId.has(s.parentId); s = byId.get(s.parentId)) d++; return d; };
  return [...trace].sort((a, b) => a.timestamp - b.timestamp).map(span => `      ${'  '.repeat(depth(span))}${span.localEndpoint?.serviceName} | ${span.kind || 'LOCAL'} | ${span.name} | ${(span.duration / 1000).toFixed(1)}ms`).join('\n');
}
async function user(role) {
  const suffix = uuid().replaceAll('-', '').slice(0, 12);
  const account = { email: `trace-${suffix}@rideflow.test`, password: 'Test@123456', fullName: `Trace ${role}`, phone: `09${String(crypto.randomInt(0, 100000000)).padStart(8, '0')}`, role };
  await call('/auth/register', { method: 'POST', body: account });
  return { account, ...(await call('/auth/login', { method: 'POST', body: { email: account.email, password: account.password } })) };
}
async function main() {
  console.log(`Tracing run ${new Date().toISOString()}; gateway=${gateway}; zipkin=${zipkin}`);
  await waitFor('zipkin up', async () => { try { return (await fetch(`${zipkin}/health`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } });

  // --- 1. Một request HTTP đi qua 2 service phải là MỘT trace ---
  const pingId = uuid();
  await call('/drivers/ping', { correlationId: pingId });
  const [pingTrace] = await waitFor('trace of /drivers/ping', async () => { const traces = await tracesFor(pingId); return traces.some(t => services([t]).length >= 2) && traces; });
  assert.deepEqual(services([pingTrace]), ['api-gateway', 'driver-service']);
  assert.equal(new Set(pingTrace.map(span => span.traceId)).size, 1);
  const serverSpan = pingTrace.find(span => span.localEndpoint.serviceName === 'driver-service' && span.kind === 'SERVER');
  const parent = pingTrace.find(span => span.id === serverSpan.parentId || (span.id === serverSpan.id && span.kind === 'CLIENT'));
  assert.equal(parent?.localEndpoint.serviceName, 'api-gateway', 'span của driver-service phải là con của span Gateway');
  pass(`GET /drivers/ping: 1 trace (traceId=${pingTrace[0].traceId}) gồm ${pingTrace.length} span của api-gateway -> driver-service, đúng quan hệ cha-con`);
  console.log(describe(pingTrace));

  // --- 2. Đăng nhập: Gateway -> User Service ---
  const loginId = uuid();
  const rider = await user('ROLE_PASSENGER');
  await call('/auth/login', { method: 'POST', correlationId: loginId, body: { email: rider.account.email, password: rider.account.password } });
  const [loginTrace] = await waitFor('trace of login', async () => { const traces = await tracesFor(loginId); return traces.some(t => services([t]).length >= 2) && traces; });
  assert.deepEqual(services([loginTrace]), ['api-gateway', 'user-service']);
  pass(`POST /auth/login: 1 trace gồm ${loginTrace.length} span của api-gateway -> user-service`);

  // --- 3. Healthcheck không tạo trace nhiễu ---
  await fetch(`${gateway}/actuator/health`, { signal: AbortSignal.timeout(5000) });
  await sleep(3000);
  const names = await (await fetch(`${zipkin}/api/v2/spans?serviceName=api-gateway`)).json();
  assert.ok(!names.some(name => name.includes('actuator')), `không được có span actuator: ${names}`);
  pass(`Request /actuator không tạo span (tên span của api-gateway: ${names.join(', ')})`);

  // --- 4. Cả một chuyến đi: tìm theo correlationId ra span của mọi service Java liên quan ---
  const pickup = { lat: 12 + crypto.randomInt(0, 1000000) / 1000000, lng: 100 + crypto.randomInt(0, 1000000) / 1000000 };
  const driver = await user('ROLE_DRIVER');
  await call('/drivers', { method: 'POST', token: driver.token, body: { licensePlate: `TRC-${uuid().slice(0, 8)}`, vehicleType: 'MOTORCYCLE' } });
  await call('/drivers/me/go-online', { method: 'POST', token: driver.token });
  await call('/drivers/me/location', { method: 'POST', token: driver.token, body: { latitude: pickup.lat, longitude: pickup.lng } });
  const tripId = uuid();
  const trip = await call('/trips', { method: 'POST', token: rider.token, correlationId: tripId, body: { riderId: rider.userId, pickup, destination: { lat: pickup.lat + 0.01, lng: pickup.lng + 0.01 }, estimatedDistance: 3, fareAmount: 125000 } });
  const status = wanted => waitFor(`trip ${wanted}`, async () => (await call(`/trips/${trip.tripId}`, { token: rider.token })).status === wanted);
  await status('AWAITING_DRIVER');
  await call(`/trips/${trip.tripId}/start`, { method: 'POST', token: driver.token });
  await call(`/trips/${trip.tripId}/complete`, { method: 'POST', token: driver.token, body: { fareAmount: 125000 } });
  await status('CONFIRMED');
  const expected = ['api-gateway', 'driver-service', 'notification-service', 'payment-service'];
  const tripTraces = await waitFor('spans of the whole trip', async () => { const traces = await tracesFor(tripId); return expected.every(name => services(traces).includes(name)) && traces; }, 90000);
  pass(`Chuyến ${trip.tripId}: tìm ${TAG}=${tripId} ra ${tripTraces.length} trace, ${tripTraces.flat().length} span của ${services(tripTraces).join(', ')}`);
  const messaging = tripTraces.flat().filter(span => ['CONSUMER', 'PRODUCER'].includes(span.kind));
  assert.ok(messaging.some(span => span.localEndpoint.serviceName === 'payment-service' && span.kind === 'CONSUMER'));
  assert.ok(messaging.some(span => span.localEndpoint.serviceName === 'notification-service' && span.kind === 'CONSUMER'));
  pass(`Luồng bất đồng bộ qua RabbitMQ cũng có span: ${[...new Set(messaging.map(span => `${span.localEndpoint.serviceName} ${span.kind} "${span.name}"`))].join('; ')}`);
  for (const trace of tripTraces.filter(t => t.some(span => span.kind === 'CONSUMER')).slice(0, 2)) console.log(describe(trace));

  await call('/drivers/me/go-offline', { method: 'POST', token: driver.token });
  const all = await (await fetch(`${zipkin}/api/v2/services`)).json();
  console.log(`Zipkin đang có trace của: ${all.join(', ')}`);
  console.log(`RESULT: ${passed} tracing checks passed on the real stack. Xem giao diện tại ${zipkin}`);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
