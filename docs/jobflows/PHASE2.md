# Job Flows — Phase 2 (Money) contracts, checkpoint 1

Status: round 3 for review, 2026-11-25 (review answers in §8). No code yet. The product spec's build order puts Money second: "Jobs → Items
for the business, Quotes and Invoices sub-tabs, and the billing choice per flow (quote first, automatic, by hand)".
Phase 1 (CONTRACTS.md) stays as agreed; this adds to it on branch `jobflows-money` (cut from `jobflows`, so Phase 1
can ship on its own).

## 0. What already exists, and is reused

| Piece | Today | Phase 2 |
| --- | --- | --- |
| Price lines on a job | an `items` field on the job list (`{ rows: [{ id, desc, qty, unit, price, cost?, taxable?, from? }], taxRate, discount? }`) | unchanged: still the job's price |
| Team price list | `priceListFor()`: every `price_list` record on boards the person sees, then Inventory items | the business Items come first; boards and Inventory stay |
| Quotes | a record with price lines + `rec.share` (link `/q/<token>`); the customer accepts exactly the lines they saw (`linesKey`), and `rec.answer = { act, name, at, lines, total }` | a job is quoted the same way: the job record itself is the quote |
| Invoices | `db.invoices`, made from the job's lines (`newInvoice`), `send` = link + job to Invoiced, rules `hold` for sending | the Invoice step can make and send one by itself |
| Finance → Quotes, Finance → Invoices | admins' lists across the team | the same lists also open in Jobs → Quotes and Jobs → Invoices |

Nothing moves out of a Board, and no price list is deleted.

## 1. Data

### 1.1 `db.jobItems[id]` (new): the business's Items
```
{ id, wsId, name (1–120), description (≤500), unit (≤20), price (cents, integer, 0–1e10), cost (cents|null),
  taxable: bool (default true), invItemId: string|null (an Inventory item of the same team), archived: bool,
  fromRecordId: string|null (the board price-list record it was copied from), createdBy, createdAt, updatedAt }
```
- Limit 2,000 a team (archived count). Names need not be unique.
- Archived items aren't offered for new lines; lines already using one keep their copy (a line is a copy, never a
  live link).
- Never stored in a version: a flow's default items name item ids, and the price is read when the job's lines are
  filled (§2.2).

### 1.2 Flow Body, new fields (versioned like the rest; a version from Phase 1 reads as the defaults)
```
billing: 'hand' | 'quote' | 'auto'          // default 'hand'
items:   [{ itemId, qty (0 < qty ≤ 1e6) }]   // ≤ 50, an itemId at most once, default []
dueDays: integer 0–120 | null                // null = 14, today's default
```
Publish validation (400 with a plain message; a draft may be saved in any state):
- `quote` billing: exactly one `quote` step and at least one `invoice` step, the quote step before the first invoice
  step. Invoice steps stay by hand (an owner or admin makes and sends it after acceptance).
- `auto` billing: exactly one `invoice` step, no `quote` step. That one step runs by itself (§1.4).
- `hand` billing: no `quote` step (any number of invoice steps, as in Phase 1).
- `quote`, `invoice` and `payment` steps are for owners and admins: a step that names nobody is saved as
  `who = { type: 'admins' }` (so Phase 1 drafts, tests and ready-made flows, which leave `who` out, keep working);
  a step that names anyone else (anyone, a role, a member) is 400. The builder shows "Owners and admins" and
  doesn't offer a choice. The server checks it again on every action (§4), so an old draft
  can't get round it.
- Every `items[].itemId` is a live (not archived) item of the team; an itemId appears once.
- `dueDays` sets the due date of every invoice made from the run (by hand from the step, or automatically):
  `issued + dueDays` days, with today's convention (`teamDay` of the team's time zone, then `addDays`). null = 14.

### 1.3 New step kind: `quote`

| kind | What the worker sees | doneWhen (server-evaluated) | how |
| --- | --- | --- | --- |
| `quote` | Send the quote (the job's lines, then the existing share link) | see below | tap (admins) |

**The accepted quote is the price.** The quote step is met when all of these hold:
- `rec.answer.act === 'accept'` and `rec.answer.at` ≥ the run's start (an acceptance from before the run never
  counts), and
