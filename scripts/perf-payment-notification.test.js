'use strict';
// Kiểm thử các hàm thuần của thí nghiệm hiệu năng Payment → Notification.
// Không cần Docker: chạy `node --test scripts/perf-payment-notification.test.js`.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const stats = require('./perf/stats');

test('percentile dùng nearest-rank và không sửa mảng đầu vào', () => {
  const values = Array.from({ length: 100 }, (_, i) => 100 - i);
  assert.equal(stats.percentile(values, 50), 50);
  assert.equal(stats.percentile(values, 95), 95);
  assert.equal(stats.percentile([5], 95), 5);
  assert.equal(stats.percentile([3, 1, 2], 50), 2);
  assert.equal(values[0], 100);
  assert.throws(() => stats.percentile([], 50));
});

test('pickClockOffset chọn mẫu có thời gian khứ hồi ngắn nhất', () => {
  const result = stats.pickClockOffset([
    { hostBefore: 0, hostAfter: 40, dbTime: 1030 },
    { hostBefore: 100, hostAfter: 104, dbTime: 1102 },
  ]);
  assert.deepEqual(result, { offsetMs: 1000, rttMs: 4 });
});

const samples = [
  { sentAt: 0, paymentAt: 1100, publishedAt: 1600, notifiedAt: 1700 },
  { sentAt: 10, paymentAt: 1120, publishedAt: 1600, notifiedAt: 1710 },
  { sentAt: 20, paymentAt: 1140, publishedAt: 1600, notifiedAt: 1720 },
  { sentAt: 30, paymentAt: 1160, publishedAt: 1600, notifiedAt: 1800 },
];
const runInput = { consumers: 1, events: 4, run: 1, startedAt: '2026-11-17T00:00:00.000Z', clockOffsetMs: 1000, clockRttMs: 2, samples };

test('summarizeRun hiệu chỉnh đồng hồ và tách chặng', () => {
  const s = stats.summarizeRun(runInput);
  assert.deepEqual(Object.keys(s), ['consumers', 'events', 'run', 'startedAt', 'clockOffsetMs', 'clockRttMs', 'throughputEps', 'p50Ms', 'p95Ms', 'maxMs', 'paymentThroughputEps', 'paymentP50Ms', 'paymentP95Ms', 'relayP50Ms', 'relayP95Ms', 'notificationP50Ms', 'notificationP95Ms']);
  assert.equal(s.throughputEps, 5);
  assert.equal(s.p50Ms, 700);
  assert.equal(s.p95Ms, 770);
  assert.equal(s.maxMs, 770);
  assert.equal(s.paymentThroughputEps, 25);
  assert.equal(s.paymentP50Ms, 110);
  assert.equal(s.paymentP95Ms, 130);
  assert.equal(s.relayP50Ms, 460);
  assert.equal(s.relayP95Ms, 500);
  assert.equal(s.notificationP50Ms, 110);
  assert.equal(s.notificationP95Ms, 200);
});

test('summarizeRun từ chối lượt thiếu event hoặc thiếu mốc', () => {
  assert.throws(() => stats.summarizeRun({ ...runInput, events: 5 }), /thiếu mốc thời gian/);
  const broken = samples.map((x, i) => (i === 2 ? { ...x, notifiedAt: null } : x));
  assert.throws(() => stats.summarizeRun({ ...runInput, samples: broken }), /thiếu mốc thời gian/);
});

test('aggregate gom theo cấu hình, lấy trung bình và khoảng min-max', () => {
  const base = stats.summarizeRun(runInput);
  const groups = stats.aggregate([
    { ...base, consumers: 3, throughputEps: 40 },
    { ...base, run: 1, throughputEps: 10, maxMs: 900 },
    { ...base, run: 2, throughputEps: 20, maxMs: 800 },
  ]);
  assert.deepEqual(groups.map(g => [g.consumers, g.events, g.runs]), [[1, 4, 2], [3, 4, 1]]);
  assert.deepEqual(groups[0].throughputEps, { mean: 15, min: 10, max: 20 });
  assert.equal(groups[0].maxMs, 900);
  assert.equal(groups[0].relayP95Ms, 500);
});

const checks = require('./perf/checks');
const healthy = checks.REQUIRED_CONTAINERS.map(name => ({ name, health: 'healthy' }));
const emptyQueues = [checks.QUEUES.payment, checks.QUEUES.notification, ...checks.QUEUES.trip].map(name => ({ name, exists: true, messages: 0 }));

