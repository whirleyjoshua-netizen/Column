// Notifications: the bell's list and pushes to a device while Kloomie is closed. A local HTTPS "push service"
// takes the server's pushes and decrypts them with the device's keys, so what a phone would show is checked for real.
import fs from 'node:fs';
import https from 'node:https';
import crypto from 'node:crypto';
import { spawn, execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = process.argv[2];
const DIR = S + '/dk/push';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4781, PUSH = 4782, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

// ---- the push service ----
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${DIR}/k.pem -out ${DIR}/c.pem -days 1 -subj /CN=127.0.0.1 2>/dev/null`);
const got = []; // { path, headers, body }
const pushSrv = https.createServer({ key: fs.readFileSync(DIR + '/k.pem'), cert: fs.readFileSync(DIR + '/c.pem') }, (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    got.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(req.url.includes('gone') ? 410 : 201).end();
  });
}).listen(PUSH);
// A device: its own P-256 key pair and auth secret, as a browser would make.
const device = (name) => {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const secret = crypto.randomBytes(16);
  return { ecdh, secret, sub: { endpoint: `https://127.0.0.1:${PUSH}/push/${name}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: secret.toString('base64url') } } };
};
// RFC 8291 / 8188: what the phone does with a push.
const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));
function decrypt(dev, body) {
  const salt = body.subarray(0, 16), idlen = body[20], keyid = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const shared = dev.ecdh.computeSecret(keyid);
  const ikm = hkdf(dev.secret, shared, Buffer.concat([Buffer.from('WebPush: info\0'), dev.ecdh.getPublicKey(), keyid]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString());
}
const pushesTo = (name) => got.filter((g) => g.path === '/push/' + name);
const waitPush = async (name, n, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (pushesTo(name).length >= n) return true; await sleep(50); } return false; };

// ---- the server ----
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '1', DATABASE_URL: '', NODE_TLS_REJECT_UNAUTHORIZED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({ status: r.status }));
};
const t = Date.now();
let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Bells ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
const J = call(r.token), jTok = r.token;
const code = (await J('GET', '/state')).workspace.inviteCode;
r = await call()('POST', '/auth', { mode: 'join', workspace: 'Bells ' + t, code, name: 'Ken', email: `ken${t}@t.test`, password: 'longenough1', device: 'Ken phone', deviceId: 'd2' });
const K = call(r.token), kTok = r.token;
const st = await J('GET', '/state');
const ken = st.workspace.members.find((m) => m.name === 'Ken').id, jo = st.me.memberId;

// ---- turning it on ----
const phone = device('kenphone');
ok((await K('POST', '/push', { sub: { ...phone.sub, endpoint: 'http://127.0.0.1/x' } })).error, 'a push address that isn’t https is refused');
ok((await K('POST', '/push', { sub: phone.sub })).ok, 'Ken turns notifications on for his phone');
let info = await K('GET', '/push?endpoint=' + encodeURIComponent(phone.sub.endpoint));
ok(info.key?.length > 60 && info.here === true && info.all === true && info.devices[0] === 'Ken phone', 'the server knows his phone; new messages are on by default');

// ---- a mention ----
const msg = await J('POST', '/items', { type: 'message', text: 'Can you grab the ladder @Ken?' });
ok(await waitPush('kenphone', 1), 'a mention reaches his phone');
let p = pushesTo('kenphone')[0];
ok(/^vapid t=.+, k=.+/.test(p.headers.authorization) && p.headers['content-encoding'] === 'aes128gcm' && Number(p.headers.ttl) > 0, 'signed (VAPID) and encrypted the standard way');
let note = decrypt(phone, p.body);
ok(note.title === 'Jo mentioned you' && note.body === 'Can you grab the ladder @Ken?' && note.url === '/?go=' + encodeURIComponent('item:' + msg.id), 'it decrypts to who, what and where it opens: ' + JSON.stringify(note));
ok(note.count === 1, 'with the bell count for the app icon');
let notes = (await K('GET', '/state')).notices;
ok(notes.length === 1 && notes[0].kind === 'mention' && !notes[0].read && notes[0].go === 'item:' + msg.id, 'and it is in his bell, unread');
ok(!pushesTo('jo').length && (await J('GET', '/state')).notices.length === 0, 'Jo (who wrote it) gets nothing');

