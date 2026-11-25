# Job Flows — Phase 3 (Steps that run by themselves) contracts, checkpoint 1

Status: draft for review, 2026-11-25. No code yet. The spec's build order: "Steps that run by themselves. Customer
updates, automatic invoice, payment reminders, review requests and quote follow-ups, all per step; the team-wide
switches retire." Branch `jobflows-auto`, cut from `jobflows-money` (Phase 2, approved). The automatic invoice itself
shipped in Phase 2 (PHASE2.md §1.4); Phase 3 adds telling the customer.

## 0. What exists, and is reused

| Piece | Today | Phase 3 |
| --- | --- | --- |
| Sending to a customer | `tellCustomer(ws, rec, contact, {…})`: email under the team's name (Resend, `platformSendBlock` daily cap and confirmed-email guard), plus a text through the team's own Twilio number when connected; otherwise the app gets an `sms` it opens in the phone's Messages app. Do-not-contact customers get nothing. Each send goes on the job's timeline. | Every Phase 3 message goes through it, unchanged. |
| On my way | One tap on a visit (`onMyWay`), marks the visit's entries `omw` | A step that's met by it |
| Visit reminder | Team switch `custMsgs.reminders`: 9am the day before, on the team's clock | A step |
| Review request | Team switch `custMsgs.reviews` + `reviewUrl`: an hour after a job reaches Paid | A step |
| Quote | Phase 2's share link, copied | Optionally emailed on Send; a follow-up |
| Invoice | Phase 2's automatic invoice: link made, job to Invoiced; never emailed | The automatic one is emailed |
| Payment reminders, quote follow-ups | none | New |
| The timer | `custMsgTick` every `CUSTMSG_TICK_MS` (5 min) | The same tick runs the flows' messages |

