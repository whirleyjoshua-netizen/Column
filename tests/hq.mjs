// Company HQ: the team's profile as approved entries under seven pillars; the old brand form writing into it; the
// website import reading the home page and its About and Services pages and suggesting entries (never approving
// them); suggestions accepted, edited or dismissed; only approved entries reach the AI; only owners and admins edit.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/hq';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4753, B = `http://127.0.0.1:${PORT}`, AI_PORT = 4751, SITE_PORT = 4752, SITE = `http://127.0.0.1:${SITE_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

// A small business website: a home page linking to About, Services and a blog post.
const page = (title, body, links = '') => `<!doctype html><html><head><title>${title}</title><meta name="description" content="Custom shades in Las Vegas"><script>var tracking = 'ignore me';</script><style>.x{}</style></head><body><nav><a href="/about">About us</a> <a href="/services">Our services</a> <a href="/blog/post-1">Blog</a> <a href="https://elsewhere.test/about">Partner</a></nav>${body}${links}</body></html>`;
const pages = {
  '/': page('Desert Shade Co', '<h1>Desert Shade Co</h1><p>Custom blinds, shades and shutters for homes across the Las Vegas Valley. You work with the owner from the first measure to the final install.</p><p>Free in-home measure. Call today.</p>'),
  '/about': page('About', '<h2>Our story</h2><p>Maria started Desert Shade in 2015 after 10 years installing for big box stores. We treat every home like our own, and we never pressure anyone into a sale.</p>'),
  '/services': page('Services', '<ul><li>Motorized roller shades</li><li>Plantation shutters</li><li>Faux wood blinds</li></ul><p>All installs carry a lifetime workmanship warranty.</p>'),
  '/blog/post-1': page('Blog', '<p>Five tips for picking blinds.</p>'),
};
const seen = [];
const site = http.createServer((req, res) => {
  seen.push(req.url);
  if (req.url === '/old') { res.writeHead(301, { location: '/' }); return res.end(); }
  const p = pages[req.url];
  if (!p) { res.writeHead(404); return res.end('nope'); }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(p);
});
await new Promise((r) => site.listen(SITE_PORT, '127.0.0.1', r));

// A stand-in AI: suggests entries from what it was sent, and records every request.
const asked = [];
const ai = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/models')) return res.end(JSON.stringify({ data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false }));
    const j = JSON.parse(b);
    const sys = typeof j.system === 'string' ? j.system : JSON.stringify(j.system);
    const user = JSON.stringify(j.messages);
    asked.push({ sys, user });
    let out = { text: 'ok' };
    if (sys.includes('interviewing the owner')) out = JSON.stringify(j.messages.at(-1)).includes('passed around')
      ? { reply: 'So nobody gets passed around. Would you call that a core value? And who are your best customers?', entries: [{ kind: 'value', title: 'One team, start to finish', text: 'Customers deal with us from the first call to the install.', do: ['Same person on every call'], dont: ['Handing people off'] }, { kind: 'teleport', title: 'x' }], done: false }
      : { reply: 'Thanks! That’s everything for now.', entries: [], done: true };
    if (sys.includes('own documents')) out = { entries: [
      { kind: 'pricing', title: 'Free measure', text: 'In-home measures are free.', file: 'prices.txt', why: 'top of the price sheet' },
      { kind: 'policy', title: 'Deposit', text: '50% to order.', file: 'prices.txt' },
      { kind: 'rule', title: 'Refunds', text: 'Any refund needs the owner.', level: 'approval', file: 'prices.txt' }], gaps: ['Warranty terms'] };
    if (sys.includes('pages from the business')) out = { entries: [
      { kind: 'about', title: '', text: 'Custom blinds, shades and shutters for homes across the Las Vegas Valley.', why: 'Home page', url: SITE + '/' },
      { kind: 'service', title: 'Motorized roller shades', text: '', why: 'Services page', url: SITE + '/services' },
      { kind: 'service', title: 'Plantation shutters', text: '', why: 'Services page', url: SITE + '/services' },
      { kind: 'value', title: 'No pressure', text: 'We never pressure anyone into a sale.', do: ['Give people time to decide'], dont: ['Countdown deals'], why: 'Inferred from the About page', url: SITE + '/about' },
      { kind: 'area', title: '', text: 'The Las Vegas Valley', url: SITE + '/' },
      { kind: 'teleport', title: 'Not a real kind', text: 'dropped' },
      { kind: 'service', title: 'motorized roller shades', text: 'a duplicate', url: SITE + '/services' },
    ], gaps: ['Pricing', 'Who your ideal customer is'] };
    res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((r) => ai.listen(AI_PORT, '127.0.0.1', r));

