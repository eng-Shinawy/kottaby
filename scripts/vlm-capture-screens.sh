#!/usr/bin/env bash
# Capture all DEV3-017 screenshots in one tight bash session.
# Restarts dev server, logs in, navigates, captures screenshots at 4 viewports × 2 locales.
# Designed to complete BEFORE the sandbox kills the Turbopack dev process.
set -e
cd /home/z/my-project

pkill -f "next" 2>&1 || true
sleep 2

# Start Next.js dev server
NEXT_DIST_DIR=.next-dev NODE_OPTIONS='--max-old-space-size=1024' setsid bash -c 'cd /home/z/my-project && exec bunx next dev --port 3000 --hostname 0.0.0.0' > /tmp/dev.log 2>&1 < /dev/null &
disown

# Wait for dev server
for i in 1 2 3 4 5 6 7 8 9 10; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3000/ 2>&1 || echo "000")
  if [ "$CODE" = "200" ]; then echo "Dev UP after $i checks"; break; fi
  sleep 3
done

# Login Admin A
LOGIN_RESP=$(curl -s -X POST http://127.0.0.1:3000/api/graphql -H "Content-Type: application/json" -d '{"query":"mutation { login(email: \"vlm-test-admin-a@app.local\", password: \"AdminPass123!\") { accessToken refreshToken } }"}' --max-time 60)
ACCESS=$(echo "$LOGIN_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data']['login']['accessToken'])")
REFRESH=$(echo "$LOGIN_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['data']['login']['refreshToken'])")
echo "Admin A logged in (access len=${#ACCESS})"

# Open agent-browser + set cookies + navigate
agent-browser close 2>&1 || true
agent-browser open http://127.0.0.1:3000/ 2>&1 | tail -1
agent-browser cookies set access_token "$ACCESS" --domain 127.0.0.1 --path / 2>&1 | tail -1
agent-browser cookies set refresh_token "$REFRESH" --domain 127.0.0.1 --path / 2>&1 | tail -1
agent-browser cookies set locale "en" --domain 127.0.0.1 --path / 2>&1 | tail -1
echo "Cookies set"

mkdir -p /home/z/my-project/download/vlm-screenshots

navigate_and_shoot() {
  local viewport_w="$1"
  local viewport_h="$2"
  local locale="$3"
  local state="$4"
  local filename="$5"

  agent-browser set viewport "$viewport_w" "$viewport_h" 2>&1 | tail -1
  agent-browser cookies set locale "$locale" --domain 127.0.0.1 --path / 2>&1 | tail -1
  agent-browser open "http://127.0.0.1:3000/admin/users/3" 2>&1 | tail -1
  sleep 4
  agent-browser wait --load networkidle --timeout 60000 2>&1 | tail -1 || true
  agent-browser screenshot "/home/z/my-project/download/vlm-screenshots/${filename}" 2>&1 | tail -1
  echo "  captured: $filename"
}

echo ""
echo "===CAPTURE MATRIX==="
# Active user (Student S, id=3) — initial state
navigate_and_shoot 1440 900 en active-state "01-desktop-1440x900-en-active.png"
navigate_and_shoot 1440 900 ar active-state "02-desktop-1440x900-ar-active-rtl.png"
navigate_and_shoot 768 1024 en active-state "03-tablet-768x1024-en-active.png"
navigate_and_shoot 768 1024 ar active-state "04-tablet-768x1024-ar-active-rtl.png"
navigate_and_shoot 375 812 en active-state "05-mobile-375x812-en-active.png"
navigate_and_shoot 375 812 ar active-state "06-mobile-375x812-ar-active-rtl.png"

echo ""
echo "===Screenshots captured==="
ls -la /home/z/my-project/download/vlm-screenshots/ 2>&1
echo ""
echo "===Dev server log tail==="
tail -10 /tmp/dev.log