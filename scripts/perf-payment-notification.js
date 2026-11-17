'use strict';
// Thí nghiệm hiệu năng Payment → Notification.
// Gửi lô event trip.completed, đo thông lượng và độ trễ p50/p95/max với Payment chạy
// 1 và 3 consumer. Chạy: node scripts/perf-payment-notification.js (xem docs/evidence/perf/README.md).
const { consumerProblems } = require('./perf/checks');

// Hàm chỉ chạy lần đầu; các lần gọi sau nhận lại cùng Promise.
function once(fn) {
  let result;
  return (...args) => {
    if (!result) result = Promise.resolve().then(() => fn(...args));
    return result;
  };
}

async function runExperiment(options, deps) {
  const problems = await deps.preflight();
  if (problems.length) throw new Error(`Hệ thống chưa sẵn sàng để đo:\n- ${problems.join('\n- ')}`);
  await deps.stopTrip();
  const results = [];
  try {
    for (const consumers of options.consumers) {
      const actual = await deps.setConsumers(consumers);
      const wrong = consumerProblems(actual, consumers);
      if (wrong.length) throw new Error(wrong.join('\n'));
      if (options.warmup > 0) {
        deps.log(`${consumers} consumer, ${options.warmup} event, lượt khởi động (bỏ kết quả)`);
        await deps.measureRun({ consumers, events: options.warmup, run: 0, timeoutMs: options.timeoutMs });
      }
      for (const events of options.sizes) {
        for (let run = 1; run <= options.runs; run++) {
          deps.log(`${consumers} consumer, ${events} event, lượt ${run}/${options.runs}`);
          results.push(await deps.measureRun({ consumers, events, run, timeoutMs: options.timeoutMs }));
        }
      }
    }
  } finally {
    await deps.restore();
  }
  return results;
}

async function main() {
  throw new Error('Chưa triển khai');
}

module.exports = { runExperiment, once };

if (require.main === module) main();
