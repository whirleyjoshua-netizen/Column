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
  with 2,000 jobs doesn't send 2,000 feeds on every change); `GET /jobs/:id/chat` returns it. A new message in it, or an
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
- Per-reader archived-feed item loading (archived feeds' items still come with the app's state, as all items do today).
