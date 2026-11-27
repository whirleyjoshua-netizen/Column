// Kloomie apps (the owner, 2026-11-27: native apps users add to help their workflow, told apart from the real
// third-party apps; "admins only, free for now, call them Kloomie apps"). Apps & Integrations has three tabs: Kloomie
// apps (Kloomie's own: an Add / Open button, a "By Kloomie" badge, a page each with what it does, where it is and who
// can use it), Integrations (other companies' apps, with their own logos and Connect) and Developers. Only owners and
// admins add or remove one; members see what's added and open it.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/kloomie_apps_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5673, CDP = 9673, APP = `http://127.0.0.1:${PORT}/`;
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
  const fill = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  return { ev, until, tap, fill, cmd, errors };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Kapps ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b, tok = a.token) => { const r = await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  ok((await api('GET', '/state')).body.workspace.tools.map === false, '(setup) Map starts off for a new team');

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');
  await A.tap(`document.querySelector('#tabs [data-tab=apps]')`);
  ok(await A.until(`!!document.querySelector('#apps .apps-tabs')`), 'Apps & Integrations opens');
  ok(await A.ev(`[...document.querySelectorAll('#apps .apps-tabs button')].map((b) => b.textContent).join('|')`) === 'Kloomie apps|Integrations|Developers', 'tabs: Kloomie apps, Integrations, Developers');
  ok(await A.until(`document.querySelector('#apps .apps-tabs button.on')?.textContent === 'Kloomie apps' && document.querySelectorAll('#apps .kapp-tile').length >= 16`), 'it opens on Kloomie apps: a tile for each of Kloomie’s own');
  ok(await A.ev(`[...document.querySelectorAll('#apps .kapp-tile')].every((t) => /By Kloomie/.test(t.querySelector('.kapp-badge')?.textContent || '') && t.querySelector('.kapp-ic svg'))`), 'each with Kloomie’s own icon and a By Kloomie badge');
  ok(await A.ev(`document.querySelectorAll('#apps .kapps-group h2').length >= 3`), 'grouped by what they’re for');
  const map = `document.querySelector('#apps .kapp-tile[data-kapp=map]')`;
  ok(await A.ev(`${map}.dataset.state === 'off' && /Not added/.test(${map}.textContent) && ${map}.querySelector('.kapp-act')?.textContent === 'Add'`), 'Map: Not added, with Add');
  ok(await A.ev(`(() => { const d = document.querySelector('#apps .kapp-tile[data-kapp=docs]'); return d.dataset.state === 'on' && /Added/.test(d.textContent) && d.querySelector('.kapp-act')?.textContent === 'Open'; })()`), 'Docs: Added, with Open');

  // Add, from the tile.
  await A.tap(`${map}.querySelector('.kapp-act')`);
  let on = false;
  for (let i = 0; i < 40 && !on; i++) { on = (await api('GET', '/state')).body.workspace.tools.map === true; if (!on) await sleep(150); }
  ok(on, 'Add turns Map on for the team');
  ok(await A.until(`${map}.dataset.state === 'on' && ${map}.querySelector('.kapp-act')?.textContent === 'Open'`), 'the tile says Added, with Open');
  await A.tap(`${map}.querySelector('.kapp-act')`);
  ok(await A.until(`document.querySelector('#split:not(.hidden) .split-title')?.textContent === 'Map' || document.querySelector('#tool:not(.hidden) .tool-title, #tool:not(.hidden) h2')?.textContent?.includes('Map')`), 'Open opens Map');
  await A.ev(`document.querySelector('#split .split-close')?.click(); true`);

  // Its page.
  await A.tap(`document.querySelector('#tabs [data-tab=apps]')`);
  await A.until(`!!document.querySelector('#apps .kapp-tile[data-kapp=map]')`);
  await A.tap(`${map}.querySelector('.kapp-name')`);
  ok(await A.until(`!!document.querySelector('#apps .kapp-detail[data-kapp=map]')`), 'tapping the tile opens Map’s page');
  ok(await A.ev(`(() => { const d = document.querySelector('#apps .kapp-detail'); return /What it does/.test(d.textContent) && /Where it is/.test(d.textContent) && /Who can use it/.test(d.textContent) && /By Kloomie/.test(d.textContent) && /Free/.test(d.textContent); })()`), 'with what it does, where it is, who can use it, By Kloomie and Free');
  await A.tap(`document.querySelector('#apps .kapp-detail .kapp-remove')`);
  await A.tap(`document.querySelector('#apps .kapp-detail .kapp-remove')`);
  let off = false;
  for (let i = 0; i < 40 && !off; i++) { off = (await api('GET', '/state')).body.workspace.tools.map === false; if (!off) await sleep(150); }
  ok(off, 'Remove from workspace (tapped twice to confirm) turns it off');
  ok(await A.until(`!!document.querySelector('#apps .kapp-detail .kapp-add')`), 'and the page offers Add again');
  await A.tap(`document.querySelector('#apps .kapp-detail .kapp-back')`);
  ok(await A.until(`!!document.querySelector('#apps .kapp-tile[data-kapp=map]') && !document.querySelector('#apps .kapp-detail')`), '‹ back to all Kloomie apps');

  // Integrations: other companies' apps, their own logos, no Kloomie badge; a search finds Kloomie apps too, marked.
  await A.ev(`[...document.querySelectorAll('#apps .apps-tabs button')].find((b) => b.textContent === 'Integrations').click(); true`);
  ok(await A.until(`document.querySelectorAll('#apps .app-tile').length > 20`), 'Integrations lists other companies’ apps');
  ok(await A.ev(`![...document.querySelectorAll('#apps .app-tile')].some((t) => t.querySelector('.kapp-badge'))`), 'none of them wears the By Kloomie badge');
  await A.fill(`document.querySelector('#apps .apps-q')`, 'inventory');
  ok(await A.until(`!!document.querySelector('#apps .apps-kloomie .kapp-tile[data-kapp=inventory] .kapp-badge')`), 'searching Integrations for “inventory” shows Kloomie’s own Inventory, badged, in its own row');
  await A.tap(`document.querySelector('#apps .apps-kloomie .kapp-tile[data-kapp=inventory] .kapp-name')`);
  ok(await A.until(`!!document.querySelector('#apps .kapp-detail[data-kapp=inventory]') && document.querySelector('#apps .apps-tabs button.on')?.textContent === 'Kloomie apps'`), 'and opens its page under Kloomie apps');

  // A member: sees what's added, can open it, can't add or remove.
  const code = (await api('GET', '/state')).body.workspace.inviteCode;
  const m = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'join', workspace: 'Kapps ' + t, code, name: 'Mo Lane', email: `mo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd2' }) })).json();
  ok((await api('PATCH', '/workspace', { tools: { map: true } }, m.token)).status === 403, 'a member can’t add one through the API either');
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(m.token))}); localStorage.removeItem('column.appsTab'); location.reload(); true`);
  await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000);
  await A.tap(`document.querySelector('#tabs [data-tab=apps]')`);
  ok(await A.until(`document.querySelectorAll('#apps .kapp-tile').length >= 10`), 'a member sees Kloomie apps');
  ok(await A.ev(`![...document.querySelectorAll('#apps .kapp-act')].some((b) => b.textContent === 'Add') && /owners and admins add/i.test(document.querySelector('#apps .apps-lead')?.textContent || '')`), 'with no Add buttons: owners and admins add them');
  await A.tap(`${map}.querySelector('.kapp-name')`);
  ok(await A.until(`!!document.querySelector('#apps .kapp-detail[data-kapp=map]') && !document.querySelector('#apps .kapp-detail .kapp-add, #apps .kapp-detail .kapp-remove') && /owner or admin/i.test(document.querySelector('#apps .kapp-detail').textContent)`), 'its page: no Add or Remove, ask an owner or admin');

  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  ok(await A.ev(`document.documentElement.scrollWidth <= 391`), 'fits a phone');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors[0] : ''));
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
chrome.kill('SIGKILL');
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
