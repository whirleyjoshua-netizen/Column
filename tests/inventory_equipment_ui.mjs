// Equipment in Inventory, in a real browser (headless Chrome): an owner moves the team's Equipment & assets project
// into Inventory with one click; a one-by-one item lists its units; a unit is checked out, brought back, reported for
// a problem and fixed; scanning a label made before the move (/a/<tag>) opens the unit in Inventory, where its combo
// shows on request; labels print. Fits a phone.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/inventory_equipment_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4987, CDP = 9545, APP = `http://127.0.0.1:${PORT}/`;
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
    // Wait until nothing (a toast) sits over it, as a person would.
    await until(`(() => { const e = ${expr}; if (!e) return false; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && (top === e || e.contains(top)); })()`, 6000);
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(150);
  };
  const fill = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  return { ev, until, tap, fill, cmd, errors };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Gear ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const st = await api('GET', '/state');
  await api('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  // The team's equipment list from before, with a label on Tower 7.
  const ap = await api('POST', '/projects', { template: 'assets' });
  const at = ap.types[0];
  const fk = (k) => at.fields.find((f) => f.key === k);
  const ch = (k, l) => fk(k).choices.find((c) => c.label === l).id;
  const tower = await api('POST', `/projects/${ap.id}/records`, { typeId: at.id, values: { name: 'Tower 7', [fk('kind').id]: ch('kind', 'Camera tower'), [fk('status').id]: ch('status', 'At the yard'), [fk('serial').id]: 'CT-0007', [fk('combo').id]: '9-9-2' } });
  const oldTag = (await api('POST', `/records/${tower.id}/tag`)).tag;
  await api('POST', '/inventory/items', { name: 'Pressure washer', track: 'units', onHand: 2 });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');
  await A.until(`!!document.querySelector('#tabs [data-tab=tools]')`, 10000);
  await A.ev(`document.querySelector('#tabs [data-tab=tools]').click(); true`);
  await A.tap(`document.querySelector('#menu [data-tool=inventory]')`);
  ok(await A.until(`!!document.querySelector('#split .inv-import[data-project]')`), 'the Equipment & assets list is offered: Move into Inventory');
  await A.tap(`document.querySelector('#split .inv-import-go')`);
  ok(await A.until(`[...document.querySelectorAll('#split .inv-row b')].some((b) => b.textContent === 'Camera tower') && !document.querySelector('#split .inv-import')`), 'moved: Camera tower is in Inventory, and the offer is gone');

  // A unit: out, back, a problem, fixed.
  await A.tap(`[...document.querySelectorAll('#split .inv-row')].find((r) => r.textContent.includes('Pressure washer'))`);
  ok(await A.until(`document.querySelectorAll('#sheet .inv-unit').length === 2`), 'a one-by-one item lists its units');
  await A.tap(`document.querySelector('#sheet .inv-unit')`);
  ok(await A.until(`!!document.querySelector('#sheet .inv-u-out') && /Available/.test(document.querySelector('#sheet').textContent)`), 'a unit opens: Available, with Check out');
  await A.tap(`document.querySelector('#sheet .inv-u-out')`);
  await A.until(`!!document.querySelector('#sheet .inv-co-who')`);
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Check it out')`);
  ok(await A.until(`[...document.querySelectorAll('#split .inv-row')].find((r) => r.textContent.includes('Pressure washer'))?.textContent.includes('1 out')`), 'checked out: the list says 1 out');
  await A.tap(`[...document.querySelectorAll('#split .inv-row')].find((r) => r.textContent.includes('Pressure washer'))`);
  await A.tap(`[...document.querySelectorAll('#sheet .inv-unit')].find((u) => u.classList.contains('s-out'))`);
  ok(await A.until(`!!document.querySelector('#sheet .inv-u-back') && /with Rico Vega/.test(document.querySelector('#sheet').textContent)`), 'out: with Rico Vega, Bring back');
  await A.tap(`document.querySelector('#sheet .inv-u-back')`);
  await A.until(`!!document.querySelector('#sheet .inv-up-place')`);
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Bring it back')`);
  ok(await A.until(`!([...document.querySelectorAll('#split .inv-row')].find((r) => r.textContent.includes('Pressure washer'))?.textContent.includes('out'))`), 'brought back');
  await A.tap(`[...document.querySelectorAll('#split .inv-row')].find((r) => r.textContent.includes('Pressure washer'))`);
  await A.tap(`document.querySelector('#sheet .inv-unit')`);
  await A.tap(`document.querySelector('#sheet .inv-u-repair')`);
  await A.until(`!!document.querySelector('#sheet .inv-u-note')`);
  await A.fill(`document.querySelector('#sheet .inv-u-note')`, 'Hose cracked');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Report it')`);
  ok(await A.until(`/1 in repair/.test([...document.querySelectorAll('#split .inv-row')].find((r) => r.textContent.includes('Pressure washer'))?.textContent || '')`), 'a problem reported: 1 in repair');
  await A.tap(`[...document.querySelectorAll('#split .inv-row')].find((r) => r.textContent.includes('Pressure washer'))`);
  await A.tap(`[...document.querySelectorAll('#sheet .inv-unit')].find((u) => u.classList.contains('s-repair'))`);
  ok(await A.until(`/Rico Vega reported a problem · “Hose cracked”/.test(document.querySelector('#sheet .inv-moves')?.textContent || '')`), 'its history says who reported what');
  await A.tap(`document.querySelector('#sheet .inv-u-fixed')`);
  ok(await A.until(`/Available/.test(document.querySelector('#sheet').textContent) && !!document.querySelector('#sheet .inv-u-out')`), 'fixed: available again');

  // The old sticker: scanning it opens the unit in Inventory, and its combo shows on request.
  await A.ev(`location.href = ${JSON.stringify(APP + 'a/')} + ${JSON.stringify(oldTag)}; true`);
  ok(await A.until(`document.querySelector('#sheet h2')?.textContent.includes('Tower 7')`, 20000), 'scanning the label made before the move opens Tower 7 in Inventory');
  ok(await A.until(`!!document.querySelector('#split .inv-row')`) && !(await A.ev(`!!document.querySelector('#split .inv-import')`)), 'after a reload, a list already moved isn’t offered again');
  await A.tap(`document.querySelector('#sheet .inv-u-reveal')`);
  ok(await A.until(`document.querySelector('#sheet .inv-combo code')?.textContent === '9-9-2'`), 'Show: its combo, still sealed until asked');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]').click(); true`);

  // Labels.
  await A.until(`!!document.querySelector('#split .inv-row')`);
  await A.tap(`[...document.querySelectorAll('#split .inv-row')].find((r) => r.textContent.includes('Pressure washer'))`);
  await A.tap(`document.querySelector('#sheet .inv-labels')`);
  ok(await A.until(`document.querySelectorAll('#sheet .as-preview .as-label img').length === 2 && document.querySelectorAll('#labelSheet .as-label').length === 2`), 'Print labels: a QR label for each, ready to print');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]').click(); true`);

  // The old list is archived, not deleted (2026-11-19): one place for the gear, and Restore puts it back.
  const proj = (await api('GET', '/state')).projects.find((x) => x.id === ap.id);
  ok(proj?.archived === true && proj.archivedWhy === 'inventory', 'moving it into Inventory archived the Equipment & assets project');
  await A.ev(`document.querySelector('#split .split-close')?.click(); document.querySelector('#tabs [data-tab=projects]').click(); true`);
  ok(await A.until(`!!document.querySelector('#projects .pj-archived') && document.querySelector('#projects .pj-archived summary').textContent === 'Archived (1)' && /Moved into Inventory/.test(document.querySelector('#projects .pj-arch').textContent) && ![...document.querySelectorAll('#projects .pj-card')].some((c) => c.textContent.includes(${JSON.stringify(proj.name)}))`), 'Projects: off the list, under Archived (1), “Moved into Inventory”');
  await A.ev(`document.querySelector('#projects .pj-archived').open = true; true`);
  await A.tap(`document.querySelector('#projects .pj-arch .linkish')`);
  ok(await A.until(`/Moved into Inventory/.test(document.querySelector('#projects .pj-arch-banner')?.textContent || '') && [...document.querySelectorAll('#projects .pj-arch-banner button')].some((b) => b.textContent === 'Open Inventory')`), 'opened, it says the gear is in Inventory now, with Open Inventory and Restore');
  await A.tap(`document.querySelector('#projects .pj-arch-banner .pj-restore')`);
  ok(await A.until(`!document.querySelector('#projects .pj-arch-banner')`), 'Restore: back to normal');
  ok(!(await api('GET', '/state')).projects.find((x) => x.id === ap.id).archived, 'and not archived any more');

  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  ok(await A.until(`document.documentElement.scrollWidth <= 392`, 4000), 'it fits a phone');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors.join(' | ').slice(0, 300) : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  chrome.kill('SIGKILL');
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
