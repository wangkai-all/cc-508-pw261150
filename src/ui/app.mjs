// 页面主控制器：表单 ↔ 域引擎 ↔ 隔离存储 的编排。
// 所有计算/校验/版本规则都在 src/domain，本文件只负责事件绑定与 DOM 渲染。

import { PARAM_FIELDS, DEFAULT_PARAMS } from '../domain/schema.mjs';
import { runScenario } from '../domain/engine.mjs';
import { ScenarioStore, localStorageAdapter } from '../domain/storage.mjs';
import { formatNumber, formatMoney, formatPercent, delta, shortHash, formatTime } from './format.mjs';
import { renderRangeChart } from './charts.mjs';

const store = new ScenarioStore(localStorageAdapter());

const state = {
  formParams: { ...DEFAULT_PARAMS },
  currentResult: null, // 最近一次成功推演结果（只在沙箱）
  baselineVersionId: store.listVersions()[0]?.versionId ?? null, // 比较基线（首个正式版本）
};

const $ = (sel) => document.querySelector(sel);

const RESULT_METRICS = [
  { key: 'unitsSold', label: '成交销量', kind: 'number', unit: '件', precision: 0 },
  { key: 'revenue', label: '营业收入', kind: 'money', precision: 0 },
  { key: 'totalCost', label: '总成本', kind: 'money', precision: 0 },
  { key: 'profit', label: '经营利润', kind: 'money', precision: 0 },
  { key: 'profitMargin', label: '利润率', kind: 'percent', precision: 2 },
  { key: 'unmetDemand', label: '供给缺口', kind: 'number', unit: '件', precision: 0 },
];

// ---------- 表单 ----------

function renderForm() {
  const groups = [];
  for (const field of PARAM_FIELDS) {
    if (!groups.some((g) => g.name === field.group)) groups.push({ name: field.group, fields: [] });
    groups.find((g) => g.name === field.group).fields.push(field);
  }
  $('#param-form').innerHTML = groups
    .map(
      (g) => `
    <fieldset class="param-group">
      <legend>${g.name}</legend>
      ${g.fields
        .map(
          (f) => `
        <label class="param-field" data-field="${f.key}">
          <span class="param-label">${f.label}<em>${f.unit} · 范围 [${f.min}, ${f.max}]</em></span>
          <input type="number" id="in-${f.key}" name="${f.key}"
                 value="${state.formParams[f.key]}"
                 min="${f.min}" max="${f.max}" step="${f.precision === 0 ? 1 : 'any'}"
                 inputmode="decimal" aria-describedby="err-${f.key}"/>
          <small class="field-hint">${f.description}</small>
          <small class="field-error" id="err-${f.key}" role="alert" hidden></small>
        </label>`
        )
        .join('')}
    </fieldset>`
    )
    .join('');

  for (const field of PARAM_FIELDS) {
    $(`#in-${field.key}`).addEventListener('input', (e) => {
      state.formParams[field.key] = e.target.value;
      clearFieldError(field.key);
    });
  }
}

function readForm() {
  const raw = {};
  for (const f of PARAM_FIELDS) raw[f.key] = $(`#in-${f.key}`).value;
  return raw;
}

function clearFieldError(key) {
  const err = $(`#err-${key}`);
  if (err) {
    err.hidden = true;
    err.textContent = '';
  }
  $(`#in-${key}`)?.classList.remove('invalid');
}

