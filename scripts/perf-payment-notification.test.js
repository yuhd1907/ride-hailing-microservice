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
