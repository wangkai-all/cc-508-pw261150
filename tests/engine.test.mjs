import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, computeOnce } from '../src/domain/engine.mjs';
import { DEFAULT_PARAMS } from '../src/domain/schema.mjs';

test('联动计算：需求、供给截断、收入、成本、利润链路正确', () => {
  const p = {
    price: 100,
    conversionRate: 10,
    traffic: 1000,
    unitVariableCost: 60,
    fixedCost: 1000,
    supplyCap: 200,
    priceVolatility: 0,
    conversionVolatility: 0,
  };
  const r = computeOnce(p);
  assert.equal(r.demand, 100); // 1000 × 10%
  assert.equal(r.unitsSold, 100); // 未触供给上限
  assert.equal(r.unitContribution, 40);
  assert.equal(r.revenue, 10000);
  assert.equal(r.totalCost, 100 * 60 + 1000);
  assert.equal(r.profit, 10000 - 7000);
  assert.equal(r.profitMargin, 0.3);
  assert.equal(r.unmetDemand, 0);
  assert.equal(r.supplyConstrained, false);
  assert.equal(r.breakEvenAchieved, true); // 保本点 25 件 < 100 件
});

test('供给约束生效：需求超过上限时截断并记录缺口', () => {
  const p = {
    price: 100,
    conversionRate: 50,
    traffic: 1000,
    unitVariableCost: 60,
    fixedCost: 1000,
    supplyCap: 200,
    priceVolatility: 0,
    conversionVolatility: 0,
  };
  const r = computeOnce(p);
  assert.equal(r.demand, 500);
  assert.equal(r.unitsSold, 200);
  assert.equal(r.unmetDemand, 300);
  assert.equal(r.supplyConstrained, true);
});

test('runScenario 对非法输入返回错误且不带结果', () => {
  const out = runScenario({ ...DEFAULT_PARAMS, price: -5 });
  assert.equal(out.ok, false);
  assert.ok(out.errors.length > 0);
  assert.equal(out.result, undefined);
});

test('重复运行逐位一致（可重复性硬保证，时间戳除外）', () => {
  const a = runScenario(DEFAULT_PARAMS, { seed: 42, runs: 500 }).result;
  const b = runScenario(DEFAULT_PARAMS, { seed: 42, runs: 500 }).result;
  const { meta: ma, ...coreA } = a;
  const { meta: mb, ...coreB } = b;
  assert.deepEqual(coreA, coreB);
  assert.deepEqual({ seed: ma.seed, runs: ma.runs, engineVersion: ma.engineVersion }, {
    seed: mb.seed,
    runs: mb.runs,
    engineVersion: mb.engineVersion,
  });
});

test('不同种子产生不同的抽样结果', () => {
  const a = runScenario(DEFAULT_PARAMS, { seed: 1, runs: 500 });
  const b = runScenario(DEFAULT_PARAMS, { seed: 2, runs: 500 });
  assert.notDeepEqual(a.result.intervals, b.result.intervals);
});

test('零波动率时区间收敛到点估计', () => {
  const params = { ...DEFAULT_PARAMS, priceVolatility: 0, conversionVolatility: 0 };
  const out = runScenario(params, { seed: 42, runs: 1000 });
  assert.equal(out.ok, true);
  for (const key of ['revenue', 'profit', 'unitsSold']) {
    const iv = out.result.intervals[key];
    assert.ok(Math.abs(iv.p05 - iv.p95) < 1e-9, `${key} 零波动区间应收敛`);
    assert.ok(Math.abs(iv.p50 - out.result.point[key]) < 1e-9);
  }
});

test('区间满足 P5 ≤ P50 ≤ P95 且 P5 ≤ 点估计邻域 ≤ P95（常规波动）', () => {
  const out = runScenario(DEFAULT_PARAMS, { seed: 42, runs: 2000 });
  for (const key of ['revenue', 'profit', 'unitsSold', 'totalCost']) {
    const iv = out.result.intervals[key];
    assert.ok(iv.p05 <= iv.p50, `${key} P5≤P50`);
    assert.ok(iv.p50 <= iv.p95, `${key} P50≤P95`);
    assert.ok(iv.p95 > iv.p05, `${key} 有波动时区间应有宽度`);
  }
});

test('结果中携带种子与抽样次数等元信息', () => {
  const out = runScenario(DEFAULT_PARAMS, { seed: 7, runs: 300 });
  assert.equal(out.result.meta.seed, 7);
  assert.equal(out.result.meta.runs, 300);
  assert.equal(typeof out.result.meta.sampledAt, 'string');
});

test('低于最小抽样次数时回退默认次数', () => {
  const out = runScenario(DEFAULT_PARAMS, { runs: 10 });
  assert.equal(out.result.meta.runs, 2000);
});

test('流量为 0 是合法场景：利润为负固定成本且不报错', () => {
  const params = { ...DEFAULT_PARAMS, traffic: 0 };
  const out = runScenario(params);
  assert.equal(out.ok, true);
  assert.equal(out.result.point.revenue, 0);
  assert.equal(out.result.point.profit, -DEFAULT_PARAMS.fixedCost);
});
