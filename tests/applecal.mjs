import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
// Apps & Integrations has the connections (out of Settings since 2026-11-20).
const appsOpen = async (A, id) => {
  await A.ev(`document.querySelector('#settings').classList.add('hidden'); document.querySelector('#tabs [data-tab=apps]').click(); true`);
  await A.until(`!!document.querySelector('#apps .apps-tabs')`);
  await A.ev(`[...document.querySelectorAll('#apps .apps-tabs button')].find((b) => b.textContent === ${JSON.stringify(id === 'dev' ? 'Developers' : id === 'tools' ? 'Kloomie apps' : 'Integrations')}).click(); true`);
  if (id === 'dev' || id === 'tools') return;
  await A.until(`!!document.querySelector('#apps .app-tile[data-app="${id}"]')`);
  await A.ev(`document.querySelector('#apps .app-tile[data-app="${id}"]').click(); true`);
};
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
const FAKE = 'http://127.0.0.1:4794';
const store = async () => (await fetch(FAKE + '/_store')).json();
const entries = async () => (await JA('GET', '/state')).entries || [];
const waitFor = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(250); } return null; };

// 1. Apps & Integrations → Apple Calendar → Connect Apple Calendar
await appsOpen(A, 'apple-calendar');
ok(await A.until(`[...document.querySelectorAll('#apps .cal-add .btn')].some((b) => b.textContent === 'Connect Apple Calendar')`), 'Apple Calendar has Connect Apple Calendar');
await A.tap(`[...document.querySelectorAll('#apps .cal-add .btn')].find((b) => b.textContent === 'Connect Apple Calendar')`);
ok(await A.until(`document.querySelector('#sheet h2')?.textContent.includes('Connect Apple Calendar') && document.querySelector('#sheet .apple-steps')?.textContent.includes('App-Specific Passwords')`), 'the sheet explains making an app-specific password');
await A.ev(`(() => { const ins = document.querySelectorAll('#sheet input'); ins[0].value = 'jo@icloud.com'; ins[1].value = 'my-real-apple-password'; })()`);
await A.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await A.until(`document.querySelector('#sheet .err')?.textContent.includes('app-specific password')`, 8000), 'a wrong password is refused, pointing at app-specific passwords');
await A.ev(`document.querySelectorAll('#sheet input')[1].value = 'abcd-efgh-ijkl-mnop'`);
await A.tap(`document.querySelector('#sheet .primary-btn')`);
ok(await A.until(`document.querySelector('#sheet').classList.contains('hidden') && document.querySelector('#apps .cal-sec')?.textContent.includes('Apple Calendar · jo@icloud.com')`, 10000), 'connected: “Apple Calendar · jo@icloud.com” in Settings');
const conns = (await JA('GET', '/calendars')).connections;
const conn = conns.find((x) => x.provider === 'apple');
ok(conn && conn.calendars.map((c) => c.name).join(',') === 'Work,Family' && !JSON.stringify(conns).includes('abcd'), 'it lists Work and Family (not Reminders), and never sends the password back');
ok(conn.calendars.find((c) => c.name === 'Work').on && !conn.calendars.find((c) => c.name === 'Family').on && conn.writeCalId.endsWith('/work/'), 'the default calendar (Work) is on and gets new blocks; Family is off');
ok(!conn.calendars.find((c) => c.name === 'Family').canWrite, 'Family is read-only');
const raw = FS.readFileSync(process.argv[2] + '/dk/data/db.json', 'utf8');
ok(!raw.includes('abcd-efgh-ijkl-mnop') && !raw.includes(Buffer.from('jo@icloud.com:abcd-efgh-ijkl-mnop').toString('base64')), 'the password is stored encrypted');

// 2. Its events come into the Day, repeating ones too
ok(await waitFor(async () => (await entries()).some((e) => e.text === 'Dentist & cleaning' && e.start != null && e.cal?.imported)), 'a one-off event shows up in the Day');
const stand = (await entries()).filter((e) => e.text === 'Crew standup');
ok(stand.length >= 8 && new Set(stand.map((e) => e.date)).size === stand.length && stand.every((e) => e.end - e.start === 15), `a weekly event shows every week (${stand.length} of them), 15 minutes each`);
await JA('PATCH', '/calendars/' + conn.id, { on: { [conn.calendars.find((c) => c.name === 'Family').id]: true } });
ok(await waitFor(async () => (await entries()).some((e) => e.text === 'Sam, birthday' && e.start == null)), 'switching Family on brings in its all-day event');

