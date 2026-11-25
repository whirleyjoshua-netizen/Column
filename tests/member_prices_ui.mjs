// Members don't see prices, in the app (docs/jobflows/PRICES.md §5): a member sees a quote's lines as what and how
// many, read-only, with no quote buttons and no price on the page; the owner still edits them.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/member_prices_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5263, CDP = 9602, APP = `http://127.0.0.1:${PORT}/`;
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
  const api = (tok) => async (m, p, body) => { const r = await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return r.json().catch(() => null); };
  const a = await api()('POST', '/auth', { mode: 'create', workspace: 'MP ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = api(a.token);
  let st = await rico('GET', '/state');
  const b = await api()('POST', '/auth', { mode: 'join', workspace: 'MP ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const board = await rico('POST', '/projects', { template: 'bids', name: 'Estimating' });
  const qT = board.types.find((x) => x.key === 'quotes');
  const itemsF = qT.fields.find((f) => f.key === 'items');
  const quote = await rico('POST', `/projects/${board.id}/records`, { typeId: qT.id, values: { title: 'Ruiz shutters', items: { rows: [{ desc: 'Shutters', qty: 2, unit: 'each', price: 4321.77, cost: 1234.56 }], taxRate: 0 } } });
  const open = async (tok) => {
    const A = await tab(APP);
    await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
    await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(tok))}); location.href = ${JSON.stringify(APP + '?go=rec:' + quote.id)}; true`);
    await A.until(`!!document.querySelector('.pj-panel .pj-items')`, 15000);
    return A;
  };
  const panel = `document.querySelector('.pj-panel').textContent`;

  // The owner: the price lines to edit, with prices, and the quote's buttons.
  const O = await open(a.token);
  ok(await O.ev(`!document.querySelector('.pj-panel .pj-items-ro') && [...document.querySelectorAll('.pj-panel .pj-items input')].some((i) => /4,?321\.77/.test(i.value))`), 'the owner gets the price lines to edit, with the price');
  ok(await O.ev(`!!document.querySelector('.pj-panel .pj-qbar')`), 'and the quote’s buttons (send, PDF)');

  // A member: what and how many, read-only, no prices, no quote buttons; the board shows — for the lines.
  const M = await open(b.token);
  ok(await M.ev(`!!document.querySelector('.pj-panel .pj-items-ro') && document.querySelector('.pj-panel .pj-items-ro').textContent.includes('2 each') && document.querySelector('.pj-panel .pj-items-ro').textContent.includes('Shutters')`), 'a member sees the lines as what and how many: ' + (await M.ev(`document.querySelector('.pj-panel .pj-items')?.textContent.slice(0, 120)`)));
  ok(await M.ev(`document.querySelector('.pj-panel .pj-items-ro').textContent.includes('Prices are for owners and admins')`), 'with “Prices are for owners and admins”');
  ok(await M.ev(`!document.querySelector('.pj-panel .pj-items input') && !document.querySelector('.pj-panel .pj-qbar')`), 'nothing to edit, and no Send to customer, link or PDF');
  ok(await M.ev(`!/4,?321\.77|8,?643\.54|1,?234\.56/.test(document.body.textContent)`), 'no price anywhere on the page');
  const card = `[...document.querySelectorAll('#projects .pj-card, #projects tbody tr, #projects [data-id]')].filter((x) => !x.closest('.pj-panel')).find((x) => x.textContent.includes('Ruiz shutters'))`;
  ok(await M.ev(`!!${card} && !/\\$\\s?\\d/.test(${card}.textContent)`), 'the quote on the board shows no amount: ' + (await M.ev(`${card}?.textContent.slice(0, 120)`)));
  ok(await O.ev(`!!${card} && /\\$\\s?[\\d,]+/.test(${card}.textContent)`), 'while the owner’s shows its total: ' + (await O.ev(`${card}?.textContent.slice(0, 120)`)));
  ok(M.errors.length === 0 && O.errors.length === 0, 'no errors on the page: ' + [...M.errors, ...O.errors].join(' | ').slice(0, 300));
} catch (e) {
  ok(false, 'threw: ' + (e.stack || e.message));
}
chrome.kill();
srv.kill();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
