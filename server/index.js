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
import { providers as calProviders } from './calendar.js';
import { llms, llmError, complete } from './llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4747);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const FILES_DIR = path.join(DATA_DIR, 'files');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const CLIENT_DIR = path.resolve(__dirname, '..', 'client');
// Where browsers reach this server; sign-in providers send people back here.
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

fs.mkdirSync(FILES_DIR, { recursive: true });

// ---------- persistence (a JSON file is plenty for personal/small-team use) ----------
let db = { workspaces: {}, tokens: {}, items: {}, entries: {}, tasks: {}, uploads: {}, campaigns: {}, goals: {}, attempts: {}, lists: {}, templates: {}, calendars: {}, ai: {} };
try {
  db = { ...db, ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
} catch {}
// Agents became smart buttons: the keys people saved for them are their AI keys now; agents' sign-ins go.
// (Old agents and their keys stay in the data file, unused, so going back to them loses nothing.)
for (const [tok, sess] of Object.entries(db.tokens)) if (sess.agentId) delete db.tokens[tok];
for (const [k, keys] of Object.entries(db.agentKeys || {})) db.ai[k] ||= { keys, provider: null, model: null };
for (const ws of Object.values(db.workspaces)) {
  ws.channels ||= [];
  ws.chatFolders ||= [];
  // Feeds became invite-only: everyone already on the team keeps the feeds they had.
  const owner = ws.members?.find((m) => m.role === 'owner');
  for (const ch of ws.channels) {
    if (ch.campaignId || ch.memberIds || !owner) continue;
    ch.ownerId = owner.id;
    ch.memberIds = ws.members.filter((m) => m !== owner).map((m) => m.id);
  }
}

// Writes wait for a 200 ms lull so bursts become one write, but never longer than 2 s behind,
// so steady activity can't hold changes in memory indefinitely.
let saveTimer = null;
let dirtySince = 0;
function writeNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!dirtySince) return;
  dirtySince = 0;
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_PATH);
}
function save() {
  dirtySince ||= Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, Math.max(0, Math.min(200, dirtySince + 2000 - Date.now())));
}
// On shutdown, write anything still waiting.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try {
      writeNow();
    } finally {
      process.exit(0);
    }
  });
}

const rid = (n = 12) => crypto.randomBytes(n).toString('base64url');

