import type { P2PGuest, P2PHost } from './p2p';
import { qrSvg, startScanner, type Scanner } from './qr';
import { describeSignal } from './signal';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  html = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function button(label: string, fn: () => void, cls = '') {
  const b = el('button', cls);
  b.textContent = label;
  b.onclick = fn;
  return b;
}

/** 展示一段连接码：二维码 + 复制按钮 + 地址类型提示 */
async function showCode(root: HTMLElement, code: string, caption: string) {
  root.innerHTML = '';
  root.append(el('p', 'step', caption));
  const qr = el('div', 'qr');
  qr.innerHTML = await qrSvg(code);
  root.append(qr);

  const info = await describeSignal(code).catch(() => null);
  if (info?.mdns) {
    root.append(
      el(
        'p',
        'hint warn',
        '提示：当前连接码使用 .local 地址。如果对方一直连不上，请在浏览器里允许摄像头权限后重新生成。',
      ),
    );
  }

  const row = el('div', 'row');
  row.append(
    button('复制连接码', async () => {
      try {
        await navigator.clipboard.writeText(code);
        toastLike(row, '已复制');
      } catch {
        ta.select();
        toastLike(row, '请手动复制下面的文字');
      }
    }),
  );
  root.append(row);
  const ta = el('textarea', 'code');
  ta.readOnly = true;
  ta.value = code;
  ta.rows = 3;
  ta.onclick = () => ta.select();
  root.append(ta);
}

function toastLike(near: HTMLElement, text: string) {
  const t = el('span', 'inline-toast');
  t.textContent = text;
  near.append(t);
  setTimeout(() => t.remove(), 1800);
}

/** 输入一段连接码：扫码或粘贴 */
function codeInput(root: HTMLElement, label: string, onCode: (code: string) => void) {
  root.innerHTML = '';
  const area = el('div', 'scan-area');
  const status = el('p', 'hint');
  let scanner: Scanner | null = null;

  const scanBtn = button('扫描二维码', async () => {
    scanBtn.disabled = true;
    status.textContent = '正在打开摄像头…';
    scanner = await startScanner(
      area,
      (text) => {
        status.textContent = '识别成功';
        onCode(text);
      },
      (msg) => {
        status.textContent = msg;
        scanBtn.disabled = false;
      },
    );
    if (area.querySelector('video')) status.textContent = '把二维码对准画面';
  }, 'primary');

  const ta = el('textarea', 'code');
  ta.rows = 3;
  ta.placeholder = '或把收到的连接码粘贴到这里';
  const ok = button('确认', () => {
    if (ta.value.trim()) {
      scanner?.stop();
      onCode(ta.value.trim());
    }
  });

  root.append(el('p', 'step', label), scanBtn, area, status, ta, ok);
  return {
    stop: () => scanner?.stop(),
    message: (t: string) => (status.textContent = t),
    reenable: () => (scanBtn.disabled = false),
  };
}

/**
 * 房主面板：生成连接码 → 展示二维码 → 扫描/粘贴客人的回复码。
 * 连接成功后由外层通过 Hub 消息切换界面，这里只管握手。
 */
export function mountHostPanel(root: HTMLElement, host: P2PHost): () => void {
  let input: ReturnType<typeof codeInput> | null = null;
  let disposed = false;
  root.innerHTML = '';
  const codeBox = el('div', 'panel-box');
  const answerBox = el('div', 'panel-box');
  root.append(codeBox, answerBox);

  const generate = async () => {
    input?.stop();
    answerBox.innerHTML = '';
    codeBox.innerHTML = '<p class="hint">正在生成连接码…</p>';
    try {
      const code = await host.createOffer();
      if (disposed) return;
      await showCode(codeBox, code, '第 1 步：让对方扫描这个二维码（或复制连接码发给对方）');
      codeBox.append(button('重新生成', generate, 'link'));
      const next = button('第 2 步：扫描对方的回复码', () => {
        next.remove();
        input = codeInput(answerBox, '第 2 步：扫描对方手机上显示的回复二维码', async (answer) => {
          input?.message('正在连接…');
          try {
            await host.acceptAnswer(answer);
          } catch (e) {
            input?.message(e instanceof Error ? e.message : '连接码无效');
            input?.reenable();
          }
        });
      }, 'primary');
      answerBox.append(next);
    } catch (e) {
      codeBox.innerHTML = '';
      codeBox.append(el('p', 'hint warn', '生成失败：' + (e instanceof Error ? e.message : String(e))));
      codeBox.append(button('重试', generate));
    }
  };
  void generate();
  return () => {
    disposed = true;
    input?.stop();
  };
}

/** 客人面板：扫描/粘贴房主的连接码 → 展示回复二维码，等房主扫描 */
export function mountGuestPanel(root: HTMLElement, guest: P2PGuest, onFail: () => void): () => void {
  let input: ReturnType<typeof codeInput> | null = null;
  const start = () => {
    root.innerHTML = '';
    const box = el('div', 'panel-box');
    root.append(box);
    input = codeInput(box, '第 1 步：扫描房主手机上的二维码', async (offer) => {
      input?.message('正在生成回复码…');
      try {
        const answer = await guest.acceptOffer(offer);
        root.innerHTML = '';
        const out = el('div', 'panel-box');
        root.append(out);
        await showCode(out, answer, '第 2 步：让房主扫描这个回复二维码（或把回复码发给房主）');
        out.append(el('p', 'hint', '房主确认后会自动进入对局…'));
        out.append(button('重新扫描', start, 'link'));
      } catch (e) {
        input?.message(e instanceof Error ? e.message : '连接码无效');
        input?.reenable();
        onFail();
      }
    });
  };
  start();
  return () => input?.stop();
}
