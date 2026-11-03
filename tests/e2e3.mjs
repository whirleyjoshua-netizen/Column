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
await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = 'ai${Date.now()}'; f.name.value = 'Jo'; f.password.value = 'secret1'; f.device.value = 'Tab A'; if (f.email && f.code !== undefined) { f.email.value = f.name.value.toLowerCase().replace(/[^a-z]/g, '') + f.workspace.value.replace(/[^a-z0-9]/gi, '') + '@t.test'; if (f.password.value.length < 8) f.password.value += 'pad1'; } f.requestSubmit(); })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'signed in');
await sleep(1500);
const token = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined })).json();
const keyR = await api('PUT', '/ai/keys/anthropic', { key: 'sk-test-1234567890' });
ok(!!keyR.provider, 'AI key saved (stand-in AI)');
const c = await api('POST', '/campaigns', { name: 'Fleet push', start: '2026-10-01', end: '2026-12-31' });
const g = await api('POST', '/goals', { campaignId: c.id, title: 'Book 5 demos', kind: 'tasks' });
const t = await api('POST', '/tasks', { text: 'Call Desert Auto', goalId: g.id });
await api('POST', '/attempts', { campaignId: c.id, outcome: 'Interested' });
const stack = (await api('GET', '/state')).workspace.stacks.find((x) => x.campaignId === c.id);
const d = await api('POST', '/items', { type: 'text', stackId: stack.id, doc: { title: '', blocks: [] } });
await sleep(500);
const openFromTool = async (title) => {
  await A.tap(`document.querySelector('#toolsBtn')`);
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Docs'))`);
  await A.tap(`[...document.querySelectorAll('#tool .doc-row')].find((r) => r.textContent.startsWith(${JSON.stringify(title)}))`);
};
await openFromTool('Untitled');
ok(await A.until(`!!document.querySelector('#docview .dv-start-row')`), 'an empty doc offers templates and AI');
// template
await A.tap(`[...document.querySelectorAll('#docview .dv-start-row button')].find((b) => b.textContent === 'Weekly report')`);
ok(await A.until(`document.querySelector('#docview .dk-title').textContent.startsWith('Fleet push · Week of')`), 'the weekly report template names itself after the campaign');
ok(await A.ev(`[...document.querySelectorAll('#docview .dk-lv')].map((x) => x.classList.contains('snap')).join()`) === 'true,true', 'it starts with two frozen number blocks');
ok(await A.ev(`[...document.querySelectorAll('#docview .dk-h1 .dk-text')].map((x) => x.textContent).join('|')`) === 'What worked|What didn’t|Next week', 'and the report headings');
ok(await A.ev(`document.querySelector('#docview .dv-start').children.length`) === 0, 'the starter goes away once there’s content');
// draft the whole doc with AI
await A.tap(`document.querySelector('.dv-bar [aria-label="Doc options"]')`);
await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('✦ Draft the whole doc')).click()`);
await A.ev(`(() => { const t = document.querySelector('#sheet textarea'); t.value = 'This week’s recap'; document.querySelector('#sheet .primary-btn').click(); })()`);
ok(await A.until(`document.querySelector('#docview .dk-draft-h')?.textContent.includes('Draft from AI')`, 5000), 'a draft comes back and waits');
ok(await A.ev(`document.querySelector('#docview .dk-draft-page').textContent.includes('Desert Auto') && !!document.querySelector('#docview .dk-draft-page b')`), 'the draft shows formatted');
let ai = (await import('node:fs')).readFileSync(process.argv[2] + '/dk/ai.log', 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);
ok(ai.user.includes('[[live:1]]') && ai.user.includes('Fleet push') && ai.user.includes('Calls and emails logged') && ai.user.includes('This week'), 'the AI got the doc with its live markers, the campaign and how it’s going');
await A.tap(`document.querySelector('#docview .dk-draft-ok')`);
ok(await A.until(`!document.querySelector('#docview .dk-draft')`), 'Use this draft puts it in');
const kinds = await A.ev(`[...document.querySelectorAll('#docview .dk-row')].map((r) => r.querySelector('.dk-lv') ? 'live' : r.className.split(' ')[1].slice(3)).join(',')`);
ok(kinds.startsWith('live,live,h1,ul,h1,ul,h1,todo'), 'live blocks kept (one the AI placed, one it left at the top): ' + kinds);
ok(await A.ev(`!!document.querySelector('#docview .dk-ul b')`), '**bold** from the AI is bold');
ok(await A.ev(`document.querySelector('#docview .dk-title').textContent.startsWith('Fleet push')`), 'its title wasn’t replaced (there was one)');
// undo takes the whole draft back
await A.ev(`(() => { const r = document.querySelector('#docview .dk-ul .dk-text'); r.focus(); getSelection().collapse(r, 0); })()`);
await A.key('z', 4);
ok(await A.until(`[...document.querySelectorAll('#docview .dk-h1 .dk-text')].map((x) => x.textContent).join('|') === 'What worked|What didn’t|Next week' && !document.querySelector('#docview .dk-ul b')`), '⌘Z takes the AI draft back out');
await A.key('z', 12);
ok(await A.until(`!!document.querySelector('#docview .dk-ul b')`), '⌘⇧Z puts it back');
// rework selected words
await A.ev(`(() => { const r = [...document.querySelectorAll('#docview .dk-ul .dk-text')][1]; const t = r.firstChild; const g = document.createRange(); g.setStart(t, 0); g.setEnd(t, t.data.length); getSelection().removeAllRanges(); getSelection().addRange(g); })()`);
ok(await A.until(`!!document.querySelector('.dk-bar .dk-ai-btn')`), 'selected text shows ✦ AI in the bar');
await A.tap(`document.querySelector('.dk-bar .dk-ai-btn')`);
await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Improve the writing').click()`);
ok(await A.until(`document.querySelector('#docview .dk-draft-ok')?.textContent === 'Replace selection'`, 5000), 'a rewrite comes back as a draft');
await A.tap(`document.querySelector('#docview .dk-draft-ok')`);
ok(await A.until(`[...document.querySelectorAll('#docview .dk-ul .dk-text')][1]?.innerHTML === 'Much <b>better</b> words'`), 'Replace selection swaps the words in place: ' + await A.ev(`[...document.querySelectorAll('#docview .dk-ul .dk-text')][1]?.innerHTML`));
// /ai with a quick ask, then discard one
await A.key('Enter');
await A.type('/'); await A.type('ai'); await A.key('Enter');
ok(await A.until(`!!document.querySelector('#docview .dk-ai-ask .dk-ai-in')`), '/ai opens the ask box');
await A.tap(`[...document.querySelectorAll('#docview .dk-ai-quick button')].find((b) => b.textContent === 'Talking points')`);
ok(await A.until(`document.querySelector('#docview .dk-draft-ok')?.textContent === 'Insert'`, 5000), 'a quick ask drafts');
await A.tap(`document.querySelector('#docview .dk-draft-ok')`);
ok(await A.until(`[...document.querySelectorAll('#docview .dk-ul .dk-text')].some((x) => x.textContent === 'Second point')`), 'Insert adds it where the cursor was');
await A.key('Enter'); await A.key('Enter');
await A.type('/'); await A.type('ai'); await A.key('Enter');
await A.until(`!!document.querySelector('#docview .dk-ai-ask .dk-ai-in')`);
await A.type('three ideas'); await A.key('Enter');
await A.until(`!!document.querySelector('#docview .dk-draft-ok')`, 5000);
const before = await A.ev(`document.querySelectorAll('#docview .dk-row').length`);
await A.tap(`[...document.querySelectorAll('#docview .dk-draft-btns button')].find((b) => b.textContent === 'Discard')`);
ok(await A.until(`!document.querySelector('#docview .dk-draft')`) && await A.ev(`document.querySelectorAll('#docview .dk-row').length`) === before, 'Discard leaves the doc as it was');
ok(await A.until(`document.querySelector('.dv-status').textContent === 'Saved'`, 4000), 'saved');
await A.ev(`document.querySelector('.dv-bar [aria-label="Close doc"]').click()`);
await A.ev(`document.querySelector('#tool [aria-label="Close"]')?.click()`);
// a doc for a task, from its menu
await A.click('[data-tab=camps]');
await A.tap(`[...document.querySelectorAll('.camp-card')].find((b) => b.textContent.includes('Fleet push'))`);
await A.until(`[...document.querySelectorAll('.task-row')].some((r) => r.textContent.includes('Call Desert Auto'))`);
await A.tap(`[...document.querySelectorAll('.task-row')].find((r) => r.textContent.includes('Call Desert Auto')).querySelector('[aria-label="More"]')`);
await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Write a doc for it…').click()`);
await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Call script')).click()`);
ok(await A.until(`document.querySelector('#docview .dk-title')?.textContent === 'Call Desert Auto'`), 'Write a doc for it opens a doc named after the task');
ok(await A.ev(`document.querySelectorAll('#docview .dk-toggle').length`) === 2, 'from the call script template (objections as toggles)');
await sleep(800);
const tt = (await api('GET', '/state')).tasks.find((x) => x.id === t.id);
const docItems = (await api('GET', '/state')).items.filter((x) => x.type === 'text');
ok(tt.files?.some((id) => docItems.find((x) => x.id === id)?.title === 'Call Desert Auto'), 'the doc is attached to the task');
await A.ev(`document.querySelector('.dv-bar [aria-label="Close doc"]').click()`);
// the report, saved as a doc and linked from the post
await A.tap(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Write a report' || b.textContent === 'Weekly check-in')`);
await A.ev(`(() => { const t = document.querySelector('#sheet textarea'); t.value = '- Desert Auto wants a demo'; })()`);
await A.ev(`document.querySelector('#sheet .primary-btn').click()`);
await sleep(1500);
const st2 = await api('GET', '/state');
const rep = st2.items.find((x) => x.type === 'text' && /report/.test(x.title || ''));
ok(!!rep && rep.stackId === stack.id, 'the report was saved as a doc in the campaign');
const repDoc = rep && await api('GET', `/items/${rep.id}/doc`);
ok(repDoc?.blocks.filter((b) => b.type === 'live' && b.snap).length === 2 && repDoc.blocks.some((b) => b.runs?.[0]?.text === 'Desert Auto wants a demo'), 'with frozen numbers and the findings');
const post = st2.items.find((x) => x.type === 'message' && x.text.includes('Report · Fleet push'));
ok(post?.text.includes(`[[doc:${rep?.id}]]`), 'the feed post links the doc');
// Sidekick proposes a doc; applying makes it
await A.tap(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Sidekick') && b.closest('#camps'))`);
ok(await A.until(`[...document.querySelectorAll('#tool .sk-card-h')].some((x) => x.textContent === 'Doc')`, 6000), 'Sidekick proposes a Doc card');
await A.tap(`[...document.querySelectorAll('#tool .sk-card')].find((x) => x.querySelector('.sk-card-h').textContent === 'Doc').querySelector('.primary-btn')`);
await A.until(`[...document.querySelectorAll('#tool .sk-ready .primary-btn')].length > 0`);
await A.tap(`document.querySelector('#tool .sk-ready .primary-btn')`);
await sleep(1500);
const skDoc = (await api('GET', '/state')).items.find((x) => x.type === 'text' && x.title === 'Fleet push · weekly report');
const skBody = skDoc && await api('GET', `/items/${skDoc.id}/doc`);
ok(skBody?.blocks[0]?.type === 'live' && skBody.blocks[0].snap && skBody.blocks.some((b) => b.type === 'todo'), 'the doc is made with the campaign’s numbers frozen on top and its to-dos');
ok(!A.errors.length, 'no page errors' + (A.errors.length ? ': ' + A.errors.join(' / ') : ''));
A.close(); chrome.kill();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
