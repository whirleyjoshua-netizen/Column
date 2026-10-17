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
let db = { workspaces: {}, tokens: {}, items: {}, entries: {}, tasks: {} };
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

const publicWorkspace = (ws) => ({
  id: ws.id,
  name: ws.name,
  settings: ws.settings,
  stacks: ws.stacks,
  channels: ws.channels,
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

function removeItemFiles(it) {
  if (it.type === 'file') fsp.rm(path.join(FILES_DIR, it.id), { force: true }).catch(() => {});
  if (it.type === 'folder') for (const f of it.files || []) fsp.rm(path.join(FILES_DIR, f.fid), { force: true }).catch(() => {});
}

function deleteItem(id) {
  const it = db.items[id];
  if (!it) return;
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

function validStack(ws, stackId) {
  return stackId && ws.stacks.some((s) => s.id === stackId) ? stackId : null;
}

// Chat feeds (#channels), optionally grouped into folders. Items with a channelId live only in that feed.
function validChannel(ws, channelId) {
  return channelId && ws.channels.some((c) => c.id === channelId) ? channelId : null;
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
  const data = JSON.stringify(msg);
  for (const s of set) if (s.readyState === 1) s.send(data);
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
    if (mode !== 'signin') broadcast(ws.id, { type: 'workspace', workspace: publicWorkspace(ws) });
    return send(res, 200, { token, workspace: publicWorkspace(ws) });
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
      .filter((it) => it.wsId === ws.id && it.status === 'ready')
      .sort((x, y) => x.createdAt - y.createdAt)
      .map(publicItem);
    return send(res, 200, {
      workspace: publicWorkspace(ws),
      me: { memberId: auth.memberId, member: auth.member, device: auth.device, deviceId: auth.deviceId },
      items,
      entries: Object.values(db.entries).filter((e) => e.wsId === ws.id).map(publicEntry),
      tasks: Object.values(db.tasks).filter((t) => t.wsId === ws.id).map(publicTask),
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
    if (!e || e.wsId !== ws.id) return send(res, 404, { error: 'Not found' });
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
      const t = applyTask({ id: rid(), wsId: ws.id, by: auth.member, createdAt: Date.now(), text: '', done: false, doneAt: null }, await readJson(req, 50_000));
      db.tasks[t.id] = t;
      save();
      broadcast(ws.id, { type: 'task', task: publicTask(t) });
      return send(res, 200, publicTask(t));
    }
    const t = b && db.tasks[b];
    if (!t || t.wsId !== ws.id) return send(res, 404, { error: 'Not found' });
    if (m === 'PATCH') {
      const next = applyTask({ ...t }, await readJson(req, 50_000));
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
      delete db.tasks[t.id];
      for (const e of Object.values(db.entries)) {
        if (e.taskId === t.id) {
          e.taskId = null;
          broadcast(ws.id, { type: 'entry', entry: publicEntry(e) });
        }
      }
      save();
      broadcast(ws.id, { type: 'task:remove', id: t.id });
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
    broadcast(ws.id, { type: 'workspace', workspace: publicWorkspace(ws) });
    return send(res, 200, publicWorkspace(ws));
  }

  if (a === 'invite' && m === 'POST') {
    if (auth.role !== 'owner') return send(res, 403, { error: 'Only team owners can do that.' });
    ws.inviteCode = newInviteCode();
    save();
    broadcast(ws.id, { type: 'workspace', workspace: publicWorkspace(ws) });
    return send(res, 200, publicWorkspace(ws));
  }

  if (a === 'workspace' && m === 'PATCH') {
    const body = await readJson(req);
    if (body.expireHours !== undefined) ws.settings.expireHours = Math.max(0, Number(body.expireHours) || 0);
    save();
    broadcast(ws.id, { type: 'workspace', workspace: publicWorkspace(ws) });
    return send(res, 200, publicWorkspace(ws));
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
      ws.stacks = ws.stacks.filter((x) => x.id !== b);
      for (const it of Object.values(db.items)) {
        if (it.wsId === ws.id && it.stackId === b) {
          it.stackId = null;
          broadcast(ws.id, { type: 'item:update', item: publicItem(it) });
        }
      }
    } else return send(res, 405, { error: 'Method not allowed' });
    save();
    broadcast(ws.id, { type: 'workspace', workspace: publicWorkspace(ws) });
    return send(res, 200, publicWorkspace(ws));
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
      ws.channels = ws.channels.filter((x) => x.id !== b);
      for (const it of Object.values(db.items)) if (it.wsId === ws.id && it.channelId === b) deleteItem(it.id);
    } else return send(res, 405, { error: 'Method not allowed' });
    save();
    broadcast(ws.id, { type: 'workspace', workspace: publicWorkspace(ws) });
    return send(res, 200, publicWorkspace(ws));
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
    broadcast(ws.id, { type: 'workspace', workspace: publicWorkspace(ws) });
    return send(res, 200, publicWorkspace(ws));
  }

  if (a === 'items') {
    if (m === 'POST' && !b) {
      const { type, text, stackId, channelId } = await readJson(req, 300_000);
      if (!['text', 'message'].includes(type)) return send(res, 400, { error: 'Bad type' });
      const t = String(text || '').slice(0, 200_000);
      if (!t.trim()) return send(res, 400, { error: 'Empty' });
      const item = addItem(baseItem(auth, { type, text: t, stackId: validStack(ws, stackId), channelId: validChannel(ws, channelId) }));
      if (type === 'message') pinLinked(ws, t);
      return send(res, 200, publicItem(item));
    }
    const it = b && db.items[b];
    if (!it || it.wsId !== ws.id) return send(res, 404, { error: 'Not found' });
    if (m === 'PATCH') {
      const body = await readJson(req);
      if (body.pinned !== undefined) it.pinned = !!body.pinned;
      if (body.stackId !== undefined) it.stackId = validStack(ws, body.stackId);
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
      deleteItem(it.id);
      return send(res, 200, { ok: true });
    }
  }

  if (a === 'clear' && m === 'POST') {
    for (const it of Object.values(db.items)) if (it.wsId === ws.id && !it.pinned) deleteItem(it.id);
    return send(res, 200, { ok: true });
  }

  // Single file: PUT raw body. Folder file: PUT with ?folder=<id>&relPath=...
  if (a === 'upload' && (m === 'PUT' || m === 'POST')) {
    const folderId = url.searchParams.get('folder');
    if (folderId) {
      const folder = db.items[folderId];
      if (!folder || folder.wsId !== ws.id || folder.type !== 'folder' || folder.status !== 'uploading') {
        return send(res, 404, { error: 'Folder not found' });
      }
      const relPath = String(url.searchParams.get('relPath') || 'file')
        .replace(/\\/g, '/')
        .split('/')
        .filter((p) => p && p !== '.' && p !== '..')
        .join('/');
      const fid = rid();
      const { size, crc } = await receiveUpload(req, path.join(FILES_DIR, fid));
      folder.files.push({ fid, relPath, size, crc, mtime: Number(url.searchParams.get('mtime')) || Date.now() });
      folder.size = folder.files.reduce((n, f) => n + f.size, 0);
      save();
      return send(res, 200, { ok: true });
    }
    const name = String(url.searchParams.get('name') || 'file').replace(/[\/\\]/g, '_').slice(0, 255);
    const id = rid();
    const { size } = await receiveUpload(req, path.join(FILES_DIR, id));
    const item = addItem({
      ...baseItem(auth, { type: 'file', name, size, mime: mimeFor(name, url.searchParams.get('type')) }),
      id,
      stackId: validStack(ws, url.searchParams.get('stackId')),
      channelId: validChannel(ws, url.searchParams.get('channelId')),
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
          stackId: validStack(ws, stackId),
          channelId: validChannel(ws, channelId),
        })
      );
      return send(res, 200, { id: item.id });
    }
    const folder = b && db.items[b];
    if (!folder || folder.wsId !== ws.id || folder.type !== 'folder') return send(res, 404, { error: 'Not found' });
    if (c === 'done' && m === 'POST') {
      folder.status = 'ready';
      folder.createdAt = Date.now();
      save();
      broadcast(ws.id, { type: 'item:add', item: publicItem(folder) });
      return send(res, 200, publicItem(folder));
    }
    if (c === 'zip' && (m === 'GET' || m === 'HEAD')) {
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
      if (m === 'HEAD') return res.end();
      return streamZip(res, entries).catch(() => res.destroy());
    }
    if (c === 'files' && d !== undefined && (m === 'GET' || m === 'HEAD')) {
      const f = folder.files[Number(d)];
      if (!f) return send(res, 404, { error: 'Not found' });
      const name = path.basename(f.relPath);
      return serveFile(req, res, path.join(FILES_DIR, f.fid), { name, mime: mimeFor(name), download: url.searchParams.has('dl') });
    }
  }

  if (a === 'files' && b && (m === 'GET' || m === 'HEAD')) {
    const it = db.items[b];
    if (!it || it.wsId !== ws.id || it.type !== 'file') return send(res, 404, { error: 'Not found' });
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
