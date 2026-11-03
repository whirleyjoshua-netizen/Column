// Exports: owners export the team, anyone exports their own things; nothing secret or someone else's private goes in.
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
const S = process.argv[2];
const DIR = S + '/dk/exp';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4785, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', APP_NAME: 'Kloomie' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body, raw) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { ...(raw ? {} : { 'content-type': 'application/json' }), ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: raw ? body : body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const mails = () => { const o = DIR + '/outbox'; return fs.existsSync(o) ? fs.readdirSync(o).sort().map((f) => JSON.parse(fs.readFileSync(o + '/' + f, 'utf8'))) : []; };
const t = Date.now();
const PW = 'longenough1';
const auth = async (body) => (await call()('POST', '/auth', { password: PW, device: 'Mac', deviceId: 'd' + Math.random(), ...body })).body;
const a = await auth({ mode: 'create', workspace: 'Expo ' + t, name: 'Jo', email: `jo${t}@t.test` });
const J = call(a.token);
const code = (await J('GET', '/state')).body.workspace.inviteCode;
const k = await auth({ mode: 'join', workspace: 'Expo ' + t, code, name: 'Ken', email: `ken${t}@t.test` });
const K = call(k.token);

// Jo's things, shared and personal
const doc = (await J('POST', '/items', { type: 'text', text: 'JO-SHARED-DOC about pricing' })).body;
const share = (await J('POST', `/items/${doc.id}/share`, {})).body.share;
const ws1 = (await J('POST', '/stacks', { name: 'Smith job' })).body;
const stack = ws1.stacks.find((x) => x.name === 'Smith job');
const file = (await J('PUT', `/upload?name=plans.txt&type=text/plain&stackId=${stack.id}`, Buffer.from('JO-FILE-BYTES the plans'), true)).body;
await J('POST', '/tasks', { text: '=HYPERLINK("http://evil.test","click") JO-TASK' });
await J('POST', '/money', { kind: 'out', amount: 40, category: 'Fuel', note: 'JO-PERSONAL-MONEY', day: '2026-11-03' });
await J('POST', '/money', { kind: 'in', amount: 900, category: 'Sales', note: 'JO-BUSINESS-MONEY', day: '2026-11-03', scope: 'business' });
// Ken's things
await K('POST', '/items', { type: 'text', text: 'KEN-SHARED-DOC' });
const kdir = (await K('POST', '/dirs', { name: 'Ken private', private: true })).body;
await K('POST', '/items', { type: 'text', text: 'KEN-PRIVATE-DOC', dirId: kdir.id });
await K('POST', '/money', { kind: 'out', amount: 12, category: 'Lunch', note: 'KEN-PERSONAL-MONEY', day: '2026-11-03' });
await K('POST', '/entries', { text: 'KEN-DAY-ENTRY', date: '2026-11-03' });

let r = await K('POST', '/exports', { kind: 'team' });
ok(r.status === 403, 'a member can’t export the whole team');
const waitReady = async (C, kind) => {
  for (let i = 0; i < 60; i++) {
    const x = (await C('GET', '/exports')).body.exports.find((y) => y.kind === kind);
    if (x && x.status !== 'building') return x;
    await sleep(250);
  }
};
r = await J('POST', '/exports', { kind: 'team' });
ok(r.status === 200 && r.body.exports[0].status === 'building', 'the owner starts a team export');
const ex = await waitReady(J, 'team');
ok(ex?.status === 'ready' && ex.size > 100, 'it’s ready a moment later: ' + JSON.stringify(ex));
await sleep(300);
ok(mails().some((m) => m.to === `jo${t}@t.test` && /export of Expo .* is ready/.test(m.subject)), 'she gets an email saying it’s ready');