// ---- a plain message: push only; and the switch for it ----
got.length = 0;
await J('POST', '/items', { type: 'message', text: 'Lunch is here' });
ok(await waitPush('kenphone', 1), 'a new message reaches his phone too');
note = decrypt(phone, pushesTo('kenphone')[0].body);
ok(note.title === 'Jo' && note.body === 'Lunch is here', 'saying who and what');
ok((await K('GET', '/state')).notices.length === 1, 'but it doesn’t go in the bell (Chat has its own dot)');
ok((await K('PUT', '/push/prefs', { all: false })).all === false, 'Ken turns off new messages');
got.length = 0;
await J('POST', '/items', { type: 'message', text: 'Another one' });
await J('POST', '/items', { type: 'message', text: '@here meeting at 3' });
await waitPush('kenphone', 1);
await sleep(500);
ok(pushesTo('kenphone').length === 1 && decrypt(phone, pushesTo('kenphone')[0].body).title === 'Jo mentioned you', 'then only what’s for him comes through (@here counts)');

// ---- while he's looking at Kloomie, it waits ----
const sock = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { authorization: 'Bearer ' + kTok } });
await new Promise((res) => sock.on('open', res));
const seen = [];
sock.on('message', (d) => seen.push(JSON.parse(d)));
sock.send(JSON.stringify({ type: 'vis', visible: true }));
await sleep(200);
got.length = 0;
await J('POST', '/items', { type: 'message', text: '@Ken you there?' });
await sleep(800);
ok(pushesTo('kenphone').length === 0, 'no push while he has Kloomie open and in front');
ok(seen.some((x) => x.type === 'notice' && x.notice.kind === 'mention'), 'the open app gets the notice instead');
sock.send(JSON.stringify({ type: 'vis', visible: false }));
await sleep(200);
await J('POST', '/items', { type: 'message', text: '@Ken hello?' });
ok(await waitPush('kenphone', 1), 'once it’s in the background, pushes come again');
sock.close();
await sleep(200);

// ---- tasks handed over: one push for a burst; nothing for edits or your own ----
got.length = 0;
const t1 = await J('POST', '/tasks', { text: 'Measure the kitchen', assigneeId: ken, due: '2026-12-01' });
ok(await waitPush('kenphone', 1, 3000), 'a task given to Ken reaches him');
note = decrypt(phone, pushesTo('kenphone')[0].body);
ok(note.title === 'Jo assigned you a task' && note.body.startsWith('Measure the kitchen') && note.url.includes(encodeURIComponent('task:' + t1.id)), 'saying what it is: ' + note.body);
got.length = 0;
await J('PATCH', '/tasks/' + t1.id, { text: 'Measure the whole kitchen' });
await J('POST', '/tasks', { text: 'Jo’s own thing', assigneeId: jo });
await K('POST', '/tasks', { text: 'Ken’s own thing', assigneeId: ken });
await sleep(1600);
ok(pushesTo('kenphone').length === 0, 'renaming it, Jo’s own task and his own task send nothing');
await Promise.all(['One', 'Two', 'Three'].map((x) => J('POST', '/tasks', { text: x, assigneeId: ken })));
await waitPush('kenphone', 1, 3000);
await sleep(1300);
ok(pushesTo('kenphone').length === 1 && decrypt(phone, pushesTo('kenphone')[0].body).title === 'Jo assigned you 3 tasks', 'three at once are one push: ' + (pushesTo('kenphone')[0] && decrypt(phone, pushesTo('kenphone')[0].body).title));

