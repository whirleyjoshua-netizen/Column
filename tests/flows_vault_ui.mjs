// Flows step 4 in a real browser (headless Chrome): an automation built in the editor that, when a job is added,
// puts a sealed note in its maker's vault and sends what happened to another app with a key added right in the
// editor. Setting up the vault makes its drop key; a job added while it's unlocked lands as a vault item at once; one
// added while it's locked waits ("a sealed note is waiting"), and unlocking keeps it. The other app gets the key.
import { autoUI } from './autobuild.mjs';
import * as FS from 'node:fs';
import http from 'node:http';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/flows_vault_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4975, H_PORT = 4976, CDP = 9533, APP = `http://127.0.0.1:${PORT}/`;
const got = [];
const hookSrv = http.createServer(async (req, res) => { let raw = ''; for await (const c of req) raw += c; got.push({ auth: req.headers.authorization || null, body: JSON.parse(raw || '{}') }); res.writeHead(200); res.end('{}'); });
await new Promise((r) => hookSrv.listen(H_PORT, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1', ALLOW_LOCAL_WEBHOOKS: '1' }, stdio: 'ignore' });
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
  const pick = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value === ${JSON.stringify(value)}; })()`);
  const fill = (sel, value) => ev(`(() => { const s = ${sel}; s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  return { ev, until, tap, pick, fill, cmd, errors };
}
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP + 'api/health')).ok) break; } catch {} await sleep(150); }
  const t = Date.now();
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Drops ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const st = await api('GET', '/state');
  await api('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, vault: true } });
  const p = await api('POST', '/projects', { template: 'blank', name: 'Sites' });
  const tp = p.types[0];
  const addRec = (name) => api('POST', `/projects/${p.id}/records`, { typeId: tp.id, values: { [tp.primary]: name } });

  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  const signIn = async () => {
    await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
    return A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000);
  };
  ok(await signIn(), 'signed in');

  // The automation, built in the editor.
  await A.until(`!!document.querySelector('#tabs [data-tab=automations]')`, 10000);
  await A.ev(`document.querySelector('#tabs [data-tab=automations]').click(); true`);
  await A.tap(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent === '+ New automation')`);
  const B = autoUI(A);
  await B.when('record.created');
  await A.fill(`document.querySelector('#sheet .auto-name')`, 'Site codes');
  await B.step(B.act(0), 'vault');
  ok(await A.until(`!!document.querySelector('#sheet .auto-vault-to')`), '“Put a sealed note in a vault” asks whose vault and what goes in it');
  ok(await A.ev(`[...document.querySelectorAll('#sheet .hint')].some((x) => x.textContent.includes('nobody, Kloomie included, can read it'))`), 'and says nobody can read it after');
  await A.fill(`document.querySelector('#sheet .auto-vault-title')`, 'Lockbox for {record}');
  await A.fill(`document.querySelector('#sheet .auto-vault-text')`, 'Lockbox code for {record}: 7310');
  await B.add('webhook');
  ok(await A.until(`!!document.querySelector('#sheet .auto-hook-url')`), '“Send to another app” asks for the address (and a key, under Advanced settings)');
  await A.fill(`document.querySelector('#sheet .auto-hook-url')`, `http://127.0.0.1:${H_PORT}/in`);
  await B.adv();
  await A.until(`[...document.querySelector('#sheet .auto-hook-key').options].some((o) => o.value === '+')`);
  await A.pick(`document.querySelector('#sheet .auto-hook-key')`, '+');
  ok(await A.until(`!document.querySelector('#sheet .auto-key-new').hidden`), '“+ Add a key…” opens the key form right there');
  await A.fill(`document.querySelector('#sheet .auto-key-name')`, 'Zap hook');
  await A.fill(`document.querySelector('#sheet .auto-key-value')`, 'zk_test_keepthissecret_AB12');
  await A.tap(`document.querySelector('#sheet .auto-key-save')`);
  ok(await A.until(`[...document.querySelector('#sheet .auto-hook-key').selectedOptions].some((o) => o.textContent === 'Zap hook (…AB12)')`), 'kept sealed: it shows by name and last four, and is picked');
  ok(await A.ev(`!document.querySelector('#sheet').innerHTML.includes('keepthissecret')`), 'and the key itself is gone from the page');
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Turn it on')`);
  ok(await A.until(`[...document.querySelectorAll('#tool .auto-row b')].some((b) => b.textContent === 'Site codes')`), 'saved');
  const saved = (await api('GET', '/automations')).find((x) => x.name === 'Site codes');
  ok(saved && saved.actions.map((s) => s.kind).join() === 'vault,webhook' && saved.actions[0].to === 'maker' && !!saved.actions[1].secretId, 'with its two steps, as built');

  // The vault: set up, which makes its drop key.
  await A.tap(`(document.querySelector('#tabs [data-tab=tools]').click(), document.querySelector('#menu [data-tool=vault]'))`);
  ok(await A.until(`!!document.querySelector('#split input[type=password]')`), 'the vault asks to be set up');
  await A.ev(`(() => { const ins = [...document.querySelectorAll('#split input')]; ins[0].value = 'correct horse battery'; ins[1].value = 'correct horse battery'; document.querySelector('#split input[type=checkbox]').checked = true; })()`);
  await A.tap(`[...document.querySelectorAll('#split .btn')].find((b) => b.textContent === 'Set up my vault')`);
  let v;
  for (let i = 0; i < 60; i++) { v = await api('GET', '/vault'); if (v.drop) break; await sleep(200); }
  ok(!!v.drop?.pub && !!v.drop.priv, 'setting it up makes its drop key (the private half sealed with the vault’s key)');

  // Unlocked: a job comes in, and the note is in the vault at once.
  await addRec('Oak St');
  for (let i = 0; i < 60; i++) { v = await api('GET', '/vault'); if (v.items.length === 1 && !v.drops.length) break; await sleep(200); }
  ok(v.items.length === 1 && v.drops.length === 0, 'with the vault open, the note is kept as an item at once');
  ok(await A.until(`document.querySelector('#split')?.textContent.includes('Lockbox for Oak St')`), 'and shows in the vault');
  ok(got.length === 1 && got[0].auth === 'Bearer zk_test_keepthissecret_AB12' && got[0].body.words.record === 'Oak St', 'the other app got what happened, with the key');

  // Locked (a reload forgets the key): it waits, and unlocking keeps it.
  ok(await signIn(), 'reloaded (the vault is locked again)');
  await addRec('Elm Rd');
  for (let i = 0; i < 60; i++) { v = await api('GET', '/vault'); if (v.drops.length === 1) break; await sleep(200); }
  ok(v.drops.length === 1 && !JSON.stringify(v).includes('7310'), 'locked, the drop waits, sealed');
  await A.tap(`(document.querySelector('#tabs [data-tab=tools]').click(), document.querySelector('#menu [data-tool=vault]'))`);
  ok(await A.until(`document.querySelector('#split .vault-drops')?.textContent === 'A sealed note from an automation is waiting. Unlock to keep it.'`), 'the locked vault says a sealed note is waiting');
  await A.ev(`document.querySelector('#split .vault-unlock input').value = 'correct horse battery'; true`);
  await A.tap(`[...document.querySelectorAll('#split .vault-unlock button')].find((b) => b.textContent === 'Unlock')`);
  ok(await A.until(`document.querySelector('#split')?.textContent.includes('Lockbox for Elm Rd')`, 15000), 'unlocked, it’s kept and shows');
  v = await api('GET', '/vault');
  ok(v.items.length === 2 && v.drops.length === 0, 'two items, nothing waiting');
  await A.tap(`[...document.querySelectorAll('#split button, #split .vault-row')].find((b) => b.textContent.includes('Lockbox for Elm Rd'))`);
  ok(await A.until(`(() => { const sh = document.querySelector('#sheet'); return !!sh && (sh.textContent + [...sh.querySelectorAll('textarea, input')].map((x) => x.value).join(' ')).includes('Lockbox code for Elm Rd: 7310'); })()`), 'opened, it has the note, words filled in');
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  ok(await A.ev(`document.documentElement.scrollWidth <= 392`), 'it fits a phone');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors.join(' | ').slice(0, 300) : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  hookSrv.close();
  chrome.kill('SIGKILL');
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
