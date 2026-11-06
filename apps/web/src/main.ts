import type { LobbyRoom, ServerMsg } from '@anqi/engine';
import { GameScreen } from './game';
import { Net, type NetStatus } from './net';
import { P2PGuest, P2PHost, type Link } from './p2p';
import { mountGuestPanel, mountHostPanel } from './p2pui';
import './style.css';

const app = document.getElementById('app')!;

/** 只有页面是从服务器（http）打开时才能连服务器；从 GitHub Pages（https）打开时浏览器禁止连 ws:// */
const serverAvailable = location.protocol === 'http:';

type Mode = 'none' | 'server' | 'host' | 'guest';
type Screen = 'home' | 'waiting' | 'game' | 'connect';

let mode: Mode = 'none';
let screen: Screen = 'home';
let link: Link | null = null;
let host: P2PHost | null = null;
let guest: P2PGuest | null = null;
let hostReady = false; // 房主已创建房间
let guestJoined = false; // 客人已发出加入请求
let disposePanel: (() => void) | null = null;

let rooms: LobbyRoom[] = [];
let waitingId = '';
let game: GameScreen | null = null;
let isLocal = false;
let netStatus: NetStatus = 'connecting';
let name = localStorage.getItem('anqi.name') ?? '';

const net = new Net(
  () => name || '玩家',
  // 服务器连接与点对点互不干扰：面对面模式下忽略服务器推来的大厅等消息
  (m) => {
    if (mode !== 'host' && mode !== 'guest') onServer(m);
  },
  (s) => {
    netStatus = s;
    if (screen === 'home') render();
  },
);

// ---------- 工具 ----------

function toast(text: string) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 2500);
}

