import { applyMove, createGame, getAllLegalMoves, type GameState, type ServerMsg } from '@anqi/engine';
import { P2PGuest, P2PHost } from './p2p';
import { decodeSignal } from './signal';

/** 同一页面内模拟房主与客人，走完整握手 + 一整局随机对局。用于无头浏览器自检（#selftest） */
export async function selfTest(out: (s: string) => void): Promise<boolean> {
  const hostMsgs: ServerMsg[] = [];
  const guestMsgs: ServerMsg[] = [];
  const waitFor = async (cond: () => boolean, what: string, ms = 8000) => {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error('超时: ' + what);
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  const host = new P2PHost((m) => hostMsgs.push(m), (c) => out(`host: guest ${c ? 'connected' : 'lost'}`));
  const guest = new P2PGuest(
    (m) => {
      guestMsgs.push(m);
      if (m.t === 'lobby' && m.rooms[0]) guest.send({ t: 'join', roomId: m.rooms[0].id });
    },
    (s) => out('guest status: ' + s),
    () => guest.send({ t: 'hello', name: '客人' }),
  );

  host.send({ t: 'hello', name: '房主' });
  host.send({ t: 'create' });
  const offer = await host.createOffer();
  out(`offer 连接码长度 ${offer.length}`);
  const sdp = (await decodeSignal(offer)).sdp ?? '';
  const cands = sdp.split(/\r?\n/).filter((l) => l.startsWith('a=candidate'));
  for (const c of cands) out('  候选: ' + c.split(' ').slice(4, 8).join(' '));
  const answer = await guest.acceptOffer(offer);
  out(`answer 连接码长度 ${answer.length}`);
  await host.acceptAnswer(answer);

  await waitFor(() => hostMsgs.some((m) => m.t === 'game') && guestMsgs.some((m) => m.t === 'game'), '双方开局');
  const hg = hostMsgs.find((m) => m.t === 'game') as Extract<ServerMsg, { t: 'game' }>;
  const gg = guestMsgs.find((m) => m.t === 'game') as Extract<ServerMsg, { t: 'game' }>;
  out(`开局: 房主=${hg.you} 客人=${gg.you} 先手=${hg.first} 同seed=${hg.seed === gg.seed}`);

  const sides = [
    { link: host, color: hg.you, msgs: hostMsgs, state: createGame(hg.seed, hg.first) as GameState },
    { link: guest, color: gg.you, msgs: guestMsgs, state: createGame(gg.seed, gg.first) as GameState },
  ];
  let n = 0;
  let end: ServerMsg | undefined;
  while (!end) {
    const mover = sides.find((s) => s.state.turn === s.color)!;
    const moves = getAllLegalMoves(mover.state);
    const move = moves[Math.floor(Math.random() * moves.length)];
    mover.link.send({ t: 'move', move });
    n++;
    await waitFor(() => sides.every((s) => s.msgs.filter((m) => m.t === 'move').length >= n), `第 ${n} 步广播`);
    for (const s of sides) s.state = applyMove(s.state, move).state;
    end = hostMsgs.find((m) => m.t === 'end');
    if (!end && sides[0].state.winner) {
      await waitFor(() => hostMsgs.some((m) => m.t === 'end'), '结束消息');
      end = hostMsgs.find((m) => m.t === 'end');
    }
  }
  const same = JSON.stringify(sides[0].state.board) === JSON.stringify(sides[1].state.board);
  out(`对局结束 步数=${n} ${JSON.stringify(end)} 棋盘一致=${same}`);
  return same;
}
