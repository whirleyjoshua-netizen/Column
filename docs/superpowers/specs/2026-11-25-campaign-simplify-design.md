# Campaigns, simpler: Plan, Work, Progress (+ Sketch)

Date: 2026-11-25 · Status: approved direction, staged build (approach A)

## Why

The owner: the campaign page is "still not easy to use for client". Small and trade businesses open a campaign and
meet 6 tabs (Overview, Plan, Work, Resources, Activity, Report), a Phases | Board switch inside Plan, 4 views and 6
filters inside Work, a Pulse pop-out, a row of numbers and a row of pills: about 20 ways to look at one campaign.
Overview and Plan's Phases view are the same three-column tree with a different left column. "I want simple for
users before anything."

The campaign tool's job stays the same: group tasks into phases with milestones and goals, with tools that help.

## Goals

- Three tabs, four when the whiteboard is on: **Plan · Work · Progress · Sketch**.
- Plan looks like the owner's mockup (`img/2026-11-25-campaign-plan-mockup.jpg`; the bigger task window they liked
  is `img/2026-11-25-campaign-task-mockup.jpg`): one card per phase with its tasks as rows, the brief down the left,
  a short task editor on the right. The mockups are AI drawings: copy their layout, not their typos or sample data.
- Keep the tree (phase → tasks → subtasks), phases' order, waits-for, roles, Add tool, Add automation, work orders,
  test runs, saved flows, sub-campaigns, targets, money: nothing a campaign can do today goes away; it moves.
- Each stage ships on its own and leaves the app working (every push to `main` deploys).

## Non-goals

- The platform-wide audit (Tasks, Contacts, Boards, Docs, Automations, Agents…). A separate project, after this one.
- Server or data changes beyond what Sketch's new template needs. Phases are still goals, tasks still tasks.
- Changing the bigger task window (`taskWindow`) used outside campaigns.

## Anti-goals (a failure even if it works)

- A new tab, switch or panel that brings the count back up.
- Plan and Sketch showing the same thing two ways.
- A team with the whiteboard off, or a phone, seeing an empty or broken tab.
- Losing a feature people use without a place to find it.

## The design

### Header (all tabs)
Name, TEST pill, health, dates, owner, `🧪 Test run`, `+ Add`, `⋯`. Under it one line: `N% complete` and the chips
**All · My tasks · Overdue · Blocked** (as in the mockup). The chips filter the tasks shown on Plan and Work (shared
state, the old `K.wfilter`). *Builder's-call answers, settled in review:* **All** = open + done, everywhere (done
rows dimmed, at the bottom of their phase or list); **My tasks / Overdue / Blocked** = open tasks only. Default is
All. No separate "Show done". On Plan, a phase's count and bar always count the whole phase, not the filtered rows;
a phase with no matching rows stays as its header with "No matching tasks". The KPI row, the Pulse button and the Pulse pop-out are
removed. Job pill, series links, In order and Private stay as small pills. `✎ Edit campaign` moves into `⋯`.

Tabs: `Plan` (default) · `Work` · `Progress` · `Sketch` (only when `toolOn('whiteboard')` and the screen is wide
enough for the board; otherwise the tab is not drawn at all, and `K.ctab === 'sketch'` falls back to Plan).

