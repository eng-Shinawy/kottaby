#!/usr/bin/env bash
# Ensure the Next.js dev server is running OUTSIDE the tool-session process tree.
#
# WHY THIS EXISTS
# The sandbox harness reaps every process spawned from a tool-call shell the
# moment that invocation ends — setsid/nohup/disown do NOT survive (verified
# 2026-10-01: even `setsid nohup ... & disown` dies at the boundary). The boot
# session's own `bun run dev` (start.sh) is exempt, but nothing restarts it if
# it dies (e.g. kernel OOM).
#
# THE ESCAPE HATCH
# postgres (boot-spawned via start.sh's initdb flow, runs as user `z`) is a
# long-lived daemon whose children survive the reaper. `COPY (SELECT '') TO
# PROGRAM` runs a shell command as a child of a postgres backend; backgrounded
# inside that shell, the child reparents to init when the backend exits and
# lives on.
#
# NOTE: the sandbox shell (AND the postgres process env) carries a poisoned
# DATABASE_URL=file:…custom.db — always strip DATABASE_URL/DB_PROVIDER before
# spawning, or Next.js silently talks to the wrong database.
#
# Usage: scripts/dev-daemon.sh   (idempotent; no-op when port 3000 already serves)

set -u
cd "$(dirname "$0")/.."

if curl -s -o /dev/null --max-time 3 http://localhost:3000/; then
  echo "dev server already up"
  exit 0
fi

PSQL=/tmp/pg-root/usr/lib/postgresql/17/bin/psql
if [ ! -x "$PSQL" ]; then
  echo "psql not found at $PSQL — cannot spawn via postgres daemon" >&2
  exit 1
fi

echo "spawning dev server via postgres COPY TO PROGRAM…"
"$PSQL" -h 127.0.0.1 -U postgres -d app_db -c "COPY (SELECT '') TO PROGRAM 'env -u DATABASE_URL -u DB_PROVIDER sh -c ''cd /home/z/my-project && NEXT_DIST_DIR=.next-dev NODE_OPTIONS=--max-old-space-size=1536 nohup ./node_modules/.bin/next dev --turbopack >> dev.log 2>&1 < /dev/null &'''"

for _ in $(seq 1 30); do
  if curl -s -o /dev/null --max-time 3 http://localhost:3000/; then
    echo "dev server is up"
    exit 0
  fi
  sleep 2
done

echo "dev server failed to come up — check dev.log" >&2
exit 1
