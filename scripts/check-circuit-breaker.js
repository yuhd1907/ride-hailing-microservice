'use strict';
// Chạy trên stack Compose thật: làm treo rồi dừng hẳn Driver Service, đo cách Gateway phản ứng.
// Chỉ dùng Node built-in; tự start/unpause lại service nếu script lỗi giữa chừng.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
const gateway = `http://127.0.0.1:${env.match(/^GATEWAY_PORT=(\d+)/m)?.[1] || 8080}`;
const SERVICE = 'driver_service_1', BREAKER = 'driver-service';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const compose = (...args) => execFileSync('docker', ['compose', '-f', 'deploy/docker-compose.yml', '--env-file', '.env', ...args], { cwd: root, timeout: 120000, stdio: 'pipe' });
let passed = 0, cleanup = null;
function pass(message) { passed++; console.log(`PASS ${passed}: ${message}`); }
async function ping(route = '/drivers/ping') {
  const started = Date.now();
  const response = await fetch(gateway + route, { signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, ms: Date.now() - started, body };
}
async function breaker(name = BREAKER) {
  const response = await fetch(`${gateway}/actuator/circuitbreakers`, { signal: AbortSignal.timeout(5000) });
  return (await response.json()).circuitBreakers[name];
}
async function waitFor(label, check, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await sleep(1000);
  }
  throw new Error(`Timeout: ${label}`);
}
const line = results => results.map(r => `${r.status}/${r.ms}ms`).join(', ');
async function healthy(label) {
  // Gọi liên tiếp để cửa sổ trượt (10 lần gọi) chỉ còn lần gọi thành công.
  const results = [];
  for (let i = 0; i < 10; i++) results.push(await ping());
  assert.ok(results.every(r => r.status === 200 && r.body === 'UP'), line(results));
  const state = await breaker();
  assert.equal(state.state, 'CLOSED');
  pass(`${label}: 10/10 lần gọi 200, breaker CLOSED, failureRate=${state.failureRate}`);
}
async function failFast(label) {
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await ping());
  assert.ok(results.every(r => r.status === 503 && r.body.circuitState === 'OPEN' && r.ms < 1000), line(results));
  pass(`${label}: breaker OPEN, 5 lần gọi tiếp đều 503 ngay: ${line(results)}`);
  console.log(`      body: ${JSON.stringify(results[0].body)}`);
}
async function recover(label, since) {
  const first = await waitFor('gateway routes to driver-service again', async () => { const r = await ping(); return r.status === 200 && r; }, 180000);
  const reopened = Date.now() - since;
  await waitFor('breaker closed', async () => { await ping(); return (await breaker()).state === 'CLOSED'; }, 30000);
  pass(`${label}: không thao tác gì trên Gateway, lần gọi 200 đầu tiên sau ${Math.round(reopened / 1000)}s (${first.ms}ms), breaker tự về CLOSED`);
}
async function main() {
  console.log(`Circuit breaker run ${new Date().toISOString()}; gateway=${gateway}; nạn nhân=${SERVICE}`);
  await waitFor('driver-service reachable', async () => (await ping()).status === 200, 120000);
  await healthy('Ban đầu');

  // --- Kịch bản 1: service treo (container bị pause, vẫn còn đăng ký Eureka) ---
  compose('pause', SERVICE); cleanup = ['unpause', SERVICE];
  const hung = await Promise.all(Array.from({ length: 5 }, () => ping()));
  assert.ok(hung.every(r => r.status === 504 && r.ms >= 4500), line(hung));
  pass(`Service treo, breaker còn CLOSED: mỗi request phải chờ hết timeout 5s rồi nhận 504: ${line(hung)}`);
  assert.equal((await breaker()).state, 'OPEN');
  await failFast('Service vẫn treo');
  const others = await ping('/users/ping');
  assert.equal(others.status, 200);
  assert.equal((await breaker('user-service')).state, 'CLOSED');
  pass(`Breaker tách theo service: /users/ping vẫn 200 (${others.ms}ms), breaker user-service CLOSED`);
  const health = await fetch(`${gateway}/actuator/health`, { signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200);
  pass('Gateway vẫn healthy (/actuator/health 200) khi một breaker đang OPEN');
  let since = Date.now();
  compose('unpause', SERVICE); cleanup = null;
  await recover('Service hết treo', since);
  await healthy('Sau khi hết treo');

  // --- Kịch bản 2: dừng hẳn service (docker compose stop) rồi start lại ---
  compose('stop', SERVICE); cleanup = ['start', SERVICE];
  const stopped = [];
  await waitFor('breaker opens after stop', async () => { stopped.push(await ping()); return (await breaker()).state === 'OPEN'; }, 60000);
  const failures = stopped.filter(r => r.status !== 200);
  assert.ok(failures.length >= 5 && failures.every(r => r.status >= 500), line(stopped));
  pass(`Service dừng: ${failures.length} lần gọi lỗi liên tiếp làm breaker OPEN: ${line(failures)}`);
  await failFast('Service đã dừng');
  since = Date.now();
  compose('start', SERVICE); cleanup = null;
  await recover('Service chạy lại', since);
  await healthy('Sau khi chạy lại');
  console.log(`RESULT: ${passed} circuit-breaker checks passed on the real stack.`);
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(() => {
  if (cleanup) { try { compose(...cleanup); } catch (error) { console.error(error.message); } }
});
