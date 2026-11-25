# Simpler automation builder (2026-11-25)

## Intent
Ease of use first. Building an automation should look like the owner's mockup: small, colored nodes in a When → Then
flow, a simple searchable colored list to pick triggers and steps, and settings that aren't simple kept under an
Advanced tab. The same look carries into "⚡ Add automation" on a task or phase in a campaign plan.

## Goals
- Builder (`autoSheet`): compact nodes (colored header band: 1. WHEN orange, ACTION purple, WAIT amber, ONLY IF teal),
  one-sentence body + small chips. Clicking a node selects it; its fields open in a side panel with Settings /
  Advanced tabs. "Change" opens the picker. "+ THEN" on connectors opens the picker and inserts that step.
- Picker popover: search, category chips (All · Tell people · Work · Customers · Money · AI & apps · Flow), colored
  icon rows. Used for triggers (grouped by tool from the catalog) and steps.
- Advanced: trigger's optional filters; steps' presets, templates, campaign "Under", proof-of-insurance, webhook key,
  visit length/crew, money category/note, saved-ask start and agent hints.
- "▶ Test your automation" at top; a pill at the bottom of the canvas about words that fill in.
- Task/phase panel (`ccAutoPanel`): mini WHEN (orange) / THEN (purple) cards with colored choice lists instead of
  selects, wait as chips; ready-made as colored rows; "Use one you have" and the full-builder link under Advanced.
- Automations list and idea cards get the colored trigger icon.

## Non-goals
- No server changes; automations save exactly as before. No new step kinds or triggers.

## Anti-goals
- Losing any existing capability (every field still reachable), breaking validation marks, Test it, past runs, drag.

## Approach
One sensible way: restyle and restructure the existing client code in place (app.js + style.css), reusing the
existing field-building code split into simple/advanced lists. A separate new builder or a canvas library would
duplicate 500 lines of field logic for no gain.

## Left to the builder
Exact icons and colors, picker positioning, mobile stacking, updating the browser tests to the new layout.
