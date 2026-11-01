// Where Column's data is kept: the db.json file next to the server, or Postgres when DATABASE_URL is set.
// Either way the server keeps everything in memory and hands the whole object to write(). In Postgres
// each record (a task, an item, a team…) is one row, and a write sends only the records that changed
// since the last one, in one transaction.
//
// Only one server may write. Starting up claims the database (column_meta 'owner'); every write checks
// the claim in the same transaction, so a server that has been replaced stops instead of writing over
// the new one's data. Nothing holds a connection open, so Neon can sleep when nobody's using Column.
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';

const CHUNK = 4 * 1024 * 1024; // characters of JSON per statement

// Postgres refuses two things JSON allows in strings: the NUL character and half of a surrogate pair.
// Both can arrive in pasted text; they become nothing and the replacement character.
function pgSafe(s) {
  if (!s.includes('\\u')) return s;
  return s
    .replace(/((?:^|[^\\])(?:\\\\)*)\\u0000/g, '$1')
    .replace(/\\u(d[89ab][0-9a-f]{2})(?!\\ud[c-f][0-9a-f]{2})/gi, '\\ufffd')
    .replace(/(?<!\\ud[89ab][0-9a-f]{2})\\u(d[c-f][0-9a-f]{2})/gi, '\\ufffd');
}

const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);

export class Fenced extends Error {}

export async function openStore({ url, file, importFile }) {
  if (!url) return fileStore(file);
  const pool = new pg.Pool({ connectionString: url, max: 2, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000 });
  pool.on('error', () => {}); // an idle connection dropped (Neon went to sleep); the next query reconnects
  const me = crypto.randomUUID();
  const cache = new Map(); // "coll\0id" -> the JSON last written
  const status = { mode: 'postgres', lastWrite: null, lastError: null, rows: 0 };

  await pool.query(`create table if not exists column_records (
    coll text not null, id text not null, ws_id text, data jsonb not null,
    updated_at timestamptz not null default now(), primary key (coll, id))`);
  await pool.query('create index if not exists column_records_ws on column_records (ws_id)');
  await pool.query('create table if not exists column_meta (key text primary key, value text not null)');

  // Take over. The row lock waits for a write the old server has in flight, so we load after it lands.
  await pool.query(`insert into column_meta (key, value) values ('owner', $1)
    on conflict (key) do update set value = excluded.value`, [me]);

  async function load() {
    const { rows } = await pool.query('select coll, id, data from column_records');
    const meta = Object.fromEntries((await pool.query('select key, value from column_meta')).rows.map((r) => [r.key, r.value]));
    const db = {};
    for (const r of rows) {
      cache.set(r.coll + '\0' + r.id, pgSafe(JSON.stringify(r.data)));
      if (r.coll === '_root') db[r.id] = r.data;
      else (db[r.coll] ||= {})[r.id] = r.data;
    }
    status.rows = rows.length;
    // First start on Postgres, or a team's data imported as a file: the file wins, once.
    const fromFile = (importFile && fs.existsSync(importFile)) ? importFile : !meta.moved_at && fs.existsSync(file) ? file : null;
    if (fromFile) {
      const data = JSON.parse(fs.readFileSync(fromFile, 'utf8'));
      return { db: data, fromFile };
    }
    return { db: rows.length || meta.moved_at ? db : null, fromFile: null };
  }

  async function write(db) {
    // Worked out right away, so later changes in memory don't mix into this write.
    const seen = new Set();
    const up = [];
    for (const [coll, v] of Object.entries(db)) {
      const entries = isMap(v) ? Object.entries(v) : [[coll, v]];
      const c = isMap(v) ? coll : '_root';
      for (const [id, rec] of entries) {
        const s = JSON.stringify(rec);
        if (s === undefined) continue;
        const key = c + '\0' + id;
        seen.add(key);
        const safe = pgSafe(s);
        if (cache.get(key) === safe) continue;
        const ws = c === 'workspaces' ? id : typeof rec?.wsId === 'string' ? rec.wsId : null;
        up.push({ key, json: `{"c":${JSON.stringify(c)},"i":${JSON.stringify(id)},"w":${JSON.stringify(ws)},"d":${safe}}`, safe });
      }
    }
    const gone = [...cache.keys()].filter((k) => !seen.has(k));
    if (!up.length && !gone.length) return { changed: 0, removed: 0 };

    const client = await pool.connect();
    try {
      await client.query('begin');
      const own = await client.query(`select value from column_meta where key = 'owner' for update`);
      if (own.rows[0]?.value !== me) throw new Fenced('Another server has taken over this database.');
      for (const part of chunks(up.map((x) => x.json))) {
        await client.query(`insert into column_records (coll, id, ws_id, data, updated_at)
          select x.c, x.i, x.w, x.d, now() from jsonb_to_recordset($1::jsonb) as x(c text, i text, w text, d jsonb)
          on conflict (coll, id) do update set ws_id = excluded.ws_id, data = excluded.data, updated_at = now()`, ['[' + part.join(',') + ']']);
      }
      for (const part of chunks(gone.map((k) => { const [c, i] = k.split('\0'); return JSON.stringify({ c, i }); }))) {
        await client.query(`delete from column_records r using jsonb_to_recordset($1::jsonb) as x(c text, i text)
          where r.coll = x.c and r.id = x.i`, ['[' + part.join(',') + ']']);
      }
      await client.query(`insert into column_meta (key, value) values ('moved_at', $1) on conflict (key) do nothing`, [new Date().toISOString()]);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      status.lastError = { at: Date.now(), message: e.message };
      throw e;
    } finally {
      client.release();
    }
    for (const x of up) cache.set(x.key, x.safe);
    for (const k of gone) cache.delete(k);
    status.rows = cache.size;
    status.lastWrite = Date.now();
    status.lastError = null;
    return { changed: up.length, removed: gone.length };
  }

  return { mode: 'postgres', load, write, status: () => ({ ...status }), close: () => pool.end() };
}

function* chunks(list) {
  let part = [], size = 0;
  for (const s of list) {
    if (part.length && size + s.length > CHUNK) {
      yield part;
      part = [];
      size = 0;
    }
    part.push(s);
    size += s.length;
  }
  if (part.length) yield part;
}

function fileStore(file) {
  const status = { mode: 'file', lastWrite: null, lastError: null };
  return {
    mode: 'file',
    async load() {
      try {
        return { db: JSON.parse(fs.readFileSync(file, 'utf8')), fromFile: null };
      } catch {
        return { db: null, fromFile: null };
      }
    },
    async write(db) {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, file);
      status.lastWrite = Date.now();
      return {};
    },
    status: () => ({ ...status }),
    close: async () => {},
  };
}
