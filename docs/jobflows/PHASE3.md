# Job Flows — Phase 3 (Steps that run by themselves) contracts, checkpoint 1

Status: round 3 for review, 2026-11-25 (review answers in §9). No code yet. The spec's build order: "Steps that run by themselves. Customer
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
- **Can't reach the customer** (no contact on the job, do-not-contact, or no valid email address and no phone the
  team's Twilio can text): the step is
  skipped by Kloomie with the reason ("Dana Ruiz has no email or text number", "Dana Ruiz is marked do not contact",
  "No client on the job"), on the timeline, and the run moves on. A courtesy message never holds a job up. An owner
  can reopen it after fixing the contact.
- **Visit reminder edge cases:** no visit booked → waits ("No visit booked to remind about"); the next visit is
  today (booked same day, or the step came up late) → skipped by Kloomie ("The visit is today"); reminded once,
  for the visit it named (`g.sent = { at, visitId, date }`); a visit moved after the reminder doesn't send another.
- **Review with no link** (step and team both empty): waits ("Add a review link"), never skipped silently.
- Markers: quote follow-up `g.followedFor = <share token>`; invoice email `g.emailedFor = <invoiceId>`; payment
  reminders `g.reminded = { <invoiceId>: [days…] }`. Each is per thing, so a New quote or a void's replacement
  invoice starts its own history.

### 3.1 Sending, exactly once (round 1, point 1)
One function, `sendOnce(marker, fn)`, used by every Phase 3 message (steps, the first quote email on Send, follow-ups,
invoice emails, payment reminders):
1. Before anything goes out, write the marker as `{ state: 'sending', at }` and **save**.
2. Call `tellCustomer`. It gives one of three outcomes:
   - **sent**: an email the provider accepted, or a text Twilio accepted → `{ state: 'sent', at, via }`.
   - **not sent, for sure**: nothing left Kloomie: email was blocked before the provider (the daily cap,
     the team's unconfirmed email, mail switched off) and no text was tried → the marker is removed; the step (or the
     reminder) waits with that reason and the next tick tries again.
   - **in doubt**: the provider or Twilio was called and failed or timed out (it may have been delivered) →
     `{ state: 'unsure', at, reason }`. **Never retried by itself.** It counts as sent for moving on (the step is met,
     the reminder day is used), and the run card says "May not have gone: <reason>". An owner who wants it again
     reopens the step.
3. A marker still `sending` when the server starts (a crash mid-send) becomes `unsure` the same way. No second send.

So a customer may, rarely, miss a message; they never get the same one twice.

