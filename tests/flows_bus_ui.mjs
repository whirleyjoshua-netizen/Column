// Flows step 1 in a real browser (headless Chrome): Settings → Automations draws "what sets it off" from the server's
// list, grouped by tool; a new one "when a job moves to a stage, in this project, to Won" is made in the editor with
// its filters; moving a job there posts in the feed; a recipe (Quote accepted) opens filled in; it fits a phone.
import { autoUI } from './autobuild.mjs';
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/flows_bus_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4894, CDP = 9507, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map();
  const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(120); } return false; };
  const tap = async (expr) => {
    await until(`!!(${expr})`, 8000);
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(150);
  };
  const type = async (s) => { for (const ch of s) { await cmd('Input.insertText', { text: ch }); await sleep(15); } };
  // Picks an option in a <select> the way a person does (the change event fires).
  const pick = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  return { ev, until, tap, type, pick, cmd, errors };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Flows ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const ws = (await api('GET', '/state')).workspace;
  await api('PATCH', '/workspace', { tools: { ...ws.tools, projects: true } });
  const p = await api('POST', '/projects', { template: 'crm', name: 'Sales' });
  const T = p.types[0];
  const stageF = T.fields.find((f) => f.key === 'stage') || T.fields.find((f) => f.type === 'select');
  const won = stageF.choices.find((c) => /won|customer/i.test(c.label)) || stageF.choices.at(-1);
  const rec = await api('POST', `/projects/${p.id}/records`, { typeId: T.id, values: { [T.primary]: 'Smith deal' } });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');
  // Automations moved out of Settings into Workspace (2026-11-14); Settings → Team points there.
  await A.ev(`document.querySelector('#settingsBtn').click(); true`);
  await A.until(`!document.querySelector('#settings').classList.contains('hidden')`);
  ok(!(await A.ev(`[...document.querySelectorAll('#settings [role=tab]')].some((b) => b.textContent.startsWith('Automations'))`)), 'Settings has no Automations tab any more');
  await A.ev(`document.querySelector('#settings .setx-item[data-page=teamset]').click(); true`);
  ok(await A.until(`document.querySelector('#settings .auto-moved')?.textContent.includes('Workspace')`), 'Settings → Team says Automations are in Workspace now');
  await A.ev(`document.querySelector('#settings .auto-moved .btn').click(); true`);
  ok(await A.until(`document.querySelector('#tool h2')?.textContent.startsWith('Automations') && document.querySelector('#settings').classList.contains('hidden')`), 'its Open button opens Workspace → Automations');
  ok(await A.ev(`!!document.querySelector('#workTabs [data-tab=automations].on')`), 'lit in Workspace’s tabs');
  await A.until(`!!document.querySelector('#tabs [data-tab=automations]')`, 10000); await A.ev(`document.querySelector('#tabs [data-tab=automations]').click(); true`); // in Workspace now (2026-11-14)
  ok(await A.until(`[...document.querySelectorAll('#tool .auto-recipe b')].some((b) => b.textContent === 'Quote accepted? Schedule it')`), 'Automations shows recipes from every tool (Quote accepted? Schedule it)');
  await A.tap(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent === '+ New automation')`);
  const B = autoUI(A);
  await A.tap(`document.querySelector('#sheet .ab-panel .ab-change')`);
  ok(await A.until(`document.querySelectorAll('.ap-pop .ap-chip').length >= 9`), 'what sets it off is grouped by tool (a chip each)');
  const groups = await A.ev(`[...document.querySelectorAll('.ap-pop .ap-chip')].map((g) => g.textContent).join(', ')`);
  ok(/Boards/.test(groups) && /Invoices & Finance/.test(groups) && /Map/.test(groups) && /Texts/.test(groups), `including ${groups}`);
  await A.tap(`document.querySelector('.ap-pop .ap-item[data-key="record.stage"]')`);
  await B.adv();
  ok(await A.until(`!!document.querySelector('#sheet .auto-proj')`), 'a record event asks which project (under Advanced settings)');
  ok(await A.ev(`document.querySelector('#sheet .auto-proj').closest('label').firstChild.textContent === 'In project'`), 'labeled In project (the campaign one says In campaign)');
  await A.pick(`document.querySelector('#sheet .auto-proj')`, p.id);
  ok(await A.until(`[...document.querySelectorAll('#sheet .auto-to option')].some((o) => o.value === ${JSON.stringify(won.label)})`), 'and which stage, from that project’s own stages');
  await A.pick(`document.querySelector('#sheet .auto-to')`, won.label);
  ok(await A.ev(`document.querySelector('#sheet').textContent.includes('{record}') && document.querySelector('#sheet').textContent.includes('{from}')`), 'it lists the words that fill in for this event');
  await A.tap(`document.querySelector('#sheet .auto-name')`);
  await A.type('Deal won');
  // The first action: post in #general.
  await B.step(B.act(0), 'post');
  await A.tap(`document.querySelector('#sheet .ab-body input')`);
  await A.type('{record} is {stage}!');
  await A.pick(`document.querySelector('#sheet .ab-body select')`, 'general');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Turn it on')`);
  ok(await A.until(`[...document.querySelectorAll('#tool .auto-row b')].some((b) => b.textContent === 'Deal won') && [...document.querySelectorAll('#tool .auto-row small')].some((s) => s.textContent.includes('in Sales') && s.textContent.includes('to ' + ${JSON.stringify(won.label)}))`), 'it’s on, summed up with its project and stage');
  await api('PATCH', `/records/${rec.id}`, { values: { [stageF.id]: won.id } });
  const posted = async () => (await api('GET', '/state')).items.some((x) => x.type === 'message' && !x.channelId && x.text === `Smith deal is ${won.label}!`);
  let hit = false;
  for (let i = 0; i < 30 && !hit; i++) { hit = await posted(); if (!hit) await sleep(200); }
  ok(hit, `moving the deal to ${won.label} posts it in #general`);
  ok(await A.until(`[...document.querySelectorAll('#tool .auto-row small')].some((s) => s.textContent.startsWith('Ran'))`), 'and the automation says it ran');

  // A recipe opens filled in.
  await A.tap(`[...document.querySelectorAll('#tool .auto-recipe')].find((b) => b.textContent.includes('Quote accepted'))`);
  ok(await A.until(`/quote/i.test(document.querySelector('#sheet .auto-trigger .an-say')?.textContent || '') && [...document.querySelectorAll('#sheet .auto-act .an-say')].some((i) => i.textContent.includes('{customer}'))`), 'the Quote accepted recipe opens filled in');
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  ok(await A.ev(`document.documentElement.scrollWidth <= 392 && document.querySelector('#sheet .sheet').getBoundingClientRect().right <= 391`), 'the editor fits a phone');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors.join(' | ').slice(0, 300) : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  chrome.kill('SIGKILL');
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
