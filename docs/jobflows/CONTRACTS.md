# Job Flows — Phase 1 contracts (checkpoint 1)

Status: draft for review, 2026-11-24. No code yet. The product spec is the owner's "Kloomie Jobs & Job Flows — spec and
workspace map"; this file is the engineering contract for its Phase 1, agreed in review with ChatGPT.

## 0. Decisions already locked

| Decision | Choice |
| --- | --- |
| Jobs | Stay `db.records` in job lists (type key `jobs` or `trade_*`). No new jobs collection; ids never change. |
| Definitions | New `db.jobFlows` + `db.jobFlowVersions` (immutable once published). Internal names never say "flow" alone: `server/flows.js` is automations. |
| Execution | A run is a campaign with `kind: 'job'`; each step is a goal with `kind: 'step'`. One progress engine: `jobSteps()`. |
| Progress | The run's step order is the source of truth for "where is this job". The job's stage field is a projection (only steps that name a stage move it). |
| Legacy | Jobs with ordinary campaigns keep working exactly as now. Nothing is converted in Phase 1. |
| Money, visits, sign-offs | The run references them; it never stores their status. |

## 1. Data

### 1.1 `db.jobFlows[id]`
```
{ id, wsId, name (≤80), icon (one emoji), draft: Body, activeVersionId: string|null,
  archived: bool, createdBy: memberId, createdAt, updatedAt }
```
- `draft` is the only editable copy. Editing never touches a version.
- Archived: can't be picked for new jobs; runs already going carry on.
- Limit: 50 flows a team.

### 1.2 `db.jobFlowVersions[id]`
```
{ id, flowId, wsId, n (1,2,3…), body: Body (deep copy, never written again), publishedAt, publishedBy }
```
- Publish = validate `draft` → copy it into a new version → `activeVersionId = new id`. No route edits a version.
- Copy flow = a new flow whose `draft` is a copy of the source's active version (or draft), unpublished.

### 1.3 Body
```
{ list: { projectId, typeId },          // the job list new jobs go into (must be a job list the publisher can see)
  whoCreates: 'admins' | 'everyone',   // who may start jobs on it (default admins)
  steps: Step[] (1–30) }
Step = { id (stable across versions), kind, name (≤80), who, how, doneWhen, canSkip: bool, stage: string|null, settings }
who  = { type: 'anyone' | 'admins' | 'role' | 'member', id? }      // 'anyone' = anyone who may edit the job (§5), not just view it
how  = 'auto' | 'tap' | 'hand'                                      // derived from kind in Phase 1, shown as a label
```

### 1.4 Phase 1 step kinds (a capability contract: only these are offered)

| kind | What the worker sees | doneWhen (server-evaluated) | how |
| --- | --- | --- | --- |
| `client` | Pick or add the client | the job's contact field holds a contact the team owns | tap |
| `details` | The job's fields | each field in `settings.fields` (by key) is filled; none listed → Done button | tap |
| `book` | Book a visit (the existing visit sheet, prefilled) | a visit exists for the job (of `settings.visitKind` if set) | tap |
| `work` | Checklist + photos | every required item of the job's checklist field ticked, and the photos field filled if `settings.photos` | tap |
| `signoff` | Customer signs | the job's signature field is filled (existing sign-off forms write it) | tap |
| `invoice` | Make and send the invoice (existing invoice sheet) | an invoice for the job is `sent`, `viewed`, `partial` or `paid` | hand |
| `payment` | Record a payment / share the pay link | an invoice for the job is `paid` (Stripe or a recorded cash/check payment, both existing paths) | auto |
| `tasks` | The step's tasks (made when the run starts, from `settings.tasks` or a saved bundle) | all its tasks done or skipped, at least one task | tap |
| `custom` | `settings.text` + optional checklist | the Done button (`g.marked`), and its own checklist all ticked | hand |

Not offered until a later phase: quote, deposit, materials, customer update, review, campaign, site visit (a `book`
step named "Site visit" covers it).

- Conditions are pure functions of the live records (`stepCondition(g, rec)`), like the existing `field` need.
  Nothing is copied into the goal except `g.marked = { byId, at }` for Done buttons.
