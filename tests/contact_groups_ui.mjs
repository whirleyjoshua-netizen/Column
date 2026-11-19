// Contact groups in the browser (2026-11-19): a Groups list beside Contacts at full size (chips across the top when
// narrow), + New group with ready names, Add to group for the people selected, a group's ⋯ to rename or delete it
// (nobody in it is deleted), a contact's Groups row (+ New group right there), a new contact starting in the group
// on screen, and a job's Pick a customer narrowed by group.
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/cgui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4891, APP = `http://127.0.0.1:${PORT}/`, CDP = 9515;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-cgui`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-cgui`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
const T = (x) => `document.querySelector('#tool ${x}')`;
const rail = () => A.ev(`[...document.querySelectorAll('#tool .ct-rail .ct-gbtn')].map((b) => b.textContent).join('|')`);
const names = () => A.ev(`[...document.querySelectorAll('#tool .contact-row .contact-name')].map((b) => b.textContent).sort().join(',')`);
const railTap = (label) => A.tap(`[...document.querySelectorAll('#tool .ct-gbtn')].find((b) => b.querySelector('span').textContent.includes(${JSON.stringify(label)}))`);
const shot = async (name) => { if (!process.env.SHOT) return; const r = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(`${process.env.SHOT}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Cg ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  await api('PATCH', '/workspace', { tools: { projects: true, contacts: true } });
  await api('POST', '/contacts', { name: 'Ivan Inspector', phone: '555-0101' });
  await api('POST', '/contacts', { name: 'Ana Attorney', email: `ana${t}@law.test` });
  await api('POST', '/contacts', { name: 'Ben Buyer', email: `ben${t}@b.test`, stage: 'lead' });
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=contacts]')`, 15000), 'Ada is in');
  await A.ev(`document.querySelector('#tabs [data-tab=contacts]').click(); true`);
  ok(await A.until(`!!${T('.ct-rail')} && document.querySelectorAll('#tool .contact-row').length === 3`), 'at full size Contacts has a Groups list beside the people');
  ok(await rail() === 'All3' && await A.ev(`!!${T('.ct-gnew')} && ${T('.ct-rail-hint')}.textContent.includes('vendors, inspectors')`), 'All 3, + New group, and what groups are for');
  // + New group, from the ready names.
  await A.tap(T('.ct-gnew'));
  ok(await A.until(`[...document.querySelectorAll('#sheet .ct-gstart .chip')].some((b) => b.textContent.includes('Inspectors'))`), '+ New group offers ready names (Inspectors, Vendors…)');
  await A.tap(`[...document.querySelectorAll('#sheet .ct-gstart .chip')].find((b) => b.textContent.includes('Inspectors'))`);
  await A.tap(`[...document.querySelectorAll('#sheet .sheet > .btns .primary-btn')].pop()`);
  ok(await A.until(`(${T('.ct-gitem.on')}?.textContent || '').includes('🔍 Inspectors') && document.querySelectorAll('#tool .contact-row').length === 0`), 'it makes 🔍 Inspectors and shows it (nobody in it yet)');
  // Add to group, for the people selected.
  await railTap('All');
  await A.until(`document.querySelectorAll('#tool .contact-row').length === 3`);
  await A.tap(`[...document.querySelectorAll('#tool .contact-row')].find((r) => r.textContent.includes('Ivan Inspector')).querySelector('input[type=checkbox]')`);
  ok(await A.until(`!!${T('.ct-to-group')}`), 'selecting someone (no email needed) offers Add to group');
  await A.tap(T('.ct-to-group'));
  await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes('Inspectors'))`);
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Inspectors')).click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#tool .contact-row')].find((r) => r.textContent.includes('Ivan Inspector'))?.querySelector('.ct-gchip')?.textContent === '🔍 Inspectors'`), 'Ivan shows 🔍 Inspectors');
  ok(await rail() === 'All3|🔍 Inspectors1|In no group2', 'the list counts them: ' + await rail());
  // A group on screen: only its people; + Add starts there.
  await railTap('Inspectors');
  ok(await A.until(`${JSON.stringify('Ivan Inspector')} === [...document.querySelectorAll('#tool .contact-row .contact-name')].map((b) => b.textContent).join(',')`), 'tapping Inspectors shows only Ivan');
  await A.tap(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent === '+ Add')`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .ct-gpick .chip.on')].map((b) => b.textContent).join() === '🔍 Inspectors'`), 'a new contact starts in the group on screen');
  await A.ev(`(() => { const i = document.querySelectorAll('#sheet input'); i[0].value = 'Ida Inspector'; })()`);
  await A.tap(`[...document.querySelectorAll('#sheet .sheet > .btns .primary-btn')].pop()`);
  ok(await A.until(`[...document.querySelectorAll('#tool .contact-row .contact-name')].map((b) => b.textContent).sort().join(',') === 'Ida Inspector,Ivan Inspector'`), 'and is in it once saved');
  // A contact's Groups row: + New group right there.
  await railTap('All');
  await A.tap(`[...document.querySelectorAll('#tool .contact-name')].find((b) => b.textContent === 'Ana Attorney')`);
  await A.until(`!!document.querySelector('#sheet .ct-gpick-new')`);
  await A.tap(`document.querySelector('#sheet .ct-gpick-new')`);
  await A.until(`document.activeElement?.classList.contains('ct-gpick-in')`);
  await A.ev(`(() => { const i = document.activeElement; i.value = 'Legal'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .ct-gpick .chip.on')].map((b) => b.textContent).join() === 'Legal'`), '+ New group in a contact makes Legal and puts Ana in it');
  await A.tap(`[...document.querySelectorAll('#sheet .sheet > .btns .primary-btn')].pop()`);
  ok(await A.until(`[...document.querySelectorAll('#tool .contact-row')].find((r) => r.textContent.includes('Ana Attorney'))?.querySelector('.ct-gchip')?.textContent === 'Legal'`), 'saved: Ana shows Legal');
  ok(await A.until(`(${T('.ct-rail')}.textContent).includes('Legal1')`), 'and Legal is in the list');
  // Search finds by group name.
  await A.ev(`(() => { const q = document.querySelector('#tool input[type=search]'); q.value = 'legal'; q.dispatchEvent(new Event('input')); })()`);
  ok(await A.until(`[...document.querySelectorAll('#tool .contact-row .contact-name')].map((b) => b.textContent).join() === 'Ana Attorney'`), 'searching “legal” finds Ana by her group');
  await A.ev(`(() => { const q = document.querySelector('#tool input[type=search]'); q.value = ''; q.dispatchEvent(new Event('input')); })()`);
  // ⋯ → Rename; ⋯ → Delete (nobody deleted).
  const opts = async (g, label) => { await A.ev(`(() => { const it = [...document.querySelectorAll('#tool .ct-gitem')].find((x) => x.textContent.includes(${JSON.stringify(g)})); it.querySelector('.ct-gmore').click(); })()`); await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes(${JSON.stringify(label)}))`); await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes(${JSON.stringify(label)})).click(); true`); };
  await opts('Legal', 'Rename');
  await A.until(`!!document.querySelector('#sheet input')`);
  await A.ev(`(() => { const i = document.querySelectorAll('#sheet input'); i[0].value = 'Legal & accounting'; i[1].value = '⚖️'; })()`);
  await A.tap(`[...document.querySelectorAll('#sheet .sheet > .btns .primary-btn')].pop()`);
  ok(await A.until(`(${T('.ct-rail')}.textContent).includes('⚖️ Legal & accounting')`), '⋯ → Rename… renames it, with an emoji');
  await opts('Inspectors', 'Delete group');
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.classList.contains('danger')).click(); true`);
  ok(await A.until(`!(${T('.ct-rail')}.textContent).includes('Inspectors') && document.querySelectorAll('#tool .contact-row').length === 4`), '⋯ → Delete group removes it; all 4 people are still here');
  await shot('cg-wide');
  // A job's Pick a customer, by group.
  const board = await api('POST', '/projects', { template: 'board', name: 'Board' });
  const rec = await api('POST', `/projects/${board.id}/records`, { typeId: board.types[0].id, values: {} });
  await A.ev(`location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=projects]')`, 15000);
  await A.ev(`document.querySelector('#tabs [data-tab=projects]').click(); true`);
  await A.tap(`[...document.querySelectorAll('#projects .pj-card')].find((c) => c.textContent.includes('Board'))`);
  await A.tap(`document.querySelector('#projects .pj-card-r')`);
  await A.until(`!!document.querySelector('#projects .pj-cust .linkish')`);
  await A.tap(`[...document.querySelectorAll('#projects .pj-cust .linkish')].find((b) => b.textContent === 'Pick a customer')`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .pj-pick-groups .chip')].map((b) => b.textContent).join('|') === 'Everyone|⚖️ Legal & accounting'`), 'Pick a customer has the groups to narrow it');
  await A.tap(`[...document.querySelectorAll('#sheet .pj-pick-groups .chip')].find((b) => b.textContent.includes('Legal'))`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .pj-pick-row:not(.new) b')].map((b) => b.textContent).join() === 'Ana Attorney'`), 'Legal shows only Ana');
  await A.ev(`document.querySelector('#sheet .sheet-close, #sheet [aria-label=Close]')?.click(); true`);
  // Narrow: chips across the top.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 420, height: 860, deviceScaleFactor: 2, mobile: true });
  await A.ev(`location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden')`, 15000);
  await A.ev(`(document.querySelector('#tabs [data-tab=contacts]') || document.querySelector('[data-tab=contacts]')).click(); true`);
  ok(await A.until(`!!${T('.ct-gchipsbar')} && !${T('.ct-rail')} && (${T('.ct-gchipsbar')}.textContent).includes('All4')`), 'narrow: the groups are chips across the top');
  await sleep(1200); await shot('cg-phone');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
chrome.kill();
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-6).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
