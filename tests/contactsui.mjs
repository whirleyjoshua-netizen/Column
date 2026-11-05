import * as FS from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${S}/dk/chrome2`, '--no-first-run', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch('http://127.0.0.1:9334/json/new?' + url, { method: 'PUT' })).json(); } catch {} }
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




// Contacts in the app: an owner adds someone, imports a spreadsheet (columns matched by name, first and last
// name put together), merges duplicates and marks someone do not contact.
const A = await tab(APP);
await A.until(`!!document.querySelector('#loginLinks a')`);
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = 'ct${Date.now()}'; f.name.value = 'Jo'; f.password.value = 'secret1pad1'; f.device.value = 'A'; if (f.email) f.email.value = 'jo' + Date.now() + '@t.test'; f.requestSubmit(); })()`);
await A.until(`!document.querySelector('#app').classList.contains('hidden')`);
await sleep(800);
const token = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = (m, p, b) => fetch(APP + 'api' + p, { method: m, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
const openContacts = async () => {
  await A.tap(`document.querySelector('#toolsBtn')`);
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Contacts')`);
};
await openContacts();
ok(await A.until(`document.querySelector('#tool')?.textContent.includes('Nobody here yet')`), 'Contacts opens without PSS, empty, saying how to fill it');

// add one
await A.tap(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent === '+ Add')`);
await A.until(`document.querySelector('#sheet h2')?.textContent.startsWith('New contact')`);
await A.ev(`(() => { const i = document.querySelectorAll('#sheet input'); i[0].value = 'Pat Lee'; i[1].value = 'Lee Roofing'; i[3].value = 'pat@example.com'; })()`);
await A.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await A.until(`[...document.querySelectorAll('#tool .contact-name')].some((b) => b.textContent === 'Pat Lee')`), 'a contact added by hand shows up');

// import a spreadsheet
const csv = S + '/dk/people.csv';
FS.writeFileSync(csv, 'First Name,Last Name,E-mail,Mobile Phone,Notes\nRobin,Diaz,robin@example.com,555-111-2222,Met at the show\nPat,Lee,pat@example.com,512-555-0100,\nAlex,Kim,,(555) 777-8888,\n');
await A.cmd('Page.enable');
await A.cmd('Page.setInterceptFileChooserDialog', { enabled: true });
await A.tap(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent === 'Import')`);
await A.until(`false`, 800);
const fc = A.chooser.at(-1);
ok(!!fc, 'Import asks for a file');
await A.cmd('DOM.setFileInputFiles', { files: [csv], backendNodeId: fc.backendNodeId });
ok(await A.until(`document.querySelector('#sheet h2')?.textContent.startsWith('Import contacts')`), 'it reads the file');
const mapped = await A.ev(`Object.fromEntries([...document.querySelectorAll('#sheet .import-map label')].map((l) => [l.firstChild.textContent, l.querySelector('select').selectedOptions[0].textContent]))`);
ok(mapped['First name'] === 'First Name' && mapped['Last name'] === 'Last Name' && mapped.Email === 'E-mail' && mapped.Phone === 'Mobile Phone' && mapped.Note === 'Notes' && mapped.Name === '—', 'columns are matched by their headings: ' + JSON.stringify(mapped));
ok(await A.ev(`document.querySelector('#sheet .day-hint:last-of-type, #sheet p.day-hint')?.textContent`).then((t) => /3 people/.test(t)), 'it says how many people are coming in');
await A.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await A.until(`[...document.querySelectorAll('#toasts *')].some((t) => t.textContent.includes('2 added') && t.textContent.includes('1 filled in'))`), 'import: 2 added, Pat filled in (matched by email)');
ok(await A.until(`[...document.querySelectorAll('#tool .contact-name')].map((b) => b.textContent).sort().join() === 'Alex Kim,Pat Lee,Robin Diaz'`), 'first and last names are put together');

