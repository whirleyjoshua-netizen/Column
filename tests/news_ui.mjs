// News in a real browser (headless Chrome): turned on in Settings → General (a card on Home); the tab shows articles as text with
// safe links and pictures through the server; 👍 and 👎 work (👎 takes it out, with undo); searching keeps the
// cursor in the box; Topics & sources adds a topic, a word to follow and your own site; What it learned shows
// what it took; Home gets a "News for you" card that opens News; it fits a phone.
import * as FS from 'node:fs';
import http from 'node:http';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/news_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4962, FEED = 4964, CDP = 9526, APP = `http://127.0.0.1:${PORT}/`, F = `http://127.0.0.1:${FEED}`;
const ago = (h) => new Date(Date.now() - h * 3600_000).toUTCString();
const rss = (title, items) => `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>${title}</title>${items.map((x) => `<item><title>${x.t}</title><link>${x.l}</link><description>${x.d || ''}</description><pubDate>${ago(x.h ?? 1)}</pubDate>${x.img ? `<media:thumbnail url="${x.img}"/>` : ''}</item>`).join('')}</channel></rss>`;
// A real 1×1 PNG, so the browser can draw it.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const FEEDS = {
  '/top.xml': () => rss('Top Wire', [
    { t: 'Heat pump rebates expand for homeowners', l: F + '/a/heat', d: 'States add money for heat pumps.', h: 2, img: F + '/pic.png' },
    { t: 'Celebrity chef opens new place', l: F + '/a/chef', d: 'Fans line up.', h: 1.5 },
    { t: '<![CDATA[<img src=x onerror="window.PWNED=1">Storm <b>closes</b> highways]]>', l: F + '/a/storm', d: '<![CDATA[<script>window.PWNED=2</script>Roads shut.]]>', h: 0.5 },
  ]),
  '/biz.xml': () => rss('Biz Daily', [{ t: 'Small firms see higher insurance costs', l: F + '/b/ins', d: 'Premiums up.', h: 4 }]),
  '/hvac.xml': () => rss('HVAC Wire', [{ t: 'Refrigerant rules change in January', l: F + '/h/refrig', d: 'What techs need to know.', h: 30 }, { t: 'Cold climate heat pump units arrive', l: F + '/h/cold', d: 'New models.', h: 8 }]),
  '/local.xml': () => rss('Valley Local News', [{ t: 'Permit office moves to new hours', l: F + '/l/permit', d: 'Local permits.', h: 1 }]),
};
const fake = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (FEEDS[u]) { res.setHeader('content-type', 'application/rss+xml'); return res.end(FEEDS[u]()); }
  if (u === '/site.html') { res.setHeader('content-type', 'text/html'); return res.end('<html><head><link rel="alternate" type="application/rss+xml" href="/local.xml"></head></html>'); }
  if (u === '/pic.png') { res.setHeader('content-type', 'image/png'); return res.end(PNG); }
  // Stands in for Anthropic, for the free brief on Kloomie's key.
  if (u === '/v1/messages') { req.resume(); return req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: JSON.stringify({ brief: '- First story in brief [1]', used: [1] }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } })); }); }
  res.statusCode = 404; res.end('no');
});
await new Promise((r) => fake.listen(FEED, '127.0.0.1', r));
const TOPICS = [
  { id: 'top', label: 'Top stories', group: 'News', feeds: [{ name: 'Top Wire', url: F + '/top.xml' }] },
  { id: 'business', label: 'Business', group: 'Business', feeds: [{ name: 'Biz Daily', url: F + '/biz.xml' }] },
  { id: 'smallbiz', label: 'Small business', group: 'Business', feeds: [] },
  { id: 'tech', label: 'Technology', group: 'Science & tech', feeds: [] },
  { id: 'hvac', label: 'HVAC', group: 'Trades', feeds: [{ name: 'HVAC Wire', url: F + '/hvac.xml' }] },
];
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1', KLOOMIE_AI_KEY: 'sk-ant-house-ui-test', ANTHROPIC_BASE_URL: F, ALLOW_LOCAL_FETCH: '1', NEWS_TEST_TOPICS: JSON.stringify(TOPICS) }, stdio: 'ignore' });
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
  const type = async (s) => { for (const ch of s) { await cmd('Input.insertText', { text: ch }); await sleep(25); } };
  return { ev, until, tap, type, cmd, errors };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'News ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');
  ok(await A.ev(`!document.querySelector('#tabs [data-tab=news]') && !document.querySelector('#home .home-card.news')`), 'News is off until you turn it on: no tab, no Home card');

  // Turn it on in Settings → General (News lives on Home, not in the toolbar, since 2026-11-14).
  await A.tap(`document.querySelector('#settingsBtn')`);
  await A.until(`[...document.querySelectorAll('#settings .srow')].some((r) => r.textContent.startsWith('News on Home'))`);
  await A.ev(`[...document.querySelectorAll('#settings .srow')].find((r) => r.textContent.startsWith('News on Home')).querySelector('input').click(); true`);
  await A.ev(`document.querySelector('#settings [aria-label=Close]').click(); true`);
  ok(!(await A.ev(`!!document.querySelector('#tabs [data-tab=news]')`)), 'News stays out of the toolbar');
  ok(await A.until(`!!document.querySelector('#home .home-card.news') && document.querySelectorAll('#home .home-card.news .nw-hrow').length >= 3`, 15000), 'Home gets a “News for you” card with the top stories');
  await A.tap(`[...document.querySelectorAll('#home .home-card.news button')].find((b) => b.textContent.includes('Open News'))`);
  ok(await A.until(`document.querySelectorAll('#tool .nw-item').length >= 4`, 15000), 'the News tab lists articles');
  const shape = await A.ev(`(() => { const items = [...document.querySelectorAll('#tool .nw-item')]; const links = [...document.querySelectorAll('#tool a')];
    return { scripts: document.querySelectorAll('#tool script, #tool [onerror]').length, pwned: window.PWNED || 0,
      storm: items.map((x) => x.querySelector('.nw-title').textContent).find((x) => /Storm/.test(x)),
      safe: links.every((l) => /^https?:/.test(l.href) && l.target === '_blank' && /noopener/.test(l.rel) && /noreferrer/.test(l.rel)),
      chips: [...document.querySelectorAll('#tool .nw-chip')].map((x) => x.textContent) }; })()`);
  ok(shape.scripts === 0 && shape.pwned === 0, `what a feed sends never runs (${JSON.stringify(shape)})`);
  ok(shape.storm === 'Storm closes highways', 'a title with markup shows as plain words');
  ok(shape.safe, 'article links open in a new tab, without telling the site where you came from');
  ok(JSON.stringify(shape.chips) === JSON.stringify(['For you', 'Top stories', 'Business', 'Small business', 'Technology', '★ Saved']), `topic chips (${shape.chips})`);
  ok(await A.until(`(() => { const i = document.querySelector('#tool .nw-img'); return i && i.complete && i.naturalWidth === 1 && new URL(i.src).host === location.host; })()`), 'the picture loads through Kloomie, not from the publisher');
  ok(await A.ev(`!!document.querySelector('#tool .nw-hint') && /learns/.test(document.querySelector('#tool .nw-hint').textContent)`), 'a first-time hint says how it learns');

  // 👍 and 👎
  const row = (re) => `[...document.querySelectorAll('#tool .nw-item')].find((x) => ${re}.test(x.querySelector('.nw-title').textContent))`;
  await A.tap(`${row('/Heat pump/')}.querySelector('.nw-like')`);
  ok(await A.until(`${row('/Heat pump/')}.querySelector('.nw-like').classList.contains('on') && ${row('/Heat pump/')}.querySelector('.nw-like').getAttribute('aria-pressed') === 'true'`), '👍 marks it liked');
  await A.tap(`${row('/Celebrity/')}.querySelector('.nw-nope')`);
  ok(await A.until(`!${row('/Celebrity/')}`), '👎 takes it out of the list');
  ok(await A.until(`[...document.querySelectorAll('#toasts .toast button')].some((b) => b.textContent === 'Undo')`), 'with an Undo');
  await A.tap(`[...document.querySelectorAll('#toasts .toast button')].find((b) => b.textContent === 'Undo')`);
  ok(await A.until(`!!${row('/Celebrity/')}`), 'Undo brings it back');

  // Search keeps the cursor in the box while the list redraws.
  await A.tap(`document.querySelector('#tool .nw-q')`);
  await A.type('insur');
  ok(await A.until(`document.querySelectorAll('#tool .nw-item').length === 1 && /insurance/.test(document.querySelector('#tool .nw-title').textContent)`), 'search narrows the list');
  ok(await A.ev(`document.activeElement === document.querySelector('#tool .nw-q') && document.activeElement.value === 'insur'`), 'and the cursor stays in the search box');
  await A.ev(`(() => { const s = document.querySelector('#tool .nw-q'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await A.until(`document.querySelectorAll('#tool .nw-item').length >= 4`);

  // Topics & sources: add HVAC, follow "refrigerant", add your own site.
  await A.tap(`document.querySelector('#tool .nw-topics-btn')`);
  ok(await A.until(`!!document.querySelector('#sheet .nw-pick [data-topic=hvac]')`), 'Topics & sources lists topics by group');
  await A.tap(`document.querySelector('#sheet [data-topic=hvac]')`);
  await A.tap(`document.querySelector('#sheet .nw-follow')`);
  await A.type('refrigerant');
  await A.tap(`document.querySelector('#sheet .nw-add-url')`);
  await A.type(F + '/site.html');
  await A.tap(`document.querySelector('#sheet .nw-add-btn')`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .nw-site b')].some((b) => b.textContent === 'Valley Local News')`, 12000), 'your own site is found from its page and listed by name');
  await A.tap(`document.querySelector('#sheet .primary-btn')`);
  ok(await A.until(`[...document.querySelectorAll('#tool .nw-chip')].some((c) => c.textContent === 'HVAC') && [...document.querySelectorAll('#tool .nw-chip')].some((c) => c.textContent === 'My sites')`), 'HVAC and My sites become chips');
  ok(await A.until(`/Refrigerant/.test(document.querySelector('#tool .nw-item .nw-title')?.textContent)`, 12000), 'a followed word comes first, even a day-old story');
  ok(await A.ev(`[...document.querySelectorAll('#tool .nw-title')].some((x) => /Permit office/.test(x.textContent))`), 'your own site’s news is in For you');
  await A.tap(`[...document.querySelectorAll('#tool .nw-chip')].find((c) => c.textContent === 'HVAC')`);
  ok(await A.until(`document.querySelectorAll('#tool .nw-item').length === 2 && [...document.querySelectorAll('#tool .nw-meta b')].every((b) => b.textContent === 'HVAC Wire')`), 'a chip shows just that topic');

  // Save, then the Saved chip.
  await A.tap(`${row('/Cold climate/')}.querySelector('.nw-save')`);
  await A.tap(`[...document.querySelectorAll('#tool .nw-chip')].find((c) => c.textContent === '★ Saved')`);
  ok(await A.until(`document.querySelectorAll('#tool .nw-item').length === 1 && /Cold climate/.test(document.querySelector('#tool .nw-title').textContent)`), 'saved for later, under ★ Saved');

  // What it learned
  await A.tap(`document.querySelector('#tool .nw-learned-btn')`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .nw-lchip.up')].some((c) => /heat/.test(c.textContent))`), 'What it learned shows the words from what you liked');
  await A.tap(`document.querySelector('#sheet .nw-reset')`);
  await A.tap(`document.querySelector('#sheet .nw-reset')`);
  ok(await A.until(`!document.querySelector('#sheet .nw-lchip.up') && /Nothing yet/.test(document.querySelector('#sheet .nw-learned').textContent)`), 'Start over (tapped twice to confirm) forgets it');
  await A.ev(`document.querySelector('#sheet .icon-btn')?.click(); true`);

  // Home card opens News.
  await A.tap(`document.querySelector('#tabs [data-tab=home]')`);
  await A.tap(`[...document.querySelectorAll('#home .home-card.news button')].find((b) => b.textContent === 'Open News')`);
  ok(await A.until(`!document.querySelector('#tool').classList.contains('hidden') && !!document.querySelector('#tool .nw')`), '“Open News” on the Home card opens the tab');

  // Brief me, with no AI key of your own: free from Kloomie, and it says how many are left today.
  await A.tap(`document.querySelector('#tool .nw-brief-btn')`);
  ok(await A.until(`/First story in brief/.test(document.querySelector('#tool .nw-brief')?.textContent || '')`), 'Brief me works without your own AI key');
  ok(await A.ev(`document.querySelector('#tool .nw-free')?.textContent.includes('2 more today')`), 'and says it’s free from Kloomie, with 2 more today');

  // A phone
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await A.tap(`[...document.querySelectorAll('#tool .nw-chip')].find((c) => c.textContent === 'For you')`);
  await A.until(`document.querySelectorAll('#tool .nw-item').length >= 4`);
  await sleep(400);
  const phone = await A.ev(`(() => { const items = [...document.querySelectorAll('#tool .nw-item')]; const w = innerWidth;
    return { over: document.documentElement.scrollWidth - w, wide: items.filter((x) => x.getBoundingClientRect().right > w + 1).length, tapH: Math.min(...[...document.querySelectorAll('#tool .nw-acts button')].map((b) => b.getBoundingClientRect().height)) }; })()`);
  ok(phone.over <= 0 && phone.wide === 0, `it fits a phone (${JSON.stringify(phone)})`);
  ok(phone.tapH >= 30, 'buttons are big enough to tap');
  ok(!A.errors.length, 'no script errors: ' + A.errors.join(' | ').slice(0, 300));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
}
srv.kill();
chrome.kill();
fake.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
