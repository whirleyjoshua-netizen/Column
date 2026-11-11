// Audit (docs/audit/FINDINGS.md G3): a customer accepts exactly the quote they saw. If its lines changed after they
// opened it, accepting asks them to look again; once accepted, the lines can't be edited (in the app or the API).
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_quote';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4913, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const vOf = async (u) => (await (await fetch(u)).text()).match(/name="v" value="([^"]+)"/)?.[1] || '';
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Q ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const jo = call(r.body.token);
  const p = (await jo('POST', '/projects', { template: 'bids', name: 'Estimating' })).body;
  const T = Object.fromEntries(p.types.map((x) => [x.key, x]));
  const F = (k) => T.quotes.fields.find((f) => f.key === k);
  const q = (await jo('POST', `/projects/${p.id}/records`, { typeId: T.quotes.id, values: { title: 'Tint', valid_until: '2099-12-31', items: { rows: [{ desc: 'Film', qty: 10, price: 400 }] } } })).body;
  const sent = (await jo('POST', `/records/${q.id}/share`, { hours: 0 })).body;
  const url = `${B}/q/${sent.share.token}`;
  const seen = await vOf(url); // the customer opens it: $4,000
  ok(!!seen, 'G3 the accept form carries a fingerprint of the lines on the page');
  await jo('PATCH', `/records/${q.id}`, { values: { [F('items').id]: { rows: [{ desc: 'Film', qty: 10, price: 550 }] } } }); // changed to $5,500 while it's open
  r = await fetch(url + '/accept', { method: 'POST', body: new URLSearchParams({ name: 'Maria', v: seen }), redirect: 'manual' });
  const stOf = async () => { const recs = (await jo('GET', `/projects/${p.id}/records`)).body; const rec = recs.find((x) => x.id === q.id); return F('status').choices.find((c) => c.id === rec.values[F('status').id])?.label; };
  ok(r.status === 409 && (await stOf()) !== 'Accepted', 'G3 accepting the $4,000 page after it changed to $5,500 doesn’t accept it; they’re asked to look again');
  r = await fetch(url + '/accept', { method: 'POST', body: new URLSearchParams({ name: 'Maria', v: await vOf(url) }), redirect: 'manual' });
  ok(r.status === 303 && (await stOf()) === 'Accepted', 'G3 accepting what’s on the page now works');
  r = await jo('PATCH', `/records/${q.id}`, { values: { [F('items').id]: { rows: [{ desc: 'Film', qty: 10, price: 900 }] } } });
  ok(r.status === 400, 'G3 once accepted, its lines can’t be edited in the app');
  const key = (await jo('POST', '/integrations/keys', { name: 'k' })).body.token;
  r = await call(key)('PATCH', `/v1/projects/${p.id}/quotes/records/${q.id}`, { fields: { items: { rows: [{ description: 'Film', qty: 10, price: 900 }] } } });
  ok(r.status === 400, 'G3 or through the API');
  ok((await jo('PATCH', `/records/${q.id}`, { values: { [F('title').id]: 'Tint (signed)' } })).status === 200, 'G3 other fields can still change');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
