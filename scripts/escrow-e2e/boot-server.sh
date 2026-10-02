#!/usr/bin/env bash
# Boot the PRODUCTION test server (.next-test-prod) if not already serving.
# Mirrors test/scripts/run-server-tests.ts spawnTestServer (production mode).
set -u
export PATH=/home/z/pgroot/usr/lib/postgresql/17/bin:$PATH
K=/home/z/my-project
PORT="${PORT:-3000}"
# Visual-loop / escrow-e2e runtime artifacts live here — ensure it exists before writes.
mkdir -p "$K/download/escrow-e2e"

probe() { curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/health" --max-time 5 2>/dev/null; }

CODE=$(probe)
if [ "$CODE" = "200" ]; then
  echo "SERVER ALREADY UP (code $CODE)"
  exit 0
fi

cd "$K"
setsid nohup env NODE_ENV=production NEXT_DIST_DIR=.next-test-prod IS_DEMO=true TEST_SERVER=1 AUTH_COOKIE_SECURE=false DISABLE_RATE_LIMITING=true \
  bun --env-file=.env.test run next start -p "$PORT" -H 127.0.0.1 > "$K/logs-prod-server.log" 2>&1 < /dev/null &
for i in $(seq 1 45); do
  CODE=$(probe)
  if [ "$CODE" = "200" ]; then
    echo "PROD SERVER READY after ${i} probes"
    exit 0
  fi
  sleep 2
done
echo "SERVER FAILED TO BOOT"; tail -20 "$K/logs-prod-server.log"
exit 1
