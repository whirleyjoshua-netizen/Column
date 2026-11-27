# Phase 5 §5 audit: every record read and record-bearing message (server, at the server checkpoint)

Rule: in a team set to "members see only theirs", a member gets a job record (or anything derived from it: its name,
values, visits, run, story, stack) only through `PJ.recordAt` / `PJ.seesRec` / `PJ.seesJob`. Searched with
`grep -n "Object.values(db.records)\|db\.records\["` over `server/*.js` (152 hits) and every `broadcast(` that carries a
record, a record id with its data, or a job name. Each hit is in one of these groups.

## A. Reads that return record data to a person: guarded
| Where | What | Guard |
|---|---|---|
| projects.js `GET /projects/:id/records` | a board's records | `seesJob` filter |
| projects.js `/records/:id/…` (log, reveal, PATCH, share, files…) | one record | `sees` + `seesJob` (404) |
| projects.js `records/for-contact` | a contact's records | `seesJob` filter |
| projects.js `records/by-tag` | a scanned label | `seesJob` (404) |
| projects.js v1 list, read, external id, timeline, PUT | public API | `seesJob` filter / 404 (as the key's maker now) |
| projects.js `recordAt` | every caller below | `sees` + `seesJob` |
| projects.js `recordStory` "linked to it" | AI and agents | `sees1('record', x)` → `canSee` → `seesRec` |
| projects.js `words` for `link` and `job` fields | AI, agents, sign-offs | the reader's view (`viewOf` now carries `memberId`) |
| projects.js `publicRecord` `jobs` (a record's Job field, e.g. equipment at a job) | records | `jobShown(id, view)`; no view in an "own" team → no name |
| jobflows.js `jobsList`, `overview`, `clients`, `mapJobs`, job routes (`jobAt`) | Jobs tab, Map | `seesJob` / `recordAt` |
| index.js `/schedule` day and week, Jobs to schedule | Schedule | `recordAt` |
| index.js `/records/:id/visits`, `/visits/:id` | visits | `recordAt` |
| index.js route stops (`/routes`) | a person's day | `recordAt` |
| index.js Ask (`askSources`) | AI search | `recordAt` (+ the story's guards) |
| index.js export (`buildExport` records) | a member's export | `seesRec` |
| index.js chat pins (`chatPinSees`) | pins | `recordAt` (locked chip, no id or name) |
| index.js job stacks (`seesStack`) | stacks, their items, search over state | `recordAt` |
| index.js `jobFor` (contact → jobs), last-event samples for automations | Contacts, the automation tester | `seesRec` |
| index.js workload / forecast (`recSeen`) | Team | `recordAt` (job names only when seen) |
| agents.js `find_records`, `read_record`, record links, `recTitle`, contact records, book visit | agents (as the person) | `seesJob` / `seesRec` / `recordAt` |
| signoff.js `locate` | sign-off form preview, send | `sees` + `seesJob` |
| publicapi.js visits list / read / book | public API | `recordAt` |

## B. Automations act as their maker: guarded
| Where | Guard |
|---|---|
| index.js `automate` trigger match | a record the maker can't see: the automation doesn't run (`seesRec`) |
| index.js waiting runs (delays, agent steps) | dropped when the record is no longer the maker's to see |
| index.js date automations (`record.date`) | each record `seesJob` for the maker |

## C. Messages: guarded at the socket
`broadcast` checks `PJ.seesMsg(msg, member)` for every socket: a message with `record.id` or `recordId` (types
`record`, `record:log`, `visits`, `jobrun`) reaches only those who see that job. `record:gone` goes to the one member
(`forMember`). `record:remove` and `records:refresh` carry ids only. Notices about a step go to the member it names
(who sees the job by rule 4). A job with a files stack: a member who gains or loses it gets `resync`, so the stack
comes or goes with it.

## D. Not a person's read (no change needed)
Server bookkeeping and the customer's own links: run sweeps (`recOf`, `jobStepsOnce`), stage sync (`syncJob`,
`advanceJob`), deleting and cascading (`recordGone*`, list/field removal), imports and templates (`importProject`,
copies), tags (`newTag`), rollup recalculation, webhooks (`hooksFire`, full by design, owners' integrations),
QuickBooks and CompanyCam sync (owners' connections), invoices (owners' and admins' routes), share links `/q/:token`,
sign links `/s/…`, the customer's invoice page, tech/GitHub boards (not job lists), test-only routes.

## E. Known limits, stated
- Rollups: a record's rollup over linked records is one stored number for everyone; a member's visible record that
  rolls up a job they can't see shows the total (a number, never a name or id). Jobs rarely link to jobs; per-reader
  rollups are out of scope.
- Link writes: a member can store a link to a job id they can't see if they already have the id; reads of it give the
  id only, no name.
- A member who can see a job whose record points at another job (a Job field) gets that name on reads with their view,
  but not on live updates in an "own" team (those are rendered without a reader); the next read has it.
