# Campaigns, simpler — Stage 3 (Progress) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activity and Report become one **Progress** tab, so the campaign has three tabs: Plan · Work · Progress (Sketch comes in stage 4).

**Architecture:** In `client/app.js`: `CC_TABS` and `ccTabOf` (old `activity`/`report` → `progress`); the campaign page's `pulse()` block becomes a compact health card plus the "What to do next" card; `ccReport(c)` keeps its sections and gains a Blocked stat; the page's `activity()` block becomes the Log and Recently done at the bottom. CSS in `client/style.css`. No server changes.

**Tech Stack:** plain-JS client; browser tests over CDP (`tests/*_ui.mjs`, Windows via `tests/chromebin.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-25-campaign-simplify-design.md` ("Progress (Report + Activity + Pulse)").

## Global Constraints

- Tabs: `[['plan','Plan'],['work','Work'],['progress','Progress']]`. `ccTabOf`: `activity`, `report`, `overview`, `resources` and anything unknown → `plan`, except `activity` and `report` → `progress`.
- Progress, top to bottom (spec order; nothing shown twice):
  1. The bar: "Worked out from the tasks as of …", **Write a report to the feed**, **🖨 Print** (as `ccReport` has it).
  2. **How it's going** (`.ccp-health`): health (On track / At risk / Off track, or Finished / Paused) with its first reason, the next milestone, and the team's avatars. The old Pulse rows for blockers, overdue, forecast and quiet go: the stats row shows them.
  3. The stats row (`.ccr-top`): % done, forecast finish, finished on time, **Blocked** (new, flagged when > 0), overdue now, gone quiet; and the forecast's why.
  4. **What to do next** (`.cc-pulse-ai`): up to 3 ideas with their buttons, and ✦ Ask Sidekick. An idea that pointed at the Report ("See the report") scrolls to the stats row instead.
  5. The report's sections as today: Progress over time, Phases, People, Gone quiet, Money, Calls and emails logged.
  6. **Log** (Log a call or email, Write a report, the log) and **Recently done** (from Activity).
- Print prints sections 2, 3 and 5 only (a `.ccp-report` wrapper), not the ideas, the log or the buttons.
- The Pulse's buttons that went to Work with a chip keep doing so.

## Review Focus

1. **Old deep links** — `K.ctab = 'activity'` / `'report'` land on Progress. (Test in Task 1.)
2. **A finished or paused campaign** — the health card says Finished / Paused; no "What to do next" ideas about check-ins. (Test in Task 1.)
3. **No tasks yet** — Progress shows the health card, stats with dashes, and the Log; no errors. (Test in Task 1.)
4. **Print** — the printed copy has no buttons, no log box, no ideas. (Test in Task 1, checking the element `ccReportPrint` receives.)
5. **Phone** — the stats wrap, nothing sideways. (Test in Task 1.)

---

### Task 1: One Progress tab

**Files:**
- Modify: `client/app.js` (`CC_TABS`, `ccTabOf`, the page's `pulse`/`activity`/`body` map, `ccReport`, `ccReportPrint`'s caller), `client/style.css` (`.ccp-health`, stats wrap)
- Test: `tests/cc_progress_ui.mjs` (new; harness from `tests/cc_work_ui.mjs` with `PORT = 4991`, `CDP = 9629`, data `dk/ccprog`, profile `dk/chrome-ccprog`)

**Interfaces:**
- Produces: `.cc-tab[data-ctab=progress]`; `.cc-body[data-tab=progress]` containing `.ccp-health`, `.ccr-top` (with a stat whose label is `Blocked`), `.cc-pulse-ai`, `.ccp-report`, the Log card (button "Log a call or email") and `.cc-hist` when something is done.

- [ ] **Step 1: Write the failing test.** Seed: 2 phases, in order on (so one task waits), an overdue task of mine, one done task, a call logged if the API allows (`POST /attempts` as other tests do; skip if not). Assertions:
  - tabs are exactly `plan,work,progress`
  - Progress shows, in this order: `.ccr-bar`, `.ccp-health`, `.ccr-top`, `.cc-pulse-ai`, then the report sections, then the Log card; checked by `compareDocumentPosition`
  - `.ccp-health` text has the health word and "Next milestone"; no `.cc-pulse-row` buttons for Blockers/Overdue/Forecast/Quiet remain
  - `.ccr-top` has a `Blocked` stat with the right count, flagged `bad`
  - "Recently done" lists the done task; "Log a call or email" opens the log box (`K.logOpen`; look for its form)
  - an idea's button: "See them" (overdue) goes to Work with the Overdue chip on
  - old links: open another campaign and back via `openCampaign` isn't reachable from the test, so instead: Work tab, then `.cc-crumb button`, reopen → Plan (stage 1 rule), and set the tab by clicking Progress, leave and come back to the same campaign → still Progress (tab sticks within a campaign)
  - Print: override `window.open` to return a stub capturing the appended node; click Print; the captured copy has no `button`, no `textarea`, no `.cc-pulse-ai`, and has `.ccr-top`
  - a campaign marked done (`PATCH /campaigns/:id { status: 'done' }`) shows "Finished" in `.ccp-health`
  - a campaign with no tasks: Progress renders `.ccp-health` and the Log, no errors
  - phone 400×860: nothing sideways
  - no script errors
- [ ] **Step 2:** Run it. Expected: FAIL at the tabs.
- [ ] **Step 3: Implement** per the Global Constraints.
- [ ] **Step 4:** Run it. Expected: all PASS.
- [ ] **Step 5:** Commit `Campaign Progress: Activity and Report in one tab, the Pulse at its top`.

### Task 2: Existing tests follow, review, ship

**Files:**
- Modify: `tests/cc_simple_ui.mjs` (tabs list; "Report has what to do next" → Progress), `tests/cc_ui.mjs` (tab names; Activity and Pulse checks → Progress), `tests/report_ui.mjs` (Report tab → Progress; `.cc-pulse-fc`/`.cc-pulse-quiet` → the `.ccr-top` stats), `tests/campaign_views_ui.mjs` and `tests/e2e3.mjs` (Activity tab → Progress), `tests/cc_work_ui.mjs` (`tabTo('activity')` → `tabTo('progress')`)

- [ ] **Step 1:** Update, run each. Expected: PASS (e2e3 keeps its known Docs failure).
- [ ] **Step 2:** Fresh reviewer on the branch; fix Critical/Important with a failing test first.
- [ ] **Step 3:** Run the full campaign browser set if memory allows; otherwise every test touched here.
- [ ] **Step 4:** Commit, `git pull --rebase`, push, tell column-bf.
