# Phase 0 Baseline Record (REQ-000.1)

**Plan:** `ai/plans/milestone_4/state_machine_invariant_verification`
**Captured:** 2026-10-09, 01:52–02:12 local (+03:00), Bun binary `~/.bun/bin/bun`, branch `main`
**Durable copies:** `/tmp/m4-smi-baseline/` (the canonical `/tmp/baseline-*` paths are a SHARED namespace — sibling plan agents overwrote several of them during capture; see §7)

---

## 1. Static-analysis baselines

### 1.1 tsgo

```
bun tsgo 2>&1 | grep "error TS" | wc -l
```

- **Count of `error TS` lines: 1** → `/tmp/baseline-tsgo.txt`
- Exit code 1. The single error (verbatim from `/tmp/baseline-tsgo-full.txt`):

```
frontend/views/admin/users/dialogs/EditUserDialog.tsx(79,5): error TS2322: Type '"" | "Female" | "Male" | "Other"' is not assignable to type '"" | "Female" | "Male"'.
  Type '"Other"' is not assignable to type '"" | "Female" | "Male"'.
```

- Unrelated to this plan's layers (frontend admin view). Later gates (5.2, 7.x) must compare **no NEW errors** — the expected steady-state count is 1.

### 1.2 biome:check

```
bun biome:check 2>&1 | grep -c "warn"
```

- **Warnings: 0 · Errors: 0** → `/tmp/baseline-biome.txt`
- Exit 0. Full output (`/tmp/m4-smi-baseline/biome-full.txt`): `Checked 2739 files in 2s. No fixes applied.` + 1 informational diagnostic: `biome.json` schema version `2.5.13` does not match CLI version `2.5.15` ("Run the command biome migrate").
- Note: the npm script runs `biome check --write --unsafe .` — at baseline it applied **no fixes** (tree untouched by biome).
- `grep -c "warn"` against the full output also yields **0** (the plan-template metric).

### 1.3 ESLint (lint-service, full-repo)

```
bun run scripts/lint-service.ts --json --id baseline
```

- **success: true · exitCode: 0 · 0 lint findings** → `/tmp/baseline-lint.json` (preserved at `/tmp/m4-smi-baseline/lint.json`)
- Metrics: scope `full-repo`, durationMs 6764, fileCount 0 (full-repo mode), queueDepth 0. Only output noise: a node `ESLintPoorConcurrencyWarning` (not a lint finding).

---

## 2. Git state at capture (~01:52)

- **Stash:** 1 entry → `/tmp/baseline-stash.txt`

```
stash@{0}: WIP on main: ede7a747 Surah/Juz Enum Homework Tracking — 144-member vocabulary + grouped picker + visual polish (#313)
```

- **Dirty working tree (7 entries)** → `/tmp/baseline-files.txt`, `/tmp/baseline-status.txt`

```
 M backend/graphql/gqlContextFactory.ts
 M backend/lib/api/cron-auth.ts
 M backend/lib/auth/cookies.test.ts
 M backend/lib/auth/cookies.ts
 M backend/lib/gateway/cron-endpoint.ts
 M backend/ws/notification-ws-server-handshake.ts
?? backend/lib/api/test/cron-auth.test.ts
```

- The two dirty files plan-review-R1 attributed line-cite drift to (`backend/graphql/query/teachers/teacher-matching.query.ts`, `backend/db/test/repo/teachers/teacher.repository.test.ts`) are now **clean** in the tree — the review's corrected cites (`:81`, `:123-128`, `:2447`, `:2765/:2778/:2793`) are live-tree values.

---

## 3. Test-suite baselines (clean, uncontended re-run 02:09–02:12)

First pass (01:58–02:08) ran concurrently with an external `bun run test` process (lock `test`, started before this task) and is preserved in `/tmp/m4-smi-baseline/contended/`. The suites were re-run after that process finished; **workflows and graphql failure counts are identical across both passes (56 / 75) — the failures are deterministic, not contention noise.** The numbers below are the clean re-run.

### 3.1 `bun run test:db` — **FAIL**

