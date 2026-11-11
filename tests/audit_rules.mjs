// Audit (docs/audit/FINDINGS.md F4): team rules hold everywhere. The public API refuses what needs an OK (deleting a
// record, a discount over the limit); deleting a project or a list that has records goes for an OK like deleting one
// record; raising an already-sent invoice's total over the limit goes for an OK like sending one that size.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_rules';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4929, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Rules ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  const code = (await jo('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Rules ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  // Sam is an admin (admins aren't the ones who approve on this team: owners are), so Sam can reach invoices.
  const samId = (await jo('GET', '/state')).body.workspace.members.find((x) => x.name === 'Sam').id;
  await jo('PATCH', '/members/' + samId, { role: 'admin' });
  await jo('PATCH', '/workspace', { tools: { projects: true } });
  await jo('PUT', '/rules', { discount: { level: 'approval', over: '10%' }, invoice: { level: 'approval', over: '$1,000' }, deleteRecord: { level: 'approval' } });

  // Sam's own project, with a job in it.
  const p = (await sam('POST', '/projects', { template: 'trades', trades: ['blinds'] })).body;
  ok(!!p?.id, '(setup) Sam makes a project');
  const tp = p.types[0];
  const priceId = tp.fields.find((f) => f.key === 'price').id;
  const lines = (pct, price = 500) => ({ rows: [{ desc: 'Shutters', qty: 1, price }], ...(pct ? { discount: { type: 'percent', value: pct } } : {}) });
  const job = (await sam('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Ruiz shutters', price: lines(0) } })).body;
  ok(!!job?.id, '(setup) and a job');

  // The API, with Sam's key.
  const key = (await sam('POST', '/integrations/keys', { name: 'zap', write: true })).body;
  const api = call(key.token);
  const priceKey = tp.fields.find((f) => f.key === 'price').key;
  r = await api('PATCH', `/v1/projects/${p.id}/${tp.key}/records/${job.id}`, { fields: { [priceKey]: lines(40) } });
  ok(r.status === 403 && /OK/.test(r.body?.error || ''), `F4 a 40% discount through the API is refused (${r.status})`);
  const now = (await jo('GET', `/projects/${p.id}/records`)).body.find((x) => x.id === job.id);
  ok(!now.values[priceId]?.discount, 'F4 and the job keeps its price');
  r = await api('POST', `/v1/projects/${p.id}/${tp.key}/records`, { fields: { job: 'New one', [priceKey]: lines(50) } });
  ok(r.status === 403, `F4 a new record with a 50% discount through the API is refused (${r.status})`);
  r = await api('DELETE', `/v1/projects/${p.id}/${tp.key}/records/${job.id}`);
  ok(r.status === 403 && !!(await jo('GET', `/projects/${p.id}/records`)).body.find((x) => x.id === job.id), `F4 deleting a record through the API is refused, and it stays (${r.status})`);
  r = await api('PATCH', `/v1/projects/${p.id}/${tp.key}/records/${job.id}`, { fields: { [priceKey]: lines(5) } });
  ok(r.status === 200, 'F4 a small discount through the API is fine');

  // Deleting a list, then the whole project, with records in them.
  if (p.types.length > 1) {
    const other = p.types.find((x) => x.id !== tp.id);
    await sam('POST', `/projects/${p.id}/records`, { typeId: other.id, values: {} });
    r = await sam('POST', `/projects/${p.id}/schema`, { op: 'removeType', typeId: other.id });
    ok(r.status === 202 && r.body?.pending, `F4 deleting a list with records in it goes for an OK (${r.status})`);
  } else {
    r = await sam('POST', `/projects/${p.id}/schema`, { op: 'addType', name: 'Extras' });
    const other = r.body.project.types.find((x) => x.name === 'Extras');
    await sam('POST', `/projects/${p.id}/records`, { typeId: other.id, values: {} });
    r = await sam('POST', `/projects/${p.id}/schema`, { op: 'removeType', typeId: other.id });
    ok(r.status === 202 && r.body?.pending, `F4 deleting a list with records in it goes for an OK (${r.status})`);
  }
  r = await sam('DELETE', `/projects/${p.id}`);
  ok(r.status === 202 && r.body?.pending, `F4 deleting a project with records in it goes for an OK (${r.status})`);
  ok(!!(await jo('GET', `/projects/${p.id}/records`)).body?.find?.((x) => x.id === job.id), 'F4 and nothing is deleted meanwhile');
  // Approving it replays the delete.
  const ap = (await jo('GET', '/rules')).body.approvals.find((x) => /Delete the project/.test(x.summary));
  if (ap) {
    r = await jo('POST', `/approvals/${ap.id}/approve`, {});
    ok(r.status === 200 && (await jo('GET', `/projects/${p.id}/records`)).status === 404, 'F4 once approved, the project is deleted');
  } else ok(false, 'F4 once approved, the project is deleted (no request was made)');

  // A sent invoice: Jo sends one for $500, then Sam raises it to $5,000.
  const p2 = (await jo('POST', '/projects', { template: 'trades', trades: ['blinds'] })).body;
  const t2 = p2.types[0];
  const job2 = (await jo('POST', `/projects/${p2.id}/records`, { typeId: t2.id, values: { job: 'Lopez blinds', price: lines(0) } })).body;
  r = await jo('POST', `/records/${job2.id}/invoices`);
  const inv = r.body;
  ok(!!inv?.id, `(setup) an invoice from the job (${r.status})`);
  r = await jo('POST', `/invoices/${inv.id}/send`);
  ok(r.status === 200 && !!r.body.sentAt, '(setup) Jo sends it, for $500');
  r = await sam('PATCH', `/invoices/${inv.id}`, { lines: { rows: [{ desc: 'Shutters', qty: 10, price: 500 }] } });
  ok(r.status === 202 && r.body?.pending, `F4 raising a sent invoice to $5,000 goes for an OK (${r.status})`);
  const after = (await jo('GET', `/invoices/${inv.id}`)).body;
  ok((after.lines?.rows || []).length === 1 && after.lines.rows[0].qty === 1, 'F4 and the invoice is unchanged meanwhile');
  r = await sam('PATCH', `/invoices/${inv.id}`, { lines: { rows: [{ desc: 'Shutters', qty: 1, price: 450 }] } });
  ok(r.status === 200, 'F4 lowering it needs no OK');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
