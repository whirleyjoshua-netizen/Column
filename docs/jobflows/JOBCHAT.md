# Chat and stacks together, and a chat for every job (contract)

The owner, 2026-11-27: "combine stacks and chat … in the same feed, with tabs at the top to switch from the whole feed
to just the chats or just the items uploaded in the stack … on each job that is formed … automatically opens a new chat
for it … that chat/stack attached or linked on the actual job card." Branch `jobchat`, cut from main at 2ba3223
(Phase 5 live). Phase 6 (recurring work) comes after this.

## 0. What exists, and what this changes
| Today | Where | This piece |
|---|---|---|
| Messages, files, docs and sealed cards are all `db.items`. An item lives in a feed (`channelId`), a stack (`stackId`, no `channelId`), a folder (`dirId`), or #general (none) | index.js `itemsFor`, `placeAudience` | unchanged: no item moves or converts |
| A feed (`ws.channels`) is the team's, invite-only (`memberIds`), or follows a campaign (`campaignId`). One gate: `seesFeed` | index.js | gains a fourth kind: follows a job (`recordId`) |
| A stack is the team's, follows a campaign, or follows a job (`recordId`, Phase 4 `ensureStack`). One gate: `seesStack` | index.js | a stack can belong to a feed (`channelId`) and then follows it |
| A campaign gets a feed **and** a stack, unconnected (`createCampaign`) | index.js | they're joined: the stack is the feed's Files |
| A stack can be pinned to a chat and opens beside it (the "shelf") | chat pins | the Files tab replaces the shelf for a feed's own stack; pinning other stacks still works |
| A job can be pinned to a chat; "a feed per job can come later" | PHASE4 §4, §8 | every job gets its own feed |
| Stacks page (Everything / Files / one chip per stack) | client `buildPanes` | unchanged in this piece (§7) |

