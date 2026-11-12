// Docs, step 5: a doc and the pages inside it as a small public site, and the team's own doc templates.
// The site serves the shared doc and the pages inside it (each at its own address, with a contents list), their
// pictures and nothing else; links between its pages work; without "pages" a page inside isn't served. A template is
// a doc and its pages saved for the team: only a doc the whole team can see can be one; using it makes new docs with
// their own pages (page blocks pointing at the new ones, to-dos without tasks), or fills an empty doc.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { PNG } from './zipmake.mjs';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/docs_wiki';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4888, B = `http://127.0.0.1:${PORT}`;
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
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Wiki ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ricoTok = r.body.token;
  const rico = call(ricoTok);
  const code = (await rico('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Wiki ' + t, code, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Olga', email: `olga${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const olga = call(r.body.token);
  const p = (text) => [{ id: 'x' + Math.random().toString(36).slice(2, 8), type: 'p', runs: [{ text }] }];
  const A = (await rico('POST', '/items', { type: 'text', doc: { title: 'Handbook', blocks: p('Welcome') } })).body;
  const Bd = (await rico('POST', '/items', { type: 'text', doc: { title: 'Safety', blocks: p('Hard hats') }, underId: A.id })).body;
  const C = (await rico('POST', '/items', { type: 'text', doc: { title: 'Ladders', blocks: p('Three points') }, underId: Bd.id })).body;
  const D = (await rico('POST', '/items', { type: 'text', doc: { title: 'UNRELATED pay rates', blocks: p('secret') } })).body;
  const pic = await (await fetch(`${B}/api/upload?name=ladder.png`, { method: 'PUT', headers: { authorization: 'Bearer ' + ricoTok }, body: PNG })).json();
  const other = await (await fetch(`${B}/api/upload?name=other.png`, { method: 'PUT', headers: { authorization: 'Bearer ' + ricoTok }, body: PNG })).json();
  await rico('PATCH', `/items/${C.id}/doc`, { ops: [{ set: { id: 'f1', type: 'file', itemId: pic.id, name: 'ladder.png' } }], sid: 's' });
  await rico('PATCH', `/items/${A.id}/doc`, { ops: [{ set: { id: 'm1', type: 'p', runs: [{ text: 'See ' }, { text: 'Ladders', ref: { k: 'doc', id: C.id } }, { text: ' and ' }, { text: 'pay', ref: { k: 'doc', id: D.id } }] } }], sid: 's' });

  // Just the doc: a page inside isn't on the link.
  r = await rico('POST', `/items/${A.id}/share`, {});
  let tok = r.body.share.token;
  ok((await fetch(`${B}/s/${tok}/p/${Bd.id}`)).status === 404 && !(await (await fetch(`${B}/s/${tok}`)).text()).includes(`/s/${tok}/p/`), 'a doc shared on its own: its pages inside aren’t on the link');
  // With its pages: a small site.
  r = await rico('POST', `/items/${A.id}/share`, { pages: true });
  ok(r.body.share.pages === true && r.body.share.token === tok, 'shared with its pages (same link)');
  const home = await (await fetch(`${B}/s/${tok}`)).text();
  ok(home.includes('class="toc"') && home.includes(`href="/s/${tok}/p/${Bd.id}"`) && home.includes(`href="/s/${tok}/p/${C.id}"`), 'the shared doc has a contents list of its pages');
  ok(home.includes(`<a class="ref" href="/s/${tok}/p/${C.id}">Ladders</a>`) && !home.includes(`/p/${D.id}`) && !home.includes('UNRELATED'), 'a mention of a page on the site links to it; one of a doc that isn’t on it stays plain words');
  const page = await fetch(`${B}/s/${tok}/p/${C.id}`);
  const html = await page.text();
  ok(page.status === 200 && html.includes('<h1>Ladders</h1>') && html.includes('class="meta crumbs"') && html.includes('aria-current="page"'), 'a page inside has its own address, its place in the site and the contents list');
  ok((await fetch(`${B}/s/${tok}/img/${pic.id}`)).status === 200 && html.includes(`/s/${tok}/img/${pic.id}`), 'its picture shows through the link');
  ok((await fetch(`${B}/s/${tok}/img/${other.id}`)).status === 404, 'and no other file');
  ok((await fetch(`${B}/s/${tok}/p/${D.id}`)).status === 404 && (await fetch(`${B}/s/${tok}/p/nope`)).status === 404, 'a doc that isn’t on the site isn’t served by its link');
  const late = (await rico('POST', '/items', { type: 'text', doc: { title: 'Added later', blocks: [] }, underId: A.id })).body;
  ok((await fetch(`${B}/s/${tok}/p/${late.id}`)).status === 200, 'a page added inside later is on the site too');
  await rico('DELETE', `/items/${A.id}/share`);
  ok((await fetch(`${B}/s/${tok}/p/${Bd.id}`)).status === 404, 'turning the link off takes the whole site down');

  // Team templates.
  const task = (await rico('POST', '/tasks', { text: 'Order brackets' })).body;
  await rico('PATCH', `/items/${Bd.id}/doc`, { ops: [{ set: { id: 't1', type: 'todo', runs: [{ text: 'Order brackets' }], taskId: task.id } }], sid: 's' });
  r = await rico('POST', '/doc-templates', { docId: A.id, name: 'Handbook template', about: 'For new crews' });
  ok(r.status === 200 && r.body.pages === 3, `a doc and its pages saved as a template (${r.body.pages} pages inside)`);
  const tpl = r.body;
  const dir = (await rico('POST', '/dirs', { name: 'Rico only', private: true })).body;
  const priv = (await rico('POST', '/items', { type: 'text', doc: { title: 'PRIVATE plan', blocks: p('x') }, dirId: dir.id })).body;
  ok((await rico('POST', '/doc-templates', { docId: priv.id })).status === 403, 'a private doc can’t be a team template (everyone would see it)');
  ok((await sam('GET', '/doc-templates')).body.some((x) => x.id === tpl.id) && !(await olga('GET', '/doc-templates')).body.length, 'the team sees it; another team doesn’t');
  r = await sam('POST', `/doc-templates/${tpl.id}/use`, {});
  const top = r.body;
  const st = (await sam('GET', '/state')).body.items;
  const newPages = st.filter((x) => x.underId === top.id);
  ok(r.status === 200 && top.title === 'Handbook' && top.id !== A.id && newPages.length === 2 && newPages.every((x) => ![Bd.id, late.id].includes(x.id)), 'using it makes a new doc with new pages inside');
  const topB = (await sam('GET', `/items/${top.id}/doc`)).body.blocks;
  ok(topB.filter((b) => b.type === 'page').every((b) => newPages.some((x) => x.id === b.docId)), 'its page blocks point at its own new pages');
  const safety2 = newPages.find((x) => x.title === 'Safety');
  const sB = (await sam('GET', `/items/${safety2.id}/doc`)).body.blocks;
  ok(sB.some((b) => b.type === 'todo' && b.runs[0].text === 'Order brackets' && !b.taskId) && st.some((x) => x.underId === safety2.id && x.title === 'Ladders'), 'to-dos come without their tasks, and pages go all the way down');
  const empty = (await sam('POST', '/items', { type: 'text', doc: { title: '', blocks: [] } })).body;
  r = await sam('POST', `/doc-templates/${tpl.id}/use`, { into: empty.id, title: 'Crew B handbook' });
  ok(r.status === 200 && r.body.id === empty.id && r.body.title === 'Crew B handbook' && (await sam('GET', '/state')).body.items.filter((x) => x.underId === empty.id).length === 2, 'it can fill an empty doc that’s open, which keeps its place');
  ok((await sam('POST', `/doc-templates/${tpl.id}/use`, { into: A.id })).status === 400, 'but not a doc with words in it');
  ok((await olga('POST', `/doc-templates/${tpl.id}/use`, {})).status === 404, 'another team can’t use it');
  ok((await sam('DELETE', `/doc-templates/${tpl.id}`)).status === 403, 'only whoever saved it (or an admin) deletes it');
  ok((await rico('DELETE', `/doc-templates/${tpl.id}`)).status === 200 && !(await sam('GET', '/doc-templates')).body.length, 'deleted');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails) console.log('Server log:\n' + srv.log.slice(-3000));
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
