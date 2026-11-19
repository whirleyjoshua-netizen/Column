// Showing your card fast (the owner, 2026-11-19: "easier to access in the middle of a quick greet"): /c/<address>/show
// is just the big QR code and Share, made to sit on a phone's Home Screen as its own icon (its own manifest, so it
// opens straight there). Showing it isn't counted as someone opening your card. Your card can be one of your pins.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/cards_show';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5231, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const OUT = DIR + '/outbox';
const mails = () => (fs.existsSync(OUT) ? fs.readdirSync(OUT).sort().map((f) => JSON.parse(fs.readFileSync(OUT + '/' + f, 'utf8'))) : []);
const confirm = async (who, email) => { const code = mails().filter((x) => x.to === email).at(-1)?.text.match(/\b(\d{6})\b/)?.[1]; return (await who('POST', '/account/verify', { code })).status; };
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Show ' + t, name: 'Maria Lopez', email: `maria${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const maria = call(r.body.token);
  await confirm(maria, `maria${t}@t.test`);
  const h = 'maria' + String(t).slice(-6);
  r = await maria('PUT', '/card', { on: true, handle: h, name: 'Maria Lopez', company: 'Lopez HVAC' });
  ok(r.status < 300 && !r.body.off, '(setup) Maria’s card is on ' + r.status + JSON.stringify(r.body).slice(0, 200));

  let res = await fetch(`${B}/c/${h}/show`);
  const html = await res.text();
  ok(res.status === 200 && html.includes(`src="/c/${h}/qr.svg"`) && html.includes('Maria Lopez') && html.includes('id="shareBtn"'), 'the show page: the big QR code, the name and Share');
  ok(html.includes(`<link rel="manifest" href="/c/${h}/manifest.webmanifest">`) && html.includes('name="apple-mobile-web-app-title" content="My card"') && html.includes('apple-touch-icon'), 'it can go on the Home Screen as “My card”, with an icon');
  ok(/manifest-src 'self'/.test(res.headers.get('content-security-policy') || ''), 'its page rules let the phone read the manifest');
  ok(html.includes(`href="/c/${h}"`), 'and a link to the full card');
  res = await fetch(`${B}/c/${h}/manifest.webmanifest`);
  const mf = await res.json().catch(() => null);
  ok(res.status === 200 && /manifest\+json/.test(res.headers.get('content-type') || '') && mf?.start_url === `/c/${h}/show` && mf.short_name === 'My card' && mf.display === 'standalone' && mf.icons?.length >= 1, `the manifest opens straight to the show page (${JSON.stringify(mf)?.slice(0, 160)})`);
  const views = (await maria('GET', '/card')).body.views || 0;
  await fetch(`${B}/c/${h}/show`);
  ok(((await maria('GET', '/card')).body.views || 0) === views, 'showing it isn’t counted as an open');
  ok((await fetch(`${B}/c/nobody${t}/show`)).status === 404 && (await fetch(`${B}/c/nobody${t}/manifest.webmanifest`)).status === 404, 'no card: not found');
  await maria('PUT', '/card', { on: false });
  ok((await fetch(`${B}/c/${h}/show`)).status === 404, 'a card that’s off can’t be shown');

  r = await maria('PUT', '/account/pins', { pins: [{ go: 'card:me', label: 'My card' }] });
  ok(r.status === 200 && r.body.pins[0]?.go === 'card:me', 'your card can be one of your pins');
} catch (e) {
  console.log('FAIL threw', e.stack);
  fails++;
}
srv.kill();
if (fails) console.log(srv.log.slice(-3000));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
