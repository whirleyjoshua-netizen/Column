// Tests: fetch keeps cookies per host, the way one browser does (Kloomie's "connect your account" sign-ins mark the
// browser that started them with a cookie; see server/oauthbind.js). Import it once at the top of a test.
const jar = new Map(); // host -> Map(name -> value)
const real = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  const mine = jar.get(u.host);
  const headers = new Headers(init.headers || {});
  if (mine?.size && !headers.has('cookie')) headers.set('cookie', [...mine].map(([k, v]) => `${k}=${v}`).join('; '));
  const r = await real(input, { ...init, headers });
  for (const c of r.headers.getSetCookie?.() || []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) { if (!jar.has(u.host)) jar.set(u.host, new Map()); jar.get(u.host).set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
  }
  return r;
};
export const clearCookies = () => jar.clear();
