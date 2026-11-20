import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateParams } from '../src/domain/validation.mjs';
import { ERROR_CODES } from '../src/domain/validation.mjs';
import { DEFAULT_PARAMS } from '../src/domain/schema.mjs';

function clone(p) {
  return { ...p };
}

test('合法参数通过校验', () => {
  const r = validateParams(clone(DEFAULT_PARAMS));
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
  assert.equal(r.params.price, 199);
});

test('数字字符串可被接受并转为数字', () => {
  const raw = Object.fromEntries(Object.entries(DEFAULT_PARAMS).map(([k, v]) => [k, String(v)]));
  const r = validateParams(raw);
  assert.equal(r.ok, true);
  assert.equal(typeof r.params.price, 'number');
});

test('缺失字段被阻断并给出原因', () => {
  const raw = clone(DEFAULT_PARAMS);
  delete raw.price;
  const r = validateParams(raw);
  assert.equal(r.ok, false);
  const err = r.errors.find((e) => e.code === ERROR_CODES.PARAM_MISSING && e.field === 'price');
  assert.ok(err);
  assert.match(err.message, /售价/);
});

test('空字符串视为缺失', () => {
  const raw = clone(DEFAULT_PARAMS);
  raw.conversionRate = '   ';
  const r = validateParams(raw);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, ERROR_CODES.PARAM_MISSING);
});

test('非数字（NaN/Infinity/布尔）被阻断', () => {
  for (const bad of ['abc', NaN, Infinity, true]) {
    const raw = clone(DEFAULT_PARAMS);
    raw.price = bad;
    const r = validateParams(raw);
    assert.equal(r.ok, false, `坏值 ${String(bad)} 应被阻断`);
    assert.equal(r.errors[0].code, ERROR_CODES.PARAM_NOT_A_NUMBER);
  }
});

test('超范围被阻断并显示允许范围', () => {
  const raw = clone(DEFAULT_PARAMS);
  raw.conversionRate = 150;
  const r = validateParams(raw);
  assert.equal(r.ok, false);
  const err = r.errors.find((e) => e.code === ERROR_CODES.PARAM_OUT_OF_RANGE);
  assert.ok(err);
  assert.match(err.message, /超出范围/);
  assert.match(err.message, /\[0.01, 100\]/);
});

test('负数超范围被阻断', () => {
  const raw = clone(DEFAULT_PARAMS);
  raw.fixedCost = -1;
  const r = validateParams(raw);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, ERROR_CODES.PARAM_OUT_OF_RANGE);
});

test('整数字段取小数被阻断', () => {
  const raw = clone(DEFAULT_PARAMS);
  raw.supplyCap = 100.5;
  const r = validateParams(raw);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, ERROR_CODES.PARAM_NOT_INTEGER);
});

test('成本 ≥ 价格的业务冲突被阻断', () => {
  const raw = clone(DEFAULT_PARAMS);
  raw.unitVariableCost = 200;
  const r = validateParams(raw);
  assert.equal(r.ok, false);
  const err = r.errors.find((e) => e.code === ERROR_CODES.CONFLICT_COST_GE_PRICE);
  assert.ok(err);
  assert.match(err.message, /输入冲突/);
});

test('成本等于价格同样被阻断（单位贡献为 0）', () => {
  const raw = clone(DEFAULT_PARAMS);
  raw.unitVariableCost = raw.price;
  const r = validateParams(raw);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === ERROR_CODES.CONFLICT_COST_GE_PRICE));
});

test('供给上限为 0 被阻断', () => {
  const raw = clone(DEFAULT_PARAMS);
  raw.supplyCap = 0;
  const r = validateParams(raw);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === ERROR_CODES.CONFLICT_SUPPLY_CAP_ZERO));
});

test('未知参数键被阻断', () => {
  const raw = { ...clone(DEFAULT_PARAMS), prise: 100 };
  const r = validateParams(raw);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === ERROR_CODES.PARAM_UNKNOWN_KEY));
});

test('参数体为 null / 数组时被阻断', () => {
  assert.equal(validateParams(null).ok, false);
  assert.equal(validateParams([]).ok, false);
  assert.equal(validateParams('nope').ok, false);
});

test('多个问题一次性全部返回（不短路）', () => {
  const raw = clone(DEFAULT_PARAMS);
  delete raw.price; // 缺失
  raw.conversionRate = 999; // 超范围
  raw.traffic = 1.5; // 整数字段取小数
  const r = validateParams(raw);
  assert.equal(r.ok, false);
  const codes = r.errors.map((e) => e.code);
  assert.ok(codes.includes(ERROR_CODES.PARAM_MISSING));
  assert.ok(codes.includes(ERROR_CODES.PARAM_OUT_OF_RANGE));
  assert.ok(codes.includes(ERROR_CODES.PARAM_NOT_INTEGER));
  assert.ok(r.errors.length >= 3);
});
