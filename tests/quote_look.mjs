// Job Flows Phase 3b §3 (docs/jobflows/PHASE3B.md): quotes and invoices that look like the business. Settings →
// Quotes & invoices (ws.docs, owners and admins): business details, a business signature, valid-for days (0 = no
// expiry), default terms and a footer, hiding line prices (the total always shows), and whether the customer accepts by
// typing their name or drawing a signature. An issued job quote keeps the look it was sent with; a New quote takes the
// current one. Job quotes get a Q-#### number, Issued, Valid until and Prepared for. The quote page loads nothing from
// outside, and its signature pad runs only by a per-page nonce.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, execSync } from 'node:child_process';
const S = path.resolve(process.argv[2] || '.');
const DIR = S + '/dk/quote_look';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 5257, B = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

// A real PNG, w×h RGBA: `ink` marks some pixels dark (a signature), none = blank.
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(w, h, ink, noise = false) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 4 + 1) + 1 + x * 4;
    const on = ink && Math.abs(y - h / 2 - Math.sin(x / 6) * h / 4) < 1.5;
    const v = noise ? (x * 7919 + y * 104729) % 256 : 0;
    raw[o] = v; raw[o + 1] = noise ? (v * 3) % 256 : 0; raw[o + 2] = noise ? (v * 5) % 256 : 0; raw[o + 3] = noise || on ? 255 : 0;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const b = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: noise ? 0 : 9 })), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + b.toString('base64');
}
const SIG = png(240, 80, true), BLANK = png(240, 80, false), HUGE = png(190, 150, false, true);
const NOT_PNG = 'data:image/png;base64,' + Buffer.from('GIF89a not a png at all').toString('base64');

