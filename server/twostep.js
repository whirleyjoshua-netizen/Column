// Two-step sign-in: after the password, a 6-digit code from an authenticator app (Google Authenticator, 1Password,
// Authy, Microsoft Authenticator…). Standard TOTP (RFC 6238): SHA-1, 6 digits, 30 seconds, one step either side
// allowed for clock drift, and a code can't be used twice. Turning it on gives 10 backup codes for a lost phone,
// each good once and kept only as a hash. It belongs to an email account (db.users), so it covers every team the
// account is in. The secret is kept encrypted.
import crypto from 'node:crypto';
import { qrSvg } from './qr.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32 = (buf) => { let bits = '', out = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; };
const unb32 = (s) => { let bits = ''; for (const ch of String(s).replace(/[\s=]/g, '').toUpperCase()) { const v = B32.indexOf(ch); if (v < 0) continue; bits += v.toString(2).padStart(5, '0'); } const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
export function totp(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', unb32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
const stepNow = () => Math.floor(Date.now() / 30_000);
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const backupCodes = () => Array.from({ length: 10 }, () => { const x = crypto.randomBytes(5).toString('hex'); return `${x.slice(0, 5)}-${x.slice(5)}`; });

export function twoStepModule({ db, save, seal, unseal, readJson, send, appName = 'Kloomie' }) {
  const on = (u) => !!u?.twoStep?.on;
  // A code from the app (this step or one either side, never one already used) or an unused backup code.
  function check(u, code) {
    const ts = u.twoStep;
    const c = String(code || '').trim().toLowerCase().replace(/\s/g, '');
    if (!ts?.secret || !c) return false;
    if (/^\d{6}$/.test(c)) {
      const secret = unseal(ts.secret).s;
      const now = stepNow();
      for (const s of [now - 1, now, now + 1]) {
        if (s > (ts.lastStep || 0) && crypto.timingSafeEqual(Buffer.from(totp(secret, s)), Buffer.from(c))) {
          ts.lastStep = s;
          return true;
        }
      }
      return false;
    }
    const hash = sha(c.replace(/-/g, '').replace(/^(.{5})/, '$1-'));
    const i = (ts.backup || []).indexOf(hash);
    if (i < 0) return false;
    ts.backup.splice(i, 1);
    ts.usedBackupAt = Date.now();
    return true;
  }
  // At sign-in, after the password was right: null to go ahead, or the answer to send instead.
  // `failed` counts a wrong code like a wrong password (same lockout).
  function gate(u, code, failed) {
    if (!on(u)) return null;
    if (!code) return { status: 401, body: { twoStep: true, error: 'Enter the 6-digit code from your authenticator app.' } };
    if (!check(u, code)) {
      failed();
      return { status: 401, body: { twoStep: true, error: 'That code isn’t right. Use the newest code in your app, or one of your backup codes.' } };
    }
    save();
    return null;
  }
  const status = (u) => ({ on: on(u), since: u?.twoStep?.on ? u.twoStep.at : null, backupLeft: u?.twoStep?.on ? (u.twoStep.backup || []).length : 0 });

  // /api/account/two-step… for the signed-in person's account.
  async function route(req, res, u, sub, { passOk, blocked, failed }) {
    const m = req.method;
    if (!u) return send(res, 400, { error: 'Add your email first: two-step sign-in belongs to an email account.' });
    if (m === 'GET' && !sub) return send(res, 200, status(u));
    const body = m === 'GET' ? {} : await readJson(req, 5_000);
    // Turning it on: a new secret to scan (not active until a code from it is entered).
    if (m === 'POST' && sub === 'start') {
      if (on(u)) return send(res, 409, { error: 'Two-step sign-in is already on.' });
      const secret = b32(crypto.randomBytes(20));
      u.twoStep = { on: false, secret: seal({ s: secret }), startedAt: Date.now() };
      save();
      const label = `${encodeURIComponent(appName)}:${encodeURIComponent(u.email)}`;
      const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(appName)}&algorithm=SHA1&digits=6&period=30`;
      return send(res, 200, { secret: secret.replace(/(.{4})/g, '$1 ').trim(), uri, qr: 'data:image/svg+xml;base64,' + Buffer.from(qrSvg(uri, { scale: 5 })).toString('base64') });
    }
    if (m === 'POST' && sub === 'confirm') {
      if (on(u)) return send(res, 409, { error: 'Two-step sign-in is already on.' });
      if (!u.twoStep?.secret || Date.now() - (u.twoStep.startedAt || 0) > 30 * 60_000) return send(res, 400, { error: 'Start again: scan a new code.' });
      if (!check(u, body.code)) return send(res, 400, { error: 'That code isn’t right. Type the 6 digits your app shows now.' });
      const codes = backupCodes();
      Object.assign(u.twoStep, { on: true, at: Date.now(), backup: codes.map(sha) });
      save();
      return send(res, 200, { ...status(u), backup: codes });
    }
    // Turning it off, or new backup codes: the password, and a current code (or a backup code).
    if ((m === 'DELETE' && !sub) || (m === 'POST' && sub === 'backup')) {
      if (!on(u)) return send(res, 400, { error: 'Two-step sign-in isn’t on.' });
      if (blocked()) return send(res, 429, { error: 'Too many wrong tries. Wait 15 minutes, then try again.' });
      if (!passOk(body.password)) { failed(); return send(res, 403, { error: 'That password isn’t right.' }); }
      if (!check(u, body.code)) { failed(); return send(res, 403, { error: 'That code isn’t right.' }); }
      if (m === 'DELETE') {
        delete u.twoStep;
        save();
        return send(res, 200, status(u));
      }
      const codes = backupCodes();
      u.twoStep.backup = codes.map(sha);
      save();
      return send(res, 200, { ...status(u), backup: codes });
    }
    return send(res, 405, { error: 'Method not allowed' });
  }
  return { on, gate, route, status };
}
