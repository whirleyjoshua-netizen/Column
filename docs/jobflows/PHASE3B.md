# Job Flows — Phase 3b: nothing reaches a customer without an OK, and quotes that look like the business

Status: round 2 for review, 2026-11-25 (round 1 answers in §6). No code yet. The owner, after the local walkthrough: "I want to confirm
anything that goes to customer. quote, text etc." and "can we give the users settings to add their logo and
customize the quote to a certain extent; logo, signature etc." On automatic messages the owner chose: per step,
"Send by itself" or "Ask me first", defaulting to Ask me first. Built on `jobflows-links` before Phase 4's code
(Phase 4's contract is approved and unchanged).

## 1. Every send a person starts asks first, with the message shown

The buttons that email or text a customer today:

| Button | Route |
| --- | --- |
| Send the quote (job card, Jobs list) | `POST /jobs/:id/quote/send` |
| On my way (visit sheet, flow step) | `POST /visits/:id/on-my-way` |
| 🔔 Remind the customer (visit) | `POST /visits/:id/remind` |
| Ask for a review (job) | `POST /records/:id/review-request` |
| Text a contact (Contacts) | `POST /contacts/:id/texts` |
| Send to sign / remind to sign (sign-offs) | `POST /signoff/:r/:f/send`, `…/remind`, `POST /signs/:id/email` |
| Send proof (licenses & insurance) | `POST /profile/proofs` (when it emails) |

**Server-enforced two-step send, with one-time tickets.** Each of these routes, called without `confirm`, sends
nothing and answers `428 { preview: { to: <name>, via: 'email'|'text'|'both', email?, phone?, subject?, text },
confirm: <ticket> }`.
- The **ticket** is an opaque random id (not a hash anyone could recompute), kept server-side
  (`db.sendTickets[id] = { wsId, memberId, route, target, digest, at, used: null }`), where `target` is the resource
  (job, visit, contact, sign-off) and `digest` hashes the exact recipients, channel, subject and text. It's valid
  for 10 minutes, for that person, that route and that target only.
- Called again with the ticket: the server checks it (same team, person, route, target, not expired, not used),
  rebuilds the message and compares the digest **immediately before sending**; then marks the ticket used and sends
  **in the same synchronous turn** (no `await` between the check, the mark and the hand-off to `sendOnce`, whose own
  marker is written in that turn too), so two simultaneous confirmations can't both send: the second sees `used`.
- A used ticket → `409 { sent: true }` (it already went; nothing is sent again). Expired, someone else's, another
  route's or target's → `409` with a fresh preview. Message or recipients changed → `409` with a fresh preview.
  The person must still be allowed to do the action when confirming (a ticket never grants permission; a member
  demoted between the two calls is refused).
- Tickets are trimmed after a day; at most 200 open per team.
So no client path (today's, a new one, the public API, an agent) can send without the preview step, and what was
confirmed is what goes, once.
- The app shows the preview in a sheet: "Send to Dana Ruiz by email (dana@…)?", the subject and the message text,
  **Send** / **Cancel**. Members see the email or phone only where they can today (the On my way sheet already shows
  the customer's name and phone to the crew; the preview never shows a member more than the screen they came from).
- **Every provider call is accounted for.** The implementation lists every call site of the customer email sender
  (`mailer.customerEmail`, `tellCustomer`) and the Twilio sender (`TW.sendText`) and puts each behind exactly one of:
  (a) a confirmed ticket (§1), (b) an automatic step set to `send: 'auto'` (§2), (c) an existing approval path that
  already holds a person's OK (agents' draft-then-accept, the Flows hold for automations' customer messages, the
  Mail tool's own review). A test greps the server for those calls and fails if a new one appears outside the
  list in `docs/jobflows/SENDS.md` (written with the code).
- A public API key must use the two calls too (and a replayed ticket doesn't send twice). Agents' existing draft /
  accept stays; accepting an agent's draft is the person's OK, and agents can't call the confirm step themselves.
- Making a quote link without emailing it (Bids & Quotes "Send to customer", which copies the link for the person
  to send themselves) and marking an invoice sent (a link, nothing emailed by Kloomie) aren't sends to a customer
  by Kloomie and stay one tap; the invoice's email (§2) is.

## 2. Automatic steps: "Send by itself" or "Ask me first"

- Each message an automatic step sends gets a setting `send: 'auto' | 'ask'`. Explicit `'auto'` sends by itself;
  explicit `'ask'` waits for an OK; **missing (every version published before this) = `'ask'`** — a deliberate change
  of default for older versions. It applies to: Visit reminder, Review request, the quote's
  follow-up, the automatic invoice's email, payment reminders. The builder shows it on each ("🤖 Send by itself" /
  "✋ Ask me first").
- **Ask me first**: when the message is due (everything in PHASE3 §3 still applies: current step, 9am, delays,
  unreachable → skipped), instead of sending, Kloomie keeps a pending message on the step,
  `g.pending = { key, kind, preview, dueAt, createdAt }` (one at a time per marker), notifies the run's owner and the
  team's owners and admins ("Day-before reminder for Dana Ruiz is ready to send"), and the run card shows it with
  the preview and **Send** / **Don't send** (owners and admins only).
  - **Send** → the too-late checks run again **at that moment** (not only when the pending entry was made); then the
    same `sendOnce` path (PHASE3 §3.1):
    - sent → the pending entry is cleared, the message is handled;
    - **not sent, for sure** (blocked) → the pending entry **stays**, with `lastTry: { at, reason }` shown on the
      card, so the owner can press Send again once the cause is fixed; the scheduler never sends it by itself;
    - unsure → handled as in Phase 3 (counted as done, "may not have gone", never retried), pending cleared.
  - **Don't send** → the message is marked `declined` (it counts as handled: a Visit reminder or Review request step
    is skipped by that person with "Not sent"; a follow-up or a payment reminder is marked declined and never asked
    again for that link / invoice / day). On the timeline.
  - **Too late**: a pending day-before reminder whose visit day has come, a follow-up whose quote was answered, a
    payment reminder whose invoice is paid or void: dropped (on the timeline: "Not sent: the visit is today"), never
    sent late.
- `POST /jobs/:id/steps/:sid/message { action: 'send' | 'skip', key }` (owners and admins); `action: 'skip'` (the
  "Don't send" button) gives the outcome `declined`.
- **Lifecycle rules**: one pending entry per send marker (the step's message, a quote link's follow-up, an invoice's
  email, an invoice's reminder day); a newer one never replaces an unresolved one (the scheduler waits); a stale or
  wrong `key` → 409, sends and declines nothing; members get 403; a declined message is never recreated for the same
  marker; a pending message that becomes too late is dropped for good and noted on the timeline; pending entries are
  kept in the data, so they survive a restart; each pending entry's preview is what Send sends (rebuilt and compared
  at send time; if it changed, the card shows the new one and the key changes).
- Changing a published flow's `send` setting needs a new version, like any setting.

## 3. Quotes and invoices that look like the business

Settings → **Quotes & invoices** (owners and admins), `ws.docs`:

| Setting | Shown |
| --- | --- |
| Logo, accent colour | (exist, in Brand) linked here too |
| Business details: name to show, address, phone, email, website, license number | top of quotes and invoices |
| **Business signature** (the team's representative): draw it or upload an image (PNG/JPEG, ≤ 200 KB), with a name and title ("Josh W., Owner") | "Prepared by" on quotes |
| Valid for N days (0–365, default 30; **0 = no expiry**) | a job quote's Valid until (Issued + N); past it the page says it expired |
| Default terms (≤ 4,000 chars) and a footer note (≤ 300) | a quote's own terms override the default; footer on quotes and invoices |
| Show each line's price (default on) | off: lines show description and quantity; **the total always shows** |
| How the customer accepts: **type** their name (default) or **draw** a signature | the quote page |

- **Issued quotes don't change underneath the customer**: when a job quote is first sent, the business details,
  business signature, terms, footer and the show-prices choice are **snapshotted** onto the quote
  (`rec.quoteLook = {…}`); its page renders from the snapshot. A New quote takes a fresh snapshot. The logo and
  accent colour follow Brand live (as today), since they're the team's identity, not the offer.

- **Job quotes** get what Bids & Quotes quotes have: a number (`Q-1001`, a team counter, given on first send),
  Issued and Valid until, and "Prepared for" with the job's client (name, address; email and phone only if the
  team turns that on).
- **Customer acceptance**, one rule per mode, both still requiring the lines fingerprint (audit G3):
  - **Type**: a typed full name is required (as today); no drawing.
  - **Draw**: a drawn signature is required; a typed name is optional (kept if given). The pad is an inline script
    allowed by a per-page CSP nonce (nothing else loads). The drawing is a PNG data URL, checked (PNG header,
    ≤ 100 KB, not blank) and kept as evidence.
  - The answer records how: `rec.answer = { act, method: 'typed' | 'drawn', name, signature?, at, lines, total }`;
    the accepted page and the job's quote step (owners and admins) show it. The business signature and the customer's
    are different things in data and on the page ("Prepared by" vs "Accepted by").
- Images (signature, logo) are served from Kloomie like the logo today (`/brand/<id>`), never from outside.
- Invoices (`/i/<token>`) show the same business details, footer and logo; their pay flow doesn't change, and they
  show nothing about the customer or the business beyond what the invoice page shows today plus those settings.

## 4. Tests (written first, failing on `jobflows-links`)

| Test (port) | Covers |
| --- | --- |
| `customer_sends.mjs` (5256) | round 1 additions: a replayed ticket doesn't send again (409 sent); two simultaneous confirms send once; an expired ticket, another person's, another route's or target's → 409; an unauthorized person with a valid ticket is refused; the public API's two calls and replay; an agent can't confirm by itself; the provider-call inventory check; legacy (no setting) versions ask, explicit auto sends; a blocked approved send keeps its pending entry with the reason and can be sent again; approval re-checks too-late; one pending per marker, no replacement, declined never recreated, pending survives a restart. And each route in §1: no `confirm` → 428 with a preview and nothing sent (outbox and Twilio stand-in empty); the right `confirm` → sent once; a stale `confirm` after the wording or recipient changed → 409, nothing sent; members' previews show no more contact detail than today; automatic steps: default ask → a pending message, a notification to owners and admins, nothing sent; Send sends once (and blocked / unsure behave as PHASE3); Don't send marks it declined and skips the step; too-late drops; a stale key 409; `send: 'auto'` sends by itself as before; members can't send or decline; a version from before this asks |
| `quote_look.mjs` (5257) | round 1 additions: an issued quote keeps its snapshot after the settings change, a New quote takes the new ones; 0 days never expires; a quote's own terms beat the default; hidden prices keep the total; type mode needs the name and no drawing, draw mode needs the drawing and not the name, the answer records the method; the invoice page shows nothing extra. And: settings validation and owners-only; business details, signature, terms, footer, hidden line prices on the quote page and the invoice page; job quote number, issued, valid until and expiry; Prepared for; the drawn signature accepted only when valid (bad header, too big, blank refused) and shown afterwards; the CSP nonce changes per page; nothing loads from outside |
| `jobs_ui.mjs` (Chrome) | the confirm sheet on Send the quote and On my way; the Ask me first card with Send / Don't send; the settings page; the signature pad on the quote page |

Existing suites that must stay green: everything in PHASE3 §7 and PHASE2 §6, plus custmsg, signoffs, twilio,
audit_send, audit_quote, contacts, agents (their send tools), apiwide.

## 5. Out of 3b
Fully custom quote layouts or fonts; per-flow quote designs; a PDF of the quote (the Bids PDF stays as it is);
editable message wording (still later).

## 6. Round 1 review (ChatGPT), and what changed
1. **Tickets, not hashes**: §1. Opaque, server-kept, 10 minutes, bound to team, person, route, target and digest;
   single use, marked and sent in one synchronous turn; replay → 409 sent; permission re-checked.
2. **Defaults and blocked sends**: §2. Explicit auto / explicit ask / missing = ask; a blocked approved send keeps
   its pending entry with the reason; unsure as Phase 3.
3. **Signatures**: §3. Type mode = typed name; draw mode = drawing (name optional); the method and evidence kept;
   business vs customer signatures distinct.
4. **Pending lifecycle**: §2. One per marker, no replacement, stale key 409, owners and admins only, declined is
   final, too-late dropped and noted, kept across restarts, `skip` → `declined`, too-late re-checked at approval.
5. **Every provider call accounted for**: §1. An inventory in SENDS.md and a test that fails on a new unlisted call.
6. **Quote details**: §3. 0 days = no expiry; issued quotes snapshot their look; own terms beat defaults; the total
   always shows; invoices expose nothing extra.


## 7. Checkpoint 2 review (ChatGPT), and what changed

Decisions that tighten §1–§3 (each has tests in round 2 of `customer_sends.mjs` / `quote_look.mjs`):

1. **The categories in `docs/jobflows/SENDS.md` are fixed**: `ticket` (§1), `auto step` (a Job Flow message set to
   "Send by itself", §2), `team switch`, `approval`, `own action`, `internal`. The test fails on any other.
   - **team switch**: Settings → Customer messages ("Visit reminders: email customers the day before a visit",
     "Review requests: ask for a review an hour after a job is paid"). They're off until an owner turns one on, and
     the switch says it sends by itself, so turning it on is the same choice as a step's "Send by itself". The settings
     row will say "🤖 Sends by itself" so that's plain. (Jobs on a flow never get these, as in Phase 3.)
   - **approval**: an agent's draft the person accepted (the replay carries `personOk`, set only by the accept path,
     never by the agent; it bypasses no rules), the Flows hold, the Mail tool's own review.
   - **own action**: only a receipt for what the customer themself just did. Today that's one: the signed copy after a
     customer signs. Tested: none before signing, exactly one after, signing again sends no second.
   - **internal**: to the team, never a customer (the Twilio "texting works" test to the owner's own number).
2. **The inventory counts every sender the contract names and its wrappers**: `mailer.customerEmail`,
   `tellCustomer`, `flowTell`, `twilioText`, `sendText`, `.sendMail`, `SIGNOFF_MAIL`, `emailCustomer`,
   `emailSignLink`, `agentEmail`. It's a text count, not a parser (SENDS.md says so); a new call style is caught by
   review, which SENDS.md asks for.
3. **Tickets** are kept in the data (they survive a restart), are trimmed after a day, at most 200 open per team
   (the oldest go first). An agent can't confirm any ticket, including one a person was given; a person can't use one
   made for an agent's call. Another team's ticket is refused.
4. **Send proof** (`POST /profile/proofs`) makes a link and emails nobody, so it isn't a send; if it ever emails,
   it joins the inventory as a `ticket` route.
5. **Acceptance mode is part of an issued quote's look** (snapshotted with the rest); the logo and accent follow
   Brand live; the business signature is snapshotted and its file stays served for the quotes that show it.
   Expired accepts answer 409. Removing the business signature means later quotes show no "Prepared by".
6. **Test-only routes** (refused in production and unless their switch is on): `POST /api/test/agent-call` and
   `GET /api/test/send-tickets` (`SENDS_TEST_AGENT=1`), `POST /api/test/backdate-quote` (`QUOTE_TEST_BACKDATE=1`).
   `SEND_TICKET_MS` and `SEND_TICKET_KEEP_MS` only shorten times outside production; production is 10 minutes and a day.
7. **Existing suites that assumed messages send by themselves** (`jobflow_auto.mjs`, the Phase 3 UI checks) set
   `send: 'auto'` where they mean it, since missing now means ask.
