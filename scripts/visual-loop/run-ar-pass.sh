#!/usr/bin/env bash
# AR (RTL) capture pass over the plan-#140 surfaces with meaningful RTL risk.
# Usage: run-ar-pass.sh   (run AFTER stage 2 so the wallet is credited)
set -u
K=/home/z/my-project
E2E=$K/scripts/escrow-e2e
VL=$K/scripts/visual-loop
CAP="$VL/capture.sh"
cd $K

STUDENT=student@draftacademy.local
TEACHER=teacher@draftacademy.local
PASS=adminpassword123

ok=0; fail=0
shot() { # session W H url name title marker
  if bash "$CAP" "$1" "$2" "$3" "$4" "$5" "$6" "$7" 12; then
    ok=$((ok+1)); else fail=$((fail+1)); fi
}

echo "=== AR PASS: STUDENT ==="
$E2E/escrow-login.sh $STUDENT $PASS arA | tail -1
agent-browser --session arA cookies set NEXT_LOCALE ar --domain 127.0.0.1 >/dev/null 2>&1
shot arA 1440 900 "http://127.0.0.1:3000/student/sessions" "09-student-sessions-ar-desktop.png" "جلساتي" "Hifz"
shot arA 390 844 "http://127.0.0.1:3000/student/sessions" "09-student-sessions-ar-mobile.png" "جلساتي" "Hifz"

echo "=== AR PASS: TEACHER WALLET (credited) ==="
$E2E/escrow-login.sh $TEACHER $PASS arT | tail -1
agent-browser --session arT cookies set NEXT_LOCALE ar --domain 127.0.0.1 >/dev/null 2>&1
shot arT 390 844 "http://127.0.0.1:3000/wallet" "09-wallet-ar-mobile.png" "محفظتي" "25.00"

echo "=== AR PASS DONE ok=$ok fail=$fail ==="
# CI gate: any failed capture must fail the pass.
[ "$fail" -eq 0 ] || exit 1