// 3. Blocks made in Kloomie go to iCloud, and edits and deletes follow
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
const blk = await JA('POST', '/entries', { text: 'Quote at Smith', date: tomorrow, start: 14 * 60, end: 15 * 60 });
const put = await waitFor(async () => Object.entries((await store()).work).find(([, t]) => t.includes('SUMMARY:Quote at Smith')));
ok(put && /DTSTART:\d{8}T\d{6}Z/.test(put[1]) && put[1].includes('BEGIN:VCALENDAR'), 'a new block is written to the Work calendar');
await JA('PATCH', '/entries/' + blk.id, { text: 'Quote at Smiths, bring samples' });
ok(await waitFor(async () => Object.values((await store()).work).some((t) => t.includes('SUMMARY:Quote at Smiths\\, bring samples'))), 'editing it in Kloomie updates iCloud');
await JA('DELETE', '/entries/' + blk.id);
ok(await waitFor(async () => !Object.values((await store()).work).some((t) => t.includes('Quote at Smith'))), 'deleting it in Kloomie deletes it in iCloud');
// Changed in Apple Calendar
const dent = (await store()).work['dentist.ics'];
await fetch(FAKE + '/_edit', { method: 'POST', body: JSON.stringify({ cal: 'work', file: 'dentist.ics', text: dent.replace('Dentist & cleaning', 'Dentist (moved)') }) });
await JA('POST', `/calendars/${conn.id}/sync`);
ok((await entries()).some((e) => e.text === 'Dentist (moved)') && !(await entries()).some((e) => e.text === 'Dentist & cleaning'), 'a change made in Apple Calendar comes through on sync');

// 4. The subscribe link
await A.until(`!!document.querySelector('#apps .cal-feed')`);
await A.tap(`[...document.querySelectorAll('#apps .cal-feed .btn')].find((b) => b.textContent === 'Make my calendar link')`);
ok(await A.until(`(document.querySelector('#apps .cal-feed a.btn')?.getAttribute('href') || '').startsWith('webcal://')`), 'Make my calendar link → Add to Apple Calendar (a webcal:// link)');
ok(await A.ev(`decodeURIComponent([...document.querySelectorAll('#apps .cal-feed a.btn')][1].href).includes('calendar.google.com/calendar/r?cid=webcal://')`), 'and Add to Google Calendar');
const feed = (await JA('GET', '/calfeed')).url;
await JA('POST', '/entries', { text: 'Measure windows\nbring the ladder', date: tomorrow, start: 9 * 60, end: 10 * 60 });
await JA('POST', '/entries', { text: 'Truck check', date: tomorrow, start: 7 * 60, end: 7 * 60 + 30, repeat: 'weekdays' });
await JA('POST', '/entries', { text: 'Invoices day', date: tomorrow });
const r = await fetch(feed.replace(/^https?:\/\/[^/]+/, 'http://127.0.0.1:4797'));
const ics = await r.text();
ok(r.ok && r.headers.get('content-type').startsWith('text/calendar') && ics.startsWith('BEGIN:VCALENDAR'), 'the link serves a calendar');
ok(ics.includes('SUMMARY:Measure windows') && ics.includes('DESCRIPTION:bring the ladder') && /DTSTART;TZID=[\w/]+:\d{8}T090000/.test(ics), 'a block, at 9:00 in the team’s time zone, with its notes');
ok(ics.includes('SUMMARY:Truck check') && ics.includes('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'), 'a weekdays block repeats there too');
ok(new RegExp('SUMMARY:Invoices day\\r\\n(?:DESCRIPTION:[^\\r]*\\r\\n)?DTSTART;VALUE=DATE:').test(ics), 'an all-day item is all-day');
ok(!ics.includes('Dentist') && !ics.includes('Crew standup'), 'events that came from iCloud aren’t sent back out in the feed');
const newLink = `[...document.querySelectorAll('#apps .cal-feed .btn')].find((b) => b.dataset.label)`;
await A.tap(newLink);
await sleep(200);
await A.tap(newLink);
const feed2 = await waitFor(async () => { const u = (await JA('GET', '/calfeed')).url; return u && u !== feed ? u : null; }, 6000);
ok(feed2 && feed2 !== feed && (await fetch(feed.replace(/^https?:\/\/[^/]+/, 'http://127.0.0.1:4797'))).status === 404, 'a new link makes the old one stop working');
await JA('DELETE', '/calfeed');
ok((await fetch(feed2.replace(/^https?:\/\/[^/]+/, 'http://127.0.0.1:4797'))).status === 404, 'Turn off stops it');

// 5. Disconnect: its events leave the Day
await JA('DELETE', '/calendars/' + conn.id);
ok(!(await entries()).some((e) => e.cal?.imported), 'disconnecting removes the iCloud events from the Day');
ok(!A.errors.length, 'no page errors' + (A.errors.length ? ': ' + A.errors.join(' / ') : ''));
A.close(); chrome.kill();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
