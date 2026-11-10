import crypto from 'node:crypto';
// Google Calendar, Outlook (Microsoft Graph) and Apple Calendar (iCloud CalDAV): sign-in, calendars, and events.
// Each provider speaks one shape: events are { id, title, allDay, start, end }, where start/end are
// Date instants for timed events and YYYY-MM-DD strings for all-day ones (end exclusive).
// Writes take Kloomie times as wall-clock strings plus an IANA time zone, so no offset math happens here.

const env = (k) => process.env[k] || '';

async function call(url, { method = 'GET', token, body, form, raw, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(raw ? { 'Content-Type': 'text/plain' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : form ? new URLSearchParams(form) : raw,
  });
  if (res.status === 202 || res.status === 204 || (method === 'DELETE' && (res.status === 404 || res.status === 410))) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    if (res.ok) throw new Error('Unexpected reply from the calendar');
  }
  if (!res.ok) {
    const msg = data?.error_description || data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || res.statusText;
    throw Object.assign(new Error(msg), { status: res.status, auth: res.status === 401 || data?.error === 'invalid_grant' });
  }
  return data;
}

// Sending email is asked for only when someone connects Gmail to send campaign emails. GOOGLE_API points
// every Google call (sign-in tokens, calendars, Gmail) at one stand-in when testing.
const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events';
const GMAIL_SEND = 'https://www.googleapis.com/auth/gmail.send';
// Google Contacts, for a team's Contacts: read-only, asked for on its own connection.
const CONTACTS_READ = 'https://www.googleapis.com/auth/contacts.readonly';
const G = (url) => (env('GOOGLE_API') ? url.replace(/^https:\/\/[^/]+/, env('GOOGLE_API')) : url);
const google = {
  name: 'Google',
  configured: () => !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')),
  authUrl: (redirect, state, mail) => 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: redirect, response_type: 'code', state,
    scope: mail ? GOOGLE_SCOPE + ' ' + GMAIL_SEND : GOOGLE_SCOPE,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
  }),
  // Someone can untick sending on Google's screen; then the connection is for the calendar only.
  async exchange(code, redirect) {
    const t = await call(G('https://oauth2.googleapis.com/token'), { method: 'POST', form: { code, redirect_uri: redirect, grant_type: 'authorization_code', client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET') } });
    const granted = String(t.scope || '').split(' ');
    return { access: t.access_token, refresh: t.refresh_token, expires: Date.now() + (t.expires_in - 60) * 1000, mail: granted.includes(GMAIL_SEND), contacts: granted.includes(CONTACTS_READ) };
  },
  contactsUrl: (redirect, state) => 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: redirect, response_type: 'code', state,
    scope: 'openid email ' + CONTACTS_READ, access_type: 'offline', prompt: 'consent',
  }),
  // Everyone in the account's Google Contacts ("My contacts"), a page at a time.
  async people(token) {
    const out = [];
    let page = '';
    for (let i = 0; i < 30; i++) {
      const d = await call(G('https://people.googleapis.com/v1/people/me/connections?') + new URLSearchParams({ personFields: 'names,emailAddresses,phoneNumbers,addresses,organizations,metadata', pageSize: '1000', ...(page ? { pageToken: page } : {}) }), { token });
      out.push(...(d?.connections || []));
      page = d?.nextPageToken;
      if (!page) return out;
    }
    throw new Error('Google Contacts has more people than Kloomie can hold.');
  },
  async sendMail(token, mime) {
    await call(G('https://gmail.googleapis.com/gmail/v1/users/me/messages/send'), { method: 'POST', token, body: { raw: Buffer.from(mime).toString('base64url') } });
  },
  async refresh(tok) {
    const t = await call(G('https://oauth2.googleapis.com/token'), { method: 'POST', form: { refresh_token: tok.refresh, grant_type: 'refresh_token', client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET') } });
    return { access: t.access_token, refresh: t.refresh_token || tok.refresh, expires: Date.now() + (t.expires_in - 60) * 1000 };
  },
  async account(token) {
    return (await call(G('https://openidconnect.googleapis.com/v1/userinfo'), { token })).email;
  },
  async calendars(token) {
    const d = await call(G('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250'), { token });
    return d.items.map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, primary: !!c.primary, canWrite: ['owner', 'writer'].includes(c.accessRole), color: c.backgroundColor || null }));
  },
  async events(token, calId, from, to) {
    const out = [];
    let page = '';
    do {
      const d = await call(G(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?`) + new URLSearchParams({ singleEvents: 'true', timeMin: from.toISOString(), timeMax: to.toISOString(), maxResults: '2500', ...(page ? { pageToken: page } : {}) }), { token });
      for (const e of d.items || []) {
        if (e.status === 'cancelled') continue;
        const allDay = !!e.start.date;
        out.push({ id: e.id, title: e.summary || '(busy)', allDay, start: allDay ? e.start.date : new Date(e.start.dateTime), end: allDay ? e.end.date : new Date(e.end.dateTime) });
      }
      page = d.nextPageToken;
    } while (page);
    return out;
  },
  body: (ev) => ({
    summary: ev.title,
    start: ev.allDay ? { date: ev.start } : { dateTime: ev.start, timeZone: ev.tz },
    end: ev.allDay ? { date: ev.end } : { dateTime: ev.end, timeZone: ev.tz },
  }),
  async create(token, calId, ev) {
    return (await call(G(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`), { method: 'POST', token, body: google.body(ev) })).id;
  },
  async update(token, calId, id, ev) {
    await call(G(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(id)}`), { method: 'PATCH', token, body: google.body(ev) });
  },
  async remove(token, calId, id) {
    await call(G(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(id)}`), { method: 'DELETE', token });
  },
};

