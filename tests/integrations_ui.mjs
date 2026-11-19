// Apps & Integrations in a real browser, reading the registry (GET /api/integrations): a connection that breaks shows
// Needs attention on its tile and what's wrong on its page; Want this? on an app that isn't built; a member sees the
// team connection as Connected and nothing more.
import http from 'node:http';
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/integrations_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5312, CDP = 9610, FPORT = 5313, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1', ALLOW_LOCAL_WEBHOOKS: '1', POSTIZ_URL: `http://127.0.0.1:${FPORT}/pz/public/v1` }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
let accept = true;
const fake = http.createServer((req, res) => {
  if (!accept || req.headers.authorization !== 'pz-good-key-123') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{}'); }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(req.url.endsWith('/integrations') ? [{ id: 'ch1', name: 'Shop page', identifier: 'facebook', picture: '' }] : {}));
}).listen(FPORT);
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
  const post = async (p, b, tok) => (await fetch(APP + 'api' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b) })).json();
  const a = await post('/auth', { mode: 'create', workspace: 'Apps ' + t, name: 'Jo Park', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const api = async (m, p, b, tok = a.token) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined })).json();
  const st = await api('GET', '/state');
  const sam = await post('/auth', { mode: 'join', workspace: 'Apps ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  ok((await fetch(APP + 'api/postiz', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: JSON.stringify({ key: 'pz-good-key-123' }) })).status === 200, 'Postiz connected (a stand-in)');

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  const signIn = async (tok) => { await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(tok)})); location.reload(); true`); await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000); };
  const openPage = async () => { await A.ev(`document.querySelector('#tabs [data-tab=apps]').click(); true`); await A.until(`!!document.querySelector('#apps .app-tile[data-app=postiz]')`); };
  const tileSt = (id) => A.ev(`document.querySelector('#apps .app-tile[data-app=${id}]')?.dataset.state || ''`);

  await signIn(a.token);
  await openPage();
  ok(await A.until(`document.querySelector('#apps .app-tile[data-app=postiz]')?.dataset.state === 'on'`), 'the Postiz tile says Connected');

  // It breaks: the tile says Needs attention, and its page says what's wrong.
  accept = false;
  await api('POST', '/postiz/refresh');
  await signIn(a.token);
  await openPage();
  ok(await A.until(`document.querySelector('#apps .app-tile[data-app=postiz]')?.dataset.state === 'error'`), 'broken, the tile says Needs attention: ' + await tileSt('postiz'));
  ok(await A.ev(`document.querySelector('#apps .app-tile[data-app=postiz] .app-st').textContent.includes('Needs attention')`), 'in words');
  await A.tap(`document.querySelector('#apps .app-tile[data-app=postiz]')`);
  ok(await A.until(`/didn’t accept/.test(document.querySelector('#apps .app-trouble')?.textContent || '')`), 'its page says what’s wrong and to connect again');
  const notices = await api('GET', '/notices');
  ok(notices.some((n) => /Postiz needs attention/.test(n.title) && n.go === 'app:postiz'), 'Jo has a notice that opens Postiz’s page');

  // Want this? on an app that isn't built.
  await A.tap(`document.querySelector('#apps .app-back')`);
  await A.tap(`document.querySelector('#apps .app-tile[data-app=slack]')`);
  await A.tap(`document.querySelector('#apps [data-want=slack]')`);
  ok(await A.until(`document.querySelector('#apps [data-want=slack]')?.getAttribute('aria-pressed') === 'true'`), 'Jo asks for Slack');
  const wants = await api('GET', '/integrations');
  ok(wants.wants.slack === 1 && wants.wanted.includes('slack'), 'it’s counted');
  await A.tap(`document.querySelector('#apps .app-back')`);
  ok(await A.until(`document.querySelector('#apps .app-tile[data-app=slack] .app-st')?.textContent.includes('Asked for')`), 'the tile says Asked for ✓');

  // A member: Postiz shows as connected, nothing about what's wrong.
  await signIn(sam.token);
  await openPage();
  ok(await A.until(`document.querySelector('#apps .app-tile[data-app=postiz]')?.dataset.state === 'on'`), 'Sam sees Postiz Connected (members aren’t shown the team connection’s trouble)');
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(300);
  ok(await A.ev(`document.documentElement.scrollWidth <= 391`), 'fits a phone');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors[0] : ''));
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
fake.close();
chrome.kill('SIGKILL');
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
