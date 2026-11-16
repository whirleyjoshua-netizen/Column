import * as FS from 'node:fs';
import { execSync } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = process.argv[2];
const APP = 'http://127.0.0.1:4797/';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9335, 'chrome3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9335) {
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
const innerW = 1300;
await A.until(`!!document.querySelector('#loginLinks a')`);
const team = 'tb' + Date.now();
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = '${team}'; f.name.value = 'Jo'; f.password.value = 'secret1pad'; f.device.value = 'Jo laptop'; if (f.email) f.email.value = 'jo${team}@t.test'; f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Jo signed in');
const tok = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
await sleep(1500); // the live connection is up, so the switch reaches this page
const patched = await api('PATCH', '/workspace', { tools: { bills: true, projects: true, docs: true, sidekick: true, meetings: true } });
ok(patched.tools?.projects === true || patched.workspace?.tools?.projects === true || !patched.error, 'tools switched on' + (patched.error ? ': ' + patched.error : ''));
await A.ev(`(() => { for (const k of Object.keys(localStorage)) if (/workLast|docsSide/.test(k)) localStorage.removeItem(k); return true; })()`);
ok(await A.until(`!!document.querySelector('#tabs [data-tab=projects]')`), 'Projects is in Workspace once the team turns it on');
const tabs = () => A.ev(`[...document.querySelectorAll('#tabs button[data-tab]:not(.tab-sub)')].map((b) => b.querySelector('.tab-l').textContent + (b.classList.contains('on') ? '*' : ''))`);
const names = async () => (await tabs()).map((t) => t.replace('*', '')).join(',');
const strip = () => A.ev(`(() => { const s = document.querySelector('#workTabs'); return s && !s.hidden && getComputedStyle(s).display !== 'none' ? [...s.querySelectorAll('button[data-tab]')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')).join(',') : ''; })()`);
const menuItems = () => A.ev(`[...document.querySelectorAll('#menu button')].map((b) => b.textContent)`);

// The same short toolbar for everyone (2026-11-14; Day moved into Workspace as Tasks 2026-11-15): Home, Chat, Agents, Workspace.
ok(await names() === 'Home,Chat,Agents,Workspace', 'the toolbar is Home, Chat, Agents, Workspace: ' + await names());
ok(!(await A.ev(`!!document.querySelector('#tabs .tabs-edit')`)), 'pins are not in the sidebar any more (2026-11-16: they are in Workspace)');
ok(!(await A.ev(`!!document.querySelector('#toolsBtn')`)), 'no All tools button: Tools is a tab in Workspace');
ok(await strip() === '', 'no Workspace strip until you are in Workspace');