test('preflightProblems chấp nhận hệ thống sạch', () => {
  assert.deepEqual(checks.preflightProblems({ containers: healthy, queues: emptyQueues, pendingOutbox: 0 }), []);
});

test('preflightProblems báo container, queue tồn đọng và outbox', () => {
  const problems = checks.preflightProblems({
    containers: healthy.map(c => (c.name === 'payment_service' ? { ...c, health: 'starting' } : c)),
    queues: emptyQueues.map(q => (q.name === 'trip-service.payment.failed' ? { ...q, messages: 7 } : q)),
    pendingOutbox: 3,
  });
  assert.equal(problems.length, 3);
  assert.ok(problems.some(p => p.includes('payment_service')));
  assert.ok(problems.some(p => p.includes('trip-service.payment.failed')));
  assert.ok(problems.some(p => p.includes('outbox')));
});

test('preflightProblems báo thiếu queue của Payment', () => {
  const queues = emptyQueues.map(q => (q.name === checks.QUEUES.payment ? { ...q, exists: false } : q));
  assert.ok(checks.preflightProblems({ containers: healthy, queues, pendingOutbox: 0 }).some(p => p.includes(checks.QUEUES.payment)));
});

test('consumerProblems phát hiện biến số consumer không có tác dụng', () => {
  assert.deepEqual(checks.consumerProblems(1, 1), []);
  const [problem] = checks.consumerProblems(3, 1);
  assert.match(problem, /3/);
  assert.match(problem, /1/);
});

test('runProblems báo payment không SUCCESS, thiếu thông báo và DLQ tăng', () => {
  const dlq = { 'payment-service.trip.completed.dlq': 0, 'notification-service.payment.succeeded.dlq': 0 };
  assert.deepEqual(checks.runProblems({ expected: 100, successCount: 100, notifiedCount: 100, dlqBefore: dlq, dlqAfter: dlq }), []);
  const problems = checks.runProblems({ expected: 100, successCount: 99, notifiedCount: 98, dlqBefore: dlq, dlqAfter: { ...dlq, 'payment-service.trip.completed.dlq': 1 } });
  assert.equal(problems.length, 3);
  assert.ok(problems.some(p => p.includes('SUCCESS')));
  assert.ok(problems.some(p => p.includes('thông báo')));
  assert.ok(problems.some(p => p.includes('payment-service.trip.completed.dlq')));
});

test('waitFor trả về khi điều kiện đạt và báo lỗi khi quá hạn', async () => {
  let calls = 0;
  const waits = [];
  await checks.waitFor(async () => ++calls === 3, { label: 'x', timeoutMs: 1000, intervalMs: 50, sleep: async ms => waits.push(ms) });
  assert.equal(calls, 3);
  assert.deepEqual(waits, [50, 50]);
  let clock = 0;
  await assert.rejects(
    checks.waitFor(async () => false, { label: 'thông báo của lượt', timeoutMs: 120000, now: () => clock, sleep: async () => { clock += 60000; } }),
    /Quá thời gian chờ.*thông báo của lượt/,
  );
});

const report = require('./perf/report');
const oneRun = stats.summarizeRun(runInput);
const groupsForReport = stats.aggregate([oneRun, { ...oneRun, consumers: 3 }]);

test('toCsv ghi mỗi lượt một dòng theo thứ tự field của RunSummary', () => {
  const csv = report.toCsv([oneRun, { ...oneRun, run: 2 }]);
  const lines = csv.split('\n');
  assert.equal(lines[0], Object.keys(oneRun).join(','));
  assert.equal(lines.length, 4);
  assert.equal(lines[3], '');
  assert.match(lines[1], /^1,4,1,2026-11-17T00:00:00.000Z,1000,2,5,700,770,770,25,/);
});

test('barChartSvg vẽ một cột cho mỗi cấu hình và escape chữ', () => {
  const svg = report.barChartSvg({
    title: 'A & <B>', xLabel: 'Số event mỗi lượt', yLabel: 'ms', categories: ['100', '500', '1000'],
    series: [1, 3].map(c => ({ name: `${c} consumer`, values: [1, 2, 3].map(v => ({ mean: v, min: v - 0.5, max: v + 0.5 })) })),
  });
  assert.ok(svg.startsWith('<svg'));
  assert.equal(svg.match(/class="bar"/g).length, 6);
  assert.ok(svg.includes('A &amp; &lt;B&gt;'));
  assert.ok(svg.includes('1 consumer') && svg.includes('3 consumer'));
  assert.ok(svg.includes('Số event mỗi lượt'));
});

