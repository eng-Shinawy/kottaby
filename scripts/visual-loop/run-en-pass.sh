#!/usr/bin/env bash
# Staged EN capture run over the four plan-#140 surfaces.
# Usage: run-en-pass.sh <stage 1|2>
#   1 = student empty/escrow rows + teacher escrow/wallet-empty
#   2 = lifecycle advance + student completed + settlement + wallet credited + admin
# Assumes: prod test server UP on :3000 (pglite), clean state (reset-state.sh ran).
set -u
K=/home/z/my-project
E2E=$K/scripts/escrow-e2e
VL=$K/scripts/visual-loop
CAP="$VL/capture.sh"
STAGE="${1:-1}"
cd $K

STUDENT=student@draftacademy.local
TEACHER=teacher@draftacademy.local
ADMIN=admin@app.local
PASS=adminpassword123

ok=0; fail=0
shot() { # session W H url name title marker
  if bash "$CAP" "$1" "$2" "$3" "$4" "$5" "$6" "$7" 12; then
    ok=$((ok+1)); else fail=$((fail+1)); fi
}

if [ "$STAGE" = "1" ]; then
echo "=== PASS 1: STUDENT (fresh login) ==="
$E2E/escrow-login.sh $STUDENT $PASS sA | tail -1
agent-browser --session sA cookies set NEXT_LOCALE en --domain 127.0.0.1 >/dev/null 2>&1
T_SA=$(cat $E2E/.token-sA)
shot sA 1440 900 "http://127.0.0.1:3000/student/sessions" "01-student-empty-desktop.png" "My Sessions" "No sessions yet"
shot sA 834 1112 "http://127.0.0.1:3000/student/sessions" "01-student-empty-tablet.png" "My Sessions" "No sessions yet"
shot sA 390 844 "http://127.0.0.1:3000/student/sessions" "01-student-empty-mobile.png" "My Sessions" "No sessions yet"

# book Hifz (escrow hold on trial lane)
curl -s -X POST http://127.0.0.1:3000/api/graphql -H "Content-Type: application/json" \
  -H "Authorization: Bearer $T_SA" -H "X-Idempotency-Key: vloop-book1-$(date +%s)" \
  -d '{"query":"mutation Book($input: CreateSessionInput!) { createSession(input: $input) { id status fee feeHeld } }","variables":{"input":{"intent":"Hifz","teacherId":2}}}' \
  --max-time 60 | tee $K/scratch/book1.json | head -c 150; echo
# insufficient-balance evidence (second booking, all lanes 0)
curl -s -X POST http://127.0.0.1:3000/api/graphql -H "Content-Type: application/json" \
  -H "Authorization: Bearer $T_SA" -H "X-Idempotency-Key: vloop-book2-$(date +%s)" \
  -d '{"query":"mutation Book($input: CreateSessionInput!) { createSession(input: $input) { id status fee } }","variables":{"input":{"intent":"Hifz","teacherId":2}}}' \
  --max-time 60 | tee $K/scratch/book2-insufficient.json | head -c 200; echo

shot sA 1440 900 "http://127.0.0.1:3000/student/sessions" "02-student-escrow-row-desktop.png" "My Sessions" "Hifz"
shot sA 834 1112 "http://127.0.0.1:3000/student/sessions" "02-student-escrow-row-tablet.png" "My Sessions" "Hifz"
shot sA 390 844 "http://127.0.0.1:3000/student/sessions" "02-student-escrow-row-mobile.png" "My Sessions" "Hifz"

echo "=== PASS 2: TEACHER (fresh login) ==="
$E2E/escrow-login.sh $TEACHER $PASS sT | tail -1
agent-browser --session sT cookies set NEXT_LOCALE en --domain 127.0.0.1 >/dev/null 2>&1
T_ST=$(cat $E2E/.token-sT)
shot sT 1440 900 "http://127.0.0.1:3000/teacher/sessions" "03-teacher-escrow-desktop.png" "Teaching Sessions" "Hifz"
shot sT 834 1112 "http://127.0.0.1:3000/teacher/sessions" "03-teacher-escrow-tablet.png" "Teaching Sessions" "Hifz"
shot sT 390 844 "http://127.0.0.1:3000/teacher/sessions" "03-teacher-escrow-mobile.png" "Teaching Sessions" "Hifz"
shot sT 1440 900 "http://127.0.0.1:3000/wallet" "04-wallet-empty-desktop.png" "My Wallet" "0.00"
fi

