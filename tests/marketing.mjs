// The Marketing Manager, Postiz and pictures. Postiz: only owners and admins connect it, a wrong key is refused,
// the key never comes back, channels Kloomie can post to are told apart from the rest. Pictures are made on the
// team's OpenAI or Gemini key (newest image model from the provider's own list) and kept in Kloomie; a Claude-only
// team is told it needs one. The agent reads what's working (leads by source and what they became, found through
// a trade job's contact, a job's client and by email), finds past customers (never anyone marked do not contact),
// starts a campaign with goals and tasks and a list, makes a picture, and drafts posts and an email campaign that
// wait for a yes; a draft that can't work goes back to it; approving (with edits) posts through Postiz or emails
// from the person's mailbox; a scheduled post can be undone; monthly schedules run in the first week only.
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2]);
const DIR = S + '/dk/marketing';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4715, B = `http://127.0.0.1:${PORT}`, FAKE = 4714, F = `http://127.0.0.1:${FAKE}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// ----- stand-ins: Claude (scripted), OpenAI images, Gemini images, Postiz -----
const seen = { asked: [], images: [], pz: [] };
const text = (c) => (typeof c === 'string' ? c : (c || []).map((b) => b.text || (b.type === 'tool_result' ? b.content : '')).join(' '));
let today = '';
const ids = {};
const SCRIPTS = {
  'what is working': (n) => [[['marketing_snapshot', { days: 365 }]], 'Website brings the most work.'][n],
  'win-back campaign': (n) => [
    [['find_customers', { who: 'past', need: 'email' }], ['list_channels', {}]],
    [['create_campaign', { name: 'Fall win-back', brief: 'Past customers, a check-in and a reason to come back. Success: 5 booked estimates.', start: today, goals: [{ title: 'Booked estimates', kind: 'count', target: 5 }, { title: 'Get it out', tasks: [{ text: 'Call anyone who opens but doesn’t book', due: today, assignee: 'Ben' }] }] }]],
    [['make_list', { campaign: 'Fall win-back', name: 'Past customers', contact_ids: ids.past }], ['make_image', { prompt: 'A sunlit living room with new roller shades, warm afternoon light, photo style', title: 'Win-back picture', shape: 'square' }]],
    [['draft_social_post', { channels: ['Facebook', 'Instagram'], text: 'Fall light is here. Time to check your shades?', image_id: ids.img, when: ids.when }], ['draft_social_post', { channels: ['Instagram'], text: 'No picture post' }], ['draft_email_campaign', { campaign: 'Fall win-back', contact_ids: [...ids.past, ids.dnc], subject: 'Checking in on your shades', body: 'Hi {First name},\n\nIt’s been a while since we put in your shades. Want us to take a look this fall?\n\nAda' }]],
    'Campaign set up; a post and an email are waiting for you.',
  ][n],
  'gemini picture': (n) => [[['make_image', { prompt: 'A storefront with awnings', title: 'Storefront', shape: 'landscape' }], ['draft_social_post', { channels: ['Facebook'], text: 'Look at this install!\n\n[Photo: the Ortiz shutters]' }]], 'Made it.'][n],
  'photo post': (n) => [
    [['find_photos', {}]],
    [['look_at_photos', { ids: ids.photos }]],
    [['look_at_photos', { ids: ids.photos }], ['draft_social_post', { channels: ['Facebook'], text: 'Fresh shutters in Henderson: bright, clean and cool.', image_id: ids.jobPhoto, why: 'The Ortiz shutters job (after shot)' }]],
    'Drafted a post with the Ortiz after shot.',
  ][n],
  'job photos only': (n) => [[['find_photos', { where: 'jobs' }], ['find_photos', { job: 'Ortiz shutters' }], ['find_photos', { query: 'kitchen' }]], 'Done.'][n],
  'claude only picture': (n) => [[['make_image', { prompt: 'Anything' }]], 'Could not.'][n],
};
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    const out = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const u = new URL(req.url, F);
    // Postiz
    if (u.pathname === '/pz/oauth/token') {
      const j = JSON.parse(raw.toString() || '{}');
      seen.token = j;
      if (j.client_id !== 'pca_test' || j.client_secret !== 'pcs_test') return out(401, { error: 'invalid_client' });
      if (j.grant_type !== 'authorization_code' || j.code !== 'good-code') return out(400, { error: 'invalid_grant' });
      return out(200, { id: 'org_1', cus: 'cus_x', access_token: 'pos_oauth_token_1', token_type: 'bearer' });
    }
    if (u.pathname.startsWith('/pz/public/v1')) {
      const p = u.pathname.slice('/pz/public/v1'.length);
      seen.pz.push({ method: req.method, p, auth: req.headers.authorization, body: req.headers['content-type']?.includes('json') ? JSON.parse(raw.toString() || 'null') : raw.length });
      if (!['pz-good-key-123', 'pos_oauth_token_1'].includes(req.headers.authorization)) return out(401, { message: 'Unauthorized' });
      if (p === '/integrations') return out(200, [
        { id: 'fb1', name: 'Premier Shades', identifier: 'facebook', picture: 'https://x.test/a.png', disabled: false, profile: 'premier' },
        { id: 'ig1', name: 'premiershades', identifier: 'instagram', picture: '', disabled: false, profile: 'premiershades' },
        { id: 'gm1', name: 'Premier Shade Solutions', identifier: 'gmb', picture: '', disabled: false, profile: '' },
        { id: 'yt1', name: 'Premier TV', identifier: 'youtube', picture: '', disabled: false, profile: '' },
      ]);
      if (p === '/upload' && req.method === 'POST') return out(200, { id: 'm1', path: 'https://uploads.postiz.test/m1.png', status: 'ready' });
      if (p === '/posts' && req.method === 'POST') { const j = JSON.parse(raw.toString()); return out(200, j.posts.map((x, i) => ({ postId: 'p' + (seen.pz.length * 10 + i), integration: x.integration.id }))); }
      if (p === '/posts' && req.method === 'GET') return out(200, { posts: [{ id: 'p1', content: '<p>Hello</p>', publishDate: new Date().toISOString(), state: 'PUBLISHED', error: null, integration: { id: 'fb1', providerIdentifier: 'facebook', name: 'Premier Shades' } }, { id: 'p2', content: 'Oops', publishDate: new Date().toISOString(), state: 'ERROR', error: 'Token expired', integration: { id: 'ig1', providerIdentifier: 'instagram', name: 'premiershades' } }] });
      if (p.startsWith('/posts/') && req.method === 'DELETE') return out(200, { id: p.slice(7) });
      return out(404, { message: 'nope' });
    }
    // OpenAI images
    if (u.pathname === '/oa/models') return out(200, { data: [{ id: 'gpt-4o' }, { id: 'gpt-image-1' }, { id: 'gpt-image-2.6-sunburst' }, { id: 'gpt-image-2.6-mini' }, { id: 'dall-e-3' }] });
    if (u.pathname === '/oa/images/generations') { const j = JSON.parse(raw.toString()); seen.images.push({ who: 'openai', ...j, auth: req.headers.authorization }); return out(200, { data: [{ b64_json: PNG.toString('base64') }] }); }
    // Gemini images
    if (u.pathname === '/gm/v1beta/models') return out(200, { models: [{ name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3-pro-image', supportedGenerationMethods: ['generateContent'] }, { name: 'models/imagen-4', supportedGenerationMethods: ['predict'] }, { name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent'] }] });
    if (u.pathname.startsWith('/gm/v1beta/models/') && u.pathname.endsWith(':generateContent')) { const j = JSON.parse(raw.toString()); seen.images.push({ who: 'gemini', model: decodeURIComponent(u.pathname.split('/')[4].split(':')[0]), ...j }); return out(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] }); }
    // Anthropic
    if (u.pathname.startsWith('/v1/models')) return out(200, { data: [{ id: 'claude-test', display_name: 'Test', type: 'model', created_at: '2026-01-01T00:00:00Z' }], has_more: false });
    const j = JSON.parse(raw.toString());
    const sys = typeof j.system === 'string' ? j.system : JSON.stringify(j.system);
    const msgs = j.messages;
    seen.asked.push({ sys, msgs: JSON.stringify(msgs), tools: (j.tools || []).map((t) => t.name) });
    const reply = (content, stop = 'end_turn') => out(200, { id: 'm', type: 'message', role: 'assistant', model: 'claude-test', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
    if (sys.includes('describe a small business’s own photos')) {
      const blocks = msgs[0].content;
      seen.vision = (seen.vision || 0) + 1;
      seen.visionImages = blocks.filter((b) => b.type === 'image').length;
      return reply([{ type: 'text', text: JSON.stringify({ photos: blocks.filter((b) => b.type === 'image').map((_, i) => ({ n: i + 1, text: i === 0 ? 'After shot: white plantation shutters in a bright living room, good light. A house number is readable through the window.' : 'In-progress shot of a kitchen window with a tape measure, a bit dark.' })) }) }]);
    }
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user' && typeof m.content === 'string');
    const key = Object.keys(SCRIPTS).find((k) => text(lastUser?.content).toLowerCase().includes(k));
    const n = msgs.length - 1 - msgs.lastIndexOf(lastUser);
    // Remember what earlier tool calls returned (the picture's id), for later turns.
    const lastRes = msgs.at(-1)?.role === 'user' && Array.isArray(msgs.at(-1).content) ? msgs.at(-1).content.map((b) => b.content).join(' ') : '';
    const m = lastRes.match(/"id":"([^"]+)","note":"Use this id/);
    if (m) ids.img = m[1];
    const step = key ? SCRIPTS[key](Math.floor(n / 2), sys) : 'Done.';
    if (typeof step === 'string' || !step) return reply([{ type: 'text', text: step || 'Done.' }]);
    reply([{ type: 'text', text: 'Working.' }, ...step.map(([name, input], i) => ({ type: 'tool_use', id: `tu_${n}_${i}`, name, input }))], 'tool_use');
  });
});
await new Promise((r) => fake.listen(FAKE, '127.0.0.1', r));
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: DIR, MAIL_OUTBOX: '1', DATABASE_URL: '', ALLOW_LOCAL_WEBHOOKS: '1', ANTHROPIC_BASE_URL: F, OPENAI_BASE_URL: F + '/oa', GEMINI_BASE_URL: F + '/gm', POSTIZ_URL: F + '/pz/public/v1', POSTIZ_CLIENT_ID: 'pca_test', POSTIZ_CLIENT_SECRET: 'pcs_test', POSTIZ_AUTHORIZE_URL: F + '/pzauth/authorize', POSTIZ_TOKEN_URL: F + '/pz/oauth/token' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(150); }
const call = (tok) => async (m, p, body) => {
  const r = await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const t = Date.now();
try {
  today = new Date().toLocaleDateString('en-CA');
  let r = await call()('POST', '/auth', { mode: 'create', workspace: 'Premier ' + t, name: 'Ada', email: `ada${t}@t.test`, password: 'longenough1', device: 'Mac', deviceId: 'd1' });
  const adaTok = r.body.token;
  const ada = call(adaTok);
  const code = (await ada('GET', '/state')).body.workspace.inviteCode;
  const benTok = (await call()('POST', '/auth', { mode: 'join', workspace: 'Premier ' + t, code, name: 'Ben', email: `ben${t}@t.test`, password: 'longenough2', device: 'Mac', deviceId: 'd2' })).body.token;
  const ben = call(benTok);
  await ada('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-1234567890' });
  await ada('PUT', '/ai/keys/openai', { key: 'sk-openai-test-key-1234567890' });
  await ada('PATCH', '/workspace', { tools: { projects: true } });

  // ----- Postiz -----
  ok((await ben('PUT', '/postiz', { key: 'pz-good-key-123' })).status === 403, 'only owners and admins connect Postiz');
  r = await ada('PUT', '/postiz', { key: 'pz-wrong-key-999' });
  ok(r.status === 400 && /didn’t accept the API key/.test(r.body.error) && !(await ada('GET', '/postiz')).body.connected, 'a wrong key is refused, and nothing is saved');
  ok((await ada('PUT', '/postiz', { key: 'short' })).status === 400, 'a key that isn’t one is refused');
  r = await ada('PUT', '/postiz', { key: 'pz-good-key-123' });
  ok(r.status === 200 && r.body.connected && r.body.last4 === '-123' && r.body.channels.length === 4, 'the right key connects, with its channels');
  ok(seen.pz.at(-1).auth === 'pz-good-key-123' && seen.pz.at(-1).p === '/integrations', 'Postiz gets the key as it is, no “Bearer”');
  ok(r.body.channels.find((x) => x.id === 'yt1').usable === false && r.body.channels.find((x) => x.id === 'gm1').kindName === 'Google Business Profile', 'channels Kloomie can post to are told apart (YouTube isn’t one)');
  ok(!JSON.stringify((await ben('GET', '/postiz')).body).includes('pz-good-key') && !JSON.stringify((await ada('GET', '/state')).body).includes('pz-good-key'), 'the key never comes back to the app');

  // ----- Some history: contacts with sources, jobs that name them three ways -----
  const C = async (name, email, source, extra = {}) => (await ada('POST', '/contacts', { name, email, source, ...extra })).body;
  const maria = await C('Maria Lopez', 'maria@lopez.test', 'Website');
  const sam = await C('Sam Ortiz', 'sam@ortiz.test', 'Referral');
  const dnc = await C('Dee Nope', 'dee@nope.test', 'Website', { dne: true });
  const lead = await C('Lee New', 'lee@new.test', 'Website');
  const crm = (await ada('POST', '/projects', { template: 'crm', name: 'Sales' })).body;
  const deals = crm.types.find((x) => x.key === 'deals'), people = crm.types.find((x) => x.key === 'contacts');
  const Fd = (tp, k) => tp.fields.find((x) => x.key === k);
  const mariaRec = (await ada('POST', `/projects/${crm.id}/records`, { typeId: people.id, values: { name: 'Maria Lopez', email: 'maria@lopez.test' } })).body;
  const ago14 = new Date(Date.now() - 425 * 864e5).toISOString().slice(0, 10);
  await ada('POST', `/projects/${crm.id}/records`, { typeId: deals.id, values: { name: 'Lopez office blinds', value: 4200, stage: Fd(deals, 'stage').choices.find((c) => c.label === 'Won').id, contact: [mariaRec.id], close_date: ago14 } });
  const jobs = (await ada('POST', '/projects', { template: 'jobs', name: 'Installs' })).body;
  const jt = jobs.types.find((x) => x.key === 'jobs'), ct = jobs.types.find((x) => x.key === 'clients');
  const samClient = (await ada('POST', `/projects/${jobs.id}/records`, { typeId: ct.id, values: { name: 'Sam Ortiz', email: 'sam@ortiz.test' } })).body;
  const samJob = (await ada('POST', `/projects/${jobs.id}/records`, { typeId: jt.id, values: { job: 'Ortiz shutters', client: [samClient.id], value: 1800, install_date: ago14 } })).body;
  const dncClient = (await ada('POST', `/projects/${jobs.id}/records`, { typeId: ct.id, values: { name: 'Dee Nope', email: 'dee@nope.test' } })).body;
  await ada('POST', `/projects/${jobs.id}/records`, { typeId: jt.id, values: { job: 'Nope job', client: [dncClient.id], install_date: ago14 } });

  const wait = async (tok, id) => { for (let i = 0; i < 100; i++) { const x = (await tok('GET', '/agents/runs/' + id)).body; if (x && !['requested', 'planning', 'running'].includes(x.status)) return x; await sleep(100); } return (await tok('GET', '/agents/runs/' + id)).body; };
  const steps = (x) => x.parts.flatMap((p) => p.steps);

  r = await ada('GET', '/agents');
  ok(Object.keys(r.body.agents).join() === 'chief,sales,ops,marketing' && r.body.agents.marketing.name === 'Marketing Manager', 'four agents now, with the Marketing Manager');
  ok(r.body.agents.marketing.tools.filter((x) => x.important).map((x) => x.key).sort().join() === 'draft_email_campaign,draft_social_post', 'posting and email campaigns always wait for a yes');

  // ----- What's working -----
  r = await ada('POST', '/agents/runs', { agent: 'marketing', ask: 'what is working' });
  let x = await wait(ada, r.body.id);
  const snap = seen.asked.find((q) => q.sys.includes('You are the Marketing Manager') && q.msgs.includes('leadsBySource'))?.msgs || '';
  ok(x.status === 'completed' && snap.includes('\\"Website\\":{\\"leads\\":3,\\"becameWork\\":2,\\"won\\":1,\\"wonValue\\":4200}'), 'what’s working: Website brought 3 leads, 2 became work (by email, through a deal’s contact and a job’s client), 1 won for $4,200');
  ok(snap.includes('\\"Referral\\":{\\"leads\\":1,\\"becameWork\\":1') && snap.includes('\\"published\\":1'), 'and referrals; posts are read from Postiz');
  ok(snap.includes('Token expired'), 'a failed post comes with its reason');
  const msys = seen.asked.find((q) => q.sys.includes('You are the Marketing Manager')).sys;
  ok(msys.includes('Never invent reviews, testimonials') && msys.includes('one of the specialists') === false && msys.includes('reviews: marketing'), 'it is told how to do the job well (no invented reviews or offers)');

  // ----- Win back past customers: the whole thing -----
  ids.past = [maria.id, sam.id];
  ids.dnc = dnc.id;
  ids.when = `${new Date(Date.now() + 3 * 864e5).toLocaleDateString('en-CA')} 09:30`;
  r = await ada('POST', '/agents/runs', { agent: 'marketing', workflow: 'winback' });
  x = await wait(ada, r.body.id);
  const s = steps(x);
  const find = (tool, i = 0) => s.filter((y) => y.tool === tool)[i];
  ok(find('find_customers').status === 'done' && find('list_channels').status === 'done', 'it looks for past customers and checks the channels');
  const fc = seen.asked.find((q) => q.msgs.includes('canEmail'))?.msgs || '';
  ok(fc.includes('Lopez office blinds') && fc.includes('Ortiz shutters') && !fc.includes('Lee New') && fc.includes('doNotContact\\":true'), 'past customers come with their last job (Lee never had one), and Dee is marked do not contact');
  const camp = (await ada('GET', '/state')).body.campaigns.find((c) => c.name === 'Fall win-back');
  ok(find('create_campaign').status === 'done' && camp, 'a real campaign, Fall win-back');
  const st = (await ada('GET', '/state')).body;
  ok(st.goals.filter((g) => g.campaignId === camp.id).length === 2 && st.goals.some((g) => g.kind === 'count' && g.target === 5) && st.tasks.some((y) => y.text.startsWith('Call anyone who opens') && y.assigneeId), 'with its goals (5 booked estimates) and a task for Ben');
  const list = st.lists.find((l) => l.campaignId === camp.id);
  ok(find('make_list').status === 'done' && list?.rows.length === 2 && list.rows.some((r2) => r2.cells.includes('maria@lopez.test')), 'a list of the two past customers on it');
  const img = find('make_image');
  const item = st.items.find((y) => y.id === img.changed?.[0]?.id);
  ok(img.status === 'done' && item?.type === 'file' && item.mime === 'image/png' && item.by === 'Ada’s Marketing Manager', 'a picture, made and kept in Kloomie');
  ok(seen.images[0]?.who === 'openai' && seen.images[0].model === 'gpt-image-2.6-sunburst' && seen.images[0].size === '1024x1024' && seen.images[0].auth === 'Bearer sk-openai-test-key-1234567890', 'on Ada’s OpenAI key, with the newest full image model it has');
  const post = find('draft_social_post', 0), bad = find('draft_social_post', 1), em = find('draft_email_campaign');
  ok(post.status === 'proposed' && !seen.pz.some((y) => y.p === '/posts' && y.method === 'POST'), 'the post waits for a yes: nothing went to Postiz');
  ok(bad.status === 'failed' && /Instagram posts need a picture/.test(bad.error), 'an Instagram post without a picture goes back to the agent to fix, not to Ada');
  ok(em.status === 'proposed' && x.status === 'awaiting', 'the email campaign waits for a yes too');
  ok(em.args.contact_ids.length === 2 && !em.args.contact_ids.includes(dnc.id) && em.names[maria.id] === 'Maria Lopez' && /1 left out/.test(em.why), 'it goes to Maria and Sam by name; Dee (do not contact) is left out, and it says so');

  // ----- What's already waiting is part of the picture, so nothing is drafted twice -----
  seen.asked.length = 0;
  const wr = await ada('POST', '/agents/runs', { agent: 'marketing', ask: 'what is working' });
  await wait(ada, wr.body.id);
  ok(seen.asked.some((q) => q.msgs.includes('waitingForYes') && q.msgs.includes('Email campaign to 2 people')), 'what’s working includes drafts already waiting for a yes (the win-back email)');

  // Approve the post, moved to 10:00.
  const newWhen = `${new Date(Date.now() + 3 * 864e5).toLocaleDateString('en-CA')} 10:00`;
  r = await ada('POST', `/agents/runs/${x.id}/steps`, { do: 'approve', id: post.id, args: { text: 'Fall light is here. Time for new shades?', when: newWhen } });
  const p2 = steps(r.body).find((y) => y.id === post.id);
  const sent = seen.pz.filter((y) => y.p === '/posts' && y.method === 'POST').at(-1)?.body;
  ok(p2.status === 'done' && seen.pz.some((y) => y.p === '/upload'), 'approved: the picture goes to Postiz first');
  ok(sent?.type === 'schedule' && sent.posts.length === 2 && sent.posts.every((y) => y.value[0].content === 'Fall light is here. Time for new shades?' && y.value[0].image[0].path === 'https://uploads.postiz.test/m1.png'), 'then the post, as edited, scheduled to Facebook and Instagram with the picture');
  ok(sent.posts.find((y) => y.integration.id === 'ig1').settings.__type === 'instagram' && sent.posts.find((y) => y.integration.id === 'ig1').settings.post_type === 'post', 'with each channel’s settings');
  const wantUtc = new Date(newWhen.replace(' ', 'T') + ':00').toISOString();
  ok(sent.date === wantUtc, 'at 10:00 on the team’s clock: ' + sent.date);
  r = await ada('POST', `/agents/runs/${x.id}/steps`, { do: 'undo', id: post.id });
  ok(steps(r.body).find((y) => y.id === post.id).status === 'undone' && seen.pz.some((y) => y.method === 'DELETE' && y.p.startsWith('/posts/')), 'a scheduled post can be undone (taken out of Postiz)');

  // The email campaign: Dee is never emailed; approving sends from the mailbox (none connected here: says so).
  r = await ada('POST', `/agents/runs/${x.id}/steps`, { do: 'approve', id: em.id, args: { subject: 'A quick check-in' } });
  const e2 = steps(r.body).find((y) => y.id === em.id);
  ok(e2.status === 'failed' && /Confirm your email|Connect Outlook or Gmail/.test(e2.error), 'approving goes through the usual checks (a confirmed email, a connected mailbox) and says what’s missing: ' + e2.error);

  // ----- The business's own photos -----
  const up = async (tok, name, mime, q = '') => (await fetch(B + `/api/upload?name=${encodeURIComponent(name)}&type=${encodeURIComponent(mime)}${q}`, { method: 'POST', headers: { authorization: 'Bearer ' + tok }, body: PNG })).json();
  const dir = (await ada('POST', '/dirs', { name: 'Marketing photos' })).body;
  const benDir = (await ben('POST', '/dirs', { name: 'Ben private', private: true })).body;
  const camp1 = (await ada('GET', '/state')).body.campaigns.find((c) => c.name === 'Fall win-back');
  const inFolder = await up(adaTok, 'kitchen-in-progress.jpg', 'image/jpeg', `&dirId=${dir.id}`);
  const inStack = await up(adaTok, 'team-photo.png', 'image/png', `&stackId=${camp1.stackId}`);
  const onJob = await up(adaTok, 'ortiz-after.jpg', 'image/jpeg');
  await ada('PATCH', '/records/' + samJob.id, { values: { [jt.fields.find((f) => f.key === 'photos').id]: [onJob.id] } });
  const heic = await up(adaTok, 'IMG_2041.HEIC', 'image/heic');
  const benOnly = await up(benTok, 'ben-secret.jpg', 'image/jpeg', `&dirId=${benDir.id}`);
  ids.photos = [onJob.id, inFolder.id];
  ids.jobPhoto = onJob.id;
  await ada('PUT', '/ai/keys/openai', { key: 'sk-openai-test-key-1234567890' });
  seen.asked.length = 0;
  r = await ada('POST', '/agents/runs', { agent: 'marketing', ask: 'photo post' });
  x = await wait(ada, r.body.id);
  const fp = seen.asked.find((q) => q.msgs.includes('ortiz-after.jpg'))?.msgs || '';
  ok(fp.includes('Photos on Ortiz shutters') && fp.includes('Folder: Marketing photos') && fp.includes('Stack: Fall win-back') && fp.includes('team-photo.png'), 'find_photos finds photos on jobs, in Folders and in a campaign’s Stack, and says where each is');
  ok(fp.includes('HEIC can’t be posted') && !fp.includes('ben-secret'), 'an iPhone HEIC is flagged as not postable, and Ben’s private folder isn’t visible to Ada’s agent');
  ok(seen.vision === 1 && seen.visionImages === 2, 'look_at_photos shows the two photos to Ada’s AI, as pictures');
  ok(fp.includes('After shot: white plantation shutters') === false && seen.asked.some((q) => q.msgs.includes('After shot: white plantation shutters') && q.msgs.includes('house number')), 'and the agent hears what each shows, including what shouldn’t be posted');
  const ps = steps(x).find((y) => y.tool === 'draft_social_post');
  ok(ps.status === 'proposed' && ps.args.image_id === onJob.id && /Ortiz shutters/.test(ps.why), 'it drafts a post with the real job photo, saying which job');
  ok(steps(x).filter((y) => y.tool === 'look_at_photos').length === 2 && seen.vision === 1, 'looking at the same photos again uses what was already seen (no second AI call)');
  const msys2 = seen.asked.find((q) => q.sys.includes('You are the Marketing Manager')).sys;
  ok(msys2.includes('their own photos first') && msys2.includes('check the customer is happy'), 'it’s told to use their own photos first, and to check with the customer');
  r = await ada('POST', '/agents/runs', { agent: 'marketing', ask: 'job photos only' });
  x = await wait(ada, r.body.id);
  const outs = seen.asked.filter((q) => q.msgs.includes('job photos only')).at(-1).msgs;
  ok(outs.includes('ortiz-after.jpg') && (outs.match(/kitchen-in-progress/g) || []).length >= 1, 'filters: on jobs, from one job, and by words (a photo’s name or what it was seen to show)');
  ok(steps(x).every((y) => y.status === 'done'), 'all three searches work');
  void heic; void inStack; void benOnly;

  // ----- Pictures on Gemini; a Claude-only team is told -----
  await ada('DELETE', '/ai/keys/openai');
  await ada('PUT', '/ai/keys/gemini', { key: 'gm-test-key-1234567890' });
  r = await ada('POST', '/agents/runs', { agent: 'marketing', ask: 'gemini picture' });
  x = await wait(ada, r.body.id);
  const gi = seen.images.find((y) => y.who === 'gemini');
  ok(steps(x)[0].status === 'done' && gi?.model === 'gemini-3.1-flash-image' && gi.generationConfig.imageConfig.aspectRatio === '4:3', 'on Gemini: its newest flash image model, in landscape');
  ok(steps(x)[1].status === 'failed' && /placeholder/.test(steps(x)[1].error), 'a post with a [Photo: …] note left in goes back to be written without it');
  await ada('DELETE', '/ai/keys/gemini');
  r = await ada('POST', '/agents/runs', { agent: 'marketing', ask: 'claude only picture' });
  x = await wait(ada, r.body.id);
  const lastAsk = seen.asked.filter((q) => q.sys.includes('You are the Marketing Manager')).at(-1);
  ok(!lastAsk.tools.includes('make_image') && lastAsk.sys.includes('no OpenAI or Gemini key on this account'), 'with only a Claude key: no picture tool, and it’s told why (so it doesn’t try)');

  // ----- Members, schedules, disconnect -----
  await ben('PUT', '/ai/keys/anthropic', { key: 'sk-ant-test-key-0987654321' });
  r = await ben('POST', '/agents/runs', { agent: 'marketing', ask: 'set up a win-back campaign' });
  x = await wait(ben, r.body.id);
  ok(steps(x)[0].status === 'failed' && /owners and admins/.test(steps(x)[0].error), 'a member’s Marketing Manager can’t read Contacts, because they can’t');
  r = await ada('PATCH', '/agents/marketing', { level: 'automate', schedules: [{ workflow: 'plan', days: [0, 1, 2, 3, 4, 5, 6], at: 0 }, { workflow: 'campaign', days: [1], at: 60 }] });
  ok(r.body.schedules.length === 1 && r.body.workflows.find((w) => w.key === 'plan').monthly, 'the monthly plan can be scheduled (a paste-in one can’t)');
  ok((await ada('DELETE', '/postiz')).body.connected === false, 'disconnect Postiz');

  // ----- Connect with Postiz (OAuth) -----
  ok((await ada('GET', '/postiz')).body.oauth === true, 'with Kloomie’s Postiz app set up, Connect with Postiz is offered');
  ok((await ben('POST', '/postiz/connect')).status === 403, 'only owners and admins start it');
  r = await ada('POST', '/postiz/connect');
  const au = new URL(r.body.url);
  const state = au.searchParams.get('state');
  ok(au.origin + au.pathname === F + '/pzauth/authorize' && au.searchParams.get('client_id') === 'pca_test' && au.searchParams.get('response_type') === 'code' && state.length >= 20, 'it sends Ada to Postiz’s approval page with Kloomie’s app id and a one-time state');
  const cb = (q) => fetch(B + '/oauth/postiz/callback?' + new URLSearchParams(q), { redirect: 'manual' });
  let res2 = await cb({ code: 'good-code', state: 'made-up' });
  ok(res2.status === 302 && res2.headers.get('location') === '/postiz/done?r=expired', 'an unknown state is refused (and answered with a redirect, never a page)');
  res2 = await cb({ code: 'good-code', state });
  ok(res2.status === 302 && res2.headers.get('location') === '/postiz/done?r=connected', 'coming back with the code connects it');
  ok(seen.token.grant_type === 'authorization_code' && seen.token.code === 'good-code' && seen.token.client_secret === 'pcs_test', 'the code is swapped for a token with Kloomie’s app secret, on the server');
  r = await ada('GET', '/postiz');
  ok(r.body.connected && r.body.via === 'oauth' && r.body.org === 'org_1' && r.body.channels.length === 4 && !JSON.stringify(r.body).includes('pos_oauth'), 'connected through Postiz, with the channels; the token never comes back to the app');
  ok(seen.pz.at(-1).auth === 'pos_oauth_token_1', 'and the token is used like a key');
  res2 = await cb({ code: 'good-code', state });
  ok(res2.headers.get('location') === '/postiz/done?r=expired', 'a state works once');
  r = await ada('POST', '/postiz/connect');
  res2 = await cb({ error: 'access_denied', state: new URL(r.body.url).searchParams.get('state') });
  ok(res2.headers.get('location') === '/postiz/done?r=denied', 'saying no in Postiz is understood');
  r = await ada('POST', '/postiz/connect');
  res2 = await cb({ code: 'bad-code', state: new URL(r.body.url).searchParams.get('state') });
  ok(res2.headers.get('location') === '/postiz/done?r=failed' && (await ada('GET', '/postiz')).body.via === 'oauth', 'a code Postiz won’t take fails, and the connection already there stays');
  const page = await (await fetch(B + '/postiz/done?r=connected')).text();
  ok(page.includes('Postiz connected') && page.includes('postMessage'), 'the done page says so (and tells the Kloomie window)');
} catch (e) {
  console.log('FAIL ' + e.stack);
  fails++;
}
srv.kill();
fake.close();
if (fails) console.log(srv.log.split('\n').filter((l) => /error|fail/i.test(l)).slice(-15).join('\n'));
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
