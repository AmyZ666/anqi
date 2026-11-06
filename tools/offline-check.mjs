// 验证 PWA 离线可用：先在线加载并等 Service Worker 接管，再切到离线刷新，检查页面仍能渲染
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:8099/';
const exe = process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(exe, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'anqi-br-'))}`, '--no-first-run', url], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log('OFFLINE FAIL:', m); proc.kill(); process.exit(1); };
let target;
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.on('open', r));
let id = 0; const pend = new Map();
ws.on('message', (d) => { const m = JSON.parse(d); pend.get(m.id)?.(m); });
const call = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await call('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;

await call('Network.enable'); await call('Page.enable');
await sleep(2000);
console.log('SW 支持:', await ev("'serviceWorker' in navigator"));
const ready = await ev("navigator.serviceWorker.ready.then(r=>!!r.active)");
console.log('SW 已激活:', ready);
// 再刷新一次，让 SW 接管页面
await call('Page.reload'); await sleep(2500);
console.log('SW 接管页面:', await ev('!!navigator.serviceWorker.controller'));
const cached = await ev("caches.keys().then(async ks=>{let n=0;for(const k of ks){n+=(await (await caches.open(k)).keys()).length}return n})");
console.log('缓存条目数:', cached);

await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await call('Page.reload'); await sleep(3000);
const text = await ev('document.body.innerText');
console.log('离线刷新后页面文字:', JSON.stringify((text ?? '').slice(0, 40)));
if (!text?.includes('暗棋')) fail('离线后页面没有渲染');
// 离线下点“我来当房主”不依赖服务器，应能进入等待页
console.log('OFFLINE PASS');
proc.kill(); process.exit(0);
