# Integrations map: how every app connects, who can use it, and where it fits

The owner, 2026-11-19: "make sure the integrations make sense and completely map out how they are connected, who has
access (agents, automations etc.), how they fit in the workflows, and easy connections and set-ups for the user."

This is the shared spec for everyone building integrations. **docs/INTEGRATIONS-PLAN.md** has the audit of what
exists and the long build order. This file is the contract every new or reworked integration follows, the map of
how each one plugs into Kloomie, and who is building what right now.

Check every claim here against the code before building on it (feedback rule: check against code). Where this file
says "verify", nobody has yet.

---

## 1. The model: four layers every integration has

```
  CONNECT            DATA                     ACCESS                         WORK
  who sets it up  →  what comes in / goes  →  who and what may use it    →  where it shows, what it starts
  (team / person)    out, where it lands      (people, agents, automations,  (pages, Home, triggers,
                                               Sidekick, public API)          actions, recipes)
```

An integration isn't done until all four are answered. The tile in Apps & Integrations is only the CONNECT layer.

### 1.1 Connect: two scopes, never mixed

| Scope | Who connects | Who it belongs to | Examples |
| --- | --- | --- | --- |
| **Team** | owners and admins (checked on the server, every path, public API included) | the team: one connection everyone's work goes through | QuickBooks, Stripe, Twilio, Postiz, Slack, Teams, GitHub, CompanyCam, Calendly (team booking pages), Square, Xero, Mailchimp, lead forms, Zapier/Make keys |
| **Person** | each person, for themselves | that person only; nobody else (owners included) can act through it | Google/Outlook/Apple calendar, Gmail/Outlook sending, Drive/OneDrive/Dropbox pickers, AI keys, a person's own Calendly |

Rules:
- A team connection's status detail (account, errors, last sync) goes to owners and admins only. Members see
  "Connected" or not, and only for tools switched on for them (member access, column-02's 3f7c586).
- Removing a member revokes and deletes their personal connections. Deleting a team deletes every connection.
  Export lists which apps were connected and never includes tokens.
- Tokens and keys are sealed (`seal`/`unseal`). OAuth goes through `oauthBind`. Outside calls go through `safeFetch`
  with a timeout.

### 1.2 Data: where it lands

Nothing from an app lives in a side copy. It lands on the thing it's about, the same way Kloomie's own data does:

| Comes in as | Lands on | Example |
| --- | --- | --- |
| a person or company | **Contacts** (deduped by email/phone; `ext.<app>` keeps the outside id) | Google Contacts, Calendly invitee, Square customer, lead form |
| a meeting or appointment | **calendar entry**, or a **visit** on the job when it matches a job | Google/Outlook/Apple events, Calendly/Cal.com booking |
| money | **invoice / payment / Finance entry** | Stripe, QuickBooks, Square, Xero |
| a photo or file | **the job's photos**, or a stack | CompanyCam, Drive, Dropbox |
| code activity | **the work item** (when it names a key) and the **team's code log** | GitHub |
| a message | **the contact's timeline** (texts), or the bell | Twilio replies, Slack replies (later) |
| a review | **the bell**, and the contact | Google Business Profile reviews |

Anything an app sends is data, never instructions. It goes into pages as text and never reaches an agent as a
command.

### 1.3 Access: one table for people, agents, automations, Sidekick and the API

| Who | Reads integration data | Acts through an integration (sends, posts, pushes) |
| --- | --- | --- |
| **A person** | what they can see anyway (visibility setting, member access, private campaigns) | team connections: if the tool is on for them and the action isn't owner/admin-only (pushing to QuickBooks, changing Stripe = admins). Personal connections: only their own |
| **Agents** (Chief of Staff, Sales, Operations, Marketing) | exactly what the person they work for can read: they run as that person through the same routes | through the same routes as that person, under the agent's level: **observe** never; **prepare** drafts and waits for a yes; **execute/automate** routine internal changes only. **Anything that leaves Kloomie to a customer or the public (email, text, social post, Slack/Teams post to a shared channel, push to accounting) always waits for a yes.** The team's rules (`hold`) apply on top |
| **Automations (Flows)** | the trigger's facts, filtered by the automation owner's visibility | runs as the person who made it. Team connections need the maker to be owner/admin when the automation is saved, checked again when it runs. Personal connections only the maker's own. Customer-facing sends follow the same consent rules as by hand (STOP, unsubscribes, do-not-contact) |
| **Sidekick / Home brief** | the person's own facts, including integration facts (code activity, today's bookings, new photos, new reviews) | nothing directly; it hands off to agents |
| **Public API / Zapier / Make** | what the API key's scopes allow (owner/admin-made keys) | same, through `/api/v1`; `hold` rules apply |

