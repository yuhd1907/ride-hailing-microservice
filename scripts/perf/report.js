'use strict';
// Sinh raw.csv, results.md và biểu đồ SVG cho thí nghiệm hiệu năng (spec mục 6.1, 6.6).

const escapeXml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const round3 = x => (typeof x === 'number' ? String(Math.round(x * 1000) / 1000) : String(x));

function toCsv(runs) {
  if (!runs.length) return '';
  const fields = Object.keys(runs[0]);
  return [fields.join(','), ...runs.map(r => fields.map(f => round3(r[f])).join(','))].join('\n') + '\n';
}

// Bước chia trục tung "đẹp" (1, 2, 5 × 10^k) cho khoảng 5 vạch.
function niceStep(maxValue) {
  const raw = maxValue / 5;
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map(m => m * power).find(step => step >= raw);
}

const formatValue = v => (Number.isInteger(v) || Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(1));

// Hai series phân biệt bằng độ đậm (in đen trắng vẫn đọc được).
const SERIES_FILLS = ['#9ecae1', '#08519c', '#fdae6b', '#a63603'];

function barChartSvg({ title, xLabel, yLabel, categories, series }) {
  const width = 720;
  const height = 420;
  const margin = { top: 70, right: 24, bottom: 64, left: 72 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const peak = Math.max(1e-9, ...series.flatMap(s => s.values.filter(Boolean).map(v => v.max)));
  const step = niceStep(peak * 1.1);
  const top = Math.ceil((peak * 1.1) / step) * step;
  const y = v => margin.top + plotH - (v / top) * plotH;
  const groupW = plotW / categories.length;
  const barW = (groupW * 0.7) / series.length;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Segoe UI, Arial, sans-serif" font-size="13" fill="#222">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
    `<text x="${width / 2}" y="28" text-anchor="middle" font-size="17" font-weight="bold">${escapeXml(title)}</text>`,
  ];
  for (let tick = 0; tick <= top + 1e-9; tick += step) {
    parts.push(`<line x1="${margin.left}" x2="${margin.left + plotW}" y1="${y(tick)}" y2="${y(tick)}" stroke="#ddd"/>`);
    parts.push(`<text x="${margin.left - 8}" y="${y(tick) + 4}" text-anchor="end">${escapeXml(formatValue(tick))}</text>`);
  }
  parts.push(`<line x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${margin.top + plotH}" stroke="#444"/>`);
  parts.push(`<line x1="${margin.left}" x2="${margin.left + plotW}" y1="${margin.top + plotH}" y2="${margin.top + plotH}" stroke="#444"/>`);
  categories.forEach((category, ci) => {
    const groupX = margin.left + ci * groupW + groupW * 0.15;
    parts.push(`<text x="${margin.left + (ci + 0.5) * groupW}" y="${margin.top + plotH + 20}" text-anchor="middle">${escapeXml(category)}</text>`);
    series.forEach((s, si) => {
      const v = s.values[ci];
      if (!v) return;
      const x = groupX + si * barW;
      const cx = x + barW / 2;
      parts.push(`<rect class="bar" x="${x + 2}" y="${y(v.mean)}" width="${barW - 4}" height="${y(0) - y(v.mean)}" fill="${SERIES_FILLS[si % SERIES_FILLS.length]}" stroke="#333"/>`);
      // Vạch min–max giữa các lượt
      parts.push(`<line x1="${cx}" x2="${cx}" y1="${y(v.min)}" y2="${y(v.max)}" stroke="#000" stroke-width="1.5"/>`);
      parts.push(`<line x1="${cx - 6}" x2="${cx + 6}" y1="${y(v.min)}" y2="${y(v.min)}" stroke="#000" stroke-width="1.5"/>`);
      parts.push(`<line x1="${cx - 6}" x2="${cx + 6}" y1="${y(v.max)}" y2="${y(v.max)}" stroke="#000" stroke-width="1.5"/>`);
      parts.push(`<text x="${cx}" y="${y(v.max) - 6}" text-anchor="middle" font-weight="bold">${escapeXml(formatValue(v.mean))}</text>`);
    });
  });
  parts.push(`<text x="${margin.left + plotW / 2}" y="${height - 16}" text-anchor="middle">${escapeXml(xLabel)}</text>`);
  parts.push(`<text transform="translate(20 ${margin.top + plotH / 2}) rotate(-90)" text-anchor="middle">${escapeXml(yLabel)}</text>`);
  series.forEach((s, si) => {
    const lx = width - margin.right - 130 * (series.length - si);
    parts.push(`<rect x="${lx}" y="44" width="14" height="14" fill="${SERIES_FILLS[si % SERIES_FILLS.length]}" stroke="#333"/>`);
    parts.push(`<text x="${lx + 20}" y="56">${escapeXml(s.name)}</text>`);
  });
  parts.push('</svg>');
  return parts.join('\n') + '\n';
}

