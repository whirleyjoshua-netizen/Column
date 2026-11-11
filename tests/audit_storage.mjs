// Audit (files, docs/audit/FINDINGS.md): D2, storage has limits. A file over the size limit is refused (while it's
// arriving, not after); a team can't store more than its total; resumable uploads can't go past the size they started
// with; file-request links follow the team's limit. Run with tiny limits (1 MB per file and per team).
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_storage';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4908, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', MAX_FILE_MB: '1', TEAM_STORAGE_MB: '1', DISK_RESERVE_MB: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const KB = 1024;
const filesOnDisk = () => fs.readdirSync(DIR + '/files').filter((f) => !f.startsWith('.')).length;
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Store ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const tok = r.body.token, jo = call(tok);
  const put = (name, bytes) => fetch(`${B}/api/upload?name=${name}`, { method: 'PUT', headers: { authorization: 'Bearer ' + tok }, body: Buffer.alloc(bytes, 97) });

  r = await put('big.bin', 1200 * KB);
  ok(r.status === 413 && /too big/.test((await r.json()).error), 'D2 a file over the size limit is refused');
  const before = filesOnDisk();
  r = await put('a.bin', 600 * KB);
  ok(r.status === 200, 'D2 (setup) a 600 KB file fits');
  r = await put('b.bin', 600 * KB);
  ok(r.status === 413 && /full/.test((await r.json()).error), 'D2 a second one is refused: the team’s files are full');
  ok(filesOnDisk() === before + 1, 'D2 and nothing refused is left on the disk');

  // Resumable uploads.
  r = await jo('POST', '/uploads', { size: 5000 * KB, name: 'huge.bin' });
  ok(r.status === 413, 'D2 a resumable upload bigger than the limit can’t start');
  await jo('DELETE', '/items/' + (await jo('GET', '/state')).body.items.find((x) => x.name === 'a.bin').id);
  r = await jo('POST', '/uploads', { size: 100 * KB, name: 'small.bin' });
  const up = r.body.id;
  r = await fetch(`${B}/api/uploads/${up}?offset=0`, { method: 'PUT', headers: { authorization: 'Bearer ' + tok }, body: Buffer.alloc(400 * KB, 98) });
  ok(r.status === 400, 'D2 a chunk can’t go past the size the upload started with');
  ok(fs.statSync(`${DIR}/files/.part-${up}`).size === 0, 'D2 and what came in past it isn’t kept');

  // File-request links follow the team's limit.
  const st = (await jo('GET', '/state')).body.workspace.stacks;
  let stackId = st[0]?.id;
  if (!stackId) { await jo('POST', '/stacks', { name: 'In' }); stackId = (await jo('GET', '/state')).body.workspace.stacks[0].id; }
  await jo('POST', `/stacks/${stackId}/request`, { note: 'send photos' });
  const link = (await jo('GET', '/state')).body.workspace.stacks.find((x) => x.id === stackId)?.request?.token;
  if (link) {
    r = await fetch(`${B}/api/public/request/${link}/file?name=x.bin&from=A`, { method: 'PUT', body: Buffer.alloc(1000 * KB, 99) });
    ok(r.status === 413, 'D2 a file-request link can’t take more than the team has room for (1000 KB on top of the 100 KB being uploaded)');
  } else ok(false, 'D2 (setup) made a file-request link: ' + JSON.stringify(r.body).slice(0, 200));
  await sleep(300);
  ok((await fetch(B + '/api/health')).ok, 'the server is fine after all that');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails && process.env.SHOWLOG) console.log(srv.log.slice(-2000));
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
