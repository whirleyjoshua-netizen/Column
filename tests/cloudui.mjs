// Files from cloud storage, in a browser: with a Dropbox app key set, the + menu offers From Dropbox; the picker (a
// stand-in for Dropbox's script, served through Chrome's request interception) hands back a file, and the browser
// downloads it and uploads it into the team's files. Pickers that aren't set up aren't offered or allowed to load.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/cloudui';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4755, APP = `http://127.0.0.1:${PORT}/`, F_PORT = 4756, CDP = 9453;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

// Where the "Dropbox" file lives (Dropbox's direct links allow downloads from web pages, like this).
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(40_000, 120), Buffer.from('\n%%EOF\n')]);
const files = http.createServer((req, res) => {
  res.writeHead(req.url === '/plans.pdf' ? 200 : 404, { 'Content-Type': 'application/pdf', 'Access-Control-Allow-Origin': '*' });
  res.end(req.url === '/plans.pdf' ? PDF : '');
});
await new Promise((r) => files.listen(F_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', DROPBOX_APP_KEY: 'testappkey', GOOGLE_PICKER_API_KEY: '', ONEDRIVE_CLIENT_ID: '' }, stdio: 'ignore' });
for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map(); const errors = []; const seen = [];
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    // Dropbox's picker script, stood in for: it picks plans.pdf.
    if (m.method === 'Fetch.requestPaused') {
      seen.push(m.params.request.url);
      const body = `window.Dropbox = { choose(o) { setTimeout(() => o.success([{ link: 'http://127.0.0.1:${F_PORT}/plans.pdf', name: 'plans.pdf', bytes: ${PDF.length} }]), 50); } };`;
      cmd('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }], body: Buffer.from(body).toString('base64') });
    }
  });
  await cmd('Runtime.enable');
  await cmd('Fetch.enable', { patterns: [{ urlPattern: '*dropbox.com/static/api/2/dropins.js*' }] });
  await cmd('Page.navigate', { url });
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  return { ev, until, errors, seen, close: () => ws.close() };
}
try {
  const csp = (await fetch(APP)).headers.get('content-security-policy') || '';
  ok(csp.includes('https://www.dropbox.com') && !csp.includes('apis.google.com') && !csp.includes('js.live.net'), 'the page lets in Dropbox’s picker (set up) but not Google’s or OneDrive’s (not set up)');
  const A = await tab(APP);
  await A.until(`!!document.querySelector('#loginLinks a')`);
  const team = 'cl' + Date.now();
  await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; f.email.value = 'jo${team}@t.test'; f.requestSubmit(); })()`);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo is in');
  const tok = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
  const st = await (await fetch(APP + 'api/state', { headers: { authorization: 'Bearer ' + tok } })).json();
  ok(st.cloud?.dropbox === 'testappkey' && !st.cloud.google && !st.cloud.onedrive, 'the app is told which pickers are set up');
  await A.ev(`(document.querySelector('#tabs [data-tab=tools]').click(), document.querySelector('#tool [data-tool=column]'))?.click()`);
  ok(await A.until(`!!document.querySelector('.composer .add')`), 'Stacks has its + button');
  await A.ev(`[...document.querySelectorAll('.composer .add')].find((b) => b.offsetParent).click()`);
  ok(await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === 'From Dropbox…')`), 'the + menu offers From Dropbox…');
  ok(!(await A.ev(`[...document.querySelectorAll('#menu button')].some((b) => /Google Drive|OneDrive/.test(b.textContent))`)), 'and not Google Drive or OneDrive, which aren’t set up');
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'From Dropbox…').click()`);
  let landed = null;
  for (let i = 0; i < 80 && !landed; i++) {
    const s2 = await (await fetch(APP + 'api/state', { headers: { authorization: 'Bearer ' + tok } })).json();
    landed = s2.items.find((x) => x.name === 'plans.pdf');
    if (!landed) await sleep(150);
  }
  ok(landed && landed.size === PDF.length, 'the picked file is downloaded and lands in the team’s files, every byte');
  ok(A.seen.some((u) => u.includes('dropins.js')), 'Dropbox’s picker script was asked for (with the app key)');
  ok(!A.errors.length, 'no errors on the page' + (A.errors.length ? ': ' + A.errors[0] : ''));
  A.close();
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  chrome.kill();
  srv.kill();
  files.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
