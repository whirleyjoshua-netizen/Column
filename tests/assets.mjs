// Equipment & assets: a project for gear that moves between sites. Its items have a number, a status, where they are
// (a location: an address and the spot, every move on the timeline), the job they're at (a record in another
// project the team can see), and a locked field for a lock combo or code: sealed on the server, never in a record,
// a list, the API, a webhook or an export, shown only to those allowed, every look on the timeline, and limited.
// Each item has a label: a QR code for /a/<tag>, which opens the item in Kloomie for those on the team who can see it.
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/assets';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4856, B = `http://127.0.0.1:${PORT}`;
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
const COMBO = '4-1-7-9-Q';
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Guard ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ricoTok = r.body.token;
  const rico = call(ricoTok);
  const code = (await rico('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Guard ' + t, code, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Olga', email: `olga${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const olga = call(r.body.token);

  // The project.
  r = await rico('POST', '/projects', { template: 'assets', name: 'Cameras' });
  const p = r.body;
  const T = p.types?.[0];
  const F = (k) => T.fields.find((f) => f.key === k);
  ok(r.status === 200 && p.template === 'assets' && T.scan === true && F('number')?.type === 'autonumber' && F('location')?.type === 'location' && F('job')?.type === 'job' && F('combo')?.type === 'secret' && F('combo').reveal === 'team' && F('status').choices[0].label === 'At the yard',
    'an Equipment & assets project: items with a number, status, location, job and a locked combo field');

  // An item, with its combo and where it is.
  r = await rico('POST', `/projects/${p.id}/records`, { typeId: T.id, values: { [F('name').id]: 'Tower 7', [F('combo').id]: COMBO, [F('location').id]: { address: 'Yard, 12 Main St', lat: 36.17, lng: -115.14 }, tag: 'MINE123456' } });
  const tower = r.body;
  ok(r.status === 200 && tower.values[F('number').id] === 'A-101' && tower.values[F('status').id] === F('status').choices[0].id, 'a new item gets its number (A-101) and starts at the yard');
  ok(!JSON.stringify(tower).includes(COMBO) && tower.values[F('combo').id]?.set === true && !('secrets' in tower), 'the combo isn’t in the record that comes back, only that one is set');
  ok(/^[A-Za-z0-9]{10}$/.test(tower.tag || '') && tower.tag !== 'MINE123456', 'it gets a label tag of its own (one sent in is ignored)');
  ok(tower.values[F('location').id].address === 'Yard, 12 Main St' && tower.values[F('location').id].lat === 36.17 && Number.isFinite(tower.values[F('location').id].at), 'where it is: the address, the spot and when');
  await sleep(600);
  const onDisk = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => fs.readFileSync(DIR + '/' + f, 'utf8')).join('');
  ok(onDisk.includes('Tower 7') && !onDisk.includes(COMBO), 'the combo isn’t stored in plain text');
  r = await rico('GET', `/projects/${p.id}/records`);
  ok(r.status === 200 && !JSON.stringify(r.body).includes(COMBO) && !JSON.stringify(r.body).includes('"secrets"'), 'nor in the project’s list of records');
  r = await rico('GET', `/records/${tower.id}/log`);
  ok(!JSON.stringify(r.body).includes(COMBO), 'nor on its timeline');

  // Seeing the combo.
  r = await rico('POST', `/records/${tower.id}/reveal/${F('combo').id}`);
  ok(r.status === 200 && r.body.value === COMBO, 'the owner sees the combo when asking for it');
  r = await sam('POST', `/records/${tower.id}/reveal/${F('combo').id}`);
  ok(r.status === 200 && r.body.value === COMBO, 'a member sees it too (the field is open to the team)');
  r = await rico('GET', `/records/${tower.id}/log`);
  const looks = r.body.filter((e) => e.kind === 'reveal');
  ok(looks.length === 2 && looks.some((e) => e.by === 'Sam Reed') && looks[0].what === 'Lock combo' && !JSON.stringify(looks).includes(COMBO), 'every look is on the timeline: who and when, never the combo');
  r = await sam('POST', `/projects/${p.id}/schema`, { op: 'updateField', typeId: T.id, fieldId: F('combo').id, reveal: 'managers' });
  ok(r.status === 403, 'a member can’t change who sees the combo');
  r = await rico('POST', `/projects/${p.id}/schema`, { op: 'updateField', typeId: T.id, fieldId: F('combo').id, reveal: 'managers' });
  ok(r.status === 200 && r.body.project.types[0].fields.find((f) => f.key === 'combo').reveal === 'managers', 'the owner keeps it to those who manage the project');
  r = await sam('POST', `/records/${tower.id}/reveal/${F('combo').id}`);
  ok(r.status === 403, 'then a member can’t see it');
  r = await olga('POST', `/records/${tower.id}/reveal/${F('combo').id}`);
  ok(r.status === 404, 'nobody from another team can');
  let last = null;
  for (let i = 0; i < 40; i++) { last = await rico('POST', `/records/${tower.id}/reveal/${F('combo').id}`); if (last.status !== 200) break; }
  ok(last.status === 429, 'looks are limited (30 an hour per person)');

  // Moving it.
  r = await sam('PATCH', `/records/${tower.id}`, { values: { [F('location').id]: { address: '1200 Warm Springs Rd, Henderson', lat: 36.03, lng: -115.06 } } });
  ok(r.status === 200 && r.body.values[F('location').id].address === '1200 Warm Springs Rd, Henderson', 'Sam moves it to Henderson');
  r = await rico('GET', `/records/${tower.id}/log`);
  const mv = r.body.find((e) => e.kind === 'move');
  ok(mv && mv.from === 'Yard, 12 Main St' && mv.to === '1200 Warm Springs Rd, Henderson' && mv.by === 'Sam Reed' && mv.lat === 36.03 && mv.lng === -115.06, 'the move is on its timeline: from, to, who, and the spot');
  r = await sam('PATCH', `/records/${tower.id}`, { values: { [F('location').id]: { address: 'Nowhere', lat: 999, lng: 0 } } });
  ok(r.status === 400, 'a spot that isn’t on Earth is refused');
  r = await sam('PATCH', `/records/${tower.id}`, { values: { [F('location').id]: 'Shop, 5 Oak Ave' } });
  ok(r.status === 200 && r.body.values[F('location').id].address === 'Shop, 5 Oak Ave' && r.body.values[F('location').id].lat === undefined, 'a location can be just an address');
  r = await sam('PATCH', `/records/${tower.id}`, { values: { [F('combo').id]: { set: true } } });
  ok(r.status === 200 && (await rico('GET', `/records/${tower.id}/log`)).body.filter((e) => e.field === 'Lock combo' && e.kind === 'change').length === 0, 'sending back the "set" marker leaves the combo alone');

  // The job it's at.
  r = await rico('POST', '/projects', { template: 'team', name: 'Sites' });
  const sites = r.body;
  const ST = sites.types[0];
  const smith = (await rico('POST', `/projects/${sites.id}/records`, { typeId: ST.id, values: { [ST.primary]: 'Smith build, Henderson' } })).body;
  r = await sam('PATCH', `/records/${tower.id}`, { values: { [F('job').id]: smith.id } });
  ok(r.status === 200 && r.body.values[F('job').id] === smith.id && r.body.jobs?.[smith.id]?.name === 'Smith build, Henderson' && r.body.jobs[smith.id].project === 'Sites', 'assigned to the Smith job (another project), with the job’s name');
  r = await rico('GET', `/records/${tower.id}/log`);
  ok(r.body.some((e) => e.field === 'Job it’s at' && e.to === 'Smith build, Henderson'), 'the assignment is on its timeline');
  const hidden = (await rico('POST', '/projects', { template: 'blank', name: 'Secret site', private: true })).body;
  const hrec = (await rico('POST', `/projects/${hidden.id}/records`, { typeId: hidden.types[0].id, values: { [hidden.types[0].primary]: 'Private job' } })).body;
  r = await rico('PATCH', `/records/${tower.id}`, { values: { [F('job').id]: hrec.id } });
  ok(r.status === 400, 'a job in a private project can’t be used (everyone who sees the item would see its name)');
  const olgaP = (await olga('POST', '/projects', { template: 'blank', name: 'Theirs' })).body;
  const orec = (await olga('POST', `/projects/${olgaP.id}/records`, { typeId: olgaP.types[0].id, values: { [olgaP.types[0].primary]: 'Their job' } })).body;
  r = await rico('PATCH', `/records/${tower.id}`, { values: { [F('job').id]: orec.id } });
  ok(r.status === 400, 'nor another team’s job');
  r = await rico('PATCH', `/records/${tower.id}`, { values: { [F('job').id]: tower.id } });
  ok(r.status === 400, 'nor the item itself');
  await rico('DELETE', `/records/${smith.id}`);
  r = await rico('GET', `/projects/${p.id}/records`);
  ok(r.body.find((x) => x.id === tower.id).values[F('job').id] === undefined, 'when the job is deleted, the item isn’t at it any more');

  // Scanning a label.
  r = await sam('POST', `/records/by-tag/${tower.tag}`);
  ok(r.status === 200 && r.body.id === tower.id && r.body.projectId === p.id, 'scanning its label finds the item');
  r = await rico('GET', `/projects/${p.id}/records`);
  const seen = r.body.find((x) => x.id === tower.id);
  ok(seen.seenAt > t && seen.seenBy === 'Sam Reed', 'and it’s marked seen: when and by whom');
  ok((await olga('POST', `/records/by-tag/${tower.tag}`)).status === 404, 'someone on another team gets nothing');
  ok((await call()('POST', `/records/by-tag/${tower.tag}`)).status === 401, 'nor does someone signed out');
  ok((await sam('POST', '/records/by-tag/nope')).status === 404, 'an unknown tag finds nothing');
  let res = await fetch(`${B}/a/${tower.tag}`, { redirect: 'manual' });
  ok(res.status === 302 && res.headers.get('location') === `/?go=asset:${tower.tag}` && res.headers.get('referrer-policy') === 'no-referrer', 'the label’s address opens Kloomie at the item');
  res = await fetch(`${B}/a/AAAAAAAAAA`, { redirect: 'manual' });
  ok(res.status === 302, 'an unknown tag looks the same from outside (nothing to learn by guessing)');
  res = await fetch(`${B}/a/<script>`, { redirect: 'manual' });
  ok(res.status === 404, 'a tag that can’t be one is turned away');

  // Labels to print.
  const second = (await rico('POST', `/projects/${p.id}/records`, { typeId: T.id, values: { [F('name').id]: 'Generator 2' } })).body;
  r = await rico('GET', `/projects/${p.id}/labels?typeId=${T.id}`);
  ok(r.status === 200 && r.body.labels.length === 2 && r.body.labels.every((x) => x.url === `${B}/a/${x.tag}` && x.qr.startsWith('data:image/svg+xml;base64,')) && r.body.labels.find((x) => x.id === second.id)?.number === 'A-102', 'a sheet of labels: a QR code, the address and the number for each item');
  ok((await olga('GET', `/projects/${p.id}/labels?typeId=${T.id}`)).status === 404, 'another team can’t print them');
  r = await rico('POST', `/records/${second.id}/tag`);
  ok(r.status === 200 && r.body.tag && r.body.tag !== second.tag, 'a new label can be made (the old one stops working)');
  ok((await rico('POST', `/records/by-tag/${second.tag}`)).status === 404, 'the old label finds nothing');

  // A private assets project.
  r = await rico('PATCH', `/projects/${p.id}`, { private: true, memberIds: [] });
  ok((await sam('POST', `/records/by-tag/${tower.tag}`)).status === 404 && (await sam('POST', `/records/${tower.id}/reveal/${F('combo').id}`)).status === 404, 'when the project is private, someone not in it finds nothing by scanning and can’t see the combo');
  await rico('PATCH', `/projects/${p.id}`, { private: false });

  // Outside: the API and exports.
  const key = (await rico('POST', '/integrations/keys', { name: 'zap' })).body;
  res = await fetch(`${B}/api/v1/projects/${p.id}/assets/records`, { headers: { authorization: 'Bearer ' + key.token } });
  const api = await res.json();
  const out = api.records?.find((x) => x.id === tower.id);
  ok(res.status === 200 && out && out.fields.combo?.set === true && !JSON.stringify(api).includes(COMBO) && out.fields.location.address === 'Shop, 5 Oak Ave', 'the API says a combo is set, never what it is');
  r = await rico('POST', '/exports', { kind: 'team' });
  let ex = null;
  for (let i = 0; i < 60 && !ex; i++) { ex = (await rico('GET', '/exports')).body.exports.find((y) => y.kind === 'team' && y.status !== 'building'); if (!ex) await sleep(250); }
  res = await fetch(`${B}/api/exports/${ex?.id}/file`, { headers: { authorization: 'Bearer ' + ricoTok } });
  const zip = DIR + '/team.zip';
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  const data = execFileSync('unzip', ['-p', zip, 'data.json']).toString();
  const sealed = JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8')).records[tower.id]?.secrets?.[F('combo').id];
  ok(ex?.status === 'ready' && data.includes('Tower 7') && sealed && !data.includes(sealed) && !data.includes(COMBO), 'a team export has the items but not the combo, not even sealed');

  // Clearing it, and removing the field.
  r = await rico('PATCH', `/records/${tower.id}`, { values: { [F('combo').id]: null } });
  ok(r.status === 200 && r.body.values[F('combo').id] === undefined, 'the combo can be cleared');
  ok((await rico('POST', `/records/${second.id}/reveal/${F('combo').id}`)).status === 404, 'an item with no combo has nothing to show');
  await rico('PATCH', `/records/${second.id}`, { values: { [F('combo').id]: 'ZZ-9' } });
  await rico('POST', `/projects/${p.id}/schema`, { op: 'removeField', typeId: T.id, fieldId: F('combo').id });
  await sleep(600);
  const db2 = JSON.parse(fs.readFileSync(DIR + '/db.json', 'utf8'));
  ok(!db2.records[second.id].secrets?.[F('combo').id], 'removing the field removes the combos in it');
} catch (e) {
  console.log('FAIL threw: ' + (e.stack || e));
  fails++;
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.split('\n').slice(-30).join('\n'));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
