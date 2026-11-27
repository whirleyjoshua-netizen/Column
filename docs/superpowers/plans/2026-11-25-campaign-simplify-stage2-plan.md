# Campaigns, simpler — Stage 2 (Work) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Work's four views go behind one **View: List ▾** dropdown, and its six filter buttons go: the header chips (All · My tasks · Overdue · Blocked) filter Work the same way they filter Plan.

**Architecture:** One function in `client/app.js`: `workBody` inside the campaign page (around the `const wf = [...]` line), plus `ccTaskBoard`'s Done-column rule. CSS in `client/style.css`. No server changes.

**Tech Stack:** plain-JS client; browser tests over CDP (`tests/*_ui.mjs`, run on Windows via `tests/chromebin.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-25-campaign-simplify-design.md` (section "Work"; header chips under "Header").

## Global Constraints

- The dropdown: a native `<select class="cc-wview-sel" aria-label="View">` with options `list` "List", `board` "Board", `timeline` "Timeline", `calendar` "Calendar", inside `label.cc-wview` whose text is "View". The choice is kept on the device as today (`store 'ccWorkView'`, `K.wview`).
- Filtering comes only from the chips (`ccChipOf(K.wfilter)`, `ccChipPick(tasks, chip)`): All = open, then done (done rows dimmed); My tasks / Overdue / Blocked = open only. Default All. The `.cc-wf` buttons are removed.
- Board by status keeps the Done column filled with done tasks whatever the chip (as today for non-All filters), so a card dragged there stays in sight.
- Empty states: All "No tasks here yet."; My tasks "Nothing open for you here."; Overdue "Nothing is overdue."; Blocked "Nothing is blocked."
- The Pulse's buttons set the chip (`blocked`, `overdue`, `all`) and go to Work, as now.
- Other sessions push to `main`: pull/rebase before pushing; pushing deploys.

## Review Focus

1. **A view kept from before** — a device whose stored view is `board` opens Work on Board with the dropdown showing Board. (Test in Task 1.)
2. **Chip set on Plan, then Work** — My tasks picked on Plan shows only my open tasks on Work, in every view. (Test in Task 1.)
3. **All with done tasks** — done tasks appear after the open ones, dimmed, in List; in Board they're in Done. (Test in Task 1.)
4. **Phone width** — the dropdown and chips fit at 400px, nothing sideways. (Test in Task 1.)
5. **An old stored filter** (`K.wfilter` `open`/`done` from before) — treated as All, no error. (Covered by `ccChipOf`; checked in Task 1.)

---

### Task 1: Work behind a dropdown, filtered by the chips

**Files:**
- Modify: `client/app.js` (`workBody` in the campaign page; `ccTaskBoard`'s `list` line), `client/style.css` (`.cc-wview`, `.cc-wview-sel`; drop `.cc-wf` rules if unused)
- Test: `tests/cc_work_ui.mjs` (new; harness copied from `tests/cc_simple_ui.mjs` with `PORT = 4981`, `CDP = 9619`, data `dk/ccwork`, profile `dk/chrome-ccwork`)

**Interfaces:**
- Consumes: `ccChipOf`, `ccChipPick`, `CC_CHIPS` (stage 1), `ccWorkView()`, `ccTaskBoard`, `ccTimeline`, `ccCalendar`.
- Produces: `select.cc-wview-sel` (values `list|board|timeline|calendar`); no `.cc-wf`.

- [ ] **Step 1: Write the failing test** (seed: 2 phases; tasks: mine overdue "Call the Lee family", unassigned "Call the Diaz family", "Send quotes" waiting on phase 1 via `PATCH /campaigns/:id { inOrder: true }`, a done task "Print flyers"). Assertions:
  - Work has `select.cc-wview-sel` with option values `list,board,timeline,calendar` and no `.cc-wf`
  - with All: List rows (`.cc-tr:not(.cc-th) .cc-tt`) are the 3 open tasks then "Print flyers", whose row has class `done`
  - chip `mine` (picked on Plan, then tab Work): only "Call the Lee family"; switch the dropdown to `board` (`A.pick`) → the board's cards are Lee in its column and Print flyers in Done; `timeline` → only Lee's bar; back to `list`
  - chip `overdue` → only Lee; chip `blocked` → only "Send quotes"; an empty chip shows its sentence (turn `inOrder` off, Blocked → "Nothing is blocked.")
  - reload with `localStorage['column.ccWorkView'] = '"board"'` (check the key `store` uses in app.js) → Work opens on Board and the select's value is `board`
  - phone 400×860: `.cc-wview-sel` and `.cc-chips` visible, `scrollWidth <= innerWidth`
  - no script errors
- [ ] **Step 2:** Run `node tests/cc_work_ui.mjs "$TEMP/kt"`. Expected: FAIL at the select.
- [ ] **Step 3: Implement** the select and chip filtering per the Global Constraints; remove the filter buttons.
- [ ] **Step 4:** Run it. Expected: all PASS.
- [ ] **Step 5:** Commit `Campaign Work: the views in a dropdown, filtered by the chips`.

### Task 2: Existing tests follow, then ship

**Files:**
- Modify: `tests/campaign_views_ui.mjs` (`.cc-wview [data-wv=X]` clicks → `A.pick(T('.cc-wview-sel'), 'X')`; `.cc-wf [data-wf=all]` → chip `all`), `tests/cc_ui.mjs` (`data-wf=blocked` → chip `blocked`; `data-wf=open` → chip `all`, and its "Work lists the 9 open tasks" count follows All = open + done), `tests/workorder_ui.mjs` (same mappings)

- [ ] **Step 1:** Update the three tests; run each. Expected: all PASS.
- [ ] **Step 2:** Run the full campaign browser set (`.superpowers/sdd/<plan>/full.sh` from stage 1, or the same 23 tests). Expected: all PASS except the three known to fail on `main` (shell_ui ×2, e2e2 "the task is in the campaign", e2e3 "an empty doc offers templates and AI").
- [ ] **Step 3:** Commit `tests follow Work's dropdown and the chips`; `git pull --rebase`; push (the owner OK'd pushing stage by stage); tell column-bf.
