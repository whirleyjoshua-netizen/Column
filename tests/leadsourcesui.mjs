// Leads from websites, in a browser: the one-line snippet on someone's own web page copies a real form submission into
// Kloomie (their form still works; a login form and a form marked data-kloomie-ignore are left alone). Settings →
// Connections walks through connecting a tool (steps with the team's snippet filled in), Send a test lead shows in
// Recent leads with every field, and Match fields lists the names seen and saves a choice.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
// Apps & Integrations has the connections (out of Settings since 2026-11-20).
const appsOpen = async (A, id) => {
  await A.ev(`document.querySelector('#settings').classList.add('hidden'); document.querySelector('#tabs [data-tab=apps]').click(); true`);
  await A.until(`!!document.querySelector('#apps .apps-tabs')`);
  await A.ev(`[...document.querySelectorAll('#apps .apps-tabs button')].find((b) => b.textContent === ${JSON.stringify(id === 'dev' ? 'Developers' : id === 'tools' ? 'Tools' : 'Apps')}).click(); true`);
  if (id === 'dev' || id === 'tools') return;
  await A.until(`!!document.querySelector('#apps .app-tile[data-app="${id}"]')`);
  await A.ev(`document.querySelector('#apps .app-tile[data-app="${id}"]').click(); true`);
};
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/leadsourcesui';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4773, APP = `http://127.0.0.1:${PORT}/`, SITE_PORT = 4774, CDP = 9473;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
let snippetTag = '';
let siteGot = [];
// Someone's own website, on another address, with the snippet pasted in.
const site = http.createServer(async (req, res) => {
  if (req.method === 'POST') { let b = ''; for await (const c of req) b += c; siteGot.push(b); res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<p id="thanks">Thanks from the site</p>'); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><title>Blinds Co</title>
<form id="quote" method="post" action="/sent"><label for="n">Your name</label><input id="n" name="input_1" value="Gus Hale"><input name="email" value="gus@x.test"><input name="phone" value="702-555-0199">
<input name="cc_number" value="4111111111111111"><input type="hidden" name="csrf_token" value="abc"><textarea name="message">Two bay windows</textarea><button>Send</button></form>
<form id="login" method="post" action="/login"><input name="email" value="admin@x.test"><input type="password" name="pw" value="x"><button>Log in</button></form>
<form id="news" data-kloomie-ignore method="post" action="/news"><input name="email" value="news@x.test"><button>Join</button></form>
${snippetTag}`);
});
await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '' }, stdio: 'ignore' });
for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map(); const errors = [];
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  await cmd('Runtime.enable');
  await cmd('Page.navigate', { url });
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  return { ev, until, errors, cmd, close: () => ws.close() };
}
try {
  const A = await tab(APP);
  await A.until(`!!document.querySelector('#loginLinks a')`);
  const team = 'ls' + Date.now();
  await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; f.email.value = 'jo${team}@t.test'; f.requestSubmit(); })()`);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo is in');
  const tok = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();

  // Apps & Integrations → Developers → turn on, pick a tool.
  await appsOpen(A, 'dev');
  ok(await A.until(`!!document.querySelector('.lead-sec') && [...document.querySelectorAll('.lead-sec button')].some((b) => b.textContent === 'Turn on')`), 'Settings → Connections has Leads from websites, funnels & forms');
  await A.ev(`[...document.querySelectorAll('.lead-sec button')].find((b) => b.textContent === 'Turn on').click()`);
  ok(await A.until(`!!document.querySelector('.lead-sec select[aria-label="Connect a website or tool"]')`), 'turned on, it asks which website or tool to connect');
  await A.ev(`(() => { const s = document.querySelector('.lead-sec select[aria-label="Connect a website or tool"]'); s.value = 'wordpress'; s.dispatchEvent(new Event('change')); })()`);
  ok(await A.until(`document.querySelector('.lead-guide')?.innerText.includes('WPCode') && document.querySelector('.lead-guide code')?.textContent.includes('/k.js')`), 'choosing WordPress shows its steps with the team’s snippet filled in');
  await A.ev(`(() => { const s = document.querySelector('.lead-sec select[aria-label="Connect a website or tool"]'); s.value = 'highlevel'; s.dispatchEvent(new Event('change')); })()`);
  ok(await A.until(`document.querySelector('.lead-guide')?.innerText.includes('Form Submitted') && document.querySelector('.lead-guide code')?.textContent.includes('/hooks/lead/')`), 'GoHighLevel shows workflow steps with the webhook address');
  snippetTag = (await api('GET', '/lead-capture')).snippet;

  // The snippet on the site.
  const W = await tab(`http://127.0.0.1:${SITE_PORT}/`);
  await W.until(`!!document.querySelector('#quote') && !!document.querySelector('script[data-key]')`);
  await sleep(300);
  await W.ev(`document.querySelector('#login').requestSubmit()`);
  await sleep(500);
  await W.cmd('Page.navigate', { url: `http://127.0.0.1:${SITE_PORT}/` });
  await W.until(`!!document.querySelector('#news')`);
  await sleep(300);
  await W.ev(`document.querySelector('#news').requestSubmit()`);
  await sleep(500);
  await W.cmd('Page.navigate', { url: `http://127.0.0.1:${SITE_PORT}/` });
  await W.until(`!!document.querySelector('#quote')`);
  await sleep(300);
  await W.ev(`document.querySelector('#quote').requestSubmit()`);
  ok(await W.until(`!!document.querySelector('#thanks')`), 'the site’s own form still works as before');
  let gus = null;
  for (let i = 0; i < 60 && !gus; i++) { gus = (await api('GET', '/contacts')).contacts.find((x) => x.email === 'gus@x.test'); if (!gus) await sleep(150); }
  ok(gus?.name === 'Gus Hale' && gus.phone === '702-555-0199' && /Two bay windows/.test(gus.note) && gus.source === 'Website (127.0.0.1:4774)', 'and the snippet copied it into Kloomie: the name from its label, phone, message, and the site as the source');
  ok(!/4111|abc/.test(JSON.stringify(gus)), 'the card number and hidden token weren’t sent');
  const all = (await api('GET', '/contacts')).contacts;
  ok(!all.some((x) => x.email === 'admin@x.test') && !all.some((x) => x.email === 'news@x.test'), 'a login form and a form marked data-kloomie-ignore were left alone');
  ok(!W.errors.length, 'no errors on the site');
  W.close();

  // Recent leads and the test.
  await appsOpen(A, 'dev');
  await A.until(`!!document.querySelector('.lead-log')`);
  ok(await A.until(`[...document.querySelectorAll('.lead-entry')].some((e) => e.innerText.includes('Gus Hale') && e.innerText.includes('Website'))`), 'Recent leads shows Gus, from the website');
  await A.ev(`[...document.querySelectorAll('.lead-sec button')].find((b) => b.textContent === 'Send a test lead').click()`);
  ok(await A.until(`document.querySelector('.lead-entry')?.innerText.includes('Test, not saved')`), 'Send a test lead shows at the top, not saved');
  await A.ev(`document.querySelector('.lead-entry .lead-head').click()`);
  ok(await A.until(`!document.querySelector('.lead-entry .lead-fields').classList.contains('hidden') && document.querySelector('.lead-entry .lead-fields').innerText.includes('test.lead@example.com')`), 'opening it shows every field and where it went');

  // Match fields.
  ok(await A.ev(`[...document.querySelectorAll('.lead-map-row')].some((r) => r.innerText.includes('Your name'))`), 'Match fields lists the field names seen');
  await A.ev(`(() => { const r = [...document.querySelectorAll('.lead-map-row')].find((r) => r.querySelector('b').textContent === 'message'); const s = r.querySelector('select'); s.value = 'ignore'; })()`);
  await A.ev(`[...document.querySelectorAll('.lead-sec button')].find((b) => b.textContent === 'Save matches').click()`);
  let saved = null;
  for (let i = 0; i < 40 && !saved; i++) { const lc = await api('GET', '/lead-capture'); if (lc.map?.message === 'ignore') saved = lc; else await sleep(150); }
  ok(saved, 'choosing where a field goes is saved');
  await A.until(`!!document.querySelector('.lead-sec h4')`); await A.ev(`[...document.querySelectorAll('.lead-sec h4')][1].scrollIntoView()`); await sleep(300);
  const shot = await A.cmd('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(DIR + '/settings.png', Buffer.from(shot.result.data, 'base64'));
  ok(!A.errors.length, 'no errors in Kloomie' + (A.errors.length ? ': ' + A.errors[0] : ''));
  A.close();
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  chrome.kill();
  srv.kill();
  site.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
