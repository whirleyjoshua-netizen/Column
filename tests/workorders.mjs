// Work orders (Command Center part 5, 2026-11-20): a task made a work order gets a number (WO-1001…), keeps its steps
// (the checklist), its instructions (the description), a list of materials (from Inventory or typed) and can need the
// customer's signature. It can't be finished until every step is ticked and, when it needs one, the customer has
// signed, on every path (the app and the public API). A saved campaign keeps the setup, not the signature.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/wo';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4994, B = `http://127.0.0.1:${PORT}`;
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
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
try {
  let r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Wo ' + t, name: 'Maria', email: `maria${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const maria = call(r0.body.token);
  r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Olga', email: `olga${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const olga = call(r0.body.token);
  const item = (await maria('POST', '/inventory/items', { name: 'Blind bracket', unit: 'ea' })).body;
  const camp = (await maria('POST', '/campaigns', { name: 'Garcia install' })).body;
  const g = (await maria('POST', '/goals', { campaignId: camp.id, title: 'Install' })).body;
  let r = await maria('POST', '/tasks', { goalId: g.id, text: 'Install the blinds', description: 'Level, then hang.', checklist: [{ text: 'Brackets up' }, { text: 'Blinds hung' }] });
  const task = r.body;
  r = await maria('PATCH', '/tasks/' + task.id, { wo: { sign: true, materials: [{ itemId: item.id, qty: 6 }, { name: 'Screws', qty: 24, unit: 'ea' }, { name: '', qty: 1 }] } });
  let wo = r.body.wo;
  ok(r.status === 200 && /^WO-\d+$/.test(wo?.no || '') && wo.sign === true, 'a task made a work order gets a number and can need a signature: ' + JSON.stringify(wo && { no: wo.no, sign: wo.sign }));
  ok(wo.materials.length === 2 && wo.materials[0].name === 'Blind bracket' && wo.materials[0].unit === 'ea' && wo.materials[0].itemId === item.id && wo.materials[1].name === 'Screws' && wo.materials.every((x) => x.id && !x.used), 'materials: an Inventory item (named from it) and a typed one; a blank line is dropped');
  const t2 = (await maria('POST', '/tasks', { goalId: g.id, text: 'Second' })).body;
  r = await maria('PATCH', '/tasks/' + t2.id, { wo: {} });
  ok(r.body.wo.no !== wo.no && Number(r.body.wo.no.slice(3)) === Number(wo.no.slice(3)) + 1, 'the next one gets the next number: ' + r.body.wo.no);
  r = await maria('PATCH', '/tasks/' + task.id, { wo: { materials: [{ itemId: 'nope', qty: 1 }] } });
  ok(r.status === 200 && r.body.wo.materials.length === 0 && r.body.wo.no === wo.no && r.body.wo.sign === true, 'an item from nowhere is dropped; the number and signature setting stay');
  r = await maria('PATCH', '/tasks/' + task.id, { wo: { materials: [{ itemId: item.id, qty: 6, used: true }] } });
  ok(r.body.wo.materials[0].used === true, 'a material marked used');
  // Not finished until the steps are ticked and the customer has signed.
  r = await maria('PATCH', '/tasks/' + task.id, { done: true });
  ok(r.status === 409 && /step/i.test(r.body.error), 'it can’t be finished with steps open: ' + r.body.error);
  const cl = (await maria('GET', '/state')).body.tasks.find((x) => x.id === task.id).checklist;
  r = await maria('PATCH', '/tasks/' + task.id, { checklist: cl.map((x) => ({ ...x, done: true })) });
  r = await maria('PATCH', '/tasks/' + task.id, { done: true });
  ok(r.status === 409 && /sign/i.test(r.body.error), 'nor before the customer signs: ' + r.body.error);
  r = await maria('PATCH', '/tasks/' + task.id, { woSign: { name: 'Ana Garcia', img: 'data:image/png;base64,AAAA' } });
  ok(r.status === 400, 'a signature that isn’t a picture is refused');
  r = await maria('PATCH', '/tasks/' + task.id, { woSign: { name: '', img: PNG } });
  ok(r.status === 400, 'a signature needs the signer’s name');
  r = await maria('PATCH', '/tasks/' + task.id, { woSign: { name: 'Ana Garcia', img: PNG } });
  ok(r.status === 200 && r.body.wo.signed?.name === 'Ana Garcia' && r.body.wo.signed.img === PNG && r.body.wo.signed.at && r.body.wo.signed.by === 'Maria', 'the customer signs: name, picture, when, and who handed it over');
  r = await maria('PATCH', '/tasks/' + task.id, { done: true });
  ok(r.status === 200 && r.body.done, 'now it can be finished');
  r = await maria('PATCH', '/tasks/' + task.id, { woSign: null });
  ok(r.status === 409, 'a finished work order’s signature stays');
  // Every path: a job task outside a campaign, finished through the public API.
  const plain = (await maria('POST', '/tasks', { text: 'Service call' })).body;
  await maria('PATCH', '/tasks/' + plain.id, { wo: { sign: true } });
  const key = (await maria('POST', '/integrations/keys', { name: 'wo test' })).body;
  if (key?.token) {
    const pr = await fetch(B + '/api/v1/tasks/' + plain.id, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key.token }, body: JSON.stringify({ done: true }) });
    ok(pr.status === 409, 'the public API can’t finish it unsigned either: ' + pr.status);
  } else ok(false, 'made an API key: ' + JSON.stringify(key));
  // Not a work order any more.
  r = await maria('PATCH', '/tasks/' + t2.id, { wo: null });
  ok(r.status === 200 && !r.body.wo, 'a task can stop being a work order');
  r = await olga('PATCH', '/tasks/' + task.id, { wo: {} });
  ok(r.status === 404 || r.status === 403, 'someone on another team can’t touch it');
  // A saved campaign keeps the setup, not the signature or what was used.
  const tp = (await maria('POST', '/templates', { campaignId: camp.id, name: 'Install', tz: 'America/Los_Angeles' })).body;
  const run = (await maria('POST', `/templates/${tp.id}/run`, { date: '2026-12-01' })).body;
  const st = (await maria('GET', '/state')).body;
  const rg = st.goals.find((x) => x.campaignId === run.id);
  const rt = st.tasks.find((x) => x.goalId === rg.id && x.text === 'Install the blinds');
  ok(rt?.wo && rt.wo.no !== wo.no && rt.wo.sign === true && rt.wo.materials.length === 1 && rt.wo.materials[0].itemId === item.id && !rt.wo.materials[0].used && !rt.wo.signed, 'a run of the saved campaign has its own work order: same setup, a new number, nothing used or signed');
} catch (e) { ok(false, e.stack); }
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-10).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
