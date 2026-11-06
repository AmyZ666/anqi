import { describe, expect, it } from 'vitest';
import {
  IllegalMoveError,
  SLOTS,
  applyMove,
  createGame,
  emptyBoard,
  getAllLegalMoves,
  getLegalMoves,
  type Color,
  type GameState,
  type PieceType,
} from '../src';

/** 构造自定义局面。spec: [x, y, type, color, revealed?]，默认明子 */
function makeState(
  spec: Array<[number, number, PieceType, Color, boolean?]>,
  turn: Color = 'red',
): GameState {
  const board = emptyBoard();
  for (const [x, y, type, color, revealed = true] of spec) {
    board[y][x] = { type, color, revealed };
  }
  return { board, turn, winner: null, moveCount: 0 };
}

// 双方将帅放在不同列，避免干扰
const KINGS: Array<[number, number, PieceType, Color]> = [
  [3, 9, 'K', 'red'],
  [5, 0, 'K', 'black'],
];

const targets = (s: GameState, x: number, y: number) =>
  getLegalMoves(s, { x, y })
    .map((p) => `${p.x},${p.y}`)
    .sort();

describe('开局布局', () => {
  it('30 个点位、每方 15 个暗子，将帅明牌在原位', () => {
    const s = createGame(12345);
    expect(SLOTS).toHaveLength(30);
    let dark = 0;
    const count: Record<string, number> = {};
    for (const { x, y } of SLOTS) {
      const p = s.board[y][x]!;
      expect(p.revealed).toBe(false);
      dark++;
      count[`${p.color}${p.type}`] = (count[`${p.color}${p.type}`] ?? 0) + 1;
    }
    expect(dark).toBe(30);
    for (const c of ['red', 'black']) {
      expect(count[`${c}A`]).toBe(2);
      expect(count[`${c}B`]).toBe(2);
      expect(count[`${c}N`]).toBe(2);
      expect(count[`${c}R`]).toBe(2);
      expect(count[`${c}C`]).toBe(2);
      expect(count[`${c}P`]).toBe(5);
    }
    expect(s.board[9][4]).toEqual({ type: 'K', color: 'red', revealed: true });
    expect(s.board[0][4]).toEqual({ type: 'K', color: 'black', revealed: true });
  });

  it('相同 seed 布局一致，不同 seed 不同', () => {
    expect(createGame(42)).toEqual(createGame(42));
    expect(createGame(42)).not.toEqual(createGame(43));
  });

  it('PRNG 固定向量（供其他端对照）', () => {
    const board = createGame(1).board;
    const flat = SLOTS.slice(0, 6).map(({ x, y }) => `${board[y][x]!.color[0]}${board[y][x]!.type}`);
    expect(flat).toMatchInlineSnapshot(`
      [
        "rP",
        "rP",
        "bC",
        "rP",
        "rN",
        "bA",
      ]
    `);
  });
});

describe('暗子按点位能力走，走后翻开', () => {
  it('炮位暗子按炮走', () => {
    // (1,7) 是红方炮位。放一个暗子（真实身份是黑车）在这里
    const s = makeState([...KINGS, [1, 7, 'R', 'black', false]]);
    const t = targets(s, 1, 7);
    expect(t).toContain('1,3'); // 炮可沿线移动（空棋盘不吃子）
    expect(t).toContain('8,7');
  });

  it('只有暗子所在半场的一方能操作它', () => {
    const s = makeState([...KINGS, [1, 7, 'R', 'black', false]], 'black');
    expect(targets(s, 1, 7)).toEqual([]); // 红半场的暗子，黑方不能动
  });

  it('走动后翻开为真实身份，并按真实颜色归属', () => {
    let s = makeState([...KINGS, [0, 6, 'R', 'black', false]]); // 红方兵位上藏了黑车
    const r = applyMove(s, { from: { x: 0, y: 6 }, to: { x: 0, y: 5 } });
    expect(r.event.flipped).toBe(true);
    expect(r.event.piece).toEqual({ type: 'R', color: 'black', revealed: true });
    s = r.state;
    expect(s.turn).toBe('black');
    // 现在是黑车，归黑方，黑方回合可以动
    expect(targets(s, 0, 5).length).toBeGreaterThan(0);
  });

  it('兵位暗子按所在半场的方向前进，不能后退或横走（未过河）', () => {
    const s = makeState([...KINGS, [2, 6, 'R', 'red', false]]);
    expect(targets(s, 2, 6)).toEqual(['2,5']);
  });
});

