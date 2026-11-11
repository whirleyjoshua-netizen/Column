# Findings

Status:
- **reported:** a reviewer found it in the code; not yet reproduced.
- **reproduced:** proven by a test or request; not yet fixed.
- **fixed:** the commit and the test that guards it are named.
- **unconfirmed:** couldn't be reproduced; not acted on.
- **won't fix:** with the reason.

Reviewer areas: A sign-in and accounts · B team isolation (no cross-team access found; issues inside a team) · C public pages (stopped early by an automated safeguard after C1) · D files (stopped early after D1–D2) · E connections · F AI agents · G money, time, data · H browser, desktop, phone. GRD = groundwork checks.

## Critical
| ID | Finding | Status |
|---|---|---|
| C1 | A request whose address has a bad %-escape (e.g. `/%E0`) throws in serveStatic. The handler has no catch outside /api, so the crash handler exits the process and the whole site goes down for everyone. | fixed 402bc6e, live 2026-11-10 (tests/audit_critical.mjs) |
| D1 / C2 / H2 | Uploaded files are served from the app's own address with the type the uploader chose (or .html/.svg by name), inline, with no nosniff or sandbox. A file a stranger uploads (through any team, or a file-request link) can run script on app.kloomie.com when opened (share links included) and read the viewer's sign-in tokens. | fixed 402bc6e (audit_critical) |
| F1 | Agent tools log_note and book_visit put the model-chosen record_id straight into a path. `../` and `?` let outside text (a lead message, a pasted email) make an agent POST to any route as the user with no approval, e.g. /api/clear (wipes chat and files) or /api/invite. | fixed 402bc6e (audit_critical, with a fake model) |
| H1 | /postiz/done put the `r` value from the address inside a `<script>` with no CSP, so a crafted link runs script on app.kloomie.com (reflected). | fixed 402bc6e (audit_critical) |

## High
| ID | Finding | Status |
|---|---|---|
| A1 / E2 | Removing a member leaves their API keys working (now as a member), and any webhooks those keys made keep pushing team events. | fixed e3c442b, live (tests/audit_auth.mjs) |
| A2 | Linking a name-only login to an email account asks only for the password, so two-step sign-in can be bypassed; after linking, password change, account delete and email change reach the victim's account. | fixed (tests/audit_auth.mjs) |
| B1 | A removed or logged-out member's open live connection keeps receiving team updates (sockets are found through tokens, and the token is already gone). | fixed: endSession closes the connection; broadcast drops connections whose session or member is gone (audit_auth) |
| H3 | The full session token is put in URLs (file links, image sources, the export link, drag-out data), and files are cached for a year after sign-out. | reported |
| D2 | No storage limit per team or overall on a 5 GB shared volume. Anonymous file-request links accept 500 MB × 200 files per hour per address; editing writes the whole body before the size check; Dropbox import has no size check. | fixed (tests/audit_storage.mjs): MAX_FILE_MB, TEAM_STORAGE_MB and DISK_RESERVE_MB, checked before reading when the size is declared and enforced while arriving; resumable uploads checked at start and per chunk; file-request links and Dropbox import too |
| E1 | Self-hosted Postiz address: checked once when saved, then fetched with redirects followed and no re-check, and the reply is shown back. That makes it a readable request into private or internal addresses, plus unbounded reply size. | fixed (tests/audit_safefetch.mjs): server/safefetch.js checks the address at connect time (no DNS-rebinding gap), refuses non-public ranges including IPv4 inside IPv6, follows no redirects unless asked, caps the reply; used by Postiz, webhooks, the HQ website reader and PSS |
| F2 | Any member can publish to the company's social accounts through the Marketing agent (draft_social_post has no role check; connecting Postiz is admin-only). | fixed in code: Postiz tools are owner/admin only for agents too (an agent test with a connected Postiz is still to add) |
| G1 | A customer can be charged twice: each Pay click opens a new Stripe session for the full balance and old ones stay valid. Paid sessions and manual or API payments aren't checked against the balance, which is clamped to 0 so overpayment is hidden. | fixed (tests/audit_money.mjs: one open card page, reused; closed in Stripe when a payment is recorded, the lines change or it's voided; manual and API payments capped at what's owed; any overpayment flagged to admins) |
| G2 | Merging or deleting a contact leaves job and record contact fields, texts and list rows pointing at a contact that no longer exists. Reminders and "on my way" silently go to nobody, and invoices lose "Bill to". | fixed (tests/audit_money.mjs): repointContact on merge, delete and connector drops; a connector contact still on a job is kept, unlinked |

