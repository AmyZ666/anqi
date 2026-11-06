// 两个标签页走完整 UI 流程：房主生成连接码 -> 客人粘贴 -> 客人回复码 -> 房主粘贴 -> 进入对局
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:8099/';
const outDir = process.argv[3];
const exe = process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(exe, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'anqi-br-'))}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log('E2E FAIL:', m); proc.kill(); process.exit(1); };

let ver;
for (let i = 0; i < 50 && !ver; i++) { await sleep(200); try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch {} }
if (!ver) fail('浏览器没起来');

async function openTab(u) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(u)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let id = 0; const pend = new Map();
  ws.on('message', (d) => { const m = JSON.parse(d); pend.get(m.id)?.(m); });
  const call = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await call('Emulation.setDeviceMetricsOverride', { width: 430, height: 1000, deviceScaleFactor: 1, mobile: true });
  return {
    async ev(expr) { const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; },
    async until(expr, what, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await this.ev(expr); if (v) return v; await sleep(200); } fail('超时: ' + what); },
    async shot(file) { const s = await call('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(s.result.data, 'base64')); },
  };
}
const click = (label) => `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(label)}));if(!b)return false;b.click();return true})()`;
const setName = (n) => `(()=>{const i=document.getElementById('name');i.value=${JSON.stringify(n)};i.dispatchEvent(new Event('change'));return true})()`;
const fillTA = (code) => `(()=>{const t=[...document.querySelectorAll('textarea')].find(t=>!t.readOnly);t.value=${JSON.stringify(code)};return true})()`;
const readCode = `(()=>{const t=[...document.querySelectorAll('textarea')].find(t=>t.readOnly);return t&&t.value.length>50?t.value:''})()`;

const A = await openTab(url); // 房主
const B = await openTab(url + '?guest'); // 客人（同源另一标签；Hub 在房主页面里）
await sleep(1500);

await A.ev(setName('房主')); await A.ev(click('我来当房主'));
const offer = await A.until(readCode, '房主连接码');
console.log('房主连接码长度', offer.length);

await B.ev(setName('客人')); await B.ev(click('加入朋友的房间'));
await B.until(`document.querySelector('textarea')?'1':''`, '客人输入框');
await B.ev(fillTA(offer)); await B.ev(click('确认'));
const answer = await B.until(readCode, '客人回复码');
console.log('客人回复码长度', answer.length);

await A.until(click('第 2 步'), '第2步按钮');
await A.until(`document.querySelector('textarea:not([readonly])')?'1':''`, '房主输入框');
await A.ev(fillTA(answer)); await A.ev(click('确认'));

const gameText = `(()=>{const t=document.body.innerText;return t.includes('红方')||t.includes('黑方')?t:''})()`;
const ta = await A.until(gameText, '房主进入对局'); const tb = await B.until(gameText, '客人进入对局');
console.log('--- 房主页面 ---\n' + ta.split('\n').slice(0, 6).join(' | '));
console.log('--- 客人页面 ---\n' + tb.split('\n').slice(0, 6).join(' | '));
if (outDir) { await A.shot(join(outDir, 'p2p-host-game.png')); await B.shot(join(outDir, 'p2p-guest-game.png')); }
console.log('E2E PASS');
proc.kill(); process.exit(0);
