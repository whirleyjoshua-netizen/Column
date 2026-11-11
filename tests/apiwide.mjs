// The wider public API: Contacts, Tasks, Visits and Invoices through an API key, and webhooks an app subscribes
// to with its key (how Zapier hears about things), signed and sent for what happens across Kloomie.
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/apiwide';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4741, B = `http://127.0.0.1:${PORT}`, H_PORT = 4742;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };

// Where webhooks land.
const got = [];
const hooks = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  got.push({ path: req.url, headers: req.headers, raw, body: JSON.parse(raw) });
  res.end('ok');
});
await new Promise((r) => hooks.listen(H_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', ALLOW_LOCAL_WEBHOOKS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Api ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  const code = (await jo('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Api ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const samId = (await jo('GET', '/state')).body.workspace.members.find((x) => x.name === 'Sam').id;
  const key = (await jo('POST', '/integrations/keys', { name: 'Zapier' })).body.token;
  const ro = (await jo('POST', '/integrations/keys', { name: 'Reader', write: false })).body.token;
  const K = call(key), R = call(ro);

  r = await K('GET', '/v1/me');
  ok(r.status === 200 && r.body.key === 'Zapier' && r.body.events.includes('invoice.paid'), 'me: the key, and every event a webhook can hear');
  ok((await K('GET', '/v1/members')).body.data.some((x) => x.name === 'Sam'), 'members, to assign things to');
  ok((await call('col_nope')('GET', '/v1/contacts')).status === 401, 'a wrong key is refused');
  ok((await K('GET', '/v1/projects')).status === 200, 'projects still answer through the same key');

  // A webhook the key subscribes itself, as Zapier does.
  r = await K('POST', '/v1/webhooks', { url: `http://127.0.0.1:${H_PORT}/z`, events: ['contact.created', 'contact.updated', 'task.created', 'task.done', 'visit.scheduled', 'visit.cancelled', 'invoice.sent', 'invoice.paid', 'payment.received', 'record.created'] });
  const sub = r.body;
  ok(r.status === 201 && sub.secret?.startsWith('whsec_') && sub.events.length === 10, 'subscribing gives the hook and its signing secret');
  ok((await K('GET', '/v1/webhooks')).body.data.length === 1 && (await R('GET', '/v1/webhooks')).body.data.length === 0, 'a key lists only the hooks it made');
  ok([403, 404].includes((await R('DELETE', '/v1/webhooks/' + sub.id)).status) && (await K('GET', '/v1/webhooks')).body.data.length === 1, 'and can’t remove another key’s (a read-only key can’t remove any)');
  ok((await jo('GET', '/integrations/webhooks')).body.some((h) => h.id === sub.id), 'the team sees it in Settings too');
  r = await K('POST', '/v1/webhooks', { url: 'http://127.0.0.1:1/x', events: ['nonsense'] });
  ok(r.status === 201 && r.body.events.length > 15, 'no known events asked for means all of them');
  await K('DELETE', '/v1/webhooks/' + r.body.id);

  // Contacts.
  ok((await R('POST', '/v1/contacts', { name: 'X' })).status === 403, 'a read-only key can’t add');
  ok((await K('POST', '/v1/contacts', { email: 'not-an-email' })).status === 400, 'a bad email is refused');
  r = await K('POST', '/v1/contacts', { name: 'Dana Ruiz', email: 'Dana@x.test', phone: '(555) 010-0100', address: '10 A St', city: 'Austin', tags: ['lead'], external_id: 'crm-1' });
  const dana = r.body;
  ok(r.status === 201 && dana.name === 'Dana Ruiz' && dana.external_id === 'crm-1' && dana.source === 'API' && dana.tags[0] === 'lead', 'a contact added, with its outside id');
  ok((await jo('GET', '/contacts')).body.contacts.some((x) => x.id === dana.id), 'and it’s in Kloomie’s Contacts');
  ok(await until(() => got.some((g) => g.body.type === 'contact.created' && g.body.data.id === dana.id)), 'contact.created was sent');
  const g0 = got.find((g) => g.body.type === 'contact.created');
  const [, ts, sig] = g0.headers['x-kloomie-signature'].match(/t=(\d+),v1=(\w+)/);
  ok(crypto.createHmac('sha256', sub.secret).update(`${ts}.${g0.raw}`).digest('hex') === sig, 'signed with the hook’s secret');
  r = await K('POST', '/v1/contacts', { name: 'Dana R', email: 'dana@x.test', note: 'From the web form', match_existing: true });
  ok(r.status === 200 && r.body.matched && r.body.id === dana.id && r.body.name === 'Dana Ruiz' && r.body.note === 'From the web form', 'match_existing finds her by email and only fills what was empty');
  ok((await K('POST', '/v1/contacts', { name: 'Twin', external_id: 'crm-1' })).status === 409, 'the same external_id twice is refused');
  r = await K('PUT', '/v1/contacts/external/crm-1', { stage: 'won' });
  ok(r.status === 200 && r.body.id === dana.id && r.body.stage === 'won', 'PUT by external_id updates her');
  r = await K('PUT', '/v1/contacts/external/crm-2', { name: 'Lee Park' });
  const lee = r.body;
  ok(r.status === 201 && lee.external_id === 'crm-2', 'and adds someone new');
  ok((await K('GET', '/v1/contacts?email=DANA@x.test')).body.data.map((x) => x.id).join() === dana.id, 'find by email');
  ok((await K('GET', '/v1/contacts?phone=5550100100')).body.data[0]?.id === dana.id, 'find by phone, however it’s written');
  r = await K('GET', '/v1/contacts?limit=1');
  ok(r.body.data.length === 1 && r.body.next_cursor, 'lists page with a cursor');
  const r2 = await K('GET', '/v1/contacts?limit=1&cursor=' + encodeURIComponent(r.body.next_cursor));
  ok(r2.body.data.length === 1 && r2.body.data[0].id !== r.body.data[0].id, 'and the next page carries on');
  ok((await K('GET', '/v1/contacts?order=newest&limit=1')).body.data[0].id === lee.id, 'order=newest for the latest');
  r = await K('PATCH', '/v1/contacts/' + lee.id, { do_not_contact: true });
  ok(r.body.do_not_contact === true, 'do_not_contact can be set');
  ok(await until(() => got.some((g) => g.body.type === 'contact.updated' && g.body.data.id === lee.id)), 'contact.updated was sent');
  ok((await K('DELETE', '/v1/contacts/' + lee.id)).body.deleted && !(await jo('GET', '/contacts')).body.contacts.some((x) => x.id === lee.id), 'a contact deleted');
  await jo('POST', '/contacts', { name: 'Made in app' });
  ok(await until(() => got.some((g) => g.body.type === 'contact.created' && g.body.data.name === 'Made in app' && g.body.by === 'Jo')), 'a contact added in the app sends contact.created too');

  // A job to hang tasks, visits and an invoice on.
  const p = (await jo('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const job = (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'AC tune-up', customer: dana.id, address: '10 A St', price: { rows: [{ desc: 'Tune-up', qty: 1, price: '300' }], taxRate: 0 } } })).body;
  ok(job.id, 'a job for Dana');

  // Tasks.
  r = await K('POST', '/v1/tasks', { text: 'Call Dana back', due: '2026-12-01', assignee: 'Sam', job_id: job.id });
  const task = r.body;
  ok(r.status === 201 && task.assignee?.id === samId && task.job_id === job.id && task.due === '2026-12-01', 'a task for Sam, by name, on the job');
  ok((await K('POST', '/v1/tasks', { text: 'x', assignee: 'Nobody' })).status === 400, 'an unknown person is refused');
  ok((await jo('GET', '/state')).body.tasks.some((x) => x.id === task.id), 'it’s on the team’s tasks');
  ok(await until(() => got.some((g) => g.body.type === 'task.created' && g.body.data.id === task.id)), 'task.created was sent');
  r = await K('PATCH', '/v1/tasks/' + task.id, { done: true });
  ok(r.body.done && r.body.done_by === 'Zapier (API)', 'ticked off through the API');
  ok(await until(() => got.some((g) => g.body.type === 'task.done' && g.body.data.id === task.id)), 'task.done was sent');
  ok((await K('GET', '/v1/tasks?done=true')).body.data.some((x) => x.id === task.id) && !(await K('GET', '/v1/tasks?done=false')).body.data.some((x) => x.id === task.id), 'tasks filter by done');
  const t2 = (await jo('POST', '/tasks', { text: 'In the app' })).body;
  await jo('PATCH', '/tasks/' + t2.id, { done: true });
  ok(await until(() => got.some((g) => g.body.type === 'task.done' && g.body.data.id === t2.id && g.body.data.done)), 'ticking one off in the app sends task.done');

  // Visits.
  ok((await K('POST', '/v1/visits', { job_id: job.id, date: '2026-12-02' })).status === 400, 'a visit needs a crew');
  r = await K('POST', '/v1/visits', { job_id: job.id, date: '2026-12-02', start: '9:30', end: '11:00', kind: 'service', crew_ids: [samId], note: 'Gate code 1234' });
  const visit = r.body;
  ok(r.status === 201 && visit.kind === 'Service' && visit.start === '09:30' && visit.end === '11:00' && visit.crew[0]?.name === 'Sam', 'a visit booked: Sam, 9:30 to 11');
  ok(visit.customer?.name === 'Dana Ruiz' && visit.customer.address === '10 A St' && visit.job.startsWith('AC tune-up'), 'it says who it’s for and where');
  ok(await until(() => got.some((g) => g.body.type === 'visit.scheduled' && g.body.data.id === visit.id)), 'visit.scheduled was sent');
  ok((await K('GET', '/v1/visits?from=2026-12-01&to=2026-12-31')).body.data.some((x) => x.id === visit.id), 'visits list by dates');
  ok(!(await K('GET', '/v1/visits?from=2026-12-03&to=2026-12-31')).body.data.length, 'and not outside them');
  r = await K('PATCH', '/v1/visits/' + visit.id, { start: '2:00pm', end: '3:00pm' });
  ok(r.body.start === '14:00', 'moved to 2pm');
  ok((await K('DELETE', '/v1/visits/' + visit.id)).body.deleted && !(await K('GET', '/v1/visits/' + visit.id)).body?.id, 'called off');
  ok(await until(() => got.some((g) => g.body.type === 'visit.cancelled' && g.body.data.id === visit.id)), 'visit.cancelled was sent');

  // Invoices.
  let inv = (await jo('POST', `/records/${job.id}/invoices`)).body;
  ok((await K('POST', `/v1/invoices/${inv.id}/payments`, { amount: 10 })).status === 400, 'a draft can’t take payments');
  await jo('POST', `/invoices/${inv.id}/send`);
  ok(await until(() => got.some((g) => g.body.type === 'invoice.sent' && g.body.data.number === inv.number)), 'invoice.sent was sent');
  r = await K('GET', '/v1/invoices/' + inv.id);
  ok(r.body.total === 300 && r.body.balance === 300 && r.body.customer.name === 'Dana Ruiz' && r.body.lines[0].price === 300 && r.body.url?.includes('/i/'), 'an invoice in dollars, with its customer and link');
  ok((await K('GET', '/v1/invoices?status=sent')).body.data.length === 1, 'invoices filter by status');
  r = await K('POST', `/v1/invoices/${inv.id}/payments`, { amount: '100.00', method: 'check', reference: 'qb-55', date: '2026-11-20' });
  ok(r.status === 201 && r.body.status === 'partial' && r.body.paid === 100 && r.body.payments[0].date === '2026-11-20', 'a payment from elsewhere: partly paid');
  r = await K('POST', `/v1/invoices/${inv.id}/payments`, { amount: '100.00', reference: 'qb-55' });
  ok(r.body.duplicate && r.body.paid === 100, 'the same reference twice is only counted once');
  r = await K('POST', `/v1/invoices/${inv.id}/payments`, { amount: 200, method: 'bank' });
  ok(r.body.status === 'paid' && r.body.balance === 0, 'the rest: paid');
  ok(await until(() => got.some((g) => g.body.type === 'invoice.paid' && g.body.data.id === inv.id)), 'invoice.paid was sent');
  ok(got.filter((g) => g.body.type === 'payment.received').length === 2, 'payment.received for each payment');
  // Record webhooks still come from Projects.
  await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Second job' } });
  ok(await until(() => got.some((g) => g.body.type === 'record.created')), 'record.created still comes through');
  ok(!got.some((g) => g.body.type === 'contact.deleted'), 'events nobody asked for aren’t sent');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
  console.log(srv.log.slice(-3000));
} finally {
  srv.kill();
  hooks.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
