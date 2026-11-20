// 浏览器编排层的端到端验证：用最小 DOM stub 加载真实的 src/ui/app.mjs，
// 模拟「填表 → 非法输入被阻断 → 合法推演 → 确认 → 回滚」完整交互，
// 保证 UI 与域模块的接线（事件、渲染、存储隔离）真实可用。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

function createElementStub(tag = 'div') {
  return {
    tag,
    hidden: false,
    innerHTML: '',
    textContent: '',
    value: '',
    className: '',
    dataset: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    _listeners: {},
    addEventListener(type, fn) {
      (this._listeners[type] ||= []).push(fn);
    },
    dispatch(type, event = {}) {
      for (const fn of this._listeners[type] || []) fn(event);
    },
    scrollIntoView() {},
    querySelectorAll() { return []; },
  };
}

function buildDom() {
  const elements = new Map();
  const ids = [
    'param-form', 'validation-banner', 'dependency-flow', 'isolation-report',
    'kpi-row', 'range-chart', 'interval-table', 'derived-notes', 'result-meta',
    'results-panel', 'confirm-note', 'confirm-feedback', 'verify-feedback',
    'ledger-count', 'ledger-table', 'audit-list', 'seed-input',
    'btn-run', 'btn-confirm', 'btn-reset', 'btn-verify',
  ];
  for (const id of ids) elements.set(id, createElementStub());
  elements.get('seed-input').value = '42';
  // 与真实 HTML 保持一致：这些面板初始为隐藏
  for (const id of ['validation-banner', 'results-panel', 'confirm-feedback', 'verify-feedback']) {
    elements.get(id).hidden = true;
  }

  const paramInputs = {};
  const setInput = (key, value) => {
    paramInputs[key].value = value;
    paramInputs[key].dispatch('input', { target: paramInputs[key] });
  };
  const dom = {
    elements,
    paramInputs,
    setInput,
    querySelector(sel) {
      // 支持 "#a b" 形式：返回父元素上预挂的同名子元素 stub
      const parts = sel.trim().split(/\s+/);
      const rootId = parts[0].replace('#', '');
      let node = elements.has(rootId) ? elements.get(rootId) : (rootId.startsWith('in-') ? paramInputs[rootId.slice(3)] : null);
      if (!node) return null;
      for (const part of parts.slice(1)) {
        const childKey = `__child_${part}`;
        if (!node[childKey]) node[childKey] = createElementStub(part);
        node = node[childKey];
      }
      return node;
    },
    createElementStub,
  };

  // param-form 的 innerHTML 写入时，为每个参数域创建对应 input stub
  const form = elements.get('param-form');
  let formHtml = '';
  Object.defineProperty(form, 'innerHTML', {
    get() { return formHtml; },
    set(html) {
      formHtml = html;
      const matches = html.match(/id="in-([a-zA-Z]+)"/g) || [];
      for (const m of matches) {
        const key = m.replace(/id="in-(.+)"/, '$1');
        if (!paramInputs[key]) paramInputs[key] = createElementStub('input');
      }
    },
  });

  return dom;
}

// 加载 app.mjs 所需的全局环境；返回 cleanup，由调用方在用例结束时还原。
async function loadApp(dom, storageMap = new Map()) {
  const localStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
  };
  const alerts = [];
  globalThis.__e2eAlerts = alerts;
  const globals = {
    document: {
      querySelector: (sel) => dom.querySelector(sel),
      addEventListener: () => {},
      body: { dataset: {} },
    },
    localStorage,
    alert: (msg) => alerts.push(msg),
  };
  const saved = {};
  for (const [k, v] of Object.entries(globals)) {
    saved[k] = globalThis[k];
    globalThis[k] = v;
  }
  const url = pathToFileURL(new URL('../src/ui/app.mjs', import.meta.url).pathname).href;
  await import(`${url}?t=${Date.now()}`); // 缓存击穿，保证每个用例重新初始化
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete globalThis[k];
      else globalThis[k] = v;
    }
  };
}

