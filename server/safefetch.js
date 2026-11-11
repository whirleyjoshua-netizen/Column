// Requests to addresses a team typed in (a self-hosted Postiz, webhook receivers, their website, the PSS connector).
// The address is checked when the connection is made, by the lookup the connection itself uses, so a name can't pass
// the check and then point somewhere private (DNS rebinding). Private, loopback, link-local, metadata and other
// non-public ranges are refused, IPv4 written inside IPv6 included. Redirects aren't followed unless asked, and each
// hop is checked the same way. Replies are cut off at a size limit, and everything has a timeout.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

const v4 = (ip) => ip.split('.').map(Number);
function privateV4(ip) {
  const [a, b, c] = v4(ip);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) || a >= 224;
}
// An IPv6 address with an IPv4 address inside it (mapped ::ffff:a.b.c.d or ::ffff:0102:0304, compatible ::a.b.c.d, NAT64 64:ff9b::).
function embeddedV4(ip) {
  const s = ip.toLowerCase();
  const dotted = /^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
  if (hex) { const x = parseInt(hex[1], 16), y = parseInt(hex[2], 16); return `${x >> 8}.${x & 255}.${y >> 8}.${y & 255}`; }
  return null;
}
export function privateIp(ip) {
  if (net.isIPv4(ip)) return privateV4(ip);
  if (!net.isIPv6(ip)) return true;
  const inner = embeddedV4(ip);
  if (inner) return privateV4(inner);
  const s = ip.toLowerCase();
  return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || s.startsWith('2001:db8') || s.startsWith('2001:10:') || s.startsWith('2001:2:') || s.startsWith('100::') || s.startsWith('::ffff:');
}
const fail = (msg, code = 'BLOCKED') => Object.assign(new Error(msg), { code });

// A dns.lookup that refuses non-public addresses; used by the connection itself.
function safeLookup(hostname, opts, cb) {
  dns.lookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: opts.family || 4 }];
    if (!list.length) return cb(fail(`Couldn’t find ${hostname}.`, 'ENOTFOUND'));
    if (list.some((x) => privateIp(x.address))) return cb(fail('That address is on a private network.'));
    if (opts.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

// Checks a typed-in address before saving it: a public https site (any port only when allowLocal).
export async function checkPublicUrl(raw, { allowLocal = false, httpsOnly = true } = {}) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw fail('That isn’t a full web address.', 'BAD_URL'); }
  if (!/^https?:$/.test(u.protocol)) throw fail('The address must start with https://', 'BAD_URL');
  if (allowLocal) return u;
  if (httpsOnly && u.protocol !== 'https:') throw fail('The address must start with https://', 'BAD_URL');
  if (u.username || u.password) throw fail('Leave the user name and password out of the address.', 'BAD_URL');
  if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && privateIp(u.hostname.replace(/^\[|\]$/g, ''))) throw fail('That address is on a private network.');
  const addrs = await dns.promises.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw fail(`Couldn’t find ${u.hostname}.`, 'ENOTFOUND');
  if (addrs.some((x) => privateIp(x.address))) throw fail('That address is on a private network.');
  return u;
}

// fetch-like: resolves to { status, ok, statusText, headers (lower-case object), url, text(), json() }.
// opts: method, headers, body (string or Buffer), timeout (ms), maxBytes, redirects (how many to follow, default 0),
// allowLocal (tests only), httpsOnly (default true).
export async function safeFetch(raw, opts = {}) {
  const { method = 'GET', headers = {}, body, timeout = 15_000, maxBytes = 2_000_000, redirects = 0, allowLocal = false, httpsOnly = true, truncate = false } = opts;
  let url = await checkPublicUrl(raw, { allowLocal, httpsOnly });
  for (let hop = 0; ; hop++) {
    const r = await once(url, { method, headers, body, timeout, maxBytes, allowLocal, truncate });
    if (r.status >= 300 && r.status < 400 && r.headers.location && hop < redirects) {
      url = await checkPublicUrl(new URL(r.headers.location, url).toString(), { allowLocal, httpsOnly });
      continue;
    }
    return r;
  }
}
function once(u, { method, headers, body, timeout, maxBytes, allowLocal, truncate }) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method, headers, timeout, ...(allowLocal ? {} : { lookup: safeLookup }) }, (res) => {
      const chunks = [];
      let n = 0, done = false;
      const finish = () => {
        if (done) return;
        done = true;
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, statusText: res.statusMessage || '', headers: res.headers, url: u.toString(),
          text: async () => buf.toString('utf8'), json: async () => JSON.parse(buf.toString('utf8')), buffer: async () => buf });
      };
      res.on('data', (c) => {
        if (done) return;
        n += c.length;
        if (n > maxBytes) {
          // Either keep what fits (truncate: a web page read for its words) or refuse the whole reply.
          if (truncate) { chunks.push(c.subarray(0, c.length - (n - maxBytes))); finish(); req.destroy(); return; }
          req.destroy(fail('The reply was too big.', 'TOO_BIG'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', finish);
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Timed out'), { name: 'TimeoutError', code: 'TIMEOUT' })));
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}
