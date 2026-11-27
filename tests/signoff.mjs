// Sign-offs on jobs and records: a team's forms (written in Kloomie with blanks and checkboxes, or an uploaded PDF),
// a form on a list's sign-off field (or one record's), signing in person with the whole form filled in, sending it
// to sign online, the record filling in either way (signed PDF, timeline, stage moved, a copy emailed), reminders,
// cancelling, and who can reach what.
import fs from 'node:fs';
import path from 'node:path';
const B = process.env.B || 'http://127.0.0.1:4797';
const OUTBOX = process.env.OUTBOX || (process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'outbox') : '');
const call = (tok) => async (m, p, body) => {
  const go = async (b) => {
    const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const r = await go(body);
  // An email to a customer asks first (docs/jobflows/PHASE3B.md §1): here the person presses Send on the preview.
  return r.status === 428 && r.body?.confirm ? go({ ...(body || {}), confirm: r.body.confirm }) : r;
};
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const auth = async (body) => (await (await fetch(B + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json());
const t0 = Date.now();
const a = await auth({ mode: 'create', workspace: 'signoff ' + t0, name: 'Jo', email: `jo${t0}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
const jo = call(a.token);
await jo('PATCH', '/workspace', { tools: { projects: true, contacts: true } });
const other = call((await auth({ mode: 'create', workspace: 'other ' + t0, name: 'Eve', email: `eve${t0}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd9' })).token);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const mails = () => (OUTBOX && fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX).map((f) => JSON.parse(fs.readFileSync(path.join(OUTBOX, f), 'utf8'))) : []);

// A job for a customer, with prices.
const cust = (await jo('POST', '/contacts', { name: 'Maria Lopez', email: 'maria@cust.test', address: '12 Main St', city: 'Las Vegas' })).body;
let p = (await jo('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
const t = p.types[0];
const F = (k) => t.fields.find((f) => f.key === k);
const sigF = F('signoff');
const done = F('status').choices.find((c) => c.label === 'Done');
const mk = async (name) => (await jo('POST', `/projects/${p.id}/records`, { typeId: t.id, values: { job: name, customer: cust.id, price: { rows: [{ desc: 'Tune-up', qty: 1, price: 189 }, { desc: 'Filter', qty: 2, price: 25 }] } } })).body;
const j1 = await mk('AC tune-up');

// The plain sign-off, before any form: the job's details and one line.
let r = await jo('GET', `/signoff/${j1.id}/${sigF.id}/preview`);
ok(r.status === 200 && r.body.form === null && r.body.lines[0].text === 'The work on AC tune-up is complete, and I accept it.' && r.body.signer.name === 'Maria Lopez' && r.body.signer.email === 'maria@cust.test', 'no form yet: the plain sign-off, filled in, with the customer as signer');

// A form written in Kloomie, with blanks and checkboxes.
r = await jo('POST', '/sign-forms', { name: 'Completion sign-off', title: 'Work completed: {job}', body: '# The work\n{line_items}\nI confirm {company} finished the work at {address} on {date}, total {total}.\n[ ] The area was left clean\n[ ] I was shown how to use the system\n{Filter size} filter fitted' });
const form = r.body;
ok(r.status === 200 && form.kind === 'text' && form.name === 'Completion sign-off', 'a form written in Kloomie');
ok((await jo('POST', '/sign-forms', { name: 'Empty', body: '  ' })).status === 400 && (await jo('POST', '/sign-forms', { body: 'x' })).status === 400, 'a form needs a name and words');
r = await jo('POST', `/projects/${p.id}/schema`, { op: 'updateField', typeId: t.id, fieldId: sigF.id, form: form.id, onSigned: done.id });
ok(r.status === 200 && r.body.project.types[0].fields.find((f) => f.id === sigF.id).form === form.id, 'the form goes on the list’s sign-off, with "when signed, move to Done"');
ok((await jo('POST', `/projects/${p.id}/schema`, { op: 'updateField', typeId: t.id, fieldId: sigF.id, form: 'nope' })).status === 400, 'an unknown form is refused');
r = await jo('GET', `/signoff/${j1.id}/${sigF.id}/preview`);
const L = r.body.lines;
ok(r.body.title === 'Work completed: AC tune-up' && L[0].kind === 'h' && L[1].kind === 'items' && L[1].rows.length === 2 && L[1].total === '$239.00', 'filled in: title, heading, the line items and total');
ok(/finished the work at 12 Main St, Las Vegas on \d{4}-\d\d-\d\d, total \$239\.00/.test(L[2].text) && L[2].text.includes('signoff ' + t0), 'blanks: company, address, date, total');
ok(L[3].kind === 'check' && L[3].id === 'c0' && L[4].id === 'c1' && L[5].text === '____ filter fitted', 'checkboxes, and an empty field shows a blank');
r = await jo('GET', `/signoff/${j1.id}/${sigF.id}/pdf`);
ok(r.status === 200 && r.body.subarray(0, 5).toString() === '%PDF-' && /attachment/.test(r.headers.get('content-disposition')) && r.headers.get('x-content-type-options') === 'nosniff', 'the filled-in form as a PDF, downloaded');

// Signed here, in person.
ok((await jo('POST', `/signoff/${j1.id}/${sigF.id}/sign`, { name: 'Maria Lopez', sig: PNG })).status === 400, 'they must agree to sign electronically');
ok((await jo('POST', `/signoff/${j1.id}/${sigF.id}/sign`, { consent: true, name: 'Maria Lopez', sig: 'data:image/png;base64,nope' })).status === 400, 'and actually sign');
const before = mails().length;
r = await jo('POST', `/signoff/${j1.id}/${sigF.id}/sign`, { consent: true, name: 'Maria Lopez', email: 'maria@cust.test', sig: PNG, checks: ['c0', 'zz'] });
let rec = r.body.record;
let v = rec?.values[sigF.id];
ok(r.status === 200 && v.name === 'Maria Lopez' && v.how === 'in person' && v.itemId && v.signId && v.image === PNG, 'signed in person: the field fills in with the signed PDF');
ok(rec.values[F('status').id] === done.id, 'and the job moved to Done');
const sg = (await jo('GET', '/signs')).body.find((x) => x.id === v.signId);
ok(sg && sg.status === 'signed' && sg.inPerson && sg.checks.join() === 'c0', 'kept as a signed request, with only real ticks');
const pdf = await fetch(sg.link.replace('/sign/', '/api/public/sign/') + '/signed');
const signedBytes = Buffer.from(await pdf.arrayBuffer());
ok(pdf.status === 200 && signedBytes.subarray(0, 5).toString() === '%PDF-', 'the signer’s copy downloads from the signing link');
let log = (await jo('GET', `/records/${j1.id}/log`)).body;
ok(log.some((e) => e.kind === 'sign' && e.what === 'signed' && /signed by Maria Lopez in person/.test(e.note)) && log.some((e) => e.kind === 'change' && e.to === 'Done'), 'the timeline says it was signed, and the stage moved');
if (OUTBOX) ok(mails().slice(before).some((m) => m.to === 'maria@cust.test' && /signed copy/i.test(m.subject) && JSON.stringify(m).includes('/sign/')), 'Maria got her copy by email');
ok((await jo('POST', `/signoff/${j1.id}/${sigF.id}/sign`, { consent: true, name: 'X', sig: PNG })).status === 409 && (await jo('POST', `/signoff/${j1.id}/${sigF.id}/send`, { name: 'X', email: 'x@x.test' })).status === 409, 'once signed, it can’t be signed or sent again');

// Sent to sign online.
const j2 = await mk('Furnace repair');
ok((await jo('POST', `/signoff/${j2.id}/${sigF.id}/send`, { name: 'Maria Lopez' })).status === 400, 'sending needs an email address');
const before2 = mails().length;
r = await jo('POST', `/signoff/${j2.id}/${sigF.id}/send`, { email: 'maria@cust.test', message: 'Thanks!' });
ok(r.status === 200 && r.body.link.includes('/sign/') && (OUTBOX ? r.body.emailed === 'kloomie' : [null, 'kloomie'].includes(r.body.emailed)) && r.body.record.signoffs[sigF.id].status === 'sent' && r.body.record.signoffs[sigF.id].to.name === 'Maria Lopez', 'sent: the record shows it’s out, to the customer (from Kloomie, with no mailbox connected)');
if (OUTBOX) ok(mails().slice(before2).some((m) => m.to === 'maria@cust.test' && /Please sign/.test(m.subject) && JSON.stringify(m).includes(r.body.link)), 'the email carries the signing link');
const token = r.body.link.split('/sign/')[1];
ok((await jo('POST', `/signoff/${j2.id}/${sigF.id}/send`, { email: 'b@b.test', name: 'B' })).status === 409, 'it can’t go out twice at once');
const pub = (part = '', body) => fetch(`${B}/api/public/sign/${token}${part}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}).then(async (x) => ({ status: x.status, body: await x.json().catch(() => null) }));
r = await pub();
ok(r.status === 200 && r.body.fields.filter((f) => f.type === 'check').length === 2 && r.body.fields.some((f) => f.type === 'sig') && r.body.fields.some((f) => f.type === 'date'), 'the signing page has two boxes to tick, a signature and the date');
rec = (await jo('GET', `/projects/${p.id}/records`)).body.find((x) => x.id === j2.id);
ok(rec.signoffs[sigF.id].status === 'viewed', 'opening it shows on the record as viewed');
ok((await jo('POST', `/signoff/${j2.id}/${sigF.id}/remind`)).body.emailed === (OUTBOX ? 'kloomie' : undefined) || !OUTBOX, 'a reminder can go');
const c1 = r.body.fields.find((f) => f.type === 'check' && f.label.startsWith('I was shown'));
r = await pub('', { consent: true, name: 'Maria Lopez', sig: PNG, values: { [c1.id]: true } });
ok(r.status === 200 && r.body.status === 'signed', 'Maria signs online');
rec = (await jo('GET', `/projects/${p.id}/records`)).body.find((x) => x.id === j2.id);
v = rec.values[sigF.id];
ok(v.how === 'online' && v.itemId && rec.signoffs[sigF.id].status === 'signed' && rec.values[F('status').id] === done.id, 'the record fills in, its stage moves to Done');
ok((await jo('GET', '/signs')).body.find((x) => x.id === v.signId).checks.join() === c1.id, 'what she ticked is kept');
log = (await jo('GET', `/records/${j2.id}/log`)).body;
ok(['sent', 'viewed', 'signed'].every((w) => log.some((e) => e.kind === 'sign' && e.what === w)), 'the timeline: sent, viewed, signed');

// Cancelling one that's out.
const j3 = await mk('Duct cleaning');
await jo('POST', `/signoff/${j3.id}/${sigF.id}/send`, { email: 'maria@cust.test' });
r = await jo('POST', `/signoff/${j3.id}/${sigF.id}/cancel`);
ok(r.status === 200 && !r.body.record.signoffs?.[sigF.id], 'cancelled: the record is ready to send again');
ok((await fetch(`${B}/api/public/sign/${(await jo('GET', '/signs')).body.find((x) => x.recordId === j3.id).link.split('/sign/')[1]}`)).status === 404, 'and the old link stops working');
ok((await jo('POST', `/signoff/${j3.id}/${sigF.id}/remind`)).status === 400, 'nothing to remind about');

// One record with a different form: an uploaded PDF.
const doc = (await jo('POST', '/docs/pdf', { name: 'Towing release', blocks: [{ t: 'h1', runs: [{ text: 'Release' }] }, { t: 'p', runs: [{ text: 'I release the vehicle to the tow company.' }] }] })).body;
r = await jo('POST', '/sign-forms', { name: 'Towing release', kind: 'pdf', itemId: doc.id });
const pform = r.body;
ok(r.status === 200 && pform.kind === 'pdf', 'an uploaded PDF as a form');
ok((await jo('POST', '/sign-forms', { name: 'Bad', kind: 'pdf', itemId: 'nope' })).status === 400, 'it must be one of the team’s PDFs');
const j4 = await mk('Tow in');
r = await jo('POST', `/signoff/${j4.id}/${sigF.id}/form`, { formId: pform.id });
ok(r.status === 200 && r.body.signForms[sigF.id] === pform.id, 'one record can use a different form');
r = await jo('GET', `/signoff/${j4.id}/${sigF.id}/preview`);
ok(r.body.form.id === pform.id && r.body.pages === 2 && /read and accept “Towing release”/.test(r.body.intro), 'its pages first, then a page to sign');
r = await jo('POST', `/signoff/${j4.id}/${sigF.id}/sign`, { consent: true, name: 'Officer Diaz', sig: PNG });
ok(r.status === 200 && r.body.record.values[sigF.id].name === 'Officer Diaz' && r.body.record.values[sigF.id].form === 'Towing release', 'someone other than the customer can sign');

// Deleting a form puts lists and records back on the plain sign-off.
await jo('DELETE', `/sign-forms/${form.id}`);
p = (await jo('GET', '/projects')).body.find((x) => x.id === p.id);
ok(!p.types[0].fields.find((f) => f.id === sigF.id).form, 'a deleted form comes off the list');

// Who can reach what.
ok((await other('GET', `/signoff/${j2.id}/${sigF.id}/preview`)).status === 404 && (await other('POST', `/signoff/${j2.id}/${sigF.id}/send`, { email: 'x@x.test', name: 'x' })).status === 404, 'another team can’t see or send it');
ok((await other('GET', '/sign-forms')).body.length === 0 && (await other('PATCH', `/sign-forms/${pform.id}`, { name: 'x' })).status === 404, 'or see or change its forms');
ok((await other('POST', '/sign-forms', { name: 'Steal', kind: 'pdf', itemId: doc.id })).status === 400, 'or use its PDFs');
const nf = F('notes') || t.fields.find((f) => f.type === 'text' && f.id !== t.primary);
ok((await jo('GET', `/signoff/${j1.id}/${nf.id}/preview`)).status === 404, 'only sign-off fields have this');
// A sign-off typed in through the record (old way, or an app) can't claim a signed PDF it doesn't have.
const j5 = await mk('Forged');
r = await jo('PATCH', `/records/${j5.id}`, { values: { [sigF.id]: { name: 'Someone', image: PNG, itemId: doc.id, signId: 'x' } } });
ok(r.status === 200 && r.body.values[sigF.id].name === 'Someone' && !r.body.values[sigF.id].itemId && !r.body.values[sigF.id].signId, 'a typed-in sign-off can’t claim a signed PDF');

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
