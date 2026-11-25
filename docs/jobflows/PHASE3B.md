# Job Flows — Phase 3b: nothing reaches a customer without an OK, and quotes that look like the business

Status: draft for review, 2026-11-25. No code yet. The owner, after the local walkthrough: "I want to confirm
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

**Server-enforced two-step send.** Each of these routes, called without `confirm`, sends nothing and answers
`428 { preview: { to: <name>, via: 'email'|'text'|'both', email?, phone?, subject?, text }, confirm: <key> }`, where
`key` is a hash of the exact message and recipients. Called again with that `confirm`, it sends, if the message and
recipients still hash the same; otherwise `409` with a fresh preview (the job, the contact or the wording changed in
between). So no client path (today's, a new one, the public API, an agent) can send without the preview step, and
what was confirmed is what goes.
- The app shows the preview in a sheet: "Send to Dana Ruiz by email (dana@…)?", the subject and the message text,
  **Send** / **Cancel**. Members see the email or phone only where they can today (the On my way sheet already shows
  the customer's name and phone to the crew; the preview never shows a member more than the screen they came from).
- Agents and automations that send to customers already go through draft-then-accept or the Flows hold; they're
  unchanged. A public API key must send `confirm` too (a second request), documented in the API notes.
- Making a quote link without emailing it (Bids & Quotes "Send to customer", which copies the link for the person
  to send themselves) and marking an invoice sent (a link, nothing emailed by Kloomie) aren't sends to a customer
  by Kloomie and stay one tap; the invoice's email (§2) is.

## 2. Automatic steps: "Send by itself" or "Ask me first"

- Each message an automatic step sends gets a setting `send: 'auto' | 'ask'`, **default `'ask'`** for every step,
  including versions published before this (no setting = ask): Visit reminder, Review request, the quote's
  follow-up, the automatic invoice's email, payment reminders. The builder shows it on each ("🤖 Send by itself" /
  "✋ Ask me first").
- **Ask me first**: when the message is due (everything in PHASE3 §3 still applies: current step, 9am, delays,
  unreachable → skipped), instead of sending, Kloomie keeps a pending message on the step,
  `g.pending = { key, kind, preview, dueAt, createdAt }` (one at a time per marker), notifies the run's owner and the
  team's owners and admins ("Day-before reminder for Dana Ruiz is ready to send"), and the run card shows it with
  the preview and **Send** / **Don't send** (owners and admins only).
  - **Send** → the same `sendOnce` path (PHASE3 §3.1), so it's still once-only, blocked / unsure as before. The
    pending entry goes when the marker is written.
  - **Don't send** → the message is marked `declined` (it counts as handled: a Visit reminder or Review request step
    is skipped by that person with "Not sent"; a follow-up or a payment reminder is marked declined and never asked
    again for that link / invoice / day). On the timeline.
  - **Too late**: a pending day-before reminder whose visit day has come, a follow-up whose quote was answered, a
    payment reminder whose invoice is paid or void: dropped (on the timeline: "Not sent: the visit is today"), never
    sent late.
- `POST /jobs/:id/steps/:sid/message { action: 'send' | 'skip', key }` (owners and admins); `key` must be the
  pending one (a stale tap gets 409).
- Changing a published flow's `send` setting needs a new version, like any setting.

## 3. Quotes and invoices that look like the business

Settings → **Quotes & invoices** (owners and admins), `ws.docs`:

| Setting | Shown |
| --- | --- |
| Logo, accent colour | (exist, in Brand) linked here too |
| Business details: name to show, address, phone, email, website, license number | top of quotes and invoices |
| Signature: draw it or upload an image (PNG/JPEG, ≤ 200 KB), with a name and title ("Josh W., Owner") | "Prepared by" on quotes |
| Valid for N days (0–365, default 30) | a job quote's Valid until (Issued + N); past it the page says it expired |
| Default terms (≤ 4,000 chars) and a footer note (≤ 300) | quotes and invoices without their own terms |
| Show each line's price (default on) | off: lines show description and quantity, the total stays |
| How the customer accepts: type their name (default) or draw a signature | the quote page |

- **Job quotes** get what Bids & Quotes quotes have: a number (`Q-1001`, a team counter, given on first send),
  Issued and Valid until, and "Prepared for" with the job's client (name, address; email and phone only if the
  team turns that on).
- **Drawn signature on accept**: the quote page gets a small signature pad (an inline script allowed by a per-page
  CSP nonce; nothing else loads). The drawing is sent as a PNG data URL, checked (PNG header, ≤ 100 KB, not blank)
  and kept on the answer (`rec.answer.signature`), shown on the accepted page and on the job's quote step to owners
  and admins. The accept still requires the lines fingerprint (audit G3) and a typed name.
- Images (signature, logo) are served from Kloomie like the logo today (`/brand/<id>`), never from outside.
- Invoices (`/i/<token>`) show the same business details, footer and logo; their pay flow doesn't change.

## 4. Tests (written first, failing on `jobflows-links`)

| Test (port) | Covers |
| --- | --- |
| `customer_sends.mjs` (5256) | each route in §1: no `confirm` → 428 with a preview and nothing sent (outbox and Twilio stand-in empty); the right `confirm` → sent once; a stale `confirm` after the wording or recipient changed → 409, nothing sent; members' previews show no more contact detail than today; automatic steps: default ask → a pending message, a notification to owners and admins, nothing sent; Send sends once (and blocked / unsure behave as PHASE3); Don't send marks it declined and skips the step; too-late drops; a stale key 409; `send: 'auto'` sends by itself as before; members can't send or decline; a version from before this asks |
| `quote_look.mjs` (5257) | settings validation and owners-only; business details, signature, terms, footer, hidden line prices on the quote page and the invoice page; job quote number, issued, valid until and expiry; Prepared for; the drawn signature accepted only when valid (bad header, too big, blank refused) and shown afterwards; the CSP nonce changes per page; nothing loads from outside |
| `jobs_ui.mjs` (Chrome) | the confirm sheet on Send the quote and On my way; the Ask me first card with Send / Don't send; the settings page; the signature pad on the quote page |

Existing suites that must stay green: everything in PHASE3 §7 and PHASE2 §6, plus custmsg, signoffs, twilio,
audit_send, audit_quote, contacts, agents (their send tools), apiwide.

## 5. Out of 3b
Fully custom quote layouts or fonts; per-flow quote designs; a PDF of the quote (the Bids PDF stays as it is);
editable message wording (still later).
