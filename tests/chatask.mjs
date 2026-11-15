// Asking a teammate to sign, in chat: POST /signs with signerId (a member, not an email). The request is posted in
// the document's feed as an @mention with a [[sign:id]] link; only the signer's link info carries the signing page,
// and someone who can't see the document can't be asked. Signed, the copy lands in the same feed.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/chatask';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4868, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const t = Date.now();
try {
  const r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Ask ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r0.body.token);
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const ben = call((await call()('POST', '/auth', { mode: 'join', workspace: 'Ask ' + t, code, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' })).body.token);
  const cy = call((await call()('POST', '/auth', { mode: 'join', workspace: 'Ask ' + t, code, name: 'Cy', email: `cy${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' })).body.token);
  const members = (await ada('GET', '/state')).body.workspace.members;
  const benId = members.find((x) => x.name === 'Ben').id, cyId = members.find((x) => x.name === 'Cy').id;
  const crew = (await ada('POST', '/channels', { name: 'crew', memberIds: [benId] })).body.channels.find((x) => x.name === 'crew');
  const msg = (await ada('POST', '/items', { type: 'message', text: 'I agree to the install on Nov 20.', channelId: crew.id })).body;
  const pdf = (await ada('POST', '/docs/pdf', { itemId: msg.id, name: 'Install', blocks: [{ t: 'p', runs: [{ text: 'I agree to the install on Nov 20.' }] }] })).body;
  ok(pdf.channelId === crew.id, 'the PDF is in the crew feed');
  const fields = [{ id: 'f1', type: 'sig', page: 0, x: 72, y: 600, w: 150, h: 50 }];

  let r = await ada('POST', '/signs', { itemId: pdf.id, signerId: cyId, fields });
  ok(r.status === 400 && /can’t see/.test(r.body?.error || ''), 'Cy isn’t in the feed, so Ada can’t ask Cy');
  r = await ada('POST', '/signs', { itemId: pdf.id, signerId: 'nobody', fields });
  ok(r.status === 400, 'nor someone who isn’t on the team');

  r = await ada('POST', '/signs', { itemId: pdf.id, signerId: benId, fields, message: 'When you get a sec' });
  ok(r.status === 200 && r.body.signerId === benId && r.body.signer.name === 'Ben' && r.body.signer.email === `ben${t}@t.test`, 'Ada asks Ben: his name and email come from the team');
  const x = r.body;
  const feed = (await ben('GET', '/state')).body.items.filter((i) => i.channelId === crew.id && i.type === 'message');
  const ask = feed.find((i) => i.text.includes(`[[sign:${x.id}]]`));
  ok(ask && /@Ben\b/.test(ask.text) && ask.by === 'Ada', 'the request is posted in the feed, @mentioning Ben');
  ok(ask && ask.text.includes('When you get a sec'), 'with Ada’s note');

  const token = x.link.split('/sign/')[1];
  const info = async (who) => (await who('POST', '/links', { links: [{ type: 'sign', id: x.id }] })).body.links['sign:' + x.id];
  const bi = await info(ben);
  ok(bi.ok && bi.signUrl?.endsWith('/sign/' + token) && bi.toSign === true, 'Ben’s link opens his signing page');
  const ai = await info(ada);
  ok(ai.ok && !ai.signUrl, 'Ada sees the request but no signing page');
  const ci = await info(cy);
  ok(!JSON.stringify(ci).includes(token) && !ci.signUrl, 'Cy gets nothing that signs it');

  const pub = (m, p, body) => fetch(B + '/api/public/sign/' + token + (p || ''), { method: m, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (q) => ({ status: q.status, body: await q.json().catch(() => null) }));
  r = await pub('POST', '', { consent: true, name: 'Ben Jones', sig: PNG });
  ok(r.status === 200 && r.body.status === 'signed', 'Ben signs');
  const after = (await ada('GET', '/state')).body.items;
  ok(after.some((i) => i.name === 'Install (signed).pdf' && i.channelId === crew.id), 'the signed copy lands in the crew feed');
  const bi2 = await info(ben);
  ok(bi2.ok && !bi2.signUrl && /signed/.test(bi2.sub), 'once signed, Ben’s link says so and no longer signs');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.split('\n').filter((l) => /error/i.test(l)).slice(-10).join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
