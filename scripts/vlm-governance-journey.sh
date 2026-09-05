#!/usr/bin/env bash
# Run apollo server in foreground, then execute a battery of curl tests.
set -e
cd /home/z/my-project

# Kill any stale servers
pkill -f "vlm-apollo" 2>&1 || true
sleep 1

# Start apollo server in background, capture logs to file
setsid bash -c 'cd /home/z/my-project && exec bun run scripts/vlm-apollo-server.ts' > /tmp/apollo.log 2>&1 < /dev/null &
APOLLO_PID=$!
disown

# Wait for server to come up
echo "Waiting for Apollo server..."
for i in 1 2 3 4 5 6 7 8 9 10; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:4000/graphql -X POST -H "Content-Type: application/json" -d '{"query":"{__typename}"}' 2>&1 || echo "000")
  if [ "$CODE" = "200" ]; then
    echo "Server UP after $i checks"
    break
  fi
  sleep 2
done

if [ "$CODE" != "200" ]; then
  echo "Server failed to start. Log:"
  tail -30 /tmp/apollo.log
  pkill -f "vlm-apollo" 2>&1 || true
  exit 1
fi

# Helper: GraphQL POST with optional auth header
gql() {
  local token="$1"
  local query="$2"
  local vars="$3"
  if [ -n "$token" ]; then
    curl -s -X POST http://127.0.0.1:4000/graphql \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $token" \
      --max-time 30 \
      -d "{\"query\":$(echo "$query" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')${vars:+,\"variables\":$vars}}"
  else
    curl -s -X POST http://127.0.0.1:4000/graphql \
      -H "Content-Type: application/json" \
      --max-time 30 \
      -d "{\"query\":$(echo "$query" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')${vars:+,\"variables\":$vars}}"
  fi
}

mkdir -p /home/z/my-project/download/vlm-screenshots
SHOT_DIR=/home/z/my-project/download/vlm-screenshots

echo ""
echo "============================================================"
echo "PHASE 1: Anonymous probe (UNAUTHORIZED expected)"
echo "============================================================"
gql "" "query { adminUserDetail(id: 3) { id email suspended isBlocked } }" | python3 -m json.tool 2>&1 | tee /tmp/test-1-anon.json
echo ""

