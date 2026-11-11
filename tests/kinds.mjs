// Jobs & projects by kind of work: Construction & Trades (trade jobs, optionally with bids, quotes, clients and a
// price list), Creative & Agencies (client projects, deliverables with sign-off, proposals accepted online), and
// Business Operations (team projects, tasks, processes). The older templates still make projects.
const B = process.env.B || 'http://127.0.0.1:4797';
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const t0 = Date.now();
const a = await (await fetch(B + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'kinds ' + t0, name: 'Jo', email: `jo${t0}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
const jo = call(a.token);
const keys = (p) => p.types.map((t) => t.key).join();
const typ = (p, k) => p.types.find((t) => t.key === k);
const fld = (t, k) => t.fields.find((f) => f.key === k);

// Trades with bidding: the trade lists, then bids, quotes, clients and a price list, links pointing inside the project.
let r = await jo('POST', '/projects', { template: 'trades', trades: ['blinds', 'hvac'], bids: true });
let p = r.body;
ok(r.status === 200 && p.name === 'Jobs' && keys(p) === 'trade_blinds,trade_hvac,quotes,bids,clients,price_list', 'trades + "we bid on jobs": ' + keys(p));
ok(fld(typ(p, 'quotes'), 'client').target === typ(p, 'clients').id && fld(typ(p, 'quotes'), 'bid').target === typ(p, 'bids').id, 'quotes link to this project’s clients and bids');
r = await jo('POST', '/projects', { template: 'trades', trades: ['blinds'] });
ok(keys(r.body) === 'trade_blinds', 'without it, only the trade lists');
r = await jo('POST', '/projects', { template: 'trades', trades: ['blinds'], bids: 'yes' });
ok(keys(r.body) === 'trade_blinds', 'only bids: true adds the bid lists');
r = await jo('GET', '/project-templates/trades');
const every = r.body.flatMap((f) => f.trades.map((x) => x.key));
r = await jo('POST', '/projects', { template: 'trades', trades: every, bids: true });
ok(r.status === 200 && r.body.types.length === 20 && keys(r.body).endsWith('quotes,bids,clients,price_list'), `every trade + bids stays within 20 lists (${r.body.types?.length})`);
r = await jo('POST', '/projects', { template: 'trades', trades: ['hvac'], name: 'Service jobs', private: true });
ok(r.body.name === 'Service jobs' && r.body.private === true, 'a trades project takes a name and can be private');

// Creative & Agencies.
r = await jo('POST', '/projects', { template: 'creative', name: 'Studio' });
p = r.body;
ok(r.status === 200 && p.template === 'creative' && p.icon === '🎨' && keys(p) === 'projects,deliverables,proposals', 'creative: ' + keys(p));
const proj = typ(p, 'projects'), del = typ(p, 'deliverables'), prop = typ(p, 'proposals');
ok(fld(proj, 'customer').type === 'contact' && fld(prop, 'customer').type === 'contact', 'clients come from Contacts');
ok(fld(del, 'project').target === proj.id && fld(prop, 'project').target === proj.id, 'deliverables and proposals link to projects');
ok(fld(del, 'signoff').type === 'signature' && fld(del, 'status').choices.some((c) => c.label === 'Client review') && fld(prop, 'items').type === 'items', 'deliverables get a client sign-off; proposals have line items');
ok(proj.views.some((v) => v.kind === 'timeline' && v.start === fld(proj, 'start').id && v.end === fld(proj, 'due').id), 'projects have a timeline from start to due');
const c = (await jo('POST', '/contacts', { name: 'Acme Co', email: 'hi@acme.test' })).body;
const pr = await jo('POST', `/projects/${p.id}/records`, { typeId: proj.id, values: { name: 'Spring campaign', customer: c.id, status: 'Brief' } });
ok(pr.status === 200 && pr.body.values[fld(proj, 'customer').id] === c.id, 'a project for a contact');
const d = await jo('POST', `/projects/${p.id}/records`, { typeId: del.id, values: { name: 'Hero video', project: [pr.body.id] } });
ok(d.status === 200 && d.body.values[fld(del, 'project').id][0] === pr.body.id && d.body.values[fld(del, 'status').id] === fld(del, 'status').choices[0].id, 'a deliverable in it, starting at To do');

// Business Operations.
r = await jo('POST', '/projects', { template: 'team', name: 'Ops' });
p = r.body;
ok(r.status === 200 && p.template === 'team' && keys(p) === 'projects,tasks,processes', 'team projects: ' + keys(p));
const proc = typ(p, 'processes');
const pc = await jo('POST', `/projects/${p.id}/records`, { typeId: proc.id, values: { name: 'Month-end close', steps: ['Reconcile bank', 'Send invoices'], frequency: 'Monthly' } });
ok(pc.status === 200 && pc.body.values[fld(proc, 'steps').id].items.length === 2, 'a process with its steps');
ok(fld(typ(p, 'tasks'), 'project').target === typ(p, 'projects').id, 'tasks link to projects');

// The older templates still work for existing flows and the API.
for (const k of ['crm', 'bids', 'jobs', 'tech', 'blank']) { r = await jo('POST', '/projects', { template: k }); ok(r.status === 200 && r.body.template === k, `template ${k} still makes a project`); }

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