- Runner: `test/scripts/run-db-tests-parallel.ts` — **bail-on-first-failure**; the run stopped at **12/56 files completed**.
- At bail point: **11 test files passed, 1 failed · 265 tests passed, 3 failed** (2167 assertions).
- Failing file: `backend/db/test/logic/billing/financial-immutability.test.ts` — all 3 failures in the **audit_logs trigger tier** (PG-only tier, `describeTriggerTier = isPgliteProvider() ? describe.skip : describe`, line 314):
  1. `financial ledger immutability — trigger presence tier > both immutability triggers are present and enabled on audit_logs` — `expect(isTriggerEnforcing(...)).toBe(true)` got `false` (line 162)
  2. `financial ledger immutability — audit_logs tamper tier > direct UPDATE on an audit row is rejected and the row stays unchanged` — `expectRepoError: expected the call to throw, but it resolved successfully`
  3. `financial ledger immutability — audit_logs tamper tier > direct DELETE of an audit row is rejected and the row stays present` — same expectRepoError symptom
- Symptom: the **audit_logs immutability triggers are absent/not-enforced in the migrate-provisioned Postgres test DB**, while the teacher_transaction/student_payments trigger tiers in the same file did not fail. The 44 un-reached files have unknown status at baseline.
- Contended first pass showed 4 failed tests / 2 failed files — the extra file+test were contention noise; the clean pass above is authoritative.

### 3.2 `bun run test:services` — **PASS**

- **89/89 test files passed (100%) · 2283 tests passed · 0 failed** (31275 assertions, 45.59s). This plan's service-tier tasks (4.1–4.3) start from a green layer.

### 3.3 `bun run test/scripts/run-test.ts test/workflows` — **FAIL**

- **482 pass · 5 skip · 56 fail** — 543 tests across 54 files (12.20s). Failure clusters (describe-level counts):

| Fails | Journey describe |
|---|---|
| 18 | direct-student-onboarding journey — admin onboards students with offline payment |
| 14 | Journey A — Admin User Lifecycle (Create → Observe → Govern → Reactivate) |
| 12 | Journey — Admin broadcast cross-actor workflow (specs §2.9 steps 1–10) |
| 12 | Audit-trail completeness journey — execute every admin action, prove the trail |
| 10 | Journey J-1 — Cold-Start Certification (Create → Certify → Observe → Deny) |
| 10 | Journey B — Teacher-Applicant Identity & Whitelist Update |
| 10 | Global audit-trail journey — produce, observe, filter, paginate, deny, govern |
| 10 | applicant cooldown lifecycle journey (fail → gate → extend → expire → re-apply) |
| 4 | DEV2-007 — evaluation rubric scoring journey (five-evaluator verdict loop) |
| 2 each | Journey W-1 refund visibility · parent handshake-code · parent full journey · journey harness smoke · Account-Governance Cross-Actor Lifecycle · admin-ordered paid re-evaluation |

- Command note: the plan (tasks.md:60) and `test/workflows/AGENTS.md` require the `run-test.ts` wrapper, not raw `bun test`; the wrapper form was used.
- Several failing journeys are files this plan EXTENDS (applicant cooldown, DEV2-007 rubric, account-governance ladder, admin lifecycle) — later tasks must attribute these pre-existing reds correctly.

### 3.4 `bun run test/scripts/run-test.ts backend/graphql/test` — **FAIL**

- **522 pass · 75 fail** — 597 tests across 49 files (77.22s). Failure clusters:

| Fails | Suite |
|---|---|
| 46 | Lessons GraphQL Role-Matrix (REQ-030) — dominated by `error: Cannot use a pool after calling end on the pool` (pg-pool) |
| 14 | Plan Catalog GraphQL Role-Matrix (REQ-064) |
| 12 | Plan catalog lane end-to-end (GraphQL → service → repository) |
| 6 | Plan Catalog Concurrency & Chaos Probes (REQ-074) |
| 2 | User activity heartbeat (recordMyActivity) — GraphQL integration matrix |
| remainder | scattered single-step failures (country input wire coercion, teacher availability toggle, etc.) |

- Wire-tier command discipline confirmed: `bun run test:graphql` only covers `frontend/graphql/test` (`run-server-tests.ts:15` `DEFAULT_TEST_PATH`); this baseline ran the backend tier directly per tasks.md rule 4.

