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
const team = 'p4' + Date.now();
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1'; f.device.value = 'Jo laptop'; if (f.email && f.code !== undefined) { f.email.value = f.name.value.toLowerCase().replace(/[^a-z]/g, '') + f.workspace.value.replace(/[^a-z0-9]/gi, '') + '@t.test'; if (f.password.value.length < 8) f.password.value += 'pad1'; } f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo signed in');
await sleep(1200);
const tokA = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = (tok) => async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
const JA = api(tokA);
const code = (await JA('GET', '/state')).workspace.inviteCode;
const B = await tab(APP, 9335);
await B.until(`!!document.querySelector('#loginLinks a')`);
await B.ev(`(() => { document.querySelector('[data-mode=join]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Sam'; f.password.value = 'secret2'; f.code.value = '${code}'; f.device.value = 'Sam phone'; if (f.email && f.code !== undefined) { f.email.value = f.name.value.toLowerCase().replace(/[^a-z]/g, '') + f.workspace.value.replace(/[^a-z0-9]/gi, '') + '@t.test'; if (f.password.value.length < 8) f.password.value += 'pad1'; } f.requestSubmit(); })()`);
ok(await B.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Sam joined in another browser');
await sleep(1200);
const tokB = await B.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const SB = api(tokB);
// a doc with a picture
const png = execSync(`python3 -c "import zlib,struct,sys;w=h=40;raw=b''.join(b'\\x00'+b'\\xff\\x80\\x00'*w for _ in range(h));c=lambda t,d:struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff);sys.stdout.buffer.write(b'\\x89PNG\\r\\n\\x1a\\n'+c(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+c(b'IDAT',zlib.compress(raw))+c(b'IEND',b''))"`);
const pic = await (await fetch(APP + 'api/upload?name=dot.png&type=image/png', { method: 'PUT', headers: { authorization: 'Bearer ' + tokA }, body: png })).json();
const d = await JA('POST', '/items', { type: 'text', doc: { title: 'Fleet offer', blocks: [{ id: 'a1', type: 'p', runs: [{ text: 'We tint fleets in a day.' }] }, { id: 'a2', type: 'file', itemId: pic.id, name: 'dot.png' }, { id: 'a3', type: 'p', runs: [{ text: 'Price on request.' }] }] } });
await sleep(500);
const openIt = async (T) => {
  await T.tap(`document.querySelector('#toolsBtn')`);
  await T.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Docs'))`);
  await T.tap(`[...document.querySelectorAll('#tool .doc-row')].find((r) => r.textContent.startsWith('Fleet offer'))`);
  return T.until(`document.querySelector('#docview .dk-title')?.textContent === 'Fleet offer'`);
};
ok(await openIt(A) && await openIt(B), 'both have the doc open');
// who's here
ok(await A.until(`document.querySelector('#docview .dv-here i')?.textContent === 'S'`), 'Jo sees Sam in the doc');
await B.ev(`(() => { const r = document.querySelector('#docview [data-id="a3"] .dk-text'); r.focus(); getSelection().collapse(r.firstChild, 3); })()`);
ok(await A.until(`!!document.querySelector('#docview [data-id="a3"] .dk-here')`), 'and which block Sam is in');
// Sam comments on selected words, mentioning Jo
await B.ev(`(() => { const r = document.querySelector('#docview [data-id="a1"] .dk-text'); const g = document.createRange(); g.setStart(r.firstChild, 3); g.setEnd(r.firstChild, 9); getSelection().removeAllRanges(); getSelection().addRange(g); })()`);
await B.until(`[...document.querySelectorAll('.dk-bar button')].some((b) => b.textContent === '💬')`);
await B.tap(`[...document.querySelectorAll('.dk-bar button')].find((b) => b.textContent === '💬')`);
ok(await B.until(`document.querySelector('#docview .dv-thread.new .dv-quote')?.textContent === 'tint f'`), 'the comment box quotes the selected words');
await B.type('Is this true for vans? @Jo');
await B.key('Enter'); // picks @Jo from the list
await B.key('Enter');
ok(await A.until(`document.querySelector('#docview [data-id="a1"] .dk-cmt')?.textContent === '💬 1'`), 'Jo sees the comment marker on the block');
ok(await A.until(`[...document.querySelectorAll('#toasts *')].some((t) => t.textContent.includes('Sam mentioned you in a comment'))`), 'Jo is told he was mentioned');
await A.tap(`document.querySelector('#docview [data-id="a1"] .dk-cmt')`);
ok(await A.until(`document.querySelector('#docview .dv-thread .dv-ctext')?.textContent.includes('vans')`), 'the marker opens the thread');
await A.ev(`(() => { const t = document.querySelector('#docview .dv-thread textarea'); t.focus(); })()`);
await A.type('Yes, vans too');
await A.key('Enter');
ok(await B.until(`[...document.querySelectorAll('#docview .dv-ctext')].some((x) => x.textContent === 'Yes, vans too')`), 'Sam sees Jo’s reply');
await A.tap(`[...document.querySelectorAll('#docview .dv-thread .btn')].find((b) => b.textContent.includes('Resolve'))`);
ok(await B.until(`!document.querySelector('#docview [data-id="a1"] .dk-cmt')`), 'resolving clears the marker for Sam');
// history: Jo edits, then Sam edits, then Jo restores Jo's version
await A.ev(`(() => { const r = document.querySelector('#docview [data-id="a3"] .dk-text'); r.focus(); const s = getSelection(); s.selectAllChildren(r); s.collapseToEnd(); })()`);
await A.type(' Call us.');
await A.until(`document.querySelector('.dv-status').textContent === 'Saved'`, 4000);
await sleep(300);
await B.ev(`(() => { const r = document.querySelector('#docview [data-id="a3"] .dk-text'); r.focus(); const s = getSelection(); s.selectAllChildren(r); s.collapseToEnd(); })()`);
await B.type(' Or email.');
await B.until(`document.querySelector('.dv-status').textContent === 'Saved'`, 4000);
await sleep(500);
await A.tap(`document.querySelector('.dv-bar [aria-label="Doc options"]')`);
await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Version history').click()`);
ok(await A.until(`document.querySelectorAll('#docview button.dv-hist-row').length >= 1`), 'version history lists earlier versions');
await A.tap(`document.querySelector('#docview button.dv-hist-row')`);
ok(await A.until(`document.querySelector('#docview .dv-hist-doc')?.textContent.includes('Call us.') && !document.querySelector('#docview .dv-hist-doc').textContent.includes('Or email')`), 'the newest version is the doc before Sam’s edit');
await A.tap(`[...document.querySelectorAll('#docview .dv-side .btn')].find((b) => b.textContent === 'Restore this version')`);
ok(await B.until(`document.querySelector('#docview [data-id="a3"] .dk-text')?.textContent === 'Price on request. Call us.'`, 5000), 'restoring it shows up for Sam too');
// lock
await A.tap(`document.querySelector('.dv-bar [aria-label="Doc options"]')`);
await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Lock')).click()`);
ok(await B.until(`document.querySelector('#docview .dk-title')?.contentEditable === 'false' && [...document.querySelectorAll('#docview .dv-badge')].some((x) => x.textContent.includes('Read only'))`), 'Sam’s view turns read-only when Jo locks it');
await B.ev(`(() => { const r = document.querySelector('#docview [data-id="a1"] .dk-text'); r.focus(); })()`);
await B.type('hack');
await sleep(800);
ok(!(await JA('GET', `/items/${d.id}/doc`)).blocks[0].runs[0].text.includes('hack'), 'typing can’t change a locked doc');
await A.tap(`document.querySelector('.dv-bar [aria-label="Doc options"]')`);
await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Unlock')).click()`);
ok(await B.until(`document.querySelector('#docview .dk-title')?.contentEditable === 'true'`), 'unlocking lets Sam edit again');
// public link
await A.tap(`document.querySelector('.dv-bar [aria-label="Doc options"]')`);
await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Share a public link')).click()`);
await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'No expiry').click()`);
ok(await A.until(`!!document.querySelector('.dv-bar .dv-pub')`), 'the doc shows 🌐 Public');
const shared = (await JA('GET', '/state')).items.find((x) => x.id === d.id);
const pageHtml = await (await fetch(APP.replace(/\/$/, '') + '/s/' + shared.share.token)).text();
ok(pageHtml.includes('Fleet offer') && pageHtml.includes('Price on request. Call us.') && pageHtml.includes(`/img/${pic.id}`), 'the public page reads like the doc, picture included');
// Word export keeps the picture
await A.tap(`document.querySelector('.dv-bar [aria-label="Doc options"]')`);
await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Export as Word (.docx)').click()`);
await A.until(`false`, 3000);
const docx = (await JA('GET', '/state')).items.find((x) => x.name === 'Fleet offer.docx');
ok(!!docx, 'the Word file was made');
if (docx) {
  const bytes = Buffer.from(await (await fetch(APP + `api/files/${docx.id}?t=${tokA}`)).arrayBuffer());
  FS.writeFileSync(process.argv[2] + '/dk/out.docx', bytes);
  const list = execSync(`unzip -l ${process.argv[2]}/dk/out.docx`).toString();
  const xml = execSync(`unzip -p ${process.argv[2]}/dk/out.docx word/document.xml`).toString();
  const rels = execSync(`unzip -p ${process.argv[2]}/dk/out.docx word/_rels/document.xml.rels`).toString();
  const ct = execSync(`unzip -p ${process.argv[2]}/dk/out.docx '\\[Content_Types\\].xml'`).toString();
  ok(/word\/media\/column-.*\.png/.test(list) && xml.includes('<pic:pic') && /r:embed="rIdC\d+"/.test(xml) && rels.includes('media/column-') && ct.includes('Extension="png"'), 'the picture is embedded in the Word file');
}
ok(!(await A.ev(`/\\bnull\\b/.test(document.querySelector('#docview').innerText + document.querySelector('.dk-bar')?.innerText)`)), 'no stray “null” on the page');
ok(!A.errors.length && !B.errors.length, 'no page errors' + (A.errors.length + B.errors.length ? ': ' + [...A.errors, ...B.errors].join(' / ') : ''));
A.close(); B.close(); chrome.kill(); chrome2.kill();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