function chartSeries(groups, field) {
  const events = [...new Set(groups.map(g => g.events))].sort((a, b) => a - b);
  const consumers = [...new Set(groups.map(g => g.consumers))].sort((a, b) => a - b);
  return {
    categories: events.map(String),
    series: consumers.map(c => ({
      name: `${c} consumer`,
      values: events.map(e => groups.find(g => g.consumers === c && g.events === e)?.[field] ?? null),
    })),
  };
}

function chartsFor(groups) {
  const xLabel = 'Số event mỗi lượt';
  return {
    throughput: barChartSvg({ title: 'Thông lượng đầu-cuối Payment → Notification', xLabel, yLabel: 'event/giây', ...chartSeries(groups, 'throughputEps') }),
    latencyP95: barChartSvg({ title: 'Độ trễ đầu-cuối p95', xLabel, yLabel: 'ms', ...chartSeries(groups, 'p95Ms') }),
  };
}

const eps = x => x.toFixed(1);
const ms = x => String(Math.round(x));
const rangeCell = (r, f) => `${f(r.mean)} (${f(r.min)}–${f(r.max)})`;

function resultsMarkdown(groups, { generatedAt, commit, runsPerConfig }) {
  const lines = [
    '# Kết quả thí nghiệm hiệu năng Payment → Notification',
    '',
    '> File này do script sinh tự động (`scripts/perf-payment-notification.js`), không sửa tay.',
    `> Thời điểm chạy: ${generatedAt}. Commit: \`${commit}\`. Mỗi cấu hình chạy ${runsPerConfig} lượt.`,
    '> Cách đo và nhận xét: xem [README.md](README.md).',
    '',
    '## Đầu-cuối: gửi `trip.completed` → thông báo được lưu',
    '',
    'Số ngoài ngoặc là trung bình các lượt; trong ngoặc là khoảng min–max giữa các lượt. Cột max là giá trị lớn nhất của mọi lượt.',
    '',
    '| Consumer | Số event | Số lượt | Thông lượng (event/s) | p50 (ms) | p95 (ms) | max (ms) |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...groups.map(g => `| ${g.consumers} | ${g.events} | ${g.runs} | ${rangeCell(g.throughputEps, eps)} | ${rangeCell(g.p50Ms, ms)} | ${rangeCell(g.p95Ms, ms)} | ${ms(g.maxMs)} |`),
    '',
    '## Theo chặng (trung bình các lượt)',
    '',
    '| Consumer | Số event | Payment (event/s) | Payment p50 / p95 (ms) | Chờ relay p50 / p95 (ms) | Notification p50 / p95 (ms) |',
    '| --- | --- | --- | --- | --- | --- |',
    ...groups.map(g => `| ${g.consumers} | ${g.events} | ${eps(g.paymentThroughputEps)} | ${ms(g.paymentP50Ms)} / ${ms(g.paymentP95Ms)} | ${ms(g.relayP50Ms)} / ${ms(g.relayP95Ms)} | ${ms(g.notificationP50Ms)} / ${ms(g.notificationP95Ms)} |`),
    '',
    '## Biểu đồ',
    '',
    '![Thông lượng](throughput.svg)',
    '',
    '![Độ trễ p95](latency-p95.svg)',
    '',
  ];
  return lines.join('\n');
}

module.exports = { toCsv, barChartSvg, chartsFor, resultsMarkdown };
