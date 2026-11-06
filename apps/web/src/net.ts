import type { ClientMsg, ServerMsg } from '@anqi/engine';

export type NetStatus = 'connecting' | 'online' | 'offline';

/** WebSocket 连接：自动重连，重连后用 clientId 恢复会话 */
export class Net {
  private ws: WebSocket | null = null;
  private retry = 0;
  private closed = false;
  clientId: string | null = localStorage.getItem('anqi.clientId');
  status: NetStatus = 'connecting';

  constructor(
    private getName: () => string,
    private onMessage: (m: ServerMsg) => void,
    private onStatus: (s: NetStatus) => void,
  ) {}

  connect() {
    this.closed = false;
    this.setStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('online');
      this.send({ t: 'hello', name: this.getName(), clientId: this.clientId ?? undefined });
    };
    ws.onmessage = (e) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === 'welcome') {
        this.clientId = m.clientId;
        localStorage.setItem('anqi.clientId', m.clientId);
      }
      this.onMessage(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.setStatus('offline');
      if (this.closed) return;
      const delay = Math.min(1000 * 2 ** this.retry++, 8000);
      setTimeout(() => !this.closed && this.connect(), delay);
    };
  }

  /** 手机切后台再回来时，连接可能已死但还没触发 onclose，主动检查 */
  reconnectIfNeeded() {
    if (!this.ws || this.ws.readyState > WebSocket.OPEN) {
      this.retry = 0;
      this.connect();
    }
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private setStatus(s: NetStatus) {
    this.status = s;
    this.onStatus(s);
  }
}