// Secrets at rest (calendar tokens, API keys) are sealed with AES-256-GCM. The key is COLUMN_SECRET,
// or a random key kept next to the data on first run. Lose the key and connections need redoing.
const SECRET = (() => {
  if (process.env.COLUMN_SECRET) return crypto.createHash('sha256').update(process.env.COLUMN_SECRET).digest();
  const file = path.join(DATA_DIR, 'secret.key');
  try {
    return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  } catch {
    const key = crypto.randomBytes(32);
    fs.writeFileSync(file, key.toString('hex'), { mode: 0o600 });
    return key;
  }
})();
function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', SECRET, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}
function unseal(str) {
  const b = Buffer.from(str, 'base64url');
  const d = crypto.createDecipheriv('aes-256-gcm', SECRET, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
}
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

// A private campaign's feed and stack are hidden from people outside it, and so is a feed you weren't invited to.
const publicWorkspace = (ws, memberId) => ({
  id: ws.id,
  name: ws.name,
  settings: ws.settings,
  stacks: ws.stacks.filter((x) => seesCampaign(x.campaignId, memberId)),
  channels: ws.channels.filter((x) => seesFeed(x, memberId)),
  chatFolders: ws.chatFolders,
  members: ws.members.map(publicMember),
  inviteCode: ws.inviteCode,
  brand: publicBrand(ws),
});

// ---------- brand & culture: the team's voice, beliefs and look ----------
// Owners set it; everyone sees it. AI drafts follow it, and the logo and accent colour brand the app and share pages.
const BRAND_TEXT = { mission: 1000, values: 3000, tone: 3000, about: 6000 };
const isHex = (v) => /^#[0-9a-f]{6}$/i.test(String(v));
const brandOf = (ws) => ({ mission: '', values: '', tone: '', about: '', colors: [], accent: null, logo: null, ...ws.brand });
const logoPath = (logo) => path.join(FILES_DIR, 'brand-' + logo.id);
const logoUrl = (logo) => logo && `/brand/${logo.id}`;
const publicBrand = (ws) => ({ ...brandOf(ws), logo: logoUrl(ws.brand?.logo) || null });
function applyBrand(ws, body) {
  const b = brandOf(ws);
  for (const [k, max] of Object.entries(BRAND_TEXT)) if (body[k] !== undefined) b[k] = String(body[k] || '').trim().slice(0, max);
  if (body.colors !== undefined) {
    b.colors = (Array.isArray(body.colors) ? body.colors : []).filter((x) => isHex(x?.hex)).slice(0, 8)
      .map((x) => ({ hex: x.hex.toLowerCase(), name: String(x.name || '').trim().slice(0, 30) }));
  }
  if (body.accent !== undefined) b.accent = isHex(body.accent) ? body.accent.toLowerCase() : null;
  ws.brand = b;
}
// Only raster images: an SVG served from this origin could run script.
function imageType(buf) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 6 && buf.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
function serveLogo(req, res, url) {
  const id = url.pathname.slice('/brand/'.length);
  const ws = /^[\w-]{8,40}$/.test(id) && Object.values(db.workspaces).find((x) => x.brand?.logo?.id === id);
  if (!ws) return send(res, 404, 'Not found');
  fs.readFile(logoPath(ws.brand.logo), (err, data) => {
    if (err) return send(res, 404, 'Not found');
    // A new upload gets a new id, so this address never changes content.
    send(res, 200, data, { 'Content-Type': ws.brand.logo.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  });
}
// The short parts go into every AI request.
function brandPrompt(ws) {
  const b = brandOf(ws);
  const lines = [b.mission && `Mission: ${b.mission}`, b.values && `Core values:\n${b.values}`, b.tone && `Tone of voice:\n${b.tone}`, b.about && `What the business does and who it serves:\n${b.about}`].filter(Boolean);
  if (!lines.length) return '';
  return [`\n\nThe team’s brand and culture. Follow it in anything you write or plan for them:`, ...lines].join('\n');
}

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

// The Day became personal: each existing entry goes to whoever made it (by device, then name), else the team owner.
function migrateDay() {
  for (const e of Object.values(db.entries)) {
    if (e.memberId) continue;
    const ws = db.workspaces[e.wsId];
    const byDevice = Object.values(db.tokens).find((x) => x.wsId === e.wsId && x.deviceId && x.deviceId === e.deviceId)?.memberId;
    e.memberId = (ws?.members?.some((m) => m.id === byDevice) && byDevice) || ws?.members?.find((m) => m.nameKey === nameKey(e.by))?.id || ws?.members?.find((m) => m.role === 'owner')?.id || null;
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
const isTextFile = (it) => (it.mime || '').startsWith('text/') || /\.(json|js|ts|css|html|md|csv|tsv|txt|log|py|sh|ya?ml|xml)$/i.test(it.name);
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
  const brand = it && db.workspaces[it.wsId] ? { ...brandOf(db.workspaces[it.wsId]), team: db.workspaces[it.wsId].name } : null;
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
    <a class="dl" href="${it.type === 'folder' ? base + '/zip' : src + '?dl=1'}">Download${it.type === 'folder' ? ' (.zip)' : ''}</a>`, it.name, brand);
}

function sharePage(res, code, body, title = 'Column', brand = null) {
  const top = brand?.logo ? `<img class="brand" src="${logoUrl(brand.logo)}" alt="${escHtml(brand.team)}">` : '';
  const from = brand ? `Shared by ${escHtml(brand.team)} with Column` : 'Shared with Column';
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
.brand{max-height:44px;max-width:180px;border-radius:6px;margin:0 auto 18px}${brand?.accent ? `:root{--accent:${brand.accent}}` : ''}
.dl{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;padding:10px 22px;border-radius:10px}
footer{margin-top:18px;font-size:11.5px;color:var(--muted)}
</style></head><body><main>${top}${body}<footer>${from}</footer></main></body></html>`);
}

// Messages link to things as [[file:<id>]], [[stack:<id>]], [[task:<id>]]. A linked file is pinned so auto-clear never breaks the link.
const LINK_RE = /\[\[(file|stack|task|campaign):([\w-]+)\]\]/g;
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
// A feed is invite-only: its creator and the people they add. A campaign's feed follows the campaign instead.
// #general (no channelId) is the whole team's.
function seesFeed(ch, memberId) {
  if (!ch) return true;
  if (ch.campaignId) return seesCampaign(ch.campaignId, memberId);
  return !ch.memberIds || ch.ownerId === memberId || ch.memberIds.includes(memberId);
}
function feedOfItem(it) {
  const top = it.parentId ? db.items[it.parentId] || it : it;
  return top.channelId ? db.workspaces[it.wsId]?.channels.find((c) => c.id === top.channelId) : null;
}
const managesFeed = (ch, auth) => ch.ownerId === auth.memberId || auth.role === 'owner';
const feedMembers = (ws, ch, ids) => [...new Set(Array.isArray(ids) ? ids : [])].filter((id) => id !== ch.ownerId && ws.members.some((m) => m.id === id));
function validChannel(ws, channelId, memberId) {
  const ch = channelId && ws.channels.find((c) => c.id === channelId);
  return ch && seesFeed(ch, memberId) ? channelId : null;
}
function validChatFolder(ws, folderId) {
  return folderId && ws.chatFolders.some((f) => f.id === folderId) ? folderId : null;
}
function channelName(ws, raw, selfId) {
  const n = String(raw || '').trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').replace(/-{2,}/g, '-').slice(0, 40);
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
  const feed = msg.item && db.items[msg.item.id] ? feedOfItem(db.items[msg.item.id]) : null;
  const data = JSON.stringify(msg);
  for (const s of set) if (s.readyState === 1 && seesCampaign(campaignId, s.meta.memberId) && seesFeed(feed, s.meta.memberId) && seesTemplate(msg.template, s.meta.memberId) && seesEntry(msg.entry, s.meta.memberId) && (!msg.forMember || msg.forMember === s.meta.memberId)) s.send(data);
}

// ---------- campaigns: campaign → goals → tasks, plus logged attempts (each call or email and its outcome) ----------
// Private campaigns, with their goals, tasks, attempts, feed, stack and schedule slots, are only visible to their members.
const OUTCOMES = ['No answer', 'Not interested', 'Interested', 'Booked'];
const METHODS = ['Call', 'Email'];
const labelList = (v, max) => [...new Set((Array.isArray(v) ? v : []).map((o) => String(o).trim().slice(0, 40)).filter(Boolean))].slice(0, max);
function seesCampaign(campaignId, memberId) {
  const c = campaignId && db.campaigns[campaignId];
  return !c || !c.private || c.ownerId === memberId || c.assigneeId === memberId || c.memberIds.includes(memberId);
}
function campaignOf(kind, x) {
  if (!x) return null;
  const ws = db.workspaces[x.wsId];
  if (kind === 'campaign') return x.id;
  if (kind === 'goal' || kind === 'attempt' || kind === 'list') return x.campaignId;
  if (kind === 'task') return x.goalId ? db.goals[x.goalId]?.campaignId || null : null;
  if (kind === 'entry') return x.taskId ? campaignOf('task', db.tasks[x.taskId]) : null;
  if (kind === 'item') {
    const top = x.parentId ? db.items[x.parentId] || x : x;
    return ws?.channels.find((c) => c.id === top.channelId)?.campaignId || ws?.stacks.find((st) => st.id === top.stackId)?.campaignId || null;
  }
  return null;
}
// Each person's Day is their own: entries, and the calendar events pulled into them, are seen only by them.
const seesEntry = (e, memberId) => !e || e.memberId === memberId;
const canSee = (auth, kind, x) => seesCampaign(campaignOf(kind, x), auth.memberId) && (kind !== 'item' || seesFeed(feedOfItem(x), auth.memberId)) && (kind !== 'entry' || seesEntry(x, auth.memberId));
function campaignOfMsg(msg) {
  if (msg.item) return campaignOf('item', db.items[msg.item.id]);
  if (msg.task) return campaignOf('task', msg.task);
  if (msg.entry) return campaignOf('entry', msg.entry);
  if (msg.campaign) return msg.campaign.id;
  if (msg.goal) return msg.goal.campaignId;
  if (msg.attempt) return msg.attempt.campaignId;
  if (msg.list) return msg.list.campaignId;
  return null;
}
// A saved campaign is private when the campaign it came from was.
function seesTemplate(t, memberId) {
  const c = t?.campaign;
  return !c || !c.private || t.ownerId === memberId || t.assigneeId === memberId || c.memberIds.includes(memberId);
}

const publicCampaign = ({ wsId, ...c }) => c;
const publicGoal = ({ wsId, ...g }) => g;
const publicAttempt = ({ wsId, ...x }) => x;
const publicList = ({ wsId, ...l }) => l;
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
    const list = labelList(body.outcomes, 12);
    if (list.length) c.outcomes = list;
  }
  if (body.methods !== undefined) c.methods = labelList(body.methods, 8);
  // The one person responsible for it, like a work order.
  if (body.assigneeId !== undefined) c.assigneeId = body.assigneeId && ws.members.some((m) => m.id === body.assigneeId) ? body.assigneeId : null;
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
  // A count goal counts the campaign's logged attempts, optionally only these outcomes and methods (empty = all).
  if (body.counts !== undefined) g.counts = Array.isArray(body.counts) ? body.counts.filter((o) => c.outcomes.includes(o)) : null;
  if (body.methods !== undefined) g.methods = Array.isArray(body.methods) ? body.methods.filter((o) => (c.methods || []).includes(o)) : null;
  if (body.order !== undefined) g.order = Number(body.order) || 0;
  if (!g.title) throw badRequest('Give the goal a name.');
  return g;
}

// A call list: a spreadsheet of prospects dropped on a campaign. Each logged call can name the row it was for,
// and a row's latest logged outcome is where that prospect stands. The file it came from stays in the campaign's stack.
const LIST_ROWS = 5000;
function applyList(l, body) {
  if (body.name !== undefined) l.name = String(body.name || '').trim().slice(0, 80) || 'List';
  if (body.columns !== undefined) l.columns = (Array.isArray(body.columns) ? body.columns : []).slice(0, 30).map((x, i) => String(x ?? '').trim().slice(0, 60) || `Column ${i + 1}`);
  if (body.rows !== undefined) {
    if (!Array.isArray(body.rows) || body.rows.length > LIST_ROWS) throw badRequest(`A list can have up to ${LIST_ROWS} rows.`);
    // Rows keep their ids across edits so the calls logged against them still point at them.
    const seen = new Set();
    l.rows = body.rows.map((r) => {
      const id = typeof r?.id === 'string' && /^[\w-]{4,20}$/.test(r.id) && !seen.has(r.id) ? r.id : rid(6);
      seen.add(id);
      return { id, cells: l.columns.map((_, i) => String(r?.cells?.[i] ?? '').trim().slice(0, 300)) };
    }).filter((r) => r.cells.some(Boolean));
  }
  if (!l.rows.length) throw badRequest('That list has no rows.');
  return l;
}

// Everything that belongs to a campaign goes with it.
function deleteGoal(g) {
  for (const t of Object.values(db.tasks)) if (t.goalId === g.id) deleteTask(t);
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
      broadcast(t.wsId, { type: 'entry:remove', id: e.id, forMember: e.memberId });
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
  for (const x of Object.values(db.attempts)) if (x.campaignId === c.id) delete db.attempts[x.id];
  for (const l of Object.values(db.lists)) if (l.campaignId === c.id) delete db.lists[l.id];
  for (const it of Object.values(db.items)) if (it.wsId === ws.id && campaignOf('item', it) === c.id) deleteItem(it.id);
  ws.channels = ws.channels.filter((x) => x.campaignId !== c.id);
  ws.stacks = ws.stacks.filter((x) => x.campaignId !== c.id);
  delete db.campaigns[c.id];
  broadcast(ws.id, { type: 'campaign:remove', id: c.id });
  broadcast(ws.id, { type: 'workspace' });
}

// A campaign gets its own feed (in a "Campaigns" chat folder) and its own stack for files.
// owner: { memberId, member } of whoever it belongs to. extra: fields set before anyone hears about it.
function createCampaign(ws, owner, body, extra = {}) {
  const c = applyCampaign({ id: rid(), wsId: ws.id, ownerId: owner.memberId, by: owner.member, createdAt: Date.now(), name: '', brief: '', start: null, end: null, color: 'violet', status: 'active', private: false, memberIds: [], assigneeId: null, outcomes: [...OUTCOMES], methods: [...METHODS], lastReportAt: null }, body, ws, owner);
  let folder = ws.chatFolders.find((f) => f.campaigns);
  if (!folder) ws.chatFolders.push((folder = { id: rid(8), name: 'Campaigns', campaigns: true }));
  const ch = { id: rid(8), name: freeChannelName(ws, c.name), folderId: folder.id, campaignId: c.id };
  const st = { id: rid(8), name: c.name.slice(0, 40), campaignId: c.id };
  ws.channels.push(ch);
  ws.stacks.push(st);
  c.channelId = ch.id;
  c.stackId = st.id;
  c.assignedBy = c.assigneeId ? owner.memberId : null;
  Object.assign(c, extra);
  db.campaigns[c.id] = c;
  save();
  broadcast(ws.id, { type: 'campaign', campaign: publicCampaign(c) });
  broadcast(ws.id, { type: 'workspace' });
  return c;
}
// Repeat runs share a name, so their feeds get -2, -3…
function freeChannelName(ws, raw) {
  for (let i = 1; ; i++) {
    try {
      return channelName(ws, i === 1 ? raw : `${String(raw).slice(0, 34)}-${i}`);
    } catch (e) {
      if (e.status !== 409 || i > 500) throw e;
    }
  }
}

// ---------- saved campaigns: a campaign's setup, goals and tasks, run again by hand or on a weekly schedule ----------
// Dates are kept as days from the start, so each run lands on its own day. Each run is a new campaign.
const dayKey = (d) => d.toISOString().slice(0, 10);
const addDays = (key, n) => dayKey(new Date(Date.parse(key + 'T00:00:00Z') + n * 864e5));
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const publicTemplate = ({ wsId, ran, ...t }) => t;

function snapshotCampaign(c) {
  const rel = (key) => (key && c.start ? daysBetween(c.start, key) : null);
  return {
    campaign: { brief: c.brief, color: c.color, outcomes: c.outcomes, methods: c.methods, private: c.private, memberIds: c.memberIds, days: c.start && c.end ? daysBetween(c.start, c.end) : null },
    goals: Object.values(db.goals).filter((g) => g.campaignId === c.id).sort((a, b) => (a.order || 0) - (b.order || 0)).map((g) => ({
      title: g.title, kind: g.kind, target: g.target, counts: g.counts, methods: g.methods || null, order: g.order, dueIn: rel(g.due),
      tasks: Object.values(db.tasks).filter((t) => t.goalId === g.id).sort((a, b) => a.createdAt - b.createdAt).map((t) => ({ text: t.text, priority: t.priority, dueIn: rel(t.due), assigneeId: t.assigneeId || null, report: !!t.report })),
    })),
  };
}

// Weekly slots: each is some weekdays (0 = Sunday) at a time, e.g. Mon/Wed/Fri at 09:00.
function slotList(v) {
  return (Array.isArray(v) ? v : []).slice(0, 30).map((x) => ({
    days: [...new Set((Array.isArray(x?.days) ? x.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(),
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(x?.time)) ? x.time : '09:00',
  })).filter((x) => x.days.length);
}
function validTz(tz) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: String(tz) }).resolvedOptions().timeZone;
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}
// The wall clock in the schedule's time zone: date, weekday and minutes since midnight.
function localNow(tz, now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), min: Number(p.hour) * 60 + Number(p.minute) };
}

