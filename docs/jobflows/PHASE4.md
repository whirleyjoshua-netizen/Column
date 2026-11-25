# Job Flows — Phase 4 (Links) contracts, checkpoint 1

Status: round 2 for review, 2026-11-25 (round 1 answers in §9). No code yet. The spec's build order: "Links. A stack per job, clients on the
map, Tasks and Campaign steps, the job in chat, Inventory use." Branch `jobflows-links`, cut from `jobflows-auto`
(Phase 3, approved, plus the owner's walkthrough fixes at b538574).

## 0. What exists, and is reused

| Piece | Today | Phase 4 |
| --- | --- | --- |
| Stacks | `ws.stacks[] = { id, name, campaignId }`; a campaign gets one at creation. Items (files, notes, photos) carry `stackId`; their visibility is the campaign's (`campaignOf('item')` → `seesCampaign`), plus `seesOwn` in "members see only theirs" mode | A stack can belong to a job instead (`recordId`), and its items' visibility is the job's |
| Map | Map tool: each person's own trips, pins and zones (`GET /api/map`). Mapbox only for routes; geocoding results are never stored (Mapbox free terms), routes cache a few minutes in memory | A team layer: jobs and clients with addresses, geocoded on request, never stored |
| Tasks step | Phase 1: `settings.tasks` (text lines) made when the run starts | Also from a saved bundle |
| Campaigns on a job | Ordinary campaigns can be linked to a job (`c.recordId`); a run owns the stage (CONTRACTS §1.5) | A Campaign step starts one from a saved campaign and waits for it |
| Chat pins | `CHAT_PIN_KINDS = ['stack','doc','dir','agent']`; each reader sees a pin only if they can open it (locked chip otherwise) | `job` pins |
| Inventory | Items, places, the movement ledger (`move` kinds receive/move/use/…, with `recordId`), a job's stock view; Items (Phase 2) have an optional `invItemId` | Using a job's stock off Inventory when its work is done |

## 1. A stack per job

- Flow setting `stack: bool` (default false; versioned). When a run starts or attaches with it, the job gets one
  stack `{ id, name: <job name>, recordId }` (`rec.stackId`), unless it already has one. A job never gets two.
- An owner or admin can also make one from the job page (`POST /api/jobs/:id/stack`), flow or not.
- **Visibility travels with the job** (CODING-GUIDE: "visibility travels with the data"). For an item whose top-level
  stack has `recordId`:
  - `campaignOf('item')` stays null (it isn't a campaign's);
  - a new `jobOfItem(x)` gives the record, and `canSee(auth, 'item', x)` additionally requires that the person can
    see that job (`PJ.recordAt` / `PJ.sees` on its project, and the members switch);
  - `seesOwn('item')` in "members see only theirs" mode: a job-stack item is visible to a member who can see the job
    in Jobs (the same rule as the Jobs list).
  Every path that uses `canSee(…, 'item', …)` or lists `ws.stacks` gets this for free; the ones that don't
  (state's `stacks` list, search, chat pins, public share links, export, agents' read tools, the public API) are
  listed and fixed in the implementation, each with a test.
- Deleting the job: its stack and the stack's items go to the trash like a campaign's do when a campaign is deleted
  (same purge rules, `purgeTrash`), never left visible to everyone.
- The job page: "📁 Files" opens the stack (the existing stack view). The run card doesn't change.

## 2. Clients and jobs on the map

- `GET /api/map/jobs?from=&to=&undated=` (everyone with Jobs and the Map tool): the jobs the person can see (Jobs list
  rules) that have an address (the job's `address` field, else its client's), plus, for owners and admins, clients with
  an address and no job among the points. Each point: `{ kind: 'job'|'client', id, name, address, lat, lng, stage?,
  flow?, next?, scheduled? }`. Members never get a client's email or phone (as the Jobs list).
- **The range** filters jobs by their Scheduled day (the job's `scheduled` field, which `syncJob` keeps at its next
  visit's day), on the team's calendar: `from` and `to` are `YYYY-MM-DD`, inclusive. Absent: from today to 30 days
  ahead (team clock). Invalid, or `from` after `to`, or a range over 366 days: 400. Jobs with no Scheduled day are
  included only with `undated=1`.
- **Limits**: at most 200 points, in a fixed order (Scheduled day, then name, then id; clients after jobs, by name),
  the rest left out with `more: <count>` (deterministic truncation, no paging in Phase 4). At most 200 distinct
  addresses are looked up per request (the points' addresses, after normalising: trimmed, spaces collapsed,
  lower-cased). Each lookup has a 5-second timeout; a failed or timed-out one leaves that point out and counts it in
  `missing`. The answer is never an error because of Mapbox.
- **Cache**: in memory, keyed by team id + normalised address, 10 minutes; one lookup per address per window however
  many points share it. **Never written** to the database or a record (Mapbox's free terms); a restart starts empty.
  Without `MAPBOX_TOKEN`: 200 with `{ points: [], off: true }` and the Map says it isn't set up.
- The Map tool gets a "Jobs" layer (on/off), pins coloured by step state; a pin opens the job.

## 3. Tasks and Campaign steps

- `tasks` step: `settings.bundleId` (a saved bundle the team owns, the existing saved-tasks bundles) as an
  alternative to the text lines. **Snapshot at publish**: publishing copies the bundle's tasks into the version's
  `settings.tasks` and keeps `settings.bundleFrom = { id, name }` for display, so editing or deleting the bundle later
  never changes a published version (republish to pick up its changes). Publish: a bundle that exists and the
  publisher can see.
- New kind `campaign`: `settings.templateId` (a saved campaign the publisher can see). **Snapshot at publish**: the
  template's definition is copied into the version (`settings.template = <copy>`, `settings.templateFrom = { id,
  name }`), so a later edit or deletion of the saved campaign doesn't change a published version. When the step
  becomes the run's current step, a campaign is made from that snapshot, linked to the job (`recordId`, owner = the
  run's owner, name "<template> · <job>"). Done when that campaign is done (status `done`).
- **Once, and recoverable** (round 1, point 1): the step records `g.campaign = { id, state }` with three states:
  `made` (the campaign exists), `deleted` (it existed and was deleted: the step is open again and the next time it's
  current a new one is made, with a new id), and nothing yet. The campaign's id is chosen first and the campaign is
  made **in the same synchronous turn** as the marker (see §5.1), so there's no "reserved but not made" state that a
  crash could leave behind. If a marker ever names a campaign that doesn't exist and was never seen (`made` but no
  campaign, e.g. a restore from an older backup), the sweep treats it as never made and makes it again **with the
  same id**, so it can't end up with two.
  It's an ordinary campaign: it shows in Campaigns, fires campaign events, and has its own feed and stack; **it
  doesn't move the job's stage** while the run owns it (CONTRACTS §1.5 stage ownership, unchanged).
  Who: `campaign` steps are for owners and admins (a campaign is made in their name).

## 4. The job in chat

- `job` is a chat pin kind: `{ kind: 'job', id: recordId }`. A reader who can see the job gets
  `{ label: <job name>, icon: <flow icon or 🛠️>, next: <current step name> }`; anyone else a locked chip (as today).
  Pinning needs the pinner to see the job. A deleted job's pin disappears.
- The job page's ⋯ menu: "Pin to a chat…".

## 5. Inventory use

- `work` step setting `useStock: bool` (default false) and `fromPlace: placeId` (an Inventory place of the team; at
  publish it must exist). Only with the Inventory tool on.
- When that step is met for the first time in a run: the job's lines whose `from` is `item:<id>` are read, and each
  Item's `invItemId` is resolved **then** (at execution, not snapshotted on the line).
- **Quantity and units**: a line's quantity is in its Item's unit, and one Item unit is one Inventory unit (no
  conversion in Phase 4). If the Item and the Inventory item both name a unit and they differ (say "box" and "each"),
  that line is skipped and noted ("Units differ: box vs each"), not converted. Lines for the same Inventory item are
  added up into one use. Skipped and noted, never blocking: an Inventory item that's gone or archived, or one tracked
  unit by unit (`track: 'units'`, which are checked out one by one), or an Item with no `invItemId`.
- **One move per Inventory item, at most what's there**: the use is capped at the stock at `fromPlace`, so two lines
  for the same stock can't together take more than there is; the shortfall is noted on the job's timeline and the
  step ("Short 2 × Filter at Truck 1"). Stock never goes below zero.
### 5.1 Why the markers are safe here (round 1, points 1 and 2)
Kloomie keeps its data in memory and writes changed records in one transaction (store.js); a write takes everything
changed so far. So a marker and the changes it guards, made **in one synchronous turn with no `await` between them**,
reach the database together or not at all: there is no window where the marker is kept and the campaign or the
stock moves aren't, or the other way round. Phase 3's messages were different because an outside call sat between
the two. The rule for Phase 4's code: the campaign step and the stock use each run start to finish without awaiting
anything (the existing `createCampaign` and Inventory `move` are synchronous), and the marker (`g.campaign`,
`g.stockUsed = { at, key, moves: [ids] }` with `key = runId:goalId:cycle`) is written in that same turn. Each move
also carries that key, so a check can always tell which moves a run made. The tests restart the server right after
each one and check that both halves are there, and that nothing repeats.

- Reopening the step doesn't put stock back (an owner returns it in Inventory, as for any use); finishing it again
  doesn't use it twice (the marker). Members can see the step's "used" note; quantities and costs follow Inventory's
  own rules (costs owners and admins only).

## 6. Permissions
Flow building: owners and admins (as all flow editing). `campaign` steps: owners and admins. Job stack: anyone who
can see the job sees and adds to it (like a campaign stack for its members); deleting items follows the existing
item rules. Map: members see only the jobs they can see. Pins: as today plus the job's visibility.

## 7. Tests (written first, failing on `jobflows-auto`)

| Test (port) | Covers |
| --- | --- |
| `jobflow_links.mjs` (5255) | round 1 additions: two concurrent start/attach requests make one stack; a member who sees the job reaches its stack, and a stack id doesn't get anyone past the job's visibility; deleting the job, its list (a type) and its project each trash the stack's items; a member who loses access to a job sees its pin locked at once (and after a live update); the map looks up a shared address once per window, truncation is deterministic with `more`, a failing or slow lookup leaves the point out as `missing`, range defaults and 400s; a campaign linked to a job doesn't move its stage through its own steps or automations; two lines for one Inventory item take at most what's there; a bundle or saved campaign edited or deleted after publishing doesn't change the version; a restart right after the campaign is made or the stock is used shows both the marker and the change, and nothing repeats. And: stack: made once at start/attach with `stack: true` and from the job page; a file in it is seen by whoever sees the job and **not** by a member who can't see the job's private project — through state, the item routes, search, a chat pin, a share link, export and the public API; "members see only theirs" mode; deleting the job trashes its stack's items. Map: a stand-in Mapbox (as tests/routes.mjs); jobs and clients with addresses, members only their visible jobs and no client contact details, 200-address cap, nothing stored (a restart re-geocodes), off without a token. Tasks from a bundle. Campaign step: made once when current, linked to the job, done when the campaign is done, a deleted campaign reopens it and a new one is made next time, the job's stage not moved by it, members can't be its who. Chat pin: label and next step for those who see the job, locked for others, gone with the job. Inventory: use moves once when the work step is met, short stock noted not blocked, reopen and redo doesn't use twice, publish needs a real place |
| `jobs_ui.mjs` (Chrome) | with the client: Files on the job, the builder's new settings, the Campaign step on the run card, Pin to a chat, the Map's Jobs layer |

Existing suites that must stay green: everything in PHASE3 §7, plus stacks/items suites, chatpins, routes,
inventory_*, campaigns (jobcampaign, cc_*), visibility, member_access, audit_access, export, apiwide.

## 8. Out of Phase 4
A job's own chat feed (pinning covers "the job in chat"; a feed per job can come later); storing geocodes; returning
stock automatically on reopen; recurring work; moving old jobs onto flows.

## 9. Round 1 review (ChatGPT), and what changed
1. **Campaign creation idempotency**: §3 and §5.1. The id is chosen, the marker written and the campaign made in one
   synchronous turn, which Kloomie's write model keeps together; states made / deleted / none; a marker naming a
   campaign that never existed (an old backup) is remade with the same id. A restart test checks it.
2. **Inventory use idempotency**: §5.1. The same rule: marker and moves in one synchronous turn; each move carries
   the run:step:cycle key; restart test.
3. **Quantity and link rules**: §5. One Item unit = one Inventory unit, differing named units skip and note; the
   link is read when the step is met; lines for one Inventory item are added up; missing, archived or unit-tracked
   items skip and note; capped at what's there.
4. **Map range and limits**: §2. Scheduled day on the team's calendar, default today to +30, 400 on bad input,
   `undated=1`; 200 points with deterministic order and `more`; 200 distinct lookups, 5-second timeout, failures as
   `missing`; cache by team + normalised address, memory only.
5. **Bundle and template**: §3. Both snapshotted into the version at publish, with where they came from for display.

