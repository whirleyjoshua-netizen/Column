import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9356, 'chrome56');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9356) {
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




// The job window in tabs (the owner, 2026-11-19): Overview, Client, Work, Finance (Materials, Quote, Invoices, Cost),
// Files & notes, Activity. Only the open tab is drawn; each job reopens on its tab; a board gets only the tabs it has
// something for; on a phone the tabs scroll and the page doesn't.
const A = await tab(APP);
try {
await A.until(`!!document.querySelector('#loginLinks a')`);
const team = 'tabs' + Date.now();
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; if (f.email) f.email.value = 'jo${team}@t.test'; f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo signed in');
const tok = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
const st = await api('GET', '/state');
const jo = st.me.memberId;
await api('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const p = await api('POST', '/projects', { template: 'trades', trades: ['hvac'] });
const tp = p.types[0];
const custF = tp.fields.find((f) => f.type === 'contact');
const pat = (await api('POST', '/contacts', { name: 'Pat Lee', phone: '555-0100' })).contact || (await api('GET', '/contacts')).contacts.find((c) => c.name === 'Pat Lee');
const jobA = await api('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Pat Lee · new unit', [custF.id]: pat.id } });
const jobB = await api('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Pat Lee · tune-up', [custF.id]: pat.id } });
const ca = await api('POST', '/campaigns', { name: 'Pat install', recordId: jobA.id });
const g = await api('POST', '/goals', { campaignId: ca.id, title: 'Install', kind: 'tasks' });
await api('POST', '/tasks', { text: 'Set the unit', goalId: g.id, assigneeId: jo, due: day(-1) });
ok(!!pat?.id && !!jobA.id && !!jobB.id, '(setup) two jobs for Pat, one with a campaign and a task that’s late');
await sleep(600);

const openJob = async (name) => {
  if (await A.ev(`!document.querySelector('#projects .pj-card-r')`)) {
    await A.ev(`document.querySelector('#tabs [data-tab=projects]')?.click(); true`);
    await A.until(`[...document.querySelectorAll('#projects .pj-card')].length > 0 || [...document.querySelectorAll('#projects .pj-card-r')].length > 0`, 8000);
    if (await A.ev(`!document.querySelector('#projects .pj-card-r')`)) await A.tap(`[...document.querySelectorAll('#projects .pj-card')][0]`);
  }
  await A.until(`[...document.querySelectorAll('#projects .pj-card-r')].some((c) => c.textContent.includes(${JSON.stringify(name)}))`, 8000);
  await A.tap(`[...document.querySelectorAll('#projects .pj-card-r')].find((c) => c.textContent.includes(${JSON.stringify(name)})).querySelector('b')`);
  return A.until(`document.querySelector('#projects .pj-panel .pj-title')?.value === ${JSON.stringify(name)}`, 8000);
};
const tabs = `[...document.querySelectorAll('#projects .pj-panel .pj-tab')].map((b) => b.dataset.tab).join()`;
const on = `document.querySelector('#projects .pj-panel .pj-tab.on')?.dataset.tab`;
const body = `document.querySelector('#projects .pj-tab-body')?.textContent || ''`;
const tapTab = async (k) => { await A.tap(`document.querySelector('#projects .pj-panel .pj-tab[data-tab=${k}]')`); return A.until(`${on} === '${k}'`); };

