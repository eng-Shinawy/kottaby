#!/usr/bin/env bash
# Capture all 6 screenshots in ONE tight bash session.
# Restart prod server + login + capture all — no pauses between.
set +e  # don't fail-fast; we want all 6 shots
cd /home/z/my-project

# Kill stale
pkill -f "next start" 2>&1 || true
pkill -f "next-server" 2>&1 || true
agent-browser close 2>&1 | tail -1 || true
sleep 2

# Start prod server
PORT=3000 setsid bash -c 'cd /home/z/my-project && exec bunx next start --port 3000 --hostname 0.0.0.0' > /tmp/start.log 2>&1 < /dev/null &
disown

# Wait for it
for i in 1 2 3 4 5 6 7 8 9 10; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/ 2>&1 || echo "000")
  if [ "$CODE" = "200" ]; then echo "Prod UP after $i checks"; break; fi
  sleep 2
done

# Login + inject (uses localhost — matches cookie domain)
echo "===Login + inject==="
bun run scripts/browser-login.ts --inject --base-url http://localhost:3000 2>&1 | tail -3

# Open browser at localhost so cookies work
agent-browser open http://localhost:3000/ 2>&1 | tail -1
sleep 2

mkdir -p /home/z/my-project/download/vlm-screenshots

shoot() {
  local W="$1"
  local H="$2"
  local LOCALE="$3"
  local FILENAME="$4"
  agent-browser set viewport "$W" "$H" 2>&1 > /dev/null
  agent-browser cookies set locale "$LOCALE" --domain localhost --path / 2>&1 > /dev/null
  agent-browser open "http://localhost:3000/admin/users/3" 2>&1 | tail -1
  sleep 6
  agent-browser wait --load networkidle --timeout 30000 2>&1 > /dev/null
  sleep 2
  agent-browser screenshot "/home/z/my-project/download/vlm-screenshots/${FILENAME}" 2>&1 | tail -1
  local SIZE=$(stat -c%s "/home/z/my-project/download/vlm-screenshots/${FILENAME}" 2>/dev/null)
  echo "  $FILENAME (size=$SIZE bytes)"
}

echo ""
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