import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9334, 'chrome2');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9334) {
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



const A = await tab(APP);
await A.until(`!!document.querySelector('#loginLinks a')`);
const team = 'vq' + Date.now();
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1'; f.device.value = 'Jo laptop'; if (f.email && f.code !== undefined) { f.email.value = f.name.value.toLowerCase().replace(/[^a-z]/g, '') + f.workspace.value.replace(/[^a-z0-9]/gi, '') + '@t.test'; if (f.password.value.length < 8) f.password.value += 'pad1'; } f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo signed in');
// This suite uses tools a new team starts without: switch them all on.
await A.ev(`fetch('/api/workspace', { method: 'PATCH', headers: { authorization: 'Bearer ' + JSON.parse(localStorage.getItem('column.token')), 'content-type': 'application/json' }, body: JSON.stringify({ tools: { sidekick: true, docs: true, contacts: true, email: true, folders: true, signs: true, bills: true, meetings: true, map: true, vault: true, projects: true } }) }).then((r) => r.ok)`);
await A.until(`document.querySelector('#settingsBtn') && true`, 500);
await sleep(1200);
const tokA = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = (tok) => async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
const JA = api(tokA);
await JA("PATCH", "/workspace", { tools: { vault: true } });
await A.ev(`location.reload()`).catch(() => {});
await sleep(1500);
await A.until(`!document.querySelector('#app').classList.contains('hidden')`);
await sleep(800);
const vaultItems = async () => (await JA('GET', '/vault')).items || [];
const posted = async (needle) => (await JA('GET', '/state')).items.some((x) => JSON.stringify(x).includes(needle));
const typeIn = async (t) => {
  await A.ev(`(() => { const ta = [...document.querySelectorAll('.composer textarea')].find((x) => x.offsetParent); ta.focus(); ta.value = ''; return true; })()`);
  await A.type(t);
};

// 1. "/vault …" in a stack, before the vault exists: set it up, and the form opens with what was typed.
await A.tap(`(document.querySelector('#tabs [data-tab=tools]').click(), document.querySelector('#menu [data-tool=column]'))`);
await typeIn('/vault gate code 4471 at Smith job');
await A.key('Enter');
ok(await A.until(`!!document.querySelector('#split input[type=password]')`), '/vault with no vault yet opens vault setup');
ok(await A.ev(`document.querySelector('#panes').parentElement.id === 'main' && !document.querySelector('#panes').classList.contains('hidden')`), 'the stack it came from moves to the page, with the vault beside it in the split');
await A.ev(`(() => { const ins = [...document.querySelectorAll('#split input')]; ins[0].value = 'correct horse battery'; ins[1].value = 'correct horse battery'; document.querySelector('#split input[type=checkbox]').checked = true; })()`);
await A.tap(`[...document.querySelectorAll('#split .btn')].find((b) => b.textContent === 'Set up my vault')`);
ok(await A.until(`document.querySelector('#sheet h2')?.textContent.startsWith('Save to my vault')`, 15000), 'after setup, the save form opens');
ok(await A.ev(`(() => { const s = document.querySelector('#sheet'); return s.querySelector('select').value === 'code' && [...s.querySelectorAll('input')].some((i) => i.value === 'Gate code at Smith job') && [...s.querySelectorAll('input')].some((i) => i.value === '4471'); })()`), 'it guessed a Code: name “Gate code at Smith job”, code 4471');
await A.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await A.until(`document.querySelector('#sheet').classList.contains('hidden')`), 'saved');
ok((await vaultItems()).length === 1, 'one item in the vault');
ok(!(await posted('4471')), 'nothing was posted to the stack');
ok(await A.ev(`![...document.querySelectorAll('.composer textarea')].find((x) => x.offsetParent).value`), 'the typing box was cleared');

// 2. Locked: + → Save to my vault…, with the passphrase box right in the form.
await A.tap(`[...document.querySelectorAll('#split .btn')].find((b) => b.textContent.includes('Lock'))`);
await typeIn('alarm 9921');
// (the vault drawer is open over the page; a real click on + is what the button does)
await A.ev(`[...document.querySelectorAll('.composer .add')].find((b) => b.offsetParent).click()`);
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Save to my vault'))`);
ok(await A.until(`!!document.querySelector('#sheet .vault-quick-lock:not(.hidden) input[type=password]') && document.querySelector('#sheet .primary-btn').textContent === 'Unlock and save'`), 'locked: the form has a passphrase box and “Unlock and save”');
await A.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await A.until(`document.querySelector('#sheet .err')?.textContent.includes('passphrase')`), 'no passphrase: asked for it');
await A.ev(`document.querySelector('#sheet .vault-quick-lock input').value = 'wrong one here'`);
await A.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await A.until(`document.querySelector('#sheet .err')?.textContent.includes('not the passphrase')`, 10000), 'a wrong passphrase is refused');
ok((await vaultItems()).length === 1, 'and nothing was saved');
await A.ev(`document.querySelector('#sheet .vault-quick-lock input').value = 'correct horse battery'`);
await A.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await A.until(`document.querySelector('#sheet').classList.contains('hidden')`, 10000), 'the right passphrase unlocks and saves');
ok((await vaultItems()).length === 2 && !(await posted('9921')), 'second item in the vault, nothing posted');
ok(await A.until(`document.querySelector('#split')?.textContent.includes('Alarm')`), 'the vault is unlocked and shows it');

// 3. A message already posted in chat: save it, and delete the plain-text original.
await A.tap(`document.querySelector('[data-tab=chat]')`);
await A.until(`[...document.querySelectorAll('.composer textarea')].some((x) => x.offsetParent)`);
await typeIn('supplier acct 12345678901');
await A.key('Enter');
ok(await A.until(`[...document.querySelectorAll('.msg')].some((m) => m.textContent.includes('12345678901'))`), 'message posted');
await A.ev(`[...document.querySelectorAll('.msg')].find((m) => m.textContent.includes('12345678901')).querySelector('button[title="Save to my vault"]').click()`);
ok(await A.until(`document.querySelector('#sheet select')?.value === 'number' && [...document.querySelectorAll('#sheet input')].some((i) => i.value === 'Supplier acct') && document.querySelector('#sheet .pick input')?.checked`), 'from a message: Account number, named “Supplier acct”, delete-the-message ticked');
await A.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await A.until(`document.querySelector('#sheet').classList.contains('hidden')`, 10000), 'saved');
await sleep(500);
ok((await vaultItems()).length === 3 && !(await posted('12345678901')), 'in the vault, and the message is gone');
const raw = FS.readFileSync(process.argv[2] + '/dk/data/db.json', 'utf8');
ok(!/(?<![\w-])(4471|9921)(?![\w-])/.test(raw), 'the codes are nowhere in Kloomie’s data file');
ok(!A.errors.length, 'no page errors' + (A.errors.length ? ': ' + A.errors.join(' / ') : ''));
A.close(); chrome.kill();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
