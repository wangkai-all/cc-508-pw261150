import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, gaussian } from '../src/domain/rng.mjs';

test('mulberry32 同种子产生完全相同的序列', () => {
  const a = createRng(12345);
  const b = createRng(12345);
  const seqA = Array.from({ length: 100 }, () => a());
  const seqB = Array.from({ length: 100 }, () => b());
  assert.deepEqual(seqA, seqB);
});

test('不同种子产生不同序列', () => {
  const a = createRng(1);
  const b = createRng(2);
  assert.notEqual(a(), b());
});

test('随机数落在 [0,1)', () => {
  const rng = createRng(7);
  for (let i = 0; i < 1000; i += 1) {
    const x = rng();
    assert.ok(x >= 0 && x < 1);
  }
});

test('gaussian 同种子可重复且均值近似 0', () => {
  const rng1 = createRng(99);
  const rng2 = createRng(99);
  const s1 = Array.from({ length: 2000 }, () => gaussian(rng1));
  const s2 = Array.from({ length: 2000 }, () => gaussian(rng2));
  assert.deepEqual(s1, s2);
  const mean = s1.reduce((acc, v) => acc + v, 0) / s1.length;
  assert.ok(Math.abs(mean) < 0.1, `均值 ${mean} 应接近 0`);
});