## 1. One feed, three tabs
Every chat feed (#general, a feed, a campaign's, a job's) has tabs at the top: **All · Chat · Files**.
- **Chat**: what the feed shows today (messages, and files dropped into the conversation).
- **Files**: everything in the feed that isn't a message (files, docs, sealed cards, folders), **plus every item in
  the feed's stack**. Filters and search as a stack has them today (`filterBar`). Dropping or uploading here puts the
  file **in the feed's stack**. Request links (`/r/:token`) on the feed's stack land here.
- **All**: both, in time order, newest at the bottom.
- #general's Files is today's Files view (everything not in a feed). #general has no stack of its own.
- The tab is remembered per feed on this device. Unread counts and @ badges count Chat only (as today).
- A feed's stack: `ch.stackId` ↔ `st.channelId`, one to one. A campaign's feed and stack are linked at startup
  (migration, once, `ws.chatStacks = 1`) and at creation. A plain feed's stack is made the first time something goes into
  its Files (one synchronous turn, so two uploads at once make one stack), named after the feed, renamed with it.
- **Seeing**: `seesStack(st)` with `st.channelId` → `seesFeed(that feed)`. Nobody reaches a feed's files through its
  stack id that they couldn't reach through the feed. A stack moved under a feed can't be made wider than the feed.
- Deleting a feed deletes its stack's items with it (as its own items today, to Trash where they go now).

## 2. Stacks that belong to no feed
A team-wide stack with no campaign, job or feed (e.g. "Receipts") gets a team-wide feed of the same name at the
migration, in a **Stacks** chat folder, linked as in §1, and opens on its Files tab. A stack made later in Settings gets
one too. The Stacks page keeps showing every stack as today, so nothing someone relies on disappears.

## 3. A chat for every job
- **Made with the job.** When a record is made in a job list (`isJobList`), by any path that announces it
  (`recordNews(…, 'record.created')`: the board, the Jobs tab, the public API, automations, agents, copies, bug
  reports on tech boards are not job lists), Job Flows makes its feed: `{ recordId, name: the job's name (free name,
  -2, -3…), folderId: the team's **Jobs** chat folder (made once, `jobs: true`), stackId: the job's stack
  (`ensureStack`, so the stack and the feed are made together) }`, and pins the job to it (`{kind:'job'}`) so its
  header shows the job and the step it's on. Bulk import (projects.js 1713, which fires hooks without `recordNews`) and
  Move my jobs here make it too. A job made before this piece gets its feed the first time someone who sees it opens
  its chat link (`POST /jobs/:id/chat`, same one-turn rule).
- A team switch, **Job Settings → Make a chat for each new job** (owners and admins, on by default): off, no feed is made
  with the job; the job's 💬 link still makes one on demand.
- **Who's in it** follows who sees the job: `seesFeed(ch)` with `ch.recordId` → `PJ.recordAt(rec.id, wsId, memberId)`.
  In a "members see only theirs" team that's the Phase 5 rule (made it, a person field, on a visit, the current step).
  A member who gains or loses the job gets `resync` (as the job's stack today, `reseeJob`), so the feed comes or goes.
  Nobody can add or remove people, leave it, or delete it by hand (400, "This chat follows its job").
- The job renamed: the feed's name follows. The job deleted (or its list or board): the feed, its items and its stack
  go with it (as the stack today).
- **Archived when the job is done**: the run reaches done (`job.flow.done`), or, for a job with no flow, its stage is
  the list's last stage. Archived feeds are left out of the sidebar and out of the workspace sent to the app (a team
  with 2,000 jobs doesn't send 2,000 feeds on every change), and so are their items; `GET /jobs/:id/chat` returns the
  feed and its items (§8.9). A new message in it, or an
  owner or admin pressing Reopen, takes it out of the archive. Its items stay where they are.
- Messages in a job's chat notify as any feed's do today (mentions, push). No customer is ever in it.

## 4. On the job card
- The Jobs tab's job rows and cards, the job page's header, and a job's card on its board show **💬** with the chat's
  unread count (and @ when someone mentioned you). Tapping it opens the job's chat beside the job (pages, not pop-ups:
  in the split at full size, a sheet in the docked column and on a phone), on its Chat tab; 🗂️ Files on the job page
  opens the same chat on its Files tab (Phase 4's Files button, now pointing here).
- `jobsList`, the job page and `publicRecord` for job records carry `chatId` (null until made). Only people who see the
  job see the record, so the id goes nowhere new.

## 5. Permissions and limits
- Posting in a job's chat: anyone who sees the job. Members' switches (What members can use): a feed and its Files
  follow **Chat** (`chat`), not Stacks (`column`): a feed's stack is the feed's files now, so a team with Stacks off
  for members still shows them a feed's Files (the state filter at index.js 8888 lets a feed's stack through on
  `chat`). With Chat off for members they still see 💬 on a job, and it says Chat is off for members.
- Feed names are today's slugs (`smith-kitchen-remodel`); a job with no name yet gets `job`, `job-2`…
- There's no limit on feeds today; job feeds add one per job, and archived ones don't load (§3).
- One job, one feed; one feed, one stack (checked on every link).

## 6. Tests, written first (each fails on main)
| Test | What |
|---|---|
| `tests/jobchat.mjs` (5269) | a job made on the board, through the Jobs tab, the public API and an automation each gets one feed, in the Jobs folder, linked to the job's stack, the job pinned; two makes at once → one feed; switch off → none until `POST /jobs/:id/chat`; older job → made on demand; rename follows; delete takes feed, items and stack; in an "own" team a member sees the feed only while they see the job (state, item routes, search, chat pins, share links, export, the public API), gets `resync` when it changes, can't add people, leave or delete it; job done → archived, out of the workspace, `GET /jobs/:id/chat` still works, a message reopens it; Files: an upload into a feed's Files goes into its stack, the stack made once, seen only by those in the feed (an invite-only feed's stack isn't reachable by stack id), a campaign's feed and stack linked after the migration, a standalone stack gets its feed once (restart doesn't make two) |
| `tests/jobchat_ui.mjs` (Chrome, 5270) | a feed's All / Chat / Files tabs show the right items; dropping a file on Files puts it in the stack; a new job shows 💬 on its card, opening the chat beside the job; unread count on the card; a member who loses the job loses the chat at once |
Existing suites that must stay green: everything in ci.sh, chatpins, chat UI suites, stacks suites, jobs_ui,
jobs_tab_ui, member_access_ui.

## 7. Not in this piece
- Taking the Stacks page out of the sidebar (it still works and still lists every stack; the owner decides once
  everyone's used the tabs).
- Customers in a job's chat; texting the customer from it (the job's customer messages stay where they are).
- Moving or detaching a feed's stack (400, §8.6).

## 8. Review round 1 (ChatGPT, chat #10): not approved yet; the 14 changes, and what the contract now says
1. **Job feeds fail closed.** `seesFeed(ch)` with `ch.recordId`: the record exists, is in the feed's workspace, is a job
   record (`JF.isJobRecord`), and `PJ.recordAt(rec.id, ws.id, memberId)` passes; anything missing → false for everyone
   (owners and admins included, as the job itself). A job feed never carries `memberIds` or `campaignId`: made without
   them, PATCH can't add them (400), and `seesFeed` returns false if one is ever there.
2. **One link, checked both ways.** `linkFeedStack(ws, ch, st)` is the only writer of `ch.stackId`/`st.channelId`. It
   links only when both are in `ws`, neither points elsewhere (`!ch.stackId || ch.stackId === st.id`, same for
   `st.channelId`), and the audiences match: a job feed ↔ that job's stack (`st.recordId === ch.recordId`); a campaign
   feed ↔ that campaign's stack (same `campaignId`); a plain feed ↔ a stack made for it (no `recordId`, `campaignId`);
   a standalone team stack ↔ a team-wide feed made for it. Anything else is refused and left as it is (never
   overwritten), logged once; the feed's Files then shows only its own non-message items. A linked stack is seen only if
   **both** `seesFeed(its feed)` and its own rule (job, campaign) pass.
3. **Made once, whole.** One function, `JF.ensureChat(ws, rec)`, synchronous from lookup to `save()` (no `await`
   between), so two calls in the same process can't both create. Keys: one feed per `recordId`, one stack per
   `recordId` (Phase 4). It finds or makes the stack, finds or makes the feed, links them, pins the job, in that one
   turn: a feed without a stack or the reverse can't be left behind (a throw before `save()` leaves nothing written;
   the next call finishes). Kloomie runs as one process (CLAUDE.md), so there's no second server. Every path calls it;
   the team switch only decides whether the automatic call happens.
4. **Cascade.** Deleting the job (or its list or board) goes through `recordGoneAll` → `jobStackGone`, which today
   deletes the stack's items outright and purges their Trash entries (no restore into a wider place); it now does the
   same for the feed: the feed's items (messages, replies, files, folders, docs, sealed cards), the feed, its pins, the
   job's pins in other feeds (Phase 4), request links on the stack (they 404 once the stack is gone), share links on the
   items (gone with the items). One synchronous turn, so there's no half-deleted state to reach. Unread counts are
   kept by the app and drop with the feed.
5. **Losing a job loses its chat everywhere.** Every read goes through `seesFeed` (feed lists, `canSee('item')` via
   `feedOfItem`, search, export, chat pins, share-link making, the public API, `validChannel` for posting and uploads) or
   `seesStack` (stack routes, request links' owner pages). `reseeJob` already sends `resync` to anyone whose access to
   a job with a stack changed; it does so for a job with a feed too, and `record:gone` closes it in the app (§8.14).
   Gaining the job: `resync` brings the feed and its items.
6. **Standalone stacks.** Only a team-wide stack (no `recordId`, `campaignId`, `channelId`) gets a feed, and it's
   team-wide: same audience, nothing widens. A stack in an invite-only feed is never made from an existing one (a plain
   feed's stack is always new). Moving a stack to another feed or detaching it isn't in this piece: 400. Items keep
   today's rules (someone who can see a file can copy it elsewhere, as now).
7. **Migration.** Runs at startup per team while `ws.chatStacks !== 1`: for each campaign, link its feed and stack (rule
   2); for each standalone team stack with no feed, make one (`freeChannelName`, so a clash with an existing feed name
   gets `-2`). Each step checks first (a stack already linked is skipped), the whole team is done in one synchronous
   turn and saved once with the marker, so a restart part-way redoes nothing twice. One process, so no two at once.
8. **What each tab holds**, each item once per tab (deduped by id):
   - Chat: top-level items with `channelId === feed` (messages and anything dropped into the conversation).
   - Files: items with `channelId === feed` that aren't messages, plus top-level items with `stackId === feed.stackId` and
     no `channelId`.
   - All: Chat ∪ Files.
   A file dropped into the conversation shows in Chat, Files and All (once in each). Order: `createdAt`, then `id`.
   Replies stay in threads, as today.
9. **Archive is how it looks, not who sees it.** Archived job feeds and their items are left out of the app's state
   (workspace and items), and still pass the same `seesFeed` check everywhere else: item routes, Ask (the server's
   search over docs and records, `askSources` → `canSee`) and export include them for people who see the job.
   `GET /jobs/:id/chat` returns `{ feed, items }` (job visibility and the member Chat switch first). The app's own
   search looks through what it has loaded, so archived chats aren't in it (corrected at checkpoint 2: there's no
   server search route). A member who loses the job loses its archived chat as well.
10. **Archive and reopen, in order.** Archiving happens once, at the done transition (`job.flow.done`, or the stage
    reaching the last one), recorded as `ch.archived = { at, for: <that transition> }`; the sweep never archives again
    for the same transition. A message posted into it, or Reopen, clears it; it's archived again only at a new done
    transition (the run reopened and finished again). Everything runs in the one event loop, so a message that
    succeeds can't be undone by an older archive write.
11. **The two switches.**
    | Make a chat for each new job | Chat for members | What happens |
    |---|---|---|
    | on | on | feed made with the job; everyone who sees the job uses it |
    | off | on | no feed until someone who sees the job taps 💬 (`POST /jobs/:id/chat` makes it) |
    | on | off | feed made; owners and admins use it; members see 💬 marked "Chat is off for members" and every feed route answers 403 for them |
    | off | off | as above, made on demand by owners and admins only |
    `POST /jobs/:id/chat` and `GET /jobs/:id/chat` check job visibility first (404, the same answer as a job that
    doesn't exist), then the Chat switch (403).
12. **Renames.** The job renamed: the feed's slug is made again with `channelName(ws, name, ch.id)` (it may keep its own
    name), `-2`, `-3`… on a clash; the stack's name follows (40 characters). Archived feeds aren't in sidebar lists or
    counts.
13. **One place jobs are made.** projects.js gets `jobMade(rec)` (a ctx hook), called from `recordNews` for
    `record.created` and from the bulk import (1713), which is every path that makes a record today; Job Flows' handler
    checks the list is a job list and the switch, then `ensureChat`. And a safety net: the `jobSteps` sweep makes the
    feed for any job made since the switch was turned on (`createdAt >= ws.jobChatsSince`) that has none, so a future
    path that forgets the hook is caught within a sweep.
14. **In the app, losing the job while its chat is open** (Phase 5's `record:gone` / `jbGone`): the chat, its split or
    sheet close; the feed, its stack and their items leave the app's state; a drag or upload aimed at them is dropped;
    the Files tab never shows what's cached; the toast "You no longer have this job".

## 9. Review round 2 (ChatGPT, chat #10): two more
1. **Files follows Chat, on every path.** A member (not an owner or admin) in a team with Chat off for members fails
   `seesFeed` for every feed (plain, campaign, job), and fails `seesStack` for any stack linked to a feed, so the feed's
   Files can't be reached through the stack either: stack reads, uploads into it, item routes, search, request links'
   owner pages, export. Their Stacks switch doesn't matter for a linked stack. #general is unchanged (its messages are
   already filtered by the Chat switch; it has no stack). Owners and admins as before.
2. **The safety net respects the switch.** The sweep makes feeds only while Make a chat for each new job is on. Turning
   it on sets `ws.jobChatsSince = now` (each time), so jobs made while it was off don't get one afterwards (only on
   demand). Turning it off stops both the hook and the sweep; feeds already made stay.

## 10. Checkpoint 2: the tests (written first; on `jobchat` before any server change: 64 of jobchat.mjs's checks and
15 of jobchat_ui.mjs's fail, log in docs/jobflows/jobchat-checkpoint2.log)
Shapes the tests fix:
- `PATCH /workspace { jobChats }` → `workspace.jobChats` (true by default). Chat folders carry `jobs: true` / `stacks: true`.
- A job feed in `workspace.channels`: `{ id, name, folderId, recordId, stackId, pins: [{kind:'job', id}] }`; its stack
  `{ recordId, channelId }`. `jobs[].chatId` in `GET /jobs`, `chatId` on the record.
- `GET /jobs/:id/chat` → `{ feed: null }` or `{ feed, items }` (feed `archived` when it is); `POST /jobs/:id/chat` →
  `{ feed }`. `POST /channels/:id/stack` → `{ stack }` (a body naming another stack is ignored).
  `POST /channels/:id/reopen` (owners and admins).
- Found while writing them, and fixed here: `DELETE /stacks/:id` and `PATCH /stacks/:id` check only `seesCampaign`, so
  anyone who has a job's stack id can delete it today, and its files fall back into the team's Stacks (their
  `stackId` is cleared). Both now use `seesStack`, and deleting a stack that belongs to a job or a feed is refused (400,
  delete the job or the feed instead).
- In the app: `.ch-tabs [data-ft=all|chat|files]` on the feed; the tab kept in `localStorage['column.feedTab:<id>']`;
  `.jb-chat` (💬 with the unread count) on `.jb-row` and on the job page's `.jb-card`.

### 10.1 Checkpoint 2 review round 1 (ChatGPT): nine more cases, now in the tests
An automation that makes a job; Move my jobs here on a job from before; Chat off for a team feed's and a campaign's
Files (writes, request links, renames by id), `POST /jobs/:id/chat` 403 making nothing, an admin keeping them; a member
who can't see a job can't rename or delete its stack by id (its files stay); conflicting links left as they are after
the migration (a stack pointing at a feed that doesn't point back, a feed pointing at another stack, a campaign feed
pointing at another team's stack); archived items out of the owner's state too, reads following the job, a second
finish archiving again; in the app: All's order, a file dropped into Chat once in each tab, the tab kept after a
reload, the chat in the split beside the job's row, and a member losing the job mid-drag: nothing of its Files left on
the page and the drop lands nowhere in it.

### 10.2 Checkpoint 2 review round 2
Added: the automation's job checked by its record and the name it was given; Ask over an archived chat (found for
someone on the job, nothing for a member who isn't). §8.9 corrected: the app's search is over what it has loaded, so
"search" for archived chats means Ask.
