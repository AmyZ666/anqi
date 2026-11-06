import type { ClientMsg, ServerMsg } from '@anqi/engine';
import { Hub, type HubOptions } from '@anqi/hub';
import type { NetStatus } from './net';
import { decodeSignal, encodeSignal } from './signal';

/** main.ts 面对的统一接口：服务器版 Net、房主、客人都实现它 */
export interface Link {
  clientId: string | null;
  send(msg: ClientMsg): void;
}

const RTC_CONFIG: RTCConfiguration = { iceServers: [] }; // 同一局域网 / 热点：只用 host candidate，不需要 STUN

/** 等 ICE 收集完（非 trickle），这样一段 SDP 就包含全部候选地址 */
function iceComplete(pc: RTCPeerConnection, timeoutMs = 4000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

/**
 * 浏览器默认把本机 IP 混淆成 xxxx.local（mDNS），对端未必解析得了。
 * 页面拿到摄像头授权时浏览器会暴露真实 IP，所以收集候选地址期间先申请一下摄像头。
 * 被拒绝也没关系，退回 mDNS 地址，多数家用 Wi-Fi 仍可连通。
 */
async function withCamera<T>(fn: () => Promise<T>): Promise<T> {
  let stream: MediaStream | null = null;
  try {
    stream = (await navigator.mediaDevices?.getUserMedia?.({ video: true, audio: false })) ?? null;
  } catch {
    /* 拒绝或不可用：忽略 */
  }
  try {
    return await fn();
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

function parse<T>(data: unknown): T | null {
  if (typeof data !== 'string' || data.length > 4096) return null;
  try {
    const m = JSON.parse(data);
    return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
  } catch {
    return null;
  }
}

/** 房主：本页面内运行 Hub，自己是本地玩家，客人通过 DataChannel 接入 */
export class P2PHost implements Link {
  clientId: string | null = null;
  readonly hub: Hub;
  private local: ReturnType<Hub['connect']>;
  private pending: RTCPeerConnection | null = null;
  private active = new Set<RTCPeerConnection>();
  guestConnected = false;

  constructor(
    onMessage: (m: ServerMsg) => void,
    private onGuest: (connected: boolean) => void,
    hubOptions: HubOptions = {},
  ) {
    this.hub = new Hub(hubOptions);
    this.local = this.hub.connect({
      send: (m) => {
        if (m.t === 'welcome') this.clientId = m.clientId;
        onMessage(m);
      },
      close: () => {},
    });
  }

  send(msg: ClientMsg) {
    this.local.onMessage(msg);
  }

  /** 生成给客人的连接码（可重复调用，旧的未使用的会作废） */
  async createOffer(): Promise<string> {
    this.pending?.close();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pending = pc;
    const dc = pc.createDataChannel('anqi', { ordered: true });

    const handler = this.hub.connect({
      send: (m) => dc.readyState === 'open' && dc.send(JSON.stringify(m)),
      close: () => dc.close(),
    });
    dc.onopen = () => {
      this.active.add(pc);
      if (this.pending === pc) this.pending = null;
      this.guestConnected = true;
      this.onGuest(true);
    };
    dc.onmessage = (e) => {
      const m = parse<ClientMsg>(e.data);
      if (m) handler.onMessage(m);
    };
    const lost = () => {
      if (!this.active.delete(pc) && this.pending !== pc) return;
      handler.onClose();
      this.guestConnected = this.active.size > 0;
      this.onGuest(this.guestConnected);
    };
    dc.onclose = lost;
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') lost();
    };

    await withCamera(async () => {
      await pc.setLocalDescription(await pc.createOffer());
      await iceComplete(pc);
    });
    return encodeSignal(pc.localDescription!);
  }

  /** 填入客人回复的连接码，完成握手 */
  async acceptAnswer(code: string) {
    if (!this.pending) throw new Error('请先生成连接码');
    await this.pending.setRemoteDescription(await decodeSignal(code));
  }
}

/** 客人：连接到房主。重连时再走一遍握手即可，clientId 会让房主 Hub 认出同一个人 */
export class P2PGuest implements Link {
  clientId: string | null = localStorage.getItem('anqi.clientId.p2p');
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;

  constructor(
    private onMessage: (m: ServerMsg) => void,
    private onStatus: (s: NetStatus) => void,
    private onOpen: () => void,
  ) {}

  /** 收到房主的连接码，返回要让房主扫描的回复码 */
  async acceptOffer(code: string): Promise<string> {
    this.close();
    const offer = await decodeSignal(code);
    if (offer.type !== 'offer') throw new Error('这不是房主的连接码');
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;
    this.onStatus('connecting');
    pc.ondatachannel = (e) => {
      const dc = e.channel;
      this.dc = dc;
      dc.onopen = () => {
        this.onStatus('online');
        this.onOpen();
      };
      dc.onmessage = (ev) => {
        const m = parse<ServerMsg>(ev.data);
        if (!m) return;
        if (m.t === 'welcome') {
          this.clientId = m.clientId;
          localStorage.setItem('anqi.clientId.p2p', m.clientId);
        }
        this.onMessage(m);
      };
      dc.onclose = () => this.pc === pc && this.onStatus('offline');
    };
    pc.onconnectionstatechange = () => {
      if (this.pc === pc && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) {
        this.onStatus('offline');
      }
    };
    await withCamera(async () => {
      await pc.setRemoteDescription(offer);
      await pc.setLocalDescription(await pc.createAnswer());
      await iceComplete(pc);
    });
    return encodeSignal(pc.localDescription!);
  }

  send(msg: ClientMsg) {
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(msg));
  }

  close() {
    const pc = this.pc;
    this.pc = null;
    this.dc = null;
    pc?.close();
  }
}
