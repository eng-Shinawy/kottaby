# Trackable Implementation Tasks: 15-Minute Inactivity Auto-Offline

> **Plan directory (verbatim — every header, ledger path, and self-reference in this document uses this exact string):** `ai/plans/milestone_2_matching_notifications_escrow/15_minute_inactivity_auto_offline_m2_auto_offline`
> **Specs of record:** `ai/plans/milestone_2_matching_notifications_escrow/15_minute_inactivity_auto_offline_m2_auto_offline/specs.md` (REQ-001..REQ-095)
> **Design of record:** `ai/plans/milestone_2_matching_notifications_escrow/15_minute_inactivity_auto_offline_m2_auto_offline/plan.md` (D1-D10, §4 signatures, §5 contracts, §6 concurrency/journeys)
> **Ticket:** `15-Minute Inactivity Auto-Offline` — Dev 2, Milestone 2, 5 SP (`docs/planning/TICKETS.md:1298-1334`); blocker SHIPPED (`1775142f`).

## Non-Negotiable Execution Protocol for All Tasks

1. **Pre-Execution Outcome Knowledge Read:** before ANY task, read ALL files in `ai/plans/milestone_2_matching_notifications_escrow/15_minute_inactivity_auto_offline_m2_auto_offline/outcome/` (start with `0-ground-truth-outcome.md`).
2. **Per-File Quality Loop:** after EVERY file edit, run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (tsgo → oxlint → biome → lint:type-aware → check:duplicates; auto-discovers + prints applicable AGENTS.md and `.agents/instructions/` files; exit 0 = pass). Fix and re-run until 0.
3. **Semantic Review (pre-`[x]` gate):** race conditions, env-config registration + cache invalidation, dead code, cross-layer imports, enum value-imports, deferred items — the script cannot detect these.
4. **Test runner:** `bun run test/scripts/run-test.ts <path>` — NEVER raw `bun test`.
5. **Post-Execution Outcome File:** write `outcome/<task-id>-outcome.md` per completed task.
6. **Progress Tracking:** flip `[ ]` → `[x]` in THIS file per completed subtask.

**Standard 5-stage subtask pipeline (every implementation task X.Y, in strict order):** `X.Y.QL` Quality Loop (sub-loop.ts, lifecycle `duplicates`, exit 0) → `X.Y.TE` Test Engineering (4-Tier; layer rules below) → `X.Y.SEC` Security & Tenancy Audit (BOLA/BOPLA/BFLA/input sanitization) → `X.Y.SR` Semantic Review (checklist) → `X.Y.IV` Instruction Verification (read every AGENTS.md + instructions file printed by sub-loop.ts and validate). Write the outcome file, then mark `[x]`.

**Layer rules enforced in every `.TE`:** DB tests under `runInRollback` + `tx` propagated to every repo call + `expectRepoError` try/catch (never `.rejects.toThrow()`); service tests mock external adapters and may freeze the clock with `setSystemTime` (restore in `finally`); GraphQL wire tests via `setupTestServerLifecycle()` + `testClient` + `describeGraphqlSuite`; journey tests (`test/workflows/`) use real services + real DB, committed fixtures + tracked `afterAll` cleanup, NO `runInRollback`, backdate rows for "the past" (never fake timers).

## Layer-to-Instructions Mapping (absolute paths — sub-loop.ts auto-discovers; listed here per the protocol)