---

## 4. Deferred ledger confirmation

- `deferred-items.md` exists with all pre-seeded rows **D-401..D-412** present (12 rows).
- **All 12 Status cells verbatim: `❌ Blocked`** (D-401 3.2+6.1 · D-402 3.5+6.1 · D-403 3.9+6.1 · D-404 3.6 · D-405 3.4+6.1 · D-406 3.4+6.1 · D-407 4.1 · D-408 4.3+6.2 · D-409 6.1 · D-410 6.1 · D-411 3.2 · D-412 3.8).
- Glyph discipline verified: blocked glyphs appear ONLY in the table Status cells (the Status Values legend deliberately omits the ❌ glyph), so the Phase-7 gate can reach zero.

## 5. Ledger glyph-grep count

```
grep -c "❌\|⚠️" ai/plans/milestone_4/state_machine_invariant_verification/deferred-items.md
```

- **12** (exactly the 12 Status cells; zero ⚠️ occurrences anywhere in the file).

---

## 6. Raw baseline command outputs

| Artifact | Path (canonical) | Durable copy |
|---|---|---|
| tsgo error count | `/tmp/baseline-tsgo.txt` (=1) | `/tmp/m4-smi-baseline/tsgo-count.txt` |
| tsgo full output | `/tmp/baseline-tsgo-full.txt` | `/tmp/m4-smi-baseline/tsgo-full.txt` |
| biome warn/error counts | `/tmp/baseline-biome.txt` (=0) | `/tmp/m4-smi-baseline/biome-{warn,error}.txt` |
| biome full output | — | `/tmp/m4-smi-baseline/biome-full.txt` |
| lint JSON | `/tmp/baseline-lint.json` | `/tmp/m4-smi-baseline/lint.json` |
| stash list | `/tmp/baseline-stash.txt` | `/tmp/m4-smi-baseline/stash-at-capture.txt` |
| dirty file list | `/tmp/baseline-files.txt` | `/tmp/m4-smi-baseline/dirty-files-at-capture.txt` |
| porcelain status | `/tmp/baseline-status.txt` | `/tmp/m4-smi-baseline/status-at-capture.txt` |
| test:db output | `/tmp/baseline-testdb.txt` | `/tmp/m4-smi-baseline/testdb.txt` |
| test:services output | `/tmp/baseline-testservices.txt` | `/tmp/m4-smi-baseline/testservices.txt` |
| workflows output | `/tmp/baseline-workflows.txt` | `/tmp/m4-smi-baseline/workflows.txt` |
| backend graphql output | `/tmp/baseline-graphql.txt` | `/tmp/m4-smi-baseline/graphql.txt` |
| contended first pass | — | `/tmp/m4-smi-baseline/contended/` |
| tree state at task end | — | `/tmp/m4-smi-baseline/status-at-baseline-completion.txt` |

---

## 7. Environmental hazard: shared `/tmp` namespace + concurrent sibling agents

During this capture, sibling milestone-4 plan agents (production_launch_checklist_execution, security_hardening, workflow_tests_student_journey, load_testing_performance) were running concurrently in the same repo:

- The canonical `/tmp/baseline-*` filenames are used by every plan's baseline task template. Several were overwritten by siblings mid-capture (`baseline-status.txt` 02:00:26, `baseline-lint.json`/`baseline-stash.txt`/`baseline-biome.txt` 02:01:34, `baseline-files.txt` zeroed). All canonical files were restored from this plan's captured values at ~02:18, but siblings may overwrite them again.
- The dirty tree grew from 7 entries (01:52 capture) to 37 entries (02:18, `/tmp/m4-smi-baseline/status-at-baseline-completion.txt`) from sibling work — including `backend/db/repo/classes/session.repository.ts`, `backend/lib/ratelimit.ts`, frontend admin views, and a new untracked `test/workflows/students/` directory.
- An external `bun run test` (full suite, lock `test`) ran during the first test pass; the clean re-run in §3 was taken after it finished.

**Later tasks comparing against this baseline must read the durable copies in `/tmp/m4-smi-baseline/` (or this file), not trust the shared `/tmp/baseline-*` paths.**
