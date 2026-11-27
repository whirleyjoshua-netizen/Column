// Campaign Sketch (stage 4, 2026-11-25; docs/superpowers/specs/2026-11-25-campaign-simplify-design.md): the whiteboard
// as its own tab (wide screens, whiteboard on), a Phases & tasks start, Update plan (a draft turned into the plan,
// nothing doubled), View as plan, and Start from a sketch in the campaign builder.
import { CHROME, SERVER_DIR } from './chromebin.mjs';
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/ccsketch';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5001, APP = `http://127.0.0.1:${PORT}/`, CDP = 9639;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-ccsketch`, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-ccsketch`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Sketch ' + t, name: 'Joshua', email: `j${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  const st = await api('GET', '/state'); const me = st.me.memberId; const today = st.today || new Date().toISOString().slice(0, 10);
  const plus = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const camp = await api('POST', '/campaigns', { name: 'Spring Promo', brief: 'Book installs', start: plus(today, -3), end: plus(today, 60) });
  await api('PATCH', '/campaigns/' + camp.id, { assigneeId: me });
  const ph = []; for (const n of ['Call past customers', 'Book installs']) ph.push(await api('POST', '/goals', { campaignId: camp.id, title: n }));
  await api('POST', '/tasks', { goalId: ph[0].id, text: 'Call the Lee family', assigneeId: me });
  await api('POST', '/tasks', { goalId: ph[1].id, text: 'Send quotes' });
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=camps]')`, 15000);
  await A.ev(`document.querySelector('[data-tab=camps]').click(); true`);
  const openCamp = async (name) => { await A.until(`[...document.querySelectorAll('.camp-card')].some((x) => x.textContent.includes(${JSON.stringify(name)}))`); await A.tap(`[...document.querySelectorAll('.camp-card')].find((x) => x.textContent.includes(${JSON.stringify(name)}))`); await A.until(`${T('.cc-name')}?.textContent === ${JSON.stringify(name)}`); await A.until(`!!document.querySelector('#camps .cc-edit, #camps .cc-done-edit')`); await A.ev(`document.querySelector('#camps .cc-edit')?.click(); true`); };
  await openCamp('Spring Promo');
  ok(await A.until(`!!${T('.cc-body')}`), 'the campaign opens');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`);
  // ----- Sketch: its own tab -----
  ok(await A.ev(`[...document.querySelectorAll('#camps .cc-tab')].map((b) => b.dataset.ctab).join() === 'plan,work,progress,sketch'`), 'four tabs on a wide screen: Plan, Work, Progress, Sketch');
  ok(await A.ev(`!${T('.cc-sketch-btn')}`), 'Plan has no Sketch button any more');
  await tabTo('sketch');
  ok(await A.until(`[...document.querySelectorAll('#camps .cc-board-starts button')].map((b) => b.dataset.tpl).join() === 'phases,workflow,brainstorm,mindmap,blank' && ${T('.cc-board-starts [data-tpl=phases]')}.classList.contains('primary-btn')`), 'the starts: Phases & tasks first, as the main one');
  await A.tap(T('.cc-board-starts [data-tpl=phases]'));
  ok(await A.until(`document.querySelectorAll('#camps .cc-board .wb-item.k-card').length === 4`, 10000), 'Phases & tasks draws the 2 phases and their 2 tasks as cards');
  ok(await A.ev(`['Update plan', 'Make tasks in', 'Full page', 'View as plan'].every((x) => [...document.querySelectorAll('#camps .cc-boardwrap button')].some((b) => b.textContent.includes(x))) && ${T('.cc-update-plan')}.classList.contains('primary-btn')`), 'the bar: Update plan (the main one), Make tasks in…, Full page, View as plan');
  const board = (await api('GET', '/boards?campaign=' + camp.id)).boards[0];
  const b0 = await api('GET', '/boards/' + board.id);
  const cardOf = (gid) => b0.items.find((x) => x.kind === 'card' && x.ref?.kind === 'goal' && x.ref.id === gid);
  const C0 = cardOf(ph[0].id), C1 = cardOf(ph[1].id);
  // Draw: a new phase "Install" after Book installs; a box named like Call past customers (other case) pointing at it;
  // two stickies under Install; one under Call past customers that's already a task; one above everything.
  const id = (s) => 'tst' + s + Date.now().toString(36);
  const [sI, sDup, k1, k2, kDup, kFar] = ['i', 'd', 'k1', 'k2', 'kd', 'kf'].map(id);
  const put = (item) => ({ op: 'put', item });
  const lnk = (from, to) => ({ op: 'put', link: { id: id('l' + from.slice(3, 5) + to.slice(3, 5)), from, to } });
  const r = await api('POST', `/boards/${board.id}/ops`, { ops: [
    put({ id: sI, kind: 'shape', shape: 'rect', x: 600, y: 0, w: 240, h: 90, text: 'Install' }),
    put({ id: sDup, kind: 'shape', shape: 'rect', x: 900, y: 0, w: 240, h: 90, text: '  call PAST customers ' }),
    put({ id: k1, kind: 'sticky', x: 610, y: 200, w: 200, h: 120, text: 'Measure windows' }),
    put({ id: k2, kind: 'sticky', x: 610, y: 360, w: 200, h: 120, text: 'Order brackets' }),
    put({ id: kDup, kind: 'sticky', x: 10, y: 600, w: 200, h: 120, text: 'Call the Lee family' }),
    put({ id: kFar, kind: 'sticky', x: 0, y: -600, w: 200, h: 120, text: 'Random idea' }),
    lnk(C1.id, sI), lnk(sDup, sI),
  ] });
  ok(r.ok, 'drew on the board');
  await A.until(`document.querySelectorAll('#camps .cc-board .wb-item.k-sticky').length === 4`, 6000);
  await A.tap(T('.cc-update-plan'));
  ok(await A.until(`[...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('Added 1 phase and 2 tasks · 2 already there'))`, 8000), 'Update plan says what it did: ' + await A.ev(`[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' / ')`));
  const st2 = await api('GET', '/state');
  const gs = st2.goals.filter((g) => g.campaignId === camp.id);
  const inst = gs.filter((g) => g.title === 'Install');
  ok(inst.length === 1 && gs.length === 3, 'one new phase, Install; Call past customers not made twice: ' + gs.map((g) => g.title).join('|'));
  ok(inst[0] && [ph[1].id, ph[0].id].every((x) => (inst[0].blockedBy || []).includes(x)), 'Install waits for Book installs and for Call past customers (the arrow from the box with its name)');
  const tk = st2.tasks.filter((t) => t.goalId === inst[0]?.id).map((t) => t.text).sort();
  ok(JSON.stringify(tk) === '["Measure windows","Order brackets"]', 'the stickies under Install are its tasks: ' + JSON.stringify(tk));
  ok(st2.tasks.filter((t) => t.text === 'Call the Lee family').length === 1, 'a sticky that’s already a task there isn’t made again');
  const b1 = await api('GET', '/boards/' + board.id);
  ok(b1.items.some((x) => x.id === kFar && x.kind === 'sticky'), 'a sticky under no phase is left alone');
  ok(!b1.items.some((x) => x.kind === 'shape') && b1.items.filter((x) => x.kind === 'card' && x.ref?.kind === 'task').length === 4, 'the boxes and stickies it used became live cards');
  await A.tap(T('.cc-update-plan'));
  ok(await A.until(`[...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('Nothing new to add'))`, 6000), 'Update plan again: nothing new, nothing doubled');
  ok((await api('GET', '/state')).goals.filter((g) => g.campaignId === camp.id).length === 3, 'still three phases');
  await A.tap(`[...document.querySelectorAll('#camps .cc-boardwrap button')].find((b) => b.textContent.includes('View as plan'))`);
  ok(await A.until(`${T('.cc-body')}?.dataset.tab === 'plan' && [...document.querySelectorAll('#camps .cc-phase')].some((p) => p.textContent.includes('Install') && p.textContent.includes('Measure windows'))`), 'View as plan: Install and its tasks on Plan');
  // From the review: arrows both ways don't make two phases wait for each other; the toast leaves out what's zero.
  await tabTo('sketch');
  await A.until(`!!${T('.cc-update-plan')}`, 8000);
  const [sW, sT] = ['w', 't'].map(id);
  await api('POST', `/boards/${board.id}/ops`, { ops: [
    put({ id: sW, kind: 'shape', shape: 'rect', x: 1300, y: 0, w: 240, h: 90, text: 'Wrap up' }),
    put({ id: sT, kind: 'shape', shape: 'rect', x: 1600, y: 0, w: 240, h: 90, text: 'Thank you' }),
    lnk(sW, sT), lnk(sT, sW),
  ] });
  await A.until(`[...document.querySelectorAll('#camps .cc-board .wb-item.k-shape')].length === 2`, 6000);
  await A.tap(T('.cc-update-plan'));
  ok(await A.until(`[...document.querySelectorAll('.toast')].some((t) => /Added 2 phases(?! and)/.test(t.textContent))`, 8000), 'the toast says “Added 2 phases” (no “and 0 tasks”): ' + await A.ev(`[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' / ')`));
  const gW = (await api('GET', '/state')).goals.filter((g) => g.campaignId === camp.id);
  const W1 = gW.find((g) => g.title === 'Wrap up'), T1 = gW.find((g) => g.title === 'Thank you');
  ok(T1 && W1 && (T1.blockedBy || []).includes(W1.id) && !(W1.blockedBy || []).includes(T1.id), 'arrows both ways: one waits for the other, not each for each');
  // A failure halfway: what was made is still turned into cards and said; the rest stays to try again.
  const [sF, kA, kB] = ['f', 'ka', 'kb'].map(id);
  await api('POST', `/boards/${board.id}/ops`, { ops: [
    put({ id: sF, kind: 'shape', shape: 'rect', x: 1900, y: 0, w: 240, h: 90, text: 'Follow up' }),
    put({ id: kA, kind: 'sticky', x: 1910, y: 200, w: 200, h: 120, text: 'Send a survey' }),
    put({ id: kB, kind: 'sticky', x: 1910, y: 360, w: 200, h: 120, text: 'Post a thank-you' }),
  ] });
  await A.until(`[...document.querySelectorAll('#camps .cc-board .wb-item.k-sticky')].some((n) => n.textContent.includes('Post a thank-you'))`, 6000);
  await A.ev(`(() => { window.__f = window.fetch; let n = 0; window.fetch = (u, o) => (String(u).includes('/api/tasks') && o?.method === 'POST' && ++n === 2 ? Promise.resolve(new Response(JSON.stringify({ error: 'Test: no more tasks' }), { status: 400, headers: { 'content-type': 'application/json' } })) : window.__f(u, o)); return true; })()`);
  await A.tap(T('.cc-update-plan'));
  ok(await A.until(`[...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('Added 1 phase and 1 task') && t.textContent.includes('Test: no more tasks'))`, 8000), 'a failure halfway: it says what it added, then why it stopped: ' + await A.ev(`[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' / ')`));
  await A.ev(`window.fetch = window.__f; true`);
  await sleep(800);
  const bF = await api('GET', '/boards/' + board.id);
  ok(!bF.items.some((x) => x.id === sF) && !bF.items.some((x) => x.id === kA) && bF.items.some((x) => x.id === kB && x.kind === 'sticky'), 'what it made became cards; the sticky it couldn’t do is still a sticky');
  await A.tap(T('.cc-update-plan'));
  let tFU = [];
  for (let i = 0; i < 30 && tFU.length < 2; i++) { const st3 = await api('GET', '/state'); const fu = st3.goals.find((g) => g.campaignId === camp.id && g.title === 'Follow up'); tFU = st3.tasks.filter((t) => t.goalId === fu?.id); await sleep(150); }
  ok(tFU.map((t) => t.text).sort().join('|') === 'Post a thank-you|Send a survey', 'Update plan again finishes the job, nothing twice: ' + tFU.map((t) => t.text).join('|'));
  await tabTo('plan');
  // A narrow screen: no Sketch tab; a stored Sketch tab shows Plan.
  await tabTo('sketch');
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 820, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  await A.ev(`document.querySelector('#camps .cc-tab')?.click(); true`); await tabTo('work'); await sleep(200);
  ok(await A.until(`![...document.querySelectorAll('#camps .cc-tab')].some((b) => b.dataset.ctab === 'sketch')`), 'narrow: no Sketch tab');
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  // Start from a sketch: the builder's option opens the new campaign on Sketch, its board drawn.
  await A.tap(T('.cc-crumb button'));
  await A.until(`[...document.querySelectorAll('#camps button')].some((b) => b.textContent === '+ New')`);
  await A.tap(`[...document.querySelectorAll('#camps button')].find((b) => b.textContent === '+ New')`);
  await A.until(`!!document.querySelector('#sheet .sheet.camp-builder .cb-grid')`);
  await A.tap(`document.querySelector('#sheet .cb-kind[data-kind=campaign]')`); // + New asks Checklist or Campaign first (2026-11-27)
  await A.ev(`(() => { const e = document.querySelector('#sheet .cb-name'); e.value = 'Fall push'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  ok(await A.until(`/Start from a sketch/.test(document.querySelector('#sheet .cb-board-pick')?.textContent || '')`), 'the builder offers Start from a sketch');
  await A.ev(`document.querySelector('#sheet .cb-board-pick input').click(); true`);
  ok(await A.ev(`document.querySelector('#sheet .cb-board-pick input').checked`), 'ticked');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Make the campaign')`);
  ok(await A.until(`${T('.cc-name')}?.textContent === 'Fall push' && ${T('.cc-body')}?.dataset.tab === 'sketch' && document.querySelectorAll('#camps .cc-board .wb-item.k-shape').length === 3`, 12000), 'it opens on Sketch with three phase boxes to name: ' + await A.ev(`[${T('.cc-name')}?.textContent, ${T('.cc-body')}?.dataset.tab, document.querySelectorAll('#camps .cc-board .wb-item').length, (${T('.cc-body')}?.textContent || '').slice(0, 120), document.querySelector('#sheet').className].join(' | ')`));
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
try { chrome.kill(); } catch {}
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-6).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
