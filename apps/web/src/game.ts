import {
  applyMove,
  createGame,
  getLegalMoves,
  type Color,
  type GameOver,
  type GameState,
  type Move,
  type MoveEvent,
  type Piece,
  type Pos,
} from '@anqi/engine';
import { pieceName, renderBoard } from './board';

export interface GameActions {
  move(m: Move): void;
  resign(): void;
  offerDraw(): void;
  replyDraw(accept: boolean): void;
  offerUndo(): void;
  replyUndo(accept: boolean): void;
  leave(): void;
  rematch(): void;
}

export interface GameOpts {
  root: HTMLElement;
  mode: 'online' | 'local';
  /** 本地模式为 null */
  you: Color | null;
  /** 仅调试：强制黑方视角（本地模式用） */
  flip?: boolean;
  seed: number;
  first: Color;
  moves: Move[];
  opponentName: string;
  opponentOnline: boolean;
  over: GameOver | null;
  actions: GameActions;
  /** 点对点模式：对方掉线时显示“重新连接”按钮 */
  onReconnect?: () => void;
}

const REASONS: Record<string, string> = {
  capture_king: '吃掉了将帅',
  no_moves: '对方无子可动',
  resign: '对方认输',
  draw: '双方同意和棋',
  timeout: '对方掉线超时',
  leave: '对方中途离开',
};

const colorName = (c: Color) => (c === 'red' ? '红' : '黑');

export class GameScreen {
  private state: GameState;
  private selected: Pos | null = null;
  private targets: Pos[] = [];
  private lastMove: Move | null = null;
  private log: string[] = [];
  private captured: Record<Color, Piece[]> = { red: [], black: [] };
  private pending = false;
  private incomingDraw = false;
  private drawSent = false;
  private incomingUndo = false;
  private undoSent = false;
  private moves: Move[] = [];
  private rematchSent = false;
  private rematchIncoming = false;
  private opponentLeft = false;
  private notice = '';
  over: GameOver | null;
  opponentOnline: boolean;

  constructor(private o: GameOpts) {
    this.state = createGame(o.seed, o.first);
    this.over = o.over;
    this.opponentOnline = o.opponentOnline;
    for (const m of o.moves) this.apply(m);
    this.render();
  }

  // ---------- 外部事件 ----------

  /** 服务器确认的一步（本人或对手） */
  onMove(m: Move) {
    this.pending = false;
    this.apply(m);
    this.render();
  }

  onEnd(over: GameOver) {
    this.over = over;
    this.incomingDraw = false;
    this.pending = false;
    this.render();
  }

  /** 从别的界面切回来时重新绘制 */
  show() {
    this.render();
  }

  setOpponentOnline(v: boolean) {
    this.opponentOnline = v;
    this.render();
  }

  setIncomingDraw(v: boolean) {
    this.incomingDraw = v;
    if (!v) this.drawSent = false;
    this.render();
  }

  onRematchOffer() {
    this.rematchIncoming = true;
    this.render();
  }

  onOpponentLeft() {
    this.opponentLeft = true;
    this.rematchIncoming = false;
    this.render();
  }

  /** 悔棋：撤回最后 count 步，从头回放 */
  onUndo(count: number) {
    const keep = this.moves.slice(0, Math.max(0, this.moves.length - count));
    this.state = createGame(this.o.seed, this.o.first);
    this.moves = [];
    this.log = [];
    this.captured = { red: [], black: [] };
    this.lastMove = null;
    this.selected = null;
    this.targets = [];
    this.pending = false;
    this.incomingUndo = false;
    this.undoSent = false;
    for (const m of keep) this.apply(m);
    this.notice = '已悔棋';
    this.render();
  }

  setIncomingUndo(v: boolean) {
    this.incomingUndo = v;
    if (!v) this.undoSent = false;
    this.render();
  }

  onUndoDeclined() {
    this.undoSent = false;
    this.notice = '对方拒绝了悔棋';
    this.render();
  }