## Medium
| ID | Finding | Status |
|---|---|---|
| A3 | Every member is sent the invite code. A removed person can rejoin at once with it. Invite links they made stay valid. | fixed (tests/audit_auth.mjs) |
| A4 | An admin (or anyone with the code) can reset a name-only member, then join by that name and become them. | fixed (tests/audit_auth.mjs) |
| A5 | Two-step can be turned on without the password (a stolen session can lock the owner out), and on an unconfirmed email (squatting). | fixed (tests/audit_auth.mjs) |
| A6 | The rate-limit address is the leftmost X-Forwarded-For (client-controlled), and the limiter table is cleared wholesale at 50k keys. | fixed: rightmost entry, expired-then-oldest eviction (audit_auth) |
| A7 / H6 | Signing out (everywhere, password reset or change) leaves push notifications going to that device. | fixed: endSession drops that device's subscription (audit_auth) |
| A8 | Wrong current-password tries on change-password and email change aren't limited, and scrypt runs synchronously on the request path. | fixed (tests/audit_auth.mjs) |
| A9 | Unconfirmed accounts can send email from Kloomie's own sender through agents and customer messages. | fixed (tests/audit_send.mjs): email from Kloomie’s own address needs a confirmed account when real email is on, plus PLATFORM_EMAILS_PER_DAY per team |
| E3 | The private-network guard for webhooks, Postiz and HQ can be bypassed (DNS rebinding between check and fetch, IPv4-mapped IPv6, missing ranges, any port). | fixed with E1 (one shared private-address list) |
| E4 | Public API tasks ignore visibility; task webhooks include private campaign tasks. | fixed (tests/audit_access.mjs): API tasks follow canSee and leave out private campaigns and projects; webhooks skip private tasks, visits and campaign-stack files |
| E5 / B6 | Webhook subscriptions over the API skip write and role checks (member keys get contact, invoice, payment and text events). | fixed at subscribe time (tests/audit_access.mjs); re-checking the maker's role at delivery is still to do |
| E6 | OAuth state isn't tied to the browser that started it, all providers (consent phishing attaches a victim's account to an attacker's team). | reported |
| F3 | Approving the same agent step or held rule twice at once runs it twice (emails or posts sent twice). | fixed 5d09311 (tests/audit_agents.mjs, reproduced with MAIL_OUTBOX_DELAY_MS so the test mailer waits like a real send) |
| F4 | Team rules are bypassed via the public API, project and list deletes, and editing a sent invoice's lines. | reported |
| F5 | Agents look up admin-only contacts by name for members and expose their email, phone and address. | fixed (tests/audit_send.mjs): only an owner’s or admin’s agent finds a contact by name |
| F6 | Outside text isn't marked untrusted in agent prompts, and execute-level writes can copy private data into shared places. | reported |
| F7 | Any member can spend an owner's or admin's AI key through /api/hq/learn. | fixed (tests/audit_send.mjs): learning runs at most once an hour per team (an owner’s or admin’s key can still pay, by design), and edits are marked learned only after it works |
| G3 | Quote lines stay editable after a customer accepts, and acceptance isn't tied to the total they saw. | fixed (tests/audit_quote.mjs): the accept form carries a fingerprint of the lines shown, so a changed quote is refused with "look again"; the accepted lines and total are kept; lines are locked after acceptance in the app, the import and the API |
| G4 | A team can end up with two Stripe subscriptions; an old one's events can take over billing. | fixed (tests/audit_billing.mjs): one open subscription checkout at a time; a second live subscription never takes over and owners are told |
| G5 / E9 | Stripe subscription webhooks are applied in arrival order (a late "incomplete" can lock a paying team). | fixed (tests/audit_billing.mjs): subscription events are applied from what Stripe says now, not the event copy |
| G6 | Removing a member silently deletes their job visits. | fixed (tests/audit_money.mjs): someone removed loses their place on shared visits; a visit only they were on goes to an owner, who is told |
| G7 | A repeat rule's UNTIL (UTC) is compared with local dates, adding one extra occurrence. | fixed (tests/audit_dates.mjs) |
| G8 | Two quick edits to a new block create two calendar events. | fixed (tests/audit_calendar.mjs) |
| GRD-1 | No HSTS on app.kloomie.com or www.kloomie.com. | fixed 402bc6e |
| GRD-2 / H11 | No frame-ancestors or X-Frame-Options (clickjacking on approve, pay and delete buttons). | fixed 402bc6e (audit_critical) |
| B2 | POST /api/clear lets any member delete everyone's unpinned messages and files (the single delete correctly refuses). | fixed (tests/audit_access.mjs: one mayDelete rule for deleting and clearing) |
| B3 | A member can move a team folder into their own private folder (hiding it), and leaving the team then deletes it. | fixed (tests/audit_access.mjs): a move that changes who can see something needs the owner (or an admin), and into a private folder only if everything moved is theirs |
| B4 | The public API ignores the billing read-only lock. | fixed (tests/audit_billing.mjs): API writes get 402 when the team is read-only, 423 while it is being deleted |
| B5 | /api/v1/tasks and visit, task and file webhooks expose private campaigns and private projects. | fixed with E4 |
| H4 | The Leaflet popup takes raw HTML from the team's route start address. | fixed: the start address is put in the popup as text |
| H5 | Electron: openExternal with any scheme, file: navigation allowed, IPC trusts any page, screen capture with no picker, unsigned builds. | reported |
| H6 | Push notifications keep going to signed-out devices. | same as A7 |
| H7 | Contacts, records and agent data stay in memory across sign-out and sign-in in the same tab. | fixed: signing out reloads the page, so nothing loaded stays in memory |

