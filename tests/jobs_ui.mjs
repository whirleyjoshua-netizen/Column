// Workspace → Jobs (docs/jobflows/CONTRACTS.md; the owner, 2026-11-24: "simple and auto, like Jobber"): a Jobs tab of
// its own with every job, its flow and a button for the step it's at; Job Flows (owners and admins) to make a flow
// from a ready-made start, change its steps and publish it; New job from a flow; on the job's Overview its steps in a
// row with Next opening the sheet that does the step (a visit, the Done of your own step), steps ticking off by
// themselves; the job window's six tabs still there; on a phone it fits.
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobsui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5007, APP = `http://127.0.0.1:${PORT}/`, CDP = 9567;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-jobsui`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-jobsui`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 80) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const tap = async (expr) => { const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); for (const ty of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type: ty, x, y, button: 'left', buttons: ty === 'mousePressed' ? 1 : 0, clickCount: 1 }); await sleep(120); };
  const pick = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  const type = (sel, text) => ev(`(() => { const e = ${sel}; e.focus(); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  return { ev, until, tap, cmd, pick, type, errors, close: () => ws.close() };
}
let A;
const btnText = (scope, text) => `[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;
// SHOTS=<folder>: screenshots at the main points, to look at.
const shot = async (name) => { if (!process.env.SHOTS) return; await sleep(500); const r = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(`${process.env.SHOTS}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
const TOOL = (sel) => `document.querySelector('#tool ${sel}')`;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Jobs ' + t, name: 'Rico Vega', email: `r${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  const st = await api('GET', '/state');
  await api('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, contacts: true } });
  const p = await api('POST', '/projects', { template: 'trades', trades: ['cleaning'] });
  const tp = p.types[0];
  const dc = await api('POST', '/contacts', { name: 'Dana Ruiz', phone: '555-0100', address: '10 A St' });
  const dana = dc?.contact || dc;
  const flow = await api('POST', '/job-flows', { name: 'Bin cleaning', icon: '🗑️', list: { projectId: p.id, typeId: tp.id }, steps: [
    { kind: 'client', name: 'Add client info' }, { kind: 'book', name: 'Book it', stage: 'Scheduled' },
    { kind: 'custom', name: 'Bins back', settings: { text: 'Put them by the house.', checklist: ['Bins back'] } }, { kind: 'invoice', name: 'Send invoice' } ] });
  await api('POST', `/job-flows/${flow.id}/publish`);
  const made = await api('POST', '/jobs', { flowId: flow.id, values: { job: 'Lee · 2 cans' } });
  await api('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Old job by hand' } });

  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=work]')`, 15000);
  await A.ev(`document.querySelector('[data-tab=work]').click(); true`);
  ok(await A.until(`!!document.querySelector('#workTabs [data-tab=jobs]')`), 'Workspace has a Jobs tab');
  ok(await A.ev(`(() => { const ks = [...document.querySelectorAll('#workTabs [data-tab]')].map((b) => b.dataset.tab); return ks.indexOf('jobs') === ks.indexOf('projects') - 1; })()`), 'beside Boards');
  await A.ev(`document.querySelector('#workTabs [data-tab=jobs]').click(); true`);
  ok(await A.until(`!!${TOOL(`.jb-row[data-job="${made.job.id}"]`)}`), 'Jobs lists the job on the flow');
  ok(await A.ev(`${TOOL(`.jb-row[data-job="${made.job.id}"]`)}.textContent.includes('Bin cleaning · 0/4') && ${TOOL(`.jb-row[data-job="${made.job.id}"] .jb-next`)}.textContent.includes('Add client info')`), 'with its flow, how far along, and a button for the step it’s at');
  ok(await A.ev(`[...document.querySelectorAll('#tool .jb-row')].some((r) => r.textContent.includes('Old job by hand') && r.textContent.includes('Not on a flow'))`), 'and a job not on a flow too');
  await shot('1-jobs');
  await A.type(TOOL('.jb-q'), 'old job');
  ok(await A.until(`document.querySelectorAll('#tool .jb-row').length === 1`), 'Find narrows the list');
  await A.type(TOOL('.jb-q'), '');

  // Job Flows: a new flow from a ready-made start, a step added and moved, published.
  await A.tap(TOOL('[data-jb=flows]'));
  ok(await A.until(`!!${TOOL(`.jb-row[data-flow="${flow.id}"]`)} && ${TOOL(`.jb-row[data-flow="${flow.id}"]`)}.textContent.includes('Version 1')`), 'Job Flows lists the flow and its version');
  await A.tap(TOOL('[data-act=new-flow]'));
  await A.until(`!document.querySelector('#sheet').classList.contains('hidden')`);
  await A.type(`document.querySelector('#sheet input')`, 'Bins, monthly');
  await A.pick(`document.querySelector('#sheet select[aria-label="Start from"]')`, 'cleaning');
  await A.tap(btnText('#sheet', 'Make it'));
  ok(await A.until(`document.querySelectorAll('#tool .jb-scard').length === 6`), 'a new flow from “Cleaning visit” opens in the builder with its 6 steps');
  ok(await A.ev(`[...document.querySelectorAll('#tool .jb-scard[data-kind=book] select[data-field=stage]')].some((s) => s.value === 'Scheduled')`), 'its steps name the job list’s own stages');
  await A.tap(TOOL('[data-act=add-step]'));
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Your own step'))`);
  ok(await A.until(`document.querySelectorAll('#tool .jb-scard').length === 7`), '+ Add a step adds one at the end');
  await A.type(TOOL('.jb-scard[data-i="6"] input[data-field=name]'), 'Text the customer');
  await A.type(TOOL('.jb-scard[data-i="6"] textarea[data-field=text]'), 'Say the bins are clean.');
  await A.tap(TOOL('.jb-scard[data-i="6"] [aria-label="Move up"]'));
  ok(await A.until(`${TOOL('.jb-scard[data-i="5"] input[data-field=name]')}?.value === 'Text the customer'`), 'and moves up');
  await shot('2-builder');
  await A.tap(TOOL('[data-act=publish]'));
  ok(await A.until(`!!${TOOL('[data-act=new-flow]')} && [...document.querySelectorAll('#tool .jb-row')].some((r) => r.textContent.includes('Bins, monthly') && r.textContent.includes('Version 1 · 7 steps'))`), 'Publish makes version 1 with 7 steps, back on the list');

  // New job from a flow; it opens on its Overview with its steps.
  await A.tap(TOOL('[data-jb=jobs]'));
  await A.until(`!!${TOOL('[data-act=new-job]')}`);
  await A.tap(TOOL('[data-act=new-job]'));
  await A.until(`!document.querySelector('#sheet').classList.contains('hidden')`);
  await A.pick(`document.querySelector('#sheet select[aria-label=Flow]')`, flow.id);
  ok(await A.ev(`document.querySelectorAll('#sheet .jb-preview li').length === 4`), 'New job shows the flow’s steps');
  await A.type(`document.querySelector('#sheet input')`, 'Dana · 3 cans');
  ok(await A.pick(`document.querySelector('#sheet select[aria-label=Client]')`, dana.id), 'New job lets you pick the client from Contacts');
  await A.tap(btnText('#sheet', 'Start the job'));
  ok(await A.until(`!!document.querySelector('#projects .jb-card')`, 8000), 'Start the job opens it, its flow on the Overview');
  ok(await A.until(`document.querySelectorAll('#projects .jb-step').length === 4 && document.querySelector('#projects .jb-step[data-state=done]')?.textContent.includes('Add client info')`), 'its 4 steps in a row, Add client info already done (the client was picked): ' + await A.ev(`[...document.querySelectorAll('#projects .jb-step')].map((x) => x.dataset.state + ':' + x.textContent).join(', ') + ' / dana ' + ${JSON.stringify(!!dana)}`));
  ok(await A.ev(`document.querySelector('#projects .jb-step[data-state=current]')?.textContent.includes('Book it')`), 'Book it is next up');
  ok(await A.ev(`document.querySelectorAll('#projects .pj-tab').length >= 5`), 'the job window keeps its tabs (Overview, Client, Work, Finance, Files & notes, Activity), its flow above them');
  await shot('3-job');
  await A.tap(`document.querySelector('#projects .jb-detail [data-act=next]')`);
  ok(await A.until(`!document.querySelector('#sheet').classList.contains('hidden') && !!document.querySelector('#sheet input[type=date]')`), 'Next on “Book it” opens the visit sheet');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].at(-1)`);
  ok(await A.until(`document.querySelector('#projects .jb-step[data-state=current]')?.textContent.includes('Bins back')`, 8000), 'the visit booked, Book it ticks off by itself and Bins back is next');
  await A.tap(`document.querySelector('#projects .jb-check input')`);
  await sleep(300);
  await A.until(`!!document.querySelector('#projects .jb-detail [data-act=next]')`);
  await A.tap(`document.querySelector('#projects .jb-detail [data-act=next]')`);
  ok(await A.until(`document.querySelector('#projects .jb-step[data-state=current]')?.textContent.includes('Send invoice')`), 'ticking its checklist and Done finishes your own step');
  await A.tap(`document.querySelector('#projects .jb-step[data-state=done]')`);
  ok(await A.until(`!!document.querySelector('#projects .jb-detail [data-act=reopen]')`), 'a finished step, picked, shows Reopen to an owner');
  await A.tap(`document.querySelector('#projects .jb-detail [data-act=reopen]')`);
  await sleep(300);

  // Back on Jobs: the new job, how far along.
  await A.ev(`document.querySelector('#workTabs [data-tab=jobs]').click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#tool .jb-row')].some((r) => r.textContent.includes('Dana · 3 cans') && /Bin cleaning · [23]\\/4/.test(r.textContent))`, 8000), 'Jobs shows the new job and how far it has got');
  // Next from the list opens the job at its step.
  await A.tap(`document.querySelector('#tool .jb-row[data-job="${made.job.id}"] .jb-next')`);
  ok(await A.until(`!!document.querySelector('#projects .jb-card') && document.querySelector('#projects .pj-tab.on')?.dataset.tab === 'client'`, 8000), 'Next on a job in the list opens it at its step (Add client info → the Client tab), its flow still in sight: ' + await A.ev(`[!!document.querySelector('#projects .jb-card'), document.querySelector('#projects .pj-tab.on')?.dataset.tab, [...document.querySelectorAll('#projects .pj-tab')].map((x) => x.dataset.tab).join(','), document.querySelector('#projects .pj-panel h2, #projects .pj-title')?.textContent].join(' | ')`));

  // A phone: Jobs fits.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  await A.ev(`(window.openTool ? 1 : 0, document.querySelector('[data-tab=jobs]')?.click()); true`);
  await sleep(500);
  await shot('4-phone');
  ok(await A.ev(`document.documentElement.scrollWidth <= innerWidth`), 'on a phone nothing scrolls sideways');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
srv.kill();
chrome.kill();
if (fails) console.log(srv.log.split('\n').slice(-8).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
