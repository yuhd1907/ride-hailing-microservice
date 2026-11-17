'use strict';
// Xuất metrics dạng text của Prometheus tại GET /metrics, không cần thư viện ngoài.
// Dùng cùng tên metric với các service Java (http_server_requests_seconds, process_uptime_seconds)
// để một dashboard Grafana đọc được cả hai loại service.
const identity = require('./identity');
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const series = new Map();
const escape = value => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const labels = values => Object.entries({ application: identity.service, ...values }).map(([key, value]) => `${key}="${escape(value)}"`).join(',');
// Dùng mẫu route (/trips/:id) thay cho URL thật để số nhãn không tăng theo từng tripId.
function uriOf(req) { return req.route ? `${req.baseUrl || ''}${req.route.path}` : 'UNKNOWN'; }
function observe(method, uri, status, seconds) {
  const key = `${method} ${uri} ${status}`;
  let entry = series.get(key);
  if (!entry) series.set(key, entry = { method, uri, status, count: 0, sum: 0, buckets: BUCKETS.map(() => 0) });
  entry.count++;
  entry.sum += seconds;
  BUCKETS.forEach((limit, index) => { if (seconds <= limit) entry.buckets[index]++; });
}
function middleware(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => observe(req.method, uriOf(req), res.statusCode, Number(process.hrtime.bigint() - started) / 1e9));
  next();
}
function render() {
  const lines = ['# TYPE http_server_requests_seconds histogram'];
  for (const entry of series.values()) {
    const base = { method: entry.method, uri: entry.uri, status: entry.status, outcome: entry.status >= 500 ? 'SERVER_ERROR' : entry.status >= 400 ? 'CLIENT_ERROR' : 'SUCCESS' };
    entry.buckets.forEach((count, index) => lines.push(`http_server_requests_seconds_bucket{${labels({ ...base, le: BUCKETS[index] })}} ${count}`));
    lines.push(`http_server_requests_seconds_bucket{${labels({ ...base, le: '+Inf' })}} ${entry.count}`);
    lines.push(`http_server_requests_seconds_count{${labels(base)}} ${entry.count}`);
    lines.push(`http_server_requests_seconds_sum{${labels(base)}} ${entry.sum}`);
  }
  const memory = process.memoryUsage();
  lines.push('# TYPE process_uptime_seconds gauge', `process_uptime_seconds{${labels({})}} ${process.uptime()}`);
  lines.push('# TYPE process_resident_memory_bytes gauge', `process_resident_memory_bytes{${labels({})}} ${memory.rss}`);
  lines.push('# TYPE nodejs_heap_used_bytes gauge', `nodejs_heap_used_bytes{${labels({})}} ${memory.heapUsed}`);
  return `${lines.join('\n')}\n`;
}
function endpoint(req, res) { res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8').send(render()); }
module.exports = { middleware, endpoint, observe, render };