- A step's `needs` (stock, equipment, visit, field) keep their existing meaning and still must be met. `doneWhen` is
  a separate goal property; `NEED_KINDS` doesn't change.

### 1.5 The run
Campaign (existing fields, plus):
```
{ kind: 'job', recordId, flowId, versionId, inOrder: true, status: 'active'|'done'|'cancelled', private: false,
  name: '<flow name> · <job name>', ownerId: the person who started it }
```
Goal per step (existing fields, plus):
```
{ kind: 'step', step: <Step copy, frozen>, stage: step.stage, marked: null|{byId, at},
  skipped, skipReason, skippedById, skippedAt }
```
- `goalMet(g)` for `kind:'step'`: `skipped || (stepCondition(g, rec) && tasks done && needsMet(g))`, `rec` being the run's job (§2.1).
- `jobStepsOnce` gets one change (checkpoint 1, second review): its completion calculation is
  `g.kind === 'step' ? goalMet(g) : <today's expression, unchanged>`. Today's expression doesn't call `goalMet` for
  `tasks` goals, so without this a step with no tasks and no needs would count as finished whatever its condition.
  Every legacy goal kind keeps today's calculation byte for byte. Beyond that the sweep is as it is: fires `step.done`
  once on the change, moves the stage for goals with `g.stage`, finishes the campaign when all goals are.
- **Stage ownership.** A job with an active `kind:'job'` run: only the run's goals count, both for moving the stage
  (the sweep) and for holding it (`openStepsUpTo` in `stageGate`). An ordinary campaign on the same job still runs
  and finishes its own goals, but neither moves nor holds that job's stage. A job without an active run: today's
  behavior exactly (every campaign on the job counts).
- **Custom steps.** The Done route only records `g.marked`; the sweep decides. A custom step with a checklist stays
  unfinished after Done until its checklist is all ticked.
- **Which invoice.** Making an invoice from the run's Invoice step binds it (`g.invoiceId`, set by the invoice
  route when the request names the step and the step has no bound invoice, or its bound one is void: a replacement
  invoice for a voided one takes its place). The invoice step is met by its bound invoice being sent, viewed,
  partial or paid; with none bound, by any non-void invoice for the job created after the run started. The payment
  step reads the flow's invoice step's bound invoice (paid); with none, at least one non-void invoice for the job
  created after the run started, and every such one paid. An invoice from before the run never counts, so an old paid
  invoice can't finish a new job's payment step.
- A job has at most one run with `kind:'job'` and `status:'active'`. An ordinary campaign on the same job is
  allowed and is never mistaken for the run.

## 2. Transitions

| Action | Route | Who | Rules |
| --- | --- | --- | --- |
| Start a job | `POST /api/jobs {flowId, values, contactId?, key}` | `whoCreates`, plus the existing record-create authorization (amendment C) | Uses the flow's active version. Authorization is the same path as `POST /projects/:id/records`: project in this team and `sees(p)`, `memberMay(ws, auth, 'projects')`, the rules hold (`holdDiscount`), then `newRecord`'s own validation. All checks and the run's goals are built and validated first; only then are the record, run and goals written, in one synchronous block, and side effects (`record.created` news, broadcasts, `campaign`-free events) go out after the whole job exists. A throw before the write leaves nothing. `key`: scoped to team + person, kept 10 minutes in memory; same key + same body → the same job back; same key + different body → 409. |
| Attach a flow | `POST /api/jobs/:id/flow {flowId, replace?}` | admins | 409 if an active run exists and `replace` isn't true. Replace sets the old run `cancelled` (kept, shown in Activity). Never touches ordinary campaigns. |
| Done (button) | `POST /api/jobs/:id/steps/:stepId/done` | the step's `who`, or admins | Only `custom`, and `details` with no fields. Idempotent: already marked → 200, nothing changes. Not the current step → 409 (in order). |
| Skip | `POST /api/jobs/:id/steps/:stepId/skip {reason}` | the step's `who` if `canSkip`; admins always | Reason required (≤300). Timeline entry. Idempotent. |
| Tick a custom step's checklist | `POST /api/jobs/:id/steps/:stepId/check {item, done}` | the step's `who`, or admins | Custom steps only; stored on the goal (`g.checks`). The sweep decides. |
| Undo skip / reopen | `POST /api/jobs/:id/steps/:stepId/reopen` | admins | Clears `marked` or `skipped`. Live conditions re-evaluate as they are. |
| Cancel run | `POST /api/jobs/:id/flow/cancel {reason}` | admins | Status `cancelled`; the job stays. |

