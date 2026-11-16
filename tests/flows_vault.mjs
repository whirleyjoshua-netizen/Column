// Flows, step 4: an automation drops a sealed note into a person's vault, and sends what happened to another app
// with a key kept sealed. The vault's drop key is made "in the browser" (WebCrypto here, as the app does): its public
// half goes to the server, its private half only encrypted with the vault's own key. A drop is sealed to it, so the
// server keeps nothing it can read (checked in the saved data), and the browser opens it with the private half.
// Starting the vault over throws drops away. Keys for other apps are shown once (last four after), never in the
// automation or the saved data in the clear; deleting one makes its automations fail and say so.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/flows_vault';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4973, H_PORT = 4974, B = `http://127.0.0.1:${PORT}`, H = `http://127.0.0.1:${H_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (f, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(100); } return false; };
// Another app, receiving.
const got = [];
let reply = 200;
const hook = http.createServer(async (req, res) => { let raw = ''; for await (const c of req) raw += c; got.push({ path: req.url, auth: req.headers.authorization || null, body: JSON.parse(raw || '{}') }); res.writeHead(reply); res.end('{}'); });
await new Promise((r) => hook.listen(H_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1', ALLOW_LOCAL_WEBHOOKS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
// The browser's side, as client/app.js does it.
const C = globalThis.crypto.subtle;
const b64u = (u8) => Buffer.from(u8).toString('base64url');
const unb64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));
const enc = new TextEncoder(), dec = new TextDecoder();
async function vaultKeyFrom(pass, salt, iters) {
  const base = await C.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return C.deriveKey({ name: 'PBKDF2', salt: unb64u(salt), iterations: iters, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const aesSeal = async (key, value) => { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await C.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)))); return b64u(Buffer.concat([iv, ct])); };
