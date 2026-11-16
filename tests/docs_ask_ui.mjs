// Search and Ask in a real browser (headless Chrome): ⌘K finds a doc by its title first and a Jobs & projects
// record; a question gets an "Ask" row whose answer shows numbered sources, and a source opens its doc. The AI is a
// stand-in on a private port.
import * as FS from 'node:fs';
import http from 'node:http';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/docs_ask_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4886, AI = 4887, CDP = 9503, APP = `http://127.0.0.1:${PORT}/`;
const ai = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'T', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const text = JSON.stringify({ answer: 'Shutters are $120 each, installed [1].', used: [1] });
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((r) => ai.listen(AI, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI}` }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
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
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(150);
  };
  const type = async (s) => { for (const ch of s) { await cmd('Input.insertText', { text: ch }); await sleep(20); } };
  const cmdK = async () => { await cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 4 }); await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 4 }); await sleep(200); };
  return { ev, until, tap, type, cmd, cmdK, errors };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Ask ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  await api('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  const ws = (await api('GET', '/state')).workspace;
  await api('PATCH', '/workspace', { tools: { ...ws.tools, projects: true } });
  // An older doc that only mentions shutters, and a newer one about something else: the one named for it comes first.
  await api('POST', '/items', { type: 'text', doc: { title: 'Install notes', blocks: [{ id: 'a1', type: 'p', runs: [{ text: 'Shutters go up after the paint dries.' }] }] } });
  const price = await api('POST', '/items', { type: 'text', doc: { title: 'Shutters price sheet', blocks: [{ id: 'b1', type: 'p', runs: [{ text: '$120 each, installed.' }] }] } });
  await api('POST', '/items', { type: 'text', doc: { title: 'Install schedule', blocks: [{ id: 'c1', type: 'p', runs: [{ text: 'Shutters on Tuesday.' }] }] } });
  const crm = await api('POST', '/projects', { template: 'crm', name: 'Sales' });
  await api('POST', `/projects/${crm.id}/records`, { typeId: crm.types[0].id, values: { [crm.types[0].primary]: 'Shutters for Smith' } });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');
  await A.until(`(() => { try { return true; } catch { return false; } })()`, 500);
  await A.cmdK();
  ok(await A.until(`!!document.querySelector('.pk-q')`), '⌘K opens search');
  await A.type('shutters');
  ok(await A.until(`(() => { const hs = [...document.querySelectorAll('.pk-list .mh')].map((x) => x.textContent); return hs.includes('Docs') && hs.includes('Records'); })()`), 'it finds docs and records');
  const firstDoc = await A.ev(`(() => { const hs = [...document.querySelectorAll('.pk-list > *')]; const i = hs.findIndex((x) => x.classList.contains('mh') && x.textContent === 'Docs'); return hs[i + 1]?.textContent; })()`);
  ok(/Shutters price sheet/.test(firstDoc || ''), `the doc named for it comes first (${firstDoc})`);
  ok(await A.ev(`[...document.querySelectorAll('.pk-list *')].some((x) => x.textContent === 'Shutters for Smith')`), 'the record is there by name');
  await A.type(' price for a house?');
  ok(await A.until(`[...document.querySelectorAll('.pk-list .mh')].some((x) => x.textContent === 'Ask') && document.querySelector('.pk-list')?.textContent.includes('Ask: “shutters price for a house?”')`), 'a question gets an Ask row at the top');
  await A.tap(`[...document.querySelectorAll('.pk-list *')].find((x) => x.textContent?.startsWith('Ask: “shutters') && x.closest('button, .pk-row, [role=option], div')).closest('button, .pk-row, [role=option], .pk-item') || [...document.querySelectorAll('.pk-list *')].find((x) => x.textContent?.startsWith('Ask: “shutters'))`);
  ok(await A.until(`document.querySelector('#sheet .ask-a')?.textContent.includes('$120 each')`, 10000), 'the answer shows');
  ok(await A.ev(`document.querySelector('#sheet .ask-ref')?.textContent === '1' && [...document.querySelectorAll('#sheet .ask-s')].some((b) => b.textContent.includes('Shutters price sheet'))`), 'with its source, numbered');
  await A.tap(`document.querySelector('#sheet .ask-ref')`);
  ok(await A.until(`document.querySelector('#docview .dk-title')?.textContent === 'Shutters price sheet'`), 'tapping [1] opens the doc it came from');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors.join(' | ').slice(0, 300) : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  ai.close();
  chrome.kill('SIGKILL');
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
