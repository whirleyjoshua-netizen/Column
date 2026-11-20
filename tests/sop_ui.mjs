// SOPs (Command Center part 5, 2026-11-20): saved campaigns are the team's SOPs. The list shows each one's version and
// who's read it; 📖 Read opens it as a guide (brief, phases, each task's how-to and checklist) with "I've read it";
// the owner sees who's read it and asks the rest; a campaign started from one updates it (a new version with what
// changed), and an earlier version can be gone back to.
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/sopui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4988, APP = `http://127.0.0.1:${PORT}/`, CDP = 9557;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-sopui`, { recursive: true, force: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-sopui`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, SKIP_SETUP: '1', PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  const mouse = async (type, x, y) => cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' || type === 'mouseMoved' ? 1 : 0, clickCount: 1 });
  const pick = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  const tap = async (expr) => { const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); for (const ty of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type: ty, x, y, button: 'left', buttons: ty === 'mousePressed' ? 1 : 0, clickCount: 1 }); await sleep(80); };
  return { ev, until, tap, mouse, cmd, pick, errors, close: () => ws.close() };
}
let A;
const shot = async (name) => { if (!process.env.SHOT) return; const r = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(`${process.env.SHOT}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const post = async (p, body, tok) => (await fetch(APP + 'api' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) })).json();
  const auth = await post('/auth', { mode: 'create', workspace: 'Sp ' + t, name: 'Joshua', email: `j${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const api = async (m, p, body, tok = auth.token) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined })).json();
  const code = (await api('GET', '/state')).workspace.inviteCode;
  const samA = await post('/auth', { mode: 'join', workspace: 'Sp ' + t, code, name: 'Sam', email: `s${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const camp = await api('POST', '/campaigns', { name: 'Blind install', brief: 'Every install, the same way.', audience: 'Homeowners' });
  const g = await api('POST', '/goals', { campaignId: camp.id, title: 'Install day' });
  await api('POST', '/tasks', { goalId: g.id, text: 'Level the brackets', description: 'Laser level, then pencil marks.', checklist: [{ text: 'Laser level' }, { text: 'Pencil' }] });
  const tp = await api('POST', '/templates', { campaignId: camp.id, name: 'Blind install', tz: 'America/Los_Angeles' });
  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  const signIn = async (tok) => { await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(tok)})); location.reload(); true`).catch(() => {}); await sleep(500); await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('[data-tab=camps]')`, 15000); for (let i = 0; i < 20 && !(await A.ev(`!!document.querySelector('.sop-row')`)); i++) { await A.ev(`(document.querySelector('.crumb-camps, #camps .cc-crumb a') || document.querySelector('[data-tab=camps]'))?.click(); true`); await sleep(300); } };
  await signIn(auth.token);
  const row = `document.querySelector('.sop-row[data-sop="${tp.id}"]')`;
  ok(await A.until(`[...document.querySelectorAll('#camps .any-h')].some((x) => x.textContent.startsWith('SOPs · saved campaigns')) && /v1/.test(${row}.textContent) && /read by 1 of 2/.test(${row}.textContent)`), 'Campaigns lists SOPs: version 1, read by 1 of 2: ' + await A.ev(`${row}?.textContent`));
  await A.tap(`${row}.querySelector('.sop-open')`);
  const G = (q) => `document.querySelector('#sheet .sop-guide ${q}')`;
  ok(await A.until(`!!${G('.sop-phase')} && /Install day/.test(${G('.sop-phase')}.textContent) && /Laser level, then pencil marks/.test(${G('.sop-how')}.textContent) && document.querySelectorAll('#sheet .sop-check li').length === 2`), 'the guide: each phase, its tasks with their how-to and checklist');
  ok(await A.ev(`/Every install, the same way/.test(${G('.sop-brief')}.textContent) && /Homeowners/.test(${G('.sop-brief')}.textContent)`), 'and the brief');
  ok(await A.ev(`/You read version 1/.test(${G('.sop-did')}.textContent)`), 'Joshua saved it, so he’s read it');
  await A.ev(`${G('.sop-who-read')}.open = true; true`);
  ok(await A.ev(`/Sam/.test(${G('.sop-who-read li.no')}?.textContent || '')`), 'Who’s read it: Sam, not yet');
  await A.tap(`[...document.querySelectorAll('#sheet .sop-who-read button')].find((b) => b.textContent === 'Ask whoever hasn’t')`);
  let notes = [];
  for (let i = 0; i < 30 && !notes.length; i++) { await sleep(150); notes = (await api('GET', '/notices', null, samA.token)).filter((n) => n.kind === 'sop'); }
  ok(notes.length === 1 && notes[0].go === 'sop:' + tp.id, 'asking tells Sam, with a link to the guide');
  await shot('sop-guide');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`);
  // A run, improved, updates the SOP.
  const run = await api('POST', `/templates/${tp.id}/run`, { date: '2026-12-01' });
  const st = await api('GET', '/state');
  await api('POST', '/tasks', { goalId: st.goals.find((x) => x.campaignId === run.id).id, text: 'Walk the customer through it' });
  const runCard = `[...document.querySelectorAll('.camp-card')].find((c) => c.querySelector('b')?.textContent === ${JSON.stringify(run.name)})`;
  ok(await A.until(`!!${runCard}`, 8000), 'the run is on the list: ' + run.name);
  await A.tap(runCard);
  await A.until(`!!document.querySelector('#camps [aria-label="Campaign options"]')`, 8000);
  await A.tap(`document.querySelector('#camps [aria-label="Campaign options"]')`);
  ok(await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === '📖 Its SOP: Blind install (v1)') && [...document.querySelectorAll('#menu button')].some((b) => b.textContent === 'Update the SOP from this campaign…')`), 'a run’s menu has its SOP and Update the SOP from this campaign: ' + await A.ev(`[...document.querySelectorAll('#menu button')].map((b) => b.textContent).join(' | ')`));
  await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Update the SOP from this campaign…').click(); true`);
  ok(await A.until(`!!document.querySelector('#sheet .sop-note')`), 'it asks what changed');
  await A.ev(`(() => { const n = document.querySelector('#sheet .sop-note'); n.value = 'Added a walk-through at the end'; n.dispatchEvent(new Event('input')); return true; })()`);
  await A.ev(`[...document.querySelectorAll('#sheet button')].find((b) => b.textContent === 'Update the SOP').click(); true`);
  let x;
  for (let i = 0; i < 30; i++) { await sleep(150); x = (await api('GET', '/state')).templates.find((y) => y.id === tp.id); if (x.version === 2) break; }
  ok(x.version === 2 && x.versions.at(-1).note === 'Added a walk-through at the end' && x.goals[0].tasks.length === 2, 'the SOP is version 2, with the run’s new task and the note');
  await A.tap(`document.querySelector('#camps .cc-crumb button')`);
  await A.until(`!!${row}`, 8000);
  ok(await A.until(`/v2/.test(${row}.textContent)`), 'the list says v2');
  await A.tap(`${row}.querySelector('.sop-open')`);
  ok(await A.until(`/Added a walk-through at the end/.test(${G('.sop-changed')}?.textContent || '') && document.querySelectorAll('#sheet .sop-steps > li').length === 2`), 'the guide says what changed, with the new step');
  await A.ev(`${G('.sop-hist')}.open = true; true`);
  await A.tap(G('.sop-restore'));
  await A.tap(G('.sop-restore'));
  for (let i = 0; i < 30; i++) { await sleep(150); x = (await api('GET', '/state')).templates.find((y) => y.id === tp.id); if (x.version === 3) break; }
  ok(x.version === 3 && x.goals[0].tasks.length === 1 && x.versions.at(-1).note === 'Back to version 1', 'Go back to this (twice): version 3 is version 1 again');
  // Sam reads it.
  await signIn(samA.token);
  ok(await A.until(`/You haven’t read it yet/.test(${row}?.textContent || '') && !${row}.querySelector('[aria-label="SOP options"]') && !!document.querySelector('.sop-badge')`), 'Sam: “You haven’t read it yet”, a badge on the list, no options');
  await A.tap(`${row}.querySelector('.sop-open')`);
  ok(await A.until(`!!${G('.sop-readbtn')} && !${G('.sop-who-read')}`), 'his guide has I’ve read it, and no Who’s read it');
  await A.tap(G('.sop-readbtn'));
  let rd;
  for (let i = 0; i < 30; i++) { await sleep(150); rd = (await api('GET', '/state')).templates.find((y) => y.id === tp.id).reads?.[samA.memberId || (await api('GET', '/state', null, samA.token)).me.memberId]; if (rd?.v === 3) break; }
  ok(rd?.v === 3, 'Sam has read version 3');
  ok(await A.until(`/You read version 3/.test(${G('.sop-did')}?.textContent || '')`), 'and his guide says so');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) { ok(false, 'threw: ' + e.stack); }
chrome.kill(); srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-12).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
