import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScenarioStore, memoryAdapter, STORAGE_KEYS } from '../src/domain/storage.mjs';
import { runScenario } from '../src/domain/engine.mjs';
import { DEFAULT_PARAMS } from '../src/domain/schema.mjs';
import { fingerprintResult, fingerprintVersion } from '../src/domain/checksum.mjs';

function run(seed = 42) {
  return runScenario(DEFAULT_PARAMS, { seed, runs: 500 }).result;
}

test('沙箱与账本使用互相独立的存储 key（物理隔离）', () => {
  const adapter = memoryAdapter();
  const store = new ScenarioStore(adapter);
  store.saveDraft({ params: DEFAULT_PARAMS, result: run() });
  const dump = adapter._dump();
  assert.ok(Object.keys(dump).includes(STORAGE_KEYS.SANDBOX_KEY));
  assert.ok(!Object.keys(dump).includes(STORAGE_KEYS.LEDGER_KEY));
  const report = store.storageReport();
  assert.equal(report.hasDraft, true);
  assert.equal(report.versionCount, 0);
});

test('saveDraft 不产生任何正式版本', async () => {
  const store = new ScenarioStore(memoryAdapter());
  store.saveDraft({ params: DEFAULT_PARAMS, result: run() });
  store.saveDraft({ params: { ...DEFAULT_PARAMS, price: 210 }, result: run() });
  assert.equal(store.listVersions().length, 0);
});

test('确认后才写入账本，版本号递增且带指纹与时间戳', async () => {
  const store = new ScenarioStore(memoryAdapter());
  const { version, duplicated } = await store.confirmVersion(run(), '首次确认');
  assert.equal(duplicated, false);
  assert.equal(version.versionId, 'v0001');
  assert.match(version.contentChecksum, /^[0-9a-f]{64}$/);
  assert.match(version.checksum, /^[0-9a-f]{64}$/);
  assert.equal(version.note, '首次确认');
  assert.equal(store.listVersions().length, 1);

  const other = runScenario({ ...DEFAULT_PARAMS, price: 210 }, { seed: 42, runs: 500 }).result;
  const v2 = await store.confirmVersion(other);
  assert.equal(v2.version.versionId, 'v0002');
  assert.equal(store.listVersions().length, 2);
});

test('重复确认同一结果是幂等的：不产生重复版本', async () => {
  const store = new ScenarioStore(memoryAdapter());
  const first = await store.confirmVersion(run());
  const second = await store.confirmVersion(run());
  assert.equal(first.duplicated, false);
  assert.equal(second.duplicated, true);
  assert.equal(second.version.versionId, first.version.versionId);
  assert.equal(store.listVersions().length, 1);
});

test('确认缺失结果被阻断', async () => {
  const store = new ScenarioStore(memoryAdapter());
  await assert.rejects(() => store.confirmVersion(null), /阻断/);
  assert.equal(store.listVersions().length, 0);
});

test('回滚把指定版本的参数载入沙箱草稿，且账本保持不变', async () => {
  const store = new ScenarioStore(memoryAdapter());
  const r1 = runScenario(DEFAULT_PARAMS, { seed: 42, runs: 500 }).result;
  const r2 = runScenario({ ...DEFAULT_PARAMS, price: 210 }, { seed: 42, runs: 500 }).result;
  await store.confirmVersion(r1, '基线');
  const v2 = await store.confirmVersion(r2, '涨价方案');
  const ledgerSizeBefore = store.listVersions().length;

  const draft = await store.rollbackTo('v0001');
  assert.equal(draft.params.price, DEFAULT_PARAMS.price);
  assert.equal(store.listVersions().length, ledgerSizeBefore); // 账本未被修改
  assert.ok(store.listAudit().some((e) => e.type === 'ROLLBACK' && e.versionId === 'v0001'));
  assert.equal(v2.version.versionId, 'v0002');
});

test('回滚不存在的版本被阻断', async () => {
  const store = new ScenarioStore(memoryAdapter());
  await assert.rejects(() => store.rollbackTo('v9999'), /不存在/);
});

test('账本被篡改时完整性校验失败并阻断回滚', async () => {
  const adapter = memoryAdapter();
  const store = new ScenarioStore(adapter);
  const { version } = await store.confirmVersion(run());
  // 模拟篡改：直接改底层存储里的价格，并重建一条指纹失配的记录
  const ledger = JSON.parse(adapter.getItem(STORAGE_KEYS.LEDGER_KEY));
  ledger.versions[0].params.price = 999;
  adapter.setItem(STORAGE_KEYS.LEDGER_KEY, JSON.stringify(ledger));

  const integrity = await store.verifyIntegrity();
  assert.equal(integrity.ok, false);
  assert.equal(integrity.failures[0].versionId, version.versionId);
  await assert.rejects(() => store.rollbackTo(version.versionId), /完整性校验失败/);
});

test('未篡改时完整性校验通过', async () => {
  const store = new ScenarioStore(memoryAdapter());
  await store.confirmVersion(run());
  const integrity = await store.verifyIntegrity();
  assert.equal(integrity.ok, true);
  assert.equal(integrity.checked, 1);
});

test('clearDraft 只清空沙箱，正式版本不受影响', async () => {
  const store = new ScenarioStore(memoryAdapter());
  store.saveDraft({ params: DEFAULT_PARAMS, result: run() });
  await store.confirmVersion(run());
  store.clearDraft();
  assert.equal(store.loadDraft(), null);
  assert.equal(store.listVersions().length, 1);
});

test('审计日志完整记录保存、确认、幂等、回滚事件', async () => {
  const store = new ScenarioStore(memoryAdapter());
  store.saveDraft({ params: DEFAULT_PARAMS, result: run() });
  await store.confirmVersion(run());
  await store.confirmVersion(run()); // 幂等命中
  await store.rollbackTo('v0001');
  const types = store.listAudit().map((e) => e.type);
  assert.ok(types.includes('DRAFT_SAVED'));
  assert.ok(types.includes('VERSION_CONFIRMED'));
  assert.ok(types.includes('CONFIRM_IDEMPOTENT_HIT'));
  assert.ok(types.includes('ROLLBACK'));
});

test('损坏的存储 JSON 在读取时被阻断', () => {
  const adapter = memoryAdapter({ [STORAGE_KEYS.LEDGER_KEY]: '{not-json' });
  const store = new ScenarioStore(adapter);
  assert.throws(() => store.listVersions(), /存储损坏/);
});

test('版本记录指纹可独立复算', async () => {
  const store = new ScenarioStore(memoryAdapter());
  const { version } = await store.confirmVersion(run());
  const recomputed = await fingerprintVersion(version);
  assert.equal(recomputed, version.checksum);
});

test('内容指纹与记录指纹是两个不同层面的标识', async () => {
  const store = new ScenarioStore(memoryAdapter());
  const { version } = await store.confirmVersion(run(), '备注 A');
  const content = await fingerprintResult(version.result);
  assert.equal(content, version.contentChecksum);
  assert.notEqual(version.contentChecksum, version.checksum);
});