- "Next" in the UI is not one route. The server returns `next: { stepId, action }` with `action` one of
  `done` | `pick-client` | `edit-fields` | `book-visit` | `checklist` | `sign` | `invoice` | `payment` | `tasks`; the button
  opens that screen, and the step finishes only when its condition becomes true on the server.
- Every write ends with `stepsSoon(wsId)` (the existing sweep). The sweep is the only place a step becomes finished,
  so a webhook, a retry and a click can't finish it three times: `g.finished` changes once, `step.done` fires once.
- Stage moves still go through `stageGate` on every path. When the job has an active run, `openStepsUpTo` counts only
  that run's goals (§1.5 Stage ownership); without one, every campaign on the job as today. Either way a person can't drag
  the stage past an unfinished step; the admin override with a reason stays.
- Order: a later step's condition may already be true (paid before signed). It shows done; the current step is the first
  unfinished, unskipped one.

### 2.1 Reopening (amendment A, checkpoint 1 review)
- `stepCondition(g, rec)` is pure: it reads live records and changes nothing. `goalMet(g)` resolves the run's job
  (`db.records[c.recordId]`, same team) and calls it; no job found → the step is not met (never true by default).
  `jobStepsOnce()` stays the only writer of `g.finished`.
- Conditions are live: a voided invoice, a removed visit or signature, an unticked checklist item or a contact
  taken off the job reopens that step on the next sweep. Needs keep their existing latching (`seen`).
- When a step reopens: the stepper shows it as current again; a `done` run goes back to `active` (only runs finished
  by steps, `doneBySteps`, as today); **the job's stage never moves backward automatically**. A person can still move it
  back by hand; moving it forward again is held by `stageGate` until the step is met.

