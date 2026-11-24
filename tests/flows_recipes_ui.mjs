// Ready-made automations by kind of business, in a real browser (headless Chrome). A trades team sees its own and
// everyone's first ("For you"), each card says which steps it uses; the chips show one group or all of them. Every
// ready-made one opens in the builder and saves as it is, except the ones that need a choice first (a project's
// date, another app's address), which say what's missing. Fits a phone.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/flows_recipes_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4982, CDP = 9539, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
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
  return { ev, until, cmd, errors };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Recipes ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  await api('PATCH', '/setup', { kind: 'trades' });
  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');
  await A.ev(`document.querySelector('#sheet:not(.hidden) [aria-label=Close]')?.click(); true`);
  await A.until(`!!document.querySelector('#tabs [data-tab=automations]')`, 10000);
  await A.ev(`document.querySelector('#tabs [data-tab=automations]').click(); true`);
  const names = `[...document.querySelectorAll('#tool .auto-recipe b')].map((b) => b.textContent)`;
  ok(await A.until(`document.querySelector('#tool .auto-recipe-for .chip.on')?.textContent === 'For you (Trades & field service)'`), 'a trades team sees “For you (Trades & field service)” first');
  const mine = await A.ev(names);
  ok(mine.includes('Done? Bill it and ask for a review') && mine.includes('Quote accepted? Book the install') && mine.includes('New lead? Sales drafts a reply') && !mine.includes('Big sale? Owners hear') && !mine.includes('New customer? Welcome them'), `its own and everyone’s, not a shop’s (${mine.length})`);
  ok(await A.ev(`[...document.querySelectorAll('#tool .auto-recipe')].find((r) => r.textContent.includes('Done? Bill it')).querySelector('.auto-recipe-steps').textContent === 'Invoice · Wait · Task'`), 'each card says which steps it uses (Invoice · Wait · Task)');
  await A.ev(`document.querySelector('#tool .auto-recipe-for [data-for=store]').click(); true`);
  ok(await A.until(`${names}.includes('Big sale? Owners hear') && !${names}.includes('Quote accepted? Book the install')`), 'the Shops chip shows a shop’s');
  await A.ev(`document.querySelector('#tool .auto-recipe-for [data-for=every]').click(); true`);
  // 27 by kind of business, and the 3 for bookings from Calendly or Cal.com (e3a7086).
  ok(await A.until(`${names}.length === 30 && ${names}.includes('Booked? Get ready for it') && ${names}.includes('Cancelled? Rebook them')`), 'All shows all 30 (the booking ones too)');

  // Every one opens in the builder and saves as it is (or says what it needs).
  const all = await A.ev(names);
  const needs = [];
  for (const name of all) {
    await A.ev(`[...document.querySelectorAll('#tool .auto-recipe')].find((r) => r.querySelector('b').textContent === ${JSON.stringify(name)}).click(); true`);
    await A.until(`!!document.querySelector('#sheet .sheet.auto-builder')`);
    await A.ev(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Turn it on').click(); true`);
    const saved = await A.until(`document.querySelector('#sheet').classList.contains('hidden')`, 3000);
    if (!saved) {
      needs.push([name, await A.ev(`document.querySelector('#sheet .err')?.textContent || ''`)]);
      await A.ev(`document.querySelector('#sheet [aria-label=Close]').click(); true`);
      await A.until(`document.querySelector('#sheet').classList.contains('hidden')`, 3000);
    }
  }
  const made = await api('GET', '/automations');
  ok(made.length === all.length - needs.length && needs.length === 3, `${made.length} of ${all.length} saved as they are; ${needs.length} need a choice first: ${needs.map(([n, e]) => `${n} (${e})`).join('; ')}`);
  ok(needs.every(([n, e]) => (/License|Plan renewing/.test(n) && /project and list/.test(e)) || (/another app/.test(n) && /web address/.test(e))), 'the ones that need a choice say what (a project and list; the web address)');
  const book = made.find((x) => x.name === 'Quote accepted? Book the install');
  ok(book && book.actions.map((s) => s.kind).join() === 'visit,email' && book.actions[0].visit === 'Install', 'saved with their steps (the install visit, the thank-you email)');
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  ok(await A.until(`document.documentElement.scrollWidth <= 392`, 4000), 'the ready-made ones and their chips fit a phone');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors.join(' | ').slice(0, 300) : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  chrome.kill('SIGKILL');
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
