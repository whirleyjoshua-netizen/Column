// A stand-in for iCloud's CalDAV server, for the Apple Calendar tests. Hands back repeating events as
// their rule (not expanded), so Kloomie's own expanding is what gets tested.
import http from 'node:http';
const PORT = 4794;
const AUTH = 'Basic ' + Buffer.from('jo@icloud.com:abcd-efgh-ijkl-mnop').toString('base64');
const day = (n) => { const d = new Date(Date.now() + n * 864e5); return d.toISOString().slice(0, 10).replace(/-/g, ''); };
const monday = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7); return d.toISOString().slice(0, 10).replace(/-/g, ''); })();
const ev = (uid, lines) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `UID:${uid}`, ...lines, 'BEGIN:VALARM', 'TRIGGER:-PT10M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const cals = {
  work: { name: 'Work', write: true, comps: 'VEVENT', items: {
    'dentist.ics': ev('dentist', [`DTSTART;TZID=America/New_York:${day(1)}T100000`, `DTEND;TZID=America/New_York:${day(1)}T110000`, 'SUMMARY:Dentist & cleaning']),
    'standup.ics': ev('standup', [`DTSTART;TZID=America/New_York:${monday}T080000`, 'DURATION:PT15M', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'SUMMARY:Crew standup']),
  } },
  family: { name: 'Family', write: false, comps: 'VEVENT', items: { 'bday.ics': ev('bday', [`DTSTART;VALUE=DATE:${day(3)}`, `DTEND;VALUE=DATE:${day(4)}`, 'SUMMARY:Sam\\, birthday']) } },
  reminders: { name: 'Reminders', write: true, comps: 'VTODO', items: {} },
};
const ms = (x) => `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/">${x}</D:multistatus>`;
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const log = [];
http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const u = new URL(req.url, 'http://x');
  const out = (code, text, type = 'application/xml') => { res.writeHead(code, { 'Content-Type': type }); res.end(text); };
  if (u.pathname === '/_store') return out(200, JSON.stringify(Object.fromEntries(Object.entries(cals).map(([k, c]) => [k, c.items]))), 'application/json');
  if (u.pathname === '/_log') return out(200, JSON.stringify(log), 'application/json');
  if (u.pathname === '/_edit') { const { cal, file, text } = JSON.parse(body); if (text == null) delete cals[cal].items[file]; else cals[cal].items[file] = text; return out(200, '{}', 'application/json'); }
  log.push(req.method + ' ' + u.pathname);
  if (req.headers.authorization !== AUTH) return out(401, 'Unauthorized', 'text/plain');
  const p = u.pathname;
  if (req.method === 'PROPFIND' && p === '/') return out(207, ms('<D:response><D:href>/</D:href><D:propstat><D:prop><D:current-user-principal><D:href>/123/principal/</D:href></D:current-user-principal></D:prop></D:propstat></D:response>'));
  if (req.method === 'PROPFIND' && p === '/123/principal/') return out(207, ms('<D:response><D:href>/123/principal/</D:href><D:propstat><D:prop><C:calendar-home-set><D:href>/123/calendars/</D:href></C:calendar-home-set><C:schedule-default-calendar-URL><D:href>/123/calendars/work/</D:href></C:schedule-default-calendar-URL></D:prop></D:propstat></D:response>'));
  if (req.method === 'PROPFIND' && p === '/123/calendars/') return out(207, ms('<D:response><D:href>/123/calendars/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>' + Object.entries(cals).map(([k, c]) => `<D:response><D:href>/123/calendars/${k}/</D:href><D:propstat><D:prop><D:displayname>${c.name}</D:displayname><D:resourcetype><D:collection/><C:calendar/></D:resourcetype><C:supported-calendar-component-set><C:comp name="${c.comps}"/></C:supported-calendar-component-set><D:current-user-privilege-set><D:privilege><D:read/></D:privilege>${c.write ? '<D:privilege><D:write/></D:privilege>' : ''}</D:current-user-privilege-set><A:calendar-color>#1BADF8FF</A:calendar-color></D:prop></D:propstat></D:response>`).join('')));
  const m = p.match(/^\/123\/calendars\/(\w+)\/(?:([\w.-]+))?$/);
  const cal = m && cals[m[1]];
  if (!cal) return out(404, 'Not found', 'text/plain');
  if (req.method === 'REPORT') return out(207, ms(Object.entries(cal.items).map(([f, t]) => `<D:response><D:href>/123/calendars/${m[1]}/${f}</D:href><D:propstat><D:prop><D:getetag>"1"</D:getetag><C:calendar-data>${esc(t)}</C:calendar-data></D:prop></D:propstat></D:response>`).join('')));
  if (req.method === 'PUT' && m[2]) {
    if (!cal.write) return out(403, 'Read only', 'text/plain');
    if (req.headers['if-none-match'] === '*' && cal.items[m[2]]) return out(412, 'Exists', 'text/plain');
    const isNew = !cal.items[m[2]];
    cal.items[m[2]] = body;
    return out(isNew ? 201 : 204, '', 'text/plain');
  }
  if (req.method === 'DELETE' && m[2]) { const had = !!cal.items[m[2]]; delete cal.items[m[2]]; return out(had ? 204 : 404, '', 'text/plain'); }
  out(405, 'No', 'text/plain');
}).listen(PORT, '127.0.0.1');
