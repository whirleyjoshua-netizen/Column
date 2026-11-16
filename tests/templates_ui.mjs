// Templates in the browser (Workspace → Tools → Templates, 2026-11-16): make an email template with a {word}, find it by
// kind and search, edit it, import one from a file, see the team's paperwork (a doc template makes a new doc), and start
// an automation's email step from a template (copied into the step).
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/tplui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4869, APP = `http://127.0.0.1:${PORT}/`, CDP = 9493;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-tplui`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-tplui`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
  const pick = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  const tap = async (expr) => { const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); for (const ty of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type: ty, x, y, button: 'left', buttons: ty === 'mousePressed' ? 1 : 0, clickCount: 1 }); await sleep(80); };
  return { ev, until, tap, mouse, cmd, pick, errors, close: () => ws.close() };
}
let A;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Tpl ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  const doc = await api('POST', '/items', { type: 'text', doc: { title: 'Work order', blocks: [{ id: 'a', type: 'p', runs: [{ text: 'Job: ' }] }] } });
  await api('POST', '/doc-templates', { docId: doc.id, name: 'Work order', about: 'For every install' });
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=work]')`, 15000), 'Ada is in');
  // Workspace → Tools → Templates.
  await A.ev(`document.querySelector('#tabs [data-tab=work]').click(); true`);
  await A.until(`!!document.querySelector('[data-tab=tools]')`);
  await A.ev(`document.querySelector('[data-tab=tools]').click(); true`);
  ok(await A.until(`!!document.querySelector('#split [data-tool=templates]')`), 'Templates is in Workspace → Tools');
  await A.ev(`document.querySelector('#split [data-tool=templates]').click(); true`);
  ok(await A.until(`document.querySelector('#split h2')?.textContent.startsWith('Templates') && document.querySelector('#split').textContent.includes('None yet')`), 'it opens, empty to start');
  ok(await A.ev(`[...document.querySelectorAll('#split .tpl-kinds button')].map((b) => b.textContent).join('|')`) === 'All|Email|Text message|Reply|Social post|Paperwork', 'with kinds: email, text, reply, social post and paperwork');
  ok(await A.ev(`!!document.querySelector('#split [data-doc-tpl]') && document.querySelector('#split').textContent.includes('Work order')`), 'the team’s doc templates show as paperwork');
  // Make an email template, with a word from the chips.
  await A.ev(`[...document.querySelectorAll('#split button')].find((b) => b.textContent === '+ New template').click(); true`);
  await A.until(`!!document.querySelector('#sheet .tpl-text')`);
  ok(await A.ev(`!document.querySelector('#sheet .tpl-subject').closest('label').hidden`), 'an email has a subject');
  await A.ev(`(() => { const s = document.querySelector('#sheet'); s.querySelector('.tpl-name').value = 'Quote follow-up'; s.querySelector('.tpl-when').value = 'A quote with no answer'; s.querySelector('.tpl-subject').value = 'Your quote for {record}'; const b = s.querySelector('.tpl-text'); b.value = 'Hi '; b.focus(); b.setSelectionRange(3, 3); return true; })()`);
  await A.ev(`[...document.querySelectorAll('#sheet .tpl-words .chip')].find((c) => c.textContent === '{customer}').click(); true`);
  ok(await A.ev(`document.querySelector('#sheet .tpl-text').value === 'Hi {customer}'`), 'a word chip goes in where the cursor is');
  await A.ev(`(() => { const b = document.querySelector('#sheet .tpl-text'); b.value += ', checking in on {record}.'; return true; })()`);
  await A.pick(`document.querySelector('#sheet .tpl-k')`, 'text');
  ok(await A.ev(`document.querySelector('#sheet .tpl-subject').closest('label').hidden`), 'a text has no subject');
  await A.pick(`document.querySelector('#sheet .tpl-k')`, 'email');
  await A.ev(`document.querySelector('#sheet .primary-btn').click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#split .tpl-card b')].some((b) => b.textContent === 'Quote follow-up')`), 'it’s in the library');
  const saved = (await api('GET', '/msg-templates')).find((x) => x.name === 'Quote follow-up');
  ok(saved && saved.subject === 'Your quote for {record}' && saved.body === 'Hi {customer}, checking in on {record}.', 'saved with its subject and words');
  // Kinds and search.
  await A.ev(`document.querySelector('#split .tpl-kinds [data-kind=post]').click(); true`);
  ok(await A.until(`!document.querySelector('#split .tpl-card[data-tpl]')`), 'Social post shows none of the emails');
  await A.ev(`document.querySelector('#split .tpl-kinds [data-kind=all]').click(); true`);
  await A.ev(`(() => { const q = document.querySelector('#split .tpl-q'); q.value = 'nothing like it'; q.dispatchEvent(new Event('input')); return true; })()`);
  ok(await A.until(`document.querySelector('#split').textContent.includes('No templates match')`), 'search narrows it');
  await A.ev(`(() => { const q = document.querySelector('#split .tpl-q'); q.value = ''; q.dispatchEvent(new Event('input')); q.blur(); return true; })()`);
  // Edit.
  await A.until(`!!document.querySelector('#split .tpl-card[data-tpl]')`);
  await A.ev(`document.querySelector('#split .tpl-card[data-tpl]').click(); true`);
  await A.until(`document.querySelector('#sheet .tpl-name')?.value === 'Quote follow-up'`);
  await A.ev(`(() => { document.querySelector('#sheet .tpl-when').value = 'After a quote goes quiet'; document.querySelector('#sheet .primary-btn').click(); return true; })()`);
  ok(await A.until(`document.querySelector('#split').textContent.includes('After a quote goes quiet')`), 'editing it saves');
  // Import from a file.
  const fp = S + '/dk/thanks-reply.txt';
  FS.writeFileSync(fp, 'Thanks so much for the review, {customer}!');
  await A.cmd('DOM.enable');
  const { root } = (await A.cmd('DOM.getDocument', { depth: -1, pierce: true })).result;
  const { nodeId } = (await A.cmd('DOM.querySelector', { nodeId: root.nodeId, selector: '#split input[type=file]' })).result;
  await A.cmd('DOM.setFileInputFiles', { nodeId, files: [fp] });
  ok(await A.until(`document.querySelector('#sheet .tpl-name')?.value === 'thanks-reply' && document.querySelector('#sheet .tpl-text').value.includes('{customer}')`), 'importing a file fills a new template with its words');
  await A.pick(`document.querySelector('#sheet .tpl-k')`, 'reply');
  await A.ev(`document.querySelector('#sheet .primary-btn').click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#split .tpl-card b')].some((b) => b.textContent === 'thanks-reply')`), 'and saves it as a reply');
  // An automation's email step starts from a template.
  await A.ev(`document.querySelector('#split [aria-label=Close], #split .icon-btn[aria-label^=Close]')?.click(); true`);
  await A.ev(`document.querySelector('#tabs [data-tab=automations]').click(); true`);
  await A.until(`[...document.querySelectorAll('#tool button')].some((b) => b.textContent === '+ New automation')`, 8000);
  await A.ev(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent === '+ New automation').click(); true`);
  await A.until(`!!document.querySelector('#sheet .auto-step-kind')`, 8000);
  await A.pick(`document.querySelector('#sheet .auto-step-kind')`, 'email');
  ok(await A.until(`!!document.querySelector('#sheet .auto-tpl')`), 'an email step offers “Use a template…”');
  ok(await A.ev(`[...document.querySelector('#sheet .auto-tpl').options].map((o) => o.textContent).includes('Quote follow-up (Email)')`), 'listing the team’s email and reply templates');
  await A.pick(`document.querySelector('#sheet .auto-tpl')`, saved.id);
  ok(await A.until(`document.querySelector('#sheet .auto-email-sub')?.value === 'Your quote for {record}' && document.querySelector('#sheet .auto-email-body')?.value === 'Hi {customer}, checking in on {record}.'`), 'picking one copies its subject and wording into the step');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
chrome.kill();
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-6).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
