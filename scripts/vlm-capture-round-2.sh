#!/usr/bin/env bash
# Capture all 6 screenshots while session is alive.
set +e
cd /home/z/my-project

mkdir -p /home/z/my-project/download/vlm-screenshots

shoot() {
  local W="$1"
  local H="$2"
  local LOCALE="$3"
  local FILENAME="$4"
  agent-browser set viewport "$W" "$H" 2>&1 > /dev/null
  # Force locale via the /api/set-locale endpoint (cookie is set server-side)
  curl -s -X POST "http://localhost:3000/api/set-locale" -H "Content-Type: application/json" -d "{\"locale\":\"$LOCALE\"}" --cookie-jar /tmp/locale-cookies.txt --cookie /tmp/locale-cookies.txt > /dev/null 2>&1 || true
  agent-browser open "http://localhost:3000/admin/users/3" 2>&1 | tail -1
  sleep 5
  agent-browser wait --load networkidle --timeout 30000 2>&1 > /dev/null
  sleep 2
  agent-browser screenshot "/home/z/my-project/download/vlm-screenshots/${FILENAME}" 2>&1 | tail -1
  local SIZE=$(stat -c%s "/home/z/my-project/download/vlm-screenshots/${FILENAME}" 2>/dev/null)
  echo "  $FILENAME ($W×$H, locale=$LOCALE, size=$SIZE bytes)"
}

# Clean previous screenshots (keep the VERIFY one)
rm -f /home/z/my-project/download/vlm-screenshots/0*.png 2>&1 || true

echo "===CAPTURE 6 SCREENSHOTS==="
shoot 1440 900 en "01-desktop-1440x900-en-active.png"
shoot 1440 900 ar "02-desktop-1440x900-ar-active-rtl.png"
shoot 768 1024 en "03-tablet-768x1024-en-active.png"
shoot 768 1024 ar "04-tablet-768x1024-ar-active-rtl.png"
shoot 375 812 en "05-mobile-375x812-en-active.png"
shoot 375 812 ar "06-mobile-375x812-ar-active-rtl.png"

echo ""
echo "===DONE==="
ls -la /home/z/my-project/download/vlm-screenshots/*.png 2>&1 | head -10
echo ""
echo "===Server alive check==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" --max-time 5 http://localhost:3000/