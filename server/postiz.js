// Postiz: social posting through the team's own Postiz account (postiz.com, or one they host themselves).
// An owner or admin pastes a Postiz API key in Settings → Connections; Kloomie then sees the channels they've
// linked in Postiz (Facebook, Instagram, LinkedIn, Google Business Profile, X, Threads, Bluesky, Mastodon…)
// and can post to them: the Marketing Manager drafts, the person approves, Postiz publishes or schedules.
// The key is kept encrypted and never sent back to the app. Kloomie pays nothing; the team pays Postiz.
//
// Public API (docs.postiz.com/public-api): base https://api.postiz.com/public/v1, or
// https://<their domain>/api/public/v1 when self-hosted; the key goes in Authorization with no "Bearer".
import dns from 'node:dns/promises';
import { privateIp, safeFetch } from './safefetch.js';

const CLOUD = 'https://api.postiz.com/public/v1';
// Channels Kloomie posts to, with the settings each needs. Others (YouTube, TikTok, Reddit, Pinterest…) need
// choices Kloomie doesn't ask for (titles, boards, privacy), so they're listed but not offered.
export const POSTIZ_KINDS = {
  facebook: { name: 'Facebook', settings: () => ({}) },
  instagram: { name: 'Instagram', needsImage: true, settings: () => ({ post_type: 'post' }) },
  'instagram-standalone': { name: 'Instagram', needsImage: true, settings: () => ({ post_type: 'post' }) },
  linkedin: { name: 'LinkedIn', settings: () => ({}) },
  'linkedin-page': { name: 'LinkedIn page', settings: () => ({}) },
  gmb: { name: 'Google Business Profile', settings: (o) => ({ topicType: 'STANDARD', ...(o.link ? { callToActionType: o.cta && GMB_CTAS.includes(o.cta) ? o.cta : 'LEARN_MORE', callToActionUrl: o.link } : {}) }) },
  x: { name: 'X', max: 280, settings: () => ({ who_can_reply_post: 'everyone' }) },
  threads: { name: 'Threads', max: 500, settings: () => ({}) },
  bluesky: { name: 'Bluesky', max: 300, settings: () => ({}) },
  mastodon: { name: 'Mastodon', max: 500, settings: () => ({}) },
};
const GMB_CTAS = ['BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'GET_OFFER', 'CALL'];
const TIMEOUT = 20_000;


// "Connect with Postiz": Kloomie's OAuth app in Postiz (Settings → Developers there). The person approves on Postiz's
// own page and comes back with a token that works like an API key and doesn't expire (they can revoke it in Postiz →
// Settings → Approved Apps). The app's id and secret live only in the server's settings.
const OAUTH = {
  id: () => process.env.POSTIZ_CLIENT_ID || '',
  secret: () => process.env.POSTIZ_CLIENT_SECRET || '',
  authorize: () => process.env.POSTIZ_AUTHORIZE_URL || 'https://platform.postiz.com/oauth/authorize',
  token: () => process.env.POSTIZ_TOKEN_URL || 'https://api.postiz.com/oauth/token',
};
const STATE_MS = 10 * 60_000;

export function postizModule({ db, save, broadcast, cleanText, readJson, send, seal, unseal, isAdmin, rid, alarm = () => {}, allowLocal = false, cloudUrl = CLOUD }) {
  const oauthOn = () => !!(OAUTH.id() && OAUTH.secret());
  const pending = new Map(); // state → { wsId, memberId, exp }
  const conn = (ws) => ws.postiz || null;
  const pub = (ws) => {
    const c = conn(ws);
    if (!c) return { connected: false, oauth: oauthOn() };
    return { connected: true, oauth: oauthOn(), via: c.via || 'key', url: c.url === cloudUrl ? null : c.url, last4: c.via === 'oauth' ? null : c.last4, org: c.org || null, at: c.at, by: c.by, channels: c.channels || [], checkedAt: c.checkedAt || null, error: c.error || null };
  };
  // A self-hosted address must be a public https site (Kloomie won't call into private networks).
  async function baseUrl(v) {
    const s = String(v || '').trim();
    if (!s) return cloudUrl;
    let u;
    try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch { throw Object.assign(new Error('Enter your Postiz address, like https://postiz.yourbusiness.com'), { status: 400 }); }
    if (!allowLocal) {
      if (u.protocol !== 'https:') throw Object.assign(new Error('Your Postiz address needs https://'), { status: 400 });
      const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
      if (!addrs.length) throw Object.assign(new Error(`Couldn’t find ${u.hostname}.`), { status: 400 });
      if (addrs.some((x) => privateIp(x.address))) throw Object.assign(new Error('That address is on a private network. Use your public Postiz address.'), { status: 400 });
    }
    // Self-hosted Postiz serves the API under /api/public/v1.
    const path = u.pathname.replace(/\/+$/, '');
    return u.origin + (/\/public\/v1$/.test(path) ? path : `${path.replace(/\/api$/, '')}/api/public/v1`);
  }
  async function call(c, method, path, body, { form } = {}) {
    const key = unseal(c.key).key;
    // A form (a picture upload) goes as its encoded bytes, so it can be sent the same safe way.
    let payload = body ? JSON.stringify(body) : undefined, type = body ? 'application/json' : null;
    if (form) {
      const enc = new Response(form);
      payload = Buffer.from(await enc.arrayBuffer());
      type = enc.headers.get('content-type');
    }
    const res = await safeFetch(c.url + path, {
      method, timeout: TIMEOUT, maxBytes: 5_000_000, allowLocal, headers: { Authorization: key, ...(type ? { 'content-type': type } : {}) }, body: payload,
    }).catch((e) => { throw Object.assign(new Error(e.code === 'TIMEOUT' ? 'Postiz didn’t answer in time. Try again.' : e.code === 'BLOCKED' ? 'That Postiz address is on a private network.' : 'Couldn’t reach Postiz.'), { status: 502 }); });
    const data = await res.json().catch(() => null);
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('Postiz didn’t accept the API key. Check it in Postiz → Settings → Public API and connect again.'), { status: 400, auth: true });
    if (res.status === 429) throw Object.assign(new Error('Postiz says too many posts this hour. Try again later.'), { status: 429 });
    if (!res.ok) throw Object.assign(new Error(`Postiz said no: ${cleanText(data?.message || data?.error || res.statusText, 300)}`), { status: 502 });
    return data;
  }
  // The channels linked in their Postiz, and which Kloomie can post to.
  const channelOf = (x) => ({ id: String(x.id), name: cleanText(x.name, 120), kind: String(x.identifier || ''), kindName: POSTIZ_KINDS[x.identifier]?.name || x.identifier, picture: /^https:\/\//.test(x.picture || '') ? x.picture : null, profile: cleanText(x.profile, 120), disabled: !!x.disabled, usable: !!POSTIZ_KINDS[x.identifier] && !x.disabled });
  async function refresh(ws) {
    const c = conn(ws);
    if (!c) return [];
    try {
      const list = await call(c, 'GET', '/integrations');
      c.channels = (Array.isArray(list) ? list : []).slice(0, 60).map(channelOf);
      c.error = null;
    } catch (e) {
      c.error = e.message;
      if (!e.auth) throw e;
    } finally {
      c.checkedAt = Date.now();
      save();
    }
    return c.channels;
  }
  const usable = (ws) => (conn(ws)?.channels || []).filter((x) => x.usable);
  // Channels by what a person or the agent called them: a channel's id, its name, or the platform ("Instagram").
  function pick(ws, names) {
    const all = usable(ws);
    const want = (Array.isArray(names) ? names : [names]).map((n) => String(n || '').trim().toLowerCase()).filter(Boolean);
    const out = [];
    for (const n of want) {
      const hit = all.filter((x) => x.id.toLowerCase() === n || x.name.toLowerCase() === n || x.kindName.toLowerCase() === n || x.kind === n || (n === 'google' && x.kind === 'gmb'));
      for (const h of hit) if (!out.includes(h)) out.push(h);
    }
    return out;
  }
  // Put a file from Kloomie into their Postiz media library, for a post.
  async function upload(ws, { bytes, name, mime }) {
    const c = conn(ws);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mime }), name);
    const m = await call(c, 'POST', '/upload', null, { form });
    if (!m?.path) throw Object.assign(new Error('Postiz didn’t take the picture.'), { status: 502 });
    return { id: m.id, path: m.path };
  }
  // One post to one or more channels: now, at a time, or as a draft in Postiz. Returns Postiz's post ids.
  async function post(ws, { channels, text, image, when, link, cta }) {
    const c = conn(ws);
    if (!c) throw Object.assign(new Error('Connect Postiz in Settings → Connections first.'), { status: 400 });
    if (!channels.length) throw Object.assign(new Error('Pick at least one channel.'), { status: 400 });
    for (const ch of channels) {
      const k = POSTIZ_KINDS[ch.kind];
      if (k.needsImage && !image) throw Object.assign(new Error(`${k.name} posts need a picture.`), { status: 400 });
      if (k.max && text.length > k.max) throw Object.assign(new Error(`That’s too long for ${k.name} (${text.length} of ${k.max} characters).`), { status: 400 });
    }
    const type = when === 'draft' ? 'draft' : when === 'now' || !when ? 'now' : 'schedule';
    const date = type === 'schedule' ? new Date(when).toISOString() : new Date().toISOString();
    const media = image ? [await upload(ws, image)] : [];
    const out = await call(c, 'POST', '/posts', {
      type, date, shortLink: false, tags: [],
      posts: channels.map((ch) => ({ integration: { id: ch.id }, value: [{ content: text, image: media }], settings: { __type: ch.kind, ...POSTIZ_KINDS[ch.kind].settings({ link, cta }) } })),
    });
    return { type, date, posts: (Array.isArray(out) ? out : []).map((x) => ({ id: String(x.postId), channel: String(x.integration) })) };
  }
  async function posts(ws, from, to) {
    const c = conn(ws);
    if (!c) return [];
    const q = new URLSearchParams({ startDate: new Date(from).toISOString(), endDate: new Date(to).toISOString() });
    const d = await call(c, 'GET', '/posts?' + q);
    return (d?.posts || []).slice(0, 100).map((x) => ({ id: String(x.id), text: cleanText(String(x.content || '').replace(/<[^>]+>/g, ' '), 300), when: x.publishDate, state: x.state, error: x.error || null, url: x.releaseURL || null, channel: x.integration?.name || '', kind: x.integration?.providerIdentifier || '' }));
  }
  async function remove(ws, id) {
    const c = conn(ws);
    try {
      await call(c, 'DELETE', '/posts/' + encodeURIComponent(id));
    } catch (e) {
      if (!/404|not found/i.test(e.message)) throw e;
    }
  }

  // Postiz comes back here with a one-time code. Like QuickBooks, this answers with a redirect, never a page, so the
  // code never sits in a page that could pass it on; /postiz/done says how it went.
  const DONE = {
    connected: ['Postiz connected', 'Your Marketing Manager can now post to the channels in your Postiz. You can close this window.'],
    expired: ['Link expired', 'Start again from Kloomie → Settings → Connections → Social posts.'],
    denied: ['Not connected', 'Postiz access wasn’t granted. You can close this window.'],
    role: ['Not connected', 'Only team owners and admins can connect Postiz.'],
    failed: ['Not connected', 'Something went wrong talking to Postiz. Try again in a minute.'],
  };
  const done = (res, how) => { res.writeHead(302, { Location: `/postiz/done?r=${how}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(); };
  function donePage(req, res, url) {
    // Only our own fixed words go in the page: nothing from the address, and no script at all.
    const r = url.searchParams.get('r');
    const [title, msg] = Object.hasOwn(DONE, r || '') ? DONE[r] : DONE.failed;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:15px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:90vh;text-align:center"><div><h2>${title}</h2><p>${msg}</p></div></body>`);
  }
  async function callback(req, res, url) {
    const st = url.searchParams.get('state') || '';
    const pend = pending.get(st);
    pending.delete(st);
    if (!pend || pend.exp < Date.now()) return done(res, 'expired');
    if (url.searchParams.get('error')) return done(res, 'denied');
    const ws = db.workspaces[pend.wsId];
    const who = ws?.members.find((x) => x.id === pend.memberId);
    if (!who || !['owner', 'admin'].includes(who.role)) return done(res, 'role');
    const code = url.searchParams.get('code') || '';
    if (!code) return done(res, 'failed');
    try {
      const r = await fetch(OAUTH.token(), { method: 'POST', signal: AbortSignal.timeout(TIMEOUT), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: OAUTH.id(), client_secret: OAUTH.secret() }) });
      const tok = await r.json().catch(() => null);
      if (!r.ok || !/^pos_/.test(String(tok?.access_token || ''))) throw new Error(`Postiz token exchange: ${r.status} ${cleanText(tok?.error || tok?.message || '', 120)}`);
      const was = ws.postiz;
      ws.postiz = { key: seal({ key: tok.access_token }), via: 'oauth', org: cleanText(tok.id, 80) || null, url: cloudUrl, at: Date.now(), by: who.name, channels: [] };
      try {
        await refresh(ws);
        if (ws.postiz.error) throw new Error(ws.postiz.error);
      } catch (e) {
        ws.postiz = was;
        throw e;
      }
      save();
      broadcast(ws.id, { type: 'postiz' });
      return done(res, 'connected');
    } catch (e) {
      alarm('Connecting Postiz failed', e);
      return done(res, 'failed');
    }
  }

  // /api/postiz: connect (key, optional self-hosted address), see channels, check again, disconnect. Owners and admins.
  async function route(req, res, parts, auth, ws) {
    const [a, b] = parts;
    if (a !== 'postiz') return null;
    const m = req.method;
    if (m === 'GET' && !b) return send(res, 200, pub(ws));
    if (!isAdmin(auth)) return send(res, 403, { error: 'Only team owners and admins can connect Postiz.' });
    // Start "Connect with Postiz": the address of Postiz's approval page for this person.
    if (m === 'POST' && b === 'connect') {
      if (!oauthOn()) return send(res, 400, { error: 'Connecting with Postiz isn’t set up on this server. Use an API key instead.' });
      const state = rid(24);
      for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k);
      pending.set(state, { wsId: ws.id, memberId: auth.memberId, exp: Date.now() + STATE_MS });
      const q = new URLSearchParams({ client_id: OAUTH.id(), response_type: 'code', state });
      return send(res, 200, { url: `${OAUTH.authorize()}?${q}` });
    }
    if (m === 'PUT' && !b) {
      const body = await readJson(req, 10_000);
      const key = String(body.key || '').trim();
      if (key.length < 10 || key.length > 500 || /\s/.test(key)) return send(res, 400, { error: 'Paste the API key from Postiz → Settings → Public API.' });
      let url;
      try { url = await baseUrl(body.url); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
      const was = ws.postiz;
      ws.postiz = { key: seal({ key }), last4: key.slice(-4), url, at: Date.now(), by: auth.member, channels: [] };
      try {
        await refresh(ws);
        if (ws.postiz.error) throw Object.assign(new Error(ws.postiz.error), { status: 400 });
      } catch (e) {
        ws.postiz = was;
        save();
        return send(res, e.status || 502, { error: e.message });
      }
      save();
      broadcast(ws.id, { type: 'postiz' });
      return send(res, 200, pub(ws));
    }
    if (!conn(ws)) return send(res, 404, { error: 'Postiz isn’t connected.' });
    if (m === 'POST' && b === 'refresh') {
      try { await refresh(ws); } catch (e) { return send(res, e.status || 502, { error: e.message }); }
      broadcast(ws.id, { type: 'postiz' });
      return send(res, 200, pub(ws));
    }
    if (m === 'DELETE' && !b) {
      delete ws.postiz;
      save();
      broadcast(ws.id, { type: 'postiz' });
      return send(res, 200, pub(ws));
    }
    return send(res, 405, { error: 'Method not allowed' });
  }
  return { route, callback, donePage, pub, refresh, usable, pick, post, posts, remove, connected: (ws) => !!conn(ws) };
}