// Workspace: its tabs across the top at full size; it opens where you were last.
await A.click('#tabs [data-tab=work]');
ok(await A.until(`!document.querySelector('#day').classList.contains('hidden') && document.querySelector('#tool').classList.contains('hidden')`), 'Workspace opens on Tasks');
ok(await strip() === 'Tasks*,Contacts,Projects,Campaigns,Folders & Docs,Automations,Tools', 'the strip across the top: ' + await strip());
await A.click('#workTabs [data-tab=contacts]');
ok(await A.until(`!document.querySelector('#tool').classList.contains('hidden') && document.querySelector('#tool h2').textContent.includes('Contacts')`), 'Contacts opens from the strip');
ok((await tabs()).includes('Workspace*'), 'Workspace is lit in the toolbar');
ok(await A.ev(`!!document.querySelector('#workTabs .tabs-edit')`), 'the strip has a pencil for your pins');
ok(await A.ev(`getComputedStyle(document.querySelector('#tabs .tab-sub')).display === 'none'`), 'at full size the sidebar does not repeat the sub-tabs');
ok(await A.until(`document.querySelector('#tool').getBoundingClientRect().top >= document.querySelector('#workTabs').getBoundingClientRect().bottom - 1`, 1500), 'the tool starts under the strip, not over it');
await A.click('#workTabs [data-tab=projects]');
ok(await A.until(`!document.querySelector('#projects').classList.contains('hidden') && document.querySelector('#tool').classList.contains('hidden')`), 'Projects opens (and Contacts closes)');
ok(await A.ev(`document.querySelector('#projects h2').textContent === 'Projects'`), 'Jobs is called Projects now');
ok(await A.ev(`document.querySelector('#projects').getBoundingClientRect().top >= document.querySelector('#workTabs').getBoundingClientRect().bottom - 1`), 'Projects starts under the strip');
await A.click('#workTabs [data-tab=camps]');
ok(await A.until(`document.querySelector('#projects').classList.contains('hidden') && !document.querySelector('#campsWrap').classList.contains('hidden')`), 'Campaigns opens in Workspace');
ok(await strip() === 'Tasks,Contacts,Projects,Campaigns*,Folders & Docs,Automations,Tools', 'Campaigns is lit in the strip: ' + await strip());
await A.click('#workTabs [data-tab=docs]');
ok(await A.until(`document.querySelector('#tool h2')?.textContent.startsWith('Folders & Docs') && !document.querySelector('#tool').classList.contains('hidden')`), 'Folders & Docs opens');
ok(await A.ev(`[...document.querySelectorAll('#tool .df-switch button')].map((b) => b.textContent).join() === 'Docs,Folders'`), 'with a Docs | Folders switch');
await A.ev(`document.querySelector('#tool .df-switch [data-df=folders]').click()`);
ok(await A.until(`!!document.querySelector('#tool .dir-crumbs') && document.querySelector('#tool .df-switch [data-df=folders]').classList.contains('on')`), 'Folders shows in the same tool');
ok((await strip()).includes('Folders & Docs*'), 'and the strip still marks Folders & Docs');
await A.click('#workTabs [data-tab=docs]');
ok(await A.ev(`!document.querySelector('#tool').classList.contains('hidden')`), 'tapping the open tab again keeps it open');
await A.click('#tabs [data-tab=chat]');
ok(await A.until(`!document.querySelector('#chat').classList.contains('hidden') && document.querySelector('#tool').classList.contains('hidden')`), 'Chat leaves Workspace');
ok(await strip() === '', 'and the strip goes');
await A.click('#tabs [data-tab=work]');
ok(await A.until(`!document.querySelector('#day').classList.contains('hidden') && document.querySelector('#tool').classList.contains('hidden')`), 'Workspace comes back on Tasks, its first view');
await A.click('#tabs [data-tab=home]');

