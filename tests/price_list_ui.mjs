// Finance step 3 in the app (2026-11-20): every job's price lines pick from one price list (boards' price lists and
// Inventory); a line remembers its source, and shows when that price has changed, with a tap to use the new one.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/price_list_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5157, CDP = 9482, APP = `http://127.0.0.1:${PORT}/`;
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
  const pick = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  const fill = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  return { ev, until, tap, pick, fill, cmd, errors };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'PL ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const st = await api('GET', '/state');
  await api('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, inventory: true } });
  const bids = await api('POST', '/projects', { template: 'bids', name: 'Estimating' });
  const T = Object.fromEntries(bids.types.map((x) => [x.key, x]));
  await api('POST', `/projects/${bids.id}/records`, { typeId: T.price_list.id, values: { item: 'Install labor', unit: 'hour', price: 75 } });
  const roll = await api('POST', '/inventory/items', { name: 'Fabric roll', unit: 'roll', cost: '90', price: '120' });
  const tr = await api('POST', '/projects', { template: 'trades', trades: ['blinds'] });
  const bl = tr.types.find((x) => x.key === 'trade_blinds');
  const itemsF = bl.fields.find((f) => f.type === 'items');
  const job = await api('POST', `/projects/${tr.id}/records`, { typeId: bl.id, values: { job: 'Smith shades' } });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.href = ${JSON.stringify(APP + '?go=rec:')} + ${JSON.stringify(job.id)}; true`);
  await A.until(`!!document.querySelector('.pj-panel .pj-tab[data-tab=finance]')`, 20000);
  await A.ev(`document.querySelector('.pj-panel .pj-tab[data-tab=finance]').click(); true`);
  await A.until(`!!document.querySelector('.pj-panel .pj-subtab[data-fin=quote]')`);
  await A.ev(`document.querySelector('.pj-panel .pj-subtab[data-fin=quote]').click(); true`);
  ok(await A.until(`!!document.querySelector('.pj-panel .pj-from-list')`, 20000), 'a job on a board with no price list of its own still has “+ From the price list”');
  await A.tap(`document.querySelector('.pj-panel .pj-from-list')`);
  ok(await A.until(`[...document.querySelectorAll('#menu .mh')].map((x) => x.textContent).join('|') === 'Price list|Inventory'`), 'it lists the team’s price list and Inventory together');
  ok(await A.ev(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes('Install labor') && b.textContent.includes('Estimating'))`), 'with the board an item comes from');
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Fabric roll')).click(); true`);
  let rows = [];
  for (let i = 0; i < 40 && !rows.length; i++) { await sleep(200); rows = (await api('GET', `/projects/${tr.id}/records`)).find((x) => x.id === job.id)?.values?.[itemsF.id]?.rows || []; }
  ok(rows[0]?.desc === 'Fabric roll' && rows[0].price === 12000 && rows[0].cost === 9000 && rows[0].from === 'inv:' + roll.id, 'picked, the line has its price and cost, and remembers it came from Inventory');

  // The price changes: the line says so, and can take the new price.
  await api('PATCH', '/inventory/items/' + roll.id, { price: '135' });
  await A.ev(`location.href = ${JSON.stringify(APP + '?go=rec:')} + ${JSON.stringify(job.id)}; true`);
  await A.until(`!!document.querySelector('.pj-panel .pj-tab[data-tab=finance]')`, 20000);
  await A.ev(`document.querySelector('.pj-panel .pj-tab[data-tab=finance]').click(); true`);
  await A.until(`!!document.querySelector('.pj-panel .pj-subtab[data-fin=quote]')`);
  await A.ev(`document.querySelector('.pj-panel .pj-subtab[data-fin=quote]').click(); true`);
  ok(await A.until(`[...document.querySelectorAll('.pj-panel .pj-price-now')].some((b) => b.textContent.includes('135.00'))`, 20000), 'after a price change, the line shows “Price list now $135.00 · use it”');
  await A.ev(`document.querySelector('.pj-panel .pj-price-now').click(); true`);
  let p2 = 0;
  for (let i = 0; i < 40 && p2 !== 13500; i++) { await sleep(200); p2 = (await api('GET', `/projects/${tr.id}/records`)).find((x) => x.id === job.id)?.values?.[itemsF.id]?.rows?.[0]?.price; }
  ok(p2 === 13500, 'tapping it uses the new price');
  ok(await A.until(`!document.querySelector('.pj-panel .pj-price-now')`), 'and the note goes away');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
chrome.kill('SIGKILL');
srv.kill();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
