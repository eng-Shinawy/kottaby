#!/usr/bin/env bash
# ==== Leg 1: Student A books a Hifz session with Teacher T (fee hold at booking) ====
set -u
export PATH=/home/z/pgroot/usr/lib/postgresql/17/bin:$PATH
K=/home/z/my-project
E2E=$K/scripts/escrow-e2e
OUT=$K/download/escrow-e2e
mkdir -p "$OUT"


# 1. Start server (or reuse if up)
cd $K
bash $E2E/boot-server.sh || exit 1

# 2. Login student A (API actor)
$E2E/escrow-login.sh escrow-student-a@vlm.local 'Password123!' sA

# 3. Baseline DB state
echo "=== BASELINE: student A lanes ==="
psql -h 127.0.0.1 -U postgres -d kottaby_db -c "SELECT balance_trial, balance_hifz FROM students s JOIN users u ON u.id=s.id WHERE u.email='escrow-student-a@vlm.local';"
TEACHER_ID=$(psql -h 127.0.0.1 -U postgres -d kottaby_db -tAc "SELECT id FROM users WHERE email='escrow-teacher-t@vlm.local'")
echo "TEACHER_ID=$TEACHER_ID"

# 4. createSession as student A (Hifz intent, idempotency key)
cat > $E2E/.payload-book1.json << EOF
{"query":"mutation Book(\$input: CreateSessionInput!) { createSession(input: \$input) { id status fee feeHeld intent teacherId } }","variables":{"input":{"intent":"Hifz","teacherId":"$TEACHER_ID"}}}
EOF
# Assign on its own line: a command-prefixed assignment is applied only after
# the parent shell expands the curl arguments, so with `set -u` the header
# expansion below would abort (or reuse a stale preexisting value).
IDEMPOTENCY_KEY="vlm-escrow-book-$(date +%s%N)-$$"
curl -s -X POST http://127.0.0.1:3000/api/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat $E2E/.token-sA)" \
  -H "X-Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d @$E2E/.payload-book1.json --max-time 60 | tee $OUT/01-create-session-response.json | python3 -m json.tool

SESSION_ID=$(python3 -c "import json; print(json.load(open('$OUT/01-create-session-response.json'))['data']['createSession']['id'])")
echo "$SESSION_ID" > $E2E/.session-1-id
echo "SESSION_ID=$SESSION_ID"

# 5. DB assertions: fee held + lane debited
echo "=== AFTER BOOKING: session row ==="
psql -h 127.0.0.1 -U postgres -d kottaby_db -c "SELECT id, status, fee, fee_held, held_balance_lane, teacher_id FROM session WHERE id=$SESSION_ID;"
echo "=== AFTER BOOKING: student A lanes (expect hifz 2->1) ==="
psql -h 127.0.0.1 -U postgres -d kottaby_db -c "SELECT balance_trial, balance_hifz FROM students s JOIN users u ON u.id=s.id WHERE u.email='escrow-student-a@vlm.local';"

# 6. Student A browser: sessions page screenshot
$E2E/escrow-login.sh escrow-student-a@vlm.local 'Password123!' sA > /dev/null
agent-browser --session sA set viewport 1440 900
agent-browser --session sA open http://127.0.0.1:3000/student/sessions
agent-browser --session sA wait --load networkidle --timeout 60000 || true
sleep 4
agent-browser --session sA screenshot $OUT/01-student-a-sessions-after-booking.png && echo "SCREENSHOT 01 OK"
agent-browser --session sA snapshot -i 2>/dev/null | head -40

# 7. Stop server
bash $E2E/stop-server.sh
echo "=== LEG 1 DONE ==="