| Layer touched by this plan | AGENTS.md files | .agents/instructions files |
|---|---|---|
| Root | `/home/ahmed/Projects/kottaby_kottaby/AGENTS.md` | — |
| Backend schema (read-only context) | `/home/ahmed/Projects/kottaby_kottaby/backend/db/schema/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md` |
| Backend repos | `/home/ahmed/Projects/kottaby_kottaby/backend/db/repo/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | `.agents/instructions/backend.instructions.md` |
| Backend services | `/home/ahmed/Projects/kottaby_kottaby/backend/services/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | `.agents/instructions/backend.instructions.md` |
| Backend types | `/home/ahmed/Projects/kottaby_kottaby/backend/types/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | `.agents/instructions/backend.instructions.md` |
| Backend GraphQL | `/home/ahmed/Projects/kottaby_kottaby/backend/graphql/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/graphql/mutation/AGENTS.md` (mutation tasks), `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | `.agents/instructions/backend.instructions.md` |
| App Router (cron route) | `/home/ahmed/Projects/kottaby_kottaby/app/AGENTS.md` | `.agents/instructions/frontend.instructions.md` |
| Frontend hooks / sharedDocuments | `/home/ahmed/Projects/kottaby_kottaby/frontend/AGENTS.md` (hooks have no dedicated AGENTS.md; views: `frontend/views/AGENTS.md` for `DashboardLayout`) | `.agents/instructions/frontend.instructions.md` |
| Tests (DB/service/graphql) | `/home/ahmed/Projects/kottaby_kottaby/backend/db/test/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | `.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md` |
| Journey tests | `/home/ahmed/Projects/kottaby_kottaby/test/workflows/AGENTS.md` | `.agents/instructions/tests.instructions.md` |

## Implementation Overview

**Strategy:** foundation-first with interleaved tests. Phase 1 lays the config + types + repo primitives (the zero-risk, zero-drift foundation); Phase 2 composes the activity writers and the sweep service with the journey authored test-first; Phase 3 exposes the API surfaces (mutation, cron route); Phase 4 ships the client heartbeat; Phase 5 hardens (journey expansion, 4-tier completion, security sweep, quality gate); Phases 6-7 document and gate. **No schema/migration step exists anywhere (D1).** Generated artifacts (`schema.graphql`, codegen) are regenerated in Task 9 and committed.

---

## Task 0: Pre-Implementation Baseline (MANDATORY)

- [ ] 0.1 Seed the deferred-items ledger and read outcome knowledge
  - Read ALL files in `ai/plans/milestone_2_matching_notifications_escrow/15_minute_inactivity_auto_offline_m2_auto_offline/outcome/`
  - Confirm `deferred-items.md` exists with the DEF-1..DEF-6 seed rows from `plan.md` §13; fix statuses as work progresses
  - _Requirements: REQ-001.2, REQ-082.1_
- [ ] 0.2 Record the error baseline BEFORE touching any file
  - `bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/baseline-tsgo.txt`
  - `bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt`
  - `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json`
  - Write outcome file: `outcome/0-baseline-outcome.md` (counts + interpretation)
  - _Requirements: REQ-001.1_
- [ ] 0.3 Confirm the zero-drift preflight (read-only)
  - Verify `users.last_active_at` at `backend/db/schema/users/users.ts:44` and `teacher.is_online` at `backend/db/schema/teachers/teacher.ts:28` exist (they must — no DDL is permitted by this plan)
  - Record in `outcome/0-baseline-outcome.md`
  - _Requirements: REQ-003.1_ (design decision D1 — zero-drift ruling)

## Task 1.5: Plan Review Gate (MANDATORY — executed at generation time; re-verify at implementation start)

- [ ] 1.5 Re-validate the complete plan (`specs.md`, `plan.md`, `tasks.md`) with the `@plan-review` skill
  - R1 ALREADY RAN at plan-generation time — verdict + fixes recorded in `outcome/plan-review-R1.md`; read it FIRST and do not repeat completed rounds
  - Re-run the review ONLY if any plan file changes during implementation (each re-run appends `plan-review-R<N>.md`)
  - _Requirements: REQ-001, REQ-002_

---

## Phase 1 — Foundation: config, types, repository primitives

- [ ] 2. Register the inactivity threshold in the environment snapshot
  - `backend/lib/env.ts`: add `DEFAULT_TEACHER_INACTIVITY_TIMEOUT_MINUTES = 15` (doc comment citing B.15, `docs/specs/open-decisions-and-gaps.md:159-163`), parse via `parsePositiveIntegerEnv` (`env.ts:187-194`), add `EnvironmentConfig` member `teacherInactivityTimeoutMinutes` (`:274`), assign in `readEnvironment()` (`:372`), add typed getter (PAYMOB precedent `env.ts:126-127`, `:349-350`, `:409-412`) — design decision D9
  - `.env.example`: add `# TEACHER_INACTIVITY_TIMEOUT_MINUTES=15` in the WS/backend-knob section (`:74-103` area)
  - Tests: env resolution legs in `backend/lib/env.test.ts` (unset → 15; `"20"` → 20; garbage/`"0"`/`"-3"` → 15) using `resetEnvironmentCache()` (`env.ts:441-443`) in `afterEach`
  - AGENTS.md: root + `backend/AGENTS.md`; instructions: `.agents/instructions/backend.instructions.md`
  - [ ] 2.QL / [ ] 2.TE / [ ] 2.SEC / [ ] 2.SR / [ ] 2.IV (standard pipeline on `backend/lib/env.ts`, `backend/lib/env.test.ts`, `.env.example`)
  - Write `outcome/2-outcome.md`; mark `[x]`
  - _Requirements: REQ-016, REQ-004_
