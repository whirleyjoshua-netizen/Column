import * as FS from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
// Building your own agent in the browser (2026-11-22): Build your own, describe it, ✨ Draft it fills the form (name,
// icon, job, connections, workflows), change a connection, Save; it's among Your own agents and its profile shows its job;
// a 🧪 Test run holds its change as a draft; its settings rename it and delete it; members' switch; a phone-sized screen.
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/agent_build_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5443, APP = `http://127.0.0.1:${PORT}/`, AI_PORT = 5442, CDP = 9611;
const SHOTS = process.env.SHOTS || '';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(CDP, 'agent_build_chrome');
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
const DRAFT = { name: 'Estimate Checker', icon: '📐', job: 'You check every estimate before it goes out.', connections: { tasks: 'act', jobs: 'read' }, workflows: [{ name: 'Check this week', ask: 'Check every estimate made this week.' }] };
const ai = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    const sys = typeof j.system === 'string' ? j.system : (j.system || []).map((s) => s.text).join(' ');
    const content = sys.includes('build an AI agent') ? [{ type: 'text', text: JSON.stringify(DRAFT) }]
      : j.messages.length === 1 && JSON.stringify(j.messages).includes('make a fix task') ? [{ type: 'tool_use', id: 't1', name: 'create_task', input: { text: 'Fix the Lee estimate' } }] : [{ type: 'text', text: 'Done.' }];
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: content[0].type === 'tool_use' ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, SKIP_SETUP: '1', PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}` }, stdio: 'ignore' });
for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
let A;
try {
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Build ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  await api('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  await api('PATCH', '/workspace', { tools: { projects: true } });
  const shot = async (n) => { if (!SHOTS) return; await sleep(500); const r = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(`${SHOTS}/${n}.png`, Buffer.from(r.result.data, 'base64')); };
  const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
  const tabTo = (name) => A.ev(`[...document.querySelectorAll('#tool .ag-tabs button')].find((b) => b.textContent === '${name}').click()`);
  A = await tab(APP);
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  await sleep(1200);
  await A.until(`!${q('#app')}.classList.contains('hidden')`);
  await A.click('#tabs [data-tab=agents]');
  ok(await A.until(`document.querySelectorAll('#tool .ag-card').length === 4 && !!${q('#tool .ag-new')}`), 'Your team: the four specialists, and Build your own');
  ok(await A.ev(`[...document.querySelectorAll('#tool .ag-sec-h b')].some((b) => b.textContent === 'Your own agents')`), 'under “Your own agents”');
  await A.tap(q('#tool .ag-new'));
  ok(await A.until(`!!${q('#tool .ag-describe')} && document.querySelectorAll('#tool .ag-conn').length >= 10`), 'the builder: describe it, and every connection to pick from');
  ok(await A.ev(`[...document.querySelectorAll('#tool .ag-conn')].every((c) => c.querySelector('.ag-mode.on')?.dataset.mode === 'off')`), 'everything starts off');
  await A.tap(q('#tool .ag-describe'));
  await A.type('Check my estimates before they go out and make me tasks to fix them.');
  await shot('build-1');
  await A.tap(q('#tool .ag-draft'));
  ok(await A.until(`${q('#tool .ag-b-name')}?.value === 'Estimate Checker' && ${q('#tool .ag-b-job')}.value.startsWith('You check every estimate') && ${q('#tool .ag-b-icon')}.value === '📐'`), '✨ Draft it fills in its name, icon and job');
  ok(await A.ev(`${q('#tool [data-conn=tasks] .ag-mode.on')}.dataset.mode === 'act' && ${q('#tool [data-conn=jobs] .ag-mode.on')}.dataset.mode === 'read' && ${q('#tool [data-conn=money] .ag-mode.on')}.dataset.mode === 'off'`), 'and its connections');
  ok(await A.ev(`${q('#tool .ag-wf-name')}?.value === 'Check this week'`), 'and a workflow');
  ok(await A.ev(`${q('#tool .ag-describe')}.value.includes('Check my estimates')`), 'what was typed stays');
  await A.tap(q('#tool [data-conn=contacts] [data-mode=read]'));
  ok(await A.until(`${q('#tool [data-conn=contacts] .ag-mode.on')}?.dataset.mode === 'read' && ${q('#tool .ag-b-name')}.value === 'Estimate Checker'`), 'a connection changes, and the rest of the form stays');
  await shot('build-2');
  await A.tap(q('#tool .ag-b-save'));
  ok(await A.until(`${q('#tool .ag-prof-h b')}?.textContent === 'Estimate Checker' && ${q('#tool .ag-job-said')}?.textContent.startsWith('You check every estimate')`), 'Save: its page, with its job as written');
  ok(await A.ev(`!!${q('#tool .ag-test')} && [...document.querySelectorAll('#tool .ag-wfs .chip')].some((b) => b.textContent === 'Check this week')`), 'a 🧪 Test run button, and its workflow one tap away');
  const st = await api('GET', '/agents');
  const key = Object.keys(st.agents).find((k) => k.startsWith('my_'));
  ok(key && st.agents[key].connections.find((c) => c.key === 'contacts').mode === 'read', 'saved with the connection as picked');
  // A test run: its change waits as a draft.
  await A.tap(q('#tool .ag-ask'));
  await A.type('make a fix task');
  await A.tap(q('#tool .ag-test'));
  ok(await A.until(`[...document.querySelectorAll('#tool .ag-step')].some((s) => s.textContent.includes('Fix the Lee estimate'))`, 8000), 'a test run shows what it would do');
  const tasks = (await api('GET', '/state')).tasks;
  ok(!tasks.some((x) => x.text === 'Fix the Lee estimate'), 'and makes nothing until approved');
  await shot('build-3');
  ok(await A.ev(`!!${q('#tool .ag-test-note')}`), 'its page says it’s a test run');
  // Back on Your team (Back goes to the agent, then the team): among Your own agents.
  await A.ev(`${q('#tool .ag-back')}.click()`);
  await A.until(`!!${q('#tool .ag-tabs')}`);
  await A.ev(`${q('#tool .ag-back')}.click()`);
  ok(await A.until(`[...document.querySelectorAll('#tool .ag-mine .ag-card')].some((c) => c.textContent.includes('Estimate Checker') && c.textContent.includes('Built by you'))`), 'Your team lists it under Your own agents');
  ok(await A.ev(`document.querySelectorAll('#tool .ag-cards:not(.ag-mine) .ag-card').length === 4`), 'the specialists are still four');
  // Its settings: rename it.
  await A.tap(`[...document.querySelectorAll('#tool .ag-mine .ag-card')].find((c) => c.textContent.includes('Estimate Checker'))`);
  await A.until(`!!${q('#tool .ag-tabs')}`);
  await tabTo('Settings');
  ok(await A.until(`!!${q('#tool .ag-b-name')} && !${q('#tool .ag-job-reset')} && !!${q('#tool .ag-delete')}`), 'its settings: name, job, workflows, delete (no reset: it’s yours)');
  await A.ev(`(() => { const i = ${q('#tool .ag-b-name')}; i.value = 'Quote Checker'; i.dispatchEvent(new Event('input')); return true; })()`);
  await A.tap(q('#tool .ag-name-save'));
  ok(await A.until(`${q('#tool .ag-prof-h b')}?.textContent === 'Quote Checker'`), 'renamed');
  // A phone: nothing sideways in the builder.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await A.ev(`${q('#tool .ag-back')}.click()`);
  await A.until(`!!${q('#tool .ag-new')}`);
  await A.tap(q('#tool .ag-new'));
  await A.until(`!!${q('#tool .ag-describe')}`);
  await sleep(300);
  ok(await A.ev(`document.documentElement.scrollWidth <= innerWidth + 1 && ${q('#tool .ag-b-name')}.getBoundingClientRect().right <= innerWidth`), 'on a phone the builder fits, nothing sideways');
  await shot('build-phone');
  await A.cmd('Emulation.clearDeviceMetricsOverride');
  // Delete it.
  await A.ev(`${q('#tool .ag-back')}.click()`);
  await A.until(`!!${q('#tool .ag-mine .ag-card')}`);
  await A.tap(q('#tool .ag-mine .ag-card'));
  await A.until(`!!${q('#tool .ag-tabs')}`);
  await tabTo('Settings');
  await A.until(`!!${q('#tool .ag-delete')}`);
  await A.tap(q('#tool .ag-delete'));
  await A.until(`!!document.querySelector('#sheet .sheet')`);
  await A.ev(`[...document.querySelectorAll('#sheet button')].find((b) => b.textContent === 'Delete').click()`);
  ok(await A.until(`!!${q('#tool .ag-new')} && !document.querySelector('#tool .ag-mine .ag-card')`), 'Delete: gone from Your own agents');
  ok(!(await api('GET', '/agents')).agents[key], 'and from the server');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
A?.close();
chrome.kill();
srv.kill();
ai.close();
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
