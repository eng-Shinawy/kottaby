#!/usr/bin/env bash
# Stop any dev server on port 3000 (bracket-trick avoids self-match).
pkill -f 'next[-]server' 2>/dev/null
pkill -f 'next[ ]dev' 2>/dev/null
pkill -f 'bun --env-file=.env run dev' 2>/dev/null
sleep 1
CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ --max-time 3 2>/dev/null)
if [ "$CODE" = "000" ]; then
  echo "SERVER STOPPED"
else
  echo "STILL RESPONDING (code $CODE)"
  exit 1
fi
