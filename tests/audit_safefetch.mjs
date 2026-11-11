// Audit (outbound requests, docs/audit/FINDINGS.md E1/E3): server/safefetch.js refuses private and other non-public
// addresses (IPv4 inside IPv6 too), plain http, and names that resolve privately; checks happen at connect time;
// redirects aren't followed unless asked; replies are cut off at a size limit.
import http from 'node:http';
import { privateIp, checkPublicUrl, safeFetch } from '../server/safefetch.js';
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const blocked = ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1', '255.255.255.255',
  '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:172.17.0.1', '::ffff:a9fe:a9fe', '64:ff9b::a9fe:a9fe', '::127.0.0.1', 'ff02::1'];
const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700::6810:85e5', '172.32.0.1', '192.169.0.1'];
ok(blocked.every(privateIp), 'E3 every private, loopback, link-local, metadata, mapped and multicast address is refused: ' + blocked.filter((x) => !privateIp(x)).join(', '));
ok(!allowed.some(privateIp), 'E3 public addresses are allowed: ' + allowed.filter(privateIp).join(', '));
const refuses = async (u, opts) => { try { await checkPublicUrl(u, opts); return false; } catch { return true; } };
ok(await refuses('http://example.com/'), 'E1 plain http is refused');
ok(await refuses('https://127.0.0.1/'), 'E1 an IP address on this machine is refused');
ok(await refuses('https://[::ffff:169.254.169.254]/'), 'E3 the metadata address written as IPv6 is refused');
ok(await refuses('https://localhost/'), 'E1 a name that resolves to this machine is refused');
ok(await refuses('https://user:pw@example.com/'), 'E1 an address with a user name and password in it is refused');
ok(await refuses('ftp://example.com/'), 'E1 other kinds of address are refused');

// The connection itself refuses: even with the check skipped for the address, connecting to a private one fails.
const srv = http.createServer((req, res) => {
  if (req.url === '/big') { res.writeHead(200); res.end(Buffer.alloc(3_000_000)); return; }
  if (req.url === '/go') { res.writeHead(302, { location: '/end' }); return res.end(); }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
}).listen(4909, '127.0.0.1');
await new Promise((r) => srv.on('listening', r));
let r = await safeFetch('http://127.0.0.1:4909/', { allowLocal: true });
ok(r.ok && (await r.json()).ok, '(test server answers when local addresses are allowed, as in tests)');
let err = null;
try { await safeFetch('http://localhost:4909/', { httpsOnly: false }); } catch (e) { err = e; }
ok(err && /private network/.test(err.message), 'E3 connecting to a name that resolves to this machine fails at connect time');
r = await safeFetch('http://127.0.0.1:4909/go', { allowLocal: true });
ok(r.status === 302, 'E1 redirects aren’t followed unless asked');
err = null;
try { await safeFetch('http://127.0.0.1:4909/big', { allowLocal: true, maxBytes: 1_000_000 }); } catch (e) { err = e; }
ok(err && /too big/.test(err.message), 'E1 a reply bigger than the limit is cut off');
srv.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
