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
import { PdfError, stampPdf, addCertificate, pageCount, writeDoc } from './pdf.js';

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
let db = { workspaces: {}, tokens: {}, items: {}, entries: {}, tasks: {}, uploads: {}, campaigns: {}, goals: {}, attempts: {}, lists: {}, templates: {}, calendars: {}, ai: {}, pss: {}, sends: {}, bills: {}, meetings: {}, money: {}, budgets: {}, plans: {}, sidekick: {}, vaults: {}, vaultItems: {}, signs: {}, signatures: {} };
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
let importing = false; // while another Column's data is being unpacked over this one, nothing is written
let dirtySince = 0;
function writeNow() {
  clearTimeout(saveTimer);
  if (importing) return;
  saveTimer = null;
  if (!dirtySince) return;
  dirtySince = 0;
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_PATH);
}
function save() {
  if (importing) return;
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
  '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm',
};
const mimeFor = (name, given) => (given && given !== 'application/octet-stream' ? given : MIME[path.extname(name).toLowerCase()] || 'application/octet-stream');

function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isObj ? 'application/json' : 'text/plain', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}

// ---------- sign-in limits: wrong passwords and invite codes, counted per address and per name ----------
// Behind a host's proxy (TRUST_PROXY=1) the address is the first one in X-Forwarded-For.
const LOGIN_TRIES = 10;
const LOGIN_WINDOW = 15 * 60_000;
const loginFails = new Map(); // key -> { n, since }
const clientIp = (req) => (process.env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || '?';
function loginBlocked(keys) {
  const now = Date.now();
  return keys.some((k) => {
    const f = loginFails.get(k);
    if (f && now - f.since > LOGIN_WINDOW) loginFails.delete(k);
    return f && now - f.since <= LOGIN_WINDOW && f.n >= LOGIN_TRIES;
  });
}
function loginFailed(keys) {
  const now = Date.now();
  for (const k of keys) {
    const f = loginFails.get(k);
    if (!f || now - f.since > LOGIN_WINDOW) loginFails.set(k, { n: 1, since: now });
    else f.n++;
  }
  if (loginFails.size > 50_000) loginFails.clear();
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
  // A call list worked as this task. It has to belong to the goal's campaign.
  if (body.listId !== undefined || body.goalId !== undefined) {
    const l = db.lists[body.listId !== undefined ? body.listId : t.listId];
    t.listId = l && l.campaignId === db.goals[t.goalId]?.campaignId ? l.id : null;
  }
  // A checklist task works one run of it.
  if (body.runId !== undefined || body.listId !== undefined || body.goalId !== undefined) {
    const id = body.runId !== undefined ? body.runId : t.runId;
    t.runId = id && db.lists[t.listId]?.runs?.some((r) => r.id === id) ? id : null;
  }
  if (body.assigneeId !== undefined) t.assigneeId = body.assigneeId && db.workspaces[t.wsId]?.members.some((m) => m.id === body.assigneeId) ? body.assigneeId : null;
  if (body.report !== undefined) t.report = !!body.report;
  // Files attached to it, like the finished list a "Provide a list of…" task asked for. Items in the same team.
  if (body.files !== undefined) t.files = [...new Set((Array.isArray(body.files) ? body.files : []).filter((id) => typeof id === 'string' && db.items[id]?.wsId === t.wsId))].slice(0, 20);
  // Where it sits when dragged: order within its goal, dayOrder on the Tasks list. null = not placed by hand.
  for (const k of ['order', 'dayOrder']) if (body[k] !== undefined) t[k] = body[k] === null || !Number.isFinite(Number(body[k])) ? null : Number(body[k]);
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
const isWordFile = (it) => /\.docx$/i.test(it.name) || it.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
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

const isOwnerId = (wsId, memberId) => db.workspaces[wsId]?.members.some((m) => m.id === memberId && m.role === 'owner');
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
  for (const s of set) if (s.readyState === 1 && seesCampaign(campaignId, s.meta.memberId) && seesFeed(feed, s.meta.memberId) && seesTemplate(msg.template, s.meta.memberId) && seesEntry(msg.entry, s.meta.memberId) && (!msg.forMember || msg.forMember === s.meta.memberId) && (!msg.forOwners || isOwnerId(wsId, s.meta.memberId)) && (!msg.bill || seesBill(wsId, msg.bill, s.meta.memberId))) s.send(data);
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

// What's been logged in Finance against a campaign: spent (its cost) and brought in. Totals only, so a
// personal entry tagged to a team campaign shows in the sum but not on its own.
function campMoney(id) {
  let spent = 0, earned = 0;
  for (const x of Object.values(db.money)) if (x.campaignId === id) x.kind === 'in' ? (earned += x.amount) : (spent += x.amount);
  return spent || earned ? { spent, earned } : null;
}
const publicCampaign = ({ wsId, ...c }) => ({ ...c, money: campMoney(c.id) });
// A money goal fills from Finance: money in tagged to it, less money out.
const goalSaved = (id) => Object.values(db.money).reduce((n, x) => (x.goalId === id ? n + (x.kind === 'in' ? x.amount : -x.amount) : n), 0);
const publicGoal = ({ wsId, ...g }) => (g.kind === 'money' ? { ...g, saved: goalSaved(g.id) } : g);
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
  // "In order": goals and tasks are worked one at a time, top to bottom. Owners set it, and can skip or unlock steps.
  if (body.inOrder !== undefined && !!body.inOrder !== !!c.inOrder) {
    if (!passesSteps(c, auth)) throw Object.assign(new Error('Only an owner can change whether this campaign is worked in order.'), { status: 403 });
    c.inOrder = !!body.inOrder;
  }
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
  if (body.kind !== undefined) g.kind = ['count', 'money'].includes(body.kind) ? body.kind : 'tasks';
  // A money goal's target is in whole dollars.
  if (body.target !== undefined) g.target = Math.max(1, Math.min(g.kind === 'money' ? 100_000_000 : 1_000_000, Math.round(Number(String(body.target).replace(/[$,\s]/g, ''))) || 1));
  // A count goal counts the campaign's logged attempts, optionally only these outcomes and methods (empty = all).
  if (body.counts !== undefined) g.counts = Array.isArray(body.counts) ? body.counts.filter((o) => c.outcomes.includes(o)) : null;
  if (body.methods !== undefined) g.methods = Array.isArray(body.methods) ? body.methods.filter((o) => (c.methods || []).includes(o)) : null;
  if (body.order !== undefined) g.order = Number(body.order) || 0;
  if (!g.title) throw badRequest('Give the goal a name.');
  return g;
}

// ----- campaigns worked in order -----
// Goals open one at a time, top to bottom: the next waits until the one above is met. Inside a goal each task
// waits for the one above it. An owner can skip a step (it stops holding up the rest) or unlock one early.
// The client works this out the same way to grey out what's waiting.
const passesSteps = (c, auth) => !c.ownerId || c.ownerId === auth.memberId || auth.role === 'owner';
const goalsInOrder = (c) => Object.values(db.goals).filter((g) => g.campaignId === c.id).sort((a, b) => (a.order || 0) - (b.order || 0) || a.createdAt - b.createdAt);
const placed = (base) => (a, b) => (a.order != null) !== (b.order != null) ? (a.order != null ? -1 : 1) : a.order != null && a.order !== b.order ? a.order - b.order : base(a, b);
const tasksInOrder = (g) => Object.values(db.tasks).filter((t) => t.goalId === g.id)
  .sort(placed((a, b) => ((a.due || '9') < (b.due || '9') ? -1 : (a.due || '9') > (b.due || '9') ? 1 : a.createdAt - b.createdAt)));
function goalMet(g) {
  if (g.skipped) return true;
  if (g.kind === 'count') {
    const n = Object.values(db.attempts).filter((x) => x.campaignId === g.campaignId && (!g.counts?.length || g.counts.includes(x.outcome)) && (!g.methods?.length || g.methods.includes(x.method))).length;
    return n >= g.target;
  }
  return tasksInOrder(g).every((t) => t.done || t.skipped);
}
// The goal it's waiting on, or null when it's open.
function goalWaitsOn(g) {
  const c = db.campaigns[g.campaignId];
  if (!c?.inOrder || g.unlocked) return null;
  for (const x of goalsInOrder(c)) {
    if (x.id === g.id) return null;
    if (!goalMet(x)) return x;
  }
  return null;
}
// What a task is waiting on (a goal or a task), or null when it can be done.
function taskWaitsOn(t) {
  const g = db.goals[t.goalId];
  if (!g || !db.campaigns[g.campaignId]?.inOrder || t.done || t.unlocked) return null;
  const wg = goalWaitsOn(g);
  if (wg) return wg;
  for (const x of tasksInOrder(g)) {
    if (x.id === t.id) return null;
    if (!x.done && !x.skipped) return x;
  }
  return null;
}

// A call list: a spreadsheet of prospects dropped on a campaign. Each logged call can name the row it was for,
// and a row's latest logged outcome is where that prospect stands. The file it came from stays in the campaign's stack.
// A list is a file made interactive. Its kind says how it's worked:
//   calls      prospects to call or email; where each stands comes from the log
//   tracker    rows moved through stages (hiring, invoices, orders…)
//   reference  a lookup sheet: price list, catalogue, inventory (quantities can be changed)
//   checklist  steps run many times, each run with its own ticks (agenda: with timings)
//   form       questions answered for each call or email in the log
const LIST_ROWS = 5000;
const LIST_KINDS = ['calls', 'tracker', 'reference', 'checklist', 'form'];
const RUNS = 300;
const cleanText = (v, n) => String(v ?? '').trim().slice(0, n);
function applyList(l, body) {
  if (body.name !== undefined) l.name = String(body.name || '').trim().slice(0, 80) || 'List';
  if (body.kind !== undefined) l.kind = LIST_KINDS.includes(body.kind) ? body.kind : 'calls';
  l.kind ||= 'calls';
  if (body.agenda !== undefined) l.agenda = !!body.agenda;
  if (body.stages !== undefined) {
    const seen = new Set();
    l.stages = (Array.isArray(body.stages) ? body.stages : []).map((x) => cleanText(x, 40)).filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase())).slice(0, 12);
  }
  if (l.kind === 'tracker' && !(l.stages || []).length) l.stages = ['To do', 'In progress', 'Done'];
  if (l.kind === 'checklist') l.runs ||= [];
  if (body.columns !== undefined) l.columns = (Array.isArray(body.columns) ? body.columns : []).slice(0, 30).map((x, i) => String(x ?? '').trim().slice(0, 60) || `Column ${i + 1}`);
  if (body.rows !== undefined) {
    if (!Array.isArray(body.rows) || body.rows.length > LIST_ROWS) throw badRequest(`A list can have up to ${LIST_ROWS} rows.`);
    // Rows keep their ids across edits so the calls logged against them still point at them.
    const seen = new Set();
    const was = new Map((l.rows || []).map((r) => [r.id, r]));
    l.rows = body.rows.map((r) => {
      const id = typeof r?.id === 'string' && /^[\w-]{4,20}$/.test(r.id) && !seen.has(r.id) ? r.id : rid(6);
      seen.add(id);
      const row = { id, cells: l.columns.map((_, i) => String(r?.cells?.[i] ?? '').trim().slice(0, 300)) };
      // Steps keep their section and planned minutes; a tracker row keeps its stage and note through edits.
      if (r?.section) row.section = cleanText(r.section, 120);
      if (Number(r?.mins) > 0) row.mins = Math.min(600, Math.round(Number(r.mins)));
      const old = was.get(id);
      for (const k of ['stage', 'note', 'by', 'at']) if (old?.[k] !== undefined) row[k] = old[k];
      if (r?.stage !== undefined) row.stage = cleanText(r.stage, 40) || null;
      return row;
    }).filter((r) => r.cells.some(Boolean));
  }
  if (!l.rows.length && !l.live) throw badRequest('That list has no rows.');
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
    campaign: { brief: c.brief, color: c.color, outcomes: c.outcomes, methods: c.methods, private: c.private, memberIds: c.memberIds, inOrder: !!c.inOrder, days: c.start && c.end ? daysBetween(c.start, c.end) : null },
    goals: Object.values(db.goals).filter((g) => g.campaignId === c.id).sort((a, b) => (a.order || 0) - (b.order || 0)).map((g) => ({
      title: g.title, kind: g.kind, target: g.target, counts: g.counts, methods: g.methods || null, order: g.order, dueIn: rel(g.due),
      tasks: Object.values(db.tasks).filter((t) => t.goalId === g.id).sort((a, b) => a.createdAt - b.createdAt).map((t) => ({ text: t.text, order: t.order ?? null, priority: t.priority, dueIn: rel(t.due), assigneeId: t.assigneeId || null, report: !!t.report })),
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
    private: k.private, memberIds: k.memberIds, inOrder: !!k.inOrder, start: date, end: k.days != null ? addDays(date, k.days) : null, assigneeId: tpl.assigneeId,
  }, { templateId: tpl.id, assignedBy: by || null }); // who handed it out: whoever started it, or nobody for a scheduled run
  const due = (n) => (n == null ? null : addDays(date, n));
  for (const sg of tpl.goals) {
    const g = applyGoal({ id: rid(), wsId: ws.id, campaignId: c.id, by: owner.member, createdAt: Date.now(), title: '', due: null, kind: 'tasks', target: 10, counts: null, order: 0 },
      { title: sg.title, kind: sg.kind, target: sg.target, counts: sg.counts, methods: sg.methods, order: sg.order, due: due(sg.dueIn) }, c);
    db.goals[g.id] = g;
    broadcast(ws.id, { type: 'goal', goal: publicGoal(g) });
    for (const st of sg.tasks) {
      const t = applyTask({ id: rid(), wsId: ws.id, by: owner.member, createdAt: Date.now(), text: '', done: false, doneAt: null, due: null, priority: 0, goalId: g.id, assigneeId: null },
        { text: st.text, order: st.order ?? null, priority: st.priority, due: due(st.dueIn), assigneeId: st.assigneeId, report: st.report });
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
  const tok = await p.exchange(url.searchParams.get('code'), `${PUBLIC_URL}/oauth/${provider}/callback`, pend.mail);
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
  conn.mail = !!tok.mail;
  conn.error = null;
  conn.lastSync = 0;
  save();
  broadcast(ws.id, { type: 'calendars', forMember: pend.memberId });
  broadcast(ws.id, { type: 'mail', forMember: pend.memberId });
  syncCalendar(conn).catch(() => {});
  if (pend.mail && !conn.mail) return page(`${p.name} connected`, `${account} is linked, but sending email wasn’t allowed. Your Microsoft admin may need to approve it.`);
  return page(`${p.name} connected`, `${account} is linked to Column${pend.mail ? ' and can send campaign emails' : ''}. You can close this window.`);
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

// ---------- PSS admin: the business site's leads and do-not-contact list ----------
// With a key an owner makes in PSS (Settings → Marketing → Column), stored sealed. Only owners
// see the contacts. A live list puts the leads that match a filter on a campaign as a call list, kept in
// step with PSS: everyone in that campaign sees its rows, which is the owner's call when they make one.
// Calls and emails logged against a lead go back to PSS, onto that lead's timeline (pushPss).
const PSS_EVERY = 15 * 60_000;
const PSS_PAGES = 200;
const PSS_STAGES = ['new', 'contacted', 'visit_booked', 'quoted', 'approved', 'signed', 'sold', 'measure', 'ordered', 'installed', 'completed', 'lost'];
const LIVE_COLS = ['Name', 'Phone', 'Email', 'Address', 'City', 'Stage', 'Source'];
const LIVE_DAYS = [0, 30, 90, 180, 365];
const pssBusy = new Map();
const stageLabel = (s) => { const t = String(s || '').replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
// The site's address: https, or http on this machine for testing.
function pssUrl(v) {
  let u;
  try {
    u = new URL(String(v || '').trim());
  } catch {
    return null;
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  return u.protocol === 'https:' || (local && u.protocol === 'http:') ? u.origin : null;
}
async function pssGet(url, key, route, body) {
  let r;
  try {
    r = await fetch(url + route, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw badRequest(`Couldn’t reach ${new URL(url).host}. Check the address.`);
  }
  if (r.status === 401) throw badRequest('PSS didn’t accept the key. Make a new one in PSS admin → Settings → Marketing → Column.');
  if (r.status === 404) throw badRequest('That site doesn’t have the Column connection yet. Check the address, or deploy PSS first.');
  if (!r.ok) throw badRequest(`PSS answered with an error (${r.status}). Try again in a minute.`);
  return r.json();
}
const pssLead = (x) => ({
  id: cleanText(x?.id, 40), name: cleanText(x?.name, 200), email: cleanText(x?.email, 200), phone: cleanText(x?.phone, 60),
  address: cleanText(x?.address, 300), city: cleanText(x?.city, 80), source: cleanText(x?.source, 80), stage: cleanText(x?.stage, 40),
  lostReason: cleanText(x?.lost_reason, 300), assignedTo: cleanText(x?.assigned_to, 80),
  createdAt: Date.parse(x?.created_at) || null, stageChangedAt: Date.parse(x?.stage_changed_at) || null,
  dne: !!x?.do_not_email, unsub: /^https:\/\/\S+$/.test(x?.unsubscribe_url || '') ? x.unsubscribe_url.slice(0, 300) : null,
});
function pssState(ws) {
  const p = db.pss[ws.id];
  if (!p) return { connected: false };
  return {
    connected: true, url: p.url, last4: p.last4, by: p.by, at: p.at, syncedAt: p.syncedAt || null, error: p.error || null, count: p.leads?.length || 0, dne: (p.leads || []).filter((x) => x.dne).length, syncing: pssBusy.has(ws.id),
    pushedAt: p.pushedAt || null, pushError: p.pushError || null, waiting: toPush(ws.id).length,
  };
}
// A live list's filter. Empty means any.
function applyLive(v) {
  const pick = (a, ok) => [...new Set((Array.isArray(a) ? a : []).map((x) => cleanText(x, 80)).filter(ok))].slice(0, 40);
  return {
    stages: pick(v?.stages, (x) => PSS_STAGES.includes(x)),
    cities: pick(v?.cities, Boolean),
    sources: pick(v?.sources, Boolean),
    days: LIVE_DAYS.includes(Number(v?.days)) ? Number(v.days) : 0,
    need: ['phone', 'email'].includes(v?.need) ? v.need : null,
  };
}
function liveMatch(f, x, now) {
  return (!f.stages.length || f.stages.includes(x.stage))
    && (!f.cities.length || f.cities.some((c) => sameText(c, x.city)))
    && (!f.sources.length || f.sources.some((s) => sameText(s, x.source)))
    && (!f.days || (x.createdAt || 0) >= now - f.days * 864e5)
    && (f.need !== 'phone' || !!x.phone)
    && (f.need !== 'email' || (!!x.email && !x.dne));
}
// Rows are keyed by the lead, so calls logged against one, and its tracker stage, stay with it across syncs.
const leadRowId = (id) => 'L' + crypto.createHash('sha256').update(id).digest('base64url').slice(0, 11);
function fillLive(l) {
  const p = db.pss[l.wsId];
  if (!p) return l;
  const now = Date.now();
  const was = new Map((l.rows || []).map((r) => [r.id, r]));
  l.columns = LIVE_COLS;
  l.rows = (p.leads || []).filter((x) => liveMatch(l.live, x, now)).slice(0, LIST_ROWS).map((x) => {
    const row = { id: leadRowId(x.id), leadId: x.id, cells: [x.name, x.phone, x.email, x.address, x.city, stageLabel(x.stage), x.source] };
    if (x.dne) row.dne = true;
    const old = was.get(row.id);
    for (const k of ['stage', 'note', 'by', 'at']) if (old?.[k] !== undefined) row[k] = old[k];
    return row;
  });
  l.syncedAt = p.syncedAt || null;
  return l;
}
// Reads every lead, a page at a time, then the do-not-contact list, and refreshes the live lists.
async function syncPss(ws) {
  const p = db.pss[ws.id];
  if (!p) return;
  if (pssBusy.has(ws.id)) return pssBusy.get(ws.id);
  const run = (async () => {
    try {
      const key = unseal(p.sealed).key;
      const leads = [];
      let after = null;
      for (let i = 0; ; i++) {
        if (i >= PSS_PAGES) throw new Error('PSS has more leads than Column can hold.');
        const page = await pssGet(p.url, key, '/api/column/leads' + (after ? '?after=' + encodeURIComponent(after) : ''));
        leads.push(...(Array.isArray(page.leads) ? page.leads : []).map(pssLead).filter((x) => x.id));
        if (!page.next) break;
        after = page.next;
      }
      const mail = await pssGet(p.url, key, '/api/column/email');
      if (db.pss[ws.id] !== p) return;
      p.leads = leads;
      p.dne = (Array.isArray(mail.do_not_email) ? mail.do_not_email : []).map((x) => cleanText(x, 200).toLowerCase()).filter(Boolean);
      // Someone who unsubscribed by address but whose lead says otherwise is still not emailed.
      const no = new Set(p.dne);
      for (const x of leads) if (no.has(x.email.toLowerCase())) x.dne = true;
      p.syncedAt = Date.now();
      p.error = null;
      pushPss(ws);
      for (const l of Object.values(db.lists)) {
        if (l.wsId !== ws.id || !l.live) continue;
        fillLive(l);
        broadcast(ws.id, { type: 'list', list: publicList(l) });
      }
    } catch (e) {
      if (db.pss[ws.id] === p) p.error = e.message;
      console.error('PSS sync failed:', e.message);
    } finally {
      p.tried = Date.now();
      pssBusy.delete(ws.id);
      save();
      broadcast(ws.id, { type: 'pss', forOwners: true });
    }
  })();
  pssBusy.set(ws.id, run);
  broadcast(ws.id, { type: 'pss', forOwners: true });
  return run;
}
function syncAllPss() {
  for (const [wsId, p] of Object.entries(db.pss)) {
    const ws = db.workspaces[wsId];
    if (!ws) delete db.pss[wsId];
    else if (Date.now() - (p.tried || 0) >= PSS_EVERY) syncPss(ws);
  }
}

// Calls and emails logged against a PSS lead that PSS doesn't have yet, oldest first. Each is marked once
// PSS has it (or once PSS says the lead is gone), so it's sent once; PSS ignores a repeat anyway.
const PSS_BATCH = 100;
const pssPushing = new Set();
const pssSoon = new Map();
const toPush = (wsId) => Object.values(db.attempts).filter((x) => x.wsId === wsId && x.leadId && !x.pss).sort((a, b) => a.at - b.at);
async function pushPss(ws) {
  const p = db.pss[ws.id];
  if (!p || pssPushing.has(ws.id)) return;
  pssPushing.add(ws.id);
  try {
    const key = unseal(p.sealed).key;
    for (let left = toPush(ws.id); left.length; left = toPush(ws.id)) {
      const batch = left.slice(0, PSS_BATCH);
      const r = await pssGet(p.url, key, '/api/column/events', {
        events: batch.map((x) => ({
          id: x.id, lead_id: x.leadId, method: x.method === 'Email' ? 'email' : 'call', outcome: x.outcome, note: x.note || '',
          campaign: (db.campaigns[x.campaignId]?.name || '').slice(0, 120), by: x.by || 'Column', at: new Date(x.at).toISOString(),
        })),
      });
      const done = new Map([...(r.saved || []).map((id) => [id, 'sent']), ...(r.missing || []).map((id) => [id, 'gone'])]);
      for (const x of batch) if (done.has(x.id) && db.attempts[x.id]) db.attempts[x.id].pss = done.get(x.id);
      if (db.pss[ws.id] !== p) return;
      p.pushedAt = Date.now();
      p.pushError = null;
      save();
      if (!batch.some((x) => done.has(x.id))) break;
    }
  } catch (e) {
    if (db.pss[ws.id] === p) p.pushError = /doesn’t have the Column connection/.test(e.message) ? 'PSS needs its latest update before calls can show up there.' : e.message;
    console.error('PSS push failed:', e.message);
    save();
  } finally {
    pssPushing.delete(ws.id);
    broadcast(ws.id, { type: 'pss', forOwners: true });
  }
}
// Soon after a call is logged, in case a few come in together.
function pushPssSoon(wsId) {
  if (!db.pss[wsId] || pssSoon.has(wsId)) return;
  pssSoon.set(wsId, setTimeout(() => {
    pssSoon.delete(wsId);
    if (db.workspaces[wsId]) pushPss(db.workspaces[wsId]);
  }, 5_000));
}

// ---------- bills: what's owed and when, personal or business ----------
// A personal bill is only its owner's. A business bill is also seen, and paid, by the team's owners.
// Each bill keeps its next due date; paying it moves that on by its repeat. Autopay bills mark
// themselves paid the day after they're due.
const BILL_REPEATS = ['once', 'weekly', 'monthly', 'quarterly', 'yearly'];
const BILL_HISTORY = 60;
const seesBill = (wsId, b, memberId) => b.memberId === memberId || (b.scope === 'business' && isOwnerId(wsId, memberId));
const publicBill = ({ wsId, ...b }) => b;
const validDay = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) ? v : null);
// The next due date after `due`, keeping the original day of the month (the 31st stays the 31st, or the month's last day).
function nextDue(b, due) {
  if (b.repeat === 'weekly') return addDays(due, 7);
  const months = { monthly: 1, quarterly: 3, yearly: 12 }[b.repeat];
  if (!months) return null;
  const [y, mo] = due.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return dayKey(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(b.dom || Number(due.slice(8)), last))));
}
function applyBill(b, body) {
  if (body.name !== undefined) b.name = cleanText(body.name, 80);
  if (!b.name) throw badRequest('Give the bill a name.');
  if (body.amount !== undefined) {
    const n = Math.round(Number(String(body.amount).replace(/[$,\s]/g, '')) * 100);
    if (!Number.isFinite(n) || n < 0 || n > 1e11) throw badRequest('Enter the amount, like 142.50');
    b.amount = n;
  }
  if (body.repeat !== undefined) b.repeat = BILL_REPEATS.includes(body.repeat) ? body.repeat : 'monthly';
  if (body.due !== undefined) {
    b.due = validDay(body.due);
    if (!b.due) throw badRequest('Pick the date it’s due.');
    b.dom = Number(b.due.slice(8));
    b.done = false;
  }
  if (body.scope !== undefined) b.scope = body.scope === 'business' ? 'business' : 'personal';
  if (body.autopay !== undefined) b.autopay = !!body.autopay;
  if (body.note !== undefined) b.note = cleanText(body.note, 1000);
  if (body.category !== undefined) b.category = cleanText(body.category, 40) || 'Bills';
  if (body.tz !== undefined) b.tz = validTz(body.tz);
  return b;
}
// Pays the bill due now: it goes into the history and the next due date comes up.
function payBill(b, by, auto) {
  // Paid shows in Finance as money out, on the day it was paid (autopay pays on the due date).
  const x = { id: rid(), wsId: b.wsId, memberId: b.memberId, by, createdAt: Date.now(), kind: 'out', amount: b.amount, day: auto ? b.due : localNow(b.tz || validTz(), Date.now()).date, category: b.category || 'Bills', note: b.name, scope: b.scope, campaignId: null, goalId: null, billId: b.id };
  db.money[x.id] = x;
  moneyNews(x);
  b.paid = [{ due: b.due, at: Date.now(), amount: b.amount, by, auto: !!auto, moneyId: x.id }, ...(b.paid || [])].slice(0, BILL_HISTORY);
  const next = nextDue(b, b.due);
  if (next) b.due = next;
  else b.done = true;
}
function billNews(b) {
  broadcast(b.wsId, { type: 'bill', bill: publicBill(b) });
}
function runAutopay() {
  for (const b of Object.values(db.bills)) {
    if (!b.autopay || b.done) continue;
    const today = localNow(b.tz || validTz(), Date.now()).date;
    let n = 0;
    while (!b.done && b.due < today && n++ < 60) payBill(b, 'Autopay', true);
    if (n) {
      save();
      billNews(b);
    }
  }
}

// ---------- finance: money in and out, budgets, and money goals on campaigns ----------
// Entries are seen like bills: personal ones by their owner only, business ones by the team's owners too.
// Tagging one to a campaign counts it as that campaign's cost (out) or earnings (in); tagging it to a money
// goal fills that goal. Budgets are a monthly limit per spending category, personal or business.
const MONEY_IMPORT = 2000;
const publicMoney = ({ wsId, key, ...x }) => x;
const publicBudget = ({ wsId, ...x }) => x;
const cents = (v, what = 'the amount') => {
  const n = Math.round(Number(String(v ?? '').replace(/[$,\s]/g, '')) * 100);
  if (!Number.isFinite(n) || n <= 0 || n > 1e11) throw badRequest(`Enter ${what}, like 142.50`);
  return n;
};
// What changing an entry touches: its goal's progress and its campaign's totals.
function moneyTouches(x, ws) {
  const g = x.goalId && db.goals[x.goalId];
  if (g) broadcast(x.wsId, { type: 'goal', goal: publicGoal(g) });
  const c = x.campaignId && db.campaigns[x.campaignId];
  if (c) broadcast(x.wsId, { type: 'campaign', campaign: publicCampaign(c) });
}
function moneyNews(x) {
  broadcast(x.wsId, { type: 'money', money: publicMoney(x), bill: x });
  moneyTouches(x);
}
function dropMoney(x) {
  delete db.money[x.id];
  broadcast(x.wsId, { type: 'money:remove', id: x.id, bill: x });
  moneyTouches(x);
}
function applyMoney(x, body, auth) {
  if (body.kind !== undefined) x.kind = body.kind === 'in' ? 'in' : 'out';
  if (body.amount !== undefined) x.amount = cents(body.amount);
  if (body.day !== undefined) {
    x.day = validDay(body.day);
    if (!x.day) throw badRequest('Pick the date.');
  }
  if (body.category !== undefined) x.category = cleanText(body.category, 40);
  if (body.note !== undefined) x.note = cleanText(body.note, 200);
  if (body.scope !== undefined) x.scope = body.scope === 'business' && auth.role === 'owner' ? 'business' : 'personal';
  // A money goal brings its campaign with it. Either has to be one you can see.
  if (body.goalId !== undefined || body.campaignId !== undefined) {
    const g = body.goalId && db.goals[body.goalId];
    const c = db.campaigns[g ? g.campaignId : body.campaignId];
    const ok = c && c.wsId === auth.ws.id && canSee(auth, 'campaign', c);
    x.goalId = ok && g?.kind === 'money' ? g.id : null;
    x.campaignId = ok ? c.id : null;
  }
  return x;
}
const newMoney = (auth) => ({ id: rid(), wsId: auth.ws.id, memberId: auth.memberId, by: auth.member, createdAt: Date.now(), kind: 'out', amount: 0, day: null, category: '', note: '', scope: 'personal', campaignId: null, goalId: null, billId: null });
// Rows from a bank statement come in once: the same day, amount and description from the same person is skipped.
const moneyKey = (x) => crypto.createHash('sha256').update([x.memberId, x.scope, x.day, x.kind, x.amount, x.note.toLowerCase()].join('|')).digest('base64url').slice(0, 22);
const sameBudget = (a, b) => a.wsId === b.wsId && a.scope === b.scope && sameText(a.category, b.category) && (a.scope === 'business' || a.memberId === b.memberId);
// ---------- PDFs: filling in, signing, and sending for signature ----------
// Your own signature and initials are PNGs kept per person. A signature request keeps a copy of the PDF as it
// was sent (and its fingerprint), so what the signer sees is exactly what they sign, even if the file changes.
const SIGN_DAYS = 30;
const SIGN_KEEP = 500;
const SIGN_FIELDS = ['sig', 'ini', 'date', 'name', 'text'];
const sigKey = (wsId, memberId) => wsId + ':' + memberId;
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const isPdf = (it) => it?.type === 'file' && (it.mime === 'application/pdf' || /\.pdf$/i.test(it.name));
const PNG_HEAD = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function pngData(v) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]{20,400000})$/.exec(String(v || ''));
  const buf = m && Buffer.from(m[1], 'base64');
  return buf && buf.subarray(0, 8).equals(PNG_HEAD) ? buf : null;
}
// Where each mark goes, in PDF points (see pdf.js).
function cleanMarks(list, kinds) {
  if (!Array.isArray(list)) return [];
  if (list.length > 500) throw badRequest('Too many marks.');
  const num = (v, lo, hi) => {
    const x = Number(v);
    if (!Number.isFinite(x) || x < lo || x > hi) throw badRequest('A mark is off the page.');
    return x;
  };
  return list.map((m) => {
    if (!kinds.includes(m?.type)) throw badRequest('Unknown kind of mark.');
    const x = { id: cleanText(m.id, 20) || rid(6), type: m.type, page: Math.round(num(m.page, 0, 9999)), x: num(m.x, -20000, 20000), y: num(m.y, -20000, 20000), w: num(m.w, 2, 3000), h: num(m.h, 2, 3000) };
    if (m.type === 'text') Object.assign(x, { text: cleanText(m.text, 500), size: num(m.size ?? 11, 4, 72) });
    if (m.label) x.label = cleanText(m.label, 60);
    return x;
  });
}
function cleanForm(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, x] of Object.entries(v).slice(0, 2000)) out[String(k).slice(0, 300)] = typeof x === 'boolean' ? x : cleanText(x, 5000);
  return out;
}
async function pdfWork(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PdfError) throw badRequest(e.message);
    throw e;
  }
}
// "Lease.pdf" → "Lease (signed).pdf"
const copyName = (name, what) => `${name.replace(/\.pdf$/i, '').replace(/ \((signed|filled)\)$/, '')} (${what}).pdf`;
// A document from the editor, checked over before it becomes a PDF: text blocks, lists, tables (text only),
// PNG or JPEG pictures and page breaks. Anything else is dropped.
const DOC_TYPES = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'];
function cleanBlocks(list, budget = { blocks: 20000, pics: 30 }, inCell = false) {
  const out = [];
  if (!Array.isArray(list)) return out;
  const runs = (rs) => (Array.isArray(rs) ? rs.slice(0, 2000) : []).map((r) => ({
    text: typeof r?.text === 'string' ? r.text.slice(0, 20000) : '',
    ...Object.fromEntries(['b', 'i', 'u', 's', 'link'].filter((k) => r?.[k] === true).map((k) => [k, true])),
  })).filter((r) => r.text);
  for (const b of list) {
    if (--budget.blocks < 0) break;
    if (!b || typeof b !== 'object') continue;
    const align = ['center', 'right', 'justify'].includes(b.align) ? b.align : '';
    if (DOC_TYPES.includes(b.t)) {
      out.push({ t: b.t, align, runs: runs(b.runs), ...(b.t === 'li' ? { ordered: !!b.ordered, n: Math.max(1, Math.min(9999, b.n | 0)), lvl: Math.max(0, Math.min(8, b.lvl | 0)) } : {}) });
    } else if (inCell) continue;
    else if (b.t === 'break') out.push({ t: 'break' });
    else if (b.t === 'table' && Array.isArray(b.rows)) {
      const rows = b.rows.slice(0, 500).map((r) => (Array.isArray(r) ? r.slice(0, 30) : []).map((cell) => cleanBlocks(cell, budget, true)));
      if (rows.length) out.push({ t: 'table', rows });
    } else if (b.t === 'img' && typeof b.src === 'string' && budget.pics-- > 0) {
      const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(b.src);
      if (!m || m[2].length > 11_000_000) continue;
      out.push({ t: 'img', w: Math.max(0, Math.min(5000, +b.w || 0)), img: { type: m[1] === 'png' ? 'png' : 'jpg', bytes: Buffer.from(m[2], 'base64') } });
    }
  }
  return out;
}
async function addPdf(who, bytes, name, src) {
  const ws = db.workspaces[who.wsId];
  const id = rid();
  await fsp.writeFile(path.join(FILES_DIR, id), bytes);
  return addItem({
    ...baseItem(who, { type: 'file', name, size: bytes.length, mime: 'application/pdf' }),
    id,
    stackId: validStack(ws, src.stackId, who.memberId),
    channelId: validChannel(ws, src.channelId, who.memberId),
  });
}
const signPath = (x, signed) => path.join(FILES_DIR, `sign-${x.id}${signed ? '-signed' : ''}.pdf`);
const signLink = (x) => `${PUBLIC_URL}/sign/${x.token}`;
const signStatus = (x) => (['sent', 'viewed'].includes(x.status) && x.expiresAt < Date.now() ? 'expired' : x.status);
function publicSign(x) {
  const { wsId, token, ...rest } = x;
  return { ...rest, status: signStatus(x), link: signLink(x) };
}
const signNews = (x) => broadcast(x.wsId, { type: 'sign', sign: publicSign(x), forMember: x.memberId });
function signEvent(x, what, req) {
  x.events.push({ at: Date.now(), what, ...(req ? { ip: clientIp(req), ua: String(req.headers['user-agent'] || '').slice(0, 200) } : {}) });
  x.events = x.events.slice(-200);
}
const utc = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
const CONSENT = 'I agree to use electronic records and signatures for this document. I can ask the sender for a paper copy instead, and I can download a copy of the signed document.';

