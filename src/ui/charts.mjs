// 纯 SVG 不确定区间图（dumbbell 点线）：每个指标一行，展示 P5–P95 区间与 P50 中位点。
// 双色：蓝=基线版本，橙=当前推演，均已通过调色板校验（明/暗模式全门通过）。
// 交互：每个图元带 <title> 原生悬浮提示；配套表格视图承载精确数值（技能要求的 relief）。

import { formatNumber, formatMoney, formatPercent } from './format.mjs';

const BLUE = 'var(--series-blue)';
const ORANGE = 'var(--series-orange)';
const MUTED = 'var(--ink-muted)';
const GRID = 'var(--gridline)';

function fmt(metric, v) {
  if (metric.kind === 'money') return formatMoney(v);
  if (metric.kind === 'percent') return formatPercent(v);
  return formatNumber(v, metric.precision ?? 1);
}

/**
 * @param {Array<{key:string,label:string,kind:string,precision?:number}>} metrics
 * @param {{current: object, baseline: object|null}} intervals 两组 P5/P50/P95 数据
 */
export function renderRangeChart(metrics, intervals) {
  const rows = metrics.map((m) => {
    const cur = intervals.current[m.key];
    const base = intervals.baseline ? intervals.baseline[m.key] : null;
    const all = [cur.p05, cur.p95, ...(base ? [base.p05, base.p95] : [])];
    return { metric: m, cur, base, min: Math.min(...all), max: Math.max(...all) };
  });

  const rowH = 64;
  const labelW = 104;
  const valueW = 150;
  const padTop = 8;
  const height = rows.length * rowH + padTop;
  const svg = [`<svg viewBox="0 0 640 ${height}" role="img" aria-label="不确定区间 P5 到 P95 对比图" class="range-chart">`];

  rows.forEach((row, i) => {
    const y = padTop + i * rowH + rowH / 2;
    const span = row.max - row.min || 1;
    const lo = row.min - span * 0.08;
    const hi = row.max + span * 0.08;
    const x = (v) => labelW + ((v - lo) / (hi - lo)) * (640 - labelW - valueW);

    // 网格线 + 两端刻度
    for (const gv of [lo, (lo + hi) / 2, hi]) {
      svg.push(
        `<line x1="${x(gv).toFixed(1)}" y1="${y - 22}" x2="${x(gv).toFixed(1)}" y2="${y + 22}" stroke="${GRID}" stroke-width="1"/>`
      );
    }

    // 行标签（文字用 ink 色，不用系列色）
    svg.push(
      `<text x="12" y="${y + 4}" class="chart-label">${row.metric.label}</text>`
    );

    const drawBand = (iv, color, label) => {
      const x1 = x(iv.p05);
      const x2 = x(iv.p95);
      const xm = x(iv.p50);
      svg.push(
        `<g><title>${label}｜${row.metric.label}：P5 ${fmt(row.metric, iv.p05)}，P50 ${fmt(row.metric, iv.p50)}，P95 ${fmt(row.metric, iv.p95)}</title>` +
          `<line x1="${x1.toFixed(1)}" y1="${y}" x2="${x2.toFixed(1)}" y2="${y}" stroke="${color}" stroke-width="2.5" stroke-linecap="round" opacity="0.55"/>` +
          `<circle cx="${x1.toFixed(1)}" cy="${y}" r="4.5" fill="${color}"/>` +
          `<circle cx="${x2.toFixed(1)}" cy="${y}" r="4.5" fill="${color}"/>` +
          `<circle cx="${xm.toFixed(1)}" cy="${y}" r="6" fill="${color}" stroke="var(--surface-1)" stroke-width="2"/></g>`
      );
    };

    if (row.base) drawBand(row.base, BLUE, '基线版本');
    drawBand(row.cur, ORANGE, '当前推演');

    // 直接标签：当前中位值（文字仍走 ink token）
    svg.push(
      `<text x="${(640 - valueW + 10).toFixed(1)}" y="${y + 4}" class="chart-value">${fmt(row.metric, row.cur.p50)}</text>`
    );
  });

  // 图例（>=2 系列必须有）
  const legendY = height - 2;
  svg.push(
    `<g class="chart-legend">` +
      `<circle cx="14" cy="${legendY - 4}" r="5" fill="${BLUE}"/><text x="26" y="${legendY}" class="chart-label">基线版本 P5–P95</text>` +
      `<circle cx="180" cy="${legendY - 4}" r="5" fill="${ORANGE}"/><text x="192" y="${legendY}" class="chart-label">当前推演 P5–P95（大点=P50）</text>` +
      `<text x="470" y="${legendY}" fill="${MUTED}" class="chart-label">悬浮查看精确值</text></g>`
  );
  svg.push('</svg>');
  return svg.join('');
}