const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', ANTHROPIC_BASE_URL: `http://127.0.0.1:${AI_PORT}`, ALLOW_LOCAL_FETCH: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => Object.assign(async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}, { tok });
const t = Date.now();
try {
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Desert ' + t, name: 'Maria', email: `maria${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const maria = call(r.body.token);
  const code = (await maria('GET', '/state')).body.workspace.inviteCode;
  r = await call()('POST', '/auth', { mode: 'join', workspace: 'Desert ' + t, code, name: 'Sam', email: `sam${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' });
  const sam = call(r.body.token);
  ok((await maria('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' })).status === 200, 'the team has an AI key');

  r = await maria('GET', '/hq');
  ok(r.status === 200 && r.body.pillars.length === 7 && r.body.progress.done === 0 && r.body.progress.of === 10, 'a new team’s Company HQ: seven pillars, nothing filled in yet');

  // The old brand form writes into HQ.
  r = await maria('PATCH', '/brand', { mission: 'Shade that fits how you live', values: 'Honesty: no upsells\nShow up on time', tone: 'Warm, plain, never pushy' });
  ok(r.status === 200 && r.body.brand.mission === 'Shade that fits how you live' && /Honesty: no upsells/.test(r.body.brand.values) && r.body.brand.tone === 'Warm, plain, never pushy', 'the brand form still works, and reads back from HQ');
  r = await maria('GET', '/hq');
  const vals = r.body.entries.filter((x) => x.kind === 'value');
  ok(vals.length === 2 && vals[0].title === 'Honesty' && vals[0].text === 'no upsells' && vals.every((x) => x.status === 'approved' && x.source.type === 'brand'), 'its values became approved value entries');
  ok(r.body.progress.done === 3, 'mission, a value and a tone of voice count toward the profile: ' + r.body.progress.done + ' of 10');
  r = await maria('PATCH', '/brand', { values: 'Show up on time' });
  ok((await maria('GET', '/hq')).body.entries.filter((x) => x.kind === 'value').length === 1, 'taking a value out of the form takes it out of HQ');

  // Adding by hand.
  r = await maria('POST', '/hq/entries', { kind: 'rule', title: 'Discounts', text: 'Anything over 10% off', level: 'approval' });
  ok(r.status === 200 && r.body.entry.pillar === 'rules' && r.body.entry.level === 'approval' && r.body.entry.status === 'approved', 'an owner adds a rule: it goes under Rules & boundaries, approved');
  ok((await maria('POST', '/hq/entries', { kind: 'goal', title: 'Win 10 commercial accounts', horizon: 'quarter', target: '10 accounts', deadline: '2026-12-31' })).body.entry.horizon === 'quarter', 'and a goal for this quarter, with its target');
  ok((await maria('POST', '/hq/entries', { kind: 'martian', title: 'x' })).status === 400 && (await maria('POST', '/hq/entries', { kind: 'service' })).status === 400, 'nonsense kinds and empty entries are refused');
  ok((await sam('POST', '/hq/entries', { kind: 'service', title: 'Shutters' })).status === 403, 'members can’t change Company HQ');

  // The website import.
  ok((await maria('POST', '/hq/import', { url: 'not a site' })).status === 400, 'a bad address is refused');
  r = await maria('POST', '/hq/import', { url: SITE + '/old' });
  ok(r.status === 200 && r.body.added === 5 && r.body.pages >= 3, `the import follows the redirect, reads ${r.body.pages} pages and suggests ${r.body.added} entries`);
  ok(seen.includes('/about') && seen.includes('/services'), 'it read the About and Services pages it found on the home page');
  ok(!seen.includes('/blog/post-1'), 'but not pages that say nothing about the business, like a blog post');
  const imp = asked.find((x) => x.sys.includes('pages from the business'));
  ok(imp && imp.user.includes('Maria started Desert Shade') && imp.user.includes('Motorized roller shades') && !imp.user.includes('tracking'), 'the AI got the pages’ words, without their scripts');
  const sugg = r.body.entries.filter((x) => x.status === 'suggested');
  ok(sugg.length === 5 && sugg.every((x) => x.source.type === 'website' && x.source.url.startsWith(SITE)), 'every suggestion says which page it came from');
  ok(!sugg.some((x) => /dropped|duplicate/.test(x.text)), 'made-up kinds and duplicates are dropped');
  ok(r.body.import.gaps.includes('Pricing'), 'and what the site doesn’t say is listed as a gap');
  ok(r.body.progress.done === 5, 'suggestions don’t count until they’re approved: still ' + r.body.progress.done + ' of 10');
  ok(!(await sam('GET', '/hq')).body.entries.some((x) => x.status === 'suggested') && (await sam('GET', '/hq')).body.import === null, 'members see only what’s approved');

  // Accepting, editing, dismissing.
  const about = sugg.find((x) => x.kind === 'about');
  r = await maria('POST', `/hq/entries/${about.id}/approve`);
  ok(r.body.entry.status === 'approved' && r.body.entry.source.type === 'website', 'accepting a suggestion approves it and keeps where it came from');
  const value = sugg.find((x) => x.kind === 'value');
  r = await maria('PATCH', '/hq/entries/' + value.id, { title: 'Never pushy', approve: true });
  ok(r.body.entry.title === 'Never pushy' && r.body.entry.status === 'approved' && r.body.entry.dont[0] === 'Countdown deals', 'or edit it as you accept it');
  r = await maria('POST', '/hq/entries', { kind: 'about', text: 'We make homes cooler and calmer.' });
  ok(r.body.entries.filter((x) => x.kind === 'about' && x.status === 'approved').length === 1, 'there’s one “what we do”: a new one replaces the last');
  const left = r.body.entries.filter((x) => x.status === 'suggested');
  const svc = left.find((x) => x.kind === 'service');
  await maria('DELETE', '/hq/entries/' + svc.id);
  r = await maria('POST', '/hq/suggestions/accept');
  ok(r.body.entries.filter((x) => x.kind === 'service' && x.status === 'approved').length === 1 && !r.body.entries.some((x) => x.status === 'suggested'), 'dismiss one, accept the rest in one go');
  await maria('POST', '/hq/import', { url: SITE + '/' });
  r = await maria('POST', '/hq/suggestions/dismiss');
  ok(!r.body.entries.some((x) => x.status === 'suggested'), 'or dismiss them all');

  // What the AI hears.
  asked.length = 0;
  await maria('POST', '/ai/doc', { mode: 'write', ask: 'A short proposal' });
  const sys = asked[0]?.sys || '';
  ok(!(await (async () => { asked.length = 0; await maria('POST', '/hq/import', { url: SITE + '/' }); return asked[0].sys; })()).includes('What the team has told Kloomie'), 'the website import itself doesn’t get the profile (it’s building it)');
  ok(sys.includes('We make homes cooler and calmer') && sys.includes('Never pushy') && sys.includes('Countdown deals') && sys.includes('Needs an owner’s OK first'), 'approved entries reach the AI: what we do, values with what to avoid, rules');
  ok(sys.includes('Plantation shutters') && !sys.includes('Motorized roller shades'), 'an accepted service reaches the AI; a dismissed one doesn’t');

  // The interview.
  r = await maria('GET', '/hq');
  ok(r.body.chat.turns.length === 0 && /your story/.test(r.body.chat.opening) && (await sam('GET', '/hq')).body.chat === null, 'the interview starts with your story (and members don’t see it)');
  ok((await sam('POST', '/hq/interview', { text: 'hi' })).status === 403 && (await maria('POST', '/hq/interview', { text: '  ' })).status === 400, 'only owners and admins answer, and an empty answer is refused');
  asked.length = 0;
  r = await maria('POST', '/hq/interview', { text: 'We started in 2015. Customers never get passed around; they deal with me the whole way.' });
  const iv = asked.find((x) => x.sys.includes('interviewing the owner'));
  ok(r.status === 200 && r.body.added === 1 && r.body.chat.turns.length === 3 && r.body.chat.turns[0].text === r.body.chat.opening, 'an answer gets a reply, and the opening question is kept in the conversation');
  ok(iv && iv.sys.includes('What the profile has so far') && iv.sys.includes('Show up on time') && iv.user.includes('passed around'), 'the AI hears what the profile already has, and the answer');
  const ivEntry = r.body.entries.find((x) => x.source?.type === 'interview');
  ok(ivEntry?.status === 'suggested' && ivEntry.dont[0] === 'Handing people off' && /passed around/.test(ivEntry.source.why) && r.body.chat.turns[2].suggested[0] === ivEntry.id, 'it becomes a suggestion, linked to the reply, with what was said');
  r = await maria('POST', '/hq/interview', { text: 'That covers it.' });
  ok(r.body.chat.turns.at(-1).done === true && r.body.chat.turns.length === 5, 'the interview can finish');
  r = await maria('DELETE', '/hq/interview');
  ok(r.body.chat.turns.length === 0 && r.body.entries.some((x) => x.id === ivEntry.id), 'start over clears the conversation, not the suggestions');

  // Documents.
  const up = async (tok, name, body) => (await fetch(B + '/api/upload?' + new URLSearchParams({ name }), { method: 'PUT', headers: { authorization: 'Bearer ' + tok }, body })).json();
  const prices = await up(maria.tok, 'prices.txt', 'PRICE SHEET\nMeasure: free\nDeposit: 50% to order\nDiscounts over 10% need Maria.');
  ok((await maria('POST', '/hq/docs', { itemIds: [] })).status === 400, 'reading needs a file');
  asked.length = 0;
  r = await maria('POST', '/hq/docs', { itemIds: [prices.id] });
  const dq = asked.find((x) => x.sys.includes('own documents'));
  ok(r.status === 200 && r.body.added === 3 && dq?.user.includes('Discounts over 10% need Maria'), 'a price sheet is read and suggests 3 entries');
  const fromDoc = r.body.entries.filter((x) => x.source?.type === 'doc');
  ok(fromDoc.length === 3 && fromDoc.every((x) => x.source.name === 'prices.txt' && x.source.itemId === prices.id && x.status === 'suggested'), 'each says which file it came from');
  ok(r.body.docs.files[0].name === 'prices.txt' && r.body.docs.files[0].count === 3 && r.body.docs.gaps[0] === 'Warranty terms', 'the files read and what they don’t settle are kept');
  ok(fromDoc.find((x) => x.kind === 'rule').level === 'approval', 'a rule keeps its level');
  r = await call()('POST', '/auth', { mode: 'create', workspace: 'Other ' + t, name: 'Zed', email: `zed${t}@t.test`, password: 'longenough3', device: 'Mac', deviceId: 'd3' });
  const zed = call(r.body.token);
  ok((await zed('POST', '/hq/docs', { itemIds: [prices.id] })).status === 400, 'another team can’t read your files');
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
srv.kill();
site.close();
ai.close();
if (fails) console.log(srv.log.split('\n').slice(-15).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
