#!/usr/bin/env bash
# The tests that run anywhere: no browser, no shared server, each on its own ports with stand-ins for outside
# services. GitHub runs them on every push and pull request (.github/workflows/tests.yml); locally:
#   bash tests/ci.sh [workdir]
# Browser tests (Chrome, the desktop app) and the ones that share a server still run with tests/run.sh on a Mac.
set -u
cd "$(dirname "$0")"
WORK="${1:-${RUNNER_TEMP:-/tmp}/kloomie-ci}"
mkdir -p "$WORK"
TESTS="admin agents alerts apiwide assets audit_access audit_agents audit_agents2 audit_agents3 audit_auth audit_batch10
  audit_batch7 audit_billing audit_billing2 audit_critical audit_dates audit_misc audit_money audit_oauth audit_quote
  audit_rules audit_safefetch audit_send audit_signin audit_signoff audit_storage audit_urls billing cards chatlinks chatpins chatsign chatask chatagent contacts workload
  custmsg delteam flows_bus flows_steps flows_actions flows_vault flows_builder flows_agent jobcampaign jobsteps inventory inventory_equipment inventory_links inventory_counts docs_ask docs_blocks docs_pages docs_wiki dropbox dupnames engine templates notion_import seo export gcontacts gmail hq hqeval hqlearn invoices leads leadsources marketing news onboard
  quickbooks routes rules tech tech2 tech3 tech4 tech5 techai twilio twostep visibility zapier"
failed=()
for t in $TESTS; do
  start=$(date +%s)
  out=$(node "$t.mjs" "$WORK" 2>&1)
  rc=$?
  echo "$t: $(echo "$out" | tail -1) ($(( $(date +%s) - start ))s)"
  if [ $rc -ne 0 ]; then
    failed+=("$t")
    echo "$out" | grep -E "^FAIL|Error" | head -10 | sed 's/^/    /'
  fi
done
if [ ${#failed[@]} -gt 0 ]; then
  echo "Failed: ${failed[*]}"
  exit 1
fi
echo "All passed."
