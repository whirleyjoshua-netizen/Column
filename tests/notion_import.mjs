// Docs, step 2: bringing in a Notion export ("Markdown & CSV", a zip, here with its pages in a "Part-1" zip inside).
// Pages become docs with the pages inside them as pages inside (each where its link was), Notion's blocks become
// Kloomie's (callouts, toggles, to-dos, lists, tables, code, quotes, dividers), links between pages become mentions,
// pictures become files, and a database becomes tables in a doc (Jobs & projects off) or a project whose records link
// their pages (on). It goes into a new private folder; a failed import leaves nothing; the zip's names are only
// titles (a "../" name writes nothing outside); a file that inflates past the limit is refused while inflating.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/notion_import';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4874, B = `http://127.0.0.1:${PORT}`;
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
import { makeZip, notionZip, PNG, ID } from './zipmake.mjs';
const t = Date.now();
try {
  // Hostile pages are read quickly (one process serves everyone): 5 MB of marks that never close, and 5 MB of tiny
  // blocks, each well under a few seconds even on a busy machine.
  const NTm = await import('../server/notion.js');
  const L = (h) => (/^https?:/.test(h) ? { link: h } : null);
  const idf = () => Math.random().toString(36).slice(2, 10);
  let s0 = Date.now();
  NTm.mdToBlocks(('**[a](*_~~<u>`' + 'x'.repeat(30) + '\n').repeat(110_000).slice(0, 5 * 1024 * 1024), { id: idf, link: L });
  const slow1 = Date.now() - s0;
  s0 = Date.now();
  const many = NTm.mdToBlocks(('**[a](*_~~<u>`' + 'x'.repeat(20) + '\n\n- [ ] *b* \n    - c\n| a | b |\n| --- | --- |\n| 1 | 2 |\n').repeat(60_000).slice(0, 5 * 1024 * 1024), { id: idf, link: L });
  const slow2 = Date.now() - s0;
  ok(slow1 < 3000 && slow2 < 3000 && many.blocks.length === 5001, `hostile pages are read fast (${slow1} ms, ${slow2} ms) and stop at a doc's 5000 blocks`);
  ok(JSON.stringify(NTm.inline('**a** *b* `c` ~~d~~ [e](https://x.y/f(g)) snake_case_x', L).map((r) => Object.keys(r).filter((k) => k !== 'text').join('') || '-')) === JSON.stringify(['b', '-', 'i', '-', 'code', '-', 's', '-', 'link', '-']), 'marks and links are read as marks and links, and snake_case stays plain');
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Notion ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ricoTok = r.body.token;
  const rico = call(ricoTok);
  const code = (await rico('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Notion ' + t, code, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const samTok = r.body.token;
  const sam = call(samTok);
  const upload = async (tok, name, buf) => (await fetch(`${B}/api/upload?name=${encodeURIComponent(name)}`, { method: 'PUT', headers: { authorization: 'Bearer ' + tok }, body: buf })).json();
  const run = async (who, body) => {
    let j = (await who('POST', '/import/notion', body));
    if (j.status !== 200) return j;
    for (let i = 0; i < 200 && j.body.status === 'running'; i++) { await sleep(100); j = await who('GET', '/import/' + j.body.id); }
    return j;
  };
  const items = async (who) => (await who('GET', '/state')).body.items;
  const blocksOf = async (id) => (await rico('GET', `/items/${id}/doc`)).body.blocks;
  ok((await rico('GET', '/state')).body.workspace.tools.projects === false, '(setup) a new team starts without Jobs & projects');

  // Not a zip: it fails and leaves nothing.
  const junk = await upload(ricoTok, 'notes.zip', Buffer.from('not a zip at all'));
  const dirsBefore = (await rico('GET', '/state')).body.workspace.dirs.length;
  r = await run(rico, { itemId: junk.id });
  ok(r.body.status === 'failed' && /isn’t a zip/.test(r.body.error), `a file that isn’t a zip fails, saying how to export (${r.body.error})`);
  ok((await rico('GET', '/state')).body.workspace.dirs.length === dirsBefore, '…and leaves no folder behind');
  const z = await upload(ricoTok, 'Export-abc.zip', notionZip);
  ok((await sam('POST', '/import/notion', { itemId: z.id })).status === 404, 'only whoever uploaded the zip can bring it in');

  // The export, with Jobs & projects off.
  r = await run(rico, { itemId: z.id, private: true, projects: true });
  ok(r.body.status === 'done', `the export comes in (${r.body.status} ${r.body.error || ''})`);
  const rep = r.body.report;
  ok(rep.pages >= 6 && rep.tables === 1 && rep.rows === 3 && rep.files === 1, `the report counts it: ${JSON.stringify({ pages: rep.pages, tables: rep.tables, rows: rep.rows, files: rep.files })}`);
  ok(rep.notes.some((n) => /too big/.test(n)) && rep.notes.some((n) => /tables because Projects is off/.test(n)), 'and says what it couldn’t: the huge page, and databases as tables');
  const ws = (await rico('GET', '/state')).body.workspace;
  const dir = ws.dirs.find((d) => d.id === r.body.dirId);
  ok(dir && dir.private && /^From Notion/.test(dir.name), 'it goes into a new private folder');
  let all = await items(rico);
  const by = (title) => all.find((x) => x.type === 'text' && x.title === title && x.dirId === dir.id);
  const hb = by('Handbook'), pricing = by('Pricing'), safety = by('Safety'), jobs = by('Jobs'), ideas = by('Ideas'), smith = by('Smith job');
  ok(hb && !hb.underId && ideas && !ideas.underId, 'top pages are top docs');
  ok(pricing?.underId === hb.id && safety?.underId === hb.id && jobs?.underId === hb.id, 'the pages inside the handbook are pages inside it');
  ok(smith?.underId === jobs.id && !by('Jones job'), 'a database row with words in its page is a page inside the table’s doc; an empty one isn’t kept');
  ok(!all.some((x) => x.title === 'Huge'), 'the page that inflates past the limit isn’t brought in');
  const evil = by('Evil');
  ok(evil && !fs.existsSync(S + '/evil ' + ID('8') + '.md') && !fs.existsSync(DIR + '/../evil ' + ID('8') + '.md'), 'a “../” name is only a title: nothing written outside');
  ok(!all.some((x) => x.id === z.id), 'the zip is removed once it’s in');

  // The handbook's blocks.
  const hbB = await blocksOf(hb.id);
  const types = hbB.map((b) => b.type).join(',');
  ok(types === 'p,callout,page,todo,todo,ul,ol,ol,table,code,quote,divider,file,page,page', `the handbook’s blocks (Pricing, linked only in a sentence, gets its page block at the end): ${types}`);
  ok(hbB[14].docId === pricing.id, '…that last one is Pricing');
  const p0 = hbB[0].runs;
  ok(p0.some((x) => x.text === 'our' && x.b) && p0.some((x) => x.link === 'https://example.com/guide') && p0.some((x) => x.ref?.k === 'doc' && x.ref.id === pricing.id), 'bold, an outside link, and a link to another page as a mention');
  ok(hbB[1].emoji === '💡' && hbB[1].runs[0].text === 'Read this first', 'a callout with its emoji');
  ok(hbB[2].docId === safety.id && hbB[13].docId === jobs.id, 'each page inside sits where its link was');
  ok(!hbB[3].checked && hbB[4].checked && hbB[5].indent === 1, 'to-dos, ticked or not, and a nested item');
  ok(hbB[8].header && hbB[8].rows.length === 2 && hbB[8].rows[1][1][0].text === '$120', 'a table with its header');
  ok(hbB[9].lang === 'js' && hbB[9].runs[0].text === 'let x = 1', 'code with its language');
  const pic = all.find((x) => x.id === hbB[12].itemId);
  ok(pic?.type === 'file' && pic.name === 'photo.png' && pic.size === PNG.length && pic.dirId === dir.id, 'the picture is a file in the folder');
  ok((await fetch(`${B}/api/files/${pic.id}`, { headers: { authorization: 'Bearer ' + ricoTok } })).status === 200, '…and opens');
  ok(pricing.refs?.includes('doc:' + hb.id), 'the link back from Pricing is a mention, so the handbook is “Linked from” it');
  ok(ideas.refs?.includes('doc:' + pricing.id), 'a notion.so address to a page in the export is a mention too');
  const sB = await blocksOf(safety.id);
  ok(sB[0].type === 'toggle' && sB[0].runs[0].text === 'Ladders' && sB[1].type === 'p' && sB[1].indent === 1 && sB[2].runs[0].text === 'After the toggle' && !sB[2].indent, 'a toggle with what’s inside it, and what comes after');
  const jB = await blocksOf(jobs.id);
  ok(jB[0].type === 'table' && jB[0].rows.length === 4 && jB[0].rows[0][0][0].text === 'Name' && jB.some((b) => b.type === 'page' && b.docId === smith.id), 'the database as a table, with its row pages listed');
  ok((await blocksOf(smith.id)).map((b) => b.runs?.[0]?.text).join() === 'Customer wants white shutters.', 'a row page keeps its words, not its property lines');
  const samSees = new Set((await items(sam)).map((x) => x.id));
  ok(![hb, pricing, safety, jobs, pic].some((x) => samSees.has(x.id)), 'nobody else sees a private import');

  // Again with Jobs & projects on: the database is a project.
  await rico('PATCH', '/workspace', { tools: { ...ws.tools, projects: true } });
  const z2 = await upload(ricoTok, 'Export-abc.zip', notionZip);
  r = await run(rico, { itemId: z2.id, private: false, projects: true, name: 'Team wiki' });
  ok(r.body.status === 'done' && r.body.report.projects === 1, 'with Jobs & projects on, the database comes in as a project');
  const ws2 = (await rico('GET', '/state')).body.workspace;
  const dir2 = ws2.dirs.find((d) => d.id === r.body.dirId);
  ok(dir2?.name === 'Team wiki' && !dir2.private, 'into a team folder, named as asked');
  all = await items(rico);
  const jobs2 = all.find((x) => x.title === 'Jobs' && x.dirId === dir2.id);
  const smith2 = all.find((x) => x.title === 'Smith job' && x.dirId === dir2.id);
  const view = (await blocksOf(jobs2.id)).find((b) => b.type === 'view');
  const projects = (await rico('GET', '/projects')).body;
  const p = projects.find((x) => x.id === view?.ref);
  ok(p?.name === 'Jobs' && !p.private, 'the table’s doc shows the project');
  const T = p.types[0];
  const F = (n) => T.fields.find((f) => f.name === n);
  ok(F('Status').type === 'select' && F('Due').type === 'date' && F('Amount').type === 'money' && F('Done').type === 'checkbox' && F('Email').type === 'email', `columns become fields of the right kind (${T.fields.map((f) => f.name + ':' + f.type).join(', ')})`);
  const recs = (await rico('GET', `/projects/${p.id}/records`)).body;
  const sr = recs.find((x) => x.values[T.primary] === 'Smith job');
  ok(recs.length === 3 && sr.values[F('Due').id] === '2026-11-11' && sr.values[F('Amount').id] === 120000 && sr.values[F('Done').id] === true && F('Status').choices.find((c) => c.id === sr.values[F('Status').id])?.label === 'Booked', 'each row is a record with its values (money in cents, as everywhere)');
  ok(sr.docId === smith2.id, 'and a row’s page is its record’s doc');
  ok(new Set((await items(sam)).map((x) => x.id)).has(jobs2.id), 'a team import is seen by the team');

  // Make it a doc: a Markdown file becomes a doc beside it.
  const md = await upload(samTok, 'Install steps.md', '# Install steps\n\n## Before\n\n- Measure twice\n- [ ] Order brackets\n\nSee [the guide](https://example.com/g) and [a page](Other%20page.md).\n');
  r = await sam('POST', '/import/markdown', { itemId: md.id });
  const mb = r.status === 200 && (await sam('GET', `/items/${r.body.id}/doc`)).body;
  ok(r.status === 200 && mb.title === 'Install steps' && mb.blocks.map((b) => b.type).join() === 'h2,ul,todo,p' && r.body.stackId === md.stackId, 'a Markdown file becomes a doc beside it, with its headings, lists and to-dos');
  ok(mb.blocks[3].runs.some((x) => x.link === 'https://example.com/g') && !mb.blocks[3].runs.some((x) => x.text === 'a page' && x.link), 'its web links stay links; a link to a file that isn’t there is just its words');
  ok((await sam('GET', '/state')).body.items.some((x) => x.id === md.id), 'the file stays');
  const png = await upload(samTok, 'pic.png', PNG);
  ok((await sam('POST', '/import/markdown', { itemId: png.id })).status === 400, 'only Markdown and text files');

  // A restart while an import is part-way: what it had made (still marked) is taken out at start, nothing else.
  srv.kill();
  await sleep(800);
  const dbFile = DIR + '/db.json';
  const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  for (const x of Object.values(data.items)) if (x.dirId === dir2.id) x.importing = 'cut';
  data.projects[p.id].importing = 'cut';
  const wsRec = Object.values(data.workspaces).find((w) => w.dirs?.some((d) => d.id === dir2.id));
  wsRec.dirs.find((d) => d.id === dir2.id).importing = 'cut';
  fs.writeFileSync(dbFile, JSON.stringify(data));
  const srv2 = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log2 = ''; srv2.stdout.on('data', (d) => (log2 += d));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
  const after = await items(rico);
  const st3 = (await rico('GET', '/state')).body;
  ok(/unfinished import/.test(log2) && !after.some((x) => x.id === jobs2.id) && !st3.workspace.dirs.some((d) => d.id === dir2.id) && !(await rico('GET', '/projects')).body.some((x) => x.id === p.id), 'after a restart, an unfinished import’s doc, folder and project are gone');
  ok(after.some((x) => x.id === hb.id) && after.some((x) => x.id === pricing.id) && !after.some((x) => x.id === smith2.id), '…and the first import, finished, is all still there');
  srv2.kill();
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails) console.log('Server log:\n' + srv.log.slice(-3000));
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
