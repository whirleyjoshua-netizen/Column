# Every call that emails or texts someone outside the team

PHASE3B.md §1 and §7. Each call of a sender in `server/` is listed here with how a person's OK covers it. The test
`tests/customer_sends.mjs` counts the calls of each sender in each file and fails when the code and this list differ,
so a new call can't land without saying how it's covered.

**It's a text count, not a parser.** It counts the sender names below wherever they're called (definitions and
comment lines aside). A call made some other way (a sender passed around under another name) isn't counted, so
review checks for that too, and any new sender joins the list of names in the test.

Categories (fixed; the test refuses others):
- **ticket**: a person started it and confirmed the preview (§1, the two-call send with a one-time ticket).
- **auto step**: a Job Flow message set to "Send by itself" (§2). Left out, a step asks first.
- **team switch**: Settings → Customer messages, a switch an owner turned on that says it sends by itself.
- **approval**: a person already said yes elsewhere: an agent's draft they accepted, an approved hold or the Flows
  hold for an automation, the Mail tool's own review before a campaign goes.
- **own action**: a receipt for what the customer themself just did (today only the signed copy after signing).
- **internal**: to the team itself, never a customer.

## The routes a person sends from (each asks first)

| Route | Ticket route name |
| --- | --- |
| POST /jobs/:id/quote/send | `quote` |
| POST /visits/:id/on-my-way | `on-my-way` (not when the phone's own Messages app sends it) |
| POST /visits/:id/remind | `remind` |
| POST /records/:id/review-request | `review` |
| POST /contacts/:id/texts | `text` |
| POST /contacts/:id/email | `contact-email` (an automation's email arrives already OK'd through the Flows hold) |
| POST /signoff/:r/:f/send | `sign-send` |
| POST /signoff/:r/:f/remind | `sign-remind` |
| POST /signs/:id/email | `sign-email` |
| POST /profile/proofs | not a send: it makes a link and emails nobody. If it ever emails, it gets a ticket. |
| POST /jobs/:id/steps/:sid/message | Send / Don't send on a waiting message (§2): the press is the OK |

## The calls

| File | Sender | Calls | Covered by | Where |
| --- | --- | --- | --- | --- |
| `server/index.js` | `mailer.customerEmail(` | 3 | ticket, auto step, team switch, approval, own action | tellCustomer (every customer message below); SIGNOFF_MAIL (sign links, signed copies); agentEmail (Kloomie's address when no mailbox) |
| `server/index.js` | `tellCustomer(` | 4 | ticket, auto step, team switch | flowTell (Job Flows); onMyWay; remindVisit and askReview (the ticketed routes, and the team switches' daily run) |
| `server/index.js` | `flowTell(` | 1 | auto step, ticket | handed to Job Flows (the calls in jobflows.js) |
| `server/index.js` | `twilioText(` | 1 | ticket | On my way by text from the team's number |
| `server/index.js` | `sendText(` | 2 | ticket, auto step, team switch | twilioText; tellCustomer's text |
| `server/index.js` | `.sendMail(` | 5 | approval, ticket, internal | Mail tool campaign (its review); Email the signing link (`sign-email`); the Mail tool's test email to yourself; emailSignLink from the sender's mailbox (`sign-send`, `sign-remind`); agentEmail from a mailbox (`contact-email`, accepted agent drafts) |
| `server/index.js` | `SIGNOFF_MAIL(` | 2 | own action, ticket | emailCustomer (the signed copy); emailSignLink through Kloomie |
| `server/index.js` | `agentEmail(` | 1 | ticket, approval | POST /contacts/:id/email |
| `server/jobflows.js` | `flowTell(` | 6 | ticket, auto step | Send the quote (`quote`); Send on a waiting message; the current step's message, the quote follow-up, the invoice email, payment reminders, each only when set to send by itself |
| `server/signoff.js` | `emailCustomer(` | 1 | own action | the signed copy, after the customer signs |
| `server/signoff.js` | `emailSignLink(` | 2 | ticket | `sign-send`, `sign-remind` |
| `server/twilio.js` | `sendText(` | 2 | ticket, internal | `text`; the "texting works" test to the owner's own number |
