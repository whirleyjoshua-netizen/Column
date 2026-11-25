// Chat is a main tab again (the owner, 2026-11-25: "move chat to the main left tab. and i still want it to be able to be
// open in the split screen through tools like it currently functions"): the sidebar's Chat opens Chat as the page;
// Tools → Chat still opens it in the split beside whatever page is showing. One #chat, so the two hand it over.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/chat_tab_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5671, CDP = 9671, APP = `http://127.0.0.1:${PORT}/`;
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
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Talk ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');
  ok(await A.ev(`[...document.querySelectorAll('#tabs > button[data-tab]:not(.tab-sub)')].map((b) => b.dataset.tab).join() === 'home,chat,agents,work,apps'`), 'the sidebar: Home, Chat, Agents, Workspace, Apps & Integrations');

  // The sidebar's Chat: the page.
  const page = `(() => { const c = document.querySelector('#chat'); return !!c && !c.classList.contains('hidden') && !document.querySelector('#split').contains(c) && document.querySelector('#main').contains(c); })()`;
  await A.tap(`document.querySelector('#tabs [data-tab=chat]')`);
  ok(await A.until(page), 'the sidebar’s Chat opens Chat as the page');
  ok(await A.ev(`document.querySelector('#split').classList.contains('hidden') && document.querySelector('#home').classList.contains('hidden') && !!document.querySelector('#chat .ch-side')`), 'not in the split; Home goes; feeds list and all');
  ok(await A.ev(`document.querySelector('#tabs [data-tab=chat]').classList.contains('on') && !document.querySelector('#tabs [data-tab=home]').classList.contains('on')`), 'Chat is lit in the sidebar');
  await A.tap(`document.querySelector('#chat textarea')`);
  await A.ev(`(() => { const ta = document.querySelector('#chat textarea'); ta.value = 'Hello from the page'; ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await A.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await A.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  let said = false;
  for (let i = 0; i < 40 && !said; i++) { said = (await api('GET', '/state')).items.some((it) => it.type === 'message' && it.text === 'Hello from the page'); if (!said) await sleep(150); }
  ok(said, 'a message sent from the Chat page');

  // The browser's Back from the Chat page goes to the page before (Home).
  await A.ev(`history.back(); true`);
  ok(await A.until(`!document.querySelector('#home').classList.contains('hidden') && document.querySelector('#chat').classList.contains('hidden')`), 'Back from the Chat page goes Home');

  // Tools → Chat: still the split, beside the page.
  await A.ev(`document.querySelector('#tabs [data-tab=tools]').click(); true`);
  await A.tap(`document.querySelector('#menu [data-tool=chat]')`);
  ok(await A.until(`!!document.querySelector('#split.chat-split:not(.hidden) #chat:not(.hidden)') && !document.querySelector('#home').classList.contains('hidden')`), 'Tools → Chat opens it in the split, Home beside it');
  ok(await A.ev(`/Hello from the page/.test(document.querySelector('#split #chat').textContent)`), 'the same feed there');
  ok(await A.ev(`!document.querySelector('#tabs [data-tab=chat]').classList.contains('on')`), 'the sidebar’s Chat isn’t lit for the split (Home is the page)');

  // The sidebar's Chat with Chat in the split: it moves over to be the page, and the split closes.
  await A.tap(`document.querySelector('#tabs [data-tab=chat]')`);
  ok(await A.until(page + ` && document.querySelector('#split').classList.contains('hidden')`), 'the sidebar’s Chat while it’s in the split: it becomes the page, the split closes');

  // Tools → Chat while Chat is the page: it stays the page (one Chat), no empty page.
  await A.ev(`document.querySelector('#tabs [data-tab=tools]').click(); true`);
  await A.tap(`document.querySelector('#menu [data-tool=chat]')`);
  await sleep(300);
  ok(await A.ev(page), 'Tools → Chat while Chat is the page: it stays the page');

  // Another page: Chat goes away; another tool in the split beside the Chat page leaves the page alone.
  await A.ev(`document.querySelector('#tabs [data-tab=tools]').click(); true`);
  await A.tap(`document.querySelector('#menu [data-tool=inventory]')`);
  ok(await A.until(`document.querySelector('#split .split-title')?.textContent === 'Inventory'`) && await A.ev(page), 'Inventory in the split beside the Chat page');
  await A.tap(`document.querySelector('#split .split-close')`);
  ok(await A.until(`document.querySelector('#split').classList.contains('hidden')`) && await A.ev(page), 'closing the split leaves the Chat page');
  await A.tap(`document.querySelector('#tabs [data-tab=home]')`);
  ok(await A.until(`!document.querySelector('#home').classList.contains('hidden') && document.querySelector('#chat').classList.contains('hidden')`), 'Home: Chat goes away');

  // A link to a feed (a pin) from another page still opens it in the split.
  const ch = (await api('POST', '/channels', { name: 'crew' }))?.channels?.find?.((c) => c.name === 'crew') || (await api('GET', '/state')).workspace.channels.find((c) => c.name === 'crew');
  if (ch) {
    await api('PUT', '/account/pins', { pins: [{ go: 'chan:' + ch.id, label: 'crew' }] });
    await A.ev(`location.reload(); true`);
    await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000);
    await A.ev(`document.querySelector('.pins-btn')?.click(); true`);
    await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes('crew'))`, 5000);
    await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('crew'))?.click(); true`);
    ok(await A.until(`!!document.querySelector('#split #chat:not(.hidden)')`, 8000), 'a pinned feed from Home opens in the split, as before');
    // ...and on the Chat page, the same pin opens the feed right there.
    await A.tap(`document.querySelector('#tabs [data-tab=chat]')`);
    await A.until(page);
    await A.ev(`document.querySelector('.ch-side [data-view=chat], .ch-side button')?.click(); true`);
    await A.ev(`document.querySelector('.pins-btn')?.click(); true`);
    await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes('crew'))`, 5000);
    await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('crew'))?.click(); true`);
    ok(await A.until(page + ` && document.querySelector('#split').classList.contains('hidden')`, 5000), 'on the Chat page, a pinned feed opens right there');
  } else ok(false, '(setup) a feed called crew');

  // A member with Chat switched off has no Chat tab.
  await api('PATCH', '/workspace', { memberAccess: { chat: false } });
  const code = (await api('GET', '/state')).workspace.inviteCode;
  const m = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'join', workspace: 'Talk ' + t, code, name: 'Mo Lane', email: `mo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd2' }) })).json();
  if (m.token) {
    await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(m.token))}); location.reload(); true`);
    await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000);
    await sleep(500);
    ok(await A.ev(`!document.querySelector('#tabs [data-tab=chat]')`), 'a member with Chat off: no Chat tab');
  } else ok(false, '(setup) a member joins: ' + JSON.stringify(m).slice(0, 120));

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