// Tools (the owner, 2026-11-16): at the far right of Workspace's strip. A tool opens in a split on the right of the page
// that's showing, with a button to go full size, wherever it's opened from. Company HQ, Business card and Signatures
// are in Settings → Business, and open in the split too.
await A.click('#tabs [data-tab=work]');
await A.click('#workTabs [data-tab=contacts]');
ok(await A.until(`document.querySelector('#tool h2')?.textContent.includes('Contacts')`), 'Contacts is open');
ok(await A.ev(`(() => { const s = document.querySelector('#workTabs').getBoundingClientRect(), t = document.querySelector('#workTabs [data-tab=tools]').getBoundingClientRect(), e = document.querySelector('#workTabs .tabs-edit').getBoundingClientRect(); return s.right - t.right < 40 && e.right <= t.left + 1; })()`), 'Tools sits at the far right of the strip, after your pins');
const split = `(() => { const s = document.querySelector('#split'); if (!s || s.classList.contains('hidden')) return null; const r = s.getBoundingClientRect(), m = document.querySelector('#main').getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), mr: Math.round(m.right), title: s.querySelector('.split-title')?.textContent || '' }; })()`;
await A.click('#workTabs [data-tab=tools]');
ok(await A.until(`(${split})?.title === 'Tools'`), 'Tools opens in a split on the right');
let sp = await A.ev(split);
ok(sp && sp.r >= innerW - 1 && sp.w >= 380 && sp.w < 900 && sp.l >= sp.mr - 1, 'the split is on the right, beside the page (the page gets narrower): ' + JSON.stringify(sp));
ok(await A.ev(`!document.querySelector('#tool').classList.contains('hidden') && document.querySelector('#tool h2').textContent.includes('Contacts')`), 'Contacts stays open on the left');
const items = (await A.ev(`[...document.querySelectorAll('#split [data-tool]')].map((b) => b.textContent)`)).join('|');
ok(items.includes('Stacks') && items.includes('Finance') && items.includes('Meeting notes'), 'Stacks, Finance and Meeting notes are in Tools: ' + items);
ok(!/Sidekick|Contacts|Jobs|Projects|Folders|Docs|News|Campaigns|Company HQ|Business card|Signatures/.test(items), 'Workspace’s tabs, Sidekick, News, HQ, cards and signatures are not');
await A.ev(`document.querySelector('#split [data-tool=bills]').click()`);
ok(await A.until(`(${split})?.title === 'Finance'`), 'Finance opens in the split');
ok(await A.ev(`document.querySelector('#tool h2').textContent.includes('Contacts')`), 'still beside Contacts');
ok((await strip()).includes('Tools*'), 'Tools is lit while a tool is open: ' + await strip());
await A.ev(`document.querySelector('#split .split-size').click()`);
ok(await A.until(`(${split})?.w > 1000`), 'the full-size button fills the page with it: ' + JSON.stringify(await A.ev(split)));
await A.ev(`document.querySelector('#split .split-size').click()`);
ok(await A.until(`(${split})?.w < 900`), 'and again puts it back in the split');
await A.ev(`document.querySelector('#split .split-back').click()`);
ok(await A.until(`(${split})?.title === 'Tools'`), '‹ Tools goes back to the list');
await A.click('#tabs [data-tab=chat]');
ok(await A.until(`!document.querySelector('#chat').classList.contains('hidden')`) && (await A.ev(split))?.title === 'Tools', 'the split stays open on another page (Chat)');
ok(!(await strip()), 'and Chat is not in Workspace');
await A.ev(`document.querySelector('#split .split-close').click()`);
ok(await A.until(`!(${split})`), '× closes the split');
await A.click('#tabs [data-tab=work]');
await A.click('#workTabs [data-tab=tools]');
await A.until(`(${split})?.title === 'Tools'`);
await A.ev(`document.querySelector('#split [data-tool=column]').click()`);
ok(await A.until(`!document.querySelector('#panes').classList.contains('hidden') && !(${split})`), 'Stacks opens as the page (the split closes)');
ok((await strip()).includes('Tools*'), 'Stacks is in Workspace → Tools: ' + await strip());
ok(await A.until(`document.querySelector('#panes').getBoundingClientRect().top >= document.querySelector('#workTabs').getBoundingClientRect().bottom - 1`, 1500), 'Stacks starts under the strip');
ok(await A.until(`[...document.querySelectorAll('#panes .chip')].map((c) => c.textContent).join('|') === 'Everything|Files'`), 'Stacks shows Everything and Files before any stack is made');

// Team switches win
await api('PATCH', '/workspace', { tools: { projects: false } });
ok(await A.until(`!document.querySelector('#tabs [data-tab=projects]')`), 'Projects leaves Workspace when the team switches it off');
await api('PATCH', '/workspace', { tools: { projects: true } });
ok(await A.until(`!!document.querySelector('#tabs [data-tab=projects]')`), 'and comes back when it is on again');

