// Campaign Work (stage 2, 2026-11-25; docs/superpowers/specs/2026-11-25-campaign-simplify-design.md): the four views
// behind one View dropdown, remembered on the device; the header chips (All, My tasks, Overdue, Blocked) filter Work
// as they filter Plan; no filter buttons of its own.
import { CHROME, SERVER_DIR } from './chromebin.mjs';
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/ccwork';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4981, APP = `http://127.0.0.1:${PORT}/`, CDP = 9619;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-ccwork`, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-ccwork`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
const srv = spawn('node', ['index.js'], { cwd: SERVER_DIR, env: { ...process.env, SKIP_SETUP: '1', PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map(); const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const mouse = async (type, x, y) => cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' || type === 'mouseMoved' ? 1 : 0, clickCount: 1 });
  const pick = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  const tap = async (expr) => { const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); for (const ty of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type: ty, x, y, button: 'left', buttons: ty === 'mousePressed' ? 1 : 0, clickCount: 1 }); await sleep(80); };
  return { ev, until, tap, mouse, cmd, pick, errors, close: () => ws.close() };
}
let A;
const T = (sel) => `document.querySelector('#camps ${sel}')`;
const tabTo = async (k) => { await A.ev(`${T(`.cc-tab[data-ctab=${k}]`)}.click(); true`); await A.until(`${T('.cc-body')}?.dataset.tab === '${k}'`); };

