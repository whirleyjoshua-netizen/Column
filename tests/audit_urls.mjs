// Audit (docs/audit/FINDINGS.md H3): addresses never carry the sign-in itself. A file link carries the sign-in's file
// key, which only reads files, exports and live updates (never changes anything, never reads the rest of the app),
// and stops working when the sign-in ends; signing out also clears what the browser cached.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_urls';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4930, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) };
};
const sock = (q) => new Promise((r) => { const s = new WebSocket(`ws://127.0.0.1:${PORT}/ws?t=${q}`); s.on('open', () => { s.close(); r(true); }); s.on('error', () => r(false)); s.on('unexpected-response', () => r(false)); });
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Urls ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const tok = r.body.token, jo = call(tok);
  const up = await (await fetch(`${B}/api/upload?name=quote.txt`, { method: 'PUT', headers: { authorization: 'Bearer ' + tok }, body: 'six windows' })).json();
  const key = (await jo('GET', '/state')).body.me.fileKey;
  ok(typeof key === 'string' && key.length >= 24 && key !== tok, 'H3 the app gets a file key, not the sign-in');
  ok((await jo('GET', '/state')).body.me.fileKey === key, 'H3 the same key each time for this sign-in');

  // What the key does.
  r = await fetch(`${B}/api/files/${up.id}?t=${encodeURIComponent(key)}`);
  ok(r.status === 200 && (await r.text()) === 'six windows', 'H3 a file link with the key opens the file');
  ok(await sock(encodeURIComponent(key)), 'H3 the live connection opens with the key');
  // What it doesn't.
  ok((await fetch(`${B}/api/state?t=${encodeURIComponent(key)}`)).status === 401, 'H3 the key doesn’t read the rest of the app');
  ok((await fetch(`${B}/api/tasks?t=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x' }) })).status === 401, 'H3 nor change anything');
  ok((await fetch(`${B}/api/files/${up.id}?t=${encodeURIComponent(key)}`, { method: 'DELETE' })).status === 401, 'H3 nor delete a file');
  // The sign-in itself never works in an address.
  ok((await fetch(`${B}/api/files/${up.id}?t=${encodeURIComponent(tok)}`)).status === 401, 'H3 the sign-in in an address doesn’t open a file');
  ok(!(await sock(encodeURIComponent(tok))), 'H3 nor the live connection');
  ok((await fetch(`${B}/api/state?t=${encodeURIComponent(tok)}`)).status === 401, 'H3 nor anything else');
  // Headers still work as always.
  ok((await fetch(`${B}/api/files/${up.id}`, { headers: { authorization: 'Bearer ' + tok } })).status === 200, 'H3 the sign-in in a header still opens it');

  // After a restart the key still works (it's kept with the sign-in).
  const stop = new Promise((r2) => srv.on('exit', r2));
  srv.kill();
  await stop;
  const srv2 = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
  try {
    ok((await fetch(`${B}/api/files/${up.id}?t=${encodeURIComponent(key)}`)).status === 200, 'H3 after a restart, the key still opens the file');
    // Signing out: the key stops working, and the browser is told to clear its cache.
    r = await jo('POST', '/logout');
    ok(r.status === 200 && /"cache"/.test(r.headers.get('clear-site-data') || ''), 'H3 signing out tells the browser to clear what it cached');
    ok((await fetch(`${B}/api/files/${up.id}?t=${encodeURIComponent(key)}`)).status === 401, 'H3 and the file key stops working');
  } finally {
    srv2.kill();
  }
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