test('chartsFor sinh hai biểu đồ đúng tiêu đề', () => {
  const charts = report.chartsFor(groupsForReport);
  assert.ok(charts.throughput.includes('Thông lượng đầu-cuối Payment → Notification'));
  assert.ok(charts.latencyP95.includes('Độ trễ đầu-cuối p95'));
});

test('resultsMarkdown có hai bảng, một dòng mỗi cấu hình và hai biểu đồ', () => {
  const md = report.resultsMarkdown(groupsForReport, { generatedAt: '2026-11-17T00:00:00Z', commit: 'abc1234', runsPerConfig: 1 });
  assert.ok(md.includes('File này do script sinh tự động'));
  assert.ok(md.includes('| Consumer | Số event | Số lượt | Thông lượng (event/s) | p50 (ms) | p95 (ms) | max (ms) |'));
  assert.ok(md.includes('| Consumer | Số event | Payment (event/s) | Payment p50 / p95 (ms) | Chờ relay p50 / p95 (ms) | Notification p50 / p95 (ms) |'));
  assert.ok(md.includes('| 1 | 4 | 1 | 5.0 (5.0–5.0) | 700 (700–700) | 770 (770–770) | 770 |'));
  assert.ok(md.includes('![Thông lượng](throughput.svg)'));
  assert.ok(md.includes('![Độ trễ p95](latency-p95.svg)'));
});

const { runExperiment, once } = require('./perf-payment-notification');

function fakeDeps(overrides = {}) {
  const calls = [];
  const deps = {
    preflight: async () => [],
    stopTrip: async () => { calls.push('stopTrip'); },
    setConsumers: async c => { calls.push(`set:${c}`); return c; },
    measureRun: async ({ consumers, events, run }) => { calls.push(`run:${consumers}:${events}:${run}`); return { consumers, events, run }; },
    restore: async () => { calls.push('restore'); },
    log: () => {},
    ...overrides,
  };
  return { deps, calls };
}
const options = { consumers: [1, 3], sizes: [100, 500], runs: 2, warmup: 200, timeoutMs: 120000 };

test('runExperiment chạy theo nhóm consumer, bỏ lượt khởi động và khôi phục một lần', async () => {
  const { deps, calls } = fakeDeps();
  const results = await runExperiment(options, deps);
  assert.deepEqual(calls, ['stopTrip',
    'set:1', 'run:1:200:0', 'run:1:100:1', 'run:1:100:2', 'run:1:500:1', 'run:1:500:2',
    'set:3', 'run:3:200:0', 'run:3:100:1', 'run:3:100:2', 'run:3:500:1', 'run:3:500:2',
    'restore']);
  assert.equal(results.length, 8);
  assert.ok(results.every(r => r.run > 0));
});

test('runExperiment: preflight lỗi thì không đổi gì', async () => {
  const { deps, calls } = fakeDeps({ preflight: async () => ['queue trip-service.payment.failed còn 7 message'] });
  await assert.rejects(runExperiment(options, deps), /trip-service\.payment\.failed/);
  assert.deepEqual(calls, []);
});

test('runExperiment: lỗi giữa chừng vẫn khôi phục', async () => {
  const { deps, calls } = fakeDeps({ measureRun: async ({ events }) => { if (events === 500) throw new Error('Quá thời gian chờ'); return {}; } });
  await assert.rejects(runExperiment(options, deps), /Quá thời gian chờ/);
  assert.equal(calls.filter(c => c === 'restore').length, 1);
  assert.equal(calls.at(-1), 'restore');
});

test('runExperiment: sai số consumer thì dừng và khôi phục', async () => {
  const { deps, calls } = fakeDeps({ setConsumers: async () => 3 });
  await assert.rejects(runExperiment(options, deps), /consumer/);
  assert.ok(!calls.some(c => c.startsWith('run:')));
  assert.equal(calls.at(-1), 'restore');
});

test('once chỉ chạy hàm một lần', async () => {
  let n = 0;
  const f = once(async () => ++n);
  await Promise.all([f(), f()]);
  await f();
  assert.equal(n, 1);
});
