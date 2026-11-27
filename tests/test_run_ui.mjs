// A campaign's test run in the app (2026-11-20): 🧪 Test run picks testers and starts it; a banner says it's a test,
// its tasks show TEST, the test log lists what an automation held back, Skip ahead finishes a phase, and Go live ends it.
import { CHROME, SERVER_DIR } from './chromebin.mjs';
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/trui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4969, APP = `http://127.0.0.1:${PORT}/`, CDP = 9547;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-trui`, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-trui`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Tr ' + t, name: 'Joshua', email: `j${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  const camp = await api('POST', '/campaigns', { name: 'Window SOP' });
  const g1 = await api('POST', '/goals', { campaignId: camp.id, title: 'Measure', order: 0 });
  await api('POST', '/goals', { campaignId: camp.id, title: 'Install', order: 1 });
  await api('POST', '/tasks', { goalId: g1.id, text: 'Measure the windows' });
  await api('POST', '/automations', { name: 'Tell the customer', on: true, trigger: { kind: 'task.done', campaignId: camp.id }, actions: [{ kind: 'email', subject: 'Measured', text: '{task} is done' }] });
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=camps]')`, 15000);
  for (let i = 0; i < 20 && !(await A.ev(`!!document.querySelector('.camp-card')`)); i++) { await A.ev(`document.querySelector('[data-tab=camps]')?.click(); true`); await sleep(300); }
  await A.tap(`document.querySelector('.camp-card')`); await A.until(`!!document.querySelector('#camps .cc-edit, #camps .cc-done-edit')`); await A.ev(`document.querySelector('#camps .cc-edit')?.click(); true`); // a campaign opens to be read: Edit (2026-11-27)
  ok(await A.until(`!!${T('.cc-testbtn')}`), 'a campaign has 🧪 Test run');
  await A.tap(T('.cc-testbtn'));
  ok(await A.until(`!!document.querySelector('#sheet .tr-testers .chip.on')`), 'it asks who tests it (me, to start)');
  await A.ev(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Start the test run').click(); true`);
  ok(await A.until(`!!${T('.cc-test')} && !!${T('.cc-testpill')} && !${T('.cc-testbtn')}`), 'a test-run banner and a TEST tag in the header');
  ok(await A.until(`[...document.querySelectorAll('#camps .step-tag.test')].length >= 1`), 'its tasks show TEST');
  await shot('trui-1');
  // Skip ahead on Measure: the automation's email is logged, not sent.
  await A.tap(T('.tr-skip'));
  ok(await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === 'Measure')`), 'Skip ahead lists the open phases');
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Measure').click(); true`);
  let st;
  for (let i = 0; i < 40; i++) { st = (await api('GET', '/state')).campaigns.find((x) => x.id === camp.id); if (st.test?.log.some((x) => x.kind === 'email')) break; await sleep(200); }
  ok(st.test.log.some((x) => x.kind === 'email' && x.text.includes('Measured')), 'the email is held in the test log');
  await sleep(500);
  await A.tap(T('.tr-logbtn'));
  ok(await A.until(`[...document.querySelectorAll('#camps .tr-log-row')].some((r) => r.textContent.includes('Measured'))`), 'Test log shows it');
  await shot('trui-2');
  // Go live (asks twice).
  await A.tap(T('.tr-live'));
  await A.tap(T('.tr-live'));
  ok(await A.until(`!${T('.cc-test')} && !!${T('.cc-testbtn')}`), 'Go live ends the test');
  const after = await api('GET', '/state');
  ok(!after.tasks.find((x) => x.text === 'Measure the windows').done && !after.campaigns.find((x) => x.id === camp.id).test, 'its task is back to not done');
  // The builder can start a new campaign as a test run.
  await A.ev(`openCampaign(null); true`).catch(() => {});
  await A.ev(`document.querySelector('[aria-label="All campaigns"]')?.click(); true`);
  await A.until(`[...document.querySelectorAll('#camps button')].some((b) => b.textContent === '+ New')`);
  await A.tap(`[...document.querySelectorAll('#camps button')].find((b) => b.textContent === '+ New')`);
  await A.until(`!!document.querySelector('#sheet .cb-stages')`);
  await A.ev(`(() => { const e = document.querySelector('#sheet .cb-name'); e.value = 'Door SOP'; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await A.tap(`document.querySelector('#sheet .cb-stage[data-stage="3"]')`);
  await A.tap(`document.querySelector('#sheet [data-launch=test] input')`);
  ok(await A.until(`!!document.querySelector('#sheet .cb-testers .chip.on') && document.querySelector('#sheet .cb-sum').textContent.includes('Starts as a test run')`), 'Launch: Start with a test run, with testers');
  await A.ev(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Make the campaign').click(); true`);
  let door;
  for (let i = 0; i < 40 && !door?.test; i++) { door = (await api('GET', '/state')).campaigns.find((x) => x.name === 'Door SOP'); await sleep(200); }
  ok(door?.test?.testers?.length === 1, 'the new campaign starts in a test run');
  ok(await A.until(`!!${T('.cc-test')}`), 'and opens with its banner');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
chrome.kill();
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-6).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
