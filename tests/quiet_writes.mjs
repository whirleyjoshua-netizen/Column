// Letting the database sleep (owner, 2026-11-20: "switch the Pause to idle to be on"). Postgres writes only the
// records that changed. A calendar's "last synced" ticking over every 3 minutes, with nothing else changed, isn't a
// change worth waking the database for; it goes with that record's next real change.
import { planWrite, QUIET } from '../server/store.js';
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

const db = {
  calendars: { c1: { id: 'c1', wsId: 'w1', account: 'a@b.test', lastSync: 1000, error: null } },
  pss: { w1: { url: 'https://pss.test', syncedAt: 1000, tried: 1000 } },
  gcontacts: { w1: { account: 'a@b.test', syncedAt: 1000, tried: 1000 } },
  lists: { l1: { id: 'l1', wsId: 'w1', rows: [{ id: 'r1' }], syncedAt: 1000 } },
  tasks: { t1: { id: 't1', wsId: 'w1', text: 'Hang blinds', updatedAt: 1000 } },
  version: 3,
};
const cache = new Map();
let p = planWrite(db, cache);
ok(p.up.length === 6 && p.gone.length === 0, 'the first write sends every record: ' + p.up.length);
for (const x of p.up) cache.set(x.key, x.safe);
ok(planWrite(db, cache).up.length === 0, 'nothing changed: nothing to send');

// Background checks ran and found nothing new.
db.calendars.c1.lastSync = 5000;
db.pss.w1.syncedAt = db.pss.w1.tried = 5000;
db.gcontacts.w1.syncedAt = db.gcontacts.w1.tried = 5000;
db.lists.l1.syncedAt = 5000;
p = planWrite(db, cache);
ok(p.up.length === 0, 'only "last synced" times moved: nothing is sent, so the database can sleep (sent ' + p.up.map((x) => x.key.replace('\0', '/')).join(', ') + ')');

// A real change in the same record is sent, with the latest time along with it.
db.calendars.c1.error = 'Sign-in expired';
p = planWrite(db, cache);
ok(p.up.length === 1 && JSON.parse(p.up[0].json).d.lastSync === 5000 && JSON.parse(p.up[0].json).d.error === 'Sign-in expired', 'a real change is sent, carrying the latest sync time');
for (const x of p.up) cache.set(x.key, x.safe);
ok(planWrite(db, cache).up.length === 0, 'and then it’s settled');

// Other records aren't affected: a task's own times are real changes.
db.tasks.t1.updatedAt = 6000;
ok(planWrite(db, cache).up.length === 1, 'a task whose time changed is still sent');
ok(QUIET.calendars?.includes('lastSync') && !QUIET.tasks, 'only the background-check times are quiet');

// A record removed is still removed.
delete db.lists.l1;
ok(planWrite(db, cache).gone.length === 1, 'a removed record is still deleted');

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