function button(label: string, fn: () => void, cls = '') {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.onclick = fn;
  return b;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function saveName(v: string) {
  name = v.trim();
  localStorage.setItem('anqi.name', name);
  if (serverAvailable) net.send({ t: 'hello', name: name || '玩家', clientId: net.clientId ?? undefined });
}

function ensureName(input: HTMLInputElement) {
  const v = input.value.trim();
  if (!v) {
    toast('先输入昵称');
    input.focus();
    return false;
  }
  if (v !== name) saveName(v);
  return true;
}

// ---------- 服务器消息（服务器版、房主本地、客人经 DataChannel，三处共用） ----------

function onServer(m: ServerMsg) {
  switch (m.t) {
    case 'lobby':
      if (screen === 'game' && isLocal) break;
      if (mode === 'guest') {
        // 房主只有一个房间：连上后自动加入；之后再收到大厅说明房间没了
        if (!guestJoined && m.rooms.length) {
          guestJoined = true;
          link?.send({ t: 'join', roomId: m.rooms[0].id });
        } else {
          endP2P(game && !game.over ? '房主已关闭房间' : '');
        }
        break;
      }
      if (mode === 'host') {
        if (hostReady) endP2P(); // 房主自己离开了
        break;
      }
      rooms = m.rooms;
      if (screen === 'game' && game && !game.over) toast('这局已不存在');
      game = null;
      mode = 'none';
      screen = 'home';
      render();
      break;
    case 'waiting':
      if (mode === 'none' && serverAvailable) startServerMode();
      waitingId = m.roomId;
      if (mode === 'host') hostReady = true;
      screen = 'waiting';
      render();
      break;
    case 'game':
      // 刷新页面后由服务器恢复的会话：mode/link 需要补上，否则按钮发不出消息
      if (mode === 'none' && serverAvailable) startServerMode();
      isLocal = false;
      disposePanel?.();
      disposePanel = null;
      screen = 'game';
      app.innerHTML = '';
      game = new GameScreen({
        root: app,
        mode: 'online',
        you: m.you,
        seed: m.seed,
        first: m.first,
        moves: m.moves,
        opponentName: m.opponentName,
        opponentOnline: m.opponentOnline,
        over: m.over,
        onReconnect: mode === 'host' || mode === 'guest' ? startReconnect : undefined,
        actions: {
          move: (move) => link?.send({ t: 'move', move }),
          resign: () => link?.send({ t: 'resign' }),
          offerDraw: () => link?.send({ t: 'draw_offer' }),
          replyDraw: (accept) => link?.send({ t: 'draw_reply', accept }),
          offerUndo: () => link?.send({ t: 'undo_offer' }),
          replyUndo: (accept) => link?.send({ t: 'undo_reply', accept }),
          leave: () => link?.send({ t: 'leave' }),
          rematch: () => link?.send({ t: 'rematch' }),
        },
      });
      break;
    case 'move':
      game?.onMove(m.move);
      break;
    case 'end':
      game?.onEnd({ winner: m.winner, reason: m.reason });
      break;
    case 'opponent':
      game?.setOpponentOnline(m.online);
      if (m.online && screen === 'connect' && game) {
        disposePanel?.();
        disposePanel = null;
        screen = 'game';
        game.show();
      }
      break;
    case 'draw_offer':
      game?.setIncomingDraw(true);
      break;
    case 'undo_offer':
      game?.setIncomingUndo(true);
      break;
    case 'undo':
      game?.onUndo(m.count);
      break;
    case 'undo_declined':
      game?.onUndoDeclined();
      break;
    case 'rematch_offer':
      game?.onRematchOffer();
      break;
    case 'opponent_left':
      game?.onOpponentLeft();
      break;
    case 'draw_declined':
      game?.onDrawDeclined();
      break;
    case 'error':
      toast(m.message);
      game?.onError();
      break;
  }
}

// ---------- 服务器版 ----------

function startServerMode() {
  mode = 'server';
  link = net;
}

// ---------- 面对面（点对点） ----------

function startHost(input: HTMLInputElement) {
  if (!ensureName(input)) return;
  mode = 'host';
  hostReady = false;
  host = new P2PHost(
    onServer,
    (connected) => {
      if (screen === 'waiting') render();
      if (!connected && game && !game.over) game.setOpponentOnline(false);
    },
    { playingGraceMs: 30 * 60_000 }, // 重新握手要扫两次码，给足时间
  );
  link = host;
  host.send({ t: 'hello', name, clientId: host.clientId ?? undefined });
  host.send({ t: 'create' });
}

function startGuest(input: HTMLInputElement) {
  if (!ensureName(input)) return;
  mode = 'guest';
  guestJoined = false;
  guest = new P2PGuest(
    onServer,
    (s) => {
      if (s === 'offline' && game && !game.over) game.setOpponentOnline(false);
    },
    () => guest?.send({ t: 'hello', name, clientId: guest.clientId ?? undefined }),
  );
  link = guest;
  screen = 'connect';
  render();
}

/** 对局中连接断了：重新走一遍握手，Hub 会凭 clientId 认出同一个人并恢复对局 */
function startReconnect() {
  guestJoined = true; // 重连后服务器直接返回 game，不要再自动加入
  screen = 'connect';
  render();
}

function endP2P(msg = '') {
  disposePanel?.();
  disposePanel = null;
  guest?.close();
  host = null;
  guest = null;
  link = null;
  hostReady = false;
  guestJoined = false;
  game = null;
  mode = 'none';
  screen = 'home';
  if (msg) toast(msg);
  render();
}

// ---------- 本地双人（调试） ----------

function startLocal(flip = false) {
  isLocal = true;
  screen = 'game';
  app.innerHTML = '';
  game = new GameScreen({
    root: app,
    mode: 'local',
    you: null,
    flip,
    seed: Math.floor(Math.random() * 2 ** 32),
    first: 'red',
    moves: [],
    opponentName: '',
    opponentOnline: true,
    over: null,
    actions: {
      move: (move) => game?.onMove(move),
      resign: () => game?.onEnd({ winner: null, reason: 'draw' }),
      offerDraw: () => game?.onEnd({ winner: null, reason: 'draw' }),
      replyDraw: () => {},
      offerUndo: () => game?.onUndo(1),
      replyUndo: () => {},
      rematch: () => {},
      leave: () => {
        isLocal = false;
        game = null;
        screen = 'home';
        render();
      },
    },
  });
}

// ---------- 界面 ----------

function render() {
  if (screen === 'game') return;
  disposePanel?.();
  disposePanel = null;
  app.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'lobby';
  app.append(wrap);
  if (screen === 'home') renderHome(wrap);
  else if (screen === 'waiting') renderWaiting(wrap);
  else renderConnect(wrap);
}

function renderHome(wrap: HTMLElement) {
  wrap.innerHTML = `
    <h1>暗棋</h1>
    <label class="field">昵称
      <input id="name" maxlength="12" placeholder="输入你的昵称" value="${esc(name)}" />
    </label>
    <h2>面对面对战 <span class="muted">无需服务器，同一 Wi-Fi 或热点</span></h2>
    <div class="row" id="p2p"></div>`;
  const input = wrap.querySelector<HTMLInputElement>('#name')!;
  input.onchange = () => saveName(input.value);

  const p2p = wrap.querySelector('#p2p')!;
  p2p.append(
    button('我来当房主', () => startHost(input), 'primary'),
    button('加入朋友的房间', () => startGuest(input)),
  );

  if (serverAvailable) {
    const statusText = { connecting: '连接中…', online: '已连接', offline: '已断开，重连中…' }[netStatus];
    const h = document.createElement('h2');
    h.innerHTML = `服务器大厅 <span class="conn ${netStatus}">${statusText}</span>`;
    wrap.append(h);
    const create = button('创建房间', () => {
      if (!ensureName(input)) return;
      startServerMode();
      net.send({ t: 'create' });
    }, 'primary');
    create.disabled = netStatus !== 'online';
    wrap.append(create);

    const list = document.createElement('div');
    list.className = 'rooms';
    if (!rooms.length) list.innerHTML = `<p class="muted">暂无等待中的房间，创建一个吧</p>`;
    for (const r of rooms) {
      const item = document.createElement('div');
      item.className = 'room';
      item.innerHTML = `<span><b>${esc(r.hostName)}</b> 的房间 <span class="muted">${esc(r.id)}</span></span>`;
      item.append(
        button('加入', () => {
          if (!ensureName(input)) return;
          startServerMode();
          net.send({ t: 'join', roomId: r.id });
        }, 'primary'),
      );
      list.append(item);
    }
    wrap.append(list);
  }

  wrap.append(button('本地双人（调试）', () => startLocal(), 'link'));
}

function renderWaiting(wrap: HTMLElement) {
  const isHost = mode === 'host';
  wrap.innerHTML = `<h1>暗棋</h1>
    <div class="card"><p>房间 <b class="code">${esc(waitingId)}</b> 已创建</p></div>`;
  if (isHost && host) {
    if (host.guestConnected) {
      wrap.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: '对方已连接，正在开局…' }));
    } else {
      const box = document.createElement('div');
      wrap.append(box);
      disposePanel = mountHostPanel(box, host);
    }
  } else {
    wrap.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: '等待对手加入…' }));
  }
  wrap.append(button('取消', () => link?.send({ t: 'leave' }), 'link'));
}

