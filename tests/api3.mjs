import WebSocket from '../server/node_modules/ws/index.js';
const B = 'http://127.0.0.1:4797';
const call = (tok) => async (m, p, body) => { const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) { const e = new Error(p + ' ' + r.status + ' ' + JSON.stringify(j)); e.status = r.status; throw e; } return j; };
const team = 'dk4' + Date.now();
const auth = async (body) => (await (await fetch(B + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json());
const a = await auth({ workspace: team, password: 'secret1', name: 'Jo', mode: 'create', device: 'x', deviceId: 'd1' });
const A = call(a.token);
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const st = await A('GET', '/state');
const b = await auth({ workspace: team, password: 'secret2', name: 'Sam', mode: 'join', code: st.workspace.inviteCode, device: 'y', deviceId: 'd2' });
const Bc = call(b.token);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const heardB = [], heardA = [];
const wsB = new WebSocket(`ws://127.0.0.1:4797/ws?t=${b.token}`);
const wsA = new WebSocket(`ws://127.0.0.1:4797/ws?t=${a.token}`);
wsB.on('message', (d) => heardB.push(JSON.parse(d)));
wsA.on('message', (d) => heardA.push(JSON.parse(d)));
await Promise.all([new Promise((r) => wsB.on('open', r)), new Promise((r) => wsA.on('open', r))]);
const d = await A('POST', '/items', { type: 'text', doc: { title: 'Offer <script>alert(1)</script>', blocks: [{ id: 'a', type: 'p', runs: [{ text: 'Version one <b>' }] }] } });
// history
await A('PATCH', `/items/${d.id}/doc`, { ops: [{ set: { id: 'a', type: 'p', runs: [{ text: 'Jo edit' }] } }] });
await Bc('PATCH', `/items/${d.id}/doc`, { ops: [{ set: { id: 'a', type: 'p', runs: [{ text: 'Sam edit' }] } }] });
await Bc('PATCH', `/items/${d.id}/doc`, { ops: [{ set: { id: 'a', type: 'p', runs: [{ text: 'Sam edit 2' }] } }] });
await sleep(300);
let hist = await A('GET', `/items/${d.id}/history`);
ok(hist.length === 2, 'two versions: before Jo started, and before Sam started: ' + hist.map((v) => v.by).join(','));
const v = await A('GET', `/items/${d.id}/history/${hist[0].id}`);
ok(v.blocks[0].runs[0].text === 'Jo edit' && v.by === 'Jo', 'the newest version is Jo’s doc before Sam changed it');
await A('PATCH', `/items/${d.id}/doc`, { ops: [{ set: v.blocks[0] }], restore: v.id });
await sleep(300);
hist = await A('GET', `/items/${d.id}/history`);
ok(hist.length === 3 && (await A('GET', `/items/${d.id}/doc`)).blocks[0].runs[0].text === 'Jo edit', 'restoring keeps the replaced version first');
// share
const pic = await (await fetch(B + `/api/upload?name=p.png&type=image/png`, { method: 'PUT', headers: { authorization: 'Bearer ' + a.token }, body: Buffer.from('89504e470d0a1a0a', 'hex') })).json();
const other = await (await fetch(B + `/api/upload?name=q.png&type=image/png`, { method: 'PUT', headers: { authorization: 'Bearer ' + a.token }, body: Buffer.from('89504e470d0a1a0a', 'hex') })).json();
await A('PATCH', `/items/${d.id}/doc`, { ops: [{ set: { id: 'f', type: 'file', itemId: pic.id, name: 'p.png' }, after: 'a' }, { set: { id: 'l', type: 'live', source: 'campaign', ref: 'x1' }, after: 'f' }, { set: { id: 'h', type: 'h1', runs: [{ text: 'Price', b: true }, { text: ' link', link: 'https://x.com' }] }, after: 'l' }] });
let sh = await A('POST', `/items/${d.id}/share`, { hours: 0, live: { l: ['Fleet push: 40% done', 'Book 5 demos: 2 / 5'] } });
const tok = sh.share.token;
let page = await (await fetch(B + `/s/${tok}`)).text();
ok(page.includes('Offer &lt;script&gt;') && !page.includes('<script>alert'), 'the title is escaped on the shared page');
ok(page.includes('Version one') === false && page.includes('Jo edit') && page.includes('Fleet push: 40% done') && page.includes(`/s/${tok}/img/${pic.id}`) && page.includes('<h2><b>Price</b><a href="https://x.com"'), 'the shared page shows the doc, its numbers as shared, and its picture');
ok((await fetch(B + `/s/${tok}/img/${pic.id}`)).status === 200, 'a picture in the doc loads through the link');
ok((await fetch(B + `/s/${tok}/img/${other.id}`)).status === 404, 'a picture not in the doc doesn’t');
sh = await A('POST', `/items/${d.id}/share`, { hours: 24, live: { l: ['Fleet push: 60% done'] } });
ok(sh.share.token === tok && (await (await fetch(B + `/s/${tok}`)).text()).includes('60% done'), 'sharing again keeps the link and updates the numbers');
await A('DELETE', `/items/${d.id}/share`);
ok((await fetch(B + `/s/${tok}`)).status === 404, 'turning it off stops the link');
// comments
heardB.length = 0;
const cm = await A('POST', `/items/${d.id}/comments`, { blockId: 'a', quote: 'Jo edit', text: 'Can you check this @Sam?' });
await sleep(200);
ok(heardB.some((m) => m.type === 'comment:mention' && m.by === 'Jo'), 'Sam is told about the @mention in a comment');
ok(heardB.some((m) => m.type === 'item:update' && m.item.id === d.id && m.item.openComments === 1), 'the doc card shows 1 open comment');
await Bc('POST', `/comments/${cm.id}/replies`, { text: 'Done' });
let list = await A('GET', `/items/${d.id}/comments`);
ok(list[0].replies[0].by === 'Sam' && list[0].quote === 'Jo edit', 'reply added under the comment');
try { await Bc('DELETE', `/comments/${cm.id}`); ok(false, 'Sam can’t delete Jo’s comment'); } catch (e) { ok(e.status === 403, 'Sam can’t delete Jo’s comment'); }
await Bc('PATCH', `/comments/${cm.id}`, { resolved: true });
const card = (await A('GET', '/state')).items.find((x) => x.id === d.id);
ok(card.openComments === 0, 'resolving clears the count');
// lock
try { await Bc('PATCH', `/items/${d.id}`, { locked: true }); ok(false, 'Sam can’t lock Jo’s doc'); } catch (e) { ok(e.status === 403, 'Sam (not owner, didn’t make it) can’t lock it'); }
await A('PATCH', `/items/${d.id}`, { locked: true });
try { await Bc('PATCH', `/items/${d.id}/doc`, { ops: [{ del: 'a' }] }); ok(false, 'locked'); } catch (e) { ok(e.status === 403, 'a locked doc refuses Sam’s edits'); }
await A('PATCH', `/items/${d.id}/doc`, { ops: [{ set: { id: 'a', type: 'p', runs: [{ text: 'owner can' }] } }] });
ok(true, 'its maker can still edit it');
await Bc('POST', `/items/${d.id}/comments`, { text: 'comments still work' });
ok((await A('GET', `/items/${d.id}/comments`)).length === 2, 'comments still work on a locked doc');
// presence
heardA.length = 0;
wsB.send(JSON.stringify({ type: 'doc:here', id: d.id, block: 'a' }));
await sleep(200);
const here = heardA.filter((m) => m.type === 'doc:here').at(-1);
ok(here?.people.some((p) => p.name === 'Sam' && p.block === 'a'), 'Jo sees Sam is in the doc, on block a');
wsB.close();
await sleep(300);
const gone = heardA.filter((m) => m.type === 'doc:here').at(-1);
ok(gone && !gone.people.some((p) => p.name === 'Sam'), 'Sam leaves when his window closes');
// deleting the doc takes its comments and history
await A('DELETE', `/items/${d.id}`);
await sleep(200);
const fs = await import('node:fs');
ok(!fs.existsSync(process.argv[2] + `/dk/data/files/dochist-${d.id}.json`), 'deleting the doc removes its history');
wsA.close();
