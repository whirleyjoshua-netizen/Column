// Campaign steps that open (2026-11-20, the owner: "make it openable… a script for the call"): clicking a step opens it
// (Details, Resources, Tasks); the owner writes a call script on the step; the step and each of its tasks show it, and it
// opens to read; clicking a task opens it (rename there) instead of editing the title; a member's task opens on what the
// step hands over, which they can read but not change; campaign task rows are lighter.
import { CHROME, SERVER_DIR } from './chromebin.mjs';
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/stepui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4919, APP = `http://127.0.0.1:${PORT}/`, CDP = 9527;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-stepui`, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-stepui`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
const shot = async (name) => { if (!process.env.SHOT) return; const r = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(`${process.env.SHOT}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Stp ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body, tok = auth.token) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
  const st = await api('GET', '/state');
  const sam = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'join', workspace: 'Stp ' + t, code: st.workspace.inviteCode, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' }) })).json();
  const samId = (await api('GET', '/state', null, sam.token)).me.memberId;
  const camp = await api('POST', '/campaigns', { name: 'Fall calls' });
  const g = await api('POST', '/goals', { campaignId: camp.id, title: 'Call last year’s customers' });
  const task = await api('POST', '/tasks', { text: 'Call the Lopez family', goalId: g.id, assigneeId: samId });
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=camps]')`, 15000);
  await A.ev(`document.querySelector('[data-tab=camps]').click(); true`);
  await A.tap(`[...document.querySelectorAll('.camp-card')].find((c) => c.textContent.includes('Fall calls'))`); await A.until(`!!document.querySelector('#camps .cc-edit, #camps .cc-done-edit')`); await A.ev(`document.querySelector('#camps .cc-edit')?.click(); true`); // a campaign opens to be read: Edit (2026-11-27)
  ok(await A.until(`!!document.querySelector('#camps .cc-phase-h [aria-label^="Phase settings"]')`), 'Ada opens the campaign');
  ok(await A.ev(`(() => { const r = [...document.querySelectorAll('#camps .cc-row')].find((x) => x.textContent.includes('Lopez')); return r && !r.querySelector('[aria-label="Tools for this task"]') && !r.querySelector('[aria-label="Put on schedule"]'); })()`), 'campaign task rows are light (tools and scheduling are inside the task)');
  // Clicking the step opens it.
  await A.tap(`document.querySelector('#camps .cc-phase-h [aria-label^="Phase settings"]')`);
  ok(await A.until(`!!document.querySelector('#sheet .step-win') && [...document.querySelectorAll('#sheet .win-tabs button')].map((b) => b.textContent).join('|') === 'Details|Resources|Tasks · 1|Automations'`), 'clicking the step opens it: Details, Resources, Tasks (and Automations for an owner)');
  ok(await A.ev(`document.querySelector('#sheet .win-title').value === 'Call last year’s customers' && !!document.querySelector('#sheet .win-rows input[type=date]')`), 'with its name and due date to change there');
  await A.tap(`[...document.querySelectorAll('#sheet .win-tabs button')].find((b) => b.textContent.startsWith('Resources'))`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .res-add')].map((b) => b.textContent).join('|') === '+ Note or script|+ Doc or file|+ Template|+ Link'`), 'Resources: + Note or script, + Doc or file, + Template, + Link');
  await A.tap(`document.querySelector('#sheet .res-add[data-kind=note]')`);
  await A.until(`!!document.querySelector('#sheet .res-form textarea')`);
  await A.ev(`(() => { const f = document.querySelector('#sheet .res-form'); f.querySelector('input').value = 'Call script'; f.querySelector('textarea').value = 'Hi, this is Ada from the shop.\\nAsk how the windows are holding up.'; })()`);
  await A.tap(`[...document.querySelectorAll('#sheet .res-form button')].find((b) => b.textContent === 'Add to the step')`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .res-row b')].map((b) => b.textContent).join() === 'Call script'`), 'the script is on the step');
  await shot('step-win');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]').click(); true`);
  // The task's tools say what its step hands over; the step's tools open the script to read.
  await A.tap(`[...document.querySelectorAll('#camps .cc-row')].find((x) => x.textContent.includes('Lopez')).querySelector('.cc-row-name')`);
  await A.tap(`document.querySelector('#camps .cc-pp-tool')`);
  ok(await A.until(`document.querySelector('#camps .cc-ptools[data-for=task]')?.textContent.includes('Call script')`), 'the task’s tools say its step has 📝 Call script');
  await A.tap(`document.querySelector('#camps .cc-ptools .pt-phase')`);
  await A.until(`!!document.querySelector('#camps .cc-ptools[data-for=phase] .res-open')`);
  await A.tap(`[...document.querySelectorAll('#camps .cc-ptools .res-open')].find((b) => b.textContent.includes('Call script'))`);
  ok(await A.until(`document.querySelector('#sheet .res-read')?.textContent.includes('Ask how the windows are holding up.')`), 'tapping it opens the script to read');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]').click(); true`);
  // Clicking a task opens it; rename there.
  await A.tap(`[...document.querySelectorAll('#camps .cc-row')].find((x) => x.textContent.includes('Lopez')).querySelector('.cc-row-name')`);
  await A.tap(`document.querySelector('#camps .cc-td-full')`);
  ok(await A.until(`!!document.querySelector('#sheet .task-win')`), 'a task picked opens whole from its panel');
  ok(await A.ev(`[...document.querySelectorAll('#sheet .td-sec-h')].some((x) => x.textContent === 'From the step · 1') && [...document.querySelectorAll('#sheet .td-row')].some((x) => x.textContent.startsWith('Assignee') && x.textContent.includes('Sam'))`), 'the drawer says who (Sam), with From the step · 1');
  await A.ev(`(() => { const i = document.querySelector('#sheet .task-win .win-title'); i.value = 'Call the Lopez family about windows'; i.dispatchEvent(new Event('change')); })()`);
  ok(await (async () => { for (let i = 0; i < 30; i++) { if ((await api('GET', '/state')).tasks.find((x) => x.id === task.id)?.text === 'Call the Lopez family about windows') return true; await sleep(100); } return false; })(), 'renaming it there saves');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]').click(); true`);
  // The step's Automations (owners and admins): ready-made ones in a tap, and + New pointed at this step.
  await A.tap(`document.querySelector('#camps .cc-phase-h [aria-label^="Phase settings"]')`);
  await A.until(`!!document.querySelector('#sheet .step-win')`);
  ok(await A.ev(`[...document.querySelectorAll('#sheet .win-tabs button')].some((b) => b.textContent === 'Automations')`), 'Ada’s step has an Automations tab');
  await A.tap(`[...document.querySelectorAll('#sheet .win-tabs button')].find((b) => b.textContent.startsWith('Automations'))`);
  ok(await A.until(`document.querySelectorAll('#sheet .step-recipe').length === 4`), 'with four ready-made ones');
  await A.tap(`document.querySelector('#sheet .step-recipe[data-recipe=opens]')`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .auto-row-step b')].some((b) => b.textContent.includes('tell them when it opens')) && !document.querySelector('#sheet .step-recipe[data-recipe=opens]')`), 'one tap turns on “tell whoever it’s for when their task opens”');
  const made = (await api('GET', '/automations')).find((x) => x.name.includes('tell them when it opens'));
  ok(made && made.on && made.trigger.kind === 'task.opened' && made.trigger.step === 'Call last year’s customers' && made.trigger.campaignId === camp.id && made.actions[0].to.join() === 'doers', 'it’s on: when a task in this step (of this campaign) opens, notify whoever it’s for');
  await A.tap(`document.querySelector('#sheet .step-auto-new')`);
  ok(await A.until(`/(Call last year’s customers)/.test(document.querySelector('#sheet .auto-trigger .an-say')?.textContent || '')`, 8000), '+ New automation for this step opens the builder for that step (its card says so)');
  await A.tap(`document.querySelector('#sheet .ab-tabs [data-tab=adv]')`);
  ok(await A.until(`document.querySelector('.auto-step-name')?.value === 'Call last year’s customers'`, 8000), 'with the step filled in (under Advanced settings)');
  await shot('step-autos');
  await A.ev(`document.querySelector('#sheet [aria-label=Close], .auto-close, [aria-label="Close"]')?.click(); true`);
  // Sam, the member: his task opens on what the step hands over; he can read it, not change it.
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(sam.token)})); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=camps]')`, 15000);
  await A.ev(`document.querySelector('[data-tab=camps]').click(); true`);
  await A.until(`!![...document.querySelectorAll('#camps .cc-row, #camps .cc-rrow')].find((x) => x.textContent.includes('Lopez')) || !!document.querySelector('.camp-card')`);
  if (!(await A.ev(`!![...document.querySelectorAll('#camps .cc-row, #camps .cc-rrow')].find((x) => x.textContent.includes('Lopez'))`))) await A.tap(`[...document.querySelectorAll('.camp-card')].find((c) => c.textContent.includes('Fall calls'))`); await A.until(`!!document.querySelector('#camps .cc-edit, #camps .cc-done-edit')`); await A.ev(`document.querySelector('#camps .cc-edit')?.click(); true`); // a campaign opens to be read: Edit (2026-11-27)
  // A member reads the campaign (the read view, 2026-11-27): a task's name opens its window.
  await A.until(`!![...document.querySelectorAll('#camps .cc-rrow')].find((x) => x.textContent.includes('Lopez'))`);
  await A.tap(`[...document.querySelectorAll('#camps .cc-rrow')].find((x) => x.textContent.includes('Lopez')).querySelector('.cc-rrow-name')`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .td-sec-h')].some((x) => x.textContent.startsWith('From the step')) && [...document.querySelectorAll('#sheet .td-res .res-row b')].map((b) => b.textContent).join() === 'Call script'`), 'Sam’s task drawer shows From the step, with the call script');
  await shot('task-win');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]').click(); true`);
  // He reads the campaign: the phase he's on shows with his task, and there's no Phase settings or Edit to change the step.
  ok(await A.until(`!!document.querySelector('#camps .cc-rphase.is-now') && document.querySelector('#camps .cc-rphase.is-now').getBoundingClientRect().height > 40`), 'the phase he’s on shows, with its tasks');
  ok(await A.ev(`!document.querySelector('#camps [aria-label^="Phase settings"]') && !document.querySelector('#camps .cc-edit')`), 'he can’t open the step’s settings or Edit, so he can’t add or remove its resources');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
chrome.kill();
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-6).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
