#!/usr/bin/env node
// 端到端演示（零依赖，Node 直接运行）：
//   node scripts/demo.mjs
// 走完整链路：阻断非法输入 → 推演 → 隔离存储 → 确认出版本 → 幂等重复确认 → 回滚 → 完整性校验。

import { runScenario } from '../src/domain/engine.mjs';
import { ScenarioStore, memoryAdapter, STORAGE_KEYS } from '../src/domain/storage.mjs';
import { DEFAULT_PARAMS } from '../src/domain/schema.mjs';

const line = (title) => console.log(`\n${'─'.repeat(64)}\n${title}\n${'─'.repeat(64)}`);
const money = (n) =>
  n.toLocaleString('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 });
const num = (n) => n.toLocaleString('zh-CN', { maximumFractionDigits: 1 });

line('① 阻断演示：缺失 + 冲突 + 超范围输入必须被拒绝');
// 场景 A：字段全部合法但存在业务冲突（成本高于售价），演示跨字段冲突阻断
const conflictInput = { ...DEFAULT_PARAMS, unitVariableCost: 99999 };
const conflictRun = runScenario(conflictInput);
console.log('场景 A（成本 ≥ 售价冲突）ok =', conflictRun.ok, `（${conflictRun.errors.length} 个错误）`);
for (const e of conflictRun.errors) console.log(`  ✖ [${e.code}] ${e.message}`);
// 场景 B：超范围 + 必填缺失，演示单字段阻断
const badInput = { ...DEFAULT_PARAMS, conversionRate: 250 };
delete badInput.traffic;
const badRun = runScenario(badInput);
console.log('场景 B（超范围 + 必填缺失）ok =', badRun.ok, `（${badRun.errors.length} 个错误）`);
for (const e of badRun.errors) console.log(`  ✖ [${e.code}] ${e.message}`);

line('② 合法推演：点估计与 P5/P50/P95 不确定区间');
const run = runScenario(DEFAULT_PARAMS, { seed: 42 });
const { point, intervals, meta } = run.result;
console.log(`种子=${meta.seed} 抽样次数=${meta.runs}`);
console.table({
  销量_件: { 点估计: num(point.unitsSold), P5: num(intervals.unitsSold.p05), P95: num(intervals.unitsSold.p95) },
  收入: { 点估计: money(point.revenue), P5: money(intervals.revenue.p05), P95: money(intervals.revenue.p95) },
  利润: { 点估计: money(point.profit), P5: money(intervals.profit.p05), P95: money(intervals.profit.p95) },
});
console.log(`供给约束触发：${point.supplyConstrained ? '是（缺口 ' + num(point.unmetDemand) + ' 件）' : '否'}`);

line('③ 可重复性：同参数同种子再跑一次，结果应逐位一致');
const rerun = runScenario(DEFAULT_PARAMS, { seed: 42 });
const same = JSON.stringify({ ...rerun.result, meta: { ...rerun.result.meta, sampledAt: '' } }) ===
  JSON.stringify({ ...run.result, meta: { ...run.result.meta, sampledAt: '' } });
console.log('重复运行结果一致：', same ? '是 ✔' : '否 ✖');

line('④ 数据隔离：草稿只进 sandbox，正式账本为空');
const store = new ScenarioStore(memoryAdapter());
store.saveDraft({ params: DEFAULT_PARAMS, result: run.result });
console.log('存储 key 清单：', Object.keys(store.adapter._dump()));
console.log('正式版本数（确认前）：', store.listVersions().length);

line('⑤ 确认生成可引用版本（含内容指纹与记录指纹）');
const confirmed = await store.confirmVersion(run.result, '基线经营方案');
console.log(`版本号=${confirmed.version.versionId}  幂等新建=${!confirmed.duplicated}`);
console.log('内容指纹：', confirmed.version.contentChecksum.slice(0, 24) + '…');
console.log('记录指纹：', confirmed.version.checksum.slice(0, 24) + '…');

line('⑥ 幂等：同一结果重复确认不产生新版本');
const again = await store.confirmVersion(run.result, '重复点确认');
console.log(`返回版本=${again.version.versionId} 命中幂等=${again.duplicated} 账本总数=${store.listVersions().length}`);

line('⑦ 第二个方案确认后回滚到 v0001，验证账本只追加');
const raised = runScenario({ ...DEFAULT_PARAMS, price: 229 }, { seed: 42 });
store.saveDraft({ params: raised.result.params, result: raised.result });
await store.confirmVersion(raised.result, '涨价方案');
console.log('账本版本：', store.listVersions().map((v) => v.versionId).join(', '));
await store.rollbackTo('v0001');
console.log('回滚后草稿价格：', store.loadDraft().params.price, '（应为 199）');
console.log('回滚后账本版本数（不变）：', store.listVersions().length);

line('⑧ 完整性校验：正常通过；篡改后被阻断');
console.log('正常账本：', await store.verifyIntegrity());
const ledgerKey = STORAGE_KEYS.LEDGER_KEY;
const tampered = JSON.parse(store.adapter.getItem(ledgerKey));
tampered.versions[0].params.price = 1;
store.adapter.setItem(ledgerKey, JSON.stringify(tampered));
const tamperCheck = await store.verifyIntegrity();
console.log(`篡改后校验：ok=${tamperCheck.ok}，失配版本=${tamperCheck.failures.map((f) => f.versionId).join(',')}`);
try {
  await store.rollbackTo('v0001');
} catch (err) {
  console.log('回滚被阻断 ✔：', err.message);
}

line('⑨ 审计日志（全程留痕）');
for (const e of store.listAudit()) console.log(`  ${e.at.slice(11, 19)}  ${e.type}${e.versionId ? ' → ' + e.versionId : ''}`);
