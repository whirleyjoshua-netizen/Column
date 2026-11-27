// One page to make a campaign (the owner, 2026-11-27: "i dont like the campaign onboarding process. i think it should be
// a simple one page fill in"). + New asks what you're making: a Checklist (a name, its tasks one per line, who and
// when, maybe a job) or a Campaign (what it is and its steps on one page; the rest under More options). No stages.
import { CHROME, SERVER_DIR } from './chromebin.mjs';
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/cccreate';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5493, APP = `http://127.0.0.1:${PORT}/`, CDP = 9762;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-cccreate`, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-cccreate`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
const srv = spawn('node', ['index.js'], { cwd: SERVER_DIR, env: { ...process.env, SKIP_SETUP: '1', PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
async function tab(url) {
  let t;
  for (let i = 0; i < 50 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.on('open', r));
  let n = 0; const wait = new Map(); const errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await cmd('Runtime.enable');
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result?.result?.value; };
  const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const mouse = async (type, x, y) => cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' || type === 'mouseMoved' ? 1 : 0, clickCount: 1 });
  const at = (expr) => ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  return { ev, until, mouse, at, cmd, errors, close: () => ws.close() };
}
let A;
const Q = (sel) => `document.querySelector('#sheet ${sel}')`;
const typeIn = (sel, v) => `(() => { const e = document.querySelector('#sheet ${sel}'); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Make ' + t, name: 'Joshua', email: `j${t}@t.test`, password: 'pw-123456' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  const me = (await api('GET', '/state')).me.memberId;
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=camps]')`, 15000);
  await A.ev(`document.querySelector('[data-tab=camps]').click(); true`);
  const plusNew = `[...document.querySelectorAll('#camps .camp-h button')].find((b) => b.textContent.includes('New'))`;
  await A.until(`!!${plusNew}`);

  // ---- + New: what are you making? ----
  await A.ev(`${plusNew}.click(); true`);
  ok(await A.until(`!!${Q('.cb-kinds')}`), '+ New asks what you’re making');
  ok(JSON.stringify(await A.ev(`[...document.querySelectorAll('#sheet .cb-kind b')].map((x) => x.textContent)`)) === JSON.stringify(['Checklist', 'Campaign']), 'a Checklist or a Campaign');
  ok(!(await A.ev(`!!${Q('.cb-stages')}`)) && !(await A.ev(`!!${Q('.cb-stage-nav')}`)), 'one page: no stages, no Next');

  // ---- a Checklist ----
  await A.ev(`${Q('.cb-kind[data-kind=checklist]')}.click(); true`);
  ok(await A.until(`!!${Q('.cb-cl-tasks')}`), 'a Checklist: its tasks, one per line');
  ok(!(await A.ev(`!!${Q('.cb-steps')}`)) && !(await A.ev(`[...document.querySelectorAll('#sheet .cb-sec h3')].some((x) => x.textContent === 'What gets logged')`)), 'and none of a campaign’s parts');
  ok(await A.ev(`/Make the checklist/.test(document.querySelector('#sheet .btns .primary-btn').textContent)`), 'its button says Make the checklist');
  await A.ev(typeIn('.cb-name', 'Lee house: A/C repair'));
  await A.ev(typeIn('.cb-cl-tasks', 'Check the filter\nReplace the capacitor\n\n  Test cooling  '));
  await A.ev(typeIn('.cb-cl-due', '2030-05-01'));
  await A.ev(`document.querySelector('#sheet .btns .primary-btn').click(); true`);
  ok(await A.until(`!document.querySelector('#sheet .camp-builder')`, 8000), 'made');
  let st = await api('GET', '/state');
  const cl = st.campaigns.find((x) => x.name === 'Lee house: A/C repair');
  ok(cl?.type === 'checklist', 'it’s a checklist');
  const clGoals = st.goals.filter((g) => g.campaignId === cl?.id);
  const clTasks = st.tasks.filter((x) => clGoals.some((g) => g.id === x.goalId));
  ok(clGoals.length === 1, 'with one list of tasks');
  ok(JSON.stringify(clTasks.map((x) => x.text).sort()) === JSON.stringify(['Check the filter', 'Replace the capacitor', 'Test cooling']), 'its tasks, blank lines left out: ' + JSON.stringify(clTasks.map((x) => x.text)));
  ok(clTasks.every((x) => x.assigneeId === me && x.due === '2030-05-01'), 'each for whoever it’s for (you, unless you pick), due that day');
  ok(!cl.channelId && !cl.stackId, 'with no feed or stack of its own (2026-11-27)');
  ok(await A.until(`!!document.querySelector('#camps .cc-name')`) && !(await A.ev(`[...document.querySelectorAll('#camps button')].some((b) => /^(Files|Notes) ·/.test(b.textContent))`)), 'its page has no Files or Notes');
  await A.ev(`document.querySelector('#camps .cc-edit')?.click(); true`);
  ok(await A.until(`!!document.querySelector('#camps .cc-planner')`), 'and it opens to edit like any campaign');
  await A.ev(`document.querySelector('#camps .cc-back')?.click(); true`);
  ok(await A.until(`[...document.querySelectorAll('.camp-card')].some((x) => x.textContent.includes('Lee house') && !!x.querySelector('.cc-kind'))`), 'the list marks it a Checklist');

  // ---- a Campaign ----
  await A.ev(`${plusNew}.click(); true`);
  await A.until(`!!${Q('.cb-kinds')}`);
  await A.ev(`${Q('.cb-kind[data-kind=campaign]')}.click(); true`);
  ok(await A.until(`!!${Q('.cb-steps')} && !!${Q('.cb-name')}`), 'a Campaign: what it is and its steps');
  const shown = await A.ev(`[...document.querySelectorAll('#sheet .cb-main > .cb-sec h3')].filter((x) => x.offsetParent).map((x) => x.textContent)`);
  ok(shown.includes('What it is') && shown.includes('Steps'), 'on the page: ' + JSON.stringify(shown));
  ok(await A.ev(`!!${Q('details.cb-more')} && !${Q('details.cb-more')}.open`), 'the rest under More options, closed');
  ok(await A.ev(`['What it’s for', 'Who’s on it', 'What gets logged', 'Money'].every((x) => [...document.querySelectorAll('#sheet details.cb-more .cb-sec h3')].some((h) => h.textContent === x))`), 'More options: the job, people, logging, money');
  ok(await A.ev(`/Make the campaign/.test(document.querySelector('#sheet .btns .primary-btn').textContent)`), 'its button says Make the campaign');
  await A.ev(typeIn('.cb-name', 'Spring tune-ups'));
  await A.ev(`${Q('.cb-add-step')}.click(); true`);
  await A.ev(typeIn('.cb-step input', 'Tell past customers'));
  await A.ev(`document.querySelector('#sheet .btns .primary-btn').click(); true`);
  ok(await A.until(`!document.querySelector('#sheet .camp-builder')`, 8000), 'made');
  st = await api('GET', '/state');
  const cp = st.campaigns.find((x) => x.name === 'Spring tune-ups');
  ok(cp && cp.type !== 'checklist', 'a campaign');
  ok(st.goals.some((g) => g.campaignId === cp?.id && g.title === 'Tell past customers'), 'with its step');

  // ---- changing one is the same one page, everything open ----
  await A.ev(`openCampaign(${JSON.stringify(cp.id)}); true`).catch(() => {});
  await A.until(`!!document.querySelector('#camps [aria-label="Campaign options"]')`);
  await A.ev(`document.querySelector('#camps [aria-label="Campaign options"]').click(); true`);
  const det = `[...document.querySelectorAll('.menu button, .menu [role=menuitem]')].find((b) => /details/i.test(b.textContent))`;
  if (await A.until(`!!${det}`)) {
    await A.ev(`${det}.click(); true`);
    ok(await A.until(`!!${Q('.cb-name')}`) && !(await A.ev(`!!${Q('.cb-kinds')}`)), 'its details: no asking what it is');
    ok(await A.ev(`!${Q('.cb-stages')} && (!${Q('details.cb-more')} || ${Q('details.cb-more')}.open)`), 'one page, everything open');
  } else ok(false, 'found Details in the campaign’s menu');
  ok(!A.errors.length, 'no page errors: ' + A.errors.join(' | '));
} catch (e) {
  ok(false, 'threw: ' + e.message);
} finally {
  A?.close(); chrome.kill(); srv.kill();
  if (fails) console.log(srv.log.slice(-2000));
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
}