if [ "$STAGE" = "2" ]; then
echo "=== PASS 3: TEACHER advances lifecycle ==="
$E2E/escrow-login.sh $TEACHER $PASS sT | tail -1
agent-browser --session sT cookies set NEXT_LOCALE en --domain 127.0.0.1 >/dev/null 2>&1
T_ST=$(cat $E2E/.token-sT)
SID=$(python3 -c "import json; print(json.load(open('$K/scratch/book1.json'))['data']['createSession']['id'])" 2>/dev/null)
if [ -z "$SID" ]; then echo "SID MISSING — run stage 1 first (fresh booking must succeed)"; exit 1; fi
echo "Using session id: $SID"
curl -s -X POST http://127.0.0.1:3000/api/graphql -H "Content-Type: application/json" \
  -H "Authorization: Bearer $T_ST" \
  -d "{\"query\":\"mutation { startSession(id: \\\"$SID\\\") { id status } }\"}" --max-time 60 | head -c 120; echo
curl -s -X POST http://127.0.0.1:3000/api/graphql -H "Content-Type: application/json" \
  -H "Authorization: Bearer $T_ST" \
  -d "{\"query\":\"mutation { completeSession(id: \\\"$SID\\\") { id status } }\"}" --max-time 60 | head -c 120; echo

$E2E/escrow-login.sh $STUDENT $PASS sA | tail -1
agent-browser --session sA cookies set NEXT_LOCALE en --domain 127.0.0.1 >/dev/null 2>&1
shot sA 1440 900 "http://127.0.0.1:3000/student/sessions" "05-student-completed-desktop.png" "My Sessions" "Confirm"
shot sA 390 844 "http://127.0.0.1:3000/student/sessions" "05-student-completed-mobile.png" "My Sessions" "Confirm"

echo "=== PASS 4: STUDENT confirms -> settlement ==="
curl -s -X POST http://127.0.0.1:3000/api/graphql -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat $E2E/.token-sA)" \
  -d "{\"query\":\"mutation { confirmSessionCompletion(id: \\\"$SID\\\") { id status feeHeld } }\"}" --max-time 60 | head -c 150; echo

$E2E/escrow-login.sh $TEACHER $PASS sT | tail -1
agent-browser --session sT cookies set NEXT_LOCALE en --domain 127.0.0.1 >/dev/null 2>&1
shot sT 1440 900 "http://127.0.0.1:3000/wallet" "06-wallet-credited-desktop.png" "My Wallet" "25.00"
shot sT 834 1112 "http://127.0.0.1:3000/wallet" "06-wallet-credited-tablet.png" "My Wallet" "25.00"
shot sT 390 844 "http://127.0.0.1:3000/wallet" "06-wallet-credited-mobile.png" "My Wallet" "25.00"
shot sT 1440 900 "http://127.0.0.1:3000/teacher/sessions" "07-teacher-completed-desktop.png" "Teaching Sessions" "Completed"

echo "=== PASS 5: ADMIN ==="
$E2E/escrow-login.sh $ADMIN $PASS sAd | tail -1
agent-browser --session sAd cookies set NEXT_LOCALE en --domain 127.0.0.1 >/dev/null 2>&1
shot sAd 1440 900 "http://127.0.0.1:3000/admin/session-governance" "08-admin-governance-desktop.png" "Session" "Session"
shot sAd 834 1112 "http://127.0.0.1:3000/admin/session-governance" "08-admin-governance-tablet.png" "Session" "Session"
shot sAd 390 844 "http://127.0.0.1:3000/admin/session-governance" "08-admin-governance-mobile.png" "Session" "Session"
fi

echo "=== STAGE $STAGE DONE ok=$ok fail=$fail ==="
# CI gate: any failed capture must fail the pass.
[ "$fail" -eq 0 ] || exit 1
