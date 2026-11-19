// Inventory linked in, in a real browser (headless Chrome): a job shows "Materials & equipment"; stock is used on it
// and equipment checked out for it right there, and the box updates; a task's menu has "Use stock for it…"; the
// automation builder has a "Use or move stock" step and Inventory's events; a ready-made "Running low? Reorder it".
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/inventory_links_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4991, CDP = 9549, APP = `http://127.0.0.1:${PORT}/`;
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
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Links ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const st = await api('GET', '/state');
  await api('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const p = await api('POST', '/projects', { template: 'trades', trades: ['hvac'] });
  const job = await api('POST', `/projects/${p.id}/records`, { typeId: p.types[0].id, values: { job: 'AC tune-up' } });
  const filter = await api('POST', '/inventory/items', { name: '16x25 air filter', cost: '6.50', reorderAt: 3, onHand: 10 });
  await api('POST', '/inventory/items', { name: 'Pressure washer', track: 'units', onHand: 1 });
  await api('POST', '/tasks', { text: 'Swap filters at Oak St' });

  const A = await tab(APP);
  // The job window is in tabs (2026-11-19): pjT(k) opens tab k first, inside a check (it waits for the window).
  const pjT = (k, sub) => `(document.querySelector('.pj-panel .pj-tab[data-tab=${k}]:not(.on)')?.click() ?? true) && ${sub ? `(document.querySelector('.pj-panel .pj-subtab[data-fin=${sub}]:not(.on)')?.click() ?? true) && ` : ''}`;
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.href = ${JSON.stringify(APP + '?go=rec:')} + ${JSON.stringify(job.id)}; true`);
  ok(await A.until(`${pjT('finance', 'materials')}!!document.querySelector('.pj-panel .inv-job .inv-job-use')`, 20000), 'the job shows Materials & equipment, with Use stock and Check out equipment');
  ok(await A.ev(`/Nothing from Inventory yet/.test(document.querySelector('.inv-job').textContent) && !!document.querySelector('.inv-job .inv-job-out')`), 'nothing used yet');
  // Use 2 filters on it.
  await A.tap(`document.querySelector('.inv-job .inv-job-use')`);
  ok(await A.until(`!!document.querySelector('#sheet .inv-m-item') && /On AC tune-up/.test(document.querySelector('#sheet').textContent)`), 'Use stock opens, for this job');
  await A.fill(`document.querySelector('#sheet .inv-m-qty')`, '2');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Use')`);
  ok(await A.until(`/2 each 16x25 air filter/.test(document.querySelector('.inv-job').textContent) && /\\$13/.test(document.querySelector('.inv-job').textContent)`), 'the box shows 2 filters used, $13');
  // Check out the pressure washer for it.
  await A.tap(`document.querySelector('.inv-job .inv-job-out')`);
  await A.until(`!!document.querySelector('#sheet .inv-pick-unit')`);
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Next')`);
  ok(await A.until(`document.querySelector('#sheet .inv-co-job')?.value === ${JSON.stringify(job.id)}`), 'checking out equipment from the job picks the job for you');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Check it out')`);
  ok(await A.until(`/Pressure washer 1/.test(document.querySelector('.inv-job').textContent)`), 'the pressure washer shows on the job');
  const jv = await api('GET', '/inventory/job/' + job.id);
  ok(jv.materials[0].qty === 2 && jv.equipment.length === 1, 'and the server agrees');

  // A task's menu.
  await A.ev(`document.querySelector('.pj-panel [aria-label=Close]')?.click(); true`);
  await A.until(`!!document.querySelector('#side button')`);
  await A.tap(`[...document.querySelectorAll('#side button')].find((b) => b.textContent.trim() === 'Workspace')`);
  await A.until(`!!document.querySelector('#tabs [data-tab=day]')`, 8000);
  await A.ev(`document.querySelector('#tabs [data-tab=day]').click(); true`);
  await A.until(`!!document.querySelector('.day-modes [data-view=list]')`, 10000);
  await A.ev(`document.querySelector('.day-modes [data-view=list]').click(); true`);
  await A.until(`[...document.querySelectorAll('.task-row')].some((x) => x.offsetParent && x.textContent.includes('Swap filters at Oak St'))`, 10000);
  await A.tap(`[...document.querySelectorAll('.task-row')].find((x) => x.offsetParent && x.textContent.includes('Swap filters at Oak St')).querySelector('[aria-label=More]')`);
  ok(await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === 'Use stock for it…')`), 'a task’s menu has “Use stock for it…”');
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Use stock for it…')`);
  ok(await A.until(`/For “Swap filters at Oak St”/.test(document.querySelector('#sheet')?.textContent || '')`), 'it opens Use stock, for that task');
  await A.fill(`document.querySelector('#sheet .inv-m-qty')`, '1');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Use')`);
  await A.until(`document.querySelector('#sheet').classList.contains('hidden')`);
  const taskId = (await api('GET', '/state')).tasks.find((x) => x.text === 'Swap filters at Oak St').id;
  ok((await api('GET', '/inventory/moves?task=' + taskId)).length === 1, 'used for the task (it’s in Inventory’s history with the task)');

  // The builder: Inventory's events and the stock step; the ready-made one.
  await A.until(`!!document.querySelector('#tabs [data-tab=automations]')`, 10000);
  await A.ev(`document.querySelector('#tabs [data-tab=automations]').click(); true`);
  await A.tap(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent === '+ New automation')`);
  await A.until(`!!document.querySelector('#sheet .auto-kind')`);
  ok(await A.ev(`!![...document.querySelectorAll('#sheet .auto-kind optgroup')].find((g) => g.label === 'Inventory' && [...g.children].some((o) => o.value === 'stock.low'))`), 'what sets it off includes Inventory: an item runs low, used on a job, equipment out, back, a problem');
  await A.pick(`document.querySelector('#sheet .auto-kind')`, 'record.stage');
  await A.pick(`document.querySelector('#sheet .auto-step-kind')`, 'stock');
  ok(await A.until(`[...(document.querySelector('#sheet .auto-stock-item')?.options || [])].some((o) => o.textContent.startsWith('16x25 air filter'))`), '“Use or move stock” lists counted items (not equipment)');
  await A.fill(`document.querySelector('#sheet .auto-edit input')`, 'Filters on finished jobs');
  await A.fill(`document.querySelector('#sheet .auto-stock-qty')`, '2');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Turn it on')`);
  ok(await A.until(`[...document.querySelectorAll('#tool .auto-row b')].some((b) => b.textContent === 'Filters on finished jobs')`), 'saved');
  const saved = (await api('GET', '/automations')).find((x) => x.name === 'Filters on finished jobs');
  ok(saved.actions[0].kind === 'stock' && saved.actions[0].itemId === filter.id && saved.actions[0].qty === 2 && saved.actions[0].act === 'use', 'with its stock step');
  await A.ev(`[...document.querySelectorAll('#tool .auto-recipe-for .chip')].find((c) => c.dataset.for === 'every')?.click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#tool .auto-recipe b')].some((b) => b.textContent === 'Running low? Reorder it')`), 'a ready-made “Running low? Reorder it”');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors.join(' | ').slice(0, 300) : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  chrome.kill('SIGKILL');
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
