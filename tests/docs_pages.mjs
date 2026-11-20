// Docs, step 1 (docs-notion plan): pages inside pages, the trash, and starred docs.
// A sub-page is a doc of its own (underId: the doc it's in), kept where its top page is and seen by whoever sees the
// top page. Its parent gets a page block for it, made by the server; a page block can only name the doc's own
// sub-pages. Moving a doc moves the pages inside it, under the same who-can-see rule as anything else (which now holds
// for private campaigns' stacks too, not only folders). Deleting a doc puts it, with its pages, in a trash for 30
// days: gone from everything else, back where it was on restore. Starred docs are each person's own.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/docs_pages';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4870, B = `http://127.0.0.1:${PORT}`;
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
const doc = (title, text = '') => ({ type: 'text', doc: { title, blocks: text ? [{ id: 'p' + Math.random().toString(36).slice(2, 8), type: 'p', runs: [{ text }] }] : [] } });
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Pages ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  const code = (await rico('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Pages ' + t, code, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Olga', email: `olga${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const olga = call(r.body.token);
  const ids = async (who) => new Set((await who('GET', '/state')).body.items.map((x) => x.id));
  const blocks = async (who, id) => (await who('GET', `/items/${id}/doc`)).body?.blocks || [];

  // A handbook with a page inside, and one inside that.
  const A = (await rico('POST', '/items', doc('Handbook', 'How we work'))).body;
  const intro = (await blocks(rico, A.id))[0];
  r = await rico('POST', '/items', { ...doc('Safety', 'Hard hats on site'), underId: A.id, after: intro.id });
  const Bp = r.body;
  ok(r.status === 200 && Bp.underId === A.id && Bp.stackId === A.stackId && !Bp.dirId, 'a page inside a doc: kept where the doc is');
  let ab = await blocks(rico, A.id);
  ok(ab.length === 2 && ab[1].type === 'page' && ab[1].docId === Bp.id, 'the doc gets a page block for it, after the block asked for');
  const Cp = (await sam('POST', '/items', { ...doc('Ladders'), underId: Bp.id })).body;
  ok(Cp.underId === Bp.id && (await blocks(sam, Bp.id)).some((b) => b.type === 'page' && b.docId === Cp.id), 'anyone who can edit a page can add one inside it (Sam, inside Safety)');
  r = await rico('POST', '/items', { type: 'text', text: 'Quick page\nfrom plain text', underId: A.id });
  ok(r.status === 200 && r.body.pinned === true && r.body.underId === A.id, 'a page made from plain text is kept too (auto-clear never takes a page inside a doc)');
  await rico('DELETE', `/items/${r.body.id}`);
  await rico('DELETE', `/trash/${r.body.id}`);
  ok((await rico('GET', '/state')).body.items.find((x) => x.id === A.id).text.includes('[Page: Safety]'), 'the doc’s text names the page inside (search and Sidekick read it)');
  await rico('PATCH', `/items/${Bp.id}/doc`, { ops: [], title: 'Safety rules', v: (await rico('GET', `/items/${Bp.id}/doc`)).body.v });
  ok((await rico('GET', '/state')).body.items.find((x) => x.id === A.id).text.includes('[Page: Safety rules]'), 'renamed, the page’s new name shows in the doc’s text too (live check 2026-11-20)');
  await rico('PATCH', `/items/${Bp.id}/doc`, { ops: [], title: 'Safety', v: (await rico('GET', `/items/${Bp.id}/doc`)).body.v });

  // Pages go 8 deep at most.
  let top = Cp, made = 3;
  while (made < 8) { top = (await rico('POST', '/items', { ...doc('Level ' + (made + 1)), underId: top.id })).body; made++; }
  r = await rico('POST', '/items', { ...doc('Too deep'), underId: top.id });
  ok(r.status === 400 && /8 deep/.test(r.body.error), `a ninth level is refused (${r.status})`);

  // A page block names only the doc's own pages: one pointing at another doc (or another team's) is dropped.
  const D = (await rico('POST', '/items', doc('PRIVATE-NAME pay rates'))).body;
  const O = (await olga('POST', '/items', doc('OLGA-SECRET plans'))).body;
  r = await sam('PATCH', `/items/${A.id}/doc`, { ops: [{ set: { id: 'fake1', type: 'page', docId: D.id }, after: intro.id }, { set: { id: 'fake2', type: 'page', docId: O.id } }], sid: 's1' });
  ab = await blocks(rico, A.id);
  ok(r.status === 200 && !ab.some((b) => b.docId === D.id || b.docId === O.id), 'a page block for a doc that isn’t a page inside this one is dropped');
  r = await sam('POST', '/items', { type: 'text', doc: { title: 'Copy', blocks: [{ id: 'x1', type: 'page', docId: Bp.id }] } });
  ok(r.status === 200 && !(await blocks(sam, r.body.id)).some((b) => b.type === 'page'), 'a new doc can’t start with a page block');
  r = await rico('POST', `/items/${A.id}/share`, {});
  const share = await (await fetch(`${B}/s/${r.body.share.token}`)).text();
  ok(share.includes('Safety') && !share.includes('OLGA-SECRET') && !share.includes('PRIVATE-NAME'), 'the public link shows the page inside by name, and nothing else');
  await rico('DELETE', `/items/${A.id}/share`);
  r = await olga('POST', '/items', { ...doc('Sneaky'), underId: A.id });
  ok(r.status === 404, 'nobody on another team can put a page in the doc');

  // A private folder: the pages in a doc there are seen only by its owner.
  const dir = (await rico('POST', '/dirs', { name: 'Rico only', private: true })).body;
  const P = (await rico('POST', '/items', { ...doc('Private plan'), dirId: dir.id })).body;
  const Q = (await rico('POST', '/items', { ...doc('PRIVATE-SUB notes'), underId: P.id })).body;
  ok(Q.dirId === dir.id, 'a page inside a doc in a folder is kept in the folder');
  let samSees = await ids(sam);
  ok(!samSees.has(Q.id) && (await sam('GET', `/items/${Q.id}/doc`)).status === 404, 'someone who can’t see the folder doesn’t see the page inside');
  ok((await sam('POST', '/items', { ...doc('x'), underId: P.id })).status === 404, '…and can’t add a page to the doc');

  // Moving: the pages go with it, under the same who-can-see rule.
  r = await sam('PATCH', `/items/${A.id}`, { dirId: dir.id });
  ok(r.status === 404 || r.status === 403, `Sam can’t move the handbook into Rico’s private folder (${r.status})`);
  const samDir = (await sam('POST', '/dirs', { name: 'Sam only', private: true })).body;
  r = await sam('PATCH', `/items/${A.id}`, { dirId: samDir.id });
  ok(r.status === 403, 'nor into his own private folder: it’s Rico’s doc, the team would lose it');
  r = await rico('PATCH', `/items/${A.id}`, { dirId: dir.id });
  samSees = await ids(sam);
  ok(r.status === 200 && !samSees.has(A.id) && !samSees.has(Bp.id) && !samSees.has(Cp.id), 'Rico (an owner) can, and every page inside goes with it');
  const st = (await rico('GET', '/state')).body.items;
  ok([Bp.id, Cp.id].every((id) => st.find((x) => x.id === id)?.dirId === dir.id), 'the pages inside are kept in the folder too');
  r = await rico('PATCH', `/items/${A.id}`, { dirId: null });
  samSees = await ids(sam);
  ok(r.status === 200 && samSees.has(A.id) && samSees.has(Cp.id), 'and back out to the stacks, with the pages');

  // A private campaign's stack changes who sees things too.
  const camp = (await sam('POST', '/campaigns', { name: 'Sam secret', private: true })).body;
  r = await sam('PATCH', `/items/${D.id}`, { stackId: camp.stackId });
  ok(r.status === 403, `moving someone else’s doc into a private campaign’s stack is refused, like a private folder (${r.status})`);
  const mine = (await sam('POST', '/items', doc('Sam note'))).body;
  r = await sam('PATCH', `/items/${mine.id}`, { stackId: camp.stackId });
  ok(r.status === 200 && !(await ids(rico)).has(mine.id), 'his own doc can go there (and then only the campaign’s people see it)');

  // Into another doc, out to a page of its own, and never inside itself.
  r = await rico('PATCH', `/items/${Cp.id}`, { underId: null });
  ok(r.status === 200 && !r.body.underId && !(await blocks(rico, Bp.id)).some((b) => b.docId === Cp.id), 'out to a page of its own: its block leaves the page it was in');
  r = await rico('PATCH', `/items/${Bp.id}`, { underId: Cp.id });
  ok(r.status === 200 && r.body.underId === Cp.id && (await blocks(rico, Cp.id)).some((b) => b.type === 'page' && b.docId === Bp.id) && !(await blocks(rico, A.id)).some((b) => b.docId === Bp.id), 'into another doc: its block moves');
  r = await rico('PATCH', `/items/${Cp.id}`, { underId: Bp.id });
  ok(r.status === 400, 'a page can’t go inside a page inside itself');
  r = await rico('PATCH', `/items/${Bp.id}`, { underId: A.id });

  // A locked doc: only its maker and admins add or take out pages.
  await rico('PATCH', `/items/${A.id}`, { locked: true });
  ok((await sam('POST', '/items', { ...doc('x'), underId: A.id })).status === 403, 'Sam can’t add a page to a locked doc');
  ok((await sam('PATCH', `/items/${Bp.id}`, { underId: null })).status === 403, '…or take one out of it');
  ok((await sam('DELETE', `/items/${Bp.id}`)).status === 403, '…or delete one from it');
  await rico('PATCH', `/items/${A.id}`, { locked: false });

  // The trash.
  await rico('POST', `/items/${A.id}/comments`, { text: 'Keep this' });
  r = await rico('POST', `/items/${A.id}/share`, {});
  const tok = r.body.share.token;
  r = await rico('DELETE', `/items/${A.id}`);
  ok(r.status === 200 && r.body.trash?.pages >= 1, `deleting the handbook puts it in the trash with the page inside (${r.body.trash?.pages})`);
  samSees = await ids(sam);
  ok(!samSees.has(A.id) && !samSees.has(Bp.id) && (await sam('GET', `/items/${Bp.id}/doc`)).status === 404, 'it and the pages inside are gone from everything');
  ok((await fetch(`${B}/s/${tok}`)).status === 404, 'its public link stops working');
  let trash = (await rico('GET', '/trash')).body;
  ok(trash.some((e) => e.id === A.id && e.title === 'Handbook' && e.until > Date.now() + 29 * 864e5), 'Rico sees it in the trash, for 30 days');
  ok(!(await sam('GET', '/trash')).body.some((e) => e.id === A.id), 'Sam (didn’t make it or delete it, not an admin) doesn’t');
  ok((await sam('POST', `/trash/${A.id}/restore`)).status === 404, '…and can’t put it back');
  ok(!(await olga('GET', '/trash')).body.length && (await olga('POST', `/trash/${A.id}/restore`)).status === 404, 'another team never sees it');
  r = await rico('POST', `/trash/${A.id}/restore`);
  samSees = await ids(sam);
  ok(r.status === 200 && samSees.has(A.id) && samSees.has(Bp.id) && (await rico('GET', `/items/${A.id}/comments`)).body.length === 1, 'put back: with its pages and comments');
  ok(!(await rico('GET', '/trash')).body.some((e) => e.id === A.id), 'and out of the trash');
  // A page inside: its block leaves its parent, and comes back.
  await rico('DELETE', `/items/${Bp.id}`);
  ok(!(await blocks(rico, A.id)).some((b) => b.docId === Bp.id), 'trashing a page inside takes its block out of the parent');
  await rico('POST', `/trash/${Bp.id}/restore`);
  ok((await blocks(rico, A.id)).some((b) => b.type === 'page' && b.docId === Bp.id) && (await ids(sam)).has(Bp.id), 'putting it back puts its block back');
  // Sam's own doc: he sees it in the trash and deletes it for good.
  await sam('DELETE', `/items/${mine.id}`);
  trash = (await sam('GET', '/trash')).body;
  ok(trash.some((e) => e.id === mine.id), 'Sam sees the doc he deleted');
  r = await sam('DELETE', `/trash/${mine.id}`);
  ok(r.status === 200 && !(await sam('GET', '/trash')).body.some((e) => e.id === mine.id) && (await sam('POST', `/trash/${mine.id}/restore`)).status === 404, 'deleted for good: gone from the trash');
  // Deleting a campaign takes its trashed docs with it.
  const c2 = (await rico('POST', '/campaigns', { name: 'Short job' })).body;
  const cd = (await rico('POST', '/items', { ...doc('Job notes'), stackId: c2.stackId })).body;
  await rico('DELETE', `/items/${cd.id}`);
  ok((await rico('GET', '/trash')).body.some((e) => e.id === cd.id), '(setup) a campaign’s doc in the trash');
  await rico('DELETE', `/campaigns/${c2.id}`);
  ok(!(await rico('GET', '/trash')).body.some((e) => e.id === cd.id), 'deleting a campaign takes its docs out of the trash too');

  // Stars: each person's own, only docs they can see.
  r = await sam('PUT', '/account/stars', { docs: [A.id, Q.id, O.id, 'nope'] });
  ok(r.status === 200 && JSON.stringify(r.body.stars) === JSON.stringify([A.id]), 'stars keep only docs the person can see');
  ok(JSON.stringify((await sam('GET', '/state')).body.me.stars) === JSON.stringify([A.id]) && !(await rico('GET', '/state')).body.me.stars.length, 'and are each person’s own');

  // After a restart: pages, the trash and stars are all still there.
  srv.kill();
  await sleep(600);
  const srv2 = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
  await rico('DELETE', `/items/${Q.id}`);
  srv2.kill();
  await sleep(600);
  const srv3 = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
  const st2 = (await rico('GET', '/state')).body;
  ok(st2.items.find((x) => x.id === Bp.id)?.underId === A.id && (await rico('GET', '/trash')).body.some((e) => e.id === Q.id), 'after restarts: pages inside pages and the trash are kept');
  srv3.kill();
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails) console.log('Server log:\n' + srv.log.slice(-3000));
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
