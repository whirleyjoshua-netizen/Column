// Rules and approvals: an owner sets what needs an OK (discounts over 10%, invoices over $1,000, deleting a job)
// and what isn't allowed; the server holds those changes for anyone who can't approve, tells the owners, and
// approving lands the change exactly as asked (or says why it couldn't). Owners always can; admins too when the
// team lets admins approve. The AI hears the rules.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/rules';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4745, B = `http://127.0.0.1:${PORT}`, AI_PORT = 4744;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const asked = [];
const ai = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    asked.push(typeof j.system === 'string' ? j.system : JSON.stringify(j.system));
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: '{"text":"ok"}' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', STRIPE_SECRET_KEY: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}` }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Shade ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  const code = (await jo('GET', '/state')).body.workspace.inviteCode;
  const join = async (name, n) => call((await call()('POST', '/auth', { mode: 'join', workspace: 'Shade ' + t, code, name, email: `${name.toLowerCase()}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n })).body.token);
  const sam = await join('Sam', 2);
  const ann = await join('Ann', 3);
  const kim = await join('Kim', 4); // an admin: members can't touch price lines (docs/jobflows/PRICES.md), so an admin's discount is the one that needs the owner's OK
  const ids = (await jo('GET', '/state')).body.workspace.members;
  await jo('PATCH', '/members/' + ids.find((x) => x.name === 'Ann').id, { role: 'admin' });
  await jo('PATCH', '/members/' + ids.find((x) => x.name === 'Kim').id, { role: 'admin' });
  await jo('PATCH', '/workspace', { tools: { projects: true } });
  const p = (await jo('POST', '/projects', { template: 'trades', trades: ['blinds'] })).body;
  const tp = p.types[0];
  const priceId = tp.fields.find((f) => f.key === 'price').id;
  const lines = (pct) => ({ rows: [{ desc: 'Shutters', qty: 4, price: 500 }], ...(pct ? { discount: { type: 'percent', value: pct } } : {}) });
  const job = (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Ruiz shutters', price: lines(0) } })).body;
  // Sam is on the job (only whoever it's assigned to, its maker and admins delete a job: tests/job_lock.mjs).
  const crewF = tp.fields.find((f) => f.type === 'person');
  const samId = ids.find((x) => x.name === 'Sam').id;
  await jo('PATCH', '/records/' + job.id, { values: { [crewF.id]: samId } });
  const disc = async (who) => (await who('GET', `/projects/${p.id}/records`)).body.find((x) => x.id === job.id)?.values[priceId]?.discount?.value || 0;

  r = await kim('PATCH', '/records/' + job.id, { values: { [priceId]: lines(15) } });
  ok(r.status === 200 && (await disc(jo)) === 15, 'with no rules, anyone can give a discount (nothing changes until an owner sets one)');
  await jo('PATCH', '/records/' + job.id, { values: { [priceId]: lines(0) } });

  // The owner sets the rules.
  ok((await sam('PUT', '/rules', { discount: { level: 'approval' } })).status === 403 && (await ann('PUT', '/rules', { discount: { level: 'approval' } })).status === 403, 'only owners change the rules');
  r = await jo('PUT', '/rules', { discount: { level: 'approval', over: '10%' }, invoice: { level: 'approval', over: '$1,000' }, deleteRecord: { level: 'approval' } });
  ok(r.status === 200 && r.body.rules.discount.over === 10 && r.body.rules.invoice.over === 1000 && r.body.rules.approvers === 'owners', 'Jo: discounts over 10%, invoices over $1,000 and deleting a job need an OK');
  ok((await sam('GET', '/rules')).body.rules.discount.level === 'approval', 'everyone can see the rules');

  // A discount over the line is held.
  r = await kim('PATCH', '/records/' + job.id, { values: { [priceId]: lines(20) } });
  ok(r.status === 202 && r.body.pending && /needs an OK first/.test(r.body.error) && /Jo/.test(r.body.error), 'Kim’s 20% discount is held, and she’s told it went to Jo: ' + r.body.error);
  ok((await disc(jo)) === 0, 'nothing changed yet');
  const ask1 = r.body.approval;
  ok(ask1.summary.includes('20% discount on Ruiz shutters') && ask1.by === 'Kim', 'the request says what it is');
  ok((await jo('GET', '/notices')).body.some((n) => n.kind === 'approval' && /Kim needs your OK/.test(n.title)), 'Jo hears about it');
  ok((await kim('PATCH', '/records/' + job.id, { values: { [priceId]: lines(8) } })).status === 200 && (await disc(jo)) === 8, 'a discount under the line goes straight through');
  ok((await jo('PATCH', '/records/' + job.id, { values: { [priceId]: lines(30) } })).status === 200 && (await disc(jo)) === 30, 'owners can always do it themselves');
  await jo('PATCH', '/records/' + job.id, { values: { [priceId]: lines(8) } });
  ok((await kim('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Big discount job', price: lines(50) } })).status === 202, 'a new job made with a big discount is held too');

  // Approving lands it exactly as asked.
  ok((await kim('POST', `/approvals/${ask1.id}/approve`)).status === 403 && (await ann('POST', `/approvals/${ask1.id}/approve`)).status === 403, 'Kim can’t approve her own, and admins can’t when only owners approve');
  r = await jo('GET', '/approvals');
  ok(r.body.canApprove && r.body.approvals.filter((x) => x.status === 'pending').length === 2, 'Jo sees what’s waiting');
  ok((await sam('GET', '/approvals')).body.approvals.every((x) => x.by === 'Sam') && (await ann('GET', '/approvals')).body.approvals.length === 0, 'others see only their own requests');
  r = await jo('POST', `/approvals/${ask1.id}/approve`);
  ok(r.status === 200 && r.body.approval.status === 'approved' && (await disc(jo)) === 20, 'Jo approves: the 20% discount lands, as Kim asked');
  ok((await jo('POST', `/approvals/${ask1.id}/approve`)).status === 409, 'it can’t be approved twice');
  ok((await kim('GET', '/notices')).body.some((n) => /Jo approved your request/.test(n.title)), 'Kim hears it was approved');
  const log = (await jo('GET', `/records/${job.id}/log`)).body;
  ok(JSON.stringify(log).includes('Kim'), 'the change is Kim’s in the job’s history');

  // Declining, and deleting.
  r = await sam('DELETE', '/records/' + job.id);
  ok(r.status === 202, 'Sam deleting the job is held');
  r = await jo('POST', `/approvals/${r.body.approval.id}/decline`, { note: 'We still need it' });
  ok(r.body.approval.status === 'declined' && (await jo('GET', `/projects/${p.id}/records`)).body.some((x) => x.id === job.id), 'Jo declines: the job stays');
  ok((await sam('GET', '/notices')).body.some((n) => /declined/.test(n.title) && /We still need it/.test(n.text)), 'and Sam hears why');
  r = await sam('DELETE', '/records/' + job.id);
  await jo('DELETE', '/records/' + job.id);
  r = await jo('POST', `/approvals/${r.body.approval.id}/approve`);
  ok(r.body.approval.status === 'failed' && /gone/i.test(r.body.approval.error), 'approving something that’s gone by then says so: ' + r.body.approval.error);
  const job2 = (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Second job', [crewF.id]: samId } })).body;
  r = await sam('DELETE', '/records/' + job2.id);
  ok((await sam('DELETE', '/approvals/' + r.body.approval.id)).status === 200 && !(await jo('GET', '/approvals')).body.approvals.some((x) => x.id === r.body.approval.id), 'Sam can take back his own request while it waits');

  // Never.
  await jo('PUT', '/rules', { deleteRecord: { level: 'never' } });
  r = await sam('DELETE', '/records/' + job2.id);
  ok(r.status === 403 && /isn’t allowed/.test(r.body.error), '“never”: Sam can’t delete at all');
  ok((await jo('DELETE', '/records/' + job2.id)).status === 200, 'owners still can');

  // Invoices, and admins approving.
  const job3 = (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Big install', price: lines(0) } })).body;
  const inv = (await ann('POST', `/records/${job3.id}/invoices`)).body;
  r = await ann('POST', `/invoices/${inv.id}/send`);
  ok(r.status === 202 && /\$2,000/.test(r.body.approval.summary), 'Ann (an admin) sending a $2,000 invoice needs Jo’s OK');
  r = await jo('POST', `/approvals/${r.body.approval.id}/approve`);
  ok(r.body.approval.status === 'approved' && (await jo('GET', '/invoices/' + inv.id)).body.status === 'sent', 'approved: the invoice is sent');
  await jo('PUT', '/rules', { approvers: 'admins' });
  const inv2 = (await ann('POST', `/records/${job3.id}/invoices`)).body;
  ok((await ann('POST', `/invoices/${inv2.id}/send`)).status === 200, 'when admins can approve, Ann sends it herself');
  r = await sam('PATCH', '/records/' + job3.id, { values: { [priceId]: lines(25) } });
  ok(r.status === 403 && /admins/.test(r.body?.error || ''), 'a member can’t give a discount at all: prices are for owners and admins');

  // The AI hears the rules.
  await jo('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  asked.length = 0;
  await jo('POST', '/ai/doc', { mode: 'write', ask: 'A quote cover letter' });
  ok(asked[0]?.includes('Rules Kloomie enforces') && asked[0].includes('Giving a discount over 10%: needs an owner’s OK first') && asked[0].includes('Deleting a job or record: not allowed'), 'the AI is told the enforced rules');
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
srv.kill();
ai.close();
if (fails) console.log(srv.log.split('\n').slice(-15).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
