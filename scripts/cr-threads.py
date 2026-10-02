#!/usr/bin/env python3
"""Fetch unresolved CodeRabbit review threads for open PRs (autofix skill Step 3, curl-based)."""
import json, os, sys, urllib.request

TOKEN = os.environ["GITHUB_TOKEN"]
OWNER, REPO = "kottaby", "kottaby"
API = "https://api.github.com"

def gh(endpoint):
    req = urllib.request.Request(
        f"{API}{endpoint}",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "kottaby-script",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

def gql(query, variables):
    payload = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    req = urllib.request.Request(
        f"{API}/graphql",
        data=payload,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "kottaby-script",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

QUERY = """
query($owner:String!, $repo:String!, $pr:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$pr) {
      title
      headRefName
      reviewThreads(first:100) {
        nodes {
          isResolved
          isOutdated
          comments(first:1) {
            nodes {
              databaseId
              body
              path
              line
              startLine
              originalLine
              author { login }
            }
          }
        }
      }
    }
  }
}
"""

# 1. List all open PRs
prs = gh("/repos/kottaby/kottaby/pulls?state=open&per_page=50")
if isinstance(prs, dict):
    print("ERR listing PRs:", prs.get("message")); sys.exit(1)

CR_AUTHORS = {"coderabbitai", "coderabbit[bot]", "coderabbitai[bot]"}

for p in prs:
    num, branch, title = p["number"], p["head"]["ref"], p["title"]
    r = gql(QUERY, {"owner": OWNER, "repo": REPO, "pr": num})
    pr = (r.get("data") or {}).get("repository", {}).get("pullRequest")
    if pr is None:
        print(f"PR #{num} ({branch}): query failed: {json.dumps(r)[:200]}")
        continue
    threads = pr["reviewThreads"]["nodes"]
    cr_unresolved = []
    for t in threads:
        if t["isResolved"] or t["isOutdated"]:
            continue
        c0 = (t["comments"]["nodes"] or [{}])[0]
        if c0.get("author", {}).get("login") in CR_AUTHORS:
            cr_unresolved.append({
                "id": c0.get("databaseId"),
                "path": c0.get("path"),
                "line": c0.get("line"), "startLine": c0.get("startLine"),
                "body": (c0.get("body") or "")[:400],
                "full_body": c0.get("body") or "",
            })
    print(f"PR #{num} | {branch} | {title[:50]}")
    print(f"  total threads: {len(threads)}, unresolved CodeRabbit: {len(cr_unresolved)}")
    for i, c in enumerate(cr_unresolved):
        first_line = c["body"].strip().splitlines()[0][:120] if c["body"] else "(empty)"
        print(f"    [{i}] {c['path']}:{c.get('line')} :: {first_line}")
    print()
