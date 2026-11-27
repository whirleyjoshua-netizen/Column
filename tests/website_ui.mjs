// Settings → Website in a real browser: an owner finds Website under Business (a member doesn't), saves the site
// they have, picks a package and website care, says what they want and asks; the page then shows the request moving
// along (asked for → building → review → live) and can withdraw it. Kloomie staff see the request on their own
// Website page and mark it Building; the owner's bell says so and opens the Website page.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/website_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5481, CDP = 9751, APP = `http://127.0.0.1:${PORT}/`;
const t = Date.now();
const STAFF = `josh${t}@kloomie.test`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1', KLOOMIE_STAFF_EMAILS: STAFF, WEBSITE_EMAIL: 'builds@kloomie.test' }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let tt;
  for (let i = 0; i < 80 && !tt; i++) { await sleep(200); try { tt = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
  const ws = new WebSocket(tt.webSocketDebuggerUrl);
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
  const post = async (p, b, tok) => (await fetch(APP + 'api' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b) })).json();
  const a = await post('/auth', { mode: 'create', workspace: 'Roof ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const api = async (m, p, b, tok = a.token) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined })).json();
  const st = await api('GET', '/state');
  const mo = await post('/auth', { mode: 'join', workspace: 'Roof ' + t, code: st.workspace.inviteCode, name: 'Mo Lane', email: `mo${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const jo = await post('/auth', { mode: 'create', workspace: 'Kloomie ' + t, name: 'Josh', email: STAFF, password: 'longenough3', device: 'Mac', deviceId: 'd3' });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  const signIn = async (tok) => { await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(tok)})); location.reload(); true`); await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000); };
  const openPage = async () => { await A.ev(`document.querySelector('#settingsBtn').click(); true`); await A.until(`!document.querySelector('#settings').classList.contains('hidden')`); };

  // A member: no Website page.
  await signIn(mo.token);
  await openPage();
  ok(await A.until(`!!document.querySelector('#settings .setx-item[data-page=business]')`) && !(await A.ev(`!!document.querySelector('#settings .setx-item[data-page=website]')`)), 'a member has no Website page');

  // The owner.
  await signIn(a.token);
  await openPage();
  await A.tap(`document.querySelector('#settings .setx-item[data-page=website]')`);
  ok(await A.until(`!!document.querySelector('#settings .web-sec input') && !!document.querySelector('#settings .web-ask .web-pkg[data-pkg=standard]')`), 'Business → Website: the site you have, and Get a website built with its packages');
  ok(await A.ev(`/\\$300/.test(document.querySelector('.web-pkg[data-pkg=basic]').textContent) && /\\$1,500/.test(document.querySelector('.web-pkg[data-pkg=standard]').textContent) && /\\$84 a month/.test(document.querySelector('.web-care').textContent)`), 'with prices: Basic $300, Standard $1,500, care $84 a month');
  await A.fill(`document.querySelector('.web-sec input')`, 'roofco.test');
  await A.tap(`[...document.querySelectorAll('.web-sec button')].find((b) => b.textContent === 'Save')`);
  ok(await A.until(`!!document.querySelector('.web-own a[href="https://roofco.test"]') && /Connect its form/.test(document.querySelector('.web-own').textContent)`), 'saving the site shows it, with Connect its form');
  await A.tap(`document.querySelector('.web-ask .btn.primary-btn')`);
  ok(await A.until(`/Pick a package/.test(document.querySelector('#toast, .toast')?.textContent || '')`, 4000), 'asking without a package says to pick one');
  await A.tap(`document.querySelector('.web-pkg[data-pkg=standard]')`);
  ok(await A.ev(`document.querySelector('.web-pkg[data-pkg=standard]').classList.contains('on') && document.querySelector('.web-pkg[data-pkg=standard]').getAttribute('aria-checked') === 'true'`), 'tapping Standard picks it');
  await A.tap(`document.querySelector('.web-care input')`);
  await A.fill(`document.querySelectorAll('.web-ask input:not([type=checkbox])')[0]`, 'Roofing in Las Vegas');
  await A.fill(`document.querySelector('.web-ask textarea')`, 'Purple, like our trucks');
  await A.tap(`document.querySelector('.web-ask .btn.primary-btn')`);
  ok(await A.until(`!!document.querySelector('.web-steps li.on') && !document.querySelector('.web-ask')`), 'asked: the request shows instead of the form');
  ok(await A.ev(`document.querySelector('.web-steps li.on').textContent === 'Asked for' && document.querySelectorAll('.web-steps li').length === 4 && /Standard, up to 5 pages, with website care/.test(document.querySelector('.web-sec').textContent)`), 'step 1 of 4, Asked for: Standard with website care');
  ok(/Purple, like our trucks/.test((await api('GET', '/website')).req.notes), 'what they wrote was sent');
  ok(await A.ev(`/Leads|Connect its form/.test(document.querySelector('.web-own').textContent)`), 'the site row is still there');
  ok(!(await A.ev(`!!document.querySelector('.web-staff')`)), 'an owner who isn’t Kloomie staff has no staff list');

  // Withdraw and ask again.
  await A.tap(`[...document.querySelectorAll('.web-sec button')].find((b) => /Withdraw/.test(b.textContent))`);
  await A.tap(`[...document.querySelectorAll('.web-sec button')].find((b) => /Withdraw|confirm/i.test(b.textContent))`);
  ok(await A.until(`!!document.querySelector('.web-ask') && !document.querySelector('.web-steps')`), 'withdrawing brings the form back');
  await api('POST', '/website/request', { pkg: 'basic' });

  // Kloomie staff.
  await signIn(jo.token);
  await openPage();
  await A.tap(`document.querySelector('#settings .setx-item[data-page=website]')`);
  ok(await A.until(`!!document.querySelector('.web-staff .web-req')`), 'Kloomie staff see Website requests on their Website page');
  ok(await A.ev(`/Roof ${t}/.test(document.querySelector('.web-staff').textContent) && /Basic/.test(document.querySelector('.web-staff').textContent) && /rico${t}@t\\.test/.test(document.querySelector('.web-staff').textContent)`), 'the team, its package and who asked');
  await A.ev(`(() => { const r = [...document.querySelectorAll('.web-staff .web-req')].find((x) => x.textContent.includes('Roof ${t}')); r.querySelector('select').value = 'building'; r.querySelectorAll('input')[1].value = 'Starting this week'; return true; })()`);
  await A.tap(`[...document.querySelectorAll('.web-staff .web-req')].find((x) => x.textContent.includes('Roof ${t}')).querySelector('button')`);
  ok(await A.until(`[...document.querySelectorAll('.web-staff .web-req')].some((x) => x.textContent.includes('Roof ${t}') && x.textContent.includes('Building'))`), 'staff mark it Building');

  // The owner is told.
  await signIn(a.token);
  await A.ev(`document.querySelector('#settings').classList.add('hidden'); document.querySelector('#bellBtn, .bell-btn, [aria-label=Notifications]')?.click(); true`);
  ok(await A.until(`[...document.querySelectorAll('.bell-row')].some((b) => /Your website: Building/.test(b.textContent))`), 'the owner’s bell: Your website: Building');
  await A.tap(`[...document.querySelectorAll('.bell-row')].find((b) => /Your website: Building/.test(b.textContent))`);
  ok(await A.until(`!document.querySelector('#settings').classList.contains('hidden') && document.querySelector('.web-steps li.on')?.textContent === 'Building'`), 'it opens the Website page at step 2, Building');
  ok(await A.ev(`/Starting this week/.test(document.querySelector('.web-updates').textContent) && !document.querySelector('.web-sec button.danger')`), 'with the note, and no Withdraw once work has started');
  ok(A.errors.length === 0, 'no errors on the page' + (A.errors.length ? ': ' + A.errors.join(' | ').slice(0, 300) : ''));
} catch (e) {
  ok(false, 'threw ' + e.stack);
} finally {
  srv.kill(); chrome.kill();
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