const base = { ...process.env, PORT: String(PORT), PUBLIC_URL: B, DATA_DIR: DIR, RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', STRIPE_PRICE: '', SKIP_SETUP: '1', NODE_ENV: 'test', MAIL_OUTBOX: '1', CUSTMSG_TICK_MS: '300', QUOTE_TEST_BACKDATE: '1' };
try { execSync(`lsof -ti tcp:${PORT} -sTCP:LISTEN | xargs kill 2>/dev/null`); await sleep(300); } catch {}
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: base, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
let up = false;
for (let i = 0; i < 100 && !up; i++) { try { up = (await fetch(B + '/api/health')).ok; } catch {} if (!up) await sleep(150); }
if (!up) { console.log('FAIL the server didn’t start\n' + srv.log.slice(-2000)); process.exit(1); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
  return r ? { status: r.status, body: await r.json().catch(() => null) } : { status: 0, body: null };
};
const page = async (url) => { if (!url) return { status: 0, csp: '', html: '' }; const r = await fetch(url); return { status: r.status, csp: r.headers.get('content-security-policy') || '', html: await r.text() }; };
const vOf = (html) => html.match(/name="v" value="([^"]+)"/)?.[1];
const answer = (token, form) => fetch(`${B}/q/${token}/accept`, { method: 'POST', body: new URLSearchParams(form), redirect: 'manual' }).catch(() => ({ status: 0 }));
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Look ' + t, name: 'Rico Vega', email: `rico${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const rico = call(r.body.token);
  const st = (await rico('GET', '/state')).body;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Look ' + t, code: st.workspace.inviteCode, name: 'Sam Reed', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  await rico('PATCH', '/workspace', { tools: { ...st.workspace.tools, projects: true, bills: true, contacts: true } });

  // ---------- the settings ----------
  r = await rico('GET', '/docs-settings');
  ok(r.status === 200 && r.body?.validDays === 30 && r.body.showPrices === true && r.body.accept === 'type', 'the defaults: valid 30 days, prices shown, the customer types their name: ' + JSON.stringify(r.body).slice(0, 160));
  ok((await sam('GET', '/docs-settings')).status === 403 && (await sam('PATCH', '/docs-settings', { footer: 'x' })).status === 403, 'members can’t see or change them');
  for (const [why, body] of [
    ['valid for 366 days', { validDays: 366 }],
    ['valid for -1 days', { validDays: -1 }],
    ['terms over 4,000 characters', { terms: 'x'.repeat(4001) }],
    ['a footer over 300 characters', { footer: 'x'.repeat(301) }],
    ['accepting some other way', { accept: 'fax' }],
    ['a website that isn’t http(s)', { business: { website: 'javascript:alert(1)' } }],
  ]) ok((await rico('PATCH', '/docs-settings', body)).status === 400, 'refused: ' + why);
  r = await rico('PATCH', '/docs-settings', { business: { name: 'Acme Cleaning LLC', address: '1 Main St, Reno NV', phone: '(775) 555-0100', email: 'office@acme.test', website: 'https://acme.test', license: 'NV-12345' }, validDays: 14, terms: 'Net 30. Thanks for your business.', footer: 'Acme is licensed and insured.', showPrices: true });
  ok(r.status === 200 && r.body?.business?.license === 'NV-12345' && r.body.validDays === 14, 'saved');
  // The business signature: drawn or uploaded, PNG or JPEG, up to 200 KB, with a name and title.
  ok((await rico('PUT', '/docs-settings/signature', { image: NOT_PNG, name: 'Rico V.', title: 'Owner' })).status === 400, 'a signature that isn’t a PNG or JPEG is refused');
  ok((await rico('PUT', '/docs-settings/signature', { image: 'data:image/png;base64,' + Buffer.alloc(210_000, 1).toString('base64'), name: 'Rico V.' })).status === 400, 'one over 200 KB is refused');
  ok((await sam('PUT', '/docs-settings/signature', { image: SIG, name: 'Sam' })).status === 403, 'members can’t set it');
  r = await rico('PUT', '/docs-settings/signature', { image: SIG, name: 'Rico V.', title: 'Owner' });
  const sigUrl = r.body?.signature?.url;
  ok(r.status === 200 && /^\/brand\/[\w-]+$/.test(sigUrl || ''), 'the business signature is kept, served from Kloomie: ' + sigUrl);
  const sigImg = sigUrl ? await fetch(B + sigUrl) : null;
  ok(sigImg?.status === 200 && sigImg.headers.get('content-type') === 'image/png', 'and it loads as a PNG');

  // ---------- a job quote ----------
  const p = (await rico('POST', '/projects', { template: 'trades', trades: ['cleaning'] })).body;
  const list = { projectId: p.id, typeId: p.types[0].id };
  const can = (await rico('POST', '/job-items', { name: 'Can clean', price: 2500 })).body?.item;
  const pad = (await rico('POST', '/job-items', { name: 'Pad wash', price: 1000 })).body?.item;
  const f = (await rico('POST', '/job-flows', { name: 'Quoted', list, billing: 'quote', items: [{ itemId: can?.id, qty: 2 }, { itemId: pad?.id, qty: 1 }], steps: [{ kind: 'client', name: 'Client' }, { kind: 'quote', name: 'Quote', settings: { email: false } }, { kind: 'invoice', name: 'Inv' }] })).body;
  ok((await rico('POST', `/job-flows/${f?.id}/publish`)).status === 200, '(setup) a quote flow');
  const dana = (await rico('POST', '/contacts', { name: 'Dana Ruiz', email: `dana${t}@x.test`, phone: '(702) 555-0111', address: '9 Elm St' })).body;
  const mkJob = async (c = dana) => (await rico('POST', '/jobs', { flowId: f?.id, contactId: (c.id ?? c.contact?.id), values: { job: 'J' + Math.random().toString(36).slice(2, 7) } })).body?.job;
  const sendQuote = async (id) => { let x = await rico('POST', `/jobs/${id}/quote/send`); if (x.status === 428) x = await rico('POST', `/jobs/${id}/quote/send`, { confirm: x.body?.confirm }); return x; };
  const j1 = await mkJob();
  r = await sendQuote(j1?.id);
  const url1 = r.body?.url, tok1 = url1?.split('/q/')[1];
  ok(r.status === 200 && !!tok1, '(setup) the quote is sent');
  let pg = await page(url1);
  const h = pg.html;
  ok(/Q-1001/.test(h), 'the job quote has a number, Q-1001');
  const issued = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  ok(h.includes('Issued') && h.includes('Valid until'), 'Issued and Valid until (Issued + 14 days)');
  ok(h.includes('Acme Cleaning LLC') && h.includes('1 Main St, Reno NV') && h.includes('(775) 555-0100') && h.includes('office@acme.test') && h.includes('NV-12345'), 'the business details are at the top');
  ok(h.includes('Prepared for') && h.includes('Dana Ruiz') && h.includes('9 Elm St'), 'Prepared for: the client’s name and address');
  ok(!h.includes(`dana${t}@x.test`) && !h.includes('555-0111'), 'not the client’s email or phone (the team hasn’t turned that on)');
  ok(h.includes('Prepared by') && h.includes('Rico V.') && h.includes('Owner') && !!sigUrl && h.includes(sigUrl), 'Prepared by: the business signature, name and title');
  ok(h.includes('Net 30. Thanks for your business.') && h.includes('Acme is licensed and insured.'), 'the default terms and the footer');
  ok(h.includes('$25.00') && h.includes('$60.00'), 'line prices show, and the total');
  ok(!/(src|href)="https?:\/\//.test(h.replace(/href="https:\/\/acme\.test"/g, '')) && /default-src 'none'/.test(pg.csp) && !/https?:/.test(pg.csp.replace(/form-action[^;]*/, '')), 'nothing loads from outside: ' + pg.csp);
  // Type mode: a typed name is needed, no drawing.
  ok(!/<canvas|<script/.test(h), 'type mode: no signature pad on the page');
  r = await answer(tok1, { name: '', v: vOf(h) });
  ok(!/Accepted by/.test((await page(url1)).html), 'type mode: no name, not accepted');
  r = await answer(tok1, { name: 'Dana Ruiz', v: vOf(h) });
  pg = await page(url1);
  ok(r.status === 303 && /Accepted by[^<]*Dana Ruiz/.test(pg.html), 'type mode: the typed name accepts it');
  let step = (await rico('GET', `/jobs/${j1?.id}/run`)).body?.run?.steps?.find((s) => s.name === 'Quote');
  ok(step?.answer?.method === 'typed' && step.answer.name === 'Dana Ruiz', 'the answer records how: typed: ' + JSON.stringify(step?.answer));
  ok(!(await sam('GET', `/jobs/${j1?.id}/run`)).body?.run?.steps?.find((s) => s.name === 'Quote')?.answer?.method, 'members don’t see the answer’s details');

  // The issued quote keeps its look; a New quote takes the current one.
  const j2 = await mkJob();
  r = await sendQuote(j2?.id);
  const url2 = r.body?.url;
  await rico('PATCH', '/docs-settings', { business: { name: 'Acme Pro Cleaning', address: '2 New Rd', phone: '(775) 555-0200', email: 'hi@acme.test', website: 'https://acme.test', license: 'NV-99999' }, terms: 'Due on receipt.', footer: 'New footer.', showPrices: false });
  pg = await page(url2);
  ok(pg.html.includes('Acme Cleaning LLC') && pg.html.includes('Net 30.') && pg.html.includes('Acme is licensed and insured.') && !pg.html.includes('Acme Pro Cleaning') && pg.html.includes('$25.00'), 'an issued quote keeps the details, terms, footer and prices it was sent with');
  ok(/Q-1002/.test(pg.html), 'and its own number, Q-1002');
  await rico('POST', `/jobs/${j2?.id}/requote`);
  r = await sendQuote(j2?.id);
  const url3 = r.body?.url;
  pg = await page(url3);
  ok(url3 && url3 !== url2 && pg.html.includes('Acme Pro Cleaning') && pg.html.includes('Due on receipt.') && pg.html.includes('New footer.'), 'a New quote takes the current settings');
  // Hidden prices: description and quantity only; the total always shows.
  ok(!pg.html.includes('$25.00') && !pg.html.includes('$10.00') && !pg.html.includes('$50.00') && pg.html.includes('$60.00') && pg.html.includes('Can clean'), 'prices hidden: no line prices or amounts, the total still shows');
  ok(/Q-1003/.test(pg.html), 'a New quote gets the next number');
  // Expiry: past Valid until it says expired and can't be accepted; 0 days never expires.
  const j3 = await mkJob();
  r = await sendQuote(j3?.id);
  const tok3 = r.body?.url?.split('/q/')[1];
  ok((await rico('POST', `/test/backdate-quote`, { recordId: j3?.id, days: 20 })).status === 200, '(setup) the quote was issued 20 days ago');
  pg = await page(r.body?.url);
  ok(/expired/i.test(pg.html) && !vOf(pg.html), 'past Valid until (14 days): it says it expired, no accept form');
  await answer(tok3, { name: 'Dana Ruiz', v: 'x' });
  ok(!(await rico('GET', `/jobs/${j3?.id}/run`)).body?.run?.steps?.find((s) => s.name === 'Quote')?.answer, 'and an accept is refused');
  await rico('PATCH', '/docs-settings', { validDays: 0 });
  const j4 = await mkJob();
  r = await sendQuote(j4?.id);
  await rico('POST', `/test/backdate-quote`, { recordId: j4?.id, days: 400 });
  pg = await page(r.body?.url);
  ok(!/expired/i.test(pg.html) && !pg.html.includes('Valid until') && !!vOf(pg.html), '0 days: no Valid until, never expires (issued 400 days ago, still open)');

  // ---------- draw mode ----------
  await rico('PATCH', '/docs-settings', { accept: 'draw', showPrices: true });
  const j5 = await mkJob();
  r = await sendQuote(j5?.id);
  const url5 = r.body?.url, tok5 = url5?.split('/q/')[1];
  const a1 = await page(url5), a2 = await page(url5);
  const nonceOf = (x) => x.csp.match(/script-src 'nonce-([\w+/=-]+)'/)?.[1];
  ok(!!nonceOf(a1) && a1.html.includes(`<script nonce="${nonceOf(a1)}"`) && /<canvas/.test(a1.html), 'draw mode: a signature pad, its script allowed by the page’s nonce');
  ok(nonceOf(a1) !== nonceOf(a2), 'a new nonce on every page');
  ok(!/script-src[^;]*(https?:|'unsafe-inline'|\*)/.test(a1.csp), 'and nothing else may run');
  const v5 = vOf(a1.html);
  for (const [why, sig] of [['no drawing', ''], ['not a PNG', NOT_PNG], ['over 100 KB', HUGE], ['a blank drawing', BLANK]]) {
    await answer(tok5, { name: 'Dana Ruiz', v: v5, sig });
    ok(!(await rico('GET', `/jobs/${j5?.id}/run`)).body?.run?.steps?.find((s) => s.name === 'Quote')?.answer && !!vOf((await page(url5)).html), 'draw mode refuses ' + why);
  }
  ok(Buffer.from(HUGE.split(',')[1], 'base64').length > 100_000 && HUGE.length < 200_000, '(the big drawing really is just over 100 KB: ' + HUGE.length + ')');
  r = await answer(tok5, { name: '', v: v5, sig: SIG });
  pg = await page(url5);
  ok(r.status === 303 && /Accepted/.test(pg.html), 'draw mode: a drawing accepts it, a typed name is optional');
  step = (await rico('GET', `/jobs/${j5?.id}/run`)).body?.run?.steps?.find((s) => s.name === 'Quote');
  ok(step?.answer?.method === 'drawn' && !!step.answer.signature, 'the answer records how: drawn, with the drawing: ' + step?.answer?.method);
  const shown = pg.html.match(/src="(\/q\/[^"]+\/signature[^"]*)"/)?.[1];
  const si = shown && await fetch(B + shown);
  ok(!!shown && si.status === 200 && si.headers.get('content-type') === 'image/png', 'the accepted page shows the customer’s drawing, served from Kloomie');
  ok(pg.html.includes('Prepared by') && pg.html.includes('Accepted by'), 'the business’s signature and the customer’s are shown apart');

  // ---------- own terms beat the default (a Bids & Quotes quote) ----------
  const bp = (await rico('POST', '/projects', { template: 'bids', name: 'Estimating' })).body;
  const T = Object.fromEntries(bp.types.map((x) => [x.key, x]));
  const q = (await rico('POST', `/projects/${bp.id}/records`, { typeId: T.quotes.id, values: { title: 'Tint', valid_until: '2099-12-31', terms: 'Half up front.', items: { rows: [{ desc: 'Film', qty: 10, price: 400 }] } } })).body;
  const q2 = (await rico('POST', `/projects/${bp.id}/records`, { typeId: T.quotes.id, values: { title: 'Wrap', valid_until: '2099-12-31', items: { rows: [{ desc: 'Vinyl', qty: 1, price: 900 }] } } })).body;
  const qs1 = (await rico('POST', `/records/${q.id}/share`, { hours: 0 })).body, qs2 = (await rico('POST', `/records/${q2.id}/share`, { hours: 0 })).body;
  const b1 = (await page(`${B}/q/${qs1?.share?.token}`)).html, b2 = (await page(`${B}/q/${qs2?.share?.token}`)).html;
  ok(b1.includes('Half up front.') && !b1.includes('Due on receipt.'), 'a quote’s own terms beat the default');
  ok(b2.includes('Due on receipt.') && b2.includes('Acme Pro Cleaning'), 'one without its own terms shows the default, and the business details');

  // ---------- the invoice page ----------
  const inv = (await rico('POST', `/records/${j1?.id}/invoices`)).body;
  const sent = (await rico('POST', `/invoices/${inv?.id}/send`)).body;
  pg = await page(sent?.url);
  ok(pg.status === 200 && pg.html.includes('Acme Pro Cleaning') && pg.html.includes('NV-99999') && pg.html.includes('New footer.'), 'the invoice page shows the business details and footer');
  ok(!pg.html.includes(sigUrl) && !pg.html.includes('Prepared by') && !pg.html.includes(`dana${t}@x.test`) && !pg.html.includes('555-0111'), 'and nothing extra: no signature, no customer email or phone');
} catch (e) {
  console.log('FAIL threw: ' + (e.stack || e.message));
  fails++;
} finally {
  srv.kill();
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
