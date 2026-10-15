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
let db = { workspaces: {}, tokens: {}, items: {} };
try {
  db = { ...db, ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
} catch {}

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
  const session = token && db.tokens[token];
  if (!session || !db.workspaces[session.wsId]) return null;
  return { token, ...session, ws: db.workspaces[session.wsId] };
}

const publicWorkspace = (ws) => ({ id: ws.id, name: ws.name, settings: ws.settings, stacks: ws.stacks });

function publicItem(it) {
  const { wsId, files, ...rest } = it;
  if (files) rest.files = files.map((f, i) => ({ i, relPath: f.relPath, size: f.size }));
  return rest;
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
    device: auth.device,
    deviceId: auth.deviceId,
    createdAt: Date.now(),
    pinned: false,
    stackId: null,
    status: 'ready',
    ...fields,
  };
}

function validStack(ws, stackId) {
  return stackId && ws.stacks.some((s) => s.id === stackId) ? stackId : null;
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
  for (const s of sockets.get(wsId) || []) seen.set(s.meta.deviceId, { deviceId: s.meta.deviceId, device: s.meta.device, member: s.meta.member });
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
    const { workspace, passphrase, name, device, deviceId, mode } = await readJson(req);
    const slug = slugify(workspace);
    if (!slug || slug.length > 60) return send(res, 400, { error: 'Enter an account or team name.' });
    if (!passphrase || String(passphrase).length < 4) return send(res, 400, { error: 'Passphrase must be at least 4 characters.' });
    let ws = Object.values(db.workspaces).find((w) => w.slug === slug);
    if (mode === 'create') {
      if (ws) return send(res, 409, { error: 'That name is taken. Join it instead, or pick another name.' });
      const salt = rid(16);
      ws = {
        id: rid(),
        name: String(workspace).trim(),
        slug,
        salt,
        hash: hashPass(passphrase, salt),
        createdAt: Date.now(),
        settings: { expireHours: 0 },
        stacks: [],
      };
      db.workspaces[ws.id] = ws;
    } else {
      if (!ws) return send(res, 404, { error: 'No account or team with that name. Create it instead?' });
      const ok = crypto.timingSafeEqual(Buffer.from(hashPass(passphrase, ws.salt), 'hex'), Buffer.from(ws.hash, 'hex'));
      if (!ok) return send(res, 401, { error: 'Wrong passphrase.' });
    }
    const token = rid(24);
    db.tokens[token] = {
      wsId: ws.id,
      member: String(name || 'Me').trim().slice(0, 40) || 'Me',
      device: String(device || 'Device').trim().slice(0, 40) || 'Device',
      deviceId: String(deviceId || rid()).slice(0, 64),
      createdAt: Date.now(),
    };
    save();
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
      me: { member: auth.member, device: auth.device, deviceId: auth.deviceId },
      items,
    });
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

  if (a === 'items') {
    if (m === 'POST' && !b) {
      const { type, text, stackId } = await readJson(req, 300_000);
      if (!['text', 'message'].includes(type)) return send(res, 400, { error: 'Bad type' });
      const t = String(text || '').slice(0, 200_000);
      if (!t.trim()) return send(res, 400, { error: 'Empty' });
      const item = addItem(baseItem(auth, { type, text: t, stackId: validStack(ws, stackId) }));
      return send(res, 200, publicItem(item));
    }
    const it = b && db.items[b];
    if (!it || it.wsId !== ws.id) return send(res, 404, { error: 'Not found' });
    if (m === 'PATCH') {
      const body = await readJson(req);
      if (body.pinned !== undefined) it.pinned = !!body.pinned;
      if (body.stackId !== undefined) it.stackId = validStack(ws, body.stackId);
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
    });
    return send(res, 200, publicItem(item));
  }

  if (a === 'folders') {
    if (m === 'POST' && !b) {
      const { name, stackId } = await readJson(req);
      const item = addItem(
        baseItem(auth, {
          type: 'folder',
          name: String(name || 'Folder').replace(/[\/\\]/g, '_').slice(0, 255),
          size: 0,
          files: [],
          status: 'uploading',
          stackId: validStack(ws, stackId),
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
    s.meta = { wsId: auth.wsId, member: auth.member, device: auth.device, deviceId: auth.deviceId };
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Column server running\n`);
  console.log(`  This machine:   http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) if (n.family === 'IPv4' && !n.internal) console.log(`  Other devices:  http://${n.address}:${PORT}`);
  }
  console.log(`\n  Data stored in ${DATA_DIR}\n`);
});
