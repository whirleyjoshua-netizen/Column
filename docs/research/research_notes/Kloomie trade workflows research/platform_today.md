# What Kloomie has today (checked against the code, 2026-11-11)

Written by the coordinator from the code at commit 744c922, so the report can map each trade's needs onto what exists. Everything here is VERIFIED in the repo unless marked.

## Shape
- Jobs & projects is one record engine. A project has lists ("types"); each list has records with custom fields, stages, a timeline log (`rec.log`, newest 300), comments and links between records (server/projects.js).
- New-project menu: 4 cards: Construction & Trades (trade picker, plus "We bid on jobs too" which adds bids/quotes/clients/price list), Technology & Software, Creative & Agencies (agency client work, UGC), Business Operations (team projects/tasks/processes, CRM "Sales pipeline", Equipment & assets, Blank). Also "Describe how you work": AI builds a custom project (server/describe.js).
- Customers live in Contacts (one list of people); a job links to a contact, and a contact shows its jobs with "Make a job".

## Trades (server/trades.js): 41 trades in 6 families, each family with its own stages
- Repair and service (New, Scheduled, In progress, Waiting on parts, Done, Invoiced, Paid): HVAC, plumbing, electrical, appliance, garage doors, locksmith, generators, water heaters/wells/septic, solar.
- Installers (Lead, Measure booked, Measured, Quoted, Ordered, Scheduled, Installed, Invoiced, Paid): blinds, flooring, cabinets/countertops, windows/doors, roofing/siding/gutters, fences/decks, security/smart home/AV, EV chargers, closets.
- Remodel and building (Estimate, Approved, Permit, In progress, Inspection, Punch list, Complete, Paid): painting, drywall/tile/carpentry, concrete/masonry, GC/remodels, insulation/waterproofing, handyman.
- Recurring (Scheduled, Done, Skipped, Invoiced, Paid): lawn, trees, pest, pools, irrigation, snow, exterior cleaning.
- Cleaning, restoration and hauling (New, Scheduled, In progress, Done, Invoiced, Paid): house cleaning/janitorial, carpet, restoration, junk/moving.
- Mobile (Booked, On the way, In progress, Done, Paid): auto detailing/repair, towing (own stages: Call in → Dispatched → En route → On scene → Towing → Dropped off → Stored → Invoiced → Paid), courier, pet grooming, home inspections.
- Each trade has its own fields and an on-site checklist. A "how often" select exists on recurring trades, but it's a label only: nothing repeats.

## Field types
text, number, money, date, select, multi, person, email, phone, url, checkbox, link, items (price lines), autonumber, files, contact, checklist, measure (w×h / area / length), equipment (make, model, serial, warranty), materials (with cost), readings (labelled with units), signature (with sign-off forms), permit (status), location (address + GPS, every move logged), job (a record elsewhere), secret (sealed, reveal logged).

## Field work
- Visits: one Day entry per person going, linked to the job; the job's scheduled day and crew follow its next visit; a booked or done visit moves the stage forward (server/index.js ~1094).
- Team schedule (drag a waiting job onto a person), routes with Mapbox (optimised order with fixed appointment times, open in Google Maps), mileage log.
- Invoices with a payment link (Stripe), job costing, quotes with a customer page to accept and sign, sign-off forms, on-my-way texts, reminders and review requests (trades plan steps 4–5).
- Equipment & assets: QR labels, Move here, job field, sealed combo.

## Automations (Flows, live since 744c922)
Events (server/flows.js): record.created, record.stage, record.deleted, quote.accepted/declined, visit.scheduled/done/cancelled, invoice.sent/paid, payment.received, money.added, text.received, contact.created/stage, task.created/done, document.signed, file.received, doc.created, pin.dropped, attempt.logged, campaign.done/checkin, schedule. Steps can branch (if/otherwise) and wait. Actions: task, post, campaign, notify, contact.

## Other platform pieces a trade can lean on
Contacts with pipelines, campaigns, a business card with lead capture, Finance (money in/out, QuickBooks), Docs (with project lists in docs), the Vault (per person), chat/feeds, Map pins, Stacks (files, file request links), agents (Chief of Staff, Sales, Operations, Marketing), public API and webhooks, Zapier, Google/Apple calendars, web push.

## Engine gaps (verified)
1. Views: only table, board, timeline and sprint (projects.js ~1092). No calendar, map, gallery or form view in a project.
2. No formulas or rollups across records.
3. No repeating records or service-due reminders: "how often" doesn't create the next visit, and no maintenance agreements or memberships. Repeats exist only in the Day planner.
4. No offline mode for crews without signal.
5. No dependencies between records or phases.
6. Automation actions can't yet change a record (move a stage, set a field, create a record). They can only make tasks, posts, campaigns, notices and contact changes.
7. No good-better-best options on quotes (the quote is one set of price lines). A price list exists in the bids lists. VERIFIED by grep: no options or tiers.
8. No supplier purchase orders or ordering status beyond the "Ordered" stage. VERIFIED.
9. No deposits, change orders or progress billing/draws on jobs or quotes. VERIFIED by grep: "deposit" appears only as an HQ policy example and in Finance bank-import rules.
10. Nevada compliance: no contractor license number on quotes or invoices, no lien notices or waivers, no 3-day right-to-cancel notice. VERIFIED by grep. What exists: e-signature consent on signing (server/index.js ~4801), and texting STOP/START opt-out marking a contact do-not-contact (server/twilio.js:5–12, 128).
11. No date-based trigger. Flows' `schedule` runs on fixed weekdays and times only (server/index.js ~3067), never "N days before a record's date field". Expiries, renewals, lien clocks and storage days all need one. VERIFIED (found while checking the report).
