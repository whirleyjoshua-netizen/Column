// Docs, step 3: a project's list inside a doc (a view block), embeds (videos, maps, designs, Google docs) and a page's
// icon and cover. A view block names its project only to those who can see it: the doc's text says [Table] and a
// public link shows "A table in Kloomie". Only known services embed, from an https address; a public link shows an
// embed as a link, never a player. An icon is one emoji; a cover is a picture already in the team that the person
// can see, and changing either isn't an edit to the words.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { PNG } from './zipmake.mjs';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/docs_blocks';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4880, B = `http://127.0.0.1:${PORT}`;
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
export const EMBED_CASES = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/shorts/abcDEF12345', 'https://vimeo.com/76979871',
  'https://www.loom.com/share/0123456789abcdef0123456789abcdef', 'https://www.google.com/maps/place/Las+Vegas,+NV/@36.1,-115.1,11z', 'https://maps.google.com/maps?q=12+Main+St',
  'https://www.figma.com/design/AbCdEf1234567890/Site?node-id=1', 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit',
  'http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', 'https://evil.example/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.example/watch?v=x', 'https://www.youtube.com/watch?v=<script>', 'not a url',
];
const t = Date.now();
try {
  const NTm = await import('../server/notion.js');
  const got = EMBED_CASES.map((u) => NTm.embedSrc(u)?.src || null);
  ok(got.slice(0, 9).every(Boolean) && got.slice(9).every((x) => !x), `only known services over https embed (${got.filter(Boolean).length} of ${EMBED_CASES.length})`);
  ok(got[0] === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' && got[5].startsWith('https://maps.google.com/maps?q=Las%20Vegas') && got[8].endsWith('/preview'), 'each as its player’s address (YouTube without cookies, a map, a sheet’s preview)');
  fs.writeFileSync(DIR + '/embed-cases.json', JSON.stringify({ cases: EMBED_CASES, server: EMBED_CASES.map((u) => NTm.embedSrc(u)) }));
  const md = NTm.mdToBlocks('# T\n\n[https://youtu.be/dQw4w9WgXcQ](https://youtu.be/dQw4w9WgXcQ)\n\nhttps://vimeo.com/76979871\n\n[a site](https://example.com)\n', { id: () => Math.random().toString(36).slice(2, 10), link: (h) => ({ link: h }) });
  ok(md.blocks.map((b) => b.type).join() === 'embed,embed,p', 'from Notion, a video link on its own line is an embed; any other link stays a link');

  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Blocks ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ricoTok = r.body.token;
  const rico = call(ricoTok);
  const code = (await rico('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Blocks ' + t, code, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Olga', email: `olga${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const olgaTok = r.body.token;
  const ws = (await rico('GET', '/state')).body.workspace;
  await rico('PATCH', '/workspace', { tools: { ...ws.tools, projects: true } });
  const p = (await rico('POST', '/projects', { template: 'crm', name: 'SECRET-PIPELINE', private: true })).body;
  const T = p.types[0];
  await rico('POST', `/projects/${p.id}/records`, { typeId: T.id, values: { [T.primary]: 'SECRET-DEAL Smith' } });
  const doc = (await rico('POST', '/items', { type: 'text', doc: { title: 'Team page', blocks: [] } })).body;
  const ops = [
    { set: { id: 'v1', type: 'view', source: 'project', ref: p.id, sub: T.id, mode: 'board' } },
    { set: { id: 'v2', type: 'view', source: 'evil', ref: p.id }, after: 'v1' },
    { set: { id: 'e1', type: 'embed', url: 'https://youtu.be/dQw4w9WgXcQ' }, after: 'v1' },
    { set: { id: 'e2', type: 'embed', url: 'javascript:alert(1)' }, after: 'e1' },
    { set: { id: 'e3', type: 'embed', url: 'https://evil.example/x' }, after: 'e1' },
    { set: { id: 'e4', type: 'embed' }, after: 'e1' },
  ];
  r = await rico('PATCH', `/items/${doc.id}/doc`, { ops, sid: 's1' });
  let d = (await rico('GET', `/items/${doc.id}/doc`)).body;
  ok(r.status === 200 && d.blocks.map((b) => b.id).join() === 'v1,e1,e4', `a view and an embed (and an empty embed to paste into) are kept; the rest are dropped (${d.blocks.map((b) => b.id).join()})`);
  ok(d.blocks[0].mode === 'board' && d.blocks[0].sub === T.id, 'a view keeps its list and its board');
  const st = (await rico('GET', '/state')).body.items.find((x) => x.id === doc.id);
  ok(st.text.includes('[Table]') && !st.text.includes('SECRET') && st.text.includes('https://youtu.be/dQw4w9WgXcQ'), 'the doc’s text says [Table] (never the project’s name) and has the embed’s link');
  ok(st.refs.includes('project:' + p.id), 'the doc is listed as mentioning the project');
  const samDoc = (await sam('GET', `/items/${doc.id}/doc`)).body;
  ok(samDoc.blocks[0].type === 'view' && (await sam('GET', `/projects/${p.id}/records`)).status === 404, 'Sam sees the doc, but the private project’s records stay closed to him');
  r = await rico('POST', `/items/${doc.id}/share`, {});
  const tok = r.body.share.token;
  const page = await (await fetch(`${B}/s/${tok}`)).text();
  ok(page.includes('A table in Kloomie') && !page.includes('SECRET') && !page.includes('<iframe') && page.includes('href="https://youtu.be/dQw4w9WgXcQ"'), 'a public link shows “A table in Kloomie”, the embed as a link, no player and nothing from the project');

  // Icon and cover.
  const v0 = (await rico('GET', `/items/${doc.id}/doc`)).body.v;
  r = await rico('PATCH', `/items/${doc.id}/doc`, { icon: '🦺' });
  ok(r.status === 200 && r.body.icon === '🦺' && (await rico('GET', `/items/${doc.id}/doc`)).body.v === v0, 'an icon is set, and it isn’t a new version of the words');
  ok((await rico('PATCH', `/items/${doc.id}/doc`, { icon: 'abc' })).status === 400 && (await rico('PATCH', `/items/${doc.id}/doc`, { icon: '<b>' })).status === 400, 'an icon is one emoji, not words or markup');
  const up = async (tk, name, buf) => (await fetch(`${B}/api/upload?name=${encodeURIComponent(name)}`, { method: 'PUT', headers: { authorization: 'Bearer ' + tk }, body: buf })).json();
  const txt = await up(ricoTok, 'notes.txt', 'just words');
  const theirs = await up(olgaTok, 'olga.png', PNG);
  const pic = await up(ricoTok, 'site.png', PNG);
  ok((await rico('PATCH', `/items/${doc.id}/doc`, { cover: txt.id })).status === 400, 'a cover must be a picture');
  ok((await rico('PATCH', `/items/${doc.id}/doc`, { cover: theirs.id })).status === 400, 'and one from this team');
  r = await rico('PATCH', `/items/${doc.id}/doc`, { cover: pic.id });
  const item = (await rico('GET', '/state')).body.items.find((x) => x.id === doc.id);
  ok(r.status === 200 && item.cover === pic.id && item.icon === '🦺' && (await rico('GET', '/state')).body.items.find((x) => x.id === pic.id).pinned, 'a cover is set (and its picture kept)');
  const page2 = await (await fetch(`${B}/s/${tok}`)).text();
  ok(page2.includes('🦺') && page2.includes(`/s/${tok}/img/${pic.id}`) && (await fetch(`${B}/s/${tok}/img/${pic.id}`)).status === 200, 'the public link shows the icon and the cover');
  ok((await fetch(`${B}/s/${tok}/img/${txt.id}`)).status === 404, 'and no other file through it');
  r = await sam('PATCH', `/items/${doc.id}/doc`, { cover: null, icon: '' });
  const item2 = (await rico('GET', '/state')).body.items.find((x) => x.id === doc.id);
  ok(r.status === 200 && !item2.cover && !item2.icon, 'anyone who can edit the doc can take them off');
  await rico('PATCH', `/items/${doc.id}`, { locked: true });
  ok((await sam('PATCH', `/items/${doc.id}/doc`, { icon: '⭐' })).status === 403, 'not on a locked doc');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails) console.log('Server log:\n' + srv.log.slice(-3000));
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
