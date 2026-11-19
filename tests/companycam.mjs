// CompanyCam (the integrations map, 2026-11-20), against a stand-in CompanyCam: an owner pastes a token; Kloomie checks
// it and registers its own signed webhook; CompanyCam projects match jobs by address (one clear match links, the rest
// wait to be picked); photos land in the job's Photos once each, and linking by hand brings the latest in. Deliveries
// must carry the right signature. Members see only that it's connected. Disconnecting deletes the webhook there.
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/companycam';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5340, CC_PORT = 5341, B = `http://127.0.0.1:${PORT}`, CCB = `http://127.0.0.1:${CC_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

// The stand-in CompanyCam.
const TOKEN = 'cc_test_token_abcdefghijklmnop';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const projects = [
  { id: 101, name: 'Smith residence', address: { street_address_1: '12 Elm Street', city: 'Mesa', state: 'AZ', postal_code: '85201' } },
  { id: 102, name: 'Jones', address: { street_address_1: '40 Oak Ave', city: 'Mesa' } },
  { id: 103, name: 'Somewhere else', address: { street_address_1: '999 Nowhere Rd', city: 'Tempe' } },
];
const photosOf = { 102: [1, 2].map((n) => ({ id: 5000 + n, project_id: 102, creator_name: 'Taylor', captured_at: 1795000000 + n, uris: [{ type: 'web', uri: `${CCB}/img/${5000 + n}.jpg`, url: `${CCB}/img/${5000 + n}.jpg` }] })) };
const hooks = [], deleted = [];
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const j = (code, x) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(x)); };
    if (req.url.startsWith('/img/')) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(JPEG); }
    if (req.headers.authorization !== 'Bearer ' + TOKEN) return j(401, { errors: ['bad token'] });
    const u = new URL(req.url, CCB);
    if (u.pathname === '/v2/company') return j(200, { id: 9, name: 'Desert Shade Co' });
    if (u.pathname === '/v2/webhooks' && req.method === 'POST') { const x = JSON.parse(b); hooks.push(x); return j(201, { id: 77, ...x }); }
    if (u.pathname.startsWith('/v2/webhooks/') && req.method === 'DELETE') { deleted.push(u.pathname.split('/').pop()); res.writeHead(204); return res.end(); }
    if (u.pathname === '/v2/projects') return j(200, u.searchParams.get('page') === '1' ? projects : []);
    let m = u.pathname.match(/^\/v2\/projects\/(\d+)\/photos$/);
    if (m) return j(200, photosOf[m[1]] || []);
    m = u.pathname.match(/^\/v2\/projects\/(\d+)$/);
    if (m) return j(200, { id: Number(m[1]), name: 'Found later', address: { street_address_1: '7 Pine Ln', city: 'Mesa' } });
    j(404, {});
  });
}).listen(CC_PORT);

