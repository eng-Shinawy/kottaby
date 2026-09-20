# Task 7 Outcome — GraphQL Integration Tests (testClient)

**File**: `frontend/graphql/test/subscription-admin/subscription-admin.test.ts` (853 lines)
**Runner**: `bun run test/scripts/run-test.ts frontend/graphql/test/subscription-admin/subscription-admin.test.ts`
**Branch**: `feat/admin-subscription-management` (no commits made — per sandbox discipline)

## Summary

The written-but-never-run integration suite was executed and verified green twice
consecutively with identical counts. **No test-code changes were required** — the
file compiled and passed as authored against the live wire surface from Tasks 1–6
(`generated/schema.graphql` carries the four admin mutations + the admin read
query + the input/payload types + `ProrationDirection`). The only failures
encountered were environmental (see "Sandbox runbook" below), not code defects.

## Test coverage (26 tests, 96 expect() calls)

- **Tier 1 — anonymous denial (5)**: `adminStudentSubscriptions` query and each of
  the four mutations (`adminExtendSubscription`, `adminRenewSubscription`,
  `adminCancelSubscription`, `adminChangeSubscriptionPlan`) with no bearer token →
  `UNAUTHORIZED` on `extensions.code`, before any resolver body runs.
- **Tier 2 — non-admin roles (10)**: `Student` and `Teacher` actors (each registered
  through the public `registerUser` mutation + real `login` token) probe all five
  operations → `FORBIDDEN` on `extensions.code` (defense-in-depth beyond the
  `authScopes` gate).
- **Tier 3 — admin happy paths over real fixture rows (5)**:
  - `adminExtendSubscription` shifts a real active row's window by exactly 5 days
    (`endDate` delta asserted in ms).
  - `adminRenewSubscription` opens a fresh period from a genuinely expired source:
    new id ≠ source id, same planId, `active`, `startDate ≈ now` (< 60 s skew),
    window length exactly 30 days.
  - `adminCancelSubscription` flips an active row → `cancelled` (meaningful reason).
  - `adminCancelSubscription` null-reason optional branch → `cancelled`.
  - `adminChangeSubscriptionPlan` payload shape: `direction` (UPGRADE derived from
    the canonical `ProrationDirection` enum — never a string literal), `carrySessions`
    = 3 (fixture-derived: unit 10.00 → 20.00, 6 remaining sessions on the Hifz lane),
    `forfeitedSessions` = 0, and `subscription` = fresh row on the 5-session plan.
- **Tier 4 — idempotent replay (2)**: duplicate `adminRenewSubscription` replays the
  FIRST renewal's row (same id, no error); serialized duplicate plan change replays
  the first result with `carrySessions: 0` / `forfeitedSessions: 0` (same id — the
  replayed call moved nothing).
- **Tier 5 — admin read query (4)**: owner-scoped rows across lifecycle states
  (`active` + `expired`, exactly 2 rows); the plan-change owner's list shows the
  cancelled source beside the fresh active row; malformed owner id → `VALIDATION`
  on `extensions.code`; unknown well-formed id → the honest empty list `[]`.

Fixtures are provisioned via the sanctioned seams only (`insertAdminUserWithChildRow`
for the admin — BFLA-excluded from public registration — public `registerUser`/`login`
for every identity, direct-DB inserts for `plans`/`subscriptions`), with full hygiene
teardown (`deleteUsersByIds` + explicit plan-id delete AFTER user deletion to release
the RESTRICT FK).

## Test results (×2 stable)

| Round | Result | Tests | Asserts | Time |
|-------|--------|-------|---------|------|
| 1 | ✅ ALL TESTS PASSED | 26 passed / 0 failed | 96 expect() | 15.41 s |
| 2 | ✅ ALL TESTS PASSED | 26 passed / 0 failed | 96 expect() | 15.37 s |

(Note: the plan estimated 21 tests; the authored suite actually contains 26 —
Tier 2 expands to 10 via the Student/Teacher × 5-operation matrix. 26 is the
authoritative count.)

## QL / typecheck

- `bun tsgo` → exit 0, **0 type errors**.
- `bun run scripts/health/sub-loop.ts frontend/graphql/test/subscription-admin/subscription-admin.test.ts --lifecycle duplicates` → **exit 0**
  (`lint:type-aware` passed; `check:duplicates` skipped — file is outside the jscpd scan scope — reported as passed).

## Sandbox runbook (environmental findings — no code changed)

1. **Postgres must be up before the run** (`pg_ctl -D /tmp/pgdata ... start`); the
   suite writes real fixture rows to the shared dev DB and tears them down.
2. **Orphaned `next dev` servers on port 3066 must be evicted before each run.**
   The sandbox has no `lsof`, so `killListenersOnPort(3066)` (used by
   `run-server-tests.ts`) is a silent no-op and a previous run's leaked server
   wedges the next one (EADDRINUSE spawn crash → tests hit the stale server →
   120 s `beforeAll` hook timeout). Fix: `kill -9` the pid bound to 3066 (via
   `ss -ltnp`) before launching. The runner's own clean-exit cleanup also leaves
   the spawned server alive in this environment, so this applies between every
   two consecutive GraphQL-suite runs.
3. First cold `next dev --turbopack` boot on 3066 can exceed a 5-min Bash window;
   run via nohup + poll, or rely on the warm `.next-test-dev` turbopack cache
   (second boot → suite completes in ~15 s of test time).

## Carry-forward

- **Task 8 (journey `admin-subscription-lifecycle`)**: the integration suite already
  proves per-operation semantics; the journey must compose them end-to-end across
  actors (admin + student + unrelated student) with `TrackedFixtures`, a
  zero-dispatch notification spy (feature deliberately emits NO notifications),
  `catchJourneyError` denial step, and audit-row assertions — reuse the same
  fixture seam (`insertAdminUserWithChildRow` + public register/login) and the
  same proration fixture math (10@100 → 5@100, carry 3) for consistency.
  Remember the port-3066 eviction runbook when running `test/workflows`.
- **Task 10 (frontend drawer)**: wire shapes asserted here are the contract for the
  shared documents — `adminStudentSubscriptions { id planId status startDate endDate }`,
  the four mutation payloads (incl. `ChangeSubscriptionPlanPayload`:
  `direction carrySessions forfeitedSessions subscription { … }`), and the
  `UNAUTHORIZED`/`FORBIDDEN`/`VALIDATION` error vocabulary on `extensions.code`.
  When Task 10 creates `sharedDocuments/admin/admin-subscriptions.documents.ts`,
  consider migrating this suite's local `parse()` documents onto the shared ones
  (the suite header documents why they are local today) — or leave as-is, since the
  local documents deliberately avoid the graphql-tag/module-conditions crash.
- **Task 11 (final gate)**: the full GraphQL suite sweep must include the
  port-3066 eviction step between files (see runbook above).
