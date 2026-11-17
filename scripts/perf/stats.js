'use strict';
// Thống kê cho thí nghiệm hiệu năng Payment → Notification (spec mục 6.4, 6.5).
// Mọi mốc thời gian là mili giây epoch. sentAt theo đồng hồ host, các mốc còn lại
// theo đồng hồ database/container; clockOffsetMs = giờ database - giờ host.

const STAGE_FIELDS = ['sentAt', 'paymentAt', 'publishedAt', 'notifiedAt'];

// Nearest-rank: phần tử thứ ceil(p/100 * n) của mảng đã sắp xếp tăng dần.
function percentile(values, p) {
  if (!values.length) throw new Error('Không tính được percentile của mảng rỗng');
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

// Chọn mẫu có thời gian khứ hồi ngắn nhất, coi giờ database ứng với điểm giữa lần hỏi.
function pickClockOffset(samples) {
  if (!samples.length) throw new Error('Cần ít nhất một mẫu đồng hồ');
  const best = samples.reduce((a, b) => (b.hostAfter - b.hostBefore < a.hostAfter - a.hostBefore ? b : a));
  return { offsetMs: best.dbTime - (best.hostBefore + best.hostAfter) / 2, rttMs: best.hostAfter - best.hostBefore };
}

function summarizeRun({ consumers, events, run, startedAt, clockOffsetMs, clockRttMs, samples }) {
  const complete = samples.length === events
    && samples.every(s => STAGE_FIELDS.every(f => Number.isFinite(s[f])));
  if (!complete) throw new Error(`Lượt ${run} (${consumers} consumer, ${events} event): thiếu mốc thời gian`);
  const endToEnd = samples.map(s => s.notifiedAt - clockOffsetMs - s.sentAt);
  const payment = samples.map(s => s.paymentAt - clockOffsetMs - s.sentAt);
  const relay = samples.map(s => s.publishedAt - s.paymentAt);
  const notification = samples.map(s => s.notifiedAt - s.publishedAt);
  const firstSent = Math.min(...samples.map(s => s.sentAt));
  const lastNotified = Math.max(...samples.map(s => s.notifiedAt)) - clockOffsetMs;
  const lastPayment = Math.max(...samples.map(s => s.paymentAt)) - clockOffsetMs;
  return {
    consumers, events, run, startedAt, clockOffsetMs, clockRttMs,
    throughputEps: (events * 1000) / (lastNotified - firstSent),
    p50Ms: percentile(endToEnd, 50),
    p95Ms: percentile(endToEnd, 95),
    maxMs: Math.max(...endToEnd),
    paymentThroughputEps: (events * 1000) / (lastPayment - firstSent),
    paymentP50Ms: percentile(payment, 50),
    paymentP95Ms: percentile(payment, 95),
    relayP50Ms: percentile(relay, 50),
    relayP95Ms: percentile(relay, 95),
    notificationP50Ms: percentile(notification, 50),
    notificationP95Ms: percentile(notification, 95),
  };
}

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const range = xs => ({ mean: mean(xs), min: Math.min(...xs), max: Math.max(...xs) });
const MEAN_FIELDS = ['paymentThroughputEps', 'paymentP50Ms', 'paymentP95Ms', 'relayP50Ms', 'relayP95Ms', 'notificationP50Ms', 'notificationP95Ms'];

// Gom các lượt cùng (consumers, events): thông lượng/p50/p95 lấy trung bình kèm min-max,
// max lấy giá trị lớn nhất, các chặng lấy trung bình.
function aggregate(runs) {
  const groups = new Map();
  for (const r of runs) {
    const key = `${r.consumers}:${r.events}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()]
    .map(rs => {
      const pick = f => rs.map(r => r[f]);
      const group = {
        consumers: rs[0].consumers, events: rs[0].events, runs: rs.length,
        throughputEps: range(pick('throughputEps')),
        p50Ms: range(pick('p50Ms')),
        p95Ms: range(pick('p95Ms')),
        maxMs: Math.max(...pick('maxMs')),
      };
      for (const f of MEAN_FIELDS) group[f] = mean(pick(f));
      return group;
    })
    .sort((a, b) => a.consumers - b.consumers || a.events - b.events);
}

module.exports = { percentile, pickClockOffset, summarizeRun, aggregate };