- [ ] 3. Add the sweep return type (canonical types file)
  - `backend/types/teachers/teacher.types.ts`: append `TeacherInactivitySweepReturnType { readonly offlined: number }` (docblock: honest-counts contract — identities never cross the cron boundary)
  - AGENTS.md: `backend/types/AGENTS.md`, `backend/AGENTS.md`
  - [ ] 3.QL / [ ] 3.TE (static-assertion style check if the types test convention applies — see `backend/types/teachers/teacher-availability.types.static-assertions.test.ts` precedent) / [ ] 3.SEC / [ ] 3.SR / [ ] 3.IV
  - Write `outcome/3-outcome.md`; mark `[x]`
  - _Requirements: REQ-017.2_
- [ ] 4. `UserRepository` activity-stamp primitives + repo tests
  - `backend/db/repo/users/user.repository.ts`: add `USER_ACTIVITY_COALESCE_WINDOW_MS = 60_000`, `updateLastActiveAt(userId, now, tx?)`, `updateLastActiveAtIfStale(userId, staleBefore, now, tx?)` — EXACT predicates per `plan.md` §4.1 (monotonic `IS NULL OR last_active_at < now`, throttle folded into the WHERE — D4/D5; single guarded UPDATE … RETURNING; boolean return; dual-branch executor per `plan.md` §4.1)
  - `backend/db/test/repo/users/user.repository.test.ts`: new describes covering 100% of both methods (write, NULL-flip, monotonic no-op on older `now`, equal-timestamp miss, stale-window hit/miss, unknown-id zero-row) under `runInRollback` + `tx` propagation
  - AGENTS.md: `backend/db/repo/AGENTS.md`, `backend/db/test/AGENTS.md`, `backend/AGENTS.md`; instructions: backend + tests
  - [ ] 4.QL / [ ] 4.TE / [ ] 4.SEC (stamps are identity-scoped; verify no cross-user write path) / [ ] 4.SR (no read-then-write; enum n/a; no env keys) / [ ] 4.IV
  - Write `outcome/4-outcome.md`; mark `[x]`
  - _Requirements: REQ-010, REQ-040.1, REQ-040.2, REQ-041.1, REQ-070.1, REQ-070.3_
- [ ] 5. `TeacherRepository.sweepInactiveOnlineOnce` + repo tests
  - `backend/db/repo/teachers/teacher.repository.ts`: add the guarded batch primitive EXACTLY per `plan.md` §4.2 (D6 sweep shape + D7 in-session belt-and-braces) — `and(eq(teacher.isOnline, true), sql\`EXISTS (users … last_active_at IS NULL OR < cutoff)\`, sql\`NOT EXISTS (session … status = SessionStatus.Started)\`)`, `.set({ isOnline: false, updatedAt: now })`, `.returning({ id })`, count return; imports `users` (`@/backend/db/schema/users/users`), `session` (`@/backend/db/schema/classes/session`), `SessionStatus` as VALUE import; NO prepared statement; NO inline `--` comments in `sql` templates
  - `backend/db/test/repo/teachers/teacher.repository.test.ts`: new `describe("TeacherRepository.sweepInactiveOnlineOnce …")` beside the `setOnline` suite (`:393`) covering the full §6.4 matrix (sweeps stale-online; NULL-activity swept; skips fresh; skips offline; skips started-session; exact-cutoff NOT swept; replay 0; `updated_at` bumped; count honest) — `runInRollback` + fixtures via `createTestUser`/`createTestTeacherRow`/`createTestSession` (`backend/db/test/entity-setup.ts:74`, `:550`, `:303`)
  - AGENTS.md: `backend/db/repo/AGENTS.md`, `backend/db/test/AGENTS.md`, `backend/AGENTS.md`; instructions: backend + tests
  - [ ] 5.QL / [ ] 5.TE / [ ] 5.SEC (predicate-only victim selection — no client params exist) / [ ] 5.SR (guarded single statement; one-now; enum value import; no module state) / [ ] 5.IV
  - Write `outcome/5-outcome.md`; mark `[x]`
  - _Requirements: REQ-018, REQ-040, REQ-041.3, REQ-043.1, REQ-050.1, REQ-051, REQ-052, REQ-070.2, REQ-070.3_