// ---- you're up ----
got.length = 0;
const first = await J('POST', '/tasks', { text: 'Order the cabinets', assigneeId: jo });
const second = await J('POST', '/tasks', { text: 'Fit the cabinets', assigneeId: ken, blockedBy: [first.id] });
await sleep(1300);
got.length = 0;
await J('PATCH', '/tasks/' + first.id, { done: true });
ok(await waitPush('kenphone', 1, 3000), 'when what he was waiting on is done, he hears');
note = decrypt(phone, pushesTo('kenphone')[0].body);
ok(note.title === 'You’re up' && note.body.includes('Fit the cabinets') && note.body.includes('Jo finished'), 'You’re up: ' + note.body);

// ---- things he can't see stay quiet ----
got.length = 0;
const ch = (await J('POST', '/channels', { name: 'jo-only', memberIds: [] }));
const chId = (await J('GET', '/state')).workspace.channels.find((x) => x.name === 'jo-only')?.id;
await K('PUT', '/push/prefs', { all: true });
await J('POST', '/items', { type: 'message', text: 'secret plans @Ken', channelId: chId });
await sleep(800);
ok(chId && pushesTo('kenphone').length === 0 && !(await K('GET', '/state')).notices.some((n) => n.text.includes('secret')), 'a mention in a feed he isn’t in sends nothing');

// ---- the bell ----
ok((await K('GET', '/state')).notices.filter((n) => !n.read).length >= 4, 'his bell has the unread ones');
await K('POST', '/notices/read');
ok((await K('GET', '/state')).notices.every((n) => n.read), 'opening the bell marks them read');
await K('DELETE', '/notices');
ok((await K('GET', '/state')).notices.length === 0, 'Clear all empties it');

// ---- test button, a phone that's gone, logging out ----
got.length = 0;
ok((await K('POST', '/push/test')).ok && await waitPush('kenphone', 1), 'Send a test arrives');
ok(decrypt(phone, pushesTo('kenphone')[0].body).title === 'Notifications are on', 'saying notifications are on');
const old = device('gone');
await K('POST', '/push', { sub: old.sub });
await J('POST', '/items', { type: 'message', text: '@Ken one more' });
await waitPush('gone', 1);
await sleep(300);
ok((await K('GET', '/push')).devices.length === 1, 'a device whose push address is gone (410) is forgotten');
const laptop = device('jolaptop');
await J('POST', '/push', { sub: laptop.sub });
await K('POST', '/logout');
ok((await J('GET', '/push')).devices.length === 1, 'logging out forgets that device’s pushes (and only that one)');
got.length = 0;
await J('POST', '/items', { type: 'message', text: 'anyone?' });
await sleep(600);
ok(pushesTo('kenphone').length === 0, 'so the logged-out phone gets nothing');

// ---- in the app: the bell up top ----
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9336', `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
async function tab(url, port = 9336) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${port}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map();
  const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const KEYS = { Enter: [13, '\r'], Escape: [27], Tab: [9], z: [90] };
  const key = async (k, modifiers = 0) => { const [code, text] = KEYS[k]; await cmd('Input.dispatchKeyEvent', { type: text && !modifiers ? 'keyDown' : 'rawKeyDown', key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, windowsVirtualKeyCode: code, modifiers, ...(text && !modifiers ? { text } : {}) }); await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code, modifiers }); await sleep(40); };
  const type = async (t) => { await cmd('Input.insertText', { text: t }); await sleep(40); };
  const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const tap = async (expr) => {
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(80);
  };
  const click = (sel) => ev(`(() => { const e = typeof ${JSON.stringify(sel)} === 'string' ? document.querySelector(${JSON.stringify(sel)}) : null; e.click(); return true; })()`);
  return { ev, key, type, until, click, tap, cmd, errors, close: () => ws.close() };
}




