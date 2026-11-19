// The engine round in a real browser (headless Chrome): a trades project's Calendar shows each job on its day, a
// job dragged to another day moves there, + on a day makes a job for that day, the month goes back and forth; a
// formula field is added from the table (its fields to tap in), and shows worked out; the automation editor watches
// a record's date (which list, which date, days before) and its steps change the record and add one; it fits a phone.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/engine_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4843, APP = `http://127.0.0.1:${PORT}/`, CDP = 9483;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map();
  const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const type = async (t) => { await cmd('Input.insertText', { text: t }); await sleep(40); };
  const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const tap = async (expr) => {
    await until(`!!(${expr})`, 8000);
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(80);
  };
  const pick = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  return { ev, type, until, tap, pick, cmd, errors, close: () => ws.close() };
}
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };

try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t0 = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Engine UI ' + t0, name: 'Rico Vega', email: `rico${t0}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  await api('PATCH', '/workspace', { tools: { projects: true } });
  const p = await api('POST', '/projects', { template: 'trades', trades: ['hvac'] });
  const T = p.types.find((x) => x.key === 'trade_hvac');
  const F = (k) => T.fields.find((f) => f.key === k);
  // Two jobs this month (the 10th and the 12th, so both are in today's month whatever today is).
  const month = day(0).slice(0, 7);
  const tune = await api('POST', `/projects/${p.id}/records`, { typeId: T.id, values: { job: 'Tune-up Smith', scheduled: `${month}-10`, value: '189' } });
  await api('POST', `/projects/${p.id}/records`, { typeId: T.id, values: { job: 'Install Lopez', scheduled: `${month}-12` } });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.href = ${JSON.stringify(APP + '?go=rec:' + tune.id)}; true`);
  ok(await A.until(`document.querySelector('#projects .pj-panel .pj-title')?.value === 'Tune-up Smith'`, 20000), 'a job opens in its project');
  ok(await A.ev(`[...document.querySelectorAll('#projects .pj-views button')].some((b) => b.textContent.includes('📅') && b.textContent.includes('Calendar'))`), 'the trade list has a Calendar view');
  await A.tap(`[...document.querySelectorAll('#projects .pj-views button')].find((b) => b.textContent.includes('Calendar'))`);
  ok(await A.until(`!!document.querySelector('#projects .cal-grid') && document.querySelector('#projects .cal-cell[data-day="${month}-10"] .cal-rec')?.textContent === 'Tune-up Smith' && document.querySelector('#projects .cal-cell[data-day="${month}-12"] .cal-rec')?.textContent === 'Install Lopez'`), 'each job is on its scheduled day');
  // Drag the tune-up to the 15th.
  await A.ev(`(() => { const dt = new DataTransfer(); const from = document.querySelector('#projects .cal-cell[data-day="${month}-10"] .cal-rec'); from.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true })); const to = document.querySelector('#projects .cal-cell[data-day="${month}-15"]'); to.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); to.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return true; })()`);
  ok(await A.until(`document.querySelector('#projects .cal-cell[data-day="${month}-15"] .cal-rec')?.textContent === 'Tune-up Smith'`), 'dragging a job to another day moves it there');
  const moved = (await api('GET', `/projects/${p.id}/records`)).find((r) => r.id === tune.id);
  ok(moved.values[F('scheduled').id] === `${month}-15`, 'and saves its new day');
  await A.tap(`document.querySelector('#projects .cal-cell[data-day="${month}-20"] .cal-add')`);
  ok(await A.until(`document.querySelector('#projects .pj-panel .pj-title')?.value === ''`), '+ on a day makes a new job, open to name it');
  ok((await api('GET', `/projects/${p.id}/records`)).some((r) => r.values[F('scheduled').id] === `${month}-20`), 'for that day');
  const head = await A.ev(`document.querySelector('#projects .cal-head b').textContent`);
  await A.tap(`document.querySelector('#projects .cal-head [aria-label="Next month"]')`);
  ok(await A.until(`document.querySelector('#projects .cal-head b').textContent !== ${JSON.stringify(head)} && !document.querySelector('#projects .cal-rec')`), 'the next month has none of them');
  await A.tap(`[...document.querySelectorAll('#projects .cal-head button')].find((b) => b.textContent === 'Today')`);
  ok(await A.until(`document.querySelector('#projects .cal-head b').textContent === ${JSON.stringify(head)}`), 'Today comes back');
  const shot = async (name) => FS.writeFileSync(`${DIR}/${name}.png`, Buffer.from((await A.cmd('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await shot('calendar');
  await A.tap(`document.querySelector('#projects .pj-panel [aria-label="Close"]') || [...document.querySelectorAll('#projects .pj-panel .icon-btn')].at(-1)`);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  ok(await A.ev(`document.querySelector('#projects .cal-grid').getBoundingClientRect().right <= 392 && document.documentElement.scrollWidth <= 392`), 'the calendar fits a phone');
  await shot('calendar-phone');
  await A.cmd('Emulation.clearDeviceMetricsOverride');
  await sleep(300);

  // A formula, from the table.
  await A.tap(`[...document.querySelectorAll('#projects .pj-views button')].find((b) => b.textContent.includes('By date'))`);
  await A.tap(`document.querySelector('#projects .pj-addcol button')`);
  await A.until(`document.querySelector('#sheet h2')?.textContent.startsWith('Add a field')`);
  await A.tap(`document.querySelector('#sheet input')`);
  await A.type('With tax');
  await A.pick(`[...document.querySelectorAll('#sheet select')][0]`, 'formula');
  ok(await A.until(`!!document.querySelector('#sheet .pf-expr') && [...document.querySelectorAll('#sheet .pf-chips .pj-chip')].some((b) => b.textContent === 'Value')`), 'a formula offers the list’s number fields to tap in');
  await A.tap(`[...document.querySelectorAll('#sheet .pf-chips .pj-chip')].find((b) => b.textContent === 'Value')`);
  await A.tap(`document.querySelector('#sheet .pf-expr')`);
  await A.ev(`(() => { const e = document.querySelector('#sheet .pf-expr'); e.setSelectionRange(e.value.length, e.value.length); return true; })()`);
  await A.type(' * 1.08');
  await A.pick(`document.querySelector('#sheet .pf-calc select')`, 'money');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Add field')`);
  ok(await A.until(`[...document.querySelectorAll('#projects .pj-calc')].some((e) => e.textContent === '$204.12')`), 'it shows worked out in the table ($189 × 1.08 = $204.12)');

  // The automation editor: a record's date, and steps that change and add records.
  await A.tap(`[...document.querySelectorAll('#projects .pj-top .icon-btn')].find((b) => b.getAttribute('aria-label') === 'Close Boards')`);
  await A.until(`!!document.querySelector('#tabs [data-tab=automations]')`, 10000); await A.ev(`document.querySelector('#tabs [data-tab=automations]').click(); true`); // in Workspace now (2026-11-14)
  ok(await A.until(`[...document.querySelectorAll('#tool .auto-recipe b')].some((b) => b.textContent === 'License expiring? Owners hear')`), 'there’s a recipe for licenses about to expire');
  await A.tap(`[...document.querySelectorAll('#tool .auto-recipe')].find((b) => b.textContent.includes('License expiring'))`);
  ok(await A.until(`document.querySelector('#sheet .auto-kind')?.value === 'record.date' && !!document.querySelector('#sheet .auto-proj')`), 'it opens on “A date on a job or record comes up”, asking which project');
  await A.pick(`document.querySelector('#sheet .auto-proj')`, p.id);
  const lic = p.types.find((x) => x.key === 'licenses');
  await A.until(`!!document.querySelector('#sheet .auto-list')`);
  await A.pick(`document.querySelector('#sheet .auto-list')`, lic.id);
  ok(await A.until(`[...document.querySelectorAll('#sheet .auto-datef option')].map((o) => o.textContent).join() === 'Expires' && document.querySelector('#sheet .auto-days').value === '30' && document.querySelector('#sheet .auto-side').value === 'before'`), 'then the list’s date (Expires), 30 days before');
  // A second step: add a task-like record in the same list.
  await A.tap(`[...document.querySelectorAll('#sheet .auto-add-step')].at(-1)`);
  await A.pick(`[...document.querySelectorAll('#sheet .auto-step-kind')].at(-1)`, 'record');
  ok(await A.until(`!!document.querySelector('#sheet .auto-rec-list') && document.querySelector('#sheet .auto-rec-list').value === ${JSON.stringify(lic.id)}`), 'a “Change the job or record” step starts on the trigger’s list');
  await A.tap(`[...document.querySelectorAll('#sheet .linkish')].find((b) => b.textContent === '+ Set a field')`);
  const notes = lic.fields.find((f) => f.key === 'notes');
  await A.pick(`document.querySelector('#sheet .auto-set-row select')`, notes.id);
  await A.tap(`document.querySelector('#sheet .auto-set-row input')`);
  await A.type('Renewal reminder sent {date}');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Turn it on')`);
  ok(await A.until(`[...document.querySelectorAll('#tool .auto-row small')].some((s) => s.textContent.startsWith('30 days before Expires in'))`), 'it’s saved, and its summary reads “30 days before Expires in …”');
  const saved = (await api('GET', '/automations')).find((x) => x.name === 'License expiring? Owners hear');
  ok(saved?.trigger.typeId === lic.id && saved.trigger.days === -30 && saved.actions[1]?.kind === 'record' && saved.actions[1].set[0]?.field === notes.id, 'with the list, the days and the field it sets');
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await A.tap(`[...document.querySelectorAll('#tool .auto-main')].find((b) => b.textContent.includes('License expiring'))`);
  await A.until(`!!document.querySelector('#sheet .auto-set-row')`);
  await sleep(400);
  ok(await A.ev(`document.documentElement.scrollWidth <= 392 && document.querySelector('#sheet .sheet').getBoundingClientRect().right <= 391`), 'the editor still fits a phone');
  await shot('editor-phone');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors.join(' | ').slice(0, 300) : ''));
} catch (e) {
  console.log('FAIL threw: ' + e.stack);
  fails++;
} finally {
  srv.kill();
  chrome.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
