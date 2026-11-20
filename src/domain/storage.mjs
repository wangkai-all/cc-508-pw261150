// 存储层：推演沙箱（sandbox）与正式版本账本（ledger）物理隔离，使用各自独立的 key。
// - sandbox：可反复覆盖的工作草稿，永远不会被当作正式数据引用；
// - ledger：仅追加（append-only）的不可变版本记录，只有显式「确认」才会写入；
// - audit log：确认、回滚、完整性告警等事件全程留痕。
// 存储适配器通过构造函数注入：浏览器注入 localStorage 包装，测试注入内存 Map。

import { fingerprintResult, fingerprintVersion } from './checksum.mjs';

const SANDBOX_KEY = 'scenario-sim:sandbox:draft:v1';
const LEDGER_KEY = 'scenario-sim:ledger:confirmed:v1';
const AUDIT_KEY = 'scenario-sim:audit:v1';

/**
 * 浏览器 localStorage 适配器。
 * 注意：在调用时才读取 globalThis.localStorage，而不是在模块求值时捕获引用——
 * 这样同一模块实例在全局存储被替换（测试隔离、账号切换）后仍指向当前存储。
 */
export function localStorageAdapter() {
  return {
    getItem: (key) => globalThis.localStorage.getItem(key),
    setItem: (key, value) => globalThis.localStorage.setItem(key, value),
  };
}

/** 测试/CLI 用内存适配器。 */
export function memoryAdapter(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    _dump: () => Object.fromEntries(map),
  };
}

function readJson(adapter, key, fallback) {
  const raw = adapter.getItem(key);
  if (raw === null || raw === undefined || raw === '') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`存储损坏：${key} 不是合法 JSON，已阻断读取以防止脏数据进入正式流程。`);
  }
}

function writeJson(adapter, key, value) {
  adapter.setItem(key, JSON.stringify(value));
}

export class ScenarioStore {
  constructor(adapter) {
    if (!adapter || typeof adapter.getItem !== 'function' || typeof adapter.setItem !== 'function') {
      throw new Error('ScenarioStore 需要实现 getItem/setItem 的存储适配器。');
    }
    this.adapter = adapter;
  }

  // ---------- 推演沙箱（隔离区，可变草稿） ----------

  /** 保存/覆盖当前推演草稿。仅写 sandbox key，绝不触碰 ledger。 */
  saveDraft(draft) {
    const record = {
      params: draft.params,
      result: draft.result ?? null,
      updatedAt: new Date().toISOString(),
    };
    writeJson(this.adapter, SANDBOX_KEY, record);
    this.appendAudit({ type: 'DRAFT_SAVED', at: new Date().toISOString() });
    return record;
  }

  loadDraft() {
    return readJson(this.adapter, SANDBOX_KEY, null);
  }

  clearDraft() {
    writeJson(this.adapter, SANDBOX_KEY, null);
    this.appendAudit({ type: 'DRAFT_CLEARED', at: new Date().toISOString() });
  }

  // ---------- 正式版本账本（仅追加，不可变） ----------

  listVersions() {
    const ledger = readJson(this.adapter, LEDGER_KEY, { versions: [] });
    return ledger.versions;
  }

  getVersion(versionId) {
    return this.listVersions().find((v) => v.versionId === versionId) ?? null;
  }

  /**
   * 确认推演结果，生成不可变的可引用版本。
   * 阻断条件：结果缺失、内容指纹不匹配（结果被篡改）。
   * 幂等：相同参数+种子+抽样次数+引擎版本 => 相同内容指纹 => 重复确认返回同一版本，不产生重复记录。
   */
  async confirmVersion(result, note = '') {
    if (!result || !result.params || !result.meta) {
      throw new Error('确认被阻断：缺少完整的推演结果，无法生成正式版本。');
    }
    const contentChecksum = await fingerprintResult(result);

    const ledger = readJson(this.adapter, LEDGER_KEY, { versions: [] });

    const existing = ledger.versions.find((v) => v.contentChecksum === contentChecksum);
    if (existing) {
      this.appendAudit({
        type: 'CONFIRM_IDEMPOTENT_HIT',
        at: new Date().toISOString(),
        versionId: existing.versionId,
      });
      return { version: existing, duplicated: true };
    }

    const seq = ledger.versions.length + 1;
    const versionId = `v${String(seq).padStart(4, '0')}`;
    const version = {
      versionId,
      contentChecksum,
      note: String(note ?? '').slice(0, 500),
      params: result.params,
      result,
      confirmedAt: new Date().toISOString(),
    };
    version.checksum = await fingerprintVersion(version);

    ledger.versions.push(version);
    writeJson(this.adapter, LEDGER_KEY, ledger);
    this.appendAudit({
      type: 'VERSION_CONFIRMED',
      at: new Date().toISOString(),
      versionId,
      contentChecksum,
    });
    return { version, duplicated: false };
  }

  /**
   * 完整性校验：重算每条版本记录的指纹并比对；返回全部不匹配项。
   * 回滚/引用前必须调用，任何一条不通过即阻断回滚。
   */
  async verifyIntegrity() {
    const versions = this.listVersions();
    const failures = [];
    for (const version of versions) {
      const expected = version.checksum;
      const actual = await fingerprintVersion(version);
      if (expected !== actual) {
        failures.push({ versionId: version.versionId, expected, actual });
      }
    }
    return { ok: failures.length === 0, failures, checked: versions.length };
  }

  /**
   * 回滚：把指定已确认版本的参数载入推演沙箱成为新草稿。
   * 账本保持只追加、不删除、不修改——回滚的是「当前工作区指向」，不是历史。
   */
  async rollbackTo(versionId) {
    const integrity = await this.verifyIntegrity();
    if (!integrity.ok) {
      const ids = integrity.failures.map((f) => f.versionId).join('、');
      throw new Error(`回滚被阻断：版本账本完整性校验失败（${ids}），请先排查数据篡改。`);
    }
    const version = this.getVersion(versionId);
    if (!version) {
      throw new Error(`回滚被阻断：版本 ${versionId} 不存在于正式账本。`);
    }
    this.saveDraft({ params: version.params, result: version.result });
    this.appendAudit({
      type: 'ROLLBACK',
      at: new Date().toISOString(),
      versionId,
    });
    return this.loadDraft();
  }

  // ---------- 审计日志 ----------

  listAudit() {
    return readJson(this.adapter, AUDIT_KEY, []);
  }

  appendAudit(event) {
    const log = readJson(this.adapter, AUDIT_KEY, []);
    log.push(event);
    writeJson(this.adapter, AUDIT_KEY, log);
  }

  // ---------- 隔离自检 ----------

  /**
   * 返回三个存储 key 的占用情况，供 UI/测试证明 sandbox 与 ledger 物理隔离。
   */
  storageReport() {
    return {
      sandboxKey: SANDBOX_KEY,
      ledgerKey: LEDGER_KEY,
      auditKey: AUDIT_KEY,
      hasDraft: this.adapter.getItem(SANDBOX_KEY) !== null,
      versionCount: this.listVersions().length,
      auditCount: this.listAudit().length,
    };
  }
}

export const STORAGE_KEYS = Object.freeze({ SANDBOX_KEY, LEDGER_KEY, AUDIT_KEY });
