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

function parseOptions(argv) {
  const { parseArgs } = require('node:util');
  const { values } = parseArgs({
    args: argv,
    options: {
      runs: { type: 'string', default: '3' },
      sizes: { type: 'string', default: '100,500,1000' },
      consumers: { type: 'string', default: '1,3' },
      warmup: { type: 'string', default: '200' },
      timeout: { type: 'string', default: '120' },
      out: { type: 'string', default: 'docs/evidence/perf' },
    },
  });
  const int = (name, text, min) => {
    const n = Number(text);
    if (!Number.isInteger(n) || n < min) throw new Error(`--${name} phải là số nguyên ${min === 0 ? 'không âm' : 'dương'} (nhận "${text}")`);
    return n;
  };
  const list = name => values[name].split(',').map(x => int(name, x.trim(), 1));
  return {
    consumers: list('consumers'),
    sizes: list('sizes'),
    runs: int('runs', values.runs, 1),
    warmup: int('warmup', values.warmup, 0),
    timeoutMs: int('timeout', values.timeout, 1) * 1000,
    out: values.out,
  };
}

async function main() {
  const fs = require('node:fs');
  const path = require('node:path');
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    console.error(`Tham số không hợp lệ: ${error.message}`);
    process.exit(2);
  }
  const infra = require('./perf/infra');
  const { aggregate } = require('./perf/stats');
  const report = require('./perf/report');
  const log = message => console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
  const config = infra.loadConfig();
  let handles;
  try {
    handles = await infra.connect(config);
    const restore = once(async () => {
      log('Khôi phục: Payment về cấu hình mặc định, dọn queue của Trip, chạy lại trip_service');
      await infra.restore(handles);
      log('Đã khôi phục hệ thống');
    });
    process.once('SIGINT', async () => {
      log('Nhận Ctrl+C, đang khôi phục hệ thống trước khi thoát...');
      try {
        await restore();
      } catch (error) {
        console.error(`Khôi phục thất bại: ${error.message}`);
      }
      process.exit(130);
    });
    const results = await runExperiment(options, {
      preflight: () => infra.preflight(handles),
      stopTrip: async () => { log('Tạm dừng trip_service'); infra.stopTrip(config); },
      setConsumers: async consumers => {
        log(`Tạo lại payment_service với ${consumers} consumer`);
        return infra.setConsumers(handles, consumers);
      },
      measureRun: runOptions => infra.measureRun(handles, runOptions),
      restore,
      log,
    });
    const out = path.resolve(config.root, options.out);
    fs.mkdirSync(out, { recursive: true });
    const groups = aggregate(results);
    const charts = report.chartsFor(groups);
    const meta = { generatedAt: new Date().toISOString(), commit: infra.gitCommit(config), runsPerConfig: options.runs };
    fs.writeFileSync(path.join(out, 'raw.csv'), report.toCsv(results));
    fs.writeFileSync(path.join(out, 'results.md'), report.resultsMarkdown(groups, meta));
    fs.writeFileSync(path.join(out, 'throughput.svg'), charts.throughput);
    fs.writeFileSync(path.join(out, 'latency-p95.svg'), charts.latencyP95);
    fs.writeFileSync(path.join(out, 'environment.txt'), infra.environmentInfo(config, options));
    log(`Xong ${results.length} lượt đo. Kết quả trong ${path.relative(config.root, out) || out}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (handles) await handles.close();
  }
}

module.exports = { runExperiment, once };

if (require.main === module) main();
