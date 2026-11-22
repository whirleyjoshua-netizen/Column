import * as FS from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
// Editing an agent in the browser: its job (what's typed outlives a redraw, saved, reset), its connections (switched,
// reset, shown in Overview), every tool named, a stopped draft saying why, and all of it on a phone-sized screen.
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/agent_edit_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5406, APP = `http://127.0.0.1:${PORT}/`, AI_PORT = 5405, CDP = 9730;
const SHOTS = process.env.SHOTS || '';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(CDP, 'agent_edit_chrome');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = CDP) {
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
const ai = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    const content = j.messages.length === 1 && JSON.stringify(j.messages).includes('draft an email')
      ? [{ type: 'tool_use', id: 't1', name: 'draft_email', input: { to_email: 'pat@t.test', subject: 'Your estimate', body: 'Hi Pat, checking in on the estimate.' } }] : [{ type: 'text', text: 'Done.' }];
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: content[0].type === 'tool_use' ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, SKIP_SETUP: '1', PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}` }, stdio: 'ignore' });
for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
let A;
try {
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Edit ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  await api('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  const shot = async (n) => { if (!SHOTS) return; await sleep(500); const r = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(`${SHOTS}/${n}.png`, Buffer.from(r.result.data, 'base64')); };
  const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
  const tabTo = (name) => A.ev(`[...document.querySelectorAll('#tool .ag-tabs button')].find((b) => b.textContent === '${name}').click()`);
  A = await tab(APP);
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  await sleep(1200);
  await A.until(`!${q('#app')}.classList.contains('hidden')`);
  await A.click('#tabs [data-tab=agents]');
  await A.until(`document.querySelectorAll('#tool .ag-card').length === 4`);
  const card = (i) => A.ev(`document.querySelectorAll('#tool .ag-card')[${i}].click()`);
  const back = () => A.ev(`${q('#tool .ag-back')}.click()`);
  for (let i = 0; i < 4; i++) {
    await card(i);
    await A.until(`!!${q('#tool .ag-tools')}`);
    ok(await A.ev(`(() => { const t = ${q('#tool .ag-tools')}.innerText; return !/undefined|·\\s*·|·\\s*$/m.test(t); })()`), `agent ${i + 1}: every tool it can use has a name`);
    await tabTo('Settings');
    ok(await A.until(`${q('#tool .ag-ins')} && !${q('#tool .ag-ins')}.placeholder.includes('undefined')`), `agent ${i + 1}: an example for standing instructions`);
    await back();
    await A.until(`document.querySelectorAll('#tool .ag-card').length === 4`);
  }

  await card(1);
  await A.until(`!!${q('#tool .ag-prof-h')}`);
  await tabTo('Settings');
  ok(await A.until(`${q('#tool .ag-job')}?.value.includes('no lead, customer, proposal')`), 'Settings shows the job it works from');
  await shot('job');
  await A.ev(`(() => { const t = ${q('#tool .ag-job')}; t.focus(); t.select(); return true; })()`);
  await A.type('You chase every estimate after three days. Short, friendly, never pushy.');
  await A.ev(`document.querySelectorAll('#tool .ag-level')[1].click()`);
  ok(await A.until(`${q('#tool .ag-level.on b')}?.textContent === 'Prepare' && ${q('#tool .ag-job')}.value.startsWith('You chase every estimate')`), 'what’s typed outlives a redraw');
  await A.ev(`${q('#tool .ag-job-save')}.click()`);
  ok(await A.until(`!!${q('#tool .ag-job-reset')}`) && (await api('GET', '/agents')).agents.sales.job.text.startsWith('You chase every estimate'), 'Save job saves it');
  await tabTo('Overview');
  ok(await A.until(`${q('#tool .ag-job-said')}?.textContent.startsWith('You chase every estimate') && !${q('#tool .ag-duties')}`), 'Overview shows the job as written');
  await back();
  ok(await A.until(`${q('#tool .ag-edited')}?.textContent === 'Edited by you'`), 'the team page marks it edited');

  await card(1);
  await A.until(`!!${q('#tool .ag-prof-h')}`);
  await tabTo('Connections');
  ok(await A.until(`document.querySelectorAll('#tool .ag-conn').length === 16`), 'Connections lists them all');
  ok(await A.ev(`${q('[data-conn=email] .ag-mode.on')}.textContent === 'On' && !${q('[data-conn=email] [data-mode=read]')}`), 'Email has no Read: it can’t read an inbox');
  await shot('connections');
  const run = await api('POST', '/agents/runs', { agent: 'sales', ask: 'draft an email to Pat' });
  for (let i = 0; i < 80 && (await api('GET', '/agents/runs/' + run.id)).status !== 'awaiting'; i++) await sleep(100);
  await A.until(`${q('#tool .ag-state')}?.textContent === '1 to approve'`); // the page has caught up, so a tap lands on what stays
  await sleep(300);
  await A.tap(q('[data-conn=email] [data-mode=off]'));
  ok(await A.until(`${q('[data-conn=email] .ag-mode.on')}?.dataset.mode === 'off'`) && !(await api('GET', '/agents')).agents.sales.tools.some((x) => x.key === 'draft_email'), 'Email off: saved, and its tools go');
  await tabTo('Work');
  await A.until(`!!${q('#tool .ag-run-row')}`);
  await A.ev(`${q('#tool .ag-run-row')}.click()`);
  ok(await A.until(`!!${q('#tool .ag-step.email')}`, 8000), 'the draft from before is still there');
  await A.ev(`[...document.querySelectorAll('#tool .ag-step.email button')].find((b) => b.textContent === 'Send').click()`);
  ok(await A.until(`${q('#tool .ag-stopped')}?.textContent.includes('Email')`), 'sending it says the connection is off');
  ok(await A.ev(`[...document.querySelectorAll('#tool .ag-step.email button')].some((b) => b.textContent === 'Send' && !b.disabled)`) && (await api('GET', '/agents/runs/' + run.id)).status === 'awaiting', 'and the draft waits, ready for when it’s back on');
  await shot('stopped');
  await back();
  await A.until(`!!${q('#tool .ag-prof-h')}`);
  await tabTo('Connections');
  await A.until(`!!${q('#tool .ag-conn-reset')}`);
  await A.ev(`${q('#tool .ag-conn-reset')}.click()`);
  ok(await A.until(`${q('[data-conn=email] .ag-mode.on')}?.dataset.mode === 'act' && !${q('#tool .ag-conn-reset')}`), 'Reset connections puts them back');

  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  ok(await A.ev(`(() => { const t = ${q('#tool')}; return t.scrollWidth <= t.clientWidth + 1 && [...t.querySelectorAll('.ag-mode')].every((b) => { const r = b.getBoundingClientRect(); return r.right <= 376 && r.height >= 43; }); })()`), 'on a phone the choices fit, big enough to tap');
  await shot('connections-phone');
  await A.tap(q('[data-conn=tasks] [data-mode=read]'));
  ok(await A.until(`${q('[data-conn=tasks] .ag-mode.on')}?.dataset.mode === 'read'`), 'and tapping one works');
  await tabTo('Settings');
  await A.until(`!!${q('#tool .ag-job-reset')}`);
  await shot('job-phone');
  await A.tap(q('#tool .ag-job-reset'));
  ok(await A.until(`${q('#sheet h2')}?.textContent.includes('Reset to the original job')`), 'Reset asks first');
  await A.ev(`[...document.querySelectorAll('#sheet .btns button')].pop().click()`);
  ok(await A.until(`${q('#tool .ag-job')}?.value.includes('no lead, customer, proposal') && !${q('#tool .ag-job-reset')}`), 'and puts the original back');
  ok(!A.errors.length, 'no page errors ' + A.errors.slice(0, 3).join(' | '));
} catch (e) {
  console.log('FAIL threw: ' + e.stack);
  fails++;
}
A?.close();
chrome.kill();
srv.kill();
ai.close();
console.log(fails ? `${fails} FAILED` : 'All passed');
process.exit(fails ? 1 : 0);
