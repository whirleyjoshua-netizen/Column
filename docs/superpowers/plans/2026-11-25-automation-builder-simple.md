# Simpler Automation Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Small colored nodes, a searchable colored picker, Settings/Advanced tabs, in the full builder and in the task/phase "⚡ Add automation" panel.

**Architecture:** Client only. `client/app.js` (autoSheet ~5942, automationsTool ~5869, ccAutoPanel ~8013, stepAutoPanel ~8509) and `client/style.css` (auto-builder block ~1877, cc-pauto ~4860). The field-building code in autoSheet's `action()` is kept and split into two arrays, `f` (Settings) and `adv` (Advanced); it is only rendered into the side panel for the selected node.

**Tech Stack:** Plain JS (`h()` helper), CSS; tests are headless-Chrome .mjs files over CDP (Mac paths; run locally on Windows with the Chrome path and `new URL(...).pathname` patched in a scratch copy).

**Spec:** docs/superpowers/specs/2026-11-25-automation-builder-simple-design.md

## Global Constraints
- No server changes; saved automation JSON identical to before.
- Every existing field stays reachable (Settings or Advanced).
- Keep class names tests and code rely on: `.auto-act` (with `lit`/`dim`/`bad`), `.auto-would`, `.auto-test`, `.auto-test-btn`, `.auto-probs`, `.auto-runs`, `.auto-word`, `.auto-branches`, `.auto-steps.nested`, `.auto-ins`, `.auto-grip`, `.auto-more`, `.auto-end`, `.auto-trigger`, field classes (`.auto-agent-who`, `.auto-if-field`, …).
- Text into pages as text (CODING-GUIDE): picker labels via `h()` text, never `html:`.

## Review Focus
- Typing in a panel field updates the selected node's sentence and red mark live (no redraw that loses focus).
- Deleting the selected step: selection falls back to the trigger, no crash.
- Picker on a phone (≤700px): fits the screen, closes on Esc / outside tap.
- A trigger kind not in the icon table (new catalog event) still shows (fallback ⚡, gray).
- Members (non-admin) never see admin-only steps in the picker (`autoDoOk`).

---

### Task 1: Look tables, picker, list icons

**Files:** Modify `client/app.js` (after `AUTO_DO`), `client/style.css`. Test: `tests/flows_builder_ui.mjs` (picker assertions added in Task 2).

**Interfaces — Produces:**
- `AUTO_LOOK: { [stepKind]: { ic: string, c: 'purple'|'teal'|'blue'|'green'|'orange'|'amber'|'red'|'pink'|'gray', g: 'people'|'work'|'customers'|'money'|'ai'|'flow' } }` for every AUTO_DO key plus `wait`, `if`.
- `AUTO_GROUPS = [['all','All'],['people','Tell people'],['work','Work'],['customers','Customers'],['money','Money'],['ai','AI & apps'],['flow','Flow']]`.
- `autoWhenLook(kind) -> { ic, c }` by event-type prefix (task ✅ orange, contact 👤, schedule ⏰, money/invoice/payment 💵 …; fallback `{ ic: '⚡', c: 'gray' }`).
- `autoPicker(anchor: Element, { title: string, items: {key,label,ic,c,g?,hint?}[], groups?: [k,label][], active?: string, onPick(key) })` — popover `.ap-pop` with `.ap-search` input, `.ap-chips` buttons (`data-g`), `.ap-item` rows (`data-key`, `.on` when active). Fixed-positioned beside anchor, bottom sheet ≤700px; closes on Esc, outside click, or pick. Returns nothing.

- [ ] Step 1: Add the tables, `autoWhenLook`, `autoPicker`, CSS (`.ap-pop`, `.ap-item`, color classes `.lk-<c>` setting `--lk` and `--lk-soft`).
- [ ] Step 2: automationsTool rows and recipe cards get a `.auto-ic.lk-<c>` icon from `autoWhenLook(trigger.kind)`.
- [ ] Step 3: Load the app in Chrome, open Automations; icons show, no console errors.

### Task 2: Builder — compact nodes, side panel, Settings/Advanced