async function signApi(req, res, token, part) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const x = token && Object.values(db.signs).find((s) => s.token === token);
  if (!x || x.status === 'void') return send(res, 404, { error: 'This signing link isn’t available any more. Ask the sender for a new one.' });
  const ws = db.workspaces[x.wsId];
  const st = signStatus(x);
  const open = st === 'sent' || st === 'viewed';
  const m = req.method;
  if (!part && m === 'GET') {
    if (open && x.events.filter((e) => e.what === 'Opened').length < 50) {
      x.status = 'viewed';
      signEvent(x, 'Opened', req);
      save();
      signNews(x);
    }
    const brand = ws ? brandOf(ws) : {};
    return send(res, 200, {
      name: x.name, from: x.by, team: ws?.name || '', logo: logoUrl(brand.logo) || null, accent: brand.accent || null, message: x.message,
      signer: x.signer, fields: x.fields, status: st, expiresAt: x.expiresAt, signedAt: x.signedAt || null, consent: CONSENT,
    });
  }
  if (part === 'file' && (m === 'GET' || m === 'HEAD')) return serveFile(req, res, signPath(x), { name: x.name, mime: 'application/pdf' });
  if (part === 'signed' && (m === 'GET' || m === 'HEAD')) {
    if (st !== 'signed') return send(res, 404, { error: 'Not signed yet.' });
    return serveFile(req, res, signPath(x, true), { name: copyName(x.name, 'signed'), mime: 'application/pdf', download: true });
  }
  if (m !== 'POST' || (part && part !== 'decline')) return send(res, 404, { error: 'Not found' });
  if (!open) return send(res, 409, { error: st === 'signed' ? 'This document is already signed.' : st === 'declined' ? 'You declined this document.' : 'This link has expired. Ask the sender for a new one.' });
  if (x.busy) return send(res, 409, { error: 'Already signing. Wait a moment.' });
  const body = await readJson(req, 2_000_000);
  if (part === 'decline') {
    x.status = 'declined';
    x.declineReason = cleanText(body.reason, 500);
    signEvent(x, 'Declined to sign' + (x.declineReason ? `: “${x.declineReason}”` : ''), req);
    save();
    signNews(x);
    return send(res, 200, { status: 'declined' });
  }
  if (body.consent !== true) return send(res, 400, { error: 'Tick the box to agree to sign electronically.' });
  const typed = cleanText(body.name, 120);
  if (!typed) return send(res, 400, { error: 'Type your full name.' });
  const images = { sig: pngData(body.sig), ini: pngData(body.ini) };
  if (!images.sig) return send(res, 400, { error: 'Add your signature.' });
  if (x.fields.some((f) => f.type === 'ini') && !images.ini) return send(res, 400, { error: 'Add your initials.' });
  const date = cleanText(body.date, 40) || new Date().toISOString().slice(0, 10);
  const values = body.values && typeof body.values === 'object' ? body.values : {};
  const marks = x.fields.map((f) =>
    f.type === 'sig' || f.type === 'ini' ? { ...f, type: 'image', image: f.type }
      : { ...f, type: 'text', size: 0, text: f.type === 'date' ? date : f.type === 'name' ? typed : cleanText(values[f.id], 300) });
  x.busy = true;
  try {
    signEvent(x, `Agreed to sign electronically: “${CONSENT}”`, req);
    signEvent(x, `Signed as “${typed}”`, req);
    const signedAt = Date.now();
    const doc = await pdfWork(() => stampPdf(fs.readFileSync(signPath(x)), { marks, images, flatten: true }));
    const at = (e) => [utc(e.at), e.what + (e.ip ? ` · from ${e.ip}` : '') + (e.ua ? ` · ${e.ua}` : '')];
    await addCertificate(doc, {
      title: 'Signing certificate',
      rows: [
        ['Document', x.name], ['Pages', `${x.pages} (this certificate is added after them)`], ['Request', x.id],
        ['Fingerprint of the document as sent (SHA-256)', x.hash],
        ['Sent by', `${x.by}, ${ws?.name || ''}`], ['Signer', `${x.signer.name} <${x.signer.email}>`], ['Signed as', typed], ['Signed', utc(signedAt)],
      ],
      images: [['Signature', images.sig], ...(images.ini ? [['Initials', images.ini]] : [])],
      events: x.events.map(at),
      note: 'Made with Column. The signer reached this document through a private link sent to the email address above. Each line of the history shows when it happened, the network address it came from, and the browser used.',
    });
    const bytes = await doc.save();
    await fsp.writeFile(signPath(x, true), bytes);
    const sender = ws?.members.find((p) => p.id === x.memberId);
    const item = await addPdf({ wsId: x.wsId, member: x.by, memberId: sender ? x.memberId : null, device: 'Signature', deviceId: null }, bytes, copyName(x.name, 'signed'), x);
    Object.assign(x, { status: 'signed', signedAt, signedName: typed, signedHash: sha256(bytes), signedItemId: item.id });
  } catch (e) {
    x.events = x.events.filter((e2) => !/^(Agreed to sign|Signed as)/.test(e2.what));
    throw e;
  } finally {
    delete x.busy;
  }
  save();
  signNews(x);
  return send(res, 200, { status: 'signed' });
}

