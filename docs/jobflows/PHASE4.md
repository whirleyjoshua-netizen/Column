# Job Flows — Phase 4 (Links) contracts, checkpoint 1

Status: draft for review, 2026-11-25. No code yet. The spec's build order: "Links. A stack per job, clients on the
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

- `GET /api/map/jobs?from=&to=` (everyone with Jobs and the Map tool): the jobs the person can see (Jobs list rules)
  that have an address (the job's `address` field, else its client's), plus, for owners and admins, clients with an
  address and no job in range. Each point: `{ kind: 'job'|'client', id, name, address, lat, lng, stage?, flow?, next? }`.
  Members never get a client's email or phone (as the Jobs list).
- Geocoding: Mapbox on request (`routes.js`' `geocode`), at most 200 addresses per request, cached in memory per
  team for 10 minutes, **never stored** (Mapbox's free terms). Without `MAPBOX_TOKEN`: 200 with
  `{ points: [], off: true }` and the Map says it isn't set up.
- The Map tool gets a "Jobs" layer (on/off), pins coloured by step state; a pin opens the job.

## 3. Tasks and Campaign steps

- `tasks` step: `settings.bundleId` (a saved bundle the team owns, the existing saved-tasks bundles) as an
  alternative to the text lines; its tasks are copied when the run starts (as today). Publish: a bundle that exists
  and the publisher can see; text lines or a bundle, not neither.
- New kind `campaign`: `settings.templateId` (a saved campaign the publisher can see). When the step becomes the
  run's current step, a campaign is made from the template, linked to the job (`recordId`, owner = the run's owner,
  name "<template> · <job>"), once per step cycle (`g.campaignId`, saved before it's made). Done when that campaign
  is done (status `done`); a deleted campaign reopens the step (and the next time it's current, a new one is made).
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
- When that step is met for the first time in a run, for each of the job's lines whose `from` is `item:<id>` and
  whose Item has an `invItemId`: a `use` movement of the line's quantity from `fromPlace`, with `recordId` and the
  step, recorded once (`g.stockUsed = { at, moves: [ids] }`, saved before the moves).
- Stock never goes below zero (Inventory's rule): a line with too little at the place is used up to what's there and
  the rest is noted on the job's timeline and the step ("Short 2 × Filter at Truck 1"); nothing is blocked.
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
| `jobflow_links.mjs` (5255) | stack: made once at start/attach with `stack: true` and from the job page; a file in it is seen by whoever sees the job and **not** by a member who can't see the job's private project — through state, the item routes, search, a chat pin, a share link, export and the public API; "members see only theirs" mode; deleting the job trashes its stack's items. Map: a stand-in Mapbox (as tests/routes.mjs); jobs and clients with addresses, members only their visible jobs and no client contact details, 200-address cap, nothing stored (a restart re-geocodes), off without a token. Tasks from a bundle. Campaign step: made once when current, linked to the job, done when the campaign is done, a deleted campaign reopens it and a new one is made next time, the job's stage not moved by it, members can't be its who. Chat pin: label and next step for those who see the job, locked for others, gone with the job. Inventory: use moves once when the work step is met, short stock noted not blocked, reopen and redo doesn't use twice, publish needs a real place |
| `jobs_ui.mjs` (Chrome) | with the client: Files on the job, the builder's new settings, the Campaign step on the run card, Pin to a chat, the Map's Jobs layer |

Existing suites that must stay green: everything in PHASE3 §7, plus stacks/items suites, chatpins, routes,
inventory_*, campaigns (jobcampaign, cc_*), visibility, member_access, audit_access, export, apiwide.

## 8. Out of Phase 4
A job's own chat feed (pinning covers "the job in chat"; a feed per job can come later); storing geocodes; returning
stock automatically on reopen; recurring work; moving old jobs onto flows.
