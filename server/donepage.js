// The page someone lands on after connecting an app (GitHub, and the other connections as they move onto it): the
// Kloomie mark, a ✓ (or ! when it didn't work), what happened, and a way back. Light and dark. Text goes in as text.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

// ok: true (connected), false (didn't work) or 'wait' (waiting on someone else). app: the app's name, for the mark.
// No scripts: send it with DONE_HEADERS (a policy that allows none).
export const DONE_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
export function donePage({ title, message, ok = true, app = '' }) {
  const mark = ok === true ? '✓' : ok === 'wait' ? '…' : '!';
  const tone = ok === true ? 'ok' : ok === 'wait' ? 'wait' : 'bad';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} · Kloomie</title>
<link rel="icon" href="/favicon.png">
<style>
:root { --bg: #f6f6f8; --card: #fff; --text: #17171c; --muted: #6b6b76; --line: #e6e6ec; --accent: #6b5cf0; --ok: #1f9d63; --wait: #b7791f; --bad: #d14343; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg: #111114; --card: #1b1b20; --text: #f2f2f5; --muted: #a0a0ab; --line: #2c2c33; --accent: #8b7cff; --ok: #3ddc97; --wait: #ffb547; --bad: #ff6b6b; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
.card { width: 100%; max-width: 420px; background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 32px 28px 26px; text-align: center; box-shadow: 0 12px 40px rgba(0,0,0,.06); }
.brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: 14px; color: var(--muted); margin-bottom: 22px; }
.brand img { width: 22px; height: 22px; border-radius: 6px; }
.mark { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%; display: grid; place-items: center; font-size: 28px; font-weight: 700; color: #fff; }
.mark.ok { background: var(--ok); } .mark.wait { background: var(--wait); } .mark.bad { background: var(--bad); }
h1 { margin: 0 0 8px; font-size: 21px; letter-spacing: -.01em; }
p { margin: 0 auto; max-width: 340px; color: var(--muted); }
.btns { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 24px; }
a { font: inherit; font-weight: 600; font-size: 14px; padding: 9px 16px; border-radius: 10px; cursor: pointer; text-decoration: none; }
.go { background: var(--accent); color: #fff; border: 1px solid var(--accent); }
.hint { margin-top: 14px; font-size: 12.5px; }
</style></head>
<body><main class="card">
<div class="brand"><img src="/icon-128.png" alt="">Kloomie${app ? ` · ${esc(app)}` : ''}</div>
<div class="mark ${tone}" aria-hidden="true">${mark}</div>
<h1>${esc(title)}</h1>
<p>${esc(message)}</p>
<div class="btns"><a class="go" href="/">Back to Kloomie</a></div>
<p class="hint">You can close this window.</p>
</main>
</body></html>`;
}
