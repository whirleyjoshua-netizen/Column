# Flows: automations that reach every tool

The owner asked (2026-11-11) for automations to connect to the whole platform: every tool, Finance, the Map, docs,
the vault "through encryption", and agents. This is the plan, checked against the code as it was.

## Where it started

`server/index.js`, "automations" had:
- 9 triggers: tasks, contacts, calls, campaigns, files, signatures and a schedule.
- 5 actions: a task, a post, a saved campaign, a notification, or a change to a contact.
- No conditions and no waits.
- Two good rules: an automation's own work never sets off another (no loops), and each runs at most 30 times an
  hour.

Webhooks (`server/projects.js` `EVENTS`) heard 17 other events through their own path (`hook()`, `PJ.emit`). Jobs,
visits, invoices, payments, texts, Finance, docs and the Map reached webhooks or nothing, but never automations.
An automation ran on any event, private or not. An admin's "when a task is done, post it in #general" would have
posted a private campaign's task to the whole team. Webhooks already skipped private things.

## Steps

1. **One event bus, triggers from every tool** (built): `server/flows.js` holds the list of 25 events from 10 tools
   (the one list the editor draws from).
   - `automate()` is the bus. Webhook-only events reach it from `hook()` and the invoices module's `emit`.
   - Records tell it from Projects' single `hooksFire`. A move to another stage is found by comparing with the stage
     last told (`rec.flowStage`, set for every record at start), so every path that changes a stage counts.
   - Money comes from `moneyNews`: business money only, heard only by owners' automations.
   - Docs come from creating one, and Map pins from a campaign's pins only.
   - Something private runs only an automation narrowed to it whose maker can see it.
   - Old trigger names (file.arrived, sign.signed, contact.added) are renamed once at start.
2. **A step engine** (built): conditions on any field ("only if the amount is over…, the stage is…"), branches, waits that
   survive a restart ("wait 2 days, then…") kept in the database, a run history with each step, and cancelling a
   waiting run. The no-loop and per-hour rules stay.
3. **Actions for every tool**, through the same functions the app and the API use, so the same permissions and team
   rules (approvals, `rules.hold`) apply: make or move a record, schedule a visit, make or send an invoice (sending to
   a customer waits for a person's OK), text or email a customer (also OK first), add money, write a doc from a
   template, drop it into a person's vault (below), start a campaign, notify.
4. **Vault and secrets:** a flow never opens a vault (the server can't: vaults are encrypted on the person's
   device). It can *drop into* a person's vault by sealing to their vault's public key, which the server can do
   without being able to read it back. A separate server-sealed store keeps keys a flow needs (an outside service's
   token), never shown again.
5. **Agents as steps, the visual editor, trade templates:** run one of the team's agents on what happened (its
   answer goes to the next step; what it changes follows its approval level), a canvas to see the whole flow, and
   ready-made flows for each trade.

Each step: server tests that fail on the code before, and real-browser tests (headless Chrome, phone width too).

## Where it is

- Step 1 is live as 1ff6ba8.
- Step 2 (if/otherwise, waits in `db.flowWaits`, waiting runs listed and stopped) is in the commit after it.
- Step 2 is live as 744c922. Flows then paused for the Jobs & projects engine round (79e51ad), which handed back.
- Step 3 (actions in every tool) is built:
  - New steps: book a visit on the job, bill the job (an invoice, optionally sent), text the customer, email the
    customer, add money to the business's Finance, and write a doc from a team doc template.
  - Each one runs through the app's own route as the automation's maker (`flowCall` → `replayAs(..., flow)`), so the
    same permissions and team rules apply. Records, money and docs show the automation's name.
  - Texts, emails and sending an invoice always wait for an OK (`RULES.ask`, an approval with `flow` set), even
    when an owner made the automation. The automation's maker can OK it too.
  - An OK sends the request through the same route, once. The OK also covers the team's invoice rule (`covers`), so
    nobody is asked twice.
  - Nobody marked do not contact, or unsubscribed, gets anything; the run log says why.
  - What an automation does, and what an OK'd send does, sets nothing off. `FLOWING` (an AsyncLocalStorage) replaces
    the old counter, so this holds across every await.
  - Only owners and admins can bill or message customers from an automation, and only owners can add money. This is
    checked when it's saved and again by the routes when it runs.
  - New route: `POST /api/contacts/:id/email`.
  - Tests: `tests/flows_actions.mjs` (CI) and `tests/flows_actions_ui.mjs` (Chrome: build it in the editor, move a
    job, OK the email and the invoice from Home, at phone width too).