// News: on Home when you turn it on in Settings, never in the toolbar.
ok(!(await A.ev(`!!document.querySelector('#tabs [data-tab=news]')`)), 'News is not in the toolbar');
await A.click('#settingsBtn');
ok(await A.until(`[...document.querySelectorAll('#settings h3')].some((x) => x.textContent === 'News')`), 'Settings → General has News');
ok(await A.ev(`[...document.querySelectorAll('#settings h3')].some((x) => x.textContent === 'Pinned')`), 'and Pinned');
ok(await A.ev(`[...document.querySelectorAll('#settings .set-tabs button')].some((b) => b.textContent === 'Business')`), 'Settings has a Business tab');
await A.ev(`[...document.querySelectorAll('#settings .set-tabs button')].find((b) => b.textContent === 'Business').click()`);
const biz = await A.ev(`[...document.querySelectorAll('#settings [data-biz]')].map((b) => b.dataset.biz).join()`);
ok(biz === 'hq,cards,signs', 'Business has Company HQ, Business card and Signatures: ' + biz);
await A.ev(`document.querySelector('#settings [data-biz=hq] button').click()`);
ok(await A.until(`document.querySelector('#settings').classList.contains('hidden') && (${split})?.title === 'Company HQ'`), 'Open takes you to Company HQ, in the split');
await A.ev(`document.querySelector('#split .split-close').click()`);
await A.click('#settingsBtn');
await A.until(`!document.querySelector('#settings').classList.contains('hidden')`);
await A.ev(`[...document.querySelectorAll('#settings .set-tabs button')].find((b) => b.textContent === 'General').click()`);
await A.ev(`[...document.querySelectorAll('#settings .srow')].find((r) => r.textContent.startsWith('News on Home')).querySelector('input').click()`);
ok(await (async () => { for (let i = 0; i < 30; i++) { if (JSON.stringify((await api('GET', '/state')).me.bar) === '["news"]') return true; await sleep(100); } return false; })(), 'turning it on is kept with the account');

// Phone width: Workspace's tabs sit under it in the drawer; no strip.
await A.cmd('Emulation.setDeviceMetricsOverride', { width: 360, height: 760, deviceScaleFactor: 2, mobile: true });
await A.ev(`document.querySelector('#settings').classList.add('hidden')`);
await A.ev(`location.reload()`).catch(() => {});
await sleep(1500);
await A.until(`!document.querySelector('#app').classList.contains('hidden')`);
await sleep(600);
await A.ev(`document.querySelector('#menuBtn').click(); true`);
await sleep(400);
ok(await A.ev(`[...document.querySelectorAll('#tabs button')].every((b) => b.scrollWidth <= b.clientWidth + 1)`), 'no tab label is cut off on a phone');
ok(await A.ev(`(() => { const bs = [...document.querySelectorAll('#tabs button[data-tab]')].filter((b) => getComputedStyle(b).display !== 'none'); const d = document.querySelector('#side').getBoundingClientRect(); return bs.map((b) => b.dataset.tab).join() === 'home,chat,agents,work,day,contacts,projects,camps,docs,automations,tools' && bs.every((b, i) => { const r = b.getBoundingClientRect(); return r.left >= d.left && r.right <= d.right + 1 && (!i || r.top > bs[i - 1].getBoundingClientRect().top); }); })()`), 'the drawer lists them one under another, Workspace’s tabs under it');
await A.ev(`document.querySelector('#tabs [data-tab=contacts]').click(); true`);
ok(await A.until(`!document.querySelector('#tool').classList.contains('hidden') && document.querySelector('#tool h2').textContent.includes('Contacts')`), 'Contacts opens from the drawer');
ok(await strip() === '', 'no strip on a phone');
await A.ev(`document.querySelector('#tool h2 button').click(); document.querySelector('#tabs [data-tab=tools]').click(); true`);
ok(await A.until(`(${split})?.w === innerWidth`, 3000) || (await A.ev(`(() => { const r = document.querySelector('#split').getBoundingClientRect(); return !document.querySelector('#split').classList.contains('hidden') && Math.round(r.width) === innerWidth; })()`)), 'on a phone a tool fills the screen');
ok(await A.ev(`getComputedStyle(document.querySelector('#split .split-size')).display === 'none'`), 'with no full-size button (it is already)');
await A.ev(`document.querySelector('#split .split-close').click(); true`);
await A.ev(`document.querySelector('#tool h2 button').click(); true`);
ok(await A.ev(`document.documentElement.scrollWidth <= innerWidth`), 'the page itself does not scroll sideways');
ok(await A.ev(`document.querySelector('#home').scrollWidth <= document.querySelector('#home').clientWidth + 1`), 'Home fits the phone (Get started rows included)');

ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
A.close();
chrome.kill();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
