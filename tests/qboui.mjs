// Settings → Connections in a browser: the QuickBooks section (connect, then connected with its counts), and the
// new-webhook sheet's event groups. Its own server, stand-in Intuit and Chrome, so nothing else is touched.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/qboui';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4746, APP = `http://127.0.0.1:${PORT}/`, F_PORT = 4748, F = `http://127.0.0.1:${F_PORT}`, CDP = 9451;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

const fake = http.createServer(async (req, res) => {
  for await (const _ of req);
  const u = new URL(req.url, F);
  res.setHeader('content-type', 'application/json');
  if (u.pathname === '/token') return res.end(JSON.stringify({ access_token: 'at1', refresh_token: 'rt1', expires_in: 3600 }));
  if (u.pathname.endsWith('/companyinfo/R1')) return res.end(JSON.stringify({ CompanyInfo: { CompanyName: 'Blinds & Co' } }));
  if (u.pathname.endsWith('/query') || u.pathname.endsWith('/cdc')) return res.end(JSON.stringify({ QueryResponse: {} }));
  res.end('{}');
});
await new Promise((r) => fake.listen(F_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '',
  QBO_CLIENT_ID: 'cid', QBO_CLIENT_SECRET: 'cs', QBO_API: F, QBO_AUTH_URL: F + '/connect', QBO_TOKEN_URL: F + '/token', QBO_REVOKE_URL: F + '/revoke' }, stdio: 'ignore' });
for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
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
  const until = async (expr, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  return { ev, until, errors, close: () => ws.close() };
}
try {
  const A = await tab(APP);
  await A.until(`!!document.querySelector('#loginLinks a')`);
  const team = 'qu' + Date.now();
  await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; if (f.email) f.email.value = 'jo${team}@t.test'; f.requestSubmit(); })()`);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo signed in');
  const tok = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
  const openConn = async () => {
    await A.ev(`document.querySelector('#settingsBtn').click()`);
    await A.until(`!!document.querySelector('#settings [role=tab]')`);
    await A.ev(`[...document.querySelectorAll('#settings [role=tab]')].find((x) => /Connections/.test(x.textContent)).click()`);
  };
  await openConn();
  ok(await A.until(`!!document.querySelector('#settings .qbo-sec h3') && /Connect QuickBooks/.test(document.querySelector('#settings .qbo-sec').textContent)`), 'Connections shows QuickBooks with a Connect button');
  ok(!(await A.ev(`document.querySelector('#settings .qbo-sec').textContent.includes('null')`)), 'no stray “null” in it');

  // Connected (through the stand-in Intuit), the section says so live.
  const { url } = await api('POST', '/quickbooks/connect');
  const st = new URL(url).searchParams.get('state');
  await fetch(`${APP}oauth/quickbooks/callback?code=x&state=${st}&realmId=R1`);
  ok(await A.until(`/Connected to Blinds & Co/.test(document.querySelector('#settings .qbo-sec')?.textContent || '')`), 'the section shows it’s connected to Blinds & Co, without reloading');
  ok(await A.ev(`[...document.querySelectorAll('#settings .qbo-sec button')].map((b) => b.textContent).join('|')`) === 'Sync now|Copy earlier ones too|Disconnect', 'with Sync now, Copy earlier ones too and Disconnect');
  ok(!(await A.ev(`document.querySelector('#settings .qbo-sec').textContent.includes('null')`)), 'still no stray “null”');

  // The new-webhook sheet.
  await A.ev(`[...document.querySelectorAll('#settings .int-sec button')].find((b) => /New webhook/.test(b.textContent)).click()`);
  ok(await A.until(`document.querySelectorAll('.int-events > div').length === 7`), 'a new webhook offers seven groups of events');
  ok(await A.ev(`[...document.querySelectorAll('.int-events b')].map((b) => b.textContent).join('|')`) === 'Contacts|Tasks|Visits|Invoices|Files & signatures|Text messages|Projects records', 'Contacts, Tasks, Visits, Invoices, Files & signatures, Text messages, Projects records');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click()`);
  ok(await A.until(`/Connect Twilio/.test(document.querySelector('#settings .tw-sec')?.textContent || '')`), 'Connections has Text messages (Twilio) with Connect Twilio');
  ok(await A.until(`/Lead form/.test(document.querySelector('#settings .lead-sec')?.textContent || '') && !!document.querySelector('#settings .lead-sec button')`), 'and Lead form & lead webhook, with Turn on');
  ok(!A.errors.length, 'no errors on the page' + (A.errors.length ? ': ' + A.errors[0] : ''));
  A.close();
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  chrome.kill();
  srv.kill();
  fake.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
