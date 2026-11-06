// 端到端冒烟：两个客户端连真实服务器，匹配后随机对局到分出胜负
import WebSocket from 'ws';
import { applyMove, createGame, getAllLegalMoves, type GameState, type ServerMsg } from '@anqi/engine';

const URL = process.env.URL ?? 'ws://localhost:8099/ws';

function client(name: string) {
  const ws = new WebSocket(URL);
  const c = {
    name,
    ws,
    you: null as null | 'red' | 'black',
    state: null as null | GameState,
    ended: null as any,
    handlers: [] as Array<(m: ServerMsg) => void>,
    send: (m: object) => ws.send(JSON.stringify(m)),
  };
  ws.on('open', () => c.send({ t: 'hello', name }));
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString()) as ServerMsg;
    if (m.t === 'game') {
      c.you = m.you;
      c.state = createGame(m.seed, m.first);
    } else if (m.t === 'move') {
      c.state = applyMove(c.state!, m.move).state;
    } else if (m.t === 'end') c.ended = m;
    c.handlers.forEach((h) => h(m));
  });
  return c;
}

const a = client('甲');
const b = client('乙');
const rnd = (n: number) => Math.floor(Math.random() * n);

a.handlers.push((m) => {
  if (m.t === 'lobby' && m.rooms.length === 0 && !a.you) a.send({ t: 'create' });
});
b.handlers.push((m) => {
  if (m.t === 'lobby' && m.rooms.length > 0 && !b.you) b.send({ t: 'join', roomId: m.rooms[0].id });
});

let moves = 0;
function step() {
  for (const c of [a, b]) {
    if (c.state && c.you === c.state.turn && !c.ended && !c.state.winner) {
      const ms = getAllLegalMoves(c.state);
      c.send({ t: 'move', move: ms[rnd(ms.length)] });
      moves++;
    }
  }
}
for (const c of [a, b]) c.handlers.push((m) => (m.t === 'game' || m.t === 'move') && setTimeout(step, 0));

const timeout = setTimeout(() => {
  console.log('TIMEOUT moves=', moves);
  process.exit(1);
}, 20000);

const iv = setInterval(() => {
  if (a.ended && b.ended) {
    clearInterval(iv);
    clearTimeout(timeout);
    const same = JSON.stringify(a.state!.board) === JSON.stringify(b.state!.board);
    console.log(`对局结束: moves=${moves} winner=${a.ended.winner} reason=${a.ended.reason} 双方棋盘一致=${same}`);
    process.exit(same ? 0 : 2);
  }
}, 50);
