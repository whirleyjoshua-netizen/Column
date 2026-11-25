# Members don't see prices or costs (owner decision, 2026-11-25)

PHASE2.md §4 and §8 point 6 raised it: a member who can see a job board gets that job's price lines, cost
included, through the board's record routes and broadcasts. The owner answered: members don't see them.

## 1. The rule
- **Who sees prices:** owners and admins, by their role now (`seesPrices(ws, memberId)`). Members never do,
  whatever board, list or tool they reach a record through. A member made admin sees them from then on; an
  admin made a member stops at once (the next read and the next broadcast).
- **What a price is (a "priced field"):**
  1. every `items` field (price lines);
  2. the `money` fields of a Price list (a list with key `price_list`: Price and Our cost);
  3. any formula or rollup that reads a priced field, directly or through another formula or rollup
     (`FX.refs` for formulas; a rollup's `of` field in its target list), up to the 8 levels calc already allows.
  Other money fields (a deal's Value, a budget, an amount) are not prices and stay as they are.
- **What a member gets instead:**
  - an `items` field: `{ rows: [{ id, desc, qty, unit }], hidden: true }`: what to do and how many, no price, cost,
    line total, tax rate, discount, subtotal, total or margin;
  - any other priced field: `null` with the record's `hiddenFields: [fieldId…]`, so the app shows "—" rather
    than "empty";
  - no `share` (the quote link and its token) and no quote total; the quote's number and status stay.

## 2. One function, fail-closed
- `publicRecord(rec, view)`: `view` is `{ prices: true }` or nothing. **Nothing means redacted.** Every caller
  that serves an owner or admin passes `PJ.view(ws, memberId)`; a caller that forgets gives an admin less, never
  a member more.
- The same for words: `words(ws, p, f, v, view)` and `recordStory(rec, ws, sees, view)`: a member's price lines
  read "3 lines" (no amounts); another priced field reads "hidden". Used by AI context (ask, next step, the
  Sidekick), agents' record tools, search snippets, chat pins and the timeline.
- Raw values (`rec.values`) never leave the server for a member except through these: the export uses
  `redactValues(p, t, values, view)`.

## 3. Every path
| Path | Members get |
|---|---|
| `GET /api/projects/:id/records`, `GET/PATCH/POST /api/records/…` answers, `records/for-contact` | redacted records |
| WebSocket `record` messages | the server sends admins a priced copy and members the redacted one, built per message (`broadcast` re-renders `msg.record` for sockets whose member sees prices) |
| `record:log` and `GET /records/:id/log`, the API timeline | a priced field's change entry: `{ field, from: '', to: 'changed' }` (entries are stored with `fieldId` from now on; older ones are matched by the field's name in that list) |
| quote answered (`quote:answer` broadcast) | no `total` (admins get it) |
| sign-off forms (signoff.js), tech AI (techai.js), Job Flows' job read (jobflows.js) | redacted records; a member's sign-off text leaves the total blank |
| AI: ask, next step | the story without amounts |
| AI estimate (draft price lines) | 403 "Prices are for owners and admins." |
| `GET /api/price-list` | `[]` (no board price lists; Items were already admins' only) |
| Finance quotes list, analytics over quote totals | already owners' and admins' (tests assert it) |
| export (a member's own export of what they can see) | redacted values (§2) |
| agents' record tools (find, read, story) | redacted |
| public API (`/api/v1`) | keys are made by owners and admins; a key runs with its maker's role now, so a maker made a member gets redacted records |
| share links (`/q/:token`), the customer's quote page and acceptance | unchanged: a link is for the customer, and only owners and admins make one now (below) |

## 4. Writes
- A member can't set or change a priced field on any path: record create, update, bulk update, CSV import into
  a board, agents acting as the member, automations they build (an automation can't set price lines today, and
  can't set a Price list's money fields for a member-built one). 403 "Prices are for owners and admins." Other
  fields in the same write are not saved either (all or nothing).
- What the server copies itself stays allowed: carry-over between stages, a quote turned into a job, a Job
  Flow's default lines, Inventory stock use. These don't show the member anything.
- Share and unshare a record with price lines (the quote link): owners and admins only (403 for members). This
  widens PHASE2's rule (it was only for jobs on a flow with a Quote step).

## 5. The app
- A member sees a job's price lines as a list of what and how many, with "Prices are for owners and admins"
  under it, read-only; Price list money columns, priced formulas and rollups show "—"; Send quote and the quote
  link aren't shown; the board's total footers skip hidden fields.

## 6. Tests: `tests/member_prices.mjs` (port 5261)
One owner, one admin, two members (one later made admin, one admin later made a member), a job board with price
lines (with cost), a Price list, a formula over the line total, a rollup of it from another list, a deal Value.
For each row in §3 the member gets the redacted shape and the admin the priced one; the deal Value is still
there for the member; each write in §4 is 403 with nothing saved; server copies still copy; role changes take
effect on the next read and the next broadcast; the WebSocket check reads the member's and the admin's sockets
for the same update. The test fails on today's code.

## 7. Not changing
- Inventory's own pages (stock prices) are the Inventory tool's, not boards'.
- What a customer sees on a quote or invoice.
- Money fields that aren't prices (§1).

## 8. Review round 1 (ChatGPT, chat #7)
1. **Old timeline entries, fail-closed.** An entry is shown in full to a member only when it is positively not a
   price: it has a `fieldId` of a field that isn't priced, or (older entries, no `fieldId`) its field name matches
   exactly one field in the record's list and that field isn't priced. A name that matches nothing (the field was
   renamed or deleted), more than one field, or a priced one → `{ from: '', to: 'changed' }`. The rule lives in
   `logFor(rec, memberId)`, which is what both `GET …/log`, the API timeline and the `record:log` broadcast use.
2. **Automations act as their maker, checked when they run.** An automation's Set step that writes a priced
   field (today only a Price list's money fields; price lines can't be set by automations at all) can be saved
   only by an owner or admin, and each run checks its maker's role then (`x.memberId`, as the run already
   records): a maker who is no longer an owner or admin, or gone, gets that run's Set refused with a note on the
   automation ("Prices are for owners and admins"), nothing written. Who triggered it doesn't matter: an admin's
   automation does what the admin set up, whoever's change started it (a value it copies from a field a member
   can fill is the admin's choice; noted in the builder's help, not blocked). Scheduled runs are the same.
3. **The customer's link is an accepted exception.** A quote link is a bearer link for the customer and shows
   the customer's prices to whoever holds it. Members no longer receive it (no `share` in records, no Send quote,
   share and unshare 403), and links made before this change keep working for the customer. A member who was
   handed a link outside Kloomie can open it: that is not something the server can tell apart from the
   customer. The promise is "Kloomie never gives a member prices or the link", not "a member can never see a
   quote".
4. **Redaction only at the output.** Stored values and calculation are untouched: `calcValues` works on the full
   record (formulas and rollups across lists use real prices, as now), and only `publicRecord`, `words`,
   `recordStory`, `logFor` and the export's `redactValues` remove priced values from what they return. They
   copy; they never write `rec.values` or anything cached.
5. **API keys:** already as asked (projects.js `keyAuth`): each request looks up the maker in the team now and
   uses their role now; a maker no longer on the team makes the key stop working (401). Keys aren't transferable.
   Tests: a key whose maker is made a member gets redacted records and 403 on priced writes on the next request.
