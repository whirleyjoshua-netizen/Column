# Kloomie for Zapier

A Zapier integration built on Kloomie's public API (`/api/v1`, documented at https://app.kloomie.com/developers).

**Sign-in:** a Kloomie API key (Apps & Integrations → Developers → New API key), plus the Kloomie address
(defaults to https://app.kloomie.com).

**Triggers** (instant: each Zap subscribes its own webhook, and every delivery's `X-Kloomie-Signature` is checked):
New Contact, Updated Contact, New Task, Task Completed, Visit Booked, Visit Moved or Changed, Visit Done, Visit Called
Off, Invoice Sent, Invoice Paid, Payment Received, Files Received, Document Signed.

**Actions:** Create or Update Contact (matches someone with the same email or phone), Update Contact, Create Task,
Complete Task, Book Visit, Record Payment (a reference is only counted once).

**Searches:** Find Contact (email or phone), Find Invoice (by number), and Find or Create Contact.

## Test

From the repo root, after `npm install` here:

```
node tests/zapier.mjs <scratch folder>
```

It starts its own Kloomie server and runs every trigger, action and search through Zapier's own test runner.

## Publish

Once, with your Zapier account:

```
npm install -g zapier-platform-cli
zapier login
cd integrations/zapier
zapier register "Kloomie"      # makes the integration in your Zapier account (writes .zapierapprc)
zapier push                    # uploads this version
```

After that, `zapier push` uploads changes (bump `version` in package.json for a new version, then `zapier promote`).
The integration starts private: share the invite link from the Zapier developer platform with customers, and submit
it for the public Zapier directory when it has a few live users.
