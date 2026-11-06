import {
  applyMove,
  createGame,
  type ClientMsg,
  type Color,
  type EndReason,
  type GameState,
  type Move,
  type ServerMsg,
} from '@anqi/engine';
import { randomChars, randomId, randomInt } from './rand';

/** 传输层抽象：Hub 不依赖 ws，便于测试 */
export interface Conn {
  send(msg: ServerMsg): void;
  close(): void;
}

interface Session {
  id: string;
  name: string;
  conn: Conn | null;
  roomId: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Room {
  id: string;
  host: string;
  guest: string | null;
  status: 'waiting' | 'playing' | 'ended';
  colors: Record<string, Color>;
  first: Color;
  seed: number;
  state: GameState | null;
  moves: Move[];
  drawOffer: Color | null;
  /** 已请求再来一局的玩家 */
  rematch: Set<string>;
  over: { winner: Color | null; reason: EndReason } | null;
}

export interface HubOptions {
  /** 对局中掉线多久判负 */
  playingGraceMs?: number;
  /** 等待中/空闲掉线多久清理 */
  idleGraceMs?: number;
}

const ROOM_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const opposite = (c: Color): Color => (c === 'red' ? 'black' : 'red');

function validMove(m: unknown): m is Move {
  const ok = (p: any) =>
    p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.x <= 8 && p.y >= 0 && p.y <= 9;
  const mv = m as any;
  return !!mv && ok(mv.from) && ok(mv.to);
}

export class Hub {
  private sessions = new Map<string, Session>();
  private rooms = new Map<string, Room>();
  private playingGraceMs: number;
  private idleGraceMs: number;

  constructor(opts: HubOptions = {}) {
    this.playingGraceMs = opts.playingGraceMs ?? 120_000;
    this.idleGraceMs = opts.idleGraceMs ?? 600_000;
  }

  // ---------- 连接生命周期 ----------

  /** 新连接。返回的 handler 由传输层在收到消息/断开时调用 */
  connect(conn: Conn): { onMessage(msg: ClientMsg): void; onClose(): void } {
    let session: Session | null = null;
    return {
      onMessage: (msg) => {
        if (msg.t === 'hello') {
          session = this.hello(conn, msg.clientId, msg.name);
          return;
        }
        if (!session) {
          conn.send({ t: 'error', message: '请先发送 hello' });
          return;
        }
        try {
          this.handle(session, msg);
        } catch (e) {
          conn.send({ t: 'error', message: e instanceof Error ? e.message : '服务器错误' });
        }
      },
      onClose: () => {
        if (session && session.conn === conn) this.disconnected(session);
      },
    };
  }

  private hello(conn: Conn, clientId: string | undefined, rawName: string): Session {
    const name = (typeof rawName === 'string' ? rawName : '').trim().slice(0, 12) || '玩家';
    let s = clientId ? this.sessions.get(clientId) : undefined;
    if (s) {
      if (s.timer) clearTimeout(s.timer);
      s.timer = null;
      if (s.conn && s.conn !== conn) s.conn.close(); // 顶掉旧连接
      s.conn = conn;
      s.name = name;
    } else {
      s = { id: randomId(), name, conn, roomId: null, timer: null };
      this.sessions.set(s.id, s);
    }
    conn.send({ t: 'welcome', clientId: s.id });

    const room = s.roomId ? this.rooms.get(s.roomId) : undefined;
    if (room) {
      this.syncRoom(room, s);
      if (room.status === 'playing') this.notifyOpponent(room, s, { t: 'opponent', online: true });
    } else {
      s.roomId = null;
      this.sendLobby(s);
    }
    return s;
  }

  private disconnected(s: Session) {
    s.conn = null;
    const room = s.roomId ? this.rooms.get(s.roomId) : undefined;
    if (room?.status === 'playing') {
      this.notifyOpponent(room, s, { t: 'opponent', online: false });
    }
    const grace = room?.status === 'playing' ? this.playingGraceMs : this.idleGraceMs;
    s.timer = setTimeout(() => this.expire(s), grace);
  }

