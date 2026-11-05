import * as FS from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9336', `--user-data-dir=${S}/dk/chrome5`, '--no-first-run', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch('http://127.0.0.1:9336/json/new?' + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map();
  const errors = [];
  const chooser = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.method === 'Page.fileChooserOpened') chooser.push(m.params); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const KEYS = { Enter: [13, '\r'], Escape: [27], Tab: [9] };
  const key = async (k) => { const [code, text] = KEYS[k]; await cmd('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: code, ...(text ? { text } : {}) }); await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code }); await sleep(40); };
  const type = async (t) => { await cmd('Input.insertText', { text: t }); await sleep(40); };
  const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const tap = async (expr) => {
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(80);
  };
  const click = (sel) => ev(`(() => { const e = typeof ${JSON.stringify(sel)} === 'string' ? document.querySelector(${JSON.stringify(sel)}) : null; e.click(); return true; })()`);
  return { ev, key, type, until, click, tap, cmd, errors, chooser, close: () => ws.close() };
}




// Send a doc for signature: the doc becomes a PDF as it is now, opened straight into placing the signer's
// boxes; the Docs library shows it waiting, then signed once they sign.
const A = await tab(APP);
await A.until(`!!document.querySelector('#loginLinks a')`);
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = 'sg${Date.now()}'; f.name.value = 'Jo'; f.password.value = 'secret1pad1'; f.device.value = 'A'; if (f.email) f.email.value = 'jo' + Date.now() + '@t.test'; f.requestSubmit(); })()`);
await A.until(`!document.querySelector('#app').classList.contains('hidden')`);
await sleep(800);
const token = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = (m, p, b) => fetch(APP + 'api' + p, { method: m, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
const doc = await api('POST', '/items', { type: 'text', doc: { title: 'Service agreement', blocks: [{ id: 'a', type: 'p', runs: [{ text: 'We’ll tint 12 windows for $1,800.' }] }] } });
ok(!!doc.id, 'a doc to send');

await A.tap(`document.querySelector('#toolsBtn')`);
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Docs')`);
await A.tap(`[...document.querySelectorAll('#tool .doc-row')].find((r) => r.textContent.includes('Service agreement'))`);
ok(await A.until(`document.querySelector('#docview .dk-title')?.textContent === 'Service agreement'`), 'the doc opens');
await A.tap(`document.querySelector('#docview [aria-label="Doc options"]')`);
ok(await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === 'Send for signature…')`), 'the doc’s menu has Send for signature');
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Send for signature…')`);
ok(await A.until(`document.querySelector('#preview .pdf-bar')?.textContent.includes('Their boxes:')`, 15000), 'it becomes a PDF, opened ready to place their boxes');
ok(await A.until(`!!document.querySelector('#preview .pdf-page canvas, #preview .pdf-page')`, 15000), 'the page is drawn');
await A.tap(`[...document.querySelectorAll('#preview .pdf-bar button')].find((b) => b.textContent === 'Signature')`);
await A.tap(`document.querySelector('#preview .pdf-page')`);
ok(await A.until(`!!document.querySelector('#preview .pm-field')`), 'a signature box for them is placed');
await A.tap(`[...document.querySelectorAll('#preview .pdf-bar button')].find((b) => b.textContent.startsWith('Next'))`);
ok(await A.until(`document.querySelector('#sheet h2')?.textContent.startsWith('Send for signature')`), 'next: who signs');
await A.ev(`(() => { const i = document.querySelectorAll('#sheet input'); i[0].value = 'Pat Lee'; i[1].value = 'pat@example.com'; })()`);
await A.tap(`document.querySelector('#sheet .primary-btn')`);
await sleep(1500);
const signs = await api('GET', '/signs');
const sg = signs.find((x) => x.docId === doc.id);
ok(sg && sg.signer.email === 'pat@example.com' && sg.status === 'sent', 'the signing request remembers the doc it came from');
ok((await api('GET', '/state')).items.some((x) => x.id === sg?.itemId && x.fromDoc === doc.id && x.name === 'Service agreement.pdf'), 'the PDF is kept next to the doc');

