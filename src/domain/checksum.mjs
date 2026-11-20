// 内容指纹：规范化 JSON + SHA-256。
// 用于版本号（同输入 + 同种子 + 同抽样次数 => 同版本号，天然支持幂等确认）
// 以及版本完整性校验（回滚/引用时比对指纹，任何字节级篡改都会暴露）。

/**
 * 稳定 JSON 序列化：对象键按字典序递归排序，消除键顺序差异。
 */
export function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(',')}}`;
}

/**
 * 计算任意可序列化值的 SHA-256 十六进制摘要（使用 Web Crypto，浏览器/Node 通用）。
 */
export async function sha256Hex(value) {
  const canonical = canonicalStringify(value);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 推演结果指纹：只覆盖影响计算结果的内容（参数、种子、抽样次数、引擎版本），
 * 不含 sampledAt 等时间戳，保证同输入重复运行指纹相同。
 */
export async function fingerprintResult(result) {
  const basis = {
    params: result.params,
    seed: result.meta.seed,
    runs: result.meta.runs,
    engineVersion: result.meta.engineVersion,
  };
  return sha256Hex(basis);
}

/**
 * 完整版本记录指纹：覆盖整条记录（含确认时间、备注、结果），用于存储完整性校验。
 */
export async function fingerprintVersion(version) {
  const { checksum: _omit, ...rest } = version;
  return sha256Hex(rest);
}