  private expire(s: Session) {
    s.timer = null;
    const room = s.roomId ? this.rooms.get(s.roomId) : undefined;
    if (room?.status === 'playing') {
      this.endGame(room, opposite(room.colors[s.id]), 'timeout');
    }
    this.removeFromRoom(s);
    this.sessions.delete(s.id);
    this.broadcastLobby();
  }

  // ---------- 消息处理 ----------

  private handle(s: Session, msg: ClientMsg) {
    switch (msg.t) {
      case 'create':
        return this.create(s);
      case 'join':
        return this.join(s, String(msg.roomId ?? '').toUpperCase());
      case 'leave':
        return this.leave(s);
      case 'rematch':
        return this.rematch(s);
      case 'move':
        return this.move(s, msg.move);
      case 'resign': {
        const room = this.playingRoom(s);
        return this.endGame(room, opposite(room.colors[s.id]), 'resign');
      }
      case 'draw_offer': {
        const room = this.playingRoom(s);
        room.drawOffer = room.colors[s.id];
        this.notifyOpponent(room, s, { t: 'draw_offer' });
        return;
      }
      case 'draw_reply': {
        const room = this.playingRoom(s);
        const mine = room.colors[s.id];
        if (!room.drawOffer || room.drawOffer === mine) throw new Error('没有待回复的和棋请求');
        room.drawOffer = null;
        if (msg.accept) this.endGame(room, null, 'draw');
        else this.notifyOpponent(room, s, { t: 'draw_declined' });
        return;
      }
      default:
        throw new Error('未知消息');
    }
  }

  private create(s: Session) {
    if (s.roomId) throw new Error('你已经在一个房间里了');
    let id: string;
    do {
      id = randomChars(ROOM_CHARS, 4);
    } while (this.rooms.has(id));
    const room: Room = {
      id,
      host: s.id,
      guest: null,
      status: 'waiting',
      colors: {},
      first: 'red',
      seed: 0,
      state: null,
      moves: [],
      drawOffer: null,
      rematch: new Set(),
      over: null,
    };
    this.rooms.set(id, room);
    s.roomId = id;
    this.send(s, { t: 'waiting', roomId: id });
    this.broadcastLobby();
  }

  private join(s: Session, roomId: string) {
    if (s.roomId) throw new Error('你已经在一个房间里了');
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'waiting') throw new Error('房间不存在或已开始');
    room.guest = s.id;
    s.roomId = room.id;

    // 首局红黑随机；之后每局结束交换（见 rematch）
    const hostRed = randomInt(2) === 0;
    room.colors = { [room.host]: hostRed ? 'red' : 'black', [s.id]: hostRed ? 'black' : 'red' };
    this.startGame(room);

    for (const id of [room.host, s.id]) {
      const p = this.sessions.get(id);
      if (p) this.syncRoom(room, p);
    }
    this.broadcastLobby();
  }

  /** 用当前 colors 开一局：红方永远先走，seed 重新生成 */
  private startGame(room: Room) {
    room.first = 'red';
    room.seed = randomInt(2 ** 32);
    room.state = createGame(room.seed, room.first);
    room.moves = [];
    room.drawOffer = null;
    room.rematch.clear();
    room.over = null;
    room.status = 'playing';
  }

  private rematch(s: Session) {
    const room = s.roomId ? this.rooms.get(s.roomId) : undefined;
    if (!room || room.status !== 'ended') throw new Error('当前局还没结束');
    const oppId = room.host === s.id ? room.guest : room.host;
    if (!oppId || this.sessions.get(oppId)?.roomId !== room.id) throw new Error('对手已离开');
    room.rematch.add(s.id);
    if (!room.rematch.has(oppId)) {
      this.notifyOpponent(room, s, { t: 'rematch_offer' });
      return;
    }
    // 双方都同意：交换红黑
    for (const id of Object.keys(room.colors)) room.colors[id] = opposite(room.colors[id]);
    this.startGame(room);
    for (const id of [room.host, room.guest!]) {
      const p = this.sessions.get(id);
      if (p) this.syncRoom(room, p);
    }
  }

