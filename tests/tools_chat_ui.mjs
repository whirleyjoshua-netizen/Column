// Chat in Tools (the owner, 2026-11-20; since 2026-11-25 also a sidebar tab, tests/chat_tab_ui.mjs: "take chat and move it into tools so that it functions like a tool opening in
// the split window ... the description only pop up when a user hovers over the tool item"): Chat isn't a sidebar tab;
// Tools lists it; it opens in the split beside the page (which stays), works there, goes back when it closes or
// another tool opens. Tools' rows show names only; a row's description shows beside it on hover.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/tools_chat_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5237, CDP = 9579, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 80 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map();
  const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(120); } return false; };
  const tap = async (expr) => {
    await until(`!!(${expr})`, 8000);
    await until(`(() => { const e = ${expr}; if (!e) return false; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && (top === e || e.contains(top)); })()`, 6000);
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(150);
  };
  const fill = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  return { ev, until, tap, fill, cmd, errors };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Talk ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');
  ok(await A.ev(`[...document.querySelectorAll('#tabs > button[data-tab]:not(.tab-sub)')].map((b) => b.dataset.tab).join() === 'home,chat,agents,work,apps'`), 'the sidebar: Home, Chat (the page; see chat_tab_ui), Agents, Workspace, Apps & Integrations');

  // Tools: names only; a description on hover.
  await A.ev(`document.querySelector('#tabs [data-tab=tools]').click(); true`);
  ok(await A.until(`!!document.querySelector('#menu [data-tool=chat]')`), 'Tools lists Chat');
  ok(await A.ev(`(() => { const rows = [...document.querySelectorAll('#menu .tool-drop-item')]; return rows.length > 3 && rows[0].dataset.tool === 'chat' && rows.every((r) => !r.querySelector('small') && r.dataset.tip); })()`), 'the rows show names only (Chat first), each with its description kept for hover');
  const [x, y] = await A.ev(`(() => { const r = document.querySelector('#menu [data-tool=inventory]').closest('button').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await A.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  ok(await A.until(`(() => { const t = document.querySelector('.tool-tip'); return t && !t.hidden && /Parts, materials and equipment/.test(t.textContent); })()`), 'hovering Inventory shows its description beside it');
  ok(await A.ev(`(() => { const t = document.querySelector('.tool-tip').getBoundingClientRect(), m = document.querySelector('#menu').getBoundingClientRect(); return t.left >= m.right - 1 || t.right <= m.left + 1; })()`), 'beside the list, not over it');
  const [x2, y2] = await A.ev(`(() => { const r = document.querySelector('#menu [data-tool=column]').closest('button').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await A.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x2, y: y2 });
  ok(await A.until(`/Cards, files and links/.test(document.querySelector('.tool-tip')?.textContent || '') && !document.querySelector('.tool-tip').hidden`), 'moving to Stacks shows Stacks’ instead');
  await A.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 600 });
  ok(await A.until(`document.querySelector('.tool-tip')?.hidden !== false`), 'and moving off hides it');

  // Chat opens in the split, beside the page.
  await A.tap(`document.querySelector('#menu [data-tool=chat]')`);
  ok(await A.until(`!!document.querySelector('#split.chat-split:not(.hidden) #chat:not(.hidden)') && document.querySelector('#split .split-title')?.textContent === 'Chat' && !!document.querySelector('#split #chat .ch-side')`), 'picking Chat opens it in the split, feeds list and all');
  ok(await A.ev(`!document.querySelector('#home').classList.contains('hidden')`), 'the page beside it stays (Home)');
  await A.tap(`document.querySelector('#split #chat textarea')`);
  await A.ev(`(() => { const ta = document.querySelector('#split #chat textarea'); ta.value = 'Hello from the split'; ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await A.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await A.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  let said = false;
  for (let i = 0; i < 40 && !said; i++) { said = (await api('GET', '/state')).items.some((it) => it.type === 'message' && it.text === 'Hello from the split'); if (!said) await sleep(150); }
  ok(said, 'a message sent from Chat in the split');
  ok(await A.until(`[...document.querySelectorAll('#split #chat .msg, #split #chat .message, #split #chat [data-id]')].some((m) => m.textContent.includes('Hello from the split'))`), 'and it shows there');

  // Another tool takes the split; Chat goes back (hidden). Closing the split, the same.
  await A.ev(`document.querySelector('#tabs [data-tab=tools]').click(); true`);
  await A.tap(`document.querySelector('#menu [data-tool=inventory]')`);
  ok(await A.until(`document.querySelector('#split .split-title')?.textContent === 'Inventory' && !document.querySelector('#split #chat') && document.querySelector('#chat').classList.contains('hidden') && !document.querySelector('#split').classList.contains('chat-split')`), 'another tool takes the split: Chat goes back, out of sight');
  await A.ev(`document.querySelector('#tabs [data-tab=tools]').click(); true`);
  await A.tap(`document.querySelector('#menu [data-tool=chat]')`);
  ok(await A.until(`!!document.querySelector('#split #chat:not(.hidden)') && /Hello from the split/.test(document.querySelector('#split #chat').textContent)`), 'Chat again: on the same feed');
  await A.tap(`document.querySelector('#split .split-close')`);
  ok(await A.until(`document.querySelector('#split').classList.contains('hidden') && document.querySelector('#chat').classList.contains('hidden') && !document.querySelector('#split #chat')`), 'closing the split puts Chat away');

  // A link to a feed (a pin) still opens it, in the split.
  const ch = (await api('POST', '/channels', { name: 'crew' }))?.channels?.find?.((c) => c.name === 'crew') || (await api('GET', '/state')).workspace.channels.find((c) => c.name === 'crew');
  if (ch) {
    await api('PUT', '/account/pins', { pins: [{ go: 'chan:' + ch.id, label: 'crew' }] });
    await A.ev(`location.reload(); true`);
    await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000);
    await A.ev(`document.querySelector('.pins-btn')?.click(); true`);
    await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes('crew'))`, 5000);
    await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('crew'))?.click(); true`);
    ok(await A.until(`!!document.querySelector('#split #chat:not(.hidden)') && /crew/.test(document.querySelector('#split #chat .ch-row.on, #split #chat .on')?.textContent || document.querySelector('#split #chat').textContent)`, 8000), 'a pinned feed opens in Chat, in the split');
  } else ok(false, '(setup) a feed called crew');

  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  ok(await A.ev(`document.documentElement.scrollWidth <= 391`), 'fits a phone');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors[0] : ''));
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
chrome.kill('SIGKILL');
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
