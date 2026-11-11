// Company HQ: what Kloomie knows about the business, so everything the AI writes or plans for the team sounds like
// them and follows their way of working. It's kept as entries under seven pillars (who they are, why they exist,
// how they sound, where they're going, who they serve, how they work, and the rules), each marked with where it
// came from and whether the owner has approved it. Only approved entries reach the AI; suggestions (from the
// website import, or later from the interview and documents) wait for an owner or admin to accept them.
//
// The website import reads the team's own public site (the home page and a handful of its pages, like About,
// Services and FAQ), and asks the team's AI to suggest entries from what the pages actually say.
import dns from 'node:dns/promises';
import { privateIp, safeFetch } from './safefetch.js';

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
const SOURCES = ['owner', 'website', 'brand', 'ai', 'interview', 'doc', 'learned'];
const LEARN_EVERY = 3; // edited drafts before Kloomie looks for a pattern
const REVIEW_DAYS = Number(process.env.HQ_REVIEW_DAYS || 90); // how often goals get a "still right?" check
// What a profile needs before the AI has enough to go on: one of each.
const ESSENTIALS = ['about', 'service', 'area', 'mission', 'value', 'voice', 'goal', 'ideal', 'process', 'rule'];

const PAGE_HINT = /about|story|who-we|mission|value|service|product|pricing|price|cost|faq|question|area|location|warrant|guarantee|review|testimonial|team|process|how-it|why/i;
const PAGE_ORDER = [/about|story|who-we|mission|value/i, /service|product/i, /pricing|price|cost/i, /faq|question/i, /review|testimonial/i, /warrant|guarantee|process|how-it|why/i, /area|location/i, /team/i];
const MAX_PAGES = 7;
// The kinds of AI work, and what each needs to know. kinds: 'all', or a list; areas: which values apply (a value
// with no areas applies everywhere); needs: what to flag when it's missing; null kinds: nothing (the profile tools).
const BASICS = ['about', 'service', 'area', 'different'];
export const TASKS = {
  general: { label: 'anything', kinds: 'all', voice: true, rules: true },
  customer: { label: 'writing to a customer', kinds: [...BASICS, 'mission', 'value', 'voice', 'prefer', 'avoid', 'never', 'why', 'objection', 'culture', 'process', 'policy', 'pricing', 'rule'], areas: ['customers', 'sales', 'marketing'], needs: ['voice', 'pricing'], voice: true, rules: true },
  sales: { label: 'moving a customer, deal or job forward', kinds: [...BASICS, 'notwanted', 'value', 'voice', 'prefer', 'avoid', 'never', 'goal', 'ideal', 'why', 'objection', 'process', 'policy', 'pricing', 'rule'], areas: ['sales', 'customers', 'jobs'], needs: ['ideal', 'voice', 'pricing'], voice: true, rules: true },
  writing: { label: 'writing a document', kinds: [...BASICS, 'model', 'mission', 'story', 'value', 'voice', 'prefer', 'avoid', 'never', 'vision', 'goal', 'ideal', 'why', 'culture', 'process', 'policy', 'pricing', 'rule'], needs: ['voice'], voice: true, rules: true },
  internal: { label: 'notes and reports for the team', kinds: [...BASICS, 'mission', 'value', 'goal', 'culture', 'process', 'policy', 'rule'], areas: ['team', 'jobs', 'money'], rules: true },
  plan: { label: 'planning work', kinds: [...BASICS, 'model', 'notwanted', 'mission', 'value', 'vision', 'goal', 'ideal', 'culture', 'process', 'policy', 'rule'], needs: ['goal'], rules: true },
  jobs: { label: 'pricing and running jobs', kinds: ['service', 'area', 'notwanted', 'value', 'never', 'process', 'policy', 'pricing', 'rule'], areas: ['jobs', 'customers', 'money'], needs: ['pricing'], rules: true },
  money: { label: 'money and budgets', kinds: ['model', 'value', 'vision', 'goal', 'pricing', 'policy', 'rule'], areas: ['money'], needs: ['goal'], rules: true },
  profile: { label: 'setting up the profile', kinds: null },
};
const PER_KIND = 8;
const MAX_PROMPT = 6000;
const PAGE_BYTES = 1_500_000;
const PAGE_CHARS = 6000;