  private leave(s: Session) {
    const room = s.roomId ? this.rooms.get(s.roomId) : undefined;
    if (room?.status === 'playing') {
      this.endGame(room, opposite(room.colors[s.id]), 'leave');
    }
    if (room && room.status !== 'waiting') this.notifyOpponent(room, s, { t: 'opponent_left' });
    this.removeFromRoom(s);
    this.sendLobby(s);
    this.broadcastLobby();
  }

  private move(s: Session, move: unknown) {
    const room = this.playingRoom(s);
    const state = room.state!;
    if (room.colors[s.id] !== state.turn) throw new Error('还没轮到你');
    if (!validMove(move)) throw new Error('走法格式错误');

    let result;
    try {
      result = applyMove(state, move);
    } catch {
      throw new Error('非法走法');
    }
    room.state = result.state;
    room.moves.push(move);
    room.drawOffer = null;
    this.broadcastRoom(room, { t: 'move', move });

    if (result.state.winner) {
      this.endGame(
        room,
        result.state.winner,
        result.event.captured?.type === 'K' ? 'capture_king' : 'no_moves',
      );
    }
  }

  // ---------- 辅助 ----------

  private playingRoom(s: Session): Room {
    const room = s.roomId ? this.rooms.get(s.roomId) : undefined;
    if (!room || room.status !== 'playing') throw new Error('当前不在对局中');
    return room;
  }

  private endGame(room: Room, winner: Color | null, reason: EndReason) {
    if (room.status !== 'playing') return;
    room.status = 'ended';
    room.over = { winner, reason };
    this.broadcastRoom(room, { t: 'end', winner, reason });
  }

  private removeFromRoom(s: Session) {
    const room = s.roomId ? this.rooms.get(s.roomId) : undefined;
    s.roomId = null;
    if (!room) return;
    const others = [room.host, room.guest].filter((id): id is string => !!id && id !== s.id);
    const stillIn = others.some((id) => this.sessions.get(id)?.roomId === room.id);
    if (!stillIn || room.status === 'waiting') this.rooms.delete(room.id);
  }

  private syncRoom(room: Room, s: Session) {
    if (room.status === 'waiting') {
      this.send(s, { t: 'waiting', roomId: room.id });
      return;
    }
    const oppId = room.host === s.id ? room.guest : room.host;
    const opp = oppId ? this.sessions.get(oppId) : undefined;
    this.send(s, {
      t: 'game',
      roomId: room.id,
      you: room.colors[s.id],
      first: room.first,
      seed: room.seed,
      opponentName: opp?.name ?? '对手',
      moves: room.moves,
      opponentOnline: !!opp?.conn,
      over: room.over,
    });
    if (room.drawOffer && room.drawOffer !== room.colors[s.id] && room.status === 'playing') {
      this.send(s, { t: 'draw_offer' });
    }
    if (room.status === 'ended') {
      if (oppId && room.rematch.has(oppId)) this.send(s, { t: 'rematch_offer' });
      if (!opp || opp.roomId !== room.id) this.send(s, { t: 'opponent_left' });
    }
  }

  private send(s: Session, msg: ServerMsg) {
    s.conn?.send(msg);
  }

  private broadcastRoom(room: Room, msg: ServerMsg) {
    for (const id of [room.host, room.guest]) {
      const p = id ? this.sessions.get(id) : undefined;
      if (p && p.roomId === room.id) this.send(p, msg);
    }
  }

  private notifyOpponent(room: Room, s: Session, msg: ServerMsg) {
    const oppId = room.host === s.id ? room.guest : room.host;
    const opp = oppId ? this.sessions.get(oppId) : undefined;
    if (opp) this.send(opp, msg);
  }

  private lobbyMsg(): ServerMsg {
    const rooms = [...this.rooms.values()]
      .filter((r) => r.status === 'waiting')
      .map((r) => ({ id: r.id, hostName: this.sessions.get(r.host)?.name ?? '玩家' }));
    return { t: 'lobby', rooms };
  }

  private sendLobby(s: Session) {
    this.send(s, this.lobbyMsg());
  }

  private broadcastLobby() {
    const msg = this.lobbyMsg();
    for (const s of this.sessions.values()) {
      if (!s.roomId) this.send(s, msg);
    }
  }

  /** 测试/监控用 */
  stats() {
    return { sessions: this.sessions.size, rooms: this.rooms.size };
  }
}
