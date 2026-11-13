// E6: a "connect your account" sign-in (Google, Microsoft, Dropbox, QuickBooks, Postiz) finishes by itself only in
// the browser that started it. Starting sets a short-lived cookie; the provider sends the person back to the same
// browser, which still has it. Anywhere else (the desktop app opens these in the computer's own browser, or someone
// was sent another person's sign-in link), the person is first shown exactly which Kloomie team and person their
// account would be connected to, and has to confirm. Without this, anyone could start connecting, send the link to
// someone else, and get that person's calendar, email or books attached to their own team.
import crypto from 'node:crypto';

const COOKIE = 'kl_oauth';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function oauthBind({ secure = false, secret = crypto.randomBytes(32) } = {}) {
  const hash = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
  const cookieOf = (req) => (/(?:^|;\s*)kl_oauth=([A-Za-z0-9_-]{24,64})(?:;|$)/.exec(req.headers.cookie || '') || [])[1] || null;
  const eq = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

  // When connecting starts: marks this browser and returns the mark to keep with the pending start.
  function start(req, res) {
    const v = cookieOf(req) || crypto.randomBytes(24).toString('base64url');
    res.setHeader('Set-Cookie', `${COOKIE}=${v}; Path=/; Max-Age=1800; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
    return hash(v);
  }
  const sameBrowser = (req, pend) => { const c = cookieOf(req); return !!(c && pend?.browser && eq(hash(c), pend.browser)); };
  const sign = (state) => crypto.createHmac('sha256', secret).update('oauth-confirm:' + state).digest('base64url');
  const confirmed = (url) => eq(url.searchParams.get('confirm') || '', sign(url.searchParams.get('state') || ''));

  // At the callback, before anything is used or the pending start is dropped. Returns true when it answered with
  // the confirm page; the caller then stops (and keeps the pending start for the confirm click).
  function gate(req, res, url, pend, { what, team, person }) {
    if (url.searchParams.get('error') || sameBrowser(req, pend) || confirmed(url)) return false;
    const next = new URLSearchParams(url.searchParams);
    next.set('confirm', sign(url.searchParams.get('state') || ''));
    const go = `${url.pathname}?${next}`;
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'",
    });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>Connect ${esc(what)} to Kloomie?</title>
<body style="font:15px system-ui;background:#f6f6f8;color:#17171c;display:grid;place-items:center;min-height:90vh;margin:0;padding:0 16px"><div style="max-width:440px">
<h2>Connect ${esc(what)} to Kloomie?</h2>
<p>This connects the account you just signed in with to <b>${esc(person)}</b> on the Kloomie team <b>“${esc(team)}”</b>.</p>
<p>Only continue if that’s you and you started this in Kloomie yourself. If someone sent you this link, close this page: nothing has been connected.</p>
<p style="margin-top:24px"><a id="confirm" href="${esc(go)}" style="display:inline-block;background:#3b82f6;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Yes, connect it</a></p>
</div></body>`);
    return true;
  }
  return { start, gate, sameBrowser };
}