## Low
A10 enumeration messages · A11 forced lockout of someone else's account · A12 session tokens stored in plain text and accepted in URLs, no absolute expiry · A13 logout leaves the WebSocket open · A14 "sign out others" keeps tokens with the same client-supplied deviceId · A15 two accounts can end up with one email · A16 scrypt cost and minimum-length inconsistency · E7 OAuth callback page puts the account name into HTML unescaped · E8 a malformed COLUMN_SECRET_KEY silently falls back to a disk key · E10 PSS address accepts localhost and private hosts · E11 missing timeouts stall sync engines · E12 Apple CalDAV retried forever, and the connect form can test passwords · E13 disconnect or leave doesn't always revoke · E14 outgoing webhook secrets not sealed · E15 QuickBooks links by DocNumber alone · E16 Twilio status order, and inbound texts ignore the contact limit · E17 OAuth pending maps never pruned · E18 the Zapier signature check passes when it can't check · E19 webhook bodies not consumed, no concurrency cap · F8 runs can hang, cancel keeps spending, and the cap skips scheduled runs · F9 hand_off in a reply is dropped · F10 step labels and errors leak private titles · F11 a linked doc reaches AI without a visibility check · F12 Approve all enforced only in the browser (fixed 5d09311, audit_agents) · G9 a duplicate visit reminder after adding crew · G10 the API accepts impossible times · G11 impossible dates stored · G12 a team being deleted keeps paying 7 days · G13 payment deletes don't sync with QuickBooks · G14 Finance and invoice payments drift · G15 bank import drops repeated same-day charges · G16 deleting a calendar event drops a visit without updating the job · GRD-3 nosniff, Referrer-Policy and a scripts-only CSP.

Also low: A10 (fixed, one answer for a wrong team, code, name or password), A13 (fixed, audit_auth), B6 (= E5), B7 template and handoff broadcasts under members-see-only-theirs, B8 the read-only allow-list is too broad, B9 module routes run before the 423 deleting check, B10 pre-account items owned by client deviceId, B11 small gaps (stack rename, locked docs, publicapi email match), H8 desktop cache path, H9 icons through innerHTML, H10 @mention inside a link, double-submit on billing, push subscription keyed by endpoint across teams.

Each low item is reproduced and fixed in turn, the same way as the rest.

