import http from 'node:http';
import crypto from 'node:crypto';
const B = 'http://127.0.0.1:4797';
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) process.exitCode = 1; };
const req = (base, tok) => async (m, p, body, raw) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json().catch(() => null); if (raw) return { status: r.status, body: j }; if (!r.ok) { const e = new Error(p + ' ' + r.status + ' ' + JSON.stringify(j)); e.status = r.status; e.body = j; throw e; } return j; };
const auth = async (base, body) => (await (await fetch(base + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json());
const team = 'pj' + Date.now();
const a = await auth(B, { workspace: team, password: 'secret1', name: 'Jo', mode: 'create', device: 'x', deviceId: 'd1' });
const A = req(B, a.token);
const st = await A('GET', '/api/state');
const b = await auth(B, { workspace: team, password: 'secret2', name: 'Sam', mode: 'join', code: st.workspace.inviteCode, device: 'y', deviceId: 'd2' });
const Bc = req(B, b.token);
const sam = (await A('GET', '/api/state')).workspace.members.find((m) => m.name === 'Sam');
// CRM template
const p = await A('POST', '/api/projects', { template: 'crm', name: 'Sales' });
ok(p.types.map((t) => t.key).join() === 'contacts,deals,companies' && p.template === 'crm', 'CRM project made with companies, contacts, deals');
const T = Object.fromEntries(p.types.map((t) => [t.key, t]));
const F = (t, k) => T[t].fields.find((f) => f.key === k);
ok(F('contacts', 'company').target === T.companies.id && F('deals', 'contact').target === T.contacts.id, 'links point at the right lists');
ok(T.deals.views[0].kind === 'board' && T.deals.views[0].groupBy === F('deals', 'stage').id, 'deals open as a pipeline board by stage');
const co = await A('POST', `/api/projects/${p.id}/records`, { typeId: T.companies.id, values: { name: 'Desert Auto', website: 'desertauto.com' } });
ok(co.values[F('companies', 'website').id] === 'https://desertauto.com', 'website gets https://');
const ct = await A('POST', `/api/projects/${p.id}/records`, { typeId: T.contacts.id, values: { name: 'Maria Lopez', email: 'Maria@DesertAuto.com', company: co.id, stage: 'Qualified', owner: 'Sam' } });
ok(ct.values[F('contacts', 'email').id] === 'maria@desertauto.com' && ct.values[F('contacts', 'company').id][0] === co.id && ct.values[F('contacts', 'owner').id] === sam.id, 'contact: email cleaned, linked to company, owner by name');
ok(F('contacts', 'stage').choices.find((c) => c.label === 'Qualified').id === ct.values[F('contacts', 'stage').id], 'stage by label');
try { await A('POST', `/api/projects/${p.id}/records`, { typeId: T.contacts.id, values: { name: 'X', stage: 'Martian' } }); ok(false, 'unknown stage refused'); } catch (e) { ok(/isn’t one of its options/.test(e.message), 'in the app, an unknown stage is refused'); }
try { await A('POST', `/api/projects/${p.id}/records`, { typeId: T.contacts.id, values: { name: 'X', email: 'nope' } }); ok(false, 'bad email'); } catch (e) { ok(/isn’t an email/.test(e.message), 'a bad email is refused'); }
const deal = await A('POST', `/api/projects/${p.id}/records`, { typeId: T.deals.id, values: { name: 'Fleet tint', value: '12,500', stage: 'Proposal', contact: ct.id, close_date: 'Nov 30 2026' } });
ok(deal.values[F('deals', 'value').id] === 1250000 && deal.values[F('deals', 'close_date').id] === '2026-11-30', 'money in cents, date read from words');
const bad = await A('POST', `/api/projects/${p.id}/records`, { typeId: T.deals.id, values: { name: 'Wrong link', contact: co.id } });
ok(!bad.values[F('deals', 'contact').id], 'a link to the wrong kind of record is dropped');
// import with matching by email
const imp = await A('POST', `/api/projects/${p.id}/import`, { typeId: T.contacts.id, match: F('contacts', 'email').id, rows: [
  { [F('contacts', 'name').id]: 'Maria Lopez', [F('contacts', 'email').id]: 'maria@desertauto.com', [F('contacts', 'city').id]: 'Las Vegas' },
  { [F('contacts', 'name').id]: 'Ben Ortiz', [F('contacts', 'email').id]: 'ben@x.com', [F('contacts', 'stage').id]: 'Trade show' },
  { [F('contacts', 'name').id]: 'Bad', [F('contacts', 'email').id]: 'not-an-email' } ] });
ok(imp.added === 1 && imp.updated === 1 && imp.skipped.length === 1 && imp.skipped[0].row === 3, 'import: 1 updated by email, 1 added, 1 skipped with its row number');
let recs = await A('GET', `/api/projects/${p.id}/records`);
ok(recs.find((r) => r.id === ct.id).values[F('contacts', 'city').id] === 'Las Vegas', 'the matched contact got the new city');
const proj2 = (await A('GET', '/api/projects')).find((x) => x.id === p.id);
ok(proj2.types.find((t) => t.key === 'contacts').fields.find((f) => f.key === 'stage').choices.some((c) => c.label === 'Trade show'), 'a new stage from the import became an option');
// schema changes
let s = await A('POST', `/api/projects/${p.id}/schema`, { op: 'addField', typeId: T.deals.id, name: 'Probability', type: 'number' });
ok(s.made.key === 'probability', 'added a field with a key');
await A('POST', `/api/projects/${p.id}/schema`, { op: 'updateField', typeId: T.deals.id, fieldId: s.made.id, name: 'Chance %' });
s = await A('POST', `/api/projects/${p.id}/schema`, { op: 'addField', typeId: T.deals.id, name: 'Chance', type: 'text' });
ok(s.made.key === 'chance', 'renaming keeps the key; a new field gets its own');
const stageF = s.project.types.find((t) => t.id === T.deals.id).fields.find((f) => f.key === 'stage');
await A('POST', `/api/projects/${p.id}/schema`, { op: 'updateField', typeId: T.deals.id, fieldId: stageF.id, choices: stageF.choices.filter((c) => c.label !== 'Proposal') });
recs = await A('GET', `/api/projects/${p.id}/records`);
ok(recs.find((r) => r.id === deal.id).values[stageF.id] === undefined, 'removing an option clears it from records');
try { await A('POST', `/api/projects/${p.id}/schema`, { op: 'removeField', typeId: T.deals.id, fieldId: T.deals.primary }); ok(false, 'primary'); } catch (e) { ok(e.status === 400, 'the name field can’t be removed'); }
// privacy
const priv = await A('POST', '/api/projects', { template: 'blank', name: 'Secret', private: true });
ok(!(await Bc('GET', '/api/projects')).some((x) => x.id === priv.id), 'Sam can’t see a private project');
const r404 = await Bc('GET', `/api/projects/${priv.id}/records`, null, true);
ok(r404.status === 404, 'or its records');
try { await Bc('DELETE', `/api/projects/${p.id}`); ok(false, 'delete'); } catch (e) { ok(e.status === 403, 'Sam can’t delete Jo’s project'); }
// ---- public API ----
const nokey = await req(B, null)('GET', '/api/v1/projects', null, true);
ok(nokey.status === 401, 'the API needs a key');
try { await Bc('POST', '/api/integrations/keys', { name: 'x' }); ok(false, 'member key'); } catch (e) { ok(e.status === 403, 'only owners make API keys'); }
const k = await A('POST', '/api/integrations/keys', { name: 'Zapier' });
ok(k.token.startsWith('col_') && !(await A('GET', '/api/integrations/keys'))[0].hash && !(await A('GET', '/api/integrations/keys'))[0].token, 'key shown once; never listed again');
const V = req(B, k.token);
const sch = await V('GET', '/api/v1/projects');
const crm = sch.projects.find((x) => x.id === p.id);
ok(crm && crm.types.find((t) => t.key === 'contacts').fields.find((f) => f.key === 'stage').options.includes('Lead') && !sch.projects.some((x) => x.id === priv.id), 'schema by keys and option labels; private projects hidden');
const made = await V('POST', `/api/v1/projects/${p.id}/contacts/records`, { external_id: 'hubspot-77', fields: { name: 'Ana Ruiz', email: 'ana@y.com', stage: 'Webinar', owner: 'Jo' } });
ok(made.external_id === 'hubspot-77' && made.fields.stage === 'Webinar' && made.fields.owner.name === 'Jo', 'API creates with labels; a new option is added');
const dup = await V('POST', `/api/v1/projects/${p.id}/contacts/records`, { external_id: 'hubspot-77', fields: { name: 'Again' } }, true);
ok(dup.status === 409, 'the same external_id twice is refused');
const up = await V('PUT', `/api/v1/projects/${p.id}/contacts/records/external/hubspot-77`, { fields: { city: 'Henderson' } }, true);
ok(up.status === 200 && up.body.id === made.id && up.body.fields.city === 'Henderson' && up.body.fields.name === 'Ana Ruiz', 'PUT by external_id updates the same record');
const up2 = await V('PUT', `/api/v1/projects/${p.id}/contacts/records/external/hubspot-78`, { fields: { name: 'New Person' } }, true);
ok(up2.status === 201, 'and creates it when it isn’t there');
const unk = await V('POST', `/api/v1/projects/${p.id}/contacts/records`, { fields: { nam: 'typo' } }, true);
ok(unk.status === 400 && /Unknown field: nam/.test(unk.body.error) && /name, email/.test(unk.body.error), 'an unknown field key is explained');
const pg1 = await V('GET', `/api/v1/projects/${p.id}/contacts/records?limit=2`);
const pg2 = await V('GET', `/api/v1/projects/${p.id}/contacts/records?limit=2&cursor=${pg1.next_cursor}`);
const all = await V('GET', `/api/v1/projects/${p.id}/contacts/records?limit=100`);
ok(pg1.records.length === 2 && pg2.records.length === 2 && new Set([...pg1.records, ...pg2.records].map((r) => r.id)).size === 4 && all.records.length === 4, 'paging with a cursor gets every record once');
await new Promise((r) => setTimeout(r, 30));
const sinceIso = new Date().toISOString();
await new Promise((r) => setTimeout(r, 30));
await V('PATCH', `/api/v1/projects/${p.id}/contacts/records/${made.id}`, { fields: { title: 'Fleet manager' } });
const changed = await V('GET', `/api/v1/projects/${p.id}/contacts/records?updated_since=${encodeURIComponent(sinceIso)}`);
ok(changed.records.length === 1 && changed.records[0].fields.title === 'Fleet manager', 'updated_since returns only what changed');
const ro = await A('POST', '/api/integrations/keys', { name: 'Reports', write: false });
const RO = req(B, ro.token);
ok((await RO('GET', `/api/v1/projects/${p.id}/deals/records`, null, true)).status === 200 && (await RO('DELETE', `/api/v1/projects/${p.id}/contacts/records/${made.id}`, null, true)).status === 403, 'a read-only key reads but can’t write');
await A('DELETE', `/api/integrations/keys/${ro.id}`);
ok((await RO('GET', '/api/v1/projects', null, true)).status === 401, 'a deleted key stops working');
// ---- webhooks ----
const got = [];
const hookSrv = http.createServer((q, s2) => { let body = ''; q.on('data', (c) => (body += c)); q.on('end', () => { got.push({ headers: q.headers, body }); s2.writeHead(got.length === 1 && process.env.FAIL_FIRST ? 500 : 200); s2.end('ok'); }); }).listen(4788);
const hk = await A('POST', '/api/integrations/webhooks', { url: 'http://127.0.0.1:4788/hook', projectId: p.id });
ok(hk.secret.startsWith('whsec_'), 'webhook made with a signing secret (shown once)');
await V('PATCH', `/api/v1/projects/${p.id}/contacts/records/${made.id}`, { fields: { stage: 'Customer' } });
await new Promise((r) => setTimeout(r, 400));
const ev = got.at(-1);
const payload = JSON.parse(ev.body);
const [tPart, vPart] = ev.headers['x-kloomie-signature'].split(',');
const expect = crypto.createHmac('sha256', hk.secret).update(`${tPart.slice(2)}.${ev.body}`).digest('hex');
ok(payload.type === 'record.updated' && payload.list === 'contacts' && payload.data.fields.stage === 'Customer' && payload.by === 'Zapier (API)', 'webhook says what changed, by whom, with the record');
ok(vPart.slice(3) === expect, 'the signature checks out with the secret');
await A('DELETE', `/api/records/${made.id}`);
await new Promise((r) => setTimeout(r, 300));
ok(JSON.parse(got.at(-1).body).type === 'record.deleted', 'deleting sends record.deleted');
await A('POST', `/api/integrations/webhooks/${hk.id}/test`);
await new Promise((r) => setTimeout(r, 300));
ok(JSON.parse(got.at(-1).body).type === 'ping', 'Send test delivers a ping');
const log = (await A('GET', '/api/integrations/webhooks'))[0].log;
ok(log.length >= 3 && log.every((l) => l.ok && l.status === 200), 'deliveries are logged');
hookSrv.close();
// a dead endpoint: logged as failed, retried later (not within this test)
const dead = await A('POST', '/api/integrations/webhooks', { url: 'http://127.0.0.1:4787/none', projectId: p.id });
await A('PATCH', `/api/records/${ct.id}`, { values: { title: 'Owner' } });
await new Promise((r) => setTimeout(r, 400));
const dl = (await A('GET', '/api/integrations/webhooks')).find((h) => h.id === dead.id).log[0];
ok(dl && !dl.ok && dl.error, 'a failed delivery is logged with its error');
// ---- the other server: no private addresses ----
const a2 = await auth('http://127.0.0.1:4795', { workspace: team + 'b', password: 'secret1', name: 'Jo', mode: 'create', device: 'x', deviceId: 'd1' });
const A2 = req('http://127.0.0.1:4795', a2.token);
for (const url of ['http://example.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://10.0.0.5/x', 'https://169.254.169.254/latest']) {
  const r = await A2('POST', '/api/integrations/webhooks', { url }, true);
  ok(r.status === 400, `refused: ${url} (${r.body?.error})`);
}
// deleting a project takes its records
await A('DELETE', `/api/projects/${p.id}`);
ok((await A('GET', `/api/projects/${p.id}/records`, null, true)).status === 404 && (await V('GET', `/api/v1/projects/${p.id}`, null, true)).status === 404, 'deleting a project removes it everywhere');
process.exit();
