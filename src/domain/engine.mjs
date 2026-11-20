// 推演引擎：一次确定性主计算 + 固定次数的蒙特卡洛抽样，输出点估计与 P5/P50/P95 区间。
// 同参数、同种子、同抽样次数 => 输出逐位一致（可重复运行的硬保证）。

import { DEFAULT_SIMULATION_RUNS, PERCENTILES } from './schema.mjs';
import { validateParams } from './validation.mjs';
import { createRng, gaussian } from './rng.mjs';

/**
 * 单次确定性计算。输入为已校验的数值参数，输出完整的指标联动链。
 * 依赖链（与 UI「依赖关系」面板一致）：
 *   traffic × conversionRate% → demand（理论需求）
 *   min(demand, supplyCap)    → unitsSold（供给约束截断）
 *   price − unitVariableCost  → unitContribution（单位边际贡献）
 *   unitsSold × price         → revenue
 *   unitsSold × unitVariableCost + fixedCost → totalCost
 *   revenue − totalCost       → profit
 *   profit / revenue          → profitMargin
 *   demand − unitsSold        → unmetDemand（供给缺口）
 *   revenue / traffic         → revenuePerVisitor
 */
export function computeOnce(p) {
  const demand = (p.traffic * p.conversionRate) / 100;
  const unitsSold = Math.min(demand, p.supplyCap);
  const unitContribution = p.price - p.unitVariableCost;
  const revenue = unitsSold * p.price;
  const variableCostTotal = unitsSold * p.unitVariableCost;
  const totalCost = variableCostTotal + p.fixedCost;
  const profit = revenue - totalCost;
  const profitMargin = revenue > 0 ? profit / revenue : 0;
  const unmetDemand = Math.max(0, demand - p.supplyCap);
  const revenuePerVisitor = p.traffic > 0 ? revenue / p.traffic : 0;
  const supplyConstrained = demand > p.supplyCap;
  const breakEvenUnits =
    unitContribution > 0 ? p.fixedCost / unitContribution : Infinity;
  const breakEvenAchieved = unitsSold >= breakEvenUnits;

  return {
    demand,
    unitsSold,
    unitContribution,
    revenue,
    variableCostTotal,
    totalCost,
    profit,
    profitMargin,
    unmetDemand,
    revenuePerVisitor,
    supplyConstrained,
    breakEvenUnits: Number.isFinite(breakEvenUnits) ? breakEvenUnits : null,
    breakEvenAchieved,
  };
}

/**
 * 最近秩法分位数。
 */
function percentile(sortedValues, pct) {
  if (sortedValues.length === 0) return 0;
  const rank = Math.ceil((pct / 100) * sortedValues.length);
  const index = Math.min(Math.max(rank, 1), sortedValues.length) - 1;
  return sortedValues[index];
}

function summarize(samples, key) {
  const values = samples.map((s) => s[key]).sort((a, b) => a - b);
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  return {
    p05: percentile(values, PERCENTILES.p05),
    p50: percentile(values, PERCENTILES.p50),
    p95: percentile(values, PERCENTILES.p95),
    mean,
  };
}

// 参与区间汇总的指标（其余派生指标仅输出点估计）。
const UNCERTAINTY_KEYS = [
  'demand',
  'unitsSold',
  'revenue',
  'totalCost',
  'profit',
  'profitMargin',
  'unmetDemand',
];

/**
 * 运行完整情景推演。
 * @param {Record<string, unknown>} rawParams 原始（未校验）输入
 * @param {{ seed?: number, runs?: number }} [options]
 * @returns {{ ok: true, result: object } | { ok: false, errors: object[] }}
 */
export function runScenario(rawParams, options = {}) {
  const validation = validateParams(rawParams);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }
  const params = validation.params;
  const seed = Number.isInteger(options.seed) ? options.seed >>> 0 : 42;
  const runs =
    Number.isInteger(options.runs) && options.runs >= 100
      ? options.runs
      : DEFAULT_SIMULATION_RUNS;

  // 点估计：用中枢参数做一次确定性计算。
  const point = computeOnce(params);

  // 蒙特卡洛：价格、转化率按各自波动率做正态扰动（乘性，保证不出现负价格/负转化率）。
  const rng = createRng(seed);
  const samples = [];
  for (let i = 0; i < runs; i += 1) {
    const priceShock = 1 + (gaussian(rng) * params.priceVolatility) / 100;
    const convShock = 1 + (gaussian(rng) * params.conversionVolatility) / 100;
    const sampled = {
      ...params,
      price: Math.max(params.price * Math.max(priceShock, 0.01), 0.01),
      conversionRate: Math.max(
        params.conversionRate * Math.max(convShock, 0.01),
        0.0001
      ),
    };
    samples.push(computeOnce(sampled));
  }

  const intervals = {};
  for (const key of UNCERTAINTY_KEYS) {
    intervals[key] = summarize(samples, key);
  }

  return {
    ok: true,
    result: {
      params,
      point,
      intervals,
      meta: {
        seed,
        runs,
        engineVersion: '1.0.0',
        sampledAt: new Date().toISOString(),
      },
    },
  };
}
