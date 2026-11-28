// The app's shell in a real browser (headless Chrome), as the owner asked on 2026-11-12: a side toolbar instead of
// tabs across the top, and always white.
// - 900px and wider: a sidebar with labels that opens what you pick, folds to icons (remembered on this device),
//   and stays put while Settings, a tool or a full-screen view (a doc, Jobs) fills the page beside it.
// - A docked column (340px) and a phone (2026-11-19): ☰ opens a menu page of app icons, four apps in a dock at the
//   bottom, pins on the menu page; the toolbar stays hidden and can't be tabbed into.
// - White everywhere, even on a computer set to dark mode; nothing spills off a phone's screen.
import { CHROME, SERVER_DIR } from './chromebin.mjs';
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/shell_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4967, CDP = 9528, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1280,820', 'about:blank'], { stdio: 'ignore' });
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
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const tap = async (expr) => {
    await until(`!!(${expr})`, 8000);
    const [x, y] = await ev(`(() => { const e = ${expr}; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(250);
  };
  const swipe = async (x0, x1, y = 400) => {
    await cmd('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= 6; i++) { await cmd('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / 6, y }] }); await sleep(16); }
    await cmd('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(350);
  };
  return { ev, until, tap, swipe, cmd, errors };
}
// How light a colour is, 0 (black) to 1 (white).
const LIGHT = `(c) => { const m = c.match(/[\\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; }`;
const rect = (sel) => `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) }; })()`;
const shown = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); return getComputedStyle(e).visibility !== 'hidden' && r.width > 0 && r.right > 0 && r.left < innerWidth; })()`;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Shell ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  await fetch(APP + 'api/account/bar', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: JSON.stringify({ bar: ['column', 'chat', 'camps', 'docs'] }) });
  const A = await tab(APP);
  // A computer set to dark mode: Kloomie stays white.
  await A.cmd('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await A.until(`document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && document.querySelectorAll('#tabs [data-tab]').length >= 6`, 20000), 'signed in');
  const colors = await A.ev(`(() => { const L = ${LIGHT}; const c = (s) => L(getComputedStyle(document.querySelector(s)).backgroundColor); return { body: c('body'), side: c('#side'), bar: c('#main > .bar'), card: c('#home .home-card'), text: L(getComputedStyle(document.body).color), scheme: getComputedStyle(document.documentElement).colorScheme, meta: document.querySelector('meta[name=theme-color]').content }; })()`);
  ok(colors.body > 0.9 && colors.side > 0.9 && colors.bar > 0.9 && colors.card > 0.9 && colors.text < 0.2, `white, with dark writing, even with the computer in dark mode (${JSON.stringify(colors)})`);
  ok(colors.scheme === 'light' && colors.meta === '#f6f6f8', 'the page tells the browser it’s light (form controls and scrollbars too)');

  // Wide: a sidebar with labels.
  const side = await A.ev(rect('#side'));
  ok(side.l === 0 && side.w >= 220 && side.w <= 240, `a sidebar on the left when there’s room (${JSON.stringify(side)})`);
  ok(!(await A.ev(shown('#menuBtn'))) && (await A.ev(`document.body.classList.contains('wide')`)), 'no ☰ when the sidebar is there');
  const labels = await A.ev(`[...document.querySelectorAll('#tabs [data-tab]:not(.tab-sub)')].map((b) => b.textContent)`);
  ok(JSON.stringify(labels) === JSON.stringify(['Home', 'Chat', 'Agents', 'Workspace', 'Apps & Integrations']), `Home, Chat, Agents, Workspace and Apps & Integrations (Tasks is in Workspace), by name, whatever tabs were saved before (${labels})`);
  ok(await A.ev(`[...document.querySelectorAll('#tabs [data-tab]')].every((b) => b.querySelector('.tab-ic svg'))`), 'each with an icon');
  ok(await A.ev(shown('#settingsBtn')) && !(await A.ev(`!!document.querySelector('#toolsBtn, #tabs .tabs-edit')`)), 'Settings is in it (All tools and pins are in Workspace now, 2026-11-16)');
  await A.ev(`document.querySelector('#tabs [data-tab=tools]').click(); true`); await A.tap(`document.querySelector('#menu [data-tool=chat]')`);
  ok(await A.until(`!document.querySelector('#chat').classList.contains('hidden') && !!document.querySelector('#split.chat-split #chat')`), 'Chat in Tools: picking it opens it in the split');
  // Settings fills the page beside the sidebar.
  await A.tap(`document.querySelector('#settingsBtn')`);
  ok(await A.until(`!document.querySelector('#settings').classList.contains('hidden')`), 'Settings opens');
  const set = await A.ev(rect('#settings'));
  ok(set.l >= side.r - 1 && (await A.ev(shown('#side'))), `beside the sidebar, which stays (${JSON.stringify(set)})`);
  await A.tap(`document.querySelector('#settingsBtn')`);
  // A full-screen view (a doc, Jobs) leaves the sidebar where it is.
  const dv = await A.ev(`(() => { const d = document.createElement('div'); d.className = 'docview'; document.body.append(d); const l = Math.round(d.getBoundingClientRect().left); d.remove(); return l; })()`);
  ok(dv >= side.r - 1, `a full-screen view starts beside the sidebar (${dv})`);
  // Previews, sheets and pop-ups cover the sidebar, never the other way round.
  const over = await A.ev(`(() => { const d = document.createElement('div'); d.className = 'preview'; d.style.cssText = 'display:block'; document.body.append(d); const e = document.elementFromPoint(100, 60); const r = d.contains(e) || e === d; d.remove(); return r; })()`);
  ok(over, 'a preview covers the sidebar');
  // Fold it to icons; this device remembers.
  await A.tap(`document.querySelector('#sideFold')`);
  ok(await A.until(`document.querySelector('#side').getBoundingClientRect().width <= 64`), 'it folds to icons');
  ok(await A.ev(`getComputedStyle(document.querySelector('#tabs [data-tab=agents] .tab-l')).display === 'none' && document.querySelector('#tabs [data-tab=agents]').title === 'Agents'`), 'folded, names show as tooltips');
  await A.ev(`location.reload(); true`);
  ok(await A.until(`document.querySelectorAll('#tabs [data-tab]').length >= 6 && document.querySelector('#side').getBoundingClientRect().width <= 64`, 20000), 'and stays folded after a reload');
  await A.tap(`document.querySelector('#sideFold')`);
  ok(await A.until(`document.querySelector('#side').getBoundingClientRect().width >= 220`), 'and opens again');

  // A docked column (2026-11-19, the owner: "like an iPhone"): no drawer. ☰ opens the menu page of app icons, four
  // apps sit in a dock at the bottom, and pins are on the menu page. mobile_shell_ui.mjs has the rest.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 340, height: 860, deviceScaleFactor: 1, mobile: false });
  ok(await A.until(`!document.body.classList.contains('wide')`), 'a 340px column isn’t wide');
  ok(await A.until(`!${shown('#side')}`, 2000) && !(await A.ev(shown('#menuBtn'))) && (await A.ev(shown('#appDock'))), 'the toolbar is hidden; the five places are on a rail (the redesign, 2026-11-28: no ☰)');
  await sleep(300);
  ok(await A.ev(`(() => { document.querySelector('#tabs [data-tab=agents]').focus(); return document.activeElement !== document.querySelector('#tabs [data-tab=agents]'); })()`), 'the hidden toolbar can’t be tabbed into');
  ok(await A.ev(`document.body.classList.contains('column')`) && !(await A.ev(shown('#topTabs'))), 'no row of tabs across the top');
  const authed = { 'content-type': 'application/json', authorization: 'Bearer ' + a.token };
  const camp = await (await fetch(APP + 'api/campaigns', { method: 'POST', headers: authed, body: JSON.stringify({ name: 'Spring push' }) })).json();
  const campId = camp.campaign?.id || camp.id;
  await fetch(APP + 'api/account/pins', { method: 'PUT', headers: authed, body: JSON.stringify({ pins: [{ go: 'camp:' + campId, label: 'Spring push' }] }) });
  await A.ev(`location.reload(); true`);
  await A.until(`!document.querySelector('#app').classList.contains('hidden')`, 20000);
  ok(!(await A.ev(shown('#topTabs'))), 'pinning something doesn’t bring the row back');
  await A.tap(`document.querySelector('#appDock [data-go="go:more"]')`);
  ok(await A.until(shown('#menuPage')) && !(await A.ev(shown('#side'))), 'More opens its page, not a drawer');
  ok(await A.ev(`!!document.querySelector('#menuPage [data-go="pin:camp:${campId}"]')`) || await A.ev(`[...document.querySelectorAll('#menuPage [data-go^="pin:"]')].length === 1`), 'the pin is in More');
  await A.ev(`document.querySelector('#menuPage [data-go^="pin:"]').scrollIntoView({ block: 'center' }); true`);
  await A.tap(`document.querySelector('#menuPage [data-go^="pin:"]')`);
  ok(await A.until(`!${shown('#menuPage')} && !document.querySelector('#campsWrap').classList.contains('hidden')`), 'tapping it opens the campaign');
  await A.tap(`document.querySelector('#appDock [data-go="go:more"]')`);
  await A.until(shown('#menuPage'));
  await A.ev(`document.querySelector('#menuPage [data-go="tool:column"]').scrollIntoView({ block: 'center' }); true`);
  await A.tap(`document.querySelector('#menuPage [data-go="tool:column"]')`);
  ok(await A.until(`!document.querySelector('#panes').classList.contains('hidden') && !!document.querySelector('#split #panes') && document.querySelector('#split .split-title').textContent === 'Stacks'`), 'Stacks from the menu opens it, in the split (the whole screen in a column)');
  await A.ev(`document.querySelector('#split .split-close').click(); true`);
  await A.tap(`document.querySelector('#appDock [data-go="go:more"]')`);
  await A.until(shown('#menuPage'));
  await A.ev(`document.querySelector('#menuPage [data-go="tab:docs"]').scrollIntoView({ block: 'center' }); true`);
  await A.tap(`document.querySelector('#menuPage [data-go="tab:docs"]')`);
  ok(await A.until(`!document.querySelector('#tool').classList.contains('hidden') && document.querySelector('#tool h2').textContent.startsWith('Folders & Docs')`) && !(await A.ev(shown('#menuPage'))), 'Folders & Docs opens from there');
  await A.ev(`document.querySelector('#tool .icon-btn')?.click(); true`);
  ok(await A.ev(`document.documentElement.scrollWidth <= innerWidth`), 'nothing spills sideways in a column');

  // A phone: the same, with touch; a swipe from the edge no longer pulls out a drawer.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await A.cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  ok(await A.until(`!document.body.classList.contains('column')`, 3000) && !(await A.ev(shown('#topTabs'))) && (await A.ev(shown('#appDock'))), 'a phone has the tab bar and no row across the top');
  await A.ev(`document.querySelector('#appDock [data-go="go:home"]').click(); true`);
  await A.swipe(4, 200);
  ok(!(await A.ev(shown('#side'))), 'a swipe in from the left edge leaves the page alone');
  ok(await A.ev(`document.documentElement.scrollWidth <= innerWidth`), 'nothing spills sideways on a phone');
  const tapH = await A.ev(`(() => { document.querySelector('#appDock [data-go="go:more"]').click(); const hs = [...document.querySelectorAll('#menuPage .more-row, #appDock .dock-app')].map((b) => b.getBoundingClientRect().height); return Math.min(...hs); })()`);
  ok(tapH >= 44, `More's rows and the tab bar are big enough to tap (${tapH}px)`);

  // The pages around the app are white too.
  for (const p of ['reset.html', 'request.html', 'sign.html']) {
    await A.ev(`location.href = ${JSON.stringify(APP + p)}; true`);
    await sleep(900);
    const bg = await A.ev(`(${LIGHT})(getComputedStyle(document.body).backgroundColor)`);
    ok(bg > 0.9, `${p} is white on a computer in dark mode (${bg?.toFixed?.(2)})`);
  }
  const page = await (await fetch(APP + 'api/oauth/nothing/callback')).text().catch(() => '');
  ok(!/background:#111/.test(page), 'a page the server makes isn’t dark');
  // And none of the app's own pages keeps a dark mode.
  const files = ['client/style.css', 'client/news.css', 'client/index.html', 'client/sign.html', 'client/request.html', 'client/reset.html', 'desktop/setup.html', 'server/index.js', 'server/oauthbind.js', 'server/quickbooks.js', 'server/postiz.js', 'server/dropbox.js', 'server/cards.js', 'server/invoices.js', 'server/projects.js', 'server/leads.js'];
  const dark = files.filter((f) => /prefers-color-scheme:\s*dark|color-scheme:\s*(light )?dark|background:#111;/.test(FS.readFileSync(new URL('../' + f, import.meta.url), 'utf8')));
  ok(!dark.length, `no dark mode left in the app’s pages (${dark.join(', ')})`);
  ok(!A.errors.length, 'no script errors: ' + A.errors.join(' | ').slice(0, 300));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
}
srv.kill();
chrome.kill();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
