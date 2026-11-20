// 输入校验：任何缺失、格式错误、超范围或业务冲突都以结构化错误返回，
// 由调用方（UI / CLI / confirm 流程）决定如何展示；校验不通过即阻断，绝不产出结果。

import { PARAM_FIELDS, PARAM_KEYS } from './schema.mjs';

export const ERROR_CODES = Object.freeze({
  PARAM_MISSING: 'PARAM_MISSING',
  PARAM_NOT_A_NUMBER: 'PARAM_NOT_A_NUMBER',
  PARAM_OUT_OF_RANGE: 'PARAM_OUT_OF_RANGE',
  PARAM_NOT_INTEGER: 'PARAM_NOT_INTEGER',
  PARAM_UNKNOWN_KEY: 'PARAM_UNKNOWN_KEY',
  CONFLICT_COST_GE_PRICE: 'CONFLICT_COST_GE_PRICE',
  CONFLICT_SUPPLY_CAP_ZERO: 'CONFLICT_SUPPLY_CAP_ZERO',
});

/**
 * 把单个原始输入解析为有限数字。
 * @returns {{ ok: true, value: number } | { ok: false, code: string }}
 */
function parseNumber(raw, field) {
  // null / undefined / 仅空白字符串 => 缺失
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return { ok: false, code: ERROR_CODES.PARAM_MISSING };
  }
  // 布尔值不是合法数字输入
  if (typeof raw === 'boolean') {
    return { ok: false, code: ERROR_CODES.PARAM_NOT_A_NUMBER };
  }
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) {
    return { ok: false, code: ERROR_CODES.PARAM_NOT_A_NUMBER };
  }
  return { ok: true, value };
}

function explain(code, field, value) {
  const range = `允许范围 [${field.min}, ${field.max}]${field.unit ? ' ' + field.unit : ''}`;
  switch (code) {
    case ERROR_CODES.PARAM_MISSING:
      return `「${field.label}」缺失：该参数为必填项，请补全后再运行推演。`;
    case ERROR_CODES.PARAM_NOT_A_NUMBER:
      return `「${field.label}」格式非法：收到 ${JSON.stringify(value)}，需要一个有限数字。`;
    case ERROR_CODES.PARAM_OUT_OF_RANGE:
      return `「${field.label}」超出范围：当前值 ${value}，${range}。`;
    case ERROR_CODES.PARAM_NOT_INTEGER:
      return `「${field.label}」必须为整数：${field.unit} 不能取小数，当前值 ${value}。`;
    default:
      return `「${field.label}」校验失败。`;
  }
}

/**
 * 校验原始参数对象。
 * @param {Record<string, unknown>} raw 表单/接口传入的原始值（允许数字字符串）
 * @returns {{ ok: boolean, errors: Array<{code:string, field:string, message:string}>, params: Record<string, number>|null }}
 */
export function validateParams(raw) {
  const errors = [];
  const parsed = {};

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      errors: [
        {
          code: ERROR_CODES.PARAM_MISSING,
          field: '*',
          message: '参数体缺失或格式非法：需要一个包含全部必填字段的对象。',
        },
      ],
      params: null,
    };
  }

  // 未知字段：阻断并指明，避免拼写错误被静默吞掉。
  for (const key of Object.keys(raw)) {
    if (!PARAM_KEYS.includes(key)) {
      errors.push({
        code: ERROR_CODES.PARAM_UNKNOWN_KEY,
        field: key,
        message: `存在未知参数「${key}」：仅允许 ${PARAM_KEYS.join('、')}。`,
      });
    }
  }

  for (const field of PARAM_FIELDS) {
    const result = parseNumber(raw[field.key], field);
    if (!result.ok) {
      errors.push({
        code: result.code,
        field: field.key,
        message: explain(result.code, field, raw[field.key]),
      });
      continue;
    }
    const value = result.value;
    if (value < field.min || value > field.max) {
      errors.push({
        code: ERROR_CODES.PARAM_OUT_OF_RANGE,
        field: field.key,
        message: explain(ERROR_CODES.PARAM_OUT_OF_RANGE, field, value),
      });
      continue;
    }
    if (field.precision === 0 && !Number.isInteger(value)) {
      errors.push({
        code: ERROR_CODES.PARAM_NOT_INTEGER,
        field: field.key,
        message: explain(ERROR_CODES.PARAM_NOT_INTEGER, field, value),
      });
      continue;
    }
    parsed[field.key] = value;
  }

  // 跨字段业务冲突（仅在单字段校验通过后再判定，避免错误叠加噪音）。
  if (PARAM_KEYS.every((k) => Object.prototype.hasOwnProperty.call(parsed, k))) {
    if (parsed.unitVariableCost >= parsed.price) {
      errors.push({
        code: ERROR_CODES.CONFLICT_COST_GE_PRICE,
        field: 'unitVariableCost',
        message:
          `输入冲突：单位变动成本（${parsed.unitVariableCost} 元/件）大于或等于售价` +
          `（${parsed.price} 元/件），单位边际贡献 ≤ 0，任何销量都无法盈利，请调整价格或成本。`,
      });
    }
    if (parsed.supplyCap === 0) {
      errors.push({
        code: ERROR_CODES.CONFLICT_SUPPLY_CAP_ZERO,
        field: 'supplyCap',
        message: '输入冲突：供给上限为 0 件，推演周期内不存在任何成交可能，请放宽供给约束。',
      });
    }
  }

  return { ok: errors.length === 0, errors, params: errors.length === 0 ? parsed : null };
}
