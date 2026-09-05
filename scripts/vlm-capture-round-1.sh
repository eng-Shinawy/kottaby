#!/usr/bin/env bash
# VLM visual verification of GovernanceActionsSection — single tight bash session.
# Uses production server (next start) — much lighter than Turbopack dev.
set -e
cd /home/z/my-project

mkdir -p /home/z/my-project/download/vlm-screenshots

# Sanity: dev server alive?
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3000/)
if [ "$CODE" != "200" ]; then
  echo "Production server not alive (HTTP $CODE)"; exit 1
fi

# Inject admin A cookies via project's browser-login script
agent-browser close 2>&1 | tail -1 || true
echo "===Injecting admin A cookies==="
bun run scripts/browser-login.ts --inject --base-url http://localhost:3000 2>&1 | tail -5
echo ""

# Helper: navigate + screenshot
shoot() {
  local W="$1"
  local H="$2"
  local LOCALE="$3"
  local STATE_DESC="$4"   # description for the filename
  local FILENAME="$5"

  agent-browser set viewport "$W" "$H" 2>&1 | tail -1
  # Set locale cookie (preserves auth cookies — only adds/replaces locale)
  agent-browser cookies set locale "$LOCALE" --domain 127.0.0.1 --path / 2>&1 | tail -1
  agent-browser open "http://127.0.0.1:3000/admin/users/3" 2>&1 | tail -1
  sleep 5
  agent-browser wait --load networkidle --timeout 60000 2>&1 | tail -1 || true
  sleep 2  # extra settle for snackbar/dialog animations
  agent-browser screenshot "/home/z/my-project/download/vlm-screenshots/${FILENAME}" 2>&1 | tail -1
  echo "  ✓ $FILENAME ($W×$H, locale=$LOCALE, state=$STATE_DESC)"
}

echo "============================================================"
echo "ACTIVE USER (Student S — suspended=false, isBlocked=false)"
echo "============================================================"
# Default state — Student S is active
shoot 1440 900 en "desktop-active" "01-desktop-1440x900-en-active.png"
shoot 1440 900 ar "desktop-active-rtl" "02-desktop-1440x900-ar-active-rtl.png"
shoot 768 1024 en "tablet-active" "03-tablet-768x1024-en-active.png"
shoot 768 1024 ar "tablet-active-rtl" "04-tablet-768x1024-ar-active-rtl.png"
shoot 375 812 en "mobile-active" "05-mobile-375x812-en-active.png"
shoot 375 812 ar "mobile-active-rtl" "06-mobile-375x812-ar-active-rtl.png"

echo ""
echo "===All screenshots captured==="
ls -la /home/z/my-project/download/vlm-screenshots/*.png 2>&1