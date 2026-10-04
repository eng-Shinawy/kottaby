# Task 0 — Ground-Truth Outcome (Generation-Time Evidence Digest)

**Plan:** `ai/plans/milestone_2_matching_notifications_escrow/15_minute_inactivity_auto_offline_m2_auto_offline/`
**Written:** 2026-10-04 (plan-generation time, before any implementation)
**Purpose:** Every executing agent MUST read this file BEFORE starting any task. It is the verified evidence census behind `specs.md`/`plan.md`/`tasks.md` — all `path:line` anchors below were verified against the working tree at generation time (branch `plans`, blocker commit `1775142f` present). Do NOT re-derive these facts; DO re-verify a line anchor if the file has since drifted (the blocker plan's anchors drifted between plan and ship — e.g. `setOnline` `:437` → `:512`).

## 1. Zero-drift schema (verified)

- `users.last_active_at` EXISTS — `backend/db/schema/users/users.ts:44` (`lastActiveAt: timestamp("last_active_at")`, nullable, no default, NO index; migration `backend/drizzle/20260904084151_omniscient_karen_page/migration.sql:344`). Only table constraint: `users_email_unique` (`:51`).
- `teacher.is_online` EXISTS — `backend/db/schema/teachers/teacher.ts:28` (`isOnline: boolean("is_online").default(false)`; check constraint `:37`; NO index). PK = `users.id` (`:22-24`).
- `session` — `backend/db/schema/classes/session.ts:54`; `teacherId` `:58`, `status` `:64`, existing `session_teacher_id_idx` `:88`.
- **NO schema work is permitted by this plan** (D1). No `db push`/`db migrate` step exists in any task.

## 2. Current writers/readers of the two columns (verified)

- `last_active_at` writers TODAY: login-only private helper `touchLastActiveAt` (`backend/services/auth/auth.service.ts:514-515`, fire-and-forget from `login` `:203-216`; raw `db.update` bypassing repo); insert-time stamps at registration (`backend/services/auth/registration.service.ts:316`) and admin user-creation (`backend/services/admin/user-management.helpers.ts:342`). Readers: `user.repository.ts:60/:94`, `admin-user.pothos.ts:81-84`, `platform-analytics.repository.ts:117` (24h window const `:87-88`).
- `is_online` writers TODAY (all via `TeacherRepository.setOnline` — `backend/db/repo/teachers/teacher.repository.ts:512-522`, tx REQUIRED, sets `updatedAt: sql`now()``): session lock `session-lifecycle.service.ts:283`, release `session-lifecycle.transitions.ts:250` (UNCONDITIONAL restore — the INV-A4 hazard, sibling `:1338` scope), manual toggle `teacher-availability.service.ts:230`.
- **No per-request/per-heartbeat writer exists. No sweep exists. No `last_active_at` repo method exists.** (All grep-verified at generation time.)

## 3. Shipped seams this plan composes (blocker `1775142f`)

- `TeacherAvailabilityService.getAvailability(teacherId, locale, tx?)` — `teacher-availability.service.ts:103-107` (⚠️ 3-param shipped form; the blocker PLAN pinned 2 params — code is authoritative).
- `TeacherAvailabilityService.setAvailability(teacherId, isOnline, locale, tx?)` — `:178-183`; one `withTransaction` (`:189`); gates Available-direction-only: certification `:209-217` (403) → in-session `:223` via `assertTeacherNotInActiveSession` (`backend/services/classes/session-lifecycle.enforcement.ts:200-214`, throws `ConflictError("TEACHER_IN_ACTIVE_SESSION")`, probes `SessionRepository.listForTeacher(teacherId, { status: SessionStatus.Started }, 1, 0, tx)` — `backend/db/repo/classes/session.repository.ts:635-643`, tx OPTIONAL there).
- GraphQL: `myTeacherAvailability` (`backend/graphql/query/teachers/teacher-availability.query.ts:50-77`) / `setTeacherAvailability(isOnline: Boolean!)` (`backend/graphql/mutation/teachers/teacher-availability.mutation.ts:53-89`), both `authScopes: { $all: { authenticated: true, role: [UserRole.Teacher] } }`; object `TeacherAvailabilityState` (`backend/graphql/pothos/teachers/teacher-availability.pothos.ts:33-48`); type `TeacherAvailabilityReturnType` (`backend/types/teachers/teacher.types.ts:24-28`).
- Frontend: `TeacherAvailabilityCard` (`frontend/views/teachers/dashboard/TeacherAvailabilityCard.tsx:62`), `useTeacherAvailabilityToggle` (`frontend/views/teachers/dashboard/useTeacherAvailabilityToggle.ts:79`), card mounted first in teacher slot (`frontend/views/dashboard/home/RoleDashboardPage.tsx:88-90`), locale namespace `availability` (`shared/locale/namespaces/availability/availability.namespace.ts:4`).
- `SessionStatus` enum: `backend/enum/scheduling/session-status.enum.ts:7-13` (Scheduled/Started/Completed/Cancelled/Disputed — no "pending"; only `Started` counts as in-session for the INV-A2 oracle; `disputed`-from-`started` keeps the lock until arbitration — `session-lifecycle.service.ts:663-665`).

## 4. Trigger/env/cron infrastructure (verified)

- Cron factory: `createCronSweepEndpoint` — `backend/lib/gateway/cron-endpoint.ts:103-105`; gates: raw `getEnv` mode check `:112-116` (bare 404 unless `external` + `true`), rate limiter `:79-83`/`:126-134`, timing-safe bearer `:143-148` (`backend/lib/api/cron-auth.ts:34-51`, SHA-256 + `timingSafeEqual`); honest-counts payload contract.
- Live precedent: `app/api/cron/sweep-sessions/route.ts:29-32` → `SessionLifecycleService.sweepExpiredSessions(outerTx?)` (`session-lifecycle.service.ts:776-808`, ONE `withTransaction`, ONE captured now, guarded repo batch `sweepExpiredScheduledOnce` `session.repository.ts:565-572`). Route tests: `app/api/cron/sweep-sessions/test/sweep-sessions-route.test.ts` (pure-function tier, `mock.module`, env stubs + `afterEach` restore, `:41-78`).
- Route registry: `backend/lib/gateway/route-inventory.ts:62-79` (`ROUTE_INVENTORY` rows; classification `envelope`); registry↔tree equality enforced by `backend/lib/gateway/route-inventory.test.ts:135-160`.
- Env pattern: `backend/lib/env.ts` — `parsePositiveIntegerEnv` `:187-194`; precedent `DEFAULT_PAYMOB_RECONCILE_PENDING_MINUTES` `:126-127`; `EnvironmentConfig` `:274`; `readEnvironment()` `:372`; `getEnvironmentConfig()` `:427-433`; SINGLE invalidator `resetEnvironmentCache()` `:441-443`. `resolveEnvConfig`/`env-config-keys.ts` DO NOT EXIST (stale template references — never cite them).
- **Verified anti-patterns (do NOT introduce):** `scripts/cron-worker.ts` (dead `package.json:65` script), `backend/services/cron/`, `vercel.json`, in-process schedulers, `app/api/fx/refresh`, `backend/lib/cron-auth.ts` (real helper: `backend/lib/api/cron-auth.ts`). Scheduling is EXTERNAL by doctrine (`docs/billing/subscription-validity-window-expiry.md:226-244`).

## 5. GraphQL/context/WS ground truth (verified)

- **Context factory:** `createGraphQLContext` — `backend/graphql/gqlContextFactory.ts:217` (signature), user resolution `:250-274` (Bearer header or `access_token` cookie → `verifyAccessToken` → `UserRepository.findById` at `:259`). The ONE point every authenticated request resolves a verified user. Context-contract test: `backend/graphql/test/context-keys.test.ts` (DB-free harness, `new Request(...)` constructions).
- **Route wiring:** `app/api/graphql/route.ts:100-107` (`startServerAndCreateNextHandler` context hook); Apollo plugins array `app/api/graphql/apollo-server.ts:36` (not needed for this plan — the factory stamp is the chosen seam, D2).
- **Mutation barrel:** `backend/graphql/mutation/index.ts` side-effect-imports every mutation file; `user.mutation.ts` (caller-scoped: `updateMyLocale`) is ALREADY imported — adding `recordMyActivity` there needs NO barrel edit. `updateMyLocale`'s document lives in `frontend/graphql/sharedDocuments/auth/auth.documents.ts` — that is the precedent home for `recordMyActivityMutationDocument`.
- **WS sidecar (DO NOT TOUCH):** separate Bun process (`bun run ws` → `scripts/start-notification-ws.ts`; dev `bun run dev:all`). Push-only: `message()` discards client frames (`backend/ws/notification-ws-server-handlers.ts:74-77`); server pings 30s / 2-miss terminate (`notification-ws-server-constants.ts:7-11`; loop `notification-ws-server-lifecycle.ts:19-43`; pong handler `:78-83`). Boundary: `docs/notifications/realtime-engine.md:197` ("Never reuse the WS sidecar for presence"). Zero `last_active_at`/`is_online` references exist under `backend/ws/` today — that must remain true after this ticket.
- **SSR seam (NOT used by this plan):** `getServerUserContext` — `backend/lib/auth/server-auth.ts:119-133` (`react.cache`-wrapped). No `middleware.ts`/`proxy.ts` exists. `instrumentation.ts:27-33` only warms the payment channel in dev.

## 6. Testing infrastructure (verified)

- `runInRollback` — `backend/db/test/test-utils.ts:34`; `expectRepoError` `:77`; NEVER `.rejects.toThrow()` inside rollback.
- Fixtures: `createTestUser(tx, overrides)` `backend/db/test/entity-setup.ts:74` (`lastActiveAt: new Date()` default `:90` — BACKDATE via overrides), `createTestTeacherRow(tx, userId, overrides)` `:550` (defaults `isApproved: true, isOnline: false`), `createTestSession(tx, teacherId, studentId, overrides)` `:303`.
- Journeys: skeleton = `test/workflows/teachers/teacher-availability.journey.test.ts` (imports `:55-76`, `beforeAll` committing `db.transaction` `:224-238`, `afterAll` `tracked.cleanup()` + `verifyAllAbsent()` `:240-251`, `catchDenial` try/catch `:105-112`, translated substrings via `getServerTranslations("en").errorsTranslations` `:91`). Cast helpers: `provisionCertifiedTeacherActor`/`provisionStudentActor` (`test/workflows/helpers/actor-context.ts:105`/`:88`), `TrackedFixtures` (`tracked-fixtures.ts:173`), `secondPrecisionMs` (`second-precision.ts:21`). Runner: `bun run test/scripts/run-test.ts test/workflows` (NO raw `bun test`; no `test:workflows` script exists). Backdate-never-fake-timers rule: `docs/testing/workflow-journey-tests.md:159-166`; precedent `test/workflows/teachers/cooldown-state-machine.test.ts:504`.
- Service-tier frozen clock: `setSystemTime` from `bun:test` — template `backend/services/classes/session-admin-governance.service.test.ts:62-65`, `:727-738` (restore in `finally`).
- GraphQL wire: `setupTestServerLifecycle` (`test/helpers/test-lifecycle.ts:41`), `testClient` + `extractErrorCode` (`test/helpers/graphql-test-helpers.ts:8`, `:72`), `describeGraphqlSuite` (`test/helpers/skip-when-pglite.ts:56`), fixtures/cleanup (`test/helpers/fixture-rows.ts:36`, `:62`; `db-cleanup.ts:295`); precedent `backend/graphql/test/teacher-availability.integration.test.ts` (`:567-596` suite shape; Bearer per-request context `:458`; runner note `:84-85`).
- Repo test homes: `backend/db/test/repo/users/user.repository.test.ts` (extend), `backend/db/test/repo/teachers/teacher.repository.test.ts` (extend; `setOnline` describe at `:393`).
- Schema-surface inventories: `backend/graphql/test/schema-surface.test.ts` (sibling consts `:943-946`-style, spreads `:1128/:1279/:1507`).

## 7. i18n + logger CORRECTIONS (root AGENTS.md is stale — use THESE)

- `useAppTranslation(handle?)` takes a **NamespaceHandle object** (`useAppTranslation(Availability)`), NOT a string, and NO `Translation` enum exists — `shared/locale/client/use-app-translation.ts:8-16`.
- `getTranslations(locale)` — ONE arg — `shared/locale/server.ts:15`. `getServerTranslations(locale)` — ONE arg, returns the whole bundle (`… .errorsTranslations`) — `shared/locale/server-graphql.ts:3`.
- Backend logger: `@/backend/lib/logger` (`backend/lib/logger.ts:64`; `logDomainError` `:92`). Frontend logger: **`@/frontend/lib/logger`** (`frontend/lib/logger.ts:109-127`, META-FIRST signatures `info/warn/error/debug(meta, message, …)`) — `@/frontend/utils/logger` DOES NOT EXIST.
- This plan adds ZERO locale keys (no-UI ruling); if copy becomes necessary, a namespace = 4 pieces: `types/<name>/labels.ts`, `en/<name>/labels.ts`, `ar/<name>/labels.ts`, `namespaces/<name>/<name>.namespace.ts` (`defineNamespace` — `shared/locale/namespaces/define-namespace.ts:8-13`) + registry (`registry.ts:39-71`) + `en/ar/messages.ts` + `types/message.ts` + parity test (precedent `shared/locale/availability-namespace.parity.test.ts`).

## 8. Frontend mount points (verified)

- `app/(dashboard)/layout.tsx` is a SERVER component rendering client `DashboardLayout` — mount the heartbeat in `DashboardLayout` (`frontend/views/dashboard/layout/DashboardLayout.tsx`, `useAuth()` at `:71`), NOT in the server layout.
- `useAuth()` — `frontend/hooks/auth/useAuth.ts:6` (provides `isAuthenticated`, `isLoading`, `user` with `role`).
- `UserRole` — `backend/enum/users/user-role.enum.ts:5-9` (Admin/Teacher/Student/Parent). Frontend hooks dir convention: `frontend/hooks/<domain>/use-*.ts` (see `notifications/`); deep imports, no new barrels.
- Documents: `frontend/graphql/sharedDocuments/` domain dirs + `documents.contract.test.ts` + `document-test-kit.ts`; naming `{entityName}MutationDocument`.

## 9. Key docs anchors (verified; watch for drift)

`docs/teachers/teacher-availability.md:313-315` (§6.3 forward contract — STALE citation `users.ts:37`, real `:44`), `:14-19`, `:174`, `:297`, `:299-311` · `docs/specs/open-decisions-and-gaps.md:159-163` (B.15), `:47-51` (A.7) · `docs/specs/state-machine-invariants.md:47` (INV-S6), `:117-125` (INV-A1..A4) · `docs/planning/PRODUCTION_READINESS.md:131-140` (§3.1), `:314` (8.7), `:332` (8.25) · `docs/planning/TEAM_ALLOCATION.md:123` · `docs/workflows/02-on-demand-matching-workflow.md:16-26`, `:82-97`, `:147` · `docs/sessions/session-lifecycle.md:46`, `:81`, `:169-173`, `:184` · `docs/backend/cross-stream-contracts.md:56`, `:117-119`.

## 10. Carry-overs for implementers

1. If any `path:line` above has drifted (files evolve fast), re-verify with grep BEFORE citing it in code comments or outcome files — and NEVER write plan artifacts (`REQ-…`, `Task …`, `specs.md`, `plan.md`) into code comments/JSDoc.
2. The context-factory stamp is fire-and-forget: NEVER await it on the request path; failure containment mirrors `auth.service.ts:203-216`.
3. `setSystemTime` for service-tier boundary legs; backdating for journey legs — do not mix.
4. All quality verification via `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) + the semantic checklist; final sweep via `bun quality-gate` (never clear caches).
