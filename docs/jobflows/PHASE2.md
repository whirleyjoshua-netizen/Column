# Job Flows — Phase 2 (Money) contracts, checkpoint 1

Status: draft for review, 2026-11-25. No code yet. The product spec's build order puts Money second: "Jobs → Items
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
- Archived items aren't offered for new lines; lines already using one keep their copy.
- Never stored in a version: a flow's default items name item ids, and the price is read when the job's lines are
  filled (§2.2).

### 1.2 Flow Body, new fields (versioned like the rest; a version from Phase 1 reads as the defaults)
```
billing: 'hand' | 'quote' | 'auto'          // default 'hand'
items:   [{ itemId, qty (0 < qty ≤ 1e6) }]   // ≤ 50, default []
dueDays: integer 0–120 | null                // invoice due date, days after it's made; null = today's 14
```
Publish validation (400 with a plain message; a draft may be saved in any state):
- `quote` billing needs exactly one `quote` step, before the first `invoice` step.
- `auto` billing needs an `invoice` step; it has no `quote` step.
- `hand` billing has no `quote` step.
- Every `items[].itemId` is a live (not archived) item of the team.
- `invoice` and `payment` steps keep `who = admins` whatever billing is (§4).

### 1.3 New step kind: `quote`

| kind | What the worker sees | doneWhen (server-evaluated) | how |
| --- | --- | --- | --- |
| `quote` | Send the quote (the job's lines, then the existing share link) | the job has `rec.answer.act === 'accept'` with `rec.answer.at` ≥ the run's start | tap (admins) |

- Declined: the step stays open, and shows "Declined by <name>: <reason>".
- **New quote** (`POST /api/jobs/:recId/requote`, admins, only while the run's quote step is open): writes the old
  answer to the job's timeline, sets `rec.answer = null`, turns the old link off (`rec.share = null`), and a new
  share makes a new token. The old link answers "Quote not available".
- The accepted lines are the job's lines: the customer can only accept when `linesKey(lines) === v` (as today), so
  at the moment of acceptance the two are identical. Lines changed after acceptance are the admin's change (spec:
  "an admin can still change a job's lines before its invoice is made") and the invoice uses the job's lines then.
- `invoice` and `payment` keep their Phase 1 meaning.

### 1.4 `auto` billing: the Invoice step runs by itself
With `billing: 'auto'`, the flow's (first) `invoice` step has `how: 'auto'`. When the sweep finds it the run's
current step (every step before it done or skipped) with no bound invoice, or only a voided one:
1. Make the invoice from the job's lines (`newInvoice`, due `dueDays`), bound to the step (`g.invoiceId`), as the
   run's owner (`by` = their name), and emit `invoice.created`.
2. Send it: the same code path as `POST /api/invoices/:id/send`, including the rules `hold`. Held → the invoice
   stays a draft, and the step shows "Waiting for approval" until the approval sends it.
3. If it can't send (total $0, or held), it stays a draft bound to the step, and the step shows why and offers the
   hand button to owners and admins. The sweep never makes a second one for the same cycle: `g.autoCycle` records the
   cycle it was made in.

"Send" here means what it means today: the link is made, the job moves to Invoiced, `invoice.sent` goes off. An
email or text to the customer is Phase 3 (customer messages).

## 2. Transitions

### 2.1 Items routes (`/api/job-items`)
- `GET` admins: every item, archived included, with `cost`. Members: 403 (Items is owners and admins, per the spec).
- `POST` admins: one item. `PATCH /:id` admins: any field; a price change fires the existing `price.changed`
  automation trigger (with how many waiting quotes use it). `POST /:id/archive`, `POST /:id/restore`. No hard delete.
- `POST /api/job-items/import { projectId }` admins: copies that board's price list (a board they can see) into
  Items; a record already copied (`fromRecordId`) is skipped, so running it twice adds nothing. Answers
  `{ added, skipped }`.
- `priceListFor()` lists live Items first (`id: 'item:<id>'`, `source: 'items'`, `board: 'Items'`; members never get
  cost), and `priceNow('item:<id>')` reads the item's price, so Finance → Quotes flags a waiting quote whose item
  price changed, as it does for board items now.

### 2.2 Default lines
- Starting a job on a flow with `items` (and on attach): if the job's items field is empty, it's filled with one row
  per default item: `{ desc: name, qty, unit, price, taxable, cost, from: 'item:<id>' }` (`cost` is kept on the row as
  today; members never see it, as today). A job whose lines aren't empty is left alone.
- A job list with no `items` field: the defaults are dropped silently (the invoice falls back to the job's value as
  today); the builder warns at publish ("This list has no line items, so the default items won't be used").
- Done inside `buildRun` (writes nothing until commit), so a failed start still keeps nothing (§9.1, point 6).

### 2.3 Quote step routes
- Sending: the existing `POST /api/projects/:p/records/:r/share` (admins only when the job is on a run with an open
  quote step; it's open to editors today for other lists, and stays so for them).
- Done is never marked by hand: no Done button on a quote step; Skip with a reason (admins) as for any step.

## 3. Reads
- The run's step for `quote` carries `quote: { status: 'draft'|'sent'|'viewed'|'accepted'|'declined', total,
  answeredBy, reason, url }` for admins; members see only `status` (no money, no link).
- The `invoice` step carries `auto: true` and, when it waits, `waiting: 'approval' | 'zero' | null`.
- `GET /api/jobs` rows gain `total` (cents, the job's lines) for admins only.

## 4. Permissions
- Items: owners and admins on every route, the public API included (no public Items API in Phase 2).
- Quote, invoice and payment steps: their buttons are for owners and admins only (Phase 1 already does this for
  invoice and payment); a member never sees a price, a total, a quote link or cost in any Jobs read.
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
| `jobitems.mjs` (5251) | CRUD, members 403 on every route, limits and validation, archive/restore, import twice adds once (and only from a board the admin sees), `price.changed` on a price edit, `priceListFor` order and no cost for members, saved across a restart, other teams nothing |
| `jobflow_money.mjs` (5252) | billing validation at publish (all six rules); default lines fill an empty job and leave a filled one; dropped on a list with no items field; a failed start keeps no lines; the quote step: done only by an acceptance after the run started (an old acceptance doesn't count), decline keeps it open, requote clears the answer and kills the old link, members get no quote money; auto billing: the invoice is made and sent once when its step comes up, bound to the step, `invoice.sent` once; voiding it makes one more (and only one) on the next sweep; a `hold` rule keeps it a draft and approval sends it; a $0 job makes a draft and waits; a run whose owner was made a member waits; reopening the work step doesn't make a second invoice in the same cycle; a Phase 1 version (no billing) behaves exactly as before |
| `jobs_ui.mjs` (Chrome) | with the client: Items tab, builder billing choice, quote step Send and status, auto invoice step |

Existing suites that must stay green: everything in CONTRACTS §7, plus price_list, price_changed, audit_quote,
costing_truth, finance_view, finance_jobs, invoices, quickbooks.

## 7. Out of Phase 2
- Deposits (the owner's open question: proposed for later, with Stripe).
- A worker adding an item on the job (needs member-visible prices; later, with the flow allowing it).
- Emails and texts to the customer, payment reminders, quote follow-ups (Phase 3).
- Moving board price lists for good, and Move my jobs here (Phase 5).
- Stock coming off Inventory when paid (Phase 4, Links: "Inventory use").
