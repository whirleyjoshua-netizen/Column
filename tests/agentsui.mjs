import * as FS from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
// Your team, in the browser: the Agents tab, asking the team, watching the steps land, opening what changed,
// undoing, a specialist's workflow with a drafted email to edit and send, levels and schedules, Home asking for a
// yes, and a phone-sized screen.
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/agentsui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4719, APP = `http://127.0.0.1:${PORT}/`, AI_PORT = 4718;
const SHOTS = process.env.SHOTS || '';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
FS.rmSync(`${S}/dk/chrome5`, { recursive: true, force: true }); // a fresh profile, never one a closing Chrome still holds
try { (await import('node:child_process')).execSync('pkill -f remote-debugging-port=9337'); await new Promise((r) => setTimeout(r, 500)); } catch {} // a Chrome left on this port from an earlier run
const chrome = launch(9337, 'chrome5');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9337) {
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





// A stand-in for Claude that follows a script per request: which tools to call on each turn, then a report.
const asked = [];
const text = (c) => (typeof c === 'string' ? c : (c || []).map((b) => b.text || (b.type === 'tool_result' ? b.content : '')).join(' '));
let today = '';
const SCRIPTS = {
  'plan my day': (n) => [
    [['look_at_day', {}], ['list_tasks', { which: 'overdue' }]],
    [['create_task', { text: 'Call the blind supplier about the Smith order', due: today, priority: 1, why: 'The Smith order is waiting on it' }], ['schedule_time', { text: 'Finish the Jones proposal', date: today, start: '9:00am', end: '10:30am', why: 'Your only open morning block' }]],
    'Here’s your day:\n- 9:00 to 10:30: finish the Jones proposal\n- Then call the blind supplier about the Smith order\nNothing else is overdue.',
  ][n],
  'new lead': (n) => [
    [['save_contact', { name: 'Maria Lopez', email: 'maria@lopez.test', company: 'Lopez Dental' }]],
    [['draft_email', { to_name: 'Maria Lopez', to_email: 'maria@lopez.test', subject: 'Your office window coverings', body: 'Hi Maria,\n\nThanks for reaching out. Could we visit Tuesday morning to measure?\n\nAda', why: 'She asked for a quote' }], ['create_task', { text: 'Follow up with Maria Lopez', due: today }]],
    'Maria is in Contacts, a reply is drafted for you, and the follow-up is set.',
  ][n],
  'prepare test': (n) => [[['create_task', { text: 'A proposed task' }]], 'One task proposed.'][n],
  'two proposals': (n) => [[['create_task', { text: 'Proposal one' }], ['create_task', { text: 'Proposal two' }]], 'Two proposed.'][n],
  'skip these': (n) => [[['create_task', { text: 'Skip me A' }], ['create_task', { text: 'Skip me B' }], ['create_task', { text: 'Skip me C' }]], 'Three proposed.'][n],
  'observe test': (n) => [[['create_task', { text: 'Only a suggestion' }]], 'I would add a task.'][n],
  'install checklist': (n) => [[['write_doc', { title: 'Garcia install checklist', text: '# Before\n- [ ] Confirm measurements' }]], 'Checklist written.'][n],
  'handoff test': (n) => [[['hand_off', { agent: 'ops', ask: 'Write the install checklist for Garcia' }]], 'Handed the checklist to Operations.'][n],
  'fail test': (n) => [[['create_record', { project: 'Nope', list: 'Jobs', values: { Name: 'x' } }]], 'That project does not exist.'][n],
  'slow test': (n) => [[['look_at_day', {}]], 'Slow done.'][n],
  'more please': (n) => [[['create_task', { text: 'Reply task from the follow-up' }]], 'Added the follow-up task.'][n],
  'answered': (n) => [[['create_task', { text: 'Task after the answer' }]], 'Done after your answer.'][n],
};
const ai = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    const sys = typeof j.system === 'string' ? j.system : JSON.stringify(j.system);
    const msgs = j.messages;
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user' && typeof m.content === 'string');
    asked.push({ sys, msgs: JSON.stringify(msgs), tools: (j.tools || []).map((t) => t.name) });
    const reply = (content, stop = 'end_turn') => res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    if (sys.includes('You coordinate four specialists') && text(msgs[0].content).includes('something vague') && !text(msgs[0].content).includes('They answered')) return reply([{ type: 'text', text: JSON.stringify({ question: 'Which customer do you mean?', parts: [] }) }]);
    if (sys.includes('You coordinate four specialists') && text(msgs[0].content).includes('They answered')) return reply([{ type: 'text', text: JSON.stringify({ summary: 'Chief handles it', parts: [{ agent: 'chief', ask: 'answered: the Garcia one' }], question: null }) }]);
    if (text(lastUser?.content).toLowerCase().includes('slow test') && msgs.length === 1) return setTimeout(() => reply([{ type: 'text', text: 'Slow done.' }]), 5000);
    if (sys.includes('You coordinate four specialists')) return reply([{ type: 'text', text: JSON.stringify({ summary: 'The Chief of Staff plans your day', parts: [{ agent: 'chief', ask: 'Plan my day today' }], question: null }) }]);
    const key = Object.keys(SCRIPTS).find((k) => text(lastUser?.content).toLowerCase().includes(k));
    // Turns since the last plain user message.
    const n = msgs.length - 1 - msgs.lastIndexOf(lastUser);
    const step = key ? SCRIPTS[key](Math.floor(n / 2), sys) : 'Done.';
    if (typeof step === 'string' || !step) return reply([{ type: 'text', text: step || 'Done.' }]);
    reply([{ type: 'text', text: 'Working on it.' }, ...step.map(([name, input], i) => ({ type: 'tool_use', id: `tu_${n}_${i}`, name, input }))], 'tool_use');
  });
});
await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, SKIP_SETUP: '1', PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}` }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
today = new Date().toLocaleDateString('en-CA');
const t = Date.now();
const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Premier ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
await api('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
const shot = async (A, n) => { if (!SHOTS) return; await sleep(600); const r = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(`${SHOTS}/${n}.png`, Buffer.from(r.result.data, 'base64')); };
let A;
try {
  A = await tab(APP);
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000); // the page is really there before the token goes in
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  await sleep(1200);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`), 'Ada is in');
  ok(await A.until(`[...document.querySelectorAll('#tabs button[data-tab]:not(.tab-sub)')].map((b) => b.textContent).join() === 'Home,Day,Chat,Agents,Workspace'`), 'Agents is on the tab bar');
  await A.click('#tabs [data-tab=agents]');
  ok(await A.until(`document.querySelector('#tool h2')?.textContent.includes('Your team') && document.querySelectorAll('#tool .ag-card').length === 4`), 'the Agents tab opens Your team, with four specialists');
  ok(await A.ev(`[...document.querySelectorAll('#tool .ag-card b')].map((b) => b.textContent).join('|') === 'Chief of Staff|Client & Sales Manager|Operations Manager|Marketing Manager'`), 'Chief of Staff, Client & Sales Manager, Operations Manager, Marketing Manager');
  ok(await A.ev(`[...document.querySelectorAll('#tool .ag-state')].every((x) => x.textContent === 'Ready') && !document.querySelector('#tool .ag-nokey')`), 'all ready, and the AI key is there');
  await shot(A, 'ag-team');

  // Ask the team
  await A.ev(`(() => { const t = document.querySelector('#tool .ag-ask'); t.value = 'Plan my day please'; t.dispatchEvent(new Event('input')); return true; })()`);
  await A.ev(`[...document.querySelectorAll('#tool .ag-box button')].find((b) => b.textContent === 'Ask your team').click()`);
  ok(await A.until(`!!document.querySelector('#tool .ag-run-h')`), 'asking opens the assignment');
  ok(await A.until(`document.querySelector('#tool .ag-run-h .ag-chip')?.textContent === 'Done'`, 10000), 'it finishes: Done');
  ok(await A.ev(`document.querySelector('#tool .ag-plan')?.textContent.includes('Chief of Staff plans your day')`), 'with the coordinator’s plan');
  ok(await A.ev(`[...document.querySelectorAll('#tool .ag-step.read')].length === 2 && document.querySelector('#tool .ag-report').textContent.includes('Jones proposal')`), 'the reads it did, and its report');
  const steps = await A.ev(`[...document.querySelectorAll('#tool .ag-step.act')].map((x) => x.textContent)`);
  ok(steps.length === 2 && steps[0].includes('Call the blind supplier') && steps[0].includes('The Smith order is waiting on it') && steps[0].includes('Undo'), 'each change with why, Open and Undo: ' + steps.join(' / '));
  await shot(A, 'ag-run');
  ok((await api('GET', '/state')).tasks.some((x) => x.text.startsWith('Call the blind supplier')), 'the task is really in Kloomie');
  await A.ev(`[...document.querySelector('#tool .ag-step.act').querySelectorAll('button')].find((b) => b.textContent === 'Undo').click()`);
  ok(await A.until(`document.querySelector('#tool .ag-step.act').classList.contains('s-undone')`), 'Undo crosses it out');
  ok(!(await api('GET', '/state')).tasks.some((x) => x.text.startsWith('Call the blind supplier')), 'and the task is gone');
  await A.ev(`[...document.querySelectorAll('#tool .ag-step.act')][1].querySelector('button.linkish').click()`);
  ok(await A.until(`!document.querySelector('#day').classList.contains('hidden') && document.querySelector('#tool').classList.contains('hidden')`), 'Open on the time block goes to the Day');
  ok(await A.until(`document.querySelector('#day').textContent.includes('Finish the Jones proposal')`), 'where the block is');

  // A specialist and a workflow with a pasted lead
  await A.click('#tabs [data-tab=agents]');
  await A.until(`!!document.querySelector('#tool .ag-back, #tool .ag-card')`);
  if (await A.ev(`!!document.querySelector('#tool .ag-run-h')`)) await A.ev(`document.querySelector('#tool .ag-back').click()`);
  await A.until(`document.querySelectorAll('#tool .ag-card').length === 4`);
  ok(await A.ev(`document.querySelector('#tool .ag-runs').textContent.includes('Plan my day please')`), 'recent activity lists the assignment');
  await A.ev(`[...document.querySelectorAll('#tool .ag-card')][1].click()`);
  ok(await A.until(`document.querySelector('#tool .ag-prof-h b')?.textContent === 'Client & Sales Manager'`), 'a specialist’s profile');
  ok(await A.ev(`[...document.querySelectorAll('#tool .ag-tabs button')].map((b) => b.textContent).join() === 'Overview,Work,Schedules,Settings' && document.querySelector('#tool .ag-tools').textContent.includes('Always asks you first')`), 'with overview (what it can use, and what it always asks first), work, schedules and settings');
  await shot(A, 'ag-profile');
  await A.ev(`[...document.querySelectorAll('#tool .ag-wfs .chip')].find((b) => b.textContent === 'Handle a new lead…').click()`);
  ok(await A.until(`!document.querySelector('#sheet').classList.contains('hidden') && document.querySelector('#sheet h2').textContent === 'Handle a new lead'`), 'a paste-in workflow asks for the email');
  await A.ev(`(() => { document.querySelector('#sheet textarea').value = 'From Maria Lopez: we need blinds for our dental office'; return true; })()`);
  await A.ev(`[...document.querySelectorAll('#sheet .btns button')].pop().click()`);
  ok(await A.until(`document.querySelector('#tool .ag-run-h .ag-chip')?.textContent === 'Needs your yes'`, 10000), 'the lead assignment waits for a yes: ' + await A.ev(`document.querySelector('#tool').innerText.slice(0, 900)`));
  ok(await A.ev(`!!document.querySelector('#tool .ag-step.email') && document.querySelector('#tool .ag-step.email textarea').value.includes('Tuesday morning')`), 'the drafted email is there to read and edit');
  await shot(A, 'ag-email');
  await A.ev(`(() => { const t = document.querySelector('#tool .ag-step.email textarea'); t.value = 'Hi Maria,\\n\\nWednesday at 10 works to measure.\\n\\nAda'; return true; })()`);
  await A.ev(`[...document.querySelectorAll('#tool .ag-step.email button')].find((b) => b.textContent === 'Send').click()`);
  ok(await A.until(`document.querySelector('#tool .ag-run-h .ag-chip')?.textContent === 'Done' && !document.querySelector('#tool .ag-step.email')`), 'Send: it goes, and the assignment is done');
  const sent = FS.readdirSync(DIR + '/outbox').map((f) => FS.readFileSync(DIR + '/outbox/' + f, 'utf8')).find((f) => f.includes('maria@lopez.test'));
  ok(sent && sent.includes('Wednesday at 10'), 'with Ada’s edit');

  // Settings and schedules
  await A.ev(`document.querySelector('#tool .ag-back').click()`);
  await A.until(`!!document.querySelector('#tool .ag-prof-h')`);
  await A.ev(`[...document.querySelectorAll('#tool .ag-tabs button')].find((b) => b.textContent === 'Settings').click()`);
  await A.until(`document.querySelectorAll('#tool .ag-level').length === 4`);
  ok(await A.ev(`document.querySelector('#tool .ag-level.on b').textContent.startsWith('Execute')`), 'it starts at Execute (recommended)');
  await A.ev(`document.querySelectorAll('#tool .ag-level')[1].click()`);
  ok(await A.until(`document.querySelector('#tool .ag-level.on b')?.textContent === 'Prepare'`), 'switch to Prepare');
  ok((await api('GET', '/agents')).agents.sales.level === 'prepare', 'saved');
  await A.ev(`[...document.querySelectorAll('#tool .ag-tabs button')].find((b) => b.textContent === 'Schedules').click()`);
  ok(await A.until(`document.querySelector('#tool .ag-note')?.textContent.includes('only run at Automate')`), 'schedules say they need Automate');
  await A.ev(`document.querySelector('#tool .ag-sched input[type=checkbox]').click()`);
  await sleep(400);
  const sch = (await api('GET', '/agents')).agents.sales.schedules;
  ok(sch.length === 1 && sch[0].workflow === 'radar' && sch[0].days.join() === '1,3,5', 'turning one on uses its usual days: ' + JSON.stringify(sch));
  await A.ev(`[...document.querySelectorAll('#tool .ag-note button')].find((b) => b.textContent === 'Switch to Automate').click()`);
  ok(await A.until(`!document.querySelector('#tool .ag-note')`) && (await api('GET', '/agents')).agents.sales.level === 'automate', 'Switch to Automate');
  await shot(A, 'ag-schedules');

  // Home asks for a yes
  await api('PATCH', '/agents/chief', { level: 'prepare' });
  const pr = await api('POST', '/agents/runs', { agent: 'chief', ask: 'prepare test' });
  for (let i = 0; i < 50; i++) { if ((await api('GET', '/agents/runs/' + pr.id)).status === 'awaiting') break; await sleep(100); }
  await A.ev(`document.querySelector('#tool [aria-label=Close]').click()`);
  await A.click('#tabs [data-tab=home]');
  ok(await A.until(`[...document.querySelectorAll('#home .need-row')].some((r) => r.textContent.includes('Chief of Staff needs your yes'))`), 'Home: the Chief of Staff needs your yes');
  await A.ev(`[...document.querySelectorAll('#home .need-row')].find((r) => r.textContent.includes('needs your yes')).click()`);
  ok(await A.until(`[...document.querySelectorAll('#tool .ag-step.act button')].some((b) => b.textContent === 'Approve')`), 'which opens the assignment with Approve');
  await A.ev(`[...document.querySelectorAll('#tool .ag-step.act button')].find((b) => b.textContent === 'Approve').click()`);
  ok(await A.until(`document.querySelector('#tool .ag-run-h .ag-chip')?.textContent === 'Done'`), 'approved: done');
  ok((await api('GET', '/state')).tasks.some((x) => x.text === 'A proposed task'), 'and the task is made');

  // ----- More of the screen: Approve all, Skip all, Skip, Observe, hand-off, failures, Stop, reply, question, delete -----
  const openRun = async (id, title) => {
    if (!(await A.ev(`!document.querySelector('#tool').classList.contains('hidden') && document.querySelector('#tool h2')?.textContent.includes('Your team')`))) await A.click('#tabs [data-tab=agents]');
    await sleep(200);
    for (let i = 0; i < 3 && await A.ev(`!!document.querySelector('#tool .ag-back')`); i++) { await A.ev(`document.querySelector('#tool .ag-back').click()`); await sleep(150); }
    await A.until(`[...document.querySelectorAll('#tool .ag-run-row')].some((r) => r.textContent.includes(${JSON.stringify(title)}))`);
    await A.ev(`[...document.querySelectorAll('#tool .ag-run-row')].find((r) => r.textContent.includes(${JSON.stringify(title)})).click()`);
    return A.until(`document.querySelector('#tool .ag-run-h b')?.textContent === ${JSON.stringify(title)}`);
  };
  const startRun = async (agent, ask) => { const x = await api('POST', '/agents/runs', { agent, ask }); for (let i = 0; i < 80; i++) { const y = await api('GET', '/agents/runs/' + x.id); if (!['requested', 'planning', 'running'].includes(y.status)) break; await sleep(100); } return x.id; };
  await api('PATCH', '/agents/chief', { level: 'prepare' });
  await startRun('chief', 'two proposals');
  ok(await openRun(null, 'two proposals'), 'an assignment opens from recent activity');
  ok(await A.ev(`document.querySelector('#tool .ag-note')?.textContent.includes('2 changes waiting')`), 'two changes waiting, with Approve all');
  await A.ev(`[...document.querySelectorAll('#tool .ag-note button')].find((b) => b.textContent === 'Approve all').click()`);
  ok(await A.until(`document.querySelector('#tool .ag-run-h .ag-chip')?.textContent === 'Done'`), 'Approve all: done');
  let st = (await api('GET', '/state')).tasks;
  ok(st.some((x) => x.text === 'Proposal one') && st.some((x) => x.text === 'Proposal two'), 'and both tasks are made');
  await startRun('chief', 'skip these');
  await openRun(null, 'skip these');
  await A.ev(`[...document.querySelectorAll('#tool .ag-step.act')][0].querySelector('button:nth-of-type(2)').click()`);
  ok(await A.until(`document.querySelectorAll('#tool .ag-step.act.s-skipped').length === 1`), 'Skip one: crossed out');
  await A.ev(`[...document.querySelectorAll('#tool .ag-note button')].find((b) => b.textContent === 'Skip all').click()`);
  ok(await A.until(`document.querySelectorAll('#tool .ag-step.act.s-skipped').length === 3 && document.querySelector('#tool .ag-run-h .ag-chip')?.textContent === 'Done'`), 'Skip all skips the rest');
  ok(!(await api('GET', '/state')).tasks.some((x) => x.text.startsWith('Skip me')), 'and nothing is made');
  await api('PATCH', '/agents/chief', { level: 'observe' });
  await startRun('chief', 'observe test');
  await openRun(null, 'observe test');
  ok(await A.ev(`document.querySelector('#tool .ag-step.act.s-suggested')?.textContent.includes('Suggestion only (Observe)')`), 'at Observe a change shows as a suggestion');
  await api('PATCH', '/agents/chief', { level: 'execute' });
  await startRun('chief', 'handoff test');
  await sleep(500);
  await openRun(null, 'handoff test');
  ok(await A.until(`document.querySelector('#tool .ag-step.handoff')?.textContent.includes('Handed to the Operations Manager') && [...document.querySelectorAll('#tool .ag-part-h')].some((p) => p.textContent.includes('from the Chief of Staff'))`), 'a hand-off shows, with the Operations part “from the Chief of Staff”');
  await A.ev(`[...document.querySelectorAll('#tool .ag-step.act')].find((s) => s.textContent.includes('Garcia install checklist')).querySelector('button.linkish').click()`);
  ok(await A.until(`!document.querySelector('#docview')?.classList.contains('hidden') && document.querySelector('#docview')?.textContent.includes('Garcia install checklist')`), 'Open on the doc opens the doc');
  await A.ev(`(() => { const b = document.querySelector('#docview .dv-bar button'); b && b.click(); return true; })()`);
  await sleep(300);
  await startRun('sales', 'fail test');
  await openRun(null, 'fail test');
  ok(await A.ev(`!!document.querySelector('#tool .ag-step.act.s-failed .ag-err')?.textContent.includes('No project called Nope')`), 'a failed step shows why');
  // Open on a task and on a contact
  await openRun(null, 'Handle a new lead');
  await A.ev(`[...document.querySelectorAll('#tool .ag-step.act')].find((s) => s.textContent.includes('Follow up with Maria')).querySelector('button.linkish').click()`);
  ok(await A.until(`!document.querySelector('#day').classList.contains('hidden') && document.querySelector('#day').textContent.includes('Follow up with Maria Lopez')`), 'Open on a task goes to it in the Day');
  await openRun(null, 'Handle a new lead');
  await A.ev(`[...document.querySelectorAll('#tool .ag-step.act')].find((s) => s.textContent.includes('Contact: Maria')).querySelector('button.linkish').click()`);
  ok(await A.until(`document.querySelector('#tool h2')?.textContent.includes('Contacts') && document.querySelector('#tool').textContent.includes('Maria Lopez')`), 'Open on a contact opens Contacts');
  // Reply
  await openRun(null, 'Plan my day please');
  await A.ev(`(() => { const t = [...document.querySelectorAll('#tool .ag-box textarea')].pop(); t.value = 'more please'; return true; })()`);
  await A.ev(`[...document.querySelectorAll('#tool .ag-box button')].pop().click()`);
  ok(await A.until(`[...document.querySelectorAll('#tool .ag-part-h')].some((p) => p.textContent.includes('You asked: more please')) && document.querySelector('#tool .ag-run-h .ag-chip')?.textContent === 'Done'`, 8000), 'a reply carries the assignment on, shown as “You asked”');
  ok(await A.ev(`document.querySelector('#tool').textContent.includes('Reply task from the follow-up')`), 'with what it did next');
  // The coordinator's question, and answering it
  await A.ev(`document.querySelector('#tool .ag-back').click()`);
  await A.until(`!!document.querySelector('#tool .ag-ask')`);
  await A.ev(`(() => { const t = document.querySelector('#tool .ag-ask'); t.value = 'something vague'; t.dispatchEvent(new Event('input')); return true; })()`);
  await A.ev(`[...document.querySelectorAll('#tool .ag-box button')].find((b) => b.textContent === 'Ask your team').click()`);
  ok(await A.until(`document.querySelector('#tool .ag-q')?.textContent.includes('Which customer do you mean?') && document.querySelector('#tool .ag-run-h .ag-chip')?.textContent === 'Has a question'`, 8000), 'the coordinator’s question shows');
  await A.ev(`(() => { const t = [...document.querySelectorAll('#tool .ag-box textarea')].pop(); t.value = 'the Garcia one'; return true; })()`);
  ok(await A.ev(`[...document.querySelectorAll('#tool .ag-box button')].pop().textContent === 'Answer'`), 'with an Answer box');
  await A.ev(`[...document.querySelectorAll('#tool .ag-box button')].pop().click()`);
  ok(await A.until(`document.querySelector('#tool .ag-run-h .ag-chip')?.textContent === 'Done' && document.querySelector('#tool').textContent.includes('Task after the answer')`, 8000), 'answering it runs the request');
  // Stop
  await A.ev(`document.querySelector('#tool .ag-back').click()`);
  await A.until(`!!document.querySelector('#tool .ag-ask')`);
  await A.ev(`(() => { const t = document.querySelector('#tool .ag-ask'); t.value = 'slow test'; t.dispatchEvent(new Event('input')); return true; })()`);
  await api('PATCH', '/agents/chief', { level: 'execute' });
  const slow = await api('POST', '/agents/runs', { agent: 'chief', ask: 'slow test' });
  await openRun(null, 'slow test');
  ok(await A.until(`!!document.querySelector('#tool .ag-working')`), 'while working: a spinner and Stop');
  await A.ev(`[...document.querySelectorAll('#tool .ag-working button')].find((b) => b.textContent === 'Stop').click()`);
  ok(await A.until(`document.querySelector('#tool .ag-run-h .ag-chip')?.textContent === 'Stopped'`, 8000), 'Stop stops it');
  // Delete from the ⋯ menu, before its last model call has come back
  await A.ev(`document.querySelector('#tool [aria-label="Assignment options"]').click()`);
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Delete this assignment').click()`);
  ok(await A.ev(`!!document.querySelector('#menu:not(.hidden)')`), 'Delete asks for a second tap first');
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => /Delete this assignment|Sure|Tap again|Confirm/i.test(b.textContent)).click()`);
  ok(await A.until(`!!document.querySelector('#tool .ag-cards') && ![...document.querySelectorAll('#tool .ag-run-row')].some((r) => r.textContent.includes('slow test'))`), 'Delete from the ⋯ menu removes it');
  await sleep(1500);
  ok(await A.ev(`!!document.querySelector('#tool .ag-cards') && ![...document.querySelectorAll('#tool .ag-run-row')].some((r) => r.textContent.includes('slow test'))`) && (await api('GET', '/agents/runs/' + slow.id)).error, 'and it stays gone');
  // Instructions, pause, days and time
  await A.ev(`[...document.querySelectorAll('#tool .ag-card')][2].click()`);
  await A.until(`document.querySelector('#tool .ag-prof-h b')?.textContent === 'Operations Manager'`);
  await A.ev(`[...document.querySelectorAll('#tool .ag-tabs button')].find((b) => b.textContent === 'Settings').click()`);
  await A.ev(`(() => { const t = document.querySelector('#tool .ag-tab-body textarea'); t.value = 'Order fabric 10 days ahead.'; return true; })()`);
  await A.ev(`[...document.querySelectorAll('#tool .ag-tab-body button')].find((b) => b.textContent === 'Save instructions').click()`);
  await sleep(400);
  ok((await api('GET', '/agents')).agents.ops.instructions === 'Order fabric 10 days ahead.', 'standing instructions save');
  await A.ev(`[...document.querySelectorAll('#tool .ag-tabs button')].find((b) => b.textContent === 'Schedules').click()`);
  await A.until(`!!document.querySelector('#tool .ag-sched')`);
  await A.ev(`[...document.querySelectorAll('#tool .ag-sched')].find((s) => s.textContent.includes('Project health check')).querySelector('input[type=checkbox]').click()`);
  await A.until(`[...document.querySelectorAll('#tool .ag-sched.on')].some((s) => s.textContent.includes('Project health check'))`);
  await A.ev(`[...document.querySelectorAll('#tool .ag-sched.on')][0].querySelectorAll('.ag-day')[3].click()`);
  await sleep(400);
  await A.ev(`(() => { const t = document.querySelector('#tool .ag-sched.on input[type=time]'); t.value = '06:45'; t.dispatchEvent(new Event('change')); return true; })()`);
  await sleep(400);
  await A.ev(`document.querySelector('#tool .ag-pause input').click()`);
  await sleep(400);
  const ops = (await api('GET', '/agents')).agents.ops;
  ok(ops.schedules[0]?.workflow === 'health' && ops.schedules[0].days.join() === '1,3' && ops.schedules[0].at === 405, 'schedule days and time change: ' + JSON.stringify(ops.schedules));
  ok(ops.paused === true, 'and Pause pauses its schedules');
  // A notification opens the assignment
  await api('PATCH', '/agents/chief', { level: 'prepare' });
  await startRun('chief', 'two proposals');
  await sleep(500);
  await A.ev(`document.querySelector('#tool [aria-label=Close]').click()`);
  await A.click('#bellBtn');
  await A.until(`[...document.querySelectorAll('#bellPop .bell-row')].some((r) => r.textContent.includes('to approve'))`);
  await A.ev(`[...document.querySelectorAll('#bellPop .bell-row')].find((r) => r.textContent.includes('to approve')).click()`);
  ok(await A.until(`document.querySelector('#tool .ag-run-h b')?.textContent === 'two proposals'`), 'the notification opens the assignment');
  await A.ev(`document.querySelector('#tool [aria-label=Close]').click()`);
  // Agents is always in the toolbar now (2026-11-14), whatever tabs someone had saved before.
  await api('PUT', '/account/bar', { bar: ['column', 'chat'] });
  await A.ev(`location.reload()`).catch(() => {});
  await sleep(1500);
  await A.until(`!document.querySelector('#app').classList.contains('hidden')`);
  await sleep(500);
  ok(await A.ev(`!!document.querySelector('#tabs [data-tab=agents]')`), 'Agents stays in the toolbar even with old saved tabs');
  await A.click('#tabs [data-tab=agents]');
  ok(await A.until(`document.querySelectorAll('#tool .ag-card').length === 4`), 'and opens from there');
  await A.ev(`document.querySelector('#tool [aria-label=Close]').click()`);
  // No AI key
  await api('DELETE', '/ai/keys/anthropic');
  await api('PUT', '/account/bar', { bar: null });
  await A.ev(`location.reload()`).catch(() => {});
  await sleep(1500);
  await A.until(`!document.querySelector('#app').classList.contains('hidden')`);
  await sleep(500);
  await A.click('#tabs [data-tab=agents]');
  ok(await A.until(`!!document.querySelector('#tool .ag-nokey') && [...document.querySelectorAll('#tool .ag-box button')].find((b) => b.textContent === 'Ask your team').disabled`), 'without an AI key: a banner to add one, and asking is off');
  await A.ev(`document.querySelector('#tool .ag-nokey button').click()`);
  ok(await A.until(`!document.querySelector('#settings').classList.contains('hidden')`), 'the banner opens Settings');
  await A.ev(`document.querySelector('#settings').classList.add('hidden')`);
  await api('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  // Switched off for the team
  await api('PATCH', '/workspace', { tools: { agents: false } });
  ok(await A.until(`!document.querySelector('#tabs [data-tab=agents]') && document.querySelector('#tool').classList.contains('hidden')`), 'switched off for the team: the tab goes and the drawer closes');
  await api('PATCH', '/workspace', { tools: { agents: true } });
  ok(await A.until(`!!document.querySelector('#tabs [data-tab=agents]')`), 'and comes back when switched on');

  // Phone
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 2, mobile: true });
  await A.click('#tabs [data-tab=agents]');
  await A.until(`document.querySelectorAll('#tool .ag-card').length === 4`);
  await sleep(300);
  ok(await A.ev(`document.documentElement.scrollWidth <= innerWidth && document.querySelector('#tool').scrollWidth <= document.querySelector('#tool').clientWidth + 1`), 'nothing runs off the side on a phone');
  await shot(A, 'ag-phone');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
A?.close();
chrome.kill();
srv.kill();
ai.close();
if (fails) console.log(srv.log.split('\n').slice(-20).join('\n'));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
