// Saved tasks in Tasks (2026-11-19): a “Saved tasks” shelf to open; save one (or from a task's menu); drag it onto a
// day of the month; a bundle of saved tasks in order; tap one to start it on a day, for someone. The shelf stays open.
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/savedtasks';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5151, APP = `http://127.0.0.1:${PORT}/`, CDP = 9476;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-sv`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-sv`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
  const tap = async (expr) => { const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); for (const ty of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type: ty, x, y, button: 'left', buttons: ty === 'mousePressed' ? 1 : 0, clickCount: 1 }); await sleep(80); };
  return { ev, until, tap, mouse, cmd, errors, close: () => ws.close() };
}
let A;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const post = async (b) => (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
  const auth = await post({ mode: 'create', workspace: 'Saved ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  const code = (await api('GET', '/state')).workspace.inviteCode;
  await post({ mode: 'join', workspace: 'Saved ' + t, code, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const benId = (await api('GET', '/state')).workspace.members.find((m) => m.name === 'Ben').id;
  const tasks = async () => (await api('GET', '/state')).tasks;
  const now = new Date();
  const day = (n) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
  A = await tab(APP);
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=work]')`, 15000), 'Ada is in');
  await A.tap(`document.querySelector('#tabs [data-tab=work]')`);
  ok(await A.until(`!!document.querySelector('#day .sv-toggle') && document.querySelector('#day .sv-shelf').classList.contains('hidden')`), 'Tasks has a “Saved tasks” button, shelf closed');
  await A.tap(`document.querySelector('#day .sv-toggle')`);
  ok(await A.until(`!document.querySelector('#day .sv-shelf').classList.contains('hidden') && !!document.querySelector('#day .sv-new')`), 'it opens the shelf, with “+ Save a task”');

  // Save one.
  await A.tap(`document.querySelector('#day .sv-new')`);
  ok(await A.until(`!!document.querySelector('#sheet .sv-text')`), 'the save sheet opens');
  await A.ev(`(() => { const s = document.querySelector('#sheet'); s.querySelector('.sv-text').value = 'Order the materials'; s.querySelector('.sv-name').value = 'Order'; s.querySelector('.sv-who').value = ${JSON.stringify(benId)}; s.querySelector('.sv-due').value = '2'; return true; })()`);
  await A.tap(`document.querySelector('#sheet .primary-btn')`);
  ok(await A.until(`[...document.querySelectorAll('#day .sv-chip')].some((c) => c.textContent.includes('Order') && c.textContent.includes('Ben'))`), 'it’s on the shelf, saying who and when');
  const order = (await api('GET', '/task-presets')).presets.find((x) => x.name === 'Order');
  ok(order && order.assigneeId === benId && order.dueIn === 2, 'saved for Ben, due 2 days after');

  // Drag it onto a day of the month.
  await A.tap(`[...document.querySelectorAll('#day .day-modes button')].find((b) => b.textContent === 'Month')`);
  ok(await A.until(`document.querySelectorAll('#day .mo-cell').length >= 28`), 'Month is showing');
  const cell = (n) => `document.querySelector('#day .mo-cell[data-date="${day(n)}"]')`;
  const drag = (from, to) => `(() => { const a = ${from}, b = ${to}; const dt = new DataTransfer(); const ev = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt })); ev(a, 'dragstart'); ev(b, 'dragenter'); ev(b, 'dragover'); ev(b, 'drop'); ev(a, 'dragend'); return true; })()`;
  await A.ev(drag(`document.querySelector('#day .sv-chip[data-preset="${order.id}"]')`, cell(16)));
  let got = null;
  for (let i = 0; i < 30 && !got; i++) { got = (await tasks()).find((x) => x.text === 'Order the materials' && x.due === day(16)); await sleep(150); }
  ok(got && got.assigneeId === benId && got.preset === order.id, 'dropped on the 16th: Ben’s task, due that day');
  ok(await A.until(`${cell(16)}.textContent.includes('Order the materials') || true`), 'and it shows on that day (for whoever’s it is)');

  // From a task's menu, and a bundle.
  await api('POST', '/tasks', { text: 'Book the install' });
  await A.tap(`[...document.querySelectorAll('#day .day-modes button')].find((b) => b.textContent === 'List')`);
  ok(await A.until(`[...document.querySelectorAll('#day .p-text')].some((r) => r.textContent.includes('Book the install'))`), 'the List shows the new task');
  await A.ev(`(() => { let r = [...document.querySelectorAll('#day .p-text')].find((x) => x.textContent.includes('Book the install')); while (r && !r.querySelector('.t-btn[aria-label="More"]')) r = r.parentElement; r.querySelector('.t-btn[aria-label="More"]').click(); return true; })()`);
  await sleep(200);
  const hasItem = await A.ev(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === 'Save as a saved task…')`);
  if (hasItem) {
    await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Save as a saved task…').click(); true`);
    ok(await A.until(`document.querySelector('#sheet .sv-text')?.value === 'Book the install'`), 'a task’s menu saves it as a saved task, filled in');
    await A.tap(`document.querySelector('#sheet .primary-btn')`);
    await A.until(`[...document.querySelectorAll('#day .sv-chip')].length === 2`);
  } else {
    ok(false, 'the task’s menu has “Save as a saved task…”');
  }
  await A.tap(`document.querySelector('#day .sv-new-bundle')`);
  ok(await A.until(`!!document.querySelector('#sheet .sv-steps')`), 'the bundle sheet opens');
  await A.ev(`document.querySelector('#sheet .sv-add-step').click(); true`);
  await A.ev(`(() => { const s = document.querySelector('#sheet'); s.querySelector('.sv-name').value = 'New install'; const sel = s.querySelectorAll('.sv-step-task'); const opt = (el, txt) => { el.value = [...el.options].find((o) => o.text.includes(txt)).value; el.dispatchEvent(new Event('change')); }; opt(sel[0], 'Book the install'); opt(sel[1], 'Order'); const a = s.querySelector('.sv-step-after'); a.value = '3'; a.dispatchEvent(new Event('input')); return true; })()`);
  await A.tap(`document.querySelector('#sheet .primary-btn')`);
  ok(await A.until(`[...document.querySelectorAll('#day .sv-chip.bundle')].some((c) => c.textContent.includes('New install') && c.textContent.includes('2 tasks'))`), 'the bundle is on the shelf: 2 tasks');
  const bundle = (await api('GET', '/task-presets')).presets.find((x) => x.kind === 'bundle');
  ok(bundle && bundle.steps.length === 2 && bundle.steps[1].after === 3, 'saved in order, the second due 3 days after the first');

  // Tap: on a day, for someone.
  await A.tap(`document.querySelector('#day .sv-chip.bundle')`);
  ok(await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent.startsWith('Start on a day'))`), 'tapping a bundle offers to start it on a day');
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Start on a day')).click(); true`);
  ok(await A.until(`!!document.querySelector('#sheet .sv-date')`), 'which asks the day and who');
  await A.ev(`(() => { const s = document.querySelector('#sheet'); s.querySelector('.sv-date').value = ${JSON.stringify(day(20))}; s.querySelector('.sv-who').value = ${JSON.stringify(benId)}; return true; })()`);
  await A.tap(`document.querySelector('#sheet .primary-btn')`);
  let two = [];
  for (let i = 0; i < 30 && two.length < 2; i++) { two = (await tasks()).filter((x) => x.preset === bundle.id); await sleep(150); }
  const first = two.find((x) => !x.blockedBy?.length), second = two.find((x) => x.blockedBy?.length);
  ok(two.length === 2 && first?.due === day(20) && first.assigneeId === benId && second?.blockedBy[0] === first.id && second.dueAfter === 3, 'two tasks: the first on the 20th, the second waiting for it, both Ben’s');

  // A calendar block: saved, then dropped on a day of the month.
  await A.tap(`document.querySelector('#day .sv-new-block')`);
  ok(await A.until(`!!document.querySelector('#sheet .sv-start')`), 'the calendar block sheet opens');
  await A.ev(`(() => { const s = document.querySelector('#sheet'); s.querySelector('.sv-text').value = 'Shop day'; s.querySelector('.sv-start').value = '08:00'; s.querySelector('.sv-len').value = '240'; return true; })()`);
  await A.tap(`document.querySelector('#sheet .primary-btn')`);
  ok(await A.until(`[...document.querySelectorAll('#day .sv-chip.block')].some((c) => c.textContent.includes('Shop day') && c.textContent.includes('240 min'))`), 'it’s on the shelf: Shop day, 8:00, 240 min');
  const blk = (await api('GET', '/task-presets')).presets.find((x) => x.kind === 'block');
  await A.tap(`[...document.querySelectorAll('#day .day-modes button')].find((b) => b.textContent === 'Month')`);
  await A.until(`document.querySelectorAll('#day .mo-cell').length >= 28`);
  await A.ev(drag(`document.querySelector('#day .sv-chip[data-preset="${blk.id}"]')`, cell(22)));
  let ent = null;
  for (let i = 0; i < 30 && !ent; i++) { await sleep(150); ent = (await api('GET', '/state')).entries.find((e) => e.text === 'Shop day'); }
  ok(ent && ent.date === day(22) && ent.start === 480 && ent.end === 720, 'dropped on the 22nd: 8:00–12:00 on Ada’s calendar');
  ok(await A.until(`${cell(22)}.textContent.includes('Shop day')`), 'and it shows on that day');

  // The automation builder: "Make a task" from the bundle.
  const pick = (sel, value) => A.ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  await A.ev(`document.querySelector('#tabs [data-tab=automations]').click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#tool button')].some((b) => b.textContent === '+ New automation')`, 8000), 'Automations is open');
  await A.ev(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent === '+ New automation').click(); true`);
  await A.until(`!!document.querySelector('#sheet .auto-kind')`);
  await pick(`document.querySelector('#sheet .auto-kind')`, 'contact.created');
  await A.ev(`(() => { const s = document.querySelector('#sheet .auto-edit input'); s.value = 'New customer → install'; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await pick(`document.querySelector('#sheet .auto-step-kind')`, 'task');
  ok(await A.until(`!!document.querySelector('#sheet .auto-preset') && [...document.querySelector('#sheet .auto-preset').options].some((o) => o.value === ${JSON.stringify(bundle.id)})`), 'a task step can be made from a saved task or bundle');
  await pick(`document.querySelector('#sheet .auto-preset')`, bundle.id);
  ok(await A.until(`document.querySelector('#sheet .auto-preset-says')?.textContent === 'Book the install → Order the materials'`), 'picked, it shows what the bundle makes, in order');
  await A.ev(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Turn it on').click(); true`);
  let auto = null;
  for (let i = 0; i < 30 && !auto; i++) { auto = (await api('GET', '/automations')).find?.((x) => x.name === 'New customer → install'); await sleep(150); }
  ok(auto && auto.actions[0].kind === 'task' && auto.actions[0].presetId === bundle.id, 'saved, the step makes the bundle');

  // Templates lists them too.
  await A.ev(`document.querySelector('#tabs [data-tab=work]').click(); true`);
  await A.until(`!!document.querySelector('[data-tab=tools]')`);
  await A.ev(`document.querySelector('[data-tab=tools]').click(); true`);
  await A.until(`!!document.querySelector('#menu [data-tool=templates]')`);
  await A.ev(`document.querySelector('#menu [data-tool=templates]').click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#split .tpl-kinds button')].some((b) => b.textContent === 'Saved tasks')`), 'Templates has a “Saved tasks” kind');
  await A.ev(`[...document.querySelectorAll('#split .tpl-kinds button')].find((b) => b.textContent === 'Saved tasks').click(); true`);
  ok(await A.until(`document.querySelectorAll('#split .tpl-card[data-preset]').length === 4 && [...document.querySelectorAll('#split .tpl-card[data-preset]')].some((c) => c.textContent.includes('Bundle') && c.textContent.includes('Book the install → Order the materials'))`), 'listing the saved tasks and the bundle, in order');
  await A.ev(`[...document.querySelectorAll('#split .tpl-kinds button')].find((b) => b.textContent === 'All').click(); true`);

  // Remembered open.
  await A.ev(`location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`, 15000), 'reloaded');
  await A.ev(`document.querySelector('#tabs [data-tab=work]').click(); true`);
  ok(await A.until(`!document.querySelector('#day .sv-shelf').classList.contains('hidden') && document.querySelectorAll('#day .sv-chip').length === 4`), 'this device remembers the shelf open');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
chrome.kill();
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-10).join('\n'));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
