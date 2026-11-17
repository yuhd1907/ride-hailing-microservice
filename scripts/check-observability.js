'use strict';
// Chạy trên stack Compose thật (có --profile observability): kiểm tra Prometheus thu được metrics của
// mọi service, Loki gom được log của mọi container và dashboard Grafana có dữ liệu. Chỉ dùng Node built-in.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
const setting = (name, fallback) => env.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1].trim() || fallback;
const gateway = `http://127.0.0.1:${setting('GATEWAY_PORT', 8080)}`;
const prometheus = `http://127.0.0.1:${setting('PROMETHEUS_PORT', 9090)}`;
const grafana = `http://127.0.0.1:${setting('GRAFANA_PORT', 3000)}`;
const admin = { Authorization: `Basic ${Buffer.from(`${setting('GRAFANA_ADMIN_USER', 'admin')}:${setting('GRAFANA_ADMIN_PASSWORD', 'admin')}`).toString('base64')}` };
const SERVICES = ['api-gateway', 'driver-service', 'matching-service', 'notification-service', 'payment-service', 'trip-service', 'user-service'];
const CONTAINERS = ['api_gateway', 'driver_service_1', 'matching_service', 'notification_service', 'payment_service', 'trip_service', 'user_service'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uuid = () => crypto.randomUUID();
let passed = 0;
function pass(message) { passed++; console.log(`PASS ${passed}: ${message}`); }
async function json(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), ...options });
  const text = await response.text();
  assert.ok(response.ok, `${url}: ${response.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
async function waitFor(label, check, timeout = 120000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await check(); if (last) return last; } catch (error) { last = error.message; }
    await sleep(3000);
  }
  throw new Error(`Timeout: ${label} (${JSON.stringify(last)})`);
}
const promQuery = async expr => (await json(`${prometheus}/api/v1/query?query=${encodeURIComponent(expr)}`)).data.result;
// Loki không mở cổng ra host: truy vấn qua proxy datasource của Grafana, đúng đường dashboard dùng.
const loki = (apiPath, params) => json(`${grafana}/api/datasources/proxy/uid/loki/loki/api/v1/${apiPath}?${new URLSearchParams(params)}`, { headers: admin });
async function call(url, { method = 'GET', body, token, correlationId = uuid() } = {}) {
  const response = await fetch(gateway + url, { method, signal: AbortSignal.timeout(15000), headers: { 'X-Correlation-ID': correlationId, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await response.text();
  assert.ok(response.ok, `${method} ${url}: ${response.status} ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}