---

## Phase 2 — Core composition: activity writers + the sweep service (journey test-first)

- [ ] 6. Per-request activity stamp in the GraphQL context factory
  - `backend/graphql/gqlContextFactory.ts`: after the verified-user resolution (`UserRepository.findById` at `:259`), issue ONE fire-and-forget `UserRepository.updateLastActiveAtIfStale(user.id, staleBefore, now)` with a single captured `now` and `staleBefore = now − USER_ACTIVITY_COALESCE_WINDOW_MS`; `void … .catch(...)` with a logged swallow (mirror `auth.service.ts:203-216`); anonymous requests issue NOTHING; NO `Context` shape change; exactly ONE capture site
  - `backend/graphql/test/context-activity-stamp.test.ts` (NEW, DB-free, modeled on `context-keys.test.ts`): authenticated construction issues exactly one throttled stamp (spy on `UserRepository`); anonymous issues zero; a rejected stamp never rejects `createGraphQLContext`
  - AGENTS.md: `backend/graphql/AGENTS.md`, `backend/AGENTS.md`; instructions: backend + tests
  - [ ] 6.QL / [ ] 6.TE / [ ] 6.SEC (identity from the resolved user only) / [ ] 6.SR (fire-and-forget containment; no request-path await; monotonic safety) / [ ] 6.IV
  - Write `outcome/6-outcome.md`; mark `[x]`
  - _Requirements: REQ-011, REQ-004.2 (context seam), REQ-072.2, REQ-072.3_ (design decision D2 — the activity model)
- [ ] 7. Login-touch consolidation onto the repo primitive
  - `backend/services/auth/auth.service.ts`: replace the private `touchLastActiveAt` call (`:203-216` block) with `UserRepository.updateLastActiveAt(user.id, new Date())` (optional-executor form); DELETE the private helper at `:514-515` and prune now-dead imports (`db`, `users`, `eq`) only after verifying no other in-file use; fire-and-forget `.catch` logging preserved
  - Tests: extend the auth service test suite — login still stamps (spy on `UserRepository.updateLastActiveAt`), login still succeeds when the stamp rejects; grep-assert zero remaining `touchLastActiveAt` definitions
  - AGENTS.md: `backend/services/AGENTS.md`, `backend/AGENTS.md`; instructions: backend + tests
  - [ ] 7.QL / [ ] 7.TE / [ ] 7.SEC / [ ] 7.SR (dead-code sweep: helper + imports gone; single writer path) / [ ] 7.IV
  - Write `outcome/7-outcome.md`; mark `[x]`
  - _Requirements: REQ-013, REQ-004.2, REQ-053.1_
