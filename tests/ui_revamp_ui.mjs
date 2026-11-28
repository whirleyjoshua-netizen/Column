// The phone and docked-column redesign (the owner, 2026-11-28: "a full audit on the column ui and the mobile ui … i'm
// open to a complete revamp"; audit https://claude.ai/artifact/K5cBXWHbn8pogU2trEm7pB). Step 1, what was broken: Day
// opens showing what's due today; Jobs always has + New job (with no flow it adds the job to a job list); on a phone a
// job opens as its own page, not under its board, and closing it goes back to where you were; Chat's closed feed
// drawer casts no shadow; the confirm-your-email box is one line, on Home only. Step 2, finding your way: five fixed
// tabs at the bottom of a phone (Home, Jobs or Tasks, +, Chat, More) and the same five down a slim rail in a docked
// column; no ☰; + makes a job, a task, a message or a contact; More is a list you can search, grouped by what people
// do, with each place's own icon.
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/uirevamp';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5520, APP = `http://127.0.0.1:${PORT}/`, CDP = 9790;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-uirevamp`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-uirevamp`, '--no-first-run', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, SKIP_SETUP: '1', PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', RESEND_API_KEY: '', STRIPE_SECRET_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const shot = async (name) => { if (!process.env.SHOTS) return; const r = await cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(`${process.env.SHOTS}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
  return { ev, until, cmd, errors, shot };
}
const api = (tok) => async (m, p, body) => { const r = await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return r.json().catch(() => null); };
const vis = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })()`;
const rect = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height, b: r.bottom, r: r.right }; })()`;
const bar = `[...document.querySelectorAll('#appDock > button')].map((b) => b.dataset.go)`;
const tapGo = (A, g, where = '#appDock') => A.ev(`document.querySelector('${where} [data-go="${g}"]').click(); true`);
const signIn = async (A, tok, mode) => {
  if (mode === 'phone') { await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await A.cmd('Emulation.setTouchEmulationEnabled', { enabled: true }); }
  else await A.cmd('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(tok)})); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && document.querySelectorAll('#appDock > button').length > 0`, 15000);
};
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await api()('POST', '/auth', { mode: 'create', workspace: 'Sunline ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'iPhone', deviceId: 'd1' });
  const rico = api(a.token);
  let st = await rico('GET', '/state');
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, chat: true, camps: true, column: true } });
  const p = await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'] });
  const tp = p.types[0];
  const job = await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Burns Home' } });
  for (const text of ['Order blinds for Smith', 'Call Lopez back', 'Restock van']) await rico('POST', '/tasks', { text, due: new Date().toISOString().slice(0, 10) });
  // A team that doesn't run jobs.
  const o = await api()('POST', '/auth', { mode: 'create', workspace: 'Plain ' + t, name: 'Olly', email: `olly${t}@t.test`, password: 'longenough2', device: 'iPhone', deviceId: 'd2' });

  // ===== a phone =====
  const A = await tab(APP);
  await signIn(A, a.token, 'phone');
  await A.until(`!document.querySelector('#home').classList.contains('hidden')`, 8000);
  await A.shot('phone-home');

  // ---- step 2: five fixed tabs ----
  ok(await A.until(`JSON.stringify(${bar}) === JSON.stringify(['go:home', 'tab:jobs', 'go:new', 'tool:chat', 'go:more'])`, 6000), 'a phone has five tabs at the bottom: Home, Jobs, +, Chat, More: ' + JSON.stringify(await A.ev(bar)) + ' ' + A.errors.join(' | ').slice(0, 600));
  ok(await A.ev(`[...document.querySelectorAll('#appDock > button')].map((b) => b.textContent.trim()).join('|')`) === 'Home|Jobs|New|Chat|More', 'each labelled');
  ok(await A.ev(`document.querySelector('#appDock [data-go="go:home"]').classList.contains('on')`), 'Home is lit on Home');
  ok(!(await A.ev(vis('#menuBtn'))) && !(await A.ev(vis('#homeBtn'))), 'no ☰ and no house up top');
  ok(await A.ev(`document.querySelectorAll('#home .home-grid > .home-card').length > 0`), 'Home still has its widgets');

  // ---- step 1: the confirm-your-email box is one line, on Home only ----
  const cb = await A.ev(rect('#confirmBar'));
  ok(cb && cb.h <= 56, 'the confirm-your-email box is one line on a phone: ' + JSON.stringify(cb));
  ok(await A.ev(`!!document.querySelector('#confirmBar [data-act="cb-open"]')`), 'with Enter code');
  await A.ev(`document.querySelector('#confirmBar [data-act="cb-open"]').click(); true`);
  ok(await A.until(vis('#confirmBar .cb-code')), 'Enter code shows the code box');

  // ---- step 1: Day shows what's due ----
  await tapGo(A, 'go:more');
  await A.until(vis('#menuPage [data-go="tab:day"]'));
  await tapGo(A, 'tab:day', '#menuPage');
  ok(await A.until(`!document.querySelector('#day').classList.contains('hidden') && !!document.querySelector('#day .anytime.tasks')`, 6000), 'Tasks opens on Day with the Due list');
  await sleep(400);
  const due = await A.ev(rect('#day .anytime.tasks'));
  const dayTop = await A.ev(rect('#day .day-scroll'));
  ok(due && dayTop && due.t >= dayTop.t - 1 && due.t < 844 - 200, 'the tasks due today are in view as Day opens: ' + JSON.stringify({ due, dayTop }));
  ok(!(await A.ev(vis('#confirmBar'))), 'the confirm box isn’t on other pages');

  // ---- step 2: More ----
  await tapGo(A, 'go:more');
  ok(await A.until(vis('#menuPage input[type=search]')), 'More opens a page with a search box');
  ok(await A.ev(`document.querySelector('#appDock [data-go="go:more"]').classList.contains('on')`), 'More is lit');
  ok(await A.ev(`document.querySelectorAll('#menuPage .more-row').length >= 10 && document.querySelectorAll('#menuPage .app-tile-btn').length === 0`), 'a list of rows, not a grid of tiles');
  const heads = await A.ev(`[...document.querySelectorAll('#menuPage .menu-sec h2')].map((x) => x.textContent)`);
  ok(heads.includes('Run jobs') && heads.includes('Talk') && heads.includes('Settings & help') && !heads.includes('Tools') && !heads.includes('Workspace'), 'grouped by what people do: ' + heads.join(', '));
  ok(!(await A.ev(`document.body.textContent.includes('Edit the dock')`)), 'no Edit the dock');
  ok(await A.ev(`(() => { const j = document.querySelector('#menuPage [data-go="tab:jobs"] .app-ic')?.innerHTML, b = document.querySelector('#menuPage [data-go="tab:projects"] .app-ic')?.innerHTML; return !!j && !!b && j !== b; })()`), 'Jobs and Boards have their own icons');
  await A.ev(`(() => { const i = document.querySelector('#menuPage input[type=search]'); i.value = 'inven'; i.dispatchEvent(new Event('input')); return true; })()`);
  ok(await A.until(`(() => { const rows = [...document.querySelectorAll('#menuPage .more-row')].filter((r) => r.offsetParent); return rows.length === 1 && rows[0].dataset.go === 'tool:inventory'; })()`), 'searching “inven” leaves Inventory');
  await A.ev(`(() => { const i = document.querySelector('#menuPage input[type=search]'); i.value = ''; i.dispatchEvent(new Event('input')); return true; })()`);
  await A.shot('phone-more');

  // ---- step 1: + New job with no flow; a job opens as its own page ----
  await tapGo(A, 'tab:jobs');
  await A.until(`!!document.querySelector('#tool [data-jb]')`, 8000);
  await A.ev(`[...document.querySelectorAll('#tool [data-jb]')].find((b) => b.dataset.jb === 'jobs')?.click(); true`);
  ok(await A.until(`!!document.querySelector('#tool [data-act="new-job"]')`, 8000), 'Jobs has + New job with no job flow yet');
  ok(await A.ev(`document.querySelector('#appDock [data-go="tab:jobs"]').classList.contains('on')`), 'Jobs is lit');
  await A.until(`!!document.querySelector('#tool .jb-main')`, 8000);
  await A.ev(`[...document.querySelectorAll('#tool .jb-main')].find((b) => /Burns Home/.test(b.textContent)).click(); true`);
  ok(await A.until(`!document.querySelector('#projects').classList.contains('hidden') && document.querySelector('#projects').classList.contains('pj-solo') && !!document.querySelector('#projects .pj-panel')`, 8000), 'tapping a job opens it as its own page');
  await sleep(300);
  const pan = await A.ev(rect('#projects .pj-panel'));
  ok(pan && pan.t < 80 && pan.w >= 380, 'the job fills the screen, no board above it: ' + JSON.stringify(pan));
  ok(!(await A.ev(`(() => { const e = document.querySelector('#projects .pj-top'); if (!e) return false; const r = e.getBoundingClientRect(); const x = document.elementFromPoint(r.left + 10, r.top + 10); return r.height > 0 && e.contains(x); })()`)), 'the board’s header isn’t showing');
  ok(await A.ev(`document.querySelector('#appDock [data-go="tab:jobs"]').classList.contains('on')`), 'Jobs stays lit (not Boards)');
  await A.shot('phone-job');
  await A.ev(`document.querySelector('#projects .pj-panel .pj-panel-h [aria-label="Close"]').click(); true`);
  ok(await A.until(`document.querySelector('#projects').classList.contains('hidden') && !!document.querySelector('#tool .jb-main')`, 5000), 'closing it goes back to the Jobs list');
  await A.ev(`document.querySelector('#tool [data-act="new-job"]').click(); true`);
  ok(await A.until(`!document.querySelector('#sheet').classList.contains('hidden') && /New job/.test(document.querySelector('#sheet').textContent)`, 4000), '+ New job opens New job');
  await A.ev(`(() => { const i = document.querySelector('#sheet input[name="jobname"]'); i.value = 'Porch wash'; return true; })()`);
  await A.ev(`document.querySelector('#sheet .btns .primary-btn').click(); true`);
  ok(await A.until(async () => false, 10) || await (async () => { for (let i = 0; i < 40; i++) { const r = await rico('GET', `/projects/${p.id}/records`); if ((r || []).some((x) => Object.values(x.values || {}).includes('Porch wash'))) return true; await sleep(150); } return false; })(), 'and it adds the job to the job list');

  // ---- step 2: + ----
  await tapGo(A, 'go:new');
  ok(await A.until(`!document.querySelector('#sheet').classList.contains('hidden') && !!document.querySelector('#sheet [data-new="job"]') && !!document.querySelector('#sheet [data-new="task"]') && !!document.querySelector('#sheet [data-new="message"]') && !!document.querySelector('#sheet [data-new="contact"]')`, 4000), '+ offers a job, a task, a message and a contact');
  await A.ev(`document.querySelector('#sheet [data-new="task"]').click(); true`);
  ok(await A.until(`!!document.querySelector('#sheet input[name="tasktext"]')`, 3000), 'New task asks what');
  await A.ev(`(() => { document.querySelector('#sheet input[name="tasktext"]').value = 'Call the supplier'; return true; })()`);
  await A.ev(`document.querySelector('#sheet .btns .primary-btn').click(); true`);
  ok(await (async () => { for (let i = 0; i < 40; i++) { const s2 = await rico('GET', '/state'); if ((s2.tasks || []).some((x) => x.text === 'Call the supplier')) return true; await sleep(150); } return false; })(), 'and makes the task');

  // ---- step 1: Chat's closed drawer casts no shadow; Chat is lit ----
  await tapGo(A, 'tool:chat');
  ok(await A.until(`!!document.querySelector('.ch-side')`, 6000), 'Chat opens');
  ok(await A.ev(`document.querySelector('#appDock [data-go="tool:chat"]').classList.contains('on')`), 'Chat is lit');
  ok(await A.ev(`getComputedStyle(document.querySelector('.ch-side')).boxShadow === 'none'`), 'the closed feed drawer casts no shadow: ' + await A.ev(`getComputedStyle(document.querySelector('.ch-side')).boxShadow`));
  await tapGo(A, 'go:home');
  ok(await A.until(`!document.querySelector('#home').classList.contains('hidden') && document.querySelector('#split').classList.contains('hidden')`, 4000), 'Home goes back home');
  ok(!A.errors.length, 'no errors on the page: ' + A.errors.join(' | ').slice(0, 300));

  // ===== a team with no jobs: Tasks is the second tab =====
  const C = await tab(APP);
  await signIn(C, o.token, 'phone');
  ok(await C.until(`JSON.stringify(${bar}) === JSON.stringify(['go:home', 'tab:day', 'go:new', 'tool:chat', 'go:more'])`, 6000), 'a team that doesn’t run jobs: Home, Tasks, +, Chat, More: ' + JSON.stringify(await C.ev(bar)));

  // ===== a docked column (narrow, with a mouse): the same five down a rail =====
  const B = await tab(APP);
  await signIn(B, a.token, 'column');
  await B.until(`document.body.classList.contains('column')`, 5000);
  ok(await B.until(`JSON.stringify(${bar}) === JSON.stringify(['go:home', 'tab:jobs', 'go:new', 'tool:chat', 'go:more'])`, 6000), 'the column has the same five');
  await sleep(300);
  const rail = await B.ev(rect('#appDock'));
  ok(rail && rail.l === 0 && rail.w <= 72 && rail.h >= 600, 'down a slim rail at the left: ' + JSON.stringify(rail));
  const home = await B.ev(rect('#home'));
  ok(home && home.l >= rail.r - 1, 'the page sits beside it: ' + JSON.stringify(home));
  ok(await B.ev(`[...document.querySelectorAll('#appDock > button')].every((b) => b.title)`), 'each with a tooltip');
  ok(!(await B.ev(vis('#menuBtn'))), 'no ☰');
  await tapGo(B, 'go:more');
  ok(await B.until(vis('#menuPage input[type=search]')), 'More opens there too');
  const mp = await B.ev(rect('#menuPage'));
  ok(mp && mp.l >= rail.r - 1, 'beside the rail: ' + JSON.stringify(mp));
  await B.shot('column-more');
  await tapGo(B, 'tool:chat');
  await B.until(vis('#split'), 5000);
  const sp = await B.ev(rect('#split'));
  ok(sp && sp.l >= rail.r - 1, 'Chat opens beside the rail, not over it: ' + JSON.stringify(sp));
  await B.shot('column-chat');
  ok(!B.errors.length && !C.errors.length, 'no errors on the page: ' + [...B.errors, ...C.errors].join(' | ').slice(0, 300));
} catch (e) {
  ok(false, 'threw: ' + (e.stack || e));
} finally {
  srv.kill(); chrome.kill();
}
if (fails) console.log(srv.log.slice(-1500));
console.log(fails ? `ui_revamp_ui: ${fails} failed` : 'ui_revamp_ui: all passed');
process.exit(fails ? 1 : 0);