describe('各子型', () => {
  it('兵：不能后退，过河前不能横走，过河后可横走', () => {
    const before = makeState([...KINGS, [4, 5, 'P', 'red']]);
    expect(targets(before, 4, 5)).toEqual(['4,4']);
    const after = makeState([...KINGS, [4, 4, 'P', 'red']]);
    expect(targets(after, 4, 4)).toEqual(['3,4', '4,3', '5,4']);
    const black = makeState([...KINGS, [4, 5, 'P', 'black']], 'black');
    expect(targets(black, 4, 5)).toEqual(['3,5', '4,6', '5,5']);
  });

  it('马：蹩腿', () => {
    const free = makeState([...KINGS, [4, 5, 'N', 'red']]);
    expect(targets(free, 4, 5)).toHaveLength(8);
    const blocked = makeState([...KINGS, [4, 5, 'N', 'red'], [4, 4, 'P', 'red']]);
    expect(targets(blocked, 4, 5)).not.toContain('3,3');
    expect(targets(blocked, 4, 5)).not.toContain('5,3');
    expect(targets(blocked, 4, 5)).toHaveLength(6);
  });

  it('象：塞眼，可以过河', () => {
    const free = makeState([...KINGS, [4, 5, 'B', 'red']]);
    expect(targets(free, 4, 5)).toEqual(['2,3', '2,7', '6,3', '6,7']);
    const blocked = makeState([...KINGS, [4, 5, 'B', 'red'], [5, 4, 'P', 'red']]);
    expect(targets(blocked, 4, 5)).not.toContain('6,3');
  });

  it('士：斜走一格，可以出九宫', () => {
    const s = makeState([...KINGS, [4, 6, 'A', 'red']]);
    expect(targets(s, 4, 6)).toEqual(['3,5', '3,7', '5,5', '5,7']);
  });

  it('将帅：不能出九宫', () => {
    const s = makeState([[3, 9, 'K', 'red'], [5, 0, 'K', 'black']]);
    expect(targets(s, 3, 9)).toEqual(['3,8', '4,9']);
    const edge = makeState([[3, 7, 'K', 'red'], [5, 0, 'K', 'black']]);
    expect(targets(edge, 3, 7)).toEqual(['3,8', '4,7']);
  });

  it('炮：隔一子吃，不隔不能吃，暗子也能当炮架', () => {
    // (0,3) 是黑兵位，放一个暗子当炮架
    const s = makeState([
      ...KINGS,
      [0, 5, 'C', 'red'],
      [0, 3, 'P', 'red', false],
      [0, 1, 'R', 'black'],
    ]);
    const t = targets(s, 0, 5);
    expect(t).toContain('0,1'); // 隔暗子炮架吃车
    expect(t).toContain('0,4');
    expect(t).not.toContain('0,3'); // 紧邻的暗子隔着 0 个子，不能吃
  });
});

describe('吃子', () => {
  it('可以吃己方颜色的暗子（误吃），暗子身份公开', () => {
    const s = makeState([...KINGS, [1, 7, 'C', 'red', false], [1, 6, 'R', 'red']]);
    // 红方的明车在 (1,6)，旁边 (1,7) 的暗子是红炮（己方颜色），也能吃
    const r = applyMove(s, { from: { x: 1, y: 6 }, to: { x: 1, y: 7 } });
    expect(r.event.captured).toEqual({ type: 'C', color: 'red', revealed: true });
  });

  it('不能吃己方明子，可以吃对方明子', () => {
    const s = makeState([...KINGS, [1, 6, 'R', 'red'], [1, 5, 'P', 'red'], [2, 6, 'P', 'black']]);
    const t = targets(s, 1, 6);
    expect(t).not.toContain('1,5');
    expect(t).toContain('2,6');
  });

  it('暗子走动可以吃子', () => {
    const s = makeState([...KINGS, [0, 6, 'N', 'red', false], [0, 5, 'P', 'black']]);
    const r = applyMove(s, { from: { x: 0, y: 6 }, to: { x: 0, y: 5 } });
    expect(r.event.captured?.color).toBe('black');
    expect(r.event.flipped).toBe(true);
  });
});

describe('飞将与胜负', () => {
  it('走子导致将帅对面是非法的', () => {
    const s = makeState([
      [4, 9, 'K', 'red'],
      [4, 0, 'K', 'black'],
      [4, 5, 'R', 'red'],
    ]);
    // 红车是唯一挡在中间的子，不能离开这一列
    const t = targets(s, 4, 5);
    expect(t).toContain('4,4');
    expect(t).not.toContain('3,5');
  });

  it('吃掉对方将帅即获胜', () => {
    const s = makeState([[3, 9, 'K', 'red'], [5, 0, 'K', 'black'], [5, 5, 'R', 'red']]);
    const r = applyMove(s, { from: { x: 5, y: 5 }, to: { x: 5, y: 0 } });
    expect(r.state.winner).toBe('red');
    expect(getAllLegalMoves(r.state)).toEqual([]);
  });

  it('非法走法抛错，且不修改原状态', () => {
    const s = createGame(7);
    const snap = JSON.stringify(s);
    expect(() => applyMove(s, { from: { x: 0, y: 0 }, to: { x: 5, y: 5 } })).toThrow(IllegalMoveError);
    expect(JSON.stringify(s)).toBe(snap);
  });

  it('开局红方有合法走法，对局可连续推进', () => {
    let s = createGame(2024);
    expect(getAllLegalMoves(s).length).toBeGreaterThan(0);
    for (let i = 0; i < 40 && s.winner === null; i++) {
      const moves = getAllLegalMoves(s);
      const m = moves[(i * 7) % moves.length];
      s = applyMove(s, m).state;
    }
    // 子数只减不增
    let n = 0;
    for (const row of s.board) for (const p of row) if (p) n++;
    expect(n).toBeLessThanOrEqual(32);
  });
});
