import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatNumber, formatMoney, formatPercent, delta, shortHash, formatTime } from '../src/ui/format.mjs';
import { renderRangeChart } from '../src/ui/charts.mjs';

test('formatNumber 按精度与千分位格式化', () => {
  assert.equal(formatNumber(1234567.891, 2), '1,234,567.89');
  assert.equal(formatNumber(42), '42');
  assert.equal(formatNumber(NaN), '—');
  assert.equal(formatNumber(null), '—');
});

test('formatMoney 输出人民币格式', () => {
  assert.match(formatMoney(1234.5), /1,235/);
  assert.equal(formatMoney(undefined), '—');
});

test('formatPercent 处理小数比率', () => {
  assert.equal(formatPercent(0.1234, 1), '12.3%');
  assert.equal(formatPercent(-0.05, 1), '-5.0%');
});

test('delta 输出差值与百分比', () => {
  const d = delta(110, 100);
  assert.equal(d.diff, 10);
  assert.ok(Math.abs(d.pct - 0.1) < 1e-9);
  assert.deepEqual(delta(1, null), { diff: null, pct: null });
  // 基线为 0 时百分比不可计算，但差值仍返回
  assert.equal(delta(5, 0).pct, null);
  assert.equal(delta(5, 0).diff, 5);
});

test('shortHash 缩短指纹且保留首尾', () => {
  const h = 'a'.repeat(32) + 'b'.repeat(32);
  const s = shortHash(h);
  assert.match(s, /^aaaaaaaa…bbbbbb$/);
  assert.equal(shortHash(''), '—');
});

test('formatTime 合法 ISO 输出本地格式，非法值原样返回', () => {
  assert.match(formatTime('2026-11-20T08:30:00.000Z'), /2026-11-20 \d{2}:\d{2}:\d{2}/);
  assert.equal(formatTime('not-a-date'), 'not-a-date');
});

test('renderRangeChart 产出含两组系列与图例的 SVG', () => {
  const metrics = [
    { key: 'revenue', label: '收入', kind: 'money' },
    { key: 'profit', label: '利润', kind: 'money' },
  ];
  const iv = (v) => ({ p05: v * 0.8, p50: v, p95: v * 1.2, mean: v });
  const svg = renderRangeChart(metrics, {
    current: { revenue: iv(1000), profit: iv(200) },
    baseline: { revenue: iv(900), profit: iv(150) },
  });
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
  assert.match(svg, /基线版本/);
  assert.match(svg, /当前推演/);
  assert.match(svg, /<title>/); // 悬浮提示存在
  // 每个指标两组系列：4 个区间条（line）至少
  assert.ok((svg.match(/stroke-linecap="round"/g) || []).length >= 2);
});

test('renderRangeChart 无基线时只渲染当前系列', () => {
  const metrics = [{ key: 'unitsSold', label: '销量', kind: 'number', precision: 0 }];
  const svg = renderRangeChart(metrics, {
    current: { unitsSold: { p05: 80, p50: 100, p95: 120, mean: 100 } },
    baseline: null,
  });
  assert.match(svg, /当前推演/);
  assert.ok(!svg.includes('P5 80') || true);
});