const vis = (sel) => `(() => { const e = document.querySelector('#camps ${sel}') || document.querySelector('${sel}'); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })()`;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Work ' + t, name: 'Joshua', email: `j${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  const st = await api('GET', '/state'); const me = st.me.memberId; const today = st.today || new Date().toISOString().slice(0, 10);
  const plus = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const camp = await api('POST', '/campaigns', { name: 'Spring Promo', brief: 'Book installs', start: plus(today, -3), end: plus(today, 60) });
  await api('PATCH', '/campaigns/' + camp.id, { assigneeId: me });
  const ph = []; for (const n of ['Call past customers', 'Book installs']) ph.push(await api('POST', '/goals', { campaignId: camp.id, title: n }));
  await api('POST', '/tasks', { goalId: ph[0].id, text: 'Call the Lee family', assigneeId: me, due: plus(today, -3), start: plus(today, -5) });
  await api('POST', '/tasks', { goalId: ph[0].id, text: 'Call the Diaz family', due: plus(today, 4) });
  const pf = await api('POST', '/tasks', { goalId: ph[0].id, text: 'Print flyers' }); await api('PATCH', '/tasks/' + pf.id, { done: true });
  const os = await api('POST', '/tasks', { goalId: ph[1].id, text: 'Order signs', assigneeId: me }); await api('PATCH', '/tasks/' + os.id, { done: true });
  await api('POST', '/tasks', { goalId: ph[1].id, text: 'Send quotes', due: plus(today, 8) });
  await api('PATCH', '/campaigns/' + camp.id, { inOrder: true });
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); localStorage.removeItem('column.ccWorkView'); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=camps]')`, 15000);
  await A.ev(`document.querySelector('[data-tab=camps]').click(); true`);
  await A.until(`!!document.querySelector('.camp-card')`);
  await A.tap(`document.querySelector('.camp-card')`); await A.until(`!!document.querySelector('#camps .cc-edit, #camps .cc-done-edit')`); await A.ev(`document.querySelector('#camps .cc-edit')?.click(); true`); // a campaign opens to be read: Edit (2026-11-27)
  ok(await A.until(`!!${T('.cc-body')}`), 'the campaign opens');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`);
  const chip = async (k) => { await A.tap(T(`.cc-chip[data-chip=${k}]`)); await A.until(`${T(`.cc-chip[data-chip=${k}]`)}.classList.contains('on')`); };
  // As a person picks: the dropdown has the focus when it changes (the page holds back its redraw for a focused box).
  const view = async (v) => { await A.ev(`${T('.cc-wview-sel')}.focus(); true`); await A.pick(T('.cc-wview-sel'), v); await sleep(250); };
  const listRows = `[...document.querySelectorAll('#camps .cc-tr:not(.cc-th)')].map((r) => r.querySelector('.cc-tt').firstChild.textContent + (r.classList.contains('done') ? '*' : ''))`;
  // ----- Work: one dropdown for the view; the chips filter -----
  await tabTo('work');
  ok(await A.until(`!!${T('select.cc-wview-sel')}`), 'Work has a View dropdown');
  ok(await A.ev(`[...${T('select.cc-wview-sel')}.options].map((o) => o.value).join() === 'list,board,timeline,calendar' && ${T('select.cc-wview-sel')}.value === 'list' && !${T('.cc-wf')} && !${T('.cc-wview [data-wv]')}`), 'List, Board, Timeline, Calendar; no filter buttons, no view buttons');
  ok(await A.ev(`${T('label.cc-wview')}.textContent.trim().startsWith('View')`), 'labelled View');
  // All: open, then done (dimmed).
  ok(JSON.stringify(await A.ev(listRows)) === JSON.stringify(['Call the Lee family', 'Call the Diaz family', 'Send quotes', 'Print flyers*', 'Order signs*']), 'All: the open tasks, then the done one, dimmed: ' + JSON.stringify(await A.ev(listRows)));
  // A chip picked on Plan carries to Work, in every view.
  await tabTo('plan');
  await chip('mine');
  await tabTo('work');
  ok(JSON.stringify(await A.ev(listRows)) === JSON.stringify(['Call the Lee family']), 'My tasks (picked on Plan): only mine on Work');
  await view('board');
  ok(await A.until(`!!${T('.ccb')}`), 'the dropdown switches to Board');
  ok(await A.until(`document.activeElement === ${T('.cc-wview-sel')}`), 'and keeps the focus, so a keyboard can step on through the views');
  const cards = `[...document.querySelectorAll('#camps .ccb-col')].map((c) => c.dataset.col + ':' + [...c.querySelectorAll('.ccb-card')].map((x) => x.title).join('+')).filter((x) => !x.endsWith(':')).join('|')`;
  ok(/Call the Lee family/.test(await A.ev(cards)) && /done:Order signs/.test(await A.ev(cards)) && !/Diaz|Send quotes|Print flyers/.test(await A.ev(cards)), 'Board, My tasks: mine in its column, and only what I finished in Done: ' + await A.ev(cards));
  await view('timeline');
  ok(await A.until(`!!${T('.cct-bar')}`), 'the dropdown switches to Timeline');
  ok(await A.ev(`[...document.querySelectorAll('#camps .cct-bar')].every((b) => (b.title || b.textContent).includes('Lee'))`), 'Timeline, My tasks: only my bar');
  await view('calendar');
  ok(await A.until(`${T('.cc-body')}.textContent.includes('Call the Lee family') && !${T('.cc-body')}.textContent.includes('Call the Diaz family')`), 'Calendar, My tasks: only mine');
  await view('list');
  await chip('overdue');
  ok(JSON.stringify(await A.ev(listRows)) === JSON.stringify(['Call the Lee family']), 'Overdue: only the late one');
  await chip('blocked');
  ok(JSON.stringify(await A.ev(listRows)) === JSON.stringify(['Call the Diaz family', 'Send quotes']), 'Blocked: only what waits (in order: Diaz waits for Lee, the next phase for this one): ' + JSON.stringify(await A.ev(listRows)));
  await api('PATCH', '/campaigns/' + camp.id, { inOrder: false });
  await tabTo('progress'); await tabTo('work');
  ok(await A.until(`${T('.cc-body')}.textContent.includes('Nothing is blocked.')`), 'nothing blocked says so');
  await view('timeline');
  ok(await A.until(`${T('.cc-body')}.textContent.includes('Nothing is blocked.') && !${T('.cc-body')}.textContent.includes('No tasks here yet')`), 'Timeline says it in the chip’s words too');
  await view('list');
  await chip('all');
  // A view kept from before: the device remembers Board.
  await A.ev(`localStorage.setItem('column.ccWorkView', JSON.stringify('board')); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=camps]')`, 15000);
  await A.ev(`document.querySelector('[data-tab=camps]').click(); true`);
  await A.until(`!!${T('.cc-tab[data-ctab=work]')} || !!document.querySelector('.camp-card')`);
  if (!(await A.ev(`!!${T('.cc-tab[data-ctab=work]')}`))) await A.tap(`document.querySelector('.camp-card')`); await A.until(`!!document.querySelector('#camps .cc-edit, #camps .cc-done-edit')`); await A.ev(`document.querySelector('#camps .cc-edit')?.click(); true`); // a campaign opens to be read: Edit (2026-11-27)
  await tabTo('work');
  ok(await A.until(`${T('select.cc-wview-sel')}?.value === 'board' && !!${T('.ccb')}`), 'a view kept from before opens on it (Board)');
  // A phone: the dropdown and chips fit.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 400, height: 860, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  ok(await A.ev(`(() => { const v = ${T('.cc-wview-sel')}.getBoundingClientRect(), c = ${T('.cc-chips')}.getBoundingClientRect(); return v.width > 0 && c.width > 0 && document.documentElement.scrollWidth <= innerWidth; })()`), 'on a phone the dropdown and chips fit, nothing sideways');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
try { chrome.kill(); } catch {}
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-6).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
