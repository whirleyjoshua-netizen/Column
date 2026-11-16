// Stacks read like a chat: the newest at the bottom in Everything, Files and each stack. Anyone can switch to newest at
// the top (Settings → General), just for them and kept with their account (it survives a reload; a teammate keeps theirs).
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/feedorder';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4769, APP = `http://127.0.0.1:${PORT}/`, CDP = 9469;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '' }, stdio: 'ignore' });
for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map(); const errors = [];
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  await cmd('Runtime.enable');
  await cmd('Page.navigate', { url });
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  return { ev, until, errors, cmd, close: () => ws.close() };
}
const api = (tok) => async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
// The text of the visible cards in the open column, top to bottom.
const ORDER = `[...document.querySelectorAll('.pane .list')].find((l) => l.offsetParent)?.innerText || ''`;
const firstIdx = (txt, a, b) => txt.indexOf(a) >= 0 && txt.indexOf(b) >= 0 && txt.indexOf(a) < txt.indexOf(b);
try {
  const A = await tab(APP);
  await A.until(`!!document.querySelector('#loginLinks a')`);
  const team = 'fo' + Date.now();
  await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; f.email.value = 'jo${team}@t.test'; f.requestSubmit(); })()`);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo is in');
  const tok = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
  const jo = api(tok);
  await jo('POST', '/stacks', { name: 'Jobs' });
  const st = await jo('GET', '/state');
  const stackId = st.workspace.stacks.find((x) => x.name === 'Jobs').id;
  await jo('POST', '/items', { type: 'text', text: 'OLDER NOTE', stackId });
  await sleep(30);
  await jo('POST', '/items', { type: 'text', text: 'NEWER NOTE', stackId });
  await A.ev(`(document.querySelector('#tabs [data-tab=tools]').click(), document.querySelector('#tool [data-tool=column]'))?.click()`);
  await A.until(`[...document.querySelectorAll('.chip')].some((c) => c.textContent === 'Jobs')`);
  await A.ev(`[...document.querySelectorAll('.chip')].find((c) => c.textContent === 'Jobs').click()`);
  ok(await A.until(`(${ORDER}).includes('NEWER NOTE')`), 'the Jobs stack shows both notes');
  ok(firstIdx(await A.ev(ORDER), 'OLDER NOTE', 'NEWER NOTE'), 'in a stack the newest is at the bottom, like a chat');
  await A.ev(`[...document.querySelectorAll('.chip')].find((c) => c.textContent === 'Files').click()`);
  await A.until(`(${ORDER}).includes('NEWER NOTE')`);
  ok(firstIdx(await A.ev(ORDER), 'OLDER NOTE', 'NEWER NOTE'), 'in Files too');

  // The switch in Settings → General.
  await A.ev(`document.querySelector('[aria-label=Settings], #settingsBtn, button[title=Settings]')?.click()`);
  ok(await A.until(`[...document.querySelectorAll('#settings .srow')].some((r) => r.textContent.includes('Newest at the top'))`), 'Settings → General has Newest at the top');
  ok(await A.ev(`![...document.querySelectorAll('#settings .srow')].find((r) => r.textContent.includes('Newest at the top')).querySelector('input').checked`), 'off to start with');
  await A.ev(`[...document.querySelectorAll('#settings .srow')].find((r) => r.textContent.includes('Newest at the top')).querySelector('input').click()`);
  ok(await A.until(`(() => { const t = ${ORDER}; return t.indexOf('NEWER NOTE') >= 0 && t.indexOf('NEWER NOTE') < t.indexOf('OLDER NOTE'); })()`), 'turned on, the newest moves to the top straight away');
  let me = (await jo('GET', '/state')).me;
  ok(me.feedTop === true, 'and it’s kept with Jo’s account');
  await A.cmd('Page.reload');
  await A.until(`!document.querySelector('#app').classList.contains('hidden')`);
  await A.ev(`(document.querySelector('#tabs [data-tab=tools]').click(), document.querySelector('#tool [data-tool=column]'))?.click()`);
  ok(await A.until(`(() => { const t = ${ORDER}; return t.indexOf('NEWER NOTE') >= 0 && t.indexOf('NEWER NOTE') < t.indexOf('OLDER NOTE'); })()`), 'after a reload it’s still newest at the top');
  const r = await jo('PUT', '/account/feed', { newestTop: false });
  ok(r.newestTop === false && (await jo('GET', '/state')).me.feedTop === false, 'turning it off goes back to newest at the bottom');
  ok(!A.errors.length, 'no errors on the page' + (A.errors.length ? ': ' + A.errors[0] : ''));
  A.close();
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  chrome.kill();
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