function showErrors(errors) {
  // 先清旧错误
  for (const f of PARAM_FIELDS) clearFieldError(f.key);
  for (const e of errors) {
    const err = $(`#err-${e.field}`);
    const input = $(`#in-${e.field}`);
    if (err) {
      err.textContent = e.message;
      err.hidden = false;
    }
    input?.classList.add('invalid');
  }
  $('#validation-banner').hidden = false;
  $('#validation-banner').innerHTML =
    `<strong>推演已阻断（${errors.length} 个问题）：</strong><ul>` +
    errors.map((e) => `<li><code>${e.code}</code> ${e.message}</li>`).join('') +
    '</ul><p class="banner-hint">修正全部问题后才能运行推演；阻断期间不会生成任何结果或版本。</p>';
  $('#validation-banner').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideErrors() {
  $('#validation-banner').hidden = true;
}

// ---------- 依赖关系 ----------

const DEPENDENCY_NODES = [
  { id: 'traffic', label: '流量 × 转化率' },
  { id: 'demand', label: '理论需求' },
  { id: 'supplyCap', label: '供给上限截断' },
  { id: 'unitsSold', label: '成交销量' },
  { id: 'unitContribution', label: '单位边际贡献（售价−变动成本）' },
  { id: 'revenue', label: '营业收入' },
  { id: 'totalCost', label: '总成本（变动+固定）' },
  { id: 'profit', label: '经营利润 / 利润率' },
];

function renderDependency() {
  $('#dependency-flow').innerHTML = DEPENDENCY_NODES.map(
    (n, i) =>
      `<span class="dep-node" id="dep-${n.id}">${n.label}</span>${
        i < DEPENDENCY_NODES.length - 1 ? '<span class="dep-arrow" aria-hidden="true">→</span>' : ''
      }`
  ).join('');
}

function highlightDependency(result) {
  for (const n of DEPENDENCY_NODES) $(`#dep-${n.id}`)?.classList.remove('active', 'warn');
  $('#dep-unitsSold')?.classList.add('active');
  $('#dep-profit')?.classList.add('active');
  if (result.point.supplyConstrained) {
    $('#dep-supplyCap')?.classList.add('warn');
    $('#dep-unitsSold')?.classList.add('warn');
  }
}

// ---------- 结果区 ----------

function metricFormatter(metric) {
  return (v) =>
    metric.kind === 'money'
      ? formatMoney(v)
      : metric.kind === 'percent'
        ? formatPercent(v, metric.precision)
        : formatNumber(v, metric.precision);
}

function deltaCell(current, baselineValue, formatter) {
  const d = delta(current, baselineValue);
  if (d.diff === null) return '<span class="muted">无基线</span>';
  if (Math.abs(d.diff) < 1e-9) return '<span class="delta-flat">持平</span>';
  const dir = d.diff > 0 ? 'up' : 'down';
  const arrow = d.diff > 0 ? '▲' : '▼';
  const pctTxt = d.pct === null ? '' : `（${(d.pct * 100).toFixed(1)}%）`;
  return `<span class="delta-${dir}">${arrow} ${formatter(Math.abs(d.diff))}${pctTxt}</span>`;
}

function renderResults(result) {
  const baseline = state.baselineVersionId ? store.getVersion(state.baselineVersionId) : null;
  const basePoint = baseline ? baseline.result.point : null;

  // KPI 行
  $('#kpi-row').innerHTML = RESULT_METRICS.map((m) => {
    const fmt = metricFormatter(m);
    const v = result.point[m.key];
    const iv = result.intervals[m.key];
    return `
    <div class="stat-tile">
      <span class="tile-label">${m.label}</span>
      <span class="tile-value">${fmt(v)}</span>
      <span class="tile-range">P5–P95：${fmt(iv.p05)} ~ ${fmt(iv.p95)}</span>
      <span class="tile-delta">${deltaCell(v, basePoint ? basePoint[m.key] : null, fmt)}</span>
    </div>`;
  }).join('');

  // 区间图
  const chartMetrics = RESULT_METRICS.filter((m) => result.intervals[m.key]);
  $('#range-chart').innerHTML = renderRangeChart(chartMetrics, {
    current: result.intervals,
    baseline: baseline ? baseline.result.intervals : null,
  });

  // 精确数值表（图表的 table view / relief）
  $('#interval-table tbody').innerHTML = chartMetrics
    .map((m) => {
      const fmt = metricFormatter(m);
      const iv = result.intervals[m.key];
      const biv = baseline ? baseline.result.intervals[m.key] : null;
      return `<tr>
        <th scope="row">${m.label}</th>
        <td>${fmt(result.point[m.key])}</td>
        <td>${fmt(iv.p05)}</td>
        <td>${fmt(iv.p50)}</td>
        <td>${fmt(iv.p95)}</td>
        <td>${biv ? `${fmt(biv.p05)} ~ ${fmt(biv.p95)}` : '<span class="muted">—</span>'}</td>
      </tr>`;
    })
    .join('');

  // 供给约束与保本点提示
  const p = result.point;
  $('#derived-notes').innerHTML = `
    <li>理论需求 <strong>${formatNumber(p.demand, 1)}</strong> 件，
      供给上限截断后成交 <strong>${formatNumber(p.unitsSold, 1)}</strong> 件，
      供给缺口 <strong class="${p.supplyConstrained ? 'text-warning' : ''}">${formatNumber(p.unmetDemand, 1)}</strong> 件
      ${p.supplyConstrained ? '（供给约束已生效，放大了不确定区间的下沿影响）' : '（当前未触达供给上限）'}。</li>
    <li>单位边际贡献 <strong>${formatMoney(p.unitContribution)}</strong>/件，
      保本销量 <strong>${p.breakEvenUnits === null ? '不可达（单位贡献≤0）' : formatNumber(p.breakEvenUnits, 1) + ' 件'}</strong>，
      保本状态：<strong class="${p.breakEvenAchieved ? 'text-good' : 'text-critical'}">${p.breakEvenAchieved ? '已过保本点' : '未达保本点'}</strong>。</li>
    <li>每访客收入 <strong>${formatMoney(p.revenuePerVisitor, 2)}</strong>，利润率 <strong>${formatPercent(p.profitMargin, 2)}</strong>。</li>`;

  $('#result-meta').textContent =
    `引擎 v${result.meta.engineVersion} · 种子 ${result.meta.seed} · 蒙特卡洛 ${result.meta.runs} 次 · 推演时间 ${formatTime(result.meta.sampledAt)}`;
  $('#results-panel').hidden = false;
  highlightDependency(result);
}

// ---------- 确认 / 版本 / 回滚 ----------

async function onConfirm() {
  if (!state.currentResult) return;
  const note = $('#confirm-note').value.trim();
  try {
    const { version, duplicated } = await store.confirmVersion(state.currentResult, note);
    if (!state.baselineVersionId) state.baselineVersionId = version.versionId;
    flashConfirm(duplicated, version);
    $('#confirm-note').value = '';
    renderLedger();
    renderAudit();
    renderIsolation();
    if (state.currentResult) renderResults(state.currentResult);
  } catch (err) {
    alert(`确认被阻断：${err.message}`);
  }
}

function flashConfirm(duplicated, version) {
  const el = $('#confirm-feedback');
  el.className = duplicated ? 'feedback warn' : 'feedback good';
  el.hidden = false;
  el.textContent = duplicated
    ? `幂等命中：相同内容已确认为 ${version.versionId}，未生成重复版本。`
    : `已生成可引用版本 ${version.versionId}，正式账本仅追加写入，沙箱草稿不受影响。`;
  setTimeout(() => {
    el.hidden = true;
  }, 6000);
}

function renderLedger() {
  const versions = store.listVersions();
  $('#ledger-count').textContent = versions.length;
  if (versions.length === 0) {
    $('#ledger-table tbody').innerHTML =
      '<tr><td colspan="6" class="muted center">尚无正式版本——确认推演后才会在此生成不可变、可引用的记录。</td></tr>';
    return;
  }
  $('#ledger-table tbody').innerHTML = versions
    .map((v) => {
      const isBaseline = v.versionId === state.baselineVersionId;
      return `<tr>
        <td><strong>${v.versionId}</strong>${isBaseline ? ' <span class="tag tag-blue">比较基线</span>' : ''}</td>
        <td>${formatTime(v.confirmedAt)}</td>
        <td class="mono" title="${v.contentChecksum}">${shortHash(v.contentChecksum)}</td>
        <td>${v.note || '<span class="muted">—</span>'}</td>
        <td>${formatMoney(v.result.point.profit)} / ${formatNumber(v.result.point.unitsSold, 0)} 件</td>
        <td class="actions">
          <button class="btn btn-small" data-action="rollback" data-id="${v.versionId}">回滚为草稿</button>
          <button class="btn btn-small btn-ghost" data-action="baseline" data-id="${v.versionId}">设为基线</button>
        </td>
      </tr>`;
    })
    .join('');

  $('#ledger-table').querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (btn.dataset.action === 'rollback') {
        try {
          const draft = await store.rollbackTo(id);
          state.formParams = { ...draft.params };
          renderForm();
          await runAndRender(true);
          renderAudit();
          renderIsolation();
        } catch (err) {
          alert(err.message);
        }
      } else {
        state.baselineVersionId = id;
        renderLedger();
        if (state.currentResult) renderResults(state.currentResult);
      }
    });
  });
}

