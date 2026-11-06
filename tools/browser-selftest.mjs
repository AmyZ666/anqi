// 用无头 Edge/Chrome 打开 URL，真实时间轮询 #o 文本直到 PASS/FAIL。用法: node tools/browser-selftest.mjs <url> [timeoutMs]
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:8099/#selftest';
const timeout = Number(process.argv[3] ?? 30000);
const exe =
  process.env.BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(exe, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'anqi-br-'))}`, '--no-first-run', url,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    target = list.find((t) => t.type === 'page');
  } catch {}
}
if (!target) { console.log('无法连接浏览器'); proc.kill(); process.exit(3); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.on('open', r));
let id = 0;
const pending = new Map();
ws.on('message', (d) => { const m = JSON.parse(d); pending.get(m.id)?.(m); });
const evalText = () => new Promise((res) => {
  const i = ++id; pending.set(i, (m) => res(m.result?.result?.value ?? ''));
  ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: "document.getElementById('o')?.textContent ?? ''" } }));
});

const t0 = Date.now();
let text = '';
while (Date.now() - t0 < timeout) {
  text = await evalText();
  if (/SELFTEST (PASS|FAIL)/.test(text)) break;
  await sleep(300);
}
console.log(text || '(页面无输出)');
ws.close(); proc.kill();
process.exit(/SELFTEST PASS/.test(text) ? 0 : 1);
