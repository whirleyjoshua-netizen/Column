import * as FS from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
// Sidekick on every page (2026-11-14): ✦ in the header opens one assistant beside whatever you're doing (a panel
// on the right at full size, a sheet from the bottom on a phone). Asking it hands the work to Your team, told what
// you're looking at; the assignment shows in the panel; it stays open beside tools, Projects and docs; ⌘J toggles it.
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/skdock';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4857, APP = `http://127.0.0.1:${PORT}/`, AI_PORT = 4859;
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
FS.rmSync(`${S}/dk/chrome-skd`, { recursive: true, force: true }); // a fresh profile, never one a closing Chrome still holds
try { (await import('node:child_process')).execSync('pkill -f remote-debugging-port=9488'); await new Promise((r) => setTimeout(r, 500)); } catch {} // a Chrome left on this port from an earlier run
const chrome = launch(9488, 'chrome-skd');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9488) {
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





const asked = [];
const text = (c) => (typeof c === 'string' ? c : (c || []).map((b) => b.text || (b.type === 'tool_result' ? b.content : '')).join(' '));
const ai = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    const sys = typeof j.system === 'string' ? j.system : JSON.stringify(j.system);
    const msgs = j.messages;
    asked.push({ sys, msgs: JSON.stringify(msgs) });
    const reply = (content, stop = 'end_turn') => res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    if (sys.includes('You coordinate four specialists')) return reply([{ type: 'text', text: JSON.stringify({ summary: 'The Chief of Staff handles it', parts: [{ agent: 'chief', ask: 'Make the dock task' }], question: null }) }]);
    // The specialist: one task on its first turn, then a short report.
    if (msgs.length === 1) return reply([{ type: 'text', text: 'On it.' }, { type: 'tool_use', id: 'tu_1', name: 'create_task', input: { text: 'Task from the panel', why: 'Asked in Sidekick' } }], 'tool_use');
    return reply([{ type: 'text', text: 'Added your task from the panel.' }]);
  });
});
await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, SKIP_SETUP: '1', PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}` }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
const t = Date.now();
const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Dock ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
await api('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
await api('PATCH', '/workspace', { tools: { projects: true, sidekick: true, agents: true } });
const rect = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width) }; })()`;
const shown = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.hidden) return false; const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0 && r.height > 0; })()`;
let A;
try {
  A = await tab(APP);
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  await sleep(1200);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=work]')`, 15000), 'Ada is in');

  // In the header on every page; no longer one of Workspace's tabs.
  ok(await A.ev(shown('#skBtn')), 'Sidekick is in the header');
  ok(!(await A.ev(`!!document.querySelector('#tabs [data-tab=sidekick]')`)), 'and not in Workspace any more');
  await A.click('#tabs [data-tab=day]');
  await A.tap(`document.querySelector('#skBtn')`);
  ok(await A.until(shown('#skDock')), 'tapping it opens the panel');
  const dock = await A.ev(rect('#skDock'));
  const main = await A.ev(rect('#main'));
  ok(dock.w >= 380 && dock.r >= (await A.ev('innerWidth')) - 1 && main.r <= dock.l + 1, `at full size it sits on the right, beside the page (${JSON.stringify({ dock, main })})`);
  ok(await A.until(`document.querySelector('#skDock .skd-page')?.textContent.startsWith('Looking at')`), 'it says what you are looking at (your Day)');
  ok(await A.until(`document.querySelector('#skDock .skd-q')?.textContent === 'How can Kloomie help you?'`), 'it asks: How can Kloomie help you?');
  ok(await A.until(`[...document.querySelectorAll('#skDock .skd-goal')].map((b) => b.textContent).join('|') === 'Grow / scale|More leads & marketing|Run my operations|Get my time back|Money|My team'`), 'with six goals to start from');
  ok(await A.ev(`[...document.querySelectorAll('#skDock .skd-chips .chip')].map((b) => b.textContent).join('|')`) === 'Plan my day|Plan a campaign|Plan my schedule|Plan my budget|Follow-up radar', 'and quick things below');

  // Ask: the team does it, and the assignment shows right there.
  await A.tap(`document.querySelector('#skDock .skd-ask')`);
  await A.type('Sort out this day for me');
  await A.key('Enter');
  ok(await A.until(`!!document.querySelector('#skDock .ag-run-top')`, 8000), 'asking opens the assignment in the panel');
  ok(await A.until(`document.querySelector('#skDock').textContent.includes('Added your task from the panel')`, 12000), 'and the team’s report lands there');
  ok((await api('GET', '/state')).tasks?.some?.((x) => x.text === 'Task from the panel') || (await api('GET', '/state')).entries?.some?.((x) => x.text === 'Task from the panel'), 'the task is real, in the app');
  ok(asked.some((a) => a.msgs.includes('looking at') && a.msgs.includes('Their Day')), 'the team was told what Ada was looking at');
  await A.tap(`document.querySelector('#skDock .skd-head [aria-label="Back to Sidekick"]')`);
  ok(await A.until(`[...document.querySelectorAll('#skDock .ag-run-row')].some((r) => r.textContent.includes('Sort out this day'))`), 'back at the start, it is under Recent');
  await A.tap(`[...document.querySelectorAll('#skDock .ag-run-row')].find((r) => r.textContent.includes('Sort out this day'))`);
  ok(await A.until(`!!document.querySelector('#skDock .ag-run-top')`) && await A.ev(`document.querySelector('#tool').classList.contains('hidden')`), 'and opens again in the panel, not in Agents');
  await A.tap(`document.querySelector('#skDock .skd-head [aria-label="Back to Sidekick"]')`);
  await A.tap(`document.querySelector('#skDock .skd-page .linkish')`);
  ok(await A.until(`document.querySelector('#skDock .skd-page').classList.contains('off')`), 'the page can be left out of a question');

  // A goal: its sentence to finish, then a plan where every change waits for a yes, with the goal's playbook.
  await A.tap(`document.querySelector('#skDock .skd-head [aria-label="Back to Sidekick"]')`).catch(() => {});
  await A.until(`!!document.querySelector('#skDock .skd-goal')`);
  await A.tap(`document.querySelector('#skDock .skd-goal[data-goal=grow]')`);
  ok(await A.until(`document.querySelector('#skDock .skd-ask')?.value.startsWith('Help me grow from ___') && document.querySelector('#skDock .skd-go').textContent === 'Make my plan'`), 'Grow fills in its sentence to finish, and the button says Make my plan');
  ok(await A.ev(`(() => { const t = document.querySelector('#skDock .skd-ask'); return document.activeElement === t && t.value.slice(t.selectionStart, t.selectionEnd) === '___'; })()`), 'with the first blank selected, ready to type over');
  await A.key('Enter');
  ok(await A.until(`[...document.querySelectorAll('.toast')].some((x) => x.textContent.includes('Fill in the blanks'))`), 'it won’t go with blanks left');
  await A.ev(`(() => { const t = document.querySelector('#skDock .skd-ask'); t.value = 'Help me grow from $20k to $40k a month by June'; t.dispatchEvent(new Event('input')); return true; })()`);
  await A.tap(`document.querySelector('#skDock .skd-go')`);
  ok(await A.until(`document.querySelector('#skDock .ag-run-h')?.textContent.includes('Grow / scale')`, 8000), 'it opens as a Grow plan in the panel');
  ok(await A.until(`[...document.querySelectorAll('#skDock .ag-step')].some((x) => x.textContent.includes('Task from the panel')) && !!document.querySelector('#skDock .ag-step .primary-btn, #skDock .ag-note .primary-btn')`, 12000), 'its changes wait for a yes, with buttons to approve');
  ok(asked.some((a) => a.msgs.includes('plan for the person to review') && /average job/i.test(a.msgs)), 'the team gets the Grow playbook');
  // In their own words: reads like a goal, so it's a plan too.
  await A.tap(`document.querySelector('#skDock .skd-head [aria-label="Back to Sidekick"]')`);
  await A.until(`!!document.querySelector('#skDock .skd-ask')`);
  await A.ev(`(() => { const t = document.querySelector('#skDock .skd-ask'); t.focus(); t.value = 'Help me get more storefront customers'; t.dispatchEvent(new Event('input')); return true; })()`);
  ok(await A.until(`document.querySelector('#skDock .skd-go').textContent === 'Make my plan'`), 'a goal in their own words gets Make my plan too');
  await A.ev(`(() => { const t = document.querySelector('#skDock .skd-ask'); t.value = 'Sort the photos'; t.dispatchEvent(new Event('input')); return true; })()`);
  ok(await A.until(`document.querySelector('#skDock .skd-go').textContent === 'Ask'`), 'a quick ask is just Ask');
  await A.ev(`(() => { const t = document.querySelector('#skDock .skd-ask'); t.value = ''; t.dispatchEvent(new Event('input')); t.blur(); return true; })()`); // a real tap on a tab moves the cursor out too

  // It stays beside your work: a tool, Projects.
  await A.click('#tabs [data-tab=contacts]');
  ok(await A.until(shown('#tool')) && await A.ev(shown('#skDock')), 'Contacts opens with Sidekick still beside it');
  ok((await A.ev(rect('#tool'))).r <= (await A.ev(rect('#skDock'))).l + 1, 'side by side, not on top of each other');
  ok(await A.until(`document.querySelector('#skDock .skd-page b')?.textContent === 'Contacts' || document.querySelector('#skDock .skd-page')?.textContent.includes('Contacts')`), 'and it now knows you are in Contacts');
  await A.click('#tabs [data-tab=projects]');
  ok(await A.until(shown('#projects')) && (await A.ev(rect('#projects'))).r <= (await A.ev(rect('#skDock'))).l + 1, 'Projects fills the space beside it');
  ok(!/\bnull\b/.test(await A.ev(`document.querySelector('#skDock').innerText`)), 'nothing stray in the panel');

  // The campaign's own side panel ("Keep beside") still works: it shares no code with Sidekick's (they were once
  // both named renderDock, and the second hid the first).
  {
    const c = await api('POST', '/campaigns', { name: 'Dock test' });
    const camp = c.campaign || c;
    const up = await (await fetch(APP + 'api/upload?name=Script.txt&type=text/plain', { method: 'PUT', headers: { authorization: 'Bearer ' + auth.token }, body: 'Hello, this is the call script.' })).json();
    await api('PATCH', '/items/' + (up.id || up.item?.id), { stackId: camp.stackId });
    await A.ev(`document.querySelector('#tabs [data-tab=camps]').click(); true`);
    ok(await A.until(`[...document.querySelectorAll('.camp-card')].some((b) => b.textContent.includes('Dock test'))`, 8000), 'the campaign is listed');
    await A.ev(`[...document.querySelectorAll('.camp-card')].find((b) => b.textContent.includes('Dock test')).click(); true`);
    await A.until(`[...document.querySelectorAll('#camps button')].some((b) => /Files/.test(b.textContent))`, 8000);
    await A.ev(`[...document.querySelectorAll('#camps button')].find((b) => /Files/.test(b.textContent)).click(); true`);
    await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent.includes('Script.txt'))`);
    await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.includes('Script.txt')).click(); true`);
    ok(await A.until(`!document.querySelector('#dock').classList.contains('hidden') && document.querySelector('#dock').textContent.includes('call script')`, 8000), 'a campaign file kept beside it opens in the campaign’s own panel');
    ok(await A.ev(shown('#skDock')), 'with Sidekick’s panel still open as well');
  }

  // ⌘J closes and opens it.
  await A.cmd('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74, modifiers: 4 });
  await A.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'j', code: 'KeyJ', windowsVirtualKeyCode: 74, modifiers: 4 });
  ok(await A.until(`!${shown('#skDock')}`), '⌘J closes it');
  ok((await A.ev(rect('#main'))).r >= (await A.ev('innerWidth')) - 1, 'and the page takes the room back');

  // A phone: a sheet from the bottom, over the page.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await A.ev(`document.querySelector('#projects [aria-label="Close Boards"]')?.click(); true`);
  await sleep(300);
  ok(await A.ev(shown('#skBtn')), 'the ✦ button is there on a phone');
  await A.tap(`document.querySelector('#skBtn')`);
  const sheetR = await A.ev(rect('#skDock'));
  ok(await A.until(shown('#skDock')) && sheetR.b >= 843 && sheetR.t > 40 && sheetR.w >= 389, `a sheet from the bottom (${JSON.stringify(sheetR)})`);
  ok(await A.ev(shown('#skScrim')), 'over the page');
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await A.cmd('Input.dispatchMouseEvent', { type, x: 200, y: 20, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
  ok(await A.until(`!${shown('#skDock')}`), 'tapping above it closes it');
  ok(await A.ev(`document.documentElement.scrollWidth <= innerWidth`), 'nothing spills sideways');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
}
A?.close();
chrome.kill();
srv.kill();
ai.close();
if (fails) console.log(srv.log.split('\n').slice(-15).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