- the job's lines still match what was accepted: `priceKey(job lines) === priceKey(rec.answer.lines)`, **or** the run
  has a non-void invoice, made after that acceptance, whose lines match it: `priceKey(invoice.lines) ===
  priceKey(rec.answer.lines)` (an invoice billed from the accepted lines keeps the step met when the job's lines are
  edited later; an invoice with other lines never does).

`priceKey(lines)` is a hash of what the customer sees and pays: each row's `desc, qty, unit, price, taxable` in order,
plus `taxRate` and `discount`. Row ids, `cost` and `from` are left out (an invoice gets new row ids and drops cost
and from, so `linesKey` can't compare a job with its invoice).

The lifecycle, in order: acceptance **locks** the job's lines (audit G3, on every path: an edit answers 400 and the
step stays met). Changing the price means an explicit **New quote**, which clears the answer and reopens the quote
step; the customer must accept the new lines; once the run has a non-void invoice, New quote is refused (409).
`priceKey` stays the comparison rule (it's what decides whether an invoice matches the acceptance), and the
run view's `changed` status covers lines that differ from the acceptance by any route that bypasses the lock.
The audited way past a quote is Skip with a reason (admins), which Phase 1 already records (who, when, why).

- Declined: the step stays open and shows "Declined by <name>: <reason>".
- **New quote** (`POST /api/jobs/:recId/requote`, admins): allowed while the run has no non-void invoice, accepted
  or not. An invoice made by hand with lines other than the accepted ones doesn't meet the quote step; the way
  forward is to void it and requote, or an admin's Skip with a reason. It writes the old answer to the job's timeline, sets `rec.answer = null`, turns the old link off
  (`rec.share = null`, so the old token answers "Quote not available"), and the status back to draft. The next
  share makes a new token. After an invoice exists: 409 "Void the invoice first".
- No Done button on a quote step: the generic Done route answers 400 for it. Only a qualifying acceptance or an
  admin's Skip finishes it.
- `invoice` and `payment` keep their Phase 1 meaning (the invoice is made from the job's lines, which, with quote
  billing, are the accepted lines unless the step was skipped).

### 1.4 `auto` billing: the Invoice step runs by itself
With `billing: 'auto'`, the flow's one `invoice` step has `how: 'auto'`. Its state lives on the goal as
`g.auto = { state, invoiceId, at }`, `state` one of `made`, `sent`, `held`, `zero`, `owner`.

When the sweep finds it the run's current step (every step before it done or skipped):
1. **Owner check.** If the run's owner is no longer an owner or admin of the team (demoted or gone), nothing is
   made: `state = 'owner'`, and the step offers owners and admins the ordinary hand button (Phase 1's invoice
   sheet). Nothing is ever made or sent as a member.
2. **Make, once.** If the step has no bound non-void invoice: make it from the job's lines (`newInvoice`, due per
   `dueDays`), bind it (`g.invoiceId`), set `g.auto = { state: 'made', invoiceId }`, emit `invoice.created`, and
   `save()` **before** trying to send. A step with a bound non-void invoice never gets another, so repeated sweeps,
   reopened earlier steps and a restart between making and sending all find and reuse the same invoice. Voiding it
   (an admin's act) unbinds it, and the next sweep makes exactly one replacement.
3. **Send.** For a bound invoice in `made`: first check the owner again (every attempt, not only before making):
   no longer an owner or admin → `state = 'owner'`, the invoice stays bound as a draft, no replacement is made, and
   admins get the hand button. Total $0 → `state = 'zero'`, stays a draft. Otherwise call the same send function the
   route uses, as the run's owner, with the same rules `hold` (summary, target, and a replayable
   `POST /api/invoices/:id/send`). Held → `state = 'held'`, stays a draft. Approval replays that send as the owner
   (rules.js already replays as the person who asked); if the owner can't send any more, the approval fails with
   its reason, as any replay does. Sent → `state = 'sent'`, `invoice.sent` once, the step is met as in Phase 1.
