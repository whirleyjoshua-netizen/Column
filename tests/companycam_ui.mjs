// CompanyCam in the app (2026-11-20): a live tile with where to get the token and a box to paste it; connected, it
// names the account and how many projects matched; a project waiting for a job is linked by picking one.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/companycam_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5342, CDP = 9640, CCB = `http://127.0.0.1:5343`, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', COMPANYCAM_API: 'http://127.0.0.1:5343/v2', COMPANYCAM_LOCAL: '1', SKIP_SETUP: '1' }, stdio: 'ignore' });
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
  const pick = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  const fill = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  return { ev, until, tap, pick, fill, cmd, errors };
}
// A stand-in CompanyCam.
const http = (await import('node:http')).default;
const TOKEN = 'cc_test_token_abcdefghijklmnop';
const projects = [
  { id: 101, name: 'Smith residence', address: { street_address_1: '12 Elm Street', city: 'Mesa' } },
  { id: 102, name: 'Jones', address: { street_address_1: '40 Oak Ave', city: 'Mesa' } },
];
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const j = (code, x) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(x)); };
    if (req.url.startsWith('/img/')) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(JPEG); }
    if (req.headers.authorization !== 'Bearer ' + TOKEN) return j(401, {});
    const u = new URL(req.url, CCB);
    if (u.pathname === '/v2/company') return j(200, { id: 9, name: 'Desert Shade Co' });
    if (u.pathname === '/v2/webhooks') return j(201, { id: 77 });
    if (u.pathname === '/v2/projects') return j(200, u.searchParams.get('page') === '1' ? projects : []);
    if (/^\/v2\/projects\/102\/photos$/.test(u.pathname)) return j(200, [{ id: 6001, project_id: 102, uris: [{ type: 'web', uri: `${CCB}/img/6001.jpg` }] }]);
    j(200, []);
  });
}).listen(5343);
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'CCUI ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const st = await api('GET', '/state');
  await api('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const p = await api('POST', '/projects', { template: 'trades', trades: ['blinds'] });
  const bl = p.types.find((x) => x.key === 'trade_blinds');
  const F = (k) => bl.fields.find((f) => f.key === k);
  await api('POST', `/projects/${p.id}/records`, { typeId: bl.id, values: { job: 'Smith shades', [F('address').id]: '12 Elm St, Mesa' } });
  const jones = await api('POST', `/projects/${p.id}/records`, { typeId: bl.id, values: { job: 'Jones shades', [F('address').id]: '41 Oak Ave, Mesa' } });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=apps]')`, 15000);
  await A.ev(`document.querySelector('#tabs [data-tab=apps]').click(); [...document.querySelectorAll('#apps .apps-tabs button')].find((b) => b.textContent === 'Integrations')?.click(); true`);
  ok(await A.until(`!!document.querySelector('#apps .app-tile[data-app=companycam]') && document.querySelector('#apps .app-tile[data-app=companycam]').dataset.state === 'off'`), 'CompanyCam is a live tile, not connected yet');
  await A.ev(`document.querySelector('#apps .app-tile[data-app=companycam]').click(); true`);
  ok(await A.until(`!!document.querySelector('#apps .app-detail .cc-token') && document.querySelector('#apps .app-detail .cc-steps').textContent.includes('Access tokens')`), 'it says where to get a token in CompanyCam, with a box to paste it');
  await A.fill(`document.querySelector('#apps .app-detail .cc-token')`, TOKEN);
  await A.ev(`document.querySelector('#apps .app-detail .cc-go').click(); true`);
  ok(await A.until(`document.querySelector('#apps .app-detail .cc-sec')?.textContent.includes('Connected to Desert Shade Co')`, 8000), 'connected: it names the CompanyCam account');
  ok(await A.ev(`document.querySelector('#apps .app-detail .cc-sec').textContent.includes('1 of 2 projects matched')`), 'and says 1 of 2 projects matched a job');
  ok(await A.until(`!!document.querySelector('#apps .app-detail .cc-pick[data-project="102"]')`), 'Jones waits for a job (41 Oak Ave isn’t 40 Oak Ave)');
  await sleep(1000); // the live update after connecting redraws the tile once
  await A.ev(`document.querySelector('#apps .app-detail .cc-row .linkish').click(); true`);
  await A.until(`[...document.querySelectorAll('#apps .app-detail .cc-pick[data-project="102"] option')].some((o) => o.value === ${JSON.stringify(jones.id)})`);
  await A.pick(`document.querySelector('#apps .app-detail .cc-pick[data-project="102"]')`, jones.id);

  ok(await A.until(`!document.querySelector('#apps .app-detail .cc-pick[data-project="102"]') && document.querySelector('#apps .app-detail .cc-sec').textContent.includes('2 of 2 projects matched')`, 8000), 'picking “all jobs” → Jones shades links it');
  const photos = bl.fields.find((f) => f.type === 'files' && f.key === 'photos') || bl.fields.find((f) => f.type === 'files');
  const rec = (await api('GET', `/projects/${p.id}/records`)).find((x) => x.id === jones.id);
  ok((rec.values[photos.id] || []).length === 1, 'and its latest photo came into the job’s Photos');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
chrome.kill('SIGKILL');
srv.kill();
fake.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
