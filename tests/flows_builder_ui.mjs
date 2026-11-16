// The automation builder in a real browser (headless Chrome): full screen; what sets it off at the top, the steps
// under it, "only if" split into Then and Otherwise side by side. A + between steps adds one there; a step dragged by
// its ⋮⋮ goes into a branch; Move up/Duplicate from its menu; ▾ folds it to one line. A step missing something is
// marked red and the bar counts them; a word chip puts {contact} where the cursor is. "Test it" lights the way it
// would go and says what each step would do (doing nothing); a past run lights the way it went. Fits a phone.
import * as FS from 'node:fs';
import WebSocket from '../server/node_modules/ws/index.js';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/flows_builder_ui';
FS.rmSync(DIR, { recursive: true, force: true });
FS.mkdirSync(DIR, { recursive: true });
const PORT = 4978, CDP = 9535, APP = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: APP.slice(0, -1), DATA_DIR: DIR + '/data', MAIL_OUTBOX: '', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: 'ignore' });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${DIR}/chrome`, '--no-first-run', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
async function tab(url) {
  let t;
  for (let i = 0; i < 80 && !t; i++) { await sleep(200); try { t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?` + url, { method: 'PUT' })).json(); } catch {} }
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
  const a = await (await fetch(APP + 'api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'create', workspace: 'Builder ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' }) })).json();
  const api = async (m, p, b) => (await fetch(APP + 'api' + p, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + a.token }, body: b ? JSON.stringify(b) : undefined })).json();
  const A = await tab(APP);
  await A.until(`location.href.startsWith(${JSON.stringify(APP)}) && document.readyState === 'complete'`, 15000);
  await A.ev(`localStorage.setItem('column.token', ${JSON.stringify(JSON.stringify(a.token))}); location.reload(); true`);
  ok(await A.until(`!document.querySelector('#app')?.classList.contains('hidden') && !!document.querySelector('#settingsBtn')`, 20000), 'signed in');
  await A.until(`!!document.querySelector('#tabs [data-tab=automations]')`, 10000);
  await A.ev(`document.querySelector('#tabs [data-tab=automations]').click(); true`);
  await A.tap(`[...document.querySelectorAll('#tool button')].find((b) => b.textContent === '+ New automation')`);
  ok(await A.until(`!!document.querySelector('#sheet .sheet.auto-builder .auto-canvas')`), 'the builder opens');
  ok(await A.ev(`(() => { const r = document.querySelector('#sheet .sheet').getBoundingClientRect(); return r.width >= innerWidth - 2 && r.height >= innerHeight - 2; })()`), 'full screen');
  ok(await A.ev(`!!document.querySelector('#sheet .auto-canvas .auto-trigger .auto-kind') && !!document.querySelector('#sheet .auto-canvas .auto-flow .auto-steps .auto-act') && document.querySelector('#sheet .auto-end')?.textContent === 'Done'`), 'what sets it off at the top, then the steps, then Done');
  await A.pick(`document.querySelector('#sheet .auto-kind')`, 'contact.created');
  await A.fill(`document.querySelector('#sheet .auto-edit input')`, 'Sort leads');
  const top = `document.querySelector('#sheet .auto-flow > .auto-steps')`;
  const acts = (list) => `[...${list}.children].filter((x) => x.classList.contains('auto-act'))`;
  // Asking your team: who, what, and waiting adds {answer} to the words (and to what "Only if" can check).
  await A.pick(`${acts(top)}[0].querySelector('.auto-step-kind')`, 'agent');
  ok(await A.until(`!!document.querySelector('#sheet .auto-agent-who') && [...document.querySelector('#sheet .auto-agent-who').options].length >= 5`), '“Ask your team” lists Your team and each agent');
  ok(await A.ev(`![...document.querySelectorAll('#sheet .auto-word')].some((b) => b.textContent === '{answer}')`), 'no {answer} until it waits');
  await A.ev(`(() => { const c = document.querySelector('#sheet .auto-agent-wait'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .auto-word')].some((b) => b.textContent === '{answer}')`), 'waiting for the answer adds {answer} to the words');
  // Step 1: a task, empty → marked red.
  await A.pick(`${acts(top)}[0].querySelector('.auto-step-kind')`, 'task');
  ok(await A.until(`${acts(top)}[0].classList.contains('bad') && /1 step needs something/.test(document.querySelector('#sheet .auto-probs')?.textContent || '')`), 'an empty step is marked red, and the bar counts it');
  // A word chip puts {contact} where the cursor is.
  await A.ev(`(() => { const i = ${acts(top)}[0].querySelector('input'); i.focus(); i.value = 'Call '; i.setSelectionRange(5, 5); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await A.tap(`[...document.querySelectorAll('#sheet .auto-word')].find((b) => b.textContent === '{contact}')`);
  ok(await A.until(`${acts(top)}[0].querySelector('input').value === 'Call {contact}'`), 'a word chip puts {contact} where the cursor was');
  ok(await A.until(`!${acts(top)}[0].classList.contains('bad') && document.querySelector('#sheet .auto-probs').hidden`), 'filled in, it isn’t red any more (while typing)');
  // The + above step 1 adds an "Only if" before it.
  await A.tap(`${top}.querySelector('.auto-ins .auto-ins-btn')`);
  ok(await A.until(`${acts(top)}.length === 2`), 'the + between steps adds one there');
  await A.pick(`${acts(top)}[0].querySelector('.auto-step-kind')`, 'if');
  ok(await A.until(`!!document.querySelector('#sheet .auto-branches') && document.querySelectorAll('#sheet .auto-branches > .auto-steps.nested').length === 2`), '“Only if” splits into Then and Otherwise');
  ok(await A.ev(`(() => { const [p, q] = document.querySelectorAll('#sheet .auto-branches > .auto-steps.nested'); const a = p.getBoundingClientRect(), b = q.getBoundingClientRect(); return Math.abs(a.top - b.top) < 4 && b.left > a.right - 2; })()`), 'side by side');
  await A.pick(`document.querySelector('#sheet .auto-if-field')`, 'stage');
  await A.fill(`document.querySelector('#sheet .auto-if-val')`, 'Lead');
  const thenL = `document.querySelectorAll('#sheet .auto-branches > .auto-steps.nested')[0]`;
  await A.pick(`${thenL}.querySelector('.auto-step-kind')`, 'post');
  await A.fill(`${thenL}.querySelector('.auto-act input')`, 'Lead: {contact}');
  await A.pick(`[...${thenL}.querySelectorAll('.auto-act select')][1]`, 'general');
  // Drag the task (step 2) into Otherwise.
  const elseL = `document.querySelectorAll('#sheet .auto-branches > .auto-steps.nested')[1]`;
  ok(await A.ev(`(() => {
    const grip = ${acts(top)}[1].querySelector('.auto-grip');
    const drop = ${elseL}.querySelector('.auto-add-step');
    const dt = new DataTransfer();
    grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    drop.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    drop.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    return true;
  })()`), '(drag the task into Otherwise)');
  ok(await A.until(`${acts(top)}.length === 1 && [...${elseL}.querySelectorAll('.auto-act input')].some((i) => i.value === 'Call {contact}')`), 'dragged by its ⋮⋮, the task is in Otherwise now');
  // Its menu: Duplicate, then Move up.
  await A.tap(`${elseL}.querySelector('.auto-act .auto-more')`);
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Duplicate')`);
  ok(await A.until(`${elseL}.querySelectorAll('.auto-act').length === 2`), 'Duplicate makes a copy under it');
  await A.fill(`[...${elseL}.querySelectorAll('.auto-act')][1].querySelector('input')`, 'Email {contact}');
  await A.tap(`[...${elseL}.querySelectorAll('.auto-act')][1].querySelector('.auto-more')`);
  await A.tap(`[...document.querySelectorAll('#menu button')].find((b) => b.textContent === 'Move up')`);
  ok(await A.until(`[...${elseL}.querySelectorAll('.auto-act')][0].querySelector('input').value === 'Email {contact}'`), 'Move up moves it up');
  // Fold and unfold.
  await A.tap(`${acts(top)}[0].querySelector('.auto-fold')`);
  ok(await A.until(`${acts(top)}[0].classList.contains('folded') && /Only if \\{stage\\} is Lead/.test(${acts(top)}[0].querySelector('.auto-fold-line')?.textContent || '') && !${acts(top)}[0].querySelector('.auto-if-field')`), '▾ folds a step to one line (its branches stay)');
  await A.tap(`document.querySelector('#sheet .auto-foldall')`);
  ok(await A.until(`[...document.querySelectorAll('#sheet .auto-act')].every((x) => x.classList.contains('folded'))`), 'Fold all folds every step');
  await A.tap(`document.querySelector('#sheet .auto-foldall')`);
  ok(await A.until(`![...document.querySelectorAll('#sheet .auto-act')].some((x) => x.classList.contains('folded'))`), 'Unfold all opens them again');

  // Test it: nothing has happened yet, a made-up customer: Otherwise.
  await A.tap(`document.querySelector('#sheet .auto-test-btn')`);
  ok(await A.until(`/made-up example/.test(document.querySelector('#sheet .auto-test')?.textContent || '')`), '“Test it” says what it’s testing on');
  ok(await A.ev(`${acts(top)}[0].classList.contains('lit') && [...${elseL}.querySelectorAll('.auto-act')].every((x) => x.classList.contains('lit')) && [...${thenL}.querySelectorAll('.auto-act')].every((x) => x.classList.contains('dim'))`), 'it lights the way it would go (Otherwise), and dims the rest');
  ok(await A.ev(`[...${elseL}.querySelectorAll('.auto-would')].map((x) => x.textContent).join('|') === 'Make the task “Email Sample customer”|Make the task “Call Sample customer”'`), 'and says what each step would do');
  // A real lead comes in: Then.
  await api('POST', '/contacts', { name: 'Ana Lead', stage: 'lead' });
  await A.tap(`document.querySelector('#sheet .auto-test-btn')`);
  ok(await A.until(`/Ana Lead/.test(document.querySelector('#sheet .auto-test')?.textContent || '') && [...${thenL}.querySelectorAll('.auto-act')].every((x) => x.classList.contains('lit'))`), 'tested on the last real one, Ana, it goes Then');
  ok(await A.ev(`${thenL}.querySelector('.auto-would').textContent === 'Post “Lead: Ana Lead” in #general'`), '“Post Lead: Ana Lead in #general”');
  ok((await api('GET', '/state')).items.filter((x) => x.type === 'message').length === 0, 'testing posted nothing');
  await A.tap(`document.querySelector('#sheet .auto-test-clear')`);
  ok(await A.until(`!document.querySelector('#sheet .auto-act.lit, #sheet .auto-act.dim, #sheet .auto-test')`), 'Clear takes the lights off');

  // Save; a real run; reopen and show it.
  await A.tap(`[...document.querySelectorAll('#sheet .btns button')].find((b) => b.textContent === 'Turn it on')`);
  ok(await A.until(`[...document.querySelectorAll('#tool .auto-row b')].some((b) => b.textContent === 'Sort leads')`), 'saved');
  const saved = (await api('GET', '/automations')).find((x) => x.name === 'Sort leads');
  ok(saved.actions.length === 1 && saved.actions[0].kind === 'if' && saved.actions[0].then[0].text === 'Lead: {contact}' && saved.actions[0].else.map((y) => y.text).join() === 'Email {contact},Call {contact}', 'as built: the “only if”, Then a post, Otherwise two tasks');
  await api('POST', '/contacts', { name: 'Bo Buyer', stage: 'customer' });
  ok(await A.until(`[...document.querySelectorAll('#tool .auto-row')].some((r) => r.textContent.includes('Make') || r.textContent.includes('Made'))`, 10000), '(it ran for Bo)');
  await A.tap(`[...document.querySelectorAll('#tool .auto-row')].find((r) => r.textContent.includes('Sort leads')).querySelector('.auto-main')`);
  ok(await A.until(`!!document.querySelector('#sheet .auto-runs')`), 'reopened, past runs can be shown');
  await A.pick(`document.querySelector('#sheet .auto-runs')`, '0');
  ok(await A.until(`[...document.querySelectorAll('#sheet .auto-branches > .auto-steps.nested')[1].querySelectorAll('.auto-act')].every((x) => x.classList.contains('lit')) && [...document.querySelectorAll('#sheet .auto-branches > .auto-steps.nested')[0].querySelectorAll('.auto-act')].every((x) => x.classList.contains('dim'))`), 'a past run lights the way it went (Bo: Otherwise)');

  // A phone.
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  ok(await A.ev(`document.documentElement.scrollWidth <= 392 && document.querySelector('#sheet .sheet').getBoundingClientRect().right <= 391`), 'it fits a phone');
  ok(await A.ev(`(() => { const [p, q] = document.querySelectorAll('#sheet .auto-branches > .auto-steps.nested'); return q.getBoundingClientRect().top >= p.getBoundingClientRect().bottom - 2; })()`), 'with the branches one above the other');
  ok(!A.errors.length, 'no errors in the page' + (A.errors.length ? ': ' + A.errors.join(' | ').slice(0, 300) : ''));
} catch (e) {
  ok(false, 'threw: ' + e.stack);
} finally {
  srv.kill();
  chrome.kill('SIGKILL');
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
