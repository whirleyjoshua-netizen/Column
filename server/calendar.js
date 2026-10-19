// Google Calendar and Outlook (Microsoft Graph): sign-in, calendars, and events.
// Each provider speaks one shape: events are { id, title, allDay, start, end }, where start/end are
// Date instants for timed events and YYYY-MM-DD strings for all-day ones (end exclusive).
// Writes take Column times as wall-clock strings plus an IANA time zone, so no offset math happens here.

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

const google = {
  name: 'Google',
  configured: () => !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')),
  authUrl: (redirect, state) => 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: redirect, response_type: 'code', state,
    scope: 'openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events',
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
  }),
  async exchange(code, redirect) {
    const t = await call('https://oauth2.googleapis.com/token', { method: 'POST', form: { code, redirect_uri: redirect, grant_type: 'authorization_code', client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET') } });
    return { access: t.access_token, refresh: t.refresh_token, expires: Date.now() + (t.expires_in - 60) * 1000 };
  },
  async refresh(tok) {
    const t = await call('https://oauth2.googleapis.com/token', { method: 'POST', form: { refresh_token: tok.refresh, grant_type: 'refresh_token', client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET') } });
    return { access: t.access_token, refresh: t.refresh_token || tok.refresh, expires: Date.now() + (t.expires_in - 60) * 1000 };
  },
  async account(token) {
    return (await call('https://openidconnect.googleapis.com/v1/userinfo', { token })).email;
  },
  async calendars(token) {
    const d = await call('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250', { token });
    return d.items.map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, primary: !!c.primary, canWrite: ['owner', 'writer'].includes(c.accessRole), color: c.backgroundColor || null }));
  },
  async events(token, calId, from, to) {
    const out = [];
    let page = '';
    do {
      const d = await call(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?` + new URLSearchParams({ singleEvents: 'true', timeMin: from.toISOString(), timeMax: to.toISOString(), maxResults: '2500', ...(page ? { pageToken: page } : {}) }), { token });
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
    return (await call(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`, { method: 'POST', token, body: google.body(ev) })).id;
  },
  async update(token, calId, id, ev) {
    await call(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(id)}`, { method: 'PATCH', token, body: google.body(ev) });
  },
  async remove(token, calId, id) {
    await call(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(id)}`, { method: 'DELETE', token });
  },
};

// MS_GRAPH points Column at a stand-in for Microsoft Graph when testing.
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

export const providers = { google, microsoft };
