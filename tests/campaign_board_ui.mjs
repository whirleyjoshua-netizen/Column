// A campaign's board (2026-11-20; the Sketch tab since 2026-11-25): it starts the campaign's whiteboard from a template;
// Update plan turns its boxes into phases in flow order, arrows into "waits for", stickies under a box into its tasks,
// and what it used into live cards; selected stickies go into a phase with Make tasks in…. The board is the campaign's.
import { CHROME, SERVER_DIR } from './chromebin.mjs';
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/cboard';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4959, APP = `http://127.0.0.1:${PORT}/`, CDP = 9543;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-cboard`, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-cboard`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
const shot = async (name) => { if (!process.env.SHOT) return; const r = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(`${process.env.SHOT}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Cb ' + t, name: 'Joshua', email: `j${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  const camp = await api('POST', '/campaigns', { name: 'Shade installs' });
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=camps]')`, 15000);
  // Open Campaigns (again if the first click came before the app was ready).
  for (let i = 0; i < 20 && !(await A.ev(`!!document.querySelector('.camp-card')`)); i++) { await A.ev(`document.querySelector('[data-tab=camps]')?.click(); true`); await sleep(300); }
  await A.tap(`document.querySelector('.camp-card')`);
  await A.until(`!!${T('.cc-tab[data-ctab=sketch]')}`);
  await A.ev(`${T('.cc-tab[data-ctab=sketch]')}.click(); true`);
  ok(await A.until(`${T('.cc-body')}?.dataset.tab === 'sketch'`), 'the board is the Sketch tab (2026-11-25, stage 4)');
  ok(await A.until(`!!${T('.cc-board-empty')} && [...document.querySelectorAll('#camps .cc-board-starts button')].map((b) => b.textContent).join('|') === 'Phases & tasks|Workflow map|Campaign brainstorm|Mind map|Blank'`), 'with no board yet: starts, Phases & tasks first');
  await A.tap(T('.cc-board-starts [data-tpl=workflow]'));
  ok(await A.until(`document.querySelectorAll('#camps .cc-board .wb-item.k-shape').length === 5`, 10000), 'the campaign’s board opens from the workflow template (5 shapes)');
  const list = (await api('GET', '/boards?campaign=' + camp.id)).boards;
  ok(list.length === 1 && list[0].campaignId === camp.id, 'the board is the campaign’s');
  await shot('cboard-1');
  // Update plan: every box, in flow order, with arrows as "waits for"; a sticky under a box is a task in it.
  await A.tap(T('.cc-update-plan'));
  const goals = async () => (await api('GET', '/state')).goals.filter((g) => g.campaignId === camp.id);
  let gs = [];
  for (let i = 0; i < 50 && gs.length < 5; i++) { gs = await goals(); await sleep(200); }
  for (let i = 0; i < 50; i++) { gs = await goals(); if (gs.filter((g) => g.blockedBy?.length).length >= 4) break; await sleep(200); }
  const byOrder = gs.sort((a, b) => (a.order || 0) - (b.order || 0));
  ok(byOrder.map((g) => g.title).join('|') === 'Lead comes in|Quote it|Book the job|Do the work|Get paid', 'Update plan makes the five phases, in flow order: ' + byOrder.map((g) => g.title).join('|'));
  const by = Object.fromEntries(byOrder.map((g) => [g.title, g]));
  ok(by['Quote it'].blockedBy?.join() === by['Lead comes in'].id && by['Get paid'].blockedBy?.join() === by['Do the work'].id && !(by['Lead comes in'].blockedBy || []).length, 'each waits for the one its arrow comes from');
  let st = await api('GET', '/state');
  for (let i = 0; i < 30 && !st.tasks.some((x) => x.text === 'Where does it get stuck?'); i++) { await sleep(150); st = await api('GET', '/state'); }
  ok(st.tasks.find((x) => x.text === 'Who does each step?')?.goalId === by['Lead comes in'].id && st.tasks.find((x) => x.text === 'Where does it get stuck?')?.goalId === by['Quote it'].id, 'the stickies under a box became its tasks');
  await sleep(600);
  const b1 = await api('GET', '/boards/' + list[0].id);
  ok(b1.items.filter((x) => x.kind === 'card' && x.ref?.kind === 'goal').length === 5 && b1.items.filter((x) => x.kind === 'shape').length === 0 && b1.links.length === 4, 'the shapes became live phase cards, and the 4 arrows stayed');
  ok(await A.until(`document.querySelectorAll('#camps .cc-board .wb-item.k-card').length === 7`), 'the board shows them as cards (5 phases, 2 tasks)');
  // Make tasks in…: a sticky under no phase, picked, into a phase.
  const kid = 'stk' + Date.now().toString(36);
  await api('POST', `/boards/${list[0].id}/ops`, { ops: [{ op: 'put', item: { id: kid, kind: 'sticky', x: 2200, y: 900, w: 200, h: 120, text: 'Call the supplier' } }] });
  await A.until(`[...document.querySelectorAll('#camps .cc-board .wb-item.k-sticky')].some((n) => n.textContent.includes('Call the supplier'))`, 6000);
  await A.tap(`[...document.querySelectorAll('#camps .cc-board .wb-item.k-sticky')].find((n) => n.textContent.includes('Call the supplier'))`);
  await sleep(300);
  await A.tap(T('.cc-mktasks'));
  ok(await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === 'Quote it')`), 'Make tasks in… asks which phase');
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Quote it').click(); true`);
  let tk;
  for (let i = 0; i < 40 && !tk; i++) { tk = (await api('GET', '/state')).tasks.find((x) => x.text === 'Call the supplier'); await sleep(150); }
  ok(tk && tk.goalId === by['Quote it'].id, 'the sticky became a task in Quote it');
  await sleep(600);
  ok((await api('GET', '/boards/' + list[0].id)).items.some((x) => x.kind === 'card' && x.ref?.kind === 'task' && x.ref.id === tk?.id), 'and a live task card on the board');
  await shot('cboard-2');
  // View as plan: they're the campaign's phases.
  await A.tap(T('.cc-asplan'));
  ok(await A.until(`${T('.cc-body')}?.dataset.tab === 'plan' && document.querySelectorAll('#camps .cc-phase').length === 5`), 'View as plan: the five phases on Plan');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
chrome.kill();
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-6).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
