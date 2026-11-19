// What members can use, in a real browser: an owner switches Boards and Inventory off for members and lets them see
// the team's schedule, in Settings → Team; the member's Workspace and Tools follow (no Boards, no Inventory, Tasks →
// Team there). Owners keep everything.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/member_access_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5246, CDP = 9587, APP = `http://127.0.0.1:${PORT}/`;
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
  const post = async (p, b, tok) => (await fetch(APP + 'api' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b) })).json();
  const a = await post('/auth', { mode: 'create', workspace: 'Acc ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const api = async (m, p, b, tok = a.token) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined })).json();
  const st = await api('GET', '/state');
  await api('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, inventory: true } });
  const mo = await post('/auth', { mode: 'join', workspace: 'Acc ' + t, code: st.workspace.inviteCode, name: 'Mo Lane', email: `mo${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  const signIn = async (tok) => { await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(tok)})); location.reload(); true`); await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000); };
  const workTabs = () => A.ev(`[...document.querySelectorAll('#tabs .tab-sub, #workTabs button[data-tab]')].map((b) => b.dataset.tab).filter(Boolean).join()`);
  const toolList = async () => { await A.ev(`document.querySelector('#tabs [data-tab=tools]').click(); true`); await A.until(`!!document.querySelector('#menu [data-tool]')`); const l = await A.ev(`[...document.querySelectorAll('#menu [data-tool]')].map((x) => x.dataset.tool).join()`); await A.ev(`document.querySelector('#menu').classList.add('hidden'); true`); return l; };

  // Mo, before: Boards and Inventory are there.
  await signIn(mo.token);
  ok((await workTabs()).includes('projects') && (await toolList()).includes('inventory'), 'at first Mo has Boards and Inventory');

  // Rico, in Settings → Team.
  await signIn(a.token);
  await A.tap(`document.querySelector('#settingsBtn')`);
  await A.tap(`[...document.querySelectorAll('#settings .set-tabs button')].find((b) => b.textContent === 'Team')`);
  ok(await A.until(`!!document.querySelector('#settings .access-sec')`), 'Settings → Team has What members can use');
  const flip = (name) => A.ev(`(() => { const r = [...document.querySelectorAll('#settings .access-sec .srow')].find((x) => x.querySelector('span').firstChild.textContent === ${JSON.stringify(name)}); const i = r.querySelector('input'); i.checked = !i.checked; i.dispatchEvent(new Event('change')); return i.checked; })()`);
  ok((await flip('Boards')) === false && (await flip('Inventory')) === false && (await flip('See the team’s schedule')) === true, 'Rico switches Boards and Inventory off for members, and the team schedule on');
  let acc;
  for (let i = 0; i < 40; i++) { acc = (await api('GET', '/state')).workspace.memberAccess; if (acc.projects === false && acc.inventory === false && acc.teamSchedule === true) break; await sleep(150); }
  ok(acc.projects === false && acc.inventory === false && acc.teamSchedule === true, 'saved');
  ok((await workTabs()).includes('projects') && (await toolList()).includes('inventory'), 'Rico (the owner) still has both');

  // Mo, after.
  await signIn(mo.token);
  ok(!(await workTabs()).includes('projects'), 'Mo’s Workspace has no Boards now: ' + await workTabs());
  ok(!(await toolList()).includes('inventory'), 'and no Inventory in Tools');
  await A.ev(`document.querySelector('#tabs [data-tab=work]').click(); true`);
  ok(await A.until(`!!document.querySelector('#day .day-modes [data-view=team]:not(.hidden)')`, 8000), 'Tasks → Team is there for him');
  const r = await fetch(APP + 'api/inventory', { headers: { authorization: 'Bearer ' + mo.token } });
  ok(r.status === 403, 'and the server refuses Inventory to him, too');
  // Contacts for members: Mo sees the list, and what the owner adds shows up for him live.
  await api('POST', '/contacts', { name: 'Dana Fox', phone: '602 555 0101' });
  await api('PATCH', '/workspace', { memberAccess: { contacts: true } });
  await A.ev(`location.reload(); true`);
  await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000);
  ok(await A.until(`(${JSON.stringify('')} || true) && [...document.querySelectorAll('#tabs .tab-sub, #workTabs button[data-tab]')].some((b) => b.dataset.tab === 'contacts')`, 8000), 'with Contacts on for members, Mo has a Contacts tab');
  await A.ev(`[...document.querySelectorAll('#workTabs button[data-tab=contacts], #tabs [data-tab=contacts]')].find((b) => b.offsetParent || true).click(); true`);
  ok(await A.until(`/Dana Fox/.test(document.querySelector('#tool')?.textContent || '')`, 8000), 'and sees the team’s contacts');
  await api('POST', '/contacts', { name: 'Lee Park', phone: '602 555 0102' });
  ok(await A.until(`/Lee Park/.test(document.querySelector('#tool')?.textContent || '')`, 8000), 'a contact the owner adds shows up for him right away');
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(300);
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
