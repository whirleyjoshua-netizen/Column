// Help, one page per topic, made from client/help.html (the one copy anyone edits). Each <h2 id="…"> section becomes
// /help/<slug>: its own title, description, canonical address, breadcrumbs (on the page and as BreadcrumbList), its
// video described as a VideoObject, and links to the topics before and after it. /help is the hub that lists them.
// Old links to a part of the long page (/help#mileage) still land in the right place: the hub's small script
// (client/help.js) sends them to the topic that part is in. Read again whenever help.html changes.
import fs from 'node:fs';
import path from 'node:path';

// Slugs that say what the topic is (what people search for), where the section's id is short.
const SLUGS = {
  start: 'getting-started', team: 'team-and-roles', home: 'home-and-day', kinds: 'project-kinds', signoff: 'sign-offs',
  cards: 'business-cards', formulas: 'formulas-and-calendars', assets: 'equipment-tracking', jobs: 'jobs-for-trades',
  apps: 'apps-and-integrations', connect: 'email-and-calendars', docs: 'docs-and-e-signatures', agents: 'ai-agents', hq: 'company-hq',
  sidekick: 'ai-and-sidekick', security: 'two-step-sign-in', data: 'your-data',
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = (html) => String(html).replace(/<br\s*\/?>|<\/(p|li|div|h\d)>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
// A description that fits a search result: whole words, about 155 characters at most.
function describe(text, max = 155) {
  const t = plain(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:(\s–-]+$/, '') + '…';
}

export function helpDocs({ clientDir }) {
  const file = path.join(clientDir, 'help.html');
  let cache = { mtime: 0, doc: null };
  function load() {
    const st = fs.statSync(file, { throwIfNoEntry: false });
    if (!st) return null;
    if (cache.doc && cache.mtime === st.mtimeMs) return cache.doc;
    const html = fs.readFileSync(file, 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    const main = html.slice(html.indexOf('<main>') + 6, html.lastIndexOf('</main>'));
    const parts = main.split(/(?=<h2 id=")/);
    const intro = parts.shift();
    const topics = parts.map((p) => {
      const m = /^<h2 id="([\w-]+)">([\s\S]*?)<\/h2>/.exec(p);
      if (!m) return null;
      const body = p.slice(m[0].length);
      const firstP = /<p>([\s\S]*?)<\/p>/.exec(body)?.[1] || /<li>([\s\S]*?)<\/li>/.exec(body)?.[1] || '';
      return { id: m[1], slug: SLUGS[m[1]] || m[1], title: plain(m[2]), titleHtml: m[2], body: body.trim(), about: describe(firstP), anchors: [...body.matchAll(/\sid="([\w-]+)"/g)].map((x) => x[1]) };
    }).filter(Boolean);
    const byId = new Map(topics.map((t) => [t.id, t]));
    // Where each part of the old long page now lives: a topic's id, and every id inside it.
    const anchors = {};
    for (const t of topics) { anchors[t.id] = t.slug; for (const a of t.anchors) anchors[a] ||= t.slug; }
    const lead = /<p class="lead">([\s\S]*?)<\/p>/.exec(intro)?.[0] || '';
    cache = { mtime: st.mtimeMs, doc: { head, topics, byId, anchors, lead, changed: st.mtime.toISOString().slice(0, 10) } };
    return cache.doc;
  }
  // A link inside a topic: to another topic, its page; to a part of another topic, that page at that part.
  function links(doc, t, body) {
    return body.replace(/href="#([\w-]+)"/g, (m, id) => {
      if (t.anchors.includes(id)) return m;
      const to = doc.byId.get(id);
      if (to) return `href="/help/${to.slug}"`;
      const slug = doc.anchors[id];
      return slug ? `href="/help/${slug}#${id}"` : m;
    });
  }
  const headWith = (doc, { title, description, canonical, ld }) => doc.head
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(description)}">`)
    .replace('<link rel="icon"', `<link rel="canonical" href="${esc(canonical)}">\n  ${ld.map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`).join('\n  ')}\n  <link rel="icon"`)
    .replace('</style>', '    .pager { display: flex; justify-content: space-between; gap: 12px; margin: 40px 0 0; padding-top: 16px; border-top: 1px solid var(--line); font-size: 14px; }\n    .pager a { text-decoration: none; font-weight: 600; } .pager .next { margin-left: auto; text-align: right; }\n    .toc small { display: block; font-weight: 400; color: var(--muted); font-size: 13px; margin-top: 2px; }\n  </style>');

  // The hub: every topic, with what it's about.
  function hub(siteUrl) {
    const doc = load();
    if (!doc) return null;
    const ld = [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Kloomie', item: siteUrl + '/' }, { '@type': 'ListItem', position: 2, name: 'Help', item: siteUrl + '/help' }] }];
    const description = 'How to set up and use Kloomie: your team, Stacks, campaigns, contacts, jobs for trades, docs and e-signatures, automations, agents, billing and your data.';
    return `${headWith(doc, { title: 'Help · Kloomie', description, canonical: siteUrl + '/help', ld })}</head>
<body>
<main>
  <p class="top"><a href="${esc(siteUrl)}">Kloomie</a> · Help</p>
  <h1>Help</h1>
  ${doc.lead}
  <ul class="toc">
${doc.topics.map((t) => `    <li><a href="/help/${t.slug}">${t.titleHtml}<small>${esc(describe(t.about, 90))}</small></a></li>`).join('\n')}
  </ul>
  <script type="application/json" id="helpAnchors">${JSON.stringify(doc.anchors).replace(/</g, '\\u003c')}</script>
  <script src="/help.js"></script>
</main>
</body>
</html>
`;
  }

  // One topic's page: { html } or { moved } (an old short name) or null.
  function topic(slug, siteUrl, videoDate) {
    const doc = load();
    if (!doc) return null;
    const i = doc.topics.findIndex((t) => t.slug === slug);
    if (i < 0) { const old = doc.byId.get(slug); return old && old.slug !== slug ? { moved: '/help/' + old.slug } : null; }
    const t = doc.topics[i], prev = doc.topics[i - 1], next = doc.topics[i + 1];
    const url = `${siteUrl}/help/${t.slug}`;
    const ld = [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Kloomie', item: siteUrl + '/' },
      { '@type': 'ListItem', position: 2, name: 'Help', item: siteUrl + '/help' },
      { '@type': 'ListItem', position: 3, name: t.title, item: url }] }];
    // Its first video, when the file is here: what it is, its picture and where it plays.
    const v = /<video[^>]*poster="([^"]+)"[^>]*aria-label="(?:Video: )?([^"]*)"[^>]*>\s*<source src="([^"]+)"/.exec(t.body);
    const when = v && videoDate(v[3]);
    if (v && when) ld.push({ '@context': 'https://schema.org', '@type': 'VideoObject', name: `${v[2]} · Kloomie`, description: t.about, thumbnailUrl: siteUrl + v[1], contentUrl: siteUrl + v[3], uploadDate: when, embedUrl: url });
    return { html: `${headWith(doc, { title: `${t.title} · Kloomie Help`, description: t.about, canonical: url, ld })}</head>
<body>
<main>
  <p class="top"><a href="${esc(siteUrl)}">Kloomie</a> · <a href="/help">Help</a> · ${t.titleHtml}</p>
  <h1>${t.titleHtml}</h1>
  ${links(doc, t, t.body)}
  <nav class="pager" aria-label="More help">
    ${prev ? `<a rel="prev" href="/help/${prev.slug}">‹ ${prev.titleHtml}</a>` : '<a href="/help">‹ All help</a>'}
    ${next ? `<a class="next" rel="next" href="/help/${next.slug}">${next.titleHtml} ›</a>` : '<a class="next" href="/help">All help ›</a>'}
  </nav>
</main>
</body>
</html>
` };
  }
  const slugs = () => (load()?.topics || []).map((t) => t.slug);
  const changed = () => load()?.changed || null;
  return { hub, topic, slugs, changed };
}
