// Audit (docs/audit/FINDINGS.md E6): a "connect your account" sign-in finishes by itself only in the browser that
// started it. Another browser (someone sent the sign-in link) is shown which team and person it would connect to and
// must confirm; nothing is connected before that. Uses a stand-in Dropbox; the same gate covers Google, Microsoft,
// QuickBooks and Postiz.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_oauth';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4927, FAKE = 4928, B = `http://127.0.0.1:${PORT}`, F = `http://127.0.0.1:${FAKE}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const fake = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url === '/oauth2/token') return new URLSearchParams(body).get('code') === 'good' ? json(200, { access_token: 'acc1', refresh_token: 'ref1', expires_in: 14400 }) : json(400, { error: 'invalid_grant' });
  if (req.url === '/2/users/get_current_account') return json(200, { email: 'victim@x.test', name: { display_name: 'Vic' } });
  json(404, {});
});
await new Promise((r) => fake.listen(FAKE, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', DROPBOX_APP_KEY: 'key1', DROPBOX_APP_SECRET: 'sek', DROPBOX_API: F, DROPBOX_AUTH: F, DROPBOX_CONTENT: F }, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
// Each "browser" keeps its own cookies.
const browser = () => {
  const jar = new Map();
  return async (url, init = {}) => {
    const headers = { ...(init.headers || {}), ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}) };
    const r = await fetch(url, { ...init, headers, redirect: 'manual' });
    for (const c of r.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); jar.set(pair.slice(0, i), pair.slice(i + 1)); }
    return r;
  };
};
const t = Date.now();
try {
  const mallory = browser(), victim = browser();
  const api = (b, tok) => async (m, p, body) => { const r = await b(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) }; };
  let r = await api(mallory)('POST', '/auth', { mode: 'create', workspace: 'Mallory Co ' + t, name: 'Mallory', email: `m${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const mal = api(mallory, r.body.token);

  // The attack: Mallory starts connecting and sends the Dropbox sign-in link to someone else.
  r = await mal('POST', '/dropbox/connect');
  ok(r.headers.get('set-cookie')?.includes('kl_oauth=') && /HttpOnly/i.test(r.headers.get('set-cookie')) && /SameSite=Lax/i.test(r.headers.get('set-cookie')), 'E6 starting marks this browser (an HttpOnly, SameSite=Lax cookie)');
  const state = new URL(r.body.url).searchParams.get('state');
  // The victim signs in to Dropbox, which sends their browser back to Kloomie.
  let cb = await victim(B + `/oauth/dropbox/callback?state=${state}&code=good`);
  const page = await cb.text();
  ok(cb.status === 200 && /Connect Dropbox to Kloomie\?/.test(page) && page.includes('Mallory') && page.includes('Mallory Co ' + t), 'E6 another browser is shown which team and person it would connect to');
  ok((await mal('GET', '/dropbox')).body.connected === false, 'E6 and nothing is connected yet');
  ok(!/script/i.test(page) && /frame-ancestors 'none'/.test(cb.headers.get('content-security-policy') || ''), 'E6 the confirm page has no script and can’t be framed');
  // Declining = closing the page. A forged confirm doesn't work either.
  cb = await victim(B + `/oauth/dropbox/callback?state=${state}&code=good&confirm=forged`);
  ok(/Connect Dropbox/.test(await cb.text()) && (await mal('GET', '/dropbox')).body.connected === false, 'E6 a made-up confirm doesn’t connect it');
  // Confirming (the button's link) connects it, once.
  const go = /href="([^"]+)"/.exec(page)?.[1]?.replace(/&amp;/g, '&');
  cb = await victim(B + go);
  ok(cb.status === 302 && cb.headers.get('location') === '/dropbox/done?r=ok', 'E6 confirming connects it');
  cb = await victim(B + go);
  ok(cb.headers.get('location') === '/dropbox/done?r=expired', 'E6 the confirm link works once');

  // The person who started it, in the same browser: no extra step.
  await mal('DELETE', '/dropbox');
  r = await mal('POST', '/dropbox/connect');
  const st2 = new URL(r.body.url).searchParams.get('state');
  cb = await mallory(B + `/oauth/dropbox/callback?state=${st2}&code=good`);
  ok(cb.status === 302 && cb.headers.get('location') === '/dropbox/done?r=ok', 'E6 in the browser that started it, it connects straight away');
  // Saying no at the provider shows "not connected", not the confirm page.
  r = await mal('POST', '/dropbox/connect');
  const st3 = new URL(r.body.url).searchParams.get('state');
  cb = await victim(B + `/oauth/dropbox/callback?state=${st3}&error=access_denied`);
  ok(cb.headers.get('location') === '/dropbox/done?r=denied', 'E6 saying no at Dropbox just says not connected');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  fake.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
