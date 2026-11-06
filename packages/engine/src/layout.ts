import type { Board, Color, GameState, Piece, PieceType, Pos } from './types';

export const COLS = 9;
export const ROWS = 10;

const BACK_RANK: PieceType[] = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'];

/** 点位所属半场：y>=5 为红方半场，否则黑方半场 */
export function slotSide(y: number): Color {
  return y >= 5 ? 'red' : 'black';
}

/** 标准开局中某个点位的子型；没有子的点位返回 null；将帅点位返回 'K' */
export function slotType(x: number, y: number): PieceType | null {
  if (y === 0 || y === 9) return BACK_RANK[x];
  if ((y === 2 || y === 7) && (x === 1 || x === 7)) return 'C';
  if ((y === 3 || y === 6) && x % 2 === 0) return 'P';
  return null;
}

/** 30 个可被打乱的点位（不含将帅），顺序固定：按 y 再按 x */
export const SLOTS: readonly Pos[] = (() => {
  const out: Pos[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = slotType(x, y);
      if (t !== null && t !== 'K') out.push({ x, y });
    }
  }
  return out;
})();

/** 每方 15 个非将帅子，顺序固定（打乱前的规范顺序） */
function canonicalPieces(): Piece[] {
  const types: PieceType[] = [
    'A', 'A', 'B', 'B', 'N', 'N', 'R', 'R', 'C', 'C', 'P', 'P', 'P', 'P', 'P',
  ];
  const out: Piece[] = [];
  for (const color of ['red', 'black'] as Color[]) {
    for (const type of types) out.push({ type, color, revealed: false });
  }
  return out;
}

/**
 * mulberry32：32 位整数 PRNG。各端（TS / Kotlin / Swift）必须逐位一致。
 * 返回 [0,1) 的浮点数。
 */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates，从后往前，j = floor(rand * (i+1)) */
export function shuffle<T>(arr: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array<Piece | null>(COLS).fill(null));
}

/** 用 seed 生成开局：将帅明牌固定，其余 30 子扣着随机放入 30 个点位 */
export function createGame(seed: number, first: Color = 'red'): GameState {
  const board = emptyBoard();
  board[9][4] = { type: 'K', color: 'red', revealed: true };
  board[0][4] = { type: 'K', color: 'black', revealed: true };
  const pieces = shuffle(canonicalPieces(), seed);
  SLOTS.forEach((pos, i) => {
    board[pos.y][pos.x] = pieces[i];
  });
  return { board, turn: first, winner: null, moveCount: 0 };
}