### 3.2 Texts (round 1, point 3)
Automatic messages text **only** through the team's connected Twilio number. The phone's-Messages-app fallback
(`sms` in `tellCustomer`'s answer) is for a person's tap and **never** counts as sent for an automatic message.
"Unreachable" (skip) means: no client, do-not-contact, or no valid email address and no Twilio-textable phone.
A valid email that can't be sent right now (cap, unconfirmed team email, mail off) is **not** unreachable: it waits
and retries (§3.1). With Twilio connected and a textable phone, a text alone counts as sent.

### 3.3 The quote's and the invoice's own state vs telling the customer (round 1, point 2)
They're separate. Telling the customer never makes, resends or changes a quote or an invoice.
- **Send the quote** (a person's tap): the link is made (the quote is sent, as in Phase 2) whatever happens to the
  email. The answer says whether the customer was emailed or texted, or why not; the link is copied either way.
  There's no background retry of this email (the person has the link in hand); the step shows "Not emailed: <reason>".
  Its marker is `g.quoteTold = { token, state, at }`, keyed to the share token and saved before the send (§3.1):
  another Send tap (or a retried request) for the same token while it's `sending`, `sent` or `unsure` emails
  nothing; a "not sent, for sure" block removes it, so the person's next tap may try again; a New quote's new token
  starts afresh. The link and the quote's state never depend on it.
- **Quote follow-up**: only while the link is live and unanswered. Once accepted, declined, turned off or replaced
  by a New quote, a pending follow-up is dropped. In doubt counts as done for that link.
- **Invoice email** (automatic billing): once the step's invoice is sent, the tick emails it, retrying "not sent,
  for sure" until it goes, **stopping** if the invoice is paid in full or voided. A void's replacement gets its own
  email. Failure never makes another invoice.

### 3.4 Payment reminders (round 1, point 4)
- `days: n` means the **calendar day** `due + n` on the team's clock, from 9am that day.
- Sent while the invoice is sent/viewed/partial and its balance is above $0: a partial payment doesn't stop them;
  paid in full or void does. Never for a draft or a void invoice.
- For the step's bound invoice (else every non-void run invoice, each with its own history, keyed by invoice id).
- Missed ticks (the server was down): when several offsets are due at once, only the latest is sent and the earlier
  ones are marked passed, so the customer gets one reminder, not a burst.

## 4. The team-wide switches retire for jobs on flows
- A job that has ever had a Job Flow run gets **no** team-wide visit reminder or review request. This is kept on the
  job itself (`rec.onFlowSince = <time of its first run>`, set when a run starts or attaches, never cleared), not
  worked out from runs that exist now, so a finished or cancelled run doesn't drop the job back into the team-wide
  messages. A run can't be deleted on its own: campaign routes refuse runs (CONTRACTS §4, `jobflow_hidden`), and a
  run goes only with its job (`dropFor`), when there's no job left to message. The test also clears the run from the
  data directly (`JOBFLOWS_TEST_DROP_RUN`, test only) to show the marker alone decides. Taking a job off its flow means it's done by hand: an owner sends
  its reminder from the visit (🔔 Remind the customer), as anyone can today. Jobs not on a flow keep today's behavior until Move my jobs here (Phase 5), when the switches
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
| `jobflow_auto.mjs` (5253) | round 1 additions: a crash after the provider accepted but before `sent` was saved (a test-only `JOBFLOWS_CRASH_AFTER_SEND` exits the process there) → after restart `unsure`, no second send; a definite failure (the daily cap) waits and retries, an ambiguous one (a test-only `JOBFLOWS_MAIL_THROW` makes the provider call throw) is `unsure` and not retried; Send the quote with the email blocked: the link exists, the quote is sent, "not emailed" shown, no retry; the automatic invoice sent while its email is blocked: one invoice, the email retried and then sent, and stopped when the invoice is paid first; no Twilio → the phone fallback never counts, a contact with a phone only is unreachable and skipped; an unconfirmed team email waits, a missing email skips; a partial payment keeps reminders, paid in full stops them; offsets on the team's calendar across midnight; several offsets due at once send one; a job whose run finished, was cancelled, or was removed from the data still gets no team-wide reminder or review, and `onFlowSince` stays on it; Send the quote twice for one link emails once, a blocked first email lets the next tap try again. And: publish rules for the new kinds and settings; `remind`: waits with no visit, sends at/after 9am the day before (team clock), once, done, on the timeline; visit today → skipped by Kloomie; unreachable / do-not-contact / no client → skipped with the reason, the run moves on; not current → nothing sent; `review`: delay counted from becoming current, sends once, no link → waits, step url beats the team's; `omw`: done by a tap on the job's visit after the run started, not by one before; the quote's email on Send and the follow-up once per link after N days (none after an answer, again after New quote); the automatic invoice emailed once per invoice (a void's replacement is emailed too); payment reminders once each, only past due and unpaid, none after paid; a failed email (cap) waits and retries, never doubles; a restart mid-way doesn't send twice; team switches give a job on a flow no reminder or review while a job off flows still gets them; members see states and reasons, no contact details |
| `jobs_ui.mjs` (Chrome) | with the client: the new steps in the builder (menu, settings), the run card's words for sent / waiting / skipped by Kloomie |

Time is made testable without waiting days: `CUSTMSG_TICK_MS` (exists) for a fast tick, and a test-only
`JOBFLOWS_DAY_MS` (outside production) that shortens a day for follow-up and review delays. The 9am rule uses the
team's time zone, as `custmsg.mjs` does (a zone where it's past 9am).

Existing suites that must stay green: everything in PHASE2 §6, plus custmsg, twilio, audit_send.

## 8. Out of Phase 3
Editable message wording; a reminder re-sent when a visit moves; texting without the team's Twilio (the phone's
Messages app stays a one-tap thing for people, never automatic); deposits; recurring work; moving old jobs onto
flows (and with it retiring the team switches entirely).

## 9. Round 1 review (ChatGPT), and what changed
1. **Exactly once**: §3.1. Three outcomes (sent, not sent for sure, in doubt); in doubt and a crash mid-send are
   `unsure`, never retried by themselves, counted as done; only a failure before the provider retries.
2. **Quote and invoice state vs notification**: §3.3. Separate; telling never makes or resends a quote or invoice;
   Send the quote's email isn't retried in the background; the invoice email retries until it goes, stopping at
   paid or void; follow-ups drop once answered.
3. **Texts**: §3.2. Automatic texts only through Twilio; the Messages-app fallback never counts; unconfirmed email
   waits, a missing address with no Twilio-textable phone skips.
4. **Payment reminders**: §3.4. Calendar days on the team's clock from 9am; continue while a balance remains; never
   for draft or void; per invoice id; one reminder when several are due at once.
5. **Jobs that were on a flow**: §4. A durable `rec.onFlowSince`, never cleared; finished, cancelled or deleted runs
   don't bring back the team-wide messages.

### Round 2 review, and what changed
1. **The first quote email's marker**: `g.quoteTold`, keyed to the share token, saved first; repeats for the same
   token send nothing; only a definite block lets a later tap try again (§3.3).
2. **Deleted runs**: there's no route that deletes a run alone; the test removes one from the data through a
   test-only hook and checks `onFlowSince` still suppresses the team-wide messages (§4, §7).

## 10. Checkpoint 2 (failing tests) notes
- `tests/jobflow_auto.mjs` (5253); the run on `jobflows-money` is `phase3-checkpoint2.log` (63 fail; the passes are
  setup, restarts and "nothing happens" checks that only mean something once the code exists).
- Names the tests settle (additions to §6):
  - `POST /api/jobs/:id/quote/send` (owners and admins): makes or reuses the share link, emails it once per link
    (`g.quoteTold`), answers `{ run, url, told: { emailed, texted, reason } }`. Email tags: `quote-sent`,
    `quote-follow-up`, `invoice`, `payment-reminder`, and today's `visit-reminder` and `review-request`.
  - A step's `sent` is `{ at, unsure? }`; `note` says "May not have gone: …" when unsure; `waiting` is the reason it
    waits; a skip by Kloomie has `skippedBy: 'kloomie'` with `skipReason`. The quote step's `followUp` is
    `{ days, sentAt }`; the payment step's `reminders` is `[{ days, sentAt }]`.
  - Test-only hooks (outside production): `JOBFLOWS_DAY_MS` (a shorter day for follow-ups and review delays),
    `JOBFLOWS_MAIL_THROW` (the provider call throws), `JOBFLOWS_CRASH_AFTER_SEND` (the process exits right after a
    send, before `sent` is saved), `JOBFLOWS_TEST_DROP_RUN` (enables `POST /api/jobs/:id/flow/test-drop`, which
    removes a job's runs from the data). "Email off" is a server started without any mail setup.