async function main() {
  console.log(`Observability run ${new Date().toISOString()}; prometheus=${prometheus}; grafana=${grafana}`);

  // --- Metrics: Prometheus tự tìm instance qua Eureka ---
  const targets = await waitFor('all scrape targets up', async () => {
    const active = (await json(`${prometheus}/api/v1/targets?state=active`)).data.activeTargets;
    const up = active.filter(target => target.health === 'up').map(target => target.labels.service).sort();
    return SERVICES.every(name => up.includes(name)) && active;
  }, 180000);
  pass(`Prometheus tìm qua Eureka và scrape được ${targets.length} instance: ${targets.map(t => `${t.labels.service}=${t.health}`).sort().join(', ')}`);

  // Tạo tải thật qua Gateway, gắn cùng một correlationId để lát nữa tìm trong log.
  const correlationId = uuid();
  const suffix = uuid().replaceAll('-', '').slice(0, 12);
  const account = { email: `obs-${suffix}@rideflow.test`, password: 'Test@123456', fullName: 'Obs Rider', phone: `09${String(crypto.randomInt(0, 100000000)).padStart(8, '0')}`, role: 'ROLE_PASSENGER' };
  await call('/auth/register', { method: 'POST', body: account, correlationId });
  const { token } = await call('/auth/login', { method: 'POST', body: { email: account.email, password: account.password }, correlationId });
  for (const route of ['/users/ping', '/drivers/ping', '/trips/ping', '/matching/ping', '/payments/ping', '/notifications/ping']) for (let i = 0; i < 5; i++) await call(route, { token, correlationId });

  const counted = await waitFor('request metrics for every service', async () => {
    const result = await promQuery('sum by (service) (http_server_requests_seconds_count{uri!~"/metrics|UNKNOWN"})');
    return SERVICES.every(name => result.some(row => row.metric.service === name && Number(row.value[1]) > 0)) && result;
  });
  pass(`Metric request của cả 7 service (Java + Node) cùng tên http_server_requests_seconds: ${counted.map(row => `${row.metric.service}=${row.value[1]}`).sort().join(', ')}`);

  const breakers = await promQuery('sum by (name) (resilience4j_circuitbreaker_state{state="closed"})');
  assert.equal(breakers.length, 6);
  assert.ok(breakers.every(row => row.value[1] === '1'), JSON.stringify(breakers));
  pass(`Trạng thái circuit breaker có trong metrics: ${breakers.map(row => row.metric.name).sort().join(', ')} đều CLOSED`);

  // --- Dashboard Grafana ---
  assert.equal((await json(`${grafana}/api/health`)).database, 'ok');
  const sources = await json(`${grafana}/api/datasources`, { headers: admin });
  assert.deepEqual(sources.map(source => source.type).sort(), ['loki', 'prometheus', 'zipkin']);
  const { dashboard } = await json(`${grafana}/api/dashboards/uid/rideflow-overview`); // không gửi đăng nhập: quyền xem ẩn danh
  pass(`Grafana chạy, 3 datasource (${sources.map(s => s.name).join(', ')}), dashboard "${dashboard.title}" xem được không cần đăng nhập, ${dashboard.panels.length} panel`);
  const empty = [];
  for (const panel of dashboard.panels.filter(p => p.datasource.type === 'prometheus')) for (const target of panel.targets) {
    const rows = await waitFor(`data for panel ${panel.title}`, async () => { const result = await promQuery(target.expr); return (result.length > 0 || /5\.\./.test(target.expr)) && result; });
    if (!rows.length) empty.push(panel.title);
  }
  pass(`Mọi câu truy vấn Prometheus trên dashboard đều hợp lệ và có dữ liệu${empty.length ? ` (trừ "${empty.join('", "')}" vì chưa có lỗi 5xx nào)` : ''}`);

  // --- Log tập trung: Loki ---
  const labels = await waitFor('loki has logs from every container', async () => {
    const { data } = await loki('label/service/values', {});
    return CONTAINERS.every(name => data.includes(name)) && data;
  });
  pass(`Loki đang gom log của ${labels.length} container: ${labels.sort().join(', ')}`);
  const range = { start: String((Date.now() - 15 * 60 * 1000) * 1e6), end: String((Date.now() + 60 * 1000) * 1e6), limit: '500' };
  const streams = await waitFor('logs by correlationId', async () => {
    const { data } = await loki('query_range', { ...range, query: `{service=~".+"} |= "${correlationId}"` });
    const found = [...new Set(data.result.map(stream => stream.stream.service))];
    return ['user_service', 'trip_service', 'matching_service', 'payment_service', 'notification_service', 'driver_service_1'].every(name => found.includes(name)) && data.result;
  });
  const lines = streams.reduce((sum, stream) => sum + stream.values.length, 0);
  pass(`Một truy vấn theo correlationId=${correlationId} ra ${lines} dòng log của ${[...new Set(streams.map(s => s.stream.service))].sort().join(', ')}`);
  const sample = JSON.parse(streams.find(stream => stream.stream.service === 'trip_service').values[0][1]);
  console.log(`      vd: ${JSON.stringify(sample)}`);
  const levels = (await loki('label/level/values', {})).data;
  assert.ok(levels.includes('info'), `nhãn level: ${levels}`);
  pass(`Trường level trong log JSON được tách thành nhãn để lọc: ${levels.join(', ')}`);
  console.log(`RESULT: ${passed} observability checks passed on the real stack. Mở ${grafana} để xem dashboard.`);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
