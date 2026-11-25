// Job Flows Phase 2 (docs/jobflows/PHASE2.md): billing per flow. Publish rules for hand, quote and auto billing; money
// steps for owners and admins; default lines from Items (only into an empty items field, no cost, refused when an item
// was archived, nothing kept by a failed start or attach); dueDays; the Quote step (the accepted quote is the price:
// an acceptance from before the run doesn't count, decline keeps it open, requote until an invoice exists, the old
// link dies, no Done, members can't skip, share or requote it, and see no money); priceKey; the automatic invoice
// (made once and sent when its step comes up, reopen and void, $0, held for an OK, the owner demoted before and after
// it was made, a restart between making and sending); a Phase 1 version unchanged.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobflow_money';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5252, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
// JOBFLOWS_FAIL_STEP: a step with this name makes starting a run throw. JOBFLOWS_FAIL_SEND: the automatic invoice's
// send throws after the invoice is made (both honoured outside production only).
const base = { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1', NODE_ENV: 'test', JOBFLOWS_FAIL_STEP: 'Boom' };
let srv;
const start = async (extra = {}) => {
  srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...base, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return true; } catch {} await sleep(150); }
  return false;
};
const stop = async () => { srv.kill(); await new Promise((r) => srv.once('exit', r)); };
if (!(await start())) { console.log('FAIL the server didn’t start\n' + srv.log.slice(-2000)); process.exit(1); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const vOf = async (u) => (await (await fetch(u)).text()).match(/name="v" value="([^"]+)"/)?.[1] || '';
const answer = (token, act, form) => fetch(`${B}/q/${token}/${act}`, { method: 'POST', body: new URLSearchParams(form), redirect: 'manual' });
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// priceKey: what the customer sees and pays, and nothing else (PHASE2 §1.3). A pure function, checked directly.
{
  const { priceKey } = await import('../server/jobflows.js').catch(() => ({}));
  ok(typeof priceKey === 'function', 'server/jobflows.js exports priceKey');
  if (typeof priceKey === 'function') {
    const L = { rows: [{ id: 'a1', desc: 'Can clean', qty: 2, unit: 'each', price: 2500, cost: 400, from: 'item:x' }, { id: 'a2', desc: 'Trip', qty: 1, unit: '', price: 1500, taxable: false }], taxRate: 8, discount: { type: 'percent', value: 5 } };
    const k = priceKey(L);
    const ch = (f) => { const c = JSON.parse(JSON.stringify(L)); f(c); return priceKey(c); };
    for (const [why, f] of [['desc', (c) => (c.rows[0].desc = 'Can wash')], ['qty', (c) => (c.rows[0].qty = 3)], ['unit', (c) => (c.rows[0].unit = 'can')], ['price', (c) => (c.rows[0].price = 2600)], ['taxable', (c) => (c.rows[1].taxable = true)], ['taxRate', (c) => (c.taxRate = 9)], ['discount', (c) => (c.discount.value = 6)], ['row order', (c) => c.rows.reverse()], ['a row more', (c) => c.rows.push({ desc: 'x', qty: 1, price: 1 })]]) ok(ch(f) !== k, 'priceKey changes with ' + why);
    for (const [why, f] of [['row ids', (c) => { c.rows[0].id = 'zz'; c.rows[1].id = 'yy'; }], ['cost', (c) => { c.rows[0].cost = 999; delete c.rows[1].cost; }], ['from', (c) => { delete c.rows[0].from; }], ['taxable true vs unset', (c) => (c.rows[0].taxable = true)]]) ok(ch(f) === k, 'priceKey ignores ' + why);
    ok(priceKey({ rows: [] }) === priceKey(null) && priceKey({ rows: [], taxRate: 0 }) === priceKey(undefined), 'no lines is one key');
  }
}

