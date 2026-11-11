// Audit (docs/audit/FINDINGS.md): G7, a repeating event's end (UNTIL, a UTC moment) is compared as a moment, so an
// evening event in Las Vegas doesn't get one extra occurrence; G11, isDay accepts real days only.
import { ics } from '../server/calendar.js';
import { isDay } from '../server/dates.js';
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const cal = (lines) => ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:x', ...lines, 'SUMMARY:E', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const run = (text) => ics.veventsToEvents('h', ics.icsEvents(text), new Date('2026-11-01T00:00:00Z'), new Date('2026-11-30T00:00:00Z'), 'UTC').map((e) => (e.start?.toISOString ? e.start.toISOString() : String(e.start ?? e.date)));
// 8pm Pacific daily, Nov 5 to Nov 10 (UNTIL is Nov 11 04:00 UTC = Nov 10 8pm PST): six evenings.
let ev = run(cal(['DTSTART;TZID=America/Los_Angeles:20261105T200000', 'DTEND;TZID=America/Los_Angeles:20261105T210000', 'RRULE:FREQ=DAILY;UNTIL=20261111T040000Z']));
ok(ev.length === 6 && ev.at(-1) === '2026-11-11T04:00:00.000Z', `G7 an evening event ends on its last evening (${ev.length} occurrences, last ${ev.at(-1)})`);
// A morning event with the same kind of UNTIL keeps its last day.
ev = run(cal(['DTSTART;TZID=America/Los_Angeles:20261105T090000', 'DTEND;TZID=America/Los_Angeles:20261105T100000', 'RRULE:FREQ=DAILY;UNTIL=20261110T170000Z']));
ok(ev.length === 6 && ev.at(-1) === '2026-11-10T17:00:00.000Z', `G7 a morning event keeps its last morning (${ev.length})`);
// All-day events: UNTIL as a date.
ev = run(cal(['DTSTART;VALUE=DATE:20261105', 'DTEND;VALUE=DATE:20261106', 'RRULE:FREQ=DAILY;UNTIL=20261107']));
ok(ev.length === 3, `G7 an all-day event to a date stops on that date (${ev.length})`);
ok(isDay('2028-02-29') && !isDay('2026-02-29') && !isDay('2026-02-31') && !isDay('2026-00-10') && !isDay('2026-13-01') && !isDay('26-01-01') && !isDay(null), 'G11 isDay takes real calendar days only');
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
