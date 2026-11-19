// Contact groups (2026-11-19): beyond sales, the team sorts people into groups (vendors, inspectors, a lawyer,
// partners, mentors). Owners and admins only, like Contacts. A name is one group (any case); a person can be in
// several; add and remove many at once; renaming can't take another group's name; deleting a group takes it off
// everyone and deletes nobody; a spreadsheet's Group column makes and fills groups; merging keeps both people's
// groups; another team's group can't be used.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/cgroups';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4889, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Grp ' + t, name: 'Maria', email: `maria${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const maria = call(r.body.token);
  const code = (await maria('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Grp ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Olga', email: `olga${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const olga = call(r.body.token);

  r = await maria('POST', '/contact-groups', { name: 'Inspectors', icon: '🔍' });
  ok(r.status === 200 && r.body.name === 'Inspectors' && r.body.icon === '🔍', 'an owner makes a group, with an emoji');
  const insp = r.body;
  r = await maria('POST', '/contact-groups', { name: '  inspectors ' });
  ok(r.status === 200 && r.body.id === insp.id, 'the same name (any case) is the same group');
  const vend = (await maria('POST', '/contact-groups', { name: 'Vendors' })).body;
  ok((await maria('POST', '/contact-groups', { name: '  ' })).status === 400, 'a group needs a name');
  ok((await sam('GET', '/contact-groups')).status === 403 && (await sam('POST', '/contact-groups', { name: 'Mine' })).status === 403, 'a member can’t see or make groups (Contacts are owners’ and admins’)');
  r = await maria('POST', '/contacts', { name: 'Ivan Inspector', phone: '555-0101', groups: [insp.id] });
  ok(r.status === 200 && r.body.groups.join() === insp.id, 'a contact is made in a group');
  const ivan = r.body;
  const olgaG = (await olga('POST', '/contact-groups', { name: 'Theirs' })).body;
  r = await maria('PATCH', '/contacts/' + ivan.id, { groups: [insp.id, vend.id, olgaG.id] });
  ok(r.status === 200 && r.body.groups.length === 2 && !r.body.groups.includes(olgaG.id), 'in several groups; another team’s group is ignored');
  const ana = (await maria('POST', '/contacts', { name: 'Ana Attorney', email: `ana${t}@law.test` })).body;
  const ben = (await maria('POST', '/contacts', { name: 'Ben Buyer', email: `ben${t}@b.test`, stage: 'lead' })).body;
  r = await maria('POST', `/contact-groups/${vend.id}/add`, { ids: [ana.id, ben.id, ivan.id, 'nope'] });
  ok(r.status === 200 && r.body.changed === 2, 'add many at once (someone already in it isn’t counted twice)');
  r = await maria('POST', `/contact-groups/${vend.id}/remove`, { ids: [ben.id] });
  ok(r.body.changed === 1, 'and take people out');
  let all = (await maria('GET', '/contacts')).body;
  const by = (id) => all.contacts.find((x) => x.id === id);
  ok(all.groups.map((g) => g.name).join() === 'Inspectors,Vendors', 'Contacts comes with the team’s groups, by name');
  ok(by(ana.id).groups.join() === vend.id && !by(ben.id).groups.length && by(ben.id).stage === 'lead', 'Ana is in Vendors, Ben in none and still a lead');
  ok((await maria('PATCH', '/contact-groups/' + vend.id, { name: 'inspectors' })).status === 400, 'renaming can’t take another group’s name');
  r = await maria('PATCH', '/contact-groups/' + vend.id, { name: 'Vendors & suppliers', icon: '🚚' });
  ok(r.status === 200 && r.body.name === 'Vendors & suppliers' && r.body.icon === '🚚', 'rename a group and change its emoji');
  // A spreadsheet's Group column.
  r = await maria('POST', '/contacts/import', { rows: [{ name: 'Lou Lawyer', email: `lou${t}@law.test`, groups: 'Legal; Mentors' }, { name: 'Ana Attorney', email: `ana${t}@law.test`, groups: 'Legal' }] });
  ok(r.status === 200 && r.body.added === 1 && r.body.updated === 1, 'an import with a Group column adds Lou and updates Ana');
  all = (await maria('GET', '/contacts')).body;
  const legal = all.groups.find((g) => g.name === 'Legal'), ment = all.groups.find((g) => g.name === 'Mentors');
  ok(legal && ment, 'it made the Legal and Mentors groups');
  const lou = all.contacts.find((x) => x.name === 'Lou Lawyer');
  ok(lou.groups.includes(legal.id) && lou.groups.includes(ment.id) && by(ana.id) && all.contacts.find((x) => x.id === ana.id).groups.includes(legal.id) && all.contacts.find((x) => x.id === ana.id).groups.includes(vend.id), 'Lou is in both, and Ana keeps Vendors and gains Legal');
  // Merging keeps both people's groups.
  const ivan2 = (await maria('POST', '/contacts', { name: 'Ivan I.', phone: '555-0101', groups: [legal.id] })).body;
  r = await maria('POST', '/contacts/merge', { ids: [ivan.id, ivan2.id] });
  ok(r.status === 200 && [insp.id, vend.id, legal.id].every((id) => r.body.groups.includes(id)), 'merging two keeps both people’s groups');
  // A campaign's list from Contacts can be everyone in a group.
  const camp = (await maria('POST', '/campaigns', { name: 'Thank our vendors' })).body;
  r = await maria('POST', '/lists', { campaignId: camp.id, name: 'Vendors', live: { groups: [vend.id] } });
  ok(r.status === 200 && r.body.rows.map((x) => x.cells[0]).sort().join() === 'Ana Attorney,Ivan Inspector', 'a campaign list from Contacts can be everyone in Vendors: ' + (r.body.rows || []).map((x) => x.cells[0]).join());
  // Deleting a group takes it off everyone and deletes nobody.
  const n = all.contacts.length;
  ok((await sam('DELETE', '/contact-groups/' + insp.id)).status === 403, 'a member can’t delete a group');
  ok((await maria('DELETE', '/contact-groups/' + insp.id)).status === 200, 'an owner deletes Inspectors');
  all = (await maria('GET', '/contacts')).body;
  ok(!all.groups.some((g) => g.id === insp.id) && all.contacts.every((x) => !x.groups.includes(insp.id)) && all.contacts.length === n, 'it’s gone from everyone, and nobody was deleted');
  ok((await olga('POST', `/contact-groups/${vend.id}/add`, { ids: [ana.id] })).status === 404, 'another team can’t touch the group');
} catch (e) { ok(false, e.stack); }
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-10).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
