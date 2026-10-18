// Column sync server: accounts/teams, file storage, and live updates over WebSocket.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { streamZip, zipSize } from './zip.js';
import { iconPng } from './png.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4747);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const FILES_DIR = path.join(DATA_DIR, 'files');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const CLIENT_DIR = path.resolve(__dirname, '..', 'client');

fs.mkdirSync(FILES_DIR, { recursive: true });

// ---------- persistence (a JSON file is plenty for personal/small-team use) ----------
let db = { workspaces: {}, tokens: {}, items: {}, entries: {}, tasks: {}, uploads: {}, campaigns: {}, goals: {}, attempts: {} };
try {
  db = { ...db, ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
} catch {}
for (const ws of Object.values(db.workspaces)) {
  ws.channels ||= [];
  ws.chatFolders ||= [];
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_PATH);
  }, 200);
}

const rid = (n = 12) => crypto.randomBytes(n).toString('base64url');
const slugify = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

function hashPass(pass, salt) {
  return crypto.scryptSync(String(pass), salt, 32).toString('hex');
}

// ---------- helpers ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.heic': 'image/heic', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.zip': 'application/zip',
};
const mimeFor = (name, given) => (given && given !== 'application/octet-stream' ? given : MIME[path.extname(name).toLowerCase()] || 'application/octet-stream');

function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isObj ? 'application/json' : 'text/plain', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}

async function readJson(req, limit = 1_000_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

function authFrom(req, url) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('t');
  const session = token ? db.tokens[token] : null;
  const ws = session ? db.workspaces[session.wsId] : null;
  const member = ws?.members.find((x) => x.id === session.memberId);
  if (!member) return null;
  return { token, ...session, ws, memberId: member.id, member: member.name, role: member.role };
}

// ---------- people ----------
// Everyone signs in with their own name + password. New people join with the team's invite code.
const nameKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const codeKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function newInviteCode() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const c = Array.from(crypto.randomBytes(8), (b) => abc[b % abc.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}
function newMember(ws, name, role) {
  const m = { id: rid(8), name, nameKey: nameKey(name), role, salt: null, hash: null, createdAt: Date.now() };
  ws.members.push(m);
  return m;
}
function setPassword(m, pass) {
  m.salt = rid(16);
  m.hash = hashPass(pass, m.salt);
}
function checkHash(pass, salt, hash) {
  return crypto.timingSafeEqual(Buffer.from(hashPass(pass, salt), 'hex'), Buffer.from(hash, 'hex'));
}
function checkInvite(ws, code) {
  if (ws.inviteCode) {
    const a = crypto.createHash('sha256').update(codeKey(code)).digest();
    return crypto.timingSafeEqual(a, crypto.createHash('sha256').update(codeKey(ws.inviteCode)).digest());
  }
  // Teams from before per-person logins: the old shared passphrase works until an owner makes a code.
  return !!ws.hash && checkHash(String(code || ''), ws.salt, ws.hash);
}
// A team with no owner (upgraded from shared passphrase) gets one: the first person to set a password.
function ensureOwner(ws, m) {
  if (!ws.members.some((x) => x.role === 'owner')) m.role = 'owner';
}
function signOutMember(ws, memberId) {
  for (const [tok, sess] of Object.entries(db.tokens)) if (sess.memberId === memberId) delete db.tokens[tok];
  for (const s of sockets.get(ws.id) || []) if (s.meta.memberId === memberId) s.close(4001, 'Signed out');
}
const publicMember = (m) => ({ id: m.id, name: m.name, role: m.role, hasPassword: !!m.hash });

// A private campaign's feed and stack are hidden from people outside it.
const publicWorkspace = (ws, memberId) => ({
  id: ws.id,
  name: ws.name,
  settings: ws.settings,
  stacks: ws.stacks.filter((x) => seesCampaign(x.campaignId, memberId)),
  channels: ws.channels.filter((x) => seesCampaign(x.campaignId, memberId)),
  chatFolders: ws.chatFolders,
  members: ws.members.map(publicMember),
  inviteCode: ws.inviteCode,
});

// Shared-passphrase teams become per-person: everyone who has signed in or posted becomes a member with no
// password yet. Their devices stay signed in; on new devices they set a password with Join team.
function migratePeople() {
  for (const ws of Object.values(db.workspaces)) {
    if (ws.members) continue;
    ws.members = [];
    ws.inviteCode = null;
    const memberFor = (name) => {
      const n = String(name || '').trim().slice(0, 40) || 'Me';
      return ws.members.find((x) => x.nameKey === nameKey(n)) || newMember(ws, n, 'member');
    };
    for (const sess of Object.values(db.tokens)) if (sess.wsId === ws.id) sess.memberId = memberFor(sess.member).id;
    for (const it of Object.values(db.items)) if (it.wsId === ws.id && it.by) it.memberId = memberFor(it.by).id;
  }
  save();
}

function publicItem(it) {
  const { wsId, files, ...rest } = it;
  if (files) rest.files = files.map((f, i) => ({ i, relPath: f.relPath, size: f.size }));
  return rest;
}

// Day planner entries: a note (start only, or no time = "anytime") or a block (start + end).
// Times are minutes from midnight in the user's local day; date is YYYY-MM-DD.
const COLORS = ['violet', 'blue', 'green', 'amber', 'rose'];
const REPEATS = ['daily', 'weekdays', 'weekly', 'monthly'];
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));
const dayList = (v) => (Array.isArray(v) ? [...new Set(v.filter(isDay))].sort().slice(-1000) : []);
const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });

function publicEntry(e) {
  const { wsId, ...rest } = e;
  return rest;
}

function applyEntry(e, body) {
  const minutes = (v, max) => {
    if (v === null || v === '' || v === undefined) return null;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > max) throw badRequest('Bad time');
    return n;
  };
  if (body.text !== undefined) e.text = String(body.text || '').trim().slice(0, 5000);
  if (body.date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) throw badRequest('Bad date');
    e.date = body.date;
  }
  if (body.start !== undefined) e.start = minutes(body.start, 1439);
  if (body.end !== undefined) e.end = minutes(body.end, 1440);
  if (body.done !== undefined) e.done = !!body.done;
  if (body.color !== undefined) e.color = COLORS.includes(body.color) ? body.color : null;
  // A repeating entry is one series: skip = dates removed from it, doneOn = dates checked off.
  if (body.repeat !== undefined) e.repeat = REPEATS.includes(body.repeat) ? body.repeat : null;
  if (body.skip !== undefined) e.skip = dayList(body.skip);
  if (body.doneOn !== undefined) e.doneOn = dayList(body.doneOn);
  if (body.taskId !== undefined) e.taskId = body.taskId && db.tasks[body.taskId]?.wsId === e.wsId ? body.taskId : null;
  if (e.start == null) e.end = null;
  if (e.end != null && e.end <= e.start) throw badRequest('End time must be after the start.');
  if (!e.text) throw badRequest('Write something first.');
  if (!e.date) throw badRequest('Pick a date.');
  return e;
}