// MS_GRAPH points Kloomie at a stand-in for Microsoft Graph when testing.
const GRAPH = env('MS_GRAPH') || 'https://graph.microsoft.com/v1.0';
const MS_SCOPE = 'offline_access openid email User.Read Calendars.ReadWrite';
// Sending email is asked for only when someone connects Outlook to send campaign emails.
const MS_MAIL_SCOPE = MS_SCOPE + ' Mail.Send';
const msTenant = () => env('MS_TENANT') || 'common';
const microsoft = {
  name: 'Outlook',
  configured: () => !!(env('MS_CLIENT_ID') && env('MS_CLIENT_SECRET')),
  authUrl: (redirect, state, mail) => `https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/authorize?` + new URLSearchParams({
    client_id: env('MS_CLIENT_ID'), redirect_uri: redirect, response_type: 'code', response_mode: 'query', state, scope: mail ? MS_MAIL_SCOPE : MS_SCOPE, prompt: 'select_account',
  }),
  // The scope granted is kept, so a refresh asks for the same (with Mail.Send if it was given).
  async exchange(code, redirect, mail) {
    const scope = mail ? MS_MAIL_SCOPE : MS_SCOPE;
    const t = await call(`https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/token`, { method: 'POST', form: { code, redirect_uri: redirect, grant_type: 'authorization_code', client_id: env('MS_CLIENT_ID'), client_secret: env('MS_CLIENT_SECRET'), scope } });
    const mailOk = /(^|\s|\/)Mail\.Send(\s|$)/i.test(t.scope || '');
    return { access: t.access_token, refresh: t.refresh_token, expires: Date.now() + (t.expires_in - 60) * 1000, scope: mailOk ? MS_MAIL_SCOPE : MS_SCOPE, mail: mailOk };
  },
  async refresh(tok) {
    const t = await call(`https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/token`, { method: 'POST', form: { refresh_token: tok.refresh, grant_type: 'refresh_token', client_id: env('MS_CLIENT_ID'), client_secret: env('MS_CLIENT_SECRET'), scope: tok.scope || MS_SCOPE } });
    return { access: t.access_token, refresh: t.refresh_token || tok.refresh, expires: Date.now() + (t.expires_in - 60) * 1000, scope: tok.scope };
  },
  // A whole message as MIME (base64), so headers like List-Unsubscribe go out as written. Saved to Sent Items.
  async sendMail(token, mime) {
    await call(GRAPH + '/me/sendMail', { method: 'POST', token, raw: Buffer.from(mime).toString('base64') });
  },
  async account(token) {
    const me = await call(GRAPH + '/me?$select=mail,userPrincipalName', { token });
    return me.mail || me.userPrincipalName;
  },
  async calendars(token) {
    const d = await call(GRAPH + '/me/calendars?$top=250&$select=id,name,canEdit,isDefaultCalendar,hexColor', { token });
    return d.value.map((c) => ({ id: c.id, name: c.name, primary: !!c.isDefaultCalendar, canWrite: !!c.canEdit, color: c.hexColor || null }));
  },
  async events(token, calId, from, to) {
    const out = [];
    let url = `${GRAPH}/me/calendars/${encodeURIComponent(calId)}/calendarView?` + new URLSearchParams({ startDateTime: from.toISOString(), endDateTime: to.toISOString(), $top: '500', $select: 'id,subject,start,end,isAllDay,isCancelled' });
    while (url) {
      const d = await call(url, { token, headers: { Prefer: 'outlook.timezone="UTC"' } });
      for (const e of d.value || []) {
        if (e.isCancelled) continue;
        // All-day events come back as midnight-to-midnight in UTC; the date part is the day.
        out.push({ id: e.id, title: e.subject || '(busy)', allDay: !!e.isAllDay, start: e.isAllDay ? e.start.dateTime.slice(0, 10) : new Date(e.start.dateTime + 'Z'), end: e.isAllDay ? e.end.dateTime.slice(0, 10) : new Date(e.end.dateTime + 'Z') });
      }
      url = d['@odata.nextLink'];
    }
    return out;
  },
  body: (ev) => ({
    subject: ev.title,
    isAllDay: !!ev.allDay,
    start: { dateTime: ev.allDay ? ev.start + 'T00:00:00' : ev.start, timeZone: ev.tz },
    end: { dateTime: ev.allDay ? ev.end + 'T00:00:00' : ev.end, timeZone: ev.tz },
  }),
  async create(token, calId, ev) {
    return (await call(`${GRAPH}/me/calendars/${encodeURIComponent(calId)}/events`, { method: 'POST', token, body: microsoft.body(ev) })).id;
  },
  async update(token, calId, id, ev) {
    await call(`${GRAPH}/me/events/${encodeURIComponent(id)}`, { method: 'PATCH', token, body: microsoft.body(ev) });
  },
  async remove(token, calId, id) {
    await call(`${GRAPH}/me/events/${encodeURIComponent(id)}`, { method: 'DELETE', token });
  },
};

