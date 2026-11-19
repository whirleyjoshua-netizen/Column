// The campaign builder at full size (the owner, 2026-11-19: "lets full size browser and desktop optimize it. and make
// sure it covers whats need with this evolving platform"): beside the sidebar, not a bottom sheet; the job it's for,
// who runs it, roles, steps that finish job stages, in order, logging and money in one go; a summary beside it;
// editing an existing one; fits a phone.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/camp_builder_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5234, CDP = 9575, APP = `http://127.0.0.1:${PORT}/`;
const AI_PORT = 5236;
const fakeAi = spawn('node', [new URL('fakeai.mjs', import.meta.url).pathname, DIR + '/ai.log'], { env: { ...process.env, FAKEAI_PORT: String(AI_PORT) }, stdio: 'ignore' });
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}`, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 80 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
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
    await until(`(() => { const e = ${expr}; if (!e) return false; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && (top === e || e.contains(top)); })()`, 6000);
    const [x, y] = await ev(`(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await sleep(150);
  };
  const fill = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  return { ev, until, tap, fill, cmd, errors };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Build ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const st = await api('GET', '/state');
  const sam = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'join', workspace: 'Build ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' }) })).json();
  await api('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true } });
  const p = await api('POST', '/projects', { template: 'trades', trades: ['hvac'] });
  const tp = p.types[0];
  const statusF = tp.fields.find((f) => f.key === 'status');
  const job = await api('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { job: 'Bill Nye · furnace', [statusF.id]: statusF.choices[0].id } });
  const stage1 = statusF.choices[1].label;

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');
  await A.until(`!!document.querySelector('#tabs [data-tab=camps]')`, 10000);
  await A.ev(`document.querySelector('#tabs [data-tab=camps]').click(); true`);
  await A.tap(`[...document.querySelectorAll('#camps button')].find((b) => b.textContent === '+ New')`);
  ok(await A.until(`!!document.querySelector('#sheet .sheet.camp-builder .cb-grid')`), 'New campaign opens the builder');
  ok(await A.ev(`(() => { const s = document.querySelector('#sheet .sheet').getBoundingClientRect(); const side = document.querySelector('#side')?.getBoundingClientRect(); return s.width > innerWidth * 0.6 && s.height >= innerHeight - 2 && (!side || !side.width || s.left >= side.right - 1); })()`), 'full size, beside the sidebar (not a bottom sheet)');
  ok(await A.ev(`(() => { const m = document.querySelector('#sheet .cb-main').getBoundingClientRect(), s = document.querySelector('#sheet .cb-sum').getBoundingClientRect(); return s.left >= m.right - 1 && s.width > 200; })()`), 'on a computer: the form, with the summary beside it');
  ok(await A.ev(`['What it is', 'What it’s for', 'Who’s on it', 'Steps', 'What gets logged', 'Money'].every((x) => [...document.querySelectorAll('#sheet .cb-sec h3')].some((h) => h.textContent === x))`), 'it covers what it is, the job, people and roles, steps, logging and money');
  ok(await A.until(`[...document.querySelectorAll('#sheet .cb-sec select option')].some((o) => o.value === ${JSON.stringify(job.id)})`, 8000), 'the job can be picked from Boards');

  const fill = (sel, v) => A.ev(`(() => { const e = ${sel}; e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await fill(`document.querySelector('#sheet .cb-name')`, 'Bill Nye furnace swap');
  await fill(`[...document.querySelectorAll('#sheet .cb-sec select')].find((s) => [...s.options].some((o) => o.value === ${JSON.stringify(job.id)}))`, job.id);
  await A.ev(`(() => { const s = [...document.querySelectorAll('#sheet label')].find((l) => l.textContent.startsWith('Runs it')).querySelector('select'); s.value = ${JSON.stringify(sam.memberId || '')} || [...s.options].find((o) => o.textContent.includes('Sam'))?.value; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await A.tap(`document.querySelector('#sheet .cb-add-role')`);
  await fill(`document.querySelector('#sheet .cb-role-h input')`, 'Installer');
  await A.tap(`[...document.querySelectorAll('#sheet .cb-role .chip')].find((b) => b.textContent.startsWith('Sam'))`);
  await A.tap(`document.querySelector('#sheet .cb-add-step')`);
  await fill(`document.querySelectorAll('#sheet .cb-step input')[0]`, 'Measure');
  ok(await A.until(`!!document.querySelector('#sheet .cb-step select')`), 'with the job picked, a step can finish one of its stages');
  await fill(`document.querySelector('#sheet .cb-step select')`, stage1);
  await A.tap(`document.querySelector('#sheet .cb-add-step')`);
  await fill(`document.querySelectorAll('#sheet .cb-step input')[1]`, 'Install');
  await A.ev(`(() => { const c = [...document.querySelectorAll('#sheet label.pick')].find((l) => l.textContent.startsWith('Work it in order')).querySelector('input'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await fill(`document.querySelector('#sheet .cb-budget')`, '1500');
  ok(await A.until(`(() => { const s = document.querySelector('#sheet .cb-sum').textContent; return s.includes('Bill Nye furnace swap') && s.includes('For the job Bill Nye · furnace') && s.includes('Sam Reed runs it') && s.includes('Installer: Sam Reed') && s.includes('2 steps, in order') && s.includes('Budget $1500'); })()`), 'the summary keeps up: name, job, who runs it, the role, 2 steps in order, the budget');

  { const shot = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(DIR + '/builder-desktop.png', Buffer.from(shot.result.data, 'base64')); }
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Make the campaign')`);
  let c, goals = [];
  for (let i = 0; i < 60; i++) { const s2 = await api('GET', '/state'); c = s2.campaigns.find((x) => x.name === 'Bill Nye furnace swap'); goals = c ? s2.goals.filter((g) => g.campaignId === c.id) : []; if (c && goals.length === 2) break; await sleep(150); }
  ok(c && c.recordId === job.id && c.assigneeId && c.inOrder === true && c.budget === 150000 && c.cast?.[0]?.name === 'Installer' && c.cast[0].memberIds.length === 1, `made in one go: the job, who runs it, in order, the budget, the role (${JSON.stringify(c && { r: c.recordId === job.id, a: !!c.assigneeId, o: c.inOrder, b: c.budget, cast: c.cast })})`);
  const gm = goals.find((g) => g.title === 'Measure'), gi = goals.find((g) => g.title === 'Install');
  ok(gm?.stage === stage1 && gi && !gi.stage && (gm.order ?? 0) < (gi.order ?? 1), `its steps, in order, Measure finishing “${stage1}”`);
  ok(await A.until(`!document.querySelector('#sheet .camp-builder') && document.querySelector('#camps')?.textContent.includes('Bill Nye furnace swap')`), 'and it opens the new campaign');

  // Editing it: the same builder, its steps listed.
  await A.ev(`openMenu && true`).catch(() => {});
  await A.ev(`(() => { const b = [...document.querySelectorAll('#camps button')].find((x) => x.getAttribute('aria-label') === 'Campaign options' || x.title === 'Campaign options'); b?.click(); return !!b; })()`);
  const opened = await A.until(`[...document.querySelectorAll('#menu button')].some((b) => b.textContent === 'Edit details…')`, 4000);
  if (opened) {
    await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Edit details…')`);
    ok(await A.until(`!!document.querySelector('#sheet .camp-builder') && document.querySelectorAll('#sheet .cb-step').length === 2 && document.querySelector('#sheet .cb-name').value === 'Bill Nye furnace swap'`), 'Edit details opens the same builder, with its steps');
    await fill(`document.querySelector('#sheet .cb-budget')`, '1800');
    await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Save')`);
    let b2;
    for (let i = 0; i < 40; i++) { b2 = (await api('GET', '/state')).campaigns.find((x) => x.id === c.id)?.budget; if (b2 === 180000) break; await sleep(150); }
    ok(b2 === 180000, 'saved: the budget is $1,800 now');
  } else ok(false, 'found the campaign’s options menu');

  // A phone: one column, nothing wider than the screen.
  await A.until(`!document.querySelector('#sheet .camp-builder')`);
  await A.ev(`[...document.querySelectorAll('#camps button')].find((x) => x.getAttribute('aria-label') === 'Campaign options' || x.title === 'Campaign options')?.click(); true`);
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Edit details…')`);
  await A.until(`!!document.querySelector('#sheet .camp-builder')`);
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  ok(await A.ev(`(() => { const m = document.querySelector('#sheet .cb-main').getBoundingClientRect(), sm = document.querySelector('#sheet .cb-sum').getBoundingClientRect(); return document.documentElement.scrollWidth <= 391 && sm.top >= m.bottom - 1 && [...document.querySelectorAll('#sheet .cb-sec, #sheet .cb-sum')].every((x) => x.getBoundingClientRect().right <= 391 && x.getBoundingClientRect().left >= 0); })()`), 'on a phone: one column (the summary under the form), nothing wider than the screen');
  await A.cmd('Emulation.clearDeviceMetricsOverride');
  await A.ev(`document.querySelector('#sheet [aria-label=Close]')?.click(); true`);
  await A.until(`document.querySelector('#sheet').classList.contains('hidden')`);

  // Sidekick, beside the form (2026-11-19): plan it by talking, then fill in the form or build it all.
  await api('PUT', '/ai/keys/anthropic', { key: 'test-key-for-the-fake-ai' });
  await A.ev(`openCampaign && true`).catch(() => {});
  await A.ev(`document.querySelector('#tabs [data-tab=camps]').click(); true`);
  await A.until(`[...document.querySelectorAll('#camps button')].some((b) => b.textContent === '← All campaigns' || b.textContent === '+ New' || b.getAttribute('aria-label') === 'All campaigns')`, 5000);
  await A.ev(`(() => { const b = [...document.querySelectorAll('#camps button')].find((x) => x.getAttribute('aria-label') === 'All campaigns' || x.textContent.includes('All campaigns')); b?.click(); return true; })()`);
  await A.tap(`[...document.querySelectorAll('#camps button')].find((b) => b.textContent === '+ New')`);
  await A.until(`!!document.querySelector('#sheet .camp-builder')`);
  ok(await A.ev(`[...document.querySelectorAll('#sheet .cb-tabs button')].map((b) => b.textContent).join('|') === 'Summary|✦ Sidekick builds it'`), 'beside the form: Summary, or Sidekick builds it');
  await fill(`document.querySelector('#sheet .cb-budget')`, '900');
  await A.tap(`document.querySelector('#sheet .cb-tabs [data-side=sk]')`);
  ok(await A.until(`!!document.querySelector('#sheet .cb-sk-ask') && getComputedStyle(document.querySelector('#sheet .cb-sum')).display === 'none'`), 'the Sidekick tab takes the place of the summary');
  await fill(`document.querySelector('#sheet .cb-sk-ask')`, 'deep plan please');
  await A.tap(`document.querySelector('#sheet .cb-sk-go')`);
  ok(await A.until(`document.querySelectorAll('#sheet .cb-sk .sk-card').length >= 4 && !!document.querySelector('#sheet .camp-builder')`, 15000), 'Sidekick answers with its plan as cards, and the builder stays open');
  for (const label of ['Campaign', 'Roles', 'Goal']) {
    await A.tap(`[...document.querySelectorAll('#sheet .cb-sk .sk-card')].find((c) => c.querySelector('.sk-card-h')?.textContent === ${JSON.stringify(label)} && c.querySelector('.primary-btn'))?.querySelector('.primary-btn')`);
    await A.until(`!document.querySelector('#sheet .cb-sk .sk-thinking')`, 8000);
  }
  ok(await A.until(`/3 accepted/.test(document.querySelector('#sheet .cb-sk-ready')?.textContent || '')`, 8000), 'cards accepted right there: 3 accepted');
  ok(await A.ev(`(() => { const box = document.querySelector('#sheet .cb-sk').getBoundingClientRect(); return [...document.querySelectorAll('#sheet .cb-sk > *')].every((e) => e.getBoundingClientRect().bottom <= box.bottom + 1); })()`), 'everything in the Sidekick panel stays inside it');
  { const shot = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(DIR + '/builder-sidekick.png', Buffer.from(shot.result.data, 'base64')); }
  await A.tap(`document.querySelector('#sheet .cb-sk-fill')`);
  ok(await A.until(`document.querySelector('#sheet .cb-name')?.value === 'Gym launch' && [...document.querySelectorAll('#sheet .cb-step input')].some((i) => i.value === 'Flyer') && [...document.querySelectorAll('#sheet .cb-role-h input')].some((i) => i.value === 'Designer') && document.querySelector('#sheet .cb-budget').value === '900'`, 8000), 'Fill in the form: the name, the roles and the steps come into the form, and what was typed there stays');
  ok(await A.ev(`!document.querySelector('#sheet .cb-sk').hidden && !!document.querySelector('#sheet .cb-sk-build')`), 'with the conversation still beside it');
  await A.tap(`document.querySelector('#sheet .cb-sk-build')`);
  let g2 = null, goals2 = [], tasks2 = [];
  for (let i = 0; i < 80; i++) { const s3 = await api('GET', '/state'); g2 = s3.campaigns.find((x) => x.name === 'Gym launch'); goals2 = g2 ? s3.goals.filter((g) => g.campaignId === g2.id) : []; tasks2 = goals2.length ? s3.tasks.filter((t) => goals2.some((g) => g.id === t.goalId)) : []; if (g2 && g2.budget === 90000 && tasks2.length) break; await sleep(150); }
  ok(g2 && goals2.some((g) => g.title === 'Flyer') && tasks2.some((t) => t.text === 'Design the flyer'), 'Build it: the campaign, its steps and their tasks');
  ok(g2?.budget === 90000 && g2.cast?.some((r) => r.name === 'Designer'), 'with what was set in the form on top (the $900 budget) and the roles');
  ok(await A.until(`!document.querySelector('#sheet .camp-builder') && document.querySelector('#camps')?.textContent.includes('Gym launch')`, 8000), 'and the new campaign opens');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors[0] : ''));
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
fakeAi.kill();
chrome.kill('SIGKILL');
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
