// What members can see and do (the owner, 2026-11-20: "make sure the separation of admin and basic users is deep ...
// can see team schedule if admin allows. also tabs that users have in their workspace should be controlled by admin"):
// owners and admins switch each Workspace tab and tool on or off for members, and whether members see the team's
// schedule. Off means the server refuses it too (not just a hidden button) and keeps its data off their devices;
// owners and admins always keep everything. Off for the whole team (Tools switches) stays off for everyone.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/member_access';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5245, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Acc ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Acc ' + t, code: st.workspace.inviteCode, name: 'Mo Lane', email: `mo${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const mo = call(r.body.token);
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, inventory: true, bills: true, meetings: true, map: true } });
  await rico('POST', '/inventory/items', { name: 'Air filter', onHand: 5 });
  const week = new Date().toISOString().slice(0, 10);

  // The defaults: what members had before.
  st = (await mo('GET', '/state')).body;
  ok(st.workspace.memberAccess && st.workspace.memberAccess.contacts === false && st.workspace.memberAccess.inventory === true && st.workspace.memberAccess.teamSchedule === false, 'members start as before: no Contacts, no team schedule, the rest on');
  ok((await mo('GET', '/inventory')).status === 200 && (await mo('GET', '/contacts')).status === 403 && (await mo('GET', '/workload?week=' + week)).status === 403, 'so Inventory works for Mo; Contacts and the team schedule don’t');
  ok((await mo('PATCH', '/workspace', { memberAccess: { inventory: false } })).status === 403, 'members can’t change what members get');

  // Switched off for members: refused by the server, not just hidden.
  r = await rico('PATCH', '/workspace', { memberAccess: { inventory: false, projects: false, bills: false, meetings: false, map: false, chat: false } });
  ok(r.status === 200 && r.body.memberAccess.inventory === false && r.body.memberAccess.projects === false, 'Rico switches Inventory, Boards, Finance, Meetings, Map and Chat off for members');
  r = await mo('GET', '/inventory');
  ok(r.status === 403 && /off for members/.test(r.body.error), `Inventory refused for Mo: “${r.body?.error}”`);
  ok((await mo('POST', '/inventory/requests', { lines: [{ name: 'x', qty: 1 }] })).status === 403, 'every Inventory route, not just the list');
  ok((await mo('GET', '/projects')).status === 403 && (await mo('POST', '/projects', { template: 'blank' })).status === 403, 'Boards refused');
  ok((await mo('GET', '/meetings')).status === 403 && (await mo('GET', '/trips')).status === 403, 'Meetings and Map refused');
  ok((await mo('POST', '/items', { type: 'message', text: 'hi' })).status === 403 && (await mo('POST', '/channels', { name: 'mine' })).status === 403, 'Chat: no messages, no new feeds');
  st = (await mo('GET', '/state')).body;
  ok(Array.isArray(st.projects) && st.projects.length === 0 && st.money.length === 0 && st.bills.length === 0 && !st.items.some((it) => it.type === 'message'), 'and their data stays off his device (boards, money, messages)');
  ok((await mo('POST', '/items', { type: 'text', text: 'a card' })).status === 200, 'what’s still on works (a card in a stack)');
  ok((await rico('GET', '/inventory')).status === 200 && (await rico('GET', '/projects')).status === 200 && (await rico('POST', '/items', { type: 'message', text: 'owner says hi' })).status === 200, 'owners and admins keep everything');
  st = (await rico('GET', '/state')).body;
  ok(st.items.some((it) => it.type === 'message'), 'the owner still sees messages');

  // Turned on for members: Contacts and the team schedule.
  r = await rico('PATCH', '/workspace', { memberAccess: { contacts: true, teamSchedule: true, inventory: true } });
  ok(r.body.memberAccess.contacts === true && r.body.memberAccess.teamSchedule === true, 'Rico lets members use Contacts and see the team schedule');
  ok((await mo('GET', '/contacts')).status === 200, 'Mo can open Contacts now');
  r = await mo('POST', '/contacts', { name: 'Dana Fox', phone: '602 555 0101' });
  ok(r.status === 200, 'and add someone');
  const danaId = r.body.id || r.body.contact?.id;
  ok((await mo('DELETE', '/contacts/' + danaId)).status === 403 && (await mo('POST', '/contact-groups', { name: 'Vendors' })).status === 403, 'but removing contacts and managing groups stay with owners and admins');
  ok((await mo('GET', '/workload?week=' + week)).status === 200 && (await mo('GET', '/forecast')).status === 200, 'and the team’s schedule (workload and the weeks ahead)');
  ok((await mo('GET', '/inventory')).status === 200, 'Inventory is back for him');

  // Off for the whole team stays off: a member can't get a tool the team doesn't have.
  await rico('PATCH', '/workspace', { tools: { inventory: false } });
  st = (await mo('GET', '/state')).body;
  ok(st.workspace.tools.inventory === false, 'Inventory off for the team: off for everyone, whatever members get');
  ok((await rico('PATCH', '/workspace', { memberAccess: { nonsense: true } })).body.memberAccess.nonsense === undefined, 'only known switches are kept');
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
