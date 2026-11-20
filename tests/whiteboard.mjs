// Whiteboard, the server (2026-11-19): boards of stickies, text, shapes, frames, files and cards, with arrows.
// Who sees a board (the team's, private to its maker, or a campaign's, following the campaign; members who see only
// what's theirs see the team boards they made), live changes over the socket only to those who see it, per-item
// last write wins (a change sends only its fields), what's kept is checked (kinds, sizes, text, cards and files only
// of this team), limits, templates, who's here, delete and restore, the tool and member switches, and the export.
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/whiteboard';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5322, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '' }, stdio: ['ignore', 'ignore', 'inherit'] });
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
// A window: what it hears.
const listen = async (tok) => {
  const heard = [];
  const s = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { authorization: 'Bearer ' + tok } });
  s.on('message', (d) => { try { heard.push(JSON.parse(d)); } catch {} });
  await new Promise((r) => s.on('open', r));
  return { heard, s, say: (m) => s.send(JSON.stringify(m)), has: (f) => heard.some(f), clear: () => heard.splice(0) };
};
const until = async (f, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (f()) return true; await sleep(50); } return false; };
let n = 0;
const nid = () => 'it' + Date.now().toString(36) + (n++);
const t = Date.now();
const socks = [];
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'WB ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const joTok = r.body.token, jo = call(joTok), code = r.body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'WB ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const samTok = r.body.token, sam = call(samTok);
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Zed', email: `zed${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const zed = call(r.body.token);
  const state = (await jo('GET', '/state')).body;
  ok(state.workspace.tools.whiteboard === true && state.workspace.memberAccess.whiteboard === true, 'Whiteboard is on for a new team, and for its members');

  // Made, empty or from a template.
  r = await sam('POST', '/boards', { name: 'Plan <b>it</b>' });
  ok(r.status === 200 && r.body.name === 'Plan <b>it</b>' && r.body.items.length === 0 && r.body.private === false, 'a member makes a team board (its name kept as text)');
  const board = r.body, bid = board.id;
  for (const tpl of ['workflow', 'brainstorm', 'mindmap']) {
    r = await jo('POST', '/boards', { name: tpl, template: tpl });
    const kinds = new Set(r.body.items.map((x) => x.kind));
    ok(r.status === 200 && r.body.items.length >= 4 && (tpl === 'brainstorm' ? kinds.has('frame') && kinds.has('sticky') : r.body.links.length >= 3), `the ${tpl} template starts with ${r.body.items.length} things and ${r.body.links.length} arrows`);
  }
  r = await jo('GET', '/boards');
  ok(r.body.boards.length === 4 && !('items' in r.body.boards[0] && Array.isArray(r.body.boards[0].items)), 'the list has the four boards, without their contents');

  // Live: Jo's window hears Sam's changes; Zed's team hears nothing.
  const joWin = await listen(joTok), samWin = await listen(samTok);
  socks.push(joWin, samWin);
  const a = nid(), b2 = nid(), fr = nid(), ln = nid();
  r = await sam('POST', `/boards/${bid}/ops`, { sid: 'sam-1', ops: [
    { op: 'put', item: { id: a, kind: 'sticky', x: 10, y: 20, text: 'Call the <b>GC</b>', color: 'pink' } },
    { op: 'put', item: { id: b2, kind: 'shape', shape: 'diamond', x: 300, y: 20, w: 160, h: 100, text: 'OK?' } },
    { op: 'put', item: { id: fr, kind: 'frame', x: -50, y: -50, w: 900, h: 500, text: 'Phase 1' } },
    { op: 'put', link: { id: ln, from: a, to: b2, label: 'then' } },
  ] });
  ok(r.status === 200 && r.body.ops.length === 4, 'Sam adds a sticky, a diamond, a frame and an arrow in one go');
  ok(await until(() => joWin.has((m) => m.type === 'board' && m.id === bid && m.ops.length === 4 && m.sid === 'sam-1' && m.by === 'Sam')), 'Jo’s window hears them within a moment, marked as Sam’s');
  r = await jo('GET', `/boards/${bid}`);
  const A = r.body.items.find((x) => x.id === a);
  ok(A.text === 'Call the <b>GC</b>' && A.color === 'pink' && A.w === 200 && A.by === 'Sam', 'the sticky is kept as written, with its size and who made it');
  // Only the fields sent change: Jo moves it while Sam retypes it.
  await jo('POST', `/boards/${bid}/ops`, { ops: [{ op: 'put', item: { id: a, x: 500, y: 600 } }] });
  await sam('POST', `/boards/${bid}/ops`, { ops: [{ op: 'put', item: { id: a, text: 'Call the GC today' } }] });
  r = await jo('GET', `/boards/${bid}`);
  const A2 = r.body.items.find((x) => x.id === a);
  ok(A2.x === 500 && A2.y === 600 && A2.text === 'Call the GC today' && A2.color === 'pink', 'Jo’s move and Sam’s new words both stick (only what each changed)');
  // Into the frame; then the frame goes, and what was in it stays.
  await jo('POST', `/boards/${bid}/ops`, { ops: [{ op: 'put', item: { id: a, parentId: fr } }, { op: 'put', item: { id: b2, parentId: a } }] });
  r = await jo('GET', `/boards/${bid}`);
  ok(r.body.items.find((x) => x.id === a).parentId === fr && !r.body.items.find((x) => x.id === b2).parentId, 'a sticky goes in a frame (only a frame holds things)');
  joWin.clear();
  r = await sam('POST', `/boards/${bid}/ops`, { ops: [{ op: 'del', item: fr }, { op: 'del', item: b2 }] });
  r = await jo('GET', `/boards/${bid}`);
  ok(r.body.items.length === 1 && !r.body.items[0].parentId && r.body.links.length === 0, 'deleting the frame keeps what was in it; deleting the diamond takes its arrow');
  ok(await until(() => joWin.has((m) => m.type === 'board' && m.ops.some((o) => o.op === 'del' && o.link === ln))), 'and Jo hears that the arrow went too');

  // What's kept is checked.
  const zedTask = (await zed('POST', '/tasks', { text: 'ZED-SECRET-TASK' })).body;
  const myTask = (await jo('POST', '/tasks', { text: 'Order tile' })).body;
  const zedFile = await (await fetch(`${B}/api/upload?name=z.txt`, { method: 'PUT', headers: { authorization: 'Bearer ' + (await call()('POST', '/auth', { mode: 'signin', workspace: 'Other ' + t, email: `zed${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' })).body.token }, body: Buffer.from('zed') })).json();
  const myFile = await (await fetch(`${B}/api/upload?name=plan.png`, { method: 'PUT', headers: { authorization: 'Bearer ' + joTok, 'content-type': 'image/png' }, body: Buffer.from('png') })).json();
  const c1 = nid(), c2 = nid(), f1 = nid(), f2 = nid(), bad = nid(), big = nid();
  r = await jo('POST', `/boards/${bid}/ops`, { ops: [
    { op: 'put', item: { id: c1, kind: 'card', ref: { kind: 'task', id: myTask.id }, x: 0, y: 0 } },
    { op: 'put', item: { id: c2, kind: 'card', ref: { kind: 'task', id: zedTask.id }, x: 0, y: 0 } },
    { op: 'put', item: { id: f1, kind: 'file', fileId: myFile.id, x: 0, y: 0 } },
    { op: 'put', item: { id: f2, kind: 'file', fileId: zedFile.id, x: 0, y: 0 } },
    { op: 'put', item: { id: bad, kind: 'drawing', x: 0, y: 0 } },
    { op: 'put', item: { id: big, kind: 'text', x: 9e12, y: -9e12, w: 1, h: 9e9, text: 'x'.repeat(9000), color: 'chartreuse' } },
    { op: 'put', item: { id: '../../etc', kind: 'sticky' } },
    { op: 'put', link: { id: nid(), from: c1, to: 'nope' } },
  ] });
  const ids = r.body.ops.map((o) => o.item?.id || o.link?.id);
  ok(ids.includes(c1) && !ids.includes(c2), 'a card links this team’s task, never another team’s');
  ok(ids.includes(f1) && !ids.includes(f2), 'a file is one of this team’s uploads, never another team’s');
  ok(!ids.includes(bad) && !ids.includes('../../etc') && r.body.ops.length === 3, 'an unknown kind, a bad id and an arrow to nothing are left out');
  const BIG = r.body.ops.find((o) => o.item?.id === big).item;
  ok(BIG.x === 200000 && BIG.y === -200000 && BIG.w === 20 && BIG.h === 20000 && BIG.text.length === 4000 && BIG.color === 'white', 'sizes and places are kept in bounds, text to 4,000 characters, colors to the known ones');
  ok((await jo('POST', `/boards/${bid}/ops`, { ops: Array.from({ length: 501 }, () => ({ op: 'del', item: 'x' })) })).status === 400, 'at most 500 changes at once');
  // At most 2,000 things a board.
  const fill = await jo('POST', '/boards', { name: 'Full' });
  for (let k = 0; k < 4; k++) await jo('POST', `/boards/${fill.body.id}/ops`, { ops: Array.from({ length: 500 }, () => ({ op: 'put', item: { id: nid(), kind: 'sticky', x: 0, y: 0 } })) });
  r = await jo('POST', `/boards/${fill.body.id}/ops`, { ops: [{ op: 'put', item: { id: nid(), kind: 'sticky' } }] });
  ok(r.status === 400 && /2,000/.test(r.body.error), 'a board holds up to 2,000 things');
  await jo('DELETE', `/boards/${fill.body.id}`);

  // Who's here.
  samWin.say({ type: 'board:here', id: bid });
  ok(await until(() => joWin.has((m) => m.type === 'board:here' && m.id === bid && m.people.some((p) => p.name === 'Sam'))), 'Jo sees that Sam has the board open');
  samWin.say({ type: 'board:here', id: null });
  ok(await until(() => joWin.heard.filter((m) => m.type === 'board:here' && m.id === bid).at(-1)?.people.length === 0), 'and that Sam left it');

  // Private: only its maker.
  r = await sam('POST', '/boards', { name: 'SAM-PRIVATE', private: true });
  const priv = r.body;
  ok(!(await jo('GET', '/boards')).body.boards.some((x) => x.id === priv.id) && (await jo('GET', `/boards/${priv.id}`)).status === 404, 'a private board isn’t listed or opened for anyone else, an owner included');
  joWin.clear();
  await sam('POST', `/boards/${priv.id}/ops`, { ops: [{ op: 'put', item: { id: nid(), kind: 'sticky', text: 'PRIVATE-STICKY' } }] });
  await sleep(400);
  ok(!JSON.stringify(joWin.heard).includes('PRIVATE-STICKY') && !JSON.stringify(joWin.heard).includes('SAM-PRIVATE'), 'and its changes never reach anyone else’s window');
  ok((await jo('POST', `/boards/${priv.id}/ops`, { ops: [{ op: 'put', item: { id: nid(), kind: 'sticky' } }] })).status === 404, 'nor can anyone else change it');
  // A team board made private: the others' windows are told it's gone.
  joWin.clear();
  ok((await jo('PATCH', `/boards/${bid}`, { private: true })).status === 400, 'only its maker can make a board private');
  r = await sam('PATCH', `/boards/${bid}`, { private: true });
  ok(r.status === 200 && r.body.private === true, 'Sam makes his board private');
  ok(await until(() => joWin.has((m) => m.type === 'board:gone' && m.id === bid)), 'Jo’s window is told it’s gone');
  ok(!samWin.has((m) => m.type === 'board:gone' && m.id === bid), 'Sam’s isn’t');
  await sam('PATCH', `/boards/${bid}`, { private: false });
  ok((await jo('GET', `/boards/${bid}`)).status === 200, 'shared again, Jo can open it');

  // A campaign's board follows the campaign.
  const camp = (await jo('POST', '/campaigns', { name: 'Owner plans', private: true })).body;
  ok((await sam('POST', '/boards', { campaignId: camp.id })).status === 404, 'nobody makes a board on a campaign they can’t see');
  r = await jo('POST', '/boards', { campaignId: camp.id, template: 'brainstorm' });
  const cb = r.body;
  ok(r.status === 200 && cb.campaignId === camp.id && cb.name === 'Owner plans board', 'Jo makes her private campaign’s board');
  ok((await sam('GET', `/boards/${cb.id}`)).status === 404 && !(await sam('GET', '/boards')).body.boards.some((x) => x.id === cb.id), 'Sam, not in the campaign, can’t see it');
  ok((await jo('GET', `/boards?campaign=${camp.id}`)).body.boards.map((x) => x.id).join() === cb.id, 'a campaign’s boards are listed for it');
  ok((await jo('PATCH', `/boards/${cb.id}`, { private: true })).status === 400, 'a campaign’s board can’t be made private on its own');
  const samId = (await jo('GET', '/state')).body.workspace.members.find((x) => x.name === 'Sam').id;
  await jo('PATCH', `/campaigns/${camp.id}`, { memberIds: [samId] });
  ok((await sam('GET', `/boards/${cb.id}`)).status === 200, 'once Sam is in the campaign, he can');

  // Members who see only what's theirs see the team boards they made.
  const joBoard = (await jo('POST', '/boards', { name: 'JO-TEAM-BOARD' })).body;
  await jo('PATCH', '/workspace', { visibility: 'own' });
  r = await sam('GET', '/boards');
  ok(!r.body.boards.some((x) => x.id === joBoard.id) && r.body.boards.some((x) => x.id === bid), 'with “only what’s theirs”, Sam sees his own boards, not Jo’s');
  await jo('PATCH', '/workspace', { visibility: 'all' });

  // Switches: off for members, then off for the team.
  await jo('PATCH', '/workspace', { memberAccess: { whiteboard: false } });
  ok((await sam('GET', '/boards')).status === 403 && (await jo('GET', '/boards')).status === 200, 'off for members: Sam can’t, Jo still can');
  await jo('PATCH', '/workspace', { memberAccess: { whiteboard: true }, tools: { whiteboard: false } });
  ok((await jo('GET', '/boards')).status === 403, 'off for the team: nobody can');
  await jo('PATCH', '/workspace', { tools: { whiteboard: true } });

  // Deleted: to Deleted, restorable by its maker or an admin; nobody else can delete it.
  ok((await sam('DELETE', `/boards/${joBoard.id}`)).status === 403, 'a member can’t delete someone else’s board');
  joWin.clear();
  r = await sam('DELETE', `/boards/${bid}`);
  ok(r.status === 200 && (await jo('GET', `/boards/${bid}`)).status === 404, 'Sam deletes his board');
  ok(await until(() => joWin.has((m) => m.type === 'board:gone' && m.id === bid)), 'and Jo’s window is told');
  r = await sam('GET', '/boards');
  ok(r.body.trash.some((x) => x.id === bid) && !r.body.boards.some((x) => x.id === bid), 'it waits in Deleted');
  r = await sam('POST', `/boards/${bid}/restore`);
  ok(r.status === 200 && r.body.items.length >= 1, 'and comes back with everything on it');

  // The owner's team export has the boards she can see, not Sam's private one.
  r = await jo('POST', '/exports', { kind: 'team' });
  let ex;
  for (let i = 0; i < 60 && !(ex && ex.status !== 'building'); i++) { await sleep(250); ex = (await jo('GET', '/exports')).body.exports.find((y) => y.kind === 'team'); }
  const zip = DIR + '/team.zip';
  fs.writeFileSync(zip, Buffer.from(await (await fetch(`${B}/api/exports/${ex.id}/file`, { headers: { authorization: 'Bearer ' + joTok } })).arrayBuffer()));
  const data = JSON.parse(execFileSync('unzip', ['-p', zip, 'data.json']).toString());
  ok(Array.isArray(data.boards) && data.boards.some((x) => x.id === bid && Object.keys(x.items).length) && !data.boards.some((x) => x.id === priv.id), 'the team export has the boards with what’s on them, not Sam’s private one');
} catch (e) {
  console.log('FAIL threw: ' + e.stack);
  fails++;
} finally {
  for (const w of socks) w.s.close();
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