function renderAudit() {
  const events = store.listAudit().slice().reverse();
  $('#audit-list').innerHTML = events.length
    ? events
        .map(
          (e) =>
            `<li><span class="mono">${formatTime(e.at)}</span> <code>${e.type}</code>${
              e.versionId ? ` → <strong>${e.versionId}</strong>` : ''
            }</li>`
        )
        .join('')
    : '<li class="muted">暂无事件。</li>';
}

function renderIsolation() {
  const report = store.storageReport();
  $('#isolation-report').innerHTML = `
    <li>沙箱 key：<code>${report.sandboxKey}</code>（草稿：${report.hasDraft ? '有' : '无'}，可反复覆盖）</li>
    <li>账本 key：<code>${report.ledgerKey}</code>（正式版本：${report.versionCount} 条，仅追加不可变）</li>
    <li>审计 key：<code>${report.auditKey}</code>（事件：${report.auditCount} 条）</li>
    <li class="text-good">两个 key 物理隔离：未确认的推演数据永远不会出现在正式账本中。</li>`;
}

// ---------- 主流程 ----------

async function runAndRender(persistDraft = true) {
  hideErrors();
  const raw = readForm();
  const out = runScenario(raw, { seed: Number($('#seed-input').value) || 42 });
  if (!out.ok) {
    showErrors(out.errors);
    return false;
  }
  state.currentResult = out.result;
  if (persistDraft) {
    store.saveDraft({ params: out.result.params, result: out.result });
    renderAudit();
    renderIsolation();
  }
  renderResults(out.result);
  return true;
}

