// 展示层格式化工具（纯函数，便于单测）。

export function formatNumber(value, precision = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

export function formatMoney(value, precision = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number(value).toLocaleString('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

export function formatPercent(value, precision = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${(value * 100).toLocaleString('zh-CN', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  })}%`;
}

/** 相对基线的变化量与变化率，供结果比较列使用。 */
export function delta(current, baseline) {
  if (baseline === null || baseline === undefined || !Number.isFinite(baseline)) {
    return { diff: null, pct: null };
  }
  const diff = current - baseline;
  const pct = baseline !== 0 ? diff / Math.abs(baseline) : null;
  return { diff, pct };
}

export function shortHash(hash) {
  return hash ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : '—';
}

export function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