const get = async (tok, id) => fetch(`${B}/api/exports/${id}/file${tok ? '?t=' + encodeURIComponent(tok) : ''}`);
let res = await get(null, ex.id);
ok(res.status === 401, 'downloading needs a sign-in');
res = await get(k.token, ex.id);
ok(res.status === 404, 'someone else can’t download her export');
res = await get(a.token, ex.id);
ok(res.status === 200 && /attachment/.test(res.headers.get('content-disposition')) && /Kloomie export - Expo/.test(decodeURIComponent(res.headers.get('content-disposition'))), 'she downloads it, named “Kloomie export - Expo …zip”');
const zipPath = DIR + '/team.zip';
fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
const list = execFileSync('unzip', ['-Z1', zipPath]).toString().trim().split('\n');
const read = (name) => execFileSync('unzip', ['-p', zipPath, name]).toString();
const raw = fs.readFileSync(zipPath).toString('latin1') + list.map(read).join('\n');
ok(execFileSync('unzip', ['-tq', zipPath]).toString().includes('No errors'), 'the .zip opens cleanly');
ok(list.includes('README.txt') && list.includes('data.json'), 'it has a README and the full data');
ok(list.some((n) => n.startsWith('docs/') && read(n).includes('JO-SHARED-DOC')), 'docs come as Markdown files');
ok(read('files/Smith job/plans.txt') === 'JO-FILE-BYTES the plans', 'uploaded files are there, in their stack, byte for byte');
const tasks = read('sheets/Tasks.csv');
ok(tasks.includes('JO-TASK') && tasks.includes(`"'=HYPERLINK(`), 'tasks are a spreadsheet, and a formula is defused');
ok(read('sheets/Money.csv').includes('900.00'), 'money is in dollars');
const data = JSON.parse(read('data.json'));
ok(data.team.members.length === 2 && !('salt' in data.team.members[0]), 'the team and its people, without passwords');
for (const mark of ['JO-PERSONAL-MONEY', 'JO-BUSINESS-MONEY', 'KEN-SHARED-DOC']) ok(raw.includes(mark), `${mark} is in it`);
for (const mark of ['KEN-PRIVATE-DOC', 'KEN-PERSONAL-MONEY', 'KEN-DAY-ENTRY']) ok(!raw.includes(mark), `${mark} (Ken’s private) isn’t`);
ok(!raw.includes(a.token) && !raw.includes(k.token) && !raw.includes(share.token) && !raw.includes(code), 'no sign-in keys, share links or invite code');
const walk = (v, bad = []) => { if (v && typeof v === 'object') for (const [key, x] of Object.entries(v)) { if (['salt', 'hash', 'token', 'tokens', 'secret', 'sealed'].includes(key)) bad.push(key); walk(x, bad); } return bad; };
ok(walk(data).length === 0, 'no secret fields anywhere in the data');

// Ken's own export
r = await K('POST', '/exports', { kind: 'mine' });
const kx = await waitReady(K, 'mine');
ok(kx?.status === 'ready', 'Ken exports his own things');
fs.writeFileSync(DIR + '/ken.zip', Buffer.from(await (await get(k.token, kx.id)).arrayBuffer()));
const kraw = execFileSync('unzip', ['-p', DIR + '/ken.zip']).toString();
ok(['KEN-PRIVATE-DOC', 'KEN-PERSONAL-MONEY', 'KEN-DAY-ENTRY', 'KEN-SHARED-DOC'].every((m) => kraw.includes(m)), 'his has his private and shared things');
ok(!kraw.includes('JO-PERSONAL-MONEY') && !kraw.includes('JO-SHARED-DOC'), 'and nothing of Jo’s');

// Deleting, and the limit
r = await J('DELETE', '/exports/' + ex.id);
await sleep(300);
ok(r.status === 200 && !fs.existsSync(`${DIR}/files/export-${ex.id}.zip`), 'deleting an export removes the file');
let limited = false;
for (let i = 0; i < 8 && !limited; i++) { const y = await J('POST', '/exports', { kind: 'team' }); limited = y.status === 429; if (y.status === 409) await sleep(300); else await waitReady(J, 'team'); }
ok(limited, 'five exports a day at most');
// Leaving takes your exports with you
const kFile = `${DIR}/files/export-${kx.id}.zip`;
ok(fs.existsSync(kFile), '(Ken’s export is on disk)');
await K('POST', '/account/leave', { password: PW });
await sleep(300);
ok(!fs.existsSync(kFile), 'when Ken leaves, his export is deleted too');
srv.kill();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