4. **Waiting states never retry by themselves.** `held` waits for the approval; the sweep doesn't send again and
   no hand button bypasses it (the run card shows "Waiting for approval" and the approval's link, nothing else).
   `zero` waits for an admin: edit the invoice's lines (existing invoice PATCH) and press Send, which is the
   existing send route with the same `hold`. Sending by hand from `zero` or `owner` is the ordinary route; nothing
   skips the rules.
5. **Leaving a waiting state.** The state follows the bound invoice, not the path that sent it: whenever the bound
   invoice is sent (the sweep, the ordinary send route by hand, or an approval's replay), `onInvoice` sets
   `g.auto = { state: 'sent', invoiceId: <same> }`. `invoice.sent` goes off once, on the first send, as today (the
   route already emits it only when `sentAt` was empty). A send that fails (held again, $0, refused) leaves the
   invoice a draft and the state at its waiting value with the reason. Voiding the bound invoice clears `g.auto`, so
   the next sweep starts again at step 1.

"Send" means what it means today: the link is made, the job moves to Invoiced, `invoice.sent` goes off. An email or
text to the customer is Phase 3 (customer messages).

## 2. Transitions

### 2.1 Items routes (`/api/job-items`)
- `GET` admins: every item, archived included, with `cost`. Members: 403 (Items is owners and admins, per the spec).
- `POST` admins: one item. `PATCH /:id` admins: any field. `POST /:id/archive`, `POST /:id/restore`. No hard delete.
- `price.changed` fires only when `price` actually changes (not description, unit, cost, taxable, archive), with
  today's payload: `{ item, was, now, quotes, who, whoId }`. `quotes` counts waiting quotes: records with a live
  link (`rec.share`), no answer, quote status pending, and a line whose `from` is `item:<id>`. No customer or quote
  detail goes in the event; automations are owners' and admins' (as today).
- `POST /api/job-items/import { projectId }` admins: a one-time copy of that board's price list (a board they can
  see; 404 otherwise). A record already copied (`fromRecordId`) is skipped even if it changed since; it's a
  snapshot, never a sync. A row with no name is skipped and counted; a missing or unreadable price imports as $0;
  `taxable` defaults to true. Answers `{ added, skipped, noName }`.
- `priceListFor()` lists live Items first **for owners and admins only** (`id: 'item:<id>'`, `source: 'items'`,
  `board: 'Items'`, with cost). Members' `/api/price-list` is unchanged: no Items. `priceNow('item:<id>')` reads the
  item's price, so Finance → Quotes flags a waiting quote whose item price changed, as for board items now.

### 2.2 Default lines
- Starting a job on a flow with `items` (and on attach): if the job's items field is empty, it's filled with one row
  per default item: `{ desc: name, qty, unit, price, taxable, from: 'item:<id>' }`, the list's `taxRate` 0. **No
  `cost` on the row**: job records reach members who can see the board (today's behavior, §4), so defaults never add
  cost to them.
- Empty means: the value is missing, null, not an object, `rows` isn't an array, or no row has a description or a
  price. Anything else is not empty and is never overwritten.
- A default item that is archived or gone: start and attach answer 400 "<flow> uses <item>, which was archived.
  Update the flow and publish it again." Nothing is made. (Publish checks it too, but an item can be archived
  after publishing.)
- A job list with no `items` field: the defaults are dropped silently (the invoice falls back to the job's value as
  today); the builder warns at publish ("This list has no line items, so the default items won't be used").
- Done inside `buildRun` (writes nothing until commit), so a failed start or a failed attach leaves the job's lines
  as they were and no run (CONTRACTS §9.1, point 6).

### 2.3 Quote step routes
- Sending: the existing `POST /api/projects/:p/records/:r/share`. For a job on an active run whose flow has a quote
  step, share and unshare are owners' and admins' (403 for members); everywhere else it's as today.
- Done: 400 on a quote step. Skip: admins only, with a reason (members 403, whatever `canSkip` says).

## 3. Reads
- The run's step for `quote` carries, for admins, `quote: { status: 'draft'|'sent'|'viewed'|'accepted'|'declined'|
  'changed', total, answeredBy, reason, url, mayRequote }` ('changed' = accepted, but the lines changed since).
  Members get only `quote: { status }`.
- The `invoice` step carries `auto: true` and, for admins, `waiting: 'approval' | 'zero' | 'owner' | null` and the
  bound invoice's number. Members get `auto: true` only.
- `GET /api/jobs` rows gain `total` (cents) for admins only.

## 4. Permissions
- Items: owners and admins on every route, the public API included (no public Items API in Phase 2).
- Quote, invoice and payment steps: every action on them (send, requote, skip, invoice, payment) is owners' and
  admins' on the server, whatever the step's saved `who`.
- **The price boundary, exactly.** Items and their prices: owners and admins only, on every route. The Jobs reads
  (`GET /api/jobs`, the run and its steps, the quote step) never give a member a price, total, cost or quote link.
  What doesn't change in Phase 2: a job record read through the existing board and record routes (and their
  broadcasts) carries its price lines to anyone who can see that board, as it does now, and the board price list
  and Inventory in `/api/price-list` stay as they are. Hiding a job's lines from members on the board is a change
  to boards in general, so it's for the owner to decide, not part of this phase (§8, point 6).
- `requote` and the auto invoice are checked on the server; the auto invoice runs as the run's owner, and if the
  owner is no longer an admin it waits for an admin to press the hand button (it never sends as a member).

## 5. Client (checkpoint 4 of this phase)
- Jobs gets three sub-tabs for owners and admins: **Quotes** and **Invoices** (the Finance lists, opening the job),
  and **Items** (add, edit in place, archive, "Copy from a board's price list").
- Builder: a Billing choice (By hand / Quote first / Automatic) that adds or removes the Quote step and sets the
  Invoice step's label; a Default items picker; Due in N days.
- The job's run card: the quote step shows its status and Send / New quote; an automatic invoice step says "Runs by
  itself when the step before it is done", and why it's waiting.

## 6. Tests (written first, failing on `jobflows`)

| Test (port) | Covers |
| --- | --- |
| `jobitems.mjs` (5251) | CRUD, members 403 on every route, limits and validation, archive/restore, import is a snapshot (twice adds once; a changed source isn't re-copied; no-name rows counted; only from a board the admin sees), `price.changed` only on a price change (not description, unit, cost, taxable, archive) with the waiting-quote count, `/api/price-list` has Items first for admins and none for members, a member gets no item price from any Jobs read, saved across a restart, other teams nothing |
| `jobflow_money.mjs` (5252) | billing validation at publish (every rule in §1.2, including `who = admins` on quote, invoice and payment, duplicate item ids, more than one invoice step with auto); `dueDays` on a hand-made and an auto-made invoice, null = 14; default lines fill each kind of empty value and leave a filled one, carry no cost, are dropped on a list with no items field; an archived or missing default item makes start and attach 400 with nothing made; a failed start and a failed attach leave the job's lines and runs as they were; the quote step: an acceptance from before the run doesn't count, decline keeps it open, accepted lines are locked (an edit is 400 and the step stays met); requote after acceptance reopens it until the new lines are accepted; sharing, accepting and declining don't write the job's stage; `priceKey` checked directly; requote before and after acceptance, 409 once invoiced, the old link dead; Done 400 on a quote step; a member can't skip, share or requote it even with `canSkip`; members' run and list responses carry no price, total, cost or link; auto billing: made and sent once when its step comes up, bound, `invoice.sent` once; the state reads `sent` after a send by the sweep, by hand from `zero` or `owner`, and by an approval's replay from `held`, each with the same invoice id and one `invoice.sent`; an owner demoted after the invoice was made but before it sent gets `owner`, the invoice kept and no replacement; a restart between making and sending reuses the same invoice; reopening an earlier step makes no second one; voiding makes exactly one replacement; a `hold` keeps it a draft, no retry, approval sends it; $0 waits as a draft, editing it and sending by hand goes through the same hold; an owner made a member, or gone, gets nothing made and the hand button for admins; a Phase 1 version (no billing) behaves exactly as before |
| `jobs_ui.mjs` (Chrome) | with the client: Items tab, builder billing choice, quote step Send and status, auto invoice step |

Existing suites that must stay green: everything in CONTRACTS §7, plus price_list, price_changed, audit_quote,
costing_truth, finance_view, finance_jobs, invoices, quickbooks.

## 7. Out of Phase 2
- Deposits (the owner's open question: proposed for later, with Stripe).
- A worker adding an item on the job (needs member-visible prices; later, with the flow allowing it).
- Emails and texts to the customer, payment reminders, quote follow-ups (Phase 3).
- Moving board price lists for good, and Move my jobs here (Phase 5).
- Stock coming off Inventory when paid (Phase 4, Links: "Inventory use").

## 8. Round 1 review (ChatGPT), and what changed
1. **Accepted lines vs invoice lines.** The accepted quote is the price. (Superseded in detail by §9 point 2:
   acceptance locks the lines; a change is an explicit requote, which reopens the step until the new lines are
   accepted; requote is refused once an invoice exists; the override is an admin's Skip with a reason; §1.3.)
2. **Quote step permissions.** Publish requires `who = admins` on quote, invoice and payment steps, and the server
   checks every action on them regardless (§1.2, §2.3, §4). No Done on a quote step.
3. **Auto invoice lifecycle.** Made and bound and saved before sending; one bound non-void invoice per step is the
   idempotency rule (restart, reopen, repeated sweeps); void → exactly one replacement; `held` waits for approval
   with no retry and no bypass; `zero` waits for an admin's edit and the ordinary send (same hold); owner demoted or
   gone → nothing made, the hand button for admins (§1.4).
4. **Archived default items.** Start and attach answer 400 naming the item; nothing made (§2.2).
5. **Empty lines** defined; duplicate item ids refused; 50 defaults; failed attach tested (§1.2, §2.2).
6. **Member prices.** Items never reach members (Items routes, `/api/price-list`, Jobs reads); default lines carry no
   cost. One thing I found and am not changing silently: today a member who can see a job board already gets that
   job's price lines through the board's record routes and broadcasts, cost included when a row has one. That's
   existing behavior outside Jobs; I'm raising it with the owner as its own fix rather than folding a board-wide
   visibility change into this phase. The Phase 2 tests assert the Jobs reads and the new Items paths.
7. **Billing validation** tightened: quote needs an invoice step, invoice steps stay by hand under quote billing;
   auto has exactly one invoice step; `dueDays` covers hand and auto invoices, null = 14 by today's date rules.
8. **Import and price.changed** spelled out: one-time snapshot, changed sources not re-copied, no-name rows counted,
   price defaults to $0; `price.changed` only on a price change, same payload as today, waiting quotes defined.

### Round 2 review, and what changed
1. **Owner demoted after the invoice was made.** The owner is checked on every send attempt; if they can't send any
   more, the made invoice stays bound, no replacement, admins get the hand button (§1.4, step 3).
2. **Leaving waiting states.** Every successful send of the bound invoice, by any path, sets the state to `sent`
   with the same invoice id; `invoice.sent` once; failures keep the waiting state and reason; void clears it
   (§1.4, step 5).
3. **The invoice exception.** Only an invoice whose lines match the accepted lines (`priceKey`) keeps the quote step
   met; an invoice made from changed lines doesn't, and the way forward is void and requote, or Skip (§1.3).

## 9. Checkpoint 2 (failing tests) notes
- `tests/jobitems.mjs` (5251) and `tests/jobflow_money.mjs` (5252), with logs of the run on `jobflows`:
  `phase2-checkpoint2-items.log` (30 fail), `phase2-checkpoint2-money.log` (85 fail; the passes are setup and
  "nothing happens" checks that are only meaningful once the code exists).
- `priceKey` is exported from `server/jobflows.js` as a pure function and checked directly (each commercial field
  changes the key; row ids, cost, `from`, and `taxable: true` vs unset don't).
- Settled while writing them (amendments to the contract above):
  1. Money steps that name nobody default to admins; naming anyone else is 400 (§1.2).
  2. **Accepted lines are already locked** on every path (audit G3: "The customer accepted this quote, so its lines
     can't change"). So "lines changed after acceptance" can only come from a requote, which clears the answer;
     the `priceKey` comparison in §1.3 stays as the rule (and guards the invoice exception), and the test asserts
     the lock (400, step still met) rather than an edit.
  3. Sharing, accepting and declining a quote **don't write the job's stage** when the job is on an active run
     (today `setStatus` would put "Sent"/"Accepted" into a trade job's stage select; the run owns the stage).
  4. A test-only hook `JOBFLOWS_FAIL_SEND` (outside production, like `JOBFLOWS_FAIL_STEP`) makes the automatic
     send throw after the invoice is made, to test a restart between making and sending.
  5. The sweep that sends a `made` invoice after a restart is the ordinary one: any change to the job (the test
     PATCHes the record) or a run route runs it.
- Checkpoint 2 review: the Items restart check names the four items it made (Can clean, Trip fee, and two imported;
  "Old service" belongs to the money test) with ids and prices; the stage is checked after a decline too; a money
  step for a role, `dueDays: -1`, and a negative or over-1e6 qty are refused at publish. A fractional qty (1.5
  hours) is allowed: the contract's range is 0 < qty ≤ 1e6, and line quantities are already fractional today.