// ---------- Apple Calendar (iCloud), over CalDAV ----------
// Apple has no sign-in for other apps' calendars, so people make an app-specific password at account.apple.com
// and type it in with their Apple ID. It's kept sealed like any token; "access" is the Basic header made from it,
// and it never expires (they cancel it at Apple). APPLE_CALDAV points Kloomie at a stand-in when testing.
const CALDAV = () => env('APPLE_CALDAV') || 'https://caldav.icloud.com';
const NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/"';

async function dav(method, url, auth, { body, depth, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: auth, ...(body ? { 'Content-Type': body.startsWith('BEGIN:') ? 'text/calendar; charset=utf-8' : 'application/xml; charset=utf-8' } : {}), ...(depth != null ? { Depth: String(depth) } : {}), ...headers },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (method === 'DELETE' && (res.status === 404 || res.status === 410)) return { status: res.status, text, url: res.url };
  if (!res.ok) {
    const auth401 = res.status === 401 || res.status === 403;
    throw Object.assign(new Error(auth401 ? 'Apple didn’t accept that Apple ID and app-specific password.' : `iCloud said ${res.status} ${res.statusText}`.trim()), { status: res.status, auth: auth401 });
  }
  return { status: res.status, text, url: res.url || url, etag: res.headers.get('etag') };
}
// Just enough XML for CalDAV replies: prefixes vary by server, so tags are matched by their local name.
const tagRe = (name, flags = 'i') => new RegExp(`<(?:[\\w-]+:)?${name}(?=[\\s/>])[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`, flags);
const tag = (xml, name) => { const m = (xml || '').match(tagRe(name)); return m ? m[1] ?? '' : null; };
const has = (xml, name) => tagRe(name).test(xml || '');
const xmlText = (s) => {
  const t = String(s || '');
  const cd = t.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cd) return cd[1];
  return t.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
};
const responses = (xml) => [...String(xml || '').matchAll(/<(?:[\w-]+:)?response(?=[\s>])[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi)].map((m) => m[1]);
const hrefOf = (xml, base) => { const h = xmlText(tag(xml, 'href') || '').trim(); return h ? new URL(h, base).href : null; };
const propfind = (props) => `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NS}><d:prop>${props}</d:prop></d:propfind>`;

// ----- iCalendar -----
function tzOk(tz) {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone; } catch { return null; }
}
// "/mozilla.org/.../America/New_York" and the like: keep the Area/City at the end.
const tzName = (tz, fallback) => tzOk(tz) || tzOk(String(tz || '').match(/[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/)?.[0] || '') || fallback || 'UTC';
function tzOffset(tz, ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(ms).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
// A wall-clock time in a zone, as an instant.
function zoned(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = guess - tzOffset(tz, guess);
  return guess - tzOffset(tz, first);
}
const pad = (n, w = 2) => String(n).padStart(w, '0');
const dayKey = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
const keyParts = (k) => k.split('-').map(Number);
const addDay = (k, n) => { const [y, m, d] = keyParts(k); return dayKey(y, m, d + n); };
const unescapeText = (v) => String(v || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const escapeText = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

function icsEvents(text) {
  const lines = String(text || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const out = [];
  let cur = null, nest = 0;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { EXDATE: [] }; nest = 0; continue; }
    if (!cur) continue;
    if (line === 'END:VEVENT') { out.push(cur); cur = null; continue; }
    if (line.startsWith('BEGIN:')) { nest++; continue; } // an alarm inside the event
    if (line.startsWith('END:')) { nest--; continue; }
    if (nest) continue;
    const m = line.match(/^([A-Za-z0-9-]+)((?:;(?:[^:";]|"[^"]*")*)*):(.*)$/);
    if (!m) continue;
    const params = {};
    for (const pm of m[2].matchAll(/;([A-Za-z-]+)=("[^"]*"|[^;]*)/g)) params[pm[1].toUpperCase()] = pm[2].replace(/^"|"$/g, '');
    const name = m[1].toUpperCase();
    if (name === 'EXDATE') cur.EXDATE.push(...m[3].split(',').map((value) => ({ value, params })));
    else cur[name] = { value: m[3], params };
  }
  return out;
}
// A DTSTART-like value: an all-day date, or wall-clock parts in a zone (UTC for "Z" times).
function icsTime(p, defTz) {
  if (!p) return null;
  const v = p.value.trim();
  const d = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (d || p.params.VALUE === 'DATE') { const [y, m, dd] = [+v.slice(0, 4), +v.slice(4, 6), +v.slice(6, 8)]; return { allDay: true, date: dayKey(y, m, dd) }; }
  const t = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!t) return null;
  const tz = t[7] ? 'UTC' : tzName(p.params.TZID, defTz);
  const wall = [+t[1], +t[2], +t[3], +t[4], +t[5], +(t[6] || 0)];
  return { allDay: false, tz, wall, ms: zoned(...wall, tz) };
}
function durationMs(v) {
  const m = String(v || '').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * ((+m[2] || 0) * 7 * 86400_000 + (+m[3] || 0) * 86400_000 + (+m[4] || 0) * 3600_000 + (+m[5] || 0) * 60_000 + (+m[6] || 0) * 1000);
}
const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
// Repeating events, for a server that hands back the rule instead of expanding it: daily, weekly (by day),
// monthly (by date, or "2nd Tuesday") and yearly, with INTERVAL, COUNT, UNTIL and EXDATE. Dates are walked on
// the event's own wall clock, so 9am stays 9am across daylight saving.
function expandRule(rule, startKey, limitKey, cap = 1500) {
  const r = Object.fromEntries(rule.split(';').map((x) => x.split('=')).map(([k, v]) => [k.toUpperCase(), v]));
  const freq = r.FREQ, step = Math.max(1, +r.INTERVAL || 1), count = +r.COUNT || 0;
  const until = r.UNTIL ? `${r.UNTIL.slice(0, 4)}-${r.UNTIL.slice(4, 6)}-${r.UNTIL.slice(6, 8)}` : null;
  const byday = (r.BYDAY || '').split(',').filter(Boolean).map((x) => { const m = x.match(/^([+-]?\d+)?([A-Z]{2})$/); return m ? { n: m[1] ? +m[1] : 0, wd: WD.indexOf(m[2]) } : null; }).filter((x) => x && x.wd >= 0);
  const bymd = (r.BYMONTHDAY || '').split(',').filter(Boolean).map(Number);
  const [sy, sm, sd] = keyParts(startKey);
  const out = [];
  let n = 0;
  const take = (k) => {
    if (k < startKey) return true;
    if ((until && k > until) || k > limitKey || (count && n >= count) || out.length >= cap) return false;
    n++;
    out.push(k);
    return true;
  };
  const wdOf = (k) => { const [y, m, d] = keyParts(k); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  for (let i = 0; i < 5000; i++) {
    if (freq === 'DAILY') { if (!take(addDay(startKey, i * step))) break; continue; }
    if (freq === 'WEEKLY') {
      const weekStart = addDay(startKey, i * 7 * step - wdOf(startKey));
      const days = byday.length ? byday.map((b) => b.wd).sort() : [wdOf(startKey)];
      let go = true;
      for (const wd of days) if (!(go = take(addDay(weekStart, wd)))) break;
      if (!go) break;
      continue;
    }
    if (freq === 'MONTHLY' || freq === 'YEARLY') {
      const months = freq === 'MONTHLY' ? i * step : i * 12 * step;
      const y = sy + Math.floor((sm - 1 + months) / 12), m = ((sm - 1 + months) % 12) + 1;
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      let days = [];
      if (byday.length && freq === 'MONTHLY') {
        for (const b of byday) {
          const all = [];
          for (let d = 1; d <= last; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === b.wd) all.push(d);
          if (!b.n) days.push(...all);
          else { const d = b.n > 0 ? all[b.n - 1] : all[all.length + b.n]; if (d) days.push(d); }
        }
      } else if (bymd.length) days = bymd.map((d) => (d < 0 ? last + d + 1 : d)).filter((d) => d >= 1 && d <= last);
      else if (sd <= last) days = [sd];
      let go = true;
      for (const d of [...new Set(days)].sort((a, b) => a - b)) if (!(go = take(dayKey(y, m, d)))) break;
      if (!go) break;
      if (`${y}-${pad(m)}` > limitKey.slice(0, 7)) break;
      continue;
    }
    // Anything rarer: just the first time.
    take(startKey);
    break;
  }
  return out;
}
// One VEVENT (plus its overrides) as Kloomie events in [from, to).
function veventsToEvents(href, vevents, from, to, defTz) {
  const out = [];
  const many = vevents.length > 1 || vevents.some((v) => v.RRULE || v['RECURRENCE-ID']);
  const idFor = (st) => (many ? `${href}#${st.allDay ? st.date : st.ms}` : href);
  const emit = (v, st, en) => {
    if ((v.STATUS?.value || '').toUpperCase() === 'CANCELLED') return;
    const title = unescapeText(v.SUMMARY?.value).trim() || '(busy)';
    if (st.allDay) {
      const end = en?.allDay && en.date > st.date ? en.date : addDay(st.date, 1);
      const a = Date.parse(st.date + 'T00:00:00Z'), z = Date.parse(end + 'T00:00:00Z');
      if (z + 14 * 3600_000 <= from.getTime() || a - 14 * 3600_000 >= to.getTime()) return;
      out.push({ id: idFor(st), title, allDay: true, start: st.date, end });
    } else {
      const end = en && !en.allDay && en.ms > st.ms ? en.ms : st.ms;
      if (end < from.getTime() || st.ms >= to.getTime()) return;
      out.push({ id: idFor(st), title, allDay: false, start: new Date(st.ms), end: new Date(end) });
    }
  };
  const endOf = (v, st) => {
    const en = icsTime(v.DTEND, defTz);
    if (en) return en;
    const dur = durationMs(v.DURATION?.value);
    if (dur == null) return null;
    return st.allDay ? { allDay: true, date: addDay(st.date, Math.max(1, Math.round(dur / 86400_000))) } : { allDay: false, ms: st.ms + dur };
  };
  const overrides = vevents.filter((v) => v['RECURRENCE-ID']);
  const moved = new Set(overrides.map((v) => { const t = icsTime(v['RECURRENCE-ID'], defTz); return t ? (t.allDay ? t.date : t.ms) : null; }));
  for (const v of vevents) {
    const st = icsTime(v.DTSTART, defTz);
    if (!st) continue;
    if (v['RECURRENCE-ID'] || !v.RRULE) { emit(v, st, endOf(v, st)); continue; }
    const en = endOf(v, st);
    const len = en ? (st.allDay ? Date.parse(en.date) - Date.parse(st.date) : en.ms - st.ms) : st.allDay ? 86400_000 : 0;
    const ex = new Set(v.EXDATE.map((x) => icsTime(x, st.tz)).filter(Boolean).map((t) => (t.allDay ? t.date : t.ms)));
    const startKey = st.allDay ? st.date : dayKey(st.wall[0], st.wall[1], st.wall[2]);
    const limitKey = new Date(to.getTime() + 86400_000).toISOString().slice(0, 10);
    for (const k of expandRule(v.RRULE.value, startKey, limitKey)) {
      const [y, m, d] = keyParts(k);
      const one = st.allDay ? { allDay: true, date: k } : { allDay: false, tz: st.tz, ms: zoned(y, m, d, st.wall[3], st.wall[4], st.wall[5], st.tz) };
      const key = one.allDay ? one.date : one.ms;
      if (ex.has(key) || moved.has(key)) continue;
      emit(v, one, one.allDay ? { allDay: true, date: addDay(k, Math.max(1, Math.round(len / 86400_000))) } : { allDay: false, ms: one.ms + len });
    }
  }
  return out;
}
const icsStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const icsDate = (k) => k.replace(/-/g, '');
// Long lines folded at 73 characters (well under the 75-octet limit for most text).
const fold = (line) => { const parts = []; for (let i = 0; i < line.length; i += 73) parts.push((i ? ' ' : '') + line.slice(i, i + 73)); return parts.join('\r\n'); };
function icsFor(uid, ev) {
  const when = (k, v) => {
    if (ev.allDay) return `${k};VALUE=DATE:${icsDate(v)}`;
    const [d, t] = v.split('T');
    const [y, m, dd] = keyParts(d);
    const [hh, mi, ss] = t.split(':').map(Number);
    return `${k}:${icsStamp(zoned(y, m, dd, hh, mi, ss || 0, tzName(ev.tz)))}`;
  };
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kloomie//Kloomie//EN', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${icsStamp(Date.now())}`, when('DTSTART', ev.start), when('DTEND', ev.end), fold('SUMMARY:' + escapeText(ev.title)), 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}

const apple = {
  name: 'Apple Calendar',
  password: true, // connected with an Apple ID and app-specific password, not a sign-in page
  configured: () => true,
  login: (user, pass) => ({ access: 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64'), refresh: null, expires: 9e15 }),
  refresh: async (tok) => tok,
  async home(auth) {
    const root = await dav('PROPFIND', CALDAV() + '/', auth, { depth: 0, body: propfind('<d:current-user-principal/>') });
    const principal = hrefOf(tag(root.text, 'current-user-principal'), root.url);
    if (!principal) throw new Error('Couldn’t find your iCloud calendars.');
    const pr = await dav('PROPFIND', principal, auth, { depth: 0, body: propfind('<c:calendar-home-set/><c:schedule-default-calendar-URL/>') });
    const home = hrefOf(tag(pr.text, 'calendar-home-set'), pr.url);
    if (!home) throw new Error('Couldn’t find your iCloud calendars.');
    return { home, primary: hrefOf(tag(pr.text, 'schedule-default-calendar-URL'), pr.url) };
  },
  async calendars(auth) {
    const { home, primary } = await apple.home(auth);
    const r = await dav('PROPFIND', home, auth, { depth: 1, body: propfind('<d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><d:current-user-privilege-set/><ic:calendar-color/>') });
    const cals = [];
    for (const x of responses(r.text)) {
      if (!has(tag(x, 'resourcetype'), 'calendar')) continue;
      const comps = tag(x, 'supported-calendar-component-set');
      if (comps && !/name="VEVENT"/i.test(comps)) continue; // a Reminders list
      const priv = tag(x, 'current-user-privilege-set');
      const id = hrefOf(x, r.url);
      const color = xmlText(tag(x, 'calendar-color') || '').trim().slice(0, 7) || null;
      cals.push({ id, name: xmlText(tag(x, 'displayname') || '').trim() || 'Calendar', primary: false, canWrite: priv == null || /<(?:[\w-]+:)?(write|write-content|all)(?=[\s/>])/i.test(priv), color });
    }
    const main = cals.find((c) => primary && c.id === primary) || cals.find((c) => c.canWrite) || cals[0];
    if (main) main.primary = true;
    return cals;
  },
  async events(auth, calId, from, to, tz) {
    const t = (d) => icsStamp(d.getTime());
    const body = `<?xml version="1.0" encoding="utf-8"?><c:calendar-query ${NS}><d:prop><d:getetag/><c:calendar-data><c:expand start="${t(from)}" end="${t(to)}"/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${t(from)}" end="${t(to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
    const r = await dav('REPORT', calId, auth, { depth: 1, body });
    const out = [];
    for (const x of responses(r.text)) {
      const data = tag(x, 'calendar-data');
      const href = hrefOf(x, r.url);
      if (!data || !href) continue;
      out.push(...veventsToEvents(href, icsEvents(xmlText(data)), from, to, tz));
    }
    return out;
  },
  async create(auth, calId, ev) {
    const uid = crypto.randomUUID();
    const url = new URL(uid + '.ics', calId.endsWith('/') ? calId : calId + '/').href;
    await dav('PUT', url, auth, { body: icsFor(uid, ev), headers: { 'If-None-Match': '*' } });
    return url;
  },
  async update(auth, calId, id, ev) {
    const uid = decodeURIComponent(new URL(id).pathname.split('/').pop().replace(/\.ics$/i, ''));
    await dav('PUT', id, auth, { body: icsFor(uid, ev) });
  },
  async remove(auth, calId, id) {
    await dav('DELETE', id.split('#')[0], auth);
  },
};

// For the subscribe-link feed and tests.
export const ics = { escapeText, fold, icsStamp, icsDate, icsEvents, veventsToEvents, expandRule };

export const providers = { google, microsoft, apple };
