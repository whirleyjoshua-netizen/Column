// Analytics v1 (Team plan step 4, the owner 2026-11-20): numbers from Kloomie's own data, for any dates, each against
// the same length of time before it, with a trend by week (or month) and the records behind every number.
// - Business (owners and admins): money in and out, profit, invoiced, collected, owed, overdue, quotes sent and won.
// - Team & operations: tasks done, on time, overdue now, visits done, days to finish, reopened; each person's line.
// - Customers (owners and admins): new contacts and leads, by where they came from.
// - Marketing (owners and admins): calls and emails logged, interested, sales from them, active campaigns.
// Members see Analytics only when an admin turns on "See the team's numbers" (teamKpis), and then only Team &
// operations, with the records behind a number limited to their own.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/analytics';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5353, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', 'x-time-zone': 'UTC', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
const today = new Date().toISOString().slice(0, 10);
const addDays = (k, n) => new Date(Date.parse(k + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const from = addDays(today, -29);
const metric = (sec, key) => sec.metrics.find((x) => x.key === key);
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Ana ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  const join = async (name, n) => call((await call()('POST', '/auth', { mode: 'join', workspace: 'Ana ' + t, code: st.workspace.inviteCode, name, email: `${n}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: n })).body.token);
  const sam = await join('Sam Reed', 'sam'), ben = await join('Ben Cho', 'ben');
  st = (await rico('GET', '/state')).body;
  const id = (name) => st.workspace.members.find((m) => m.name === name).id;
  const samId = id('Sam Reed'), benId = id('Ben Cho');

  // Who can ask.
  ok((await sam('GET', `/analytics?from=${from}&to=${today}`)).status === 403, 'members can’t, until an admin lets them see the team’s numbers');
  ok((await rico('GET', '/analytics')).status === 400, 'dates are needed');
  ok((await rico('GET', `/analytics?from=${today}&to=${from}`)).status === 400, 'from comes before to');
  ok((await rico('GET', `/analytics?from=2019-01-01&to=${today}`)).status === 400, 'at most three years at a time');

  // Team: Sam finishes two tasks (one late, one on time), Ben one with no due date; one of Ben's is overdue now; one reopened.
  const mk = async (who, text, due, memberId) => (await rico('POST', '/tasks', { text, ...(due ? { due } : {}), ...(memberId ? { assigneeId: memberId } : {}) })).body;
  const a1 = await mk(rico, 'Call supplier', addDays(today, -3), samId);
  const a2 = await mk(rico, 'Order parts', addDays(today, 2), samId);
  const a3 = await mk(rico, 'Tidy van', null, benId);
  const a4 = await mk(rico, 'Send photos', addDays(today, -2), benId);
  const a5 = await mk(rico, 'Check stock', null, samId);
  await sam('PATCH', `/tasks/${a1.id}`, { done: true });
  await sam('PATCH', `/tasks/${a2.id}`, { done: true });
  await ben('PATCH', `/tasks/${a3.id}`, { done: true });
  await sam('PATCH', `/tasks/${a5.id}`, { done: true });
  await sam('PATCH', `/tasks/${a5.id}`, { done: false });

  // Money and invoices.
  await rico('POST', '/money', { kind: 'in', amount: 1200, day: addDays(today, -5), category: 'Sales', scope: 'business' });
  await rico('POST', '/money', { kind: 'out', amount: 300, day: addDays(today, -4), category: 'Materials', scope: 'business' });
  await rico('POST', '/money', { kind: 'in', amount: 500, day: addDays(from, -10), category: 'Sales', scope: 'business' }); // the 30 days before
  await rico('POST', '/money', { kind: 'out', amount: 99, day: addDays(today, -1), category: 'Lunch', scope: 'personal' }); // not the business's

  // Customers: two new contacts, one from a lead form source.
  await rico('POST', '/contacts', { name: 'Dana Ruiz', email: 'dana@x.test', source: 'Website form' });
  await rico('POST', '/contacts', { name: 'Eli Park' });

  // Marketing: a campaign with logged calls, one a sale.
  const camp = (await rico('POST', '/campaigns', { name: 'Spring tune-ups' })).body;
  await sam('POST', '/attempts', { campaignId: camp.id, outcome: 'No answer', contact: 'Bo' });
  await sam('POST', '/attempts', { campaignId: camp.id, outcome: 'Interested', contact: 'Cal' });
  await sam('POST', '/attempts', { campaignId: camp.id, outcome: 'Booked', contact: 'Di', amount: '250' });

  r = await rico('GET', `/analytics?from=${from}&to=${today}`);
  ok(r.status === 200, 'owners get the report: ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  const A = r.body;
  ok(A.prevFrom === addDays(from, -30) && A.prevTo === addDays(from, -1), 'compared with the 30 days before: ' + A.prevFrom + '..' + A.prevTo);
  ok(Array.isArray(A.buckets) && A.buckets.length >= 4 && A.buckets.length <= 6 && A.buckets[0].from === from && A.buckets.at(-1).to === today, 'a trend by week over the dates: ' + A.buckets?.length);
  ok(['business', 'team', 'customers', 'marketing'].every((k) => A.sections[k]), 'all four sections for an owner');

  const Bz = A.sections.business;
  ok(metric(Bz, 'income').value === 120000 && metric(Bz, 'income').prev === 50000, 'money in, against before: ' + JSON.stringify(metric(Bz, 'income')));
  ok(metric(Bz, 'expenses').value === 30000 && metric(Bz, 'profit').value === 90000, 'spending and profit (personal money left out)');
  ok(metric(Bz, 'income').series.reduce((n, x) => n + x, 0) === 120000 && metric(Bz, 'income').series.length === A.buckets.length, 'the trend adds up to the total');

  const T = A.sections.team;
  ok(metric(T, 'tasksDone').value === 3, 'tasks done (the reopened one doesn’t count): ' + metric(T, 'tasksDone').value);
  ok(metric(T, 'onTime').value === 50 && metric(T, 'onTime').unit === 'pct', 'on time: one of the two with a due date: ' + metric(T, 'onTime').value);
  ok(metric(T, 'overdueNow').value === 1 && metric(T, 'overdueNow').now, 'overdue now: Ben’s');
  ok(metric(T, 'reopened').value >= 1, 'reopened');
  const sp = T.people.find((p) => p.id === samId), bp = T.people.find((p) => p.id === benId);
  ok(sp.done === 2 && sp.onTime === 50 && sp.overdue === 0 && bp.done === 1 && bp.overdue === 1 && bp.onTime === null, 'each person’s line: ' + JSON.stringify([sp, bp]));

  const C = A.sections.customers;
  ok(metric(C, 'newContacts').value === 2 && metric(C, 'leads').value === 1, 'new contacts, and leads (with a source)');
  ok(C.sources.some((x) => x.name === 'Website form' && x.n === 1), 'by where they came from');

  const M = A.sections.marketing;
  ok(metric(M, 'attempts').value === 3 && metric(M, 'interested').value === 2 && metric(M, 'sales').value === 25000, 'calls logged, interested or booked, and sales: ' + JSON.stringify(M.metrics.map((x) => x.value)));
  ok(metric(M, 'campaigns').value === 1 && metric(M, 'campaigns').now, 'active campaigns');

  // The records behind a number.
  r = await rico('GET', `/analytics/drill?metric=tasksDone&from=${from}&to=${today}`);
  ok(r.status === 200 && r.body.rows.length === 3 && r.body.rows.every((x) => x.go?.startsWith('task:')), 'tasks done: the tasks, each opening: ' + JSON.stringify(r.body).slice(0, 200));
  r = await rico('GET', `/analytics/drill?metric=tasksDone&from=${from}&to=${today}&member=${samId}`);
  ok(r.body.rows.length === 2, 'one person’s');
  r = await rico('GET', `/analytics/drill?metric=income&from=${from}&to=${today}`);
  ok(r.status === 200 && r.body.rows.length === 1 && r.body.rows[0].amount === 120000, 'money in: the entries');
  r = await rico('GET', `/analytics/drill?metric=leads&from=${from}&to=${today}`);
  ok(r.body.rows.length === 1 && r.body.rows[0].go.startsWith('contact:'), 'leads: the contacts');
  ok((await rico('GET', `/analytics/drill?metric=nope&from=${from}&to=${today}`)).status === 400, 'an unknown number is refused');

  // Members, once an admin lets them: Team & operations only; behind a number, only their own.
  await rico('PATCH', '/workspace', { memberAccess: { teamKpis: true } });
  r = await sam('GET', `/analytics?from=${from}&to=${today}`);
  ok(r.status === 200 && r.body.sections.team && !r.body.sections.business && !r.body.sections.customers && !r.body.sections.marketing, 'a member sees Team & operations only');
  ok(!JSON.stringify(r.body).includes('120000'), 'and no money');
  r = await sam('GET', `/analytics/drill?metric=tasksDone&from=${from}&to=${today}`);
  ok(r.status === 200 && r.body.rows.length === 2 && r.body.hidden === 1 && !JSON.stringify(r.body).includes('Tidy van'), 'behind a number, their own (others’ counted, not shown)');
  ok((await sam('GET', `/analytics/drill?metric=income&from=${from}&to=${today}`)).status === 403, 'never the business’s money');
  ok(!/Error|TypeError/.test(srv.log), 'no server errors' + (/Error/.test(srv.log) ? ': ' + srv.log.slice(-600) : ''));
} catch (e) {
  ok(false, 'crashed: ' + e.stack);
} finally {
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