function bindEvents() {
  $('#btn-run').addEventListener('click', () => runAndRender(true));
  $('#btn-confirm').addEventListener('click', onConfirm);
  $('#btn-reset').addEventListener('click', () => {
    state.formParams = { ...DEFAULT_PARAMS };
    renderForm();
    hideErrors();
  });
  $('#btn-verify').addEventListener('click', async () => {
    const r = await store.verifyIntegrity();
    const el = $('#verify-feedback');
    el.hidden = false;
    el.className = r.ok ? 'feedback good' : 'feedback critical';
    el.textContent = r.ok
      ? `完整性校验通过：已核对 ${r.checked} 个正式版本，全部记录指纹一致。`
      : `校验失败：${r.failures.map((f) => f.versionId).join('、')} 指纹失配，回滚已被阻断。`;
  });
  // Ctrl/Cmd+Enter 快捷运行
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runAndRender(true);
  });
}

function hydrate() {
  const draft = store.loadDraft();
  if (draft?.params) {
    state.formParams = { ...DEFAULT_PARAMS, ...draft.params };
    state.currentResult = draft.result;
  }
}

const init = () => {
  hydrate();
  renderForm();
  renderDependency();
  renderLedger();
  renderAudit();
  renderIsolation();
  bindEvents();
  if (state.currentResult) renderResults(state.currentResult);
};

init();