### 2.2 Completion cycles (amendment B)
- A step's completion cycle is `goalId:reopens`. `step.done` fires once per cycle: the sweep changes `g.finished`
  once, so duplicate deliveries (webhook retry, double click, an automation's change) inside one cycle do nothing.
- A genuine re-completion after a reopen is a new cycle and fires `step.done` again, with `cycle: n` (`reopens + 1`)
  and `again: true` in the event, so an automation can choose to run only the first time.
- Anything that must happen once per completion (later: an automatic invoice) keys on `goalId:cycle`.

### 2.3 Run completion and campaign events (amendment D)
- `step.done` fires for run steps with `run: true`, `flowId`, `cycle`.
- A run finishing fires a new event `job.flow.done` (the job, the flow, who). It does **not** fire `campaign.done`, and
  starting a run does not fire `campaign.started`: existing campaign automations never see runs. A campaign
  automation filter can't pick a run.

## 3. Reads

`GET /api/jobs?flow=&q=&mine=` → `{ jobs: [ { id, projectId, typeId, name, client: {name}|null, stage, scheduled,
run: null | { flowId, flowName, versionN, done, total, current: {stepId, name, kind, action, mayAct}, blocked: [...] },
legacy: bool } ] }`
- All job records the person may see (`PJ.recordAt`), with or without a run. Not limited by campaigns.
- `legacy: true` = an ordinary campaign drives it (shown as it is today, no stepper).
- No counts or totals for things the person can't see; client data no wider than `publicRecord` gives today.

`GET /api/jobs/:id/run` → the run, its steps in order with `state` (`done` | `skipped` | `current` | `waiting` |
`blocked`), what's missing for the current one, and `next`. The client never rebuilds this from goals.

`GET/POST/PATCH /api/job-flows`, `POST /api/job-flows/:id/publish|copy|archive`, `GET /api/job-flows/:id/versions`
— admins write; anyone who may create jobs on a flow can read its active version.

## 4. Keeping runs out of campaigns

- One helper on each side: `isJobRun(c)` = `c.kind === 'job'`; server `campaignsFor(ws, auth)` and
  `goalsFor(...)` used by every listing. The client never receives job runs or their goals in `S.campaigns` /
  `S.goals`; their changes go out as `{type:'jobrun', recordId, run}`.
- Audit (every `db.campaigns` read: index.js 90, agents.js 5, analytics.js 4, whiteboard.js 3, inventory.js 1,
  publicapi.js 1) classified as: include runs (jobSteps, stageGate, openStepsUpTo, needs, inventory goalId, forecast,
  work history, onRecordGone) or exclude runs (state, broadcasts, Campaigns/Command Center/Pulse, templates, agents'
  campaign tools, analytics campaign counts, whiteboard links, exports' campaign list, chat pins, public API
  campaigns, board).
- `campaignsFor()` returns ordinary campaigns only; runs need an explicit `{ runs: true }`. Added audit targets:
  campaign detail and deep links (`/c/` style links, `go 'camp:'`), templates (a run can't be saved as one, picked as
  a parent or source), `campaign.started` / `campaign.done` (not fired for runs, 2.3), follow-ups and next-up,
  campaign search, filters and counts, public or shared campaign links, broadcasts (runs go as `jobrun`), test runs,
  and deletion (deleting the job cancels and removes its run, as `campsOffJob` does now; a run can't be deleted on the
  campaign routes).
- Tasks of a `tasks` step are real tasks (`goalId` + `recordId`). They show in Tasks as the job's tasks; the client
  treats a task whose goal it doesn't hold as a job task, never as an orphan.

### 3.1 What a run response may show (amendment E)
- The job itself: `publicRecord` exactly as the record routes send it (records look the same to everyone who can
  see the project; secrets are already stripped there).
- Steps: name, kind, state, `how`, who may act (names only), skip reason. Step `settings.text` (custom instructions)
  is shown to whoever can see the job, as the flow's instructions to its workers; nothing private goes there.
- Missing pieces: in words ("no visit booked", "invoice not paid") with no amounts for members. Invoice numbers,
  totals and balances only for owners and admins, as on the invoice routes.
- Tasks of a `tasks` step: only those the person can see under the existing task rules; others counted as "N more".
- Flow reads: only the active published version of the person's own team's flows; drafts and older versions are for
  owners and admins.

## 5. Permissions (every route, every path)

- Flow write/publish/archive: owners and admins.
- Jobs list and run: `PJ.recordAt(id, ws, member)` plus `memberMay(ws, auth, 'projects')` (the jobs routes join
  `MEMBER_ROUTES.projects`). A member never gets a contact record through a job beyond what `publicRecord` shows now.
- Done / skip: the step's `who`; reopen, attach, replace, cancel: admins.
- `who` is validated at publish: a `member` id must be on this team, a `role` id one of the team's roles. At run
  time a member who has left, or a role that's gone, means only owners and admins may act on that step (shown on the
  step). `anyone` = anyone who may edit the job (sees the project and has the members switch), not merely view it.
  Step permission never grants an admin override, a payment, a signature on someone's behalf or a stage-gate override.
- Copying a flow makes new step ids; versions of one flow keep their step ids. Payments and invoices keep their own
  admin-only routes; the run only reads them.
- Automations: `step.done` already carries the job; the event gains `run: true` so automations can tell. No new
  automation actions in Phase 1.
- Agents: see runs only through the job (later phase); excluded from their campaign tools now.

## 6. Ready-made flows

A short reviewed set, generated deterministically from `trades.js` families when an owner taps "Add ready-made
flows" (never automatically, never overwriting an edited flow; each remembers `fromFamily`):
service (Client → Details → Book → Work → Sign-off → Invoice → Payment), install (Client → Book "Measure" → Details
→ Book "Install" → Work → Sign-off → Invoice → Payment), cleaning, recurring (one-visit version until Phase 6),
mobile. Each step names the family stage it reaches, so the old stage field keeps telling the truth.

