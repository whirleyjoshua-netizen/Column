#!/bin/zsh
# Runs the end-to-end tests against throwaway local servers: ./tests/run.sh [suite ...]
# Browser suites drive headless Google Chrome. pgtest needs TEST_DATABASE_URL set to a Neon
# test branch (never the live one) and is skipped without it. Real email is never sent.
T=${0:A:h}; W=$T/.work; D=$W/dk
mkdir -p $D
cd $T/../server
start() {
  lsof -ti:4797,4795,4799,4794 | xargs kill 2>/dev/null; sleep 1
  rm -rf $D/data $D/data2 $D/chrome2 $D/chrome3 $D/chrome4
  (cd $D && node $T/fakeai.mjs $D/ai.log > $D/fakeai.out 2>&1 &)
  (node $T/fakecaldav.mjs > $D/fakecaldav.out 2>&1 &)
  SKIP_SETUP=1 PORT=4797 DATA_DIR=$D/data APPLE_CALDAV=http://127.0.0.1:4794 MAIL_OUTBOX=1 ALLOW_LOCAL_WEBHOOKS=1 ANTHROPIC_BASE_URL=http://127.0.0.1:4799 DATABASE_URL= node index.js > $D/s1.log 2>&1 &
  SKIP_SETUP=1 PORT=4795 DATA_DIR=$D/data2 DATABASE_URL= node index.js > $D/s2.log 2>&1 &
  sleep 3
}
all=(mileage push apiwide quickbooks qboui twostep twostepui zapier twilio cloudui leads hq hqeval rules hqlearn tech tech2 tech3 tech4 tech5 techai agents agentsui agent_build_ui marketing marketingui setupui chatlinks chatlinksui chatpins chatpinsui chatsign chatsignui chatask chataskui chatpanelsui tabbar pins applecal slash vaultquick custmsg invoices routes jobs onboard automations gcontacts skplan leader toolsteps cast deps budget proj api3 quote conn aiproj contacts contactsui admin visibility docsign gmail billing billingui acct acct3 req seal tasksui tz e2e e2e2 e2e3 e2e4 e2e5 e2e6 e2e7 e2e8 acctui acctui2 tzui delteam delui leave leaveui export expui alerts pgtest cards cards_ui assets assets_ui engine_ui docs_pages docs_pages_ui docs_view_ui docs_home_ui notion_import notion_import_ui shadow_ui docs_blocks docs_blocks_ui docs_ask docs_ask_ui docs_wiki docs_wiki_ui flows_bus flows_bus_ui flows_steps flows_steps_ui flows_actions flows_actions_ui flows_vault flows_vault_ui flows_builder flows_builder_ui flows_agent flows_recipes_ui inventory inventory_ui inventory_equipment inventory_equipment_ui inventory_links inventory_links_ui inventory_counts inventory_steps inventory_orders projects_archive cards_show inventory_labels inventory_labels_ui camp_builder_ui tools_chat_ui chat_tab_ui inventory_requests inventory_requests_ui member_access member_access_ui inventory_reorder_ui inventory_orders_ui stacks_bottom_ui news news_ui shell_ui desktop_mode skdock_ui dayweek_ui taskswork_ui taskmonth_ui savedtasks_ui finance_jobs_ui finance_jobs finance_view_ui finance_view price_list_ui price_list costing_ui costing_truth finance_report_ui finance_report receipts_ui receipts price_changed visit_setups_ui saved_asks_ui side_sheet_ui companycam_ui companycam teamload_ui taskpresets workswitch_ui wide_ui templates_ui pjnew_ui boards_ui contact_groups_ui pinsplit_ui apps_ui githubapp githubapp_ui integrations integrations_ui bookings_ui settings_ui teampage_ui shifts_ui hours_ui analytics_ui sidebar_nav_ui back_ui step_window_ui mobile_shell_ui cc_ui cc_plan_ui plan_autos_ui plan_tools_ui task_autos whiteboard_ui campaign_board_ui test_run_ui campaign_views_ui sop_ui workorder_ui report_ui jobs_ui)
(( $# )) && all=("$@")
failed=0
for t in $all; do
  if [[ $t == pgtest && -z $TEST_DATABASE_URL ]]; then printf '%-8s %s\n' $t 'skipped (no TEST_DATABASE_URL)'; continue; fi
  start; pkill -f "remote-debugging-port=93"
  out=$(node $T/$t.mjs $W 2>&1); rc=$?
  printf '%-8s %s\n' $t "$(echo $out | tail -1)"
  echo $out | grep FAIL | sed 's/^/         /'
  echo $out | grep -q FAIL && failed=1
  (( rc )) && { echo $out | grep -m3 'Error' | sed 's/^/         /'; failed=1 }
done
lsof -ti:4797,4795,4799,4794 | xargs kill 2>/dev/null
exit $failed