export function hqModule({ db, save, broadcast, rid, cleanText, readJson, send, isAdmin, aiAsk, aiRun, itemFiles, replyJson, enforced = () => [], writePlaybook = null, allowLocal = false }) {
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
    if (status === 'approved' && x.kind === 'goal') ws.hqReviewedAt = Date.now();
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
  function progress(ws) {
    const have = new Set(approved(ws.id).map((x) => x.kind));
    if (enforced(ws).length) have.add('rule'); // a rule Kloomie enforces counts
    const missing = ESSENTIALS.filter((k) => !have.has(k));
    return { done: ESSENTIALS.length - missing.length, of: ESSENTIALS.length, pct: Math.round(((ESSENTIALS.length - missing.length) / ESSENTIALS.length) * 100), missing: missing.map((k) => ({ kind: k, name: KINDS[k].name, pillar: pillarOf(k) })) };
  }
  function state(ws, auth) {
    const admin = isAdmin(auth);
    return {
      pillars: PILLARS, kinds: KINDS,
      entries: entriesOf(ws.id).filter((x) => admin || x.status === 'approved').map(publicEntry),
      progress: progress(ws),
      import: admin ? ws.hqImport || null : null,
      chat: admin ? { opening: OPENING, turns: chatOf(ws) } : null,
      docs: admin ? { files: ws.hqDocs || [], gaps: ws.hqDocGaps || [] } : null,
      learning: admin ? { edits: (ws.hqEdits || []).filter((x) => !x.read).length, every: LEARN_EVERY, lastAt: ws.hqLearnAt || null } : null,
      review: reviewDue(ws),
      playbook: ws.hqPlaybook || null,
    };
  }

  // ---------- what the AI hears: the behavior engine ----------
  // Each kind of AI work gets the parts of the profile that bear on it, not all of it: an email to a customer
  // needs the voice, the customer-facing values and what never to promise; a plan needs the goals, the work the
  // team doesn't want and the rules; an estimate needs the services, prices and policies. Values that name the
  // areas they matter in only go to work in those areas. What the work needs but the profile doesn't have is
  // named, so the AI says so instead of making it up.
  function prompt(ws, task = 'general') {
    const t = TASKS[task] || TASKS.general;
    if (!t.kinds) return '';
    const es = approved(ws.id);
    const enforcedLines = t.rules ? enforced(ws) : [];
    if (!es.length && !enforcedLines.length) return '';
    const fits = (x) => t.kinds === 'all' || t.kinds.includes(x.kind);
    const inArea = (x) => !t.areas || !x.areas?.length || x.areas.some((a) => t.areas.includes(a));
    const horizon = { quarter: 0, year: 1, long: 2 };
    const mine = es.filter((x) => fits(x) && inArea(x)).sort((a, b) => (a.priority || 2) - (b.priority || 2) || (horizon[a.horizon] ?? 3) - (horizon[b.horizon] ?? 3));
    const line = (x) => {
      if (KINDS[x.kind].one) return `- ${KINDS[x.kind].name}: ${x.text || x.title}`;
      const head = [x.title, x.text].filter(Boolean).join(': ');
      const more = [x.priority === 1 && (x.kind === 'goal' ? 'Top priority' : 'Most important'), x.horizon && { long: 'Long term', year: 'This year', quarter: 'This quarter' }[x.horizon],
        x.do?.length && `Do: ${x.do.join('; ')}`, x.dont?.length && `Never: ${x.dont.join('; ')}`, x.target && `Target: ${x.target}`, x.deadline && `By ${x.deadline}`,
        x.level && { auto: 'Fine to do without asking', approval: 'Needs an owner’s OK first', never: 'Never do this' }[x.level]].filter(Boolean).join('. ');
      return `- ${head}${more ? ` (${more})` : ''}`;
    };
    const parts = PILLARS.map((p) => {
      const group = [];
      for (const k of p.kinds) group.push(...mine.filter((x) => x.kind === k).slice(0, PER_KIND));
      return group.length ? `${p.name}:\n${group.map(line).join('\n')}` : '';
    }).filter(Boolean);
    let text = parts.join('\n');
    if (text.length > MAX_PROMPT) text = text.slice(0, MAX_PROMPT).replace(/\n[^\n]*$/, '');
    const have = new Set(es.map((x) => x.kind));
    const missing = (t.needs || []).filter((k) => !have.has(k)).map((k) => KINDS[k].name.toLowerCase());
    return [
      `\n\nWhat the team has told Kloomie about their business, for this kind of work (${t.label}). Follow it and don’t contradict it. Don’t make up facts about the business that aren’t here: no prices, fees, dates, policies, procedures, services or history they haven’t given. Where something is needed and missing, leave a short [gap in brackets] for them to fill, or say what you’d need to know.`,
      text ? text : '',
      enforcedLines.length ? `Rules Kloomie enforces for this team (people can’t get around these, so don’t suggest it):\n${enforcedLines.join('\n')}` : '',
      t.voice && have.has('voice') ? 'Write in their tone of voice. Use the words they use and avoid the ones they avoid.' : '',
      t.rules && (have.has('rule') || enforcedLines.length) ? 'Where a rule says something needs an owner’s OK, don’t do it or promise it. To a customer, just say you’ll check and come back to them; don’t mention an owner, who may be the person writing.' : '',
      missing.length ? `Their profile doesn’t say yet: ${missing.join(', ')}. If your answer depends on it, say so plainly instead of guessing.` : '',
    ].filter(Boolean).join('\n');
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
      const r = await safeFetch(u.href, { allowLocal, httpsOnly: false, timeout: 10_000, maxBytes: PAGE_BYTES, truncate: true, headers: { 'user-agent': 'Mozilla/5.0 (compatible; KloomieBot/1.0; +https://www.kloomie.com)', accept: 'text/html,application/xhtml+xml' } });
      if (r.status >= 300 && r.status < 400 && r.headers.location) {
        u = await publicUrl(new URL(r.headers.location, u).href);
        continue;
      }
      if (!r.ok) throw new Error(`${u.hostname} answered ${r.status}`);
      if (!/html/i.test(r.headers['content-type'] || 'text/html')) throw new Error('Not a web page');
      return { url: u, html: await r.text() };
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
    // The pages that say the most about a business first; one page from each section (a site's twenty
    // service-area pages count as one).
    const rank = (l) => { const i = PAGE_ORDER.findIndex((re) => re.test(l.href + ' ' + l.label)); return i < 0 ? PAGE_ORDER.length : i; };
    const sections = new Set();
    const next = pages[0].links.filter((l) => PAGE_HINT.test(l.href + ' ' + l.label) && !/\.(pdf|jpe?g|png|gif|zip)$/i.test(l.href))
      .filter((l) => { const k = l.href.replace(/\/$/, ''); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => rank(a) - rank(b))
      .filter((l) => { const parts = new URL(l.href).pathname.split('/').filter(Boolean); if (parts.length < 2) return true; if (sections.has(parts[0])) return false; sections.add(parts[0]); return true; })
      .slice(0, MAX_PAGES - 1);
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

  // What the AI suggested, kept as suggestions: known kinds only, and nothing the profile already has.
  function suggest(ws, auth, entries, sourceOf) {
    const have = entriesOf(ws.id);
    const same = (a, b) => a.kind === b.kind && (a.title || a.text).toLowerCase().trim() === (b.title || b.text).toLowerCase().trim();
    const added = [];
    for (const e of (Array.isArray(entries) ? entries : []).slice(0, 40)) {
      let fields;
      try { fields = clean({ ...e, areas: Array.isArray(e?.areas) ? e.areas : [] }); } catch { continue; }
      if (have.concat(added).some((y) => same(y, fields))) continue;
      added.push(add(ws, fields, { status: 'suggested', source: sourceOf(e), by: auth.member }));
    }
    return added;
  }
  const KIND_LIST = PILLARS.map((p) => `- ${p.name}: ${p.kinds.map((k) => `${k} (${KINDS[k].name})`).join(', ')}`).join('\n');
  const ENTRY_SHAPE = '{"kind":"service","title":"short name","text":"one or two plain sentences","do":["kind value only: what it looks like in practice"],"dont":["kind value only: what to avoid"],"horizon":"kind goal only: long|year|quarter","target":"kind goal only","level":"kind rule only: auto|approval|never","why":"where this came from"}';
  // A short summary of the profile so far, so the AI asks about what's missing and doesn't repeat what's there.
  function profileBrief(wsId) {
    const es = entriesOf(wsId);
    const by = PILLARS.map((p) => {
      const mine = es.filter((x) => x.pillar === p.key);
      return `${p.name}: ${mine.length ? mine.map((x) => `${KINDS[x.kind].name}${x.status === 'suggested' ? ' (suggested)' : ''}: ${clipTo(x.title || x.text, 80)}`).join('; ') : 'nothing yet'}`;
    });
    return by.join('\n');
  }
  const clipTo = (s, n) => (String(s || '').length > n ? String(s).slice(0, n) + '…' : String(s || ''));

  async function importSite(ws, auth, raw) {
    const pages = await readSite(raw);
    const words = pages.reduce((n, p) => n + p.text.split(/\s+/).length, 0);
    if (words < 40) throw Object.assign(new Error('That site has almost no text Kloomie can read (it may be built entirely in JavaScript or images). Try another page, or fill in your profile by hand.'), { status: 400 });
    const brief = pages.map((p) => [`PAGE ${p.url}`, p.title && `Title: ${p.title}`, p.meta && `Description: ${p.meta}`, p.ld && `Structured data: ${p.ld}`, p.text].filter(Boolean).join('\n')).join('\n\n---\n\n');
    const out = replyJson(await aiAsk(ws, auth.memberId, IMPORT_SYSTEM, `The business is called ${ws.name}.\n\n${brief}`, 'profile'));
    const added = suggest(ws, auth, out.entries, (e) => ({ type: 'website', url: pages.find((p) => p.url === e.url)?.url || pages[0].url, why: cleanText(e.why, 300) }));
    ws.hqImport = { url: pages[0].url, at: Date.now(), by: auth.member, pages: pages.map((p) => ({ url: p.url, title: cleanText(p.title, 120) })), count: added.length, gaps: list(out.gaps, 8, 200) };
    save();
    news(ws.id);
    return { added: added.length, pages: pages.length, gaps: ws.hqImport.gaps };
  }

  // ---------- the interview ----------
  // Kloomie asks one question at a time, the way a good consultant would: your story, what you believe, who you
  // serve, where you're going, how work gets done, and what needs your OK. Each answer can turn into suggestions.
  const OPENING = 'Let’s start with your story. How did the business begin, and what made you want to build it?';
  const INTERVIEW_SYSTEM = `You are interviewing the owner of a small business so Kloomie can learn how the business thinks and works. Be warm, curious and brief, like a good consultant over coffee.

Cover these topics, roughly in this order, skipping what the profile already covers well: their story; what makes them different and what they won't compromise on (values); who their best customers are and why they choose them; where they want the business in a few years and what matters most this year; how work flows from first call to getting paid; what Kloomie may do without asking and what needs their OK; how they like to sound.

Each turn: reflect back what you heard in a few words, then ask ONE question. When an answer reveals a value, a rule or a goal, name it and check it ("So nobody gets passed around: would you call that a core value?"). Never more than three short sentences. Use plain words; no jargon like "operating principles".

From the owner's latest answer, suggest profile entries that capture what they actually said (not what you guess). Kinds:
${KIND_LIST}

Reply with JSON only: {"reply":"what you say next, ending with your question","entries":[${ENTRY_SHAPE}],"done":false}. Set done to true only when every topic is covered; then thank them and say they can keep adding any time.`;
  const chatOf = (ws) => ws.hqChat?.turns || [];
  async function interview(ws, auth, text) {
    const said = cleanText(text, 4000);
    if (!said) throw Object.assign(new Error('Write an answer first.'), { status: 400 });
    const turns = chatOf(ws).length ? chatOf(ws) : [{ role: 'kloomie', text: OPENING, at: Date.now() }];
    turns.push({ role: 'owner', text: said, by: auth.member, at: Date.now() });
    const history = turns.slice(-30).map((t) => ({ role: t.role === 'owner' ? 'user' : 'assistant', text: t.text }));
    if (history[0].role === 'assistant') history.unshift({ role: 'user', text: 'Let’s set up my company profile.' });
    const out = replyJson(await aiRun(ws, auth.memberId, `${INTERVIEW_SYSTEM}\n\nThe business is called ${ws.name}. What the profile has so far:\n${profileBrief(ws.id)}`, history, 'profile'));
    const added = suggest(ws, auth, out.entries, () => ({ type: 'interview', why: clipTo(said, 300) }));
    turns.push({ role: 'kloomie', text: cleanText(out.reply, 2000) || 'Thanks. What else should I know?', at: Date.now(), suggested: added.map((x) => x.id), done: !!out.done });
    ws.hqChat = { turns: turns.slice(-60), updatedAt: Date.now() };
    save();
    news(ws.id);
    return { added: added.length };
  }

  // ---------- documents ----------
  // Files already in Kloomie (a price sheet, a handbook, a proposal template): Word, Excel, PowerPoint and text are
  // read as words; PDFs and pictures go to the AI whole.
  const DOC_SYSTEM = `You help a small business set up its company profile in Kloomie. You are given the business's own documents (for example a price sheet, a handbook, a proposal template, a checklist or a service agreement). Suggest profile entries using ONLY what the documents say. Never invent facts, numbers, prices or policies. Templates and letters show how the business sounds: suggest a tone of voice or words they use when that's clear.

Kinds you can use, by pillar:
${KIND_LIST}

Reply with JSON only: {"entries":[${ENTRY_SHAPE.replace('"why":"where this came from"', '"why":"which document and where in it","file":"the file name it came from"')}],"gaps":["important things the documents don't settle"]}. One entry per price, policy, step or rule. Aim for 5 to 30 entries.`;
  async function readDocs(ws, auth, ids) {
    const { files, names, used } = await itemFiles(ws, auth, ids);
    if (!files.length) throw Object.assign(new Error('Kloomie can read PDFs, pictures, and Word, Excel, PowerPoint and text files. Pick one of those.'), { status: 400 });
    const out = replyJson(await aiRun(ws, auth.memberId, DOC_SYSTEM, [{ role: 'user', text: `The business is called ${ws.name}. Their documents are attached: ${names.join('; ')}.`, files }], 'profile'));
    const fileOf = (e) => names.find((n) => n === e.file) || names[0];
    const added = suggest(ws, auth, out.entries, (e) => ({ type: 'doc', name: cleanText(fileOf(e), 200), itemId: used[names.indexOf(fileOf(e))] || null, why: cleanText(e.why, 300) }));
    ws.hqDocs = [...(ws.hqDocs || []).filter((x) => !names.includes(x.name)), ...names.map((n, i) => ({ name: cleanText(n, 200), itemId: used[i] || null, at: Date.now(), by: auth.member, count: added.filter((x) => x.source.name === n).length }))].slice(-30);
    ws.hqDocGaps = list(out.gaps, 8, 200);
    save();
    news(ws.id);
    return { added: added.length, files: names.length, gaps: ws.hqDocGaps };
  }

  // ---------- learning from edits ----------
  // When someone uses an AI draft (an email, a document, a call script) after changing it, the before and after
  // are kept. Every few, the AI looks for what keeps changing (shorter, no exclamation marks, a sign-off, a word
  // they always swap) and suggests it as a lasting preference; one-off fixes to the content are ignored.
  const LEARN_SYSTEM = `You compare AI drafts with how someone at a small business changed them before using them. Find lasting preferences for how this business writes: tone, length, structure, words they add or always remove, greetings and sign-offs, claims they take out. Ignore one-off fixes to facts or content. Only suggest a preference that shows up in at least two of the edits, or one that is unmistakable.

Kinds you can use: voice (Tone of voice: a full replacement description of how they sound, folding in what you see), prefer (Words we use), avoid (Words we avoid), never (Never promise or claim).

Reply with JSON only: {"entries":[${ENTRY_SHAPE}],"seen":"one plain sentence on what you noticed, or empty"}. Use "why" to say what the edits showed, briefly. If there's no clear pattern, return no entries.`;
  async function learnNow(ws, memberId, by) {
    const fresh = (ws.hqEdits || []).filter((x) => !x.read);
    if (fresh.length < LEARN_EVERY) return null;
    if (Date.now() - (ws.hqLearnAt || 0) < 3_600_000) return null;
    ws.hqLearnAt = Date.now();
    const brief = fresh.map((x, i) => `EDIT ${i + 1} (${x.kind}, by ${x.by})\nDRAFT:\n${x.draft}\n\nWHAT THEY USED:\n${x.final}`).join('\n\n---\n\n');
    const voice = approved(ws.id).find((x) => x.kind === 'voice');
    // On the AI key of whoever's edit tipped it over, else an owner's or admin's (keys are each person's own).
    const history = [{ role: 'user', text: `The business is called ${ws.name}.${voice ? ` Their tone of voice so far: ${voice.text}` : ''}\n\n${brief}` }];
    let text = null;
    // The edits teach the team's voice whoever made them, so an owner's or admin's key can pay for it, but only once an
    // hour per team (above), so nobody can run up someone else's AI bill by sending edits.
    for (const id of [memberId, ...ws.members.filter((m) => m.role === 'owner' || m.role === 'admin').map((m) => m.id)]) {
      try {
        text = await aiRun(ws, id, LEARN_SYSTEM, history, 'profile');
        break;
      } catch (e) {
        if (e.status !== 400) throw e;
      }
    }
    if (text == null) {
      ws.hqLearnAt = 0; // nobody has a key yet: try again on the next edit
      save();
      return null;
    }
    // Learned: these edits won't be sent again.
    for (const x of fresh) x.read = true;
    const out = replyJson(text);
    const added = suggest(ws, { member: by }, (Array.isArray(out.entries) ? out.entries : []).filter((e) => ['voice', 'prefer', 'avoid', 'never'].includes(e?.kind)), (e) => ({ type: 'learned', why: cleanText(e.why || out.seen, 300) }));
    ws.hqLearned = { at: Date.now(), seen: cleanText(out.seen, 300), count: added.length };
    save();
    news(ws.id);
    return added;
  }
  function learn(ws, auth, body) {
    const kind = ['email', 'doc', 'script', 'message'].includes(body.kind) ? body.kind : 'other';
    const draft = cleanText(body.draft, 4000);
    const final = cleanText(body.final, 4000);
    if (!draft || !final || draft === final) return { kept: false };
    // A tiny change (a typo) teaches nothing.
    const a = draft.split(/\s+/), b = final.split(/\s+/);
    const shared = a.filter((w, i) => b[i] === w).length;
    if (Math.abs(a.length - b.length) < 3 && shared / Math.max(a.length, b.length) > 0.95) return { kept: false };
    ws.hqEdits = [...(ws.hqEdits || []), { kind, draft, final, by: auth.member, at: Date.now() }].slice(-20);
    save();
    // Looked at in the background: the person using the draft doesn't wait.
    if (ws.hqEdits.filter((x) => !x.read).length >= LEARN_EVERY) learnNow(ws, auth.memberId, auth.member).catch((e) => console.error('Learning from edits failed:', e.message));
    return { kept: true };
  }

  // ---------- the quarterly check on goals ----------
  function reviewDue(ws) {
    const goals = approved(ws.id).filter((x) => x.kind === 'goal');
    if (!goals.length) return null;
    const since = ws.hqReviewedAt || Math.min(...goals.map((x) => x.approvedAt || x.createdAt));
    return Date.now() - since > REVIEW_DAYS * 864e5 ? { since, goals: goals.length } : null;
  }

  // ---------- the Company Playbook ----------
  // A living doc made from what's approved: who the business is, why it exists, what it won't compromise, where
  // it's going, who it serves, how it sounds, how it works and how it decides. Kept in the Company HQ folder,
  // with the doc's own history; making it again updates the same doc.
  function playbookText(ws) {
    const es = approved(ws.id);
    const of = (...kinds) => kinds.flatMap((k) => es.filter((x) => x.kind === k));
    const one = (k) => es.find((x) => x.kind === k)?.text || '';
    const item = (x) => `- ${x.title || KINDS[x.kind].name}${x.text && x.title ? ': ' + x.text : !x.title && x.text ? ': ' + x.text : ''}`;
    const sec = (title, lines) => (lines.filter(Boolean).length ? [`## ${title}`, ...lines.filter(Boolean), ''] : []);
    const horizon = { quarter: 'This quarter', year: 'This year', long: 'Long term' };
    const goals = of('goal').sort((a, b) => ['quarter', 'year', 'long'].indexOf(a.horizon) - ['quarter', 'year', 'long'].indexOf(b.horizon) || (a.priority || 2) - (b.priority || 2));
    const rules = of('rule');
    const level = { auto: 'fine without asking', approval: 'needs an owner’s OK', never: 'never' };
    const missing = progress(ws).missing.map((m) => m.name.toLowerCase());
    return [
      `# ${ws.name} Company Playbook`,
      `How ${ws.name} works, and how Kloomie and its AI understand the business. Made from Company HQ on ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}; make it again there after the profile changes.`,
      '',
      ...sec('Who we are', [one('about'), of('service').length ? `What we offer: ${of('service').map((x) => x.title || x.text).join(', ')}.` : '', one('area') && `Where we work: ${one('area')}`, one('model') && `How we make money: ${one('model')}`, ...of('different').map(item), ...of('notwanted').map((x) => `- Work we don’t take: ${x.title || x.text}${x.title && x.text ? ' (' + x.text + ')' : ''}`)]),
      ...sec('Why we exist', [one('mission') && `Mission: ${one('mission')}`, one('story')]),
      ...sec('What we never compromise', of('value').sort((a, b) => (a.priority || 2) - (b.priority || 2)).flatMap((x) => [item(x), ...(x.do || []).map((d) => `  - Do: ${d}`), ...(x.dont || []).map((d) => `  - Never: ${d}`)])),
      ...sec('Where we’re going', [one('vision') && `Where we’re headed: ${one('vision')}`, ...goals.map((x) => `- ${horizon[x.horizon] || 'Goal'}: ${x.title || x.text}${x.target ? ` (target: ${x.target})` : ''}${x.deadline ? `, by ${x.deadline}` : ''}${x.priority === 1 ? ' · top priority' : ''}`)]),
      ...sec('Who we serve', [...of('ideal').map(item), ...of('why').map((x) => `- Why they choose us: ${x.title || x.text}${x.title && x.text ? ': ' + x.text : ''}`), ...of('objection').map((x) => `- When they push back: ${x.title || x.text}${x.title && x.text ? ': ' + x.text : ''}`)]),
      ...sec('How we sound', [one('voice'), ...of('prefer').map((x) => `- We say: ${x.title || x.text}${x.title && x.text ? ' (' + x.text + ')' : ''}`), ...of('avoid').map((x) => `- We don’t say: ${x.title || x.text}${x.title && x.text ? ' (' + x.text + ')' : ''}`), ...of('never').map((x) => `- We never promise: ${x.title || ''}${x.title && x.text ? ': ' : ''}${x.text || ''}`)]),
      ...sec('How we work', [...of('process').map(item), ...of('policy').map(item), ...of('pricing').map(item), ...of('culture').map(item)]),
      ...sec('How we decide', [...enforced(ws).map((l) => l.replace(/^- /, '- Enforced: ')), ...rules.map((x) => `- ${x.title || ''}${x.title && x.text ? ': ' : ''}${x.text || ''} (${level[x.level] || 'needs an owner’s OK'})`)]),
      ...sec('Still to fill in', missing.length ? [`Company HQ doesn’t have these yet: ${missing.join(', ')}.`] : []),
    ].join('\n').trim();
  }

  // ---------- routes: /api/hq ----------
  async function route(req, res, parts, auth, ws) {
    const [a, b, c, d] = parts;
    if (a !== 'hq') return null;
    const m = req.method;
    if (!b && m === 'GET') return send(res, 200, state(ws, auth));
    if (b === 'learn' && !c && m === 'POST') return send(res, 200, learn(ws, auth, await readJson(req)));
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
    if (b === 'playbook' && !c && m === 'POST') {
      if (!writePlaybook) return send(res, 400, { error: 'Not available' });
      if (!approved(ws.id).length) return send(res, 400, { error: 'Add something to Company HQ first: the Playbook is made from it.' });
      const it = await writePlaybook(ws, auth, `${ws.name} Company Playbook`, playbookText(ws), ws.hqPlaybook?.id || null);
      ws.hqPlaybook = { id: it.id, at: Date.now(), by: auth.member };
      save();
      news(ws.id);
      return send(res, 200, { item: it, ...state(ws, auth) });
    }
    if (b === 'review' && !c && m === 'POST') {
      ws.hqReviewedAt = Date.now();
      save();
      news(ws.id);
      return send(res, 200, state(ws, auth));
    }
    if (b === 'interview' && !c && (m === 'POST' || m === 'DELETE')) {
      try {
        if (m === 'DELETE') {
          delete ws.hqChat;
          save();
          return send(res, 200, state(ws, auth));
        }
        const out = await interview(ws, auth, (await readJson(req)).text);
        return send(res, 200, { ...out, ...state(ws, auth) });
      } catch (e) {
        if (!e.status) console.error('Interview failed:', e.message);
        return send(res, e.status || 502, { error: e.status ? e.message : 'Couldn’t get an answer just now. Try again in a minute.' });
      }
    }
    if (b === 'docs' && !c && m === 'POST') {
      const body = await readJson(req);
      const ids = [...new Set((Array.isArray(body.itemIds) ? body.itemIds : []).map(String))].slice(0, 5);
      if (!ids.length) return send(res, 400, { error: 'Pick a file first.' });
      try {
        const out = await readDocs(ws, auth, ids);
        return send(res, 200, { ...out, ...state(ws, auth) });
      } catch (e) {
        if (!e.status) console.error('Reading documents failed:', e.message);
        return send(res, e.status || 502, { error: e.status ? e.message : 'Couldn’t read those just now. Try again in a minute.' });
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
      if (x.kind === 'goal' && x.status === 'approved') ws.hqReviewedAt = Date.now();
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

  return { route, prompt, brandText, setBrandText, migrate, state, progress, readSite, playbookText, learnNow };
}