// ---------- vault: each person's safe box, locked in their own browser ----------
// Everything is encrypted and decrypted on the person's device with a key made from their vault passphrase,
// which never reaches the server. The server keeps the salt, a check value (a known text encrypted with
// that key, so a wrong passphrase can be told apart), and each item's encrypted blob. Links to a campaign
// or contact are kept readable so the campaign can show a lock; what's in the item isn't.
// Lose the passphrase and the contents are gone: starting over deletes them.
const VAULT_ITEMS = 1000;
const B64 = /^[\w-]+$/;
const vaultKey = (wsId, memberId) => `${wsId}:${memberId}`;
const publicVaultItem = ({ wsId, memberId, ...x }) => x;
function vaultBlob(v, max) {
  const t = String(v || '');
  if (!t || t.length > max || !B64.test(t)) throw badRequest('That doesn’t look encrypted.');
  return t;
}
function vaultLink(v, ws) {
  if (!v || typeof v !== 'object') return null;
  if (v.type === 'campaign' && db.campaigns[v.id]?.wsId === ws.id) return { type: 'campaign', id: v.id };
  if (v.type === 'contact' && typeof v.id === 'string' && v.id.length <= 60) return { type: 'contact', id: v.id };
  return null;
}

// ---------- planner: work out the goal and what it needs before it becomes a campaign ----------
// A plan is its maker's own: the end goal, the steps to it (each with its tasks), and what's needed
// to start: a thing in Column, PSS leads, a pasted list, or just a note to tick off. Making it a
// campaign happens in the browser, through the usual campaign, goal, task and list routes.
const PLAN_LINKS = ['file', 'stack', 'campaign', 'task'];
const publicPlan = ({ wsId, ...p }) => p;
const planId = (v) => (typeof v === 'string' && /^[\w-]{4,20}$/.test(v) ? v : rid(6));
function planLink(v) {
  if (!v || typeof v !== 'object') return null;
  if (PLAN_LINKS.includes(v.type) && typeof v.id === 'string') return { type: v.type, id: v.id.slice(0, 40) };
  if (v.type === 'live') return { type: 'live', live: applyLive(v.live) };
  if (v.type === 'rows') {
    const columns = (Array.isArray(v.columns) ? v.columns : []).slice(0, 30).map((x, i) => cleanText(x, 60) || `Column ${i + 1}`);
    if (!Array.isArray(v.rows) || v.rows.length > LIST_ROWS) throw badRequest(`A list can have up to ${LIST_ROWS} rows.`);
    const rows = v.rows.map((r) => ({ cells: columns.map((_, i) => cleanText(r?.cells?.[i], 300)) })).filter((r) => r.cells.some(Boolean));
    return rows.length ? { type: 'rows', columns, rows } : null;
  }
  return null;
}
function applyPlan(p, body) {
  if (body.name !== undefined) p.name = cleanText(body.name, 80) || 'Untitled plan';
  if (body.goal !== undefined) p.goal = cleanText(body.goal, 2000);
  if (body.notes !== undefined) p.notes = cleanText(body.notes, 20000);
  if (body.due !== undefined) p.due = body.due ? validDay(body.due) : null;
  if (body.steps !== undefined) {
    p.steps = (Array.isArray(body.steps) ? body.steps : []).slice(0, 30).map((x) => ({
      id: planId(x?.id), title: cleanText(x?.title, 200), due: x?.due ? validDay(x.due) : null,
      tasks: (Array.isArray(x?.tasks) ? x.tasks : []).slice(0, 50).map((t) => ({ id: planId(t?.id), text: cleanText(t?.text, 500) })),
    }));
  }
  if (body.needs !== undefined) {
    p.needs = (Array.isArray(body.needs) ? body.needs : []).slice(0, 40).map((x) => ({ id: planId(x?.id), text: cleanText(x?.text, 300), done: !!x?.done, link: planLink(x?.link) }));
  }
  if (body.campaignId !== undefined) p.campaignId = typeof body.campaignId === 'string' && db.campaigns[body.campaignId]?.wsId === p.wsId ? body.campaignId : null;
  p.updatedAt = Date.now();
  return p;
}
function planNews(p) {
  broadcast(p.wsId, { type: 'plan', plan: publicPlan(p), forMember: p.memberId });
}

