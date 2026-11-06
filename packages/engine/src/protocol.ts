import type { Color, Move } from './types';

export type EndReason =
  | 'capture_king' // 吃掉将帅
  | 'no_moves' // 对方无子可动
  | 'resign' // 认输
  | 'draw' // 协商和棋
  | 'timeout' // 掉线超时
  | 'leave'; // 中途离开

export interface LobbyRoom {
  id: string;
  hostName: string;
}

export interface GameOver {
  winner: Color | null;
  reason: EndReason;
}

export type ClientMsg =
  | { t: 'hello'; clientId?: string; name: string }
  | { t: 'create' }
  | { t: 'join'; roomId: string }
  | { t: 'leave' }
  | { t: 'move'; move: Move }
  | { t: 'resign' }
  | { t: 'draw_offer' }
  | { t: 'draw_reply'; accept: boolean }
  /** 一局结束后请求再来一局；双方都请求后交换红黑重新开局 */
  | { t: 'rematch' };

export type ServerMsg =
  | { t: 'welcome'; clientId: string }
  | { t: 'lobby'; rooms: LobbyRoom[] }
  | { t: 'waiting'; roomId: string }
  /** 开局或重连时的完整同步：客户端用 seed 生成布局，再依次回放 moves */
  | {
      t: 'game';
      roomId: string;
      you: Color;
      first: Color;
      seed: number;
      opponentName: string;
      moves: Move[];
      opponentOnline: boolean;
      over: GameOver | null;
    }
  | { t: 'move'; move: Move }
  | { t: 'end'; winner: Color | null; reason: EndReason }
  | { t: 'opponent'; online: boolean }
  | { t: 'draw_offer' }
  | { t: 'draw_declined' }
  | { t: 'rematch_offer' }
  | { t: 'opponent_left' }
  | { t: 'error'; message: string };