**Fixed wording.** Every message is a fixed template (the team's name, the customer's first name, the job's
address, the visit's day and time, a link) like today's reminders and review requests. No free text goes to a
customer from a step in Phase 3, so the rule that an automation's own message to a customer waits for an OK
(Flows, rules.js) doesn't apply; that rule is about text a person wrote into an automation. Editable wording is
later.

## 1. New step kinds

| kind | Name in the menu | How | Done when (server) |
| --- | --- | --- | --- |
| `remind` | Visit reminder | auto | the reminder for the job's next visit was sent (`g.sent`) |
| `omw` | On my way | tap | someone tapped On my way on one of the job's visits after the run started (`entry.omw ≥ run start`) |
| `review` | Review request | auto | the request was sent (`g.sent`) |

Settings:
- `remind`: `visitKind` (optional, as the `book` step). Sends at 9am team time the day before the job's next visit
  (of that kind) that is tomorrow or later.
- `review`: `delayHours` 0–168 (default 1), counted from when the step became the current one; `url` (optional, an
  https address) else the team's review link.
- `omw`: `visitKind` (optional).

Who: `remind` and `review` are automatic, so `who` is ignored and shown as "Kloomie". `omw` is for anyone on the job
by default (it's the crew's tap).

## 2. Settings on existing steps

| Step | Setting | What it does |
| --- | --- | --- |
| `quote` | `email: bool` (default true) | Send the quote also emails the customer the link (the link is still copied). |
| `quote` | `followUpDays: 0–30` (default 0 = off) | When the quote was sent and has no answer after that many days, one follow-up email/text with the link. Once per link (a New quote can follow up again). |
| `invoice` (auto billing only) | `email: bool` (default true) | When the step's invoice is sent, the customer gets it by email (and text) with the pay link. Once per invoice. |
| `payment` | `reminders: [days…]` (up to 3, each 1–60, ascending; default `[]`) | For each, when the run's invoice is that many days past due and not paid, one reminder at 9am team time, with the pay link. |

## 3. When automatic steps act

The flows' messages run in the existing tick (`custMsgTick`), not in the sweep (sending is slow and outside), and
only for a going run on a team that's online and not read-only (as today).
- **An automatic step acts only when it's the run's current step** (like the automatic invoice), so it never fires
  for work not yet reached.
- `g.currentSince` is set by the sweep the first time a step becomes current in a cycle (cleared on reopen), so
  `review.delayHours` counts from then.
- **Can't reach the customer** (no contact on the job, do-not-contact, no email and no Twilio text): the step is
  skipped by Kloomie with the reason ("Dana Ruiz has no email or text number", "Dana Ruiz is marked do not contact",
  "No client on the job"), on the timeline, and the run moves on. A courtesy message never holds a job up. An owner
  can reopen it after fixing the contact.
- **Visit reminder edge cases:** no visit booked → waits ("No visit booked to remind about"); the next visit is
  today (booked same day, or the step came up late) → skipped by Kloomie ("The visit is today"); reminded once,
  for the visit it named (`g.sent = { at, visitId, date }`); a visit moved after the reminder doesn't send another.
- **Review with no link** (step and team both empty): waits ("Add a review link"), never skipped silently.
- **The email couldn't go** (daily cap, unconfirmed email, mail off) and no text went either: the step waits with
  that reason and the tick tries again next time; it's met only when something was actually sent.
- **Exactly once.** `g.sent` (and the per-link / per-invoice / per-day markers below) are written and saved
  **before** the send starts (`g.sending = true`, then `g.sent` on success, cleared on failure), so a tick that
  overlaps or a restart never sends twice. A send in flight at a crash is lost, not doubled.
- Markers: quote follow-up `g.followedFor = <share token>`; invoice email `g.emailedFor = <invoiceId>`; payment
  reminders `g.reminded = { <invoiceId>: [days…] }`.

## 4. The team-wide switches retire for jobs on flows
- A job that has (or had) a Job Flow run, not cancelled, gets **no** team-wide visit reminder or review request;
  its flow decides. Jobs not on a flow keep today's behavior until Move my jobs here (Phase 5), when the switches
  go away for good.
- Settings → Customer messages says so ("Jobs on a Job Flow follow their flow's steps").

## 5. Permissions and privacy
- Building: owners and admins (as all flow editing). Publish rules: `review.url` must be `https://`; `reminders`
  as above; `followUpDays` 0–30; `delayHours` 0–168.
- Runs: members see an automatic step's state and its reason, never the customer's email or phone (the run view
  already carries no contact details; the reasons name the customer only by name, as the job page does).
- Every message lands on the job's timeline (as `tellCustomer` does today), with who/what: "Kloomie" for automatic
  ones, the person for On my way and Send the quote.

## 6. Reads
A step carries, for everyone: `auto: true` for `remind`/`review`, `sent: { at } | null`, `waiting: reason | null`
(when it waits), `skippedBy: 'kloomie' | null`. For owners and admins: `sentTo: 'email' | 'text' | 'both'`. The quote
step adds `followUp: { days, sentAt }`; the payment step adds `reminders: [{ days, sentAt }]`.

## 7. Tests (written first, failing on `jobflows-money`)

| Test (port) | Covers |
| --- | --- |
| `jobflow_auto.mjs` (5253) | publish rules for the new kinds and settings; `remind`: waits with no visit, sends at/after 9am the day before (team clock), once, done, on the timeline; visit today → skipped by Kloomie; unreachable / do-not-contact / no client → skipped with the reason, the run moves on; not current → nothing sent; `review`: delay counted from becoming current, sends once, no link → waits, step url beats the team's; `omw`: done by a tap on the job's visit after the run started, not by one before; the quote's email on Send and the follow-up once per link after N days (none after an answer, again after New quote); the automatic invoice emailed once per invoice (a void's replacement is emailed too); payment reminders once each, only past due and unpaid, none after paid; a failed email (cap) waits and retries, never doubles; a restart mid-way doesn't send twice; team switches give a job on a flow no reminder or review while a job off flows still gets them; members see states and reasons, no contact details |
| `jobs_ui.mjs` (Chrome) | with the client: the new steps in the builder (menu, settings), the run card's words for sent / waiting / skipped by Kloomie |

Time is made testable without waiting days: `CUSTMSG_TICK_MS` (exists) for a fast tick, and a test-only
`JOBFLOWS_DAY_MS` (outside production) that shortens a day for follow-up and review delays. The 9am rule uses the
team's time zone, as `custmsg.mjs` does (a zone where it's past 9am).

Existing suites that must stay green: everything in PHASE2 §6, plus custmsg, twilio, audit_send.

## 8. Out of Phase 3
Editable message wording; a reminder re-sent when a visit moves; texting without the team's Twilio (the phone's
Messages app stays a one-tap thing for people, never automatic); deposits; recurring work; moving old jobs onto
flows (and with it retiring the team switches entirely).