- [ ] 8. Explicit-intent stamp inside `setAvailability` (EXTEND the shipped service)
  - `backend/services/teachers/teacher-availability.service.ts`: inside the existing `withTransaction` (`:189`), after `TeacherRepository.setOnline(…)` (`:230`), compose `await UserRepository.updateLastActiveAt(teacherId, activityNow, innerTx)` with ONE captured `now`; gates, write, zero-row guard, and error codes stay byte-identical (behavioral order preserved)
  - `backend/services/teachers/teacher-availability.service.test.ts`: existing matrix re-run green; NEW assertions — stamp lands in-transaction (rollback rolls the stamp), fresh toggle carries fresh activity
  - AGENTS.md: `backend/services/AGENTS.md`, `backend/AGENTS.md`; instructions: backend + tests
  - [ ] 8.QL / [ ] 8.TE / [ ] 8.SEC (BOPLA: no input spread; identity server-derived) / [ ] 8.SR (atomicity: stamp + toggle share the tx; one-now; INV-A1/A2 unchanged) / [ ] 8.IV
  - Write `outcome/8-outcome.md`; mark `[x]`
  - _Requirements: REQ-012, REQ-042.1, REQ-042.2, REQ-071.3_
- [ ] 9. The inactivity sweep service — JOURNEY TEST-FIRST
  - [ ] 9.1 Author the failing journey FIRST: `test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts` — skeleton per `test/workflows/teachers/teacher-availability.journey.test.ts` (`beforeAll` committing `db.transaction` + `provisionCertifiedTeacherActor`/`provisionStudentActor` (`test/workflows/helpers/actor-context.ts:88`, `:105`) + `TrackedFixtures`; `afterAll` `cleanup()` + `verifyAllAbsent()`; `catchDenial` try/catch; backdate legs via direct `users.last_active_at` update, second-precision (`test/workflows/helpers/second-precision.ts:21`)). Encode J-IO-1..6 (REQ-090..REQ-095) including the admin-observer leg via `getTeacherPresenceStats` (`platform-analytics.repository.ts:320`)
  - [ ] 9.2 Implement `backend/services/teachers/teacher-inactivity.service.ts` — `TeacherInactivityService.sweepInactiveTeachers(outerTx?)` EXACTLY per `plan.md` §4.3 (one `withTransaction`, one captured `now`, `cutoff = now − getter·60000`, delegate to `TeacherRepository.sweepInactiveOnlineOnce`, return `{ offlined }`; `logger.info` on completion)
  - [ ] 9.3 Service tests: NEW `backend/services/teachers/teacher-inactivity.service.test.ts` per REQ-071.1 — env resolution + `resetEnvironmentCache()`; repo spy receives `(now, cutoff, tx)` with exact cutoff; zero-count pass-through; `outerTx` join vs own; `setSystemTime` boundary legs 14:59/15:00/15:01 (restore in `finally`, template `session-admin-governance.service.test.ts:727-738`)
  - [ ] 9.4 Run the journey to green: `bun run test/scripts/run-test.ts test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts`
  - AGENTS.md: `backend/services/AGENTS.md`, `test/workflows/AGENTS.md`, `backend/AGENTS.md`; instructions: backend + tests
  - [ ] 9.QL (per file) / [ ] 9.TE / [ ] 9.SEC (sweep reachable only via cron route; no GraphQL exposure) / [ ] 9.SR (one-now; idempotent replay; no module state; env getter registered) / [ ] 9.IV
  - Write `outcome/9-outcome.md`; mark `[x]`
  - _Requirements: REQ-017, REQ-042, REQ-043, REQ-050, REQ-053.2, REQ-071.1, REQ-071.2, REQ-074.1, REQ-074.2, REQ-074.3, REQ-090, REQ-091, REQ-092, REQ-093, REQ-094, REQ-095_

---

## Phase 3 — API layer: heartbeat mutation + cron route

