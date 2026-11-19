// Archiving a project (2026-11-19): it leaves the Projects list but nothing in it is lost; it can be opened and
// restored. Whoever made it and team owners and admins can. "Move into Inventory" archives the Equipment & assets
// list it came from, so there's one place for the gear.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/projects_archive';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5223, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Arch ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Arch ' + t, code: st.workspace.inviteCode, name: 'Mo Lane', email: `mo${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const mo = call(r.body.token);
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const p = (await rico('POST', '/projects', { template: 'assets' })).body;
  const tp = p.types[0];
  const rec = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { name: 'Tower 7' } })).body;

  ok((await mo('PATCH', '/projects/' + p.id, { archived: true })).status === 403, 'a member who didn’t make it can’t archive it');
  r = await rico('PATCH', '/projects/' + p.id, { archived: true });
  ok(r.status === 200 && r.body.archived === true && r.body.archivedAt > 0 && r.body.archivedBy === 'Rico Vega', 'archived, with when and by whom');
  st = (await rico('GET', '/state')).body;
  ok(st.projects.find((x) => x.id === p.id)?.archived === true, 'still there (archived), not deleted');
  ok((await rico('GET', `/projects/${p.id}/records`)).body.some((x) => x.id === rec.id), 'its records are all still there');
  r = await rico('PATCH', '/projects/' + p.id, { archived: false });
  ok(r.status === 200 && !r.body.archived && !r.body.archivedAt, 'restored');
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
