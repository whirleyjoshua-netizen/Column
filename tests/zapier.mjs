// The Zapier app (integrations/zapier) against a real Kloomie server, through Zapier's own test runner: signing in
// with an API key, every action and search, and instant triggers end to end (subscribe, a signed delivery from
// Kloomie, a tampered one refused, sample data, unsubscribe). Needs `npm install` in integrations/zapier.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../integrations/zapier/', import.meta.url));
let App, zapier;
try {
  zapier = require('zapier-platform-core');
  App = require('./index.js');
} catch {
  console.log('skipped (run npm install in integrations/zapier)');
  process.exit(0);
}
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/zapier';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4751, B = `http://127.0.0.1:${PORT}`, H_PORT = 4752;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };

// Where Zapier's hook URL would be: keeps each delivery as Zapier would receive it.
const got = [];
const hooks = http.createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  got.push({ headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => ['Http-' + k.replace(/(^|-)([a-z])/g, (m, d, ch) => d + ch.toUpperCase()), v])), content: raw, body: JSON.parse(raw) });
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
const appTester = zapier.createAppTester(App);
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Zap ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  const code = (await jo('GET', '/state')).body.workspace.inviteCode;
  await call()('POST', '/auth', { mode: 'join', workspace: 'Zap ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const key = (await jo('POST', '/integrations/keys', { name: 'Zapier' })).body.token;
  const authData = { api_key: key, server: B };
  const run = (fn, inputData = {}, extra = {}) => appTester(fn, { authData, inputData, ...extra });

  // Signing in.
  r = await run(App.authentication.test);
  ok(r.team === 'Zap ' + t && r.key === 'Zapier' && r.write === true, 'the connection test reaches Kloomie and names the team');
  try { await appTester(App.authentication.test, { authData: { api_key: 'col_wrong', server: B } }); ok(false, 'a wrong key is refused'); } catch (e) { ok(/API key/.test(e.message), 'a wrong key is refused, saying to check the API key'); }
  const members = await run(App.triggers.members.operation.perform);
  const sam = members.find((m) => m.name === 'Sam');
  ok(sam?.id && members.length === 2, 'the team list fills the “who” dropdowns');

  // Contacts.
  const dana = await run(App.creates.create_contact.operation.perform, { name: 'Dana Ruiz', email: 'dana@x.test', phone: '555-010-0100', source: 'Website', tags: ['lead', 'zap'] });
  ok(dana.id && dana.name === 'Dana Ruiz' && dana.tags.includes('zap'), 'Create Contact adds her');
  const again = await run(App.creates.create_contact.operation.perform, { name: 'Dana R', email: 'DANA@x.test', note: 'Second form fill' });
  ok(again.id === dana.id && again.matched && again.note === 'Second form fill', 'running it again with the same email updates her instead of adding a copy');
  try { await run(App.creates.create_contact.operation.perform, { note: 'nobody' }); ok(false, 'a contact with nothing to go by is refused'); } catch (e) { ok(/name, company, email or phone/.test(e.message), 'a contact with nothing to go by is refused'); }
  r = await run(App.searches.find_contact.operation.perform, { phone: '(555) 010 0100' });
  ok(r.length === 1 && r[0].id === dana.id, 'Find Contact finds her by phone, however it’s written');
  r = await run(App.creates.update_contact.operation.perform, { contact_id: dana.id, stage: 'Won', do_not_contact: false });
  ok(r.stage === 'Won', 'Update Contact changes her stage');

  // Tasks.
  const task = await run(App.creates.create_task.operation.perform, { text: 'Call Dana back', due: '2026-12-01T09:00:00-08:00', assignee_id: sam.id, priority: '3' });
  ok(task.id && task.assignee?.name === 'Sam' && task.due === '2026-12-01' && task.priority === 3, 'Create Task gives Sam a task due Dec 1');
  r = await run(App.creates.complete_task.operation.perform, { task_id: task.id });
  ok(r.done && r.done_by === 'Zapier (API)', 'Complete Task ticks it off');

  // A job, then a visit on it.
  const p = (await jo('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const job = (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'AC tune-up', customer: dana.id, address: '10 A St', price: { rows: [{ desc: 'Tune-up', qty: 1, price: '300' }], taxRate: 0 } } })).body;
  r = await run(App.creates.book_visit.operation.perform, { job_id: job.id, date: '2026-12-02T00:00:00Z', start: '9:30 AM', end: '11:00', kind: 'Service', crew_ids: [sam.id], note: 'Gate code on file' });
  ok(r.id && r.start === '09:30' && r.end === '11:00' && r.crew[0]?.name === 'Sam' && r.customer?.name === 'Dana Ruiz', 'Book Visit puts Sam on the job at 9:30');

  // Invoices.
  let inv = (await jo('POST', `/records/${job.id}/invoices`)).body;
  await jo('POST', `/invoices/${inv.id}/send`);
  r = await run(App.searches.find_invoice.operation.perform, { number: inv.number.toLowerCase() });
  ok(r.length === 1 && r[0].id === inv.id && r[0].balance === 300, `Find Invoice finds ${inv.number}`);
  r = await run(App.creates.record_payment.operation.perform, { invoice_id: inv.id, amount: 100, method: 'check', reference: 'QB-77', date: '2026-11-20T10:00:00Z' });
  ok(r.paid === 100 && r.status === 'partial', 'Record Payment puts $100 on it');
  r = await run(App.creates.record_payment.operation.perform, { invoice_id: inv.id, amount: 100, method: 'check', reference: 'QB-77' });
  ok(r.paid === 100, 'the same reference again isn’t counted twice');

  // Dropdowns instead of typing ids.
  r = await run(App.triggers.jobs.operation.perform);
  ok(r.some((x) => x.id === job.id && /AC tune-up/.test(x.name)), 'the Job dropdown lists the job by name');
  r = await run(App.triggers.unpaid_invoices.operation.perform);
  ok(r.some((x) => x.id === inv.id && /\$200 owed/.test(x.name)), 'the Invoice dropdown lists what’s still owed');
  r = await run(App.triggers.contact_list.operation.perform);
  ok(r.some((x) => x.id === dana.id && /Dana Ruiz/.test(x.name)), 'the Contact dropdown lists Dana');
  const t2 = await run(App.creates.create_task.operation.perform, { text: 'Order parts' });
  r = await run(App.triggers.open_tasks.operation.perform);
  ok(r.some((x) => x.id === t2.id) && !r.some((x) => x.id === task.id), 'the Task dropdown lists open tasks, not done ones');
  try { await appTester(App.authentication.test, { authData: { api_key: key, server: 'http://evil.example/x' } }); ok(false, 'a non-https address is refused'); } catch (e) { ok(/https:\/\/app\.kloomie\.com/.test(e.message), 'a Kloomie address that isn’t plain https is refused'); }

  // Instant triggers: subscribing, a signed delivery, a tampered one, and unsubscribing.
  const targetUrl = `http://127.0.0.1:${H_PORT}/hooks/catch/123/abc`;
  const sub = await run(App.triggers.new_contact.operation.performSubscribe, {}, { targetUrl });
  ok(sub.id && sub.secret?.startsWith('whsec_') && sub.events.join() === 'contact.created', 'turning on a New Contact Zap subscribes a webhook for contact.created only');
  await jo('POST', '/contacts', { name: 'Lee Park', email: 'lee@x.test' });
  ok(await until(() => got.some((g) => g.body.type === 'contact.created')), 'Kloomie sends the new contact to the Zap’s address');
  const d = got.find((g) => g.body.type === 'contact.created');
  r = await run(App.triggers.new_contact.operation.perform, {}, { cleanedRequest: d.body, rawRequest: { headers: d.headers, content: d.content }, subscribeData: sub });
  ok(r.length === 1 && r[0].name === 'Lee Park' && r[0].id.startsWith('evt_') && r[0].kloomie_id && r[0].by === 'Jo', 'the signed delivery runs the Zap with Lee’s details');
  try {
    await run(App.triggers.new_contact.operation.perform, {}, { cleanedRequest: d.body, rawRequest: { headers: d.headers, content: d.content.replace('Lee Park', 'Mallory') }, subscribeData: sub });
    ok(false, 'a tampered delivery is refused');
  } catch (e) { ok(/signed by Kloomie/.test(e.message), 'a tampered delivery is refused'); }
  r = await run(App.triggers.new_contact.operation.perform, {}, { cleanedRequest: { ...d.body, type: 'contact.deleted' }, rawRequest: { headers: d.headers, content: d.content }, subscribeData: sub });
  ok(r.length === 0, 'an event this Zap didn’t ask for is ignored');
  r = await run(App.triggers.new_contact.operation.performList);
  ok(r.length >= 2 && r[0].name && r[0].kloomie_id, 'sample contacts for setting up the Zap come from the team’s real contacts');
  r = await run(App.triggers.invoice_paid.operation.performList);
  ok(r.length === 1 && r[0].number === 'INV-1001', 'with no paid invoices yet, Invoice Paid shows a sample to map fields from');
  r = await run(App.triggers.payment_received.operation.performList);
  ok(r.length === 1 && r[0].payment?.amount === 100 && r[0].invoice_number === inv.number, 'Payment Received samples come from real payments');
  ok((await jo('GET', '/integrations/webhooks')).body.some((h) => h.id === sub.id), 'the Zap’s webhook shows in Kloomie’s Settings');
  await run(App.triggers.new_contact.operation.performUnsubscribe, {}, { subscribeData: sub });
  ok(!(await jo('GET', '/integrations/webhooks')).body.some((h) => h.id === sub.id), 'turning the Zap off removes its webhook');

  // Every trigger subscribes to its own event.
  const want = { updated_contact: 'contact.updated', new_task: 'task.created', task_done: 'task.done', visit_scheduled: 'visit.scheduled', visit_changed: 'visit.changed', visit_done: 'visit.done', visit_cancelled: 'visit.cancelled', invoice_sent: 'invoice.sent', invoice_paid: 'invoice.paid', payment_received: 'payment.received', file_received: 'file.received', document_signed: 'document.signed' };
  let all = true;
  for (const [k, ev] of Object.entries(want)) {
    const s = await run(App.triggers[k].operation.performSubscribe, {}, { targetUrl });
    all = all && s.events.join() === ev;
    await run(App.triggers[k].operation.performUnsubscribe, {}, { subscribeData: s });
    const list = await run(App.triggers[k].operation.performList);
    all = all && Array.isArray(list) && list.length > 0 && !!list[0].id;
  }
  ok(all, 'every trigger subscribes to its own event and has sample data');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails) console.log(srv.log.slice(-2000));
  srv.kill();
  hooks.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
