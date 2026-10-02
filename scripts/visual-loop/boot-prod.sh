#!/usr/bin/env bash
# Boot the PRODUCTION server against pglite (.env: DB_PROVIDER=pglite)
# for visual-improvement-loop captures. Reuses a healthy instance if up.
set -u
K=/home/z/my-project
PORT="${PORT:-3000}"

probe() { curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/health" --max-time 5 2>/dev/null; }

CODE=$(probe)
if [ "$CODE" = "200" ]; then
  echo "SERVER ALREADY UP (code $CODE)"
  exit 0
fi

cd "$K"
setsid nohup env NODE_ENV=production NODE_OPTIONS='--max-old-space-size=1024' \
  NEXT_DIST_DIR=.next-test-prod IS_DEMO=true TEST_SERVER=1 \
  AUTH_COOKIE_SECURE=false DISABLE_RATE_LIMITING=true \
  bun --env-file=.env run next start -p "$PORT" -H 127.0.0.1 \
  > "$K/visual-prod-server.log" 2>&1 < /dev/null &

for i in $(seq 1 30); do
  CODE=$(probe)
  if [ "$CODE" = "200" ]; then
    echo "PROD SERVER READY after ${i} probes"
    exit 0
  fi
  sleep 2
done
echo "SERVER FAILED TO BOOT"; tail -20 "$K/visual-prod-server.log"
exit 1
