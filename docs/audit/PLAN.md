# Kloomie code audit and security hardening (started 2026-11-10)

**Soft freeze while this runs:** sessions push bug fixes only, no new features, until the audit closes. Message before every push (see `check-other-sessions`).

## Rules
- **Prove it first.** A finding counts only once it's reproduced: a failing test or an exact request against a private local server, or against the live site using only the throwaway QB Test team. Anything that can't be reproduced is listed as unconfirmed, never fixed on a guess.
- **Fix at the root**, then search the whole codebase for the same pattern.
- **Lock it in.** Every fix ships with the test that proved it, and the full suite is run before each push.
- **Small commits**, one finding or one root cause each, named by finding ID.

## Phases
1. **Groundwork:** route and permission inventory, data map, threat model, baseline test run, library and secret scans, live headers.
2. **Security:** sign-in and accounts (A), team isolation and roles (B), public pages and server-built HTML (C), files and storage (D), connections, webhooks, outbound requests and stored secrets (E), AI agents and automations (F).
3. **Correctness:** money, time, data integrity, concurrency and validation (G); clients, desktop and service worker (H).
4. **Operations:** backups and a restore drill, tests on every push, monitoring, pinned versions.
5. **Report:** what was found, what was fixed, what's left on purpose and why.

## Baseline (2026-11-10, commit 2c97941)
- `npm audit --omit=dev`: 0 known vulnerabilities in server, desktop and integrations/zapier.
- Git history secret scan (Stripe, Anthropic, OpenAI, AWS, Google, Slack, GitHub, Resend keys, database URLs, private keys): no real secrets. The one database URL match is a template in a test.
- Live headers: see findings GRD-1 to GRD-3.
- Test suite: see `baseline.md`.