## Test suite findings (from the baseline run, 2026-11-10)
- **push.mjs** fails on 2c97941 as well; it passes after the sign-in fixes (signing out now drops a device's notifications) ("opening it lists them, marked new"): an existing bug or a stale test, to be checked.
- **Flaky:** e2e6 failed twice and passed twice on the same code. e2e7 and e2e8 failed only while other test servers clashed on ports.
- **Stale since recent features:** qboui expects the old "Lead form & lead webhook" title. acctui2, e2e5, export, leave, req, tabbar and tech2 failed on the baseline too; each to be checked (code bug or test out of date) before the audit closes.
- Running audit tests at the same time as the suite made them hit other tests' servers, because ports 4781 to 4785 were shared. Audit tests use 4901 to 4904, and nothing else runs alongside the suite.
- **export.mjs** and **leave.mjs** fail on 2c97941 the same way they fail now (export: a missing inviteCode in the test; leave: "his AI key in Alpha is gone"). Both are to be checked.
- **A3 adjustment:** replacing the invite code when anyone leaves broke leave.mjs and would surprise teams, because a code an admin just shared would stop working. It is now replaced only when an admin removes someone.
- **Flaky by design:** e2e5, e2e6, e2e7 and e2e8 switch the team's tools on, wait a fixed 1.2 seconds, then expect the Tools menu to have updated. On a busy machine that is too short. e2e8 failed on 2c97941 too. These tests are to be changed to wait for the menu item to appear instead.
- **Tests opening a page have side effects:** opening a sent quote marks it Viewed, so quote.mjs now expects Sent or Viewed after reading the form.
- **F7 adjustment:** at first I made learning use only the person's own key. hqlearn.mjs showed the intended design (a member's edits teach the team's voice on an owner's key), so the fix kept that and added the hourly limit, which removes the unlimited-spend problem.
- **The machine was overloaded** (load average 20 to 30, the screen recorder replayd near 150% CPU for hours), so browser tests timed out at random steps. Server-level checks confirmed the features (for example, bid to quote) while the browser tests were unreliable.

## Batch 6 (tests/audit_misc.mjs)
- **E8 fixed:** a COLUMN_SECRET_KEY with stray spaces is trimmed; one that's set but malformed stops the server instead of quietly sealing with another key.
- **H8 fixed:** a file can't be named "." or ".." (stored as "_..").
- **G10 fixed:** the API refuses impossible times (25:00, 9:75) instead of changing them.
- **G11 fixed:** one shared isDay (server/dates.js) checks real calendar days everywhere a day is accepted: entries, tasks, bills, invoices, payments, the API, HQ deadlines and standups.
- **B9 fixed:** a team being deleted can't change texting, lead capture or Dropbox.
- **E7 fixed as a precaution, not reproduced:** the calendar connection pages escape what they show and allow no script. The real path, an account name from Google or Microsoft, couldn't be produced in a test.
- **E12 fixed:** an Apple calendar whose app-specific password stopped working isn't retried every few minutes.
- **E16 fixed (status order):** a Twilio status only moves forward. Won't fix: capping contacts made by inbound texts. A cap would drop a real customer's message, and flooding would mean someone paying for texts to the team's own number.
- **E17 fixed:** expired sign-in starts are pruned (calendars, QuickBooks).
- **G9 fixed:** someone added to a visit that has already been reminded about doesn't set off a second reminder.
- **G7 fixed:** a repeating event's end (UNTIL) is compared as a moment, so an evening event doesn't get one extra day.
- **G8 fixed:** pushes to a connected calendar queue per block, so quick edits make one event; a deleted calendar's entries are cleaned up.
- **E5 (delivery) fixed:** a webhook checks its maker's role again when it delivers, not only when it is made.
- **D (crash):** a crash now writes the last moment's changes before the server stops.

## Areas the stopped reviewers didn't finish (C, D), reviewed by hand
- **D (files):** every kind of stored file (uploads, folder files, doc history, signing PDFs, meeting audio, Sidekick files, exports, logos, upload parts) is removed when its owner is deleted and when a team is erased. Stale resumable uploads are swept after 24 hours. Saving is debounced with retries, fencing and a flush on shutdown (a crash now flushes too). Low, not fixed: no sweep for files left on disk by a crash mid-write.
- **C (public pages):** every public route was listed. All secret links are 96 bits or more of randomness. Server-built pages escape what they show, and shared docs check link schemes when saved and allow no script. Unauthenticated writes are rate-limited or signature-checked. /import needs IMPORT_TOKEN (24+ characters, constant-time) and only works on an empty database. Recommendation: remove IMPORT_TOKEN from Railway unless a migration is in progress.
