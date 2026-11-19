// Two-step sign-in in a browser: Settings → Account → Turn on (QR code and key, a code from the "app", backup codes),
// then signing out and back in, where the code field shows up after the password. Own server and Chrome.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { totp } from '../server/twostep.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/twostepui';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4750, APP = `http://127.0.0.1:${PORT}/`, CDP = 9452;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '' }, stdio: 'ignore' });
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
const step = () => Math.floor(Date.now() / 30_000);
try {
  const A = await tab(APP);
  await A.until(`!!document.querySelector('#loginLinks a')`);
  const team = 'ts' + Date.now(), email = `jo${team}@t.test`;
  await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; f.email.value = '${email}'; f.requestSubmit(); })()`);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo made a team and is in');
  await A.ev(`document.querySelector('#settingsBtn').click()`);
  await A.until(`!!document.querySelector('#settings .setx-item[data-page=profile]')`);
  await A.ev(`document.querySelector('#settings .setx-item[data-page=profile]').click()`);
  ok(await A.until(`/Turn on/.test(document.querySelector('#settings .ts2-sec')?.textContent || '')`), 'Settings → Account has Two-step sign-in with Turn on');
  // Two-step needs a confirmed email (the code that was emailed) and the password.
  const outbox = DIR + '/outbox';
  const code = fs.readdirSync(outbox).sort().map((f) => JSON.parse(fs.readFileSync(outbox + '/' + f, 'utf8'))).filter((x) => x.to === email).at(-1).text.match(/\b(\d{6})\b/)[1];
  await A.ev(`fetch('/api/account/verify', { method: 'POST', headers: { authorization: 'Bearer ' + JSON.parse(localStorage.getItem('column.token')), 'content-type': 'application/json' }, body: JSON.stringify({ code: '${code}' }) })`);
  await A.ev(`[...document.querySelectorAll('#settings .ts2-sec button')].find((b) => b.textContent === 'Turn on').click()`);
  ok(await A.until(`!!document.querySelector('#sheet:not(.hidden) input[type=password]')`), 'turning it on asks for the password first');
  await A.ev(`(() => { const i = document.querySelector('#sheet input[type=password]'); i.value = 'secret1pad'; document.querySelector('#sheet .primary-btn').click(); })()`);
  ok(await A.until(`document.querySelector('#sheet:not(.hidden) img.ts2-qr')?.naturalWidth > 100`), 'a QR code to scan');
  const secret = (await A.ev(`document.querySelector('#sheet .ts2-key').textContent`)).replace(/\s/g, '');
  ok(/^[A-Z2-7]{32}$/.test(secret), 'and the key to type in by hand');
  const scanned = await A.ev(`(async () => { if (!('BarcodeDetector' in window)) return 'skip'; const img = document.querySelector('#sheet img.ts2-qr'); const c = document.createElement('canvas'); c.width = c.height = 420; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 420, 420); const r = await new BarcodeDetector({ formats: ['qr_code'] }).detect(c); return r[0]?.rawValue || 'none'; })()`);
  ok(scanned === 'skip' || (scanned.startsWith('otpauth://totp/Kloomie:') && scanned.includes('secret=' + secret)), 'the QR code scans to the authenticator link with that key' + (scanned === 'skip' ? ' (no barcode reader in this browser, skipped)' : ''));
  await A.ev(`(() => { const i = document.querySelector('#sheet input[autocomplete=one-time-code]'); i.value = '${totp(secret, step())}'; document.querySelector('#sheet .primary-btn').click(); })()`);
  ok(await A.until(`(document.querySelector('#sheet:not(.hidden) .ts2-codes')?.textContent.trim().split(/\\s+/).length) === 10`), 'the right code turns it on and shows 10 backup codes');
  await A.ev(`document.querySelector('#sheet .primary-btn').click()`);
  ok(await A.until(`/On since/.test(document.querySelector('#settings .ts2-sec')?.textContent || '')`), 'Settings now says it’s on');
  // Signing out and back in.
  await A.ev(`(() => { localStorage.clear(); location.reload(); })()`);
  await A.until(`!!document.querySelector('#loginLinks a')`);
  await A.ev(`(() => { const f = document.querySelector('#loginForm'); f.email.value = '${email}'; f.password.value = 'secret1pad'; f.requestSubmit(); })()`);
  ok(await A.until(`!document.querySelector('#otpField').classList.contains('hidden') && /code/.test(document.querySelector('#loginErr').textContent)`), 'after the password, it asks for the code');
  await A.ev(`(() => { const f = document.querySelector('#loginForm'); f.otp.value = '000000'; f.requestSubmit(); })()`);
  ok(await A.until(`/isn’t right/.test(document.querySelector('#loginErr').textContent)`), 'a wrong code says so');
  await A.ev(`(() => { const f = document.querySelector('#loginForm'); f.otp.value = '${totp(secret, step() + 1)}'; f.requestSubmit(); })()`);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'the right code signs in');
  ok(!A.errors.length, 'no errors on the page' + (A.errors.length ? ': ' + A.errors[0] : ''));
  A.close();
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  chrome.kill();
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
