# Campaigns, simpler — Stage 1 (Plan) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the campaign's Overview and Plan into one Plan tab that looks like the owner's mockup, with a simpler header (chips instead of the KPI row and Pulse), and Resources folded under the brief.

**Architecture:** All UI lives in `client/app.js` (plain JS, `h()` builds elements) and `client/style.css`. The campaign page is built in the function around `client/app.js:7780-7965` (tabs, header, `body` map); the three-column planner is `ccPlanner` (`client/app.js:8170`). Stage 1 rewrites the header and replaces `ccPlanner`'s middle column with phase cards and its right panel with Task details. No server changes.

**Tech Stack:** Node 24 server (`server/index.js`), plain-JS client, browser tests driving headless Chrome over CDP (`tests/*_ui.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-25-campaign-simplify-design.md` (mockups in `docs/superpowers/specs/img/`).

## Global Constraints

- Tabs after this stage: **Plan · Work · Activity · Report** (Progress and Sketch come in stages 3 and 4).
- `K.ctab` mapping: `overview` → `plan`, `resources` → `plan`; unknown → `plan`. Default tab is `plan`.
- Chips: **All · My tasks · Overdue · Blocked**, state in `K.wfilter` with values `all | mine | overdue | blocked`. All = open + done (done dimmed, at the bottom); the other three = open tasks only. Default `all`.
- A phase's count and bar always count the whole phase. A phase with no rows matching the chip shows its header and "No matching tasks".
- Ticking a row's checkbox goes through `ccTaskSet(t, { done: true })` (the same path as the panel), so in-order, work-order and sign-off rules hold (docs/CODING-GUIDE.md: one rule on every path).
- Text from users goes into the page as text (`h()` children, never `html:` with user text; `linkify` is the existing exception for brief fields).
- The whiteboard stays reachable: a `🗺️ Sketch` button in the Plan toolbar, only when `toolOn('whiteboard')`, toggling `K.planView = 'board'` to show today's `ccBoardView`.
- Removed from the header: the KPI row (`.cc-kpis`), the Pulse button and pop-out (`.cc-pulse-btn`, `.cc-pulse`), the Overview and Resources tabs. `✎ Edit campaign` moves into `campaignMenu` (`client/app.js:10103`).
- The Pulse's "What to do next" ideas (the `ideas` array) and its rows (health, next milestone, blockers, overdue, forecast, quiet) render at the top of the Report tab.
- Copy the mockups' layout, not their sample text or typos.
- Other sessions push to `main`: stage only this plan's files; `git pull --rebase` before pushing; pushing deploys.
- Local Node is v22.18 (server targets 24): if anything fails on a v24-only API, stop and say so.

## Review Focus

1. **A campaign with no phases** — Plan shows the brief, an empty middle with `+ Add Phase` and `✨ Suggest from the brief`, and At a glance on the right; no errors. (Test in Task 3.)
2. **A task in a phase that is waiting (in order / waits-for)** — its checkbox is disabled with the "waits for" title, as the panel's status buttons are today. (Test in Task 3.)
3. **Subtasks** — a task with subtasks shows `n/m` beside its name, subtasks don't appear as their own rows, and a subtask picked in the panel opens in the panel. (Test in Task 3.)
4. **Old deep links** — `K.ctab = 'overview'` or `'resources'` (set by `openCampaign`, `D.board`, agents' Open links) lands on Plan without a blank page. (Test in Task 2.)
5. **Phone width (420px)** — columns stack: brief, then phases, and a picked task's details show below/over the phases with a working ✕. (Test in Task 3.)

---

### Task 1: Browser tests run on Windows

The owner's machine is Windows; browser tests hard-code the Mac Chrome path and use `new URL(..).pathname` for the server folder (gives `/C:/…` on Windows).

**Files:**
- Create: `tests/chromebin.mjs`
- Modify: `tests/cc_plan_ui.mjs`, `tests/cc_ui.mjs`, `tests/campaign_views_ui.mjs`, `tests/campaign_board_ui.mjs`, `tests/report_ui.mjs`, `tests/plan_autos_ui.mjs`, `tests/plan_tools_ui.mjs`, `tests/workorder_ui.mjs` (only the Chrome spawn line and the server `cwd`)

**Interfaces:**
- Produces: `export const CHROME: string` (`process.env.CHROME`, else `C:/Program Files/Google/Chrome/Application/chrome.exe` on win32, else the Mac path); `export const SERVER_DIR: string` (`fileURLToPath(new URL('../server', import.meta.url))`).

- [ ] **Step 1:** Run `node tests/cc_plan_ui.mjs "$TEMP/kt"` and confirm it fails to start Chrome (ENOENT) on Windows.
- [ ] **Step 2:** Write `tests/chromebin.mjs` with the two exports.
- [ ] **Step 3:** In each listed test, import them and use `CHROME` in `spawn(...)` and `cwd: SERVER_DIR`. Leave `pkill` as is (already in try/catch).
- [ ] **Step 4:** Run `node tests/cc_plan_ui.mjs "$TEMP/kt"`. Expected: it runs and ends with its usual summary (all PASS on the current code).
- [ ] **Step 5:** Run the other seven the same way and note the baseline (all PASS expected). If one fails on the unchanged code, record it in the commit message as pre-existing; don't fix it here.
- [ ] **Step 6:** Commit `tests: browser tests find Chrome and the server folder on Windows`.

### Task 2: Header, tabs and chips

**Files:**
- Modify: `client/app.js:6881` (`K.ctab = 'overview'` → `'plan'`), `client/app.js:7780-7965` (tab list, `setTabC`, header, `body`), `client/app.js:10103` (`campaignMenu`: add `✎ Edit campaign` → `campaignSheet(c)`), `client/style.css` (`.cc-chips`, remove dead `.cc-kpis`/`.cc-pulse-btn` rules only if nothing else uses them)
- Test: `tests/cc_simple_ui.mjs` (new, copy the harness of `tests/cc_plan_ui.mjs`: own `PORT = 4961`, `CDP = 9599`, data folder `dk/ccsimple`, Chrome profile `dk/chrome-ccsimple`)

**Interfaces:**
- Produces: `const CC_TABS = [['plan','Plan'],['work','Work'],['activity','Activity'],['report','Report']]`; `ccTabOf(k: string): string` (maps old/unknown values to `'plan'`); `ccChipPick(tasks: Task[], k: 'all'|'mine'|'overdue'|'blocked'): Task[]` (All = open then done; others open only, using `taskMine`, `isOverdue`, `taskBlockers`). Header chips are buttons `.cc-chip[data-chip=<k>]` inside `.cc-chips`, with the `N% complete` text first.

- [ ] **Step 1: Write the failing test** in `tests/cc_simple_ui.mjs`, seeding the same campaign as `cc_plan_ui.mjs` (3 phases, an overdue task of mine, a subtask, a done task added with `PATCH /tasks/:id {done:true}`). Assertions:
  - `[...document.querySelectorAll('#camps .cc-tab')].map(b => b.dataset.ctab)` equals `['plan','work','activity','report']`
  - the open campaign's `.cc-body` has `data-tab === 'plan'`
  - no `#camps .cc-kpis`, no `#camps .cc-pulse-btn`
  - `.cc-chips` text starts with a `%` figure and `complete`; chips `all`, `mine`, `overdue`, `blocked` exist; `all` is `.on`
  - setting `K` isn't reachable from the test, so for Review Focus 4: open the campaign, click `.cc-tab[data-ctab=work]`, then call `openCampaign` again through the list (`.cc-crumb button` then `.camp-card`) and assert `data-tab === 'plan'`; also assert `campaignMenu` has an item with text `Edit campaign` (tap `[aria-label="Campaign options"]`, look in `.menu`)
  - the Report tab's body contains `What to do next`
  - no page errors (`A.errors.length === 0`)
- [ ] **Step 2:** Run `node tests/cc_simple_ui.mjs "$TEMP/kt"`. Expected: FAIL on the tab list, KPI row and chips.
- [ ] **Step 3: Implement** `CC_TABS`, `ccTabOf`, `ccChipPick`; replace the `.cc-kpis` block and `pulseBtn` in the header with `.cc-chips`; drop `pulse` from the page wrapper and `K.pulse` handling; move `✎ Edit campaign` from the tab row to `campaignMenu`; `report: () => [ccPulseBlock(c, …), ccReport(c)]` where `ccPulseBlock` is the old Pulse aside's content (health, rows, ideas, Ask Sidekick) as a `section.cc-card.cc-pulse-in`. Pulse rows that called `setTabC('work')` with a filter keep doing so with the new chip values (`blocked`, `overdue`); "Assign them" uses `all`. Keep `K.wfilter` values `open`/`done` working on Work until stage 2 by treating the chip value as Work's filter when it is one of the four, else Work's own default.
- [ ] **Step 4:** Run the new test. Expected: PASS. Run `cc_ui`, `report_ui`; failures are only the removed KPI row / Pulse / tabs (fixed in Task 4).
- [ ] **Step 5:** Commit `Campaign: Plan, Work, Activity, Report tabs; chips instead of the numbers and the Pulse`.

### Task 3: Plan in the mockup's look

**Files:**
- Modify: `client/app.js` — in the campaign page `body` map, `plan` becomes the merged view; delete the `overview` entry and the `resources` function after moving its links; `ccPlanner(c, phases, ov)` becomes `ccPlanner(c, phases, { left, idle })` with one selection key `psel` (drop `osel`); its middle column becomes phase cards; its right panel becomes Task details. Remove `planSwitch`; add the Sketch button.
- Modify: `client/style.css` — `.cc-phase`, `.cc-phase-h`, `.cc-row`, `.cc-row-check`, `.cc-row-who`, `.cc-row-due`, `.cc-row-status`, `.cc-phase-add`, `.cc-where`, `.cc-td` (Task details), phone stacking under `@media (max-width: 760px)`.
- Test: `tests/cc_simple_ui.mjs` (extend)

**Interfaces:**
- Consumes: `ccChipPick`, `K.wfilter` (Task 2); existing `ccTaskSet`, `ccStatus`, `tasksInOrder`, `subtasksOf`, `goalProgress`, `goalBlockers`, `taskBlockers`, `stepWindow`, `goalSheet`, `suggestPlan`, `attachToTask`, `taskFiles`, `taskWindow`, `ccToolPanel`, `ccAutoPanel`, `loadPresets`/`SV.list`, `copyAutoTo`, `sopGuide`, `castStrip`, `goalCard`.
- Produces: `ccPhaseCard(c, g, i, sel, rows: Task[]): HTMLElement` (`.cc-phase[data-phase=<id>]`); `ccRow(t, sel): HTMLElement` (`.cc-row[data-task=<id>]` with `.cc-row-check` checkbox, name, `.cc-row-who`, `.cc-row-due`, `.cc-row-status`); `ccSavedMenu(anchor, c, g)` (the old left column's saved flows / tasks / autos as an `openMenu` list, same `into()` behaviour); `ccWhere(c): HTMLElement` (`.cc-where`, the Resources links).

Layout, from the spec:
- **Left** (`aside.cc-plib.cc-obrief`): Objective, Audience, Strategy, Success metrics (today's `ovBrief`), then `ccWhere(c)`: chat channel, Files ▾, Notes ▾, Map, Signatures, Vault (the buttons from the old `resources()`), "Lists & docs · n" opening a sheet with the existing `listCard`s, and "Phase resources · n" when any phase has resources (a menu of phases → `stepWindow`).
- **Middle:** a toolbar row (`+ Add Phase`, `✨ Suggest from the brief`, and `🗺️ Sketch` when `toolOn('whiteboard')`), then one `ccPhaseCard` per phase: collapse arrow (remembered in `K.closed` as `goalCard` does), title, `Phase n (x/y tasks done)` and a thin `bar()`, ⚡ count when automations exist, ⋯ → `stepWindow`. Rows: root tasks of the phase filtered by `ccChipPick`; subtasks shown as `n/m` on the parent row. Footer: inline `input.cc-phase-add` ("+ Add task to Phase n…", Enter posts `/tasks` with `parseTask` like `goalCard`) and `+ From saved` → `ccSavedMenu`. Clicking a phase header picks the phase; clicking a row picks the task. Drag from the saved menu is not kept.
- **Right:** nothing picked → At a glance (today's `ovIdle`); task picked → Task details (`aside.cc-ppanel.cc-td`): header with the phase name and ✕; Title; Assignee + Due side by side; Status (the existing three-button seg); waits-for line; Subtasks (tick/add as today); **Notes** = `textarea` bound to `t.description` (save on blur via `ccTaskSet(t, { description })`); **Attachments** = a drop area calling `attachToTask(t, files)` plus the list from `taskFiles(t)`; footer `🧰 Add tool`, `⚡ Add automation` (admins), `Open full` (`taskWindow(t)`), and `Delete task` (same call and clean-up as `client/app.js:8651`, after a `confirm`-free two-tap: first tap turns the button into "Tap again to delete" for 3 s — no browser dialogs). Phase picked → today's Add task panel.

- [ ] **Step 1: Write the failing tests** (append to `tests/cc_simple_ui.mjs`), on the Plan tab at 1500×950:
  - three `.cc-phase` in order with titles `Call past customers`, `Book installs`, `Install`; the first's header text includes `Phase 1` and `(0/2` (Lee, Diaz; the subtask isn't counted)
  - the row for "Call the Lee family" shows `0/1` (its subtask), and there is no row for "Ask about the patio"
  - the Lee row's `.cc-row-due` has class `late`; `.cc-row-status` text is `Overdue`
  - `.cc-obrief` contains `Objective` and `Book installs` (the brief), and `.cc-where` exists
  - With nothing picked the right column contains `At a glance`; tap the Lee row → `.cc-td` with an input whose value is `Call the Lee family`, a `textarea` for notes, an attachments drop area, buttons `Add tool`, `Open full`, `Delete task`
  - type `Bring brochure` in the notes, blur → `GET /tasks` (via `api`) shows that description on the Lee task
  - tick the Diaz row's checkbox → the API shows it done; the first phase header now includes `(1/2`
  - chip `mine` → only the Lee row in phase 1; phase 2 shows `No matching tasks`; its header still includes `(0/1`; chip `all` restores
  - type `Measure the yard` + Enter in phase 3's `.cc-phase-add` → a row with that text appears in phase 3
  - `+ From saved` in phase 2 → a menu containing `Install day` and `Order samples`; pick `Order samples` → a row appears in phase 2
  - Delete task on "Measure the yard": first tap shows `Tap again`, second removes the row
  - Review Focus 1: create a second campaign with no phases via API, open it → `+ Add Phase` visible, `At a glance` visible, no errors
  - Review Focus 2: `PATCH /campaigns/:id { inOrder: true }` on the first campaign → phase 2's "Send quotes" checkbox is `disabled`
  - Review Focus 5: set the viewport to 420×860 (`Emulation.setDeviceMetricsOverride`, `mobile: true`) → `.cc-obrief` is above the first `.cc-phase` (`getBoundingClientRect().top` smaller); tap a row → `.cc-td` visible; its ✕ closes it
  - With the whiteboard on (set it up the way `tests/campaign_board_ui.mjs` does before it uses the board), `🗺️ Sketch` shows `.cc-board-empty` (no board yet) and tapping it again returns to the phase cards
  - `A.errors.length === 0`
- [ ] **Step 2:** Run it. Expected: FAIL from the first phase-card assertion.
- [ ] **Step 3: Implement** the left, middle and right as above.
- [ ] **Step 4:** Run `node tests/cc_simple_ui.mjs "$TEMP/kt"`. Expected: all PASS.
- [ ] **Step 5:** Look at it: start the server (`cd server && SKIP_SETUP=1 PORT=4790 DATA_DIR=$TEMP/kdev node index.js`), open a campaign at desktop and phone widths, compare with `docs/superpowers/specs/img/2026-11-25-campaign-plan-mockup.jpg`. Fix spacing/visual gaps in `style.css`.
- [ ] **Step 6:** Commit `Campaign Plan in the owner's mockup: phase cards with task rows, brief and links on the left, Task details on the right`.

### Task 4: Existing tests follow the new page

**Files:**
- Modify: `tests/cc_ui.mjs`, `tests/cc_plan_ui.mjs`, `tests/campaign_views_ui.mjs`, `tests/campaign_board_ui.mjs`, `tests/report_ui.mjs`, `tests/plan_autos_ui.mjs`, `tests/plan_tools_ui.mjs`, `tests/workorder_ui.mjs`, `tests/contactsui.mjs`, `tests/e2e3.mjs`, `tests/e2e7.mjs`, `tests/skdock_ui.mjs`
- Modify (only if a test shows a real gap): `client/app.js`

**Interfaces:**
- Consumes: selectors from Tasks 2-3 (`.cc-tab[data-ctab=…]` with the four tabs, `.cc-chip[data-chip=…]`, `.cc-phase`, `.cc-row`, `.cc-td`, `.cc-where`, the Sketch button, `campaignMenu`'s Edit campaign).

Rules for each change: replace `data-ctab=overview`/`resources` with `plan` (Resources' buttons are in `.cc-where`); replace `.cc-kpis`/`.cc-kpi.*` with the chips; Pulse checks move to the Report tab's `.cc-pulse-in`; `.cc-ptile`/`.cc-pt-*` tree selectors become `.cc-phase`/`.cc-row`; the left "Saved flows" column becomes `+ From saved`; `.cc-planswitch [data-pv=board]` becomes the Sketch button; `.cc-edit` becomes the menu item. Keep each test's intent; don't delete an assertion without a replacement unless the feature itself was removed by the spec (KPI row, Pulse pop-out, Overview tab, the saved column, drag from it). In `cc_plan_ui.mjs`, the drag-from-saved assertions are removed (spec: drag not kept); keep click-to-add via `+ From saved`.

- [ ] **Step 1:** Run each listed test; list the failures.
- [ ] **Step 2:** Update the tests per the rules above, one file at a time, rerunning each until it passes. If a failure is a real regression (a feature the spec keeps is missing), fix `client/app.js` and note it in the commit.
- [ ] **Step 3:** Run `bash tests/ci.sh "$TEMP/kci"`. Expected: `All passed.` (it has no browser tests; this guards server-side nothing-broke).
- [ ] **Step 4:** Commit `tests follow the simpler campaign page`.

### Task 5: Ship stage 1

- [ ] **Step 1:** `git pull --rebase` and rerun `tests/cc_simple_ui.mjs` and `tests/cc_ui.mjs`.
- [ ] **Step 2:** Ask the owner before pushing (a push deploys to app.kloomie.com). On a yes, `git push`.
