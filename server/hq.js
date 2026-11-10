// Company HQ: what Kloomie knows about the business, so everything the AI writes or plans for the team sounds like
// them and follows their way of working. It's kept as entries under seven pillars (who they are, why they exist,
// how they sound, where they're going, who they serve, how they work, and the rules), each marked with where it
// came from and whether the owner has approved it. Only approved entries reach the AI; suggestions (from the
// website import, or later from the interview and documents) wait for an owner or admin to accept them.
//
// The website import reads the team's own public site (the home page and a handful of its pages, like About,
// Services and FAQ), and asks the team's AI to suggest entries from what the pages actually say.
import dns from 'node:dns/promises';
import net from 'node:net';

export const PILLARS = [
  { key: 'identity', name: 'Company identity', about: 'Who you are and what you do', kinds: ['about', 'service', 'area', 'model', 'different', 'notwanted'] },
  { key: 'purpose', name: 'Mission & values', about: 'Why you exist and what you stand for', kinds: ['mission', 'story', 'value'] },
  { key: 'brand', name: 'Brand & voice', about: 'How you sound and present yourselves', kinds: ['voice', 'prefer', 'avoid', 'never'] },
  { key: 'goals', name: 'Vision & goals', about: 'Where you’re going and what success means', kinds: ['vision', 'goal'] },
  { key: 'customers', name: 'Customers & culture', about: 'Who you serve and how you treat people', kinds: ['ideal', 'why', 'objection', 'culture'] },
  { key: 'operations', name: 'How we work', about: 'How work gets done, from first call to paid', kinds: ['process', 'policy', 'pricing'] },
  { key: 'rules', name: 'Rules & boundaries', about: 'What needs approval, and what’s off limits', kinds: ['rule'] },
];
export const KINDS = {
  about: { name: 'What we do', one: true, hint: 'What you sell, who to, and where, in a few sentences.' },
  service: { name: 'Product or service', hint: 'One thing you sell, e.g. Motorized roller shades.' },
  area: { name: 'Where we work', one: true, hint: 'e.g. The Las Vegas Valley and Henderson.' },
  model: { name: 'How we make money', one: true, hint: 'e.g. Product sales plus installation; most jobs $1–5k.' },
  different: { name: 'What makes us different', hint: 'e.g. You deal with the owner from first call to install.' },
  notwanted: { name: 'Work we don’t want', hint: 'e.g. Commercial jobs over 50 windows.' },
  mission: { name: 'Mission', one: true, hint: 'Why the business exists, in a sentence or two.' },
  story: { name: 'Our story', one: true, hint: 'How and why it started.' },
  value: { name: 'Value', principle: true, hint: 'Something you won’t compromise on, e.g. Customers before the sale.' },
  voice: { name: 'Tone of voice', one: true, hint: 'How you sound, e.g. Warm and direct. Short sentences. Never pushy.' },
  prefer: { name: 'Words we use', hint: 'e.g. We say “your home”, not “the property”.' },
  avoid: { name: 'Words we avoid', hint: 'e.g. Cheap, deal, ASAP.' },
  never: { name: 'Never promise or claim', hint: 'e.g. Never promise an install date before the order ships.' },
  vision: { name: 'Where we’re headed', one: true, hint: 'Where you want the business in 3–5 years.' },
  goal: { name: 'Goal', goal: true, hint: 'e.g. Win 10 commercial accounts this quarter.' },
  ideal: { name: 'Ideal customer', hint: 'Who you do your best work for.' },
  why: { name: 'Why customers choose us', hint: 'e.g. Fast measure appointments; honest pricing.' },
  objection: { name: 'Common objection', hint: 'What customers push back on, and how you answer.' },
  culture: { name: 'How we treat people', hint: 'e.g. We own our mistakes and fix them the same week.' },
  process: { name: 'How work gets done', hint: 'A step in your process, e.g. Every lead gets a call back the same day.' },
  policy: { name: 'Policy', hint: 'e.g. 50% deposit to order; balance on install.' },
  pricing: { name: 'Pricing', hint: 'e.g. Free measure; motorization adds $250 a window.' },
  rule: { name: 'Rule', rule: true, hint: 'e.g. Discounts over 10% need the owner’s OK.' },
};
const AREAS = ['sales', 'customers', 'jobs', 'marketing', 'money', 'team'];
const HORIZONS = ['long', 'year', 'quarter'];
const LEVELS = ['auto', 'approval', 'never'];
const SOURCES = ['owner', 'website', 'brand', 'ai'];
// What a profile needs before the AI has enough to go on: one of each.
const ESSENTIALS = ['about', 'service', 'area', 'mission', 'value', 'voice', 'goal', 'ideal', 'process', 'rule'];