## 7. Tests (written first, failing on main)

The cases ChatGPT asked for are grouped into five files (fewer servers to start; every assertion kept). Run log on
main: `docs/jobflows/checkpoint2-main.log`.

| Test (port) | Covers |
| --- | --- |
| `jobflows_defs.mjs` (5240) | drafts, publish n+1, versions immutable and no route edits one, step ids kept across versions, copy = new ids, archive, validation (no steps, 31 steps, kind not offered, bad list, another team's member), members read the active version only, other teams nothing, saved across a restart |
| `jobflow_run.mjs` (5241) | start = job + run, key dedupe and 409 on a different body; every Phase 1 condition from real records (client, fields, visit, checklist, signature, invoice sent, invoice paid, custom Done + checklist); live reopen (unticked item, payment removed) and re-finish; `step.done` once per cycle, a second cycle fires again (cycle 2); `job.flow.done` once; skip needs a reason and permission; reopen admins; attach / 409 / replace; an invoice from before the run never counts; v2 doesn't change a v1 job; archived = no new jobs, runs go on; restart keeps runs and fires nothing again |
| `jobs_list.mjs` (5247) | campaign-less, legacy, run, generic Jobs list and trade jobs listed; CRM records aren't jobs; private project hidden from members; no client email/phone to members; other teams nothing; start-job = record-create checks (rules OK for a discount, private project, flow for admins only, members switch off); `anyone` needs edit access; a step for a member who left falls back to admins |
| `jobflow_stage.mjs` (5248) | the run alone moves and holds the stage with an ordinary campaign on the job; the hold names the run's step; a step with no stage doesn't move it; the ordinary campaign finishes on its own; reopen never moves the stage back; a forward move held until met; a job without a run behaves as today |
| `jobflow_hidden.mjs` (5249) | the run and its steps are not in state; campaign routes can't open, change, add to, template, parent or delete it; not on the old board; no `campaign.started` / `campaign.done` for runs while an ordinary campaign on the same job still fires them; deleting the job removes its run |
| `jobflow_checks.mjs` (5250) | checkpoint 3 review: a step action's answer is the kept state (last Done answers `done`, reopen `active`); Done/reopen/Done is two `step.done` cycles and two `job.flow.done`; a member can't reopen or skip on a finished run; a cancelled run's steps 404; members read only flows they may start (admins-only and private-list flows 404); a flow for another list can't attach and the run stays; payment waits for a draft too; an ordinary campaign's stage done under a run moves the job when the run is cancelled; a failed start leaves no job, task, event or used job number; a skipped task finishes a Tasks step; a run's task has no campaign in `task.done` or the public API; a failed PATCH changes nothing |
| `jobs_ui.mjs` (Chrome) | written with the client, after the server is reviewed: Jobs tab, list, builder, New job, stepper + Next opening the right sheet, the six job tabs intact |

Existing suites that must stay green: jobs, jobboard, jobsteps, jobflows, joblinks, jobneeds, jobcampaign,
invoices, finance_jobs, inventory_links, inventory_steps, forecast, history, contacts, audit_rules, flows_*.

## 8. Out of Phase 1
Business items catalog, quotes, billing modes, automatic invoices, customer messages per step, campaign steps,
stacks per job, map pins for clients, migration of legacy jobs, recurring work, Clients/Schedule/Overview sub-tabs.

## 9. Implementation notes (checkpoint 3)

Where the server differs from, or settles, something above:
- Runs are stored with `inOrder: false`. The legacy in-order machinery would lock a later step's tasks; the run's own
  order (the first unmet, unskipped step is current; Done is refused on any other) is enforced in `server/jobflows.js`.
- Steps routes act on the going run or, if none, the last finished one, so an owner can reopen a step on a finished
  run (the sweep then puts the run back to going, as `doneBySteps` campaigns already do). Cancelled runs are never
  acted on, never swept, and never count toward the stage or the forecast.
- Hiding is done at the shared doors, not per surface: `canSee(kind 'campaign'|'goal')` is false for a run, so every
  campaign route, the state, templates and exports refuse or omit it; `broadcast` drops `campaign` / `goal` /
  `nextup` messages about a run (it travels as `{type:'jobrun', recordId, runId}`); `seesCampaign(run)` follows the
  job's visibility so the run's tasks reach whoever sees the job, and in "members see only theirs" a run's tasks
  count as the job's tasks (theirs only). Agents' and whiteboards' campaign checks exclude runs; the old job board, the
  getting-started card and the workload's campaign counts skip runs.
- A run as a campaign parent gets exactly the answer a missing campaign gets today (400 "That campaign is gone.").
- A start-job with a discount over the rules' limit is held exactly as `POST /projects/:id/records` holds it (for an
  app user that's 202 with an approval request, for an API key 403); the test compares the two routes rather than
  hard-coding a status.
- `step.done` for a run carries `run`, `flowId`, `cycle`, `again`; the job/project for automations is found from the
  run's `recordId`, as for any job campaign. New automation trigger `job.flow.done` (project filter).
- Invoices tell the sweep after every change (`onInvoice` in `news` and `settle`), and an invoice made with
  `{ jobStep }` from the Invoice step is bound to it (`bindInvoice`).

### 9.1 Checkpoint 3 review fixes
- The sweep runs before the answer: every step action, start, attach and cancel calls `jobSteps` as the person
  (`sweepNow`) before building the response, so the answer shows the kept status and the events have gone off. (The
  `HANDOFF_ROUTES` sweep after the response still runs and finds nothing to do.)
- Members read a flow only if they may start a job on it: published, not archived, `whoCreates: 'everyone'`, and its
  job list in a project they can see. Otherwise list and `GET /job-flows/:id` leave it out / 404, as for a flow that
  doesn't exist.
- Attach and replace check the flow's list against the job (`projectId` and `typeId`): a mismatch is 400 before
  anything is built or cancelled.
- Payment without a bound invoice: every non-void invoice made since the run started must be paid, drafts included
  (§1.5 as written); a draft voided stops counting.
- Only a campaign that owns the stage updates `g.staged`. A campaign held back while a run owns the stage keeps its
  done goals unstaged, so they move the job once the run is cancelled (or finishes).
- Starting a job is atomic: `buildRun` writes nothing, and runs inside `newRecord` (`opts.before`) after the record is
  built and before anything is kept; the job number is taken, the project told and the record kept only after it. A
  throw keeps no record, run, goal or task, uses no number and tells nobody. `commitRun` only assigns. Test-only hook:
  outside production, a step named `JOBFLOWS_FAIL_STEP` makes `buildRun` throw.
- A run's tasks are never shown under the run as a campaign: `taskCampaign(t)` (null for runs) feeds the task
  automations (`task.created/opened/done/reopened`) and the AI task brief; agents' task lines and the public API's
  `campaign` are null for them. Their job (`recordId` / `job_id`) is unchanged.
- `job.flow.done` goes off each time a run finishes; a run reopened and finished again fires it again (each finish
  is a transition `active → done`), while `step.done` carries `cycle` / `again`.
- A PATCH to a flow checks the name and the steps before changing anything.

- Unticking a checklist item of a finished step (on a finished run, or a finished step of a going one) would reopen
  it, so it is a reopen: owners and admins only (403 for anyone else). Ticking, and unticking before the step is
  finished, follow the step's `who` as before. (Round 2 review.)

## 10. Client (checkpoint 4)

- Workspace → **Jobs**, a tab of its own between Contacts and Boards (`WORK_TABS`), shown when Boards is on for the
  team and the member may use it. It's a tool page (`TOOLS.jobs`, `jobsTool()` in client/app.js, all names `jb…`).
- **Jobs** (everyone): `GET /api/jobs`; find by job or client, filter by flow or "not on a flow"; each row shows the
  client, stage, date, the flow and how far along, and a button for the step it's at, which opens the job and runs
  that step's Next. **+ New job** only when there's a flow you may start.
- **Job Flows** (owners and admins only; members never see the sub-tab): the flows with version, "changes not
  published", list and archived; ⋯ Edit, Start a job on it, Make a copy, Archive / Bring back. **+ New flow**: name,
  job list, and a start (Blank, Service call, Measure then install, Cleaning visit). The starts are built in the
  client and sent as an ordinary draft. A step names a stage only if the list has one by that name, and a details
  step only fields the list has. This stands in for §6's server-side "Add ready-made flows" for Phase 1; nothing is
  made automatically.
- **Builder**: name, icon, list, who starts jobs. Steps: add (menu of the 9 kinds), rename, ↑ ↓, remove, who
  (anyone, admins, a role, a person), the stage it moves the job to (the list's stages), may-skip, and per-kind
  settings (details fields, visit kind, photos, tasks, your own step's text and checklist). Save draft = PATCH;
  Publish = PATCH then publish. The server's checks are the only checks; its error shows in the builder.
- **New job**: flow (shows its steps), the job's name (the list's primary field), a client from Contacts (if the
  Contacts tool is on); `POST /api/jobs` with a request key made when the sheet opens, so a double tap makes one job.
  The job opens.
- **On a job** (any job on a job list): its flow's card sits **above the job window's tabs**, not inside Overview, so
  where the job is stays in sight whichever tab Next opens. It shows the steps in a row (done ✓, skipped –, next up,
  later) and the step picked, or next up: what makes it done, what's missing, who it's for, your own step's checklist
  and text, a Tasks step's tasks you can see. Buttons: Next (only when you may act), Skip (admins, or the step's
  person when it may be skipped, with a reason), Reopen (admins, on a done or skipped step). ⋯ for admins: Move to
  another flow (replace), Take it off this flow (with a reason). A job not on a flow shows "Put on a flow" to admins
  when a published flow fits its list. The six tabs are unchanged.
- **Next** opens what does the step and never ticks it off itself: client → the Client tab; details → the Overview's
  fields; book → the visit sheet; work, sign-off, tasks → the Work tab; invoice → the job's draft invoice, or a new one
  made with `{ jobStep }`; payment → record a payment on the open invoice (a draft: "Send the invoice first"); your own
  step → Done. Invoice and payment are owners and admins only, as their routes are.
- **Live**: `{type:'jobrun'}` refetches that job's run if it's open or cached, and refreshes the Jobs list. The client
  keeps no copy of the run's logic; every state comes from the server's run view.
- Tests: `tests/jobs_ui.mjs` (Chrome, ports 5007 / 9567; `SHOTS=<folder>` saves screenshots). `tests/tabbar.mjs`
  expects Jobs in the strip.
- Checkpoint 4 review: **Next shows only on the step the job is at** (`state === 'current'`), only when `mayAct`, and
  on invoice and payment steps only for owners and admins, whatever the step's `who` (`jbMayNext`). The Jobs list's
  step button follows the same rule for invoice and payment. Picking the step the job is at goes back to following
  the job (the card moves on as steps finish); picking another step holds it there.
- `tests/jobs_ui.mjs` also runs as a member: Jobs but no Job Flows sub-tab or builder; New job offers only flows
  everyone may start; Next and Skip on the member's own step; no Next on a later step, an admins' step or an invoice
  step (nor its button in the list); no Reopen and no flow menu; the card moves on live when a step is done elsewhere.
  The six job tabs are checked exactly and in order, under the flow card.
- Checkpoint 4, round 2: the Jobs list's `run.current` carries `mayAct` (the step's `who` for the person asking, as
  in the run view). A row's step button shows only when `jbMayNext` allows it (current, `mayAct`, invoice and payment
  for owners and admins); anyone else sees "Next: <step>" as text. Opening the Jobs tab shows the list at once and
  refreshes it behind; a refresh asked for while one is loading runs again after it. `tests/jobflow_checks.mjs` checks
  `mayAct` in the list as a member and an owner; `tests/jobs_ui.mjs` has a payment step and checks the list as a member
  for an owners-and-admins step, an invoice step and a payment step.