- [ ] 10. `recordMyActivity` mutation (service-first) + SDL regeneration + wire tests
  - `backend/services/auth/auth.service.ts`: add `recordMyActivity(userId: number): Promise<boolean>` EXACTLY per `plan.md` §4.5.2 (one captured `now`; `withTransaction(undefined, …)` wrapping `UserRepository.updateLastActiveAt(userId, now, tx)`; returns `true`) — the service `user.mutation.ts` already imports
  - `backend/graphql/mutation/user.mutation.ts`: add the field per `plan.md` §5.1 — argless, `authScopes: { authenticated: true }`, resolver is a ONE-LINE delegation `AuthService.recordMyActivity(ctx.user.id)` (no repository imports, no inline business logic — resolver-delegation rule); no barrel edit (file already side-effect-imported)
  - Regenerate: `bun run generate:gqlSchema` then `bun codegen`; commit `frontend/graphql/generated/schema.graphql` + regenerated types
  - `backend/graphql/test/schema-surface.test.ts`: add `USER_ACTIVITY_MUTATION_FIELDS = ["recordMyActivity"] as const` and register in the mutation assertions (sibling precedent: const `TEACHER_AVAILABILITY_MUTATION_FIELDS` at `:944`, spread at `:1279`)
  - NEW `backend/graphql/test/user-activity.integration.test.ts` per REQ-072.1: `describeGraphqlSuite` + `setupTestServerLifecycle()` + `testClient`; authenticated teacher → `true` + DB read-back fresh `last_active_at`; anonymous → 401 (error code pin); all four roles accepted; scalar-only response
  - Service tests: extend the auth suite — `recordMyActivity` stamps via the repo (spy) and returns `true`
  - AGENTS.md: `backend/services/AGENTS.md`, `backend/graphql/AGENTS.md`, `backend/graphql/mutation/AGENTS.md`, `backend/AGENTS.md`; instructions: backend + tests
  - [ ] 10.QL / [ ] 10.TE / [ ] 10.SEC (BOLA: `ctx.user.id` only; BFLA: authenticated-only; BOPLA: argless) / [ ] 10.SR (SDL artifact committed; one resolver; no dead fields) / [ ] 10.IV
  - Write `outcome/10-outcome.md`; mark `[x]`
  - _Requirements: REQ-014, REQ-060, REQ-030.1, REQ-032.1, REQ-072.1_
- [ ] 11. Cron route + inventory registration + route test
  - NEW `app/api/cron/sweep-inactive-teachers/route.ts` EXACTLY per `plan.md` §5.2 (D8 trigger ruling; factory shape, honest-counts payload `{ offlined }`)
  - `backend/lib/gateway/route-inventory.ts`: add `{ path: "/api/cron/sweep-inactive-teachers", classification: "envelope" }` with a sibling-mirroring comment (`:62-79` area)
  - NEW `app/api/cron/sweep-inactive-teachers/test/sweep-inactive-teachers-route.test.ts` per REQ-073: pure-function tier, `mock.module` the service, per-test env stubs restored `afterEach`, legs: mode-gate bare-404 / missing+bad bearer 401 / 200 `{ offlined }` (model `app/api/cron/sweep-sessions/test/sweep-sessions-route.test.ts:41-78`)
  - AGENTS.md: `app/AGENTS.md`, root; instructions: frontend (app-router lane) + backend for the factory context
  - [ ] 11.QL / [ ] 11.TE / [ ] 11.SEC (gate chain: mode 404 → bearer timing-safe → rate limit; low-privilege probes 404/401) / [ ] 11.SR (registry↔tree static assertions green; no scheduler code introduced) / [ ] 11.IV
  - Write `outcome/11-outcome.md`; mark `[x]`
  - _Requirements: REQ-063, REQ-031.2, REQ-031.3, REQ-073.1, REQ-043.2, REQ-053.2_

---

## Phase 4 — Frontend: the client presence heartbeat

