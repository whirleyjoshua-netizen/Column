// Signing in chat, on the server: a message, a photo or a Word file becomes a PDF next to it (POST /docs/pdf with
// the item), which is then signed with /pdf/:id/save and lands in the same feed. Pictures in PDFs: JPEG as well as
// PNG (pdf-lib read a small JPEG's bytes from the wrong place: "SOI not found in JPEG").
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/chatsign';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4866, B = `http://127.0.0.1:${PORT}`;
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
// A 1×1 JPEG and a 1×1 PNG.
const JPG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const t = Date.now();
try {
  const r0 = await call()('POST', '/auth', { mode: 'create', workspace: 'Sign ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ada = call(r0.body.token);
  let r = await ada('POST', '/docs/pdf', { name: 'Photo', blocks: [{ t: 'img', src: 'data:image/jpeg;base64,' + JPG, w: 5000 }] });
  ok(r.status === 200 && r.body.name === 'Photo.pdf', 'a JPEG picture makes a PDF');
  r = await ada('POST', '/docs/pdf', { name: 'Logo', blocks: [{ t: 'img', src: 'data:image/png;base64,' + PNG, w: 5000 }] });
  ok(r.status === 200, 'and a PNG');
  const crew = (await ada('POST', '/channels', { name: 'crew' })).body.channels.find((x) => x.name === 'crew');
  const msg = (await ada('POST', '/items', { type: 'message', text: 'I agree to the install on Nov 20 for $2,400.\nPayment on completion.', channelId: crew.id })).body;
  r = await ada('POST', '/docs/pdf', { itemId: msg.id, name: 'I agree to the install', blocks: [{ t: 'p', runs: [{ text: 'I agree to the install on Nov 20 for $2,400.' }] }] });
  ok(r.status === 200 && r.body.channelId === crew.id, 'a message’s PDF lands in its feed');
  const pdf = r.body;
  await ada('PUT', '/signature', { sig: 'data:image/png;base64,' + PNG });
  r = await ada('POST', `/pdf/${pdf.id}/save`, { marks: [{ id: 'm1', type: 'sig', page: 0, x: 72, y: 600, w: 150, h: 50 }] });
  ok(r.status === 200 && r.body.name === 'I agree to the install (signed).pdf' && r.body.channelId === crew.id, 'signed, the copy lands in the same feed');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.split('\n').filter((l) => /error/i.test(l)).slice(-10).join('\n'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
