// The website for search engines (the 2026-11 SEO audit): a page that isn't there on the website's address is a real
// 404 with a way home (the app's own addresses there still go to the app); pages and data come compressed (brotli,
// else gzip) when the browser takes it; pictures are kept for a day and the app's files are checked with an ETag
// (304 when unchanged); the sitemap says when each page last changed; the home page's description fits a search
// result and its heading says what Kloomie is; the download page's title says where it runs.
import fs from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
const S = (await import('node:path')).resolve(process.argv[2] || '.');
const DIR = S + '/dk/seo';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const PORT = 4845;
const SITE = 'www.example.test', APPH = 'app.example.test';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const srv = spawn('node', ['index.js'], { cwd: new URL('../server', import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: `https://${APPH}`, SITE_HOST: SITE, DATA_DIR: DIR, MAIL_OUTBOX: '1', RESEND_API_KEY: '', DATABASE_URL: '', STRIPE_SECRET_KEY: '', SKIP_SETUP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
srv.log = ''; srv.stdout.on('data', (d) => (srv.log += d)); srv.stderr.on('data', (d) => (srv.log += d));
// A request as if to one of the addresses (Host), with the headers given; the body as it came (still compressed).
const get = (host, p, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET', headers: { host, ...headers } }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks) }));
  });
  req.on('error', reject);
  req.end();
});
const text = (r) => { const e = r.headers['content-encoding']; return (e === 'br' ? zlib.brotliDecompressSync(r.raw) : e === 'gzip' ? zlib.gunzipSync(r.raw) : r.raw).toString('utf8'); };
try {
  for (let i = 0; i < 100; i++) { try { if ((await get(APPH, '/api/health')).status === 200) break; } catch {} await sleep(150); }

  // Pages that aren't there.
  let r = await get(SITE, '/blog');
  ok(r.status === 404 && /<a [^>]*href="\/"/.test(text(r)) && /text\/html/.test(r.headers['content-type']), `a page that isn't on the website is a real 404, with a link home (${r.status})`);
  r = await get(SITE, '/pricing/plans');
  ok(r.status === 404, 'so is one deeper down');
  for (const p of ['/c/rico', '/q/abc123', '/join/xyz', '/sign/tok', '/s/tok']) {
    r = await get(SITE, p);
    ok(r.status === 302 && r.headers.location === `https://${APPH}${p}`, `the app’s own address ${p} still goes to the app`);
  }
  r = await get(APPH, '/blog');
  ok(r.status === 200 && r.headers['x-robots-tag'] === 'noindex', 'on the app’s address it’s still the app, kept out of search');
  r = await get(SITE, '/help');
  ok(r.status === 200 && /rel="canonical"/.test(r.headers.link || ''), 'Help is there, naming itself as the copy to index');

  // Compression.
  r = await get(SITE, '/', { 'accept-encoding': 'gzip, deflate, br' });
  ok(r.headers['content-encoding'] === 'br' && /<title>/.test(text(r)) && r.raw.length < 20000, `the home page comes compressed with brotli (${r.raw.length} bytes)`);
  ok(/accept-encoding/i.test(r.headers.vary || ''), 'and says it varies by what the browser takes');
  r = await get(SITE, '/', { 'accept-encoding': 'gzip' });
  ok(r.headers['content-encoding'] === 'gzip' && /<title>/.test(text(r)), 'with gzip for a browser that only takes that');
  r = await get(SITE, '/');
  ok(!r.headers['content-encoding'] && /<title>/.test(r.raw.toString()), 'and plain for one that takes neither');
  r = await get(APPH, '/app.js', { 'accept-encoding': 'br' });
  ok(r.headers['content-encoding'] === 'br' && text(r).length > 100000, 'the app’s script comes compressed');
  r = await get(APPH, '/og.jpg', { 'accept-encoding': 'br, gzip' });
  ok(!r.headers['content-encoding'], 'a picture isn’t (it’s compressed already)');

  // Caching.
  ok(/max-age=86400/.test(r.headers['cache-control'] || ''), `pictures are kept for a day (${r.headers['cache-control']})`);
  r = await get(APPH, '/app.js');
  const etag = r.headers.etag;
  ok(/no-cache/.test(r.headers['cache-control'] || '') && !!etag, 'the app’s script is checked each time, with an ETag');
  r = await get(APPH, '/app.js', { 'if-none-match': etag });
  ok(r.status === 304 && !r.raw.length, 'and unchanged it’s a 304 with nothing to download');

  // The sitemap and the pages' words.
  r = await get(SITE, '/sitemap.xml');
  const sm = text(r);
  ok((sm.match(/<url>/g) || []).length >= 5 && (sm.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g) || []).length === (sm.match(/<url>/g) || []).length && !/changefreq|priority/.test(sm), 'the sitemap says when each page last changed (and drops what Google ignores)');
  r = await get(SITE, '/');
  const home = text(r);
  const desc = /<meta name="description" content="([^"]*)"/.exec(home)?.[1] || '';
  ok(desc.length >= 70 && desc.length <= 158, `the home page’s description fits a search result (${desc.length} characters)`);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(home)?.[1].replace(/<[^>]+>/g, '') || '';
  ok(/team app/i.test(h1) && /small business/i.test(h1), `its main heading says what it is (“${h1.trim()}”)`);
  r = await get(SITE, '/download');
  ok(/<title>[^<]*(Mac|Windows)[^<]*<\/title>/.test(text(r)), 'the download page’s title says where Kloomie runs');
} catch (e) {
  console.log('FAIL threw: ' + e.stack);
  fails++;
} finally {
  srv.kill();
}
if (fails) console.log(srv.log.slice(-1500));
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
