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
2. **A step engine:** conditions on any field ("only if the amount is over…, the stage is…"), branches, waits that
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