Checked against the code (column-02, 2026-11-19): steps run through the app's own routes as their maker
(`flowCall` → `replayAs`), so a route that's owner/admin-only refuses a maker who isn't any more. A step that acts
through a team connection is also checked by kind, when the automation is saved and before each run:
`TEAM_STEPS` in server/integrations.js (`text` → Twilio, `webhook`, `slack`, `teams`). **Add your new action's kind
there.**

### 1.4 Work: three ways an integration shows up beyond its tile

1. **On the thing it's about:** the job shows its CompanyCam photos, an invoice shows "In QuickBooks ✓", a work item
   shows its pull requests, a contact shows "Booked through Calendly".
2. **As Flows triggers and actions:** each integration adds events to `server/flows.js` (`EVENTS`, `tool: '<app>'`)
   and actions to the automation runner. Naming: event `<app>.<thing>` (`calendly.booked`, `github.merged`,
   `companycam.photo`), action `kind: '<app>'` with an `op` (`{ kind: 'slack', op: 'post', channel, text }`).
3. **On Home and in Sidekick's brief**, when it's something a person wants to know today (a card, plus a line in
   `homeFacts`).

Every integration also ships **recipes**: two or three ready-made automations offered right after connecting ("Post
new bookings to #jobs in Slack"). That makes the integration useful in one click.

---

## 2. The map: every core integration, all four layers

Legend: **T** team, **P** person. "Trigger" and "Action" are Flows. "Agents" names the agent tools.

### Live today (wiring to finish)

| App | Connect | Data in → lands on | Out | Triggers | Actions | Agents | Shows in |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Google / Outlook / Apple calendar | P · OAuth / CalDAV | events → calendar entries | your blocks → your calendar | (to add) `calendar.event_soon` | (to add) `calendar` add block | Chief of Staff `look_at_day` reads them | Day, Tasks, Home Today |
| Gmail / Outlook sending | P · same sign-in | none | campaign email from your address | `attempt.logged` | `email` | Sales/Marketing draft, wait for yes | Email tool, campaigns |
| Google Contacts | T · OAuth | people → Contacts | none | `contact.created` | none | `find_contacts` | Contacts |
| QuickBooks | T · OAuth | payments, customers | invoices | `payment.received` | (to add) push invoice now | `look_at_money` | invoice "In QuickBooks", Finance |
| Stripe (payments) | T · key | payments | Pay button | `payment.received`, `invoice.paid` | none | `look_at_money` | invoices, quote pages |
| Twilio | T · key | replies → contact timeline | texts | `text.received` | `text` | suggest as tasks (consent) | Contacts, customer messages |
| Postiz | T · key/OAuth | post status | social posts | (to add) `post.published` | `post` | Marketing `social_posts`, waits for yes | Marketing, campaigns |
| Drive / OneDrive / Dropbox | P · picker | picked files → stack | none | `file.received` | none | `find_docs` | Stacks (+ → From …) |
| Notion | P · import | export → Docs | none | `doc.created` | none | `read_doc` | Docs |
| Lead forms | T · hosted form/webhook | leads → Contacts | none | `contact.created` | none | Sales follow-up radar | Contacts, Home |
| Zapier / Make / API | T · API key | anything | anything | all public events | all public actions | none | Developers |
| AI keys | P · key | none | none | none | `agent` | all | everywhere AI is |

### Building now (section 4 says who)

| App | Connect (setup the user does) | Data in → lands on | Out | Triggers | Actions | Agents | Shows in |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **GitHub (team)** | T · **Connect → sign in to GitHub → tick repos** (GitHub App install). No webhook pasting | pushes, commits, PRs, releases → team **code log**; key mentions → work items (existing behaviour) | none (read-only) | `github.pushed`, `github.pr_opened`, `github.merged`, `github.released` | none | `code_activity` (read) for Chief of Staff and Operations | **Home "Code" card**, Sidekick brief, software boards pick a repo from the list, work items |
| **Slack** | T · **Add to Slack** (OAuth, pick a channel), or paste an incoming-webhook address to start | (later) replies | messages to a channel | (later) `slack.message` | `slack` post (channel, text with {words}) | post drafts, wait for yes | recipes: new lead, job won, invoice paid, approval needed |
| **Microsoft Teams** | T · paste a Teams **Workflows** webhook address (Teams → channel → Workflows → "Post to a channel when a webhook request is received"), with a picture-by-picture guide | none | messages to a channel | none | `teams` post | same as Slack | same recipes |
| **Calendly / Cal.com** (built: server/bookings.js, tests/bookings.mjs; GET /api/bookings; agent tool `find_bookings`; Flows tool `bookings`) | T or P · Calendly: **Connect** (OAuth with PKCE; scopes users:read scheduled_events:read webhooks:write; webhooks signed with the app's key, CALENDLY_WEBHOOK_KEY) · Cal.com: paste API key; Kloomie makes the webhook itself. Calendly's docs (2026-11) say invitee webhooks work on every plan, Free included; a plan that refuses shows on the tile | booking → contact (dedupe) + calendar entry, or a **visit** on the matching job; cancels and reschedules follow | none | `booking.created`, `booking.cancelled`, `booking.rescheduled` | none (later: send booking link) | Sales sees new bookings in follow-up radar; Chief of Staff in the day | contact timeline, Day, Home Today, visit on job |
| **CompanyCam** | T · paste API token (CompanyCam → Settings → Integrations → API); Kloomie makes the webhook | projects ↔ jobs matched by address (pick by hand when unsure); photos → **the job's photos** | (later) make a CompanyCam project when a job is won | `companycam.photo`, `companycam.project` | none | Operations `find_photos` / `look_at_photos` include them | job page photos, sign-offs, invoices |
| **Registry + health + Want this?** | none (plumbing) | `connection.lost` | none | `connection.lost` | none | none | tiles show **Needs attention**, admins get one notice, Want this? counts |

### Next (after the core, by demand from Want this?)

Square (payments like Stripe, in-person taps) · Xero (QuickBooks pattern) · Mailchimp (Contacts groups ↔ audiences,
unsubscribes both ways) · Google Business Profile reviews (bell + reply) · Jobber / Housecall Pro / ServiceTitan
imports. Each fills in the same four columns before code starts.

---

## 3. How it fits the work: the trade job and the software team, end to end

**A trade job:**
```
Lead form / Calendly booking ──► Contact (+ visit if booked) ──► Slack/Teams: "New lead: {contact}"
        │                                                     └► Sales agent: follow-up task
        ▼
Quote accepted ──► Job won ──► CompanyCam project matched ──► crew photos land on the job
        │
        ▼
Visit done (+ sign-off) ──► Invoice sent ──► Stripe/Square pays ──► QuickBooks/Xero gets it
        │                                                       └► Slack: "Paid: {amount}"
        ▼
Campaign: review request ──► Google review comes in ──► bell; Marketing agent drafts a Postiz post (waits for yes)
```

**A software team:**
```
Work item APP-12 ──► branch app-12-login ──► GitHub push (code log, Home card)
        ──► PR opened (item → Code review) ──► merged (→ Testing) ──► release v2.4 (release → Released)
        ──► Home "Code" card + Sidekick brief: "4 pushes to main, 1 PR merged, v2.4 out"
        ──► Flows: github.merged → Slack "#dev: {title} merged"
```

---

## 4. Easy setup: the standard every tile follows

1. **One button when possible.** OAuth: "Connect" → the app's own sign-in → back to the tile showing Connected and
   the account name.
2. **When a key or address has to be pasted:** numbered steps with where to click in the other app, a field that
   checks the format, and a **Test** button that makes a real (harmless) call and says plainly what's wrong.
3. **When the other app has to call Kloomie:** Kloomie registers its webhook itself through the app's API wherever
   the API allows (Calendly, Cal.com, CompanyCam, GitHub App, Square). When it can't (Teams), copy buttons plus a
   live "Waiting for the first message…" line that turns green when it arrives.
4. **Right after connecting:** a "What now" card with 2–3 recipes to switch on in one tap, and where the data will
   show ("Bookings show in Day and on the contact").
5. **Health:** Connected (green), Needs attention (red, with what to do), Not set up here (server keys missing),
   Set up (connected but one more step, for example GitHub with no repos ticked).
6. **Disconnect** is always on the tile, says what stops, and deletes the stored token.

---

## 5. The builders' contract

- **Tile:** edit your app's existing line in `APP_LIST` (client/app.js) from `soon(...)` to a live entry with
  `sec()` and `state()`. Keep the id.
- **Server module:** `server/<app>.js` exporting `<app>Module({...})`, the way github.js and postiz.js do. Routes
  under `/api/<app>/…`. Incoming webhooks at `/api/<app>/hook/<team token>` with the app's signature checked.
- **Registry (live, server/integrations.js):** export a `describe` object from your module with
  `{ id, name, scope: 'team'|'person', auth: 'oauth'|'key'|'webhook'|'none', tool?, configured(), status(ws, memberId) }`
  and add `APPS_REG.register(<MOD>.describe)` in index.js next to the others (after the module is made). `id` is the
  tile's id in `APP_LIST`. `status` returns `null` when not connected, else `{ account, by, byId, lastSync, error,
  needsReconnect, setup? }` read from what you store (no outside calls). Set `needsReconnect = true` where your
  module learns the sign-in or key was refused (a 401), and `false` on the next good call; the registry does the
  rest: the tile's Needs attention, one notice to `byId`, and `connection.lost`. `tool` (a member-access key) hides
  the app from members who don't have that tool. GET /api/integrations returns `{ apps, wanted, wants? }`.
- **Flows:** add your events to `EVENTS` in server/flows.js and `TOOLS` (one key per app). Fire them through
  `automate` from the one place the thing happens. Add actions in the runner next to `slack` / `webhook`.
- **Agents:** read tools only unless section 1.3 says otherwise. Add the tool name to the right agents' `tools`
  lists in server/agents.js.
- **Help:** a short section in client/help.html under Apps & Integrations, and a line in docs/INTEGRATIONS-MAP.md.
- **Tests:** a stand-in server for the outside app (like tests/fakecaldav.mjs). Never a real service. Use your own
  ports:

| Builder | Server ports | Chrome debug ports |
| --- | --- | --- |
| column-14 (GitHub) | 5300–5309 | 9600–9609 |
| column-02 (registry, health, Flows) | 5310–5319 | 9610–9619 |
| column-bb (Slack, Teams) | 5320–5329 | 9620–9629 |
| column-a9 (Calendly, Cal.com) | 5330–5339 | 9630–9639 |
| column-f9 (CompanyCam, review) | 5340–5349 | 9640–9649 |

- **Git:** work in your own worktree (`git worktree add ~/column-<app> origin/main`), stage only your files, run
  `node tests/dupnames.mjs` before pushing app.js, message the others before pushing, check CI after.
- **Server keys** the owner has to make (Slack app, Calendly app, GitHub App): write down exactly which keys and
  where, and tell column-14, who collects them for the owner in one list.

---

## 6. Who is building what (2026-11-19)

| Session | Building | Done when |
| --- | --- | --- |
| column-14 | GitHub team connection (GitHub App: connect once, tick repos), code log, Home **Code** card, Sidekick brief line, `code_activity` agent tool, `github.*` triggers; software boards pick a repo. Registers the GitHub App in the browser with the owner | owner connects, pushes show on Home |
| column-02 | `server/integrations.js` registry + `GET /api/integrations`, health (Needs attention, one notice, `connection.lost`), **Want this?** on not-built tiles, the access rules in 1.3 enforced for automations, recipe card after connecting | tiles read the registry; a broken token shows Needs attention |
| column-bb | Slack (Add to Slack OAuth; webhook address to start) + Microsoft Teams (Workflows webhook), `slack`/`teams` Flows actions, recipes | a recipe posts a new lead to a channel |
| column-a9 | Calendly (OAuth + webhook subscription) and Cal.com (API key + webhook), bookings → contact + calendar entry/visit, `booking.*` triggers | a booking makes a contact and shows in Day |
| column-f9 | CompanyCam (API token + webhook), photos onto jobs matched by address, `companycam.*` triggers; reviews the others' pushes against CODING-GUIDE and this map | a CompanyCam photo shows on the job |

**CompanyCam: LIVE (column-f9, 2026-11-20).** server/companycam.js on the documented v2 API (`COMPANYCAM_API`; v2 is supported until September 2027, and the newer public_api/v1 doesn't yet document webhook event names or payloads). The team token and webhook secret are sealed; deliveries are checked by `X-CompanyCam-Signature` (base64 HMAC-SHA1); photos come through safeFetch, image types only; photos land in the job's files field (`photos`), each once (`db.ccPhotos`); triggers `companycam.photo`, `companycam.project`; `describe` is exported for the registry. Erasing a team deletes its webhook in CompanyCam. Tests: tests/companycam.mjs, tests/companycam_ui.mjs (stand-in CompanyCam).
