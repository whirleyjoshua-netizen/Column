# Apps & Integrations: audit and build plan

Written 2026-11-20. Every "exists" or "works" below was checked against the code on `main`, not taken from earlier
plans. When something here and the code disagree, the code wins: fix this file.

## 1. What changed today

- **Apps & Integrations** is its own tab in the sidebar (under Workspace). It has three tabs:
  - **Apps:** about 90 tiles with logos, grouped by kind, the connected apps first, plus search and filters.
  - **Tools:** the team's tool switches, moved out of Settings → Team.
  - **Developers:** API keys, webhooks and website lead forms.
- Settings no longer has a Connections tab. Settings → General and Settings → Team each keep a row that points to
  the new page. Old links (`openSettings('connections', …)`) open the right app or tab instead.
- Each tile opens the **same section Settings had** (calendarSection, qboSection, …). Nothing about how a connection
  works changed, only where it lives.
- A tile always says where it stands, one of five:
  - **Connected:** set up and working.
  - **Connect:** built, and this person can connect it. A member sees **Owners & admins** on team-only apps.
  - **Ready to use:** nothing to connect, like Notion import or GitHub.
  - **Not set up here:** built, but the server doesn't have its keys yet.
  - **Not built yet:** the tile explains that and points to Zapier and Make.
- Logos come from Simple Icons (CC0), saved in `client/applogos.js` and loaded only when the page opens.
  - Brands that asked Simple Icons to remove them get a lettered tile, not a copied logo: Microsoft/Outlook/Teams/
    OneDrive/SharePoint, Slack, Salesforce, LinkedIn, Canva, Adobe, OpenAI, Twilio, DocuSign and others.
  - If we ever want official logos for those, each brand's press kit has its own rules; read them first.
- Code: `client/app.js` (look for "Apps & Integrations"). Test: `tests/apps_ui.mjs` (ports 5242, Chrome 9581).

## 2. Audit: what Kloomie really connects to today

### Built and working (in the code)

