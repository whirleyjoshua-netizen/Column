# Kloomie coding guide: what the November 2026 audit taught us

Every rule here comes from a real mistake found in Kloomie's own code during the audit (docs/audit/FINDINGS.md has
each finding, its fix and its test). None of them was careless typing: each was a reasonable shortcut that held
until someone used the app in a way nobody pictured. The point is to learn the shape of each mistake so the next
feature doesn't repeat it.

Read this before writing a route, a connection to another service, an AI feature or a migration.

---

## 1. One rule, every path

**The mistake.** A permission or business rule was checked on the main path and forgotten on the others. Team
rules (approvals) held in the app but not in the public API, not when deleting a whole project or list (which deletes
its records), and not when a sent invoice's lines were edited afterwards (F4). Deleting one message checked
ownership; "Clear" deleted everyone's (B2). The read-only lock held in the app, not the API (B4).

**Why it happens.** A rule is written where the feature is first built. New ways to reach the same data (an API, a
bulk action, an import, an agent, a webhook) are added later by someone thinking about the new feature.

**The practice.**
- Put the rule in one function and call it from every path that can cause the effect. Ask "what else deletes a
  record?" not "what does this route do?".
- When adding a new door (API, agent tool, import, bulk action), list the rules the old doors enforce and call the
  same functions.
- A change after approval is a new change: editing an approved thing needs the same check.

```js
// Before: only DELETE /records/:id asked for an OK.
for (const r of Object.values(db.records)) if (r.projectId === p.id) delete db.records[r.id];

// After: deleting a project with records goes through the same rule.
const n = Object.values(db.records).filter((r) => r.projectId === p.id).length;
const held = n ? hold(ws, auth, 'deleteRecord', { summary: `Delete ${p.name} and its ${n} records`, req }) : null;
if (held) return send(res, held.status, held.body);
```

## 2. Visibility travels with the data

**The mistake.** Something private leaked through a side channel even though its main view was locked down: an
agent's step label named a private record (F10); a broadcast sent a saved campaign to people who shouldn't see it
because the copy sent had no team id to check (B7); a record could link a doc the person couldn't see, and the AI then
read it (F11); webhooks and API task lists included private campaigns (E4, B5).

**Why it happens.** Visibility is checked when listing, but data also flows into labels, error messages, prompts,
live updates, exports and webhooks.

**The practice.**
- Every place that turns data into text for someone (a label, an error, a prompt, a notification, a broadcast, a
  webhook) checks that this person may see it. Use `canSee`, `seesCampaign`, `PJ.sees`.
- Error messages never list other things ("No campaign called X. Campaigns: …" listed private ones).
- Check against the stored record, not a public copy that has had fields removed.
- When linking A to B, check the person can see B, and check again when B is read for someone else.

## 3. Never trust the client for identity or ownership

**The mistake.** Ownership of old messages was decided by a device id the browser sends, and other people could
read that id (B10). "Sign out everywhere else" kept every sign-in claiming the same device id (A14).

**The practice.** Identity comes from the server's own records: the sign-in's member, never a value the request
supplies. If a browser must prove it holds something (its other sign-ins), it sends the thing itself and the server
checks it.

## 4. Secrets: sealed at rest, never in addresses

**The mistake.** Webhook signing secrets were stored in plain text (E14). Sign-ins were stored in plain text (A12)
and put in URLs for files, images, exports and the live connection, where they end up in logs, history and
drag-and-drop data (H3).

**The practice.**
- Every secret is sealed (`seal`/`unseal`), including keys that "only" sign things. Show a secret once, when made.
- Store a hash of anything used to sign in; look it up by hash.
- Nothing that can act as the person goes in a URL. If a URL must carry something (an `<img src>`), make a separate,
  limited key (the file key: reads files only, ends with the sign-in).

## 5. Uniqueness counts what's pending

**The mistake.** While someone was switching to a new email (waiting for its code), someone else could make an
account with that address, and then both accounts had it (A15).

**The practice.** A uniqueness check includes values that are reserved but not final (pending emails, invites,
holds). Check again when the pending value becomes final.

## 6. Connections to other services

**The mistakes.**
- An OAuth sign-in finished in whatever browser came back, so someone could send a victim their own sign-in link and
  attach the victim's account to the attacker's team (E6).
