import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMove, getAllLegalMoves, createGame, type Move, type ServerMsg } from '@anqi/engine';
import { Hub, type Conn } from '../src';

function client(hub: Hub, name: string) {
  const inbox: ServerMsg[] = [];
  const conn: Conn = { send: (m) => inbox.push(m), close: () => {} };
  const h = hub.connect(conn);
  let clientId: string | undefined;
  const api = {
    inbox,
    conn,
    send: (m: any) => h.onMessage(m),
    close: () => h.onClose(),
    hello: () => {
      h.onMessage({ t: 'hello', name, clientId });
      clientId = (inbox.find((m) => m.t === 'welcome') as any)?.clientId ?? clientId;
    },
    last: <T extends ServerMsg['t']>(t: T) =>
      [...inbox].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined,
    clear: () => (inbox.length = 0),
    get id() {
      return clientId;
    },
  };
  api.hello();
  return api;
}

function startGame(hub: Hub) {
  const a = client(hub, 'A');
  const b = client(hub, 'B');
  a.send({ t: 'create' });
  const roomId = a.last('waiting')!.roomId;
  b.send({ t: 'join', roomId });
  const ga = a.last('game')!;
  const gb = b.last('game')!;
  return { a, b, ga, gb, roomId };
}


describe('Hub', () => {
  let hub: Hub;
  beforeEach(() => {
    vi.useFakeTimers();
    hub = new Hub({ playingGraceMs: 1000, idleGraceMs: 5000 });
  });
  afterEach(() => vi.useRealTimers());

  describe('悔棋', () => {
    function play(n: number) {
      const { a, b, ga } = startGame(hub);
      const red = ga.you === 'red' ? a : b;
      const black = red === a ? b : a;
      let st = createGame(ga.seed, 'red');
      const moves: Move[] = [];
      for (let i = 0; i < n; i++) {
        const m = getAllLegalMoves(st)[0];
        (i % 2 === 0 ? red : black).send({ t: 'move', move: m });
        st = applyMove(st, m).state;
        moves.push(m);
      }
      return { red, black, seed: ga.seed, moves };
    }

    it('没走过棋不能悔棋', () => {
      const { black } = play(1);
      black.send({ t: 'undo_offer' });
      expect(black.last('error')).toBeDefined();
    });

    it('同意后撤回自己刚走的一步，并可重新走', () => {
      const { red, black, seed, moves } = play(1);
      red.send({ t: 'undo_offer' });
      expect(black.last('undo_offer')).toBeDefined();
      black.send({ t: 'undo_reply', accept: true });
      expect(red.last('undo')!.count).toBe(1);
      expect(black.last('undo')!.count).toBe(1);
      red.clear();
      red.send({ t: 'move', move: moves[0] });
      expect(red.last('error')).toBeUndefined();
      expect(seed).toBeTypeOf('number');
    });

    it('对方已应对时撤回两步；拒绝则不变', () => {
      const { red, black } = play(2);
      red.send({ t: 'undo_offer' });
      black.send({ t: 'undo_reply', accept: false });
      expect(red.last('undo_declined')).toBeDefined();
      expect(red.last('undo')).toBeUndefined();
      red.send({ t: 'undo_offer' });
      black.send({ t: 'undo_reply', accept: true });
      expect(red.last('undo')!.count).toBe(2);
    });

    it('自己不能同意自己的悔棋请求', () => {
      const { red } = play(1);
      red.send({ t: 'undo_offer' });
      red.send({ t: 'undo_reply', accept: true });
      expect(red.last('error')).toBeDefined();
    });
  });

  it('新玩家收到大厅，创建房间后其他人在大厅看到', () => {
    const a = client(hub, 'A');
    const b = client(hub, 'B');
    expect(b.last('lobby')!.rooms).toEqual([]);
    a.send({ t: 'create' });
    const rooms = b.last('lobby')!.rooms;
    expect(rooms).toHaveLength(1);
    expect(rooms[0].hostName).toBe('A');
  });

  it('加入后双方开局：颜色相反、seed 相同、从大厅消失', () => {
    const c = client(hub, 'C');
    const { ga, gb } = startGame(hub);
    expect(ga.you).not.toBe(gb.you);
    expect(ga.seed).toBe(gb.seed);
    expect(ga.first).toBe(gb.first);
    expect(ga.opponentName).toBe('B');
    expect(c.last('lobby')!.rooms).toEqual([]);
  });

  it('只有轮到的一方能走，走法广播给双方', () => {
    const { a, b, ga, gb } = startGame(hub);
    const first = ga.first;
    const [mover, other] = ga.you === first ? [a, b] : [b, a];
    const state = createGame(ga.seed, ga.first);
    const move = getAllLegalMoves(state)[0];

    other.send({ t: 'move', move });
    expect(other.last('error')?.message).toBe('还没轮到你');

    mover.clear();
    other.clear();
    mover.send({ t: 'move', move });
    expect(mover.last('move')!.move).toEqual(move);
    expect(other.last('move')!.move).toEqual(move);
  });

  it('非法走法被拒绝', () => {
    const { a, b, ga } = startGame(hub);
    const mover = ga.you === ga.first ? a : b;
    mover.send({ t: 'move', move: { from: { x: 0, y: 0 }, to: { x: 8, y: 9 } } });
    expect(mover.last('error')?.message).toBe('非法走法');
    mover.send({ t: 'move', move: { from: 'x', to: null } });
    expect(mover.last('error')?.message).toBe('走法格式错误');
  });

  it('认输：对方获胜', () => {
    const { a, b, ga } = startGame(hub);
    a.send({ t: 'resign' });
    const end = b.last('end')!;
    expect(end.reason).toBe('resign');
    expect(end.winner).not.toBe(ga.you);
  });

  it('和棋：请求、拒绝、再请求并接受', () => {
    const { a, b } = startGame(hub);
    a.send({ t: 'draw_offer' });
    expect(b.last('draw_offer')).toBeDefined();
    b.send({ t: 'draw_reply', accept: false });
    expect(a.last('draw_declined')).toBeDefined();
    a.send({ t: 'draw_offer' });
    b.send({ t: 'draw_reply', accept: true });
    expect(a.last('end')).toMatchObject({ winner: null, reason: 'draw' });
  });

  it('掉线后重连：恢复同一局，已走棋谱完整', () => {
    const { a, b, ga } = startGame(hub);
    const mover = ga.you === ga.first ? a : b;
    const state = createGame(ga.seed, ga.first);
    const move = getAllLegalMoves(state)[0];
    mover.send({ t: 'move', move });

    b.close();
    expect(a.last('opponent')).toEqual({ t: 'opponent', online: false });

    const b2 = client(hub, 'B'); // 新连接，但带不上旧 id
    b2.send({ t: 'hello', name: 'B', clientId: b.id });
    const g = b2.last('game')!;
    expect(g.seed).toBe(ga.seed);
    expect(g.moves).toEqual([move]);
    expect(a.last('opponent')).toEqual({ t: 'opponent', online: true });
  });

  it('掉线超时判负', () => {
    const { a, b, ga } = startGame(hub);
    b.close();
    vi.advanceTimersByTime(1500);
    const end = a.last('end')!;
    expect(end.reason).toBe('timeout');
    expect(end.winner).toBe(ga.you);
  });

  it('等待中的房主离开，房间从大厅消失', () => {
    const a = client(hub, 'A');
    const b = client(hub, 'B');
    a.send({ t: 'create' });
    a.send({ t: 'leave' });
    expect(b.last('lobby')!.rooms).toEqual([]);
    expect(hub.stats().rooms).toBe(0);
  });

  it('对局中离开等于认输', () => {
    const { a, b, ga } = startGame(hub);
    a.send({ t: 'leave' });
    expect(b.last('end')).toMatchObject({ reason: 'leave' });
    expect(b.last('end')!.winner).not.toBe(ga.you);
  });

  it('不能加入已开始或不存在的房间', () => {
    const { roomId } = startGame(hub);
    const c = client(hub, 'C');
    c.send({ t: 'join', roomId });
    expect(c.last('error')).toBeDefined();
    c.send({ t: 'join', roomId: 'NOPE' });
    expect(c.last('error')?.message).toContain('不存在');
  });
  it('红方永远先走（多次开局）', () => {
    for (let i = 0; i < 20; i++) {
      const h = new Hub();
      const { ga, gb } = startGame(h);
      expect(ga.first).toBe('red');
      expect(gb.first).toBe('red');
    }
  });

  it('首局红黑随机：多次开局房主两种颜色都会出现', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      seen.add(startGame(new Hub()).ga.you);
    }
    expect(seen.size).toBe(2);
  });

  describe('再来一局', () => {
    function finish() {
      const g = startGame(hub);
      g.a.send({ t: 'resign' });
      return g;
    }

    it('单方请求不会开局，只通知对方', () => {
      const { a, b } = finish();
      a.send({ t: 'rematch' });
      expect(b.last('rematch_offer')).toBeDefined();
      expect(a.inbox.filter((m) => m.t === 'game')).toHaveLength(1); // 只有首局那一条
    });

    it('双方都同意：交换红黑、红方先走、棋谱清空', () => {
      const { a, b, ga, gb } = finish();
      a.send({ t: 'rematch' });
      b.send({ t: 'rematch' });
      const na = a.last('game')!;
      const nb = b.last('game')!;
      expect(na.you).toBe(ga.you === 'red' ? 'black' : 'red');
      expect(nb.you).toBe(gb.you === 'red' ? 'black' : 'red');
      expect(na.you).not.toBe(nb.you);
      expect(na.first).toBe('red');
      expect(na.moves).toEqual([]);
      expect(na.over).toBeNull();
      expect(na.seed).toBe(nb.seed);
    });

    it('连续多局颜色逐局交换，红方始终先走并能正常走棋', () => {
      const { a, b, ga } = startGame(hub);
      let aColor = ga.you;
      for (let round = 0; round < 3; round++) {
        const g = a.last('game')!;
        expect(g.you).toBe(aColor);
        const redPlayer = g.you === 'red' ? a : b;
        const blackPlayer = g.you === 'red' ? b : a;
        const move = getAllLegalMoves(createGame(g.seed, 'red'))[0];
        blackPlayer.send({ t: 'move', move });
        expect(blackPlayer.last('error')?.message).toBe('还没轮到你');
        redPlayer.clear();
        redPlayer.send({ t: 'move', move });
        expect(redPlayer.last('move')).toBeDefined();
        a.send({ t: 'resign' });
        a.send({ t: 'rematch' });
        b.send({ t: 'rematch' });
        aColor = aColor === 'red' ? 'black' : 'red';
      }
    });

    it('对局进行中不能请求再来一局', () => {
      const { a } = startGame(hub);
      a.send({ t: 'rematch' });
      expect(a.last('error')?.message).toBe('当前局还没结束');
    });

    it('对手离开后：通知对方，且不能再来一局', () => {
      const { a, b } = finish();
      b.send({ t: 'leave' });
      expect(a.last('opponent_left')).toBeDefined();
      a.send({ t: 'rematch' });
      expect(a.last('error')?.message).toBe('对手已离开');
    });

    it('重连时能收到对方已发起的再来一局请求', () => {
      const { a, b } = finish();
      a.send({ t: 'rematch' });
      b.close();
      const b2 = client(hub, 'B');
      b2.send({ t: 'hello', name: 'B', clientId: b.id });
      expect(b2.last('rematch_offer')).toBeDefined();
    });
  });
});