function renderConnect(wrap: HTMLElement) {
  const reconnecting = !!game;
  wrap.innerHTML = `<h1>${reconnecting ? '重新连接' : '加入房间'}</h1>`;
  const box = document.createElement('div');
  wrap.append(box);
  if (mode === 'host' && host) disposePanel = mountHostPanel(box, host);
  else if (mode === 'guest' && guest) disposePanel = mountGuestPanel(box, guest, () => {});

  if (reconnecting) {
    wrap.append(
      button('返回对局', () => {
        disposePanel?.();
        disposePanel = null;
        screen = 'game';
        game?.show();
      }, 'link'),
    );
  } else {
    wrap.append(button('取消', () => endP2P(), 'link'));
  }
}

// ---------- 启动 ----------

document.addEventListener('visibilitychange', () => {
  if (serverAvailable && document.visibilityState === 'visible') net.reconnectIfNeeded();
});

render();
if (serverAvailable) net.connect();
if (location.hash === '#local') startLocal(); // 调试直达本地双人
if (location.hash === '#local-black') startLocal(true); // 调试：黑方视角

if (location.hash === '#selftest') {
  import('./selftest').then(async ({ selfTest }) => {
    document.body.innerHTML = '<pre id="o"></pre>';
    const o = document.getElementById('o')!;
    const log = (t: string) => (o.textContent += t + '\n');
    try {
      log((await selfTest(log)) ? 'SELFTEST PASS' : 'SELFTEST FAIL');
    } catch (e) {
      log('SELFTEST FAIL ' + (e instanceof Error ? e.message : e));
    }
  });
}
