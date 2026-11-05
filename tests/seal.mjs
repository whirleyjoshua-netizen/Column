import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9334, 'chrome2');
const chrome2 = launch(9335, 'chrome3');
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
const team = 'seal' + Date.now();
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1'; f.device.value = 'Jo laptop'; if (f.email && f.code !== undefined) { f.email.value = f.name.value.toLowerCase().replace(/[^a-z]/g, '') + f.workspace.value.replace(/[^a-z0-9]/gi, '') + '@t.test'; if (f.password.value.length < 8) f.password.value += 'pad1'; } f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo signed in');
// This suite uses tools a new team starts without: switch them all on.
await A.ev(`fetch('/api/workspace', { method: 'PATCH', headers: { authorization: 'Bearer ' + JSON.parse(localStorage.getItem('column.token')), 'content-type': 'application/json' }, body: JSON.stringify({ tools: { sidekick: true, docs: true, contacts: true, email: true, folders: true, signs: true, bills: true, meetings: true, map: true, vault: true, projects: true } }) }).then((r) => r.ok)`);
await A.until(`document.querySelector('#toolsBtn') && true`, 500);
await sleep(1200);
const tokA = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = (tok) => async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
const JA = api(tokA);
const code0 = (await JA('GET', '/state')).workspace.inviteCode;
const B = await tab(APP, 9335);
await B.until(`!!document.querySelector('#loginLinks a')`);
await sleep(1000);
await B.ev(`(() => { document.querySelector('[data-mode=join]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Sam'; f.password.value = 'secret2'; f.code.value = '${code0}'; f.device.value = 'Sam phone'; if (f.email && f.code !== undefined) { f.email.value = f.name.value.toLowerCase().replace(/[^a-z]/g, '') + f.workspace.value.replace(/[^a-z0-9]/gi, '') + '@t.test'; if (f.password.value.length < 8) f.password.value += 'pad1'; } f.requestSubmit(); })()`);
const sj = await B.until(`!document.querySelector('#app').classList.contains('hidden')`); if (!sj) console.log('SAM:', await B.ev(`document.querySelector('#loginErr')?.textContent + ' | ' + location.href`)); ok(sj, 'Sam joined');
await sleep(1000);
// Jo: a sealed note from the stack's +
await A.tap(`document.querySelector('[data-tab=column]')`);
await A.tap(`[...document.querySelectorAll('.composer .add')].find((b) => b.offsetParent)`);
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Sealed note'))`);
await A.ev(`(() => { const s = document.querySelector('#sheet'); s.querySelector('input').value = 'Shop alarm'; s.querySelector('textarea').value = 'Alarm code 4417, disarm within 30s'; [...s.querySelectorAll('input')][1].value = 'Alarm code'; })()`);
await A.tap(`document.querySelector('#sheet .primary-btn')`);
const gotCode = await A.until(`/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(document.querySelector('#sheet .seal-code')?.textContent || '')`, 10000); if (!gotCode) { console.log('JO SHEET:', await A.ev(`document.querySelector('#sheet').innerText.slice(0, 300)`)); process.exit(1); } ok(gotCode, 'Jo gets a one-time code like XXXX-XXXX-XXXX');
const code = await A.ev(`document.querySelector('#sheet .seal-code').textContent`);
await A.ev(`document.querySelector('#sheet .primary-btn').click()`);
const card = (await JA('GET', '/state')).items.find((x) => x.type === 'sealed');
ok(card && card.label === 'Alarm code' && card.burn && card.expiresAt > Date.now() && !JSON.stringify(card).includes('4417') && !JSON.stringify(card).includes('Shop alarm'), 'the server has only the label and scrambled data, no secret, no name');
const raw = FS.readFileSync(process.argv[2] + '/dk/data/db.json', 'utf8');
ok(!/(?<![0-9a-zA-Z_-])4417(?![0-9a-zA-Z_-])/.test(raw) && !raw.includes(code.replace(/-/g, '')), 'neither the secret nor the code is anywhere in Column’s data file');
// Sam sees the card and opens it
await B.tap(`document.querySelector('[data-tab=column]')`);
ok(await B.until(`[...document.querySelectorAll('.sealed-card')].some((c) => c.textContent.includes('Alarm code') && c.textContent.includes('Sealed by Jo') && c.textContent.includes('burns after reading'))`), 'Sam sees a sealed card: label, sender, burns after reading');
await B.tap(`[...document.querySelectorAll('.sealed-card .meta')].find((c) => c.textContent.includes('Alarm code'))`);
await B.until(`!!document.querySelector('#sheet .seal-in')`);
await B.ev(`document.querySelector('#sheet .seal-in').value = 'AAAA-BBBB-CCCC'`);
await B.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await B.until(`document.querySelector('#sheet .err')?.textContent.includes('doesn’t open it')`, 8000), 'a wrong code doesn’t open it');
ok((await JA('GET', '/state')).items.some((x) => x.type === 'sealed'), 'and a wrong code doesn’t burn it');
await B.ev(`document.querySelector('#sheet .seal-in').value = ${JSON.stringify(code.toLowerCase().replace(/-/g, ' '))}`);
await B.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await B.until(`document.querySelector('#sheet .seal-note')?.textContent === 'Alarm code 4417, disarm within 30s' && document.querySelector('#sheet h2')?.textContent.includes('Shop alarm')`, 8000), 'the right code (any case, spaces instead of dashes) opens it');
ok(await B.ev(`!!document.querySelector('#sheet .seal-burn')`), 'Sam is told it has been deleted');
ok(await A.until(`![...document.querySelectorAll('.sealed-card')].length`, 4000), 'the card is gone from Jo’s stack too');
await B.ev(`document.querySelector('#sheet .primary-btn').click()`);
// From the vault, kept (no burn)
await A.tap(`document.querySelector('#toolsBtn')`); await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Vault'))`);
await A.until(`!!document.querySelector('#tool input[type=password]')`);
await A.ev(`(() => { const ins = [...document.querySelectorAll('#tool input')]; ins[0].value = 'correct horse battery'; ins[1].value = 'correct horse battery'; const cb = document.querySelector('#tool input[type=checkbox]'); if (cb) cb.checked = true; })()`);
await A.tap(`[...document.querySelectorAll('#tool .btn')].find((b) => b.textContent === 'Set up my vault')`);
await A.until(`[...document.querySelectorAll('#tool .btn')].some((b) => b.textContent === '+ Add')`, 15000);
await A.tap(`[...document.querySelectorAll('#tool .btn')].find((b) => b.textContent === '+ Add')`);
await A.ev(`(() => { const s = document.querySelector('#sheet'); const k = s.querySelector('select'); k.value = 'login'; k.dispatchEvent(new Event('change')); })()`);
await A.ev(`(() => { const s = document.querySelector('#sheet'); const ins = [...s.querySelectorAll('input')]; ins[0].value = 'Supplier portal'; ins[1].value = 'filmco.com'; ins[2].value = 'jo@shop.com'; ins[3].value = 'Tint!2026'; ins.slice(1, 4).forEach((i) => i.dispatchEvent(new Event('input'))); })()`);
await A.tap(`document.querySelector('#sheet .primary-btn')`);
await A.tap(`[...document.querySelectorAll('#tool .vault-row')].find((r) => r.textContent.includes('Supplier portal'))`);
await A.tap(`[...document.querySelectorAll('#sheet .btn')].find((b) => b.textContent.includes('Send sealed'))`);
ok(await A.until(`document.querySelector('#sheet h2')?.textContent.startsWith('Send sealed') && document.querySelector('#sheet input').value === 'Supplier portal'`), 'a vault item: Send sealed…, labelled with its name');
await A.ev(`(() => { const s = document.querySelector('#sheet'); s.querySelector('input[type=checkbox]').checked = false; const life = [...s.querySelectorAll('select')].at(-1); life.value = '168'; })()`);
await A.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await A.until(`!!document.querySelector('#sheet .seal-code')`, 15000), 'sealed, with its code');
const code2 = await A.ev(`document.querySelector('#sheet .seal-code').textContent`);
await A.ev(`document.querySelector('#sheet .primary-btn').click()`);
await B.until(`[...document.querySelectorAll('.sealed-card')].some((c) => c.textContent.includes('Supplier portal') && c.textContent.includes('expires in 7 days'))`);
await B.tap(`[...document.querySelectorAll('.sealed-card .meta')].find((c) => c.textContent.includes('Supplier portal'))`);
await B.until(`!!document.querySelector('#sheet .seal-in')`);
await B.ev(`document.querySelector('#sheet .seal-in').value = ${JSON.stringify(code2)}`);
await B.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await B.until(`[...document.querySelectorAll('#sheet .seal-row')].map((r) => r.querySelector('small').textContent).join(',') === 'Website,Username,Password'`, 8000), 'Sam sees the login’s fields');
ok(await B.ev(`[...document.querySelectorAll('#sheet .seal-row')][2].querySelector('.seal-val').textContent === '••••••••'`), 'the password is hidden until Show');
await B.tap(`[...[...document.querySelectorAll('#sheet .seal-row')][2].querySelectorAll('.btn')].find((b) => b.textContent === 'Show')`);
ok(await B.ev(`[...document.querySelectorAll('#sheet .seal-row')][2].querySelector('.seal-val').textContent === 'Tint!2026'`), 'Show reveals it');
ok(!(await B.ev(`!!document.querySelector('#sheet .seal-burn')`)), 'not burned (that was turned off)');
await B.ev(`document.querySelector('#sheet .primary-btn').click()`);
ok(await A.until(`[...document.querySelectorAll('.sealed-card')].some((c) => c.textContent.includes('opened 1×'))`, 4000), 'Jo sees it was opened once');
ok(!A.errors.length && !B.errors.length, 'no page errors' + (A.errors.length + B.errors.length ? ': ' + [...A.errors, ...B.errors].join(' / ') : ''));
A.close(); B.close(); chrome.kill(); chrome2.kill();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
