// Command Center part 4 (2026-11-20): the Work tab shows the campaign’s tasks as a List, a Board (columns by status,
// phase or person; drag a card across to change it), a Timeline (a bar from start to due, dragged or pulled by
// either end, drawn on an empty row, arrows for what it waits for) and a Calendar (drag a task to another day).
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/cviews';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4979, APP = `http://127.0.0.1:${PORT}/`, CDP = 9553;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-cviews`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-cviews`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, SKIP_SETUP: '1', PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
const dk = (d) => d.toISOString().slice(0, 10);
const plus = (k, n) => { const d = new Date(k + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return dk(d); };
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Cv ' + t, name: 'Joshua', email: `j${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  const st0 = await api('GET', '/state');
  const me = st0.me.memberId;
  const camp = await api('POST', '/campaigns', { name: 'Shade installs' });
  const prep = await api('POST', '/goals', { campaignId: camp.id, title: 'Prep' });
  const inst = await api('POST', '/goals', { campaignId: camp.id, title: 'Install' });
  const A0 = await api('POST', '/tasks', { goalId: prep.id, text: 'Order fabric', due: plus(dk(new Date()), 2) });
  const B0 = await api('POST', '/tasks', { goalId: prep.id, text: 'Call the customer' });
  const C0 = await api('POST', '/tasks', { goalId: inst.id, text: 'Hang the shades', due: plus(dk(new Date()), 6), blockedBy: [A0.id] });
  const task = async (id) => (await api('GET', '/state')).tasks.find((x) => x.id === id);
  const wait = async (id, f) => { let x; for (let i = 0; i < 40; i++) { x = await task(id); if (f(x)) return x; await sleep(150); } return x; };
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=camps]')`, 15000);
  for (let i = 0; i < 20 && !(await A.ev(`!!document.querySelector('.camp-card')`)); i++) { await A.ev(`document.querySelector('[data-tab=camps]')?.click(); true`); await sleep(300); }
  await A.tap(`document.querySelector('.camp-card')`);
  await A.until(`!!${T('.cc-tab[data-ctab=work]')}`);
  await A.ev(`${T('.cc-tab[data-ctab=work]')}.click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#camps .cc-wview [data-wv]')].map((b) => b.dataset.wv).join() === 'list,board,timeline,calendar' && !!${T('.cc-table')}`), 'Work has List, Board, Timeline and Calendar, on List');
  const drag = async ([x1, y1], [x2, y2]) => {
    await A.mouse('mouseMoved', x1, y1); await A.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 10; i++) { await A.mouse('mouseMoved', x1 + ((x2 - x1) * i) / 10, y1 + ((y2 - y1) * i) / 10); await sleep(20); }
    await A.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1 }); await sleep(350);
  };
  const mid = (expr) => A.ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  const at = (expr) => A.ev(`(() => { const e = ${expr}; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  const card = (id) => T(`.ccb-card[data-task="${id}"]`);
  const col = (k) => T(`.ccb-col[data-col="${k}"]`);
  // Board, by status.
  await A.ev(`${T('.cc-wview [data-wv=board]')}.click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#camps .ccb-col')].map((c) => c.dataset.col).join() === 'open,doing,wait,done'`), 'Board: Not started, In progress, Waiting, Done: ' + await A.ev(`[...document.querySelectorAll('#camps .ccb-col')].map((c) => c.dataset.col).join()`));
  ok(await A.ev(`!!${col('open')}.querySelector('[data-task="${A0.id}"]') && !!${col('wait')}.querySelector('[data-task="${C0.id}"]')`), 'a task that waits for another is under Waiting');
  await drag(await mid(card(A0.id)), await at(col('doing')));
  ok((await wait(A0.id, (x) => x.status === 'doing')).status === 'doing', 'dragged to In progress, it’s in progress');
  ok(await A.until(`!!${col('doing')}.querySelector('[data-task="${A0.id}"]')`), 'and the card is there');
  await drag(await mid(card(C0.id)), await at(col('doing')));
  await sleep(300);
  ok((await task(C0.id)).status !== 'doing' && await A.ev(`!!${col('wait')}.querySelector('[data-task="${C0.id}"]')`), 'a waiting task stays under Waiting when dragged to In progress (it moves on by itself)');
  ok(await A.until(`/Waiting on “Order fabric”/.test(document.querySelector('#toast, .toast')?.textContent || '')`, 3000), 'and says what it waits for: ' + await A.ev(`document.querySelector('#toast, .toast')?.textContent`));
  await drag(await mid(card(A0.id)), await at(col('done')));
  ok((await wait(A0.id, (x) => x.done)).done === true, 'dragged to Done, it’s done');
  ok(await A.until(`!!${col('open')}.querySelector('[data-task="${C0.id}"]')`), 'and what waited for it moves to Not started');
  await shot('cv-board');
  // By phase, then by person.
  await A.ev(`${T('.ccb-by [data-by=phase]')}.click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#camps .ccb-col')].map((c) => c.querySelector('.ccb-h b').textContent).join() === 'Prep,Install'`), 'Columns: Phase');
  await drag(await mid(card(B0.id)), await at(col(inst.id)));
  ok((await wait(B0.id, (x) => x.goalId === inst.id)).goalId === inst.id, 'a card dragged to another phase moves there');
  await A.ev(`${T('.ccb-by [data-by=person]')}.click(); true`);
  ok(await A.until(`!!${col('')} && !!${col(me)}`), 'Columns: Person (Nobody, then each person)');
  await drag(await mid(card(B0.id)), await at(col(me)));
  ok((await wait(B0.id, (x) => x.assigneeId === me)).assigneeId === me, 'dragged onto Joshua, it’s his');
  // Timeline.
  await A.ev(`${T('.cc-wview [data-wv=timeline]')}.click(); true`);
  await A.ev(`${T('.cc-wf [data-wf=all]')}.click(); true`);
  ok(await A.until(`!!${T(`.cct-bar[data-task="${C0.id}"]`)} && !${T(`.cct-bar[data-task="${B0.id}"]`)}`), 'Timeline: a bar for each dated task, none for one with no days');
  ok(await A.until(`document.querySelectorAll('#camps .cct-links path:not(marker path)').length >= 1`), 'an arrow for what it waits for');
  ok(await A.ev(`[...document.querySelectorAll('#camps .cct-phase .cct-name b')].map((b) => b.textContent).join() === 'Prep,Install'`), 'grouped by phase');
  const g = await A.ev(`(() => { const e = ${T('.cct')}; return { from: e.dataset.from, px: Number(e.dataset.px) }; })()`);
  const dx = (k) => Math.round((Date.parse(k) - Date.parse(g.from)) / 864e5);
  const laneX = async (id, k) => A.ev(`(() => { const l = ${T(`.cct-lane[data-task="${id}"]`)}; const r = l.getBoundingClientRect(); return [r.left + ${dx(k) * g.px + g.px / 2}, r.top + r.height / 2]; })()`);
  const today = dk(new Date());
  await A.ev(`(() => { const l = ${T(`.cct-lane[data-task="${B0.id}"]`)}; l.scrollIntoView({ block: 'center' }); ${T('.cct-scroll')}.scrollLeft = ${dx(today) * g.px} - 200; return true; })()`);
  await sleep(200);
  await drag(await laneX(B0.id, plus(today, 1)), await laneX(B0.id, plus(today, 3)));
  let b = await wait(B0.id, (x) => x.due);
  ok(b.startOn === plus(today, 1) && b.due === plus(today, 3), 'dragging across an empty row gives it a start and a due day: ' + [b.startOn, b.due]);
  // Pull its end out two days, then move it a day earlier.
  const rEnd = await A.ev(`(() => { const r = ${T(`.cct-bar[data-task="${B0.id}"] .cct-h.r`)}.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await drag(rEnd, [rEnd[0] + 2 * g.px, rEnd[1]]);
  b = await wait(B0.id, (x) => x.due === plus(today, 5));
  ok(b.due === plus(today, 5) && b.startOn === plus(today, 1), 'pulling its end makes it due two days later: ' + [b.startOn, b.due]);
  const body = await at(T(`.cct-bar[data-task="${B0.id}"]`));
  await drag(body, [body[0] - g.px, body[1]]);
  b = await wait(B0.id, (x) => x.due === plus(today, 4));
  ok(b.startOn === today && b.due === plus(today, 4), 'dragging the bar moves both days: ' + [b.startOn, b.due]);
  const lEnd = await A.ev(`(() => { const r = ${T(`.cct-bar[data-task="${B0.id}"] .cct-h.l`)}.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await drag(lEnd, [lEnd[0] + 2 * g.px, lEnd[1]]);
  b = await wait(B0.id, (x) => x.startOn === plus(today, 2));
  ok(b.startOn === plus(today, 2) && b.due === plus(today, 4), 'pulling its start in starts it later: ' + [b.startOn, b.due]);
  await shot('cv-timeline');
  // Calendar.
  await A.ev(`${T('.cc-wview [data-wv=calendar]')}.click(); true`);
  const cDue = (await task(C0.id)).due;
  ok(await A.until(`!!${T('.ccc')}`), 'Calendar: the month');
  for (let i = 0; i < 3 && !(await A.ev(`!!${T(`.ccc-day[data-day="${cDue}"]:not(.other)`)}`)); i++) { await A.ev(`${T('.ccc-next')}.click(); true`); await sleep(200); }
  ok(await A.until(`!!${T(`.ccc-day[data-day="${cDue}"] .ccc-chip[data-task="${C0.id}"]`)}`), 'each task on its due day');
  const target = plus(cDue, -1);
  await drag(await mid(T(`.ccc-chip[data-task="${C0.id}"]`)), await at(T(`.ccc-day[data-day="${target}"]`)));
  ok((await wait(C0.id, (x) => x.due === target)).due === target, 'dragged to the day before, it’s due then');
  const D0 = await api('POST', '/tasks', { goalId: inst.id, text: 'Send the invoice' });
  ok(await A.until(`!!${T(`.ccc-tray .ccc-chip[data-task="${D0.id}"]`)}`, 8000), 'a task with no due day waits in the tray');
  await drag(await mid(T(`.ccc-tray .ccc-chip[data-task="${D0.id}"]`)), await at(T(`.ccc-day[data-day="${cDue}"]`)));
  ok((await wait(D0.id, (x) => x.due === cDue)).due === cDue, 'dragged onto a day, it’s due then');
  await shot('cv-calendar');
  // The drawer has Starts.
  await A.tap(T(`.ccc-chip[data-task="${D0.id}"]`));
  ok(await A.until(`!!document.querySelector('.td-start')`), 'the task drawer has a Starts day');
  // From the live check (column-a9, 2026-11-20): while someone types, work arriving from others holds the page's redraw
  // until they leave the field. Pressing a button used to redraw it before the click landed, losing what was typed.
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`);
  await A.ev(`${T('.cc-tab[data-ctab=activity]')}.click(); true`);
  await A.until(`[...document.querySelectorAll('#camps button')].some((b) => b.textContent === 'Log a call or email')`);
  await A.ev(`[...document.querySelectorAll('#camps button')].find((b) => b.textContent === 'Log a call or email').click(); true`);
  await A.until(`!!${T('.log-contact')}`);
  await A.ev(`${T('.log-contact')}.focus(); true`);
  await A.cmd('Input.insertText', { text: 'Old Town Shades' });
  await api('POST', '/tasks', { goalId: inst.id, text: 'Someone else’s change' }); // arrives over the socket while typing
  await sleep(900);
  ok(await A.ev(`document.activeElement === ${T('.log-contact')} && ${T('.log-contact')}.value === 'Old Town Shades'`), '(still typing, the page waits)');
  await A.tap(T('.log-outcomes .oc-0'));
  let att = [];
  for (let i = 0; i < 30 && !att.length; i++) { await sleep(150); att = (await api('GET', '/state')).attempts.filter((x) => x.campaignId === camp.id); }
  ok(att.length === 1 && /Old Town Shades/.test(JSON.stringify(att[0])), 'clicking an outcome with the mouse saves the call with its name: ' + JSON.stringify(att.map((x) => x.contact || x.who)));
  // A task added in a phase (Overview's Add task, picked from its tile) shows at once, and the field stays ready.
  await A.tap(T('.cc-tab[data-ctab=overview]'));
  const addQ = `document.querySelector('#camps .cc-ov .cc-ppanel .cc-pp-name')`;
  await A.tap(`document.querySelector('#camps .cc-ov .cc-ptile.phase[data-phase="${prep.id}"]')`);
  await A.until(`document.activeElement === ${addQ}`);
  await A.cmd('Input.insertText', { text: 'Measure the windows' });
  await A.ev(`${addQ}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true`);
  ok(await A.until(`document.querySelector('#camps .cc-ov .cc-pt-phase[data-id="${prep.id}"]')?.textContent.includes('Measure the windows')`, 5000), 'a task added in a phase shows right away');
  ok(await A.until(`document.activeElement === ${addQ} && !${addQ}.value`, 3000), 'and the add field still has the cursor');
  // The builder's last stage has no stray "null" where Next would be.
  await A.ev(`${T('.cc-edit')}.click(); true`);
  await A.until(`!!document.querySelector('.cb-stage[data-stage="3"]')`);
  await A.ev(`document.querySelector('.cb-stage[data-stage="3"]').click(); true`);
  ok(await A.until(`!!document.querySelector('.cb-stage-nav .cb-back')`) && !/null/.test(await A.ev(`document.querySelector('.cb-stage-nav').textContent`)), 'the builder’s last stage shows Back and nothing else: ' + await A.ev(`document.querySelector('.cb-stage-nav').textContent`));
  // The drawer's "waits for" chip opens what it waits for (a live check, 2026-11-20).
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`);
  const X0 = await api('POST', '/tasks', { goalId: inst.id, text: 'Pick up the brackets' });
  const Y0 = await api('POST', '/tasks', { goalId: inst.id, text: 'Mount the brackets', blockedBy: [X0.id] });
  await A.tap(T('.cc-tab[data-ctab=work]'));
  await A.until(`!!${T('.cc-wview [data-wv=list]')}`);
  await A.tap(T('.cc-wview [data-wv=list]'));
  await A.tap(T('.cc-wf [data-wf=all]'));
  await A.until(`!!${T(`.cc-tr[data-task="${Y0.id}"]`)}`, 8000);
  for (let i = 0; i < 4 && !(await A.ev(`document.querySelector('#sheet .td')?.dataset.task === ${JSON.stringify(Y0.id)}`)); i++) { await A.ev(`${T(`.cc-tr[data-task="${Y0.id}"]`)}.click(); true`); await sleep(400); }
  ok(await A.until(`document.querySelector('#sheet button.td-dep')?.textContent.includes('Pick up the brackets')`), 'a waiting task’s drawer shows what it waits for, as a button');
  await A.tap(`document.querySelector('#sheet button.td-dep')`);
  ok(await A.until(`document.querySelector('#sheet .td')?.dataset.task === ${JSON.stringify(X0.id)}`), 'clicking it opens that task');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
chrome.kill(); srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-12).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