// ---------- campaign email: one email to each person, from an owner's own Outlook ----------
// Never BCC: each person gets their own message, addressed only to them. Every email carries the team's
// mailing address and that person's unsubscribe link from PSS (and List-Unsubscribe headers), and anyone
// on PSS's do-not-contact list is skipped, checked again just before each send. Sends go out one every
// few seconds in the background, within Outlook's limits, and each one is logged in the campaign.
const MAIL_GAP = 3000;
const MAIL_MAX = 2000;
const MAIL_KEEP = 30;
const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[a-z]{2,}$/i;
const mailConn = (wsId, memberId) => Object.values(db.calendars).find((x) => x.wsId === wsId && x.memberId === memberId && x.provider === 'microsoft' && x.mail);
const doNotEmail = (wsId) => {
  const p = db.pss[wsId];
  return new Set([...(p?.dne || []), ...(p?.leads || []).filter((x) => x.dne).map((x) => x.email.toLowerCase())]);
};
const mailText = (v, n) => String(v ?? '').replace(/\r\n?/g, '\n').slice(0, n);
function mailFooter(v) {
  const f = mailText(v, 500).trim();
  if (!f) throw badRequest('Add your business name and mailing address. The law requires it on marketing email.');
  if (!/\d/.test(f)) throw badRequest('The footer needs your mailing address (street or PO box).');
  return f;
}
// "Hi {first name}" → "Hi Pat", or "Hi there" when there's no first name.
const merge = (text, r) => text.replace(/\{\s*first\s*name\s*\}/gi, r.first || 'there').replace(/\{\s*name\s*\}/gi, r.name || 'there');
const mimeWord = (t) => (/^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${Buffer.from(t).toString('base64')}?=`);
const mimeAddr = (name, email) => (name ? `"${mimeWord(name.replace(/["\\\r\n]/g, ''))}" <${email}>` : `<${email}>`);
function mailBody(sendRec, r, unsub) {
  return `${merge(sendRec.body, r).trim()}\n\n--\n${sendRec.footer}\nDon’t want these emails? Unsubscribe: ${unsub}\n`;
}
function mailMime(from, r, subject, text, unsub) {
  const b64 = Buffer.from(text.replace(/\n/g, '\r\n')).toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    `From: <${from}>`, `To: ${mimeAddr(r.name, r.email)}`, `Subject: ${mimeWord(subject.replace(/[\r\n]+/g, ' '))}`,
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64',
    ...(unsub.startsWith('https://') ? [`List-Unsubscribe: <${unsub}>`, 'List-Unsubscribe-Post: List-Unsubscribe=One-Click'] : []),
    '', b64,
  ].join('\r\n');
}
// One unsubscribe link per address, from PSS, a thousand at a time.
async function unsubLinks(wsId, emails) {
  const p = db.pss[wsId];
  if (!p) throw badRequest('Connect PSS in Settings first. Unsubscribe links come from the PSS website.');
  const key = unseal(p.sealed).key;
  const out = {};
  for (let i = 0; i < emails.length; i += 1000) {
    let r;
    try {
      r = await fetch(p.url + '/api/column/email', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ emails: emails.slice(i, i + 1000) }), redirect: 'error', signal: AbortSignal.timeout(20_000) });
    } catch {
      throw badRequest('Couldn’t reach PSS for unsubscribe links. Try again in a minute.');
    }
    if (!r.ok) throw badRequest(`PSS couldn’t make unsubscribe links (${r.status}).`);
    Object.assign(out, (await r.json()).unsubscribe_urls || {});
  }
  return out;
}
function publicSend(x) {
  const n = (st) => x.to.filter((r) => r.status === st).length;
  return {
    id: x.id, campaignId: x.campaignId, listId: x.listId, by: x.by, memberId: x.memberId, from: x.from, subject: x.subject, createdAt: x.createdAt,
    status: x.status, error: x.error || null, doneAt: x.doneAt || null, total: x.to.length, sent: n('sent'), failed: n('failed'), skipped: n('skipped'),
    problems: x.to.filter((r) => r.status === 'failed' || r.status === 'skipped').slice(0, 50).map((r) => ({ email: r.email, name: r.name, why: r.error })),
  };
}
// Owners see every send; a member who sent one sees their own.
function sendNews(x) {
  broadcast(x.wsId, { type: 'send', send: publicSend(x), forOwners: true });
  if (!isOwnerId(x.wsId, x.memberId)) broadcast(x.wsId, { type: 'send', send: publicSend(x), forMember: x.memberId });
}
// A member's own campaigns: ones they made, run, are invited to, or have a task in.
const onCampaign = (c, memberId) => c.ownerId === memberId || c.assigneeId === memberId || (c.memberIds || []).includes(memberId)
  || Object.values(db.tasks).some((t) => t.assigneeId === memberId && campaignOf('task', t) === c.id);
