// Asking for stock in a real browser: a member asks (an item and something not in Inventory), sees it under My
// requests; an admin sees it under Requests, picks where requests go (a private #inventory feed), approves it and hands
// it out onto the member's truck; the member sees it handed out. Fits a phone.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/inventory_requests_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5244, CDP = 9585, APP = `http://127.0.0.1:${PORT}/`;
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
  const post = async (p, b, tok) => (await fetch(APP + 'api' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b) })).json();
  const a = await post('/auth', { mode: 'create', workspace: 'Ask ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const api = async (m, p, b, tok = a.token) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined })).json();
  const st = await api('GET', '/state');
  const mo = await post('/auth', { mode: 'join', workspace: 'Ask ' + t, code: st.workspace.inviteCode, name: 'Mo Lane', email: `mo${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const moId = (await api('GET', '/state', null, mo.token)).me.memberId;
  const flt = await api('POST', '/inventory/items', { name: '16x25 air filter', onHand: 20 });
  const truck = await api('POST', '/inventory/places', { name: 'Mo’s truck', kind: 'truck', memberId: moId });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  const signIn = async (tok) => { await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify('X'))}.replace('X', ${JSON.stringify(tok)})); location.reload(); true`); await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000); };
  const openInv = async () => { await A.until(`!!document.querySelector('#tabs [data-tab=tools]')`, 10000); await A.ev(`document.querySelector('#tabs [data-tab=tools]').click(); true`); await A.tap(`document.querySelector('#menu [data-tool=inventory]')`); await A.until(`!!document.querySelector('#split .inv-ask')`); };

  // Mo, a member, asks.
  await signIn(mo.token);
  await openInv();
  ok(await A.ev(`document.querySelector('#split .inv-ask').classList.contains('primary-btn') && !document.querySelector('#split .inv-new')`), 'a member has Request items (and no + Item)');
  await A.tap(`document.querySelector('#split .inv-ask')`);
  await A.until(`!!document.querySelector('#sheet .inv-r-qty')`);
  await A.fill(`document.querySelector('#sheet .inv-r-qty')`, '3');
  await A.tap(`document.querySelector('#sheet .inv-r-add')`);
  await A.until(`document.querySelectorAll('#sheet .inv-req-line').length === 2`);
  await A.ev(`(() => { const s = document.querySelectorAll('#sheet .inv-r-item')[1]; s.value = ''; s.dispatchEvent(new Event('change')); return true; })()`);
  ok(await A.until(`!document.querySelectorAll('#sheet .inv-r-name')[1].hidden`), 'something not in Inventory: type what it is');
  await A.fill(`document.querySelectorAll('#sheet .inv-r-name')[1]`, 'Ladder hooks');
  await A.fill(`document.querySelectorAll('#sheet .inv-r-qty')[1]`, '4');
  await A.fill(`document.querySelector('#sheet .inv-r-note')`, 'For Monday');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Send the request')`);
  ok(await A.until(`document.querySelector('#split .inv-views .on')?.textContent === 'My requests (1)' && /3 each 16x25 air filter/.test(document.querySelector('#split .inv-req')?.textContent || '') && /Ladder hooks/.test(document.querySelector('#split .inv-req').textContent) && /Waiting/.test(document.querySelector('#split .inv-req-st').textContent)`), 'sent: under My requests (1), waiting');
  ok(await A.ev(`!document.querySelector('#split .inv-req-ok') && !document.querySelector('#split .inv-req-hand') && !!document.querySelector('#split .inv-req-cancel')`), 'Mo can cancel it, but not approve or hand it out');

  // Rico, the owner.
  await signIn(a.token);
  await openInv();
  await A.tap(`[...document.querySelectorAll('#split .inv-views button')].find((b) => b.dataset.view === 'requests')`);
  ok(await A.until(`document.querySelector('#split .inv-views .on')?.textContent === 'Requests (1)' && /Request 1 · Mo Lane/.test(document.querySelector('#split .inv-req')?.textContent || '')`), 'the owner sees Requests (1), from Mo Lane');
  ok(await A.ev(`/Requests go to owners and admins/.test(document.querySelector('#split .inv-req-where').textContent)`), 'and where they go: owners and admins');
  await A.tap(`document.querySelector('#split .inv-req-set')`);
  await A.tap(`document.querySelector('#sheet .inv-req-mkfeed')`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .inv-req-feed option')].some((o) => o.selected && o.textContent === '#inventory')`), 'a private #inventory feed, made and picked');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Save')`);
  ok(await A.until(`/and #inventory/.test(document.querySelector('#split .inv-req-where')?.textContent || '')`), 'requests also go to #inventory now');
  await A.tap(`document.querySelector('#split .inv-req-ok')`);
  ok(await A.until(`/Approved/.test(document.querySelector('#split .inv-req-st')?.textContent || '')`), 'approved');
  await A.tap(`document.querySelector('#split .inv-req-hand')`);
  ok(await A.until(`document.querySelector('#sheet .inv-h-to')?.value === ${JSON.stringify(truck.id)} && /Ladder hooks/.test(document.querySelector('#sheet').textContent)`), 'Hand it out: onto Mo’s truck, and it says the hooks aren’t in Inventory');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Hand it out')`);
  ok(await A.until(`/Handed out/.test(document.querySelector('#split .inv-req-st')?.textContent || '') || /Closed · 1/.test(document.querySelector('#split').textContent)`), 'handed out');
  const inv = await api('GET', '/inventory');
  ok(inv.items.find((x) => x.id === flt.id).stock[truck.id] === 3, '3 filters are on Mo’s truck');
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  ok(await A.ev(`document.documentElement.scrollWidth <= 391`), 'fits a phone');
  await A.cmd('Emulation.clearDeviceMetricsOverride');

  // Mo hears it, and sees it handed out.
  const bells = (await api('GET', '/state', null, mo.token)).notices || [];
  ok(bells.some((n) => /approved your request/.test(n.title)) && bells.some((n) => /Your stock is on Mo’s truck/.test(n.title)), 'Mo was told: approved, then on his truck');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors[0] : ''));
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
chrome.kill('SIGKILL');
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
