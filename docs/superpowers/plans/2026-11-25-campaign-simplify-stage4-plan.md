# Campaigns, simpler — Stage 4 (Sketch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The campaign's whiteboard becomes its own **Sketch** tab (only when the whiteboard is on and the screen is wide), with a **Phases & tasks** start drawn from the campaign, an **Update plan** button that turns the sketch into phases and tasks without doubling anything, **View as plan →**, and "Start from a sketch" when a campaign is made.

**Architecture:** Server: a `phases` template in `server/whiteboard.js` (`TEMPLATES`, `seed`), drawn from the campaign's phases (`db.goals`) and top-level tasks (`db.tasks`). Client (`client/app.js`): tabs become `ccTabs()` (Sketch added when `ccSketchOn()`), `ccTabOf` maps `sketch` to `plan` when it's off; `ccBoardView` gets the new start and toolbar; a new `ccUpdatePlan(c, btn)` replaces Make phases as the main button; the Plan's 🗺️ Sketch button and `K.planView` go; the campaign builder's board option opens the new campaign on Sketch with the Phases & tasks start.

**Tech Stack:** Node server module; plain-JS client; tests: `tests/whiteboard.mjs` (server, in `ci.sh`), browser tests over CDP.

**Spec:** `docs/superpowers/specs/2026-11-25-campaign-simplify-design.md` ("Sketch (the whiteboard)").

## Global Constraints

