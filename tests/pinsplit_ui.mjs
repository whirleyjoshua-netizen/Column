// Pins open in the split (the owner, 2026-11-19): at full size (the desktop app, a browser), a pinned job, board,
// campaign, chat feed or doc opens on the right, beside the page you're working on, the way the tools do. The page
// stays. Another pin takes the split's place; ✕ puts it back. A pin for the page you're already on opens there. On a
// phone a pin still opens as the page.
import { CHROME, SERVER_DIR } from './chromebin.mjs';
import * as FS from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/pinsplit';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5238, APP = `http://127.0.0.1:${PORT}/`, CDP = 9577;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
try { (await import('node:child_process')).execSync(`pkill -f remote-debugging-port=${CDP}`); await sleep(400); } catch {}
FS.rmSync(`${S}/dk/chrome-pinsplit`, { recursive: true, force: true });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${S}/dk/chrome-pinsplit`, '--no-first-run', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
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
  const ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(expr.slice(0, 60) + ': ' + r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  const until = async (expr, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr).catch(() => false)) return true; await sleep(100); } return false; };
  // SHOTS=<dir> saves a picture at each step, to look at the layout.
  const shot = async (name) => { if (!process.env.SHOTS) return; const r = await cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(`${process.env.SHOTS}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
  return { ev, until, cmd, errors, shot, close: () => ws.close() };
}
let A;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Pins ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
  await api('PATCH', '/workspace', { tools: { projects: true, docs: true } });
  const camp = await api('POST', '/campaigns', { name: 'Spring blinds push', start: '2026-11-01' });
  const proj = await api('POST', '/projects', { template: 'crm', name: 'Installs' });
  const rec = await api('POST', `/projects/${proj.id}/records`, { typeId: proj.types[0].id, values: { [proj.types[0].primary]: 'Smith kitchen shades' } });
  const ch = (await api('POST', '/channels', { name: 'crew' })).channels?.find((c) => c.name === 'crew') || (await api('GET', '/state')).workspace.channels.find((c) => c.name === 'crew');
  const doc = await api('POST', '/items', { type: 'text', doc: { title: 'Install checklist', blocks: [{ id: 'a', type: 'p', runs: [{ text: 'Measure twice.' }] }] } });
  const put = await api('PUT', '/account/pins', { pins: [{ go: 'rec:' + rec.id, label: 'Smith' }, { go: 'proj:' + proj.id, label: 'Installs' }, { go: 'camp:' + camp.id, label: 'Spring' }, { go: 'chan:' + ch.id, label: 'crew' }, { go: 'doc:' + doc.id, label: 'Install checklist' }] });
  ok(put.pins?.length === 5, 'five things pinned');

  A = await tab(APP);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await A.until(`location.origin === new URL(${JSON.stringify(APP)}).origin`, 20000);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=work]') && document.body.classList.contains('wide')`, 15000), 'Ada is in, at full size');
  const pick = (label) => A.ev(`(document.querySelector('#workTabs .pins-btn').click(), [...document.querySelectorAll('#menu .pin-item')].find((x) => x.textContent.includes(${JSON.stringify(label)})).click(), true)`);
  const inSplit = (sel) => `!!document.querySelector('#split:not(.hidden) .split-body > ${sel}:not(.hidden)')`;
  const title = () => A.ev(`document.querySelector('#split .split-title')?.textContent || ''`);
  const home = (sel) => `document.querySelector('${sel}').parentElement === document.querySelector('#main') && document.querySelector('${sel}').classList.contains('hidden')`;

  // Working in Tasks; the job opens on the right.
  await A.ev(`document.querySelector('#tabs [data-tab=work]').click(); true`);
  await A.ev(`openBarItem ? 0 : 0`).catch(() => {});
  await A.ev(`document.querySelector('#workTabs [data-tab=day]')?.click(); true`);
  ok(await A.until(`!document.querySelector('#day').classList.contains('hidden')`), 'Tasks is the page');
  await pick('Smith');
  ok(await A.until(inSplit('#projects') + ` && !!document.querySelector('#split .pj-panel[data-id="${rec.id}"]')`, 6000), 'the job pin opens the job in the split');
  ok(await A.ev(`!document.querySelector('#day').classList.contains('hidden') && document.querySelector('#day').getBoundingClientRect().width > 300`), 'Tasks stays open beside it');
  ok(await A.until(`document.querySelector('#split .split-title')?.textContent.includes('Smith kitchen shades')`), 'the split is titled with the job: ' + await title());
  ok(await A.ev(`(() => { const s = document.querySelector('#split').getBoundingClientRect(), p = document.querySelector('#split #projects').getBoundingClientRect(); return p.left >= s.left - 1 && p.right <= s.right + 1 && p.top >= s.top; })()`), 'the job sits inside the split, not over the page');
  ok(await A.until(`(() => { const b = [...document.querySelectorAll('#workTabs button')].find((x) => x.dataset.tab === 'day'); return b?.classList.contains('on'); })()`), 'Tasks is still the tab that’s on');
  await A.shot('job');
  ok(await A.ev(`document.querySelector('#workTabs .pins-btn').classList.contains('on')`), 'and 📌 lights while a pin is open');

  // The board pin: the same page, a different board view, in the split.
  await pick('Installs');
  ok(await A.until(inSplit('#projects') + ` && !document.querySelector('#split .pj-panel')`, 6000) && (await title()).includes('Installs'), 'the board pin opens the board in the split: ' + await title());
  // The split has its own Close; the board's own ✕ did nothing there (column-a9's live check, 2026-11-20), and stacked a second ✕.
  const boardsX = `[...document.querySelectorAll('#split #projects [aria-label="Close Boards"]')].filter((b) => b.offsetParent).length`;
  ok(await A.ev(boardsX) === 0, 'a board in the split shows no ✕ of its own, only the split’s Close');
  await A.ev(`document.querySelector('#split #projects [aria-label="All boards"]').click(); true`);
  ok(await A.until(`!!document.querySelector('#split #projects .pj-head')`, 6000) && await A.ev(boardsX) === 0, 'nor does the Boards list it goes back to');

  // Another pin takes the split's place; the job goes back where it lives, closed.
  await pick('Spring');
  ok(await A.until(inSplit('#campsWrap') + ` && !!document.querySelector('#split [aria-label="Campaign options"]')`), 'the campaign pin opens the campaign in the split');
  ok(await A.ev(home('#projects')), 'Boards went back under the page, closed');
  ok((await title()).includes('Spring blinds push'), 'titled with the campaign');
  await A.shot('camp');
  ok(await A.ev(`!document.querySelector('#day').classList.contains('hidden')`), 'Tasks is still the page');

  // A feed opens Chat, which lives in the split (Chat is a tool since 217f8a3).
  await pick('crew');
  ok(await A.until(`!!document.querySelector('#split:not(.hidden) #chat:not(.hidden)') && document.querySelector('#split .ch-head')?.textContent.includes('crew')`), 'the feed pin opens that feed in the split');
  ok(await A.ev(home('#campsWrap')), 'the campaign went back, closed');
  await A.ev(`(() => { const ta = document.querySelector('#split .chat-pane textarea'); ta.value = 'On my way'; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
  ok(await A.until(`document.querySelector('#split .chat-pane .list')?.textContent.includes('On my way')`), 'you can talk in the feed from the split');
  await A.shot('feed');

  await pick('Install checklist');
  ok(await A.until(inSplit('#docview') + ` && document.querySelector('#split #docview').textContent.includes('Measure twice')`, 6000), 'the doc pin opens the doc in the split');
  await A.shot('doc');
  ok(await A.ev(home('#chat')), 'the feed went back, closed');
  ok(await A.ev(`!document.querySelector('#day').classList.contains('hidden')`), 'Tasks is still the page');

  // ✕ closes the split and leaves the page as it was.
  await A.ev(`document.querySelector('#split .split-close').click(); true`);
  ok(await A.until(`document.querySelector('#split').classList.contains('hidden') && !document.querySelector('#split #docview') && (!document.querySelector('#docview') || document.querySelector('#docview').classList.contains('hidden'))`), '✕ closes the split, and the doc with it');
  ok(await A.ev(`!document.querySelector('#day').classList.contains('hidden')`), 'Tasks is the page, as it was');

  // On Campaigns, the campaign pin opens there, and a feed opens beside it.
  await A.ev(`document.querySelector('#tabs [data-tab=work]').click(); true`);
  await A.ev(`document.querySelector('#workTabs [data-tab=camps]')?.click(); true`);
  ok(await A.until(`!document.querySelector('#campsWrap').classList.contains('hidden') && document.querySelector('#campsWrap').parentElement === document.querySelector('#main')`), 'Campaigns is the page');
  await pick('Spring');
  ok(await A.until(`document.querySelector('#campsWrap').parentElement === document.querySelector('#main') && !!document.querySelector('#camps [aria-label="Campaign options"]')`) && await A.ev(`document.querySelector('#split').classList.contains('hidden')`), 'a campaign pin while in Campaigns opens it there');
  await pick('crew');
  ok(await A.until(`!!document.querySelector('#split:not(.hidden) #chat') && !document.querySelector('#campsWrap').classList.contains('hidden') && document.querySelector('#campsWrap').parentElement === document.querySelector('#main')`), 'and the feed opens beside it');
  // From Tasks, the campaign in the split; then Campaigns from the tabs brings it back to the page.
  await A.ev(`document.querySelector('#workTabs [data-tab=day]').click(); true`);
  await pick('Spring');
  ok(await A.until(inSplit('#campsWrap')), 'the campaign in the split again, from Tasks');
  // Picking the page that's in the split (Campaigns) brings it back to the page.
  await A.ev(`document.querySelector('#tabs [data-tab=work]').click(); true`);
  await A.ev(`document.querySelector('#workTabs [data-tab=camps]')?.click(); true`);
  ok(await A.until(`document.querySelector('#split').classList.contains('hidden') && document.querySelector('#campsWrap').parentElement === document.querySelector('#main') && !document.querySelector('#campsWrap').classList.contains('hidden')`), 'Campaigns from the tabs takes it back from the split, as the page');

  // The job in the split, the Boards tab on the left: Boards comes back as the page.
  await pick('Smith');
  ok(await A.until(inSplit('#projects') + ` && !!document.querySelector('#split .pj-panel')`, 6000), 'the job in the split again');
  await A.ev(`document.querySelector('#workTabs [data-tab=projects]').click(); true`);
  ok(await A.until(`document.querySelector('#split').classList.contains('hidden') && document.querySelector('#projects').parentElement === document.querySelector('#main') && !document.querySelector('#projects').classList.contains('hidden')`), 'Boards from the tabs takes it back as the page');
  ok(await A.ev(`getComputedStyle(document.querySelector('#projects')).position === 'fixed'`), 'and it lays out as the page again');

  // A phone: pins open as the page, as before.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 2, mobile: true });
  ok(await A.until(`!document.body.classList.contains('wide')`), 'a phone');
  await A.ev(`document.querySelector('#tabs [data-tab=home]').click(); true`);
  await A.ev(`(() => { const b = document.querySelector('#topTabs [data-pin^="camp:"]'); b.click(); return true; })()`);
  ok(await A.until(`!document.querySelector('#campsWrap').classList.contains('hidden') && document.querySelector('#campsWrap').parentElement === document.querySelector('#main') && document.querySelector('#split').classList.contains('hidden')`), 'on a phone the campaign pin opens the campaign page');

  ok(!A.errors.length, 'no errors in the page: ' + A.errors.join(' | '));
} catch (e) {
  ok(false, 'threw: ' + e.message);
} finally {
  A?.close();
  chrome.kill();
  srv.kill();
}
if (fails) console.log(srv.log.slice(-1500));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