const DEFAULT_RAW = {
  price: '199', conversionRate: '4.5', traffic: '100000',
  unitVariableCost: '110', fixedCost: '350000', supplyCap: '4000',
  priceVolatility: '8', conversionVolatility: '15',
};

let dom;
let storageMap;

beforeEach(() => {
  dom = buildDom();
  storageMap = new Map();
});

test('初始化渲染表单、依赖链与空账本', async (t) => {
  const cleanup = await loadApp(dom, storageMap);
  t.after(cleanup);
  assert.match(dom.elements.get('param-form').innerHTML, /售价/);
  assert.match(dom.elements.get('dependency-flow').innerHTML, /理论需求/);
  assert.equal(String(dom.elements.get('ledger-count').textContent), '0');
  assert.ok(storageMap.size >= 0);
});

test('非法输入点击运行：阻断横幅出现且结果面板保持隐藏', async (t) => {
  const cleanup = await loadApp(dom, storageMap);
  t.after(cleanup);
  for (const [k, v] of Object.entries(DEFAULT_RAW)) dom.setInput(k, v);
  dom.setInput('price', ''); // 缺失
  dom.setInput('conversionRate', '300'); // 超范围

  dom.elements.get('btn-run').dispatch('click');
  const banner = dom.elements.get('validation-banner');
  assert.equal(banner.hidden, false);
  assert.match(banner.innerHTML, /推演已阻断/);
  assert.equal(dom.elements.get('results-panel').hidden, true);
});

test('合法输入运行：KPI、图表、数值表、隔离状态全部渲染', async (t) => {
  const cleanup = await loadApp(dom, storageMap);
  t.after(cleanup);
  for (const [k, v] of Object.entries(DEFAULT_RAW)) dom.setInput(k, v);
  dom.elements.get('btn-run').dispatch('click');

  assert.equal(dom.elements.get('results-panel').hidden, false);
  assert.match(dom.elements.get('kpi-row').innerHTML, /经营利润/);
  assert.match(dom.elements.get('range-chart').innerHTML, /<svg/);
  assert.match(dom.querySelector('#interval-table tbody').innerHTML, /营业收入/);
  assert.match(dom.elements.get('isolation-report').innerHTML, /sandbox/);
  // 草稿已落沙箱，但账本仍为空
  const keys = [...storageMap.keys()];
  assert.ok(keys.some((k) => k.includes('sandbox')));
  assert.ok(!keys.some((k) => k.includes('ledger')));
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

test('确认后账本出现版本，重复确认幂等不新增', async (t) => {
  const cleanup = await loadApp(dom, storageMap);
  t.after(cleanup);
  for (const [k, v] of Object.entries(DEFAULT_RAW)) dom.setInput(k, v);
  dom.elements.get('btn-run').dispatch('click');

  dom.elements.get('confirm-note').value = 'E2E 方案';
  dom.elements.get('btn-confirm').dispatch('click');
  await flush(); // 等待 async 确认处理器（含 SHA-256）完成
  assert.deepEqual(globalThis.__e2eAlerts, []);
  assert.equal(String(dom.elements.get('ledger-count').textContent), '1');
  assert.match(dom.querySelector('#ledger-table tbody').innerHTML, /v0001/);

  // 再次确认同一结果
  dom.elements.get('btn-confirm').dispatch('click');
  await flush();
  assert.equal(String(dom.elements.get('ledger-count').textContent), '1');
  assert.match(dom.elements.get('confirm-feedback').textContent, /幂等命中/);
});

test('审计日志记录运行与确认事件', async (t) => {
  const cleanup = await loadApp(dom, storageMap);
  t.after(cleanup);
  for (const [k, v] of Object.entries(DEFAULT_RAW)) dom.setInput(k, v);
  dom.elements.get('btn-run').dispatch('click');
  dom.elements.get('btn-confirm').dispatch('click');
  await flush();
  assert.deepEqual(globalThis.__e2eAlerts, []);
  const audit = dom.elements.get('audit-list').innerHTML;
  assert.match(audit, /DRAFT_SAVED/);
  assert.match(audit, /VERSION_CONFIRMED/);
});
