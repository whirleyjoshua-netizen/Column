// Settings, redesigned (2026-11-20, the owner: "too much fine print, empty spaces, no dividers"): a menu of short pages
// down the side (You, Team, Business, Data), one column of cards per page, Search settings, a device that saved an old tab
// name lands on its page now, members see only their pages, deleting and leaving come last on Export & delete, and a phone
// shows the list first, then a page with ‹ back.
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/setui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4899, APP = `http://127.0.0.1:${PORT}/`, CDP = 9525;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-setui`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-setui`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
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
const items = () => A.ev(`[...document.querySelectorAll('#settings .setx-item')].filter((b) => !b.hidden).map((b) => b.dataset.page).join('|')`);
const heads = () => A.ev(`[...document.querySelectorAll('#settings .setx-cards > section > h3')].map((x) => x.textContent).join('|')`);
const open = async (k) => { await A.ev(`document.querySelector('#settings .setx-item[data-page=${k}]').click(); true`); await A.until(`document.querySelector('#settings .setx-item.on')?.dataset.page === '${k}'`); };
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Set ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  // This device last had Settings on the old Account tab.
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); localStorage.setItem('column.setTab', JSON.stringify('account')); location.reload(); true`).catch(() => {});
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 15000), 'Ada (an owner) is in');
  await A.ev(`document.querySelector('#settingsBtn').click(); true`);
  ok(await A.until(`!!document.querySelector('#settings .setx-nav')`), 'Settings opens with a menu down the side');
  ok(await A.ev(`[...document.querySelectorAll('#settings .setx-group-h')].map((x) => x.textContent).join('|')`) === 'You|Team|Business|Data', 'grouped: You, Team, Business, Data');
  ok(await items() === 'profile|notify|prefs|signature|members|access|roles|teamset|business|website|data', 'an owner has every page: ' + await items());
  ok(await A.ev(`document.querySelector('#settings .setx-item.on')?.dataset.page === 'profile' && document.querySelector('#settings .setx-head h2').textContent === 'Profile & sign-in'`), 'a device that saved the old Account tab opens on Profile & sign-in');
  ok(await heads() === 'Your email|Where you’re signed in|Your password|Two-step sign-in|This device and sign-out', 'Profile & sign-in: ' + await heads());
  ok(await A.ev(`(() => { const cs = [...document.querySelectorAll('#settings .setx-cards > section')]; return cs.length > 2 && cs.every((c) => Math.abs(c.getBoundingClientRect().left - cs[0].getBoundingClientRect().left) < 2) && getComputedStyle(cs[0]).borderTopWidth !== '0px'; })()`), 'its cards are one column, each with a border');
  ok(await A.ev(`![...document.querySelectorAll('#settings .setx-page p, #settings .setx-page small')].some((p) => parseFloat(getComputedStyle(p).fontSize) < 12.5)`), 'no fine print: nothing under 12.5px on the page');
  // Search settings.
  await A.ev(`(() => { const q = document.querySelector('#settings .setx-search'); q.value = 'time zone'; q.dispatchEvent(new Event('input')); })()`);
  ok(await items() === 'teamset', 'searching “time zone” leaves Team settings');
  await A.ev(`document.querySelector('#settings .setx-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true`);
  ok(await A.until(`document.querySelector('#settings .setx-head h2')?.textContent === 'Team settings' && [...document.querySelectorAll('#settings .setx-cards h3')].some((x) => x.textContent === 'Time zone')`), 'Enter opens it, with Time zone');
  await A.ev(`(() => { const q = document.querySelector('#settings .setx-search'); q.value = 'password'; q.dispatchEvent(new Event('input')); })()`);
  ok((await items()).split('|').includes('profile'), '“password” finds Profile & sign-in');
  await A.ev(`(() => { const q = document.querySelector('#settings .setx-search'); q.value = ''; q.dispatchEvent(new Event('input')); })()`);
  // Each page has its cards; danger last.
  await open('access');
  ok(await heads() === 'What members see|What members can use|Campaign email', 'What members can use: ' + await heads());
  ok(await A.ev(`(() => { const r = [...document.querySelectorAll('#settings .access-sec .srow')].find((x) => x.textContent.startsWith('Boards')); return r.classList.contains('off-team') && r.querySelector('input').disabled && !r.querySelector('input').checked && r.textContent.includes('Off for the team'); })()`), 'a tool off for the whole team (Boards, new team) is greyed with “Off for the team”, not shown as on');
  await open('teamset');
  ok((await heads()).endsWith('Moved to their own pages') && !!(await A.ev(`!!document.querySelector('#settings .apps-moved button') && !!document.querySelector('#settings .auto-moved button')`)), 'Team settings ends with where Tools and Automations went');
  await open('data');
  ok(await heads() === 'Export the team|Export your things|Leave or delete|Delete team|Clear items', 'Export & delete: exports first, then the danger zone: ' + await heads());
  ok(await A.ev(`[...document.querySelectorAll('#settings .danger-sec')].length === 3`), 'the three danger cards are marked as such');
  // A member sees their own pages and the team's people, not the owners' ones.
  const st = await api('GET', '/state');
  const mo = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'join', workspace: 'Set ' + t, code: st.workspace.inviteCode, name: 'Mo', email: `mo${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' }) })).json();
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(mo.token)})); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 15000);
  await A.ev(`document.querySelector('#settingsBtn').click(); true`);
  await A.until(`!!document.querySelector('#settings .setx-nav')`);
  ok(await items() === 'profile|notify|prefs|signature|members|roles|business|data', 'a member has no What members can use, Team settings or Website: ' + await items());
  // A phone: the list first, then a page, ‹ back.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  await A.ev(`document.querySelector('#settings [aria-label=Close]').click(); document.querySelector('#settingsBtn').click(); true`);
  ok(await A.until(`!!document.querySelector('#settings .setx.list-only') && getComputedStyle(document.querySelector('#settings .setx-page')).display === 'none'`), 'on a phone Settings opens on the list of pages');
  await A.tap(`document.querySelector('#settings .setx-item[data-page=prefs]')`);
  ok(await A.until(`!document.querySelector('#settings .setx.list-only') && getComputedStyle(document.querySelector('#settings .setx-nav')).display === 'none' && document.querySelector('#settings .setx-head h2')?.textContent === 'Preferences'`), 'tapping one opens just that page');
  await A.tap(`document.querySelector('#settings .setx-back')`);
  ok(await A.until(`!!document.querySelector('#settings .setx.list-only')`), '‹ goes back to the list');
  ok(await A.ev(`document.documentElement.scrollWidth <= innerWidth`), 'nothing spills sideways');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
chrome.kill();
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-6).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