function sendFinish(x) {
  x.status = 'done';
  x.doneAt = Date.now();
  x.waitUntil = 0;
}
// Sends the next email of each sending batch, at most one per mailbox per tick.
const mailBusy = new Set();
async function mailTick() {
  const now = Date.now();
  for (const x of Object.values(db.sends)) {
    if (x.status !== 'sending' || mailBusy.has(x.connId) || (x.waitUntil || 0) > now) continue;
    mailBusy.add(x.connId);
    mailOne(x).catch((e) => console.error('Email send failed:', e.message)).finally(() => mailBusy.delete(x.connId));
  }
}
async function mailOne(x) {
  const r = x.to.find((y) => y.status === 'queued');
  const c = x.campaignId ? db.campaigns[x.campaignId] : null;
  if (!r) {
    sendFinish(x);
    save();
    return sendNews(x);
  }
  const conn = db.calendars[x.connId];
  if (!conn?.mail) {
    x.status = 'paused';
    x.error = 'Outlook was disconnected. Connect it again to finish sending.';
    save();
    return sendNews(x);
  }
  if (doNotEmail(x.wsId).has(r.email)) {
    r.status = 'skipped';
    r.error = 'Unsubscribed';
  } else {
    try {
      await calProviders.microsoft.sendMail(await calToken(conn), mailMime(conn.account, r, merge(x.subject, r), mailBody(x, r, r.unsub), r.unsub));
      r.status = 'sent';
      r.at = Date.now();
      // Logged in the campaign it was sent for; against the list row too when that list is the campaign's.
      if (c) {
        const listId = r.listId || x.listId;
        const onList = listId && db.lists[listId]?.campaignId === c.id && db.lists[listId].rows.some((y) => y.id === r.rowId);
        const a = {
          id: rid(), wsId: x.wsId, campaignId: c.id, method: (c.methods || []).includes('Email') ? 'Email' : null, taskId: null,
          listId: onList ? listId : null, rowId: onList ? r.rowId : null, leadId: r.leadId || null,
          memberId: x.memberId, by: x.by, at: r.at, outcome: 'Sent', contact: (r.name || r.email).slice(0, 200), note: merge(x.subject, r).slice(0, 2000), answers: [], sendId: x.id,
        };
        db.attempts[a.id] = a;
        broadcast(x.wsId, { type: 'attempt', attempt: publicAttempt(a) });
        if (a.leadId) pushPssSoon(x.wsId);
      }
      r.tries = 0;
    } catch (e) {
      if (e.auth) {
        x.status = 'paused';
        x.error = 'Outlook’s sign-in expired. Connect it again to finish sending.';
      } else if (e.status === 429 || e.status >= 500 || !e.status) {
        // Busy or unreachable: wait and try the same person again, a few times.
        r.tries = (r.tries || 0) + 1;
        x.waitUntil = Date.now() + Math.min(5 * 60_000, 30_000 * r.tries);
        if (r.tries >= 4) {
          r.status = 'failed';
          r.error = String(e.message || 'Outlook didn’t send it').slice(0, 200);
        }
      } else {
        r.status = 'failed';
        r.error = String(e.message || 'Outlook didn’t send it').slice(0, 200);
      }
    }
  }
  if (x.status === 'sending' && !x.to.some((y) => y.status === 'queued')) sendFinish(x);
  save();
  sendNews(x);
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
    log.length ? `Calls and emails logged since the last report (oldest first):\n${log.slice(-300).map((x) => `- ${fmtDay(x.at)} ${x.method || ''} ${x.contact || '(no name)'}: ${x.outcome}${x.note ? ` · ${clipText(x.note, 300)}` : ''}${(x.answers || []).map((y) => ` · ${clipText(y.q, 80)} ${clipText(y.a, 200)}`).join('')} (${x.by})`).join('\n')}` : 'Nothing logged since the last report.',
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

// ---------- meeting notes: record a call, transcribe it, draft notes that tie into campaigns ----------
// The recording streams up in pieces while it runs and is only the recorder's. Transcribing needs an
// OpenAI or Gemini key (Claude doesn't take audio); the notes are drafted with whichever AI the person
// picked. Nothing goes into a campaign until they accept the draft, and the audio is deleted then.
const MEET_MAX = 26_000_000;
const meetPath = (x) => path.join(FILES_DIR, `meet-${x.id}.webm`);
const publicMeeting = ({ wsId, ...x }) => x;
const meetNews = (x) => broadcast(x.wsId, { type: 'meeting', meeting: publicMeeting(x), forMember: x.memberId });
async function readRaw(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Too large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
async function transcribe(ai, file) {
  const buf = await fs.promises.readFile(file);
  if (ai.keys.openai) {
    const key = unseal(ai.keys.openai.sealed).key;
    let last;
    for (const model of ['gpt-4o-transcribe', 'whisper-1']) {
      const form = new FormData();
      form.append('file', new Blob([buf], { type: 'audio/webm' }), 'meeting.webm');
      form.append('model', model);
      form.append('response_format', 'json');
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form, signal: AbortSignal.timeout(15 * 60_000) });
      const d = await r.json().catch(() => null);
      if (r.ok) return String(d?.text || '');
      last = Object.assign(new Error(d?.error?.message || r.statusText), { status: r.status });
      if (r.status === 401 || r.status === 429) break;
    }
    throw last;
  }
  if (ai.keys.gemini) {
    const key = unseal(ai.keys.gemini.sealed).key;
    const base = 'https://generativelanguage.googleapis.com';
    const start = await fetch(`${base}/upload/v1beta/files`, { method: 'POST', headers: { 'x-goog-api-key': key, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(buf.length), 'X-Goog-Upload-Header-Content-Type': 'audio/webm', 'Content-Type': 'application/json' }, body: JSON.stringify({ file: { display_name: 'meeting' } }) });
    if (!start.ok) throw Object.assign(new Error((await start.json().catch(() => null))?.error?.message || start.statusText), { status: start.status });
    const up = await fetch(start.headers.get('x-goog-upload-url'), { method: 'POST', headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }, body: buf });
    let file = (await up.json()).file;
    for (let i = 0; i < 60 && file.state === 'PROCESSING'; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      file = await (await fetch(`${base}/v1beta/${file.name}`, { headers: { 'x-goog-api-key': key } })).json();
    }
    const models = ai.keys.gemini.models || [];
    const model = (models.find((m) => /^gemini-[\d.]+-flash$/.test(m.id)) || models.find((m) => /flash/.test(m.id)) || models[0])?.id || 'gemini-2.5-flash';
    const r = await fetch(`${base}/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ file_data: { mime_type: 'audio/webm', file_uri: file.uri } }, { text: 'Transcribe this meeting recording word for word. Start a new paragraph when the speaker changes, labelled "Speaker 1:", "Speaker 2:" and so on. Reply with the transcript only.' }] }] }) });
    const d = await r.json().catch(() => null);
    fetch(`${base}/v1beta/${file.name}`, { method: 'DELETE', headers: { 'x-goog-api-key': key } }).catch(() => {});
    if (!r.ok) throw Object.assign(new Error(d?.error?.message || r.statusText), { status: r.status });
    return (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  }
  throw badRequest('Transcribing needs an OpenAI or Gemini key. Add one in Settings → AI.');
}
// Notes, decisions and next steps from the transcript, tied to the campaigns, goals and PSS leads it mentions.
async function draftMeeting(ws, x) {
  const auth = { memberId: x.memberId, role: ws.members.find((m) => m.id === x.memberId)?.role };
  const camps = Object.values(db.campaigns).filter((c) => c.wsId === ws.id && c.status !== 'done' && canSee(auth, 'campaign', c));
  const said = x.transcript.toLowerCase();
  // Only leads named in the call go to the AI, and only for owners (who can see them).
  const leads = auth.role === 'owner' ? (db.pss[ws.id]?.leads || []).filter((l) => l.name.length > 3 && said.includes(l.name.toLowerCase())).slice(0, 10) : [];
  const prompt = [
    `Meeting: ${x.title || 'Untitled'} on ${fmtDay(x.startedAt)}, ${Math.round(((x.endedAt || x.startedAt) - x.startedAt) / 60000)} minutes. Recorded by ${x.by}.`,
    camps.length ? `Campaigns it might belong to:
${camps.slice(0, 30).map((c) => `- id ${c.id}: ${c.name}${c.brief ? ` · ${clipText(c.brief, 200)}` : ''}
  outcomes: ${c.outcomes.join(', ')}
  goals: ${Object.values(db.goals).filter((g) => g.campaignId === c.id).map((g) => `${g.id} "${clipText(g.title, 80)}"`).join(', ') || 'none'}`).join('\n')}` : 'No campaigns.',
    leads.length ? `Leads from the CRM named in the call:
${leads.map((l) => `- id ${l.id}: ${l.name}, stage ${l.stage}${l.city ? ', ' + l.city : ''}`).join('\n')}` : '',
    `Transcript:
${clipText(x.transcript, 120_000)}`,
  ].filter(Boolean).join('\n\n');
  const text = await aiAsk(ws, x.memberId,
    'You turn a meeting transcript into notes for the person who recorded it. Write a short title, a summary of 3 to 8 plain bullet lines, ' +
    'the decisions made, and the action items as concrete tasks (with a due date YYYY-MM-DD only when one was said, and who if named). ' +
    'If the meeting clearly belongs to one of the campaigns listed, give its id, the goal id each action fits (or null), the outcome from that ' +
    'campaign’s outcomes that fits best, and who was met. Use only what was said: never invent names, numbers, dates or commitments. ' +
    'If nothing fits a campaign, use null. Reply with JSON only: {"title":"","summary":[""],"decisions":[""],"actions":[{"text":"","due":null,"who":null,"goalId":null}],' +
    '"campaignId":null,"outcome":null,"contact":null,"leadId":null}',
    prompt);
  const j = replyJson(text);
  const camp = camps.find((c) => c.id === j.campaignId) || null;
  const goalIds = new Set(camp ? Object.values(db.goals).filter((g) => g.campaignId === camp.id).map((g) => g.id) : []);
  const lines = (v, n, len) => (Array.isArray(v) ? v : []).map((t) => cleanText(t, len)).filter(Boolean).slice(0, n);
  return {
    title: cleanText(j.title, 120) || x.title || 'Meeting',
    summary: lines(j.summary, 12, 400),
    decisions: lines(j.decisions, 12, 300),
    actions: (Array.isArray(j.actions) ? j.actions : []).slice(0, 20).map((a) => ({
      text: cleanText(a?.text, 300), due: isDay(a?.due) ? a.due : null, who: cleanText(a?.who, 60) || null, goalId: goalIds.has(a?.goalId) ? a.goalId : null,
    })).filter((a) => a.text),
    campaignId: camp?.id || null,
    outcome: camp && camp.outcomes.includes(j.outcome) ? j.outcome : null,
    contact: cleanText(j.contact, 120) || null,
    leadId: leads.some((l) => l.id === j.leadId) ? j.leadId : null,
  };
}
async function processMeeting(x) {
  const ws = db.workspaces[x.wsId];
  try {
    x.status = 'transcribing';
    meetNews(x);
    if (!x.transcript) x.transcript = (await transcribe(aiOf(ws.id, x.memberId), meetPath(x))).trim();
    if (!x.transcript) throw badRequest('Nothing was heard in the recording.');
    x.status = 'drafting';
    meetNews(x);
    x.draft = await draftMeeting(ws, x);
    x.status = 'ready';
    x.error = null;
  } catch (e) {
    console.error('Meeting notes failed:', e.message);
    x.status = 'failed';
    x.error = e.status === 400 ? e.message : e.status ? llmError(e) : 'Something went wrong making the notes. Try again.';
  }
  save();
  meetNews(x);
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

// ---------- Sidekick: plan a campaign or a schedule by talking it through ----------
// A conversation with the person's own AI. It asks what the goal is, proposes a path as cards (goals and
// tasks, a prospect list, a script, a budget, time on the Day), checks the accepted ones still add up, and
// the app builds them through the usual routes. After that it keeps an eye on the campaign's pace and
// says so when it's behind, and the person can pick the conversation back up. Each one is its maker's own.
const SK_CARDS = ['campaign', 'goal', 'list', 'note', 'budget', 'block', 'task', 'change'];
const SK_KEEP = 60;
const publicSidekick = ({ wsId, ...x }) => x;
const skNews = (x) => broadcast(x.wsId, { type: 'sidekick', sidekick: publicSidekick(x), forMember: x.memberId });
const skDay = (v) => (isDay(v) ? v : null);
const skMin = (v, max) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.max(0, Math.min(max, Math.round(Number(v)))) : null);
// One card from the AI, cleaned up: only what Column can build, with sane values.
function skCard(v, ws) {
  const type = SK_CARDS.includes(v?.type) ? v.type : null;
  if (!type) return null;
  const t = (x, n) => clipText(String(x ?? '').trim(), n);
  const c = { id: rid(6), type, state: 'new', why: t(v.why, 300) };
  if (type === 'campaign') Object.assign(c, { name: t(v.name, 80), brief: t(v.brief, 4000), start: skDay(v.start), end: skDay(v.end) });
  if (type === 'goal') Object.assign(c, {
    title: t(v.title, 200), kind: ['count', 'money'].includes(v.kind) ? v.kind : 'tasks',
    target: v.kind === 'count' || v.kind === 'money' ? Math.max(1, Math.min(10_000_000, Math.round(Number(String(v.target).replace(/[$,]/g, ''))) || 10)) : null,
    due: skDay(v.due), tasks: (Array.isArray(v.tasks) ? v.tasks : []).slice(0, 12).map((x) => ({ text: t(x?.text, 300), due: skDay(x?.due) })).filter((x) => x.text),
  });
  if (type === 'list') {
    if (!db.pss[ws.id]) return null;
    Object.assign(c, { name: t(v.name, 80) || 'PSS leads', live: applyLive(v.live || {}) });
  }
  if (type === 'note') Object.assign(c, { title: t(v.title, 120), text: t(v.text, 8000) });
  if (type === 'budget') Object.assign(c, { category: t(v.category, 40), limit: Math.max(1, Math.min(1e9, Math.round(Number(String(v.limit).replace(/[$,]/g, ''))) || 0)) });
  if (type === 'block') Object.assign(c, { text: t(v.text, 200), date: skDay(v.date), start: skMin(v.start, 1439), end: skMin(v.end, 1440), repeat: REPEATS.includes(v.repeat) ? v.repeat : null });
  if (type === 'task') Object.assign(c, { text: t(v.text, 300), due: skDay(v.due), goal: t(v.goal, 200) });
  if (type === 'change') Object.assign(c, { text: t(v.text, 300), goalId: db.goals[v.goalId]?.wsId === ws.id ? v.goalId : null, due: skDay(v.due), target: Number(v.target) > 0 ? Math.round(Number(v.target)) : null, end: skDay(v.end) });
  const empty = { campaign: !c.name, goal: !c.title, note: !c.text, budget: !c.category || !c.limit, block: !c.text || !c.date || c.start == null || c.end == null || c.end <= c.start, task: !c.text, change: !c.text || (!c.goalId && !c.end) }[type];
  return empty ? null : c;
}
// How far along a campaign is, 0 to 1: its goals' progress on average, as the app shows it.
function campFrac(c) {
  const gs = Object.values(db.goals).filter((g) => g.campaignId === c.id);
  if (!gs.length) return null;
  const one = (g) => {
    if (g.kind === 'money') return Math.min(1, Math.max(0, goalSaved(g.id)) / (g.target * 100));
    if (g.kind === 'count') {
      const n = Object.values(db.attempts).filter((x) => x.campaignId === c.id && (!g.counts?.length || g.counts.includes(x.outcome)) && (!g.methods?.length || g.methods.includes(x.method))).length;
      return Math.min(1, n / g.target);
    }
    const ts = Object.values(db.tasks).filter((t) => t.goalId === g.id);
    return ts.length ? ts.filter((t) => t.done).length / ts.length : 0;
  };
  return gs.reduce((n, g) => n + one(g), 0) / gs.length;
}
// Where the campaign is against its calendar: a note when it's well behind, or nothing.
function skPace(c, today) {
  if (!c || c.status !== 'active' || !c.start || !c.end || c.end <= c.start || today < c.start) return null;
  const span = (Date.parse(c.end) - Date.parse(c.start)) / 864e5;
  const gone = Math.min(1, (Date.parse(today) - Date.parse(c.start)) / 864e5 / span);
  const done = campFrac(c);
  if (done == null || gone < 0.15 || done >= gone - 0.2) return null;
  return `${Math.round(gone * 100)}% of the way through the dates, ${Math.round(done * 100)}% done.`;
}
function runSidekickPace() {
  for (const x of Object.values(db.sidekick)) {
    if (!x.campaignId) continue;
    const c = db.campaigns[x.campaignId];
    const note = skPace(c, fmtDay(Date.now()));
    if ((note || null) === (x.nudge?.text || null)) continue;
    x.nudge = note ? { text: note, at: Date.now() } : null;
    save();
    skNews(x);
  }
}
// What Sidekick knows before it asks anything: the date, what's in Column, and the campaign it's for.
function skContext(ws, auth, x, today) {
  const camps = Object.values(db.campaigns).filter((c) => c.wsId === ws.id && canSee(auth, 'campaign', c));
  const p = db.pss[ws.id];
  const count = (k) => Object.entries((p?.leads || []).reduce((m, l) => ((m[l[k] || '—'] = (m[l[k] || '—'] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([v, n]) => `${v} ${n}`).join(', ');
  const mine = Object.values(db.entries).filter((e) => e.wsId === ws.id && e.memberId === auth.memberId && e.start != null && (e.repeat || (e.date >= today && e.date <= addDays(today, 14))));
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const c = x.campaignId && db.campaigns[x.campaignId];
  const lines = [
    `Today is ${today} (${new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}). The person is ${auth.member}${auth.role === 'owner' ? ', a team owner' : ''}.`,
    camps.length ? `Campaigns already in Column: ${camps.slice(0, 30).map((c) => `${c.name} (${c.status})`).join('; ')}.` : 'No campaigns yet.',
    p ? `PSS (their website's leads) is connected: ${p.leads?.length || 0} leads. By stage: ${count('stage')}. By city: ${count('city')}. By source: ${count('source')}.` : 'PSS isn’t connected, so there are no leads to pull in: prospects would have to be found or imported.',
    mine.length ? `Their Day for the next two weeks (busy times):\n${mine.slice(0, 80).map((e) => `- ${e.repeat ? 'repeats ' + e.repeat + ' from ' + e.date : e.date} ${fmt(e.start)}${e.end != null ? '–' + fmt(e.end) : ''} ${clipText(e.text, 60)}`).join('\n')}` : 'Nothing on their Day in the next two weeks.',
  ];
  if (c) {
    const gs = Object.values(db.goals).filter((g) => g.campaignId === c.id).sort((a, b) => (a.order || 0) - (b.order || 0));
    const ts = Object.values(db.tasks).filter((t) => campaignOf('task', t) === c.id);
    const log = Object.values(db.attempts).filter((a) => a.campaignId === c.id);
    const recent = log.filter((a) => a.at > Date.now() - 14 * 864e5);
    const by = (xs) => Object.entries(xs.reduce((m, a) => ((m[a.outcome] = (m[a.outcome] || 0) + 1), m), {})).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
    const money = campMoney(c.id);
    lines.push([
      `This conversation is about the campaign “${c.name}” (${c.status}), running ${c.start || '?'} to ${c.end || 'no end'}. It's ${Math.round((campFrac(c) || 0) * 100)}% done.${x.nudge ? ' ' + x.nudge.text : ''}`,
      c.brief ? `Brief: ${clipText(c.brief, 2000)}` : '',
      gs.length ? `Goals (use these ids for changes):\n${gs.map((g) => `- [${g.id}] ${g.title} · ${g.kind}${g.target ? ' target ' + g.target : ''}${g.due ? ' due ' + g.due : ''} · ${g.kind === 'money' ? '$' + Math.round(goalSaved(g.id) / 100) + ' so far' : g.kind === 'count' ? '' : `${ts.filter((t) => t.goalId === g.id && t.done).length}/${ts.filter((t) => t.goalId === g.id).length} tasks done`}`).join('\n')}` : 'No goals yet.',
      `Tasks: ${ts.filter((t) => t.done).length} done, ${ts.filter((t) => !t.done).length} open, ${ts.filter((t) => !t.done && t.due && t.due < today).length} overdue.`,
      `Logged calls and emails: ${log.length} in all (${by(log)}); last 14 days ${recent.length} (${by(recent)}).`,
      money ? `Money: spent $${Math.round(money.spent / 100)}, brought in $${Math.round(money.earned / 100)}.` : '',
    ].filter(Boolean).join('\n'));
  }
  return lines.join('\n\n');
}
const SK_SYSTEM = (kind, built) => [
  'You are Sidekick, the planning partner inside Column, a work app for a small business: it has campaigns (each with goals, and tasks under the goals, call lists, a log of calls and emails, and notes), a Day schedule, and Finance (money in and out, budgets).',
  kind === 'schedule'
    ? 'Here you help plan the person’s schedule: what they want to get done, when they work best, what’s fixed. Then propose time blocks on their Day around what’s already there.'
    : 'Here you help plan a campaign: what success looks like (a number to reach, by when), who it’s aimed at, what they already have (leads, lists, scripts), how much time and money they can put in. Then propose the campaign, its goals with tasks, and what it needs to succeed.',
  built ? 'The plan is already built and running. Help them see how it’s going from the numbers given, say plainly what’s working and what isn’t and why, what could happen next, and propose changes. Keep it short.' : '',
  'Work like a sharp colleague brainstorming: ask one or two questions at a time, the ones that matter most, and don’t ask what the context already tells you. When you know enough, propose a path as cards. Explain briefly why each card helps. When asked to check the accepted cards, say honestly whether they add up to the goal (do the numbers work, is anything missing, is the time realistic) and propose what would fix it.',
  'Never invent leads, names, numbers or results. Use dates from today on, as YYYY-MM-DD. Times are minutes after midnight (9:00 = 540).',
  'Reply with JSON only: {"reply":"what you say, plain text, short paragraphs, no markdown","title":"a short name for this plan, once you know it, else null","cards":[...]}. cards is often empty while you’re still asking. Card shapes:',
  '{"type":"campaign","name":"","brief":"the goal, audience and approach in a few lines","start":"YYYY-MM-DD","end":"YYYY-MM-DD","why":""}',
  '{"type":"goal","title":"","kind":"tasks"|"count"|"money","target":number|null (count: logged calls or emails to reach; money: whole dollars),"due":"YYYY-MM-DD"|null,"tasks":[{"text":"an action for one sitting","due":"YYYY-MM-DD"|null}],"why":""}',
  '{"type":"list","name":"","live":{"stages":[],"cities":[],"sources":[],"days":0|30|90|180|365,"need":"phone"|"email"|null},"why":""} — a prospect list pulled from PSS by filter, only if PSS is connected. Use stage, city and source values exactly as given.',
  '{"type":"note","title":"","text":"","why":""} — a call script, an email draft, a checklist, talking points.',
  '{"type":"budget","category":"","limit":whole dollars a month,"why":""}',
  '{"type":"block","text":"","date":"YYYY-MM-DD","start":540,"end":600,"repeat":null|"daily"|"weekdays"|"weekly"|"monthly","why":""} — time on their Day. Don’t overlap what’s already there.',
  built ? '{"type":"task","text":"","due":"YYYY-MM-DD"|null,"goal":"the goal’s title it goes under","why":""} and {"type":"change","text":"what changes, in words","goalId":"id"|null,"due":"YYYY-MM-DD"|null,"target":number|null,"end":"YYYY-MM-DD"|null (the campaign’s new end),"why":""}' : '',
].filter(Boolean).join('\n');
async function skTurn(ws, auth, x, today, say) {
  const ai = aiOf(ws.id, auth.memberId);
  const use = aiUse(ai);
  if (!use) throw Object.assign(new Error('Add your AI key in Settings → AI to use Sidekick.'), { status: 400 });
  const cardLine = (c) => `[${c.state}] ${c.type}: ${c.name || c.title || c.text || c.category || ''}${c.type === 'goal' && c.target ? ' · target ' + c.target : ''}${c.type === 'block' ? ` · ${c.date} ${c.start}-${c.end}${c.repeat ? ' ' + c.repeat : ''}` : ''}`;
  const history = x.messages.slice(-30).map((m) => ({ role: m.role, text: m.role === 'assistant' ? JSON.stringify({ reply: m.text, cards: (m.cards || []).map(cardLine) }) : m.text }));
  history.push({ role: 'user', text: `${say}\n\n(Context, not from the person)\n${skContext(ws, auth, x, today)}` });
  let out;
  try {
    out = await llms[use.provider].run({ key: unseal(ai.keys[use.provider].sealed).key, model: use.model, system: SK_SYSTEM(x.kind, !!x.campaignId || x.status === 'built') + brandPrompt(ws), history, tools: [], web: false, exec: () => Promise.reject(new Error('No tools')) });
  } catch (e) {
    console.error('Sidekick request failed:', e.message);
    throw Object.assign(new Error(llmError(e)), { status: 502 });
  }
  if (out.refused) throw Object.assign(new Error(out.text), { status: 502 });
  const j = replyJson(out.text);
  const msg = { role: 'assistant', text: clipText(String(j.reply || '').trim(), 6000) || '…', cards: (Array.isArray(j.cards) ? j.cards : []).slice(0, 16).map((v) => skCard(v, ws)).filter(Boolean), at: Date.now() };
  if (j.title && (!x.title || x.title === 'New campaign plan' || x.title === 'New schedule')) x.title = clipText(String(j.title).trim(), 80);
  x.messages.push(msg);
  x.messages = x.messages.slice(-SK_KEEP);
  x.updatedAt = Date.now();
  return msg;
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
    const tries = ['ip:' + clientIp(req), `name:${slug}:${nameKey(who)}`];
    if (loginBlocked(tries)) return send(res, 429, { error: 'Too many wrong tries. Wait 15 minutes, then try again.' });
    const refuse = (msg) => {
      loginFailed(tries);
      return send(res, 401, { error: msg });
    };
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
        if (!checkInvite(ws, code)) return refuse('Wrong invite code.');
        if (member?.hash) return send(res, 409, { error: 'Someone here already uses that name. Sign in instead, or pick another name.' });
        member ||= newMember(ws, who, 'member');
        setPassword(member, password);
        ensureOwner(ws, member);
      } else {
        if (!member) return send(res, 404, { error: `No one called “${who}” in ${ws.name}. New here? Use Join team with the invite code.` });
        if (!member.hash) return send(res, 401, { error: 'No password set for this name yet. Use Join team with the invite code to set one.' });
        if (!checkHash(password, member.salt, member.hash)) return refuse('Wrong password.');
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

  // Someone signing a document they were sent: the link is their way in, no account.
  if (a === 'public' && b === 'sign') return signApi(req, res, c, d);

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
      bills: Object.values(db.bills).filter((x) => x.wsId === ws.id && seesBill(ws.id, x, auth.memberId)).map(publicBill),
      money: Object.values(db.money).filter((x) => x.wsId === ws.id && seesBill(ws.id, x, auth.memberId)).map(publicMoney),
      budgets: Object.values(db.budgets).filter((x) => x.wsId === ws.id && seesBill(ws.id, x, auth.memberId)).map(publicBudget),
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
      const body = await readJson(req, 50_000);
      const camp = db.campaigns[db.goals[t.goalId]?.campaignId];
      if ((body.skipped !== undefined || body.unlocked !== undefined) && !(camp && passesSteps(camp, auth))) return send(res, 403, { error: 'Only an owner can skip or unlock a step.' });
      const waits = body.done && !t.done && camp && !passesSteps(camp, auth) && taskWaitsOn(t);
      if (waits) return send(res, 409, { error: `This campaign is worked in order. Finish “${waits.title || waits.text}” first.` });
      const next = applyTask({ ...t }, body);
      if (body.skipped !== undefined) next.skipped = !!body.skipped;
      if (body.unlocked !== undefined) next.unlocked = !!body.unlocked;
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
      const { provider, tz, mail } = await readJson(req);
      const p = calProviders[provider];
      if (!p) return send(res, 400, { error: 'Unknown calendar' });
      if (!p.configured()) return send(res, 400, { error: `${p.name} isn’t set up on this server yet.` });
      const state = rid(18);
      const wantMail = !!mail && provider === 'microsoft';
      oauthPending.set(state, { wsId: ws.id, memberId: auth.memberId, provider, tz: validTz(tz), mail: wantMail, exp: Date.now() + 15 * 60_000 });
      return send(res, 200, { url: p.authUrl(`${PUBLIC_URL}/oauth/${provider}/callback`, state, wantMail) });
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

  // Your meeting recordings and their notes. Only yours.
  if (a === 'meetings') {
    const mine = () => Object.values(db.meetings).filter((x) => x.wsId === ws.id && x.memberId === auth.memberId).sort((p, q) => q.startedAt - p.startedAt);
    if (m === 'GET' && !b) return send(res, 200, mine().slice(0, 50).map(publicMeeting));
    if (m === 'POST' && !b) {
      const body = await readJson(req);
      if (mine().some((x) => x.status === 'recording' && Date.now() - x.touched < 60_000)) return send(res, 409, { error: 'You’re already recording a meeting.' });
      const e = body.entryId && db.entries[body.entryId];
      const x = { id: rid(), wsId: ws.id, memberId: auth.memberId, by: auth.member, title: cleanText(body.title, 120) || 'Meeting', entryId: e && e.wsId === ws.id ? e.id : null, startedAt: Date.now(), touched: Date.now(), endedAt: null, bytes: 0, seq: 0, mic: !!body.mic, call: !!body.call, status: 'recording', transcript: '', draft: null, error: null };
      db.meetings[x.id] = x;
      await fs.promises.writeFile(meetPath(x), '');
      save();
      meetNews(x);
      return send(res, 200, publicMeeting(x));
    }
    const x = b && db.meetings[b];
    if (!x || x.wsId !== ws.id || x.memberId !== auth.memberId) return send(res, 404, { error: 'Not found' });
    // Pieces arrive in order; a piece sent twice (a retry) is ignored.
    if (m === 'PUT' && c === 'audio') {
      if (x.status !== 'recording') return send(res, 409, { error: 'This recording has stopped.' });
      const seq = Number(url.searchParams.get('seq'));
      const buf = await readRaw(req, 4_000_000);
      if (seq < x.seq) return send(res, 200, { bytes: x.bytes });
      if (seq !== x.seq) return send(res, 409, { error: 'Out of order', seq: x.seq });
      if (x.bytes + buf.length > MEET_MAX) return send(res, 413, { error: 'The recording is as long as it can be.' });
      await fs.promises.appendFile(meetPath(x), buf);
      x.bytes += buf.length;
      x.seq++;
      x.touched = Date.now();
      return send(res, 200, { bytes: x.bytes });
    }
    if (m === 'POST' && c === 'stop') {
      if (x.status !== 'recording') return send(res, 409, { error: 'Already stopped.' });
      x.endedAt = Date.now();
      if (x.bytes < 2000) {
        x.status = 'failed';
        x.error = 'Nothing was recorded.';
        await fs.promises.rm(meetPath(x), { force: true });
      } else processMeeting(x);
      save();
      meetNews(x);
      return send(res, 200, publicMeeting(x));
    }
    if (m === 'POST' && c === 'retry' && x.status === 'failed' && (x.transcript || x.bytes >= 2000)) {
      processMeeting(x);
      return send(res, 200, publicMeeting(x));
    }
    // Accepted: the notes went where the person chose, and the audio goes.
    if (m === 'POST' && c === 'saved') {
      const body = await readJson(req);
      x.status = 'saved';
      x.savedAt = Date.now();
      x.noteId = typeof body.noteId === 'string' ? body.noteId.slice(0, 40) : null;
      x.campaignId = db.campaigns[body.campaignId]?.wsId === ws.id ? body.campaignId : null;
      await fs.promises.rm(meetPath(x), { force: true });
      save();
      meetNews(x);
      return send(res, 200, publicMeeting(x));
    }
    if (m === 'DELETE' && !c) {
      await fs.promises.rm(meetPath(x), { force: true });
      delete db.meetings[x.id];
      save();
      broadcast(ws.id, { type: 'meeting:remove', id: x.id, forMember: x.memberId });
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  // Bills: yours, and the business's if you're an owner.
  if (a === 'bills') {
    if (m === 'POST' && !b) {
      const body = await readJson(req, 20_000);
      const x = applyBill({ id: rid(), wsId: ws.id, memberId: auth.memberId, by: auth.member, createdAt: Date.now(), name: '', amount: 0, repeat: 'monthly', scope: 'personal', autopay: false, note: '', paid: [], done: false, tz: validTz() }, { repeat: 'monthly', ...body });
      if (!x.due) return send(res, 400, { error: 'Pick the date it’s due.' });
      if (x.scope === 'business' && auth.role !== 'owner') x.scope = 'personal';
      db.bills[x.id] = x;
      runAutopay();
      save();
      billNews(x);
      return send(res, 200, publicBill(x));
    }
    const x = b && db.bills[b];
    if (!x || x.wsId !== ws.id || !seesBill(ws.id, x, auth.memberId)) return send(res, 404, { error: 'Not found' });
    const body = m === 'DELETE' ? {} : await readJson(req, 20_000);
    if (m === 'PATCH' && !c) {
      // Only its owner moves a bill between personal and business.
      if (body.scope !== undefined && x.memberId !== auth.memberId) delete body.scope;
      if (body.scope === 'business' && auth.role !== 'owner') return send(res, 403, { error: 'Only team owners keep business bills.' });
      applyBill(x, body);
    } else if (m === 'POST' && c === 'paid') {
      if (body.undo) {
        const last = x.paid?.[0];
        if (!last) return send(res, 400, { error: 'Nothing to undo.' });
        x.paid.shift();
        if (db.money[last.moneyId]) dropMoney(db.money[last.moneyId]);
        x.due = last.due;
        x.done = false;
      } else if (x.done) return send(res, 400, { error: 'That bill is already paid.' });
      else payBill(x, auth.member, false);
    } else if (m === 'DELETE' && !c) {
      delete db.bills[x.id];
      save();
      broadcast(ws.id, { type: 'bill:remove', id: x.id, bill: publicBill(x) });
      return send(res, 200, { ok: true });
    } else return send(res, 405, { error: 'Method not allowed' });
    save();
    billNews(x);
    return send(res, 200, publicBill(x));
  }

  // Finance: money in and out, yours and (for owners) the business's.
  if (a === 'money') {
    if (m === 'POST' && b === 'import') {
      const body = await readJson(req, 2_000_000);
      const rows = Array.isArray(body.rows) ? body.rows.slice(0, MONEY_IMPORT) : [];
      if (!rows.length) return send(res, 400, { error: 'There’s nothing to import.' });
      const scope = body.scope === 'business' && auth.role === 'owner' ? 'business' : 'personal';
      const have = new Set(Object.values(db.money).filter((x) => x.wsId === ws.id && x.key).map((x) => x.key));
      const added = [];
      let skipped = 0;
      for (const r of rows) {
        const n = Number(String(r?.amount ?? '').replace(/[$,\s]/g, ''));
        const day = validDay(r?.day);
        if (!day || !Number.isFinite(n) || !n) { skipped++; continue; }
        const x = { ...newMoney(auth), kind: n > 0 ? 'in' : 'out', day, scope, note: cleanText(r.note, 200), category: cleanText(r.category, 40) };
        x.amount = Math.min(1e11, Math.round(Math.abs(n) * 100));
        x.key = moneyKey(x);
        if (have.has(x.key)) { skipped++; continue; }
        have.add(x.key);
        db.money[x.id] = x;
        added.push(x);
      }
      save();
      for (const x of added) broadcast(ws.id, { type: 'money', money: publicMoney(x), bill: x });
      return send(res, 200, { added: added.length, skipped, entries: added.map(publicMoney) });
    }
    if (m === 'POST' && !b) {
      const x = applyMoney(newMoney(auth), { kind: 'out', ...(await readJson(req, 20_000)) }, auth);
      if (!x.amount) return send(res, 400, { error: 'Enter the amount, like 142.50' });
      if (!x.day) return send(res, 400, { error: 'Pick the date.' });
      db.money[x.id] = x;
      save();
      moneyNews(x);
      return send(res, 200, publicMoney(x));
    }
    const x = b && db.money[b];
    if (!x || x.wsId !== ws.id || !seesBill(ws.id, x, auth.memberId)) return send(res, 404, { error: 'Not found' });
    if (m === 'PATCH') {
      const body = await readJson(req, 20_000);
      if (body.scope !== undefined && x.memberId !== auth.memberId) delete body.scope;
      const was = { ...x };
      applyMoney(x, body, auth);
      save();
      if (was.goalId !== x.goalId || was.campaignId !== x.campaignId) moneyTouches(was);
      moneyNews(x);
      return send(res, 200, publicMoney(x));
    }
    if (m === 'DELETE') {
      dropMoney(x);
      save();
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  // A monthly budget for one spending category. A limit of 0 removes it.
  if (a === 'budgets' && m === 'PUT') {
    const body = await readJson(req, 20_000);
    const want = { wsId: ws.id, memberId: auth.memberId, scope: body.scope === 'business' && auth.role === 'owner' ? 'business' : 'personal', category: cleanText(body.category, 40) };
    if (!want.category) return send(res, 400, { error: 'Pick a category.' });
    const old = Object.values(db.budgets).find((x) => sameBudget(x, want));
    const limit = Math.round(Number(String(body.limit ?? '').replace(/[$,\s]/g, '')) * 100) || 0;
    if (limit <= 0) {
      if (old) {
        delete db.budgets[old.id];
        broadcast(ws.id, { type: 'budget:remove', id: old.id, bill: old });
      }
      save();
      return send(res, 200, { ok: true });
    }
    const x = old || { id: rid(), ...want, by: auth.member };
    x.limit = Math.min(1e11, limit);
    db.budgets[x.id] = x;
    save();
    broadcast(ws.id, { type: 'budget', budget: publicBudget(x), bill: x });
    return send(res, 200, publicBudget(x));
  }

  // Your vault: only ever encrypted blobs. Nobody else, owners included, can reach it.
  if (a === 'signature') {
    const k = sigKey(ws.id, auth.memberId);
    if (m === 'GET') return send(res, 200, db.signatures[k] || {});
    if (m === 'PUT') {
      const body = await readJson(req, 1_200_000);
      const cur = { ...db.signatures[k] };
      for (const f of ['sig', 'ini']) {
        if (!(f in body)) continue;
        if (body[f] === null) delete cur[f];
        else if (!pngData(body[f])) return send(res, 400, { error: 'That signature didn’t come through. Draw it again.' });
        else cur[f] = body[f];
      }
      db.signatures[k] = cur;
      save();
      broadcast(ws.id, { type: 'signature', forMember: auth.memberId });
      return send(res, 200, cur);
    }
  }

  // Saves a filled-in or signed copy of a PDF next to it. The original stays as it was.
  if (a === 'pdf' && b && c === 'save' && m === 'POST') {
    const it = db.items[b];
    if (!it || it.wsId !== ws.id || it.status !== 'ready' || !canSee(auth, 'item', it)) return send(res, 404, { error: 'Not found' });
    if (!isPdf(it)) return send(res, 400, { error: 'Only PDFs can be filled in and signed here.' });
    const body = await readJson(req, 2_000_000);
    const marks = cleanMarks(body.marks, ['text', 'check', 'sig', 'ini']);
    const form = cleanForm(body.form);
    if (!marks.length && !Object.keys(form).length) return send(res, 400, { error: 'Nothing to save yet.' });
    const mine = db.signatures[sigKey(ws.id, auth.memberId)] || {};
    const images = { sig: pngData(mine.sig), ini: pngData(mine.ini) };
    for (const x of marks) {
      if (x.type !== 'sig' && x.type !== 'ini') continue;
      if (!images[x.type]) return send(res, 400, { error: x.type === 'sig' ? 'Add your signature first.' : 'Add your initials first.' });
      Object.assign(x, { image: x.type, type: 'image' });
    }
    const signed = marks.some((x) => x.type === 'image');
    const bytes = await pdfWork(async () => (await stampPdf(await fsp.readFile(path.join(FILES_DIR, it.id)), { marks, form, images, flatten: signed })).save());
    const item = await addPdf(auth, bytes, copyName(it.name, signed ? 'signed' : 'filled'), it);
    return send(res, 200, publicItem(item));
  }

  // A document from the editor (a Word file, or one started in Column) as a PDF in the same stack.
  if (a === 'docs' && b === 'pdf' && m === 'POST') {
    const body = await readJson(req, 40_000_000);
    const src = body.itemId ? db.items[body.itemId] : null;
    if (body.itemId && (!src || src.wsId !== ws.id || !canSee(auth, 'item', src))) return send(res, 404, { error: 'Not found' });
    const blocks = cleanBlocks(body.blocks);
    if (!blocks.some((x) => x.t === 'img' || x.t === 'table' || x.runs?.some((r) => r.text.trim()))) return send(res, 400, { error: 'There’s nothing in this document yet.' });
    const name = (cleanText(body.name, 200) || 'Document').replace(/\.(docx?|pdf)$/i, '');
    const bytes = Buffer.from(await pdfWork(() => writeDoc(blocks, { title: name })));
    const item = await addPdf(auth, bytes, name + '.pdf', src || { stackId: body.stackId, channelId: body.channelId });
    return send(res, 200, publicItem(item));
  }

  if (a === 'signs') {
    const mine = (x) => x.wsId === ws.id && x.memberId === auth.memberId;
    if (m === 'GET' && !b) return send(res, 200, Object.values(db.signs).filter(mine).sort((p, q) => q.createdAt - p.createdAt).slice(0, SIGN_KEEP).map(publicSign));
    if (m === 'POST' && !b) {
      const body = await readJson(req, 1_000_000);
      const it = db.items[body.itemId];
      if (!it || it.wsId !== ws.id || it.status !== 'ready' || !canSee(auth, 'item', it)) return send(res, 404, { error: 'Not found' });
      if (!isPdf(it)) return send(res, 400, { error: 'Only PDFs can be sent for signature.' });
      const name = cleanText(body.signer?.name, 120);
      const email = cleanText(body.signer?.email, 200).toLowerCase();
      if (!name) return send(res, 400, { error: 'Add the name of the person signing.' });
      if (!EMAIL_RE.test(email)) return send(res, 400, { error: 'Add their email address.' });
      const fields = cleanMarks(body.fields, SIGN_FIELDS);
      if (fields.length > 100) return send(res, 400, { error: 'That’s too many boxes. 100 at most.' });
      if (!fields.some((f) => f.type === 'sig')) return send(res, 400, { error: 'Add at least one signature box for them.' });
      const bytes = await fsp.readFile(path.join(FILES_DIR, it.id));
      const pages = await pdfWork(() => pageCount(bytes));
      if (fields.some((f) => f.page >= pages)) return send(res, 400, { error: 'A box is off the end of the document.' });
      const camp = body.campaignId && db.campaigns[body.campaignId];
      const x = {
        id: rid(), wsId: ws.id, memberId: auth.memberId, by: auth.member, itemId: it.id, name: it.name, stackId: it.stackId, channelId: it.channelId,
        campaignId: camp && camp.wsId === ws.id && seesCampaign(camp.id, auth.memberId) ? camp.id : null,
        signer: { name, email }, message: String(body.message ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 2000), fields, pages,
        token: rid(24), hash: sha256(bytes), status: 'sent', events: [], createdAt: Date.now(), expiresAt: Date.now() + SIGN_DAYS * 86_400_000,
      };
      await fsp.writeFile(signPath(x), bytes);
      signEvent(x, `Sent by ${auth.member} (${ws.name})`, req);
      db.signs[x.id] = x;
      save();
      signNews(x);
      return send(res, 200, publicSign(x));
    }
    const x = b && db.signs[b];
    if (!x || !mine(x)) return send(res, 404, { error: 'Not found' });
    const open = ['sent', 'viewed'].includes(signStatus(x));
    if (c === 'email' && m === 'POST') {
      const conn = mailConn(ws.id, auth.memberId);
      if (!conn) return send(res, 400, { error: 'Connect Outlook in Settings to email it from Column, or copy the link and send it yourself.' });
      if (!open) return send(res, 400, { error: 'This request is closed.' });
      const first = x.signer.name.split(/\s+/)[0];
      const until = new Date(x.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      const text = `Hi ${first},\n\n${x.by} at ${ws.name} sent you “${x.name}” to sign.\n\n${x.message ? x.message + '\n\n' : ''}Read it and sign here:\n${signLink(x)}\n\nThe link works until ${until}.\n`;
      try {
        await calProviders.microsoft.sendMail(await calToken(conn), mailMime(conn.account, x.signer, `Please sign: ${x.name}`, text, ''));
      } catch (e) {
        return send(res, 502, { error: e.auth ? 'Outlook’s sign-in expired. Connect it again.' : 'Outlook didn’t send it: ' + String(e.message).slice(0, 200) });
      }
      signEvent(x, `Emailed to ${x.signer.email} from ${conn.account}`);
      save();
      signNews(x);
      return send(res, 200, publicSign(x));
    }
    if (c === 'void' && m === 'POST') {
      if (!open) return send(res, 400, { error: 'This request is already closed.' });
      x.status = 'void';
      signEvent(x, `Cancelled by ${auth.member}`);
      save();
      signNews(x);
      return send(res, 200, publicSign(x));
    }
    if (m === 'DELETE' && !c) {
      if (x.status === 'signed') return send(res, 400, { error: 'A signed request stays on record.' });
      delete db.signs[x.id];
      fsp.rm(signPath(x), { force: true }).catch(() => {});
      save();
      broadcast(ws.id, { type: 'sign:remove', id: x.id, forMember: x.memberId });
      return send(res, 200, { ok: true });
    }
  }

  if (a === 'vault') {
    const key = vaultKey(ws.id, auth.memberId);
    const mine = () => Object.values(db.vaultItems).filter((x) => x.wsId === ws.id && x.memberId === auth.memberId);
    const v = db.vaults[key];
    if (m === 'GET' && !b) return send(res, 200, v ? { salt: v.salt, iters: v.iters, check: v.check, items: mine().map(publicVaultItem) } : { salt: null });
    // Set up, or start over with a new passphrase (which deletes everything in it).
    if (m === 'POST' && b === 'setup') {
      const body = await readJson(req, 10_000);
      if (v && !body.reset) return send(res, 409, { error: 'Your vault is already set up.' });
      const iters = Math.round(Number(body.iters));
      if (!(iters >= 100_000 && iters <= 10_000_000)) return send(res, 400, { error: 'Bad key settings.' });
      const next = { wsId: ws.id, memberId: auth.memberId, salt: vaultBlob(body.salt, 64), iters, check: vaultBlob(body.check, 200), createdAt: Date.now() };
      for (const x of mine()) delete db.vaultItems[x.id];
      db.vaults[key] = next;
      save();
      broadcast(ws.id, { type: 'vault', forMember: auth.memberId });
      return send(res, 200, { salt: next.salt, iters, check: next.check, items: [] });
    }
    if (!v) return send(res, 400, { error: 'Set up your vault first.' });
    if (b === 'items') {
      if (m === 'POST' && !c) {
        if (mine().length >= VAULT_ITEMS) return send(res, 400, { error: `A vault holds up to ${VAULT_ITEMS} items.` });
        const body = await readJson(req, 200_000);
        const x = { id: rid(), wsId: ws.id, memberId: auth.memberId, blob: vaultBlob(body.blob, 150_000), link: vaultLink(body.link, ws), createdAt: Date.now(), updatedAt: Date.now() };
        db.vaultItems[x.id] = x;
        save();
        broadcast(ws.id, { type: 'vault', forMember: auth.memberId });
        return send(res, 200, publicVaultItem(x));
      }
      const x = c && db.vaultItems[c];
      if (!x || x.wsId !== ws.id || x.memberId !== auth.memberId) return send(res, 404, { error: 'Not found' });
      if (m === 'PATCH') {
        const body = await readJson(req, 200_000);
        if (body.blob !== undefined) x.blob = vaultBlob(body.blob, 150_000);
        if (body.link !== undefined) x.link = vaultLink(body.link, ws);
        x.updatedAt = Date.now();
      } else if (m === 'DELETE') delete db.vaultItems[x.id];
      else return send(res, 405, { error: 'Method not allowed' });
      save();
      broadcast(ws.id, { type: 'vault', forMember: auth.memberId });
      return send(res, 200, m === 'DELETE' ? { ok: true } : publicVaultItem(x));
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  // Plans: only yours.
  // Sidekick conversations: yours only.
  if (a === 'sidekick') {
    const mine = () => Object.values(db.sidekick).filter((x) => x.wsId === ws.id && x.memberId === auth.memberId);
    if (m === 'GET' && !b) return send(res, 200, mine().sort((p, q) => q.updatedAt - p.updatedAt).map(publicSidekick));
    const body = m === 'GET' || m === 'DELETE' ? {} : await readJson(req, 200_000);
    const today = isDay(body.today) ? body.today : fmtDay(Date.now());
    if (m === 'POST' && !b) {
      if (mine().length >= 200) return send(res, 400, { error: 'You can keep up to 200 Sidekick plans. Delete some old ones first.' });
      const camp = body.campaignId && db.campaigns[body.campaignId];
      const ok = camp && camp.wsId === ws.id && canSee(auth, 'campaign', camp);
      const kind = ok || body.kind !== 'schedule' ? 'campaign' : 'schedule';
      const x = { id: rid(), wsId: ws.id, memberId: auth.memberId, createdAt: Date.now(), updatedAt: Date.now(), kind, title: ok ? camp.name : kind === 'schedule' ? 'New schedule' : 'New campaign plan', status: ok ? 'built' : 'talking', campaignId: ok ? camp.id : null, entryIds: [], messages: [], nudge: null };
      await skTurn(ws, auth, x, today, ok ? `I want to talk about how “${camp.name}” is going.` : kind === 'schedule' ? 'I want to plan my schedule.' : 'I want to plan a campaign.');
      x.messages[0].opener = true;
      db.sidekick[x.id] = x;
      save();
      skNews(x);
      return send(res, 200, publicSidekick(x));
    }
    const x = b && db.sidekick[b];
    if (!x || x.wsId !== ws.id || x.memberId !== auth.memberId) return send(res, 404, { error: 'Not found' });
    if (m === 'POST' && (c === 'say' || c === 'check')) {
      const text = cleanText(body.text, 4000);
      if (c === 'say' && !text) return send(res, 400, { error: 'Write something first.' });
      const said = c === 'check' ? 'Check the cards I accepted: do they add up to the goal? What’s missing or unrealistic?' : text;
      x.messages.push({ role: 'user', text: said, at: Date.now(), check: c === 'check' || undefined });
      try {
        await skTurn(ws, auth, x, today, said);
      } catch (e) {
        x.messages.pop();
        throw e;
      }
      save();
      skNews(x);
      return send(res, 200, publicSidekick(x));
    }
    // A card accepted, skipped, edited, or built.
    if (m === 'PATCH' && c === 'cards' && d) {
      const card = x.messages.flatMap((y) => y.cards || []).find((y) => y.id === d);
      if (!card) return send(res, 404, { error: 'Not found' });
      if (['new', 'accepted', 'skipped', 'built'].includes(body.state)) card.state = body.state;
      if (body.card && typeof body.card === 'object') {
        const fresh = skCard({ ...card, ...body.card, type: card.type }, ws);
        if (!fresh) return send(res, 400, { error: 'That card is missing something it needs.' });
        Object.assign(card, fresh, { id: card.id, state: card.state });
      }
      x.updatedAt = Date.now();
      save();
      skNews(x);
      return send(res, 200, publicSidekick(x));
    }
    if (m === 'PATCH' && !c) {
      if (body.title !== undefined) x.title = cleanText(body.title, 80) || x.title;
      if (body.campaignId !== undefined) {
        const camp = db.campaigns[body.campaignId];
        x.campaignId = camp?.wsId === ws.id && canSee(auth, 'campaign', camp) ? camp.id : x.campaignId;
      }
      if (Array.isArray(body.entryIds)) x.entryIds = [...new Set([...x.entryIds, ...body.entryIds.filter((id) => db.entries[id]?.wsId === ws.id)])].slice(-200);
      if (body.built) x.status = 'built';
      if (body.status === 'done' || body.status === 'built') x.status = body.status;
      x.nudge = x.campaignId ? (skPace(db.campaigns[x.campaignId], today) ? { text: skPace(db.campaigns[x.campaignId], today), at: Date.now() } : null) : null;
      x.updatedAt = Date.now();
      save();
      skNews(x);
      return send(res, 200, publicSidekick(x));
    }
    if (m === 'DELETE' && !c) {
      delete db.sidekick[x.id];
      save();
      broadcast(ws.id, { type: 'sidekick:remove', id: x.id, forMember: x.memberId });
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  if (a === 'plans') {
    const mine = () => Object.values(db.plans).filter((x) => x.wsId === ws.id && x.memberId === auth.memberId).sort((p, q) => q.updatedAt - p.updatedAt);
    if (m === 'GET' && !b) return send(res, 200, mine().map(publicPlan));
    if (m === 'POST' && !b) {
      if (mine().length >= 200) return send(res, 400, { error: 'You can keep up to 200 plans. Delete some old ones first.' });
      const x = applyPlan({ id: rid(), wsId: ws.id, memberId: auth.memberId, by: auth.member, createdAt: Date.now(), name: 'Untitled plan', goal: '', notes: '', due: null, steps: [], needs: [], campaignId: null }, await readJson(req, 4_000_000));
      db.plans[x.id] = x;
      save();
      planNews(x);
      return send(res, 200, publicPlan(x));
    }
    const x = b && db.plans[b];
    if (!x || x.wsId !== ws.id || x.memberId !== auth.memberId) return send(res, 404, { error: 'Not found' });
    if (m === 'PATCH') {
      applyPlan(x, await readJson(req, 4_000_000));
      save();
      planNews(x);
      return send(res, 200, publicPlan(x));
    }
    if (m === 'DELETE') {
      delete db.plans[x.id];
      save();
      broadcast(ws.id, { type: 'plan:remove', id: x.id, forMember: x.memberId });
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }

  // Campaign email from your own Outlook. Owners only, since it reaches the PSS contacts.
  if (a === 'mail') {
    // Owners, and members when an owner allows it in Settings. Members email only rows of lists in their own
    // campaigns, with the team's footer, and see only their own sends.
    const owner = auth.role === 'owner';
    if (!owner && !ws.settings.memberEmail) return send(res, 403, { error: 'Only team owners can send campaign email. An owner can let members send it in Settings.' });
    const conn = mailConn(ws.id, auth.memberId);
    const body = m === 'GET' ? {} : await readJson(req, 2_000_000);
    if (m === 'GET' && !b) {
      const sends = Object.values(db.sends).filter((x) => x.wsId === ws.id && (owner || x.memberId === auth.memberId)).sort((p, q) => q.createdAt - p.createdAt).slice(0, MAIL_KEEP).map(publicSend);
      return send(res, 200, { from: conn?.account || null, canConnect: calProviders.microsoft.configured(), footer: ws.mailFooter || '', pss: !!db.pss[ws.id], sends });
    }
    if (m === 'PUT' && b === 'footer') {
      if (!owner) return send(res, 403, { error: 'Only team owners can change the footer.' });
      ws.mailFooter = mailFooter(body.footer);
      save();
      return send(res, 200, { footer: ws.mailFooter });
    }
    const subject = mailText(body.subject, 200).trim();
    const text = mailText(body.body, 20_000);
    if ((b === 'test' || (b === 'sends' && !c)) && m === 'POST') {
      if (!conn) return send(res, 400, { error: 'Connect Outlook to send from it first.' });
      if (!subject) return send(res, 400, { error: 'Add a subject.' });
      if (!text.trim()) return send(res, 400, { error: 'Write the message.' });
      const footer = owner ? mailFooter(body.footer ?? ws.mailFooter) : ws.mailFooter || '';
      if (!owner && !footer.trim()) return send(res, 400, { error: 'An owner needs to add the team’s footer (business and mailing address) first.' });
      if (footer !== ws.mailFooter) ws.mailFooter = footer;
      // A test comes to you, merged with the first person's name, with a placeholder unsubscribe link.
      if (b === 'test') {
        const r = { email: conn.account, name: cleanText(body.sample?.name, 200), first: cleanText(body.sample?.first, 80) };
        const unsub = '(each person gets their own unsubscribe link here)';
        try {
          await calProviders.microsoft.sendMail(await calToken(conn), mailMime(conn.account, r, '[Test] ' + merge(subject, r), mailBody({ body: text, footer }, r, unsub), unsub));
        } catch (e) {
          return send(res, 502, { error: e.auth ? 'Outlook’s sign-in expired. Connect it again.' : 'Outlook didn’t send it: ' + String(e.message).slice(0, 200) });
        }
        save();
        return send(res, 200, { to: conn.account });
      }
      // A campaign is optional: with one, each email is logged there.
      const camp = body.campaignId ? db.campaigns[body.campaignId] : null;
      if (body.campaignId && (!camp || camp.wsId !== ws.id || !canSee(auth, 'campaign', camp))) return send(res, 404, { error: 'Campaign not found' });
      if (Object.values(db.sends).some((x) => x.connId === conn.id && x.status === 'sending')) return send(res, 409, { error: 'An email is still going out from your Outlook. Wait for it, or stop it, first.' });
      // Each person once, and nobody who unsubscribed. People can come from PSS contacts (by lead), a list's
      // row (which must hold that address), or be typed in.
      const no = doNotEmail(ws.id);
      const leads = new Map((db.pss[ws.id]?.leads || []).map((y) => [y.id, y]));
      const seen = new Set();
      const to = [];
      for (const r of (Array.isArray(body.to) ? body.to : []).slice(0, MAIL_MAX * 2)) {
        const email = cleanText(r?.email, 200).toLowerCase();
        if (!EMAIL_RE.test(email) || seen.has(email)) continue;
        const l = r?.listId && db.lists[r.listId];
        const row = l && l.wsId === ws.id && canSee(auth, 'list', l) ? l.rows.find((y) => y.id === r.rowId && y.cells.some((v) => v.trim().toLowerCase() === email)) : null;
        const lead = leads.get(r?.leadId);
        if (!owner && !(row && onCampaign(db.campaigns[l.campaignId] || {}, auth.memberId))) continue;
        seen.add(email);
        if (no.has(email) || row?.dne || lead?.dne) continue;
        to.push({
          email, name: cleanText(r.name, 200), first: cleanText(r.first, 80),
          listId: row ? l.id : null, rowId: row ? row.id : null, leadId: lead && lead.email.toLowerCase() === email ? lead.id : row?.leadId || null, status: 'queued',
        });
      }
      if (!to.length) return send(res, 400, { error: owner ? 'Nobody here can be emailed.' : 'Nobody here can be emailed. Members can email people on lists in their own campaigns.' });
      if (to.length > MAIL_MAX) return send(res, 400, { error: `Send to up to ${MAIL_MAX} people at a time.` });
      const links = await unsubLinks(ws.id, to.map((r) => r.email));
      for (const r of to) r.unsub = links[r.email] || null;
      if (to.some((r) => !r.unsub)) return send(res, 502, { error: 'PSS didn’t give an unsubscribe link for everyone. Nothing was sent.' });
      const x = { id: rid(), wsId: ws.id, campaignId: camp?.id || null, listId: null, memberId: auth.memberId, by: auth.member, connId: conn.id, from: conn.account, subject, body: text, footer, createdAt: Date.now(), status: 'sending', to };
      db.sends[x.id] = x;
      // Old batches go, oldest first; the emails they logged stay in the campaign.
      const mine = Object.values(db.sends).filter((y) => y.wsId === ws.id && y.status !== 'sending').sort((p, q) => q.createdAt - p.createdAt);
      for (const y of mine.slice(MAIL_KEEP)) delete db.sends[y.id];
      save();
      sendNews(x);
      return send(res, 200, publicSend(x));
    }
    const x = b === 'sends' && c && db.sends[c];
    if (!x || x.wsId !== ws.id || (!owner && x.memberId !== auth.memberId)) return send(res, 404, { error: 'Not found' });
    if (m === 'POST' && d === 'stop' && (x.status === 'sending' || x.status === 'paused')) {
      for (const r of x.to) if (r.status === 'queued') r.status = 'stopped';
      x.status = 'stopped';
      x.doneAt = Date.now();
    } else if (m === 'POST' && d === 'resume' && x.status === 'paused') {
      if (!db.calendars[x.connId]?.mail) {
        const now = mailConn(ws.id, x.memberId);
        if (!now) return send(res, 400, { error: 'Connect Outlook again first.' });
        x.connId = now.id;
      }
      x.status = 'sending';
      x.error = null;
    } else if (m === 'DELETE' && x.status !== 'sending') {
      delete db.sends[x.id];
      save();
      broadcast(ws.id, { type: 'send:remove', id: x.id, forOwners: true });
      if (!isOwnerId(ws.id, x.memberId)) broadcast(ws.id, { type: 'send:remove', id: x.id, forMember: x.memberId });
      return send(res, 200, { ok: true });
    } else return send(res, 400, { error: 'That can’t be done now.' });
    save();
    sendNews(x);
    return send(res, 200, publicSend(x));
  }

  // The PSS admin connection and its contacts. Owners only.
  if (a === 'pss') {
    if (auth.role !== 'owner') return send(res, 403, { error: 'Only team owners can do that.' });
    if (m === 'GET' && !b) return send(res, 200, pssState(ws));
    if (m === 'PUT' && !b) {
      const body = await readJson(req);
      const url = pssUrl(body.url);
      const key = String(body.key || '').trim();
      if (!url) return send(res, 400, { error: 'Use the site’s https address, like https://premiershadesolutions.com' });
      if (!/^[\w-]{20,200}$/.test(key)) return send(res, 400, { error: 'That doesn’t look like a PSS key.' });
      await pssGet(url, key, '/api/column/leads?limit=1');
      db.pss[ws.id] = { url, sealed: seal({ key }), last4: key.slice(-4), by: auth.member, at: Date.now(), leads: [], dne: [] };
      await syncPss(ws);
      return send(res, 200, pssState(ws));
    }
    if (!db.pss[ws.id]) return send(res, 404, { error: 'PSS isn’t connected.' });
    if (m === 'POST' && b === 'sync') {
      await syncPss(ws);
      return send(res, 200, pssState(ws));
    }
    if (m === 'GET' && b === 'contacts') {
      const p = db.pss[ws.id];
      return send(res, 200, { syncedAt: p.syncedAt || null, stages: PSS_STAGES, leads: p.leads || [] });
    }
    // Live lists stop updating and keep the rows they had.
    if (m === 'DELETE' && !b) {
      delete db.pss[ws.id];
      save();
      broadcast(ws.id, { type: 'pss', forOwners: true });
      return send(res, 200, pssState(ws));
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
      const body = await readJson(req, 50_000);
      const camp = db.campaigns[g.campaignId];
      if ((body.skipped !== undefined || body.unlocked !== undefined) && !passesSteps(camp, auth)) return send(res, 403, { error: 'Only an owner can skip or unlock a step.' });
      const next = applyGoal({ ...g }, body, camp);
      if (body.skipped !== undefined) next.skipped = !!body.skipped;
      if (body.unlocked !== undefined) next.unlocked = !!body.unlocked;
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
        // The PSS lead it was, from a live list's row, or picked by an owner from the contacts.
        leadId: row?.leadId || (auth.role === 'owner' && db.pss[ws.id]?.leads?.some((y) => y.id === body.leadId) ? body.leadId : null),
        memberId: auth.memberId, by: auth.member, at: Date.now(), outcome,
        contact: String(body.contact || '').trim().slice(0, 200), note: String(body.note || '').trim().slice(0, 2000),
        // Answers to the campaign's question form, asked on this call.
        answers: (Array.isArray(body.answers) ? body.answers : []).slice(0, 40).map((x) => ({ q: cleanText(x?.q, 300), a: cleanText(x?.a, 2000) })).filter((x) => x.q && x.a),
      };
      db.attempts[x.id] = x;
      save();
      broadcast(ws.id, { type: 'attempt', attempt: publicAttempt(x) });
      if (x.leadId) pushPssSoon(ws.id);
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
      let l;
      if (body.live) {
        if (auth.role !== 'owner') return send(res, 403, { error: 'Only team owners can make lists from PSS.' });
        if (!db.pss[ws.id]) return send(res, 400, { error: 'Connect PSS in Settings first.' });
        l = fillLive(applyList({ id: rid(), wsId: ws.id, campaignId: c.id, itemId: null, by: auth.member, createdAt: Date.now(), kind: 'calls', live: applyLive(body.live), columns: [], rows: [] }, { name: body.name || 'PSS leads' }));
      } else l = applyList({ id: rid(), wsId: ws.id, campaignId: c.id, itemId: file && file.wsId === ws.id ? file.id : null, by: auth.member, createdAt: Date.now(), name: '', columns: [], rows: [] }, { name: 'List', ...body });
      db.lists[l.id] = l;
      save();
      broadcast(ws.id, { type: 'list', list: publicList(l) });
      return send(res, 200, publicList(l));
    }
    const l = b && db.lists[b];
    if (!l || l.wsId !== ws.id || !canSee(auth, 'list', l)) return send(res, 404, { error: 'Not found' });
    const done = () => {
      save();
      broadcast(ws.id, { type: 'list', list: publicList(l) });
      return send(res, 200, publicList(l));
    };
    // One row: its stage and note (trackers), or a cell (a quantity on a reference sheet).
    if (c === 'rows' && d && m === 'PATCH') {
      const row = l.rows.find((r) => r.id === d);
      if (!row) return send(res, 404, { error: 'Not found' });
      const body = await readJson(req, 20_000);
      if (body.stage !== undefined) row.stage = (l.stages || []).includes(body.stage) ? body.stage : null;
      if (body.note !== undefined) row.note = cleanText(body.note, 2000);
      if (body.cell !== undefined) {
        const i = Number(body.cell?.i);
        if (!(i >= 0 && i < l.columns.length)) return send(res, 400, { error: 'Bad column' });
        row.cells[i] = cleanText(body.cell.v, 300);
      }
      row.by = auth.member;
      row.at = Date.now();
      return done();
    }
    // Checklist runs: each time the checklist is worked through, with its own ticks and notes.
    if (c === 'runs' && l.kind === 'checklist') {
      l.runs ||= [];
      if (m === 'POST' && !d) {
        if (l.runs.length >= RUNS) return send(res, 400, { error: `A checklist keeps up to ${RUNS} runs. Delete some old ones first.` });
        const body = await readJson(req, 20_000);
        const run = { id: rid(8), name: cleanText(body.name, 80) || l.name, by: auth.member, createdAt: Date.now(), ticks: {}, notes: {}, cur: null, doneAt: null };
        l.runs.push(run);
        save();
        broadcast(ws.id, { type: 'list', list: publicList(l) });
        return send(res, 200, { list: publicList(l), run });
      }
      const run = d && l.runs.find((r) => r.id === d);
      if (!run) return send(res, 404, { error: 'Not found' });
      if (m === 'PATCH') {
        const body = await readJson(req, 50_000);
        const step = (id) => l.rows.some((r) => r.id === id);
        if (body.name !== undefined) run.name = cleanText(body.name, 80) || run.name;
        if (body.tick && step(body.tick.rowId)) {
          if (body.tick.on) run.ticks[body.tick.rowId] = { by: auth.member, at: Date.now() };
          else delete run.ticks[body.tick.rowId];
        }
        if (body.note && step(body.note.rowId)) {
          const t = cleanText(body.note.text, 4000);
          if (t) run.notes[body.note.rowId] = t;
          else delete run.notes[body.note.rowId];
        }
        // The agenda item being discussed right now, and since when.
        if (body.cur !== undefined) run.cur = body.cur && step(body.cur) ? { rowId: body.cur, at: Date.now() } : null;
        if (body.done !== undefined) run.doneAt = body.done ? Date.now() : null;
        return done();
      }
      if (m === 'DELETE') {
        l.runs = l.runs.filter((r) => r !== run);
        for (const t of Object.values(db.tasks)) {
          if (t.runId !== run.id) continue;
          t.runId = null;
          broadcast(ws.id, { type: 'task', task: publicTask(t) });
        }
        return done();
      }
    }
    if (c) return send(res, 404, { error: 'Not found' });
    if (m === 'PATCH') {
      const body = await readJson(req, 8_000_000);
      // A live list's rows come from PSS: only its name and (by an owner) its filter change.
      if (l.live) {
        if (body.live !== undefined && auth.role !== 'owner') return send(res, 403, { error: 'Only team owners can change what a PSS list shows.' });
        const next = fillLive(applyList({ ...l, live: body.live !== undefined ? applyLive(body.live) : l.live }, { name: body.name }));
        db.lists[l.id] = next;
        save();
        broadcast(ws.id, { type: 'list', list: publicList(next) });
        return send(res, 200, publicList(next));
      }
      const next = applyList({ ...l }, body);
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
    if (body.memberEmail !== undefined) {
      if (auth.role !== 'owner') return send(res, 403, { error: 'Only team owners can change who sends campaign email.' });
      ws.settings.memberEmail = !!body.memberEmail;
    }
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
        // Notes (text cards) are shared, like text files. Messages belong to whoever sent them.
        if (it.type !== 'text' && (it.type !== 'message' || !own)) return send(res, 403, { error: 'You can only edit your own messages.' });
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
    const word = isWordFile(it);
    if (!isTextFile(it) && !word) return send(res, 400, { error: 'Only text files and Word documents can be edited here.' });
    const tmp = path.join(FILES_DIR, '.edit-' + rid());
    const { size } = await receiveUpload(req, tmp);
    if (size > (word ? 100_000_000 : 5_000_000)) {
      await fsp.rm(tmp, { force: true });
      return send(res, 413, { error: 'Too big to edit here' });
    }
    // A Word document is a zip; anything else would leave a file Word can't open.
    if (word) {
      const fh = await fsp.open(tmp);
      const head = Buffer.alloc(4);
      await fh.read(head, 0, 4, 0);
      await fh.close();
      if (head.readUInt32LE(0) !== 0x04034b50) {
        await fsp.rm(tmp, { force: true });
        return send(res, 400, { error: 'That isn’t a Word document.' });
      }
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
  const files = ['index.html', 'app.js', 'style.css', 'pdfkit.js', 'wordkit.js'].map((f) => path.join(CLIENT_DIR, f));
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
  // Only Column's own script runs on its pages: markup that slips in from a file or message can't run code.
  const csp = path.extname(file) === '.html' ? { 'Content-Security-Policy': "script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'" } : {};
  // Libraries in /vendor/ have their version in the folder name, so they never change.
  const cache = rel.startsWith('/vendor/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache, ...csp });
  });
}

// ---------- moving in: a one-time upload of another Column's data folder ----------
// Only when IMPORT_TOKEN is set (24+ characters) and this Column has no teams yet. The body is a .tar.gz
// of the data folder (db.json, secret.key, files/). Afterwards the server exits so the host restarts it
// on the new data; then remove IMPORT_TOKEN.
async function importData(req, res) {
  const token = process.env.IMPORT_TOKEN || '';
  const given = String(req.headers.authorization || '').replace(/^Bearer /, '');
  const same = token.length >= 24 && given.length === token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
  if (!same) return send(res, 404, 'Not found');
  if (importing || Object.keys(db.workspaces).length) return send(res, 409, { error: 'This Column already has data.' });
  importing = true;
  clearTimeout(saveTimer);
  dirtySince = 0;
  const { spawn } = await import('node:child_process');
  const tar = spawn('tar', ['-xzf', '-', '--no-same-owner', '-C', DATA_DIR], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  tar.stderr.on('data', (d) => (err += d));
  req.pipe(tar.stdin);
  tar.on('close', (code) => {
    if (code !== 0) {
      importing = false;
      return send(res, 500, { error: 'Unpacking failed: ' + err.slice(0, 300) });
    }
    send(res, 200, { ok: true, restarting: true });
    console.log('Imported data. Restarting to load it.');
    setTimeout(() => process.exit(1), 500);
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
  if (url.pathname === '/import' && req.method === 'POST') return importData(req, res);
  if (url.pathname.startsWith('/s/') && (req.method === 'GET' || req.method === 'HEAD')) return serveShare(req, res, url);
  if (url.pathname.startsWith('/sign/') && req.method === 'GET') {
    // The signing page; the token in the address stays out of other sites' logs and search results.
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex');
    return serveStatic(req, res, new URL('/sign.html', 'http://x'));
  }
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
setInterval(syncAllPss, 60_000);
setInterval(mailTick, MAIL_GAP);
setInterval(runAutopay, 10 * 60_000);
setInterval(runSidekickPace, 30 * 60_000);

// ---------- backups: a copy of the data file each day, the last 14 kept next to it ----------
// They guard against a bad write or a mistake; the host's volume backups guard against losing the disk.
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
function backupDb() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const file = path.join(BACKUP_DIR, `db-${dayKey(new Date())}.json`);
    if (fs.existsSync(file) || !fs.existsSync(DB_PATH)) return;
    writeNow();
    fs.copyFileSync(DB_PATH, file);
    for (const old of fs.readdirSync(BACKUP_DIR).filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -14)) fs.rmSync(path.join(BACKUP_DIR, old));
  } catch (e) {
    console.error('Backup failed:', e.message);
  }
}
setInterval(backupDb, 60 * 60_000);
backupDb();
// A recording whose page went away (closed, crashed) is wrapped up with what arrived.
setInterval(() => {
  for (const x of Object.values(db.meetings)) {
    if (x.status !== 'recording' || Date.now() - x.touched < 2 * 60_000) continue;
    x.endedAt = x.touched;
    if (x.bytes >= 2000) processMeeting(x);
    else {
      x.status = 'failed';
      x.error = 'Nothing was recorded.';
      fs.promises.rm(meetPath(x), { force: true }).catch(() => {});
      save();
      meetNews(x);
    }
  }
}, 60_000);
runAutopay();

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