// Tasks: an undated to-do list. Schedule entries can link to one (entry.taskId) and then share its text and done state.
const publicTask = publicEntry;

function applyTask(t, body) {
  if (body.text !== undefined) t.text = String(body.text || '').trim().slice(0, 5000);
  if (body.due !== undefined) {
    if (body.due !== null && !/^\d{4}-\d{2}-\d{2}$/.test(body.due)) throw badRequest('Bad due date.');
    t.due = body.due;
  }
  if (body.repeat !== undefined) t.repeat = REPEATS.includes(body.repeat) ? body.repeat : null;
  if (body.goalId !== undefined) t.goalId = body.goalId && db.goals[body.goalId]?.wsId === t.wsId ? body.goalId : null;
  if (body.assigneeId !== undefined) t.assigneeId = body.assigneeId && db.workspaces[t.wsId]?.members.some((m) => m.id === body.assigneeId) ? body.assigneeId : null;
  if (body.report !== undefined) t.report = !!body.report;
  if (body.priority !== undefined) t.priority = Math.max(0, Math.min(3, Math.round(Number(body.priority)) || 0));
  if (body.done !== undefined) {
    t.done = !!body.done;
    t.doneAt = t.done ? Date.now() : null;
  }
  if (!t.text) throw badRequest('Write something first.');
  return t;
}

function contentDisposition(kind, name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// Serves a file with Range support so videos/music stream and scrub.
function serveFile(req, res, filePath, { name, mime, download }) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return send(res, 404, { error: 'File missing' });
  }
  const headers = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Content-Disposition': contentDisposition(download ? 'attachment' : 'inline', name),
    'Cache-Control': 'private, max-age=31536000, immutable',
  };
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range && stat.size > 0) {
    let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, stat.size - 1);
    if (start > end) return send(res, 416, '', { 'Content-Range': `bytes */${stat.size}` });
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(filePath, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

async function receiveUpload(req, dest) {
  let size = 0;
  let crc = 0;
  req.on('data', (c) => {
    size += c.length;
    crc = zlib.crc32(c, crc);
  });
  try {
    await pipeline(req, fs.createWriteStream(dest));
  } catch (e) {
    await fsp.rm(dest, { force: true });
    throw Object.assign(new Error('Upload interrupted'), { status: 400 });
  }
  return { size, crc };
}

// Folder-relative path with no way to climb out of the folder.
const cleanRel = (p) => String(p || 'file').replace(/\\/g, '/').split('/').filter((x) => x && x !== '.' && x !== '..').join('/') || 'file';
const cleanName = (n) => String(n || 'file').replace(/[\/\\]/g, '_').slice(0, 255);

// Resumable uploads: a session holds the bytes received so far in FILES_DIR/.part-<id>.
const partPath = (up) => path.join(FILES_DIR, '.part-' + up.id);
function dropUpload(up) {
  delete db.uploads[up.id];
  fsp.rm(partPath(up), { force: true }).catch(() => {});
  save();
}

function removeItemFiles(it) {
  if (it.type === 'file') fsp.rm(path.join(FILES_DIR, it.id), { force: true }).catch(() => {});
  if (it.type === 'folder') for (const f of it.files || []) fsp.rm(path.join(FILES_DIR, f.fid), { force: true }).catch(() => {});
}

function deleteItem(id) {
  const it = db.items[id];
  if (!it) return;
  if (it.type === 'message') for (const r of Object.values(db.items)) if (r.parentId === id) deleteItem(r.id);
  removeItemFiles(it);
  delete db.items[id];
  save();
  broadcast(it.wsId, { type: 'item:remove', id });
}

function addItem(item) {
  db.items[item.id] = item;
  save();
  if (item.status === 'ready') broadcast(item.wsId, { type: 'item:add', item: publicItem(item) });
  return item;
}

function baseItem(auth, fields) {
  return {
    id: rid(),
    wsId: auth.wsId,
    by: auth.member,
    memberId: auth.memberId,
    device: auth.device,
    deviceId: auth.deviceId,
    createdAt: Date.now(),
    pinned: false,
    stackId: null,
    channelId: null,
    status: 'ready',
    ...fields,
  };
}

function sendZip(req, res, folder) {
  const entries = folder.files.map((f) => ({
    name: `${folder.name}/${f.relPath}`,
    path: path.join(FILES_DIR, f.fid),
    size: f.size,
    crc: f.crc,
    mtime: f.mtime,
  }));
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': zipSize(entries),
    'Content-Disposition': contentDisposition('attachment', `${folder.name}.zip`),
  });
  if (req.method === 'HEAD') return res.end();
  return streamZip(res, entries).catch(() => res.destroy());
}

// ---------- public share links: /s/<token> is a download page for one file or folder, no sign-in ----------
const liveShare = (it) => it?.share && (!it.share.expiresAt || it.share.expiresAt > Date.now());
const sharedItem = (token) => Object.values(db.items).find((it) => it.share?.token === token && liveShare(it) && it.status === 'ready');
const escHtml = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
function fmtBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) (n /= 1024), i++;
  return (i && n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
}

function serveShare(req, res, url) {
  const [, token, part] = url.pathname.split('/').filter(Boolean);
  const it = token && sharedItem(token);
  const headers = { 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (!it) return sharePage(res, 404, '<h1>Link not available</h1><p>This link has expired or was turned off.</p>');
  if (part === 'file' && it.type === 'file') return serveFile(req, res, path.join(FILES_DIR, it.id), { name: it.name, mime: it.mime, download: url.searchParams.has('dl') });
  if (part === 'zip' && it.type === 'folder') return sendZip(req, res, it);
  if (part) return sharePage(res, 404, '<h1>Not found</h1>');
  const base = `/s/${token}`;
  const mime = it.mime || '';
  const src = `${base}/file`;
  const preview = it.type !== 'file' ? ''
    : /^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(mime) ? `<img src="${src}" alt="">`
    : /^video\/(mp4|webm|quicktime)$/.test(mime) ? `<video src="${src}" controls playsinline preload="metadata"></video>`
    : mime.startsWith('audio/') ? `<audio src="${src}" controls preload="metadata"></audio>` : '';
  const detail = it.type === 'folder' ? `Folder · ${it.files.length} file${it.files.length === 1 ? '' : 's'} · ${fmtBytes(it.size)}` : fmtBytes(it.size);
  const until = it.share.expiresAt ? ` · link expires ${new Date(it.share.expiresAt).toUTCString().slice(0, 16)}` : '';
  sharePage(res, 200, `${preview}<h1>${escHtml(it.name)}</h1><p>${detail}${until}</p>
    <a class="dl" href="${it.type === 'folder' ? base + '/zip' : src + '?dl=1'}">Download${it.type === 'folder' ? ' (.zip)' : ''}</a>`, it.name);
}

function sharePage(res, code, body, title = 'Column') {
  res.writeHead(code, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
  });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(title)}</title><style>