function applyTemplate(t, body, ws) {
  if (body.name !== undefined) t.name = String(body.name || '').trim().slice(0, 80);
  if (body.assigneeId !== undefined) t.assigneeId = body.assigneeId && ws.members.some((m) => m.id === body.assigneeId) ? body.assigneeId : null;
  if (body.tz !== undefined) t.tz = validTz(body.tz);
  if (body.slots !== undefined || body.auto !== undefined) {
    if (body.slots !== undefined) t.slots = slotList(body.slots);
    if (body.auto !== undefined) t.auto = !!body.auto;
    t.since = Date.now(); // a slot earlier today doesn't fire just because the schedule was edited
  }
  if (!t.name) throw badRequest('Give it a name.');
  return t;
}

// Makes a new campaign from a saved one. date: its start day; time: set for scheduled runs.
function runTemplate(tpl, { date, time, by }) {
  const ws = db.workspaces[tpl.wsId];
  const ownerM = ws.members.find((m) => m.id === tpl.ownerId) || ws.members.find((m) => m.role === 'owner');
  const owner = { memberId: ownerM.id, member: ownerM.name };
  const label = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const k = tpl.campaign;
  const c = createCampaign(ws, owner, {
    name: `${tpl.name} · ${label}${time ? ' ' + time : ''}`.slice(0, 80), brief: k.brief, color: k.color, outcomes: k.outcomes, methods: k.methods,
    private: k.private, memberIds: k.memberIds, start: date, end: k.days != null ? addDays(date, k.days) : null, assigneeId: tpl.assigneeId,
  }, { templateId: tpl.id, assignedBy: by || null }); // who handed it out: whoever started it, or nobody for a scheduled run
  const due = (n) => (n == null ? null : addDays(date, n));
  for (const sg of tpl.goals) {
    const g = applyGoal({ id: rid(), wsId: ws.id, campaignId: c.id, by: owner.member, createdAt: Date.now(), title: '', due: null, kind: 'tasks', target: 10, counts: null, order: 0 },
      { title: sg.title, kind: sg.kind, target: sg.target, counts: sg.counts, methods: sg.methods, order: sg.order, due: due(sg.dueIn) }, c);
    db.goals[g.id] = g;
    broadcast(ws.id, { type: 'goal', goal: publicGoal(g) });
    for (const st of sg.tasks) {
      const t = applyTask({ id: rid(), wsId: ws.id, by: owner.member, createdAt: Date.now(), text: '', done: false, doneAt: null, due: null, priority: 0, goalId: g.id, assigneeId: null },
        { text: st.text, priority: st.priority, due: due(st.dueIn), assigneeId: st.assigneeId, report: st.report });
      if (t.assigneeId) t.assignedBy = by || null;
      db.tasks[t.id] = t;
      broadcast(ws.id, { type: 'task', task: publicTask(t) });
    }
  }
  tpl.lastRunAt = Date.now();
  save();
  broadcast(ws.id, { type: 'template', template: publicTemplate(tpl) });
  return c;
}

