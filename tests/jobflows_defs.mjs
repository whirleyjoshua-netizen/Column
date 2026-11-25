// Job Flows, definitions and versions (docs/jobflows/CONTRACTS.md §1, the owner 2026-11-24): an owner or admin
// builds a named flow (a draft), publishes it (an immutable version), edits the draft again without touching what was
// published, copies it (an independent draft with new step ids), archives it (no new jobs; runs go on). Members can't
// write flows and never see drafts or other teams' flows.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobflows_defs';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5240, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
if (!(await fetch(B + '/api/health').then((x) => x.ok, () => false))) { console.log('FAIL the server didn’t start\n' + srv.log.slice(-2000)); process.exit(1); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Bins ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Bins ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Olive Park', email: `olive${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const olive = call(r.body.token);
  st = (await rico('GET', '/state')).body;
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'] })).body;
  const list = { projectId: p.id, typeId: p.types[0].id };

  const steps = [
    { kind: 'client', name: 'Add client info' },
    { kind: 'book', name: 'Book on schedule' },
    { kind: 'work', name: 'Clean the cans' },
    { kind: 'custom', name: 'Bins back by the house', settings: { text: 'Put them back where they were.' } },
  ];
  r = await rico('POST', '/job-flows', { name: 'Trash can cleaning, individual', icon: '🗑️', list, steps });
  ok(r.status === 200 && r.body?.id && !r.body.activeVersionId, 'an owner makes a flow, a draft with no version yet: ' + r.status + ' ' + JSON.stringify(r.body)?.slice(0, 160));
  const flow = r.body;
  ok(flow?.draft?.steps?.length === 4 && flow.draft.steps.every((s) => s.id), 'its steps get ids');

  r = await sam('POST', '/job-flows', { name: 'Sam’s flow', list, steps });
  ok(r.status === 403, 'a member can’t make a flow: ' + r.status);
  r = await sam('GET', '/job-flows');
  ok(r.status === 200 && !(r.body?.flows || []).some((f) => f.id === flow.id), 'a member doesn’t see an unpublished flow');

  // Validation before publishing.
  r = await rico('POST', '/job-flows', { name: 'Empty', list, steps: [] });
  ok(r.status === 400, 'a flow with no steps is refused: ' + r.status);
  r = await rico('POST', '/job-flows', { name: 'Too long', list, steps: Array.from({ length: 31 }, (_, i) => ({ kind: 'custom', name: 'Step ' + i })) });
  ok(r.status === 400, '31 steps are refused: ' + r.status);
  r = await rico('POST', '/job-flows', { name: 'Odd step', list, steps: [{ kind: 'quote', name: 'Quote' }] });
  ok(r.status === 400, 'a step kind not offered yet (quote) is refused: ' + r.status);
  r = await rico('POST', '/job-flows', { name: 'Bad list', list: { projectId: 'nope', typeId: 'nope' }, steps });
  ok(r.status === 400, 'a list that isn’t a job list here is refused: ' + r.status);
  r = await rico('POST', '/job-flows', { name: 'Stranger', list, steps: [{ kind: 'custom', name: 'X', who: { type: 'member', id: 'not-a-member' } }] });
  ok(r.status === 400, 'a step for someone not on the team is refused: ' + r.status);

  // Publish → version 1, frozen.
  r = await rico('POST', `/job-flows/${flow.id}/publish`);
  ok(r.status === 200 && r.body?.activeVersionId && r.body.version?.n === 1, 'publishing makes version 1: ' + r.status + ' ' + JSON.stringify(r.body)?.slice(0, 160));
  const v1 = r.body.activeVersionId;
  const stepIds = flow.draft.steps.map((s) => s.id);
  r = await rico('PATCH', `/job-flows/${flow.id}`, { steps: [...flow.draft.steps.map((s) => (s.kind === 'custom' ? { ...s, name: 'Bins back, lids shut' } : s)), { kind: 'payment', name: 'Collect payment' }] });
  ok(r.status === 200 && r.body?.draft?.steps?.length === 5 && r.body.activeVersionId === v1, 'editing the draft leaves version 1 active');
  r = await rico('GET', `/job-flows/${flow.id}/versions`);
  const ver1 = (r.body?.versions || []).find((v) => v.id === v1);
  ok(ver1?.body?.steps?.length === 4 && ver1.body.steps.find((s) => s.kind === 'custom')?.name === 'Bins back by the house', 'version 1 still has its 4 steps as published');
  r = await rico('PATCH', `/job-flows/${flow.id}/versions/${v1}`, { steps: [] });
  ok(r.status === 404 || r.status === 405, 'no route changes a version: ' + r.status);
  r = await rico('GET', `/job-flows/${flow.id}/versions`);
  ok((r.body?.versions || []).find((v) => v.id === v1)?.body?.steps?.length === 4, 'and version 1 is unchanged after the attempt');
  r = await rico('POST', `/job-flows/${flow.id}/publish`);
  ok(r.status === 200 && r.body.version?.n === 2 && r.body.activeVersionId !== v1, 'publishing again makes version 2');
  ok(JSON.stringify(r.body.version.body.steps.slice(0, 4).map((s) => s.id)) === JSON.stringify(stepIds), 'versions of one flow keep their step ids');

  // Members see the active version only.
  r = await sam('GET', '/job-flows');
  const seen = (r.body?.flows || []).find((f) => f.id === flow.id);
  ok(!!seen && !seen.draft && seen.version?.n === 2, 'a member sees the published flow, its active version, no draft');
  r = await sam('GET', `/job-flows/${flow.id}/versions`);
  ok(r.status === 403, 'a member can’t list old versions: ' + r.status);
  r = await sam('PATCH', `/job-flows/${flow.id}`, { name: 'Mine now' });
  ok(r.status === 403, 'a member can’t edit a flow: ' + r.status);
  r = await olive('GET', '/job-flows');
  ok(r.status === 200 && !(r.body?.flows || []).some((f) => f.id === flow.id), 'another team doesn’t see it');
  r = await olive('PATCH', `/job-flows/${flow.id}`, { name: 'Taken' });
  ok(r.status === 404, 'another team can’t touch it: ' + r.status);

  // Copy: an independent draft with new step ids.
  r = await rico('POST', `/job-flows/${flow.id}/copy`);
  ok(r.status === 200 && r.body?.id !== flow.id && !r.body.activeVersionId && r.body.draft.steps.length === 5, 'copying makes an unpublished draft');
  ok(r.body?.draft?.steps?.every((s) => !stepIds.includes(s.id)), 'a copy gets new step ids');

  // Archive: off the list for new jobs, still readable.
  r = await rico('POST', `/job-flows/${flow.id}/archive`, { archived: true });
  ok(r.status === 200 && r.body?.archived === true, 'an owner archives it');
  r = await sam('GET', '/job-flows');
  ok(!(r.body?.flows || []).some((f) => f.id === flow.id), 'an archived flow isn’t offered to members');

  // It survives a restart.
  srv.kill(); await sleep(400);
  const again = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
  r = await rico('GET', `/job-flows/${flow.id}/versions`);
  ok((r.body?.versions || []).length === 2, 'flows and versions are saved: ' + (r.body?.versions || []).length);
  again.kill();
} catch (e) {
  console.log('FAIL threw: ' + e.stack);
  fails++;
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
