#!/usr/bin/env bash
# Boot the Next.js DEV server (turbopack) against PGlite (.env: DB_PROVIDER=pglite)
# for the visual-improvement-loop captures. Reuses a healthy instance if up.
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
# pglite holds the data dir in-process — server must own db/pglite exclusively.
setsid nohup env NODE_OPTIONS='--max-old-space-size=2048' \
  bun --env-file=.env run dev --port "$PORT" -H 127.0.0.1 \
  > "$K/visual-loop-server.log" 2>&1 < /dev/null &

for i in $(seq 1 90); do
  CODE=$(probe)
  if [ "$CODE" = "200" ]; then
    echo "DEV SERVER READY after ${i} probes"
    exit 0
  fi
  sleep 2
done
echo "SERVER FAILED TO BOOT"; tail -30 "$K/visual-loop-server.log"
exit 1
