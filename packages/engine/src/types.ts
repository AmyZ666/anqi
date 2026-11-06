/** 红方在下（y=9 为底线），黑方在上（y=0 为底线）。x: 0-8，y: 0-9。 */
export type Color = 'red' | 'black';

/** K 将帅 · A 士 · B 象 · N 马 · R 车 · C 炮 · P 兵卒 */
export type PieceType = 'K' | 'A' | 'B' | 'N' | 'R' | 'C' | 'P';

export interface Piece {
  type: PieceType;
  /** 真实颜色，固定不变 */
  color: Color;
  /** false = 暗子（扣着） */
  revealed: boolean;
}

export interface Pos {
  x: number;
  y: number;
}

export interface Move {
  from: Pos;
  to: Pos;
}

/** board[y][x] */
export type Board = (Piece | null)[][];

export interface GameState {
  board: Board;
  turn: Color;
  winner: Color | null;
  moveCount: number;
}

export interface MoveEvent {
  move: Move;
  /** 走动的子（走完已翻开，含真实身份） */
  piece: Piece;
  /** 本步是否把一个暗子翻开了 */
  flipped: boolean;
  /** 被吃的子（已公开真实身份），没有则为 null */
  captured: Piece | null;
}

export class IllegalMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllegalMoveError';
  }
}
