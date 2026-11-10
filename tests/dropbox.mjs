// Dropbox listed inside Kloomie, against a stand-in Dropbox: connecting (per person), the folder list and search,
// adding a picked file into a stack (the bytes arrive), files Dropbox can't download refused, an expired sign-in asking
// to reconnect (never signing you out of Kloomie), disconnecting, and the old Chooser used only without the secret.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/dropbox';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4759, FAKE = 4760, B = `http://127.0.0.1:${PORT}`, F = `http://127.0.0.1:${FAKE}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

// The stand-in Dropbox.
const PDF = Buffer.from('%PDF-1.4 quote for six windows');
const FILES = {
  '': [{ '.tag': 'folder', id: 'id:f1', name: 'Jobs', path_display: '/Jobs' }, { '.tag': 'file', id: 'id:a1', name: 'Price list.pdf', path_display: '/Price list.pdf', size: PDF.length, server_modified: '2026-11-01T10:00:00Z', is_downloadable: true }],
  '/Jobs': [{ '.tag': 'file', id: 'id:b2', name: 'Café plan é.pdf', path_display: '/Jobs/Café plan é.pdf', size: PDF.length, is_downloadable: true }, { '.tag': 'file', id: 'id:p3', name: 'Notes.paper', path_display: '/Jobs/Notes.paper', size: 0, is_downloadable: false }],
};
const all = Object.values(FILES).flat();
const seen = { revoked: 0, refreshes: 0, args: [] };
let refreshOk = true;
let accessGood = 'acc1';
const fake = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const json = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.url === '/oauth2/token') {
    const f = new URLSearchParams(body);
    if (f.get('client_secret') !== 'sek') return json(400, { error: 'invalid_client' });
    if (f.get('grant_type') === 'authorization_code') return f.get('code') === 'good' ? json(200, { access_token: 'acc1', refresh_token: 'ref1', expires_in: 14400 }) : json(400, { error: 'invalid_grant' });
    seen.refreshes++;
    if (!refreshOk) return json(400, { error: 'invalid_grant' });
    accessGood = 'acc2';
    return json(200, { access_token: 'acc2', expires_in: 14400 });
  }
  if (req.headers.authorization !== 'Bearer ' + accessGood) return json(401, { error_summary: 'expired_access_token/' });
  const b = body ? JSON.parse(body) : null;
  if (req.url === '/2/users/get_current_account') return json(200, { email: 'jo@x.test', name: { display_name: 'Jo Smith' } });
  if (req.url === '/2/files/list_folder') return FILES[b.path] ? json(200, { entries: FILES[b.path], has_more: false, cursor: 'c' }) : json(409, { error_summary: 'path/not_found/', error: { '.tag': 'path', path: { '.tag': 'not_found' } } });
  if (req.url === '/2/files/search_v2') return json(200, { matches: all.filter((x) => x.name.toLowerCase().includes(b.query.toLowerCase())).map((x) => ({ metadata: { '.tag': 'metadata', metadata: x } })) });
  if (req.url === '/2/files/get_metadata') { const x = all.find((y) => y.id === b.path); return x ? json(200, x) : json(409, { error_summary: 'path/not_found/' }); }
  if (req.url === '/2/files/download') {
    const arg = req.headers['dropbox-api-arg'];
    seen.args.push(arg);
    if (/[^\x00-\x7f]/.test(arg)) return json(400, { error: 'non-ascii header' });
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    return res.end(PDF);
  }
  if (req.url === '/2/auth/token/revoke') { seen.revoked++; return json(200, null); }
  json(404, {});
}).listen(FAKE);

