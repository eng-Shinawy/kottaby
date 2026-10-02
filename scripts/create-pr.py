#!/usr/bin/env python3
"""Create PR: feat/session-report-homework -> main (autofix Step 2 flow)."""
import json, os, sys, urllib.error, urllib.request

TOKEN = os.environ["GITHUB_TOKEN"]
API = "https://api.github.com"

BODY = """## Session Report & Homework Infrastructure — issue #75

Closes #75

Full implementation per `ai/plans/milestone_1_core_domain_mvp/session-report-homework-infrastructure/`
(spec-implementation protocol: outcome files, checkbox state machine, mid-point gate, review waves).

### Scope
- Schema: `reports` + `homework` tables (one-report-per-session unique constraints, Jadid/Madi 0–100 CHECK)
- Repositories + services: session gate lock (INV-S7), report+homework transactional write (INV-S8), notification seam
- GraphQL: Pothos surface + resolvers + codegen; canonical types incl. `SurahJuzRef` guard
- Frontend: typed GraphQL documents + contract tests
- C.4 invariant: no `teacher_id` on reports — derived via `session.teacher_id`
- BOLA isolation: outsiders receive indistinguishable `SESSION_NOT_FOUND`
- i18n: bidi-safe notification copy (FSI/PDI isolation + RLM/LRM sentence-base marks)
- Plan closure: all task/pipeline checkboxes `[x]`, review waves + final outcome reconciled

### Verification (this session, 2026-09-08)
- `bun run db migrate` + `seed`: OK (pglite)
- `generate:gqlSchema` + `codegen`: zero drift
- `test:db`: **26/26 files, 466/466 tests** ✅
- `test:services`: **39/39 files, 802/802 tests** ✅
- `test:graphql`: **10/10 files, 172/172 tests** ✅
- `bun quality-gate`: **ALL QUALITY GATES PASSED** (tsgo → oxlint 0 errors → biome clean → knip → type-aware lint → 0 duplicate clones) ✅
- Cross-user browser verification (agent-browser + VLM): booking → session → report → notification → isolation, all per spec
- Visual audit: 6 pages × 3 viewports VLM 10/10 (desktop 1440 / tablet 820 / mobile 390)

### Notes
- `style/ui-visual-audit-fixes` commit `26deb13` (3 UI style fixes + bidi i18n fix) is included
- Quality-gate unblock for 4 GB sandbox: knip stale ignore + sharded type-aware lint cache warming (`4c68676`)
- Audit tooling: `scripts/cr-threads.py`, `scripts/cr-detail.py` (CodeRabbit thread scanners)
"""

payload = json.dumps({
    "title": "feat: session report & homework infrastructure (issue #75) — tests + quality-gate green",
    "head": "feat/session-report-homework",
    "base": "main",
    "body": BODY,
}).encode("utf-8")

req = urllib.request.Request(
    f"{API}/repos/kottaby/kottaby/pulls",
    data=payload,
    headers={
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "kottaby-script",
    },
)

try:
    with urllib.request.urlopen(req) as resp:
        r = json.loads(resp.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    r = json.loads(e.read().decode("utf-8"))

if "number" in r:
    print(f"PR CREATED: #{r['number']}  {r['html_url']}")
    print(f"  head: {r['head']['ref']} -> base: {r['base']['ref']}")
    print(f"  commits: {r['commits']}, files: {r['changed_files']}")
else:
    print("ERROR:", json.dumps(r)[:500])
    sys.exit(1)