// the Docs library shows it waiting
await A.ev(`document.querySelector('#sheet:not(.hidden) .sheet h2 .icon-btn')?.click()`);
await sleep(300);
await A.ev(`document.querySelector('#preview .close')?.click()`);
await A.ev(`document.querySelector('#docview [aria-label="Close doc"]')?.click()`);
await sleep(300);
await A.tap(`document.querySelector('#toolsBtn')`);
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Docs')`);
ok(await A.until(`[...document.querySelectorAll('#tool .doc-row')].find((r) => r.textContent.includes('Service agreement'))?.querySelector('.doc-sign')?.textContent === 'Waiting for signature'`), 'the Docs library shows it waiting for a signature');

// they sign
const T = sg.link.split('/sign/')[1];
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
await fetch(APP + 'api/public/sign/' + T);
const r = await fetch(APP + 'api/public/sign/' + T, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ consent: true, name: 'Pat Lee', sig: png, date: '2026-11-05', values: {} }) });
ok(r.ok, 'the customer signs: ' + (r.ok ? '' : JSON.stringify(await r.json())));
ok(await A.until(`[...document.querySelectorAll('#tool .doc-row')].find((r) => r.textContent.includes('Service agreement'))?.querySelector('.doc-sign')?.textContent === 'Signed'`), 'and the Docs library shows it signed, live');
// a signature: saved once in Settings, added to docs with / → My signature
await A.ev(`document.querySelector('#settingsBtn').click()`);
await sleep(400);
await A.ev(`[...document.querySelectorAll('#settings .set-tabs button')].find((b) => b.textContent.trim() === 'Account').click()`);
ok(await A.until(`!!document.querySelector('#settings .sig-sec textarea')`), 'Settings → Account has Signature');
await A.ev(`(() => { const t = document.querySelector('#settings .sig-sec textarea'); t.value = 'Jo Whirley\\nOwner, Premier Shades\\n(702) 555-0199'; })()`);
await A.tap(`[...document.querySelectorAll('#settings .sig-sec button')].find((b) => b.textContent === 'Save')`);
ok(await A.until(`[...document.querySelectorAll('#toasts *')].some((t) => t.textContent.includes('Signature saved'))`), 'saved');
ok((await api('GET', '/signature')).email === 'Jo Whirley\nOwner, Premier Shades\n(702) 555-0199', 'kept with the account');
ok((await fetch(APP + 'api/signature', { method: 'PUT', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a\nb\nc\nd\ne\nf\ng\nh\ni' }) })).status === 400, 'up to 8 lines');
await A.ev(`document.querySelector('#settings .icon-btn[aria-label=Close], #settingsBtn')?.click()`);
await sleep(300);
const d2 = await api('POST', '/items', { type: 'text', doc: { title: 'Letter', blocks: [{ id: 'a', type: 'p', runs: [{ text: 'Thanks for your business.' }] }, { id: 'b', type: 'p', runs: [] }] } });
await A.ev(`document.querySelector('#tool [aria-label=Close]')?.click()`);
await A.tap(`document.querySelector('#toolsBtn')`);
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Docs')`);
await A.tap(`[...document.querySelectorAll('#tool .doc-row')].find((r) => r.textContent.includes('Letter'))`);
ok(await A.until(`document.querySelector('#docview .dk-title')?.textContent === 'Letter'`), 'a doc opens');
await A.ev(`(() => { const r = [...document.querySelectorAll('#docview .dk-text')].at(-1); r.focus(); getSelection().collapse(r, 0); })()`);
await A.type('/');
await A.type('my sig');
ok(await A.until(`[...document.querySelectorAll('.dk-slash b')].some((b) => b.textContent === 'My signature')`), '/my sig finds My signature');
await A.key('Enter');
ok(await A.until(`[...document.querySelectorAll('#docview .dk-text')].map((x) => x.textContent).join('|').includes('Jo Whirley|Owner, Premier Shades|(702) 555-0199')`), 'it puts the signature lines in the doc');
await A.cmd('Page.captureScreenshot', {}).then((r) => FS.writeFileSync(S + '/dk/docsign.png', Buffer.from(r.result.data, 'base64')));
ok(!A.errors.length, 'no errors on the page: ' + A.errors.join(' | '));
A.close();
chrome.kill();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