const PAGE_HINT = /about|story|who-we|mission|value|service|product|pricing|price|cost|faq|question|area|location|warrant|guarantee|review|testimonial|team|process|how-it|why/i;
const MAX_PAGES = 7;
const PAGE_BYTES = 1_500_000;
const PAGE_CHARS = 6000;

export function hqModule({ db, save, broadcast, rid, cleanText, readJson, send, isAdmin, aiAsk, replyJson, allowLocal = false }) {
  db.hq ||= {};
  const entriesOf = (wsId) => Object.values(db.hq).filter((x) => x.wsId === wsId).sort((a, b) => a.createdAt - b.createdAt);
  const approved = (wsId) => entriesOf(wsId).filter((x) => x.status === 'approved');
  const pillarOf = (kind) => PILLARS.find((p) => p.kinds.includes(kind))?.key;
  const list = (v, n, max) => [...new Set((Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => cleanText(x, max)).filter(Boolean))].slice(0, n);

  // An entry as it's kept: the fields its kind uses, nothing else.
  function clean(body, was = {}) {
    const kind = KINDS[body.kind] ? body.kind : was.kind;
    if (!KINDS[kind]) throw Object.assign(new Error('Pick what kind of thing this is.'), { status: 400 });
    const k = KINDS[kind];
    const pick = (f) => (body[f] !== undefined ? body[f] : was[f]);
    const x = { kind, pillar: pillarOf(kind), title: cleanText(pick('title'), 160), text: cleanText(pick('text'), 4000) };
    if (!x.title && !x.text) throw Object.assign(new Error('Write something first.'), { status: 400 });
    if (k.principle) {
      x.do = list(pick('do'), 12, 300);
      x.dont = list(pick('dont'), 12, 300);
      x.areas = list(pick('areas'), 6, 20).filter((a) => AREAS.includes(a));
      x.priority = [1, 2, 3].includes(Number(pick('priority'))) ? Number(pick('priority')) : 2;
    }
    if (k.goal) {
      x.horizon = HORIZONS.includes(pick('horizon')) ? pick('horizon') : 'year';
      x.target = cleanText(pick('target'), 120);
      x.deadline = /^\d{4}-\d{2}-\d{2}$/.test(pick('deadline') || '') ? pick('deadline') : null;
      x.priority = [1, 2, 3].includes(Number(pick('priority'))) ? Number(pick('priority')) : 2;
    }
    if (k.rule) x.level = LEVELS.includes(pick('level')) ? pick('level') : 'approval';
    return x;
  }
  const publicEntry = ({ wsId, ...x }) => x;
  const news = (wsId) => broadcast(wsId, { type: 'hq' });
  function add(ws, fields, { status, source, by }) {
    const x = { id: rid(), wsId: ws.id, ...fields, status, source, by, createdAt: Date.now(), updatedAt: Date.now() };
    if (status === 'approved') Object.assign(x, { approvedBy: by, approvedAt: Date.now() });
    // Some kinds are one per team (the mission, the tone of voice): an approved one replaces the last.
    if (status === 'approved' && KINDS[x.kind].one) for (const y of approved(ws.id)) if (y.kind === x.kind) delete db.hq[y.id];
    db.hq[x.id] = x;
    return x;
  }

  // A suggestion accepted: it stays the same entry (and keeps where it came from), now approved.
  function approveIn(ws, x, by) {
    if (x.status === 'approved') return;
    if (KINDS[x.kind].one) for (const y of approved(ws.id)) if (y.kind === x.kind) delete db.hq[y.id];
    Object.assign(x, { status: 'approved', approvedBy: by, approvedAt: Date.now(), updatedAt: Date.now() });
  }

  // How complete the profile is: the essentials it has (approved), and what's still missing.
  function progress(wsId) {
    const have = new Set(approved(wsId).map((x) => x.kind));
    const missing = ESSENTIALS.filter((k) => !have.has(k));
    return { done: ESSENTIALS.length - missing.length, of: ESSENTIALS.length, pct: Math.round(((ESSENTIALS.length - missing.length) / ESSENTIALS.length) * 100), missing: missing.map((k) => ({ kind: k, name: KINDS[k].name, pillar: pillarOf(k) })) };
  }
  function state(ws, auth) {
    const admin = isAdmin(auth);
    return {
      pillars: PILLARS, kinds: KINDS,
      entries: entriesOf(ws.id).filter((x) => admin || x.status === 'approved').map(publicEntry),
      progress: progress(ws.id),
      import: admin ? ws.hqImport || null : null,
    };
  }

  // ---------- what the AI hears ----------
  // The approved entries, grouped the way a person would brief a new hire. This replaces the old brand block, and
  // step 3 narrows it to what each kind of work needs.
  function prompt(ws) {
    const es = approved(ws.id);
    if (!es.length) return '';
    const line = (x) => {
      const head = [x.title, x.text].filter(Boolean).join(': ');
      const more = [x.do?.length && `Do: ${x.do.join('; ')}`, x.dont?.length && `Never: ${x.dont.join('; ')}`, x.target && `Target: ${x.target}`, x.deadline && `By ${x.deadline}`,
        x.level && { auto: 'Fine to do without asking', approval: 'Needs an owner’s OK first', never: 'Never do this' }[x.level]].filter(Boolean).join('. ');
      return `- ${head}${more ? ` (${more})` : ''}`;
    };
    const parts = PILLARS.map((p) => {
      const mine = es.filter((x) => x.pillar === p.key).sort((a, b) => (a.priority || 2) - (b.priority || 2));
      if (!mine.length) return '';
      return `${p.name}:\n${mine.map((x) => (KINDS[x.kind].one ? `- ${KINDS[x.kind].name}: ${x.text || x.title}` : line(x))).join('\n')}`;
    }).filter(Boolean);
    return `\n\nWhat the team has told Kloomie about their business. Follow it in anything you write or plan for them, and don’t contradict it or make up facts about the business that aren’t here:\n${parts.join('\n')}`;
  }
  // The old brand fields, read from HQ, for the brand card and anything else that still asks for them.
  function brandText(ws) {
    const one = (kind) => approved(ws.id).find((x) => x.kind === kind);
    return {
      mission: one('mission')?.text || '',
      values: approved(ws.id).filter((x) => x.kind === 'value').map((x) => [x.title, x.text].filter(Boolean).join(': ')).join('\n'),
      tone: one('voice')?.text || '',
      about: one('about')?.text || '',
    };
  }
  // The old brand form (PATCH /api/brand with mission, values, tone, about) still works: it writes HQ entries.
  function setBrandText(ws, body, by) {
    const single = { mission: 'mission', tone: 'voice', about: 'about' };
    for (const [f, kind] of Object.entries(single)) {
      if (body[f] === undefined) continue;
      const text = cleanText(body[f], 4000);
      if (text) add(ws, { kind, pillar: pillarOf(kind), title: '', text }, { status: 'approved', source: { type: 'brand' }, by });
      else for (const y of approved(ws.id)) if (y.kind === kind) delete db.hq[y.id];
    }
    if (body.values !== undefined) {
      const lines = list(body.values, 20, 300);
      const have = approved(ws.id).filter((x) => x.kind === 'value');
      const key = (s) => s.toLowerCase().replace(/\s+/g, ' ');
      for (const y of have) if (!lines.some((l) => key(l) === key([y.title, y.text].filter(Boolean).join(': ')))) delete db.hq[y.id];
      for (const l of lines) {
        if (have.some((y) => db.hq[y.id] && key(l) === key([y.title, y.text].filter(Boolean).join(': ')))) continue;
        const [title, ...rest] = l.split(':');
        add(ws, clean({ kind: 'value', title: rest.length ? title : l, text: rest.join(':').trim() }), { status: 'approved', source: { type: 'brand' }, by });
      }
    }
    news(ws.id);
  }
  // Teams that wrote a brand before HQ existed keep it, as approved entries.
  function migrate(ws) {
    const b = ws.brand || {};
    if (ws.hqMigrated || !(b.mission || b.values || b.tone || b.about)) return false;
    setBrandText(ws, { mission: b.mission || undefined, values: b.values || undefined, tone: b.tone || undefined, about: b.about || undefined }, 'Kloomie');
    ws.hqMigrated = true;
    return true;
  }

  // ---------- reading the team's website ----------
  const privateIp = (ip) => {
    if (net.isIPv4(ip)) {
      const [a1, b1] = ip.split('.').map(Number);
      return a1 === 10 || a1 === 127 || a1 === 0 || (a1 === 169 && b1 === 254) || (a1 === 172 && b1 >= 16 && b1 <= 31) || (a1 === 192 && b1 === 168) || (a1 === 100 && b1 >= 64 && b1 <= 127);
    }
    const s = ip.toLowerCase();
    return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80') || s.startsWith('::ffff:');
  };
  async function publicUrl(v) {
    let u;
    try {
      u = new URL(/^https?:\/\//i.test(String(v || '').trim()) ? String(v).trim() : 'https://' + String(v || '').trim());
    } catch {
      throw Object.assign(new Error('Enter your website’s address, like yourbusiness.com'), { status: 400 });
    }
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') && !allowLocal) throw Object.assign(new Error('Enter your website’s address, like yourbusiness.com'), { status: 400 });
    if (!allowLocal) {
      const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
      if (!addrs.length) throw Object.assign(new Error(`Couldn’t find ${u.hostname}. Check the address.`), { status: 400 });
      if (addrs.some((x) => privateIp(x.address))) throw Object.assign(new Error('That address isn’t a public website.'), { status: 400 });
    }
    u.hash = '';
    return u;
  }
  // One page as text, following up to 3 redirects (each checked again), within size and time limits.
  async function getPage(start) {
    let u = start;
    for (let hop = 0; hop < 4; hop++) {
      const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; KloomieBot/1.0; +https://www.kloomie.com)', accept: 'text/html,application/xhtml+xml' } });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        u = await publicUrl(new URL(r.headers.get('location'), u).href);
        continue;
      }
      if (!r.ok) throw new Error(`${u.hostname} answered ${r.status}`);
      if (!/html/i.test(r.headers.get('content-type') || 'text/html')) throw new Error('Not a web page');
      const reader = r.body.getReader();
      const chunks = [];
      let n = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.length;
        if (n > PAGE_BYTES) { reader.cancel().catch(() => {}); break; }
        chunks.push(value);
      }
      return { url: u, html: Buffer.concat(chunks).toString('utf8') };
    }
    throw new Error('Too many redirects');
  }
  const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;|&rsquo;/g, '’').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d) || 32));
  function readPage(html, url) {
    const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim());
    const meta = decode(html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i)?.[1] || '');
    // What a site says about itself for search engines: name, address, area served, hours.
    const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].trim()).join('\n').slice(0, 2000);
    const text = decode(html.replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
      .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 2).join('\n').slice(0, PAGE_CHARS);
    const links = [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((m) => {
      try { return { href: new URL(m[1], url).href, label: decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() }; } catch { return null; }
    }).filter((l) => l && new URL(l.href).hostname === url.hostname && /^https?:$/.test(new URL(l.href).protocol));
    return { title, meta, ld, text, links };
  }
  async function readSite(raw) {
    const home = await publicUrl(raw);
    let first;
    try {
      first = await getPage(home);
    } catch (e) {
      throw Object.assign(new Error(`Couldn’t open ${home.hostname}: ${e.message}.`), { status: 400 });
    }
    const pages = [{ url: first.url.href, ...readPage(first.html, first.url) }];
    const seen = new Set([first.url.href.replace(/\/$/, '')]);
    const next = pages[0].links.filter((l) => PAGE_HINT.test(l.href + ' ' + l.label) && !/\.(pdf|jpe?g|png|gif|zip)$/i.test(l.href))
      .filter((l) => { const k = l.href.replace(/\/$/, ''); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, MAX_PAGES - 1);
    const more = await Promise.all(next.map(async (l) => {
      try { const p = await getPage(await publicUrl(l.href)); return { url: p.url.href, ...readPage(p.html, p.url) }; } catch { return null; }
    }));
    return pages.concat(more.filter(Boolean));
  }

  const IMPORT_SYSTEM = `You help a small business set up its company profile in Kloomie. You are given the text of pages from the business's own website. Suggest profile entries using ONLY what the pages say or clearly show. Never invent facts, numbers, prices, promises or policies. Where you are inferring (for example a value or a tone of voice from how they write), say so in "why".

Kinds you can use, by pillar:
${PILLARS.map((p) => `- ${p.name}: ${p.kinds.map((k) => `${k} (${KINDS[k].name})`).join(', ')}`).join('\n')}

Reply with JSON only, in this shape:
{"entries":[{"kind":"service","title":"short name","text":"one or two plain sentences","do":["for kind value only: what this looks like in practice"],"dont":["for kind value only: what to avoid"],"why":"which page says this, or what you inferred it from","url":"the page it came from"}],"gaps":["important things the site doesn't say, that the owner should fill in"]}

Aim for 8 to 25 entries. Use one entry per service. Write in plain words, in the business's own voice where you can. Skip anything that's generic filler.`;

  async function importSite(ws, auth, raw) {
    const pages = await readSite(raw);
    const words = pages.reduce((n, p) => n + p.text.split(/\s+/).length, 0);
    if (words < 40) throw Object.assign(new Error('That site has almost no text Kloomie can read (it may be built entirely in JavaScript or images). Try another page, or fill in your profile by hand.'), { status: 400 });
    const brief = pages.map((p) => [`PAGE ${p.url}`, p.title && `Title: ${p.title}`, p.meta && `Description: ${p.meta}`, p.ld && `Structured data: ${p.ld}`, p.text].filter(Boolean).join('\n')).join('\n\n---\n\n');
    const out = replyJson(await aiAsk(ws, auth.memberId, IMPORT_SYSTEM, `The business is called ${ws.name}.\n\n${brief}`));
    const have = entriesOf(ws.id);
    const same = (a, b) => a.kind === b.kind && (a.title || a.text).toLowerCase().trim() === (b.title || b.text).toLowerCase().trim();
    const added = [];
    for (const e of (Array.isArray(out.entries) ? out.entries : []).slice(0, 40)) {
      let fields;
      try { fields = clean({ ...e, areas: [] }); } catch { continue; }
      if (have.concat(added).some((y) => same(y, fields))) continue;
      const pageUrl = pages.find((p) => p.url === e.url)?.url || pages[0].url;
      added.push(add(ws, fields, { status: 'suggested', source: { type: 'website', url: pageUrl, why: cleanText(e.why, 300) }, by: auth.member }));
    }
    ws.hqImport = { url: pages[0].url, at: Date.now(), by: auth.member, pages: pages.map((p) => ({ url: p.url, title: cleanText(p.title, 120) })), count: added.length, gaps: list(out.gaps, 8, 200) };
    save();
    news(ws.id);
    return { added: added.length, pages: pages.length, gaps: ws.hqImport.gaps };
  }

  // ---------- routes: /api/hq ----------
  async function route(req, res, parts, auth, ws) {
    const [a, b, c, d] = parts;
    if (a !== 'hq') return null;
    const m = req.method;
    if (!b && m === 'GET') return send(res, 200, state(ws, auth));
    if (!isAdmin(auth)) return send(res, 403, { error: 'Only team owners and admins can change Company HQ.' });
    if (b === 'import' && !c && m === 'POST') {
      const body = await readJson(req);
      try {
        const out = await importSite(ws, auth, body.url);
        return send(res, 200, { ...out, ...state(ws, auth) });
      } catch (e) {
        if (!e.status) console.error('Website import failed:', e.message);
        return send(res, e.status || 502, { error: e.status ? e.message : 'Couldn’t read the site just now. Try again in a minute.' });
      }
    }
    if (b === 'entries' && !c && m === 'POST') {
      const body = await readJson(req);
      let fields;
      try { fields = clean(body); } catch (e) { return send(res, 400, { error: e.message }); }
      const x = add(ws, fields, { status: 'approved', source: { type: SOURCES.includes(body.source) ? body.source : 'owner' }, by: auth.member });
      save();
      news(ws.id);
      return send(res, 200, { entry: publicEntry(x), ...state(ws, auth) });
    }
    if (b === 'suggestions' && c === 'accept' && m === 'POST') {
      for (const x of entriesOf(ws.id)) if (x.status === 'suggested' && db.hq[x.id]) approveIn(ws, x, auth.member);
      save();
      news(ws.id);
      return send(res, 200, state(ws, auth));
    }
    if (b === 'suggestions' && c === 'dismiss' && m === 'POST') {
      for (const x of entriesOf(ws.id)) if (x.status === 'suggested') delete db.hq[x.id];
      save();
      news(ws.id);
      return send(res, 200, state(ws, auth));
    }
    const x = b === 'entries' && db.hq[c]?.wsId === ws.id ? db.hq[c] : null;
    if (b === 'entries' && !x) return send(res, 404, { error: 'That entry is gone.' });
    if (x && !d && m === 'PATCH') {
      const body = await readJson(req);
      let fields;
      try { fields = clean(body, x); } catch (e) { return send(res, 400, { error: e.message }); }
      Object.assign(x, fields, { updatedAt: Date.now(), editedBy: auth.member });
      if (body.approve) approveIn(ws, x, auth.member);
      save();
      news(ws.id);
      return send(res, 200, { entry: publicEntry(x), ...state(ws, auth) });
    }
    if (x && d === 'approve' && m === 'POST') {
      approveIn(ws, x, auth.member);
      save();
      news(ws.id);
      return send(res, 200, { entry: publicEntry(x), ...state(ws, auth) });
    }
    if (x && !d && m === 'DELETE') {
      delete db.hq[x.id];
      save();
      news(ws.id);
      return send(res, 200, state(ws, auth));
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  return { route, prompt, brandText, setBrandText, migrate, state, progress, readSite };
}
