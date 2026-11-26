// Phase 5 (docs/jobflows/PHASE5.md §1–4): Jobs → Overview (pipeline counts over the same jobs as the Jobs list, no
// amounts), Clients (owners with money, members only with the Contacts switch, no money, only clients of jobs they
// see), Schedule by week, everyone's lanes only with the team's schedule switch, and Jobs to schedule = jobs at a
// Book step (plus open jobs not on a flow with nothing booked ahead).
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobs_tab';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5264, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const env = { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1', NODE_ENV: 'test' };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
let up = false;
for (let i = 0; i < 100 && !up; i++) { try { up = (await fetch(B + '/api/health')).ok; } catch {} if (!up) await sleep(150); }
if (!up) { console.log('FAIL the server didn’t start\n' + srv.log.slice(-2000)); process.exit(1); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Tab ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  const join = async (name, n) => (await call()('POST', '/auth', { mode: 'join', workspace: 'Tab ' + t, code: st.workspace.inviteCode, name, email: `${name.split(' ')[0].toLowerCase()}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n })).body.token;
  const ada = call(await join('Ada Admin', 2)), sam = call(await join('Sam Reed', 3)), mia = call(await join('Mia Cruz', 4));
  st = (await rico('GET', '/state')).body;
  const idOf = (name) => st.workspace.members.find((m) => m.name === name)?.id;
  const samId = idOf('Sam Reed'), miaId = idOf('Mia Cruz');
  await rico('PATCH', '/members/' + idOf('Ada Admin'), { role: 'admin' });
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, bills: true } });
  const tz = st.workspace.tz || 'UTC';
  const dayOf = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  const today = dayOf(Date.now()), yesterday = dayOf(Date.now() - 86400000);

  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'] })).body;
  const tp = p.types[0];
  const contact = async (name, extra = {}) => { const x = (await rico('POST', '/contacts', { name, email: `${name.split(' ')[0].toLowerCase()}@x.test`, ...extra })).body; return x.id ?? x.contact?.id; };
  const dana = await contact('Dana Ruiz'), eli = await contact('Eli Park'), fay = await contact('Fay Lin'), hal = await contact('Hal Moss');
  const clientsG = (await rico('POST', '/contact-groups', { name: 'Clients' })).body;
  const gus = await contact('Gus Grey', { groups: [clientsG.id] });

  const mk = async (name, body) => {
    const f = (await rico('POST', '/job-flows', { name, list: { projectId: p.id, typeId: tp.id }, ...body })).body;
    const y = await rico('POST', `/job-flows/${f?.id}/publish`);
    ok(y.status === 200, `(setup) “${name}” published ${y.body?.error || ''}`);
    return { id: f.id, sid: (kind) => y.body?.version?.body?.steps.find((s) => s.kind === kind)?.id };
  };
  const sk = { canSkip: true };
  const F = await mk('Cleaning', { steps: [{ kind: 'client', name: 'Client', ...sk }, { kind: 'book', name: 'Book', stage: 'Scheduled', ...sk }, { kind: 'work', name: 'Clean', stage: 'Done', ...sk }, { kind: 'invoice', name: 'Invoice', stage: 'Invoiced', ...sk }, { kind: 'payment', name: 'Payment', stage: 'Paid', ...sk }] });
  const FQ = await mk('Quoted cleaning', { billing: 'quote', steps: [{ kind: 'client', name: 'Client', ...sk }, { kind: 'quote', name: 'Quote', who: { type: 'admins' }, settings: { email: false } }, { kind: 'book', name: 'Book', ...sk }, { kind: 'invoice', name: 'Invoice', who: { type: 'admins' } }, { kind: 'payment', name: 'Payment', who: { type: 'admins' } }] });
  const start = async (flow, values) => { const y = await rico('POST', '/jobs', { flowId: flow.id, values }); ok(y.status === 200, `(setup) job “${values.job}” ${y.body?.error || ''}`); return y.body?.job; };
  const skip = (j, flow, kind) => rico('POST', `/jobs/${j.id}/steps/${flow.sid(kind)}/skip`, { reason: 'test' });
  const visit = (j, date, memberIds, start = 540) => rico('POST', `/records/${j.id}/visits`, { kind: 'Clean', date, start, end: start + 60, memberIds });
  const runOf = async (j) => (await rico('GET', `/jobs/${j.id}/run`)).body?.run;

  const j1 = await start(F, { job: 'To book', customer: dana });                       // at Book
  const lines = (dollars) => ({ rows: [{ desc: 'Clean', qty: 1, price: String(dollars) }] });
  const j2 = await start(FQ, { job: 'To quote', customer: eli, price: lines(120) });    // at Quote, sent, not answered
  r = await rico('POST', `/jobs/${j2.id}/quote/send`);
  ok(r.status === 200, '(setup) the quote is sent: ' + r.status + ' ' + (r.body?.error || ''));
  const j2b = await start(FQ, { job: 'Quote accepted', customer: eli, price: lines(90) }); // sent and accepted: at Book
  r = await rico('POST', `/jobs/${j2b.id}/quote/send`);
  const tok2b = r.body?.share?.token || r.body?.token || (r.body?.url || '').split('/q/')[1];
  const vOf = async (u) => (await (await fetch(u)).text()).match(/name="v" value="([^"]+)"/)?.[1] || '';
  await fetch(`${B}/q/${tok2b}/accept`, { method: 'POST', body: new URLSearchParams({ name: 'Eli', v: await vOf(`${B}/q/${tok2b}`) }), redirect: 'manual' });
  const j3 = await start(F, { job: 'Booked today', customer: dana });
  await visit(j3, today, [samId], 540); await visit(j3, today, [samId], 780);         // two visits today: one job
  const j4 = await start(F, { job: 'To invoice', customer: fay });
  await skip(j4, F, 'book'); await skip(j4, F, 'work');                                 // at Invoice
  const j5 = await start(F, { job: 'Waiting to be paid', customer: fay, price: { rows: [{ desc: 'Clean', qty: 1, price: '80' }] } });
  await skip(j5, F, 'book'); await skip(j5, F, 'work');
  const inv = (await rico('POST', `/records/${j5.id}/invoices`, { jobStep: F.sid('invoice') })).body;
  await rico('POST', `/invoices/${(inv?.invoice || inv)?.id}/send`);                   // at Payment, $80 owed
  const plain = (vals) => rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: vals }).then((y) => y.body);
  const j6 = await plain({ job: 'Plain, today', customer: hal });
  await visit(j6, today, [miaId], 600);                                                 // not on a flow, visit today (Mia's)
  const j7 = await plain({ job: 'Plain, nothing booked', customer: hal }); // open, no visit ahead
  const j8 = await plain({ job: 'Plain, booked yesterday', customer: hal });
  await visit(j8, yesterday, [miaId], 600);
  const j9 = await plain({ job: 'Plain, booked tomorrow', customer: hal });
  await visit(j9, dayOf(Date.now() + 86400000), [miaId], 600);
  // Hal's invoices: one sent and unpaid ($100), one sent and paid in full ($30), one still a draft.
  const invOf = async (j) => { const y = (await rico('POST', `/records/${j.id}/invoices`, {})).body; return y?.invoice || y; };
  const j10 = await plain({ job: 'Hal billed', customer: hal, price: lines(100) }), j11 = await plain({ job: 'Hal paid', customer: hal, price: lines(30) });
  const hA = await invOf(j10), hB = await invOf(j11), hC = await invOf(j10);
  await rico('POST', `/invoices/${hA?.id}/send`); await rico('POST', `/invoices/${hB?.id}/send`);
  r = await rico('POST', `/invoices/${hB?.id}/payments`, { amount: '30', method: 'cash' });
  ok(hA?.id && hB?.id && hC?.id && r.status === 200, '(setup) Hal’s three invoices');
  ok((await runOf(j1))?.current?.kind === 'book' && (await runOf(j2))?.current?.kind === 'quote' && (await runOf(j2b))?.current?.kind === 'book' && (await runOf(j4))?.current?.kind === 'invoice' && (await runOf(j5))?.current?.kind === 'payment', '(setup) the jobs are at Book, Quote, Invoice and Payment');

  // 1. Overview.
  r = await rico('GET', '/jobs/overview');
  ok(r.status === 200 && r.body?.counts, 'the Overview answers: ' + r.status + ' ' + (r.body?.error || ''));
  const O = r.body || {};
  const L = O.lists || {};
  ok(O.counts?.quote === 1 && L.quote?.join() === j2.id, 'To quote: the job at a Quote step');
  ok(O.counts?.book === 2 && [...(L.book || [])].sort().join() === [j1.id, j2b.id].sort().join(), 'To book: the jobs at a Book step (one after its quote was accepted)');
  ok(O.counts?.today === 2 && [...(L.today || [])].sort().join() === [j3.id, j6.id].sort().join(), 'Booked today: a job with two visits today counts once, a job not on a flow counts too, yesterday’s doesn’t');
  ok(O.counts?.invoice === 1 && L.invoice?.join() === j4.id, 'To invoice: the job at an Invoice step');
  ok(O.counts?.payment === 1 && L.payment?.join() === j5.id, 'Waiting for payment: the job at a Payment step');
  const steps4 = ['quote', 'book', 'invoice', 'payment'].map((k) => L[k] || []);
  ok(steps4.flat().length === new Set(steps4.flat()).size, 'a job is in at most one of To quote, To book, To invoice and Waiting for payment');
  ok(![j6, j7, j8, j9].some((j) => steps4.flat().includes(j.id)) && !(L.today || []).includes(j9.id) && !(L.today || []).includes(j8.id), 'jobs not on a flow are only ever in Booked today (yesterday’s and tomorrow’s visits don’t count)');
  const listed = new Set(((await rico('GET', '/jobs')).body?.jobs || []).map((j) => j.id));
  ok(Object.values(L).flat().every((id) => listed.has(id)), 'every job counted is in the Jobs list');
  ok(!/total|balance|amount|8000|80\.00/.test(JSON.stringify(O)), 'no amounts in the Overview');
  r = await sam('GET', '/jobs/overview');
  ok(r.status === 200 && !/total|balance|amount|8000|80\.00/.test(JSON.stringify(r.body)), 'a member gets the Overview too, without amounts');
  await rico('PATCH', '/workspace', { memberAccess: { projects: false } });
  ok((await sam('GET', '/jobs/overview')).status === 403, 'with Boards off for members, a member gets no Overview');
  await rico('PATCH', '/workspace', { memberAccess: { projects: true } });

  // 2. Clients.
  r = await rico('GET', '/jobs/clients');
  ok(r.status === 200 && Array.isArray(r.body?.clients), 'Clients answers: ' + r.status + ' ' + (r.body?.error || ''));
  const C = (list, id) => (list || []).find((x) => x.id === id);
  const oc = r.body?.clients || [];
  ok(C(oc, dana)?.jobs === 2 && C(oc, dana)?.open === 2 && C(oc, eli)?.jobs === 2 && C(oc, fay)?.jobs === 2 && C(oc, hal)?.jobs === 6, 'each client with how many jobs and how many are open');
  ok(C(oc, gus) && C(oc, gus).jobs === 0, 'a contact in the Clients group is listed for owners, with no jobs');
  ok(C(oc, fay)?.balance === 8000 && C(oc, fay)?.invoices === 1, 'owners get each client’s balance owed and unpaid invoices');
  ok(C(oc, hal)?.invoices === 1 && C(oc, hal)?.balance === 10000, 'a paid invoice and a draft don’t count: Hal owes $100 on one invoice: ' + JSON.stringify(C(oc, hal)));
  ok(C(oc, eli)?.quotes === 1 && C(oc, dana)?.quotes === 0 && C(oc, fay)?.quotes === 0, 'open quotes: sent and not answered (Eli’s accepted one doesn’t count)');
  ok(!C(oc, idOf('Rico Vega')) && oc.every((x) => typeof x.name === 'string'), 'only contacts are listed');
  ok((await ada('GET', '/jobs/clients')).body?.clients?.length === oc.length, 'an admin gets the same list');
  ok((await sam('GET', '/jobs/clients')).status === 403, 'a member with Contacts off gets no Clients');
  await rico('PATCH', '/workspace', { memberAccess: { contacts: true } });
  r = await sam('GET', '/jobs/clients');
  ok(r.status === 200 && C(r.body?.clients, dana)?.jobs === 2, 'a member with Contacts on gets Clients');
  ok(!C(r.body?.clients, gus), 'a member doesn’t get the client groups, only clients of jobs they see');
  ok((r.body?.clients || []).every((x) => !('balance' in x) && !('invoices' in x) && !('quotes' in x)) && !/8000/.test(JSON.stringify(r.body)), 'a member gets no balance, invoices or quotes');
  await rico('PATCH', '/workspace', { memberAccess: { contacts: false } });

  // 3. Schedule: the week.
  const sunday = (() => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); })();
  r = await rico('GET', '/schedule?week=' + sunday);
  ok(r.status === 200 && r.body?.week === sunday && r.body?.days?.length === 7 && r.body.days[0] === sunday, 'the week: its Sunday and seven days: ' + r.status + ' ' + (r.body?.error || ''));
  const W = r.body || {};
  const di = (W.days || []).indexOf(today);
  const samRow = (W.people || []).find((x) => x.id === samId), miaRow = (W.people || []).find((x) => x.id === miaId);
  ok(samRow?.cells?.length === 7 && samRow.cells[di]?.length === 2 && samRow.cells[di].every((v) => v.recordId === j3.id && v.kind === 'Clean' && typeof v.start === 'number' && v.label), 'each person, each day: the visits (kind, job, time)');
  ok(miaRow?.cells?.[di]?.length === 1 && miaRow.cells[di][0].recordId === j6.id, 'a job not on a flow is on the week too');
  ok((await rico('GET', '/schedule?week=nope')).status === 400, 'a week has to be a date');

  // Everyone's lanes need the team's schedule switch.
  r = await sam('GET', '/schedule?date=' + today);
  ok(r.status === 200 && r.body.members.map((x) => x.id).join() === samId && r.body.visits.every((v) => v.memberIds.includes(samId)), 'switch off: a member sees their own lane only');
  r = await sam('GET', '/schedule?week=' + sunday);
  ok(r.status === 200 && r.body.people?.map((x) => x.id).join() === samId, 'switch off: a member’s week is their own row only');
  await rico('PATCH', '/workspace', { memberAccess: { teamSchedule: true } });
  r = await sam('GET', '/schedule?date=' + today);
  ok(r.status === 200 && r.body.members.length === 4 && r.body.visits.some((v) => v.recordId === j6.id), 'switch on: a member sees everyone’s lanes');
  r = await sam('GET', '/schedule?week=' + sunday);
  ok(r.status === 200 && r.body.people?.length === 4, 'switch on: a member’s week has everyone');
  await rico('PATCH', '/workspace', { memberAccess: { teamSchedule: false } });

  // Jobs to schedule.
  r = await rico('GET', '/schedule?date=' + today);
  const waiting = (r.body?.waiting || []).map((w) => w.recordId);
  ok(waiting.includes(j1.id), 'Jobs to schedule: the job at a Book step');
  ok(!waiting.includes(j2.id) && !waiting.includes(j4.id) && !waiting.includes(j5.id), 'a flow job not at a Book step isn’t listed (at Quote, Invoice, Payment)');
  ok(waiting.includes(j7.id) && waiting.includes(j8.id), 'jobs not on a flow: open with nothing booked, or only a past visit, are listed');
  ok(!waiting.includes(j6.id) && !waiting.includes(j9.id), 'a visit today (any time) or later counts as booked ahead: not listed');
} catch (e) {
  ok(false, 'threw: ' + (e.stack || e));
}
srv.kill();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