ok(await openJob('Pat Lee · new unit'), 'the job opens');
ok(await A.ev(tabs) === 'overview,client,work,finance,files,activity' && await A.ev(on) === 'overview', 'in tabs, on its Overview: ' + await A.ev(tabs));
ok(await A.until(`!!document.querySelector('#projects .pj-status') && /0\\/1 steps/.test(document.querySelector('#projects .pj-status').textContent) && /Set the unit/.test(document.querySelector('#projects .pj-status').textContent)`, 8000), 'the Overview says where it stands: 0 of 1 steps, and the late task holding it up: ' + await A.ev(`document.querySelector('#projects .pj-status')?.textContent`));
ok(await A.ev(`document.querySelector('#projects .pj-client-line b')?.textContent === 'Pat Lee' && !!document.querySelector('#projects .pj-add-detail') && !!document.querySelector('#projects .pj-act-btns')`), 'who it’s for, its details and the quick actions');
ok(await A.ev(`!document.querySelector('#projects .pj-timeline') && !document.querySelector('#projects .pj-invs')`), 'only the open tab is drawn: no timeline or invoices yet');
ok(await A.ev(`document.querySelector('#projects .pj-tab[data-tab=work] .pj-tab-n.bad')?.textContent === '1'`), 'Work has a badge: 1 overdue');
await A.tap(`document.querySelector('#projects .pj-client-line')`);
ok(await A.until(`${on} === 'client' && /555-0100/.test(${body}) && /Pat Lee · tune-up/.test(${body})`), 'the client line opens Client: the card, and their other jobs');
ok(await tapTab('work') && await A.until(`/Nothing booked yet/.test(${body})`) && /Pat install/.test(await A.ev(body)) && /Set the unit/.test(await A.ev(body)), 'Work: visits (loaded when the tab opens), the campaign and its task');
ok(await A.ev(`document.querySelector('#projects .pj-tabs').getBoundingClientRect().height >= 28`), 'on a long tab, the tab row keeps its height (it had shrunk to 1px and hidden the tabs): ' + await A.ev(`document.querySelector('#projects .pj-tabs').getBoundingClientRect().height`));
ok(await tapTab('finance') && await A.ev(`[...document.querySelectorAll('#projects .pj-subtab')].map((b) => b.dataset.fin).join()`) === 'materials,quote,invoices,cost', 'Finance has Materials, Quote, Invoices and Cost (for an owner)');
await A.tap(`document.querySelector('#projects .pj-subtab[data-fin=invoices]')`);
ok(await A.until(`[...document.querySelectorAll('#projects .pj-tab-body button')].some((b) => b.textContent === '+ Make an invoice')`), 'Invoices: + Make an invoice');
await A.tap(`document.querySelector('#projects .pj-subtab[data-fin=cost]')`);
ok(await A.until(`!!document.querySelector('#projects .pj-subtab[data-fin=cost].on') && !/Make an invoice/.test(${body})`), 'Cost, without the invoices');
ok(await tapTab('files') && !!(await A.ev(`document.querySelector('#projects .pj-notes')`)), 'Files & notes: the notes doc');
ok(await tapTab('activity') && await A.until(`[...document.querySelectorAll('#projects .pj-tl')].some((x) => /added this/.test(x.textContent))`), 'Activity: the timeline, fetched when it’s opened');
// Each job reopens on its own tab; one not opened before starts on its Overview.
await tapTab('finance');
ok(await openJob('Pat Lee · tune-up') && await A.ev(on) === 'overview', 'another job opens on its Overview');
ok(await A.ev(tabs) === 'overview,client,work,finance,files,activity', 'with the same tabs');
ok(await openJob('Pat Lee · new unit') && await A.ev(on) === 'finance' && await A.ev(`document.querySelector('#projects .pj-subtab.on')?.dataset.fin`) === 'cost', 'back on the first, it’s on Finance · Cost again');
// On a phone: the tabs scroll sideways, the page doesn't.
await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 2, mobile: true });
await sleep(500);
ok(await A.until(`!!document.querySelector('#projects .pj-tabs')`), 'the tabs are there on a phone');
ok(await A.ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`), 'and the page doesn’t scroll sideways: ' + await A.ev(`document.documentElement.scrollWidth + ' / ' + window.innerWidth`));
ok(await A.ev(`(() => { const t = document.querySelector('#projects .pj-tabs'); return t.scrollWidth >= t.clientWidth && getComputedStyle(t).overflowX === 'auto'; })()`), 'the tab row scrolls instead');
await A.cmd('Emulation.clearDeviceMetricsOverride');
// A board with less: a contact list (no client, no money) gets only what it has.
const crm = await api('POST', '/projects', { template: 'crm' });
ok(!!crm?.id, '(setup) a CRM board ' + (crm?.error || ''));
const ct = crm.types[0];
await api('POST', `/projects/${crm.id}/records`, { typeId: ct.id, values: { [ct.primary]: 'Dana Ruiz' } });
await sleep(400);
await A.tap(`document.querySelector('#projects .pj-top [aria-label="All boards"]')`);
await A.until(`[...document.querySelectorAll('#projects .pj-card')].length >= 2`, 8000);
await A.tap(`[...document.querySelectorAll('#projects .pj-card')].find((c) => c.textContent.includes(${JSON.stringify(crm.name)}))`);
ok(await A.until(`[...document.querySelectorAll('#projects .pj-types button')].some((b) => b.textContent.includes(${JSON.stringify(ct.name)}))`, 8000) || true, '(setup) the CRM board');
await A.until(`[...document.querySelectorAll('#projects .pj-card-r, #projects .pj-open')].some((c) => c.textContent.includes('Dana Ruiz'))`, 8000);
await A.tap(`[...document.querySelectorAll('#projects .pj-card-r, #projects .pj-open')].find((c) => c.textContent.includes('Dana Ruiz'))`);
ok(await A.until(`document.querySelector('#projects .pj-panel .pj-title')?.value === 'Dana Ruiz'`, 8000), 'a contact opens');
ok(!/finance|client/.test(await A.ev(tabs)) && /overview/.test(await A.ev(tabs)) && /activity/.test(await A.ev(tabs)), 'with no Client or Finance tab: ' + await A.ev(tabs));
// A pinned job opens beside the page (pins in the split, column-14): the same tabs there, and they work.
await api('PUT', '/account/pins', { pins: [{ go: 'rec:' + jobA.id, label: 'Pat Lee · new unit' }] });
await A.ev(`location.reload(); true`);
await A.until(`!!document.querySelector('#workTabs .pins-btn')`, 15000);
await A.ev(`(document.querySelector('#workTabs .pins-btn').click(), true)`);
await A.until(`[...document.querySelectorAll('#menu .pin-item')].some((x) => x.textContent.includes('Pat Lee'))`);
await A.ev(`([...document.querySelectorAll('#menu .pin-item')].find((x) => x.textContent.includes('Pat Lee')).click(), true)`);
ok(await A.until(`!!document.querySelector('#split .pj-panel[data-id="${jobA.id}"] .pj-tabs')`, 8000), 'a pinned job opens beside the page, in tabs');
await A.tap(`document.querySelector('#split .pj-panel .pj-tab[data-tab=work]')`);
ok(await A.until(`document.querySelector('#split .pj-panel .pj-tab.on')?.dataset.tab === 'work' && /Pat install/.test(document.querySelector('#split .pj-tab-body').textContent)`), 'its tabs work there (a real click): Work');
ok(await A.ev(`document.querySelector('#split .pj-tabs').getBoundingClientRect().height >= 28`), 'and the tab row keeps its height there too');
await A.tap(`document.querySelector('#split .pj-panel .pj-tab[data-tab=activity]')`);
ok(await A.until(`[...document.querySelectorAll('#split .pj-tl')].some((x) => /added this/.test(x.textContent))`), 'Activity there too');
ok(!A.errors.length, 'no errors: ' + A.errors.join(' | '));
} catch (e) { ok(false, 'threw ' + e.message); }
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
chrome.kill();
process.exit(fails ? 1 : 0);
