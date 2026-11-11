# Running Kloomie: backups, restoring, deploys, monitoring

How the live service at app.kloomie.com is kept safe, and what to do when something goes wrong. Written during the
November 2026 audit (docs/audit/), after a restore drill on a throwaway database.

## What runs where

| Piece | Where | Notes |
|---|---|---|
| The app (one server) | Railway, service `Column`, region us-west2 | Builds from `main` on every push (`.railway/railway.ts`). Health check `/api/health`. |
| Data (everything but files) | Neon Postgres, project `column` (patient-salad-03357674), branch `main` | Kept in memory; each change is written to `column_records` within about 2 seconds. Free plan: **6 hours of history**, **1 GB per branch** (32 MB used in November 2026). |
| Files (uploads, signed PDFs, exports, logos) | Railway volume `column-volume`, mounted at `/data` (5 GB, alerts at 80/95/100%) | **Not backed up anywhere else yet.** See "Gaps" below. |
| Daily backups of the data | `/data/backups/db-YYYY-MM-DD.json` on the same volume | One a day, made the first time the server runs that day (at start, then hourly); the last 14 are kept. Secrets inside are sealed with `COLUMN_SECRET_KEY`; sign-ins are stored only as hashes. |
| Secret key | Railway variable `COLUMN_SECRET_KEY` (64 hex characters) | Seals every token, API key and password-like secret. **Without it, a backup's connections (Google, QuickBooks, Stripe keys of teams, webhooks) can't be opened.** Keep a copy in a password manager. A malformed key stops the server on purpose. |
| Uptime | UptimeRobot monitor on `https://app.kloomie.com/api/up` | Emails when the site is down. |
| Error alerts | `ALERT_EMAIL` (admin@kloomie.com) | Crashes, 500s, saving failing 3 times, backups failing, erasing teams, a failed QuickBooks payment removal, and more (`alarm()` in server/index.js). |
| Tests | GitHub Actions `Tests` (`.github/workflows/tests.yml`, `tests/ci.sh`) on every push and pull request | The browser and desktop-app tests run on a Mac with `tests/run.sh`. |

## How much can be lost

- **A bad change or a deleted team, noticed within 6 hours:** nothing. Restore Neon to a point before it (below).
- **Noticed later:** back to the start of that day (the daily backup), so up to about a day, for up to 14 days back.
- **The Railway volume is lost:** the data is safe in Neon; **files are lost** (no copy elsewhere yet), along with the daily backups.
- **Neon is lost:** the daily backup on the volume (up to a day old).

## Restoring

### A. Neon point in time (within 6 hours)
1. In the Neon console, project `column`, branch `main`: Restore → pick a time just before the problem. Neon keeps
   the current state as a backup branch, so this can be undone.
2. Restart the Railway service (Deployments → Restart) so the server loads the restored data. The server keeps
   everything in memory, so a restore without a restart would be written over.
3. Check: sign in, open the affected team, look at `/api/health` (`"data":"postgres","saving":"ok"`).

### B. A daily backup (Kloomie's own)
Drilled on a throwaway database with `tests/restore_drill.mjs` (see "Drills").
1. Pick the file: `railway ssh` into the service, then `ls -la /data/backups`.
2. Copy it into place: `cp /data/backups/db-YYYY-MM-DD.json /data/import-pending.json`.
3. Restart the service. On start the server logs `Moving import-pending.json into Postgres.`, replaces everything in
   Postgres with the backup, and renames the file to `import-pending.json.done` once written, so it's taken in once.
4. Everyone's sign-ins from that day keep working; anything changed after the backup is gone.
5. The same `COLUMN_SECRET_KEY` must be set, or connections in the backup can't be opened.

### C. One team only
Not built in. Restore a backup into a throwaway server locally (file mode: `DATA_DIR=… node server/index.js` with the
backup as `db.json`), export what's needed, and put it back by hand. Ask before doing this with real customer data.

## Deploys and rolling back
- Every push to `main` deploys. Railway → Deployments → an earlier one → Redeploy rolls back the code.
- **Data changes that don't roll back by themselves:** audit batch 9 stores sign-ins as hashes. Rolling back to code
  from before that (before 636af22) signs everyone out once. Webhook secrets are sealed since batch 7; older code
  can't read them (deliveries would fail until rolled forward).
- Before pushing: run the suite (`tests/run.sh` on a Mac, or at least `bash tests/ci.sh`), and check other sessions
  aren't mid-push.

## Drills
- **Restore drill:** `DRILL_DATABASE_URL=… node tests/restore_drill.mjs <workdir>` on a throwaway database (it
  refuses `neondb` and any name without "drill"). Made-up data only. Last run: see docs/audit/FINDINGS.md (Ops).
  Do it again after any change to saving, loading or backups, and every few months.
- **Neon restore:** once a quarter, restore a test branch to a point in time and check it.

## Gaps (decisions for the owner)
1. **Files have no backup.** Options: Railway's volume backups (Railway dashboard → the volume → Backups; check the
   plan), or move files to object storage (planned "phase 2"). Until then a lost volume loses every upload.
2. **6 hours of Neon history.** A paid Neon plan keeps 7 days or more.
3. **Backups sit on the same volume as the files.** A copy somewhere else (another provider, or Neon itself) would
   survive losing the volume.
4. **Railway deploys without waiting for the tests** (`checkSuites: false` in `.railway/railway.ts`). With the
   `Tests` workflow in place, `checkSuites: true` makes Railway wait for it.
5. **One server, no standby.** A Railway region problem takes the site down until it's back.
6. **The desktop app isn't signed or notarized** (needs an Apple Developer ID and a Windows code-signing certificate).
