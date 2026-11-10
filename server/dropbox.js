// Dropbox inside Kloomie: each person connects their own Dropbox once, then + → From Dropbox shows its folders and files
// in Kloomie itself (browse, search, tick, Add). No popup window, so it works the same in a browser tab, the desktop app
// and an app saved to a phone's home screen. The server copies each picked file from Dropbox into the stack.
// Needs a Dropbox app with Full Dropbox access: DROPBOX_APP_KEY + DROPBOX_APP_SECRET, redirect <PUBLIC_URL>/oauth/dropbox/callback,
// scopes account_info.read, files.metadata.read, files.content.read. Without the secret the old Chooser popup is used.
// Only reads: Kloomie never changes anything in anyone's Dropbox. The refresh token is kept sealed.
import crypto from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';

const API = process.env.DROPBOX_API || 'https://api.dropboxapi.com';
const CONTENT = process.env.DROPBOX_CONTENT || 'https://content.dropboxapi.com';
const AUTH = process.env.DROPBOX_AUTH || 'https://www.dropbox.com';
const SCOPES = 'account_info.read files.metadata.read files.content.read';

export function dropboxModule({ db, rid, save, send, readJson, seal, unseal, broadcast, publicUrl, receiveUpload, addItem, baseItem, uploadPlace, publicItem, FILES_DIR, mimeFor, cleanName, alarm }) {
  db.dropbox ||= {};
  const env = (k) => process.env[k] || '';
  const configured = () => !!(env('DROPBOX_APP_KEY') && env('DROPBOX_APP_SECRET'));
  const redirect = () => `${publicUrl}/oauth/dropbox/callback`;
  const keyOf = (wsId, memberId) => `${wsId}:${memberId}`;
  const pending = new Map(); // state → who is connecting
  const fail = (msg, status = 400, extra = {}) => Object.assign(new Error(msg), { status, ...extra });

  async function tokenCall(form) {
    const r = await fetch(`${API}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...form, client_id: env('DROPBOX_APP_KEY'), client_secret: env('DROPBOX_APP_SECRET') }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw fail('Dropbox didn’t accept the sign-in.', 502, { auth: r.status === 400 || r.status === 401 });
    return j;
  }
  async function access(c) {
    let tok = unseal(c.tokens);
    if (!tok.access || Date.now() > tok.expires) {
      let j;
      try {
        j = await tokenCall({ grant_type: 'refresh_token', refresh_token: tok.refresh });
      } catch (e) {
        if (e.auth) { c.error = 'Dropbox sign-in expired. Connect again.'; save(); throw fail(c.error, 409, { reconnect: true }); }
        throw e;
      }
      tok = { ...tok, access: j.access_token, expires: Date.now() + (j.expires_in - 120) * 1000 };
      c.tokens = seal(tok);
      c.error = null;
      save();
    }
    return tok.access;
  }
  async function rpc(c, endpoint, body) {
    const token = await access(c);
    const r = await fetch(`${API}/2/${endpoint}`, { method: 'POST', headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 401) { c.error = 'Dropbox sign-in expired. Connect again.'; save(); throw fail(c.error, 409, { reconnect: true }); }
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      const tag = j?.error?.['.tag'] || j?.error_summary || '';
      if (/not_found/.test(JSON.stringify(j?.error || tag))) throw fail('That folder or file isn’t in Dropbox any more.', 404);
      if (/missing_scope/.test(JSON.stringify(j || ''))) throw fail('Dropbox didn’t allow reading files. Connect again and allow access.', 403, { reconnect: true });
      throw fail('Dropbox had a problem: ' + String(j?.error_summary || r.status).slice(0, 120), 502);
    }
    return j;
  }
  // Dropbox's own shape → what the list shows.
  const entry = (x) => x['.tag'] === 'folder'
    ? { id: x.id, name: x.name, path: x.path_display || x.path_lower, folder: true }
    : { id: x.id, name: x.name, path: x.path_display || x.path_lower, folder: false, size: x.size || 0, modified: x.server_modified || x.client_modified || null, downloadable: x.is_downloadable !== false };
  const sortEntries = (list) => list.sort((a, b) => (b.folder - a.folder) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  // Header values must be ASCII: names in other alphabets go as \u escapes.
  const headerArg = (o) => JSON.stringify(o).replace(/[\u007f-￿]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));

  const status = (c) => ({ configured: configured(), connected: !!c, account: c?.account || null, name: c?.name || null, error: c?.error || null });

  async function route(req, res, parts, auth, ws) {
    if (parts[0] !== 'dropbox') return null;
    const m = req.method;
    const k = keyOf(ws.id, auth.memberId);
    const c = db.dropbox[k];
    const [, b] = parts;
    try {
      if (m === 'GET' && !b) return send(res, 200, status(c));
      if (!configured()) return send(res, 400, { error: 'Dropbox isn’t set up on this server yet.' });
      if (m === 'POST' && b === 'connect') {
        const state = crypto.randomBytes(18).toString('base64url');
        pending.set(state, { wsId: ws.id, memberId: auth.memberId, exp: Date.now() + 15 * 60_000 });
        for (const [s, p] of pending) if (p.exp < Date.now()) pending.delete(s);
        const url = `${AUTH}/oauth2/authorize?` + new URLSearchParams({ client_id: env('DROPBOX_APP_KEY'), response_type: 'code', token_access_type: 'offline', redirect_uri: redirect(), state, scope: SCOPES });
        return send(res, 200, { url });
      }
      if (m === 'DELETE' && !b) {
        if (c) {
          await rpc(c, 'auth/token/revoke').catch(() => {});
          delete db.dropbox[k];
          save();
        }
        return send(res, 200, status(null));
      }
      if (!c) return send(res, 409, { error: 'Connect your Dropbox first.', reconnect: true });
      // A folder's contents ('' is the top), a page at a time.
      if (m === 'GET' && b === 'list') {
        const url = new URL(req.url, 'http://x');
        const cursor = url.searchParams.get('cursor');
        let p = url.searchParams.get('path') || '';
        if (p === '/') p = '';
        const j = cursor ? await rpc(c, 'files/list_folder/continue', { cursor }) : await rpc(c, 'files/list_folder', { path: p, limit: 500, include_non_downloadable_files: true });
        return send(res, 200, { entries: sortEntries(j.entries.filter((x) => x['.tag'] !== 'deleted').map(entry)), cursor: j.has_more ? j.cursor : null });
      }
      if (m === 'GET' && b === 'search') {
        const q = String(new URL(req.url, 'http://x').searchParams.get('q') || '').trim().slice(0, 200);
        if (!q) return send(res, 200, { entries: [] });
        const j = await rpc(c, 'files/search_v2', { query: q, options: { max_results: 100, file_status: 'active', filename_only: false } });
        return send(res, 200, { entries: (j.matches || []).map((x) => x.metadata?.metadata).filter(Boolean).map(entry) });
      }
      // One picked file, copied from Dropbox into the stack (or channel, or folder) like an upload.
      if (m === 'POST' && b === 'import') {
        const body = await readJson(req, 10_000);
        const id = String(body.id || '');
        if (!/^id:[\w-]+$/.test(id)) return send(res, 400, { error: 'Pick a file.' });
        const meta = await rpc(c, 'files/get_metadata', { path: id });
        if (meta['.tag'] !== 'file') return send(res, 400, { error: 'Only files can be added, not folders.' });
        if (meta.is_downloadable === false) return send(res, 400, { error: `${meta.name} can’t be downloaded from Dropbox (it’s a Dropbox Paper or cloud document).` });
        const token = await access(c);
        const r = await fetch(`${CONTENT}/2/files/download`, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'Dropbox-API-Arg': headerArg({ path: id }) } });
        if (!r.ok || !r.body) throw fail(`Couldn’t download ${meta.name} from Dropbox.`, 502);
        const name = cleanName(meta.name);
        const fid = rid();
        const { size } = await receiveUpload(Readable.fromWeb(r.body), path.join(FILES_DIR, fid));
        const item = addItem({ ...baseItem(auth, { type: 'file', name, size, mime: mimeFor(name) }), id: fid, ...uploadPlace(ws, auth, body), from: 'Dropbox' });
        return send(res, 200, publicItem(item));
      }
      return send(res, 404, { error: 'Not found' });
    } catch (e) {
      if (e.status) return send(res, e.status, { error: e.message, ...(e.reconnect ? { reconnect: true } : {}) });
      throw e;
    }
  }

  const PAGES = {
    ok: ['Dropbox connected', 'You can close this window and go back to Kloomie. Your Dropbox files are in + → From Dropbox.'],
    expired: ['Link expired', 'Start again from Kloomie: + → From Dropbox → Connect Dropbox.'],
    denied: ['Not connected', 'Dropbox access wasn’t allowed. You can close this window.'],
    failed: ['Not connected', 'Something went wrong talking to Dropbox. Try again in a minute.'],
  };
  const done = (res, how) => { res.writeHead(302, { Location: `/dropbox/done?r=${how}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(); };
  function donePage(req, res, url) {
    const [title, msg] = PAGES[url.searchParams.get('r')] || PAGES.failed;
    return send(res, 200, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>${title}</title><body style="font:15px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:90vh;text-align:center;padding:0 16px"><div><h2>${title}</h2><p>${msg}</p></div></body>`,
      { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  }
  async function callback(req, res, url) {
    const st = url.searchParams.get('state') || '';
    const pend = pending.get(st);
    pending.delete(st);
    if (!pend || pend.exp < Date.now()) return done(res, 'expired');
    if (url.searchParams.get('error')) return done(res, 'denied');
    const ws = db.workspaces[pend.wsId];
    if (!ws?.members.some((x) => x.id === pend.memberId)) return done(res, 'expired');
    try {
      const j = await tokenCall({ grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: redirect() });
      if (!j.refresh_token) return done(res, 'failed');
      const c = { wsId: ws.id, memberId: pend.memberId, at: Date.now(), error: null, tokens: seal({ refresh: j.refresh_token, access: j.access_token, expires: Date.now() + (j.expires_in - 120) * 1000 }) };
      const acct = await rpc(c, 'users/get_current_account').catch(() => null);
      c.account = acct?.email || null;
      c.name = acct?.name?.display_name || null;
      db.dropbox[keyOf(ws.id, pend.memberId)] = c;
      save();
      broadcast(ws.id, { type: 'dropbox', forMember: pend.memberId });
      return done(res, 'ok');
    } catch (e) {
      alarm('Connecting Dropbox failed', e);
      return done(res, 'failed');
    }
  }
  // A person leaving a team takes their Dropbox link with them.
  function forget(wsId, memberId) {
    if (db.dropbox[keyOf(wsId, memberId)]) { delete db.dropbox[keyOf(wsId, memberId)]; save(); }
  }
  return { route, callback, donePage, configured, forget };
}
