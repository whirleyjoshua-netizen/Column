// Receipts on money (Finance, the owner 2026-11-20): a photo or PDF kept with a money entry, apart from the team's
// files. Each is seen by exactly who sees its entry: a business expense's by owners and admins, a personal one's by
// its owner. A link opens with the file key (never the sign-in). Deleting the entry deletes its receipts.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/receipts';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5162, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const raw = (tok, p) => fetch(B + '/api' + p, { headers: tok ? { authorization: 'Bearer ' + tok } : {} });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PDF = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
const t = Date.now();
try {
  const r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Rc ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const adaT = r0.body.token, ada = call(adaT);
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const join = async (name, n) => (await call()('POST', '/auth', { mode: 'join', workspace: 'Rc ' + t, code, name, email: `${name.toLowerCase()}${t}@t.test`, password: 'longenough' + n, device: 'Mac', deviceId: 'd' + n })).body.token;
  const benT = await join('Ben', 2), cyT = await join('Cy', 3);
  const ben = call(benT), cy = call(cyT);
  const benId = (await ada('GET', '/state')).body.workspace.members.find((x) => x.name === 'Ben').id;
  await ada('PATCH', '/members/' + benId, { role: 'admin' });
  await ada('PATCH', '/workspace', { tools: { bills: true } });
  const today = new Date().toISOString().slice(0, 10);
  const biz = (await ada('POST', '/money', { kind: 'out', amount: '42', day: today, category: 'Supplies', note: 'Home Depot', scope: 'business' })).body;
  const mine = (await ada('POST', '/money', { kind: 'out', amount: '9', day: today, category: 'Food', note: 'Lunch', scope: 'personal' })).body;

  let r = await ada('POST', `/money/${biz.id}/receipts`, { name: 'receipt.png', data: PNG });
  ok(r.status === 200 && r.body.receipts?.length === 1 && r.body.receipts[0].mime === 'image/png' && r.body.receipts[0].name === 'receipt.png', 'Ada adds a photo of the receipt');
  const rc = r.body.receipts[0];
  r = await ada('POST', `/money/${biz.id}/receipts`, { name: 'invoice.pdf', data: PDF });
  ok(r.status === 200 && r.body.receipts[1]?.mime === 'application/pdf', 'or a PDF');
  ok((await ada('POST', `/money/${biz.id}/receipts`, { name: 'x.html', data: 'data:text/html;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64') })).status === 400, 'anything else is turned away');

  let f = await raw(adaT, `/money/${biz.id}/receipts/${rc.id}`);
  ok(f.status === 200 && f.headers.get('content-type')?.startsWith('image/png') && (await f.arrayBuffer()).byteLength > 50, 'it opens for Ada');
  f = await raw(benT, `/money/${biz.id}/receipts/${rc.id}`);
  ok(f.status === 200, 'and for Ben (admin): it’s the business’s money');
  f = await raw(cyT, `/money/${biz.id}/receipts/${rc.id}`);
  ok(f.status === 404, 'not for Cy (member)');
  ok(!(await cy('GET', '/state')).body.items.some((x) => /receipt/.test(x.name || '')), 'and it isn’t among the team’s files');
  ok((await ben('GET', '/state')).body.money.find((x) => x.id === biz.id)?.receipts?.length === 2, 'Ben’s Finance shows the entry has 2 receipts');

  // A link with the file key, as an <img> uses.
  const key = (await ada('GET', '/state')).body.me.fileKey;
  f = await fetch(`${B}/api/money/${biz.id}/receipts/${rc.id}?t=${key}`);
  ok(f.status === 200, 'a link with Ada’s file key opens it');
  f = await fetch(`${B}/api/money/${biz.id}/receipts/${rc.id}?t=nope`);
  ok(f.status === 401 || f.status === 404, 'a made-up key doesn’t');

  // Personal money's receipts are only its owner's.
  r = await ada('POST', `/money/${mine.id}/receipts`, { name: 'lunch.png', data: PNG });
  const lunch = r.body.receipts[0];
  ok((await raw(benT, `/money/${mine.id}/receipts/${lunch.id}`)).status === 404, 'Ben can’t open the receipt on Ada’s personal money');

  // Removing.
  ok((await cy('DELETE', `/money/${biz.id}/receipts/${rc.id}`)).status === 404, 'Cy can’t remove one');
  r = await ben('DELETE', `/money/${biz.id}/receipts/${rc.id}`);
  ok(r.status === 200 && r.body.receipts.length === 1, 'Ben can');
  ok((await raw(adaT, `/money/${biz.id}/receipts/${rc.id}`)).status === 404, 'and it’s gone');
  const pdfId = r.body.receipts[0].id;
  await ada('DELETE', '/money/' + biz.id);
  ok((await raw(adaT, `/money/${biz.id}/receipts/${pdfId}`)).status === 404, 'deleting the entry takes its receipts with it');
  const left = fs.readdirSync(DIR + '/files').filter((n) => n.startsWith('receipt-'));
  ok(left.length === 1, `only the lunch receipt’s file is left on disk (${left.length})`);
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.split('\n').filter((l) => /error/i.test(l)).slice(-10).join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
