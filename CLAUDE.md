# Kloomie

Kloomie (formerly Column) is a team workspace sold to small and trade businesses. Server: `server/` (Node 24, one
process, data in memory written to Postgres on Neon or a file). Client: `client/` (plain JS). Desktop app: `desktop/`
(Electron). Live at app.kloomie.com on Railway; every push to `main` deploys.

## Before writing code
- Read **docs/CODING-GUIDE.md**: the rules learned from the November 2026 audit (one rule on every path, visibility
  travels with the data, no secrets in URLs, timeouts on outside calls, outside text is data, text into pages as text,
  limits on what costs, drill the restore). Its checklist applies to every change.
- Running the service, backups, restoring and rolling back: **docs/OPERATIONS.md**.
- Every audit finding, its fix and its test: docs/audit/FINDINGS.md.

## Tests
- Write the test first and see it fail on the old code.
- `bash tests/ci.sh` runs the tests that need no browser (GitHub runs it on every push). `tests/run.sh` runs the
  whole suite on a Mac, including Chrome and desktop tests; it uses (and frees) ports 4794–4799.
- Each test owns its ports and data folder. Tests that connect an account with plain fetch import
  `tests/cookiejar.mjs`; WebSockets send `authorization: Bearer`, never `?t=<sign-in>`.
- Never point a test at the live database. `tests/restore_drill.mjs` refuses anything but a database named "*drill*".

## Conventions
- Sign-ins are stored by hash (`auth.token` is the hash inside the server). URLs carry `S.me.fileKey`, never the
  sign-in.
- Secrets go through `seal`/`unseal`. Outside addresses go through `safeFetch` (server/safefetch.js). OAuth starts
  and callbacks go through `oauthBind` (server/oauthbind.js).
- Rules that need an OK (server/rules.js `hold`) are called from every path, the public API included.
- Other Claude sessions work in this repo too: stage only your own changes, never `git stash` without a unique tag,
  and check with the others before pushing.
