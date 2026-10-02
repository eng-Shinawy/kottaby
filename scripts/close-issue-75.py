#!/usr/bin/env python3
"""close-issue-by-plan Step 4a — post evidence comment + close #75 as completed."""
import json, os, sys, urllib.request

TOKEN = os.environ["GITHUB_TOKEN"]  # never hardcode — GitHub push protection blocks token-bearing commits
REPO = "kottaby/kottaby"
ISSUE = 75
COMMENT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "issue-75-close-comment.md")
BASE = f"https://api.github.com/repos/{REPO}/issues/{ISSUE}"


def api(method: str, url: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "close-issue-by-plan",
    })
    with urllib.request.urlopen(req) as r:
        body = r.read().decode()
        return json.loads(body) if body else {}


# 1. Post the evidence comment
with open(COMMENT_FILE, encoding="utf-8") as f:
    body = f.read()
c = api("POST", f"{BASE}/comments", {"body": body})
print(f"COMMENT_POSTED: id={c.get('id')} url={c.get('html_url')}")

# 2. Close as completed
r = api("PATCH", BASE, {"state": "closed", "state_reason": "completed"})
print(f"ISSUE_STATE: {r.get('state')} reason={r.get('state_reason')} closed_at={r.get('closed_at')}")

# 3. Verify
v = api("GET", BASE)
ok = v.get("state") == "closed" and v.get("state_reason") == "completed"
print(f"VERIFY: state={v.get('state')} reason={v.get('state_reason')} -> {'OK' if ok else 'FAIL'}")
sys.exit(0 if ok else 1)
