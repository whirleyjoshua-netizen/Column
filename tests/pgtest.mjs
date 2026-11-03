// Postgres storage: restarts, odd characters, shutdown mid-save, a second server taking over, and the database going away.
import fs from 'node:fs';
import net from 'node:net';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const URL0 = process.env.TEST_DATABASE_URL;
const DIR = S + '/dk/pgt';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

function server(port, url) {
  const p = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(port), DATA_DIR: DIR, DATABASE_URL: url }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.log = '';
  p.stdout.on('data', (d) => (p.log += d));
  p.stderr.on('data', (d) => (p.log += d));
  p.exited = new Promise((r) => p.on('exit', (code) => r(code)));
  p.base = `http://127.0.0.1:${port}/api`;
  return p;
}
async function up(p) {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(p.base + '/health')).ok) return true; } catch {} await sleep(200); }
  console.log(p.log);
  return false;
}
const stop = async (p) => { p.kill('SIGTERM'); return p.exited; };
const call = (p, tok) => async (m, path, body) => { const r = await fetch(p.base + path, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
const health = async (p) => (await fetch(p.base + '/health')).json();

// 1. A team and an item with characters Postgres won't take as they are
let s1 = server(4790, URL0);
ok(await up(s1), 'the server starts on Postgres');
ok((await health(s1)).data === 'postgres', 'health says it’s on Postgres');
const team = 'pgt' + Date.now();
const auth = await call(s1)('POST', '/auth', { mode: 'create', workspace: team, name: 'Jo', password: 'secret1', device: 'Laptop', deviceId: 'dev1' });
const tok = auth.token;
ok(!!tok, 'made a team');
const odd = await call(s1, tok)('POST', '/items', { type: 'text', text: 'before\u0000after \ud800 lone' });
await sleep(2500);
ok(!/Saving failed/.test(s1.log), 'a NUL and half a surrogate pair don’t break saving');

// 2. Restart: everything is still there
await stop(s1);
s1 = server(4790, URL0);
await up(s1);
let st = await call(s1, tok)('GET', '/state');
const back = st.items?.find((x) => x.id === odd.id);
ok(st.workspace?.name && back, 'after a restart the team, its sign-in and the item are all still there');
ok(back?.text === 'beforeafter � lone', 'the odd characters were cleaned up, the rest kept');

// 3. Shut down right after a change: it's saved on the way out
const quick = await call(s1, tok)('POST', '/items', { type: 'text', text: 'saved on the way out' });
const code = await stop(s1);
ok(code === 0, 'shutdown waits for the save and exits cleanly');
s1 = server(4790, URL0);
await up(s1);
st = await call(s1, tok)('GET', '/state');
ok(st.items.some((x) => x.id === quick.id), 'a change made just before shutdown survived');

// 4. A second server takes over: the first stops instead of writing over it
const s2 = server(4792, URL0);
ok(await up(s2), 'a second server starts and takes over');
await call(s1, tok)('POST', '/items', { type: 'text', text: 'from the replaced server' });
const c1 = await Promise.race([s1.exited, sleep(8000).then(() => 'running')]);
ok(c1 === 1 && /taken over/.test(s1.log), 'the replaced server stops at its next save');
st = await call(s2, tok)('GET', '/state');
ok(st.items.some((x) => x.id === quick.id) && !st.items.some((x) => x.text === 'from the replaced server'), 'the new server has the saved data and nothing from the replaced one');
await stop(s2);

// 5. The database goes away for a while: changes wait in memory and are saved when it's back
const u = new globalThis.URL(URL0);
const ep = u.hostname.split('.')[0];
let socks = new Set();
let proxy;
const startProxy = () => new Promise((r) => {
  proxy = net.createServer((c) => {
    const d = net.connect(5432, u.hostname);
    socks.add(c); socks.add(d);
    c.pipe(d); d.pipe(c);
    const end = () => { c.destroy(); d.destroy(); };
    c.on('error', end); d.on('error', end); c.on('close', end); d.on('close', end);
  }).listen(4793, r);
});
const stopProxy = () => new Promise((r) => { for (const s of socks) s.destroy(); socks = new Set(); proxy.close(() => r()); });
await startProxy();
const viaProxy = `postgresql://${u.username}:${u.password}@127.0.0.1:4793${u.pathname}?sslmode=no-verify&options=endpoint%3D${ep}`;
let s3 = server(4794, viaProxy);
ok(await up(s3), 'a server starts through the stand-in network');
const tok3 = (await call(s3)('POST', '/auth', { mode: 'signin', workspace: team, name: 'Jo', password: 'secret1', device: 'Laptop', deviceId: 'dev1' })).token || tok;
await stopProxy();
const during = await call(s3, tok3)('POST', '/items', { type: 'text', text: 'made while the database was away' });
ok(!!during.id, 'Column keeps working while the database is away');
let retrying = false;
for (let i = 0; i < 40 && !retrying; i++) { await sleep(250); retrying = (await health(s3)).saving === 'retrying'; }
ok(retrying, 'health shows saving is retrying');
await startProxy();
let fine = false;
for (let i = 0; i < 80 && !fine; i++) { await sleep(500); fine = (await health(s3)).saving === 'ok'; }
ok(fine && /Saving works again/.test(s3.log), 'when the database is back, saving catches up by itself');
await stop(s3);
s3 = server(4794, viaProxy);
await up(s3);
st = await call(s3, tok3)('GET', '/state');
ok(st.items.some((x) => x.id === during.id), 'the change made while it was away was saved');

// 6. Deleting removes the row
await call(s3, tok3)('DELETE', '/items/' + during.id);
await stop(s3);
s3 = server(4794, viaProxy);
await up(s3);
st = await call(s3, tok3)('GET', '/state');
ok(!st.items.some((x) => x.id === during.id), 'a deleted item stays deleted after a restart');
await stop(s3);
await stopProxy();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