echo "============================================================"
echo "PHASE 2: Admin A login"
echo "============================================================"
ADMIN_LOGIN=$(gql "" 'mutation Login($input: LoginInput!) { login(input: $input) { accessToken refreshToken user { id email role isDeleted isBlocked suspended } } }' '{"input":{"email":"vlm-test-admin-a@app.local","password":"AdminPass123!"}}')
echo "$ADMIN_LOGIN" | python3 -m json.tool 2>&1 | tee /tmp/test-2-admin-login.json
ADMIN_TOKEN=$(echo "$ADMIN_LOGIN" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data']['login']['accessToken'])" 2>&1)
echo "Admin A token (first 40 chars): ${ADMIN_TOKEN:0:40}..."
echo ""

echo "============================================================"
echo "PHASE 3: Admin A fetches Student S detail (governance state probe)"
echo "============================================================"
gql "$ADMIN_TOKEN" "query { adminUserDetail(id: 3) { id email suspended suspendedAt suspendedPeriodDays isBlocked blockedAt isDeleted } }" | python3 -m json.tool 2>&1 | tee /tmp/test-3-probe-student.json
echo ""

echo "============================================================"
echo "PHASE 4: Admin A SUSPENDS Student S (periodDays=7)"
echo "============================================================"
gql "$ADMIN_TOKEN" 'mutation AdminSetUserSuspended($id: Int!, $suspended: Boolean!, $periodDays: Int) { adminSetUserSuspended(id: $id, suspended: $suspended, periodDays: $periodDays) { id email suspended suspendedAt suspendedPeriodDays isBlocked blockedAt isDeleted } }' '{"id":3,"suspended":true,"periodDays":7}' | python3 -m json.tool 2>&1 | tee /tmp/test-4-suspend.json
echo ""

echo "============================================================"
echo "PHASE 5: Student S attempts login → SHOULD BE DENIED (active suspension)"
echo "============================================================"
gql "" 'mutation Login($input: LoginInput!) { login(input: $input) { accessToken refreshToken user { id email } } }' '{"input":{"email":"vlm-test-student-s@app.local","password":"StudentPass123!"}}' | python3 -m json.tool 2>&1 | tee /tmp/test-5-student-login-denied.json
echo ""

echo "============================================================"
echo "PHASE 6: Admin B login (cross-actor observer)"
echo "============================================================"
ADMIN_B_LOGIN=$(gql "" 'mutation Login($input: LoginInput!) { login(input: $input) { accessToken refreshToken user { id email role } } }' '{"input":{"email":"vlm-test-admin-b@app.local","password":"AdminPass123!"}}')
ADMIN_B_TOKEN=$(echo "$ADMIN_B_LOGIN" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data']['login']['accessToken'])" 2>&1)
echo "Admin B token (first 40 chars): ${ADMIN_B_TOKEN:0:40}..."
echo ""

echo "============================================================"
echo "PHASE 7: Admin B reads Student S — observes A's suspend action"
echo "============================================================"
gql "$ADMIN_B_TOKEN" "query { adminUserDetail(id: 3) { id email suspended suspendedAt suspendedPeriodDays isBlocked blockedAt isDeleted } }" | python3 -m json.tool 2>&1 | tee /tmp/test-7-cross-actor-observe.json
echo ""

echo "============================================================"
echo "PHASE 8: Admin A UNSUSPENDS Student S"
echo "============================================================"
gql "$ADMIN_TOKEN" 'mutation AdminSetUserSuspended($id: Int!, $suspended: Boolean!, $periodDays: Int) { adminSetUserSuspended(id: $id, suspended: $suspended, periodDays: $periodDays) { id email suspended suspendedAt suspendedPeriodDays isBlocked blockedAt isDeleted } }' '{"id":3,"suspended":false,"periodDays":null}' | python3 -m json.tool 2>&1 | tee /tmp/test-8-unsuspend.json
echo ""

echo "============================================================"
echo "PHASE 9: Student S login → SHOULD SUCCEED (suspension cleared)"
echo "============================================================"
gql "" 'mutation Login($input: LoginInput!) { login(input: $input) { accessToken refreshToken user { id email } } }' '{"input":{"email":"vlm-test-student-s@app.local","password":"StudentPass123!"}}' | python3 -m json.tool 2>&1 | tee /tmp/test-9-student-login-success.json
echo ""

echo "============================================================"
echo "PHASE 10: Admin A BLOCKS Student S"
echo "============================================================"
gql "$ADMIN_TOKEN" 'mutation AdminSetUserBlocked($id: Int!, $blocked: Boolean!) { adminSetUserBlocked(id: $id, blocked: $blocked) { id email suspended isBlocked blockedAt isDeleted } }' '{"id":3,"blocked":true}' | python3 -m json.tool 2>&1 | tee /tmp/test-10-block.json
echo ""

echo "============================================================"
echo "PHASE 11: Student S login → SHOULD BE DENIED (blocked, no lapse)"
echo "============================================================"
gql "" 'mutation Login($input: LoginInput!) { login(input: $input) { accessToken refreshToken user { id email } } }' '{"input":{"email":"vlm-test-student-s@app.local","password":"StudentPass123!"}}' | python3 -m json.tool 2>&1 | tee /tmp/test-11-blocked-login.json
echo ""

echo "============================================================"
echo "PHASE 12: Admin A UNSUSPENDS/UNBLOCKS Student S — full restore"
echo "============================================================"
gql "$ADMIN_TOKEN" 'mutation AdminSetUserBlocked($id: Int!, $blocked: Boolean!) { adminSetUserBlocked(id: $id, blocked: $blocked) { id email suspended isBlocked isDeleted } }' '{"id":3,"blocked":false}' | python3 -m json.tool 2>&1 | tee /tmp/test-12-unblock.json
echo ""

echo "============================================================"
echo "PHASE 13: Student S login → SHOULD SUCCEED"
echo "============================================================"
gql "" 'mutation Login($input: LoginInput!) { login(input: $input) { accessToken refreshToken user { id email } } }' '{"input":{"email":"vlm-test-student-s@app.local","password":"StudentPass123!"}}' | python3 -m json.tool 2>&1 | tee /tmp/test-13-final-login.json
echo ""

echo "============================================================"
echo "PHASE 14: Admin A self-targets suspend → USER_SELF_SUSPENSION_FORBIDDEN"
echo "============================================================"
ADMIN_A_ID=1
gql "$ADMIN_TOKEN" 'mutation AdminSetUserSuspended($id: Int!, $suspended: Boolean!, $periodDays: Int) { adminSetUserSuspended(id: $id, suspended: $suspended, periodDays: $periodDays) { id email } }' "{\"id\":${ADMIN_A_ID},\"suspended\":true,\"periodDays\":7}" | python3 -m json.tool 2>&1 | tee /tmp/test-14-self-suspend.json
echo ""

echo "============================================================"
echo "PHASE 15: periodDays validation hostilities (0, -3, 1.5, 3651)"
echo "============================================================"
for PD in 0 -3 1.5 3651; do
  echo "--- periodDays=$PD ---"
  gql "$ADMIN_TOKEN" 'mutation AdminSetUserSuspended($id: Int!, $suspended: Boolean!, $periodDays: Int) { adminSetUserSuspended(id: $id, suspended: $suspended, periodDays: $periodDays) { id email suspended } }' "{\"id\":3,\"suspended\":true,\"periodDays\":$PD}" | python3 -m json.tool 2>&1 | head -15
done | tee /tmp/test-15-validation.json
echo ""

echo "============================================================"
echo "PHASE 16: Governed Admin G login → DENIED (blocked actor)"
echo "============================================================"
gql "" 'mutation Login($input: LoginInput!) { login(input: $input) { accessToken refreshToken user { id email } } }' '{"input":{"email":"vlm-test-governed-g@app.local","password":"GovernedPass123!"}}' | python3 -m json.tool 2>&1 | tee /tmp/test-16-governed-login.json
echo ""

echo "============================================================"
echo "PHASE 17: Audit trail verification (count rows for Student S)"
echo "============================================================"
# Direct pglite probe — count audit_logs rows for entity_id=3
bun -e "
import { PGlite } from '@electric-sql/pglite';
const pg = new PGlite('file:///home/z/my-project/db/pglite.db');
const r = await pg.query('SELECT action_type, entity_type, entity_id, actor_id, details FROM audit_logs WHERE entity_type=\$1 AND entity_id=\$2 ORDER BY id', ['user', 3]);
console.log('AUDIT ROWS for entity_id=3 (Student S):');
for (const row of r.rows) console.log(JSON.stringify(row));
console.log('TOTAL:', r.rows.length);
await pg.close();
" 2>&1 | tee /tmp/test-17-audit-trail.json
echo ""

echo "============================================================"
echo "PHASE 18: Cross-role containment check (Teacher T unchanged)"
echo "============================================================"
bun -e "
import { PGlite } from '@electric-sql/pglite';
const pg = new PGlite('file:///home/z/my-project/db/pglite.db');
const t = await pg.query('SELECT id, email, suspended, is_blocked, is_deleted FROM users WHERE id=4');
console.log('Teacher T state (should be unchanged):', JSON.stringify(t.rows[0]));
const s = await pg.query('SELECT id, email, suspended, suspended_at, suspended_period_days, is_blocked, blocked_at, is_deleted FROM users WHERE id=3');
console.log('Student S state (final):', JSON.stringify(s.rows[0]));
await pg.close();
" 2>&1 | tee /tmp/test-18-cross-role.json
echo ""

echo "============================================================"
echo "ALL TESTS COMPLETE — shutting down Apollo server"
echo "============================================================"
pkill -f "vlm-apollo" 2>&1 || true
echo ""
echo "Test artifacts saved to /tmp/test-*.json"
ls -la /tmp/test-*.json 2>&1 | head -20