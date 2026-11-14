// Pinned to a chat: a stack, doc, folder or agent stays at the top of a feed for everyone in it. Each reader only
// learns what they could open themselves (a pin they can't see is a locked chip with no name or id). And things in
// chat can be copied into a stack or folder, the message staying where it is, but never somewhere more people would
// see something someone else posted.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/chatpins';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4860, B = `http://127.0.0.1:${PORT}`;
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
const upload = async (tok, name, bytes, q) => (await fetch(`${B}/api/upload?name=${encodeURIComponent(name)}&${new URLSearchParams(q)}`, { method: 'PUT', headers: { authorization: 'Bearer ' + tok }, body: bytes })).json();
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Pins ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const adaTok = r.body.token, ada = call(adaTok);
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const benTok = (await call()('POST', '/auth', { mode: 'join', workspace: 'Pins ' + t, code, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' })).body.token;
  const ben = call(benTok);
  const cyTok = (await call()('POST', '/auth', { mode: 'join', workspace: 'Pins ' + t, code, name: 'Cy', email: `cy${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' })).body.token;
  const cy = call(cyTok);
  const st0 = (await ada('GET', '/state')).body;
  const benId = st0.workspace.members.find((x) => x.name === 'Ben').id;
  const stacks = (await ada('POST', '/stacks', { name: 'Henderson job' })).body.stacks;
  const stack = stacks.find((x) => x.name === 'Henderson job');
  // A feed for Ada and Ben only.
  const crew = (await ada('POST', '/channels', { name: 'crew', memberIds: [benId] })).body.channels.find((x) => x.name === 'crew');
  // A private campaign of Ada's: its stack is hers alone.
  const camp = (await ada('POST', '/campaigns', { name: 'Secret bid', private: true })).body;
  const secretStack = camp.stackId || (await ada('GET', '/state')).body.workspace.stacks.find((x) => x.campaignId === camp.id)?.id;
  ok(!!secretStack, 'the private campaign has a stack');
  const doc = (await ada('POST', '/items', { type: 'text', doc: { title: 'Install notes', blocks: [] } })).body;

  // Pin a stack to #crew: Ben sees it, with its name.
  r = await ada('POST', `/channels/${crew.id}/pins`, { kind: 'stack', id: stack.id });
  ok(r.status === 200, 'Ada pins a stack to #crew');
  const crewOf = async (who) => (await who('GET', '/state')).body.workspace.channels.find((x) => x.id === crew.id);
  let bc = await crewOf(ben);
  ok(bc?.pins?.length === 1 && bc.pins[0].kind === 'stack' && bc.pins[0].id === stack.id && !bc.pins[0].locked, 'Ben sees the pinned stack');
  ok(!!bc.pins[0].pid, 'each pin has its own id');

  // Pinning something only she can see: it's pinned, she's told not everyone can see it, and Ben gets a locked chip.
  r = await ada('POST', `/channels/${crew.id}/pins`, { kind: 'stack', id: secretStack });
  ok(r.status === 200 && r.body.narrower === true, 'pinning a private stack says not everyone in the feed can see it');
  bc = await crewOf(ben);
  const lockedPin = bc.pins.find((x) => x.locked);
  ok(bc.pins.length === 2 && lockedPin && !lockedPin.id && !lockedPin.label, 'Ben sees a locked chip with no id or name');
  ok(!JSON.stringify((await ben('GET', '/state')).body).includes(secretStack), 'the private stack id never reaches Ben');
  const ac = await crewOf(ada);
  ok(ac.pins.find((x) => x.id === secretStack && !x.locked), 'Ada sees her private stack pinned');

  // Ben can't pin what he can't see, or pin twice, or pin to a feed he's not in.
  r = await ben('POST', `/channels/${crew.id}/pins`, { kind: 'stack', id: secretStack });
  ok(r.status === 404, 'Ben can’t pin a stack he can’t see');
  r = await ben('POST', `/channels/${crew.id}/pins`, { kind: 'stack', id: stack.id });
  ok(r.status === 409, 'the same thing can’t be pinned twice');
  r = await cy('POST', `/channels/${crew.id}/pins`, { kind: 'stack', id: stack.id });
  ok(r.status === 404, 'Cy (not in #crew) can’t pin to it');
  ok(!(await cy('GET', '/state')).body.workspace.channels.some((x) => x.id === crew.id), 'Cy doesn’t see #crew at all');
  r = await ben('POST', `/channels/${crew.id}/pins`, { kind: 'doc', id: doc.id });
  ok(r.status === 200, 'Ben pins a team doc');
  r = await ben('POST', `/channels/${crew.id}/pins`, { kind: 'agent', id: 'ops' });
  ok(r.status === 200 && r.body.channels.find((x) => x.id === crew.id).pins.some((p) => p.kind === 'agent' && p.id === 'ops' && p.label === 'Operations Manager'), 'an agent can be pinned, with its name');
  r = await ben('POST', `/channels/${crew.id}/pins`, { kind: 'agent', id: 'nobody' });
  ok(r.status === 404, 'an agent that doesn’t exist can’t be pinned');
  r = await ben('POST', `/channels/${crew.id}/pins`, { kind: 'vault', id: 'x' });
  ok(r.status === 400, 'only stacks, docs, folders and agents can be pinned');

  // General (the team's feed with no channel record) takes pins too.
  r = await ben('POST', '/channels/general/pins', { kind: 'stack', id: stack.id });
  ok(r.status === 200 && (await cy('GET', '/state')).body.workspace.chatPins?.some((p) => p.id === stack.id), 'pins on #general, seen by the whole team');

  // A folder.
  r = await ada('POST', '/dirs', { name: 'Permits' });
  const dirId = (r.body.dirs || r.body.workspace?.dirs || []).find?.((d) => d.name === 'Permits')?.id || (await ada('GET', '/state')).body.workspace.dirs.find((d) => d.name === 'Permits')?.id;
  r = await ada('POST', `/channels/${crew.id}/pins`, { kind: 'dir', id: dirId });
  ok(r.status === 200, 'a folder can be pinned');

  // Eight at most.
  for (let i = 0; i < 6; i++) await ada('POST', '/stacks', { name: 'S' + i });
  const many = (await ada('GET', '/state')).body.workspace.stacks.filter((x) => /^S\d$/.test(x.name));
  let last;
  for (const s of many) last = await ada('POST', `/channels/${crew.id}/pins`, { kind: 'stack', id: s.id });
  ok(last.status === 400 && (await crewOf(ada)).pins.length === 8, 'a feed holds 8 pins at most');

  // Anyone in the feed can take a pin off, even one they see locked.
  r = await ben('DELETE', `/channels/${crew.id}/pins/${lockedPin.pid}`);
  ok(r.status === 200 && !(await crewOf(ada)).pins.some((x) => x.id === secretStack), 'Ben takes the locked pin off');
  r = await cy('DELETE', `/channels/${crew.id}/pins/${bc.pins[0].pid}`);
  ok(r.status === 404, 'Cy can’t take pins off a feed he’s not in');

  // A pinned stack that's deleted just drops off.
  await ada('DELETE', '/stacks/' + many[0].id);
  ok(!(await crewOf(ada)).pins.some((x) => x.id === many[0].id), 'a deleted stack’s pin is gone');

  // ---- Copying from chat into a stack or folder ----
  const bytes = Buffer.from('hello from the job site ' + t);
  const benFile = await upload(benTok, 'site.txt', bytes, { channelId: crew.id });
  const adaFile = await upload(adaTok, 'quote.txt', Buffer.from('quote'), { channelId: crew.id });
  ok(benFile.channelId === crew.id, 'Ben’s file is in #crew');
  r = await ben('POST', `/items/${benFile.id}/copy`, { stackId: stack.id });
  ok(r.status === 200 && r.body.stackId === stack.id && !r.body.channelId && r.body.id !== benFile.id && r.body.name === 'site.txt', 'Ben copies his own file from #crew into the stack');
  const dl = await fetch(`${B}/api/files/${r.body.id}`, { headers: { authorization: 'Bearer ' + benTok } });
  const got = dl.ok ? Buffer.from(await dl.arrayBuffer()) : null;
  ok(got && got.equals(bytes), 'the copy has the same bytes');
  ok((await ben('GET', '/state')).body.items.some((x) => x.id === benFile.id && x.channelId === crew.id), 'the original stays in the chat');
  r = await ben('POST', `/items/${adaFile.id}/copy`, { stackId: stack.id });
  ok(r.status === 403, 'Ben can’t copy Ada’s file out of a private feed to the whole team');
  r = await ada('POST', `/items/${adaFile.id}/copy`, { stackId: stack.id });
  ok(r.status === 200, 'Ada can copy her own');
  // From the team's feed to a team stack, anyone may: nobody new sees it.
  const genFile = await upload(adaTok, 'plan.txt', Buffer.from('plan'), {});
  r = await ben('POST', `/items/${genFile.id}/copy`, { stackId: stack.id });
  ok(r.status === 200, 'Ben copies Ada’s file from #general into a team stack');
  // Into a narrower place (a folder only Ada sees) is fine for her; Ben can't use a stack he can't see.
  r = await ben('POST', `/items/${genFile.id}/copy`, { stackId: secretStack });
  ok(r.status === 404, 'Ben can’t copy into a stack he can’t see');
  r = await ben('POST', `/items/${genFile.id}/copy`, { dirId });
  ok(r.status === 200 && r.body.dirId === dirId && !r.body.stackId, 'copy into a folder');
  // A message becomes a note.
  const msg = (await ben('POST', '/items', { type: 'message', text: 'Gate code is 4412', channelId: crew.id })).body;
  r = await ben('POST', `/items/${msg.id}/copy`, { stackId: stack.id });
  ok(r.status === 200 && r.body.type === 'text' && r.body.text.includes('Gate code is 4412') && r.body.stackId === stack.id, 'a message copied into a stack is a note');
  r = await ben('POST', `/items/${msg.id}/copy`, {});
  ok(r.status === 400, 'a copy needs somewhere to go');
  r = await cy('POST', `/items/${benFile.id}/copy`, { stackId: stack.id });
  ok(r.status === 404, 'Cy can’t copy what he can’t see');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.split('\n').slice(-30).join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
