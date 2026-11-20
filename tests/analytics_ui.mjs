import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9360, 'chrome60');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9360) {
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




// Analytics v1 (Team plan step 4): Tools → Analytics. An Overview and a tab per section; each number against the dates
// before, with a trend; tapping one shows the records behind it, inside the page, and tapping a record opens it. Members
// see it only when an admin turns on "See the team's numbers", and then only Team & operations.
const A = await tab(APP);
try {
await A.until(`!!document.querySelector('#loginLinks a')`);
const team = 'an' + Date.now();
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; if (f.email) f.email.value = 'jo${team}@t.test'; f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo signed in');
const tok = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const call = (t) => async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const api = call(tok);
const st = await api('GET', '/state');
const samTok = (await call()('POST', '/auth', { mode: 'join', workspace: team, code: st.workspace.inviteCode, name: 'Sam', email: `sam${team}@t.test`, password: 'longenoughsam', device: 'Mac', deviceId: 'sam' })).token;
const sam = call(samTok);
const samId = (await sam('GET', '/state')).me.memberId;
const today = new Date().toISOString().slice(0, 10);
const plus = (k, n) => new Date(Date.parse(k + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const t1 = await api('POST', '/tasks', { text: 'Fix gate', due: plus(today, 1), assigneeId: samId });
const t2 = await api('POST', '/tasks', { text: 'Call Bo', due: plus(today, -2), assigneeId: samId });
await sam('PATCH', `/tasks/${t1.id}`, { done: true });
await api('POST', '/money', { kind: 'in', amount: 1500, day: plus(today, -1), category: 'Sales', scope: 'business', note: 'Gate job' });
await api('POST', '/contacts', { name: 'Dana Ruiz', source: 'Website form' });

await A.ev(`document.querySelector('#tabs [data-tab=tools]').click(); true`);
ok(await A.until(`!!document.querySelector('#menu [data-tool=analytics]')`), 'Tools lists Analytics');
await A.ev(`document.querySelector('#menu [data-tool=analytics]').closest('button').click(); true`);
ok(await A.until(`!!document.querySelector('#sheet .an .an-card')`, 8000), 'it opens, with numbers');
ok(await A.ev(`[...document.querySelectorAll('#sheet .an-tab')].map((b) => b.dataset.tab).join() === 'overview,business,team,customers,marketing'`), 'an Overview and four sections: ' + await A.ev(`[...document.querySelectorAll('#sheet .an-tab')].map((b) => b.dataset.tab).join()`));
const card = (k) => `document.querySelector('#sheet .an-card[data-metric=${k}]')`;
ok(await A.ev(`/\\$1,500/.test(${card('income')}.textContent)`), 'money in: $1,500: ' + await A.ev(`${card('income')}.textContent`));
ok(await A.ev(`/▲/.test(${card('income')}.textContent) && !!${card('income')}.querySelector('.an-spark svg')`), 'up on before, with a trend');
ok(await A.ev(`/^Tasks done1/.test(${card('tasksDone')}.textContent)`), 'tasks done: 1');
ok(await A.ev(`/As of today/.test(${card('overdueNow')}.textContent) && /1/.test(${card('overdueNow')}.querySelector('.an-value').textContent)`), 'overdue now: 1, as of today');
// The records behind a number, and back.
await A.tap(card('tasksDone'));
ok(await A.until(`/Fix gate/.test(document.querySelector('#sheet .an-rows')?.textContent || '')`, 8000), 'tapping it shows the task behind it');
await A.tap(`document.querySelector('#sheet .an-back')`);
ok(await A.until(`!!${card('income')}`), 'and back');
// A section: Team, with each person's line.
await A.tap(`document.querySelector('#sheet .an-tab[data-tab=team]')`);
ok(await A.until(`!!document.querySelector('#sheet .an-people tr[data-member="${samId}"]')`), 'Team & operations has a line for Sam');
ok(await A.ev(`(() => { const c = [...document.querySelector('#sheet .an-people tr[data-member="${samId}"]').cells].map((x) => x.textContent); return c[1] === '1' && c[2] === '100%' && c[3] === '1'; })()`), 'one done, on time, one overdue: ' + await A.ev(`[...document.querySelector('#sheet .an-people tr[data-member="${samId}"]').cells].map((x) => x.textContent).join('|')`));
await A.tap(`document.querySelector('#sheet .an-people tr[data-member="${samId}"]')`);
ok(await A.until(`/Sam/.test(document.querySelector('#sheet .an-detail .tm-when')?.textContent || '') && /Fix gate/.test(document.querySelector('#sheet .an-rows').textContent)`, 8000), 'tapping Sam shows his tasks done');
await A.tap(`document.querySelector('#sheet .an-back')`);
// Other dates.
await A.ev(`(() => { const s = document.querySelector('#sheet .an-preset'); s.value = '7'; s.dispatchEvent(new Event('change')); return true; })()`);
ok(await A.until(`document.querySelector('#sheet .an-preset')?.value === '7' && !document.querySelector('#sheet .an-body.loading') && !!document.querySelector('#sheet .an-card') && /Tasks done1/.test(document.querySelector('#sheet .an-card[data-metric=tasksDone]').textContent)`, 8000), 'the last 7 days');
await A.ev(`(() => { const s = document.querySelector('#sheet .an-preset'); s.value = 'custom'; s.dispatchEvent(new Event('change')); return true; })()`);
ok(await A.until(`!!document.querySelector('#sheet .an-from')`), 'or dates of your own');
// The customers tab.
await A.tap(`document.querySelector('#sheet .an-tab[data-tab=customers]')`);
ok(await A.until(`/Website form/.test(document.querySelector('#sheet .an-bars')?.textContent || '')`, 8000), 'where new contacts came from');
// A phone.
await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(300);
await A.tap(`document.querySelector('#sheet .an-tab[data-tab=overview]')`);
await sleep(300);
ok(await A.ev(`document.documentElement.scrollWidth <= 391`), 'fits a phone: ' + await A.ev(`document.documentElement.scrollWidth`));
await A.cmd('Emulation.clearDeviceMetricsOverride');

// A member: not until an admin lets them; then Team & operations only.
const B = await tab(APP);
await B.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
await B.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(samTok))}); location.reload(); true`);
ok(await B.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=tools]')`, 20000), 'Sam signed in');
await B.ev(`document.querySelector('#tabs [data-tab=tools]').click(); true`);
await B.until(`!!document.querySelector('#menu [data-tool]')`);
ok(await B.ev(`!document.querySelector('#menu [data-tool=analytics]')`), 'a member doesn’t have Analytics until an admin lets them');
await B.ev(`document.body.click(); true`);
await api('PATCH', '/workspace', { memberAccess: { teamKpis: true } });
await B.ev(`location.reload(); true`);
await B.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=tools]')`, 20000);
await B.ev(`document.querySelector('#tabs [data-tab=tools]').click(); true`);
ok(await B.until(`!!document.querySelector('#menu [data-tool=analytics]')`), 'once an admin lets them, it’s in their Tools');
await B.ev(`document.querySelector('#menu [data-tool=analytics]').closest('button').click(); true`);
ok(await B.until(`!!document.querySelector('#sheet .an .an-card')`, 8000), 'then they do');
ok(await B.ev(`[...document.querySelectorAll('#sheet .an-tab')].map((b) => b.dataset.tab).join() === 'overview,team' && !document.querySelector('#sheet .an-card[data-metric=income]')`), 'Team & operations only, and no money');
ok(!A.errors.length && !B.errors.length, 'no errors: ' + [...A.errors, ...B.errors].join(' | '));
} catch (e) { ok(false, 'threw ' + e.message); }
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
chrome.kill();
process.exit(fails ? 1 : 0);
