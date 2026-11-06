/** 浏览器与 Node 通用的随机数（基于 Web Crypto，Node 19+ 与所有现代浏览器都有 globalThis.crypto） */

/** [0, max) 的均匀随机整数，max <= 2^32 */
export function randomInt(max: number): number;
export function randomInt(min: number, max: number): number;
export function randomInt(a: number, b?: number): number {
  const [min, max] = b === undefined ? [0, a] : [a, b];
  const range = max - min;
  const buf = new Uint32Array(1);
  // 拒绝采样，避免取模偏差
  const limit = Math.floor(4294967296 / range) * range;
  let x: number;
  do {
    globalThis.crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return min + (x % range);
}

/** 随机字符串 id（不要求是标准 UUID） */
export function randomId(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function randomChars(alphabet: string, n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}
