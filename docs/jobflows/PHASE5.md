# Phase 5: the rest of the Jobs tab (contract)

The spec's build order: "The rest of the tab. Overview pipeline, Clients, Schedule moved into Jobs, member access
switches, Move my jobs here." The owner said "do phase 5" on 2026-11-25. This contract says what each piece is,
on the server and in the app, what members get, and the tests written first.

Built on what's live (main 3af3b91): Jobs is a Workspace tab (`WORK_TABS` `jobs`, `toolOn('projects') &&
memberMay('projects')`) with sub-tabs Jobs, Quotes, Invoices, Items, Job Flows (the last four for owners and admins);
`GET /api/jobs` (jobsList); `GET /api/schedule?date=` (one day's job visits per person, plus "Jobs to schedule");
`POST /api/jobs/:id/flow` (put one job on a flow, admins); ready-made starts in the builder (`JB_STARTS`: service,
install, cleaning); members don't see prices (PRICES.md).

## 0. Two changes to the spec, and why
1. **No member switches for Quotes, Invoices or Items.** The spec gave each a switch in What members can use. The
   owner's later decision that members don't see prices or costs (PRICES.md) supersedes it: all three are prices.
   They stay owners' and admins' with no switch. **Job Flows** stays owners' and admins' too: "May members build
   flows?" is still an open question in the spec, so no switch until the owner answers it.
2. **Boards keep showing the jobs that move.** "The Board … stops showing the moved jobs" is left to Phase 7
   ("Boards without jobs"), which takes jobs out of Boards altogether. Hiding them in Phase 5 would leave jobs a
   member can reach only one way for one phase and the other way the next.

## 1. Overview (the pipeline)
Jobs → **Overview** is the first sub-tab, for everyone who has the Jobs tab.

`GET /api/jobs/overview` → `{ counts: { quote, book, today, invoice, payment }, lists: { quote: [ids], … } }`,
over exactly the jobs `GET /api/jobs` gives this person (§5 applies), so a count never shows a job the list
wouldn't. A job is in:
| Count | A job is in it when |
|---|---|
| `quote` (To quote) | its run's current step is a Quote step |
| `book` (To book) | its run's current step is a Book step |
| `today` (Booked today) | it has a visit today (the team's day, `teamDay`) that isn't done, flow or not |
| `invoice` (To invoice) | its run's current step is an Invoice step |
| `payment` (Waiting for payment) | its run's current step is a Payment step |

A job counts once per row (several visits today are one job). Jobs not on a flow count only in `today`. No amounts,
for anyone: the Overview is counts. Each count opens Jobs → Jobs filtered to that list (`JB.pipe`), with a chip to
clear it. + New job stays where it is (Jobs → Jobs) and is on the Overview too.

## 2. Clients
Jobs → **Clients**: everyone you work for. Same records as Contacts (one home: the spec's table).

`GET /api/jobs/clients` → `{ clients: [{ id, name, company, jobs, open, last, quotes?, invoices?, balance? }] }`:
- who's listed: a team contact that's the client of at least one job this person may see (the job list's contact
  field), plus contacts in the team's client groups (contact groups whose name is Clients or Customers) for owners
  and admins;
- `jobs` (how many), `open` (how many not done: no run, or a run not done), `last` (the newest job's date);
- owners and admins also get `quotes` (open: sent, not answered), `invoices` (unpaid) and `balance` (cents owed on
  sent, unpaid invoices); members never get these three (prices, PRICES.md);
- members: only with the **Contacts** switch on (What members can use → Contacts); off → 403, as Contacts is today.
  A member's list is only the clients of jobs they may see (§5), never the client groups.
- A client opens its contact page (as Contacts does), which already lists its jobs. "+ New client" adds a contact
  (the existing route and its rules); "On the map" opens Map → Jobs with clients (Phase 4).

## 3. Schedule (moved into Jobs)
Jobs → **Schedule**: the team's job visits by day (the Team page's Visits view, moved) and by week.
- Day: today's `teamVisits` (lanes per person, drag a job from "Jobs to schedule" onto a person and time, 🗺 route
  for the day). The Team page keeps a link to it ("Job visits are in Jobs → Schedule").
- Week: `GET /api/schedule?week=YYYY-MM-DD` (the week's Sunday) → people × 7 days, each cell the visits that day
  (kind, job, time). Dragging a job onto a cell opens the visit sheet for that person and day, as Day does.
- **Who sees whom (fixes today's inconsistency):** everyone's lanes need `isAdmin || memberMay('teamSchedule')`, the
  same rule as workload, forecast and hours. Today `/schedule` gives members only their own lane whatever the
  switch says. With the switch on, a member sees everyone's lanes for the jobs they may see (§5).
- "Jobs to schedule": jobs (this person may see) whose run's current step is a Book step, plus jobs not on a flow
  that are open, have a client and nothing booked ahead (today's rule). A flow job not at a Book step isn't listed.

## 4. Member access switches
Nothing new in What members can use; the Jobs tab reads the switches there:
| Sub-tab | Members |
|---|---|
| Overview, Jobs | with Boards on (`projects`, as now) |
| Schedule | their own lanes always; everyone's with The team's schedule on |
| Clients | with Contacts on |
| Quotes, Invoices, Items, Job Flows | never (§0) |
The Settings rows say where each shows in Jobs (Boards: "also the Jobs tab"; Contacts: "also Jobs → Clients"; the
team's schedule: "also Jobs → Schedule"). All enforced on the server; the app only hides what the server refuses.

## 5. Members see only their own jobs (the "members see only theirs" setting)
The spec: members see Overview, Schedule and Jobs "limited to their own jobs unless an admin lets them see all (the
existing 'members see only theirs' setting)". Today that setting (`ws.settings.visibility === 'own'`) narrows
campaigns, tasks and files, but not board records. Phase 5 adds jobs.

**The rule (one function, `PJ.seesJob(rec, memberId)`):** in a team set to `own`, a member sees a record in a job
list (`isJobList`) only when it's theirs:
1. they made it (`rec.memberId`);
2. a person field on it is them;
3. they're on one of its visits (any, done or not);
4. a step of its going run names them (`who: member`), or names a role they have.
Owners and admins see every job. In a team set to `all`, nothing changes. Records in other lists (CRM, bids,
anything custom) are unchanged: the setting is about jobs here.

**Every path.** `PJ.recordAt` gains the check (it's what job routes, record routes, agents and pins call), and each
place that lists records filters with it: the board's records list and its counts, `GET /api/jobs` and
`/jobs/overview`, `/schedule` (visits and Jobs to schedule), Map → Jobs (`mapJobs`), search, records for a contact
(a contact's page), the public API list and read (as its key's maker), agents' find and read, the export (a member's
own export), chat pins and the job's stack (Phase 4's stack visibility already follows the job), WebSocket `record`
messages (members not allowed the job don't get them, as `seesMsg` does for private boards), the bell/notices about a
job, linked-record names (a job a member can't see shows as "a job" with no name, as private boards do now). The
test lists each path (§7).

**When it changes.** A job becomes a member's the moment a rule above starts holding (assigned, booked, step
reached) and stops when none does; the next read and the next broadcast follow. Switching the team between `all`
and `own` resyncs the members' state, as it does for campaigns today.

## 6. Move my jobs here
Jobs → Overview, owners and admins, shows **Move my jobs here** while any job board has jobs not on a flow.

`GET /api/jobs/move` → per job list (`{ projectId, typeId, board, list }`): how many jobs aren't on a flow, how
many are on campaign steps (legacy; they don't move), the stages they're at, the published flows for that list, and
a suggested ready-made start (by the list's trade family; `service` when unsure).

`POST /api/jobs/move` `{ projectId, typeId, flowId | start, recordIds? }`, owners and admins:
- `flowId`: a published flow for that list. Or `start`: one of the ready-made starts; the server makes and publishes
  a flow for the list from it (named after the list, `fromStart`), the same steps the builder's start gives (the
  starts move to the server: `server/jobflows.js` `STARTS`, and the app reads them from there).
- each job not on a flow and not on campaign steps (all of them, or `recordIds`) gets a run on that flow's active
  version, **at the step matching its stage**: the last step whose `stage` is the job's current stage, or, when no
  step names it, the first step. Every step before that one that isn't already met is marked skipped with the
  reason "Before the move to Job Flows" (who: the mover). A job whose stage is the flow's last stage gets a run with
  every step met or skipped, so it's done.
- **Nothing reaches a customer because of the move.** A move never sends: steps skipped by the move don't run their
  automatic sends, and the step a moved job lands on, if it sends by itself (Phase 3b), is held as "Ask me first"
  for that first time (a pending send, as Phase 3b's ask). No `step.done` or `job.flow.done` events fire for steps
  the move skips or for jobs the move finishes (automations stay quiet); the job's timeline says "Moved onto the flow
  “…” at “step”".
- The job's stage doesn't move (it's what picked the step).
- Atomic per job, not per request: a job that can't move (gone, now on a flow, another list) is reported and skipped;
  the answer is `{ moved, skipped: [{ id, why }], flowId }`. Up to 2,000 jobs a request.
- Also offered on the same screen: copy the board's price list into Items (the existing `POST /job-items/import`).
- The team-wide customer-message switches already stop for a job once it's on a flow (Phase 3, `onFlowSince`). A
  flow made from a start by the move gets a Visit reminder step and a Review request step when those switches are
  on, set to "Ask me first" (the owner: confirm anything that goes to a customer).

## 7. Tests, written first (each fails on main)
- `tests/jobs_tab.mjs` (5264): the Overview counts against fixtures for each row (and the same jobs as `/jobs`); a
  job with two visits today counts once; no amounts for anyone; Clients for owners (with quotes, invoices, balance)
  and members (Contacts switch on: no money fields; off: 403); a member's clients only from jobs they may see;
  Schedule week shape; `/schedule` everyone's lanes only with the teamSchedule switch (and members' own lane without
  it); Jobs to schedule for flow jobs is the Book step only.
- `tests/jobs_own.mjs` (5265): a team set to `own`; a member with one job of each kind of "theirs" (made, person
  field, visit, step `who`, step role) and one job that isn't theirs; for each path in §5 the member gets theirs and
  not the other; owners and admins get all; non-job records unchanged; a job becoming theirs (booked onto a visit)
  and stopping (taken off) shows on the next read and the next broadcast; `all` changes nothing.
- `tests/jobs_move.mjs` (5266): `GET /jobs/move` counts; moving with a flow and with a start (a flow made and
  published, `fromStart`); each job lands on the step for its stage, steps before it skipped with the reason, met
  ones left met; a job at the last stage is done; legacy jobs and jobs already on a flow untouched; nothing sent
  (outbox empty), no `step.done` / `job.flow.done` / automation runs, an auto-send step landed on is pending "ask";
  members 403; `recordIds`; a second move moves nothing; saved across a restart.
- `tests/jobs_tab_ui.mjs` (5267/9604): Overview counts open filtered Jobs; Clients list (owner sees balance, member
  doesn't); Schedule day and week, dragging a job onto a person; Move my jobs here moves a board's jobs.
- Existing suites stay green: jobs_list, jobflow_*, jobs_ui, member_access(_ui), visibility, routes, member_prices,
  contacts, schedule-related (teamload_ui, forecast).

## 8. Not in Phase 5
Recurring work (Phase 6). Jobs as its own top tab, Contacts as Clients, Boards without jobs (Phase 7). A client hub
for customers (open question).