**Files:** Modify `client/app.js` autoSheet, `client/style.css` auto-builder block. Test: `tests/flows_builder_ui.mjs`, then follow-ups in `flows_actions_ui, flows_bus_ui, flows_steps_ui, flows_vault_ui, inventory_links_ui, saved_asks_ui, savedtasks_ui, templates_ui, engine_ui, flows_recipes_ui, cc_plan_ui`.

**Interfaces — Consumes:** Task 1. **Produces:**
- `B.sel: 'trigger' | <step path at>`; `freshStep(kind, prev) -> step` (the old kind-change factory).
- Node DOM: `.auto-act[data-at]` > `.an-h` (dot, label `.an-n`, grip, `.auto-more`, remove) + `.an-b` (`.an-ic`, `.an-say` = `autoLine(a)`) + `.auto-would`. Click selects.
- Trigger node `.auto-trigger` > `.an-h` "1. WHEN" + `.an-say` (when-sentence).
- Panel `.ab-panel` > `.ab-ph` (title + `.ab-change` button opening picker) + `.ab-tabs` (`[data-tab=set]`, `[data-tab=adv]`, Advanced only when it has fields) + `.ab-body` fields + word chips.
- Trigger kind and step kind change via picker, the `.auto-kind`/`.auto-step-kind` selects are gone. Fold / Fold all removed.

- [ ] Step 1: Update `tests/flows_builder_ui.mjs` to the new flow: open builder → trigger selected; `.ab-change` → `.ap-pop` lists events; search "contact" filters; pick `contact.created`; click first `.auto-act` → panel; `.ab-change` + pick `agent` → `.auto-agent-who` in panel; `.ab-tabs [data-tab=adv]` shows `.auto-ask-from` only there (when saved asks exist) ; `+` on `.auto-ins` opens picker, pick `if` → branches side by side; drag, duplicate, move up, test-lights, past runs as before; fold assertions removed; `.an-say` updates while typing.
- [ ] Step 2: Run (patched copy) — FAIL on old code.
- [ ] Step 3: Implement. Split pushes into `f`/`adv` per the spec's Advanced list; render fields only for the selected node; `marks()` also refreshes `.an-say`; deleting the selected step resets `B.sel = 'trigger'`; trigger filters: `schedule`, `record.date`, `contact.stage` in Settings, other filters in Advanced ("Narrow it down"). Layout grid: canvas | 340px panel; stacked ≤900px.
- [ ] Step 4: Run flows_builder_ui — PASS. Update and run the other listed builder UI tests (replace `.auto-step-kind` picks with a helper that selects the node and picks from the picker; fields read from the panel).
- [ ] Step 5: `bash tests/ci.sh` subset touching flows passes; commit.

### Task 3: Task/phase "⚡ Add automation" panel, phase window tab

**Files:** Modify `client/app.js` ccAutoPanel, stepAutoPanel; `client/style.css` cc-pauto. Test: `tests/plan_autos_ui.mjs`, `tests/cc_plan_ui.mjs`.

**Interfaces — Consumes:** `AUTO_LOOK`, `autoWhenLook`. **Produces:** `.pa-when` / `.pa-then` become `role=radiogroup` lists of `.pa-opt[data-v]` buttons (`aria-checked`) inside `.pa-node.when` (orange) / `.pa-node.then` (purple); "Tell someone" opens a `.pa-who` select; wait is `.pa-wait` chips `.pa-opt[data-v=0|1|2|7]`; `.pa-say`, `.pa-for`, `.pa-save` unchanged; ready-made `.pa-recipe` rows with icons; `.pa-adv` disclosure holds "Use one you have" (`.pa-copy`, `.pa-copy-go`) and `.pa-full`.

- [ ] Step 1: Update plan_autos_ui to click `.pa-opt` instead of setting selects; open `.pa-adv` before `.pa-copy`. Run — FAIL.
- [ ] Step 2: Implement; same `draft()` output as before.
- [ ] Step 3: Run plan_autos_ui and cc_plan_ui — PASS. Commit.
