// Flows step 3 in a real browser (headless Chrome): an automation built in the editor that, when a job moves to
// Done, books the install, bills the job (and asks to send it), emails the customer (after an OK), adds the money and
// writes the work order from a doc template. The job moves; what doesn't need an OK is done at once; the OKs wait on
// Home as the automation's, and its maker (the owner) can OK them: the email goes out once, the invoice is sent. The
// new steps' editor fits a phone.
import { autoUI } from './autobuild.mjs';
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/flows_actions_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const OUTBOX = DIR + '/data/outbox';
const mails = () => (FS.existsSync(OUTBOX) ? FS.readdirSync(OUTBOX).map((f) => JSON.parse(FS.readFileSync(OUTBOX + '/' + f, 'utf8'))) : []);
const PORT = 4972, CDP = 9531, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
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
  const pick = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  const fill = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const check = (sel) => ev(`(() => { const s = ${sel}; s.checked = true; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  return { ev, until, tap, pick, fill, check, cmd, errors };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Acts ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const st = await api('GET', '/state');
  await api('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const p = await api('POST', '/projects', { template: 'trades', trades: ['hvac'] });
  const tp = p.types[0];
  const statusF = tp.fields.find((f) => f.key === 'status');
  const dana = await api('POST', '/contacts', { name: 'Dana Ruiz', email: 'dana@x.test', phone: '702-555-0142' });
  const doc = await api('POST', '/items', { type: 'text', doc: { title: 'Work order', blocks: [{ type: 'p', runs: [{ text: 'For the crew' }] }] } });
  await api('POST', '/doc-templates', { docId: doc.id, name: 'Work order' });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');
  await A.until(`!!document.querySelector('#tabs [data-tab=automations]')`, 10000);
  await A.ev(`document.querySelector('#tabs [data-tab=automations]').click(); true`);
  await A.tap(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent === '+ New automation')`);
  const B = autoUI(A);
  await B.when('record.stage');
  await A.fill(`document.querySelector('#sheet .auto-name')`, 'Done → follow through');
  await B.adv();
  await A.until(`!!document.querySelector('#sheet .auto-proj')`);
  await A.pick(`document.querySelector('#sheet .auto-proj')`, p.id);
  await A.until(`!!document.querySelector('#sheet .auto-to')`);
  await A.pick(`document.querySelector('#sheet .auto-to')`, 'Done');
  await B.pick(B.act(0));
  await A.tap(`document.querySelector('#sheet .ab-panel .ab-change')`);
  ok(await A.until(`[...document.querySelectorAll('.ap-pop .ap-item')].map((o) => o.dataset.key).filter((v) => ['visit', 'invoice', 'text', 'email', 'money', 'doc'].includes(v)).length === 6`), 'the step picker has the new steps: visit, invoice, text, email, money, doc');
  // 1. Book the install, 2 days out at 9:00 for 1½ hours.
  await A.tap(`document.querySelector('.ap-pop .ap-item[data-key="visit"]')`);
  ok(await A.until(`!!document.querySelector('#sheet .auto-visit-kind')`), '“Book a visit” asks which kind, when and who goes');
  await A.pick(`document.querySelector('#sheet .auto-visit-kind')`, 'Install');
  await A.fill(`document.querySelector('#sheet .auto-visit-days')`, '2');
  await A.ev(`(() => { const s = document.querySelector('#sheet .auto-visit-at'); s.value = '09:00'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await B.adv();
  await A.pick(`document.querySelector('#sheet .auto-visit-len')`, '90');
  await A.pick(`document.querySelector('#sheet .auto-visit-crew')`, '');
  // 2. Bill it, and send it after an OK.
  await B.add('invoice');
  await A.until(`!!document.querySelector('#sheet .auto-inv-send')`);
  await A.check(`document.querySelector('#sheet .auto-inv-send')`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .hint')].some((x) => x.textContent.includes('asks for an OK to send it'))`), 'ticking “send it” says it asks for an OK first');
  // 3. Email the customer.
  await B.add('email');
  await A.until(`!!document.querySelector('#sheet .auto-email-sub')`);
  await A.fill(`document.querySelector('#sheet .auto-email-sub')`, '{record} is done');
  await A.fill(`document.querySelector('#sheet .auto-email-body')`, 'Hi,\n\n{record} is finished. Thank you!');
  ok(await A.ev(`[...document.querySelectorAll('#sheet .hint')].some((x) => x.textContent.startsWith('Waits for an OK every time'))`), 'the email says it waits for an OK every time');
  // 4. The money in.
  await B.add('money');
  await A.until(`!!document.querySelector('#sheet .auto-money-amt')`);
  await A.fill(`document.querySelector('#sheet .auto-money-amt')`, '300');
  await B.adv();
  await A.fill(`document.querySelector('#sheet .auto-money-cat')`, 'Jobs');
  await A.fill(`document.querySelector('#sheet .auto-money-note')`, 'Paid for {record}');
  // 5. The work order.
  await B.add('doc');
  ok(await A.until(`[...(document.querySelector('#sheet .auto-doc-tpl')?.options || [])].some((o) => o.textContent === 'Work order')`), '“Write a doc” lists the team’s doc templates');
  await A.fill(`document.querySelector('#sheet .auto-doc-title')`, 'Work order: {record}');
  await B.pick(B.act(0));
  // At phone width, before saving: it fits.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  ok(await A.ev(`document.documentElement.scrollWidth <= 392 && document.querySelector('#sheet .sheet').getBoundingClientRect().right <= 391 && !!document.querySelector('#sheet .auto-visit-kind')`), 'the editor with the new steps fits a phone');
  await A.cmd('Emulation.clearDeviceMetricsOverride');
  await sleep(300);
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Turn it on')`);
  ok(await A.until(`[...document.querySelectorAll('#tool .auto-row b')].some((b) => b.textContent === 'Done → follow through')`), 'saved');
  const saved = (await api('GET', '/automations')).find((x) => x.name === 'Done → follow through');
  ok(saved && saved.actions.map((s) => s.kind).join() === 'visit,invoice,email,money,doc', `with its five steps, as built (${saved?.actions.map((s) => s.kind).join()})`);
  ok(saved.actions[0].visit === 'Install' && saved.actions[0].inDays === 2 && saved.actions[0].start === '09:00' && saved.actions[0].length === 90 && saved.actions[1].send === true && saved.actions[2].subject === '{record} is done' && saved.actions[3].amount === 300 && saved.actions[4].title === 'Work order: {record}', 'each step as set');

  // The job moves to Done.
  const job = await api('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'AC tune-up', customer: dana.id, price: { rows: [{ desc: 'Tune-up', qty: 1, price: '300' }] } } });
  await api('PATCH', `/records/${job.id}`, { values: { [statusF.id]: statusF.choices.find((c) => c.label === 'Done').id } });
  ok(await A.until(`[...document.querySelectorAll('#tool .auto-row')].some((r) => r.textContent.includes('Booked the install') && r.textContent.includes('Waiting for an OK'))`), 'the list shows what it did, and what waits for an OK');
  const s2 = await api('GET', '/state');
  ok((await api('GET', `/records/${job.id}/visits`)).some((v) => v.kind === 'Install' && v.start === 540) && s2.money.some((m) => m.note === 'Paid for AC tune-up') && s2.items.some((x) => x.title === 'Work order: AC tune-up'), 'the install is booked, the money is in, and the work order is written');
  ok(!mails().some((m) => m.to === 'dana@x.test'), 'Dana hasn’t been emailed yet');

  // Home: the automation needs an OK. Its maker opens it and OKs the email.
  await A.ev(`document.querySelector('#tabs [data-tab=home]').click(); true`);
  const need = (what) => `[...document.querySelectorAll('button, .hm-item, [role=button]')].find((b) => b.textContent.includes('Automation “Done → follow through” needs your OK') && b.textContent.includes(${JSON.stringify(what)}))`;
  ok(await A.until(`!!(${need('Email Dana Ruiz')})`, 12000), 'Home says the automation needs an OK to email Dana');
  await A.tap(need('Email Dana Ruiz'));
  ok(await A.until(`[...document.querySelectorAll('#sheet button')].some((b) => b.textContent === '✓ Approve')`), 'its maker can OK it (it’s the automation asking)');
  ok(await A.ev(`document.querySelector('#sheet .ap-preview')?.textContent.includes('AC tune-up is done') && document.querySelector('#sheet .ap-preview').textContent.includes('is finished. Thank you!')`), 'the OK shows the email itself: subject and message');
  await A.tap(`[...document.querySelectorAll('#sheet button')].find((b) => b.textContent === '✓ Approve')`);
  let sent = false;
  for (let i = 0; i < 40 && !sent; i++) { sent = mails().some((m) => m.to === 'dana@x.test' && m.subject === 'AC tune-up is done'); if (!sent) await sleep(150); }
  ok(sent, 'OK’d, the email goes to Dana');
  await A.until(`!(${need('Email Dana Ruiz')})`, 8000);
  await A.tap(need('Send INV-'));
  await A.tap(`[...document.querySelectorAll('#sheet button')].find((b) => b.textContent === '✓ Approve')`);
  let inv;
  for (let i = 0; i < 40; i++) { inv = (await api('GET', '/invoices')).find((x) => x.recordId === job.id); if (inv?.sentAt) break; await sleep(150); }
  ok(!!inv?.sentAt, 'OK’d, the invoice is sent');
  ok(await A.until(`!(${need('Automation')})`, 8000), 'and nothing is left waiting on Home');
  ok(mails().filter((m) => m.to === 'dana@x.test' && m.subject === 'AC tune-up is done').length === 1, 'Dana got the email once');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors.join(' | ').slice(0, 300) : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  chrome.kill('SIGKILL');
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
