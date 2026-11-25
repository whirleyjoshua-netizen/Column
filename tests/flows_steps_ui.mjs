// Flows step 2 in a real browser (headless Chrome): an automation built in the editor with "Only if…" (and
// "Otherwise") and "Wait…"; saved with its nested steps; each new contact goes the right way; the wait shows as a
// waiting run that can be listed and stopped; it fits a phone. (Waits go 1000× faster here: tests only.)
import { autoUI } from './autobuild.mjs';
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/flows_steps_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4898, CDP = 9509, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1', FLOW_TIME_SCALE: '0.00005', SCHEDULE_TICK_MS: '200' }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
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
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(120); } return false; };
  const tap = async (expr) => {
    await until(`!!(${expr})`, 8000);
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(150);
  };
  const type = async (s) => { for (const ch of s) { await cmd('Input.insertText', { text: ch }); await sleep(15); } };
  const pick = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  const fill = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  return { ev, until, tap, type, pick, fill, cmd, errors };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Steps ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');
  await A.until(`!!document.querySelector('#tabs [data-tab=automations]')`, 10000); await A.ev(`document.querySelector('#tabs [data-tab=automations]').click(); true`); // in Workspace now (2026-11-14)
  await A.tap(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent === '+ New automation')`);
  const B = autoUI(A);
  await B.when('contact.created');
  await A.fill(`document.querySelector('#sheet .auto-name')`, 'Sort new contacts');
  // Step 1: Only if {stage} is Lead → post; otherwise → post.
  await B.step(B.act(0), 'if');
  ok(await A.until(`!!document.querySelector('#sheet .auto-if-field') && [...document.querySelectorAll('#sheet .auto-steps-h')].map((x) => x.textContent).join() === 'Then,Otherwise'`), '“Only if…” shows what it checks, and its Then and Otherwise steps');
  await A.pick(`document.querySelector('#sheet .auto-if-field')`, 'stage');
  await A.pick(`document.querySelector('#sheet .auto-if-op')`, 'is');
  await A.fill(`document.querySelector('#sheet .auto-if-val')`, 'Lead');
  // Then: post in #general.
  const thenBox = `[...document.querySelectorAll('#sheet .auto-steps.nested')][0]`;
  await B.step(B.act(0, thenBox), 'post');
  await A.fill(`document.querySelector('#sheet .ab-body input')`, 'LEAD {contact}');
  await A.pick(`document.querySelector('#sheet .ab-body select')`, 'general');
  // Otherwise: add a step, a post.
  const elseBox = `[...document.querySelectorAll('#sheet .auto-steps.nested')][1]`;
  await B.add('post', elseBox);
  await A.fill(`document.querySelector('#sheet .ab-body input')`, 'OTHER {contact}');
  await A.pick(`document.querySelector('#sheet .ab-body select')`, 'general');
  // Step 2: wait 2 days; step 3: post.
  await B.add('wait');
  ok(await A.until(`!!document.querySelector('#sheet .auto-wait-n')`), '“Wait…” asks how long');
  await A.fill(`document.querySelector('#sheet .auto-wait-n')`, '2');
  await A.pick(`document.querySelector('#sheet .auto-wait-u')`, 'days');
  await B.add('post');
  await A.fill(`document.querySelector('#sheet .ab-body input')`, 'TWO DAYS LATER {contact}');
  await A.pick(`document.querySelector('#sheet .ab-body select')`, 'general');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Turn it on')`);
  ok(await A.until(`[...document.querySelectorAll('#tool .auto-row b')].some((b) => b.textContent === 'Sort new contacts')`), 'saved');
  const saved = (await api('GET', '/automations')).find((x) => x.name === 'Sort new contacts');
  ok(saved && saved.actions.map((s) => s.kind).join() === 'if,wait,post' && saved.actions[0].then[0].text === 'LEAD {contact}' && saved.actions[0].else[0].text === 'OTHER {contact}' && saved.actions[1].amount === 2, 'with its nested steps, as built');
  ok(await A.ev(`[...document.querySelectorAll('#tool .auto-row small')].some((s) => s.textContent.includes('if {stage}') && s.textContent.includes('wait 2 days'))`), 'its summary says what it decides and how long it waits');

  // It runs: each contact the right way, and the wait.
  await api('POST', '/contacts', { name: 'Ana', stage: 'lead' });
  await api('POST', '/contacts', { name: 'Bo', stage: 'customer' });
  const general = async () => (await api('GET', '/state')).items.filter((x) => x.type === 'message' && !x.channelId).map((x) => x.text);
  let g = [];
  for (let i = 0; i < 40; i++) { g = await general(); if (g.includes('LEAD Ana') && g.includes('OTHER Bo')) break; await sleep(150); }
  ok(g.includes('LEAD Ana') && g.includes('OTHER Bo') && !g.includes('OTHER Ana') && !g.includes('LEAD Bo'), 'each contact goes the right way');
  ok(await A.until(`[...document.querySelectorAll('#tool .auto-waiting')].some((s) => /2 runs waiting/.test(s.textContent))`), 'two runs wait, and the list says so');
  await A.tap(`[...document.querySelectorAll('#tool .auto-row')].find((r) => r.textContent.includes('Sort new contacts')).querySelector('[aria-label="Options"]')`);
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Waiting runs'))`);
  ok(await A.until(`document.querySelectorAll('#sheet .int-log .bill').length === 2`), 'the waiting runs are listed, about Ana and Bo');
  await A.tap(`[...document.querySelectorAll('#sheet .int-log .bill')].find((r) => r.textContent.includes('Bo')).querySelector('button')`);
  await A.tap(`[...document.querySelectorAll('#sheet .int-log .bill')].find((r) => r.textContent.includes('Bo')).querySelector('button')`);
  ok(await A.until(`document.querySelectorAll('#sheet .int-log .bill').length === 1`), 'Stop it (twice to be sure) stops Bo’s');
  for (let i = 0; i < 200; i++) { g = await general(); if (g.includes('TWO DAYS LATER Ana')) break; await sleep(150); }
  ok(g.includes('TWO DAYS LATER Ana') && !g.includes('TWO DAYS LATER Bo'), 'after the wait Ana’s goes on; Bo’s was stopped');
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await A.ev(`document.querySelector('#sheet .sheet h2 [aria-label=Close]')?.click(); true`);
  await A.tap(`[...document.querySelectorAll('#tool .auto-row')].find((r) => r.textContent.includes('Sort new contacts')).querySelector('.auto-main')`);
  await sleep(500);
  ok(await A.until(`document.documentElement.scrollWidth <= 392 && document.querySelector('#sheet .sheet').getBoundingClientRect().right <= 391 && !!document.querySelector('#sheet .auto-steps.nested')`, 4000), 'the editor, nested steps and all, fits a phone');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors.join(' | ').slice(0, 300) : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  chrome.kill('SIGKILL');
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
