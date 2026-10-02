#!/usr/bin/env bash
# capture.sh <agent-browser-session> <W> <H> <url> <screenshot-name> <expected-title-substr> [marker] [settle]
# Viewport + navigate + settle + marker retry + precheck gate + screenshot. Fast path.
set -u
S="$1"; W="$2"; H="$3"; URL="$4"; OUT="$5"; TITLE="$6"; MARKER="${7:-}"; SETTLE="${8:-10}"
K=/home/z/my-project
PC="$K/.agents/skills/visual-improvement-loop/scripts/visual-precheck.sh"
export AGENT_BROWSER_SESSION="$S"

agent-browser --session "$S" set viewport "$W" "$H" >/dev/null 2>&1
agent-browser --session "$S" open "$URL" >/dev/null 2>&1
sleep "$SETTLE"

if [ -n "$MARKER" ]; then
  ok=0
  for _try in 1 2; do
    BODY=$(agent-browser --session "$S" eval "document.body.innerText" 2>/dev/null)
    if printf '%s' "$BODY" | grep -qi "$MARKER"; then ok=1; break; fi
    sleep 4
  done
  if [ "$ok" != "1" ]; then
    echo "MARKER FAIL: '$MARKER' missing on $OUT"
    mkdir -p "$K/scratch/screenshots"
    agent-browser --session "$S" screenshot "$K/scratch/screenshots/$OUT" >/dev/null 2>&1 || true
    exit 1
  fi
fi

if bash "$PC" --no-nav --expect-title "$TITLE"; then
  mkdir -p "$K/scratch/screenshots"
  agent-browser --session "$S" screenshot "$K/scratch/screenshots/$OUT" >/dev/null 2>&1 \
    && echo "SHOT OK: $OUT" || { echo "SHOT FAILED: $OUT"; exit 1; }
else
  echo "PRECHECK FAILED: $OUT"
  mkdir -p "$K/scratch/screenshots"
  agent-browser --session "$S" screenshot "$K/scratch/screenshots/$OUT" >/dev/null 2>&1 || true
  exit 1
fi