- Sketch is a **draft turned into the plan** (owner's decision): no live sync; nothing on the board becomes real until **Update plan**. No data change: boards stay as they are.
- `ccSketchOn()` = `toolOn('whiteboard') && document.body.classList.contains('wide')`. When off, there is no Sketch tab and `K.ctab = 'sketch'` lands on Plan.
- **Phases & tasks** template (server, campaign boards only; on a board with no campaign it is Blank): each phase (`kind` not `count`/`money`, in `order` then `createdAt`) as a live `card` `{ kind: 'goal' }` in a row (x = i·300, y = 0, 240×90); its top-level tasks (no `parentId`, in `order` then `createdAt`, at most 12) as `card` `{ kind: 'task' }` below it (y = 130 + j·100, 240×80); an arrow for each phase's `blockedBy` from the phase it waits for. With no phases: three `shape` rects "Phase 1", "Phase 2", "Phase 3" joined by arrows, and a `text` item to the left (x = −320) saying "Name each phase in its box. Put a sticky under a phase for each task, then Update plan." It is listed first and is the main button in the start choices.
- **Update plan** (client), on the whole board (or the selection when something is selected):
  - Phases: existing phase cards on the board, plus `shape`s with words (no `ref`). A shape whose words match an existing phase of this campaign (trimmed, case-insensitive) is that phase (not made again); the rest become new phases, in flow order (`ccFlowOrder`).
  - Arrows between any two of those (existing or new) become "waits for" on the second, added only if missing.
  - Stickies with words (no `ref`) go to the phase whose box's horizontal span holds the sticky's centre and that sits above it (nearest above); a sticky under no phase is left alone. A sticky whose words match a task already in that phase is skipped.
  - Shapes turned into (or matched to) phases become live phase cards; stickies turned into tasks become live task cards (`ccToCards`).
  - It says what it did: "Added 2 phases and 5 tasks" (+ "· 1 already there" when it skipped some), or "Nothing new to add" when it found nothing.
- Sketch toolbar: **Update plan** (primary), **Make tasks in…** (as now), **⤢ Full page**, **View as plan →** (`K.ctab = 'plan'`).
- The Plan's 🗺️ Sketch button and `K.planView` are removed. The builder's option reads "Start from a sketch: open it on Sketch with its phases drawn out" and is shown only when `ccSketchOn()`; ticking it opens the new campaign on Sketch with a Phases & tasks board already made.
- Other sessions push to `main`: pull/rebase before pushing; pushing deploys (server change: watch `ci.sh` on GitHub).

## Review Focus

1. **Update plan twice** — the second run adds nothing ("Nothing new to add"), no duplicates. (Task 2.)
2. **A shape named like an existing phase** — matched, not doubled; its arrows still make "waits for". (Task 2.)
3. **A sticky between two phases or above all of them** — left alone, not guessed. (Task 2.)
4. **Narrow screen / whiteboard off** — no Sketch tab; a stored `sketch` tab lands on Plan. (Task 2.)
5. **A campaign someone can't edit / a member** — Update plan's API calls fail with the server's message (toast), the board isn't changed. (Covered by the existing server rules; noted, not tested.)

---

### Task 1: The Phases & tasks template (server)

**Files:** Modify `server/whiteboard.js` (`TEMPLATES`, `seed`); Test `tests/whiteboard.mjs` (add a section; fix its server `cwd` for Windows with `fileURLToPath` if it uses `.pathname`).

- [ ] **Step 1: Failing test:** a campaign with phases A, B (B waits for A), tasks a1, a2 in A (and a subtask under a1), b1 in B; `POST /boards { campaignId, template: 'phases' }` → 2 goal cards (A at x 0, B at x 300), 3 task cards (no subtask), 1 link from A's card to B's. A campaign with no phases → 3 shapes "Phase 1/2/3", 2 links, 1 text. A board without a campaign and `template: 'phases'` → no items.
- [ ] **Step 2:** Run `node tests/whiteboard.mjs "$TEMP/kt"`. Expected: FAIL on the new checks.
- [ ] **Step 3:** Implement `seed(b, 'phases', by)` per the constraints.
- [ ] **Step 4:** Run it. Expected: all PASS.
- [ ] **Step 5:** Commit `Whiteboard: a Phases & tasks start, drawn from the campaign`.

### Task 2: Sketch tab, Update plan, Start from a sketch (client)

**Files:** Modify `client/app.js`, `client/style.css`; Test `tests/cc_sketch_ui.mjs` (new; harness from `tests/cc_progress_ui.mjs`, `PORT = 5001`, `CDP = 9639`, `dk/ccsketch`, `dk/chrome-ccsketch`); update `tests/campaign_board_ui.mjs`, `tests/cc_simple_ui.mjs` (its Sketch-button checks), `tests/cc_progress_ui.mjs` / `tests/cc_ui.mjs` / `tests/cc_simple_ui.mjs` tab lists (`plan,work,progress,sketch` on a wide screen).

- [ ] **Step 1: Failing test** (`cc_sketch_ui`): tabs `plan,work,progress,sketch` at 1500 wide; Sketch with no board shows the starts with "Phases & tasks" first and primary; it draws the campaign's phases as cards; via `POST /boards/:id/ops` add a shape "Install" right of the last phase card with an arrow from it, a shape named like an existing phase (different case), two stickies under "Install", one sticky under an existing phase whose text matches a task there, one sticky far above everything; tap Update plan → API: phase "Install" exists once, waits for the phase its arrow came from; the two stickies are tasks in Install; nothing doubled; the far sticky is still a sticky; the toast says "Added 1 phase and 2 tasks · 1 already there"; tap again → "Nothing new to add"; View as plan → Plan shows Install with its 2 tasks; at 1000 wide (narrow) there's no Sketch tab and the stored `sketch` tab shows Plan; Start from a sketch: open the builder (`+ New campaign` path used by `camp_builder_ui`), name it, tick the option, make it → lands on Sketch with a board of 3 "Phase n" shapes; no script errors.
- [ ] **Step 2:** Run it. Expected: FAIL at the tabs.
- [ ] **Step 3:** Implement per the constraints.
- [ ] **Step 4:** Run it; update and run the other listed tests. Expected: PASS.
- [ ] **Step 5:** Commit `Campaign Sketch: its own tab, a Phases & tasks start, Update plan, Start from a sketch`.

### Task 3: Review and ship

- [ ] Fresh reviewer on the branch; fix Critical/Important with a failing test first.
- [ ] Run every test touched, plus `camp_builder_ui`, `whiteboard_ui` if it exists, and the campaign set if memory allows.
- [ ] Commit, `git pull --rebase`, push, tell column-bf.