Old `K.ctab` values map: `overview` → `plan`, `resources` → `plan`, `activity` → `progress`, `report` → `progress`.
Anything that opened those (deep links, Pulse rows, `+ Add → A task`, `D.board`, agents' Open links) goes to the new
home. Plan's old board view (`K.planView === 'board'`) → `sketch`.

### Plan (Overview + Plan's Phases view, merged)
Three columns on a computer, stacked on a phone (brief first, then phases, the editor as a sheet).

- **Left:** Objective, Audience, Strategy (edited in place, as now), Success metrics (targets with numbers, `+ Add a
  target`). Under them a short **Where things are** list: the links the Resources tab had (chat channel, Files ▾,
  Notes ▾, Map, Signatures, Vault), "What each phase hands its people" only as a count/link into each phase's
  resources, and Lists & docs as a link that opens them (a sheet or the existing list cards; builder's call).
- **Middle:** one card per phase, in order: collapse arrow, title, `Phase n (x/y tasks done)` and a thin bar, ⋯ (the
  phase's whole window, as now). Rows: checkbox, task name (+ WO chip, ⚡/🧰 marks, TEST), assignee pill, due pill
  (red when late), status pill (`ccStatus`). Subtasks show as an indented count or rows under their task (builder's
  call, keep it quiet). `+ Add task to Phase n…` (inline typing, Enter adds), and `+ From saved` which opens the saved
  flows / tasks / automations picker that Plan's left column has today (click puts them into that phase; drag from it
  onto a phase still works if cheap to keep). `+ Add Phase` at the bottom. Tick a checkbox = done, same rules as now
  (in order, work orders, sign-off).
- **Right:** nothing picked → **At a glance** (progress, phase now, targets, money, sub-campaigns, team and roles: the
  current `ovIdle`). A task picked → **Task details** like the mockup: title, assignee, due, status, subtasks
  (tick/add/remove), notes (the task's description), attachments drop area, and at the bottom `Add tool`,
  `Add automation` (owners/admins as now), `Delete task`, and `Open full` (the existing `taskWindow`). A phase picked
  → its name, due, what it waits for, its resources, and Add task (today's phase panel).

### Work
The four views behind one dropdown: **View: List ▾** (List, Board, Timeline, Calendar), remembered on the device
(`store 'ccWorkView'`, as now). The six filter buttons go; the header chips filter, with the same meaning as on Plan.

### Progress (Report + Activity + Pulse)
Top to bottom: health and the forecast finish; **What to do next** (the Pulse's ideas with their buttons, up to 3,
and Ask Sidekick); blockers, overdue, quiet; burn-up chart, per-person numbers, phases against their due days, money
and calls (today's `ccReport`, Print kept); the Log (Log a call or email, Write a report) and Recently done.

### Sketch (the whiteboard)
For drawing a campaign out in different flows. It belongs to the campaign (the existing campaign board,
`/boards?campaign=`).

- **A draft you turn into the plan (owner's decision).** Sketch is not kept in sync with Plan. The board is a
  scratchpad; nothing on it becomes real until the user presses **Update plan**. Changes made on Plan later do not
  redraw the sketch; `card` items for tasks still show live status, as the board already does. No data change: boxes
  are not linked to goals.
- No board yet: the start choices, with a new default **Phases & tasks** first: a labelled `shape` (not a frame, so
  today's Make phases logic reads it) per existing phase in order, left to right, arrows following waits-for, and the
  phase's tasks as `card` items under its shape. With no phases yet it draws three empty shapes ("Phase 1", "Phase 2",
  "Phase 3") joined by arrows. Workflow map, Brainstorm, Mind map, Blank stay.
- **Update plan** replaces Make phases as the main button: shapes (selected, or all with words in them) become phases
  in flow order, skipping any whose name matches an existing phase in this campaign (trimmed, case-insensitive), and
  arrows become waits-for, as now. Stickies placed under or inside a phase's shape become tasks in that phase,
  skipping names already there; stickies elsewhere are left alone. It then says what it added ("Added 2 phases and 5
  tasks") and offers View as plan. `Make tasks in…` stays for selected stickies.
- Toolbar: `Update plan`, `Make tasks in…`, `⤢ Full page`, and **View as plan →** (goes to Plan).
- **Start from a sketch:** in New campaign, an option that makes a draft campaign (name only, status as a normal new
  campaign) and opens it on Sketch with Phases & tasks seeded empty. Only offered when the whiteboard is on and the
  screen is wide. Opened later on a phone, the draft is simply a campaign on Plan with `+ Add Phase` (and a one-line
  note that its sketch opens on a computer, if it has a board).

## Stages (each its own push, tests first)

1. **Plan** — merge Overview and Plan's Phases view into the new Plan; header chips; remove KPI row and Pulse button
   (their content stays reachable: Pulse's ideas go to Progress in stage 3, so in stage 1 keep the Report tab and add
   the ideas to the top of it); Resources' links under the brief; tab mapping for `overview`/`resources`. The
   whiteboard stays reachable until stage 4 as a small `🗺️ Sketch` button in the Plan toolbar (only when the
   whiteboard is on) that shows today's `ccBoardView`, so campaign_board_ui keeps passing; stage 4 turns it into the tab.
2. **Work** — the view dropdown; filters from the chips.
3. **Progress** — Report + Activity + Pulse in one tab; tab mapping for `activity`/`report`.
4. **Sketch** — own tab, Phases & tasks template (server `whiteboard.js` TEMPLATES + seed, which needs the
   campaign's phases and tasks), View as plan, Start from a sketch; tab hidden when off or narrow.

## Constraints

- `client/app.js` is plain JS (~26k lines); campaign page is `campCommandCenter` area around lines 7780–7960,
  `ccPlanner` ~8170, `ccBoardView` ~7479. Server whiteboard templates: `server/whiteboard.js`.
- docs/CODING-GUIDE.md applies (text into pages as text; one rule on every path: ticking done from a row must go
  through the same rules as the task window).
- Tests that touch the campaign page and must follow each stage: cc_ui, cc_plan_ui, campaign_views_ui,
  campaign_board_ui, report_ui, plan_autos_ui, plan_tools_ui, workorder_ui, contactsui, e2e3, e2e7, skdock_ui. Write
  the new expectation first and see it fail on the old code.
- Other Claude sessions push to this repo: stage only these changes, pull before pushing.

## Approaches considered

- **A. Staged, four pushes (picked).** Each stage usable on its own; small, easy to roll back; tests move a few at a
  time. Most parts exist already, so stages mostly rearrange.
- B. All at once. Faster overall, but one large push to live and ~12 tests rewritten together; harder to see what
  broke.
- C. New page beside the old behind a setting. Safest for customers, but two campaign pages in one 26k-line file for a
  while; too much for a team this size.

## Decided by the owner

- Plan = the mockup's look, keeping the tree. Overview goes (merged into Plan).
- The whiteboard is for sketching a campaign in flows, tied to the campaign or turned into one; a way to view it in
  campaign mode. When the whiteboard is off, no tab for it.
- Work's views in a dropdown.
- Progress = Report + Activity + Pulse. Resources folds under the brief.
- Staged build, approach A. Platform audit afterwards.
- Sketch is a draft turned into the plan with Update plan (no live sync), Claude's pick, accepted by the owner.

## Left to the builder

Exact styling (follow the mockup and existing `cc-` styles), how subtasks show in rows, how Lists & docs opens from
the left column, how "Done" shows in Work, whether drag from `+ From saved` survives, the "wide enough" breakpoint
for Sketch, and where the Phases & tasks seed runs (server preferred, so it is one path).