- Calls to Google, Microsoft, QuickBooks, Dropbox and AI providers had no timeout, so one stalled call could freeze a
  team's sync or an agent run until a restart (E11, F8).
- QuickBooks linked to any invoice with the same number, whoever's it was (E15).
- An address typed in by a user could point at the server's own network (E1, E3).

**The practice.**
- OAuth: bind the start to the browser (`oauthbind.js`); any other browser must confirm, seeing which team and
  person it connects to.
- Every outgoing call has a timeout (`AbortSignal.timeout`), and anything long-running can be stopped.
- An outside address goes through `safeFetch` (checked when the connection is made, no redirects, a size cap).
- Linking to something that already exists elsewhere needs proof it's ours (same customer, same total), not just the
  same name or number.
- Two-way sync means both directions of every action, delete included (G13).

## 7. Text from outside is data, never instructions

**The mistake.** What agents' tools brought back (records, emails, form answers, web pages) went to the AI looking
like any other text, and a run at "execute" level could copy private things into shared places (F6).

**The practice.**
- Mark tool results as data and tell the model, every time, that it is information and never instructions.
- Anything that leaves the team (email, posts) waits for a person's yes.
- Once a run has read something private, its changes wait for a yes.
- Fence user-provided text in prompts; clean the model's reply on the server as untrusted input.

## 8. HTML is built from text, never the other way round

**The mistakes.** A project's icon went into the page as HTML (H9). An @mention inside a link's address put
markup inside the `href` and broke it (H10). A map popup took a team's address as HTML (H4).

**The practice.** Text goes into the page as text (`h('span', {}, text)`, `textContent`). When decorating HTML that
already exists (mentions, links), split it on tags and change only the text between them, and skip inside links.

## 9. Money and records must agree everywhere

**The mistakes.** Two identical coffees on one bank statement became one (G15). An invoice payment's Finance line
could be deleted in Finance while the invoice still said Paid (G14). Removing a payment didn't reach QuickBooks
(G13). A deleted team kept paying for a week (G12). A visit deleted in a calendar left the job "Scheduled" (G16).

**The practice.**
- When the same fact lives in two places, one owns it and the other is read-only, or every change goes through one
  function that updates both.
- Undo paths move things back (Paid → Invoiced), not only forward.
- Duplicate detection: two identical rows in the same file are two real things; only a second import of the same
  row is a duplicate.
- Stop billing the moment something is being deleted, and never erase until the cancel has worked.

## 10. Startup and migrations run in a different world

**The mistake.** Restoring from a daily backup crashed the server on start: the import called `save()`, which used a
variable declared further down the file, so the restore never landed (O1, found only by a drill). Agent sign-ins,
sign-in hashing and item owners are converted at start too.

**The practice.**
- Code that can run while the server starts must not depend on anything declared later. Declare state before the
  functions that use it.
- Every migration is idempotent (running it twice is harmless) and is tested by starting a server on old data.
- Drill the restore. A backup nobody has restored is a hope, not a backup (`tests/restore_drill.mjs`).

## 11. Limits on everything that costs

Uploads have size limits enforced while the bytes arrive (D2). Email from Kloomie's own address needs a confirmed
account and has a daily cap (A9). Webhook deliveries go out at most 4 at a time (E19). Filled-in forms are made at
most 20 times a minute (sign-offs). Wrong passwords lock the place they come from, not the account owner (A11). When
adding something that sends, stores, calls a paid service or does heavy work, add its limit in the same change.

## 12. Reading what people upload: time and size are limits too

**The mistakes (found building Docs import, before release).** A Markdown reader for Notion exports used lazy regexes
and joined lines by copying arrays: one 5 MB page of marks that never close took 82 seconds, and Kloomie is one
process, so everyone's app would have frozen. A zip's sizes are what the zip claims, not what it inflates to. A job
that writes as it goes can be cut off by a restart and leave half its work.

