#!/bin/zsh
# Runs the end-to-end tests against throwaway local servers: ./tests/run.sh [suite ...]
# Browser suites drive headless Google Chrome. pgtest needs TEST_DATABASE_URL set to a Neon
# test branch (never the live one) and is skipped without it. Real email is never sent.
T=${0:A:h}; W=$T/.work; D=$W/dk
mkdir -p $D
cd $T/../server
start() {
  lsof -ti:4797,4795,4799 | xargs kill 2>/dev/null; sleep 1
  rm -rf $D/data $D/data2 $D/chrome2 $D/chrome3 $D/chrome4
  (cd $D && node $T/fakeai.mjs $D/ai.log > $D/fakeai.out 2>&1 &)
  PORT=4797 DATA_DIR=$D/data MAIL_OUTBOX=1 ALLOW_LOCAL_WEBHOOKS=1 ANTHROPIC_BASE_URL=http://127.0.0.1:4799 DATABASE_URL= node index.js > $D/s1.log 2>&1 &
  PORT=4795 DATA_DIR=$D/data2 DATABASE_URL= node index.js > $D/s2.log 2>&1 &
  sleep 3
}
all=(leader toolsteps cast deps budget proj api3 quote conn aiproj contacts contactsui admin visibility docsign gmail billing billingui acct acct3 req seal tasksui tz e2e e2e2 e2e3 e2e4 e2e5 e2e6 e2e7 e2e8 acctui acctui2 tzui delteam delui leave leaveui export expui alerts pgtest)
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
lsof -ti:4797,4795,4799 | xargs kill 2>/dev/null
exit $failed
