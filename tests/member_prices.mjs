// Members don't see prices or costs (docs/jobflows/PRICES.md). Owners and admins see price lines, a Price list's
// money fields and formulas or rollups over them; members get what and how many, "—" for the rest, no quote link,
// on every path (records, live updates, the timeline, the price list, the AI estimate, the export, the public API).
// Members can't write a price (all or nothing); what the server copies itself still copies; role changes count
// from the next read and the next live update; automations act as their maker, checked when they run.
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/member_prices';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5261, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
const env = { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1', NODE_ENV: 'test' };
let srv;
const start = async () => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return true; } catch {} await sleep(150); }
  return false;
};
const stop = async () => { srv.kill(); await new Promise((r) => srv.once('exit', r)); };
if (!(await start())) { console.log('FAIL the server didn’t start\n' + srv.log.slice(-2000)); process.exit(1); }
const call = (tok, pre = '/api') => async (m, p, body) => {
  const r = await fetch(B + pre + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const sockets = [];
const listen = (tok) => {
  const heard = [];
  const s = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { authorization: 'Bearer ' + tok } });
  s.on('message', (d) => { try { heard.push(JSON.parse(d)); } catch {} });
  sockets.push(s);
  return { heard, ready: new Promise((r) => s.once('open', r)) };
};
const t = Date.now();
// A record's price lines, as a member must see them: what and how many, nothing else.
const ITEM_KEYS = ['desc', 'id', 'qty', 'unit'];
const memberLines = (v) => !!v && v.hidden === true && Array.isArray(v.rows) && v.rows.length > 0 && v.rows.every((r) => Object.keys(r).every((k) => ITEM_KEYS.includes(k)) && typeof r.desc === 'string') && Object.keys(v).every((k) => ['rows', 'hidden'].includes(k));
const PRICE = 4321.77, COST = 1234.56; // distinctive, to look for anywhere in a member's copy
const leaks = (x) => { const s = JSON.stringify(x ?? null); return /432177|4321\.77|4,321\.77|123456|1234\.56|1,234\.56|864354|8643\.54|8,643\.54|869354|8693\.54|8,693\.54|1733708|17337\.08|17,337\.08/.test(s); };
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Prices ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ricoTok = r.body.token, rico = call(ricoTok);
  let st = (await rico('GET', '/state')).body;
  const join = async (name, n) => (await call()('POST', '/auth', { mode: 'join', workspace: 'Prices ' + t, code: st.workspace.inviteCode, name, email: `${name.split(' ')[0].toLowerCase()}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n })).body.token;
  const adaTok = await join('Ada Admin', 2), samTok = await join('Sam Reed', 3), miaTok = await join('Mia Cruz', 4);
  const ada = call(adaTok), sam = call(samTok), mia = call(miaTok);
  st = (await rico('GET', '/state')).body;
  const idOf = (name) => st.workspace.members.find((m) => m.name === name)?.id;
  await rico('PATCH', '/members/' + idOf('Ada Admin'), { role: 'admin' });
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, bills: true } });

  // The board: quotes with price lines (with cost), a Price list, a formula over the line total, a rollup of it
  // from Jobs, and Jobs' own Value (a money field that isn't a price).
  const board = (await rico('POST', '/projects', { template: 'bids', name: 'Estimating' })).body;
  const T = (k) => board.types.find((x) => x.key === k);
  const F = (tk, fk) => T(tk).fields.find((f) => f.key === fk);
  const qT = T('quotes'), jT = T('jobs'), plT = T('price_list');
  let y = await rico('POST', `/projects/${board.id}/schema`, { typeId: qT.id, op: 'addField', name: 'Twice', type: 'formula', expr: '{Line items} * 2', format: 'money' });
  ok(y.status === 200, 'a formula over the line total: ' + y.status + ' ' + (y.body?.error || ''));
  let proj = (await rico('GET', '/projects')).body.find((p) => p.id === board.id);
  const twiceF = proj.types.find((x) => x.id === qT.id).fields.find((f) => f.name === 'Twice');
  y = await rico('POST', `/projects/${board.id}/schema`, { typeId: jT.id, op: 'addField', name: 'Quoted', type: 'rollup', via: F('jobs', 'quote').id, of: F('quotes', 'items').id, fn: 'sum' });
  ok(y.status === 200, 'a rollup of the quote’s total from Jobs: ' + y.status + ' ' + (y.body?.error || ''));
  y = await rico('POST', `/projects/${board.id}/schema`, { typeId: jT.id, op: 'addField', name: 'Quoted twice', type: 'rollup', via: F('jobs', 'quote').id, of: twiceF.id, fn: 'sum' });
  proj = (await rico('GET', '/projects')).body.find((p) => p.id === board.id);
  const quotedF = proj.types.find((x) => x.id === jT.id).fields.find((f) => f.name === 'Quoted');
  const quoted2F = proj.types.find((x) => x.id === jT.id).fields.find((f) => f.name === 'Quoted twice');
  const lines = (price = PRICE) => ({ rows: [{ desc: 'Shutters', qty: 2, unit: 'each', price, cost: COST }, { desc: 'Trip', qty: 1, price: 50 }], taxRate: 0 });
  const quote = (await rico('POST', `/projects/${board.id}/records`, { typeId: qT.id, values: { title: 'Ruiz shutters', items: lines() } })).body;
  const job = (await rico('POST', `/projects/${board.id}/records`, { typeId: jT.id, values: { job: 'Ruiz install', value: 9000, quote: [quote.id] } })).body;
  const film = (await rico('POST', `/projects/${board.id}/records`, { typeId: plT.id, values: { item: 'Window film', price: PRICE, cost: COST } })).body;
  ok(quote?.id && job?.id && film?.id, 'the records are made');

  const recs = async (C) => (await C('GET', `/projects/${board.id}/records`)).body || [];
  const find = (list, id) => list.find((x) => x.id === id);

  // 1. Board records: owners and admins get the prices, members the redacted shape.
  for (const [who, C] of [['the owner', rico], ['an admin', ada]]) {
    const L = await recs(C);
    const q = find(L, quote.id), j = find(L, job.id), f = find(L, film.id);
    ok(q?.values[F('quotes', 'items').id]?.rows?.[0]?.price != null && q.values[F('quotes', 'items').id].rows[0].cost != null && !q.values[F('quotes', 'items').id].hidden, `${who} gets the price lines with price and cost`);
    ok(q?.values[twiceF.id] != null && j?.values[quotedF.id] != null && j?.values[quoted2F.id] != null, `${who} gets the formula and both rollups`);
    ok(f?.values[F('price_list', 'price').id] != null && f?.values[F('price_list', 'cost').id] != null, `${who} gets the Price list’s price and cost`);
  }
  for (const [who, C] of [['a member', sam]]) {
    const L = await recs(C);
    const q = find(L, quote.id), j = find(L, job.id), f = find(L, film.id);
    ok(memberLines(q?.values[F('quotes', 'items').id]), `${who} gets the price lines as what and how many only: ` + JSON.stringify(q?.values[F('quotes', 'items').id]).slice(0, 200));
    ok(q?.values[twiceF.id] == null && (q?.hiddenFields || []).includes(twiceF.id), `${who}: the formula over prices is empty and listed in hiddenFields`);
    ok(j?.values[quotedF.id] == null && j?.values[quoted2F.id] == null && (j?.hiddenFields || []).includes(quotedF.id) && (j?.hiddenFields || []).includes(quoted2F.id), `${who}: both rollups (straight and through the formula) are empty and listed`);
    ok(f?.values[F('price_list', 'price').id] == null && f?.values[F('price_list', 'cost').id] == null && (f?.hiddenFields || []).includes(F('price_list', 'price').id), `${who}: the Price list’s price and cost are empty and listed`);
    ok(j?.values[F('jobs', 'value').id] != null, `${who} still gets the job’s Value (not a price)`);
    ok(!leaks([q, j, f]), `${who}: no price or cost anywhere in the records`);
  }

  // 2. Live updates: one change, the member's socket and the admin's socket.
  const samL = listen(samTok), adaL = listen(adaTok);
  await Promise.all([samL.ready, adaL.ready]);
  await rico('PATCH', `/records/${quote.id}`, { values: { items: lines(PRICE * 2) } });
  await until(() => samL.heard.some((m) => m.type === 'record' && m.record?.id === quote.id) && adaL.heard.some((m) => m.type === 'record' && m.record?.id === quote.id));
  const sHeard = samL.heard.filter((m) => m.type === 'record' && m.record?.id === quote.id).at(-1);
  const aHeard = adaL.heard.filter((m) => m.type === 'record' && m.record?.id === quote.id).at(-1);
  ok(sHeard && memberLines(sHeard.record.values[F('quotes', 'items').id]) && !leaks(sHeard), 'the member’s live update has no prices');
  ok(aHeard && aHeard.record.values[F('quotes', 'items').id]?.rows?.[0]?.price != null, 'the admin’s live update for the same change has them');
  ok(!samL.heard.some((m) => leaks(m)), 'nothing the member’s socket heard carries a price');

  // 3. The timeline: a price change reads "changed" for members, in full for admins; other fields in full.
  await rico('PATCH', `/records/${quote.id}`, { values: { terms: 'Net 30' } });
  const logOf = async (C) => (await C('GET', `/records/${quote.id}/log`)).body || [];
  let sLog = await logOf(sam), aLog = await logOf(ada);
  const priceEntry = (L) => L.find((e) => e.kind === 'change' && e.field === 'Line items');
  ok(priceEntry(aLog) && /\$/.test(priceEntry(aLog).to), 'the admin’s timeline shows the price lines change with amounts: ' + JSON.stringify(priceEntry(aLog)));
  ok(priceEntry(sLog) && priceEntry(sLog).from === '' && priceEntry(sLog).to === 'changed', 'the member’s shows it as changed, no amounts: ' + JSON.stringify(priceEntry(sLog)));
  ok(sLog.some((e) => e.kind === 'change' && e.field === 'Terms' && e.to === 'Net 30'), 'a change to another field shows in full for the member');
  ok(!leaks(sLog), 'nothing in the member’s timeline carries a price');
  ok(samL.heard.filter((m) => m.type === 'record:log').every((m) => !leaks(m)), 'nor the timeline’s live updates');
  // A renamed priced field: the old entry still reads "changed".
  await rico('POST', `/projects/${board.id}/schema`, { typeId: qT.id, op: 'updateField', fieldId: F('quotes', 'items').id, name: 'Lines' });
  sLog = await logOf(sam);
  ok(!leaks(sLog), 'after the price field is renamed, its old entries still carry no amounts for the member');

  // Entries from before this change (no fieldId), read after a restart: matched by name, fail-closed.
  await stop();
  const dbFile = DIR + '/db.json';
  const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const qrec = data.records[quote.id];
  for (const e of qrec.log || []) delete e.fieldId;
  qrec.log.push({ id: 'legacy1', kind: 'change', field: 'Gone field', from: '$1.00', to: '$4,321.77', by: 'Rico Vega', at: Date.now() });
  qrec.log.push({ id: 'legacy2', kind: 'change', field: 'Terms', from: 'Net 30', to: 'Net 15', by: 'Rico Vega', at: Date.now() });
  fs.writeFileSync(dbFile, JSON.stringify(data));
  await start();
  sLog = await logOf(sam);
  ok(!leaks(sLog), 'older entries with no field id: none carries an amount for the member (a renamed or deleted field reads changed)');
  ok(sLog.find((e) => e.id === 'legacy1')?.to === 'changed', 'an entry naming a field that no longer exists reads changed');
  ok(sLog.find((e) => e.id === 'legacy2')?.to === 'Net 15', 'an older entry naming a field that is plainly not a price shows in full');
  aLog = await logOf(ada);
  ok(aLog.find((e) => e.id === 'legacy1')?.to === '$4,321.77', 'the admin still sees the old entry as it was');

  // 4. The quote link: members never get it and can't make or remove one.
  r = await rico('POST', `/records/${quote.id}/share`, {});
  const token = r.body?.share?.token;
  ok(!!token, 'the owner makes the quote link');
  ok(!find(await recs(sam), quote.id)?.share, 'the member’s copy of the quote has no link');
  ok((await sam('POST', `/records/${quote.id}/share`, {})).status === 403 && (await sam('DELETE', `/records/${quote.id}/share`)).status === 403, 'a member can’t make or remove the quote link (403)');
  ok(find(await recs(rico), quote.id)?.share?.token === token, 'and the link the owner made is untouched');
  // A customer answering: the member hears that it was answered, without the total.
  const samL2 = listen(samTok), adaL2 = listen(adaTok);
  await Promise.all([samL2.ready, adaL2.ready]);
  const html = await (await fetch(`${B}/q/${token}`)).text();
  const v = html.match(/name="v" value="([^"]+)"/)?.[1];
  await fetch(`${B}/q/${token}/accept`, { method: 'POST', body: new URLSearchParams({ name: 'Dana Ruiz', v: v || '' }), redirect: 'manual' });
  await until(() => adaL2.heard.some((m) => m.type === 'quote:answer'));
  const sAns = samL2.heard.find((m) => m.type === 'quote:answer'), aAns = adaL2.heard.find((m) => m.type === 'quote:answer');
  ok(aAns && aAns.total != null, 'the admin hears the answer with its total');
  ok(sAns && sAns.total === undefined && !leaks(sAns), 'the member hears it without the total: ' + JSON.stringify(sAns || null).slice(0, 160));
  ok(!samL2.heard.some((m) => leaks(m)), 'nothing else the member heard about it carries a price');

  // 5. The price list, the AI estimate.
  ok(((await sam('GET', '/price-list')).body?.items || []).length === 0, 'a member’s price list is empty');
  ok(((await rico('GET', '/price-list')).body?.items || []).some((x) => x.name === 'Window film' && x.price != null), 'the owner’s still has the board’s items');
  ok((await sam('POST', '/ai/estimate', { recordId: quote.id })).status === 403, 'a member can’t ask the AI for an estimate (403)');
  ok((await rico('POST', '/ai/estimate', { recordId: quote.id })).status !== 403, 'an owner isn’t refused for being an owner');

  // 6. Writes: members can't set or change a price, all or nothing; other changes still work and keep the lines.
  const q2 = (await rico('POST', `/projects/${board.id}/records`, { typeId: qT.id, values: { title: 'Second quote', items: lines() } })).body;
  const qBefore = find(await recs(rico), q2.id);
  r = await sam('PATCH', `/records/${q2.id}`, { values: { items: lines(1), terms: 'Sam was here' } });
  let qAfter = find(await recs(rico), q2.id);
  ok(r.status === 403 && JSON.stringify(qAfter.values[F('quotes', 'items').id]) === JSON.stringify(qBefore.values[F('quotes', 'items').id]) && qAfter.values[F('quotes', 'terms').id] !== 'Sam was here', 'a member changing price lines: 403, and nothing in that write saved: ' + r.status);
  const filmPrice = find(await recs(rico), film.id).values[F('price_list', 'price').id];
  r = await sam('PATCH', `/records/${film.id}`, { values: { price: 1 } });
  ok(r.status === 403 && find(await recs(rico), film.id).values[F('price_list', 'price').id] === filmPrice, 'a member changing a Price list’s price: 403, unchanged: ' + r.status);
  r = await sam('POST', `/projects/${board.id}/records`, { typeId: qT.id, values: { title: 'Sam quote', items: lines(1) } });
  ok(r.status === 403 && !(await recs(rico)).some((x) => x.values[F('quotes', 'title').id] === 'Sam quote'), 'a member adding a record with price lines: 403, nothing made');
  r = await sam('POST', `/projects/${board.id}/records`, { typeId: plT.id, values: { item: 'Sam item', cost: 1 } });
  ok(r.status === 403 && !(await recs(rico)).some((x) => x.values[F('price_list', 'item').id] === 'Sam item'), 'or a Price list item with a cost: 403, nothing made');
  r = await sam('POST', `/projects/${board.id}/import`, { typeId: plT.id, rows: [{ [F('price_list', 'item').id]: 'Imported', [F('price_list', 'price').id]: 5 }] });
  ok(r.status === 403 && !(await recs(rico)).some((x) => x.values[F('price_list', 'item').id] === 'Imported'), 'a member importing rows with prices: 403, nothing added');
  r = await sam('PATCH', `/records/${q2.id}`, { values: { terms: 'Net 10' } });
  qAfter = find(await recs(rico), q2.id);
  ok(r.status === 200 && memberLines(r.body?.values?.[F('quotes', 'items').id]) && !leaks(r.body), 'a member changing another field: saved, and the answer has no prices');
  ok(JSON.stringify(qAfter.values[F('quotes', 'items').id]) === JSON.stringify(qBefore.values[F('quotes', 'items').id]) && qAfter.values[F('quotes', 'terms').id] === 'Net 10', 'and the price lines are exactly as they were');
  r = await sam('POST', `/projects/${board.id}/records`, { typeId: qT.id, values: { title: 'Sam plain quote' } });
  ok(r.status === 200 && !leaks(r.body), 'a member can still add a record without prices');

  // 7. The export: a member's own export has no prices; the owner's team export does.
  await sam('PATCH', `/records/${r.body.id}`, { values: { terms: 'mine' } });
  await rico('PATCH', `/records/${r.body.id}`, { values: { items: lines() } });
  const exportOf = async (C, tok, kind) => {
    await C('POST', '/exports', { kind });
    let x;
    for (let i = 0; i < 80 && !(x && x.status !== 'building'); i++) { x = ((await C('GET', '/exports')).body?.exports || []).find((e) => e.kind === kind); if (!x || x.status === 'building') await sleep(250); }
    const res = await fetch(`${B}/api/exports/${x?.id}/file`, { headers: { authorization: 'Bearer ' + tok } });
    const zip = `${DIR}/${kind}.zip`;
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    return execFileSync('unzip', ['-Z1', zip]).toString().trim().split('\n').map((n) => execFileSync('unzip', ['-p', zip, n]).toString()).join('\n');
  };
  const teamX = await exportOf(rico, ricoTok, 'team');
  ok(/432177/.test(teamX), 'the owner’s team export has the prices');
  const samX = await exportOf(sam, samTok, 'mine');
  ok(samX.length > 0 && !leaks(samX), 'the member’s own export has none');

  // 8. The public API: a key whose maker is now a member gets redacted records and can't write prices.
  r = await ada('POST', '/integrations/keys', { name: 'Ada key', write: true });
  const key = r.body?.key || r.body?.token || r.body?.secret;
  ok(!!key, 'an admin makes an API key: ' + r.status);
  const v1 = call(key, '/api/v1');
  const v1Quote = async () => (await v1('GET', `/projects/${board.id}/quotes/records/${quote.id}`)).body;
  let vq = await v1Quote();
  ok(vq?.fields?.items?.rows?.[0]?.price != null, 'while she’s an admin the key gets the prices');
  // An automation the admin made that sets a Price list's price when a job is added.
  r = await ada('POST', '/automations', { name: 'Reprice', trigger: { kind: 'record.created', projectId: board.id, typeId: plT.id }, actions: [{ kind: 'record', projectId: board.id, typeId: plT.id, set: [{ field: F('price_list', 'price').id, value: '77' }] }] });
  ok(r.status === 200, 'an admin can save an automation that sets a Price list price: ' + r.status + ' ' + (r.body?.error || ''));
  r = await sam('POST', '/automations', { name: 'Sam reprice', trigger: { kind: 'record.created', projectId: board.id, typeId: plT.id }, actions: [{ kind: 'record', projectId: board.id, typeId: plT.id, set: [{ field: F('price_list', 'price').id, value: '1' }] }] });
  ok(r.status >= 400 && r.status < 500, 'a member can’t: ' + r.status);
  await rico('PATCH', '/members/' + idOf('Ada Admin'), { role: 'member' });
  vq = await v1Quote();
  ok(vq && vq.fields && vq.fields.items?.hidden === true && !leaks(vq), 'the next request after she’s made a member: redacted: ' + JSON.stringify(vq?.fields?.items).slice(0, 160));
  r = await v1('PATCH', `/projects/${board.id}/price_list/records/${film.id}`, { fields: { price: 3 } });
  ok(r.status === 403, 'and a price write through the key is 403: ' + r.status);
  ok(memberLines(find(await recs(ada), quote.id)?.values[F('quotes', 'items').id]), 'her own app reads are redacted from the next read');
  // Her automation, run after she's a member: its Set is refused, nothing written. Sam (a member) triggers it.
  const before77 = (await recs(rico)).filter((x) => x.typeId === plT.id).map((x) => x.values[F('price_list', 'price').id]);
  await rico('POST', `/projects/${board.id}/records`, { typeId: plT.id, values: { item: 'Trigger', price: 10 } });
  await sleep(600);
  const after77 = (await recs(rico)).find((x) => x.values[F('price_list', 'item').id] === 'Trigger');
  ok(after77 && after77.values[F('price_list', 'price').id] !== 7700 && after77.values[F('price_list', 'price').id] !== 77, 'her automation, run once she’s a member, doesn’t write the price: ' + JSON.stringify(after77?.values[F('price_list', 'price').id]) + ' ' + before77.length);

  // 9. Role changes reach live updates too: Mia (member) made admin hears prices on the next update.
  const miaL = listen(miaTok);
  await miaL.ready;
  await rico('PATCH', '/members/' + idOf('Mia Cruz'), { role: 'admin' });
  ok(find(await recs(mia), quote.id)?.values[F('quotes', 'items').id]?.rows?.[0]?.price != null, 'a member made admin sees prices on the next read');
  await rico('PATCH', `/records/${quote.id}`, { values: { terms: 'Net 45' } });
  await until(() => miaL.heard.some((m) => m.type === 'record' && m.record?.id === quote.id && m.record.values[F('quotes', 'terms').id] === 'Net 45'));
  const mHeard = miaL.heard.filter((m) => m.type === 'record' && m.record?.id === quote.id).at(-1);
  ok(mHeard?.record?.values[F('quotes', 'items').id]?.rows?.[0]?.price != null, 'and on the next live update');
  const adaL3 = listen(adaTok);
  await adaL3.ready;
  await rico('PATCH', `/records/${quote.id}`, { values: { terms: 'Net 60' } });
  await until(() => adaL3.heard.some((m) => m.type === 'record' && m.record?.id === quote.id));
  ok(adaL3.heard.filter((m) => m.type === 'record').every((m) => !leaks(m)), 'an admin made a member hears no prices on the next live update');
} catch (e) {
  ok(false, 'threw: ' + (e.stack || e.message));
}
for (const s of sockets) try { s.close(); } catch {}
await stop();
if (fails) console.log(srv.log.slice(-1500));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
