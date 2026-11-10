// Mileage: tracking a drive live, a day's job route as mileage, working out road miles from addresses, typing it in;
// the rate, totals and a CSV; people see their own and admins see everyone's.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/mileage';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4774, B = `http://127.0.0.1:${PORT}`, M_PORT = 4772;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
// A stand-in for Mapbox: every place is on one straight road, x km from the shop; driving takes 2 minutes a km.
const KM = { 'shop': 0, 'a st': 10, 'b st': 20, 'c st': 30, 'supply yard': 16 };
const lngOf = (q) => { const k = Object.keys(KM).find((x) => q.toLowerCase().includes(x)); return k == null ? null : KM[k] / 100; };
const at = (s) => s.split(';').map((p) => Number(p.split(',')[0]) * 100);
let calls = { geo: 0, matrix: 0, dir: 0 };
const fake = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'application/json');
  if (u.searchParams.get('access_token') !== 'tok') { res.writeHead(401); return res.end('{"message":"bad token"}'); }
  if (u.pathname === '/search/geocode/v6/forward') {
    calls.geo++;
    const x = lngOf(u.searchParams.get('q'));
    return res.end(JSON.stringify({ features: x == null ? [] : [{ geometry: { coordinates: [x, 33.4] } }] }));
  }
  if (u.pathname.startsWith('/directions-matrix/v1/mapbox/driving/')) {
    calls.matrix++;
    const xs = at(decodeURIComponent(u.pathname.split('/').pop()));
    return res.end(JSON.stringify({ durations: xs.map((a) => xs.map((b) => Math.abs(a - b) * 120)), distances: xs.map((a) => xs.map((b) => Math.abs(a - b) * 1000)) }));
  }
  if (u.pathname.startsWith('/directions/v5/mapbox/driving/')) {
    calls.dir++;
    const xs = at(decodeURIComponent(u.pathname.split('/').pop()));
    return res.end(JSON.stringify({ routes: [{ geometry: { coordinates: xs.map((x) => [x / 100, 33.4]) }, legs: xs.slice(1).map((x, i) => ({ duration: Math.abs(x - xs[i]) * 120, distance: Math.abs(x - xs[i]) * 1000 })) }] }));
  }
  res.writeHead(404); res.end('{}');
});
await new Promise((r) => fake.listen(M_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', MAPBOX_API: `http://127.0.0.1:${M_PORT}`, MAPBOX_TOKEN: 'tok' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, body: j, text, type: r.headers.get('content-type') };
};
const MI = 1609.344;
const t = Date.now();
let r = await call()('POST', '/auth', { mode: 'create', workspace: 'M ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
const jo = call(r.body.token);
const code = (await jo('GET', '/state')).body.workspace.inviteCode;
r = await call()('POST', '/auth', { mode: 'join', workspace: 'M ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Phone', deviceId: 'd2' });
const sam = call(r.body.token);
const samId = (await jo('GET', '/state')).body.workspace.members.find((x) => x.name === 'Sam').id;
const today = new Date().toLocaleDateString('en-CA');

// ---- working out road miles from addresses ----
r = await sam('POST', '/mileage/calc', { from: '1 Shop Way', to: '5 A St' });
ok(r.status === 200 && r.body.meters === 10000 && r.body.mins === 20, 'road distance between two addresses: 10 km, 20 min');
r = await sam('POST', '/mileage/calc', { from: '1 Shop Way', to: '5 A St', roundTrip: true });
ok(r.body.meters === 20000, 'a round trip counts there and back');
r = await sam('POST', '/mileage/calc', { from: '1 Shop Way', to: 'Nowhere Lane' });
ok(r.status === 400 && /Nowhere Lane/.test(r.body.error), 'an address it can’t find says which one');

// ---- logging, seeing, changing ----
r = await sam('POST', '/mileage', { from: '1 Shop Way', to: '5 A St', purpose: 'Quote at Smith', meters: 10000, how: 'calc', roundTrip: false });
const s1 = r.body;
ok(r.status === 200 && s1.memberId === samId && s1.date === today && s1.how === 'calc', 'Sam logs a trip (today, worked out from the map)');
ok((await sam('POST', '/mileage', { purpose: 'nothing', meters: 0 })).status === 400, 'a trip needs a distance');
ok((await sam('POST', '/mileage', { meters: 5000, date: 'tuesday' })).status === 400, 'and a real day');
await jo('POST', '/mileage', { purpose: 'Bank', meters: Math.round(3 * MI), how: 'manual', date: '2026-01-15' });
r = await sam('GET', '/mileage');
ok(r.body.list.length === 1 && r.body.list[0].id === s1.id, 'Sam sees only his own trips');
ok((await sam('GET', '/mileage?member=' + (await jo('GET', '/state')).body.me.memberId)).body.list.every((x) => x.memberId === samId), 'even when he asks for someone else’s');
r = await jo('GET', '/mileage');
ok(r.body.list.length === 2 && r.body.rate === 70 && r.body.unit === 'mi' && r.body.maps === true, 'Jo (the owner) sees everyone’s, with the rate (70¢/mi to start)');
ok((await jo('GET', `/mileage?from=${today.slice(0, 7)}-01&to=${today}`)).body.list.length === 1, 'and can look at just this month');
ok((await sam('PATCH', '/mileage/' + s1.id, { purpose: 'Quote at the Smith job' })).body.purpose === 'Quote at the Smith job', 'Sam can change his trip');
const joTrip = (await jo('GET', '/mileage?from=2026-01-01&to=2026-01-31')).body.list[0];
ok((await sam('PATCH', '/mileage/' + joTrip.id, { meters: 1 })).status === 404 && (await sam('DELETE', '/mileage/' + joTrip.id)).status === 404, 'but not Jo’s');
r = await jo('POST', '/mileage', { memberId: samId, purpose: 'Logged for Sam', meters: 2000 });
ok(r.body.memberId === samId, 'an owner can log a trip for someone');
await jo('DELETE', '/mileage/' + r.body.id);

// ---- the rate and the CSV ----
ok((await sam('PATCH', '/workspace', { mileRate: 100 })).status === 403, 'only owners and admins set the rate');
r = await jo('PATCH', '/workspace', { mileRate: 72.5, mileUnit: 'mi' });
ok(r.body.settings.mileRate === 73 && r.body.settings.mileUnit === 'mi', 'Jo sets it (in cents)');
r = await jo('GET', '/mileage?csv=1');
ok(/text\/csv/.test(r.type) && r.text.includes('Quote at the Smith job') && r.text.includes('Map distance') && r.text.includes('Amount at 0.73/mi'), 'the CSV has each trip, how it was logged and the amount');
const lastLine = r.text.trim().split('\n').pop();
const miles = 10000 / MI + 3;
ok(lastLine.startsWith('Total') && lastLine.includes(miles.toFixed(1)) && lastLine.includes((miles * 0.73).toFixed(2)), 'with a total line: ' + lastLine);
ok((await call()('GET', '/mileage?csv=1')).status === 401, 'nobody signed out gets it');

// ---- a drive tracked on the map ----
r = await sam('POST', '/trips', { id: 'drv' + t, startedAt: Date.now() - 60000, kind: 'drive' });
ok(r.body.kind === 'drive', 'a tracked drive is kept as a drive, apart from canvassing runs');

// ---- in the app ----
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9337', `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
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




const A = await tab(B + '/');
await A.until(`!!document.querySelector('#loginLinks a')`);
await A.cmd('Browser.grantPermissions', { origin: B, permissions: ['geolocation'] });
const here = { lat: 33.4, lng: -111.9 };
await A.cmd('Emulation.setGeolocationOverride', { latitude: here.lat, longitude: here.lng, accuracy: 5 });
await A.ev(`(() => { document.querySelector('[data-mode=signin]').click(); const f = document.querySelector('#loginForm'); f.email.value = 'jo${t}@t.test'; f.password.value = 'longenough1'; f.requestSubmit(); return 1; })()`);
ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`, 12000), 'Jo is in the app');
await A.ev(`fetch('/api/workspace', { method: 'PATCH', headers: { authorization: 'Bearer ' + JSON.parse(localStorage.getItem('column.token')), 'content-type': 'application/json' }, body: JSON.stringify({ tools: { map: true, projects: true } }) }).then((r) => r.ok)`);
await sleep(800);
await A.click('#toolsBtn');
await sleep(200);
await A.ev(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent.startsWith('Map')).click()`);
ok(await A.until(`[...document.querySelectorAll('#tool .map-mode button')].some((b) => b.textContent === 'Mileage')`), 'the Map has a Mileage section');
await A.ev(`[...document.querySelectorAll('#tool .map-mode button')].find((b) => b.textContent === 'Mileage').click()`);
ok(await A.until(`document.querySelector('#tool .ml-big b')?.textContent.endsWith('mi') && document.querySelectorAll('#tool .map-row').length === 1`), 'it shows this month’s miles and trips: ' + await A.ev(`document.querySelector('#tool .ml-big')?.textContent`));
ok(await A.ev(`document.querySelector('#tool .ml-big').textContent.includes('$0.73/mi')`), 'and what they come to at the rate');
ok(await A.ev(`[...document.querySelectorAll('#tool .ml-people .chip')].length === 0`), 'no per-person split while only one person drove this month');

// Add a trip, working the miles out from the map
await A.ev(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent === '+ Add a trip').click()`);
ok(await A.until(`document.querySelector('#sheet:not(.hidden) h2')?.textContent.startsWith('Add a trip')`), 'Add a trip opens the form');
await A.ev(`(() => { const ins = document.querySelectorAll('#sheet input:not([type])'); ins[0].value = '1 Shop Way'; ins[1].value = 'Supply Yard'; ins[2].value = 'Lumber'; document.querySelector('#sheet input[type=checkbox]').click(); return 1; })()`);
await A.ev(`[...document.querySelectorAll('#sheet button')].find((b) => b.textContent.includes('Work out the miles')).click()`);
ok(await A.until(`document.querySelector('#sheet input[type=number]').value === (32000 / 1609.344).toFixed(1)`), 'Work out the miles fills in the road distance there and back: ' + await A.ev(`document.querySelector('#sheet input[type=number]').value`));
ok(await A.ev(`document.querySelector('#sheet .ml-note').textContent.includes('there and back')`), 'and says how long the drive is');
await A.ev(`[...document.querySelectorAll('#sheet .btns button')].pop().click()`);
await A.until(`document.querySelector('#sheet').classList.contains('hidden')`);
r = (await jo('GET', '/mileage?from=' + today + '&to=' + today)).body.list.find((x) => x.purpose === 'Lumber');
ok(r && r.how === 'calc' && r.roundTrip && r.meters === Math.round(Number((32000 / MI).toFixed(1)) * MI), 'saved as a round trip worked out from the map');

// Track a drive live: the phone moves 30 m a second along a street
await A.ev(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent.includes('Track my mileage')).click()`);
ok(await A.until(`[...document.querySelectorAll('#tool button')].some((b) => b.textContent === 'Stop and log miles')`), 'Track my mileage starts tracking');
for (let i = 1; i <= 12; i++) {
  await A.cmd('Emulation.setGeolocationOverride', { latitude: here.lat + i * 0.00027, longitude: here.lng, accuracy: 5 });
  await sleep(1000);
}
const shown = await A.ev(`document.querySelector('#tool .map-stats').textContent`);
ok(/^0\.\d mi · /.test(shown), 'the live counter shows the distance so far: ' + shown);
await A.ev(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent === 'Stop and log miles').click()`);
ok(await A.until(`document.querySelector('#sheet:not(.hidden) h2')?.textContent.startsWith('Add a trip') && Number(document.querySelector('#sheet input[type=number]').value) > 0.15`), 'stopping opens the form with the tracked distance: ' + await A.ev(`document.querySelector('#sheet input[type=number]')?.value`));
await A.ev(`(() => { document.querySelectorAll('#sheet input:not([type])')[2].value = 'Drive to the Jones job'; return 1; })()`);
await A.ev(`[...document.querySelectorAll('#sheet .btns button')].pop().click()`);
await A.until(`document.querySelector('#sheet').classList.contains('hidden')`);
r = (await jo('GET', '/mileage?from=' + today + '&to=' + today)).body.list.find((x) => x.purpose === 'Drive to the Jones job');
ok(r && r.how === 'gps' && r.tripId && r.meters > 250 && r.meters < 400, 'saved as a tracked drive, with its path: ' + (r && r.meters) + ' m');
const st = (await jo('GET', '/map')).body;
ok(st?.trips?.some((x) => x.id === r?.tripId && x.kind === 'drive' && x.path.length > 5), 'the drive’s path is kept, marked as a drive');
await A.ev(`[...document.querySelectorAll('#tool .map-mode button')].find((b) => b.textContent === 'Canvassing').click()`);
ok(await A.until(`!!document.querySelector('#tool .map-run')`) && !(await A.ev(`[...document.querySelectorAll('#tool .map-row')].some((x) => x.textContent.includes('0.2 mi') || x.textContent.includes('Jones'))`)), 'drives don’t show up as canvassing runs');

// A day's job route, logged as mileage in one tap (from the shop, two jobs, and back: 60 km)
const joId = (await jo('GET', '/state')).body.me.memberId;
await jo('PATCH', '/workspace', { base: '1 Shop Way' });
const pj = (await jo('POST', '/projects', { template: 'trades', trades: ['hvac'] })).body;
const job = async (name, address) => (await jo('POST', `/projects/${pj.id}/records`, { typeId: pj.types[0].id, values: { job: name, address } })).body;
const ja = await job('Job A', '10 A St'), jc = await job('Job C', '30 C St');
for (const [j, start] of [[ja, 540], [jc, 660]]) await jo('POST', `/records/${j.id}/visits`, { kind: 'Service', date: today, start, end: start + 60, memberIds: [joId] });
await A.ev(`[...document.querySelectorAll('#tool .map-mode button')].find((b) => b.textContent === 'Job routes').click()`);
ok(await A.until(`[...document.querySelectorAll('#tool button')].some((b) => b.textContent.includes('as mileage'))`, 8000), 'the day’s job route offers to log its miles: ' + await A.ev(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent.includes('as mileage'))?.textContent`));
await A.ev(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent.includes('as mileage')).click()`);
ok(await A.until(`document.querySelector('#sheet:not(.hidden)') && document.querySelector('#sheet input[type=number]').value === (60000 / 1609.344).toFixed(1)`), 'the form has the route’s road miles');
ok(await A.ev(`document.querySelectorAll('#sheet input:not([type])')[2].value.startsWith('Job visits:') && document.querySelector('#sheet input[type=checkbox]').checked`), 'with what it was for (the jobs) and as a round trip from the shop');
await A.ev(`[...document.querySelectorAll('#sheet .btns button')].pop().click()`);
await A.until(`document.querySelector('#sheet').classList.contains('hidden')`);
r = (await jo('GET', '/mileage?from=' + today + '&to=' + today + '&member=' + joId)).body.list.filter((x) => x.how === 'route');
ok(r.length === 1 && r[0].routeDate === today && r[0].from === '1 Shop Way', 'saved as the day’s job route');
await A.ev(`[...document.querySelectorAll('#tool .map-mode button')].find((b) => b.textContent === 'Job routes').click()`);
await A.until(`[...document.querySelectorAll('#tool button')].some((b) => b.textContent.includes('as mileage'))`, 8000);
await A.ev(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent.includes('as mileage')).click()`);
ok(await A.until(`document.querySelector('#sheet:not(.hidden) h2')?.textContent === 'Trip'`), 'logging the same day again opens that trip instead of a second one');
await A.ev(`document.querySelector('#sheet h2 .icon-btn').click()`);

// /miles in a chat box
await A.ev(`document.querySelector('#tool h2 .icon-btn').click()`);
await A.click('#tabs [data-tab=chat]');
await A.until(`!!document.querySelector('#chat textarea')`);
await A.ev(`(() => { const ta = [...document.querySelectorAll('#chat textarea')].find((x) => x.offsetParent); ta.focus(); return 1; })()`);
await A.cmd('Input.insertText', { text: '/miles 12 bank run' });
await A.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
await A.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
ok(await A.until(`document.querySelector('#sheet:not(.hidden) h2')?.textContent.startsWith('Add a trip') && document.querySelector('#sheet input[type=number]').value === '12.0' && document.querySelectorAll('#sheet input:not([type])')[2].value === 'bank run'`), '/miles 12 bank run opens the form filled in: ' + await A.ev(`document.querySelector('#sheet input[type=number]')?.value + ' / ' + document.querySelectorAll('#sheet input:not([type])')[2]?.value`));
ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
A.close();
chrome.kill();
srv.kill();
fake.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
