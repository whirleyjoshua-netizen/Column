// News: each person's own current events and articles, from publishers' feeds, ranked by what they chose and
// what they liked (server/news.js). Each person turns on its card on Home for themselves (Settings → General): the
// top few, and Open News for the rest. 👍 and 👎 teach it; "What it learned" shows what it took from them and can start over.
// Everything from a feed is outside text: it goes into the page as text, links only when they're http(s).
window.ColumnNews = (deps) => {
  const { h, api, toast, sheet, openMenu, ago, confirmClick, fileKey, redrawHome, onBar, open } = deps;
  const NW = { topic: 'all', q: '', list: null, loading: false, prefs: null, catalog: null, brief: null, busy: false, polls: 0, home: null, homeAt: 0, homeBusy: false, seq: 0 };
  const safeLink = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.toString() : null; } catch { return null; } };
  const imgSrc = (a) => (a.img ? `${a.img}?t=${encodeURIComponent(fileKey() || '')}` : null);
  const topicLabel = (id) => NW.catalog?.find((t) => t.id === id)?.label || id;

  async function load(quiet) {
    const seq = ++NW.seq;
    if (!quiet) { NW.loading = true; redraw(); }
    try {
      if (!NW.catalog) NW.catalog = (await api('GET', '/news/catalog')).topics;
      const qs = new URLSearchParams({ topic: NW.topic, limit: '60' });
      if (NW.q.trim()) qs.set('q', NW.q.trim());
      const r = await api('GET', '/news?' + qs);
      if (seq !== NW.seq) return;
      NW.list = r.articles;
      NW.prefs = r.prefs;
      NW.loading = r.loading;
      // A slow publisher shows up on a later look: try again a few times while some sources are still coming.
      if (r.loading && NW.polls < 4) { NW.polls++; setTimeout(() => { if (seq === NW.seq) load(true); }, 3500); } else NW.polls = 0;
    } catch (e) {
      if (seq !== NW.seq) return;
      NW.loading = false;
      NW.err = e.message;
    }
    redraw();
  }
  function pick(topic) { NW.topic = topic; NW.list = null; NW.brief = null; NW.polls = 0; NW.err = null; load(); }

  async function react(a, v) {
    const was = a.liked ? 1 : 0;
    try {
      await api('POST', '/news/react', { id: a.id, v });
      a.liked = v === 1;
      if (v === -1) {
        NW.list = NW.list.filter((x) => x.id !== a.id);
        toast('Fewer like that from now on', { label: 'Undo', run: async () => { await api('POST', '/news/react', { id: a.id, v: was }).catch(() => {}); load(true); } });
      } else if (v === 1) toast('More like this from now on');
      NW.homeAt = 0;
    } catch (e) { toast(e.message); }
    redraw();
  }
  async function keep(a) {
    try { await api('POST', '/news/save', { id: a.id, on: !a.saved }); a.saved = !a.saved; if (!a.saved && NW.topic === 'saved') NW.list = NW.list.filter((x) => x.id !== a.id); toast(a.saved ? 'Saved' : 'Taken out of Saved'); } catch (e) { toast(e.message); }
    redraw();
  }
  async function source(a, how) {
    try {
      NW.prefs = await api('POST', '/news/mute', { srcId: a.srcId, how });
      toast(how === 'none' ? `Nothing more from ${a.source}` : how === 'fewer' ? `Fewer from ${a.source}` : `More from ${a.source}`);
      NW.homeAt = 0;
      load(true);
    } catch (e) { toast(e.message); }
  }
  function moreMenu(a, anchor) {
    openMenu(anchor, [
      { head: a.source },
      { label: `More from ${a.source}`, run: () => source(a, 'more') },
      { label: `Fewer from ${a.source}`, run: () => source(a, 'fewer') },
      { label: `Hide ${a.source}`, run: () => source(a, 'none') },
      { label: 'Copy link', run: () => { navigator.clipboard?.writeText(a.link).then(() => toast('Link copied'), () => toast('Couldn’t copy')); } },
    ]);
  }

  function articleRow(a) {
    const link = safeLink(a.link);
    const pic = imgSrc(a);
    const img = pic ? h('img', { class: 'nw-img', src: pic, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.currentTarget.remove() }) : null;
    const title = link ? h('a', { class: 'nw-title', href: link, target: '_blank', rel: 'noopener noreferrer' }, a.title) : h('span', { class: 'nw-title' }, a.title);
    return h('article', { class: 'nw-item' + (a.gone ? ' gone' : ''), 'data-id': a.id },
      h('div', { class: 'nw-body' },
        h('div', { class: 'nw-meta' }, h('b', {}, a.source), a.at ? ' · ' + ago(a.at) : '', a.topics?.[0] && NW.topic === 'all' ? h('span', { class: 'nw-tag' }, topicLabel(a.topics[0])) : null),
        title,
        a.summary ? h('p', { class: 'nw-sum' }, a.summary) : null,
        a.also?.length ? h('small', { class: 'nw-also' }, 'Also in ', ...a.also.flatMap((x, i) => [i ? ', ' : '', safeLink(x.link) ? h('a', { href: safeLink(x.link), target: '_blank', rel: 'noopener noreferrer' }, x.source) : x.source])) : null,
        h('div', { class: 'nw-acts' },
          h('button', { class: 'nw-like' + (a.liked ? ' on' : ''), 'aria-pressed': a.liked ? 'true' : 'false', title: 'More like this', onclick: () => react(a, a.liked ? 0 : 1) }, '👍', h('span', {}, a.liked ? 'Liked' : 'Like')),
          NW.topic === 'saved' ? null : h('button', { class: 'nw-nope', title: 'Fewer like this', onclick: () => react(a, -1) }, '👎', h('span', {}, 'Not for me')),
          h('button', { class: 'nw-save' + (a.saved ? ' on' : ''), 'aria-pressed': a.saved ? 'true' : 'false', title: a.saved ? 'Take out of Saved' : 'Save for later', onclick: () => keep(a) }, a.saved ? '★' : '☆', h('span', {}, a.saved ? 'Saved' : 'Save')),
          a.gone ? null : h('button', { class: 'nw-more', 'aria-label': 'More', onclick: (e) => moreMenu(a, e.currentTarget) }, '⋯'))),
      img);
  }

  async function doBrief() {
    NW.busy = true; redraw();
    try { NW.brief = { ...(await api('POST', '/news/brief', {})), at: Date.now() }; } catch (e) { toast(e.message); }
    NW.busy = false; redraw();
  }
  function briefBox() {
    if (!NW.brief) return null;
    const used = NW.brief.used || [];
    return h('div', { class: 'nw-brief' },
      h('div', { class: 'nw-brief-h' }, h('b', {}, '✦ Your brief'), h('small', {}, ago(NW.brief.at)), h('button', { class: 'icon-btn', 'aria-label': 'Close the brief', onclick: () => { NW.brief = null; redraw(); } }, '×')),
      ...String(NW.brief.text).split('\n').filter((l) => l.trim()).map((l) => h('p', {}, l.replace(/^\s*[-*•]\s*/, '• ').replace(/\*\*/g, ''))),
      used.length ? h('small', { class: 'nw-also' }, 'From ', ...used.flatMap((x, i) => [i ? ' · ' : '', `[${x.n}] `, safeLink(x.link) ? h('a', { href: safeLink(x.link), target: '_blank', rel: 'noopener noreferrer' }, x.source) : x.source])) : null,
      // A free brief (on Kloomie's key): how many more today.
      NW.brief.free ? h('small', { class: 'nw-also nw-free' }, NW.brief.left ? `Free from Kloomie · ${NW.brief.left} more today` : 'Free from Kloomie · that’s all for today. Add your own AI key in Settings → AI for more.') : null);
  }

  // The tab itself: one lasting root, so the search box keeps its place (and the cursor) while the rest redraws.
  let root, chips, briefBtn, body, search;
  function build() {
    search = h('input', { type: 'search', class: 'nw-q', placeholder: 'Search your news', 'aria-label': 'Search your news' });
    let t;
    search.addEventListener('input', () => { NW.q = search.value; clearTimeout(t); t = setTimeout(() => load(true), 350); });
    chips = h('div', { class: 'nw-chips', role: 'tablist' });
    briefBtn = h('button', { class: 'btn small nw-brief-btn', onclick: doBrief, title: 'A short brief of your top stories' }, '✦ Brief me');
    body = h('div', { class: 'nw-main' });
    root = h('div', { class: 'nw' }, h('div', { class: 'nw-top' }, chips,
      h('div', { class: 'nw-tools' }, search, briefBtn,
        h('button', { class: 'btn small nw-topics-btn', onclick: topicsSheet }, 'Topics & sources'),
        h('button', { class: 'btn small nw-learned-btn', onclick: learnedSheet }, 'What it learned'))), body);
  }
  function paint() {
    if (!root) return;
    const p = NW.prefs;
    const chip = (id, label) => h('button', { class: 'nw-chip' + (NW.topic === id ? ' on' : ''), role: 'tab', 'aria-selected': NW.topic === id ? 'true' : 'false', 'data-topic': id, onclick: () => NW.topic !== id && pick(id) }, label);
    chips.replaceChildren(chip('all', 'For you'), ...(p?.topics || []).map((id) => chip(id, topicLabel(id))), p?.custom?.length ? chip('mine', 'My sites') : '', chip('saved', '★ Saved'));
    briefBtn.disabled = NW.busy;
    briefBtn.textContent = NW.busy ? 'Writing…' : '✦ Brief me';
    if (search.value !== NW.q && document.activeElement !== search) search.value = NW.q;
    const firstTime = p && !p.reactions;
    body.replaceChildren(...[
      firstTime && NW.topic === 'all' ? h('p', { class: 'nw-hint' }, 'Tap 👍 on what you like and 👎 on what you don’t. It learns from both, and from the topics, words and sites you pick in Topics & sources.') : null,
      briefBox(),
      NW.err ? h('p', { class: 'err' }, NW.err) : null,
      NW.loading && !NW.list?.length ? h('p', { class: 'day-hint' }, 'Reading the news…') : null,
      NW.loading && NW.list?.length ? h('p', { class: 'nw-hint' }, 'Still reading some sources…') : null,
      NW.list && !NW.list.length && !NW.loading ? h('p', { class: 'day-hint nw-empty' }, NW.topic === 'saved' ? 'Nothing saved yet. Tap ☆ Save on an article to keep it here.' : NW.q ? 'Nothing in your news matches that.' : 'Nothing here yet. Pick some topics in Topics & sources.') : null,
      NW.list?.length ? h('div', { class: 'nw-list' }, NW.list.map(articleRow)) : null,
    ].filter(Boolean));
  }
  const redraw = () => paint();
  function render() {
    if (!root) build();
    if (!NW.list && !NW.loading && !NW.err) load();
    paint();
    return [root];
  }

  // Topics, words to follow or hide, sites of your own, hidden sources, and the Home card.
  async function topicsSheet() {
    if (!NW.catalog) NW.catalog = (await api('GET', '/news/catalog').catch((e) => (toast(e.message), { topics: [] }))).topics;
    if (!NW.prefs) NW.prefs = (await api('GET', '/news?limit=1').catch(() => ({ prefs: null }))).prefs;
    if (!NW.prefs) return;
    const p = NW.prefs;
    const chosen = new Set(p.topics);
    const groups = [...new Set(NW.catalog.map((t) => t.group))];
    const topicBox = h('div', { class: 'nw-pick' }, groups.map((g) => h('div', { class: 'nw-group' }, h('div', { class: 'nw-group-h' }, g),
      h('div', { class: 'nw-group-list' }, NW.catalog.filter((t) => t.group === g).map((t) => {
        const box = h('input', { type: 'checkbox', checked: chosen.has(t.id), 'data-topic': t.id });
        box.addEventListener('change', () => (box.checked ? chosen.add(t.id) : chosen.delete(t.id)));
        return h('label', { class: 'nw-topic', title: t.sources.join(', ') }, box, h('span', {}, t.label), h('small', {}, t.sources.join(', ')));
      })))));
    const follow = h('input', { class: 'nw-follow', value: p.follow.join(', '), placeholder: 'heat pumps, Las Vegas, permits', 'aria-label': 'Words to follow' });
    const block = h('input', { class: 'nw-block', value: p.block.join(', '), placeholder: 'celebrity, crypto', 'aria-label': 'Words to hide' });
    const home = h('input', { type: 'checkbox', checked: p.home !== false, class: 'nw-home' });
    const sites = h('div', { class: 'nw-sites' });
    const drawSites = () => sites.replaceChildren(
      ...NW.prefs.custom.map((c) => h('div', { class: 'nw-site' }, h('span', {}, h('b', {}, c.name), h('small', {}, c.err ? '⚠ ' + c.err : c.url)),
        h('button', { class: 'btn small danger', 'data-label': '1', onclick: (e) => confirmClick(e.currentTarget, async () => { NW.prefs = await api('DELETE', '/news/feeds/' + c.id).catch((er) => (toast(er.message), NW.prefs)); drawSites(); }) }, 'Remove'))),
      ...NW.prefs.muted.map((m) => h('div', { class: 'nw-site muted' }, h('span', {}, h('b', {}, m.name), h('small', {}, 'Hidden')),
        h('button', { class: 'btn small', onclick: async () => { NW.prefs = await api('POST', '/news/mute', { srcId: m.id, how: 'unmute' }).catch((er) => (toast(er.message), NW.prefs)); drawSites(); } }, 'Show again'))));
    drawSites();
    const addUrl = h('input', { class: 'nw-add-url', placeholder: 'A news site or its RSS feed (localnews.com)', 'aria-label': 'Site or feed address' });
    const addBtn = h('button', { class: 'btn small nw-add-btn', onclick: async () => {
      if (!addUrl.value.trim()) return;
      addBtn.disabled = true; addBtn.textContent = 'Looking…';
      try { NW.prefs = await api('POST', '/news/feeds', { url: addUrl.value.trim() }); addUrl.value = ''; drawSites(); toast('Added'); } catch (e) { toast(e.message); }
      addBtn.disabled = false; addBtn.textContent = 'Add';
    } }, 'Add');
    const list = (s) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    sheet('Topics & sources', [
      h('p', { class: 'day-hint' }, 'Pick what you want to keep up with. Your news is yours alone: nobody on your team sees what you read or like.'),
      topicBox,
      h('label', { class: 'nw-field' }, 'Follow these words (they come first)', follow),
      h('label', { class: 'nw-field' }, 'Hide anything with these words', block),
      h('div', { class: 'nw-field' }, h('b', {}, 'Your own sites'), h('small', { class: 'day-hint' }, 'Your local paper, a trade blog, a supplier’s news: any site with a news feed.'), sites, h('div', { class: 'nw-add' }, addUrl, addBtn)),
      h('label', { class: 'nw-check' }, home, 'Show my top stories on Home'),
    ], async () => {
      NW.prefs = await api('PUT', '/news/prefs', { topics: [...chosen], follow: list(follow.value), block: list(block.value), home: home.checked });
      if (NW.topic !== 'all' && NW.topic !== 'saved' && NW.topic !== 'mine' && !chosen.has(NW.topic)) NW.topic = 'all';
      NW.list = null; NW.homeAt = 0;
      load();
      redrawHome();
    });
  }

  async function learnedSheet() {
    const box = h('div', { class: 'nw-learned' }, h('p', { class: 'day-hint' }, 'Loading…'));
    sheet('What your news learned', [box], null);
    const draw = (L) => {
      const chips = (list, cls) => list.length ? h('div', { class: 'nw-chiplist' }, list.map((x) => h('span', { class: 'nw-lchip ' + cls }, x.name || x.k))) : h('small', { class: 'muted' }, 'Nothing yet');
      box.replaceChildren(
        h('p', { class: 'day-hint' }, L.reactions ? `From ${L.reactions} article${L.reactions === 1 ? '' : 's'} you liked or passed on. It only uses what you do in News, and only for you.` : 'Nothing yet. Tap 👍 or 👎 on a few articles and it starts to learn.'),
        h('h4', {}, 'You like stories about'), chips(L.likes, 'up'),
        h('h4', {}, 'Less of'), chips(L.dislikes, 'down'),
        h('h4', {}, 'Sources'), chips([...L.sources.more.map((x) => ({ ...x, name: '↑ ' + x.name })), ...L.sources.less.map((x) => ({ ...x, name: '↓ ' + x.name }))], ''),
        h('div', { class: 'btns' }, h('button', { class: 'btn danger nw-reset', 'data-label': '1', onclick: (e) => confirmClick(e.currentTarget, async () => { draw(await api('DELETE', '/news/learned')); toast('Started over'); NW.list = null; NW.homeAt = 0; load(true); }) }, 'Start over')));
    };
    try { draw(await api('GET', '/news/learned')); } catch (e) { box.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }

  // Home: the top few, when they turned News on Home on (and didn't turn the card off in Topics).
  function homeCard(card) {
    if (!onBar()) return null;
    if (NW.prefs && NW.prefs.home === false) return null;
    if (!NW.homeBusy && Date.now() - NW.homeAt > 10 * 60_000) {
      NW.homeBusy = true;
      api('GET', '/news?topic=all&limit=4').then((r) => { NW.home = r.articles; NW.prefs = r.prefs; NW.homeAt = Date.now(); }, () => { NW.homeAt = Date.now(); }).finally(() => { NW.homeBusy = false; redrawHome(); });
    }
    if (NW.prefs && NW.prefs.home === false) return null;
    const list = NW.home || [];
    return card('news', 'News for you', 0, ['Open News', open],
      list.length ? h('div', { class: 'nw-home' }, list.map((a) => {
        const link = safeLink(a.link);
        return h(link ? 'a' : 'span', { class: 'need-row nw-hrow', ...(link ? { href: link, target: '_blank', rel: 'noopener noreferrer' } : {}) },
          h('span', { class: 'need-text' }, h('b', {}, a.title), h('small', {}, a.source + (a.at ? ' · ' + ago(a.at) : ''))));
      })) : h('p', { class: 'day-hint' }, NW.homeBusy || !NW.homeAt ? 'Reading the news…' : 'Nothing yet. Pick topics in News.'));
  }

  return { render, homeCard, reload: () => { NW.list = null; load(); } };
};
