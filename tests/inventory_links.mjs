// Inventory, step 3: linked to jobs, automations and the AI team. A job shows the stock used on it (net of what came
// back, with cost for owners and admins) and the equipment out at it; what the job cost counts that stock. Automations
// hear stock running low, stock used on a job, equipment out, back and with a problem, and can use, move or receive
// stock (their own use sets nothing off). The AI team looks up stock, and Operations records stock used on a job.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/inventory_links';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4989, AI_PORT = 4990, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(120); } return false; };
const OPS = { job: null };
const text = (c) => (typeof c === 'string' ? c : (c || []).map((b) => b.text || (b.type === 'tool_result' ? b.content : '')).join(' '));
const results = [];
const ai = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    const msgs = j.messages, first = text(msgs[0].content);
    const reply = (content, stop = 'end_turn') => res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    if (msgs.length > 1) { results.push(text(msgs.at(-1).content)); return reply([{ type: 'text', text: 'Done.' }]); }
    if (/what is low/i.test(first)) return reply([{ type: 'tool_use', id: 't1', name: 'find_inventory', input: { q: 'filter' } }], 'tool_use');
    if (/use filters/i.test(first)) return reply([{ type: 'tool_use', id: 't2', name: 'use_stock', input: { item: 'air filter', qty: 2, from: 'Truck 2', record_id: OPS.job, why: 'Swapped at the tune-up' } }], 'tool_use');
    reply([{ type: 'text', text: 'Done.' }]);
  });
});
await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}` }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Links ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Links ' + t, code: st.workspace.inviteCode, name: 'Mo Lane', email: `mo${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const mo = call(r.body.token);
  st = (await rico('GET', '/state')).body;
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const feed = async (name) => { const w = (await rico('POST', '/channels', { name })).body; return (w.channels || w.workspace?.channels || []).find((c) => c.name === name)?.id; };
  const posts = async (f) => (await rico('GET', '/state')).body.items.filter((x) => x.type === 'message' && x.channelId === f).map((x) => x.text);

  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const statusF = tp.fields.find((f) => f.key === 'status');
  const job = (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'AC tune-up', price: { rows: [{ desc: 'Tune-up', qty: 1, price: '300' }] } } })).body;
  OPS.job = job.id;
  const filter = (await rico('POST', '/inventory/items', { name: '16x25 air filter', cost: '6.50', reorderAt: 5, onHand: 10 })).body;
  const inv0 = (await rico('GET', '/inventory')).body;
  const main = inv0.places[0];
  const truck = (await rico('POST', '/inventory/places', { name: 'Truck 2', kind: 'truck' })).body;
  await rico('POST', '/inventory/moves', { kind: 'move', itemId: filter.id, qty: 6, from: main.id, to: truck.id });
  const pw = (await rico('POST', '/inventory/items', { name: 'Pressure washer', track: 'units', onHand: 1 })).body;
  const pwUnit = (await rico('GET', '/inventory/items/' + pw.id)).body.units[0];

  // Automations hear Inventory.
  const f1 = await feed('stock');
  for (const [kind, text] of [['stock.low', 'LOW {item}: {qty} left, order from {supplier}'], ['stock.used', 'USED {qty} {item} on {record} by {who}'], ['equipment.out', 'OUT {unit} with {who} for {record}'], ['equipment.back', 'BACK {unit} to {place}'], ['equipment.problem', 'PROBLEM {unit}: {note}']]) {
    r = await rico('POST', '/automations', { name: 'Hear ' + kind, trigger: { kind }, actions: [{ kind: 'post', text, channelId: f1 }] });
    if (r.status !== 200) console.log(kind, r.body);
  }
  await rico('PATCH', `/inventory/items/${filter.id}`, { supplier: 'Ferguson' });

  // Used on the job (some back), equipment out at it.
  await mo('POST', '/inventory/moves', { kind: 'use', itemId: filter.id, qty: 3, from: truck.id, jobId: job.id });
  await mo('POST', '/inventory/moves', { kind: 'return', itemId: filter.id, qty: 1, to: truck.id, jobId: job.id });
  await mo('POST', `/inventory/units/${pwUnit.id}/act`, { act: 'checkout', jobId: job.id });
  ok(await until(async () => (await posts(f1)).includes('USED 3 16x25 air filter on AC tune-up by Mo Lane')), 'an automation hears stock used on a job, with the item, how many, the job and who');
  ok(await until(async () => (await posts(f1)).includes('OUT Pressure washer 1 with Mo Lane for AC tune-up')), 'and equipment checked out for it');
  let jv = (await rico('GET', '/inventory/job/' + job.id)).body;
  ok(jv.materials.length === 1 && jv.materials[0].qty === 2 && jv.materials[0].cost === 1300 && jv.cost === 1300, 'the job shows 2 filters used (3 out, 1 back), $13 of stock');
  ok(jv.equipment.length === 1 && jv.equipment[0].name === 'Pressure washer 1' && jv.equipment[0].item === 'Pressure washer', 'and the pressure washer out at it');
  const mjv = (await mo('GET', '/inventory/job/' + job.id)).body;
  ok(mjv.cost === undefined && mjv.materials[0].cost === undefined && mjv.materials[0].qty === 2, 'members see what was used, not what it cost');
  ok((await mo('GET', '/inventory/job/nope')).status === 404, 'a job that isn’t there: not found');
  const cost = (await rico('GET', `/records/${job.id}/costing`)).body;
  ok(cost.fromStock === 1300 && cost.materials >= 1300, `what the job cost counts the stock used ($${cost.materials / 100})`);
  await mo('POST', `/inventory/units/${pwUnit.id}/act`, { act: 'repair', note: 'Pump leaking' });
  await mo('POST', `/inventory/units/${pwUnit.id}/act`, { act: 'return', placeId: main.id });
  ok(await until(async () => { const x = await posts(f1); return x.includes('PROBLEM Pressure washer 1: Pump leaking') && x.includes('BACK Pressure washer 1 to Main storage'); }), 'and a problem reported, and it brought back');

  // Running low: once, when it crosses the reorder point.
  await mo('POST', '/inventory/moves', { kind: 'use', itemId: filter.id, qty: 4, from: main.id });
  ok(await until(async () => (await posts(f1)).includes('LOW 16x25 air filter: 4 left, order from Ferguson')), 'running low (4, reorder at 5): it hears, with what’s left and the supplier');
  await mo('POST', '/inventory/moves', { kind: 'use', itemId: filter.id, qty: 1, from: truck.id });
  await sleep(400);
  ok((await posts(f1)).filter((x) => x.startsWith('LOW')).length === 1, 'and only once while it stays low');

  // A stock step: when a job is Done, use 2 filters from the truck on it. Its own use sets nothing off.
  ok((await rico('POST', '/automations', { name: 'Bad', trigger: { kind: 'record.stage' }, actions: [{ kind: 'stock', act: 'use', itemId: pw.id, qty: 1, from: main.id }] })).status === 400, 'equipment tracked one by one can’t be used by count in an automation');
  ok((await rico('POST', '/automations', { name: 'Bad', trigger: { kind: 'record.stage' }, actions: [{ kind: 'stock', act: 'use', itemId: filter.id, qty: 0, from: main.id }] })).status === 400, 'it needs how many');
  await rico('POST', '/inventory/moves', { kind: 'receive', itemId: filter.id, qty: 10, to: truck.id });
  r = await rico('POST', '/automations', { name: 'Filters on done', trigger: { kind: 'record.stage', to: 'Done' }, actions: [{ kind: 'stock', act: 'use', itemId: filter.id, qty: 2, from: truck.id, note: 'Swapped on {record}' }] });
  ok(r.status === 200, 'an automation that uses 2 filters from the truck on a finished job');
  const test = (await rico('POST', '/automations/test', { name: 'x', trigger: r.body.trigger, actions: r.body.actions })).body;
  ok(test.steps[0].said === 'Use 2 each 16x25 air filter on Sample job', `“Test it” says what it would use (${test.steps[0].said})`);
  const usedBefore = (await posts(f1)).filter((x) => x.startsWith('USED')).length;
  await rico('PATCH', `/records/${job.id}`, { values: { [statusF.id]: statusF.choices.find((c) => c.label === 'Done').id } });
  ok(await until(async () => /^Used 2 each 16x25 air filter on AC tune-up/.test((await rico('GET', '/automations')).body.find((x) => x.name === 'Filters on done')?.runs?.[0]?.note || '')), 'the job is done: it used them, and says so');
  jv = (await rico('GET', '/inventory/job/' + job.id)).body;
  ok(jv.materials[0].qty === 4, 'now 4 used on the job');
  await sleep(400);
  ok((await posts(f1)).filter((x) => x.startsWith('USED')).length === usedBefore, 'the automation’s own use set nothing off');

  // The AI team.
  await rico('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  r = await rico('POST', '/agents/runs', { agent: 'chief', ask: 'What is low in inventory?' });
  ok(await until(() => results.some((x) => x.includes('16x25 air filter'))), 'the AI team looks up stock (and sees what’s on hand where)');
  r = await rico('POST', '/agents/runs', { agent: 'ops', ask: 'Use filters on the tune-up' });
  ok(await until(async () => (await rico('GET', '/inventory/job/' + job.id)).body.materials[0]?.qty === 6), 'Operations records stock used on the job (2 more: 6 in all)');
  const last = (await rico('GET', '/inventory/moves?job=' + job.id)).body[0];
  ok(last.from === truck.id && last.note === 'Swapped at the tune-up' && /Operations|Rico/.test(last.by), `from the truck, with why, by the agent (${last.by})`);
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
ai.close();
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