// Fires each slot once, when its time comes in the schedule's time zone. A slot missed by more than 6 hours (server was off) is skipped.
// x: anything with { auto, slots, tz, since, ran }; marks the slots it returns as run.
function dueSlots(x, now) {
  if (!x.auto || !x.slots?.length || !db.workspaces[x.wsId]) return [];
  const L = localNow(x.tz, now);
  const today = x.slots.filter((s) => s.days.includes(L.dow));
  const due = [];
  for (const time of new Set(today.map((s) => s.time))) {
    const [hh, mm] = time.split(':').map(Number);
    const at = now - (L.min - (hh * 60 + mm)) * 60_000;
    const key = `${L.date} ${time}`;
    if (at > now || at < x.since || now - at > 6 * 3600_000 || x.ran.includes(key)) continue;
    x.ran = [...x.ran, key].slice(-60);
    due.push({ date: L.date, time, several: today.length > 1 });
  }
  return due;
}
function runSchedules() {
  const now = Date.now();
  let ran = false;
  for (const tpl of Object.values(db.templates)) {
    for (const slot of dueSlots(tpl, now)) {
      ran = true;
      try {
        runTemplate(tpl, { date: slot.date, time: slot.several ? slot.time : null });
      } catch (e) {
        console.error('Scheduled campaign failed:', e);
      }
    }
  }
  if (ran) save();
}

function presence(wsId) {
  const seen = new Map();
  for (const s of sockets.get(wsId) || []) seen.set(s.meta.deviceId, { deviceId: s.meta.deviceId, device: s.meta.device, member: s.meta.member, memberId: s.meta.memberId });
  broadcast(wsId, { type: 'presence', devices: [...seen.values()] });
}

// ---------- calendars: Google / Outlook, both ways ----------
// Events from the calendars you switch on become entries in your Day that only you see (cal.imported).
// Blocks you add in Column go to the calendar you pick (writeCalId) and stay linked (cal, not imported),
// so an edit or delete on either side follows to the other. Repeating entries and events spanning
// several days stay one-way for now.
const oauthPending = new Map(); // state -> who is connecting
const publicCalendarConn = ({ tokens, wsId, ...x }) => x;
const SYNC_EVERY = 3 * 60_000;
const syncing = new Set();
const pushing = new Map(); // connId -> writes in flight; a pull waits so it doesn't import our own new event

