// Audit, critical findings (docs/audit/FINDINGS.md): each check states the safe behaviour.
// C1  a bad %-escape in an address answers 400 and the server keeps running.
// D1  uploaded files never open as a page on Kloomie's address: web pages download as plain bytes, SVG downloads with
//     no script allowed, pictures still show; every file has nosniff and a no-script policy.
// F1  an agent tool given an odd record id (from outside text) is refused; nothing else in the team changes.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_critical';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4783, AI = 4784, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
// A stand-in model that asks for two log_note calls with ids that aren't record ids, then stops.
const SCRIPT = [[['log_note', { record_id: '../clear?', text: 'x' }], ['log_note', { record_id: '../invite?', text: 'x' }]], 'done'];
const ai = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'T', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    const n = j.messages.length - 1;
    const step = SCRIPT[Math.min(Math.floor(n / 2), 1)];
    const reply = (content, stop = 'end_turn') => res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    if (typeof step === 'string') return reply([{ type: 'text', text: step }]);
    reply(step.map(([name, input], i) => ({ type: 'tool_use', id: `tu_${n}_${i}`, name, input })), 'tool_use');
  });
});
await new Promise((r) => ai.listen(AI, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI}` }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
let exited = false;
srv.on('exit', () => (exited = true));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  // C1
  let r = await fetch(B + '/%E0');
  ok(r.status === 400, 'C1 an address with a bad %-escape gets 400');
  r = await fetch(B + '/files/%E0%A4%A.png');
  ok(r.status === 400 || r.status === 404, 'C1 another bad escape is answered too');
  await sleep(300);
  ok(!exited && (await fetch(B + '/api/health')).ok, 'C1 and the server is still running');

  // H1: the after-connecting pages put only their own fixed words in the page, and run no script.
  for (const pth of ['/postiz/done', '/quickbooks/done', '/dropbox/done']) {
    r = await fetch(B + pth + '?r=' + encodeURIComponent('</p><b>x</b>'));
    const body = await r.text();
    ok(r.status === 200 && !body.includes('<b>x</b>') && !/<script/i.test(body), `H1 ${pth} doesn’t echo the address into the page or run script`);
  }
  r = await fetch(B + '/postiz/done?r=__proto__');
  ok(r.status === 200, 'H1 an odd value just shows the “didn’t work” words');
  ok(/default-src 'none'/.test((await fetch(B + '/postiz/done?r=connected')).headers.get('content-security-policy') || ''), 'H1 the page allows no script');
  // GRD-2/3: every response has nosniff and can't be framed by other sites; the lead form, meant to be embedded, still can be.
  r = await fetch(B + '/');
  ok(r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('x-frame-options') === 'SAMEORIGIN' && /frame-ancestors 'self'/.test(r.headers.get('content-security-policy') || '') && r.headers.get('referrer-policy'), 'GRD the app page can’t be framed by other sites, with nosniff and a referrer policy');
  ok((await fetch(B + '/api/health')).headers.get('x-content-type-options') === 'nosniff', 'GRD API answers have nosniff too');

  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Crit ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const tok = r.body.token, ada = call(tok);

  // D1
  const up = async (name, type, body) => (await fetch(`${B}/api/upload?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`, { method: 'PUT', headers: { authorization: 'Bearer ' + tok }, body })).json();
  const get = (id) => fetch(`${B}/api/files/${id}`, { headers: { authorization: 'Bearer ' + tok } });
  const html = await up('page.html', 'text/html', '<p>hello</p>');
  r = await get(html.id);
  ok(r.headers.get('content-type') === 'application/octet-stream' && /^attachment/.test(r.headers.get('content-disposition')), 'D1 an uploaded web page downloads as plain bytes, never opens as a page');
  ok(r.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(r.headers.get('content-security-policy') || '') && /default-src 'none'/.test(r.headers.get('content-security-policy') || ''), 'D1 with nosniff and a policy that allows no script');
  const lied = await up('notes.txt', 'text/html', '<p>hello</p>');
  r = await get(lied.id);
  ok(r.headers.get('content-type') === 'application/octet-stream', 'D1 the type an uploader claims can’t make a file a page');
  const svg = await up('logo.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  r = await get(svg.id);
  ok(r.headers.get('content-type') === 'image/svg+xml' && /^attachment/.test(r.headers.get('content-disposition')) && /sandbox/.test(r.headers.get('content-security-policy') || ''), 'D1 an SVG keeps its type (it still shows as a picture in the app) but opened on its own it downloads, no script allowed');
  const png = await up('photo.png', 'image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  r = await get(png.id);
  ok(r.headers.get('content-type') === 'image/png' && /^inline/.test(r.headers.get('content-disposition')) && r.headers.get('x-content-type-options') === 'nosniff', 'D1 a picture still shows in place');
  const pdf = await up('quote.pdf', 'application/pdf', '%PDF-1.4');
  r = await get(pdf.id);
  ok(r.headers.get('content-type') === 'application/pdf' && /^inline/.test(r.headers.get('content-disposition')), 'D1 a PDF still opens in the browser’s viewer');

  // GRD-2: the lead form says it may be embedded anywhere (frame-ancestors *), which browsers honour over X-Frame-Options.
  const lc = (await ada('PUT', '/lead-capture', { on: true })).body;
  ok(/frame-ancestors \*/.test((await fetch(lc.formUrl + '?embed=1')).headers.get('content-security-policy') || ''), 'GRD the lead form can still be embedded on a customer’s site');

  // F1
  await ada('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  for (const s of ['hello team', 'invoice notes', 'important msg']) await ada('POST', '/items', { type: 'message', text: s });
  let st = (await ada('GET', '/state')).body;
  const code0 = st.workspace.inviteCode, msgs0 = st.items.filter((i) => i.type === 'message').length;
  r = await ada('POST', '/agents/runs', { agent: 'sales', workflow: 'lead', ask: 'A new lead came in. Log a note on it.' });
  let run = null;
  for (let i = 0; i < 80; i++) { run = (await ada('GET', '/agents/runs/' + r.body.id)).body; if (!['requested', 'planning', 'running'].includes(run.status)) break; await sleep(150); }
  const steps = (run?.parts || []).flatMap((p) => p.steps || []).filter((s) => s.tool === 'log_note');
  ok(steps.length === 2 && steps.every((s) => s.status !== 'done'), 'F1 log_note with an id that isn’t a record is refused');
  st = (await ada('GET', '/state')).body;
  ok(st.items.filter((i) => i.type === 'message').length === msgs0 && st.workspace.inviteCode === code0, 'F1 and nothing else in the team changed (messages kept, invite code the same)');
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  if (fails && process.env.SHOWLOG) console.log(srv.log.slice(-3000));
  srv.kill();
  ai.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