| App | How it connects | Who connects | What moves | Code | Server keys it needs |
| --- | --- | --- | --- | --- | --- |
| Google Calendar | OAuth (`oauthBind`) | each person | events both ways; blocks you add go to the calendar you pick | calendar.js, index.js `calProviders` | GOOGLE_CLIENT_ID/SECRET |
| Gmail (sending) | same Google sign-in, "send email" box ticked | each person | campaign email goes out from their address; Kloomie can't read the inbox | index.js `mailConn` | same |
| Outlook / Microsoft 365 | OAuth (Microsoft Graph) | each person | calendar both ways, sending email | calendar.js | MS_CLIENT_ID/SECRET |
| Apple Calendar | iCloud CalDAV with an app-specific password | each person | calendar both ways | calendar.js | none |
| Your Day as a calendar link | .ics subscribe link | each person | one way out, read-only | index.js `calfeeds` | none |
| Google Contacts | OAuth | owner/admin | reads into Contacts, keeps current | index.js `gc*` | Google keys |
| QuickBooks Online | Intuit OAuth | owner/admin | invoices, payments and customers in; QuickBooks payments back | quickbooks.js | QBO_CLIENT_ID/SECRET (+QBO_ENV=production) |
| Stripe (customer payments) | pasted secret or restricted key, sealed | owner/admin | Pay button on invoices and quote pages; paid marks itself | index.js payments | none (team's own key) |
| Stripe (Kloomie's own billing) | server key | Kloomie | seat billing | stripe.js | STRIPE_SECRET_KEY, STRIPE_PRICE |
| Twilio | pasted SID, token and number (bring your own), sealed | owner/admin | texts out; replies onto contacts; STOP respected | twilio.js | none |
| Postiz | pasted API key, or "Connect with Postiz" OAuth | owner/admin | posts to Facebook, Instagram, LinkedIn, X, Threads, Bluesky, Mastodon, Google Business Profile… | postiz.js | POSTIZ_CLIENT_ID/SECRET for OAuth |
| Dropbox | OAuth (list mode) or Chooser popup | each person | files picked into a stack, read-only | dropbox.js | DROPBOX_APP_KEY/SECRET |
| Google Drive | Google Picker | each person | files picked into a stack | index.js `cloudPickers` | GOOGLE_PICKER_API_KEY, GOOGLE_PROJECT_NUMBER |
| OneDrive | OneDrive picker | each person | files picked into a stack | index.js `cloudPickers` | ONEDRIVE_CLIENT_ID |
| Notion | one-time import of an export .zip | anyone with Docs | pages, sub-pages and tables become docs | notion.js | none |
| GitHub | repository webhook with a secret (signature checked) | per software board | PRs, merges and releases move work items | github.js | none |
| Zapier | Kloomie's Zapier app (invite link) on the public API | owner/admin makes the key | triggers and actions for contacts, tasks, visits, invoices, records | integrations/zapier, publicapi.js | none |
| Make / your own code | public API `/api/v1` + webhooks | owner/admin | same as Zapier | publicapi.js, projects.js | none |
| Website lead forms | hosted form `/l/<key>` + lead webhook `/hooks/lead/<key>` | owner/admin | leads into Contacts, starting automations | leads.js | none |
| Claude / OpenAI / Gemini | each person's own API key, sealed | each person | agents, Sidekick, drafts, pictures (OpenAI/Gemini) | llm.js, images.js | none (KLOOMIE_AI_KEY for the free tier) |
| PSS admin | internal | PSS team only | customers and jobs | index.js `pss` | PSS_TEAMS |

These are Kloomie's own plumbing, not tiles: Resend (Kloomie's emails), Mapbox (maps and drive times), web push
(VAPID). They stay server settings.

### Which of these are switched on at app.kloomie.com

The server only offers a connection when its keys are set; otherwise the tile says **Not set up here**. From earlier
work:
- **QuickBooks:** live on Intuit **sandbox** keys. Production needs Intuit's Production tab, then `QBO_ENV=production`.
- **Google:** OAuth verification started 2026-11-08. Until Google approves, only test users can connect Calendar,
  Gmail and Contacts.
- **Not checked from here:** Microsoft, Dropbox, the Drive picker, OneDrive and Postiz OAuth. Look at the Railway
  variables for each one's keys and fill in the gaps (section 7, step 1).

### What was wrong with the old Settings → Connections

- Ten sections sat on one long page, with 11px grey headings and 11px hints. Nothing
  separated one connection from the next, and you couldn't see at a glance what was connected.
- Team tools were buried in Settings → Team. Developer items (API keys, webhooks) sat in the same list as "connect
  your calendar".
- There was no sign of which apps Kloomie *doesn't* connect to, so people couldn't tell "not built" from "not found".

### What the pasted master list got right, and what it missed

- **Right:** the categories, and the three kinds of connection: built in, through Zapier/Make/webhooks, and the API.
  Kloomie already has all three. Built in is the table above. Zapier, Make and webhooks exist in publicapi.js and the
  Zapier app. The API is `/api/v1` with docs at /developers.
- **Right:** each integration should declare what it can do, so it becomes a building block in Kloomie and not just a
  logo. Flows (automations) is where those building blocks land: see 3.3.
- **Missed:** about 20 connections Kloomie already has (Twilio, Postiz and the channels behind it, Apple Calendar,
  lead forms, Notion import, AI keys, the Drive/OneDrive/Dropbox pickers).
- **Missed:** some apps on it need partner approval before anyone can build (ServiceTitan, Gusto, Jobber's
  marketplace, Procore's marketplace). That changes the order.

## 3. Architecture to build toward

### 3.1 One registry of integrations (server)

Right now each connection is wired by hand: its own routes, its own `S.x` in the client, its own status shape, and
the tile catalog lives in the client (`APP_LIST` in app.js). Move to one registry:

```
server/integrations.js
  register({
    id: 'quickbooks', name, category, kind: 'native' | 'via' (Postiz channels) | 'automation' | 'api',
    scope: 'team' | 'person',            // who connects it; team ones are owner/admin only (checked here, every path)
    auth: 'oauth' | 'key' | 'webhook' | 'none',
    configured: () => bool,              // server keys present (drives "Not set up here")
    status: (ws, memberId) => ({ state: 'on'|'off'|'error', account, lastSync, error }),
    capabilities: ['invoices.push', 'payments.pull', ...],
    disconnect: (ws, memberId) => …,
  })
GET /api/integrations  -> every integration's state for this person, in one call (admin-only ones filtered by role)
```

- The client catalog becomes the server's list, plus the not-built tiles (a static list either side).
- The page loads one call instead of ten.
- Admin-only status never reaches members (CODING-GUIDE: visibility travels with the data).
- Existing modules (quickbooks.js, twilio.js, postiz.js, …) each add one `register` call. Their routes stay.

### 3.2 Connection health

Every native integration records `lastSync`, `lastError` and `needsReconnect` (token revoked or expired). Then:
- The tile shows **Needs attention** (red) instead of Connected.
- The person who connected it gets one notice. The board's "connections" warnings (already in `/api/board`,
  `d.connections`) come from the same place.
- ALERT_EMAIL gets an email when a team-wide integration fails three syncs in a row (operations already has the
  error email).
- Removing a member revokes and deletes their personal connections. Deleting a team deletes all of them. Export
  includes which apps were connected, never the tokens.

### 3.3 Capabilities feed Flows

Flows already runs triggers and actions across tools (flows.js). Each capability an integration declares becomes:
- **Triggers:** "QuickBooks: payment recorded", "Calendly: meeting booked", "CompanyCam: photo added to project".
- **Actions:** "Slack: post a message", "Mailchimp: add to audience", "Xero: send invoice".

That's how integrations show up across the product and not only on this page:
- A job's page shows its CompanyCam photos.
- An invoice shows "In Xero ✓".
- A contact shows "In Mailchimp list: Spring promo".

### 3.4 Rules every integration follows (from docs/CODING-GUIDE.md)

- Tokens and keys go through `seal`/`unseal`, never into URLs or logs. OAuth starts and callbacks go through
  `oauthBind`. Outside addresses go through `safeFetch`, with a timeout on every call.
- Incoming webhooks are checked: a signature where the app signs (Stripe, GitHub, Twilio, Slack, Calendly, Square
  all do), or a per-team secret in the address where it doesn't.
- Whatever an app sends is data, never instructions: text from it never goes to an agent as a command, and goes into
  pages as text.
- Ask for the least access each feature needs. Read-only unless the feature writes.
- Limits on what costs: a sync budget per team per hour, and backoff when an API says slow down.
- Team-wide connections are owner/admin only on every path, the public API included (`hold` in rules.js where an OK
  is needed).
- Each integration gets a stand-in server in tests, the way `tests/fakecaldav.mjs` and the QuickBooks fake work.
  Never point a test at a real service.

## 4. Build order, and why

Kloomie sells to small and trade businesses. The order below puts first what those customers already pay for and
ask about: money, scheduling, photos, getting found. The approval wait for each app is in the last column. Start
applications early: they take weeks.

### Step 1: switch on what's built (days, mostly settings)

| Item | What to do | Who |
| --- | --- | --- |
| QuickBooks production | Intuit Production tab: app URLs, compliance questionnaire; then `QBO_ENV=production` and production keys on Railway | owner (Intuit account) + Claude |
| Google verification | finish OAuth review (Search Console, demo video, submit) so anyone can connect Calendar/Gmail/Contacts/Drive | owner + Claude |
| Microsoft | Azure app registration for Outlook/OneDrive (`MS_CLIENT_ID/SECRET`, `ONEDRIVE_CLIENT_ID`), publisher verification | owner + Claude |
| Dropbox | production app approval (needed past 500 users) | owner + Claude |
| Postiz OAuth | `POSTIZ_CLIENT_ID/SECRET` so "Connect with Postiz" works without pasting a key | owner + Claude |
| Zapier app | move from invite-only to public (Zapier's review: tests, branding, help article) | Claude, owner submits |
| Live tests | the pending live tests already listed (Stripe real card, Postiz, Apple Calendar on a real iCloud, push on iPhone) | owner |

### Step 2: the registry, health and "ask for this app" (about a week)

- server/integrations.js with `GET /api/integrations`. Move the existing ten connections onto it. The client catalog
  reads from it.
- Health, as in 3.2.
- A **Want this?** button on every Not built yet tile (`db.appRequests`: team, app, who, when). Owner gets a weekly
  count. This tells us what to build next with real demand, not guesses.
- Test: registry states for owner/member, needs-reconnect, a member never sees team-only status.

### Step 3: what trade customers ask for first (2–4 weeks)

| App | What it does in Kloomie | How | Size | Notes |
| --- | --- | --- | --- | --- |
| Slack | job, lead and approval notices into a channel; slash command to add a task | Slack app (OAuth, incoming webhooks, events) | M | outbound-only first is S |
| Microsoft Teams | same notices | Teams Workflows webhook | S | outbound only |
| Calendly / Cal.com | a booking becomes a contact plus a visit on the job board | OAuth + webhooks (Calendly webhooks need a paid Calendly plan) | M | Cal.com is open source with webhooks on every plan |
| CompanyCam | project photos show on the matching job; new photos can start a flow | API + webhooks, match by address | M | the most-asked app in roofing, solar and restoration |
| Xero | same as QuickBooks for teams outside the US | OAuth 2.0 + Accounting API | L | reuse quickbooks.js reconcile pattern |
| Square | card payments and in-person taps on invoices; payments come back | OAuth + webhooks | M | for teams already on Square |
| Mailchimp | Contacts groups ↔ audiences, unsubscribes respected both ways | OAuth + webhooks | M | Kloomie keeps its own unsubscribe list as the source of truth |
| Google Business Profile reviews | read new reviews into the bell; reply from Kloomie | Business Profile API (needs Google approval) | M | posting already works through Postiz |

### Step 4: bringing teams over from other field-service software (4–6 weeks, mostly approvals)

Customers switching to Kloomie need their data to come with them. Build a **one-time import first** (customers, jobs,
invoices, price list), then two-way sync only where it pays.

| App | Import | Sync | Before building |
| --- | --- | --- | --- |
| Jobber | clients, jobs, quotes, invoices | later | Jobber's developer program; apps go through their review |
| Housecall Pro | customers, jobs, estimates | later | API is on their higher plans; check terms |
| ServiceTitan | customers, locations, jobs | no | partner approval required; long lead time |
| Buildertrend | projects, clients | no | check whether a public API is offered; CSV import may be the only path |
| Procore | projects, photos, RFIs read-only | maybe | Procore developer program and marketplace listing |
| CSV for anything else | contacts, jobs, items, price list | none | already partly there (contacts and records import); make one guided importer |

### Step 5: the rest of the list, by demand from step 2

- **HR & payroll:** Gusto (hours from visits and tasks into payroll, which needs partner approval), Homebase /
  Deputy / When I Work (timesheets in). These depend on Kloomie having time tracking: decide that first.
- **CRM:** HubSpot (two-way contacts and deals), Pipedrive, Zoho, Salesforce (enterprise; last).
- **Signatures:** DocuSign and PandaDoc only if customers insist. Kloomie has its own signatures and sign-offs.
- **Software & dev:** GitLab and Bitbucket (copy github.js: the webhook pattern is the same), Jira and Linear
  import, Sentry issues to work items.
- **Marketing:** Google Analytics and Search Console read-only numbers on campaigns; Meta/Google Ads spend per
  campaign; Canva designs into Docs (Canva Connect API).
- **Forms:** Typeform, Google Forms and Jotform answers become contacts and tasks. Most already work today through
  the lead webhook: write a help page per form tool before writing code.
- **Storage:** Box and SharePoint pickers like OneDrive's.

### Step 6: Kloomie as a platform

- **Make app and n8n node** next to Zapier, all on the same public API.
- **"Sign in with Kloomie" (OAuth provider)** so other companies can build on Kloomie without asking a team for a key.
  This is what turns the directory into a marketplace. It needs scopes, consent screens and per-app rate limits.
- **A public directory page** on kloomie.com (`/integrations`, `/integrations/quickbooks`, …), made from the same
  registry. Good for search too (see the SEO plan).

## 5. How to add a new integration (the recipe)

1. Read docs/CODING-GUIDE.md and its checklist.
2. Write the test first, with a stand-in for the outside service (copy `tests/quickbooks.mjs` + its fake). Own ports.
3. `server/<app>.js`:
   - a module like `quickbooksModule({ db, seal, unseal, safeFetch, … })` with `route(req, res, parts, auth, ws)`;
   - OAuth through `oauthBind`;
   - tokens sealed;
   - webhooks signature-checked;
   - a sync tick with backoff.
4. Register it (step 2 onward) with its capabilities. Add Flow triggers and actions for those capabilities.
5. Client:
   - the tile in the catalog;
   - a `<app>Section()` that renders connect, connected and error states;
   - wherever the data shows on jobs, contacts or invoices.
6. Help: a paragraph in help.html under Apps & Integrations.
7. Run `bash tests/ci.sh` and the browser test, then check with the other sessions before pushing.

## 6. Logos and names

- Logos: Simple Icons 16.30.0, CC0, saved locally (no outside requests from the app). `client/applogos.js` says how
  it's made. To add one, regenerate it from the package.
- Trademarks stay with their owners. We show them only to say which app a connection is for. Don't use them in ads
  or on kloomie.com marketing pages without checking each brand's guidelines.
- Partner badges ("QuickBooks App Store", "Zapier partner") need each program's approval first.

## 7. Decisions for the owner

1. **Step 1 keys and approvals:** Intuit production, Google verification, Microsoft, Dropbox, Postiz OAuth, Zapier
   public. These need your accounts. Claude can do the rest of each step.
2. **Order of step 3:** the table is a recommendation. If customers have asked for something specific, put it first.
3. **Time tracking:** payroll integrations (step 5) need Kloomie to track hours first. In or out?
4. **Start partner applications now?** ServiceTitan, Jobber, Gusto and Procore take weeks to approve. Applying early
   costs nothing.
5. **Want this? button:** OK to collect requests per team (no personal data beyond who asked)?
