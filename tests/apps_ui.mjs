// Apps & Integrations (the owner, 2026-11-20): its own tab in the sidebar, out of Settings. Big tiles with the apps'
// logos, grouped by kind, a search, the apps you've connected first; each tile opens what it connects (the same
// sections Settings had). Apps Kloomie doesn't connect to yet say so, and point to Zapier and Make. Tools (which tools
// the team uses) is a tab of its own here, and the API, webhooks and lead forms are under Developers.
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/appsui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5242, APP = `http://127.0.0.1:${PORT}/`, CDP = 9581;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-appsui`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-appsui`, '--no-first-run', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
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
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Apps ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();

  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=work]')`, 15000), 'Ada is in');

  // Its own tab in the sidebar.
  ok(await A.until(`document.querySelector('#tabs [data-tab=apps]')?.textContent.includes('Apps & Integrations')`), 'Apps & Integrations is in the sidebar');
  await A.ev(`document.querySelector('#tabs [data-tab=apps]').click(); true`);
  ok(await A.until(`!document.querySelector('#apps').classList.contains('hidden') && document.querySelector('#apps h1')?.textContent.includes('Apps & Integrations')`), 'it opens as a page');
  ok(await A.ev(`document.querySelector('#tabs [data-tab=apps]').classList.contains('on')`), 'and its tab is on');
  ok(await A.ev(`[...document.querySelectorAll('#apps .apps-tabs button')].map((b) => b.textContent).join('|')`) === 'Apps|Tools|Developers', 'tabs: Apps, Tools, Developers');
  ok(await A.until(`document.querySelectorAll('#apps .app-tile').length >= 60`), 'a big directory of apps: ' + await A.ev(`document.querySelectorAll('#apps .app-tile').length`));
  ok(await A.ev(`['Email & calendar', 'Money & payments', 'Field service & trades', 'Marketing & social', 'AI'].every((c) => [...document.querySelectorAll('#apps .apps-cat h2')].some((h) => h.textContent.startsWith(c)))`), 'grouped by kind');
  ok(await A.until(`!!document.querySelector('#apps .app-tile[data-app=quickbooks] .app-logo svg path') && !!document.querySelector('#apps .app-tile[data-app=stripe] .app-logo svg')`), 'with the apps’ logos');
  ok(await A.ev(`document.querySelector('#apps .app-tile[data-app=slack] .app-logo.mono')?.textContent === 'S'`), 'a lettered tile where there’s no logo to use');
  ok(await A.ev(`(() => { const r = document.querySelector('#apps .app-tile').getBoundingClientRect(); return r.width >= 150 && r.height >= 120; })()`), 'tiles are big');
  ok(await A.ev(`getComputedStyle(document.querySelector('#apps .app-tile')).borderTopStyle === 'solid'`), 'each tile has a border');
  ok(await A.ev(`document.querySelector('#apps .app-tile[data-app=stripe]').textContent.includes('Connect') && document.querySelector('#apps .app-tile[data-app=quickbooks]').textContent.includes('Not set up here') && document.querySelector('#apps .app-tile[data-app=slack]').textContent.includes('Not built yet')`), 'each says where it stands: Connect, or Not built yet');

  // Search.
  await A.ev(`(() => { const q = document.querySelector('#apps .apps-q'); q.value = 'quick'; q.dispatchEvent(new Event('input')); return true; })()`);
  ok(await A.until(`[...document.querySelectorAll('#apps .app-tile')].map((x) => x.dataset.app).join() === 'quickbooks'`), 'search finds QuickBooks: ' + await A.ev(`[...document.querySelectorAll('#apps .app-tile')].map((x) => x.dataset.app).join()`));
  await A.ev(`(() => { const q = document.querySelector('#apps .apps-q'); q.value = ''; q.dispatchEvent(new Event('input')); return true; })()`);

  // A tile opens what it connects: the same section Settings had.
  await A.ev(`document.querySelector('#apps .app-tile[data-app=stripe]').click(); true`);
  ok(await A.until(`!!document.querySelector('#apps .app-detail .pay-sec') && document.querySelector('#apps .app-detail h1')?.textContent === 'Stripe'`), 'Stripe opens its connection');
  ok(await A.ev(`document.querySelectorAll('#apps .app-detail .app-does li').length >= 2`), 'and says what it does');
  await A.ev(`document.querySelector('#apps .app-back').click(); true`);
  ok(await A.until(`!document.querySelector('#apps .app-detail') && document.querySelectorAll('#apps .app-tile').length >= 60`), '‹ back to all apps');
  // Built but not switched on for this server (no QuickBooks keys here): it says so, instead of an empty box.
  await A.ev(`document.querySelector('#apps .app-tile[data-app=quickbooks]').click(); true`);
  ok(await A.until(`document.querySelector('#apps .app-detail')?.textContent.includes('isn’t switched on for this server yet')`), 'QuickBooks without its server keys says it isn’t switched on yet');
  await A.ev(`document.querySelector('#apps .app-back').click(); true`);
  await A.ev(`document.querySelector('#apps .app-tile[data-app=claude]').click(); true`);
  ok(await A.until(`!!document.querySelector('#apps .app-detail .ai-sec')`), 'Claude opens the AI keys');
  await A.ev(`document.querySelector('#apps .app-back').click(); true`);

  // Not built yet: says so, and points to Zapier.
  await A.ev(`document.querySelector('#apps .app-tile[data-app=slack]').click(); true`);
  ok(await A.until(`document.querySelector('#apps .app-detail')?.textContent.includes('isn’t built yet')`), 'Slack says Kloomie doesn’t connect to it yet');
  await A.ev(`document.querySelector('#apps .app-detail [data-go=zapier]').click(); true`);
  ok(await A.until(`document.querySelector('#apps .app-detail h1')?.textContent === 'Zapier' && !!document.querySelector('#apps .app-detail .int-sec')`), 'and its Zapier button opens Zapier, with the API keys');
  await A.ev(`document.querySelector('#apps .app-back').click(); true`);

  // Something connected shows at the top.
  ok(await A.ev(`!document.querySelector('#apps .apps-connected .app-tile[data-app=leads]')`), 'lead forms aren’t on yet');
  await api('PUT', '/lead-capture', { on: true });
  await A.ev(`document.querySelector('#tabs [data-tab=home]').click(); true`);
  await A.ev(`document.querySelector('#tabs [data-tab=apps]').click(); true`);
  ok(await A.until(`!!document.querySelector('#apps .apps-connected .app-tile[data-app=leads]') && document.querySelector('#apps .apps-connected').textContent.includes('1 connected')`), 'once on, lead forms are under Connected');

  // Tools.
  await A.ev(`[...document.querySelectorAll('#apps .apps-tabs button')].find((b) => b.textContent === 'Tools').click(); true`);
  ok(await A.until(`document.querySelectorAll('#apps .tool-tile').length >= 12 && !!document.querySelector('#apps .tool-tile[data-tool=news] input[type=checkbox]')`), 'Tools: a tile for each, with a switch');
  await A.ev(`(() => { const i = document.querySelector('#apps .tool-tile[data-tool=news] input'); i.checked = false; i.dispatchEvent(new Event('change')); return true; })()`);
  ok(await (async () => { for (let i = 0; i < 30; i++) { if ((await api('GET', '/state')).workspace.tools.news === false) return true; await sleep(100); } return false; })(), 'switching News off turns it off for the team');

  // Developers.
  await A.ev(`[...document.querySelectorAll('#apps .apps-tabs button')].find((b) => b.textContent === 'Developers').click(); true`);
  ok(await A.until(`!!document.querySelector('#apps .int-sec') && !!document.querySelector('#apps .lead-sec')`), 'Developers: API keys, webhooks and lead forms');

  // Out of Settings.
  await A.ev(`document.querySelector('#settingsBtn').click(); true`);
  ok(await A.until(`!document.querySelector('#settings').classList.contains('hidden')`), 'Settings opens');
  ok(await A.ev(`![...document.querySelectorAll('#settings .set-tabs button')].some((b) => b.textContent === 'Connections')`), 'Settings has no Connections tab');
  await A.ev(`[...document.querySelectorAll('#settings .set-tabs button')].find((b) => b.textContent === 'Team').click(); true`);
  ok(await A.until(`!!document.querySelector('#settings .apps-moved') && !document.querySelector('#settings .tools-sec')`), 'Team’s Tools moved out, with a pointer');
  await A.ev(`document.querySelector('#settings .apps-moved button').click(); true`);
  ok(await A.until(`document.querySelector('#settings').classList.contains('hidden') && !document.querySelector('#apps').classList.contains('hidden') && !!document.querySelector('#apps .tool-tile')`), 'which opens Apps & Integrations → Tools');

  // A phone: two tiles a row, nothing off the side.
  await A.ev(`[...document.querySelectorAll('#apps .apps-tabs button')].find((b) => b.textContent === 'Apps').click(); true`);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 2, mobile: true });
  ok(await A.until(`!document.body.classList.contains('wide')`), 'a phone');
  await sleep(300);
  ok(await A.ev(`(() => { const t = [...document.querySelectorAll('#apps .apps-cat .app-tile')].slice(0, 3).map((x) => x.getBoundingClientRect()); return t[0].top === t[1].top && t[2].top > t[0].top && document.querySelector('#apps').scrollWidth <= document.querySelector('#apps').clientWidth + 1; })()`), 'two tiles a row on a phone, and no sideways scroll');
  if (process.env.SHOTS) {
    await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    const r = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(process.env.SHOTS + '/apps.png', Buffer.from(r.result.data, 'base64'));
    await A.ev(`document.querySelector('#apps').scrollTop = 900; true`); await sleep(200);
    const r2 = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(process.env.SHOTS + '/apps2.png', Buffer.from(r2.result.data, 'base64'));
    await A.ev(`[...document.querySelectorAll('#apps .apps-tabs button')].find((b) => b.textContent === 'Tools').click(); true`); await sleep(300);
    const r3 = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(process.env.SHOTS + '/tools.png', Buffer.from(r3.result.data, 'base64'));
    await A.ev(`[...document.querySelectorAll('#apps .apps-tabs button')].find((b) => b.textContent === 'Apps').click(); document.querySelector('#apps .app-tile[data-app=quickbooks]').click(); true`); await sleep(500);
    const r4 = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(process.env.SHOTS + '/detail.png', Buffer.from(r4.result.data, 'base64'));
  }
  ok(!A.errors.length, 'no errors in the page: ' + A.errors.join(' | '));
} catch (e) {
  ok(false, 'threw: ' + e.message);
} finally {
  A?.close();
  chrome.kill();
  srv.kill();
}
if (fails) console.log(srv.log.slice(-1500));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
