// The page after connecting an app (2026-11-20, the owner: "can it be cleaner"): GitHub's /github/done is Kloomie's
// own page now: the mark, ✓ / … / !, the title and message as text, Back to Kloomie, light and dark, and a policy
// that allows no scripts. Unknown answers fall back to "Not connected".
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { donePage } from '../server/donepage.js';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/donepage';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4895, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
try {
  let r = await fetch(B + '/github/done?r=connected');
  let html = await r.text();
  const csp = r.headers.get('content-security-policy') || '';
  ok(r.status === 200 && r.headers.get('content-type').startsWith('text/html'), 'GitHub’s finish page is ours: 200, a web page');
  ok(html.includes('<h1>GitHub connected</h1>') && html.includes('class="mark ok"') && html.includes('Kloomie · GitHub') && html.includes('href="/">Back to Kloomie</a>'), 'connected: the Kloomie mark with GitHub, a ✓, the title and Back to Kloomie');
  ok(html.includes('Pushes, pull requests and releases') && html.includes('You can close this window.'), 'what happened, and that the window can be closed');
  ok(html.includes('prefers-color-scheme: dark'), 'it has a dark look too');
  ok(!/<script/i.test(html) && /default-src 'none'/.test(csp) && !/script-src/.test(csp) && /frame-ancestors 'none'/.test(csp), 'no scripts, and a policy that allows none (and no framing)');
  ok(r.headers.get('cache-control') === 'no-store' && r.headers.get('x-robots-tag') === 'noindex', 'not cached, not indexed');
  html = await (await fetch(B + '/github/done?r=requested')).text();
  ok(html.includes('class="mark wait"') && html.includes('Waiting for an organisation owner'), 'waiting on an organisation owner: a waiting mark');
  html = await (await fetch(B + '/github/done?r=%3Cscript%3E')).text();
  ok(html.includes('class="mark bad"') && html.includes('<h1>Not connected</h1>') && !html.includes('<script>'), 'anything else: Not connected, with a ! (and what was in the address isn’t shown)');
  html = donePage({ title: '<b>Hi</b>', message: '"x" & <y>', ok: false, app: '<i>' });
  ok(html.includes('&lt;b&gt;Hi&lt;/b&gt;') && html.includes('&quot;x&quot; &amp; &lt;y&gt;') && html.includes('Kloomie · &lt;i&gt;') && !html.includes('<b>Hi'), 'titles, messages and app names go in as text');
} catch (e) { ok(false, e.stack); }
srv.kill();
if (fails) console.log(srv.log.split('\n').slice(-10).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
