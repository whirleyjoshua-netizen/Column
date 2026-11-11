import * as FS from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
// Sign-up and the guided setup. The sign-up screen asks only what it needs (the business's name, no device). A new
// owner gets the setup once: just me or a team, what kind of business (trades switch on Jobs, Map and Finance and
// start a Jobs project from the kinds of work they pick; software starts a development board), the AI key, the
// website read into Company HQ, the calendar; then a Get started list made for them (no invite step on their own,
// their first job). Skipping works. Someone who joins gets no setup, and a welcome list of their own.
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/setupui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4709, APP = `http://127.0.0.1:${PORT}/`, AI_PORT = 4708, SITE_PORT = 4707, SITE = `http://127.0.0.1:${SITE_PORT}`;
FS.rmSync(`${S}/dk/chrome7`, { recursive: true, force: true });
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
const chrome = launch(9339, 'chrome7');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9339) {
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






const page = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body><nav><a href="/about">About</a> <a href="/services">Services</a></nav><h1>${title}</h1>${body}</body></html>`;
const pages = {
  '/': page('Desert Shade Co', '<p>Custom blinds, shades and shutters for homes across the Las Vegas Valley. Free in-home measure. Family owned since 2015. We install every job ourselves and we never pressure anyone.</p>'),
  '/about': page('About', '<p>Maria started Desert Shade in 2015 after 10 years installing for big box stores. We treat every home like our own.</p>'),
  '/services': page('Services', '<ul><li>Motorized roller shades</li><li>Plantation shutters</li></ul><p>Lifetime workmanship warranty.</p>'),
};
const site = http.createServer((req, res) => { const p = pages[req.url]; if (!p) { res.writeHead(404); return res.end('nope'); } res.setHeader('content-type', 'text/html'); res.end(p); });
await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));
const ai = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    const sys = typeof j.system === 'string' ? j.system : JSON.stringify(j.system);
    let out = { text: 'ok' };
    if (sys.includes('pages from the business')) out = { entries: [
      { kind: 'about', title: '', text: 'Custom blinds, shades and shutters for homes across the Las Vegas Valley.', url: SITE + '/' },
      { kind: 'service', title: 'Motorized roller shades', text: '', url: SITE + '/services' },
      { kind: 'area', title: '', text: 'The Las Vegas Valley', url: SITE + '/' },
      { kind: 'different', title: 'We install every job ourselves', text: '', url: SITE + '/' },
    ], gaps: ['Pricing'] };
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', ALLOW_LOCAL_FETCH: '1', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}`, SKIP_SETUP: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
const t = Date.now();
const apiAs = (tok) => async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
let A;
const card = (sel) => `document.querySelector('#setupWrap .su-card ${sel || ''}')`;
const pick = (text) => A.ev(`(() => { const b = [...document.querySelectorAll('#setupWrap button')].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`);
const title = () => A.ev(`document.querySelector('#setupWrap h2')?.textContent`);
const signOut = async () => { await A.ev(`(() => { localStorage.clear(); location.href = '/'; return true; })()`).catch(() => {}); await sleep(1500); };
try {
  A = await tab(APP + '?start=1');
  // ----- The sign-up screen -----
  ok(await A.until(`document.querySelector('[data-mode=create]')?.classList.contains('on')`, 20000), 'the website’s Start free trial opens Create');
  ok(await A.ev(`document.querySelector('#deviceField').classList.contains('hidden') && document.querySelector('#teamField').firstChild.textContent === 'Business name' && document.querySelector('#loginBtn').textContent === 'Start free trial'`), 'it asks for the business’s name, no device, and says Start free trial');
  await A.ev(`(() => { const f = document.querySelector('#loginForm'); f.workspace.value = 'Desert Shade ${t}'; f.name.value = 'Maria Ruiz'; f.email.value = 'maria${t}@t.test'; f.password.value = 'longenough1'; f.requestSubmit(); return true; })()`);
  ok(await A.until(`!!document.querySelector('#setupWrap')`, 15000), 'a new owner gets the setup');
  ok((await title()).startsWith('Welcome to Kloomie, Maria'), 'Welcome to Kloomie, Maria');
  const tok = await A.ev(`JSON.parse(localStorage.getItem('column.token'))`);
  const api = apiAs(tok);
  ok((await api('GET', '/state')).me.device !== 'Device', 'this device got a name anyway: ' + (await api('GET', '/state')).me.device);
  // Just me
  await pick('Just me');
  ok(await A.until(`document.querySelector('#setupWrap h2')?.textContent === 'What kind of business?'`), 'what kind of business?');
  ok(await A.ev(`document.querySelectorAll('#setupWrap .su-opt').length === 5`), 'five kinds to pick from');
  await pick('Trades & field service');
  ok(await A.until(`document.querySelector('#setupWrap h2')?.textContent === 'What do you do?' && document.querySelectorAll('#setupWrap .pj-trade').length > 5`), 'trades pick what they do');
  await A.ev(`[...document.querySelectorAll('#setupWrap .pj-trade')].slice(0, 2).forEach((b) => b.click())`);
  await pick('Set up my Jobs');
  ok(await A.until(`document.querySelector('#setupWrap h2')?.textContent === 'Switch on your AI team'`, 10000), 'then the AI key');
  let st = await api('GET', '/state');
  ok(st.workspace.tools.projects && st.workspace.tools.map && st.workspace.tools.bills, 'trades switched on Jobs, Map and Finance');
  ok(st.projects.some((p) => p.template === 'trades' && p.types.length === 2), 'and started a Jobs project with the two kinds of work');
  ok(st.workspace.setup.solo === true && st.workspace.setup.kind === 'trades' && st.workspace.setup.pending, 'the answers are kept; setup isn’t finished yet');
  await A.ev(`(() => { const c = document.querySelector('#setupWrap'); c.querySelector('select').value = 'anthropic'; c.querySelector('input[type=password]').value = 'sk-ant-test-key-1234567890'; return true; })()`);
  await pick('Save and continue');
  ok(await A.until(`document.querySelector('#setupWrap h2')?.textContent === 'Tell Kloomie about your business'`, 10000), 'then the website');
  ok(Object.keys((await api('GET', '/ai')).keys).includes('anthropic'), 'the AI key is saved');
  await A.ev(`(() => { document.querySelector('#setupWrap input[type=url]').value = '${SITE}/'; return true; })()`);
  await pick('Read my site');
  ok(await A.until(`document.querySelector('#setupWrap h2')?.textContent === 'Here’s what Kloomie found'`, 15000), 'Kloomie reads the site');
  ok(await A.ev(`document.querySelector('#setupWrap').textContent.includes('found 4 things') && document.querySelector('#setupWrap').textContent.includes('Pricing')`), 'it says what it found, and what the site doesn’t say');
  await pick('Add 4 to my profile');
  ok(await A.until(`document.querySelector('#setupWrap h2')?.textContent === 'Bring in your calendar'`), 'then the calendar');
  ok((await api('GET', '/hq')).entries.filter((x) => x.status === 'approved').length >= 4, 'the profile has what was found in it');
  await pick('Finish');
  ok(await A.until(`!document.querySelector('#setupWrap')`), 'Finish closes it');
  st = await api('GET', '/state');
  ok(st.workspace.setup.pending === false, 'setup is done');
  const keys = st.start.map((x) => x.key + (x.done ? '✓' : ''));
  ok(!keys.some((k) => k.startsWith('invite')) && keys.includes('hq✓') && keys.includes('ai✓') && keys.some((k) => k.startsWith('job')), 'Get started is made for her: profile and AI done, her first job next, no invite step: ' + keys.join(' '));
  ok(await A.until(`[...document.querySelectorAll('#home .start-row')].some((r) => r.textContent.includes('Add your first job'))`), 'and Home shows it');
  await A.ev(`location.reload()`).catch(() => {});
  await sleep(2000);
  await A.until(`!document.querySelector('#app').classList.contains('hidden')`);
  await sleep(800);
  ok(await A.ev(`!document.querySelector('#setupWrap')`), 'setup doesn’t come back after a reload');
  const code = st.workspace.inviteCode;
  const team1 = st.workspace.name;

  // ----- A software team that skips the key and the site -----
  await signOut();
  await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = 'Atlas Apps ${t}'; f.name.value = 'Sam Lee'; f.email.value = 'sam${t}@t.test'; f.password.value = 'longenough1'; f.requestSubmit(); return true; })()`);
  ok(await A.until(`!!document.querySelector('#setupWrap')`, 15000), 'the next new owner gets it too');
  await pick('Me and my team');
  await A.until(`document.querySelector('#setupWrap h2')?.textContent === 'What kind of business?'`);
  await pick('Software or tech');
  ok(await A.until(`document.querySelector('#setupWrap h2')?.textContent === 'Switch on your AI team'`, 10000), 'software goes straight to the AI key');
  await pick('I’ll do this later');
  ok(await A.until(`document.querySelector('#setupWrap h2')?.textContent === 'Tell Kloomie about your business' && document.querySelector('#setupWrap .primary-btn').disabled`), 'without a key the site can’t be read yet, and it says so');
  await pick('Skip for now');
  await A.until(`document.querySelector('#setupWrap h2')?.textContent === 'Bring in your calendar'`);
  await pick('Finish');
  await A.until(`!document.querySelector('#setupWrap')`);
  const api2 = apiAs(await A.ev(`JSON.parse(localStorage.getItem('column.token'))`));
  st = await api2('GET', '/state');
  ok(st.projects.some((p) => p.template === 'tech'), 'a development board was started');
  const k2 = st.start.map((x) => x.key);
  ok(k2.includes('invite') && k2.includes('work') && !k2.includes('job') && st.start.find((x) => x.key === 'ai').done === false, 'their list has inviting the team, the first piece of work, and the AI key still to do: ' + k2.join(' '));

  // ----- Skip setup -----
  await signOut();
  await A.ev(`(() => { document.querySelector('[data-mode=create]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = 'Quick ${t}'; f.name.value = 'Kai'; f.email.value = 'kai${t}@t.test'; f.password.value = 'longenough1'; f.requestSubmit(); return true; })()`);
  await A.until(`!!document.querySelector('#setupWrap')`, 15000);
  await pick('Skip setup');
  ok(await A.until(`!document.querySelector('#setupWrap')`) && (await apiAs(await A.ev(`JSON.parse(localStorage.getItem('column.token'))`))('GET', '/state')).workspace.setup.pending === false, 'Skip setup skips it, for good');

  // ----- Someone who joins: no setup, a welcome of their own -----
  await signOut();
  await A.ev(`(() => { document.querySelector('[data-mode=join]').click(); const f = document.querySelector('#loginForm'); f.workspace.value = ${JSON.stringify(team1)}; f.code.value = ${JSON.stringify(code)}; f.name.value = 'Leo'; f.email.value = 'leo${t}@t.test'; f.password.value = 'longenough2'; f.requestSubmit(); return true; })()`);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`, 15000), 'Leo joins Maria’s team');
  await sleep(1200);
  ok(await A.ev(`!document.querySelector('#setupWrap')`), 'he doesn’t get the owner’s setup');
  ok(await A.until(`document.querySelector('#home .start')?.textContent.includes('Welcome to ' + ${JSON.stringify(team1)})`), 'he gets “Welcome to Desert Shade”');
  const lk = (await apiAs(await A.ev(`JSON.parse(localStorage.getItem('column.token'))`))('GET', '/state')).start.map((x) => x.key);
  ok(lk.join() === 'calendar,ai,agents', 'with his own steps: calendar, AI key, agents');
  // Phone width on the setup itself
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 2, mobile: true });
  await A.ev(`(() => { openSetup && 0; return true; })()`).catch(() => {});
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
A?.close();
chrome.kill();
srv.kill();
ai.close();
site.close();
if (fails) console.log(srv.log.split('\n').filter((l) => /error|fail/i.test(l)).slice(-10).join('\n'));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
