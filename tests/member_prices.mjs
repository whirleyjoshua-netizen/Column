// Members don't see prices or costs (docs/jobflows/PRICES.md). Owners and admins see price lines, a Price list's
// money fields and formulas or rollups over them; members get what and how many, "—" for the rest, no quote link,
// on every path (records, live updates, the timeline, the price list, the AI estimate, the export, the public API).
// Members can't write a price (all or nothing); what the server copies itself still copies; role changes count
// from the next read and the next live update; automations act as their maker, checked when they run.
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import http from 'node:http';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/member_prices';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5261, B = `http://127.0.0.1:${PORT}`;
// A stand-in AI (port 5262): keeps every request it gets; answers an estimate, a next step, an agent's RUN: script.
const AI_PORT = 5262, F = `http://127.0.0.1:${AI_PORT}`;
let aiSaw = [];
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const out = (x) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(x)); };
    if (req.url.startsWith('/v1/models')) return out({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false });
    aiSaw.push(b);
    const j = JSON.parse(b || '{}');
    const reply = (content, stop = 'end_turn') => out({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
    const all = JSON.stringify(j);
    if (all.includes('{\\"rows\\":[{\\"desc')) return reply([{ type: 'text', text: JSON.stringify({ rows: [{ desc: 'Hinges', qty: 4, unit: 'each', from: null, price: 3, cost: null }], assumptions: [], questions: [] }) }]);
    if (all.includes('{\\"answer\\":')) return reply([{ type: 'text', text: JSON.stringify({ answer: 'It is for shutters.', used: [1] }) }]);
    if (all.includes('{\\"read\\":')) return reply([{ type: 'text', text: JSON.stringify({ read: 'Looks fine.', steps: [] }) }]);
    const last = [...(j.messages || [])].reverse().find((m) => m.role === 'user' && typeof m.content === 'string');
    const after = (j.messages || []).slice((j.messages || []).lastIndexOf(last) + 1);
    const script = last?.content.match(/RUN:(.*):END/)?.[1];
    if (after.length || !script) return reply([{ type: 'text', text: 'Done.' }]);
    reply(JSON.parse(script).map(([name, input], i) => ({ type: 'tool_use', id: 't' + i, name, input })), 'tool_use');
  });
});
await new Promise((r) => fake.listen(AI_PORT, '127.0.0.1', r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
const env = { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1', NODE_ENV: 'test', ANTHROPIC_BASE_URL: F };
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
const memberLines = (v) => !!v && v.hidden === true && Array.isArray(v.rows) && v.rows.length > 0 && v.rows.every((r) => Object.keys(r).every((k) => ITEM_KEYS.includes(k)) && typeof r.desc === 'string' && typeof r.qty === 'number' && 'unit' in r) && v.rows[0].desc === 'Shutters' && v.rows[0].qty === 2 && v.rows[0].unit === 'each' && Object.keys(v).every((k) => ['rows', 'hidden'].includes(k));
const PRICE = 4321.77, COST = 1234.56; // distinctive, to look for anywhere in a member's copy
const leaks = (x) => { const s = JSON.stringify(x ?? null); return /432177|4321\.77|4,321\.77|123456|1234\.56|1,234\.56|864354|8643\.54|8,643\.54|869354|8693\.54|8,693\.54|1733708|17337\.08|17,337\.08|1738708|17387\.08|17,387\.08|3467416|34674\.16|34,674\.16/.test(s); };
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
  // A chain six deep over the price (each formula reads the one before), and a formula that reads no price.
  let prev = 'Twice';
  for (const n of ['T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10']) { y = await rico('POST', `/projects/${board.id}/schema`, { typeId: qT.id, op: 'addField', name: n, type: 'formula', expr: `{${prev}} * 1`, format: 'money' }); prev = n; }
  // Twice to T9 is eight levels (calc's limit); T10 is the ninth, past it: still a price, fail-closed.
  ok(y.status === 200, 'a chain of formulas over the price: ' + y.status + ' ' + (y.body?.error || ''));
  await rico('POST', `/projects/${board.id}/schema`, { typeId: qT.id, op: 'addField', name: 'Plain', type: 'formula', expr: '2 + 3', format: 'number' });
  await rico('POST', `/projects/${board.id}/schema`, { typeId: qT.id, op: 'addField', name: 'Customer', type: 'contact' });
  proj = (await rico('GET', '/projects')).body.find((p) => p.id === board.id);
  const qF = (n) => proj.types.find((x) => x.id === qT.id).fields.find((f) => f.name === n);
  const dana = (await rico('POST', '/contacts', { name: 'Dana Ruiz', email: 'dana@ruiz.test' })).body;
  const danaId = dana?.id ?? dana?.contact?.id;
  const lines = (price = PRICE) => ({ rows: [{ desc: 'Shutters', qty: 2, unit: 'each', price, cost: COST }, { desc: 'Trip', qty: 1, unit: 'trip', price: 50 }], taxRate: 0 });
  const quote = (await rico('POST', `/projects/${board.id}/records`, { typeId: qT.id, values: { title: 'Ruiz shutters', items: lines(), [qF('Customer').id]: danaId } })).body;
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
    ok(q?.values[qF('T9').id] != null, `${who} gets the eighth level of the formula chain`);
    ok(q?.values[twiceF.id] != null && j?.values[quotedF.id] != null && j?.values[quoted2F.id] != null, `${who} gets the formula and both rollups`);
    ok(f?.values[F('price_list', 'price').id] != null && f?.values[F('price_list', 'cost').id] != null, `${who} gets the Price list’s price and cost`);
  }
  for (const [who, C] of [['a member', sam]]) {
    const L = await recs(C);
    const q = find(L, quote.id), j = find(L, job.id), f = find(L, film.id);
    ok(memberLines(q?.values[F('quotes', 'items').id]), `${who} gets the price lines as what and how many only: ` + JSON.stringify(q?.values[F('quotes', 'items').id]).slice(0, 200));
    ok(q?.values[twiceF.id] == null && (q?.hiddenFields || []).includes(twiceF.id), `${who}: the formula over prices is empty and listed in hiddenFields`);
    ok(j?.values[quotedF.id] == null && j?.values[quoted2F.id] == null && (j?.hiddenFields || []).includes(quotedF.id) && (j?.hiddenFields || []).includes(quoted2F.id), `${who}: both rollups (straight and through the formula) are empty and listed`);
    ok(q?.values[qF('T9').id] == null && ['T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9'].every((n) => (q?.hiddenFields || []).includes(qF(n).id)), `${who}: every formula in the eight-level chain is empty and listed`);
    ok(q?.values[qF('T10').id] == null && (q?.hiddenFields || []).includes(qF('T10').id), `${who}: the ninth level, past calc’s limit, is treated as a price too (empty and listed)`);
    ok(q?.values[qF('Plain').id] === 5 && !(q?.hiddenFields || []).includes(qF('Plain').id), `${who}: a formula that reads no price is still there`);
    ok(f?.values[F('price_list', 'price').id] == null && f?.values[F('price_list', 'cost').id] == null && (f?.hiddenFields || []).includes(F('price_list', 'price').id) && (f?.hiddenFields || []).includes(F('price_list', 'cost').id), `${who}: the Price list’s price and cost are empty and listed`);
    ok(j?.values[F('jobs', 'value').id] != null, `${who} still gets the job’s Value (not a price)`);
    ok(!leaks([q, j, f]), `${who}: no price or cost anywhere in the records`);
  }

  // Records for a contact (the contact's page).
  const fc = async (C) => ((await C('GET', `/records/for-contact/${danaId}`)).body || []).find((x) => x.id === quote.id);
  ok((await fc(ada))?.values[F('quotes', 'items').id]?.rows?.[0]?.price != null, 'records for a contact: the admin gets the prices');
  const sfc = await fc(sam);
  ok(sfc && memberLines(sfc.values[F('quotes', 'items').id]) && !leaks(sfc), 'records for a contact: the member gets them redacted');

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
  const sLogMsgs = samL.heard.filter((m) => m.type === 'record:log' && m.recordId === quote.id);
  ok(sLogMsgs.length > 0 && sLogMsgs.every((m) => !leaks(m)) && sLogMsgs.at(-1).log.some((e) => e.field === 'Line items' && e.to === 'changed'), 'the member’s timeline live updates arrive, with the price change as changed and no amounts');
  const aLogMsgs = adaL.heard.filter((m) => m.type === 'record:log' && m.recordId === quote.id);
  ok(aLogMsgs.at(-1)?.log.some((e) => e.field === 'Line items' && /\$/.test(e.to)), 'the admin’s have the amounts');
  // A renamed priced field: the old entry still reads "changed".
  await rico('POST', `/projects/${board.id}/schema`, { typeId: qT.id, op: 'updateField', fieldId: F('quotes', 'items').id, name: 'Lines' });
  sLog = await logOf(sam);
  ok(!leaks(sLog) && sLog.find((e) => e.id === priceEntry(aLog).id)?.to === 'changed' && sLog.find((e) => e.id === priceEntry(aLog).id)?.from === '', 'after the price field is renamed, its old entry still reads changed for the member');

  // Entries from before this change (no fieldId), read after a restart: matched by name, fail-closed.
  await stop();
  const dbFile = DIR + '/db.json';
  const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const qrec = data.records[quote.id];
  for (const e of qrec.log || []) delete e.fieldId;
  qrec.log.push({ id: 'legacy1', kind: 'change', field: 'Gone field', from: '$1.00', to: '$4,321.77', by: 'Rico Vega', at: Date.now() });
  // A text field with the same name as the (renamed) price field: an old entry naming it is ambiguous.
  const qtype = data.projects[board.id].types.find((x) => x.id === qT.id);
  qtype.fields.push({ id: 'dupname1', key: 'lines_note', name: 'Lines', type: 'text' });
  qrec.log.push({ id: 'legacy3', kind: 'change', field: 'Lines', from: '$1.00', to: '$4,321.77', by: 'Rico Vega', at: Date.now() });
  qrec.log.push({ id: 'legacy2', kind: 'change', field: 'Terms', from: 'Net 30', to: 'Net 15', by: 'Rico Vega', at: Date.now() });
  fs.writeFileSync(dbFile, JSON.stringify(data));
  await start();
  sLog = await logOf(sam);
  ok(!leaks(sLog), 'older entries with no field id: none carries an amount for the member (a renamed or deleted field reads changed)');
  ok(sLog.find((e) => e.id === 'legacy1')?.to === 'changed', 'an entry naming a field that no longer exists reads changed');
  ok(sLog.find((e) => e.id === 'legacy3')?.to === 'changed' && sLog.find((e) => e.id === 'legacy3')?.from === '', 'an older entry whose name matches two fields, one a price, reads changed');
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
  for (const C of [rico, sam]) await C('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  aiSaw = [];
  ok((await sam('POST', '/ai/estimate', { recordId: quote.id })).status === 403 && aiSaw.length === 0, 'a member can’t ask the AI for an estimate (403, nothing sent to the AI)');
  r = await rico('POST', '/ai/estimate', { recordId: quote.id });
  ok(r.status === 200 && r.body?.rows?.[0]?.desc === 'Hinges', 'the owner gets the estimate: ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
  // What the AI is told: the owner's ask and next step carry the prices, a member's don't.
  for (const [who, C, priced] of [['the owner', rico, true], ['a member', sam, false]]) {
    aiSaw = [];
    r = await C('POST', '/ai/record', { recordId: quote.id });
    ok(r.status === 200 && aiSaw.length > 0 && leaks(aiSaw) === priced, `next step: what the AI is told for ${who} ${priced ? 'has' : 'has no'} prices (${r.status})`);
    aiSaw = [];
    r = await C('POST', '/ai/ask', { q: 'Ruiz shutters' });
    ok(r.status === 200 && aiSaw.length > 0 && aiSaw.some((x) => x.includes('Ruiz shutters')) && leaks(aiSaw) === priced, `ask: what the AI is told for ${who} ${priced ? 'has' : 'has no'} prices (${r.status})`);
    aiSaw = [];
    const run = (await C('POST', '/agents/runs', { agent: 'ops', ask: `RUN:${JSON.stringify([['read_record', { id: quote.id }], ['find_records', { query: 'Ruiz' }]])}:END` })).body;
    let x;
    for (let i = 0; i < 100; i++) { x = (await C('GET', '/agents/runs/' + run?.id)).body; if (x && !['requested', 'planning', 'running'].includes(x.status)) break; await sleep(80); }
    const toolAnswers = aiSaw.filter((b) => b.includes('tool_result'));
    ok(toolAnswers.length > 0 && toolAnswers.some((b) => b.includes('Ruiz')) && leaks(toolAnswers) === priced, `agents’ record tools for ${who} ${priced ? 'have' : 'have no'} prices`);
  }

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
  r = await sam('POST', `/projects/${board.id}/records`, { typeId: plT.id, values: { item: 'Sam priced', price: 1 } });
  ok(r.status === 403 && !(await recs(rico)).some((x) => x.values[F('price_list', 'item').id] === 'Sam priced'), 'a member adding a Price list item with a price: 403, nothing made');
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
  const samPlain = r.body;

  // Agents write through the same routes: the owner's agent can change a Price list price, a member's can't.
  const agentRun = async (C, tools) => {
    const run = (await C('POST', '/agents/runs', { agent: 'ops', ask: `RUN:${JSON.stringify(tools)}:END` })).body;
    let x;
    for (let i = 0; i < 100; i++) { x = (await C('GET', '/agents/runs/' + run?.id)).body; if (x && !['requested', 'planning', 'running'].includes(x.status)) break; await sleep(80); }
    return x;
  };
  const priceOf = async (id) => find(await recs(rico), id)?.values[F('price_list', 'price').id];
  const filmBefore = await priceOf(film.id);
  aiSaw = [];
  await agentRun(sam, [['update_record', { id: film.id, values: { Price: 2, Description: 'agent' } }]]);
  ok((await priceOf(film.id)) === filmBefore && find(await recs(rico), film.id)?.values[F('price_list', 'description').id] !== 'agent', 'a member’s agent changing a Price list price: nothing saved');
  ok(aiSaw.some((b) => b.includes('tool_result') && /owners and admins/i.test(b)), 'and the agent is told prices are for owners and admins');
  await agentRun(rico, [['update_record', { id: film.id, values: { Price: 2 } }]]);
  ok((await priceOf(film.id)) === 200, 'the owner’s agent can (positive control): ' + (await priceOf(film.id)));

  // What the server copies itself still copies: a member starting a job on a flow with a default line.
  const jp = (await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'] })).body;
  const jtp = jp.types[0];
  const jfid = (k) => jtp.fields.find((f) => f.key === k)?.id;
  const can = (await rico('POST', '/job-items', { name: 'Can clean', unit: 'each', price: 432177, cost: 123456 })).body?.item;
  const fl = (await rico('POST', '/job-flows', { name: 'Clean', list: { projectId: jp.id, typeId: jtp.id }, billing: 'hand', whoCreates: 'everyone', items: [{ itemId: can?.id, qty: 1 }], steps: [{ kind: 'client', name: 'Client' }, { kind: 'invoice', name: 'Send invoice' }] })).body;
  await rico('POST', `/job-flows/${fl?.id}/publish`);
  r = await sam('POST', '/jobs', { flowId: fl?.id, contactId: danaId, values: { job: 'Sam started' } });
  const samJob = r.body?.job;
  const before = ((await rico('GET', `/projects/${jp.id}/records`)).body || []).length;
  const pr = await sam('POST', '/jobs', { flowId: fl?.id, contactId: danaId, values: { job: 'Sam priced job', price: { rows: [{ desc: 'Unit', qty: 1, price: '5' }] } } });
  ok(pr.status === 403 && ((await rico('GET', `/projects/${jp.id}/records`)).body || []).length === before, 'a member starting a job with price lines: 403, nothing made: ' + pr.status);
  ok(r.status === 200 && samJob?.id, 'a member starts a job on the flow: ' + r.status + ' ' + (r.body?.error || ''));
  const ownerJob = ((await rico('GET', `/projects/${jp.id}/records`)).body || []).find((x) => x.id === samJob?.id);
  ok(ownerJob?.values[jfid('price')]?.rows?.[0]?.price === 432177, 'the job got the default line with its price (the owner sees it)');
  ok(!leaks(r.body) && !leaks(((await sam('GET', `/projects/${jp.id}/records`)).body || []).find((x) => x.id === samJob?.id)), 'and the member who started it sees no price');
  // A sign-off form on that job: a member's leaves the line prices and their total out, but keeps the Value (not a price).
  await rico('POST', `/projects/${jp.id}/schema`, { typeId: jtp.id, op: 'addField', name: 'Sign-off', type: 'signature' });
  await rico('POST', `/projects/${jp.id}/schema`, { typeId: jtp.id, op: 'addField', name: 'Value', type: 'money' });
  const jtp2 = ((await rico('GET', '/projects')).body.find((x) => x.id === jp.id)).types.find((x) => x.id === jtp.id);
  const sigF = jtp2.fields.find((f) => f.name === 'Sign-off'), valF = jtp2.fields.find((f) => f.name === 'Value');
  ok(valF?.key === 'value', '(setup) the Value field’s key is value: ' + valF?.key);
  await rico('PATCH', `/records/${samJob?.id}`, { values: { [valF?.id]: 9000 } });
  const ownerForm = (await rico('GET', `/signoff/${samJob?.id}/${sigF?.id}/preview`)).body;
  ok(leaks(ownerForm), 'the owner’s sign-off form has the line prices');
  const samForm = (await sam('GET', `/signoff/${samJob?.id}/${sigF?.id}/preview`)).body;
  ok(samForm && !leaks(samForm) && JSON.stringify(samForm.rows || []).includes('9,000'), 'a member’s has no line prices or their total, and keeps the Value: ' + JSON.stringify(samForm?.rows || null).slice(0, 200));

  // 7. The export: a member's own export has no prices; the owner's team export does.
  await sam('PATCH', `/records/${samPlain.id}`, { values: { terms: 'mine' } });
  await rico('PATCH', `/records/${samPlain.id}`, { values: { items: lines() } });
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
  ok(leaks((await v1('GET', `/projects/${board.id}/quotes/records/${quote.id}/timeline`)).body), 'and the API timeline has the amounts');
  // An automation the admin made that sets a Price list's price when a job is added.
  r = await ada('POST', '/automations', { name: 'Reprice', trigger: { kind: 'record.created', projectId: board.id, typeId: plT.id }, actions: [{ kind: 'record', projectId: board.id, typeId: plT.id, set: [{ field: F('price_list', 'price').id, value: '77' }] }] });
  ok(r.status === 200, 'an admin can save an automation that sets a Price list price: ' + r.status + ' ' + (r.body?.error || ''));
  r = await sam('POST', '/automations', { name: 'Sam reprice', trigger: { kind: 'record.created', projectId: board.id, typeId: plT.id }, actions: [{ kind: 'record', projectId: board.id, typeId: plT.id, set: [{ field: F('price_list', 'price').id, value: '1' }] }] });
  ok(r.status >= 400 && r.status < 500, 'a member can’t: ' + r.status);
  await sam('POST', `/projects/${board.id}/records`, { typeId: plT.id, values: { item: 'Before' } });
  ok(await until(async () => (await recs(rico)).find((x) => x.values[F('price_list', 'item').id] === 'Before')?.values[F('price_list', 'price').id] === 7700), 'while she’s an admin, her automation (started by Sam’s change) sets the price (positive control)');
  await rico('PATCH', '/members/' + idOf('Ada Admin'), { role: 'member' });
  vq = await v1Quote();
  ok(vq && vq.fields && vq.fields.items?.hidden === true && !leaks(vq), 'the next request after she’s made a member: redacted: ' + JSON.stringify(vq?.fields?.items).slice(0, 160));
  const vt = (await v1('GET', `/projects/${board.id}/quotes/records/${quote.id}/timeline`)).body?.timeline || [];
  ok(vt.length > 0 && !leaks(vt) && vt.some((e) => e.to === 'changed'), 'the API timeline through her key: price changes read changed, no amounts');
  r = await v1('PATCH', `/projects/${board.id}/price_list/records/${film.id}`, { fields: { price: 3 } });
  ok(r.status === 403, 'and a price write through the key is 403: ' + r.status);
  ok(memberLines(find(await recs(ada), quote.id)?.values[F('quotes', 'items').id]), 'her own app reads are redacted from the next read');
  // Her automation, run after she's a member, triggered by Sam (a member): its Set is refused with a note.
  await sam('POST', `/projects/${board.id}/records`, { typeId: plT.id, values: { item: 'Trigger' } });
  const autoNote = async () => ((await rico('GET', '/automations')).body?.automations || (await rico('GET', '/automations')).body || []).find?.((x) => x.name === 'Reprice')?.runs?.[0];
  ok(await until(async () => /owners and admins/i.test((await autoNote())?.note || '')), 'her automation ran on Sam’s change and noted that prices are for owners and admins: ' + JSON.stringify(await autoNote()));
  ok(/Ada Admin/.test((await autoNote())?.note || '') && /\bPrice\b/.test((await autoNote())?.note || ''), 'the note names her (the maker) and the field it couldn’t set');
  ok((await autoNote())?.ok === false, 'that run is marked as not done');
  const trig = (await recs(rico)).find((x) => x.values[F('price_list', 'item').id] === 'Trigger');
  ok(trig && trig.values[F('price_list', 'price').id] == null, 'and the price wasn’t written: ' + JSON.stringify(trig?.values[F('price_list', 'price').id]));

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
fake.close();
await stop();
if (fails) console.log(srv.log.slice(-1500));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