const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', SKIP_SETUP: '1', COMPANYCAM_API: CCB + '/v2', COMPANYCAM_LOCAL: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  const r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'CC ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r0.body.token);
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const cy = call((await call()('POST', '/auth', { mode: 'join', workspace: 'CC ' + t, code, name: 'Cy', email: `cy${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' })).body.token);
  await ada('PATCH', '/workspace', { tools: { projects: true } });
  const p = (await ada('POST', '/projects', { template: 'trades', trades: ['blinds'] })).body;
  const bl = p.types.find((x) => x.key === 'trade_blinds');
  const F = (k) => bl.fields.find((f) => f.key === k);
  const photosF = bl.fields.find((f) => f.type === 'files' && f.key === 'photos') || bl.fields.find((f) => f.type === 'files');
  ok(!!F('address') && !!photosF, '(setup) blinds jobs have an address and Photos');
  const job = async (name, address) => (await ada('POST', `/projects/${p.id}/records`, { typeId: bl.id, values: { job: name, [F('address').id]: address } })).body;
  const smith = await job('Smith shades', '12 Elm St, Mesa');
  const jones1 = await job('Jones front', '40 Oak Ave, Mesa');
  const jones2 = await job('Jones back', '40 Oak Avenue, Mesa');

  // Connecting.
  ok((await cy('PUT', '/companycam', { token: TOKEN })).status === 403, 'members can’t connect CompanyCam');
  ok((await ada('PUT', '/companycam', { token: 'cc_wrong_token_abcdefghijklmnop' })).status === 400, 'a token CompanyCam doesn’t accept is turned away');
  let r = await ada('PUT', '/companycam', { token: TOKEN });
  ok(r.status === 200 && r.body.connected && r.body.account === 'Desert Shade Co', 'Ada connects: Kloomie checked the token with CompanyCam');
  const hk = hooks.at(-1);
  ok(hk && hk.url.startsWith(B + '/api/companycam/hook/') && hk.scopes.includes('photo.created') && hk.scopes.includes('project.created') && hk.token?.length >= 20, 'and registered its own webhook, with a secret');
  ok(!JSON.stringify(r.body).includes(TOKEN) && !JSON.stringify(r.body).includes(hk.token), 'neither the token nor the secret comes back');
  ok(r.body.linked === 1 && r.body.projects === 3, `one project matched a job by address (12 Elm Street = 12 Elm St, Mesa) (${r.body.linked} of ${r.body.projects})`);
  const w = Object.fromEntries(r.body.waiting.map((x) => [x.id, x]));
  ok(w['102']?.candidates.length === 2 && w['103']?.candidates.length === 0, 'Jones (two jobs at 40 Oak Ave) waits with both offered; the one with no job waits with none');
  ok(JSON.stringify(await cy('GET', '/companycam')) === JSON.stringify({ status: 200, body: { connected: true } }), 'Cy sees only that it’s connected');

  // A photo on the matched project, through the signed webhook.
  const deliver = async (body, secret = hk.token) => { const raw = JSON.stringify(body); return fetch(hk.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-companycam-signature': crypto.createHmac('sha1', secret).update(raw).digest('base64') }, body: raw }); };
  const photosOn = async (rec) => (await ada('GET', `/projects/${p.id}/records`)).body.find((x) => x.id === rec.id)?.values?.[photosF.id] || [];
  ok((await deliver({ event_type: 'photo.created', payload: { id: 4001, project_id: 101, uris: [{ type: 'web', uri: `${CCB}/img/4001.jpg` }] } }, 'wrong-secret')).status === 401, 'a delivery without the right signature is refused');
  ok((await photosOn(smith)).length === 0, 'and changed nothing');
  r = await deliver({ event_type: 'photo.created', webhook_id: 77, created_at: 1, payload: { id: 4001, project_id: 101, creator_name: 'Taylor', captured_at: 1795000000, uris: [{ type: 'thumbnail', uri: `${CCB}/img/x.jpg` }, { type: 'web', uri: `${CCB}/img/4001.jpg` }] } });
  ok(r.status === 200, 'a signed photo.created is taken');
  let on = await photosOn(smith);
  ok(on.length === 1, 'the photo is in Smith’s Photos');
  const it = (await ada('GET', '/state')).body.items.find((x) => x.id === on[0]);
  ok(it && it.type === 'file' && it.mime === 'image/jpeg' && /^CompanyCam /.test(it.name), `as a JPEG named for CompanyCam (${it?.name})`);
  const img = await fetch(`${B}/api/files/${on[0]}`, { headers: { authorization: 'Bearer ' + r0.body.token } });
  ok(img.status === 200 && (await img.arrayBuffer()).byteLength === JPEG.length, 'and it opens');
  await deliver({ event_type: 'photo.created', payload: { id: 4001, project_id: 101, uris: [{ type: 'web', uri: `${CCB}/img/4001.jpg` }] } });
  ok((await photosOn(smith)).length === 1, 'the same photo again (CompanyCam retries) comes in once');

  // Automations hear it.
  const ch = (await ada('POST', '/channels', { name: 'site', memberIds: [] })).body.channels.find((x) => x.name === 'site');
  ok((await ada('POST', '/automations', { name: 'New photo', trigger: { kind: 'companycam.photo' }, actions: [{ kind: 'post', text: 'New photo on {record} from {who} ({text})', channelId: ch.id }] })).status === 200, 'an automation can start on “A CompanyCam photo lands on a job”');
  await deliver({ event_type: 'photo.created', payload: { id: 4003, project_id: 101, creator_name: 'Sam', uris: [{ type: 'web', uri: `${CCB}/img/4003.jpg` }] } });
  let heard = false;
  for (let i = 0; i < 30 && !heard; i++) { await sleep(150); heard = (await ada('GET', '/state')).body.items.some((x) => x.channelId === ch.id && x.text === 'New photo on Smith shades from Sam (Smith residence)'); }
  ok(heard, 'and posts “New photo on Smith shades from Sam (Smith residence)”');

  // Picking the job by hand brings the project's latest photos.
  ok((await cy('POST', '/companycam/link', { projectId: '102', recordId: jones2.id })).status === 403, 'members can’t link projects');
  r = await ada('POST', '/companycam/link', { projectId: '102', recordId: jones2.id });
  ok(r.status === 200 && r.body.brought === 2 && (await photosOn(jones2)).length === 2 && (await photosOn(jones1)).length === 0, 'Ada picks “Jones back”: its 2 latest photos come in');

  // A project CompanyCam makes later.
  await deliver({ event_type: 'project.created', payload: { id: 104, name: 'Smith garage', address: { street_address_1: '12 Elm St', city: 'Mesa' } } });
  const st = (await ada('GET', '/companycam')).body;
  ok(st.projects === 4 && st.linked === 3, 'a new project at a job’s address is matched as it arrives');

  // Disconnecting.
  r = await ada('DELETE', '/companycam');
  ok(r.status === 200 && !r.body.connected && deleted.includes('77'), 'disconnecting deletes the webhook in CompanyCam');
  ok((await deliver({ event_type: 'photo.created', payload: { id: 4002, project_id: 101 } })).status === 404, 'and its address stops working');
  ok((await photosOn(smith)).length === 2, 'the photos already in stay on the job');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  fake.close();
}
if (fails) console.log(srv.log.split('\n').filter((l) => /error|fail/i.test(l)).slice(-10).join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
