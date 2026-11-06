import { COLS, ROWS, slotSide, slotType } from './layout';
import {
  IllegalMoveError,
  type Board,
  type Color,
  type GameState,
  type Move,
  type MoveEvent,
  type Piece,
  type PieceType,
  type Pos,
} from './types';

const inBoard = (x: number, y: number) => x >= 0 && x < COLS && y >= 0 && y < ROWS;

const opponent = (c: Color): Color => (c === 'red' ? 'black' : 'red');

/**
 * 一个子"此刻按什么能力走、归谁操作"：
 * - 暗子：按所在点位的子型、所在半场的一方
 * - 明子：按真实子型、真实颜色
 */
export function effective(piece: Piece, pos: Pos): { type: PieceType; side: Color } {
  if (piece.revealed) return { type: piece.type, side: piece.color };
  const type = slotType(pos.x, pos.y);
  if (type === null || type === 'K') {
    throw new Error(`暗子不在合法点位: (${pos.x},${pos.y})`);
  }
  return { type, side: slotSide(pos.y) };
}

/** 目标格上的子能否被 side 一方吃：暗子一律可吃（含己方颜色的暗子），明子须为对方颜色 */
function capturable(target: Piece, side: Color): boolean {
  return !target.revealed || target.color !== side;
}

function inPalace(x: number, y: number, color: Color): boolean {
  if (x < 3 || x > 5) return false;
  return color === 'red' ? y >= 7 && y <= 9 : y >= 0 && y <= 2;
}

/** 伪合法落点（尚未检查飞将） */
function pseudoTargets(board: Board, pos: Pos, type: PieceType, side: Color): Pos[] {
  const { x, y } = pos;
  const out: Pos[] = [];
  const tryAdd = (nx: number, ny: number) => {
    if (!inBoard(nx, ny)) return;
    const t = board[ny][nx];
    if (t === null || capturable(t, side)) out.push({ x: nx, y: ny });
  };

  switch (type) {
    case 'K':
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (inPalace(x + dx, y + dy, side)) tryAdd(x + dx, y + dy);
      }
      break;
    case 'A': // 士：斜走一格，可出九宫
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) tryAdd(x + dx, y + dy);
      break;
    case 'B': // 象：田字，塞象眼，不限过河
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ex = x + dx;
        const ey = y + dy;
        if (inBoard(ex, ey) && board[ey][ex] === null) tryAdd(x + 2 * dx, y + 2 * dy);
      }
      break;
    case 'N': // 马：日字，蹩马腿
      for (const [dx, dy] of [
        [1, 2], [-1, 2], [1, -2], [-1, -2], [2, 1], [-2, 1], [2, -1], [-2, -1],
      ]) {
        const lx = x + (Math.abs(dx) === 2 ? Math.sign(dx) : 0);
        const ly = y + (Math.abs(dy) === 2 ? Math.sign(dy) : 0);
        if (inBoard(lx, ly) && board[ly][lx] === null) tryAdd(x + dx, y + dy);
      }
      break;
    case 'R':
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let nx = x + dx;
        let ny = y + dy;
        while (inBoard(nx, ny)) {
          const t = board[ny][nx];
          if (t === null) {
            out.push({ x: nx, y: ny });
          } else {
            if (capturable(t, side)) out.push({ x: nx, y: ny });
            break;
          }
          nx += dx;
          ny += dy;
        }
      }
      break;
    case 'C':
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let nx = x + dx;
        let ny = y + dy;
        // 不吃子：沿线到第一个障碍（炮架）为止
        while (inBoard(nx, ny) && board[ny][nx] === null) {
          out.push({ x: nx, y: ny });
          nx += dx;
          ny += dy;
        }
        // 吃子：越过炮架后的第一个子
        nx += dx;
        ny += dy;
        while (inBoard(nx, ny)) {
          const t = board[ny][nx];
          if (t !== null) {
            if (capturable(t, side)) out.push({ x: nx, y: ny });
            break;
          }
          nx += dx;
          ny += dy;
        }
      }
      break;
    case 'P': {
      // 兵：只进不退；过河（进入对方半场）后可横走
      const dy = side === 'red' ? -1 : 1;
      tryAdd(x, y + dy);
      const crossed = side === 'red' ? y <= 4 : y >= 5;
      if (crossed) {
        tryAdd(x - 1, y);
        tryAdd(x + 1, y);
      }
      break;
    }
  }
  return out;
}

/** 将帅是否在同一列且中间无子（飞将） */
function kingsFacing(board: Board): boolean {
  let red: Pos | null = null;
  let black: Pos | null = null;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const p = board[y][x];
      if (p?.type === 'K') {
        if (p.color === 'red') red = { x, y };
        else black = { x, y };
      }
    }
  }
  if (!red || !black || red.x !== black.x) return false;
  for (let y = Math.min(red.y, black.y) + 1; y < Math.max(red.y, black.y); y++) {
    if (board[y][red.x] !== null) return false;
  }
  return true;
}

/** 返回 from 处的子在当前局面下所有合法落点；非己方回合 / 无子 / 游戏已结束则为空 */
export function getLegalMoves(state: GameState, from: Pos): Pos[] {
  if (state.winner !== null) return [];
  const piece = state.board[from.y]?.[from.x];
  if (!piece) return [];
  const eff = effective(piece, from);
  if (eff.side !== state.turn) return [];

  return pseudoTargets(state.board, from, eff.type, eff.side).filter((to) => {
    const target = state.board[to.y][to.x];
    if (target?.type === 'K') return true; // 吃将直接获胜，不再检查飞将
    const next = state.board.map((row) => row.slice());
    next[to.y][to.x] = piece;
    next[from.y][from.x] = null;
    return !kingsFacing(next);
  });
}

export function getAllLegalMoves(state: GameState): Move[] {
  const moves: Move[] = [];
  if (state.winner !== null) return moves;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      for (const to of getLegalMoves(state, { x, y })) {
        moves.push({ from: { x, y }, to });
      }
    }
  }
  return moves;
}

/** 落子。非法则抛 IllegalMoveError。返回新状态（不修改入参）与事件。 */
export function applyMove(state: GameState, move: Move): { state: GameState; event: MoveEvent } {
  const legal = getLegalMoves(state, move.from);
  if (!legal.some((p) => p.x === move.to.x && p.y === move.to.y)) {
    throw new IllegalMoveError(
      `非法走法: (${move.from.x},${move.from.y}) -> (${move.to.x},${move.to.y})`,
    );
  }

  const board = state.board.map((row) => row.slice());
  const mover = board[move.from.y][move.from.x]!;
  const target = board[move.to.y][move.to.x];

  const moved: Piece = { ...mover, revealed: true };
  const captured: Piece | null = target ? { ...target, revealed: true } : null;

  board[move.to.y][move.to.x] = moved;
  board[move.from.y][move.from.x] = null;

  const next: GameState = {
    board,
    turn: opponent(state.turn),
    winner: null,
    moveCount: state.moveCount + 1,
  };

  if (captured?.type === 'K') {
    next.winner = state.turn;
  } else if (getAllLegalMoves(next).length === 0) {
    next.winner = state.turn; // 对方无子可动
  }

  return {
    state: next,
    event: { move, piece: moved, flipped: !mover.revealed, captured },
  };
}
