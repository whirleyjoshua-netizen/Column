// Audit, in a real browser (docs/audit/FINDINGS.md): H9 a project's icon is shown as text, never as HTML; H10 an
// @mention inside a link's address leaves the link whole.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_ui7';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR + '/chrome', { recursive: true });
const PORT = 4926, CDP = 9341, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR + '/data', MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
for (let i = 0; i < 200; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
async function tab(url) {
  let t;
  for (let i = 0; i < 100 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map(); const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(150); } return false; };
  const tap = async (expr) => {
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(100);
  };
  const type = async (t) => { await cmd('Input.insertText', { text: t }); await sleep(60); };
  return { ev, until, tap, type, errors, close: () => ws.close() };
}
const t = Date.now();
try {
  const team = 'UI7 ' + t;
  const r0 = await call()('POST', '/auth', { mode: 'create', workspace: team, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd' + t });
  ok(!!r0.body?.token, `(setup) Jo makes a team (${r0.status})`);
  const jo = call(r0.body?.token);
  const A = await tab(B + '/');
  ok(await A.until(`!!document.querySelector('#loginForm')`), '(setup) the app loads');
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(r0.body?.token))}); location.reload(); true`);
  await sleep(500);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), '(setup) Jo is signed in in the browser');

  // H10: a link whose address has (@Jo) in it.
  const url = 'https://example.test/(@Jo)/page';
  await jo('POST', '/items', { type: 'message', text: 'see ' + url });
  ok(await A.until(`[...document.querySelectorAll('.bubble a')].some((a) => a.textContent.includes('example.test'))`), '(setup) the message with the link shows in the feed');
  const href = await A.ev(`[...document.querySelectorAll('.bubble a')].find((a) => a.textContent.includes('example.test'))?.getAttribute('href')`);
  ok(href === url, `H10 the link's address stays whole (${href})`);
  ok(await A.ev(`![...document.querySelectorAll('.bubble a')].some((a) => a.querySelector('.mention') || a.getAttribute('href')?.includes('<'))`), 'H10 no mention markup inside the link');

  // H3: a picture posted to the feed shows, from an address with the file key and never the sign-in.
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64');
  const upr = await fetch(`${B}/api/upload?name=site.png`, { method: 'PUT', headers: { authorization: 'Bearer ' + r0.body.token, 'content-type': 'image/png' }, body: PNG });
  ok(upr.ok, `(setup) a picture is posted (${upr.status})`);
  const pic = await upr.json();
  await A.ev(`location.href = '/?view=${pic.id}'; true`);
  await sleep(500);
  const shown = await A.until(`[...document.querySelectorAll('img')].some((i) => i.src.includes('/api/files/${pic.id}') && i.complete && i.naturalWidth === 8)`);
  ok(shown, 'H3 the picture opens and shows in the browser');
  const src = await A.ev(`[...document.querySelectorAll('img')].find((i) => i.src.includes('/api/files/'))?.src || ''`);
  ok(src && !src.includes(encodeURIComponent(r0.body.token)) && !src.includes(r0.body.token), 'H3 its address doesn’t carry the sign-in');
  ok(await A.ev(`(async () => { const s = [...document.querySelectorAll('img')].find((i) => i.src.includes('/api/files/')).src; return (await fetch(s)).ok; })()`), 'H3 and the file opens from that address');

  // H9: a project whose icon is a bit of HTML.
  const p = await jo('POST', '/projects', { template: 'trades', trades: ['hvac'], name: 'Iconproj', icon: '<b>X</b>' });
  ok(p.status === 200, `(setup) a project with an HTML icon (${p.status})`);
  await A.ev(`location.href = '/'; true`);
  await sleep(500);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=tools]')`), '(setup) the app reloads');
  await A.ev(`document.querySelector('#tabs [data-tab=tools]').click(); true`); await A.tap(`document.querySelector('#menu [data-tool=chat]')`);
  ok(await A.until(`[...document.querySelectorAll('.link-btn')].some((e) => e.offsetParent)`), '(setup) Chat has the link button');
  await A.tap(`[...document.querySelectorAll('.link-btn')].find((e) => e.offsetParent)`);
  ok(await A.until(`!!document.querySelector('.pk-q')`), '(setup) the link picker opens');
  await A.type('Iconproj');
  ok(await A.until(`[...document.querySelectorAll('.picker .pk-ic')].some((e) => e.closest('*:not(.pk-ic)')?.textContent.includes('Iconproj'))`), '(setup) the project shows in the picker');
  const ic = await A.ev(`(() => { const row = [...document.querySelectorAll('.picker .pk-ic')].find((e) => e.parentElement.textContent.includes('Iconproj')); return row ? { b: !!row.querySelector('b'), text: row.textContent } : null; })()`);
  ok(ic && !ic.b && ic.text === '<b>X</b>', `H9 the icon is shown as text, not drawn as HTML (${JSON.stringify(ic)})`);
  ok(!A.errors.length, 'no errors on the page' + (A.errors.length ? ': ' + A.errors[0] : ''));
  A.close();
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  chrome.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