  onDrawDeclined() {
    this.drawSent = false;
    this.notice = '对方拒绝了和棋';
    this.render();
  }

  onError() {
    this.pending = false;
    this.render();
  }

  // ---------- 内部 ----------

  private apply(m: Move) {
    const mover = this.state.turn;
    let ev: MoveEvent;
    try {
      const r = applyMove(this.state, m);
      this.state = r.state;
      ev = r.event;
    } catch {
      return; // 与服务器不一致时忽略，等待重连同步
    }
    this.moves.push(m);
    this.lastMove = m;
    this.selected = null;
    this.targets = [];
    this.notice = '';
    this.drawSent = false;
    this.incomingDraw = false;
    this.incomingUndo = false;
    this.undoSent = false;
    // 按吃子的一方归类（无论吃的是己方还是对方的子）
    if (ev.captured) this.captured[mover].push(ev.captured);
    let text = `${this.log.length + 1}. ${colorName(mover)}方：`;
    text += ev.flipped ? `暗子翻开是【${pieceName(ev.piece)}】` : pieceName(ev.piece);
    if (ev.captured) text += `，吃掉【${pieceName(ev.captured)}】`;
    this.log.push(text);
    // 本地模式由引擎判定胜负
    if (this.o.mode === 'local' && this.state.winner && !this.over) {
      this.over = {
        winner: this.state.winner,
        reason: ev.captured?.type === 'K' ? 'capture_king' : 'no_moves',
      };
    }
  }

  private myTurn() {
    if (this.over) return false;
    return this.o.mode === 'local' || this.state.turn === this.o.you;
  }

  private click(p: Pos) {
    if (!this.myTurn() || this.pending) return;
    if (this.selected && this.selected.x === p.x && this.selected.y === p.y) {
      this.selected = null;
      this.targets = [];
      this.render();
      return;
    }
    if (this.selected && this.targets.some((t) => t.x === p.x && t.y === p.y)) {
      const move = { from: this.selected, to: p };
      this.selected = null;
      this.targets = [];
      this.pending = this.o.mode === 'online';
      this.o.actions.move(move);
      if (this.o.mode === 'online') this.render();
      return;
    }
    const lm = getLegalMoves(this.state, p);
    this.selected = lm.length ? p : null;
    this.targets = lm;
    this.render();
  }

  private statusText(): string {
    const { over, o } = this;
    if (over) {
      if (over.winner === null) return `和棋（${REASONS[over.reason]}）`;
      const who =
        o.mode === 'local' ? `${colorName(over.winner)}方获胜` : over.winner === o.you ? '你赢了！' : '你输了';
      const why =
        o.mode === 'online' && over.reason === 'resign' && over.winner !== o.you ? '你认输' : REASONS[over.reason];
      return `${who}（${why}）`;
    }
    const turn = this.state.turn;
    if (o.mode === 'local') return `轮到 ${colorName(turn)}方`;
    return turn === o.you ? '轮到你走' : '等待对手…';
  }