- [ ] 12. Heartbeat document + hook + mount + tests
  - `frontend/graphql/sharedDocuments/auth/auth.documents.ts`: add `recordMyActivityMutationDocument` (scalar mutation; naming rule; no object `id` requirement)
  - NEW `frontend/hooks/presence/use-teacher-presence-heartbeat.ts`: `TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS = 5 * 60_000` exported; teacher-gated (`useAuth()` — `frontend/hooks/auth/useAuth.ts:6`); beat obtained via `useMutation(recordMyActivityMutationDocument)` from `@/apollo/client/react`; interval fires the beat while `document.visibilityState === "visible"`; stops on hidden/logout/unmount (timer cleared); failures logged via `@/frontend/lib/logger` and swallowed; no UI output
  - `frontend/views/dashboard/layout/DashboardLayout.tsx`: mount the hook (single client shell, `useAuth()` at `:71`); `app/(dashboard)/layout.tsx` stays untouched
  - NEW `frontend/hooks/presence/use-teacher-presence-heartbeat.test.ts` per REQ-075.1: role gating (non-teacher/null → no timer), cadence fire, visibility stop, failure silence — stubbed timer/`document` globals AND `mock.module` stubs for the `@/frontend/hooks/auth` (`useAuth` throws outside `AuthProvider`, `useAuth.ts:8-10`) and `@apollo/client/react` seams (or a provider-wrapped consumer component — `renderHook` is unavailable under bun:test)
  - `frontend/graphql/sharedDocuments/documents.contract.test.ts` stays green (run it)
  - AGENTS.md: `frontend/AGENTS.md`, `frontend/views/AGENTS.md`; instructions: frontend
  - [ ] 12.QL (per file) / [ ] 12.TE / [ ] 12.SEC (no token handling changes; no new data exposure) / [ ] 12.SR (no unbounded state; timer cleanup; logger path is `@/frontend/lib/logger`) / [ ] 12.IV
  - Write `outcome/12-outcome.md`; mark `[x]`
  - _Requirements: REQ-015, REQ-061, REQ-062, REQ-075.1, REQ-075.2, REQ-075.3_ (design decision D3 — heartbeat-as-API-call)

---

## Phase 5 — Hardening: full test sweep, security probes, quality gate

- [ ] 13. Complete the 4-Tier matrix + security/abuse sweep
  - Tier 3 (chaos) legs: overlapping sweeps via `Promise.allSettled` (counts sum to a single pass — second run 0 rows); out-of-order monotonic stamps (older `now` after newer — no regression); concurrent toggle-vs-sweep serialization probe (REQ-042.1/042.2 outcomes)
  - Tier 4 (abuse) legs: anonymous mutation 401 (wire tier); student/parent token vs cron route (404 mode-off / 401 no bearer); malformed `TEACHER_INACTIVITY_TIMEOUT_MINUTES` (falls back, never throws); heartbeat failure storm (repeated failing beats → no unhandled rejection, schedule survives)
  - Verify no pglite-incompatible lane was introduced; run every touched lane via `bun run test/scripts/run-test.ts <path>`
  - [ ] 13.QL / [ ] 13.TE / [ ] 13.SEC (document each probe result in the outcome file) / [ ] 13.SR / [ ] 13.IV
  - Write `outcome/13-outcome.md`; mark `[x]`
  - _Requirements: REQ-030..034 (probes), REQ-050.4, REQ-053.1, REQ-053.3, REQ-070..075 (tier completion)_
- [ ] 14. Boundary proofs + grep invariants + full quality gate
  - Boundary legs green at BOTH tiers: service tier (`setSystemTime` 14:59/15:00/15:01 — Task 9.3) and journey tier (backdated exact-cutoff NOT swept — REQ-095.2)
  - Grep invariants (record outputs in outcome):
    - `grep -rn "last_active_at\|lastActiveAt" backend/ --include="*.ts" | grep -v "repo/users\|test\|schema\|types"` → ZERO non-repo, non-test writers (REQ-004.2)
    - `grep -rn "isOnline: \|is_online" backend/ --include="*.ts" | grep -v "repo/teachers\|test\|schema\|types\|pothos"` → ZERO writers outside `TeacherRepository` (REQ-004.1)
    - `git status backend/ws/` → byte-untouched (REQ-034.2, REQ-033.3)
  - `bun quality-gate` green (tsgo → oxlint → biome → lint → duplicates; resume from last failed stage on retry — never clear caches)
  - [ ] 14.QL / [ ] 14.TE / [ ] 14.SEC / [ ] 14.SR / [ ] 14.IV
  - Write `outcome/14-outcome.md`; mark `[x]`
  - _Requirements: REQ-004.1, REQ-004.2, REQ-033.3, REQ-034.2, REQ-050, REQ-082.2_

---

## Phase 6 — Documentation

