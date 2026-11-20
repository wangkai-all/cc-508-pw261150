// 确定性随机数：mulberry32（32 位种子 -> (0,1) 浮点流）。
// 同种子 + 同抽样次数 => 完全相同的序列，保证推演可重复运行、结果逐位一致。

/**
 * 构造一个 mulberry32 伪随机数生成器。
 * @param {number} seed 32 位整数种子（非整数会被截断为 32 位有符号整数）
 * @returns {() => number} 每次调用返回 [0,1) 的确定性伪随机数
 */
export function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Box–Muller：由两个均匀随机数生成标准正态样本（确定性）。
 * @param {() => number} rng
 * @returns {number} N(0,1) 样本
 */
export function gaussian(rng) {
  // 避免 log(0)：u 落在 (0,1)
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
