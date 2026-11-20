// The phone and docked-column shell (the owner, 2026-11-19): "use widgets for the pages instead of tabs… opening you
// get home… home is the main widget that scrolls horizontal to the different subjects… at the bottom like an iPhone
// the pinned four apps… up top the settings icon and the menu icon; the menu icon routes you to the menu page, not a
// drop down… like the iPhone interface icons." Full size keeps its sidebar.
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/mobileshell';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5304, APP = `http://127.0.0.1:${PORT}/`, CDP = 9601;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-mshell`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-mshell`, '--no-first-run', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
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
  // SHOTS=<dir> saves a picture at each step, to look at the layout.
  const shot = async (name) => { if (!process.env.SHOTS) return; const r = await cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(`${process.env.SHOTS}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
  return { ev, until, cmd, errors, shot, close: () => ws.close() };
}
let A;
const phone = async () => { await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await A.cmd('Emulation.setTouchEmulationEnabled', { enabled: true }); await sleep(300); };
const vis = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })()`;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Phone ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'iPhone', deviceId: 'd1' }) })).json();
  A = await tab(APP);
  await phone();
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !document.body.classList.contains('wide')`, 15000), 'Ada is in, on a phone');

  // Home first, with the menu and settings icons up top (Sidekick moves to the menu page).
  ok(await A.until(`!document.querySelector('#home').classList.contains('hidden')`), 'it opens on Home');
  ok(await A.ev(vis('#menuBtn')) && await A.ev(vis('#gearBtn')) && !(await A.ev(vis('#skBtn'))), 'the top bar has the menu and settings icons');
  ok(!(await A.ev(vis('#topTabs'))), 'no row of tabs across the top');

  // Home: widgets side by side, swiped one at a time, with dots.
  ok(await A.until(`document.querySelectorAll('#home .home-grid > .home-card').length >= 4`), 'Home is made of widgets');
  await A.shot('phone-home');
  ok(await A.ev(`(() => { const g = document.querySelector('#home .home-grid'), c = g.querySelector('.home-card').getBoundingClientRect(); return getComputedStyle(g).overflowX === 'auto' && g.scrollWidth > g.clientWidth * 2 && c.width > 390 * 0.75 && c.width < 390; })()`), 'they scroll sideways, one big widget at a time');
  const n = await A.ev(`document.querySelectorAll('#home .home-grid > .home-card').length`);
  ok(await A.ev(`document.querySelectorAll('#home .home-dots i').length`) === n && await A.ev(`document.querySelectorAll('#home .home-dots i.on').length === 1 && document.querySelector('#home .home-dots i').classList.contains('on')`), `a dot for each of the ${n} widgets, the first lit`);
  await A.ev(`(() => { const g = document.querySelector('#home .home-grid'); g.scrollLeft = g.querySelectorAll('.home-card')[1].offsetLeft - g.offsetLeft; g.dispatchEvent(new Event('scroll')); return true; })()`);
  ok(await A.until(`[...document.querySelectorAll('#home .home-dots i')].findIndex((x) => x.classList.contains('on')) === 1`), 'swiping to the next one lights its dot');
  await A.ev(`document.querySelectorAll('#home .home-dots i')[2].click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#home .home-dots i')].findIndex((x) => x.classList.contains('on')) === 2`), 'tapping a dot goes to that widget: ' + await A.ev(`(() => { const g = document.querySelector('#home .home-grid'); return JSON.stringify({ sl: g.scrollLeft, offs: [...g.children].map((c) => c.offsetLeft), cw: g.clientWidth, on: [...document.querySelectorAll('#home .home-dots i')].findIndex((x) => x.classList.contains('on')), same: g.isConnected }); })()`));

  // The dock: four apps at the bottom.
  ok(await A.ev(vis('#appDock')), 'a dock at the bottom');
  ok(await A.ev(`(() => { const d = document.querySelector('#appDock').getBoundingClientRect(); return d.bottom >= 844 - 2 && d.top > 844 - 130; })()`), 'pinned to the bottom of the screen');
  ok(await A.ev(`[...document.querySelectorAll('#appDock .dock-app')].map((b) => b.dataset.go).join()`) === 'tab:day,tool:chat,tab:contacts,tab:camps', 'four apps: Tasks, Chat, Contacts, then Campaigns while Boards is switched off: ' + await A.ev(`[...document.querySelectorAll('#appDock .dock-app')].map((b) => b.dataset.go).join()`));
  ok(await A.ev(`[...document.querySelectorAll('#appDock .dock-app')].every((b) => b.querySelector('.app-ic svg') && b.querySelector('.app-l').textContent)`), 'each an icon with its name under it');
  await A.ev(`document.querySelector('#appDock [data-go="tab:day"]').click(); true`);
  ok(await A.until(`!document.querySelector('#day').classList.contains('hidden') && document.querySelector('#appDock [data-go="tab:day"]').classList.contains('on')`), 'Tasks opens from the dock, and its icon lights');
  await A.shot('phone-tasks');
  ok(await A.ev(`(() => { const d = document.querySelector('#appDock').getBoundingClientRect(), s = document.querySelector('#day').getBoundingClientRect(); return s.bottom <= d.top + 1 || JSON.stringify([s.top, s.bottom, d.top]); })()`) === true, 'the page ends above the dock: ' + await A.ev(`(() => { const d = document.querySelector('#appDock').getBoundingClientRect(), s = document.querySelector('#day').getBoundingClientRect(), m = document.querySelector('#main').getBoundingClientRect(); return JSON.stringify({ day: [s.top, s.bottom], dock: d.top, main: [m.top, m.bottom, getComputedStyle(document.querySelector('#main')).paddingBottom] }); })()`));
  ok(await A.ev(vis('#homeBtn')), 'away from Home, a Home icon up top');
  await A.ev(`document.querySelector('#homeBtn').click(); true`);
  ok(await A.until(`!document.querySelector('#home').classList.contains('hidden')`), 'which goes back Home');

  // The menu page: not a drawer.
  await A.ev(`document.querySelector('#menuBtn').click(); true`);
  ok(await A.until(`!document.querySelector('#menuPage').classList.contains('hidden')`), '☰ opens the menu page');
  ok(!(await A.ev(`document.querySelector('#app').classList.contains('side-open')`)), 'not the drawer');
  await A.shot('phone-menu');
  const tiles = await A.ev(`[...document.querySelectorAll('#menuPage .app-tile-btn')].map((b) => b.dataset.go)`);
  ok(['tab:day', 'tab:contacts', 'tab:camps', 'tab:docs', 'tool:chat', 'tool:column', 'tab:apps', 'go:settings'].every((k) => tiles.includes(k)), 'icons for every page and tool: ' + tiles.join());
  ok((await A.ev(`[...document.querySelectorAll('#menuPage .menu-sec h2')].map((x) => x.textContent).join('|')`)).startsWith('Workspace|Tools'), 'grouped: Workspace, Tools…');
  ok(await A.ev(`(() => { const b = [...document.querySelectorAll('#menuPage .app-tile-btn')].slice(0, 4).map((x) => x.getBoundingClientRect()); return b[0].top === b[3].top && b[0].width < 110; })()`), 'four across, like a phone’s home screen');
  await A.ev(`document.querySelector('#menuPage [data-go="tab:contacts"]').click(); true`);
  ok(await A.until(`!document.querySelector('#tool').classList.contains('hidden') && document.querySelector('#menuPage').classList.contains('hidden')`), 'a menu icon opens its page');
  await A.ev(`document.querySelector('#menuBtn').click(); true`);
  await A.until(`!document.querySelector('#menuPage').classList.contains('hidden')`);
  await A.ev(`document.querySelector('#menuPage [data-go="tab:apps"]').click(); true`);
  ok(await A.until(`!document.querySelector('#apps').classList.contains('hidden')`), 'Apps & Integrations too');

  // Change the dock.
  await A.ev(`document.querySelector('#menuBtn').click(); true`);
  await A.until(`!document.querySelector('#menuPage').classList.contains('hidden')`);
  await A.ev(`document.querySelector('#menuPage .dock-edit').click(); true`);
  ok(await A.until(`document.querySelectorAll('#sheet select.dock-pick').length === 4`), 'Edit the dock: four slots to pick from');
  await A.shot('phone-dock-edit');
  await A.ev(`(() => { const s = document.querySelectorAll('#sheet select.dock-pick')[3]; s.value = 'tab:apps'; s.dispatchEvent(new Event('change')); return true; })()`);
  await A.ev(`[...document.querySelectorAll('#sheet button')].find((b) => b.textContent === 'Save').click(); true`);
  ok(await A.until(`[...document.querySelectorAll('#appDock .dock-app')].map((b) => b.dataset.go).join() === 'tab:day,tool:chat,tab:contacts,tab:apps'`), 'the fourth is now Apps & Integrations');

  // Widgets: pick which show.
  await A.ev(`document.querySelector('#homeBtn').click(); true`);
  await A.until(`!document.querySelector('#home').classList.contains('hidden')`);
  ok(await A.until(`!!document.querySelector('#home .home-card.today')`), 'Today is a widget');
  await A.ev(`document.querySelector('#home .widgets-edit').click(); true`);
  ok(await A.until(`!!document.querySelector('#sheet .widget-row[data-w=today]')`), 'Edit widgets lists them');
  await A.ev(`(() => { const i = document.querySelector('#sheet .widget-row[data-w=today] input'); i.checked = false; i.dispatchEvent(new Event('change')); return true; })()`);
  await A.ev(`[...document.querySelectorAll('#sheet button')].find((b) => b.textContent === 'Save').click(); true`);
  ok(await A.until(`!document.querySelector('#home .home-card.today')`), 'hiding Today takes it off Home');
  await A.ev(`location.reload(); true`).catch(() => {});
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && document.querySelectorAll('#home .home-grid > .home-card').length >= 3`, 15000) && !(await A.ev(`!!document.querySelector('#home .home-card.today')`)) && await A.ev(`document.querySelector('#appDock [data-go="tab:apps"]') !== null`), 'the dock and widgets stay as Ada left them');

  // Typing: the dock steps aside for the keyboard.
  await A.ev(`document.querySelector('#appDock [data-go="tab:contacts"]').click(); true`);
  const field = `[...document.querySelectorAll('input[type=search], input:not([type]), input[type=text], textarea')].find((e) => e.getBoundingClientRect().width > 0)`;
  await A.until(`!!${field}`);
  await A.ev(`${field}.focus(); true`);
  ok(await A.until(`!${vis('#appDock')}`), 'while typing, the dock hides');
  await A.ev(`document.activeElement.blur(); true`);
  ok(await A.until(vis('#appDock')), 'and comes back after');

  // Settings from the gear.
  await A.ev(`document.querySelector('#gearBtn').click(); true`);
  ok(await A.until(`!document.querySelector('#settings').classList.contains('hidden')`), 'the gear opens Settings');
  await A.shot('phone-settings');

  // A docked column (a mouse): arrows to step through widgets.
  await A.cmd('Emulation.setTouchEmulationEnabled', { enabled: false });
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: false });
  await A.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'hover' }, { name: 'pointer', value: 'fine' }] });
  await A.ev(`document.querySelector('#homeBtn')?.click(); true`);
  ok(await A.until(`document.body.classList.contains('column') && ${vis('#home .home-next')}`), 'in a docked column, arrows step through the widgets');
  await A.shot('column-home');

  // Full size: unchanged.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  ok(await A.until(`document.body.classList.contains('wide') && !${vis('#appDock')} && ${vis('#side')} && !${vis('#gearBtn')}`), 'full size keeps its sidebar, no dock');
  ok(await A.ev(`getComputedStyle(document.querySelector('#home .home-grid')).display === 'grid'`), 'and Home’s cards in a grid');
  ok(!A.errors.length, 'no errors in the page: ' + A.errors.join(' | '));
} catch (e) {
  ok(false, 'threw: ' + (e.stack || e.message));
} finally {
  A?.close(); chrome.kill(); srv.kill();
  if (fails) console.log(srv.log.slice(-1500));
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
}