- [ ] 15. Canonical doc update (knowledge propagation target)
  - `docs/teachers/teacher-availability.md`: rewrite §6.3 (`:313-315`) from "related forward contract" to the SHIPPED sweep section — owner surface (`TeacherInactivityService` + repo primitive + cron route), threshold env key, recommended ops cadence (≤5 min), boundary semantics (strict `<`, NULL ⇒ expired, in-session NOT EXISTS), the heartbeat-as-API-call ruling (D2/D3), and the D10 self-heal interplay with the unconditional release
  - Amend the single-primitive sentence at `:174` ("exactly one repo method that writes the boolean") to name BOTH `TeacherRepository` write primitives (`setOnline` + `sweepInactiveOnlineOnce`) so the rewritten doc does not self-contradict (REQ-081.2)
  - Fix the stale citation in that doc: `users.ts:37` → `backend/db/schema/users/users.ts:44` (ledger DEF-6 → ✅)
  - AGENTS.md/instructions files are NOT modified by plan work (REQ-083)
  - [ ] 15.QL / [ ] 15.TE (n/a — documentation; keep the doc lint-clean) / [ ] 15.SEC (n/a) / [ ] 15.SR (no rule files touched) / [ ] 15.IV
  - Write `outcome/15-outcome.md`; mark `[x]`
  - _Requirements: REQ-081.1, REQ-081.2, REQ-083.1_

---

## Phase 7 — Final gate: deferred enforcement + knowledge propagation

- [ ] 16. Final quality gate & deferred-items enforcement
  - `grep -c "❌\|⚠️" ai/plans/milestone_2_matching_notifications_escrow/15_minute_inactivity_auto_offline_m2_auto_offline/deferred-items.md` → MUST be 0 (every row a ✅ resolved-pointer with owner named)
  - Baseline comparison vs `/tmp/baseline-*.txt` — document any new errors introduced (must be zero)
  - Re-run the touched lanes one final time: repo, services, graphql wire, cron route, journey, frontend hook, documents contract
  - _Requirements: REQ-001.3, REQ-082.2_
- [ ] 17. Knowledge Propagation & Documentation
  - Read ALL outcome files in `…/outcome/`; extract recurring patterns/gotchas (e.g. monotonic predicate discipline, throttle-in-WHERE, backdate-vs-freeze-clock split across tiers)
  - The canonical doc update shipped in Task 15 IS this plan's propagation target (domain: `docs/teachers/`); verify it consolidates the outcome learnings; do NOT create redundant docs, do NOT touch AGENTS.md / `.agents/instructions/**` (hand-curated only)
  - Write `outcome/17-knowledge-propagation-outcome.md`; mark `[x]`
  - _Requirements: REQ-083.1, REQ-080.1_
- [ ] 18. Hand-off summary (no new files — respond in chat)
  - Summarize shipped surfaces, invariants honored (INV-A1/A2/S6 preserved; INV-A4 pointer), ops arming steps (`CRON_EXECUTION_MODE=external`, `CRON_EXTERNAL_ENABLED=true`, `CRON_SECRET`, ≤5-min scheduler), and remaining sibling scope (`:1338`)
  - _Requirements: REQ-002.3 (final checkbox sweep)_

---

## Requirement Coverage Index (audit table)

| REQ band | Covering tasks |
|---|---|
| REQ-001 | 0.2, 0.3, 1.5, 16 |
| REQ-002 | 0.1, every task (protocol), 18 |
| REQ-003 | 0.3, 2, 15 (doc), every `.IV` |
| REQ-004 | 4, 5, 6, 7, 14 (grep invariants) |
| REQ-010 | 4 |
| REQ-011 | 6 |
| REQ-012 | 8 |
| REQ-013 | 7 |
| REQ-014 | 10 |
| REQ-015 | 12 |
| REQ-016 | 2 |
| REQ-017 | 3, 9 |
| REQ-018 | 5 |
| REQ-030..034 | 10, 11, 13 (probes), 14 (greps) |
| REQ-040..043 | 4, 5, 8, 9, 13 |
| REQ-050..053 | 5, 9, 13, 14 |
| REQ-060..063 | 10, 11, 12 |
| REQ-070..075 | 4, 5, 9, 10, 11, 12, 13 |
| REQ-080..083 | every task (outcome files), 15, 16, 17 |
| REQ-090..095 | 9 (journey), 13 (expansion), 14 (boundary leg) |