const aesOpen = async (key, blob) => { const b = unb64u(blob); return JSON.parse(dec.decode(await C.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12) }, key, b.subarray(12)))); };
async function openDrop(vk, drop, d) {
  const priv = await C.importKey('pkcs8', unb64u(await aesOpen(vk, drop.priv)), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const epk = await C.importKey('raw', unb64u(d.epk), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = await C.deriveBits({ name: 'ECDH', public: epk }, priv, 256);
  const hk = await C.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const k = await C.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: unb64u(d.epk), info: enc.encode('kloomie-vault-drop') }, hk, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return aesOpen(k, d.blob);
}
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Vault ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  let st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Vault ' + t, code: st.workspace.inviteCode, name: 'Mo Lane', email: `mo${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const mo = call(r.body.token);
  st = (await rico('GET', '/state')).body;
  const moId = st.workspace.members.find((m) => m.name === 'Mo Lane').id;
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });

  // Mo sets up a vault (no drop key yet: it's made once it's unlocked).
  const salt = b64u(crypto.getRandomValues(new Uint8Array(16))), iters = 100_000;
  const vk = await vaultKeyFrom('mo’s long passphrase', salt, iters);
  await mo('POST', '/vault/setup', { salt, iters, check: await aesSeal(vk, 'column-vault') });
  ok((await mo('GET', '/vault')).body.drop === null, 'a new vault doesn’t take drops yet');

  // An automation to drop into Mo's vault; Mo can't take drops yet, so it says so.
  r = await rico('POST', '/automations', { name: 'Gate code to Mo', trigger: { kind: 'record.created' }, actions: [{ kind: 'vault', to: moId, title: 'Gate code for {record}', text: 'The gate code for {record} is in the note: {record}-4471' }] });
  ok(r.status === 200 && r.body.actions[0].kind === 'vault' && r.body.actions[0].to === moId, 'an automation that drops into Mo’s vault is saved');
  ok((await rico('POST', '/automations', { name: 'Empty', trigger: { kind: 'record.created' }, actions: [{ kind: 'vault', to: moId, text: '' }] })).status === 400, 'a drop with nothing in it is refused');
  const p = (await rico('POST', '/projects', { template: 'blank', name: 'Sites' })).body;
  const tp = p.types[0];
  const rec = async (name) => (await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { [tp.primary]: name } })).body;
  await rec('Oak St');
  const runs = async (name) => (await rico('GET', '/automations')).body.find((x) => x.name === name)?.runs || [];
  ok(await until(async () => /haven’t opened their vault since it could take drops/.test((await runs('Gate code to Mo'))[0]?.note || '')), 'before Mo’s vault takes drops, nothing is put there (and it says why)');

  // Mo unlocks: the browser makes the drop key.
  const kp = await C.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = b64u(new Uint8Array(await C.exportKey('raw', kp.publicKey)));
  const priv = await aesSeal(vk, b64u(new Uint8Array(await C.exportKey('pkcs8', kp.privateKey))));
  ok((await mo('POST', '/vault/dropkey', { pub: 'AAAA', priv })).status === 400, 'a drop key that isn’t a P-256 point is refused');
  r = await mo('POST', '/vault/dropkey', { pub, priv });
  ok(r.status === 200 && r.body.drop.pub === pub, 'Mo’s vault takes drops now');
  ok((await mo('POST', '/vault/dropkey', { pub, priv })).status === 409, 'and its drop key can’t be swapped (only by starting the vault over)');
  ok((await rico('POST', '/vault/dropkey', { pub, priv })).status === 400, 'someone without a vault can’t set one');

  await rec('Elm Rd');
  ok(await until(async () => (await runs('Gate code to Mo'))[0]?.note === 'Put a sealed note in Mo Lane’s vault'), 'a job is added: the note goes in Mo’s vault, and the log doesn’t say what it was');
  let v = (await mo('GET', '/vault')).body;
  ok(v.drops.length === 1 && v.drops[0].from === 'Gate code to Mo' && !JSON.stringify(v.drops).includes('4471'), 'one drop waits for Mo, sealed');
  const note = await openDrop(vk, v.drop, v.drops[0]);
  ok(note.kind === 'note' && note.title === 'Gate code for Elm Rd' && note.note === 'The gate code for Elm Rd is in the note: Elm Rd-4471' && note.from === 'Gate code to Mo', 'Mo’s browser opens it with the vault’s own key: the note, with the words filled in');
  const dbText = () => (fs.existsSync(DIR + '/db.json') ? fs.readFileSync(DIR + '/db.json', 'utf8') : '');
  await until(() => dbText().includes(v.drops[0].id));
  const raw = dbText();
  ok(raw.includes('{record}-4471') && !raw.includes('Elm Rd-4471') && !raw.includes('Gate code for Elm'), 'the server’s saved data has nothing it can read of the note (only the automation’s own words, with {record} in them)');
  ok(JSON.stringify((await rico('GET', '/state')).body).includes('4471') === false, 'nobody else sees it either');
  const n = (await mo('GET', '/state')).body.notices?.find((x) => x.kind === 'vault');
  ok(!n || /left you a sealed note/.test(n.text), 'Mo is told something is waiting');
  // Kept: as an ordinary vault item, and the drop goes.
  await mo('POST', '/vault/items', { blob: await aesSeal(vk, note) });
  ok([400, 404].includes((await rico('DELETE', `/vault/drops/${v.drops[0].id}`)).status), 'nobody else can throw away Mo’s drop');
  ok((await mo('DELETE', `/vault/drops/${v.drops[0].id}`)).status === 200, 'Mo’s browser keeps it as an item and the drop goes');
  v = (await mo('GET', '/vault')).body;
  ok(v.drops.length === 0 && v.items.length === 1, 'one item in Mo’s vault, nothing waiting');

  // Starting over throws away drops (they can't be opened any more) and the drop key.
  await rec('Pine Ave');
  ok(await until(async () => (await mo('GET', '/vault')).body.drops.length === 1), '(setup) another drop waiting');
  const vk2 = await vaultKeyFrom('a new passphrase', salt, iters);
  await mo('POST', '/vault/setup', { salt, iters, check: await aesSeal(vk2, 'column-vault'), reset: true });
  v = (await mo('GET', '/vault')).body;
  ok(v.drops.length === 0 && v.drop === null, 'starting the vault over throws away what was waiting, and its drop key');

  // "Whoever set it off" and the maker.
  r = await rico('POST', '/automations', { name: 'To whoever', trigger: { kind: 'record.created' }, actions: [{ kind: 'vault', to: 'who', text: 'x' }] });
  ok(r.status === 200 && r.body.actions[0].to === 'who', 'a drop to whoever set it off is saved');
  await rico('DELETE', '/automations/' + r.body.id);

  // Keys for other apps.
  ok((await mo('GET', '/automations/secrets')).status === 403, 'members can’t see automation keys');
  ok((await rico('POST', '/automations/secrets', { name: 'Hook', value: 'short' })).status === 400, 'a key that’s too short is refused');
  r = await rico('POST', '/automations/secrets', { name: 'Zap hook', value: 'zk_live_supersecret_9Q2X' });
  const key = r.body;
  ok(r.status === 200 && key.last4 === '9Q2X' && !JSON.stringify(key).includes('supersecret'), 'a key is kept: only its name and last four come back');
  ok(!JSON.stringify((await rico('GET', '/automations/secrets')).body).includes('supersecret'), 'and it’s never shown again');
  ok((await rico('POST', '/automations', { name: 'Bad url', trigger: { kind: 'record.created' }, actions: [{ kind: 'webhook', url: 'ftp://x.test/' }] })).status === 400, 'an address that isn’t https is refused');
  ok((await rico('POST', '/automations', { name: 'Creds', trigger: { kind: 'record.created' }, actions: [{ kind: 'webhook', url: 'https://user:pw@x.test/' }] })).status === 400, 'a key in the address is refused');
  ok((await rico('POST', '/automations', { name: 'Gone key', trigger: { kind: 'record.created' }, actions: [{ kind: 'webhook', url: H + '/in', secretId: 'nope' }] })).status === 400, 'a key that isn’t the team’s is refused');
  r = await rico('POST', '/automations', { name: 'Tell Zapier', trigger: { kind: 'record.created' }, actions: [{ kind: 'webhook', url: H + '/in', secretId: key.id }] });
  ok(r.status === 200 && !JSON.stringify(r.body).includes('supersecret'), 'an automation that sends to another app, with the key, is saved (by the key’s id only)');
  ok((await rico('GET', '/automations/secrets')).body[0].used === 1, 'the key says one automation uses it');
  await rico('PATCH', '/automations/' + (await rico('GET', '/automations')).body.find((x) => x.name === 'Gate code to Mo').id, { on: false });
  await rec('Birch Ln');
  ok(await until(() => got.length === 1), 'a job is added: it’s sent to the other app');
  ok(got[0]?.auth === 'Bearer zk_live_supersecret_9Q2X' && got[0].body.automation === 'Tell Zapier' && got[0].body.event === 'record.created' && got[0].body.words.record === 'Birch Ln', 'with the key, and what happened ({record} and the rest)');
  ok(await until(async () => (await runs('Tell Zapier'))[0]?.note === `Sent to 127.0.0.1:${H_PORT}`), 'the log says where it went');
  await until(() => dbText().includes(key.id));
  ok(dbText().includes(key.id) && !dbText().includes('supersecret'), 'the key isn’t in the saved data in the clear');
  reply = 500;
  await rec('Cedar Ct');
  ok(await until(async () => { const x = (await runs('Tell Zapier'))[0]; return x && !x.ok && /said 500/.test(x.note); }), 'when the other app fails, the run is marked failed');
  reply = 200;
  await rico('DELETE', '/automations/secrets/' + key.id);
  await rec('Ash Way');
  ok(await until(async () => { const x = (await runs('Tell Zapier'))[0]; return x && !x.ok && /its key is gone/.test(x.note); }), 'with its key deleted it fails, and says so');
  ok(got.length === 2, 'and nothing was sent without the key');
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
hook.close();
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