:root{color-scheme:light dark;--bg:#f6f6f8;--card:#fff;--text:#16161a;--muted:#6b6b76;--accent:#7c6cf6}
@media (prefers-color-scheme:dark){:root{--bg:#111115;--card:#1a1a20;--text:#ececf1;--muted:#8d8d99}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:16px;box-sizing:border-box}
main{background:var(--card);border-radius:16px;padding:24px;width:min(560px,100%);box-shadow:0 10px 40px rgba(0,0,0,.12);text-align:center}
img,video{max-width:100%;max-height:60vh;border-radius:10px;display:block;margin:0 auto 16px}audio{width:100%;margin-bottom:16px}
h1{font-size:18px;margin:0 0 4px;word-break:break-word}p{color:var(--muted);margin:0 0 18px;font-size:13px}
.dl{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;padding:10px 22px;border-radius:10px}
footer{margin-top:18px;font-size:11.5px;color:var(--muted)}
</style></head><body><main>${body}<footer>Shared with Column</footer></main></body></html>`);
}

// Messages link to things as [[file:<id>]], [[stack:<id>]], [[task:<id>]]. A linked file is pinned so auto-clear never breaks the link.
const LINK_RE = /\[\[(file|stack|task):([\w-]+)\]\]/g;
function pinLinked(ws, text) {
  for (const [, kind, id] of text.matchAll(LINK_RE)) {
    const it = kind === 'file' && db.items[id];
    if (!it || it.wsId !== ws.id || it.pinned) continue;
    it.pinned = true;
    broadcast(ws.id, { type: 'item:update', item: publicItem(it) });
  }
  save();
}

function validStack(ws, stackId, memberId) {
  const st = stackId && ws.stacks.find((s) => s.id === stackId);
  return st && seesCampaign(st.campaignId, memberId) ? stackId : null;
}

// Chat feeds (#channels), optionally grouped into folders. Items with a channelId live only in that feed.
function validChannel(ws, channelId, memberId) {
  const ch = channelId && ws.channels.find((c) => c.id === channelId);
  return ch && seesCampaign(ch.campaignId, memberId) ? channelId : null;
}
function validChatFolder(ws, folderId) {
  return folderId && ws.chatFolders.some((f) => f.id === folderId) ? folderId : null;
}
function channelName(ws, raw, selfId) {
  const n = String(raw || '').trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  if (!n) throw badRequest('Name required');
  if (n === 'general' || ws.channels.some((c) => c.name === n && c.id !== selfId)) throw Object.assign(new Error(`#${n} already exists.`), { status: 409 });
  return n;
}

// ---------- realtime ----------
const sockets = new Map(); // wsId -> Set<socket>

function broadcast(wsId, msg) {
  const set = sockets.get(wsId);
  if (!set) return;
  if (msg.type === 'workspace') {
    const ws = db.workspaces[wsId];
    for (const s of set) if (s.readyState === 1) s.send(JSON.stringify({ type: 'workspace', workspace: publicWorkspace(ws, s.meta.memberId) }));
    return;
  }
  const campaignId = campaignOfMsg(msg);
  const data = JSON.stringify(msg);
  for (const s of set) if (s.readyState === 1 && seesCampaign(campaignId, s.meta.memberId)) s.send(data);
}

// ---------- campaigns: campaign → goals → tasks, plus logged attempts (each call or email and its outcome) ----------
// Private campaigns, with their goals, tasks, attempts, feed, stack and schedule slots, are only visible to their members.
const OUTCOMES = ['No answer', 'Not interested', 'Interested', 'Booked'];
function seesCampaign(campaignId, memberId) {
  const c = campaignId && db.campaigns[campaignId];
  return !c || !c.private || c.ownerId === memberId || c.memberIds.includes(memberId);
}
function campaignOf(kind, x) {
  if (!x) return null;
  const ws = db.workspaces[x.wsId];
  if (kind === 'campaign') return x.id;
  if (kind === 'goal' || kind === 'attempt') return x.campaignId;
  if (kind === 'task') return x.goalId ? db.goals[x.goalId]?.campaignId || null : null;
  if (kind === 'entry') return x.taskId ? campaignOf('task', db.tasks[x.taskId]) : null;
  if (kind === 'item') {
    const top = x.parentId ? db.items[x.parentId] || x : x;
    return ws?.channels.find((c) => c.id === top.channelId)?.campaignId || ws?.stacks.find((st) => st.id === top.stackId)?.campaignId || null;
  }
  return null;
}
const canSee = (auth, kind, x) => seesCampaign(campaignOf(kind, x), auth.memberId);
function campaignOfMsg(msg) {
  if (msg.item) return campaignOf('item', db.items[msg.item.id]);
  if (msg.task) return campaignOf('task', msg.task);
  if (msg.entry) return campaignOf('entry', msg.entry);
  if (msg.campaign) return msg.campaign.id;
  if (msg.goal) return msg.goal.campaignId;
  if (msg.attempt) return msg.attempt.campaignId;
  return null;
}

const publicCampaign = ({ wsId, ...c }) => c;
const publicGoal = ({ wsId, ...g }) => g;
const publicAttempt = ({ wsId, ...x }) => x;
const isDate = (v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(String(v));

function applyCampaign(c, body, ws, auth) {
  if (body.name !== undefined) c.name = String(body.name || '').trim().slice(0, 80);
  if (body.brief !== undefined) c.brief = String(body.brief || '').slice(0, 20_000);
  for (const k of ['start', 'end']) {
    if (body[k] === undefined) continue;
    if (!isDate(body[k] || null)) throw badRequest('Bad date');
    c[k] = body[k] || null;
  }
  if (body.color !== undefined) c.color = COLORS.includes(body.color) ? body.color : 'violet';
  if (body.status !== undefined && ['active', 'paused', 'done'].includes(body.status)) c.status = body.status;
  if (body.lastReportAt !== undefined) c.lastReportAt = Number(body.lastReportAt) || null;
  if (body.outcomes !== undefined) {
    const list = [...new Set((Array.isArray(body.outcomes) ? body.outcomes : []).map((o) => String(o).trim().slice(0, 40)).filter(Boolean))].slice(0, 12);
    if (list.length) c.outcomes = list;
  }
  // Only the person who made it decides who can see it.
  if ((body.private !== undefined || body.memberIds !== undefined) && c.ownerId && c.ownerId !== auth.memberId) throw Object.assign(new Error('Only the campaign owner can change who sees it.'), { status: 403 });
  if (body.private !== undefined) c.private = !!body.private;
  if (body.memberIds !== undefined) c.memberIds = (Array.isArray(body.memberIds) ? body.memberIds : []).filter((id) => ws.members.some((m) => m.id === id) && id !== c.ownerId);
  if (c.end && c.start && c.end < c.start) throw badRequest('The end date is before the start.');
  if (!c.name) throw badRequest('Give it a name.');
  return c;
}

function applyGoal(g, body, c) {
  if (body.title !== undefined) g.title = String(body.title || '').trim().slice(0, 200);
  if (body.due !== undefined) {
    if (!isDate(body.due || null)) throw badRequest('Bad date');
    g.due = body.due || null;
  }
  if (body.kind !== undefined) g.kind = body.kind === 'count' ? 'count' : 'tasks';
  if (body.target !== undefined) g.target = Math.max(1, Math.min(1_000_000, Math.round(Number(body.target)) || 1));
  // What counts toward a count goal: every attempt (null) or only these outcomes.
  if (body.counts !== undefined) g.counts = Array.isArray(body.counts) ? body.counts.filter((o) => c.outcomes.includes(o)) : null;
  if (body.order !== undefined) g.order = Number(body.order) || 0;
  if (!g.title) throw badRequest('Give the goal a name.');
  return g;
}

// Everything that belongs to a campaign goes with it.
function deleteGoal(g) {
  for (const t of Object.values(db.tasks)) if (t.goalId === g.id) deleteTask(t);
  for (const x of Object.values(db.attempts)) if (x.goalId === g.id) delete db.attempts[x.id];
  delete db.goals[g.id];
  broadcast(g.wsId, { type: 'goal:remove', id: g.id });
}
function deleteTask(t) {
  const priv = campaignOf('task', t) && db.campaigns[campaignOf('task', t)]?.private;
  for (const e of Object.values(db.entries)) {
    if (e.taskId !== t.id) continue;
    if (priv) {
      // Its slot on the schedule was private too, so it goes rather than turning visible.
      delete db.entries[e.id];
      broadcast(t.wsId, { type: 'entry:remove', id: e.id });
    } else {
      e.taskId = null;
      broadcast(t.wsId, { type: 'entry', entry: publicEntry(e) });
    }
  }
  delete db.tasks[t.id];
  broadcast(t.wsId, { type: 'task:remove', id: t.id });
}
function deleteCampaign(ws, c) {
  for (const g of Object.values(db.goals)) if (g.campaignId === c.id) deleteGoal(g);
  for (const it of Object.values(db.items)) if (it.wsId === ws.id && campaignOf('item', it) === c.id) deleteItem(it.id);
  ws.channels = ws.channels.filter((x) => x.campaignId !== c.id);
  ws.stacks = ws.stacks.filter((x) => x.campaignId !== c.id);
  delete db.campaigns[c.id];
  broadcast(ws.id, { type: 'campaign:remove', id: c.id });
  broadcast(ws.id, { type: 'workspace' });
}

function presence(wsId) {
  const seen = new Map();
  for (const s of sockets.get(wsId) || []) seen.set(s.meta.deviceId, { deviceId: s.meta.deviceId, device: s.meta.device, member: s.meta.member, memberId: s.meta.memberId });
  broadcast(wsId, { type: 'presence', devices: [...seen.values()] });
}

// ---------- icons ----------
const iconCache = {};
function icon(size) {
  return (iconCache[size] ||= iconPng(size));
}

// ---------- routes ----------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
  const [a, b, c, d] = parts;
  const m = req.method;

  if (a === 'health') return send(res, 200, { ok: true, app: 'column' });

  if (a === 'auth' && m === 'POST') {
    const { workspace, password, code, name, device, deviceId, mode } = await readJson(req);
    const slug = slugify(workspace);
    if (!slug || slug.length > 60) return send(res, 400, { error: 'Enter a team name.' });
    const who = String(name || '').trim().slice(0, 40);
    if (!who) return send(res, 400, { error: 'Enter your name.' });
    if (!password || String(password).length < 6) return send(res, 400, { error: 'Password must be at least 6 characters.' });
    let ws = Object.values(db.workspaces).find((w) => w.slug === slug);
    let member;
    if (mode === 'create') {
      if (ws) return send(res, 409, { error: 'That team name is taken. Join it instead, or pick another name.' });
      ws = {
        id: rid(),
        name: String(workspace).trim(),
        slug,
        createdAt: Date.now(),
        settings: { expireHours: 0 },
        stacks: [],
        channels: [],
        chatFolders: [],
        members: [],
        inviteCode: newInviteCode(),
      };
      db.workspaces[ws.id] = ws;
      member = newMember(ws, who, 'owner');
      setPassword(member, password);
    } else {
      if (!ws) return send(res, 404, { error: 'No team with that name. Create it instead?' });
      member = ws.members.find((x) => x.nameKey === nameKey(who));
      if (mode === 'join') {
        if (!checkInvite(ws, code)) return send(res, 401, { error: 'Wrong invite code.' });
        if (member?.hash) return send(res, 409, { error: 'Someone here already uses that name. Sign in instead, or pick another name.' });
        member ||= newMember(ws, who, 'member');
        setPassword(member, password);
        ensureOwner(ws, member);
      } else {
        if (!member) return send(res, 404, { error: `No one called “${who}” in ${ws.name}. New here? Use Join team with the invite code.` });
        if (!member.hash) return send(res, 401, { error: 'No password set for this name yet. Use Join team with the invite code to set one.' });
        if (!checkHash(password, member.salt, member.hash)) return send(res, 401, { error: 'Wrong password.' });
      }
    }
    const token = rid(24);
    db.tokens[token] = {
      wsId: ws.id,
      memberId: member.id,
      device: String(device || 'Device').trim().slice(0, 40) || 'Device',
      deviceId: String(deviceId || rid()).slice(0, 64),
      createdAt: Date.now(),
    };
    save();
    if (mode !== 'signin') broadcast(ws.id, { type: 'workspace' });
    return send(res, 200, { token, workspace: publicWorkspace(ws, member.id) });
  }

  const auth = authFrom(req, url);
  if (!auth) return send(res, 401, { error: 'Not signed in' });
  const { ws } = auth;

  if (a === 'logout' && m === 'POST') {
    delete db.tokens[auth.token];
    save();
    return send(res, 200, { ok: true });
  }

  if (a === 'state' && m === 'GET') {
    const items = Object.values(db.items)
      .filter((it) => it.wsId === ws.id && it.status === 'ready' && canSee(auth, 'item', it))
      .sort((x, y) => x.createdAt - y.createdAt)
      .map(publicItem);
    return send(res, 200, {
      workspace: publicWorkspace(ws, auth.memberId),
      me: { memberId: auth.memberId, member: auth.member, device: auth.device, deviceId: auth.deviceId },
      items,
      entries: Object.values(db.entries).filter((e) => e.wsId === ws.id && canSee(auth, 'entry', e)).map(publicEntry),
      tasks: Object.values(db.tasks).filter((t) => t.wsId === ws.id && canSee(auth, 'task', t)).map(publicTask),
      campaigns: Object.values(db.campaigns).filter((c) => c.wsId === ws.id && canSee(auth, 'campaign', c)).map(publicCampaign),
      goals: Object.values(db.goals).filter((g) => g.wsId === ws.id && canSee(auth, 'goal', g)).map(publicGoal),
      attempts: Object.values(db.attempts).filter((x) => x.wsId === ws.id && canSee(auth, 'attempt', x)).map(publicAttempt),
    });
  }

  if (a === 'entries') {
    if (m === 'POST' && !b) {
      const body = await readJson(req, 50_000);
      const e = applyEntry({ id: rid(), wsId: ws.id, by: auth.member, deviceId: auth.deviceId, createdAt: Date.now(), text: '', date: null, start: null, end: null, done: false, color: null, taskId: null }, body);
      db.entries[e.id] = e;
      save();
      broadcast(ws.id, { type: 'entry', entry: publicEntry(e) });
      return send(res, 200, publicEntry(e));
    }
    const e = b && db.entries[b];
    if (!e || e.wsId !== ws.id || !canSee(auth, 'entry', e)) return send(res, 404, { error: 'Not found' });
    if (m === 'PATCH') {
      const next = applyEntry({ ...e }, await readJson(req, 50_000));
      db.entries[e.id] = next;
      save();
      broadcast(ws.id, { type: 'entry', entry: publicEntry(next) });
      return send(res, 200, publicEntry(next));
    }
    if (m === 'DELETE') {
      delete db.entries[e.id];
      save();
      broadcast(ws.id, { type: 'entry:remove', id: e.id });
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  if (a === 'tasks') {
    if (m === 'POST' && !b) {
      const t = applyTask({ id: rid(), wsId: ws.id, by: auth.member, createdAt: Date.now(), text: '', done: false, doneAt: null, due: null, priority: 0, goalId: null, assigneeId: null }, await readJson(req, 50_000));
      if (!canSee(auth, 'task', t)) return send(res, 404, { error: 'Goal not found' });
      db.tasks[t.id] = t;
      save();
      broadcast(ws.id, { type: 'task', task: publicTask(t) });
      return send(res, 200, publicTask(t));
    }
    const t = b && db.tasks[b];
    if (!t || t.wsId !== ws.id || !canSee(auth, 'task', t)) return send(res, 404, { error: 'Not found' });
    if (m === 'PATCH') {
      const next = applyTask({ ...t }, await readJson(req, 50_000));
      if (!canSee(auth, 'task', next)) return send(res, 404, { error: 'Goal not found' });
      db.tasks[t.id] = next;
      // Keep linked entries' own copy current so they still read right if the task is deleted later.
      for (const e of Object.values(db.entries)) {
        if (e.taskId === t.id && (e.text !== next.text || e.done !== next.done)) {
          e.text = next.text;
          e.done = next.done;
          broadcast(ws.id, { type: 'entry', entry: publicEntry(e) });
        }
      }
      save();
      broadcast(ws.id, { type: 'task', task: publicTask(next) });
      return send(res, 200, publicTask(next));
    }
    if (m === 'DELETE') {
      deleteTask(t);
      save();
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  if (a === 'campaigns') {
    if (m === 'POST' && !b) {
      const body = await readJson(req, 100_000);
      const c = applyCampaign({ id: rid(), wsId: ws.id, ownerId: auth.memberId, by: auth.member, createdAt: Date.now(), name: '', brief: '', start: null, end: null, color: 'violet', status: 'active', private: false, memberIds: [], outcomes: [...OUTCOMES], lastReportAt: null }, body, ws, auth);
      // Its own feed (in a "Campaigns" chat folder) and its own stack for files.
      let folder = ws.chatFolders.find((f) => f.campaigns);
      if (!folder) ws.chatFolders.push((folder = { id: rid(8), name: 'Campaigns', campaigns: true }));
      const ch = { id: rid(8), name: channelName(ws, c.name), folderId: folder.id, campaignId: c.id };
      const st = { id: rid(8), name: c.name.slice(0, 40), campaignId: c.id };
      ws.channels.push(ch);
      ws.stacks.push(st);
      c.channelId = ch.id;
      c.stackId = st.id;
      db.campaigns[c.id] = c;
      save();
      broadcast(ws.id, { type: 'campaign', campaign: publicCampaign(c) });
      broadcast(ws.id, { type: 'workspace' });
      return send(res, 200, publicCampaign(c));
    }
    const c = b && db.campaigns[b];
    if (!c || c.wsId !== ws.id || !canSee(auth, 'campaign', c)) return send(res, 404, { error: 'Not found' });
    if (m === 'PATCH') {
      const body = await readJson(req, 100_000);
      const was = JSON.stringify([c.private, c.memberIds]);
      const next = applyCampaign({ ...c, memberIds: [...c.memberIds] }, body, ws, auth);
      db.campaigns[c.id] = next;
      if (body.name !== undefined) {
        const st = ws.stacks.find((x) => x.id === c.stackId);
        if (st) st.name = next.name.slice(0, 40);
      }
      save();
      // Who can see it changed: everyone reloads so it appears or disappears cleanly.
      if (was !== JSON.stringify([next.private, next.memberIds])) broadcast(ws.id, { type: 'resync' });
      else {
        broadcast(ws.id, { type: 'campaign', campaign: publicCampaign(next) });
        if (body.name !== undefined) broadcast(ws.id, { type: 'workspace' });
      }
      return send(res, 200, publicCampaign(next));
    }
    if (m === 'DELETE') {
      if (c.ownerId !== auth.memberId && auth.role !== 'owner') return send(res, 403, { error: 'Only the campaign owner can delete it.' });
      deleteCampaign(ws, c);
      save();
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  if (a === 'goals') {
    if (m === 'POST' && !b) {
      const body = await readJson(req, 50_000);
      const c = db.campaigns[body.campaignId];
      if (!c || c.wsId !== ws.id || !canSee(auth, 'campaign', c)) return send(res, 404, { error: 'Campaign not found' });
      const order = Math.max(0, ...Object.values(db.goals).filter((g) => g.campaignId === c.id).map((g) => g.order || 0)) + 1;
      const g = applyGoal({ id: rid(), wsId: ws.id, campaignId: c.id, by: auth.member, createdAt: Date.now(), title: '', due: null, kind: 'tasks', target: 10, counts: null, order }, body, c);
      db.goals[g.id] = g;
      save();
      broadcast(ws.id, { type: 'goal', goal: publicGoal(g) });
      return send(res, 200, publicGoal(g));
    }
    const g = b && db.goals[b];
    if (!g || g.wsId !== ws.id || !canSee(auth, 'goal', g)) return send(res, 404, { error: 'Not found' });
    if (m === 'PATCH') {
      const next = applyGoal({ ...g }, await readJson(req, 50_000), db.campaigns[g.campaignId]);
      db.goals[g.id] = next;
      save();
      broadcast(ws.id, { type: 'goal', goal: publicGoal(next) });
      return send(res, 200, publicGoal(next));
    }
    if (m === 'DELETE') {
      deleteGoal(g);
      save();
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  // One logged call/email/visit and how it went.
  if (a === 'attempts') {
    if (m === 'POST' && !b) {
      const body = await readJson(req, 50_000);
      const g = db.goals[body.goalId];
      if (!g || g.wsId !== ws.id || !canSee(auth, 'goal', g)) return send(res, 404, { error: 'Goal not found' });
      const c = db.campaigns[g.campaignId];
      const outcome = String(body.outcome || '');
      if (!c.outcomes.includes(outcome)) return send(res, 400, { error: 'Pick an outcome' });
      const t = body.taskId && db.tasks[body.taskId];
      const x = {
        id: rid(), wsId: ws.id, campaignId: c.id, goalId: g.id, taskId: t && t.goalId === g.id ? t.id : null,
        memberId: auth.memberId, by: auth.member, at: Date.now(), outcome,
        contact: String(body.contact || '').trim().slice(0, 200), note: String(body.note || '').trim().slice(0, 2000),
      };
      db.attempts[x.id] = x;
      save();
      broadcast(ws.id, { type: 'attempt', attempt: publicAttempt(x) });
      return send(res, 200, publicAttempt(x));
    }
    const x = b && db.attempts[b];
    if (!x || x.wsId !== ws.id || !canSee(auth, 'attempt', x)) return send(res, 404, { error: 'Not found' });
    if (m === 'DELETE') {
      if (x.memberId !== auth.memberId && db.campaigns[x.campaignId]?.ownerId !== auth.memberId) return send(res, 403, { error: 'You can only remove your own entries.' });
      delete db.attempts[x.id];
      save();
      broadcast(ws.id, { type: 'attempt:remove', id: x.id });
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  if (a === 'members') {
    if (b === 'me' && c === 'password' && m === 'POST') {
      const { current, next } = await readJson(req);
      const me = ws.members.find((x) => x.id === auth.memberId);
      if (me.hash && !checkHash(String(current || ''), me.salt, me.hash)) return send(res, 401, { error: 'Current password is wrong.' });
      if (String(next || '').length < 6) return send(res, 400, { error: 'Password must be at least 6 characters.' });
      setPassword(me, String(next));
      ensureOwner(ws, me);
    } else {
      if (auth.role !== 'owner') return send(res, 403, { error: 'Only team owners can do that.' });
      const target = b && ws.members.find((x) => x.id === b);
      if (!target) return send(res, 404, { error: 'Not found' });
      if (target.id === auth.memberId) return send(res, 400, { error: 'You can’t do that to yourself.' });
      if (m === 'DELETE') {
        ws.members = ws.members.filter((x) => x !== target);
        signOutMember(ws, target.id);
      } else if (c === 'reset' && m === 'POST') {
        target.salt = target.hash = null;
        signOutMember(ws, target.id);
      } else if (m === 'PATCH') {
        const { role } = await readJson(req);
        if (role === 'owner' || role === 'member') target.role = role;
      } else return send(res, 405, { error: 'Method not allowed' });
    }
    save();
    broadcast(ws.id, { type: 'workspace' });
    return send(res, 200, publicWorkspace(ws, auth.memberId));
  }

  if (a === 'invite' && m === 'POST') {
    if (auth.role !== 'owner') return send(res, 403, { error: 'Only team owners can do that.' });
    ws.inviteCode = newInviteCode();
    save();
    broadcast(ws.id, { type: 'workspace' });
    return send(res, 200, publicWorkspace(ws, auth.memberId));
  }

  if (a === 'workspace' && m === 'PATCH') {
    const body = await readJson(req);
    if (body.expireHours !== undefined) ws.settings.expireHours = Math.max(0, Number(body.expireHours) || 0);
    save();
    broadcast(ws.id, { type: 'workspace' });
    return send(res, 200, publicWorkspace(ws, auth.memberId));
  }

  if (a === 'stacks') {
    if (m === 'POST' && !b) {
      const { name } = await readJson(req);
      const n = String(name || '').trim().slice(0, 40);
      if (!n) return send(res, 400, { error: 'Name required' });
      const stack = { id: rid(8), name: n };
      ws.stacks.push(stack);
    } else if (m === 'PATCH' && b) {
      const { name } = await readJson(req);
      const s = ws.stacks.find((x) => x.id === b);
      if (s && String(name || '').trim()) s.name = String(name).trim().slice(0, 40);
    } else if (m === 'DELETE' && b) {
      if (ws.stacks.find((x) => x.id === b)?.campaignId) return send(res, 400, { error: 'This stack belongs to a campaign. Delete the campaign instead.' });
      ws.stacks = ws.stacks.filter((x) => x.id !== b);
      for (const it of Object.values(db.items)) {
        if (it.wsId === ws.id && it.stackId === b) {
          it.stackId = null;
          broadcast(ws.id, { type: 'item:update', item: publicItem(it) });
        }
      }
    } else return send(res, 405, { error: 'Method not allowed' });
    save();
    broadcast(ws.id, { type: 'workspace' });
    return send(res, 200, publicWorkspace(ws, auth.memberId));
  }

  if (a === 'channels') {
    if (m === 'POST' && !b) {
      const { name, folderId } = await readJson(req);
      ws.channels.push({ id: rid(8), name: channelName(ws, name), folderId: validChatFolder(ws, folderId) });
    } else if (m === 'PATCH' && b) {
      const body = await readJson(req);
      const ch = ws.channels.find((x) => x.id === b);
      if (!ch) return send(res, 404, { error: 'Not found' });
      if (body.name !== undefined) ch.name = channelName(ws, body.name, ch.id);
      if (body.folderId !== undefined) ch.folderId = validChatFolder(ws, body.folderId);
    } else if (m === 'DELETE' && b) {
      if (ws.channels.find((x) => x.id === b)?.campaignId) return send(res, 400, { error: 'This feed belongs to a campaign. Delete the campaign instead.' });
      ws.channels = ws.channels.filter((x) => x.id !== b);
      for (const it of Object.values(db.items)) if (it.wsId === ws.id && it.channelId === b) deleteItem(it.id);
    } else return send(res, 405, { error: 'Method not allowed' });
    save();
    broadcast(ws.id, { type: 'workspace' });
    return send(res, 200, publicWorkspace(ws, auth.memberId));
  }

  if (a === 'chat-folders') {
    if (m === 'POST' && !b) {
      const { name } = await readJson(req);
      const n = String(name || '').trim().slice(0, 40);
      if (!n) return send(res, 400, { error: 'Name required' });
      ws.chatFolders.push({ id: rid(8), name: n });
    } else if (m === 'PATCH' && b) {
      const { name } = await readJson(req);
      const f = ws.chatFolders.find((x) => x.id === b);
      if (f && String(name || '').trim()) f.name = String(name).trim().slice(0, 40);
    } else if (m === 'DELETE' && b) {
      ws.chatFolders = ws.chatFolders.filter((x) => x.id !== b);
      for (const ch of ws.channels) if (ch.folderId === b) ch.folderId = null;
    } else return send(res, 405, { error: 'Method not allowed' });
    save();
    broadcast(ws.id, { type: 'workspace' });
    return send(res, 200, publicWorkspace(ws, auth.memberId));
  }

  if (a === 'items') {
    if (m === 'POST' && !b) {
      const { type, text, stackId, channelId, parentId } = await readJson(req, 300_000);
      if (!['text', 'message'].includes(type)) return send(res, 400, { error: 'Bad type' });
      const t = String(text || '').slice(0, 200_000);
      if (!t.trim()) return send(res, 400, { error: 'Empty' });
      // A reply lives in its parent's thread and feed. Threads are one level deep.
      const parent = parentId ? db.items[parentId] : null;
      if (parentId && (type !== 'message' || !parent || parent.wsId !== ws.id || parent.type !== 'message' || parent.parentId || !canSee(auth, 'item', parent))) {
        return send(res, 400, { error: 'That thread is gone' });
      }
      const where = parent ? { parentId: parent.id, channelId: parent.channelId || null } : { stackId: validStack(ws, stackId, auth.memberId), channelId: validChannel(ws, channelId, auth.memberId) };
      if (!parent && channelId && !where.channelId) return send(res, 404, { error: 'Feed not found' });
      const item = addItem(baseItem(auth, { type, text: t, ...where }));
      if (type === 'message') pinLinked(ws, t);
      return send(res, 200, publicItem(item));
    }
    const it = b && db.items[b];
    if (!it || it.wsId !== ws.id || !canSee(auth, 'item', it)) return send(res, 404, { error: 'Not found' });
    // Messages: only the author edits; the author or an owner deletes.
    const own = it.memberId ? it.memberId === auth.memberId : it.deviceId === auth.deviceId;
    if (c === 'react' && m === 'POST' && it.type === 'message') {
      const emoji = String((await readJson(req)).emoji || '').trim();
      if (!emoji || emoji.length > 16) return send(res, 400, { error: 'Bad emoji' });
      const r = (it.reactions ||= {});
      const who = r[emoji] || [];
      r[emoji] = who.includes(auth.memberId) ? who.filter((x) => x !== auth.memberId) : [...who, auth.memberId];
      if (!r[emoji].length) delete r[emoji];
      if (Object.keys(r).length > 40) return send(res, 400, { error: 'Too many reactions' });
      save();
      broadcast(ws.id, { type: 'item:update', item: publicItem(it) });
      return send(res, 200, publicItem(it));
    }
    if (c === 'share' && (it.type === 'file' || it.type === 'folder')) {
      if (m === 'POST') {
        const { hours } = await readJson(req);
        const h = Number(hours) > 0 ? Math.min(Number(hours), 24 * 365) : null;
        it.share = { token: crypto.randomBytes(18).toString('base64url'), createdAt: Date.now(), expiresAt: h ? Date.now() + h * 3600_000 : null, by: auth.member };
        it.pinned = true; // auto-clear must not break the link
      } else if (m === 'DELETE') it.share = null;
      else return send(res, 405, { error: 'Method not allowed' });
      save();
      broadcast(ws.id, { type: 'item:update', item: publicItem(it) });
      return send(res, 200, publicItem(it));
    }
    if (c) return send(res, 404, { error: 'Not found' });
    if (m === 'PATCH') {
      const body = await readJson(req, 300_000);
      if (body.text !== undefined) {
        if (it.type !== 'message' || !own) return send(res, 403, { error: 'You can only edit your own messages.' });
        const t = String(body.text).slice(0, 200_000);
        if (!t.trim()) return send(res, 400, { error: 'Empty' });
        if (t !== it.text) {
          it.text = t;
          it.editedAt = Date.now();
          pinLinked(ws, t);
        }
      }
      if (body.pinned !== undefined) it.pinned = !!body.pinned;
      if (body.stackId !== undefined) it.stackId = validStack(ws, body.stackId, auth.memberId);
      if (body.name !== undefined && (it.type === 'file' || it.type === 'folder')) {
        const name = String(body.name).trim().replace(/[\/\\]/g, '_').slice(0, 255);
        if (!name) return send(res, 400, { error: 'Name required' });
        it.name = name;
      }
      save();
      broadcast(ws.id, { type: 'item:update', item: publicItem(it) });
      return send(res, 200, publicItem(it));
    }
    if (m === 'DELETE') {
      if (it.type === 'message' && !own && auth.role !== 'owner') return send(res, 403, { error: 'You can only delete your own messages.' });
      deleteItem(it.id);
      return send(res, 200, { ok: true });
    }
  }

  if (a === 'clear' && m === 'POST') {
    for (const it of Object.values(db.items)) if (it.wsId === ws.id && !it.pinned && canSee(auth, 'item', it)) deleteItem(it.id);
    return send(res, 200, { ok: true });
  }

  // Big files: POST /uploads to open a session, PUT chunks at ?offset=, GET to ask how far it got, POST done.
  if (a === 'uploads') {
    if (m === 'POST' && !b) {
      const body = await readJson(req);
      const size = Math.floor(Number(body.size));
      if (!Number.isFinite(size) || size < 0) return send(res, 400, { error: 'Bad size' });
      let target;
      if (body.folder) {
        const folder = db.items[body.folder];
        if (!folder || folder.wsId !== ws.id || folder.type !== 'folder' || folder.status !== 'uploading') return send(res, 404, { error: 'Folder not found' });
        target = { folder: folder.id, relPath: cleanRel(body.relPath), mtime: Number(body.mtime) || Date.now() };
      } else {
        target = { name: cleanName(body.name), type: String(body.type || '').slice(0, 200), stackId: validStack(ws, body.stackId, auth.memberId), channelId: validChannel(ws, body.channelId, auth.memberId) };
      }
      const up = { id: rid(), wsId: ws.id, size, received: 0, crc: 0, touched: Date.now(), ...target };
      await fsp.writeFile(partPath(up), '');
      db.uploads[up.id] = up;
      save();
      return send(res, 200, { id: up.id, offset: 0 });
    }
    const up = b && db.uploads[b];
    if (!up || up.wsId !== ws.id) {
      req.resume();
      return send(res, 404, { error: 'Upload expired, try again' });
    }
    if (m === 'GET' && !c) return send(res, 200, { offset: up.received, size: up.size });
    if (m === 'PUT' && !c) {
      if (Number(url.searchParams.get('offset')) !== up.received) {
        req.resume();
        return send(res, 409, { error: 'Wrong offset', offset: up.received });
      }
      // Cut off whatever an interrupted chunk left behind, then append this one.
      await fsp.truncate(partPath(up), up.received);
      let n = 0;
      let crc = up.crc;
      req.on('data', (chunk) => {
        n += chunk.length;
        crc = zlib.crc32(chunk, crc);
      });
      try {
        await pipeline(req, fs.createWriteStream(partPath(up), { flags: 'a' }));
      } catch {
        return send(res, 400, { error: 'Chunk interrupted', offset: up.received });
      }
      if (up.received + n > up.size) {
        await fsp.truncate(partPath(up), up.received);
        return send(res, 400, { error: 'More data than expected', offset: up.received });
      }
      up.received += n;
      up.crc = crc;
      up.touched = Date.now();
      save();
      return send(res, 200, { offset: up.received });
    }
    if (c === 'done' && m === 'POST') {
      if (up.received !== up.size) return send(res, 409, { error: 'Upload incomplete', offset: up.received });
      const id = rid();
      if (up.folder) {
        const folder = db.items[up.folder];
        if (!folder || folder.status !== 'uploading') {
          dropUpload(up);
          return send(res, 404, { error: 'Folder not found' });
        }
        await fsp.rename(partPath(up), path.join(FILES_DIR, id));
        delete db.uploads[up.id];
        folder.files.push({ fid: id, relPath: up.relPath, size: up.size, crc: up.crc, mtime: up.mtime });
        folder.size = folder.files.reduce((t, f) => t + f.size, 0);
        save();
        return send(res, 200, { ok: true });
      }
      await fsp.rename(partPath(up), path.join(FILES_DIR, id));
      delete db.uploads[up.id];
      const item = addItem({
        ...baseItem(auth, { type: 'file', name: up.name, size: up.size, mime: mimeFor(up.name, up.type) }),
        id,
        stackId: validStack(ws, up.stackId, auth.memberId),
        channelId: validChannel(ws, up.channelId, auth.memberId),
      });
      return send(res, 200, publicItem(item));
    }
    if (m === 'DELETE' && !c) {
      dropUpload(up);
      return send(res, 200, { ok: true });
    }
  }

  // Single file: PUT raw body. Folder file: PUT with ?folder=<id>&relPath=...
  if (a === 'upload' && (m === 'PUT' || m === 'POST')) {
    const folderId = url.searchParams.get('folder');
    if (folderId) {
      const folder = db.items[folderId];
      if (!folder || folder.wsId !== ws.id || folder.type !== 'folder' || folder.status !== 'uploading') {
        return send(res, 404, { error: 'Folder not found' });
      }
      const relPath = cleanRel(url.searchParams.get('relPath'));
      const fid = rid();
      const { size, crc } = await receiveUpload(req, path.join(FILES_DIR, fid));
      folder.files.push({ fid, relPath, size, crc, mtime: Number(url.searchParams.get('mtime')) || Date.now() });
      folder.size = folder.files.reduce((n, f) => n + f.size, 0);
      save();
      return send(res, 200, { ok: true });
    }
    const name = cleanName(url.searchParams.get('name'));
    const id = rid();
    const { size } = await receiveUpload(req, path.join(FILES_DIR, id));
    const item = addItem({
      ...baseItem(auth, { type: 'file', name, size, mime: mimeFor(name, url.searchParams.get('type')) }),
      id,
      stackId: validStack(ws, url.searchParams.get('stackId'), auth.memberId),
      channelId: validChannel(ws, url.searchParams.get('channelId'), auth.memberId),
    });
    return send(res, 200, publicItem(item));
  }

  if (a === 'folders') {
    if (m === 'POST' && !b) {
      const { name, stackId, channelId } = await readJson(req);
      const item = addItem(
        baseItem(auth, {
          type: 'folder',
          name: String(name || 'Folder').replace(/[\/\\]/g, '_').slice(0, 255),
          size: 0,
          files: [],
          status: 'uploading',
          stackId: validStack(ws, stackId, auth.memberId),
          channelId: validChannel(ws, channelId, auth.memberId),
        })
      );
      return send(res, 200, { id: item.id });
    }
    const folder = b && db.items[b];
    if (!folder || folder.wsId !== ws.id || folder.type !== 'folder' || !canSee(auth, 'item', folder)) return send(res, 404, { error: 'Not found' });
    if (c === 'done' && m === 'POST') {
      folder.status = 'ready';
      folder.createdAt = Date.now();
      save();
      broadcast(ws.id, { type: 'item:add', item: publicItem(folder) });
      return send(res, 200, publicItem(folder));
    }
    if (c === 'zip' && (m === 'GET' || m === 'HEAD')) return sendZip(req, res, folder);
    if (c === 'files' && d !== undefined && (m === 'GET' || m === 'HEAD')) {
      const f = folder.files[Number(d)];
      if (!f) return send(res, 404, { error: 'Not found' });
      const name = path.basename(f.relPath);
      return serveFile(req, res, path.join(FILES_DIR, f.fid), { name, mime: mimeFor(name), download: url.searchParams.has('dl') });
    }
  }

  if (a === 'files' && b && (m === 'GET' || m === 'HEAD')) {
    const it = db.items[b];
    if (!it || it.wsId !== ws.id || it.type !== 'file' || !canSee(auth, 'item', it)) return send(res, 404, { error: 'Not found' });
    return serveFile(req, res, path.join(FILES_DIR, it.id), { name: it.name, mime: it.mime, download: url.searchParams.has('dl') });
  }

  return send(res, 404, { error: 'Unknown endpoint' });
}

function serveStatic(req, res, url) {
  const iconMatch = /^\/(?:icon-(\d+)|apple-touch-icon|favicon)\.png$/.exec(url.pathname);
  if (iconMatch) {
    const size = Math.min(1024, Number(iconMatch[1]) || (url.pathname.includes('apple') ? 180 : 64));
    return send(res, 200, icon(size), { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.join(CLIENT_DIR, rel);
  if (!file.startsWith(CLIENT_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Range');
    if (req.method === 'OPTIONS') return send(res, 204, '');
    try {
      await api(req, res, url);
    } catch (e) {
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
      if (!e.status) console.error(e);
    }
    return;
  }
  if (url.pathname.startsWith('/s/') && (req.method === 'GET' || req.method === 'HEAD')) return serveShare(req, res, url);
  serveStatic(req, res, url);
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const auth = url.pathname === '/ws' && authFrom(req, url);
  if (!auth) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (s) => {
    s.meta = { wsId: auth.wsId, memberId: auth.memberId, member: auth.member, device: auth.device, deviceId: auth.deviceId };
    s.alive = true;
    s.on('pong', () => (s.alive = true));
    if (!sockets.has(auth.wsId)) sockets.set(auth.wsId, new Set());
    sockets.get(auth.wsId).add(s);
    presence(auth.wsId);
    s.on('close', () => {
      sockets.get(auth.wsId)?.delete(s);
      presence(auth.wsId);
    });
  });
});

setInterval(() => {
  for (const set of sockets.values()) {
    for (const s of set) {
      if (!s.alive) s.terminate();
      else {
        s.alive = false;
        s.ping();
      }
    }
  }
}, 30_000);

// Auto-clear expired items and abandoned uploads.
setInterval(() => {
  const now = Date.now();
  for (const it of Object.values(db.items)) {
    const ws = db.workspaces[it.wsId];
    if (!ws) {
      removeItemFiles(it);
      delete db.items[it.id];
      continue;
    }
    if (it.status === 'uploading' && now - it.createdAt > 24 * 3600_000) deleteItem(it.id);
    const h = ws.settings.expireHours;
    if (h > 0 && !it.pinned && it.status === 'ready' && now - it.createdAt > h * 3600_000) deleteItem(it.id);
  }
  for (const it of Object.values(db.items)) {
    if (it.share && !liveShare(it)) {
      it.share = null;
      save();
      broadcast(it.wsId, { type: 'item:update', item: publicItem(it) });
    }
  }
  for (const up of Object.values(db.uploads)) if (now - up.touched > 24 * 3600_000 || !db.workspaces[up.wsId]) dropUpload(up);
}, 60_000);

migratePeople();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Column server running\n`);
  console.log(`  This machine:   http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) if (n.family === 'IPv4' && !n.internal) console.log(`  Other devices:  http://${n.address}:${PORT}`);
  }
  console.log(`\n  Data stored in ${DATA_DIR}\n`);
});
