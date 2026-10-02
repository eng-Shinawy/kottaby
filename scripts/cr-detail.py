#!/usr/bin/env python3
"""Detailed look at PR #85 threads, CodeRabbit PR comments, and issue #75 comments."""
import json, os, sys, urllib.request

TOKEN = os.environ["GITHUB_TOKEN"]
API = "https://api.github.com"
REPO = "/repos/kottaby/kottaby"

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

QUERY = """
query($owner:String!, $repo:String!, $pr:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$pr) {
      title
      reviewThreads(first:100) {
        nodes {
          isResolved
          isOutdated
          comments(first:1) {
            nodes { databaseId body path line author { login } }
          }
        }
      }
    }
  }
}
"""

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

print("=" * 70)
print("PR #85 review threads (full detail)")
print("=" * 70)
r = gql(QUERY, {"owner": "kottaby", "repo": "kottaby", "pr": 85})
pr = r["data"]["repository"]["pullRequest"]
for t in pr["reviewThreads"]["nodes"]:
    c0 = (t["comments"]["nodes"] or [{}])[0]
    author = c0.get("author", {}).get("login", "?")
    first = (c0.get("body") or "").strip().splitlines()
    head = first[0][:100] if first else "(empty)"
    print(f"resolved={t['isResolved']} outdated={t['isOutdated']} | {author} | {c0.get('path')}:{c0.get('line')}")
    print(f"   >> {head}")

print()
print("=" * 70)
print("PR #85 issue-comments by author (last 15)")
print("=" * 70)
comments = gh(f"{REPO}/issues/85/comments?per_page=100")
for c in comments[-15:] if isinstance(comments, list) else []:
    print(f"- {c['user']['login']} at {c['created_at']}: {c['body'][:80].replace(chr(10),' ')}")

print()
print("=" * 70)
print("PR #85 reviews by author")
print("=" * 70)
reviews = gh(f"{REPO}/pulls/85/reviews?per_page=100")
for rv in reviews if isinstance(reviews, list) else []:
    body = (rv.get("body") or "").replace("\n", " ")[:80]
    print(f"- {rv['user']['login']} state={rv['state']} :: {body}")

print()
print("=" * 70)
print("Issue #75 comments by author")
print("=" * 70)
ic = gh(f"{REPO}/issues/75/comments?per_page=100")
if isinstance(ic, dict):
    print("ERR:", ic.get("message"))
else:
    for c in ic:
        print(f"- {c['user']['login']} at {c['created_at']}: {c['body'][:80].replace(chr(10),' ')}")
    print(f"(total {len(ic)} comments)")
