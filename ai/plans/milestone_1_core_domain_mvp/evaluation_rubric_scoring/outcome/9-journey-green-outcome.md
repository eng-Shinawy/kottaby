# Task 9 Outcome — Journey Driven Green + Cross-Suite Sweeps

**Plan:** `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`

---

## Journey Status

The journey reached FULL GREEN within Task 8's verification (the single first-run finding was a test-authoring defect in the publish-window placement, fixed and documented in `outcome/8-journey-first-outcome.md` — no service/GraphQL layer gap existed to close). This task confirms green stability and runs the mandated cross-suite sweeps.

## Sweep Results

| Suite | Command | Result |
|---|---|---|
| Repository / DB | `bun run test:db` | **1012 pass / 0 fail** (49 files, 6006 expects, ~32s) |
| Service unit | `bun run test:services` | **1675 pass / 1 fail** — the 1 fail is the PRE-EXISTING `VerificationPurchaseService` chaos test (see D5; identical failure reproduced on a pristine `origin/main` worktree at `6bf6c71`, 18 pass/1 fail there — unrelated to this plan's diff) |
| GraphQL integration | `bun run test:graphql` | **141 pass / 1 fail** — same pre-existing D5 suite running under the server-test runner; ALL rubric GraphQL transport tests pass (15/15) |
| Journey run 1 | `bun run test/scripts/run-test.ts test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts` | **16 pass / 0 fail** |
| Journey run 2 (back-to-back idempotency) | same | **16 pass / 0 fail** |

## Environment Repairs Made During Sweeps (recorded for reproducibility)

1. The sandbox databases were schema-pushed only — `backend/db/migration/` SQL files (extensions, functions, immutability triggers, settlement trigger, dispute/broadcast backfills) had never been applied. Applied ALL numbered migrations in order to BOTH `kottaby_db` and `kottaby_test`; this fixed 13 pre-existing `financial ledger immutability` failures (trigger presence/message tiers) that also reproduce on a pristine sandbox DB without this plan's diff.
2. A stray `rollback-down.sql` execution during the migration sweep dropped the schemas; recovered by re-pushing the Drizzle schema and re-applying migrations in order (both DBs verified: 26 tables, all triggers present).
3. Residue rows from a crashed journey run (mid-flight abort before `afterAll`) polluted one admin-governance count assertion; test DB truncated for a pristine slate, suite re-run green.
4. Stale listener on test port 3066 caused one EADDRINUSE server boot failure; cleaned via port kill, suite re-run green.

## Pre-Existing (Out-of-Scope) Findings Log

- **D5 (new ledger row):** `VerificationPurchaseService` chaos double-submit test fails deterministically in this sandbox AND on pristine `origin/main` — pre-existing, billing-domain, not caused by this plan. All other 2687 swept tests pass.

## Verification Evidence

- Journey idempotency: two consecutive full-green runs against committed fixtures with per-run unique prefixes.
- `bun tsgo 2>&1 | grep "error TS" | wc -l` → 0 (re-verified during sweeps).

## Deferred Items

- D5 added (pre-existing cross-domain observation with receiving-ticket pointer); D1–D4 unchanged.