const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Money ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ricoTok = r.body.token;
  let rico = call(ricoTok);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Money ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const samTok = r.body.token;
  let sam = call(samTok);
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Money ' + t, code: st.workspace.inviteCode, name: 'Ann Cole', email: `ann${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const annTok = r.body.token;
  let ann = call(annTok);
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, bills: true } });
  st = (await rico('GET', '/state')).body;
  const memberId = (n) => st.workspace.members.find((m) => m.name === n).id;
  const samId = memberId('Sam Reed'), annId = memberId('Ann Cole');
  await rico('PATCH', '/members/' + annId, { role: 'admin' });
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'] })).body;
  const tp = p.types[0];
  const list = { projectId: p.id, typeId: tp.id };
  const fid = (k) => tp.fields.find((f) => f.key === k).id;
  const statusF = tp.fields.find((f) => f.key === 'status');
  const recOf = async (id) => (await rico('GET', `/projects/${p.id}/records`)).body.find((x) => x.id === id);
  const linesOf = async (id) => (await recOf(id))?.values[fid('price')];
  const stageOf = async (id) => { const v = (await recOf(id))?.values[statusF.id]; return statusF.choices.find((c) => c.id === v)?.label || v; };
  const dana = (await rico('POST', '/contacts', { name: 'Dana Ruiz', email: 'dana@x.test', phone: '555-0100', address: '10 A St' })).body;
  const danaId = dana.id ?? dana.contact?.id;
  const posts = async () => (await rico('GET', '/state')).body.items.filter((it) => it.type === 'message').map((it) => it.text);
  await rico('POST', '/automations', { name: 'sent', trigger: { kind: 'invoice.sent' }, actions: [{ kind: 'post', text: 'SENT {invoice}', channelId: 'general' }] });
  const sentPosts = async (num) => (await posts()).filter((s) => s === 'SENT ' + num).length;
  const item = async (body) => (await rico('POST', '/job-items', body)).body?.item;
  const can = await item({ name: 'Can clean', unit: 'each', price: 2500, cost: 400 });
  const trip = await item({ name: 'Trip fee', unit: 'each', price: 1500, taxable: false });
  const gone = await item({ name: 'Old service', price: 900 });
  await rico('POST', `/job-items/${gone?.id}/archive`);
  ok(!!can?.id && !!trip?.id && !!gone?.id, '(setup) three items, one archived');
  const flowOf = async (body) => {
    const f = (await rico('POST', '/job-flows', { list, ...body })).body;
    const pub = await rico('POST', `/job-flows/${f?.id}/publish`);
    return { id: f?.id, status: pub.status, error: pub.body?.error || '', version: pub.body?.version, sid: (n) => pub.body?.version?.body?.steps?.find((s) => s.name === n)?.id };
  };
  const roleId = ((await rico('POST', '/roles', { name: 'Crew', memberIds: [samId] })).body?.roles || []).find((x) => x.name === 'Crew')?.id;
  ok(!!roleId, '(setup) a Crew role');
  const C = { kind: 'client', name: 'Client' }, W = { kind: 'custom', name: 'Clean', who: { type: 'anyone' }, settings: { text: 'Clean.' } };
  const I = { kind: 'invoice', name: 'Send invoice' }, P = { kind: 'payment', name: 'Collect payment' }, Q = { kind: 'quote', name: 'Send quote' };

  // 1. Publish rules (§1.2). A draft can be saved in any state; publishing checks.
  for (const [why, body] of [
    ['quote billing with no quote step', { billing: 'quote', steps: [C, W, I, P] }],
    ['quote billing with the quote after the invoice', { billing: 'quote', steps: [C, I, Q, P] }],
    ['quote billing with no invoice step', { billing: 'quote', steps: [C, Q, W] }],
    ['quote billing with two quote steps', { billing: 'quote', steps: [C, Q, { ...Q, name: 'Again' }, I] }],
    ['hand billing with a quote step', { billing: 'hand', steps: [C, Q, I] }],
    ['no billing (hand) with a quote step', { steps: [C, Q, I] }],
    ['auto billing with a quote step', { billing: 'auto', steps: [C, Q, I] }],
    ['auto billing with two invoice steps', { billing: 'auto', steps: [C, I, { ...I, name: 'Second invoice' }] }],
    ['auto billing with no invoice step', { billing: 'auto', steps: [C, W] }],
    ['an unknown billing', { billing: 'barter', steps: [C, I] }],
    ['a quote step for anyone', { billing: 'quote', steps: [C, { ...Q, who: { type: 'anyone' } }, I] }],
    ['an invoice step for anyone', { steps: [C, { ...I, who: { type: 'anyone' } }] }],
    ['a payment step for one member', { steps: [C, I, { ...P, who: { type: 'member', id: samId } }] }],
    ['an invoice step for a role', { steps: [C, { ...I, who: { type: 'role', id: roleId } }] }],
    ['a default item twice', { items: [{ itemId: can?.id, qty: 1 }, { itemId: can?.id, qty: 2 }], steps: [C, I] }],
    ['an archived default item', { items: [{ itemId: gone?.id, qty: 1 }], steps: [C, I] }],
    ['a made-up default item', { items: [{ itemId: 'nope', qty: 1 }], steps: [C, I] }],
    ['a default item with qty 0', { items: [{ itemId: can?.id, qty: 0 }], steps: [C, I] }],
    ['a default item with a negative qty', { items: [{ itemId: can?.id, qty: -2 }], steps: [C, I] }],
    ['a default item with qty over 1e6', { items: [{ itemId: can?.id, qty: 1e6 + 1 }], steps: [C, I] }],
    ['dueDays over 120', { dueDays: 121, steps: [C, I] }],
    ['dueDays below 0', { dueDays: -1, steps: [C, I] }],
    ['dueDays that isn’t whole', { dueDays: 1.5, steps: [C, I] }],
  ]) {
    const f = (await rico('POST', '/job-flows', { name: 'Bad: ' + why, list, ...body })).body;
    const pub = await rico('POST', `/job-flows/${f?.id}/publish`);
    ok(!!f?.id && pub.status === 400, `refused at publish: ${why} (${pub.status} ${pub.body?.error || ''})`);
  }
  const many = [];
  for (let i = 0; i < 51; i++) many.push({ itemId: (await item({ name: 'Bulk ' + i, price: 100 }))?.id, qty: 1 });
  ok((await flowOf({ name: '51 defaults', items: many, steps: [C, I] })).status === 400, 'refused at publish: 51 default items');
  ok((await flowOf({ name: 'Fractional qty', items: [{ itemId: can?.id, qty: 1.5 }], steps: [C, I] })).status === 200, 'a fractional default qty is fine (1.5 hours)');
  let F = await flowOf({ name: 'Money steps default', steps: [C, I, P] });
  ok(F.status === 200 && F.version?.body?.steps?.filter((s) => ['invoice', 'payment'].includes(s.kind)).every((s) => s.who?.type === 'admins'), 'an invoice or payment step that names nobody is saved for owners and admins');
  ok(F.version?.body?.billing === 'hand' && Array.isArray(F.version?.body?.items) && F.version.body.items.length === 0 && F.version?.body?.dueDays === null, 'a Phase 1 shaped flow publishes as billing hand, no items, dueDays null');
  F = await flowOf({ name: 'Quote OK', billing: 'quote', steps: [C, Q, W, I, P] });
  ok(F.status === 200 && F.version?.body?.steps?.find((s) => s.kind === 'quote')?.who?.type === 'admins', 'a quote flow publishes, its quote step for owners and admins: ' + F.error);
  F = await flowOf({ name: 'Auto OK', billing: 'auto', steps: [C, W, I, P] });
  ok(F.status === 200 && F.version?.body?.steps?.find((s) => s.kind === 'invoice')?.how === 'auto', 'an auto flow publishes, its invoice step how auto: ' + F.error);

  // 2. Default lines (§2.2) and dueDays.
  const FH = await flowOf({ name: 'Hand with items', items: [{ itemId: can?.id, qty: 3 }, { itemId: trip?.id, qty: 1 }], dueDays: 7, steps: [C, I, P] });
  ok(FH.status === 200, '(setup) a hand flow with default items and dueDays 7: ' + FH.error);
  const newJob = async (flowId, values = {}, who = rico) => (await who('POST', '/jobs', { flowId, contactId: danaId, values: { job: 'J ' + Math.random().toString(36).slice(2, 7), ...values } })).body?.job;
  let j = await newJob(FH.id);
  let lines = await linesOf(j?.id);
  ok(lines?.rows?.length === 2 && lines.rows[0].desc === 'Can clean' && lines.rows[0].qty === 3 && lines.rows[0].price === 2500 && lines.rows[0].from === 'item:' + can?.id && lines.rows[1].taxable === false, 'a job with no lines gets the flow’s default items: ' + JSON.stringify(lines));
  ok(lines?.rows?.every((x) => x.cost == null), 'and no cost is put on the rows');
  for (const [why, v] of [['rows []', { rows: [] }], ['null', null]]) {
    const jj = await newJob(FH.id, { price: v });
    ok((await linesOf(jj?.id))?.rows?.length === 2, 'an empty items field (' + why + ') is filled');
  }
  const jf = await newJob(FH.id, { price: { rows: [{ desc: 'Custom quote', qty: 1, price: '40' }] } });
  lines = await linesOf(jf?.id);
  ok(lines?.rows?.length === 1 && lines.rows[0].desc === 'Custom quote', 'a job that already has lines is left alone');
  r = await rico('POST', `/records/${j?.id}/invoices`, { jobStep: FH.sid('Send invoice') });
  ok(r.body?.due === addDays(r.body?.issued, 7), 'an invoice made by hand from the step is due dueDays after it’s issued: ' + r.body?.issued + ' → ' + r.body?.due);
  const FD = await flowOf({ name: 'Default due', steps: [C, I] });
  const jd = await newJob(FD.id);
  r = await rico('POST', `/records/${jd?.id}/invoices`, { jobStep: FD.sid('Send invoice') });
  ok(r.body?.due === addDays(r.body?.issued, 14), 'with dueDays null it’s 14 days, as today');
  // A list with no items field: the defaults are dropped, and the job starts.
  const p2 = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const t2 = p2.types[0];
  await rico('POST', `/projects/${p2.id}/schema`, { op: 'removeField', typeId: t2.id, fieldId: t2.fields.find((f) => f.key === 'price').id });
  const fNo = (await rico('POST', '/job-flows', { name: 'No lines list', list: { projectId: p2.id, typeId: t2.id }, items: [{ itemId: can?.id, qty: 1 }], steps: [C, I] })).body;
  await rico('POST', `/job-flows/${fNo?.id}/publish`);
  r = await rico('POST', '/jobs', { flowId: fNo?.id, values: { job: 'No lines' } });
  ok(r.status === 200 && !!r.body?.run, 'on a list with no items field the defaults are dropped and the job starts: ' + r.status + ' ' + (r.body?.error || ''));
  // An item archived after publishing: start and attach are refused, nothing is made.
  const temp = await item({ name: 'Seasonal clean', price: 3000 });
  const FT = await flowOf({ name: 'Seasonal', items: [{ itemId: temp?.id, qty: 1 }], steps: [C, I] });
  await rico('POST', `/job-items/${temp?.id}/archive`);
  const before = (await rico('GET', `/projects/${p.id}/records`)).body.length;
  r = await rico('POST', '/jobs', { flowId: FT.id, values: { job: 'Should not exist' } });
  ok(r.status === 400 && /Seasonal clean/.test(r.body?.error || '') && (await rico('GET', `/projects/${p.id}/records`)).body.length === before, 'starting on a flow whose default item was archived is refused, naming it, and makes no job: ' + r.status + ' ' + (r.body?.error || ''));
  const bare = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Bare job' } })).body;
  r = await rico('POST', `/jobs/${bare.id}/flow`, { flowId: FT.id });
  ok(r.status === 400 && !(await rico('GET', `/jobs/${bare.id}/run`)).body?.run && !(await linesOf(bare.id))?.rows?.length, 'attaching it is refused too: no run, no lines: ' + r.status);
  // A failed start or attach keeps no lines.
  const FB = await flowOf({ name: 'Boom flow', items: [{ itemId: can?.id, qty: 1 }], steps: [C, { kind: 'custom', name: 'Boom', settings: { text: 'x' } }, I] });
  const n0 = (await rico('GET', `/projects/${p.id}/records`)).body.length;
  r = await rico('POST', '/jobs', { flowId: FB.id, values: { job: 'Fails' } });
  ok(r.status >= 400 && (await rico('GET', `/projects/${p.id}/records`)).body.length === n0, 'a failed start keeps no job (and so no lines)');
  r = await rico('POST', `/jobs/${bare.id}/flow`, { flowId: FB.id });
  ok(r.status >= 400 && !(await rico('GET', `/jobs/${bare.id}/run`)).body?.run && !(await linesOf(bare.id))?.rows?.length, 'a failed attach leaves the job’s lines empty and no run: ' + r.status);

  // 3. The Quote step (§1.3).
  const FQ = await flowOf({ name: 'Quote first', billing: 'quote', items: [{ itemId: can?.id, qty: 2 }], steps: [C, { ...Q, canSkip: true }, W, I, P] });
  ok(FQ.status === 200, '(setup) a quote-first flow: ' + FQ.error);
  const invs = async (id) => { const b = (await rico('GET', `/records/${id}/invoices`)).body; return Array.isArray(b) ? b : []; };
  const runOf = async (id, who = rico) => (await who('GET', `/jobs/${id}/run`)).body?.run;
  const stepOf = async (id, name, who = rico) => (await runOf(id, who))?.steps?.find((s) => s.name === name);
  // An acceptance from before the run doesn't count.
  const old = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Old quote', customer: danaId, price: { rows: [{ desc: 'Can clean', qty: 2, price: '25' }] } } })).body;
  const oldShare = (await rico('POST', `/records/${old.id}/share`, { hours: 0 })).body;
  await answer(oldShare?.share?.token, 'accept', { name: 'Dana', v: await vOf(`${B}/q/${oldShare?.share?.token}`) });
  await sleep(20);
  r = await rico('POST', `/jobs/${old.id}/flow`, { flowId: FQ.id });
  ok(r.status === 200 && (await runOf(old.id))?.current?.kind === 'quote', 'an acceptance from before the run doesn’t meet the quote step: ' + (await runOf(old.id))?.current?.kind);
  // A new job.
  const jq = await newJob(FQ.id);
  const stage0 = await stageOf(jq?.id);
  let s = await stepOf(jq?.id, 'Send quote');
  ok(s?.state === 'current' && s.quote?.status === 'draft' && s.quote?.total === 5000 && s.quote?.url === null && s.quote?.mayRequote === true, 'the quote step is current: draft, $50.00, no link yet: ' + JSON.stringify(s?.quote));
  let ms = await stepOf(jq?.id, 'Send quote', sam);
  ok(ms?.quote && Object.keys(ms.quote).join() === 'status' && ms.quote.status === 'draft', 'a member sees only the quote’s status: ' + JSON.stringify(ms?.quote));
  ok(!/5000|"url"|\/q\//.test(JSON.stringify(await runOf(jq?.id, sam))), 'the member’s run carries no money or link');
  const ml = (await sam('GET', '/jobs')).body?.jobs?.find((x) => x.id === jq?.id || x.recordId === jq?.id);
  ok(!!ml && ml.total === undefined && !/5000/.test(JSON.stringify(ml)), 'the member’s Jobs list row has no total');
  const al = (await rico('GET', '/jobs')).body?.jobs?.find((x) => x.id === jq?.id || x.recordId === jq?.id);
  ok(al?.total === 5000, 'the owner’s Jobs list row has the total: ' + al?.total);
  ok((await rico('POST', `/jobs/${jq?.id}/steps/${FQ.sid('Send quote')}/done`)).status === 400, 'a quote step has no Done (400)');
  ok((await sam('POST', `/jobs/${jq?.id}/steps/${FQ.sid('Send quote')}/skip`, { reason: 'x' })).status === 403, 'a member can’t skip it, even with canSkip');
  ok((await sam('POST', `/records/${jq?.id}/share`, { hours: 0 })).status === 403, 'or send it');
  ok((await sam('POST', `/jobs/${jq?.id}/requote`)).status === 403, 'or requote it');
  let sh = (await rico('POST', `/records/${jq?.id}/share`, { hours: 0 })).body;
  const tok1 = sh?.share?.token;
  s = await stepOf(jq?.id, 'Send quote');
  ok(s?.quote?.status === 'sent' && s.quote.url?.endsWith('/q/' + tok1) && s.state === 'current', 'sending it: status sent, the link, still current');
  ok((await stageOf(jq?.id)) === stage0, 'sending a quote doesn’t change the job’s stage (the run owns it): ' + (await stageOf(jq?.id)));
  const stage1 = await stageOf(jq?.id);
  await answer(tok1, 'decline', { name: 'Dana', reason: 'Too much' });
  ok((await stageOf(jq?.id)) === stage1, 'declining doesn’t write the job’s stage');
  s = await stepOf(jq?.id, 'Send quote');
  ok(s?.state === 'current' && s.quote?.status === 'declined' && s.quote?.answeredBy === 'Dana' && s.quote?.reason === 'Too much', 'a decline keeps it open, with who and why: ' + JSON.stringify(s?.quote));
  r = await rico('POST', `/jobs/${jq?.id}/requote`);
  ok(r.status === 200 && (await stepOf(jq?.id, 'Send quote'))?.quote?.status === 'draft', 'New quote: back to draft');
  ok((await fetch(`${B}/q/${tok1}`)).status === 404, 'the old link is dead');
  ok(/declin/i.test(JSON.stringify((await rico('GET', `/records/${jq?.id}/log`)).body || '')), 'the old answer is on the job’s timeline');
  sh = (await rico('POST', `/records/${jq?.id}/share`, { hours: 0 })).body;
  const tok2 = sh?.share?.token;
  ok(!!tok2 && tok2 !== tok1, 'the next send makes a new link');
  await answer(tok2, 'accept', { name: 'Dana', v: await vOf(`${B}/q/${tok2}`) });
  let run = await runOf(jq?.id);
  s = run?.steps?.find((x) => x.name === 'Send quote');
  ok(s?.state === 'done' && s.quote?.status === 'accepted' && run.current?.name === 'Clean', 'accepting it meets the quote step; the job moves on: ' + run?.current?.name);
  ok((await stageOf(jq?.id)) === stage0, 'accepting doesn’t write the job’s stage either');
  r = await rico('PATCH', '/records/' + jq?.id, { values: { price: { rows: [{ desc: 'Can clean', qty: 5, price: '25' }] } } });
  ok(r.status === 400 && (await stepOf(jq?.id, 'Send quote'))?.state === 'done', 'the accepted lines can’t be edited (G3), and the step stays met');
  r = await rico('POST', `/jobs/${jq?.id}/requote`);
  ok(r.status === 200 && (await runOf(jq?.id))?.current?.name === 'Send quote', 'requote after acceptance (no invoice yet) reopens the quote step');
  await rico('PATCH', '/records/' + jq?.id, { values: { price: { rows: [{ desc: 'Can clean', qty: 3, price: '25' }] } } });
  sh = (await rico('POST', `/records/${jq?.id}/share`, { hours: 0 })).body;
  await answer(sh?.share?.token, 'accept', { name: 'Dana', v: await vOf(`${B}/q/${sh?.share?.token}`) });
  ok((await runOf(jq?.id))?.current?.name === 'Clean', 'the new lines accepted: met again');
  await rico('POST', `/jobs/${jq?.id}/steps/${FQ.sid('Clean')}/done`);
  ok((await runOf(jq?.id))?.current?.kind === 'invoice', 'with quote billing the invoice step is by hand: it waits');
  await sleep(300);
  ok((await invs(jq?.id)).length === 0, 'and nothing made it by itself');
  const qi = (await rico('POST', `/records/${jq?.id}/invoices`, { jobStep: FQ.sid('Send invoice') })).body;
  ok(qi?.total === 7500, 'the invoice is the accepted lines: ' + qi?.total);
  ok((await rico('POST', `/jobs/${jq?.id}/requote`)).status === 409, 'requote once an invoice exists: 409');
  await rico('PATCH', `/invoices/${qi?.id}`, { lines: { rows: [{ desc: 'Can clean', qty: 4, price: '25' }] } });
  ok((await stepOf(jq?.id, 'Send quote'))?.state === 'done', 'the job’s lines still match the acceptance, so editing the invoice doesn’t reopen the quote step');
  // An admin's Skip is the way past a quote.
  const jk = await newJob(FQ.id);
  r = await rico('POST', `/jobs/${jk?.id}/steps/${FQ.sid('Send quote')}/skip`, { reason: 'Agreed on the phone' });
  ok(r.status === 200 && (await runOf(jk?.id))?.current?.name === 'Clean', 'an admin skips the quote step with a reason');

  // 4. Automatic invoice (§1.4).
  const FA = await flowOf({ name: 'Auto bill', billing: 'auto', items: [{ itemId: can?.id, qty: 2 }], dueDays: 10, steps: [C, W, I, P] });
  ok(FA.status === 200, '(setup) an auto flow: ' + FA.error);
  const ja = await newJob(FA.id);
  await sleep(300);
  ok((await invs(ja?.id)).length === 0, 'nothing is made while an earlier step is open');
  await rico('POST', `/jobs/${ja?.id}/steps/${FA.sid('Clean')}/done`);
  ok(await until(async () => (await invs(ja?.id))[0]?.status === 'sent'), 'when the invoice step comes up, the invoice is made and sent by itself');
  let iv = (await invs(ja?.id))[0];
  ok(iv?.total === 5000 && iv.due === addDays(iv.issued, 10), 'from the job’s lines, due in dueDays');
  ok(await until(async () => (await sentPosts(iv?.number)) === 1), 'invoice.sent went off once');
  run = await runOf(ja?.id);
  s = run?.steps?.find((x) => x.kind === 'invoice');
  ok(s?.state === 'done' && s.auto === true && s.waiting === null && run.current?.kind === 'payment', 'the invoice step is met; payment is next');
  ms = (await runOf(ja?.id, sam))?.steps?.find((x) => x.kind === 'invoice');
  ok(ms?.auto === true && ms.waiting === undefined && !/INV-/.test(JSON.stringify(ms)), 'a member sees auto, not the waiting state or the invoice number');
  await rico('POST', `/jobs/${ja?.id}/steps/${FA.sid('Clean')}/reopen`);
  await rico('POST', `/jobs/${ja?.id}/steps/${FA.sid('Clean')}/done`);
  await sleep(500);
  ok((await invs(ja?.id)).length === 1 && (await sentPosts(iv?.number)) === 1, 'reopening and redoing an earlier step makes no second invoice');
  // Void: exactly one replacement.
  const jv = await newJob(FA.id);
  await rico('POST', `/jobs/${jv?.id}/steps/${FA.sid('Clean')}/done`);
  await until(async () => (await invs(jv?.id))[0]?.status === 'sent');
  await rico('POST', `/invoices/${(await invs(jv?.id))[0]?.id}/void`);
  ok(await until(async () => (await invs(jv?.id)).filter((x) => x.status === 'sent').length === 1), 'voiding it makes one replacement, sent');
  await rico('PATCH', '/records/' + jv?.id, { values: { address: '11 B St' } });
  await sleep(600);
  ok((await invs(jv?.id)).length === 2, 'and only one, whatever sweeps follow: ' + (await invs(jv?.id)).length);
  // $0: a draft that waits.
  const jz = await newJob(FA.id, { price: { rows: [{ desc: 'Free look', qty: 1, price: '0' }] } });
  await rico('POST', `/jobs/${jz?.id}/steps/${FA.sid('Clean')}/done`);
  ok(await until(async () => (await invs(jz?.id)).length === 1), 'a $0 job gets its invoice made');
  await sleep(400);
  iv = (await invs(jz?.id))[0];
  s = await stepOf(jz?.id, 'Send invoice');
  ok(iv?.status === 'draft' && s?.waiting === 'zero' && s.state === 'current', 'but it stays a draft, waiting (zero): ' + iv?.status + ' ' + s?.waiting);
  await rico('PATCH', `/invoices/${iv?.id}`, { lines: { rows: [{ desc: 'Call-out', qty: 1, price: '30' }] } });
  await rico('POST', `/invoices/${iv?.id}/send`);
  s = await stepOf(jz?.id, 'Send invoice');
  ok(s?.state === 'done' && s.waiting === null && (await invs(jz?.id)).length === 1 && (await sentPosts(iv?.number)) === 1, 'fixed and sent by hand: the state is sent, the same invoice, invoice.sent once');
  // Held for an OK: Ann is an admin but not an approver (owners approve), so her run's send waits.
  await rico('PUT', '/rules', { invoice: { level: 'approval', over: '$10' } });
  const jh = await newJob(FA.id, {}, ann);
  await ann('POST', `/jobs/${jh?.id}/steps/${FA.sid('Clean')}/done`);
  ok(await until(async () => (await invs(jh?.id)).length === 1), 'Ann’s run makes its invoice');
  await sleep(500);
  iv = (await invs(jh?.id))[0];
  s = await stepOf(jh?.id, 'Send invoice');
  let aps = [].concat((await rico('GET', '/rules')).body?.approvals || []).filter((x) => x.status === 'pending' && x.target?.invoiceId === iv?.id);
  ok(iv?.status === 'draft' && s?.waiting === 'approval' && aps.length === 1, 'the send is held: a draft, waiting for approval, one approval asked: ' + iv?.status + ' ' + s?.waiting + ' ' + aps.length);
  await rico('PATCH', '/records/' + jh?.id, { values: { address: '12 C St' } });
  await sleep(500);
  aps = [].concat((await rico('GET', '/rules')).body?.approvals || []).filter((x) => x.status === 'pending' && x.target?.invoiceId === iv?.id);
  ok(aps.length === 1 && (await invs(jh?.id))[0]?.status === 'draft', 'later sweeps don’t try again or ask again');
  r = await ann('POST', `/invoices/${iv?.id}/send`);
  ok(r.status === 202 && (await invs(jh?.id))[0]?.status === 'draft', 'sending it by hand goes through the same hold');
  r = await rico('POST', `/approvals/${aps[0]?.id}/approve`, {});
  ok(await until(async () => (await invs(jh?.id))[0]?.status === 'sent'), 'the owner’s OK sends it: ' + r.status + ' ' + (r.body?.error || ''));
  s = await stepOf(jh?.id, 'Send invoice');
  ok(s?.state === 'done' && s.waiting === null && (await invs(jh?.id)).length === 1 && (await sentPosts(iv?.number)) === 1, 'after the approval: sent, the same invoice, invoice.sent once');
  await rico('PUT', '/rules', { invoice: { level: 'auto' } });
  // The owner demoted before the invoice is made: nothing made, the hand button for admins.
  const jo = await newJob(FA.id, {}, ann);
  await rico('PATCH', '/members/' + annId, { role: 'member' });
  await rico('POST', `/jobs/${jo?.id}/steps/${FA.sid('Clean')}/done`);
  await sleep(600);
  s = await stepOf(jo?.id, 'Send invoice');
  ok((await invs(jo?.id)).length === 0 && s?.waiting === 'owner' && s.state === 'current', 'a run whose owner is no longer an admin makes nothing and waits (owner): ' + s?.waiting);
  const hi = (await rico('POST', `/records/${jo?.id}/invoices`, { jobStep: FA.sid('Send invoice') })).body;
  await rico('POST', `/invoices/${hi?.id}/send`);
  s = await stepOf(jo?.id, 'Send invoice');
  ok(s?.state === 'done' && s.waiting === null, 'an admin makes and sends it by hand: met, state sent');
  await rico('PATCH', '/members/' + annId, { role: 'admin' });

  // 5. A restart between making and sending, and the owner demoted after making.
  await stop();
  ok(await start({ JOBFLOWS_FAIL_SEND: '1' }), '(setup) restarted with the send failing');
  rico = call(ricoTok); sam = call(samTok); ann = call(annTok);
  const jr = await newJob(FA.id);
  const je = await newJob(FA.id, {}, ann);
  await rico('POST', `/jobs/${jr?.id}/steps/${FA.sid('Clean')}/done`);
  await rico('POST', `/jobs/${je?.id}/steps/${FA.sid('Clean')}/done`);
  ok(await until(async () => (await invs(jr?.id)).length === 1 && (await invs(je?.id)).length === 1), 'both invoices are made before the send fails');
  const rid1 = (await invs(jr?.id))[0], eid1 = (await invs(je?.id))[0];
  ok(rid1?.status === 'draft' && eid1?.status === 'draft', 'and are still drafts');
  await rico('PATCH', '/members/' + annId, { role: 'member' });
  await stop();
  ok(await start(), 'restarted, sending works again');
  rico = call(ricoTok);
  await rico('PATCH', '/records/' + jr?.id, { values: { address: '13 D St' } });
  ok(await until(async () => (await invs(jr?.id))[0]?.status === 'sent'), 'the next sweep sends the invoice that was made');
  ok((await invs(jr?.id)).length === 1 && (await invs(jr?.id))[0].id === rid1?.id && (await sentPosts(rid1?.number)) === 1, 'the same invoice, no second one, invoice.sent once');
  await rico('PATCH', '/records/' + je?.id, { values: { address: '14 E St' } });
  await sleep(700);
  s = await stepOf(je?.id, 'Send invoice');
  ok((await invs(je?.id)).length === 1 && (await invs(je?.id))[0].status === 'draft' && (await invs(je?.id))[0].id === eid1?.id && s?.waiting === 'owner', 'Ann was made a member after hers was made: kept as a draft, no replacement, waiting (owner): ' + s?.waiting);

  // 6. A Phase 1 version (no billing): nothing runs by itself.
  const F1 = await flowOf({ name: 'Phase 1 shape', steps: [C, W, I, P] });
  const j1 = await newJob(F1.id);
  await rico('POST', `/jobs/${j1?.id}/steps/${F1.sid('Clean')}/done`);
  await sleep(500);
  s = await stepOf(j1?.id, 'Send invoice');
  ok((await invs(j1?.id)).length === 0 && s?.state === 'current' && !s?.auto, 'a flow without billing makes no invoice by itself');
} catch (e) {
  console.log('FAIL threw: ' + (e.stack || e.message));
  fails++;
} finally {
  srv.kill();
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
