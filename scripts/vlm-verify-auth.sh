#!/usr/bin/env bash
# Tight bash session: restart prod server, login, capture screenshots WITHOUT pauses.
# After login, immediately navigate + capture — minimize window before access_token (15min) expires.
set +e
cd /home/z/my-project

pkill -f "next start" 2>&1 || true
pkill -f "next-server" 2>&1 || true
agent-browser close 2>&1 | tail -1 || true
sleep 2

# Start prod server
PORT=3000 setsid bash -c 'cd /home/z/my-project && exec bunx next start --port 3000 --hostname 0.0.0.0' > /tmp/start.log 2>&1 < /dev/null &
disown
for i in 1 2 3 4 5 6 7 8 9 10; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/ 2>&1 || echo "000")
  if [ "$CODE" = "200" ]; then echo "Prod UP after $i"; break; fi
  sleep 2
done

# Re-login (mint fresh access_token, refresh 15min window) + inject
bun run scripts/browser-login.ts --inject --base-url http://localhost:3000 2>&1 | tail -3

# Open browser at localhost (cookies are domain=localhost)
agent-browser open http://localhost:3000/admin/dashboard 2>&1 | tail -1
sleep 5
agent-browser wait --load networkidle --timeout 30000 2>&1 | tail -1
echo "Dashboard URL: $(agent-browser get url 2>&1 | tail -1)"
echo "Dashboard title: $(agent-browser get title 2>&1 | tail -1)"

# Now navigate to user detail page — admin should be authed
agent-browser open http://localhost:3000/admin/users/3 2>&1 | tail -1
sleep 5
agent-browser wait --load networkidle --timeout 30000 2>&1 | tail -1
echo "User detail URL: $(agent-browser get url 2>&1 | tail -1)"
echo "User detail title: $(agent-browser get title 2>&1 | tail -1)"

# Take one screenshot at desktop EN to verify the page actually rendered
mkdir -p /home/z/my-project/download/vlm-screenshots
agent-browser set viewport 1440 900 2>&1 | tail -1
agent-browser cookies set locale en --domain localhost --path / 2>&1 | tail -1
agent-browser open http://localhost:3000/admin/users/3 2>&1 | tail -1
sleep 5
agent-browser screenshot /home/z/my-project/download/vlm-screenshots/VERIFY-desktop-en.png 2>&1 | tail -1
echo "VERIFY screenshot size: $(stat -c%s /home/z/my-project/download/vlm-screenshots/VERIFY-desktop-en.png 2>/dev/null) bytes"

# Snapshot to see what elements are present
echo "---SNAPSHOT---"
agent-browser snapshot -i 2>&1 | head -40