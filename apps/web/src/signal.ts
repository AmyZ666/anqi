/** 把 WebRTC 的 SDP 压缩成一段可放进二维码 / 复制粘贴的短文本 */

const toB64 = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(data: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream) {
  const w = stream.writable.getWriter();
  w.write(data);
  w.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

const hasCompression = typeof CompressionStream !== 'undefined';

/** 前缀 Z = deflate-raw 压缩；P = 未压缩（老浏览器兜底） */
export async function encodeSignal(desc: RTCSessionDescriptionInit): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify({ t: desc.type, s: desc.sdp }));
  if (hasCompression) return 'Z' + toB64(await pipe(raw, new CompressionStream('deflate-raw')));
  return 'P' + toB64(raw);
}

export async function decodeSignal(code: string): Promise<RTCSessionDescriptionInit> {
  const c = code.trim().replace(/\s+/g, '');
  if (c.length < 2) throw new Error('连接码为空');
  let raw: Uint8Array<ArrayBuffer>;
  try {
    const body = fromB64(c.slice(1));
    if (c[0] === 'Z') {
      if (typeof DecompressionStream === 'undefined') throw new Error('浏览器版本太旧，不支持解压连接码');
      raw = await pipe(body, new DecompressionStream('deflate-raw'));
    } else if (c[0] === 'P') raw = body;
    else throw new Error('不是有效的连接码');
  } catch (e) {
    throw e instanceof Error && /浏览器|不是有效/.test(e.message) ? e : new Error('连接码无法解析，请重新获取');
  }
  const o = JSON.parse(new TextDecoder().decode(raw));
  if ((o.t !== 'offer' && o.t !== 'answer') || typeof o.s !== 'string') throw new Error('连接码内容不正确');
  return { type: o.t, sdp: o.s };
}

/** 诊断：连接码里的候选地址是真实 IP 还是 mDNS(.local) 混淆地址 */
export async function describeSignal(code: string): Promise<{ candidates: number; mdns: boolean }> {
  const sdp = (await decodeSignal(code)).sdp ?? '';
  const lines = sdp.split(/\r?\n/).filter((l) => l.startsWith('a=candidate'));
  return { candidates: lines.length, mdns: lines.some((l) => l.includes('.local')) };
}
