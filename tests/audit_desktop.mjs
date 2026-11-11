// Audit (docs/audit/FINDINGS.md H5), in the real desktop app: the page can't change which server the app talks to,
// can't open file: or other non-web links, can't make the app download from anywhere but the Kloomie server, and the
// window stays on the server. Runs Electron with its own settings folder (KLOOMIE_USER_DATA), so a real install's
// settings are never touched. Needs Electron (the desktop folder's node_modules, here or in the main checkout).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import WebSocket from '../server/node_modules/ws/index.js';
const require = createRequire(import.meta.url);
const S = path.resolve(process.argv[2] || '.');
const DIR = S + '/dk/audit_desktop';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR + '/user', { recursive: true });
const PORT = 4931, CDP = 9342, B = `http://127.0.0.1:${PORT}`;
const DESKTOP = new URL('../desktop', import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

// The checks themselves (desktop/guard.js).
const G = require('../desktop/guard.js');
ok(G.externalOk('https://kloomie.com') && G.externalOk('mailto:a@b.test') && G.externalOk('tel:+15551234') && !G.externalOk('file:///etc/passwd') && !G.externalOk('javascript:alert(1)') && !G.externalOk('smb://host/share') && !G.externalOk('x-apple.systempreferences:') && !G.externalOk('not a url'), 'H5 links leave the app only as web, email or phone links');
ok(JSON.stringify(G.cfgPatch({ serverUrl: 'https://evil.test', alwaysOnTop: 1, x: 2 })) === '{"alwaysOnTop":true}', 'H5 a page can change only its own settings, never the server');
ok(G.insideDir('/Users/a/Downloads/Kloomie/q.pdf', '/Users/a/Downloads/Kloomie') && !G.insideDir('/etc/hosts', '/Users/a/Downloads/Kloomie') && !G.insideDir('/Users/a/Downloads/Kloomie/../x', '/Users/a/Downloads/Kloomie') && !G.insideDir('/Users/a/Downloads/Kloomie', '/Users/a/Downloads/Kloomie'), 'H5 "show in folder" only inside the app’s Downloads folder');
const tr = G.makeTrust({ onServer: (u) => { try { return new URL(u).host === '127.0.0.1:4931'; } catch { return false; } }, setupFile: '/Apps/Kloomie app/setup.html' });
ok(tr.pageOk(B + '/') && tr.pageOk('file:///Apps/Kloomie%20app/setup.html?server=') && !tr.pageOk('file:///etc/hosts') && !tr.pageOk('https://evil.test/') && !tr.sender({ senderFrame: { url: B + '/', parent: {} } }) && tr.sender({ senderFrame: { url: B + '/', parent: null } }), 'H5 only the server’s main frame (or the setup page) is trusted');

const electron = [path.join(DESKTOP, 'node_modules/.bin/electron'), '/Users/premiershades/column/desktop/node_modules/.bin/electron'].find((p) => fs.existsSync(p));
if (!electron) {
  console.log('SKIP the real app: Electron isn’t installed');
} else {
  const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR + '/data', MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
  fs.writeFileSync(DIR + '/user/config.json', JSON.stringify({ serverUrl: B }));
  const app = spawn(electron, [DESKTOP, `--remote-debugging-port=${CDP}`], { env: { ...process.env, KLOOMIE_USER_DATA: DIR + '/user' }, stdio: 'ignore' });
  try {
    let page;
    for (let i = 0; i < 100 && !page; i++) { await sleep(300); try { page = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((x) => x.type === 'page' && x.url.startsWith(B)); } catch {} }
    ok(!!page, 'H5 (setup) the desktop app opens the Kloomie server');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => ws.on('open', r));
    let n = 0; const wait = new Map();
    ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
    const cmd = (method, params = {}) => new Promise((r) => { const id = ++n; wait.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
    const ev = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true })).result?.result?.value;
    let bridge = false;
    for (let i = 0; i < 100 && !bridge; i++) { bridge = await ev(`document.readyState === 'complete' && !!window.columnDesktop`).catch(() => false); if (!bridge) await sleep(200); }
    ok(bridge, 'H5 (setup) the page has the desktop bridge');
    await ev(`columnDesktop.setConfig({ serverUrl: 'https://evil.test', alwaysOnTop: false })`);
    ok((await ev(`columnDesktop.getConfig().then((c) => c.serverUrl)`)) === B, 'H5 the page can’t switch the app to another server');
    ok(JSON.parse(fs.readFileSync(DIR + '/user/config.json', 'utf8')).serverUrl === B, 'H5 and the saved settings keep the Kloomie server');
    const saved = await ev(`columnDesktop.save({ id: 'x1', name: 'meta.txt', type: 'file', url: 'http://169.254.169.254/latest/meta-data/' }).then(() => 'saved', (e) => 'refused: ' + e.message)`);
    ok(/^refused/.test(saved || ''), `H5 the app won’t download from anywhere but the Kloomie server (${saved})`);
    await ev(`location.href = 'file:///etc/hosts'; true`);
    await sleep(1200);
    const still = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).filter((x) => x.type === 'page').map((x) => x.url);
    ok(still.some((u) => u.startsWith(B)) && !still.some((u) => u.startsWith('file:///etc')), 'H5 the window can’t be sent to a file: page');
    const log = fs.readFileSync(DIR + '/user/column.log', 'utf8');
    ok(/blocked opening file:\/\/\/etc\/hosts|Not allowed to load local resource: file:\/\/\/etc\/hosts/.test(log) && !/openExternal.*file:/.test(log), 'H5 and the file: link is stopped (by the browser or the app), never opened');
    // A link the page opens in a new window: web links go to the browser, anything else is stopped.
    await ev(`window.open('file:///etc/hosts'); window.open('smb://host/share'); true`);
    await sleep(800);
    const log2 = fs.readFileSync(DIR + '/user/column.log', 'utf8');
    ok(/blocked opening smb:\/\/host\/share/.test(log2) && (log2.match(/blocked opening file:\/\/\/etc\/hosts|Not allowed to load local resource: file:\/\/\/etc\/hosts/g) || []).length >= 2, 'H5 a new window for a file: or smb: link is stopped, not handed to the computer');
    ws.close();
  } catch (e) {
    ok(false, 'threw: ' + e.stack);
  } finally {
    app.kill();
    srv.kill();
  }
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
