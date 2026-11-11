// Audit (docs/audit/FINDINGS.md, sign-offs): a PDF someone keeps private isn't shown to people who can't see it just
// because it's used as a form; and a filled-in form is made at most 20 times a minute per person.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_signoff';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4941, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  const team = 'Sign ' + t;
  let r = await call()('POST', '/auth', { mode: 'create', workspace: team, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token), code = r.body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: team, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  await jo('PATCH', '/workspace', { tools: { projects: true } });
  const p = (await jo('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
  const tp = p.types[0];
  const sigF = tp.fields.find((f) => f.key === 'signoff');
  const job = (await jo('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'AC tune-up' } })).body;
  ok(!!sigF && !!job?.id, '(setup) a job with a sign-off');

  // Jo's private PDF, used as the job's form.
  const dir = (await jo('POST', '/dirs', { name: 'Jo only', private: true })).body;
  const pdf = (await jo('POST', '/docs/pdf', { name: 'Private terms', blocks: [{ t: 'p', runs: [{ text: 'Jo’s private terms and prices.' }] }] })).body;
  await jo('PATCH', `/items/${pdf.id}`, { dirId: dir.id });
  ok(!(await sam('GET', '/state')).body.items.some((x) => x.id === pdf.id), '(setup) Sam can’t see Jo’s private PDF');
  const form = (await jo('POST', '/sign-forms', { name: 'Private terms', kind: 'pdf', itemId: pdf.id })).body;
  r = await jo('POST', `/signoff/${job.id}/${sigF.id}/form`, { formId: form.id });
  ok(r.status === 200, '(setup) the job uses it as its sign-off form');
  r = await sam('GET', `/signoff/${job.id}/${sigF.id}/preview`);
  ok(r.status === 400 && !JSON.stringify(r.body).includes('private terms'), `Sam can’t open the private PDF through the sign-off (${r.status})`);
  ok((await fetch(`${B}/api/signoff/${job.id}/${sigF.id}/pdf`, { headers: { authorization: 'Bearer ' + (await call()('POST', '/auth', { mode: 'email', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd3' })).body.token } })).status === 400, 'nor download it filled in');
  ok((await jo('GET', `/signoff/${job.id}/${sigF.id}/preview`)).status === 200, 'Jo, who can see it, can');

  // A filled-in form at most 20 times a minute per person.
  await jo('POST', `/signoff/${job.id}/${sigF.id}/form`, { formId: null });
  const codes = [];
  for (let i = 0; i < 22; i++) codes.push((await jo('GET', `/signoff/${job.id}/${sigF.id}/preview`)).status);
  ok(codes.filter((c) => c === 200).length <= 20 && codes.at(-1) === 429, `asked 22 times in a minute, the last ones wait (${codes.slice(-3).join(',')})`);
  ok((await sam('GET', `/signoff/${job.id}/${sigF.id}/preview`)).status === 200, 'and the limit is per person');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
