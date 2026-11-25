// Whiteboard in a browser (2026-11-19): Tools → Whiteboard, a board from a template, a sticky written in place, two
// people on one board (who's here, a move and a delete reaching the other), undo, an arrow between two things, a
// card for a real task, zoom, and the phone layout. Real mouse and keys, as a person uses it.
import { CHROME, SERVER_DIR } from './chromebin.mjs';
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/whiteboard_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5323, CDP = 9622, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'ignore', 'inherit'] });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
let front = null; // input only reaches the tab in front (a background tab doesn't draw)
async function tab(url) {
  let t;
  for (let i = 0; i < 80 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map(); const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 80) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const me = {};
  const up = async () => { if (front !== me) { await cmd('Page.bringToFront'); front = me; await sleep(150); } };
  const input = async (method, params) => { await up(); return cmd(method, params); };
  const mouse = (type, x, y, mods = 0) => input('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, modifiers: mods });
  const at = (expr) => ev(`(() => { const e = ${expr}; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  const click = async (x, y, mods = 0) => { await input('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers: mods }); await mouse('mousePressed', x, y, mods); await mouse('mouseReleased', x, y, mods); await sleep(60); };
  const tap = async (expr, mods = 0) => { const [x, y] = await at(expr); await click(x, y, mods); };
  const dragTo = async (x1, y1, x2, y2) => { await input('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 }); await mouse('mousePressed', x1, y1); for (let i = 1; i <= 8; i++) { await input('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + ((x2 - x1) * i) / 8, y: y1 + ((y2 - y1) * i) / 8, button: 'left', buttons: 1 }); await sleep(30); } await mouse('mouseReleased', x2, y2); await sleep(80); };
  const key = async (k, code, mods = 0, text) => { await input('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers: mods, text, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : { Escape: 27, Delete: 46, Backspace: 8, Enter: 13 }[k] }); await input('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: mods }); await sleep(60); };
  Object.assign(me, { up, ev, until, tap, click, dragTo, key, at, cmd, input, errors, close: () => ws.close() });
  return me;
}
const t = Date.now();
let A, Bn;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const post = async (p, body, tok) => (await fetch(APP + 'api' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) })).json();
  const get = async (p, tok) => (await fetch(APP + 'api' + p, { headers: { authorization: 'Bearer ' + tok } })).json();
  const ada = await post('/auth', { mode: 'create', workspace: 'Board ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const ben = await post('/auth', { mode: 'join', workspace: 'Board ' + t, code: ada.workspace.inviteCode, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  await post('/tasks', { text: 'Order tile for Smith' }, ada.token);
  const signIn = async (tok) => {
    const X = await tab(APP);
    await X.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
    await X.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(tok))}); location.reload(); true`);
    await X.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=work]')`, 15000);
    return X;
  };
  A = await signIn(ada.token);
  const META = await A.ev(`/Mac/.test(navigator.platform) ? 4 : 2`); // ⌘ on a Mac, Ctrl elsewhere
  await A.ev(`document.querySelector('#tabs [data-tab=work]').click(); true`);
  await A.until(`!!document.querySelector('#workTabs [data-tab=tools]')`);
  await A.ev(`document.querySelector('#workTabs [data-tab=tools]').click(); true`);
  ok(await A.until(`!!document.querySelector('#menu [data-tool=whiteboard]')`), 'Tools lists Whiteboard');
  await A.ev(`document.querySelector('#menu [data-tool=whiteboard]').click(); true`);
  ok(await A.until(`!!document.querySelector('#wbview:not(.hidden) .wb-tpl[data-tpl=workflow]')`), 'with no boards yet, it offers the templates');
  await A.tap(`document.querySelector('.wb-tpl[data-tpl=workflow]')`);
  ok(await A.until(`document.querySelectorAll('#wbview .wb-item').length === 8 && document.querySelectorAll('#wbview g.wb-link').length === 4`), 'Workflow map opens with its steps and arrows');
  ok(await A.ev(`document.querySelector('.wb-name').value === 'Workflow map' && !!document.querySelector('#wbview .wb-tools [data-tool=sticky]')`), 'the board has its name and the tools');
  ok(!(await A.ev(`document.querySelector('.wb-bar').textContent`)).includes('null'), 'its top bar has no stray “null” when nobody else is here');
  const boardId = (await get('/boards', ada.token)).boards[0].id;

  // A sticky: S, then click where it goes, then write.
  await A.ev(`document.querySelector('#wbview .wb-canvas').focus(); true`);
  await A.key('s', 'KeyS', 0, 's');
  ok(await A.ev(`document.querySelector('.wb-tool[data-tool=sticky]').classList.contains('on')`), 'S picks the sticky note');
  const [cx, cy] = await A.at(`document.querySelector('#wbview .wb-canvas')`);
  await A.click(cx + 250, cy + 250);
  ok(await A.until(`document.querySelectorAll('#wbview .wb-item').length === 9 && !!document.querySelector('.wb-item.k-sticky.editing')`), 'a click puts it there, ready to write on');
  await A.input('Input.insertText', { text: 'Call the GC' });
  await A.key('Escape', 'Escape');
  let stickyId = null;
  for (let i = 0; i < 30 && !stickyId; i++) { await sleep(150); stickyId = (await get(`/boards/${boardId}`, ada.token)).items.find((x) => x.kind === 'sticky' && x.text === 'Call the GC')?.id; }
  ok(!!stickyId, 'what she wrote is saved');

  // Ben opens the same board: he sees it, and she sees him.
  Bn = await signIn(ben.token);
  await Bn.ev(`document.querySelector('#tabs [data-tab=work]').click(); true`);
  await Bn.until(`!!document.querySelector('#workTabs [data-tab=tools]')`);
  await Bn.ev(`document.querySelector('#workTabs [data-tab=tools]').click(); true`);
  await Bn.until(`!!document.querySelector('#menu [data-tool=whiteboard]')`);
  await Bn.ev(`document.querySelector('#menu [data-tool=whiteboard]').click(); true`);
  ok(await Bn.until(`!!document.querySelector('.wb-bcard[data-board="${boardId}"]')`), 'Ben sees the team’s board in his list');
  await Bn.tap(`document.querySelector('.wb-bcard[data-board="${boardId}"]')`);
  ok(await Bn.until(`[...document.querySelectorAll('#wbview .wb-item .wb-text')].some((x) => x.textContent === 'Call the GC')`), 'and Ada’s sticky on it');
  ok(await A.until(`!!document.querySelector('.wb-here .wb-face[title=Ben]')`), 'Ada sees Ben is here');

  // Ada moves the sticky: Ben sees it move. Undo puts it back, for both.
  const sticky = `document.querySelector('#wbview .wb-item[data-id="${stickyId}"]')`;
  const before = await Bn.ev(`${sticky}.style.left`);
  const [sx, sy] = await A.at(sticky);
  await A.dragTo(sx, sy, sx + 160, sy + 90);
  ok(await Bn.until(`${sticky}.style.left !== ${JSON.stringify(before)}`, 4000), `Ben sees it move (${before} → ${await Bn.ev(`${sticky}.style.left`)})`);
  await A.key('z', 'KeyZ', META, '');
  ok(await Bn.until(`${sticky}.style.left === ${JSON.stringify(before)}`, 4000), 'Ada undoes it, and it’s back for Ben too');
  await A.key('z', 'KeyZ', META | 8, '');
  ok(await A.until(`${sticky}.style.left !== ${JSON.stringify(before)}`), 'and redo moves it again');

  // An arrow: select two things, Connect.
  const links0 = await A.ev(`document.querySelectorAll('#wbview g.wb-link').length`);
  await A.tap(sticky);
  await A.tap(`document.querySelectorAll('#wbview .wb-item.k-shape')[0]`, 8);
  ok(await A.until(`document.querySelectorAll('#wbview .wb-item.sel').length === 2 && !!document.querySelector('.wb-selbar .wb-sb[title^=Connect]')`), 'Shift+click selects a second thing; the bar offers Connect');
  await A.tap(`document.querySelector('.wb-selbar .wb-sb[title^=Connect]')`);
  ok(await A.until(`document.querySelectorAll('#wbview g.wb-link').length === ${links0 + 1}`) && await Bn.until(`document.querySelectorAll('#wbview g.wb-link').length === ${links0 + 1}`), 'an arrow joins them, for both of them');

  // Colors from the bar.
  await A.tap(sticky);
  await A.tap(`document.querySelector('.wb-selbar .wb-sw.c-blue')`);
  ok(await Bn.until(`${sticky}.classList.contains('c-blue')`), 'Ada makes it blue; Ben sees it');
  // Keys still work after clicking a color (focus was on the color button).
  await A.key('z', 'KeyZ', META, '');
  ok(await Bn.until(`!${sticky}.classList.contains('c-blue')`), '⌘Z right after picking a color undoes it');
  await A.key('z', 'KeyZ', META | 8, '');
  ok(await Bn.until(`${sticky}.classList.contains('c-blue')`), 'and redo brings it back');

  // A card for a real task.
  await A.tap(`document.querySelector('.wb-tool[data-tool=card]')`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .wb-pick')].some((x) => x.textContent.includes('Order tile for Smith'))`), 'Add a card lists her tasks');
  await A.tap(`[...document.querySelectorAll('#sheet .wb-pick')].find((x) => x.textContent.includes('Order tile for Smith'))`);
  ok(await A.until(`[...document.querySelectorAll('#wbview .wb-item.k-card')].some((x) => x.textContent.includes('Order tile for Smith') && x.textContent.includes('To do'))`), 'the card shows the task and where it stands');
  ok(await Bn.until(`[...document.querySelectorAll('#wbview .wb-item.k-card')].some((x) => x.textContent.includes('Order tile for Smith'))`), 'Ben sees the card too (it’s his team’s task)');

  // Delete: gone for Ben.
  await A.tap(sticky);
  await A.key('Delete', 'Delete');
  ok(await Bn.until(`!${sticky}`), 'Ada deletes the sticky; it’s gone for Ben (and its arrow with it)');

  // Zoom.
  await A.tap(`[...document.querySelectorAll('.wb-zoom .wb-btn')].find((b) => b.textContent === '+')`);
  ok(await A.until(`/%$/.test(document.querySelector('.wb-zoom-n').textContent) && document.querySelector('.wb-world').style.transform.includes('scale')`), 'zoom in: ' + await A.ev(`document.querySelector('.wb-zoom-n').textContent`));

  await A.up();
  await A.tap(`document.querySelectorAll('#wbview .wb-item.k-sticky')[0] || document.querySelector('#wbview .wb-item')`);
  FS.writeFileSync(DIR + '/board-desktop.png', Buffer.from((await A.cmd('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  // A phone: the tools move to the bottom.
  await Bn.up();
  await Bn.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 2, mobile: true });
  ok(await Bn.until(`document.querySelector('#wbview .wb').classList.contains('narrow') && getComputedStyle(document.querySelector('#wbview .wb-tools')).flexDirection === 'row'`), 'on a phone the tools run along the bottom');
  ok(await Bn.ev(`document.documentElement.scrollWidth <= 390`), 'and nothing sticks out sideways');
  await sleep(300);
  FS.writeFileSync(DIR + '/board-phone.png', Buffer.from((await Bn.cmd('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));

  ok(A.errors.length === 0 && Bn.errors.length === 0, 'no script errors' + (A.errors.length || Bn.errors.length ? ': ' + [...A.errors, ...Bn.errors].join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
Bn?.close();
chrome.kill();
srv.kill();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
