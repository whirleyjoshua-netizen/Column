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
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, SKIP_SETUP: '1', PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', CUSTMSG_TICK_MS: '300' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
const mailsTo = (to) => { const o = DIR + '/outbox'; return FS.existsSync(o) ? FS.readdirSync(o).map((f) => JSON.parse(FS.readFileSync(o + '/' + f, 'utf8'))).filter((m) => m.to === to) : []; };
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(150); } return false; };
const btnText = (scope, text) => `[...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;
// SHOTS=<folder>: screenshots at the main points, to look at.
const shot = async (name) => { if (!process.env.SHOTS) return; await sleep(500); const r = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(`${process.env.SHOTS}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
const TOOL = (sel) => `document.querySelector('#tool ${sel}')`;
// Open a job from the Jobs list (Workspace → Jobs), as clicking its row does.
const openJobIn = async (id) => { await A.ev(`document.querySelector('#workTabs [data-tab=jobs]').click(); true`); await A.until(`!!document.querySelector('#tool [data-jb=jobs]')`); await A.tap(TOOL('[data-jb=jobs]')); await A.until(`!!document.querySelector('#tool .jb-row[data-job="${id}"]')`, 8000); await A.tap(TOOL(`.jb-row[data-job="${id}"] .jb-main`)); await A.until(`!!document.querySelector('#projects .jb-card')`, 8000); };
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
  const samAuth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'join', workspace: 'Jobs ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `s${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' }) })).json();
  const samId = (await api('GET', '/state')).workspace.members.find((m) => m.name === 'Sam Reed').id;
  const crew = await api('POST', '/job-flows', { name: 'Crew flow', whoCreates: 'everyone', list: { projectId: p.id, typeId: tp.id }, steps: [
    { kind: 'custom', name: 'Crew check', who: { type: 'member', id: samId }, canSkip: true, settings: { text: 'Check the truck.' } },
    { kind: 'custom', name: 'Office check', who: { type: 'admins' }, canSkip: true, settings: { text: 'Check the paperwork.' } },
    { kind: 'invoice', name: 'Bill it' },
    { kind: 'payment', name: 'Get paid' },
    { kind: 'custom', name: 'Wrap up', who: { type: 'anyone' }, settings: { text: 'Done for the day.' } } ] });
  const crewPub = await api('POST', `/job-flows/${crew.id}/publish`);
  const crewSid = (n) => crewPub.version.body.steps.find((x) => x.name === n).id;
  const crewJob = await api('POST', '/jobs', { flowId: crew.id, values: { job: 'Crew job' } });
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

  // Phase 2 (docs/jobflows/PHASE2.md §5): Items, the builder's billing, the Quote step, the automatic invoice, and
  // Quotes and Invoices in Jobs.
  ok(await A.ev(`['jobs', 'quotes', 'invoices', 'items', 'flows'].join() === [...document.querySelectorAll('#tool [data-jb]')].map((b) => b.dataset.jb).join()`), 'an owner’s Jobs has Jobs, Quotes, Invoices, Items and Job Flows');
  await A.tap(TOOL('[data-jb=items]'));
  ok(await A.until(`!!${TOOL('[data-act=new-item]')}`), 'Items opens, with + New item');
  await A.tap(TOOL('[data-act=new-item]'));
  await A.until(`!document.querySelector('#sheet').classList.contains('hidden')`);
  await A.type(`document.querySelector('#sheet [data-field=name]')`, 'Can clean');
  await A.type(`document.querySelector('#sheet [data-field=unit]')`, 'each');
  await A.type(`document.querySelector('#sheet [data-field=price]')`, '25');
  await A.tap(btnText('#sheet', 'Add it'));
  ok(await A.until(`[...document.querySelectorAll('#tool .jb-row[data-item]')].some((r) => r.textContent.includes('Can clean') && r.textContent.includes('$25.00 / each'))`), 'a new item shows on Items with its price and unit');
  await shot('5-items');
  await A.tap(TOOL('[data-jb=flows]'));
  await A.until(`!!${TOOL('[data-act=new-flow]')}`);
  await A.tap(TOOL('[data-act=new-flow]'));
  await A.until(`!document.querySelector('#sheet').classList.contains('hidden')`);
  await A.type(`document.querySelector('#sheet input')`, 'Quoted cleans');
  await A.pick(`document.querySelector('#sheet select[aria-label="Start from"]')`, 'cleaning');
  await A.tap(btnText('#sheet', 'Make it'));
  await A.until(`!!${TOOL('select[data-field=billing]')}`);
  ok(await A.ev(`[...document.querySelectorAll('#tool .jb-scard[data-kind=invoice] [data-field=who], #tool .jb-scard[data-kind=payment] [data-field=who]')].every((e) => e.tagName === 'SMALL' && e.textContent === 'For owners and admins')`), 'invoice and payment steps say they’re for owners and admins (no choice)');
  await A.pick(TOOL('select[data-field=billing]'), 'quote');
  ok(await A.until(`(() => { const ks = [...document.querySelectorAll('#tool .jb-scard')].map((c) => c.dataset.kind); return ks.indexOf('quote') >= 0 && ks.indexOf('quote') === ks.indexOf('invoice') - 1; })()`), 'Quote first puts a Send the quote step just before the invoice');
  await A.until(`[...document.querySelectorAll('#tool select[data-field=add-item] option')].some((o) => o.textContent.includes('Can clean'))`);
  const canId = await A.ev(`[...document.querySelectorAll('#tool select[data-field=add-item] option')].find((o) => o.textContent.includes('Can clean')).value`);
  await A.pick(TOOL('select[data-field=add-item]'), canId);
  ok(await A.until(`!!${TOOL(`.jb-defrow[data-default="${canId}"]`)}`), 'a default item is added from Items');
  await A.type(TOOL(`.jb-defrow[data-default="${canId}"] .jb-qty`), '2');
  await A.type(TOOL('input[data-field=dueDays]'), '10');
  await shot('6-billing');
  await A.tap(TOOL('[data-act=publish]'));
  ok(await A.until(`[...document.querySelectorAll('#tool .jb-row')].some((r) => r.textContent.includes('Quoted cleans') && r.textContent.includes('Version 1'))`), 'the quote-first flow publishes: ' + await A.ev(`document.querySelector('#tool .err')?.textContent || ''`));
  const qf = (await api('GET', '/job-flows')).flows.find((f) => f.name === 'Quoted cleans');
  ok(qf?.version?.body?.billing === 'quote' && qf.version.body.items?.[0]?.qty === 2 && qf.version.body.dueDays === 10, 'its version keeps billing, the default item and due days');
  // Changing only the billing, the default items or the due days is a change not yet published.
  await A.tap(TOOL(`.jb-row[data-flow="${qf.id}"] .jb-main`));
  await A.until(`!!${TOOL('input[data-field=dueDays]')}`);
  await A.type(TOOL('input[data-field=dueDays]'), '20');
  await A.tap(TOOL('[data-act=save]'));
  ok(await A.until(`[...document.querySelectorAll('#tool .jb-row')].some((r) => r.textContent.includes('Quoted cleans') && r.textContent.includes('changes not published'))`, 8000), 'a draft that changes only the due days says it has changes not published');
  await api('PATCH', `/job-flows/${qf.id}`, { dueDays: 10 });
  // Items: archive and bring back.
  await A.tap(TOOL('[data-jb=items]'));
  await A.until(`!!${TOOL(`.jb-row[data-item="${canId}"] [data-act=archive]`)}`);
  await A.tap(TOOL(`.jb-row[data-item="${canId}"] [data-act=archive]`));
  ok(await A.until(`!!document.querySelector('#tool .jb-gone .jb-row[data-item="${canId}"] [data-act=restore]')`), 'archiving an item moves it under Archived');
  await A.ev(`document.querySelector('#tool .jb-gone').open = true; true`);
  await A.tap(`document.querySelector('#tool .jb-gone .jb-row[data-item="${canId}"] [data-act=restore]')`);
  ok(await A.until(`!!${TOOL(`.jb-row[data-item="${canId}"] [data-act=archive]`)} && !document.querySelector('#tool .jb-gone')`), 'and bringing it back puts it back');
  const qj = await api('POST', '/jobs', { flowId: qf.id, contactId: dana.id, values: { job: 'Quoted job' } });
  for (const st of qf.version.body.steps.slice(0, qf.version.body.steps.findIndex((x) => x.kind === 'quote'))) if (st.kind !== 'client') await api('POST', `/jobs/${qj.job.id}/steps/${st.id}/skip`, { reason: 'Test: straight to the quote' });
  await A.tap(TOOL('[data-jb=jobs]'));
  await A.until(`!!${TOOL(`.jb-row[data-job="${qj.job.id}"]`)}`, 8000);
  ok(await A.ev(`${TOOL(`.jb-row[data-job="${qj.job.id}"]`)}.textContent.includes('$50.00')`), 'the Jobs list shows an owner the job’s total from its default lines');
  await A.tap(TOOL(`.jb-row[data-job="${qj.job.id}"] .jb-main`));
  ok(await A.until(`document.querySelector('#projects .jb-step[data-state=current]')?.textContent.includes('Send the quote')`, 8000), 'the job opens at Send the quote');
  ok(await A.until(`document.querySelector('#projects .jb-quote')?.dataset.quote === 'draft' && document.querySelector('#projects .jb-quote').textContent.includes('$50.00')`), 'the quote step shows not sent, $50.00');
  await A.tap(`document.querySelector('#projects .jb-detail [data-act=next]')`);
  ok(await A.until(`document.querySelector('#projects .jb-quote')?.dataset.quote === 'sent' && document.querySelector('#projects .jb-detail [data-act=next]')?.textContent.includes('Copy the quote link') && !!document.querySelector('#projects .jb-detail [data-act=requote]')`, 8000), 'Send the quote sends it: sent, Copy the quote link, New quote');
  await shot('7-quote');
  await A.tap(`document.querySelector('#projects .jb-detail [data-act=requote]')`);
  ok(await A.until(`document.querySelector('#projects .jb-quote')?.dataset.quote === 'draft'`, 8000), 'New quote: back to not sent');
  // Automatic billing.
  const af = await api('POST', '/job-flows', { name: 'Auto bins', list: { projectId: p.id, typeId: tp.id }, billing: 'auto', items: [{ itemId: canId, qty: 1 }], steps: [{ kind: 'client', name: 'Client' }, { kind: 'custom', name: 'Clean', settings: { text: 'Clean.' } }, { kind: 'invoice', name: 'Bill' }] });
  const afPub = await api('POST', `/job-flows/${af.id}/publish`);
  const aj = await api('POST', '/jobs', { flowId: af.id, contactId: dana.id, values: { job: 'Auto job' } });
  await openJobIn(aj.job.id);
  await A.tap(`document.querySelector('#projects .jb-step[data-step="${afPub.version.body.steps[2].id}"]')`);
  ok(await A.until(`document.querySelector('#projects .jb-auto')?.textContent.includes('Runs by itself')`) && await A.ev(`!document.querySelector('#projects .jb-detail [data-act=next]')`), 'an automatic invoice step says it runs by itself, with no button');
  await api('POST', `/jobs/${aj.job.id}/steps/${afPub.version.body.steps[1].id}/done`);
  ok(await A.until(`document.querySelector('#projects .jb-step[data-state=done][data-step="${afPub.version.body.steps[2].id}"]') && (document.querySelector('#projects .jb-auto')?.textContent || '').includes('Made and sent by itself (INV-')`, 8000), 'Clean done: the invoice is made and sent by itself, and the step says so: ' + JSON.stringify((await api('GET', `/jobs/${aj.job.id}/run`)).run?.steps?.map((x) => [x.name, x.state, x.waiting, x.invoice])) + ' | ' + await A.ev(`document.querySelector('#projects .jb-auto')?.textContent + ' / ' + [...document.querySelectorAll('#projects .jb-step')].map((x) => x.dataset.state).join()`));
  await A.ev(`document.querySelector('#workTabs [data-tab=jobs]').click(); true`);
  await A.until(`!!document.querySelector('#tool [data-jb=quotes]')`, 8000);
  await A.tap(TOOL('[data-jb=quotes]'));
  ok(await A.until(`!!document.querySelector('#tool .fin-q-f')`), 'Quotes in Jobs is the team’s quotes list');
  await A.tap(TOOL('[data-jb=invoices]'));
  ok(await A.until(`[...document.querySelectorAll('#tool .fin-inv')].some((r) => r.textContent.includes('INV-'))`, 8000), 'Invoices in Jobs lists the invoice the flow sent');
  await A.tap(TOOL('[data-jb=jobs]'));

  // Phase 3 (docs/jobflows/PHASE3.md): steps Kloomie does by itself.
  await A.tap(TOOL('[data-jb=flows]'));
  await A.until(`!!${TOOL(`.jb-row[data-flow="${qf.id}"] .jb-main`)}`);
  await A.tap(TOOL(`.jb-row[data-flow="${qf.id}"] .jb-main`));
  await A.until(`!!${TOOL('[data-act=add-step]')}`);
  await A.tap(TOOL('[data-act=add-step]'));
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Review request'))`);
  ok(await A.until(`!!${TOOL('.jb-scard[data-kind=review] input[data-field=url]')} && ${TOOL('.jb-scard[data-kind=review] [data-field=who]')}.textContent.includes('Done by Kloomie')`), 'a Review request step: done by Kloomie, with its delay and link');
  await A.type(TOOL('.jb-scard[data-kind=review] input[data-field=url]'), 'https://g.page/r/ours');
  await A.type(TOOL('.jb-scard[data-kind=quote] input[data-field=followUpDays]'), '3');
  ok(await A.ev(`!!${TOOL('.jb-scard[data-kind=quote] input[data-field=email]')}?.checked && !!${TOOL('.jb-scard[data-kind=payment] input[data-field=reminders]')}`), 'the quote step can email and follow up; the payment step takes reminders');
  await A.tap(TOOL('[data-act=add-step]'));
  ok(await A.ev(`['Visit reminder', 'On my way'].every((l) => [...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes(l)))`), 'the step menu offers Visit reminder and On my way');
  await A.ev(`document.body.click(); true`);
  await A.tap(TOOL('[data-act=publish]'));
  ok(await A.until(`[...document.querySelectorAll('#tool .jb-row')].some((r) => r.textContent.includes('Quoted cleans') && r.textContent.includes('Version 2'))`), 'it publishes as version 2: ' + await A.ev(`document.querySelector('#tool .err')?.textContent || ''`));
  const v2 = (await api('GET', '/job-flows')).flows.find((f) => f.name === 'Quoted cleans')?.version?.body;
  ok(v2?.steps?.find((x) => x.kind === 'review')?.settings?.url === 'https://g.page/r/ours' && v2?.steps?.find((x) => x.kind === 'quote')?.settings?.followUpDays === 3, 'the version keeps the review link and the follow-up');
  const rf = await api('POST', '/job-flows', { name: 'Thanks', list: { projectId: p.id, typeId: tp.id }, steps: [{ kind: 'client', name: 'Client' }, { kind: 'review', name: 'Ask for a review', settings: { delayHours: 0, url: 'https://g.page/r/ours' } }] });
  await api('POST', `/job-flows/${rf.id}/publish`);
  const noMail = await api('POST', '/jobs', { flowId: rf.id, contactId: dana.id, values: { job: 'Dana thanks' } });
  await openJobIn(noMail.job.id);
  await A.tap(`[...document.querySelectorAll('#projects .jb-step')].find((x) => x.textContent.includes('Ask for a review'))`);
  ok(await A.until(`document.querySelector('#projects .jb-auto')?.dataset.msg === 'skipped' && /Kloomie skipped it: .*no email or text number/.test(document.querySelector('#projects .jb-auto').textContent)`, 8000), 'a customer Kloomie can’t reach: “Kloomie skipped it”, saying why');
  const mailer = await api('POST', '/contacts', { name: 'Mo Mail', email: `mo${t}@x.test` });
  const withMail = await api('POST', '/jobs', { flowId: rf.id, contactId: (mailer.contact || mailer).id, values: { job: 'Mo thanks' } });
  await openJobIn(withMail.job.id);
  await A.tap(`[...document.querySelectorAll('#projects .jb-step')].find((x) => x.textContent.includes('Ask for a review'))`);
  // Phase 3b: a step with no send setting asks first. The card shows the message with Send / Don't send.
  ok(await A.until(`document.querySelector('#projects .jb-auto')?.dataset.msg === 'pending' && /Ready to send/.test(document.querySelector('#projects .jb-auto').textContent) && !!document.querySelector('#projects .jb-auto [data-act=msg-send]') && !!document.querySelector('#projects .jb-auto [data-act=msg-skip]')`, 8000), 'a review request with no send setting waits: “Ready to send”, with Send and Don’t send');
  ok(await A.ev(`/Thanks for choosing/.test(document.querySelector('#projects .jb-auto').textContent)`), 'and shows what it will say');
  await A.tap(`document.querySelector('#projects .jb-auto [data-act=msg-send]')`);
  ok(await A.until(`document.querySelector('#projects .jb-auto')?.dataset.msg === 'sent' && /Sent by email/.test(document.querySelector('#projects .jb-auto').textContent)`, 8000) && await A.ev(`!document.querySelector('#projects .jb-detail [data-act=next]')`), 'Send: it goes, the card says “Sent by email”');
  ok(mailsTo(`mo${t}@x.test`).length === 1, 'once');
  const nell = await api('POST', '/contacts', { name: 'Nell Nope', email: `nell${t}@x.test` });
  const nj = await api('POST', '/jobs', { flowId: rf.id, contactId: (nell.contact || nell).id, values: { job: 'Nell thanks' } });
  await openJobIn(nj.job.id);
  await A.tap(`[...document.querySelectorAll('#projects .jb-step')].find((x) => x.textContent.includes('Ask for a review'))`);
  await A.until(`document.querySelector('#projects .jb-auto')?.dataset.msg === 'pending'`, 8000);
  await A.tap(`document.querySelector('#projects .jb-auto [data-act=msg-skip]')`);
  ok(await A.until(`document.querySelector('#projects .jb-step[data-state=skipped]')?.textContent.includes('Ask for a review') || /Not sent/.test(document.querySelector('#projects .jb-detail')?.textContent || '')`, 8000), 'Don’t send: the step is skipped, “Not sent”');
  await sleep(600);
  ok(!mailsTo(`nell${t}@x.test`).length, 'and nothing went');
  // On my way for one kind of visit: Next opens that visit, not an earlier one of another kind.
  const of = await api('POST', '/job-flows', { name: 'Install day', list: { projectId: p.id, typeId: tp.id }, steps: [{ kind: 'client', name: 'Client' }, { kind: 'omw', name: 'Heading over', settings: { visitKind: 'Install' } }] });
  await api('POST', `/job-flows/${of.id}/publish`);
  const oj = await api('POST', '/jobs', { flowId: of.id, contactId: dana.id, values: { job: 'Two visits' } });
  const dayAfter = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString('en-CA');
  await api('POST', `/records/${oj.job.id}/visits`, { kind: 'Measure', date: dayAfter(1), start: 540, end: 600, memberIds: [st.workspace.members[0].id] });
  await openJobIn(oj.job.id);
  await A.until(`!!document.querySelector('#projects .jb-detail [data-act=next]')`, 8000);
  await A.tap(`document.querySelector('#projects .jb-detail [data-act=next]')`);
  await sleep(500);
  ok(await A.ev(`document.querySelector('#sheet').classList.contains('hidden') || !/On my way/.test(document.querySelector('#sheet h2, #sheet .sheet-title')?.textContent || '')`), 'On my way for an Install with only a Measure booked opens no sheet (it says to book the Install)');
  await api('POST', `/records/${oj.job.id}/visits`, { kind: 'Install', date: dayAfter(2), start: 540, end: 600, memberIds: [st.workspace.members[0].id] });
  await openJobIn(oj.job.id);
  await A.until(`!!document.querySelector('#projects .jb-detail [data-act=next]')`, 8000);
  await A.tap(`document.querySelector('#projects .jb-detail [data-act=next]')`);
  ok(await A.until(`!document.querySelector('#sheet').classList.contains('hidden') && /On my way · Install/.test(document.querySelector('#sheet').textContent)`), 'with an Install booked too, Next opens On my way for the Install, not the earlier Measure');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`);
  // Phase 3b: a customer Kloomie can email. On my way's Email asks first, showing who and the message; Cancel sends nothing.
  const ec = await api('POST', '/contacts', { name: 'Erin Ames', email: `erin${t}@x.test`, phone: '555-0199', address: '5 B St' });
  const erin = ec?.contact || ec;
  const ej = await api('POST', '/jobs', { flowId: of.id, contactId: erin.id, values: { job: 'Erin install' } });
  await api('POST', `/records/${ej.job.id}/visits`, { kind: 'Install', date: dayAfter(2), start: 540, end: 600, memberIds: [st.workspace.members[0].id] });
  const omwOpen = async () => { await A.tap(`document.querySelector('#projects .jb-detail [data-act=next]')`); await A.until(`/On my way · Install/.test(document.querySelector('#sheet').textContent)`); };
  await openJobIn(ej.job.id);
  await A.until(`!!document.querySelector('#projects .jb-detail [data-act=next]')`, 8000);
  await omwOpen();
  const erinOmw = () => mailsTo(erin.email).filter((m) => m.tag === 'on-my-way').length;
  await A.tap(`[...document.querySelectorAll('#sheet button')].find((b) => b.textContent.includes('Email'))`);
  ok(await A.until(`!!document.querySelector('#sheet .send-ok') && /Send to Erin Ames by email/.test(document.querySelector('#sheet .send-ok').textContent) && /on the way/i.test(document.querySelector('#sheet .send-ok').textContent)`), 'Email asks first: “Send to Erin Ames by email?” with the message');
  await A.tap(btnText('#sheet .send-ok', 'Cancel'));
  await sleep(600);
  ok(erinOmw() === 0, 'Cancel: nothing sent');
  await omwOpen();
  await A.tap(`[...document.querySelectorAll('#sheet button')].find((b) => b.textContent.includes('Email'))`);
  await A.until(`!!document.querySelector('#sheet .send-ok')`);
  await A.tap(btnText('#sheet .send-ok', 'Send'));
  ok(await A.until(`document.querySelector('#sheet').classList.contains('hidden')`) && await until(() => erinOmw() === 1), 'Send: it goes, once');
  // Send the quote asks first too: who, the subject and the words; Cancel, then Send.
  const sq = await api('POST', '/jobs', { flowId: qf.id, contactId: erin.id, values: { job: 'Erin quote' } });
  for (const x of qf.version.body.steps.slice(0, qf.version.body.steps.findIndex((y) => y.kind === 'quote'))) if (x.kind !== 'client') await api('POST', `/jobs/${sq.job.id}/steps/${x.id}/skip`, { reason: 'Test: straight to the quote' });
  await openJobIn(sq.job.id);
  await A.until(`document.querySelector('#projects .jb-step[data-state=current]')?.textContent.includes('Send the quote') && !!document.querySelector('#projects .jb-detail [data-act=next]')`, 8000);
  await A.tap(`document.querySelector('#projects .jb-detail [data-act=next]')`);
  ok(await A.until(`!!document.querySelector('#sheet .send-ok') && /Your quote from/.test(document.querySelector('#sheet .send-ok').textContent) && /Send to Erin Ames by email/.test(document.querySelector('#sheet .send-ok').textContent) && /look it over and accept it online/.test(document.querySelector('#sheet .send-ok').textContent)`), 'Send the quote: the confirm sheet shows who, the subject and the words');
  await A.tap(btnText('#sheet .send-ok', 'Cancel'));
  await sleep(600);
  ok(!mailsTo(erin.email).some((m) => m.tag === 'quote-sent'), 'Cancel: not sent');
  await A.tap(`document.querySelector('#projects .jb-detail [data-act=next]')`);
  await A.until(`!!document.querySelector('#sheet .send-ok')`);
  await A.tap(btnText('#sheet .send-ok', 'Send'));
  ok(await until(() => mailsTo(erin.email).some((m) => m.tag === 'quote-sent')), 'and Send sends it');
  // Settings → Quotes & invoices.
  await A.ev(`document.querySelector('#settingsBtn').click(); true`);
  await A.until(`!!document.querySelector('#settings .setx-item[data-page=docs]')`);
  await A.ev(`document.querySelector('#settings .setx-item[data-page=docs]').click(); true`);
  ok(await A.until(`document.querySelector('#settings .setx-item.on')?.dataset.page === 'docs' && !!document.querySelector('#settings [data-doc=business-name]') && !!document.querySelector('#settings [data-doc=validDays]') && !!document.querySelector('#settings [data-doc=showPrices]') && !!document.querySelector('#settings [data-doc=accept]') && !!document.querySelector('#settings .doc-sig canvas')`), 'Settings → Quotes & invoices: business details, valid for, show prices, how customers accept, and a pad to draw the business signature');
  await A.type(`document.querySelector('#settings [data-doc=business-name]')`, 'Jobs Test Cleaning');
  await A.ev(`(() => { const c = document.querySelector('#settings .doc-sig canvas'); c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); const at = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: r.left + x, clientY: r.top + y, pointerId: 1, buttons: 1 })); at('pointerdown', 10, 30); for (let x = 12; x < 180; x += 6) at('pointermove', x, 30 + Math.cos(x / 9) * 12); at('pointerup', 180, 30); return true; })()`);
  await A.type(`document.querySelector('#settings [data-doc=sig-name]')`, 'Ada Owner');
  await A.ev(`${btnText('#settings .doc-sig', 'Save signature')}.click(); true`); // (a toast from the send above can sit over it)
  ok(await until(async () => { const d = await api('GET', '/docs-settings'); return /^\/brand\//.test(d.signature?.url || '') && d.signature?.name === 'Ada Owner'; }), 'the business signature is drawn and saved, with a name');
  await A.ev(`(() => { const s = document.querySelector('#settings [data-doc=accept]'); s.value = 'draw'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await A.ev(`${btnText('#settings', 'Save')}.click(); true`);
  ok(await until(async () => { const d = await api('GET', '/docs-settings'); return d.business?.name === 'Jobs Test Cleaning' && d.accept === 'draw'; }), 'saved: the business name, and customers draw to accept');
  // The quote page in draw mode: the customer signs on a pad.
  const qj2 = await api('POST', '/jobs', { flowId: qf.id, contactId: erin.id, values: { job: 'Erin quote 2' } });
  for (const x of qf.version.body.steps.slice(0, qf.version.body.steps.findIndex((y) => y.kind === 'quote'))) if (x.kind !== 'client') await api('POST', `/jobs/${qj2.job.id}/steps/${x.id}/skip`, { reason: 'Test: straight to the quote' });
  let qs = await api('POST', `/jobs/${qj2.job.id}/quote/send`);
  if (qs.confirm) qs = await api('POST', `/jobs/${qj2.job.id}/quote/send`, { confirm: qs.confirm });
  const Q = await tab(qs.url);
  ok(await Q.until(`!!document.querySelector('canvas') && document.body.textContent.includes('Jobs Test Cleaning')`), 'the quote page shows a signature pad and the business name');
  await Q.ev(`(() => { const c = document.querySelector('canvas'), r = c.getBoundingClientRect(); const at = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: r.left + x, clientY: r.top + y, pointerId: 1, buttons: 1 })); at('pointerdown', 10, 30); for (let x = 12; x < 200; x += 6) at('pointermove', x, 30 + Math.sin(x / 10) * 15); at('pointerup', 200, 30); return true; })()`);
  await Q.ev(`document.querySelector('form.accept button[type=submit], form.accept button').click(); true`);
  ok(await Q.until(`/Accepted/.test(document.body.textContent) && !!document.querySelector('img[src*="/signature"]')`, 8000), 'drawn and accepted: the page shows the signature');
  await Q.close?.();
  ok(!A.errors.length && !Q.errors.length, 'no errors in the page: ' + [...A.errors, ...Q.errors].join(' | ').slice(0, 300));
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`);
  await shot('8-auto');
  await A.ev(`document.querySelector('#workTabs [data-tab=jobs]').click(); true`);
  await A.until(`!!document.querySelector('#tool [data-jb=jobs]')`, 8000);
  await A.tap(TOOL('[data-jb=jobs]'));

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
  await A.tap(`[...document.querySelectorAll('#projects .jb-step')].find((x) => x.textContent.includes('Send invoice'))`);
  ok(await A.until(`document.querySelector('#projects .jb-detail')?.textContent.includes('Send invoice')`) && await A.ev(`!document.querySelector('#projects .jb-detail [data-act=next]')`), 'a later step, picked, offers no Next even to an owner (only the step the job is at does)');
  await A.tap(`document.querySelector('#projects .jb-step[data-state=current]')`);
  ok(await A.ev(`[...document.querySelectorAll('#projects .pj-tab')].map((x) => x.dataset.tab).join() === 'overview,client,work,finance,files,activity' && document.querySelector('#projects .jb-card').compareDocumentPosition(document.querySelector('#projects .pj-tabs')) & Node.DOCUMENT_POSITION_FOLLOWING`), 'the job window keeps its tabs (Overview, Client, Work, Finance, Files & notes, Activity), its flow above them');
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

  // As a member (Sam): Jobs, but no Job Flows or builder; New job only from a flow everyone may start; Next only on
  // the step the job is at and only when the step is theirs; never Next on an invoice or a payment; no Reopen, no
  // flow menu.
  const asSam = async () => { await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(samAuth.token)})); location.reload(); true`).catch(() => {}); await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=work]')`, 15000); };
  await asSam();
  await A.ev(`document.querySelector('[data-tab=work]').click(); true`);
  await A.until(`!!document.querySelector('#workTabs [data-tab=jobs]')`);
  await A.ev(`document.querySelector('#workTabs [data-tab=jobs]').click(); true`);
  ok(await A.until(`!!${TOOL(`.jb-row[data-job="${crewJob.job.id}"]`)}`), 'a member sees Jobs');
  ok(await A.ev(`!document.querySelector('#tool [data-jb]') && !document.querySelector('#tool [data-act=new-flow], #tool .jb-scard, #tool [data-flow]')`), 'but no Job Flows sub-tab and nothing of the builder');
  await A.tap(TOOL('[data-act=new-job]'));
  await A.until(`!document.querySelector('#sheet').classList.contains('hidden')`);
  ok(await A.ev(`[...document.querySelectorAll('#sheet select[aria-label=Flow] option')].map((o) => o.value).join() === ${JSON.stringify(crew.id)}`), 'New job offers only the flow everyone may start (not the owners-and-admins ones)');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]').click(); true`);
  await A.tap(TOOL(`.jb-row[data-job="${crewJob.job.id}"] .jb-main`));
  ok(await A.until(`document.querySelector('#projects .jb-step[data-state=current]')?.textContent.includes('Crew check')`, 8000), '(setup) Sam opens the crew job at Crew check');
  ok(await A.ev(`!!document.querySelector('#projects .jb-detail [data-act=next]') && !!document.querySelector('#projects .jb-detail [data-act=skip]')`), 'the step for Sam shows him Next and Skip');
  ok(await A.ev(`!document.querySelector('#projects .jb-card [aria-label="Flow options"]')`), 'and no flow menu (move, take off)');
  await A.tap(`document.querySelector('#projects .jb-step[data-step="${crewSid('Wrap up')}"]')`);
  ok(await A.until(`document.querySelector('#projects .jb-detail')?.dataset.detail === ${JSON.stringify(crewSid('Wrap up'))}`) && await A.ev(`!document.querySelector('#projects .jb-detail [data-act=next]')`), 'a later step (anyone’s) never offers Next');
  await api('POST', `/jobs/${crewJob.job.id}/steps/${crewSid('Crew check')}/done`);
  ok(await A.until(`document.querySelector('#projects .jb-step[data-state=current]')?.textContent.includes('Office check')`, 8000), 'live: the step done elsewhere moves the card on to Office check');
  await A.tap(`document.querySelector('#projects .jb-step[data-step="${crewSid('Office check')}"]')`);
  ok(await A.ev(`!document.querySelector('#projects .jb-detail [data-act=next]') && !document.querySelector('#projects .jb-detail [data-act=skip]')`), 'an owners-and-admins step offers Sam neither Next nor Skip');
  await A.tap(`document.querySelector('#projects .jb-step[data-step="${crewSid('Crew check')}"]')`);
  ok(await A.until(`document.querySelector('#projects .jb-detail')?.dataset.detail === ${JSON.stringify(crewSid('Crew check'))}`) && await A.ev(`!document.querySelector('#projects .jb-detail [data-act=reopen]')`), 'a finished step offers Sam no Reopen');
  await A.ev(`document.querySelector('#workTabs [data-tab=jobs]').click(); true`);
  ok(await A.until(`${TOOL(`.jb-row[data-job="${crewJob.job.id}"] .jb-at`)}?.textContent === 'Next: Office check'`) && await A.ev(`!${TOOL(`.jb-row[data-job="${crewJob.job.id}"] .jb-next`)}`), 'in the Jobs list an owners-and-admins step is only named for Sam, no button');
  await A.tap(TOOL(`.jb-row[data-job="${crewJob.job.id}"] .jb-main`));
  await A.until(`document.querySelector('#projects .jb-step[data-state=current]')?.textContent.includes('Office check')`, 8000);
  await api('POST', `/jobs/${crewJob.job.id}/steps/${crewSid('Office check')}/done`);
  ok(await A.until(`document.querySelector('#projects .jb-step[data-state=current]')?.textContent.includes('Bill it')`, 8000), '(setup) Bill it is next');
  await A.tap(`document.querySelector('#projects .jb-step[data-step="${crewSid('Bill it')}"]')`);
  ok(await A.ev(`!document.querySelector('#projects .jb-detail [data-act=next]')`), 'an invoice step never shows a member Next');
  await A.ev(`document.querySelector('#workTabs [data-tab=jobs]').click(); true`);
  ok(await A.until(`${TOOL(`.jb-row[data-job="${crewJob.job.id}"] .jb-at`)}?.textContent === 'Next: Bill it'`) && await A.ev(`!${TOOL(`.jb-row[data-job="${crewJob.job.id}"] .jb-next`)}`), 'nor a button for it in the Jobs list (only its name): ' + await A.ev(`${TOOL(`.jb-row[data-job="${crewJob.job.id}"]`)}?.textContent`));
  await api('POST', `/jobs/${crewJob.job.id}/steps/${crewSid('Bill it')}/skip`, { reason: 'Billed on paper' });
  ok(await A.until(`${TOOL(`.jb-row[data-job="${crewJob.job.id}"] .jb-at`)}?.textContent === 'Next: Get paid'`, 8000) && await A.ev(`!${TOOL(`.jb-row[data-job="${crewJob.job.id}"] .jb-next`)}`), 'a payment step: no button in the Jobs list either');
  await A.tap(TOOL(`.jb-row[data-job="${crewJob.job.id}"] .jb-main`));
  ok(await A.until(`document.querySelector('#projects .jb-step[data-state=current]')?.textContent.includes('Get paid')`, 8000) && await A.ev(`!document.querySelector('#projects .jb-detail [data-act=next]')`), 'and no Next on the job');

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
