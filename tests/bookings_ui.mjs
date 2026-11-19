// Calendly and Cal.com tiles in the app (2026-11-20): connect the team's Calendly in the browser (its sign-in in a new
// tab, back to Kloomie by itself), the tile says it hears bookings and offers recipes; Cal.com takes a pasted key with
// a format check; a booking that comes in shows on Home.
import http from 'node:http';
import crypto from 'node:crypto';
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/bookings_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 5332, FAKE = 5333, CDP = 9630, APP = `http://127.0.0.1:${PORT}/`, F = `http://127.0.0.1:${FAKE}`;
const HOOK_KEY = 'calendly-app-signing-key-for-ui';
const fake = { challenge: null, calSecret: null };
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body ?? {})); };
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  const u = new URL(req.url, F);
  const body = /json/.test(req.headers['content-type'] || '') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
  if (u.pathname === '/oauth/authorize') { fake.challenge = u.searchParams.get('code_challenge'); res.writeHead(302, { location: `${u.searchParams.get('redirect_uri')}?code=good-code&state=${u.searchParams.get('state')}` }); return res.end(); }
  if (u.pathname === '/oauth/token') return crypto.createHash('sha256').update(String(body.code_verifier || '')).digest('base64url') === fake.challenge ? json(res, 200, { access_token: 'tok-1', refresh_token: 'r', expires_in: 7200, owner: 'https://api.calendly.com/users/U1', organization: 'https://api.calendly.com/organizations/O1' }) : json(res, 400, { error: 'invalid_grant' });
  if (u.pathname === '/users/me') return fake.revoked ? json(res, 401, {}) : json(res, 200, { resource: { uri: 'https://api.calendly.com/users/U1', name: 'Rico on Calendly', email: 'rico@cal.test', current_organization: 'https://api.calendly.com/organizations/O1' } });
  if (u.pathname === '/webhook_subscriptions') { fake.calendlyUrl = body.url; return json(res, 201, { resource: { uri: F + '/webhook_subscriptions/W1', scope: body.scope } }); }
  if (u.pathname === '/v2/me') return req.headers.authorization === 'Bearer cal_live_goodgoodgoodgood1234' ? json(res, 200, { status: 'success', data: { id: 7, email: 'rico@calcom.test', username: 'rico', name: 'Rico on Cal.com' } }) : json(res, 401, {});
  if (u.pathname === '/v2/webhooks') { fake.calSecret = body.secret; return json(res, 201, { status: 'success', data: { id: 55 } }); }
  json(res, 404, {});
}).listen(FAKE, '127.0.0.1');
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1',
  ALLOW_LOCAL_WEBHOOKS: '1', CALENDLY_CLIENT_ID: 'cid', CALENDLY_CLIENT_SECRET: 'csecret', CALENDLY_WEBHOOK_KEY: HOOK_KEY, CALENDLY_AUTH_URL: F, CALENDLY_API_URL: F, CALCOM_API_URL: F + '/v2' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
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
  const pick = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  const fill = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  return { ev, until, tap, pick, fill, cmd, errors };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Bookings ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden') && !!document.querySelector('#tabs [data-tab=apps]')`, 15000), 'Rico is in');
  await A.ev(`document.querySelector('#tabs [data-tab=apps]').click(); true`);
  ok(await A.until(`document.querySelector('#apps .app-tile[data-app=calendly]')?.dataset.state === 'off' && document.querySelector('#apps .app-tile[data-app=caldotcom]')?.dataset.state === 'off'`), 'Calendly and Cal.com are live tiles, not connected: ' + await A.ev(`document.querySelector('#apps .app-tile[data-app=calendly]')?.dataset.state`));
  await A.tap(`document.querySelector('#apps .app-tile[data-app=calendly]')`);
  ok(await A.until(`document.querySelectorAll('#apps .bk-sec[data-app=calendly] .bk-connect').length === 2`), 'its page offers the team’s booking page and your own');
  await A.tap(`document.querySelector('#apps .bk-sec .bk-connect[data-scope=team]')`);
  ok(await A.until(`/Rico on Calendly/.test(document.querySelector('#apps .bk-sec')?.textContent || '') && /Hears new bookings/.test(document.querySelector('#apps .bk-sec').textContent)`, 15000), 'after Calendly’s sign-in (in its own tab), the tile says it hears new bookings, by itself: ' + await A.ev(`document.querySelector('#apps .bk-sec')?.textContent.slice(0, 300)`));
  ok(await A.until(`document.querySelectorAll('#apps .app-now .app-now-list li').length === 4 && /host’s Day/.test(document.querySelector('#apps .app-now').textContent)`), 'What now: where bookings show, and four automations to turn on: ' + await A.ev(`document.querySelectorAll('#apps .app-now li').length`));
  await A.tap(`[...document.querySelectorAll('#apps .app-now li')].find((li) => /Tell the team/.test(li.textContent)).querySelector('button:not(.primary-btn)')`);
  ok(await A.until(`!!document.querySelector('#sheet .auto-edit') && document.querySelector('#sheet').textContent.includes('Booked? Tell the team') && [...document.querySelectorAll('#sheet select')].some((x) => x.value === 'booking.created')`), 'a recipe opens the automation builder, set to start when someone books');
  await A.ev(`document.querySelector('#sheet [aria-label=Close], #sheet .sheet-x, #sheetBack')?.click(); true`);
  await A.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(300);
  // Its sign-in revoked in Calendly: Check again says so, and the tile says Needs attention (from the registry).
  fake.revoked = true;
  await A.ev(`document.querySelector('#tabs [data-tab=apps]').click(); true`);
  await A.tap(`document.querySelector('#apps .app-tile[data-app=calendly]')`);
  await A.tap(`document.querySelector('#apps .bk-sec .bk-conn[data-scope=team] .bk-check')`);
  ok(await A.until(`/sign-in ran out/.test(document.querySelector('#apps .bk-sec .bk-conn[data-scope=team]')?.textContent || '')`), 'a revoked sign-in: the tile’s page says to connect again');
  await A.tap(`document.querySelector('#apps .app-back')`);
  ok(await A.until(`document.querySelector('#apps .app-tile[data-app=calendly]')?.dataset.state === 'error' && /Needs attention/.test(document.querySelector('#apps .app-tile[data-app=calendly]').textContent)`, 10000), 'and its tile says Needs attention: ' + await A.ev(`document.querySelector('#apps .app-tile[data-app=calendly]')?.dataset.state`));
  fake.revoked = false;
  // Cal.com: paste a key.
  await A.until(`!!document.querySelector('#apps .app-tile[data-app=caldotcom]')`);
  await A.tap(`document.querySelector('#apps .app-tile[data-app=caldotcom]')`);
  await A.tap(`document.querySelector('#apps .bk-sec[data-app=calcom] .bk-connect[data-scope=person]')`);
  ok(await A.until(`!!document.querySelector('#sheet .bk-key')`), 'Cal.com asks for a key, with where to find it: ' + await A.ev(`document.querySelector('#sheet .bk-steps')?.textContent`));
  await A.fill(`document.querySelector('#sheet .bk-key')`, 'nope');
  ok(await A.until(`/starts with cal_live_/.test(document.querySelector('#sheet .err')?.textContent || '')`), 'a key that isn’t one is caught as you type');
  await A.fill(`document.querySelector('#sheet .bk-key')`, 'cal_live_goodgoodgoodgood1234');
  await A.tap(`document.querySelector('#sheet .primary-btn')`);
  ok(await A.until(`/Rico on Cal.com/.test(document.querySelector('#apps .bk-sec[data-app=calcom]')?.textContent || '') && /····1234/.test(document.querySelector('#apps .bk-sec[data-app=calcom]').textContent)`, 10000), 'connected: the account and the key’s last four');
  // A booking comes in: it's on Home.
  const raw = JSON.stringify({ event: 'invitee.created', payload: { uri: 'https://api.calendly.com/scheduled_events/E1/invitees/I1', email: 'bob@x.test', name: 'Bob Stone', scheduled_event: { uri: 'https://api.calendly.com/scheduled_events/E1', name: 'Phone consult', start_time: new Date(Date.now() + 3 * 3600e3).toISOString(), end_time: new Date(Date.now() + 3.5 * 3600e3).toISOString(), event_memberships: [{ user_email: `rico${t}@t.test` }] } } });
  const ts = Math.floor(Date.now() / 1000);
  const r = await fetch(fake.calendlyUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'calendly-webhook-signature': `t=${ts},v1=${crypto.createHmac('sha256', HOOK_KEY).update(`${ts}.${raw}`).digest('hex')}` }, body: raw });
  ok(r.status === 200, 'a booking comes in from Calendly: ' + r.status);
  await A.ev(`document.querySelector('#tabs [data-tab=home]')?.click(); true`);
  ok(await A.until(`[...document.querySelectorAll('.home *')].some((x) => /Booked: Phone consult/.test(x.textContent || ''))`, 15000), 'Home shows it under what came in');
  ok(!A.errors.length, 'no errors: ' + A.errors.join(' | '));
} catch (e) { ok(false, 'threw ' + e.stack); }
srv.kill();
chrome.kill('SIGKILL');
if (fails) console.log(srv.log.split('\n').slice(-30).join('\n'));
console.log(fails ? fails + ' FAILED' : 'ALL PASS');
process.exit(fails ? 1 : 0);