// duplicates
await api('POST', '/contacts', { name: 'R. Diaz', phone: '(555) 111-2222', tags: 'vip' });
ok(await A.until(`[...document.querySelectorAll('#tool button')].some((b) => b.textContent === 'Duplicates · 1')`), 'a duplicate (same phone) is spotted, live');
await A.tap(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent === 'Duplicates · 1')`);
ok(await A.until(`document.querySelector('#sheet .dupe')?.textContent.includes('Robin Diaz / R. Diaz')`), 'the duplicates sheet shows who');
await A.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await A.until(`[...document.querySelectorAll('#toasts *')].some((t) => t.textContent.includes('Merged a duplicate') || t.textContent.includes('Merged 1 duplicate'))`), 'merged');
ok(await A.until(`document.querySelectorAll('#tool .contact-name').length === 3 && ![...document.querySelectorAll('#tool button')].some((b) => b.textContent.startsWith('Duplicates'))`), 'one Robin left');
ok(await A.until(`[...document.querySelectorAll('#tool .contact-row')].find((r) => r.textContent.includes('Robin Diaz'))?.textContent.includes('#vip')`), 'with the other one’s tag');

// do not contact
await A.tap(`[...document.querySelectorAll('#tool .contact-name')].find((b) => b.textContent === 'Robin Diaz')`);
ok(await A.until(`document.querySelector('#sheet textarea')?.value === 'Met at the show'`), 'tapping someone opens them, with their note');
await A.ev(`[...document.querySelectorAll('#sheet label.pick')].find((l) => l.textContent.includes('Do not contact')).querySelector('input').click()`);
await A.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await A.until(`[...document.querySelectorAll('#tool .contact-row')].find((r) => r.textContent.includes('Robin Diaz'))?.querySelector('.dne')`), 'marked do not contact');
ok(await A.ev(`[...document.querySelectorAll('#tool .contact-row')].find((r) => r.textContent.includes('Robin Diaz')).querySelector('input[type=checkbox]').disabled`), 'and can’t be picked for email');

// search
await A.ev(`(() => { const q = document.querySelector('#tool input[type=search]'); q.value = 'roofing'; q.dispatchEvent(new Event('input')); })()`);
ok(await A.until(`document.querySelectorAll('#tool .contact-name').length === 1`), 'search finds by company');
ok(!/\bnull\b/.test(await A.ev(`document.querySelector('#tool').innerText`)), 'nothing stray shows under the list');
// a call list for a campaign, from Contacts
await api('POST', '/campaigns', { name: 'Spring calls' });
await A.tap(`document.querySelector('#tool [aria-label=Close]')`).catch(() => {});
await A.tap(`document.querySelector('[data-tab=camps]')`);
await A.until(`[...document.querySelectorAll('.camp-card')].some((b) => b.textContent.includes('Spring calls'))`);
await A.tap(`[...document.querySelectorAll('.camp-card')].find((b) => b.textContent.includes('Spring calls'))`);
await A.until(`[...document.querySelectorAll('#camps button')].some((b) => b.textContent.startsWith('Files'))`);
await A.tap(`[...document.querySelectorAll('#camps button')].find((b) => b.textContent.startsWith('Files'))`);
ok(await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === '+ Call list from Contacts…')`), 'a campaign can make a call list from Contacts, without PSS');
await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === '+ Call list from Contacts…')`);
ok(await A.until(`document.querySelector('#sheet h2')?.textContent.startsWith('Call list from Contacts')`), 'the call list sheet opens');
ok(!(await A.ev(`document.querySelector('#sheet').textContent.includes('Stage')`)), 'no Stage filter when nobody has a stage');
await A.ev(`(() => { const s = [...document.querySelectorAll('#sheet select')].at(-1); s.value = 'phone'; s.dispatchEvent(new Event('change')); })()`);
ok(await A.until(`/^3 contacts right now/.test(document.querySelector('#sheet .live-count')?.textContent)`), 'it counts who matches (has a phone)');
await A.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await A.until(`[...document.querySelectorAll('#toasts *')].some((t) => t.textContent.includes('· 3 contacts'))`), 'the list is made with them');
// Settings → Team: what members see
await A.ev(`document.querySelector('#settingsBtn').click()`);
await sleep(400);
await A.ev(`[...document.querySelectorAll('#settings .set-tabs button')].find((b) => b.textContent.trim() === 'Team').click()`);
ok(await A.until(`[...document.querySelectorAll('#settings h3')].some((x) => x.textContent === 'What members see')`), 'Settings → Team has What members see');
await A.tap(`[...document.querySelectorAll('#settings .vis-sec button')].find((b) => b.textContent === 'Only what’s theirs')`);
ok(await A.until(`document.querySelector('#settings .vis-sec .on')?.textContent === 'Only what’s theirs' && document.querySelector('#settings .vis-sec .day-hint').textContent.includes('Nothing else reaches their devices')`), 'choosing Only what’s theirs saves and explains it');
await A.cmd('Page.captureScreenshot', {}).then((r) => FS.writeFileSync(S + '/dk/contacts.png', Buffer.from(r.result.data, 'base64')));
ok(!A.errors.length, 'no errors on the page: ' + A.errors.join(' | '));
A.close();
chrome.kill();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