  private render() {
    const { root, mode, you, actions } = this.o;
    root.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'game';

    const top = document.createElement('div');
    top.className = 'bar';
    const oppColor = you ? (you === 'red' ? 'black' : 'red') : 'black';
    top.innerHTML =
      mode === 'online'
        ? `<span class="dot ${this.opponentOnline ? 'on' : 'off'}"></span><b>${esc(this.o.opponentName)}</b>
           <span class="tag ${oppColor}">${colorName(oppColor)}方</span>
           <span class="grow"></span><span class="taken">${this.capturedChips(oppColor)}</span>`
        : `<b>本地双人（调试）</b><span class="grow"></span>`;
    wrap.append(top);

    wrap.append(
      renderBoard(
        {
          board: this.state.board,
          flip: this.o.flip ?? you === 'black',
          selected: this.selected,
          targets: this.targets,
          lastMove: this.lastMove,
          revealAll: !!this.over,
        },
        (p) => this.click(p),
      ),
    );

    const bottom = document.createElement('div');
    bottom.className = 'bar';
    bottom.innerHTML =
      mode === 'online'
        ? `<b>你</b><span class="tag ${you}">${colorName(you!)}方</span><span class="grow"></span>
           <span class="taken">${this.capturedChips(you!)}</span>`
        : '';
    if (mode === 'online') wrap.append(bottom);

    const status = document.createElement('div');
    status.className = 'status' + (this.over ? ' over' : this.myTurn() ? ' mine' : '');
    status.textContent = this.statusText();
    wrap.append(status);

    if (this.notice) {
      const n = document.createElement('div');
      n.className = 'notice';
      n.textContent = this.notice;
      wrap.append(n);
    }

    if (this.over && mode === 'online') {
      const msg = this.opponentLeft ? '对手已离开' : this.rematchIncoming ? '对方想再来一局，红黑将交换' : '';
      if (msg) {
        const n = document.createElement('div');
        n.className = 'notice';
        n.textContent = msg;
        wrap.append(n);
      }
    }

    if (this.incomingUndo && !this.over) {
      const b = document.createElement('div');
      b.className = 'banner';
      b.innerHTML = `<span>对方请求悔棋</span>`;
      b.append(
        btn('同意', () => {
          this.incomingUndo = false;
          actions.replyUndo(true);
        }),
        btn('拒绝', () => {
          this.incomingUndo = false;
          actions.replyUndo(false);
          this.render();
        }),
      );
      wrap.append(b);
    }

    if (this.incomingDraw && !this.over) {
      const b = document.createElement('div');
      b.className = 'banner';
      b.innerHTML = `<span>对方请求和棋</span>`;
      b.append(
        btn('同意', () => actions.replyDraw(true)),
        btn('拒绝', () => {
          this.incomingDraw = false;
          actions.replyDraw(false);
          this.render();
        }),
      );
      wrap.append(b);
    }

    const row = document.createElement('div');
    row.className = 'row';
    if (this.over) {
      if (mode === 'online' && !this.opponentLeft) {
        row.append(
          btn(
            this.rematchSent ? '等待对方同意…' : '再来一局（交换红黑）',
            () => {
              this.rematchSent = true;
              actions.rematch();
              this.render();
            },
            'primary',
            this.rematchSent,
          ),
        );
      }
      row.append(btn('返回大厅', () => actions.leave()));
    } else {
      if (mode === 'online' && !this.opponentOnline && this.o.onReconnect) {
        row.append(btn('重新连接', () => this.o.onReconnect!(), 'primary'));
      }
      row.append(
        btn(this.drawSent ? '已请求和棋' : '求和', () => {
          this.drawSent = true;
          actions.offerDraw();
          this.render();
        }, '', this.drawSent),
        btn(this.undoSent ? '已请求悔棋' : '悔棋', () => {
          if (mode === 'online') this.undoSent = true;
          actions.offerUndo();
          this.render();
        }, '', this.undoSent || this.moves.length === 0),
        btn('认输', () => confirm('确定认输吗？') && actions.resign()),
        btn('离开', () => confirm(mode === 'online' ? '中途离开将判负，确定吗？' : '结束本局？') && actions.leave()),
      );
    }
    wrap.append(row);

    const log = document.createElement('div');
    log.className = 'log';
    log.innerHTML = this.log
      .slice(-6)
      .reverse()
      .map((l) => `<div>${esc(l)}</div>`)
      .join('');
    wrap.append(log);

    root.append(wrap);
  }

  /** color 一方吃掉的子（含己方的暗子） */
  private capturedChips(color: Color) {
    const list = this.captured[color];
    if (!list.length) return '';
    return `吃：` + list.map((p) => `<i class="chip ${p.color}">${pieceName(p).slice(1)}</i>`).join('');
  }
}

function btn(label: string, fn: () => void, cls = '', disabled = false) {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.disabled = disabled;
  b.onclick = fn;
  return b;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