const A = await tab(B + '/');
await A.until(`!!document.querySelector('#loginLinks a')`);
await A.ev(`(() => { document.querySelector('[data-mode=signin]').click(); const f = document.querySelector('#loginForm'); f.email.value = 'jo${t}@t.test'; f.password.value = 'longenough1'; if (f.device) f.device.value = 'Jo laptop'; f.requestSubmit(); return 1; })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`, 12000), 'Jo is in the app' + await A.ev(`document.querySelector('#app').classList.contains('hidden') ? ' | err=' + document.querySelector('#loginErr').textContent + ' tok=' + localStorage.getItem('column.token') + ' mode=' + document.querySelector('#modeSeg .on')?.dataset.mode + ' email=' + document.querySelector('#loginForm').email.value : ''`));
ok(await A.until(`!!document.querySelector('#bellBtn') && document.querySelector('#bellN').classList.contains('hidden')`), 'a bell up top, with no count yet');
r = await call()('POST', '/auth', { mode: 'email', email: `ken${t}@t.test`, password: 'longenough1', device: 'Ken phone', deviceId: 'd2' });
const K2 = call(r.token);
const kMsg = await K2('POST', '/items', { type: 'message', text: 'Done with the ladder @Jo' });
await K2('POST', '/tasks', { text: 'Sign the delivery note', assigneeId: jo });
ok(await A.until(`document.querySelector('#bellN').textContent === '2'`, 5000), 'the bell shows 2 new: ' + await A.ev(`document.querySelector('#bellN').textContent`));
ok(await A.ev(`![...document.querySelectorAll('.home-card.notes')].length`), 'they’re in the bell, not on Home');
await A.click('#bellBtn');
ok(await A.until(`document.querySelectorAll('#bellPop .bell-row.new').length === 2`), 'opening it lists them, marked new');
ok(await A.ev(`document.querySelector('#bellPop').textContent.includes('Ken mentioned you') && document.querySelector('#bellPop').textContent.includes('Ken assigned you a task')`), 'saying what happened');
ok(await A.until(`document.querySelector('#bellN').classList.contains('hidden')`, 4000), 'and the count goes once seen');
ok((await J('GET', '/state')).notices.every((n) => n.read), 'read on the server too (so her other devices agree)');
await A.ev(`[...document.querySelectorAll('#bellPop .bell-row')].find((b) => b.textContent.includes('mentioned')).click()`);
ok(await A.until(`!document.querySelector('#chat').classList.contains('hidden') && document.querySelector('#bellPop').classList.contains('hidden')`), 'tapping the mention opens the chat it’s in');
ok(await A.ev(`navigator.serviceWorker.getRegistration().then((r) => !!r)`), 'the service worker that shows pushes is installed');
// Opened from a push: /?go=…
await A.ev(`location.href = '/?go=' + encodeURIComponent('task:' + ${JSON.stringify((await J('GET', '/state')).tasks.find((x) => x.text === 'Sign the delivery note').id)}); 1`).catch(() => {});
await sleep(1500);
await A.until(`!document.querySelector('#app').classList.contains('hidden')`);
ok(await A.until(`!document.querySelector('#day').classList.contains('hidden') && location.search === ''`), 'a tapped push opens where it points (a task opens the Day’s tasks) ' + await A.ev(`location.href + ' day hidden=' + document.querySelector('#day').classList.contains('hidden') + ' app hidden=' + document.querySelector('#app').classList.contains('hidden')`));
await A.click('#settingsBtn');
ok(await A.until(`[...document.querySelectorAll('#settings .srow')].some((x) => x.textContent.includes('Notifications'))`), 'Settings → This device has Notifications');
ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
A.close();
chrome.kill();

srv.kill();
pushSrv.close();
if (/Notifying failed|Push failed/.test(srv.log)) ok(false, 'server log: ' + srv.log.match(/.*(Notifying|Push) failed.*/)[0]);
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
