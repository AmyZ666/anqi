import type { Board, Color, Piece, Pos } from '@anqi/engine';

const S = 56; // 格距
const M = 32; // 边距
const W = 8 * S + 2 * M;
const H = 9 * S + 2 * M;

const NAMES: Record<Color, Record<string, string>> = {
  red: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' },
  black: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' },
};

export const pieceName = (p: Piece) => `${p.color === 'red' ? '红' : '黑'}${NAMES[p.color][p.type]}`;

export interface BoardView {
  board: Board;
  /** 黑方视角时翻转 180°，让自己的半场在下方 */
  flip: boolean;
  selected: Pos | null;
  targets: Pos[];
  lastMove: { from: Pos; to: Pos } | null;
  /** 终局：亮出所有暗子 */
  revealAll?: boolean;
}

const ns = 'http://www.w3.org/2000/svg';

function el(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const e = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

export function renderBoard(view: BoardView, onClick: (p: Pos) => void): SVGSVGElement {
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'board' }) as SVGSVGElement;
  const px = (x: number) => M + (view.flip ? 8 - x : x) * S;
  const py = (y: number) => M + (view.flip ? 9 - y : y) * S;

  svg.append(el('rect', { x: 0, y: 0, width: W, height: H, rx: 8, fill: '#e9c98e' }));

  const line = (x1: number, y1: number, x2: number, y2: number) =>
    el('line', { x1, y1, x2, y2, stroke: '#5b3a1a', 'stroke-width': 1.5 });

  for (let y = 0; y < 10; y++) svg.append(line(M, M + y * S, M + 8 * S, M + y * S));
  for (let x = 0; x < 9; x++) {
    if (x === 0 || x === 8) svg.append(line(M + x * S, M, M + x * S, M + 9 * S));
    else {
      svg.append(line(M + x * S, M, M + x * S, M + 4 * S));
      svg.append(line(M + x * S, M + 5 * S, M + x * S, M + 9 * S));
    }
  }
  // 九宫斜线
  svg.append(line(M + 3 * S, M, M + 5 * S, M + 2 * S));
  svg.append(line(M + 5 * S, M, M + 3 * S, M + 2 * S));
  svg.append(line(M + 3 * S, M + 7 * S, M + 5 * S, M + 9 * S));
  svg.append(line(M + 5 * S, M + 7 * S, M + 3 * S, M + 9 * S));
  // 河界
  const ry = M + 4.5 * S + 9;
  svg.append(el('text', { x: M + 2 * S, y: ry, class: 'river', 'text-anchor': 'middle' }, '楚 河'));
  svg.append(el('text', { x: M + 6 * S, y: ry, class: 'river', 'text-anchor': 'middle' }, '汉 界'));

  // 上一步标记
  if (view.lastMove) {
    for (const p of [view.lastMove.from, view.lastMove.to]) {
      svg.append(
        el('rect', {
          x: px(p.x) - S / 2 + 3, y: py(p.y) - S / 2 + 3, width: S - 6, height: S - 6,
          fill: 'none', stroke: '#2f7d32', 'stroke-width': 2, 'stroke-dasharray': '6 4',
        }),
      );
    }
  }

  // 棋子
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const p = view.board[y][x];
      if (!p) continue;
      const g = el('g', {});
      const cx = px(x);
      const cy = py(y);
      const isSel = view.selected?.x === x && view.selected?.y === y;
      if (p.revealed || view.revealAll) {
        const col = p.color === 'red' ? '#c0392b' : '#1c1c1c';
        // 终局亮出的原暗子用虚线圈区分
        const unflipped = !p.revealed;
        g.append(
          el('circle', {
            cx, cy, r: 24, fill: unflipped ? '#f1e3c0' : '#fbefd0', stroke: col,
            'stroke-width': isSel ? 4 : 2.5, ...(unflipped ? { 'stroke-dasharray': '5 3' } : {}),
          }),
        );
        g.append(el('circle', { cx, cy, r: 19.5, fill: 'none', stroke: col, 'stroke-width': 1 }));
        g.append(el('text', { x: cx, y: cy + 9, class: 'piece', fill: col, 'text-anchor': 'middle' }, NAMES[p.color][p.type]));
      } else {
        g.append(el('circle', { cx, cy, r: 24, fill: '#6b8e7a', stroke: isSel ? '#000' : '#3d5a4a', 'stroke-width': isSel ? 4 : 2.5 }));
        g.append(el('circle', { cx, cy, r: 19.5, fill: 'none', stroke: '#c8dccf', 'stroke-width': 1 }));
        g.append(el('text', { x: cx, y: cy + 8, class: 'piece dark', fill: '#e6f0ea', 'text-anchor': 'middle' }, '暗'));
      }
      svg.append(g);
    }
  }

  // 可走位置
  for (const t of view.targets) {
    const occupied = view.board[t.y][t.x] !== null;
    svg.append(
      occupied
        ? el('circle', { cx: px(t.x), cy: py(t.y), r: 28, fill: 'none', stroke: '#e67e22', 'stroke-width': 3.5 })
        : el('circle', { cx: px(t.x), cy: py(t.y), r: 7, fill: '#2f7d32', opacity: 0.85 }),
    );
  }

  // 点击热区（盖在最上层）
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const hit = el('circle', { cx: px(x), cy: py(y), r: S / 2, fill: 'transparent', style: 'cursor:pointer' });
      hit.addEventListener('click', () => onClick({ x, y }));
      svg.append(hit);
    }
  }
  return svg;
}
