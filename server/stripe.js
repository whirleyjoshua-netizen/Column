// Stripe, for billing: a few REST calls and checking that a webhook really came from Stripe. No SDK.
// STRIPE_API points it at a stand-in when testing.
import crypto from 'node:crypto';

const env = (k) => process.env[k] || '';
export const configured = () => !!(env('STRIPE_SECRET_KEY') && env('STRIPE_PRICE'));

// Stripe takes form fields, with nested ones written like items[0][price].
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function call(method, path, body) {
  const res = await fetch((env('STRIPE_API') || 'https://api.stripe.com') + '/v1' + path, {
    method,
    headers: { Authorization: 'Bearer ' + env('STRIPE_SECRET_KEY'), ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), 'Stripe-Version': '2024-06-20' },
    body: body ? form(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message || `Stripe answered ${res.status}`), { status: 502 });
  return data;
}

// The Stripe-Signature header: t=<seconds>,v1=<hmac of "t.body">, signed with the webhook's secret.
export function verify(raw, header) {
  const secret = env('STRIPE_WEBHOOK_SECRET');
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
  const sigs = String(header).split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300 || !sigs.length) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return sigs.some((s) => s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want)));
}
