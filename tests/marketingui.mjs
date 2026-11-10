import * as FS from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import WebSocket from '../server/node_modules/ws/index.js';
// The Marketing Manager in the browser: connecting Postiz in Settings (a wrong key is refused, the channels show),
// the fourth agent on Your team, a win-back assignment with a campaign, a picture shown in the steps, a post draft
// with its channels, picture and time to change before scheduling it, Undo taking it back out of Postiz, an email
// campaign draft that names who it goes to (never anyone marked do not contact) and lets you leave people out,
// the monthly schedule label, and a phone-sized screen.
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/marketingui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4713, APP = `http://127.0.0.1:${PORT}/`, FAKE = 4712, F = `http://127.0.0.1:${FAKE}`;
const SHOTS = process.env.SHOTS || '';
const launch = (port, dir) => spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${S}/dk/${dir}`, '--no-first-run', '--window-size=1300,900', 'about:blank'], { stdio: 'ignore' });
FS.rmSync(`${S}/dk/chrome6`, { recursive: true, force: true }); // a fresh profile, never one a closing Chrome still holds
const chrome = launch(9338, 'chrome6');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url, port = 9338) {
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





// ----- stand-ins: Claude (scripted), OpenAI images, Gemini images, Postiz -----
const seen = { asked: [], images: [], pz: [] };
const text = (c) => (typeof c === 'string' ? c : (c || []).map((b) => b.text || (b.type === 'tool_result' ? b.content : '')).join(' '));
let today = '';
const ids = {};
const SCRIPTS = {
  'what is working': (n) => [[['marketing_snapshot', { days: 365 }]], 'Website brings the most work.'][n],
  'win-back campaign': (n) => [
    [['find_customers', { who: 'past', need: 'email' }], ['list_channels', {}]],
    [['create_campaign', { name: 'Fall win-back', brief: 'Past customers, a check-in and a reason to come back. Success: 5 booked estimates.', start: today, goals: [{ title: 'Booked estimates', kind: 'count', target: 5 }, { title: 'Get it out', tasks: [{ text: 'Call anyone who opens but doesn’t book', due: today, assignee: 'Ben' }] }] }]],
    [['make_list', { campaign: 'Fall win-back', name: 'Past customers', contact_ids: ids.past }], ['make_image', { prompt: 'A sunlit living room with new roller shades, warm afternoon light, photo style', title: 'Win-back picture', shape: 'square' }]],
    [['draft_social_post', { channels: ['Facebook', 'Instagram'], text: 'Fall light is here. Time to check your shades?', image_id: ids.img, when: ids.when }], ['draft_social_post', { channels: ['Instagram'], text: 'No picture post' }], ['draft_email_campaign', { campaign: 'Fall win-back', contact_ids: [...ids.past, ids.dnc], subject: 'Checking in on your shades', body: 'Hi {First name},\n\nIt’s been a while since we put in your shades. Want us to take a look this fall?\n\nAda' }]],
    'Campaign set up; a post and an email are waiting for you.',
  ][n],
  'gemini picture': (n) => [[['make_image', { prompt: 'A storefront with awnings', title: 'Storefront', shape: 'landscape' }]], 'Made it.'][n],
  'claude only picture': (n) => [[['make_image', { prompt: 'Anything' }]], 'Could not.'][n],
};
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const out = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const u = new URL(req.url, F);
    // Postiz
    if (u.pathname.startsWith('/pz/public/v1')) {
      const p = u.pathname.slice('/pz/public/v1'.length);
      seen.pz.push({ method: req.method, p, auth: req.headers.authorization, body: req.headers['content-type']?.includes('json') ? JSON.parse(raw.toString() || 'null') : raw.length });
      if (req.headers.authorization !== 'pz-good-key-123') return out(401, { message: 'Unauthorized' });
      if (p === '/integrations') return out(200, [
        { id: 'fb1', name: 'Premier Shades', identifier: 'facebook', picture: 'https://x.test/a.png', disabled: false, profile: 'premier' },
        { id: 'ig1', name: 'premiershades', identifier: 'instagram', picture: '', disabled: false, profile: 'premiershades' },
        { id: 'gm1', name: 'Premier Shade Solutions', identifier: 'gmb', picture: '', disabled: false, profile: '' },
        { id: 'yt1', name: 'Premier TV', identifier: 'youtube', picture: '', disabled: false, profile: '' },
      ]);
      if (p === '/upload' && req.method === 'POST') return out(200, { id: 'm1', path: 'https://uploads.postiz.test/m1.png', status: 'ready' });
      if (p === '/posts' && req.method === 'POST') { const j = JSON.parse(raw.toString()); return out(200, j.posts.map((x, i) => ({ postId: 'p' + (seen.pz.length * 10 + i), integration: x.integration.id }))); }
      if (p === '/posts' && req.method === 'GET') return out(200, { posts: [{ id: 'p1', content: '<p>Hello</p>', publishDate: new Date().toISOString(), state: 'PUBLISHED', error: null, integration: { id: 'fb1', providerIdentifier: 'facebook', name: 'Premier Shades' } }, { id: 'p2', content: 'Oops', publishDate: new Date().toISOString(), state: 'ERROR', error: 'Token expired', integration: { id: 'ig1', providerIdentifier: 'instagram', name: 'premiershades' } }] });
      if (p.startsWith('/posts/') && req.method === 'DELETE') return out(200, { id: p.slice(7) });
      return out(404, { message: 'nope' });
    }
    // OpenAI images
    if (u.pathname === '/oa/models') return out(200, { data: [{ id: 'gpt-4o' }, { id: 'gpt-image-1' }, { id: 'gpt-image-2.6-sunburst' }, { id: 'gpt-image-2.6-mini' }, { id: 'dall-e-3' }] });
    if (u.pathname === '/oa/images/generations') { const j = JSON.parse(raw.toString()); seen.images.push({ who: 'openai', ...j, auth: req.headers.authorization }); return out(200, { data: [{ b64_json: PNG.toString('base64') }] }); }
    // Gemini images
    if (u.pathname === '/gm/v1beta/models') return out(200, { models: [{ name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3-pro-image', supportedGenerationMethods: ['generateContent'] }, { name: 'models/imagen-4', supportedGenerationMethods: ['predict'] }, { name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent'] }] });
    if (u.pathname.startsWith('/gm/v1beta/models/') && u.pathname.endsWith(':generateContent')) { const j = JSON.parse(raw.toString()); seen.images.push({ who: 'gemini', model: decodeURIComponent(u.pathname.split('/')[4].split(':')[0]), ...j }); return out(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] }); }
    // Anthropic
    if (u.pathname.startsWith('/v1/models')) return out(200, { data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false });
    const j = JSON.parse(raw.toString());
    const sys = typeof j.system === 'string' ? j.system : JSON.stringify(j.system);
    const msgs = j.messages;
    seen.asked.push({ sys, msgs: JSON.stringify(msgs), tools: (j.tools || []).map((t) => t.name) });
    const reply = (content, stop = 'end_turn') => out(200, { id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user' && typeof m.content === 'string');
    const key = Object.keys(SCRIPTS).find((k) => text(lastUser?.content).toLowerCase().includes(k));
    const n = msgs.length - 1 - msgs.lastIndexOf(lastUser);
    // Remember what earlier tool calls returned (the picture's id), for later turns.
    const lastRes = msgs.at(-1)?.role === 'user' && Array.isArray(msgs.at(-1).content) ? msgs.at(-1).content.map((b) => b.content).join(' ') : '';
    const m = lastRes.match(/"id":"([^"]+)","note":"Use this id/);
    if (m) ids.img = m[1];
    const step = key ? SCRIPTS[key](Math.floor(n / 2), sys) : 'Done.';
    if (typeof step === 'string' || !step) return reply([{ type: 'text', text: step || 'Done.' }]);
    reply([{ type: 'text', text: 'Working.' }, ...step.map(([name, input], i) => ({ type: 'tool_use', id: `tu_${n}_${i}`, name, input }))], 'tool_use');
  });
});
await new Promise((r) => fake.listen(FAKE, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', ALLOW_LOCAL_WEBHOOKS: '1', ANTHROPIC_BASE_URL: F, OPENAI_BASE_URL: F + '/oa', GEMINI_BASE_URL: F + '/gm', POSTIZ_URL: F + '/pz/public/v1', POSTIZ_CLIENT_ID: 'pca_test', POSTIZ_CLIENT_SECRET: 'pcs_test', POSTIZ_AUTHORIZE_URL: F + '/pzauth/authorize', POSTIZ_TOKEN_URL: F + '/pz/oauth/token' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
today = new Date().toLocaleDateString('en-CA');
const t = Date.now();
const auth = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Premier ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
const api = async (m, p, body) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.token }, body: body ? JSON.stringify(body) : undefined })).json();
await api('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
await api('PUT', '/ai/keys/openai', { key: 'sk-openai-test-key-1234567890' });
await api('PATCH', '/workspace', { tools: { projects: true } });
// Past customers: Maria (a won deal) and Sam (a job), 14 months ago; Dee is do not contact.
const C = async (name, email, source, extra = {}) => api('POST', '/contacts', { name, email, source, ...extra });
const maria = await C('Maria Lopez', 'maria@lopez.test', 'Website');
const sam = await C('Sam Ortiz', 'sam@ortiz.test', 'Referral');
const dnc = await C('Dee Nope', 'dee@nope.test', 'Website', { dne: true });
const jobs = await api('POST', '/projects', { template: 'jobs', name: 'Installs' });
const jt = jobs.types.find((x) => x.key === 'jobs'), ct = jobs.types.find((x) => x.key === 'clients');
const ago14 = new Date(Date.now() - 425 * 864e5).toISOString().slice(0, 10);
for (const [n, e] of [['Maria Lopez', 'maria@lopez.test'], ['Sam Ortiz', 'sam@ortiz.test']]) {
  const cl = await api('POST', `/projects/${jobs.id}/records`, { typeId: ct.id, values: { name: n, email: e } });
  await api('POST', `/projects/${jobs.id}/records`, { typeId: jt.id, values: { job: n + ' shades', client: [cl.id], install_date: ago14 } });
}
ids.past = [maria.id, sam.id];
ids.dnc = dnc.id;
ids.when = `${new Date(Date.now() + 3 * 864e5).toLocaleDateString('en-CA')} 09:30`;
const shot = async (A, n) => { if (!SHOTS) return; await sleep(600); const r = await A.cmd('Page.captureScreenshot', { format: 'png' }); FS.writeFileSync(`${SHOTS}/${n}.png`, Buffer.from(r.result.data, 'base64')); };
let A;
try {
  A = await tab(APP);
  await A.ev(`localStorage.setItem('column.token', JSON.stringify(${JSON.stringify(auth.token)})); location.reload(); true`).catch(() => {});
  await sleep(1200);
  ok(await A.until(`!document.querySelector('#app').classList.contains('hidden')`, 20000), 'Ada is in');

  // ----- Postiz in Settings → Connections -----
  await A.click('#settingsBtn');
  await A.until(`!!document.querySelector('#settings')`);
  await A.ev(`(() => { const b = [...document.querySelectorAll('#settings button, #settings [role=tab]')].find((x) => /Connections/.test(x.textContent)); b && b.click(); return true; })()`);
  ok(await A.until(`!!document.querySelector('#settings .pz-sec input[type=password]')`), 'Settings → Connections has Social posts (Postiz)');
  ok(await A.ev(`[...document.querySelectorAll('#settings .pz-sec button')].some((b) => b.textContent === 'Connect with Postiz') && !document.querySelector('#settings .pz-sec details').open && document.querySelector('#settings .pz-sec details summary').textContent.includes('API key instead')`), 'with Kloomie’s Postiz app set up: Connect with Postiz first, and an API key tucked underneath');
  await A.ev(`document.querySelector('#settings .pz-sec details').open = true`);
  await A.ev(`(() => { document.querySelector('#settings .pz-sec input[type=password]').value = 'pz-wrong-key-999'; [...document.querySelectorAll('#settings .pz-sec button')].find((b) => b.textContent === 'Connect Postiz').click(); return true; })()`);
  ok(await A.until(`[...document.querySelectorAll('.toast, #toast')].some((x) => /didn’t accept the API key/.test(x.textContent))`), 'a wrong key is refused, with why');
  await A.until(`[...document.querySelectorAll('#settings .pz-sec button')].some((b) => b.textContent === 'Connect Postiz' && !b.disabled)`);
  await A.ev(`(() => { document.querySelector('#settings .pz-sec input[type=password]').value = 'pz-good-key-123'; [...document.querySelectorAll('#settings .pz-sec button')].find((b) => b.textContent === 'Connect Postiz').click(); return true; })()`);
  ok(await A.until(`document.querySelectorAll('#settings .pz-chan').length === 3`), 'connected: Facebook, Instagram and the Google profile show as channels');
  ok(await A.ev(`document.querySelector('#settings .pz-sec').textContent.includes('Premier TV (youtube)') && document.querySelector('#settings .pz-sec').textContent.includes('key ending -123')`), 'YouTube is listed as not posted to; the key shows only its end');
  await shot(A, 'mk-postiz');
  await A.ev(`document.querySelector('#settings').classList.add('hidden')`);

  // ----- The Marketing Manager -----
  await A.click('#tabs [data-tab=agents]');
  ok(await A.until(`document.querySelectorAll('#tool .ag-card').length === 4 && [...document.querySelectorAll('#tool .ag-card b')].pop().textContent === 'Marketing Manager'`), 'Your team has a fourth specialist, the Marketing Manager');
  await A.ev(`[...document.querySelectorAll('#tool .ag-card')][3].click()`);
  await A.until(`document.querySelector('#tool .ag-prof-h b')?.textContent === 'Marketing Manager'`);
  ok(await A.ev(`[...document.querySelectorAll('#tool .ag-wfs .chip')].map((b) => b.textContent).join('|') === 'Monthly marketing plan|Build a campaign…|Win back past customers|Reviews & referrals|Content week|Neighbor blitz…|What’s working'`), 'its workflows: plan, campaign, win-back, reviews, content week, neighbor blitz, what’s working');
  ok(await A.ev(`document.querySelector('#tool .ag-tools').textContent.includes('Draft social and Google posts') && document.querySelector('#tool .ag-tools').textContent.includes('Always asks you first')`), 'its overview says what it can use and what always waits for a yes');
  await shot(A, 'mk-profile');
  await A.ev(`[...document.querySelectorAll('#tool .ag-wfs .chip')].find((b) => b.textContent === 'Win back past customers').click()`);
  ok(await A.until(`document.querySelector('#tool .ag-run-h .ag-chip')?.textContent === 'Needs your yes'`, 15000), 'Win back past customers runs, and waits for a yes');
  ok(await A.ev(`[...document.querySelectorAll('#tool .ag-step.act')].some((s) => s.textContent.includes('Campaign: Fall win-back with 2 goals') && s.classList.contains('s-done'))`), 'it started the campaign');
  ok(await A.ev(`!!document.querySelector('#tool .ag-step.act img.ag-pic')`), 'the picture it made shows in its step');
  ok(await A.ev(`[...document.querySelectorAll('#tool .ag-step.act.s-failed')].some((s) => s.textContent.includes('Instagram posts need a picture'))`), 'the post it got wrong shows as sent back, with why');
  // The post draft
  ok(await A.ev(`!!document.querySelector('#tool .ag-step.post')`), 'a post draft');
  const chips = await A.ev(`[...document.querySelectorAll('#tool .ag-step.post .ag-chans .chip')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : ''))`);
  ok(chips.join('|') === 'Facebook · Premier Shades*|Instagram · premiershades*|Google Business Profile · Premier Shade Solutions', 'with Facebook and Instagram picked, and the Google profile there to add: ' + chips.join(' | '));
  ok(await A.ev(`!!document.querySelector('#tool .ag-step.post .ag-post-pic img') && document.querySelector('#tool .ag-step.post select').value === 'at' && document.querySelector('#tool .ag-step.post input[type=datetime-local]').value.endsWith('T09:30')`), 'its picture, and scheduled for 9:30 as drafted');
  await shot(A, 'mk-post');
  await A.ev(`(() => { const p = document.querySelector('#tool .ag-step.post'); const t = p.querySelector('textarea'); t.value = 'Fall light is here. Want your shades checked?'; t.dispatchEvent(new Event('input')); const d = p.querySelector('input[type=datetime-local]'); d.value = d.value.replace('T09:30', 'T11:15'); [...p.querySelectorAll('.ag-chans .chip')][2].click(); return true; })()`);
  ok(await A.ev(`document.querySelector('#tool .ag-step.post .ag-step-act .primary-btn').textContent === 'Schedule'`), 'the button says Schedule');
  await A.ev(`document.querySelector('#tool .ag-step.post .ag-step-act .primary-btn').click()`);
  ok(await A.until(`!document.querySelector('#tool .ag-step.post') && [...document.querySelectorAll('#tool .ag-step.act.s-done')].some((s) => s.textContent.includes('Post to'))`), 'scheduled: the draft becomes a done step');
  const sent = seen.pz.filter((y) => y.p === '/posts' && y.method === 'POST').at(-1)?.body;
  ok(sent?.type === 'schedule' && sent.posts.length === 3 && sent.posts.every((y) => y.value[0].content === 'Fall light is here. Want your shades checked?') && sent.posts.find((y) => y.integration.id === 'gm1').settings.__type === 'gmb', 'Postiz got the edited words for all three channels, the Google profile included');
  ok(new Date(sent.date).getHours() === 11 && new Date(sent.date).getMinutes() === 15, 'at the new time, 11:15');
  await A.ev(`[...[...document.querySelectorAll('#tool .ag-step.act.s-done')].find((s) => s.textContent.includes('Post to')).querySelectorAll('button')].find((b) => b.textContent === 'Undo').click()`);
  ok(await A.until(`[...document.querySelectorAll('#tool .ag-step.act.s-undone')].some((s) => s.textContent.includes('Post to'))`) && seen.pz.some((y) => y.method === 'DELETE'), 'Undo takes the scheduled post back out of Postiz');
  // The email campaign draft
  const to = await A.ev(`[...document.querySelectorAll('#tool .ag-who .chip')].map((c) => c.textContent.replace('×', ''))`);
  ok(to.join('|') === 'Maria Lopez|Sam Ortiz', 'the email campaign names who it goes to (not Dee): ' + to.join(', '));
  ok(await A.ev(`document.querySelector('#tool .ag-step.email:not(.post) .ag-email-h').textContent.includes('1 left out')`), 'and says one was left out');
  await A.ev(`[...document.querySelectorAll('#tool .ag-who .chip')][1].querySelector('.ag-x').click()`);
  ok(await A.ev(`[...document.querySelectorAll('#tool .ag-step.email:not(.post) button')].some((b) => b.textContent === 'Send to 1')`), 'leaving Sam out: Send to 1');
  await shot(A, 'mk-email');
  await A.ev(`[...document.querySelectorAll('#tool .ag-step.email:not(.post) button')].find((b) => b.textContent === 'Send to 1').click()`);
  ok(await A.until(`[...document.querySelectorAll('#tool .ag-step.act.s-failed')].some((s) => /Confirm your email|Connect Outlook or Gmail/.test(s.textContent))`), 'sending goes through the usual checks, and the step says what’s missing');
  // Open the picture
  await A.ev(`document.querySelector('#tool .ag-step.act img.ag-pic').click()`);
  ok(await A.until(`!document.querySelector('#preview').classList.contains('hidden')`), 'the picture opens in the viewer');
  await A.key('Escape');
  await sleep(300);
  // The monthly schedule
  await A.click('#tabs [data-tab=agents]');
  await A.until(`!!document.querySelector('#tool')`);
  for (let i = 0; i < 3 && await A.ev(`!!document.querySelector('#tool .ag-back')`); i++) { await A.ev(`document.querySelector('#tool .ag-back').click()`); await sleep(200); }
  await A.ev(`[...document.querySelectorAll('#tool .ag-card')][3]?.click()`);
  await A.until(`document.querySelector('#tool .ag-prof-h b')?.textContent === 'Marketing Manager'`);
  await A.ev(`[...document.querySelectorAll('#tool .ag-tabs button')].find((b) => b.textContent === 'Schedules').click()`);
  ok(await A.until(`[...document.querySelectorAll('#tool .ag-sched')].some((s) => s.textContent.includes('Monthly marketing plan') && s.textContent.includes('first week of the month'))`), 'the monthly plan’s schedule says it runs in the first week of the month');
  // Phone
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 375, height: 800, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  ok(await A.ev(`document.documentElement.scrollWidth <= innerWidth && document.querySelector('#tool').scrollWidth <= document.querySelector('#tool').clientWidth + 1`), 'nothing runs off the side on a phone');
  ok(A.errors.length === 0, 'no script errors' + (A.errors.length ? ': ' + A.errors.join(' | ') : ''));
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
A?.close();
chrome.kill();
srv.kill();
fake.close();
if (fails) console.log(srv.log.split('\n').filter((l) => /error|fail/i.test(l)).slice(-15).join('\n'));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
