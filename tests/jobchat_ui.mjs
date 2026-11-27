// Chat and stacks together in the app (docs/jobflows/JOBCHAT.md): a feed's All / Chat / Files tabs show the right
// things; a note or a file dropped on Files goes into the feed's stack; a new job shows 💬 on its row and its page,
// opening its chat beside the job, with the unread count on the row; a member with a job's chat open who loses the
// job (an "own" team) sees the chat close and the feed leave the list.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/jobchat_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5270, CDP = 9605, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 80 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map();
  const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed'); return r.result?.result?.value; };
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(120); } return false; };
  const tap = async (expr) => {
    if (!(await until(`!!(${expr})`, 8000))) return false;
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(150);
  };
  return { ev, until, tap, cmd, errors };
}
const TOOL = (sel) => `document.querySelector('#tool ${sel}')`;
const CHAT = `(document.querySelector('#chat:not(.hidden)'))`;
const listText = `(${CHAT}?.querySelector('.chat-pane .list')?.textContent || '')`;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const api = (tok) => async (m, p, body) => { const r = await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return r.json().catch(() => null); };
  const a = await api()('POST', '/auth', { mode: 'create', workspace: 'JC ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = api(a.token);
  let st = await rico('GET', '/state');
  const b = await api()('POST', '/auth', { mode: 'join', workspace: 'JC ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = api(b.token);
  st = await rico('GET', '/state');
  const samId = st.workspace.members.find((m) => m.name === 'Sam Reed').id;
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, chat: true } });
  const p = await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'] });
  const tp = p.types[0];
  // A plain feed with a message, and a note in its Files.
  const yard = (await rico('POST', '/channels', { name: 'yard' })).channels.find((c) => c.name === 'yard');
  await rico('POST', '/items', { type: 'message', text: 'YARDMSG hello', channelId: yard.id });
  const yst = (await rico('POST', `/channels/${yard.id}/stack`))?.stack;
  await rico('POST', '/items', { type: 'text', text: 'YARDNOTE in files', stackId: yst?.id });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000);
  await A.tap(`document.querySelector('#tabs [data-tab=chat]')`);
  await A.until(`!!${CHAT}?.querySelector('.ch-row')`, 10000);
  // The Jobs folder: first, there before any job, no rename or delete; a new job's chat shows up in it by itself.
  const firstFolder = `${CHAT}.querySelector('.ch-folder')`;
  ok(await A.until(`/^Jobs/.test(${firstFolder}?.textContent || '') && ${CHAT}.textContent.includes('Each new job’s chat shows up here')`, 8000), 'the Jobs folder is first in the chat list, there before any job');
  await A.ev(`${firstFolder}.querySelector('.ch-more').click(); true`);
  ok(await A.until(`!document.querySelector('#menu').classList.contains('hidden') && /always here/.test(document.querySelector('#menu').textContent) && !/Rename|Delete/.test(document.querySelector('#menu').textContent)`), 'its menu has no Rename or Delete');
  await A.ev(`document.body.click(); true`);
  const burns = await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Burns hOme' } });
  ok(await A.until(`(() => { const rows = [...${CHAT}.querySelectorAll('.ch-folder, .ch-row')]; const i = rows.findIndex((r) => r.classList.contains('ch-folder') && /^Jobs/.test(r.textContent)); return i >= 0 && rows[i + 1]?.classList.contains('in') && /burns-home/.test(rows[i + 1].textContent); })()`, 10000), 'a new job called “Burns hOme”: its chat, burns-home, shows up under Jobs without a reload');
  await A.ev(`[...${CHAT}.querySelectorAll('.ch-row')].find((r) => /burns-home/.test(r.textContent)).querySelector('.ch-more')?.click(); true`);
  ok(await A.until(`/follows its job/.test(document.querySelector('#menu').textContent) && !/Move to folder|Delete feed|Rename/.test(document.querySelector('#menu').textContent)`), 'a job chat’s menu: no rename, move or delete');
  await A.ev(`document.body.click(); true`);
  await A.ev(`[...${CHAT}.querySelectorAll('.ch-row')].find((r) => /yard/.test(r.textContent)).click(); true`);
  ok(await A.until(`!!${CHAT}?.querySelector('.ch-tabs [data-ft=all]') && !!${CHAT}.querySelector('.ch-tabs [data-ft=chat]') && !!${CHAT}.querySelector('.ch-tabs [data-ft=files]')`), 'a feed has All / Chat / Files tabs');
  await A.tap(`${CHAT}.querySelector('.ch-tabs [data-ft=chat]')`);
  ok(await A.until(`${listText}.includes('YARDMSG') && !${listText}.includes('YARDNOTE')`), 'Chat: the message, not the note in its Files');
  await A.tap(`${CHAT}.querySelector('.ch-tabs [data-ft=files]')`);
  ok(await A.until(`${listText}.includes('YARDNOTE') && !${listText}.includes('YARDMSG')`), 'Files: the note, not the message');
  await A.tap(`${CHAT}.querySelector('.ch-tabs [data-ft=all]')`);
  ok(await A.until(`${listText}.includes('YARDNOTE') && ${listText}.includes('YARDMSG')`), 'All: both');
  ok(await A.ev(`${listText}.indexOf('YARDMSG') < ${listText}.indexOf('YARDNOTE')`), 'in the order they were made (the message first), newest at the bottom');
  // A file dropped into the conversation: in Chat, Files and All, once in each.
  await A.tap(`${CHAT}.querySelector('.ch-tabs [data-ft=chat]')`);
  await A.ev(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'inchat.txt', { type: 'text/plain' })); const to = ${CHAT}.querySelector('.chat-pane .list'); for (const type of ['dragenter', 'dragover', 'drop']) to.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true })); return true; })()`);
  const once = `(${listText}.split('inchat.txt').length - 1) >= 1 && [...${CHAT}.querySelectorAll('.chat-pane .list > *')].filter((e) => e.textContent.includes('inchat.txt')).length === 1`;
  ok(await A.until(once, 8000), 'a file dropped into Chat shows there, once');
  await A.tap(`${CHAT}.querySelector('.ch-tabs [data-ft=files]')`);
  ok(await A.until(once), 'in Files, once');
  await A.tap(`${CHAT}.querySelector('.ch-tabs [data-ft=all]')`);
  ok(await A.until(once), 'and in All, once');
  // A file dropped on Files goes into the feed's stack.
  await A.tap(`${CHAT}.querySelector('.ch-tabs [data-ft=files]')`);
  await A.ev(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['hello'], 'yardfile.txt', { type: 'text/plain' })); const to = ${CHAT}.querySelector('.chat-pane .list'); for (const type of ['dragenter', 'dragover', 'drop']) to.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true })); return true; })()`);
  let ok1 = false;
  for (let i = 0; i < 50 && !ok1; i++) { st = await rico('GET', '/state'); ok1 = st.items.some((x) => x.name === 'yardfile.txt' && x.stackId === yst?.id && !x.channelId); if (!ok1) await sleep(200); }
  ok(ok1, 'a file dropped on Files lands in the feed’s stack');
  ok(await A.until(`${listText}.includes('yardfile.txt')`), 'and shows there');
  ok(await A.ev(`localStorage.getItem('column.feedTab:' + ${JSON.stringify(yard.id)})`) === '"files"', 'the tab is remembered for the feed on this device');
  await A.ev(`location.reload(); true`);
  await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000);
  await A.tap(`document.querySelector('#tabs [data-tab=chat]')`);
  await A.until(`!!${CHAT}?.querySelector('.ch-row')`, 10000);
  await A.ev(`[...${CHAT}.querySelectorAll('.ch-row')].find((r) => /yard/.test(r.textContent))?.click(); true`);
  ok(await A.until(`!!${CHAT}?.querySelector('.ch-tabs [data-ft=files].on') && ${listText}.includes('YARDNOTE') && !${listText}.includes('YARDMSG')`), 'after a reload the feed opens on Files again');
  // Newest at the top (Settings → General) applies to Files; Chat still reads top to bottom.
  await rico('PUT', '/account/feed', { newestTop: true });
  await A.ev(`location.reload(); true`);
  await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000);
  await A.tap(`document.querySelector('#tabs [data-tab=chat]')`);
  await A.until(`!!${CHAT}?.querySelector('.ch-row')`, 10000);
  await A.ev(`[...(${CHAT}?.querySelectorAll('.ch-row') || [])].find((r) => /yard/.test(r.textContent))?.click(); true`);
  ok(await A.until(`${listText}.includes('yardfile.txt') && ${listText}.indexOf('yardfile.txt') < ${listText}.indexOf('YARDNOTE')`), 'with newest at the top chosen, Files shows the newest first');
  await A.tap(`${CHAT}.querySelector('.ch-tabs [data-ft=chat]')`);
  ok(await A.until(`${listText}.includes('inchat.txt') && ${listText}.indexOf('YARDMSG') < ${listText}.indexOf('inchat.txt')`), 'and Chat still reads top to bottom');
  await rico('PUT', '/account/feed', { newestTop: false });

  // An older job with a stack and no chat: its 📁 Files opens (and makes) its chat, on Files, with the stack's things.
  await rico('PATCH', '/workspace', { jobChats: false });
  const oldJob = await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Older gutter job' } });
  const oldSt = (await rico('POST', `/jobs/${oldJob.id}/stack`))?.stack;
  await rico('POST', '/items', { type: 'text', text: 'OLDSTACKNOTE gutter photos', stackId: oldSt?.id });
  await rico('PATCH', '/workspace', { jobChats: true });
  await A.ev(`document.querySelector('#workTabs [data-tab=jobs]').click(); true`);
  await A.until(`!!document.querySelector('#tool [data-jb=jobs]')`, 10000);
  await A.ev(`document.querySelector('#tool [data-jb=jobs]').click(); true`);
  await A.tap(TOOL(`.jb-row[data-job="${oldJob.id}"] .jb-main`));
  await A.tap(`document.querySelector('#projects .jb-card [data-act=files]')`);
  ok(await A.until(`!!${CHAT} && /older-gutter-job/.test(${CHAT}.querySelector('.ch-title')?.textContent || '') && !!${CHAT}.querySelector('.ch-tabs [data-ft=files].on') && ${listText}.includes('OLDSTACKNOTE')`, 10000), 'an older job’s 📁 Files opens its new chat on Files, with what was in its stack');
  st = await rico('GET', '/state');
  ok(st.workspace.channels.find((c) => c.recordId === oldJob.id)?.stackId === oldSt?.id, 'its chat took the stack it had');
  await A.tap(`document.querySelector('#projects .pr-close, #projects [aria-label="Close"]')`);

  // A new job: 💬 on its row, opening its chat beside it.
  const job = await rico('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Porch wash', crew: samId } });
  st = await rico('GET', '/state');
  const jf = st.workspace.channels.find((c) => c.recordId === job.id);
  await A.ev(`document.querySelector('#workTabs [data-tab=jobs]').click(); true`);
  await A.until(`!!document.querySelector('#tool [data-jb=jobs]')`, 10000);
  await A.ev(`document.querySelector('#tool [data-jb=jobs]').click(); true`);
  ok(await A.until(`!!${TOOL(`.jb-row[data-job="${job.id}"] .jb-chat`)}`, 10000), 'the new job’s row has 💬');
  await sam('POST', '/items', { type: 'message', text: 'Sam says hi', channelId: jf?.id });
  ok(await A.until(`/1/.test(${TOOL(`.jb-row[data-job="${job.id}"] .jb-chat`)}?.textContent || '')`, 8000), 'with the unread count when someone posts');
  await A.tap(TOOL(`.jb-row[data-job="${job.id}"] .jb-chat`));
  ok(await A.until(`!!${CHAT} && /porch-wash/.test(${CHAT}.querySelector('.ch-title')?.textContent || '') && ${listText}.includes('Sam says hi')`, 10000), 'tapping it opens the job’s chat');
  ok(await A.until(`!!document.querySelector('#split:not(.hidden)')?.contains(${CHAT}) && !!document.querySelector('#tool .jb-row[data-job="${job.id}"]')?.offsetParent`), 'beside the job: the chat in the split, the job’s row still showing');
  ok(await A.until(`!/1/.test(${TOOL(`.jb-row[data-job="${job.id}"] .jb-chat`)}?.textContent || '')`, 6000), 'read: the count goes');
  await A.tap(TOOL(`.jb-row[data-job="${job.id}"] .jb-main`));
  ok(await A.until(`!!document.querySelector('#projects .jb-card .jb-chat')`, 10000), 'the job’s page has 💬 too');

  // A member with the job's chat open loses the job.
  await rico('PATCH', '/workspace', { visibility: 'own' });
  const B = await tab(APP);
  await B.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await B.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(b.token))}); location.reload(); true`);
  await B.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000);
  await B.until(`!!document.querySelector('#workTabs [data-tab=jobs]')`, 15000);
  await B.ev(`document.querySelector('#workTabs [data-tab=jobs]').click(); true`);
  await B.until(`!!document.querySelector('#tool [data-jb=jobs]')`, 10000);
  await B.ev(`document.querySelector('#tool [data-jb=jobs]').click(); true`);
  await rico('POST', '/items', { type: 'text', text: 'JOBFILE porch', stackId: jf?.stackId });
  await B.tap(TOOL(`.jb-row[data-job="${job.id}"] .jb-chat`));
  ok(await B.until(`!!${CHAT} && /porch-wash/.test(${CHAT}.querySelector('.ch-title')?.textContent || '')`, 10000), 'Sam opens the job’s chat');
  await B.tap(`${CHAT}.querySelector('.ch-tabs [data-ft=files]')`);
  ok(await B.until(`${listText}.includes('JOBFILE')`), 'on its Files');
  // A drag over it, still going when he loses the job.
  await B.ev(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'stale.txt', { type: 'text/plain' })); window.__dt = dt; const to = ${CHAT}.querySelector('.chat-pane .list'); for (const type of ['dragenter', 'dragover']) to.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true })); return true; })()`);
  await rico('PATCH', `/records/${job.id}`, { values: { crew: null } });
  ok(await B.until(`!/porch-wash/.test(${CHAT}?.querySelector('.ch-title')?.textContent || '') && !/Sam says hi/.test(${listText})`, 10000), 'taken off the job: its chat closes for him');
  ok(await B.until(`![...document.querySelectorAll('#chat .ch-row')].some((r) => /porch-wash/.test(r.textContent))`, 8000), 'and the feed leaves his list');
  ok(await B.ev(`!document.body.textContent.includes('JOBFILE')`), 'nothing of its Files is left on the page');
  await B.ev(`(() => { const to = document.querySelector('#chat .chat-pane .list') || document.body; to.dispatchEvent(new DragEvent('drop', { dataTransfer: window.__dt, bubbles: true, cancelable: true })); return true; })()`);
  await sleep(1500);
  st = await rico('GET', '/state');
  const stale = await rico('GET', `/jobs/${job.id}/chat`);
  ok(!JSON.stringify(stale?.items || []).includes('stale.txt') && !st.items.some((x) => x.name === 'stale.txt'), 'the drag that was going lands nowhere: not in the job’s chat, not in #general, not anywhere');
  ok(!A.errors.length && !B.errors.length, 'no errors on the page: ' + [...A.errors, ...B.errors].join(' | ').slice(0, 400));
} catch (e) {
  ok(false, 'threw: ' + (e.stack || e));
} finally {
  srv.kill(); chrome.kill();
}
console.log(fails ? `jobchat_ui: ${fails} failed` : 'jobchat_ui: all passed');
process.exit(fails ? 1 : 0);
