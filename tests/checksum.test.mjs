import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalStringify, sha256Hex, fingerprintResult } from '../src/domain/checksum.mjs';
import { runScenario } from '../src/domain/engine.mjs';
import { DEFAULT_PARAMS } from '../src/domain/schema.mjs';

test('canonicalStringify 对键顺序不敏感', () => {
  assert.equal(canonicalStringify({ a: 1, b: 2 }), canonicalStringify({ b: 2, a: 1 }));
});

test('canonicalStringify 区分不同值', () => {
  assert.notEqual(canonicalStringify({ a: 1 }), canonicalStringify({ a: 2 }));
});

test('sha256Hex 输出 64 位十六进制且稳定', async () => {
  const h1 = await sha256Hex({ x: 1 });
  const h2 = await sha256Hex({ x: 1 });
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(h1, h2);
});

test('同输入（忽略时间戳）产生相同内容指纹', async () => {
  const a = runScenario(DEFAULT_PARAMS, { seed: 42 }).result;
  const b = runScenario(DEFAULT_PARAMS, { seed: 42 }).result;
  assert.notEqual(a.meta.sampledAt, b.meta.sampledAt); // 时间戳不同
  assert.equal(await fingerprintResult(a), await fingerprintResult(b)); // 指纹仍相同
});

test('参数变化导致指纹变化', async () => {
  const a = runScenario(DEFAULT_PARAMS, { seed: 42 }).result;
  const b = runScenario({ ...DEFAULT_PARAMS, price: 210 }, { seed: 42 }).result;
  assert.notEqual(await fingerprintResult(a), await fingerprintResult(b));
});

test('种子变化导致指纹变化', async () => {
  const a = runScenario(DEFAULT_PARAMS, { seed: 1 }).result;
  const b = runScenario(DEFAULT_PARAMS, { seed: 2 }).result;
  assert.notEqual(await fingerprintResult(a), await fingerprintResult(b));
});
