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
who  = { type: 'anyone' | 'admins' | 'role' | 'member', id? }      // 'anyone' = anyone who can see the job
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
- `goalMet(g)` for `kind:'step'`: `skipped || (stepCondition(g) && tasks done && needsMet(g))`.
- `jobStepsOnce` needs no new branch: it already sweeps every goal, fires `step.done` once on the change, moves the
  stage for goals with `g.stage`, and finishes the campaign when all goals are.
- A job has at most one run with `kind:'job'` and `status:'active'`. An ordinary campaign on the same job is
  allowed and is never mistaken for the run.

## 2. Transitions

| Action | Route | Who | Rules |
| --- | --- | --- | --- |
| Start a job | `POST /api/jobs {flowId, values, contactId?, key}` | `whoCreates`, plus the existing record-create authorization (amendment C) | Uses the flow's active version. Authorization is the same path as `POST /projects/:id/records`: project in this team and `sees(p)`, `memberMay(ws, auth, 'projects')`, the rules hold (`holdDiscount`), then `newRecord`'s own validation. All checks and the run's goals are built and validated first; only then are the record, run and goals written, in one synchronous block, and side effects (`record.created` news, broadcasts, `campaign`-free events) go out after the whole job exists. A throw before the write leaves nothing. `key`: scoped to team + person, kept 10 minutes in memory; same key + same body → the same job back; same key + different body → 409. |
| Attach a flow | `POST /api/jobs/:id/flow {flowId, replace?}` | admins | 409 if an active run exists and `replace` isn't true. Replace sets the old run `cancelled` (kept, shown in Activity). Never touches ordinary campaigns. |
| Done (button) | `POST /api/jobs/:id/steps/:stepId/done` | the step's `who`, or admins | Only `custom`, and `details` with no fields. Idempotent: already marked → 200, nothing changes. Not the current step → 409 (in order). |
| Skip | `POST /api/jobs/:id/steps/:stepId/skip {reason}` | the step's `who` if `canSkip`; admins always | Reason required (≤300). Timeline entry. Idempotent. |
| Undo skip / reopen | `POST /api/jobs/:id/steps/:stepId/reopen` | admins | Clears `marked` or `skipped`. Live conditions re-evaluate as they are. |
| Cancel run | `POST /api/jobs/:id/flow/cancel {reason}` | admins | Status `cancelled`; the job stays. |

- "Next" in the UI is not one route. The server returns `next: { stepId, action }` with `action` one of
  `done` | `pick-client` | `edit-fields` | `book-visit` | `checklist` | `sign` | `invoice` | `payment` | `tasks`; the button
  opens that screen, and the step finishes only when its condition becomes true on the server.
- Every write ends with `stepsSoon(wsId)` (the existing sweep). The sweep is the only place a step becomes finished,
  so a webhook, a retry and a click can't finish it three times: `g.finished` changes once, `step.done` fires once.
- Stage moves still go through `stageGate` on every path. A run's steps count in `openStepsUpTo` like any campaign's,
  so a person can't drag the stage past an unfinished step; the admin override with a reason stays.
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
run: null | { flowId, flowName, versionN, done, total, current: {stepId, name, kind, action}, blocked: [...] },
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

| Test | Asserts |
| --- | --- |
| `jobflows_defs.mjs` | draft edits never change a version; publish makes n+1; copy is an independent draft; archive blocks new jobs, runs go on; validation (no steps, bad list, 31 steps) refused; members can't write |
| `jobs_list.mjs` | campaign-less jobs listed; trade and generic job lists; private projects hidden; member access switch; no leak via counts or client data |
| `jobflow_run.mjs` | start job (record + run + goals), key dedupes; current step; conditions from real records (contact, fields, visit, checklist, signature, invoice sent/paid, tasks); in-order Done 409; skip needs reason + canSkip; reopen admins; stage moves only for steps with a stage; stageGate holds a manual jump past an open step |
| `jobflow_events.mjs` | the same step finished by a payment twice, a retry and a click: one `step.done`, one stage move; void the invoice → step reopens, run back to active, stage does NOT move back; pay again → `step.done` with `cycle: 2, again: true`; a run never fires `campaign.started` / `campaign.done`; `job.flow.done` once |
| `jobflow_access.mjs` | start-job refused where `POST /projects/:id/records` would be (private project, members switch off, a rules hold); key reuse with another body 409; run response hides invoice totals and unseen tasks from a member; `who` with another team's member refused at publish; a step whose member left → admins only |
| `jobflow_versions.mjs` | publishing v2 leaves a running v1 job's steps as they were |
| `jobflow_hidden.mjs` | a run is in no campaign surface (state, broadcast, templates, board, analytics, agents, export, public API campaigns); an ordinary campaign on the same job still is |
| `jobflow_legacy.mjs` | a job driven by an ordinary campaign progresses exactly as before; `legacy:true` in the list |
| `jobflow_finance.mjs` | invoice/payment steps follow the real invoice (void after paid reopens the step) |
| `jobs_ui.mjs` (Chrome) | Jobs tab, list, builder (add, reorder, rename, publish), New job, stepper + Next opening the right sheet, existing six job tabs intact |

## 8. Out of Phase 1
Business items catalog, quotes, billing modes, automatic invoices, customer messages per step, campaign steps,
stacks per job, map pins for clients, migration of legacy jobs, recurring work, Clients/Schedule/Overview sub-tabs.