async function oauthCallback(req, res, url) {
  const provider = url.pathname.split('/')[2];
  const p = calProviders[provider];
  const pend = oauthPending.get(url.searchParams.get('state') || '');
  const page = (title, msg) => send(res, 200, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:15px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:90vh;text-align:center"><div><h2>${title}</h2><p>${msg}</p></div></body>`, { 'Content-Type': 'text/html; charset=utf-8' });
  if (!p || !pend || pend.provider !== provider || pend.exp < Date.now()) return page('Link expired', 'Start again from Column → Settings → Calendars.');
  oauthPending.delete(url.searchParams.get('state'));
  if (url.searchParams.get('error')) return page('Not connected', 'Calendar access wasn’t granted. You can close this window.');
  const ws = db.workspaces[pend.wsId];
  if (!ws?.members.some((m) => m.id === pend.memberId)) return page('Not connected', 'You’re no longer on that team.');
  const tok = await p.exchange(url.searchParams.get('code'), `${PUBLIC_URL}/oauth/${provider}/callback`);
  if (!tok.refresh) return page('Not connected', `${p.name} didn’t allow offline access. Try connecting again.`);
  const account = await p.account(tok.access);
  const cals = await p.calendars(tok.access);
  // Reconnecting the same account keeps its settings and links.
  let conn = Object.values(db.calendars).find((x) => x.wsId === ws.id && x.memberId === pend.memberId && x.provider === provider && x.account === account);
  if (!conn) {
    const primary = cals.find((x) => x.primary) || cals[0];
    conn = { id: rid(), wsId: ws.id, memberId: pend.memberId, provider, account, tz: pend.tz, calendars: [], writeCalId: primary?.canWrite ? primary.id : null, createdAt: Date.now(), lastSync: 0, error: null };
    db.calendars[conn.id] = conn;
  }
  const was = new Map(conn.calendars.map((x) => [x.id, x.on]));
  conn.calendars = cals.map((x) => ({ ...x, on: was.has(x.id) ? was.get(x.id) : x.primary }));
  conn.tokens = seal(tok);
  conn.error = null;
  conn.lastSync = 0;
  save();
  broadcast(ws.id, { type: 'calendars', forMember: pend.memberId });
  syncCalendar(conn).catch(() => {});
  return page(`${p.name} connected`, `${account} is linked to Column. You can close this window.`);
}

async function calToken(conn) {
  let tok = unseal(conn.tokens);
  if (Date.now() > tok.expires) {
    tok = await calProviders[conn.provider].refresh(tok);
    conn.tokens = seal(tok);
    save();
  }
  return tok.access;
}
function calFailed(conn, e) {
  conn.error = e.auth ? 'Sign-in expired. Reconnect this calendar.' : 'Couldn’t reach the calendar: ' + String(e.message || e).slice(0, 200);
  if (!e.auth) console.error(`Calendar ${conn.provider} ${conn.id}:`, e.message);
  save();
  broadcast(conn.wsId, { type: 'calendars', forMember: conn.memberId });
}

// An event as Day entries: one per day it touches (most are one). Times are minutes in the calendar's zone.
function eventPieces(ev, tz) {
  const out = [];
  if (ev.allDay) {
    for (let d = ev.start; d < ev.end && out.length < 14; d = addDays(d, 1)) out.push({ date: d, start: null, end: null });
    if (!out.length) out.push({ date: ev.start, start: null, end: null });
  } else {
    const a = localNow(tz, ev.start.getTime());
    const z = localNow(tz, ev.end.getTime());
    if (a.date === z.date || (z.min === 0 && addDays(a.date, 1) === z.date)) out.push({ date: a.date, start: a.min, end: z.date === a.date ? Math.max(z.min, a.min) : 1440 });
    else {
      out.push({ date: a.date, start: a.min, end: 1440 });
      for (let d = addDays(a.date, 1); d < z.date && out.length < 14; d = addDays(d, 1)) out.push({ date: d, start: null, end: null });
      if (z.min > 0) out.push({ date: z.date, start: 0, end: z.min });
    }
  }
  return out.map((x) => ({ ...x, text: ev.title.slice(0, 5000) }));
}
// A Column entry as an event, in wall-clock time.
function entryEvent(e, tz) {
  const t = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
  if (e.start == null) return { title: e.text, allDay: true, start: e.date, end: addDays(e.date, 1), tz };
  const end = e.end != null && e.end > e.start ? e.end : Math.min(1440, e.start + 30);
  return { title: e.text, allDay: false, start: `${e.date}T${t(e.start)}`, end: end >= 1440 ? `${addDays(e.date, 1)}T00:00:00` : `${e.date}T${t(end)}`, tz };
}
function setEntry(e, fields) {
  const changed = Object.entries(fields).some(([k, v]) => e[k] !== v);
  if (!changed) return;
  Object.assign(e, fields);
  broadcast(e.wsId, { type: 'entry', entry: publicEntry(e) });
}
function dropEntry(e) {
  delete db.entries[e.id];
  broadcast(e.wsId, { type: 'entry:remove', id: e.id, forMember: e.memberId });
}

async function syncCalendar(conn) {
  if (syncing.has(conn.id) || pushing.get(conn.id) || !db.calendars[conn.id]) return;
  const ws = db.workspaces[conn.wsId];
  const who = ws?.members.find((m) => m.id === conn.memberId);
  if (!who) return disconnectCalendar(conn); // they left the team
  syncing.add(conn.id);
  try {
    const p = calProviders[conn.provider];
    const token = await calToken(conn);
    const today = localNow(conn.tz, Date.now()).date;
    const fromKey = addDays(today, -7);
    const toKey = addDays(today, 60);
    const from = new Date(Date.parse(fromKey + 'T00:00:00Z') - 14 * 3600_000);
    const to = new Date(Date.parse(toKey + 'T00:00:00Z') + 14 * 3600_000);
    const inWindow = (e) => e.date >= fromKey && e.date < toKey;
    for (const cal of conn.calendars) {
      const linked = Object.values(db.entries).filter((e) => e.cal?.connId === conn.id && e.cal.calId === cal.id);
      if (!cal.on) for (const e of linked) if (e.cal.imported) dropEntry(e);
      if (!cal.on && cal.id !== conn.writeCalId && !linked.some((e) => !e.cal.imported)) continue;
      const events = await p.events(token, cal.id, from, to);
      const byId = new Map(events.map((ev) => [ev.id, ev]));
      // Blocks made in Column: follow edits and deletes made in the calendar.
      const ours = new Set();
      for (const e of linked.filter((x) => !x.cal.imported)) {
        ours.add(e.cal.eventId);
        const ev = byId.get(e.cal.eventId);
        if (!ev) {
          if (inWindow(e)) dropEntry(e);
          continue;
        }
        const [piece] = eventPieces(ev, conn.tz);
        if (!e.repeat) setEntry(e, piece);
      }
      if (!cal.on) continue;
      // Everything else in the calendar: your private copies.
      const have = new Map(linked.filter((x) => x.cal.imported).map((e) => [`${e.cal.eventId}|${e.date}`, e]));
      for (const ev of events) {
        if (ours.has(ev.id)) continue;
        const pieces = eventPieces(ev, conn.tz);
        for (const piece of pieces) {
          const key = `${ev.id}|${piece.date}`;
          const e = have.get(key);
          have.delete(key);
          if (e) setEntry(e, { ...piece, cal: e.cal.span === pieces.length > 1 ? e.cal : { ...e.cal, span: pieces.length > 1 } });
          else {
            const n = { id: rid(), wsId: ws.id, memberId: conn.memberId, by: who?.name || '', createdAt: Date.now(), ...piece, done: false, color: null, taskId: null, cal: { connId: conn.id, calId: cal.id, eventId: ev.id, imported: true, span: pieces.length > 1 } };
            db.entries[n.id] = n;
            broadcast(ws.id, { type: 'entry', entry: publicEntry(n) });
          }
        }
      }
      for (const e of have.values()) if (inWindow(e)) dropEntry(e);
    }
    conn.lastSync = Date.now();
    conn.error = null;
    save();
    broadcast(conn.wsId, { type: 'calendars', forMember: conn.memberId });
  } catch (e) {
    calFailed(conn, e);
  } finally {
    syncing.delete(conn.id);
  }
}
function syncAllCalendars() {
  for (const conn of Object.values(db.calendars)) {
    if (conn.error?.startsWith('Sign-in') || Date.now() - (conn.lastSync || 0) < SYNC_EVERY) continue;
    syncCalendar(conn).catch(() => {});
  }
}

// After an entry is saved or deleted in Column, send it to the calendar it's linked to (or, for a new
// block, to its maker's chosen calendar). Runs after the response; failures show on the connection.
async function pushEntry(ref, action) {
  const e = action === 'delete' ? ref : db.entries[ref];
  if (!e || (e.cal?.span)) return;
  let conn = e.cal ? db.calendars[e.cal.connId] : null;
  if (!e.cal) {
    if (action === 'delete' || e.repeat || e.start == null || e.end == null || !e.memberId) return;
    conn = Object.values(db.calendars).find((x) => x.wsId === e.wsId && x.memberId === e.memberId && x.writeCalId && !x.error);
  }
  if (!conn) return;
  if (e.cal && e.repeat && action !== 'delete') return;
  const p = calProviders[conn.provider];
  pushing.set(conn.id, (pushing.get(conn.id) || 0) + 1);
  try {
    const token = await calToken(conn);
    if (action === 'delete') await p.remove(token, e.cal.calId, e.cal.eventId);
    else if (e.cal) await p.update(token, e.cal.calId, e.cal.eventId, entryEvent(e, conn.tz));
    else {
      const eventId = await p.create(token, conn.writeCalId, entryEvent(e, conn.tz));
      const cur = db.entries[e.id];
      if (cur) {
        cur.cal = { connId: conn.id, calId: conn.writeCalId, eventId, imported: false };
        save();
        broadcast(cur.wsId, { type: 'entry', entry: publicEntry(cur) });
      }
    }
  } catch (err) {
    calFailed(conn, err);
  } finally {
    pushing.set(conn.id, pushing.get(conn.id) - 1);
  }
}

// Your private copies go; blocks made in Column stay, just no longer linked.
function disconnectCalendar(conn) {
  for (const e of Object.values(db.entries)) {
    if (e.cal?.connId !== conn.id) continue;
    if (e.cal.imported) dropEntry(e);
    else {
      delete e.cal;
      broadcast(e.wsId, { type: 'entry', entry: publicEntry(e) });
    }
  }
  delete db.calendars[conn.id];
  save();
  broadcast(conn.wsId, { type: 'calendars', forMember: conn.memberId });
}

// ---------- AI: smart buttons on each person's own API key ----------
// Each one drafts something for a person to check (a report, a plan) and changes nothing by itself.
// Keys are stored sealed, per person, and never sent back to the app.
const aiOf = (wsId, memberId) => (db.ai[`${wsId}:${memberId}`] ||= { keys: {}, provider: null, model: null });
function aiState(ws, memberId) {
  const ai = aiOf(ws.id, memberId);
  const use = aiUse(ai);
  return {
    providers: Object.fromEntries(Object.entries(llms).map(([k, p]) => [k, p.name])),
    keys: Object.fromEntries(Object.entries(ai.keys).map(([k, v]) => [k, { last4: v.last4, models: v.models, savedAt: v.savedAt }])),
    provider: use?.provider || null,
    model: use?.model || null,
  };
}
// The provider and model to use: the one picked, else the first with a key.
function aiUse(ai) {
  const provider = ai.keys[ai.provider] ? ai.provider : Object.keys(llms).find((k) => ai.keys[k]);
  if (!provider) return null;
  const models = ai.keys[provider].models;
  return { provider, model: provider === ai.provider && models.some((m) => m.id === ai.model) ? ai.model : llms[provider].pick(models) };
}
async function aiAsk(ws, memberId, system, prompt) {
  const ai = aiOf(ws.id, memberId);
  const use = aiUse(ai);
  if (!use) throw Object.assign(new Error('Add your AI key in Settings → AI to use this.'), { status: 400 });
  try {
    return await complete(llms[use.provider], { key: unseal(ai.keys[use.provider].sealed).key, model: use.model, system: system + brandPrompt(ws), prompt });
  } catch (e) {
    console.error('AI request failed:', e.message);
    throw Object.assign(new Error(llmError(e)), { status: 502 });
  }
}
const clipText = (s, n) => (String(s || '').length > n ? String(s).slice(0, n) + '…' : String(s || ''));
// The first JSON object in a reply, which may come wrapped in prose or a code fence.
function replyJson(text) {
  const i = text.indexOf('{');
  const j = text.lastIndexOf('}');
  try {
    return JSON.parse(text.slice(i, j + 1));
  } catch {
    throw Object.assign(new Error('The AI’s answer didn’t come back in a usable shape. Try again.'), { status: 502 });
  }
}
const fmtDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// The report's "Findings": what the log says since the last report, in the team's voice.
async function aiReport(ws, auth, c, body) {
  const since = Number(body.since) || 0;
  const log = Object.values(db.attempts).filter((x) => x.campaignId === c.id && x.at > since).sort((a, b) => a.at - b.at);
  const done = Object.values(db.tasks).filter((t) => campaignOf('task', t) === c.id && t.done && (t.doneAt || 0) > since);
  const open = Object.values(db.tasks).filter((t) => campaignOf('task', t) === c.id && !t.done);
  const prompt = [
    `Campaign: ${c.name}`,
    c.brief ? `Brief:\n${clipText(c.brief, 4000)}` : 'No brief.',
    `Numbers (already shown above the findings, don't repeat them as a list):\n${(Array.isArray(body.stats) ? body.stats : []).map((x) => '- ' + clipText(x, 300)).join('\n')}`,
    log.length ? `Calls and emails logged since the last report (oldest first):\n${log.slice(-300).map((x) => `- ${fmtDay(x.at)} ${x.method || ''} ${x.contact || '(no name)'}: ${x.outcome}${x.note ? ` · ${clipText(x.note, 300)}` : ''} (${x.by})`).join('\n')}` : 'Nothing logged since the last report.',
    done.length ? `Tasks finished:\n${done.slice(-50).map((t) => '- ' + clipText(t.text, 200)).join('\n')}` : '',
    open.length ? `Tasks still open:\n${open.slice(0, 50).map((t) => `- ${clipText(t.text, 200)}${t.due ? ` (due ${t.due})` : ''}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  const text = await aiAsk(ws, auth.memberId,
    'You write the findings section of a short progress report for a sales or outreach campaign, posted to the team’s chat. ' +
    'From the log, say what’s working, what isn’t, notable conversations or patterns in the notes, and the next steps. ' +
    'Use only what the data shows: never invent names, numbers or results. If little was logged, say so plainly and keep it short. ' +
    'Write 3 to 6 short lines of plain text, no headings and no markdown, at most a few dashes for a list. Reply with the findings only.',
    prompt);
  return { text: text.trim() };
}

// Goals and tasks drafted from the brief, for the person to tick and add.
async function aiPlan(ws, auth, c, body) {
  if (!c.brief.trim()) throw badRequest('Write a brief first: the plan is made from it.');
  const today = isDay(body.today) ? body.today : fmtDay(Date.now());
  const goals = Object.values(db.goals).filter((g) => g.campaignId === c.id);
  const tasks = Object.values(db.tasks).filter((t) => campaignOf('task', t) === c.id);
  const lists = Object.values(db.lists).filter((l) => l.campaignId === c.id);
  const prompt = [
    `Campaign: ${c.name}`,
    `Today: ${today}. Runs ${c.start || 'from now'} to ${c.end || 'no set end'}.`,
    `Brief:\n${clipText(c.brief, 8000)}`,
    `Ways to reach people it logs: ${(c.methods || []).join(', ') || 'none set'}. Outcomes it logs: ${c.outcomes.join(', ')}.`,
    lists.length ? `Call lists: ${lists.map((l) => `${l.name} (${l.rows.length} prospects)`).join(', ')}.` : '',
    goals.length ? `Goals it already has (don't repeat them):\n${goals.map((g) => `- ${g.title}`).join('\n')}` : '',
    tasks.length ? `Tasks it already has (don't repeat them):\n${tasks.slice(0, 80).map((t) => `- ${clipText(t.text, 150)}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  const text = await aiAsk(ws, auth.memberId,
    'You turn a campaign brief into a practical plan of goals and tasks. A goal is either "tasks" (done when its tasks are) or "count" ' +
    '(a number of logged calls or emails to reach, with a target, optionally only some outcomes or methods). Suggest 2 to 5 goals, ' +
    'each with 1 to 6 concrete tasks a person can do in one sitting, phrased as actions. Give due dates (YYYY-MM-DD) within the campaign’s ' +
    'dates, from today on, when timing matters; otherwise null. Stick to what the brief supports: never invent leads, contacts or facts. ' +
    'Reply with JSON only, in this shape: {"goals":[{"title":"","kind":"tasks"|"count","target":null|number,"outcomes":[],"methods":[],"due":null|"YYYY-MM-DD","tasks":[{"text":"","due":null|"YYYY-MM-DD"}]}]}',
    prompt);
  const day = (v) => (isDay(v) && v >= today && (!c.end || v <= c.end) ? v : null);
  const out = (Array.isArray(replyJson(text).goals) ? replyJson(text).goals : []).slice(0, 6).map((g) => ({
    title: clipText(String(g?.title || '').trim(), 200),
    kind: g?.kind === 'count' ? 'count' : 'tasks',
    target: g?.kind === 'count' ? Math.max(1, Math.min(100_000, Math.round(Number(g.target)) || 10)) : null,
    counts: Array.isArray(g?.outcomes) ? g.outcomes.filter((o) => c.outcomes.includes(o)) : [],
    methods: Array.isArray(g?.methods) ? g.methods.filter((o) => (c.methods || []).includes(o)) : [],
    due: day(g?.due),
    tasks: (Array.isArray(g?.tasks) ? g.tasks : []).slice(0, 8).map((t) => ({ text: clipText(String(t?.text || '').trim(), 300), due: day(t?.due) })).filter((t) => t.text),
  })).filter((g) => g.title);
  if (!out.length) throw Object.assign(new Error('The AI didn’t suggest anything. Add more to the brief and try again.'), { status: 502 });
  return { goals: out };
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
      lists: Object.values(db.lists).filter((l) => l.wsId === ws.id && canSee(auth, 'list', l)).map(publicList),
      templates: Object.values(db.templates).filter((t) => t.wsId === ws.id && seesTemplate(t, auth.memberId)).map(publicTemplate),
      version: clientVersion(),
    });
  }

  if (a === 'entries') {
    if (m === 'POST' && !b) {
      const body = await readJson(req, 50_000);
      const e = applyEntry({ id: rid(), wsId: ws.id, memberId: auth.memberId, by: auth.member, deviceId: auth.deviceId, createdAt: Date.now(), text: '', date: null, start: null, end: null, done: false, color: null, taskId: null }, body);
      db.entries[e.id] = e;
      save();
      broadcast(ws.id, { type: 'entry', entry: publicEntry(e) });
      pushEntry(e.id, 'save');
      return send(res, 200, publicEntry(e));
    }
    const e = b && db.entries[b];
    if (!e || e.wsId !== ws.id || !canSee(auth, 'entry', e)) return send(res, 404, { error: 'Not found' });
    if (m === 'PATCH') {
      const next = applyEntry({ ...e }, await readJson(req, 50_000));
      db.entries[e.id] = next;
      save();
      broadcast(ws.id, { type: 'entry', entry: publicEntry(next) });
      pushEntry(e.id, 'save');
      return send(res, 200, publicEntry(next));
    }
    if (m === 'DELETE') {
      delete db.entries[e.id];
      save();
      broadcast(ws.id, { type: 'entry:remove', id: e.id, forMember: e.memberId });
      pushEntry(e, 'delete');
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  if (a === 'tasks') {
    if (m === 'POST' && !b) {
      const t = applyTask({ id: rid(), wsId: ws.id, by: auth.member, createdAt: Date.now(), text: '', done: false, doneAt: null, due: null, priority: 0, goalId: null, assigneeId: null }, await readJson(req, 50_000));
      if (!canSee(auth, 'task', t)) return send(res, 404, { error: 'Goal not found' });
      if (t.assigneeId) t.assignedBy = auth.memberId;
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
      // Who handed it over, so the new assignee can be told.
      if (next.assigneeId !== t.assigneeId) next.assignedBy = next.assigneeId ? auth.memberId : null;
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
      const c = createCampaign(ws, auth, await readJson(req, 100_000));
      return send(res, 200, publicCampaign(c));
    }
    const c = b && db.campaigns[b];
    if (!c || c.wsId !== ws.id || !canSee(auth, 'campaign', c)) return send(res, 404, { error: 'Not found' });
    if (m === 'PATCH') {
      const body = await readJson(req, 100_000);
      const was = JSON.stringify([c.private, c.memberIds, c.assigneeId]);
      const next = applyCampaign({ ...c, memberIds: [...c.memberIds] }, body, ws, auth);
      if (next.assigneeId !== c.assigneeId) next.assignedBy = next.assigneeId ? auth.memberId : null;
      db.campaigns[c.id] = next;
      if (body.name !== undefined) {
        const st = ws.stacks.find((x) => x.id === c.stackId);
        if (st) st.name = next.name.slice(0, 40);
      }
      save();
      // Who can see it changed: everyone reloads so it appears or disappears cleanly.
      // The campaign itself goes first so a new assignee is told it's theirs.
      if (was !== JSON.stringify([next.private, next.memberIds, next.assigneeId])) {
        broadcast(ws.id, { type: 'campaign', campaign: publicCampaign(next) });
        if (next.private) broadcast(ws.id, { type: 'resync' });
      } else {
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

  // Your own connected calendars. Nobody else on the team sees them or their events.
  if (a === 'calendars') {
    const mine = () => Object.values(db.calendars).filter((x) => x.wsId === ws.id && x.memberId === auth.memberId).map(publicCalendarConn);
    if (m === 'GET' && !b) return send(res, 200, { providers: Object.fromEntries(Object.entries(calProviders).map(([k, p]) => [k, p.configured()])), connections: mine(), redirect: PUBLIC_URL + '/oauth/<provider>/callback' });
    if (m === 'POST' && b === 'connect') {
      const { provider, tz } = await readJson(req);
      const p = calProviders[provider];
      if (!p) return send(res, 400, { error: 'Unknown calendar' });
      if (!p.configured()) return send(res, 400, { error: `${p.name} isn’t set up on this server yet.` });
      const state = rid(18);
      oauthPending.set(state, { wsId: ws.id, memberId: auth.memberId, provider, tz: validTz(tz), exp: Date.now() + 15 * 60_000 });
      return send(res, 200, { url: p.authUrl(`${PUBLIC_URL}/oauth/${provider}/callback`, state) });
    }
    const conn = b && db.calendars[b];
    if (!conn || conn.wsId !== ws.id || conn.memberId !== auth.memberId) return send(res, 404, { error: 'Not found' });
    if (m === 'POST' && c === 'sync') {
      conn.lastSync = 0;
      await syncCalendar(conn);
      return send(res, 200, publicCalendarConn(conn));
    }
    if (m === 'PATCH' && !c) {
      const body = await readJson(req);
      if (body.on && typeof body.on === 'object') for (const cal of conn.calendars) if (body.on[cal.id] !== undefined) cal.on = !!body.on[cal.id];
      if (body.writeCalId !== undefined) conn.writeCalId = conn.calendars.some((x) => x.id === body.writeCalId && x.canWrite) ? body.writeCalId : null;
      if (body.tz !== undefined) conn.tz = validTz(body.tz);
      save();
      await syncCalendar(conn).catch(() => {});
      return send(res, 200, publicCalendarConn(conn));
    }
    if (m === 'DELETE' && !c) {
      disconnectCalendar(conn);
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  // Your own AI key and model, and the smart buttons that use them. Nobody else on the team sees your key.
  if (a === 'ai') {
    const ai = aiOf(ws.id, auth.memberId);
    const body = m === 'GET' || m === 'DELETE' ? {} : await readJson(req, 100_000);
    if (b === 'keys' && c) {
      const p = llms[c];
      if (!p) return send(res, 404, { error: 'Unknown provider' });
      if (m === 'PUT') {
        const key = String(body.key || '').trim();
        if (key.length < 10 || key.length > 400) return send(res, 400, { error: 'That doesn’t look like an API key.' });
        let models;
        try {
          models = await p.models(key);
        } catch (e) {
          return send(res, 400, { error: llmError(e) });
        }
        if (!models.length) return send(res, 400, { error: 'This key can’t use any chat models.' });
        ai.keys[c] = { sealed: seal({ key }), last4: key.slice(-4), models, savedAt: Date.now() };
      } else if (m === 'DELETE') delete ai.keys[c];
      else return send(res, 405, { error: 'Method not allowed' });
      save();
      return send(res, 200, aiState(ws, auth.memberId));
    }
    if (m === 'GET' && !b) return send(res, 200, aiState(ws, auth.memberId));
    if (m === 'PATCH' && !b) {
      if (body.provider !== undefined && ai.keys[body.provider]) {
        ai.provider = body.provider;
        ai.model = llms[body.provider].pick(ai.keys[body.provider].models);
      }
      if (body.model !== undefined && ai.keys[ai.provider]?.models.some((x) => x.id === body.model)) ai.model = body.model;
      save();
      return send(res, 200, aiState(ws, auth.memberId));
    }
    if (m === 'POST' && (b === 'report' || b === 'plan')) {
      const camp = db.campaigns[body.campaignId];
      if (!camp || camp.wsId !== ws.id || !canSee(auth, 'campaign', camp)) return send(res, 404, { error: 'Campaign not found' });
      return send(res, 200, await (b === 'report' ? aiReport : aiPlan)(ws, auth, camp, body));
    }
    return send(res, 404, { error: 'Not found' });
  }

  if (a === 'templates') {
    if (m === 'POST' && !b) {
      const body = await readJson(req, 50_000);
      const c = db.campaigns[body.campaignId];
      if (!c || c.wsId !== ws.id || !canSee(auth, 'campaign', c)) return send(res, 404, { error: 'Campaign not found' });
      const t = applyTemplate({ id: rid(), wsId: ws.id, ownerId: auth.memberId, by: auth.member, createdAt: Date.now(), name: body.name || c.name, assigneeId: c.assigneeId || null, tz: validTz(body.tz), slots: [], auto: false, since: Date.now(), ran: [], lastRunAt: null, ...snapshotCampaign(c) }, body, ws);
      db.templates[t.id] = t;
      save();
      broadcast(ws.id, { type: 'template', template: publicTemplate(t) });
      return send(res, 200, publicTemplate(t));
    }
    const t = b && db.templates[b];
    if (!t || t.wsId !== ws.id || !seesTemplate(t, auth.memberId)) return send(res, 404, { error: 'Not found' });
    if (c === 'run' && m === 'POST') {
      const { date, tz } = await readJson(req);
      const camp = runTemplate(t, { date: isDay(date) ? date : localNow(validTz(tz || t.tz), Date.now()).date, by: auth.memberId });
      return send(res, 200, publicCampaign(camp));
    }
    if (c) return send(res, 404, { error: 'Not found' });
    if (t.ownerId !== auth.memberId && auth.role !== 'owner') return send(res, 403, { error: 'Only the person who saved it can change it.' });
    if (m === 'PATCH') {
      const was = t.assigneeId;
      applyTemplate(t, await readJson(req, 50_000), ws);
      save();
      if (was !== t.assigneeId && t.campaign.private) broadcast(ws.id, { type: 'resync' });
      else broadcast(ws.id, { type: 'template', template: publicTemplate(t) });
      return send(res, 200, publicTemplate(t));
    }
    if (m === 'DELETE') {
      delete db.templates[t.id];
      save();
      broadcast(ws.id, { type: 'template:remove', id: t.id });
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
      const c = db.campaigns[body.campaignId];
      if (!c || c.wsId !== ws.id || !canSee(auth, 'campaign', c)) return send(res, 404, { error: 'Campaign not found' });
      const outcome = String(body.outcome || '');
      if (!c.outcomes.includes(outcome)) return send(res, 400, { error: 'Pick an outcome' });
      const method = (c.methods || []).includes(body.method) ? body.method : null;
      const t = body.taskId && db.tasks[body.taskId];
      const l = body.listId && db.lists[body.listId];
      const row = l && l.campaignId === c.id && l.rows.find((r) => r.id === body.rowId);
      const x = {
        id: rid(), wsId: ws.id, campaignId: c.id, method, taskId: t && campaignOf('task', t) === c.id ? t.id : null,
        listId: row ? l.id : null, rowId: row ? row.id : null,
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

  if (a === 'lists') {
    if (m === 'POST' && !b) {
      const body = await readJson(req, 8_000_000);
      const c = db.campaigns[body.campaignId];
      if (!c || c.wsId !== ws.id || !canSee(auth, 'campaign', c)) return send(res, 404, { error: 'Campaign not found' });
      const file = body.itemId && db.items[body.itemId];
      const l = applyList({ id: rid(), wsId: ws.id, campaignId: c.id, itemId: file && file.wsId === ws.id ? file.id : null, by: auth.member, createdAt: Date.now(), name: '', columns: [], rows: [] }, { name: 'List', ...body });
      db.lists[l.id] = l;
      save();
      broadcast(ws.id, { type: 'list', list: publicList(l) });
      return send(res, 200, publicList(l));
    }
    const l = b && db.lists[b];
    if (!l || l.wsId !== ws.id || !canSee(auth, 'list', l)) return send(res, 404, { error: 'Not found' });
    if (m === 'PATCH') {
      const next = applyList({ ...l }, await readJson(req, 8_000_000));
      db.lists[l.id] = next;
      save();
      broadcast(ws.id, { type: 'list', list: publicList(next) });
      return send(res, 200, publicList(next));
    }
    // Calls logged against it stay in the log.
    if (m === 'DELETE') {
      delete db.lists[l.id];
      save();
      broadcast(ws.id, { type: 'list:remove', id: l.id });
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

  if (a === 'brand') {
    if (auth.role !== 'owner') return send(res, 403, { error: 'Only team owners can change the brand.' });
    const old = ws.brand?.logo;
    if (m === 'PATCH' && !b) {
      applyBrand(ws, await readJson(req, 100_000));
    } else if (b === 'logo' && m === 'PUT') {
      const { data } = await readJson(req, 3_000_000);
      const buf = Buffer.from(String(data || '').replace(/^data:[^,]*,/, ''), 'base64');
      const mime = imageType(buf);
      if (!mime) return send(res, 400, { error: 'Use a PNG, JPEG, GIF or WebP image.' });
      if (buf.length > 2_000_000) return send(res, 400, { error: 'Keep the logo under 2 MB.' });
      const logo = { id: rid(), mime };
      await fsp.writeFile(logoPath(logo), buf);
      applyBrand(ws, {});
      ws.brand.logo = logo;
    } else if (b === 'logo' && m === 'DELETE') {
      applyBrand(ws, {});
      ws.brand.logo = null;
    } else return send(res, 405, { error: 'Method not allowed' });
    if (old && old.id !== ws.brand.logo?.id) fsp.rm(logoPath(old), { force: true }).catch(() => {});
    ws.brand.updatedAt = Date.now();
    ws.brand.updatedBy = auth.memberId;
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
    let resync = false;
    if (m === 'POST' && !b) {
      const { name, folderId, memberIds } = await readJson(req);
      const ch = { id: rid(8), name: channelName(ws, name), folderId: validChatFolder(ws, folderId), ownerId: auth.memberId };
      ch.memberIds = feedMembers(ws, ch, memberIds);
      ws.channels.push(ch);
    } else {
      const ch = b && ws.channels.find((x) => x.id === b);
      if (!ch || !seesFeed(ch, auth.memberId)) return send(res, 404, { error: 'Not found' });
      if (m === 'POST' && c === 'leave') {
        if (ch.campaignId || !ch.memberIds?.includes(auth.memberId)) return send(res, 400, { error: 'You can’t leave this feed.' });
        ch.memberIds = ch.memberIds.filter((id) => id !== auth.memberId);
        resync = true;
      } else if (m === 'PATCH' && !c) {
        const body = await readJson(req);
        if (body.name !== undefined) ch.name = channelName(ws, body.name, ch.id);
        if (body.folderId !== undefined) ch.folderId = validChatFolder(ws, body.folderId);
        if (body.memberIds !== undefined) {
          if (ch.campaignId) return send(res, 400, { error: 'This feed follows its campaign. Change who sees the campaign instead.' });
          if (!managesFeed(ch, auth)) return send(res, 403, { error: 'Only the person who made this feed can change who’s in it.' });
          ch.memberIds = feedMembers(ws, ch, body.memberIds);
          resync = true;
        }
      } else if (m === 'DELETE' && !c) {
        if (ch.campaignId) return send(res, 400, { error: 'This feed belongs to a campaign. Delete the campaign instead.' });
        if (ch.ownerId && !managesFeed(ch, auth)) return send(res, 403, { error: 'Only the person who made this feed can delete it.' });
        ws.channels = ws.channels.filter((x) => x.id !== b);
        for (const it of Object.values(db.items)) if (it.wsId === ws.id && it.channelId === b) deleteItem(it.id);
      } else return send(res, 405, { error: 'Method not allowed' });
    }
    save();
    // Who's in a feed changed: everyone reloads so it and its messages appear or disappear cleanly.
    broadcast(ws.id, { type: resync ? 'resync' : 'workspace' });
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

  // Saves an edited text file in place.
  if (a === 'files' && b && m === 'PUT') {
    const it = db.items[b];
    if (!it || it.wsId !== ws.id || it.type !== 'file' || !canSee(auth, 'item', it)) return send(res, 404, { error: 'Not found' });
    if (!isTextFile(it)) return send(res, 400, { error: 'Only text files can be edited here.' });
    const tmp = path.join(FILES_DIR, '.edit-' + rid());
    const { size } = await receiveUpload(req, tmp);
    if (size > 5_000_000) {
      await fsp.rm(tmp, { force: true });
      return send(res, 413, { error: 'Too big to edit here' });
    }
    await fsp.rename(tmp, path.join(FILES_DIR, it.id));
    Object.assign(it, { size, editedAt: Date.now(), editedBy: auth.member });
    save();
    broadcast(ws.id, { type: 'item:update', item: publicItem(it) });
    return send(res, 200, publicItem(it));
  }

  if (a === 'files' && b && (m === 'GET' || m === 'HEAD')) {
    const it = db.items[b];
    if (!it || it.wsId !== ws.id || it.type !== 'file' || !canSee(auth, 'item', it)) return send(res, 404, { error: 'Not found' });
    return serveFile(req, res, path.join(FILES_DIR, it.id), { name: it.name, mime: it.mime, download: url.searchParams.has('dl') });
  }

  return send(res, 404, { error: 'Unknown endpoint' });
}

// A fingerprint of the app's files. Open windows compare it when they reconnect and reload when it changes,
// so devices that stay open (like the desktop app in the tray) pick up updates.
let clientVer = { key: '', hash: '' };
function clientVersion() {
  const files = ['index.html', 'app.js', 'style.css'].map((f) => path.join(CLIENT_DIR, f));
  const key = files.map((f) => fs.statSync(f, { throwIfNoEntry: false })?.mtimeMs || 0).join(':');
  if (key !== clientVer.key) {
    const h = crypto.createHash('sha256');
    for (const f of files) h.update(fs.existsSync(f) ? fs.readFileSync(f) : '');
    clientVer = { key, hash: h.digest('hex').slice(0, 12) };
  }
  return clientVer.hash;
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
  if (url.pathname.startsWith('/brand/') && (req.method === 'GET' || req.method === 'HEAD')) return serveLogo(req, res, url);
  if (url.pathname.startsWith('/oauth/')) return oauthCallback(req, res, url).catch((e) => {
    console.error(e);
    if (!res.headersSent) send(res, 500, 'Something went wrong connecting your calendar.');
  });
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

setInterval(runSchedules, 30_000);
setInterval(syncAllCalendars, 30_000);

migratePeople();
migrateDay();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Column server running\n`);
  console.log(`  This machine:   http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) if (n.family === 'IPv4' && !n.internal) console.log(`  Other devices:  http://${n.address}:${PORT}`);
  }
  console.log(`\n  Data stored in ${DATA_DIR}\n`);
});