- Step 3 is live as c692312.
- Step 4 (vault drops, automation keys, sending to another app) is built:
  - Drop key: each vault gets one when it's set up or next unlocked, made in the browser. It's a P-256 key pair; the
    public half goes to the server, and the private half is stored only encrypted with the vault's own key.
  - The "Put a sealed note in a vault" step goes to the maker, whoever set it off, or a named person. It seals the
    note to that drop key (`sealToVault`: one-time ECDH, HKDF-SHA256, AES-256-GCM) before anything is saved, so the
    server can never read it.
  - The note waits in `db.vaultDrops`. On the next unlock the browser opens it and keeps it as an ordinary vault item.
  - The run log only says a note was left, never what was in it. Starting the vault over throws drops away, and so
    does leaving the team.
  - Automation keys (`db.flowSecrets`, `/api/automations/secrets`) are sealed with `seal` and never shown again
    (only the last four), and automations refer to them by id.
  - The "Send to another app" step posts what happened (the event's words) as JSON through `safeFetch`, with the key
    as a Bearer token. It's https only, with a 10-second limit, and only owners and admins can add it.
  - Tests: `tests/flows_vault.mjs` (CI; opens the drops with WebCrypto, as the app does, and checks the saved data
    holds nothing readable) and `tests/flows_vault_ui.mjs` (Chrome).
- Step 4 is live as d47220b.
- The visual builder (the editor part of step 5, asked for by the owner on 2026-11-16) is built:
  - Editing an automation opens it full screen, as a flow: what sets it off at the top, the steps under it, and
    "Only if" split into Then and Otherwise side by side (one above the other on a phone).
  - A + between steps adds one there. A step's ⋮⋮ drags it anywhere, into a branch too; it can't go inside itself,
    and "Only if" goes 3 deep at most. Each step's menu has Duplicate and Move up/down. ▾ folds a step to one line,
    and the bar can fold or unfold them all.
  - A step that's missing something is marked red as you type (`autoProblem`, the same checks the server makes), and
    the bar counts them. Word chips put {word} where the cursor is.
  - "Test it" (`POST /api/automations/test`) walks the automation as it's being built, on the last real event of
    its kind that matches and that its maker can see (`lastEvents`, in memory, never private or owners-only), or on a
    made-up one. It lights the way it would go and says what each step would do, and it changes, sends and asks for
    nothing.
  - Each run keeps the way it went (`run.path`: "0", "1.then.0"…), and "Show a past run" lights it on the canvas.
  - Tests: `tests/flows_builder.mjs` (CI) and `tests/flows_builder_ui.mjs` (Chrome).
- The visual builder is live as 3e6e5b7.
- Agents as steps (step 5) are built:
  - "Ask your team (AI)" asks the maker's own agent, or their whole team, on the maker's AI key, through
    `AGENTS_M.newRun`. It works at the level the maker set for that agent, so anything important waits for their yes
    in Your team.
  - The agent is told what happened (the ask, with the words filled in) and that an automation asked. Its work runs
    inside `FLOWING`, so it sets no automation off.
  - With "wait for the answer", the run waits (`flowWaits` with `agentRun`) until the assignment is done, up to 30
    minutes. The steps after it then get `{answer}`, the agents' reports. If it takes longer they go on without it
    and say so.
  - No AI key: it fails and says so. At most 3 of the maker's assignments run at once.
  - Tests: `tests/flows_agent.mjs` (CI, with a stand-in Claude), plus a check in `flows_builder_ui`.
- Agents as steps are live as a3b4959.
- Ready-made automations by kind of business are built: 25 of them in `AUTO_RECIPES`, each tagged `for` trades,
  services, sales, office, store, software or all.
  - The team's own kind (from setup) and everyone's show first ("For you"), and chips show one group or all.
  - Each card lists the steps it uses. They use the new steps: book the install, bill and send after an OK, text
    and email the customer, Sales drafting a reply to a lead, the Chief of Staff's Friday recap, sending to another
    app.
  - `tests/flows_recipes_ui.mjs` opens every one and saves it as it is. 22 save; the other 3 need a choice first
    (a project's date field, another app's address) and say so.
- Flows is complete except `create_automation` for the agents (so "Plan my business" can draft real automations).
- New events for the engine round go into `server/flows.js` `EVENTS` and fire through `automate()`.