**The practice.**
- Parse uploaded text in one pass with a bounded look-ahead (native `indexOf` within a window), cap the text per
  block, and stop at the most the result can hold (a doc's 5000 blocks). Time a hostile input in the test.
- Inflate with `maxOutputLength` or count bytes while streaming; never trust a header's size. Names inside an
  archive are titles, never paths.
- Yield (`setImmediate`) between units of a long job, so other requests get their turn.
- Mark what a long job makes (`importing: jobId`) until it finishes, and take marked things out at start
  (`dropCutImports`). A failed job takes back what it made.

## 13. A class name is a selector

**The mistake.** A block's row gets the class `dk-<type>`, and the page link inside it was also given `dk-page`, so
`closest('.dk-page')` matched the whole row and tapping the drag handle opened the page. Give inner parts names no
outer element can have.

A name is a selector in code too. `client/app.js` is one closure, so a second `function importSheet` silently
replaced Contacts' own, and two older pairs had done the same for months: a chat folder's options opened the
save-to-folder menu, and starting a checklist run with Enter started a GPS run on the Map. `tests/dupnames.mjs` (in
CI) now fails on any name declared twice at a file's top level. Search for a name before giving a function one.

## 14. Tests that prove something

- Write the test first, run it on the old code, and see it fail. A test that passes on the broken code proves
  nothing (several audit tests were rewritten when they did).
- Test the real path: a real browser for anything on the page (`audit_ui7.mjs`), the real Electron app for the
  desktop (`audit_desktop.mjs`), a real Postgres database for restoring.
- Tests own their ports and their data folders; nothing else runs on them. Kill what you start, including browsers.
- A failure that "only happens under load" is still a failure until you know why: in the audit, most were port
  clashes or leftover processes.

---

## 15. Work history: every change to work is recorded, on every path

Team performance reporting reads the history Kloomie keeps, not the work's current state (job plan Phase 5,
2026-11-19). That history is only as good as its weakest path: a way of making or changing work that skips it leaves
a hole nobody notices until a report comes out wrong.

- **Every write to a task goes through `noteWork`.** Anything that creates a task or changes whether it's done, who
  it's for (person, team role or campaign role), its due date or its sign-off calls `noteWork(t, workOf(before))`
  (or `noteWork(t, null)` for a new one) just before `db.tasks[id] = t`. Going through `POST /tasks`, `PATCH
  /tasks/:id` or the public API already does. A new direct write to `db.tasks` must do it too. When Saved tasks
  added `usePreset`, its tasks were made without it and had no history until `tests/history.mjs` was extended to
  cover them.
- **Don't pass who did it: read it.** `actorNow()` knows who's acting. Each request runs with an `ACTOR` store that
  its sign-in fills in (the app, the public API, or a replay as someone), and an automation's own work runs under
  `FLOWING`, so it's the automation's, never its maker's. Only override it when the change really belongs to
  someone else: a step's tool (`via: 'tool'`, as whoever used it) or Kloomie itself (`by: null, via: 'kloomie'`).
- **Count a thing once, when it ends.** An automation run is tallied on the day it finishes, fails with no try left,
  or is dropped. A run waiting on a wait step or a retry isn't counted yet. The first version counted at every log
  line, so one run that waited showed as two. Anything new that counts work (runs, visits, steps) needs the same
  care.
- **Steps, visits, jobs.** A step's `startedAt` / `finishedAt` / `finishedById` are kept in `jobStepsOnce`, a visit's
  `doneAt` / `doneById` in `applyEntry`, and a job's stages in `recordEvent`. Change those through the same places.
- **History stays on the server.** `hist` (tasks) and `stages` (jobs) are stripped from what goes to the browser
  (`publicTask`, `publicRecord`). Keep it that way: reports read it on the server, with the reader's visibility.

---

## Before you push: a short checklist
- [ ] Every path that can cause this effect calls the same rule (app, API, bulk, import, agent, webhook).
- [ ] Every place this data turns into text checks who's reading.
- [ ] No secret stored in plain text; nothing that can act as the person in a URL.
- [ ] Outgoing calls have timeouts; outside addresses go through `safeFetch`.
- [ ] Uploaded files are read with size caps enforced while reading, in bounded time (a hostile input is timed in
      the test); long jobs yield and leave nothing half-made after a failure or a restart.
- [ ] Text goes into pages as text.
- [ ] Anything that sends, stores or costs has a limit.
- [ ] Startup code and migrations tested on old data.
- [ ] Anything that makes or changes a task calls `noteWork`; who did it comes from `actorNow()`.
- [ ] A test that failed on the old code now passes; `bash tests/ci.sh` passes.
