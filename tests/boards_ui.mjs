// Boards (2026-11-19): + New board opens straight onto a blank board (jobs in columns, each with its customer). Columns
// are changed where they are: rename by clicking the name, + Add column, ⋯ to color, move or delete (its jobs move to
// another column), drag to reorder. A job gets its customer from Contacts or a new one (saved in Contacts too), and
// + Add a detail adds what jobs usually need. "Use a template instead" swaps an untouched blank board for a template.
import { CHROME, SERVER_DIR } from './chromebin.mjs';
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/boardsui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4879, APP = `http://127.0.0.1:${PORT}/`, CDP = 9513;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-boardsui`, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-boardsui`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
const P = (x) => `document.querySelector('#projects ${x}')`;
const cols = () => A.ev(`[...document.querySelectorAll('#projects .pj-col[data-choice] .pj-col-h b')].map((b) => b.textContent).join('|')`);
const shot = async (name) => { if (!process.env.SHOT) return; const r = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(`${process.env.SHOT}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Brd ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  await api('PATCH', '/workspace', { tools: { projects: true, contacts: true } });
  await api('POST', '/projects', { template: 'crm', name: 'Sales' });
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=projects]')`, 15000), 'Ada is in');
  ok(await A.ev(`document.querySelector('#tabs [data-tab=projects]').textContent.trim() === 'Boards'`), 'the tab is called Boards');
  await A.ev(`document.querySelector('#tabs [data-tab=projects]').click(); true`);
  ok(await A.until(`${P('h2')}?.textContent === 'Boards' && !!${P('.pj-new-board')} && !!${P('.pj-use-tpl')}`), 'Boards has + New board and Use a template');
  // + New board: straight onto a blank board.
  await A.tap(P('.pj-new-board'));
  ok(await A.until(`${P('.pj-name')}?.textContent === 'Board' && !!${P('.pj-board')}`), '+ New board opens a blank board, no questions');
  ok(await cols() === 'New|Scheduled|In progress|Done', 'with columns New, Scheduled, In progress, Done: ' + await cols());
  ok(await A.ev(`!!${P('.pj-blank-hint')} && !!${P('.pj-blank-tpl')}`), 'it says how to change it, with Use a template instead');
  await shot('board-blank');
  // Rename a column by clicking its name.
  await A.tap(`[...document.querySelectorAll('#projects .pj-col-name')].find((b) => b.textContent === 'New')`);
  ok(await A.until(`document.activeElement?.classList.contains('pj-col-input')`), 'clicking a column’s name lets you type a new one');
  await A.ev(`(() => { const i = document.activeElement; i.value = 'Leads'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  ok(await A.until(`[...document.querySelectorAll('#projects .pj-col-h b')].map((b) => b.textContent).join('|') === 'Leads|Scheduled|In progress|Done'`), 'Enter renames it');
  // + Add column.
  await A.tap(P('.pj-addcol-btn'));
  ok(await A.until(`document.activeElement?.classList.contains('pj-col-input') && !!document.activeElement.closest('.pj-coladd')`), '+ Add column asks for a name');
  await A.ev(`(() => { const i = document.activeElement; i.value = 'Invoiced'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  ok(await A.until(`[...document.querySelectorAll('#projects .pj-col-h b')].map((b) => b.textContent).join('|') === 'Leads|Scheduled|In progress|Done|Invoiced'`), 'and adds it at the end');
  ok(await A.until(`document.activeElement?.classList.contains('pj-col-input') && !!document.activeElement.closest('.pj-coladd')`), 'ready for another one');
  await A.ev(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
  // ⋯ → Move left.
  const menu = async (col, label) => { await A.tap(`[...document.querySelectorAll('#projects .pj-col')].find((c) => c.querySelector('.pj-col-h b')?.textContent === ${JSON.stringify(col)}).querySelector('.pj-col-more')`); await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes(${JSON.stringify(label)}))`); await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes(${JSON.stringify(label)})).click(); true`); };
  await menu('Invoiced', 'Move left');
  ok(await A.until(`[...document.querySelectorAll('#projects .pj-col-h b')].map((b) => b.textContent).join('|') === 'Leads|Scheduled|In progress|Invoiced|Done'`), '⋯ → Move left moves it');
  await menu('Invoiced', 'Color');
  await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes('Rose'))`);
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Rose')).click(); true`);
  await sleep(400);
  const proj = (await api('GET', '/projects')).find((x) => x.name === 'Board');
  const stage = proj.types[0].fields.find((f) => f.key === 'stage');
  ok(stage.choices.find((c) => c.label === 'Invoiced')?.color === 'rose', '⋯ → Color… sets its color');
  // Drag a column by its top.
  await A.ev(`document.querySelector('#projects .pj-body').scrollLeft = 0; true`);
  const pos = async (expr) => A.ev(`(() => { const r = (${expr}).getBoundingClientRect(); return [r.left + 40, r.top + r.height / 2]; })()`);
  const from = await pos(`[...document.querySelectorAll('#projects .pj-col-h')].find((h) => h.querySelector('b')?.textContent === 'Scheduled')`);
  const to = await pos(`[...document.querySelectorAll('#projects .pj-col')].find((c) => c.querySelector('.pj-col-h b')?.textContent === 'Leads')`);
  await A.mouse('mouseMoved', from[0], from[1]); await A.mouse('mousePressed', from[0], from[1]);
  for (let i = 1; i <= 12; i++) await A.mouse('mouseMoved', from[0] + (to[0] - 20 - from[0]) * i / 12, from[1]);
  await A.mouse('mouseReleased', to[0] - 20, to[1]);
  ok(await A.until(`[...document.querySelectorAll('#projects .pj-col-h b')].map((b) => b.textContent).join('|') === 'Scheduled|Leads|In progress|Invoiced|Done'`), 'dragging a column by its top moves it: ' + await cols());
  // A job: + New in a column, its customer as a new contact (saved in Contacts too).
  await A.tap(`[...document.querySelectorAll('#projects .pj-col')].find((c) => c.querySelector('.pj-col-h b')?.textContent === 'Leads').querySelector('.pj-newrow')`);
  ok(await A.until(`document.activeElement === ${P('.pj-panel .pj-title')}`), '+ New makes a job and opens it, ready for its name');
  await sleep(800);
  ok(await A.ev(`document.activeElement === ${P('.pj-panel .pj-title')}`), 'and stays ready while its customer’s visits load');
  await A.ev(`(() => { const i = document.activeElement; i.value = 'Kitchen blinds'; i.dispatchEvent(new Event('change')); i.blur(); })()`);
  await sleep(300);
  ok(await A.until(`!!${P('.pj-panel .pj-cust.empty')} && [...document.querySelectorAll('#projects .pj-act-btns button')].map((b) => b.textContent).join('|').includes('+ Task|+ Campaign')`), 'the job has a customer to pick, + Task and + Campaign');
  ok(await A.ev(`!document.querySelector('#projects .pj-blank-hint')`), 'the blank-board note goes once a job is on it');
  // A real click (2026-11-19: a page-wide .empty style had made this button unclickable).
  await A.tap(`[...document.querySelectorAll('#projects .pj-cust .linkish')].find((b) => b.textContent === 'Pick a customer')`);
  ok(await A.until(`!!document.querySelector('#sheet .pj-pick-row.new')`), 'Pick a customer opens Contacts to choose from (a real click)');
  await A.ev(`(() => { const q = document.querySelector('#sheet input[type=search]'); q.value = 'Pat Lee'; q.dispatchEvent(new Event('input')); })()`);
  await A.tap(`document.querySelector('#sheet .pj-pick-row.new')`);
  await A.until(`document.querySelector('#sheet h3, #sheet .sheet-title, #sheet')?.textContent.includes('New contact') && !!document.querySelector('#sheet input[type=tel]')`);
  await A.ev(`(() => { const i = document.querySelector('#sheet input[type=tel]'); i.value = '555-0100'; })()`);
  await A.tap(`document.querySelector('#sheet .primary-btn')`);
  // The job window is in tabs (2026-11-19): the Overview says who it's for, and its Client tab has the card.
  ok(await A.until(`${P('.pj-panel .pj-client-line b')}?.textContent === 'Pat Lee'`), '+ New contact sets the job’s customer (on its Overview)');
  await A.tap(P('.pj-panel .pj-client-line'));
  ok(await A.until(`${P('.pj-panel .pj-tab.on')}?.dataset.tab === 'client' && ${P('.pj-panel .pj-cust-h b')}?.textContent === 'Pat Lee'`), 'which opens the Client tab, with the customer’s card (a real click)');
  await A.tap(P('.pj-panel .pj-tab[data-tab=overview]'));
  await A.until(`!!${P('.pj-panel .pj-add-detail')}`);
  ok((await api('GET', '/contacts')).contacts.some((c) => c.name === 'Pat Lee' && c.phone === '555-0100'), 'and Pat is in Contacts too');
  // + Add a detail.
  await A.tap(P('.pj-add-detail'));
  ok(await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes('Photos')) && ![...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes('Customer ·'))`), '+ Add a detail offers what jobs need (not Customer, it’s there)');
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Checklist')).click(); true`);
  // The checklist is added to the board first (a toast says so), then the window is drawn again.
  await A.until(`[...document.querySelectorAll('.toast, #toast')].some((x) => /Checklist added/.test(x.textContent))`, 6000);
  await sleep(300);
  await A.tap(P('.pj-panel .pj-tab[data-tab=work]'));
  ok(await A.until(`document.querySelector('#projects .pj-panel').textContent.includes('Clean up')`), 'Checklist adds a checklist to every job, with steps to start (on its Work tab)');
  // Ticking and adding go one step at a time, and the name on the tick is the server's (the team audit, 2026-11-28).
  await A.tap(P('.pj-panel .pj-cl-row input[type=checkbox]'));
  ok(await A.until(`${P('.pj-panel .pj-cl-row.done small')}?.textContent.startsWith('Ada ·')`), 'ticking a step shows who ticked it');
  await A.ev(`(() => { const i = ${P('.pj-panel .pj-items .pj-it-in[placeholder="+ Add a step"]')}; i.value = 'Haul away the old blinds'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
  ok(await A.until(`[...document.querySelectorAll('#projects .pj-panel .pj-cl-row')].at(-1)?.textContent.includes('Haul away the old blinds') && ${P('.pj-panel .pj-cl-row.done')} !== null`), '+ Add a step adds one at the end, and the tick stays');
  // ⋯ on a step (whoever runs the job): reword it, move it, mark it not needed (tests/job_tasks.mjs).
  const rows = `[...document.querySelectorAll('#projects .pj-panel .pj-cl-row')]`;
  const menuPick = async (label) => { await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === ${JSON.stringify(label)})`); await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === ${JSON.stringify(label)}).click(); true`); };
  await A.tap(`${rows}.at(-1).querySelector('.pj-cl-more')`);
  await menuPick('Reword');
  ok(await A.until(`!!${P('.pj-panel .pj-cl-edit')} && document.activeElement === ${P('.pj-panel .pj-cl-edit')}`), '⋯ → Reword turns the step into a box to write in');
  await A.ev(`(() => { const i = ${P('.pj-panel .pj-cl-edit')}; i.value = 'Haul away the old blinds and brackets'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
  ok(await A.until(`${rows}.at(-1)?.querySelector('.pick span')?.textContent === 'Haul away the old blinds and brackets'`), 'Enter saves the new words');
  await A.tap(`${rows}.at(-1).querySelector('.pj-cl-more')`);
  await menuPick('Move up');
  ok(await A.until(`${rows}.at(-2)?.textContent.includes('Haul away the old blinds and brackets')`), '⋯ → Move up moves it up one');
  await A.tap(`${rows}.at(-2).querySelector('.pj-cl-more')`);
  await menuPick('Not needed');
  ok(await A.until(`${rows}.at(-2)?.classList.contains('skip') && ${rows}.at(-2).querySelector('.pj-cl-skip')?.textContent === 'Not needed' && ${rows}.at(-2).querySelector('input').disabled`), '⋯ → Not needed keeps it on the list, struck out, marked Not needed');
  ok(await A.until(`/not needed/.test(${P('.pj-panel .pj-cl-n')}?.textContent || '')`), 'and the count says how many aren’t needed: ' + await A.ev(`${P('.pj-panel .pj-cl-n')}?.textContent`));
  await shot('board-job');
  // Delete a column that has a job: its jobs move.
  await menu('Leads', 'Delete column');
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.classList.contains('danger')).click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#menu .mh')].some((x) => /Move its 1 job to/.test(x.textContent))`), 'deleting a column with a job asks where it goes');
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Scheduled').click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#projects .pj-col-h b')].map((b) => b.textContent).join('|') === 'Scheduled|In progress|Invoiced|Done' && [...document.querySelectorAll('#projects .pj-col')].find((c) => c.querySelector('.pj-col-h b')?.textContent === 'Scheduled').textContent.includes('Kitchen blinds')`), 'the column goes and its job is now Scheduled');
  // Use a template instead: an untouched blank board is swapped for the template.
  await A.tap(`document.querySelector('#projects .pj-top [aria-label="All boards"]')`);
  await A.tap(P('.pj-new-board'));
  ok(await A.until(`${P('.pj-name')}?.textContent === 'Board 2' && !!${P('.pj-blank-tpl')}`), 'a second blank board is Board 2');
  await A.tap(P('.pj-blank-tpl'));
  ok(await A.until(`${P('.pj-head h2')}?.textContent === 'Use a template' && !!${P('.pjn')}`), 'Use a template instead opens the template list');
  await A.tap(`[...document.querySelectorAll('#projects .pjn-row')].find((b) => b.textContent.includes('Sales pipeline'))`);
  await A.until(`${P('.pjn-detail h3')}?.textContent === 'Sales pipeline'`);
  await A.tap(P('.pjn-create'));
  ok(await A.until(`${P('.pj-name')}?.textContent === 'Sales pipeline'`), 'picking one makes it');
  await sleep(300);
  const names = (await api('GET', '/projects')).map((x) => x.name).sort().join('|');
  ok(names === 'Board|Sales|Sales pipeline', 'and the untouched Board 2 is gone (the used Board stays): ' + names);
  // Esc from Use a template goes back to the blank board.
  await A.tap(`document.querySelector('#projects .pj-top [aria-label="All boards"]')`);
  await A.tap(P('.pj-new-board'));
  await A.until(`${P('.pj-name')}?.textContent === 'Board 2'`);
  await A.tap(P('.pj-blank-tpl'));
  await A.until(`!!${P('.pjn')}`);
  await A.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  ok(await A.until(`${P('.pj-name')}?.textContent === 'Board 2'`), 'Esc goes back to the blank board');
  // + Campaign → New campaign for this job; its empty brief takes a real click.
  await A.tap(`document.querySelector('#projects .pj-top [aria-label="All boards"]')`);
  await A.tap(`[...document.querySelectorAll('#projects .pj-card')].find((c) => c.querySelector('b')?.textContent.trim() === 'Board')`);
  await A.tap(`[...document.querySelectorAll('#projects .pj-card-r')].find((c) => c.textContent.includes('Kitchen blinds'))`);
  if (await A.ev(`!${P('.pj-camp-btn')}`)) { await A.tap(P('.pj-panel .pj-tab[data-tab=overview]')); await A.until(`!!${P('.pj-camp-btn')}`); } // + Campaign is on the Overview
  await A.tap(P('.pj-camp-btn'));
  await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === 'New campaign for this job')`);
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'New campaign for this job').click(); true`);
  // The brief is the Command Center's Objective (2026-11-20, part 1), on the campaign's Overview.
  ok(await A.until(`!!document.querySelector('#camps .cc-bf.empty[data-field=brief]')`, 8000), '+ Campaign makes a campaign for the job, with no brief yet');
  await A.tap(`document.querySelector('#camps .cc-bf.empty[data-field=brief]')`);
  ok(await A.until(`!!document.querySelector('#camps .cc-bf-edit')`), 'clicking the empty brief opens it to write (a real click)');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
chrome.kill();
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-6).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