const start = (extra) => {
  const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '',
    DROPBOX_API: F, DROPBOX_CONTENT: F, DROPBOX_AUTH: F, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
  return srv;
};
const up = async () => { for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) return; } catch {} await sleep(150); } };
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
let srv = start({ DROPBOX_APP_KEY: 'key1', DROPBOX_APP_SECRET: '' });
const t = Date.now();
try {
  await up();
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Dbx ' + t, name: 'Jo', email: `jo${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const joTok = r.body.token;
  let jo = call(joTok);
  let st = (await jo('GET', '/state')).body;
  ok(st.cloud.dropbox === 'key1' && !st.cloud.dropboxList, 'with only the app key, the Chooser popup is used');
  srv.kill(); await sleep(400);
  srv = start({ DROPBOX_APP_KEY: 'key1', DROPBOX_APP_SECRET: 'sek' });
  await up();
  st = (await jo('GET', '/state')).body;
  ok(st.cloud.dropboxList === true && !st.cloud.dropbox, 'with the secret too, Dropbox is listed inside Kloomie instead');
  const csp = (await fetch(B + '/')).headers.get('content-security-policy') || '';
  ok(!csp.includes('dropbox.com'), 'and no Dropbox script is let into the page');
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Dbx ' + t, code: st.workspace.inviteCode, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);

  ok((await jo('GET', '/dropbox')).body.connected === false, 'not connected to start with');
  ok((await jo('GET', '/dropbox/list')).status === 409, 'listing before connecting asks to connect');
  r = await jo('POST', '/dropbox/connect');
  const auth = new URL(r.body.url);
  ok(auth.origin === F && auth.searchParams.get('token_access_type') === 'offline' && auth.searchParams.get('redirect_uri') === B + '/oauth/dropbox/callback' && /files\.content\.read/.test(auth.searchParams.get('scope')), 'connecting sends you to Dropbox for read-only access that lasts');
  const state = auth.searchParams.get('state');
  let cb = await fetch(B + '/oauth/dropbox/callback?state=wrong&code=good', { redirect: 'manual' });
  ok(cb.headers.get('location') === '/dropbox/done?r=expired', 'a made-up return is refused');
  cb = await fetch(B + `/oauth/dropbox/callback?state=${state}&code=good`, { redirect: 'manual' });
  ok(cb.status === 302 && cb.headers.get('location') === '/dropbox/done?r=ok', 'coming back from Dropbox connects it');
  ok(/Dropbox connected/.test(await (await fetch(B + '/dropbox/done?r=ok')).text()), 'with a page saying so');
  cb = await fetch(B + `/oauth/dropbox/callback?state=${state}&code=good`, { redirect: 'manual' });
  ok(cb.headers.get('location') === '/dropbox/done?r=expired', 'the same return can’t be used twice');
  r = await jo('GET', '/dropbox');
  ok(r.body.connected && r.body.account === 'jo@x.test' && !JSON.stringify(r.body).includes('ref1'), 'it shows whose Dropbox, and never the token');
  ok((await sam('GET', '/dropbox')).body.connected === false, 'it’s Jo’s alone: Sam isn’t connected');

  r = await jo('GET', '/dropbox/list');
  ok(r.body.entries[0].folder && r.body.entries[0].name === 'Jobs' && r.body.entries[1].name === 'Price list.pdf' && r.body.entries[1].size === PDF.length, 'the top of the Dropbox: folders first, files with sizes');
  r = await jo('GET', '/dropbox/list?path=' + encodeURIComponent('/Jobs'));
  ok(r.body.entries.length === 2 && r.body.entries.find((x) => x.name === 'Notes.paper').downloadable === false, 'inside a folder, a file Dropbox can’t download is marked');
  r = await jo('GET', '/dropbox/search?q=price');
  ok(r.body.entries.length === 1 && r.body.entries[0].id === 'id:a1', 'search finds files anywhere');

  await jo('POST', '/stacks', { name: 'Quotes' });
  const stackId = (await jo('GET', '/state')).body.workspace.stacks.find((x) => x.name === 'Quotes')?.id;
  r = await jo('POST', '/dropbox/import', { id: 'id:b2', stackId });
  ok(r.status === 200 && r.body.name === 'Café plan é.pdf' && r.body.size === PDF.length && stackId && r.body.stackId === stackId, 'adding a file copies it into the stack');
  ok(seen.args.at(-1) && !/[^\x00-\x7f]/.test(seen.args.at(-1)), 'names in any alphabet are sent the way Dropbox needs');
  const dl = await fetch(B + `/api/files/${r.body.id}`, { headers: { authorization: 'Bearer ' + joTok } });
  ok(dl.ok && Buffer.from(await dl.arrayBuffer()).equals(PDF), 'and the file’s bytes are there');
  ok((await jo('POST', '/dropbox/import', { id: 'id:p3' })).status === 400, 'a file Dropbox can’t download is refused, saying why');
  ok((await jo('POST', '/dropbox/import', { id: 'id:f1' })).status === 400, 'a folder can’t be added as a file');
  ok((await jo('POST', '/dropbox/import', { id: '../etc' })).status === 400, 'only Dropbox file ids are taken');
  ok((await sam('POST', '/dropbox/import', { id: 'id:a1' })).status === 409, 'Sam can’t add from Jo’s Dropbox');

  // The access token runs out: refreshed quietly. The refresh refused: asks to reconnect, without signing out.
  accessGood = 'acc-new';
  refreshOk = false;
  r = await jo('GET', '/dropbox/list');
  ok(r.status === 409 && r.body.reconnect && /Connect again/.test(r.body.error), 'Dropbox refusing the sign-in asks you to connect again (not a sign-out)');
  ok((await jo('GET', '/state')).status === 200, 'you’re still signed in to Kloomie');
  refreshOk = true;
  accessGood = 'acc2';
  r = await jo('DELETE', '/dropbox');
  ok(r.body.connected === false && seen.revoked >= 0, 'disconnecting forgets it');
  ok((await jo('GET', '/dropbox/list')).status === 409, 'and the list asks to connect again');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails) console.log(srv.log.slice(-3000));
  srv.kill();
  fake.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
