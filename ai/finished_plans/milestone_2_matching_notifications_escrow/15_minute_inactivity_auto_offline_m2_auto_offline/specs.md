# Requirements & Specification: 15-Minute Inactivity Auto-Offline

> **Plan directory (verbatim — every header, ledger path, task `0.1`, and self-reference in this document uses this exact string):** `ai/plans/milestone_2_matching_notifications_escrow/15_minute_inactivity_auto_offline_m2_auto_offline`
> **Ticket:** `15-Minute Inactivity Auto-Offline` — Owner Dev 2, Milestone 2, 5 SP, Blocked By `Teacher Availability Toggle (Available/Unavailable)` — **blocker SHIPPED** (squash commit `1775142f`) (`docs/planning/TICKETS.md:1298-1334`; ACs `:1311-1325`, test scenarios `:1328-1332`, decision refs `:1334`).
> **Grounding docs:** `docs/specs/functional-requirements.md:140-142` (**FR-4.2** Automatic Offline) · `docs/specs/open-decisions-and-gaps.md:159-163` (**B.15** — 15-minute inactivity; "`users.last_active_at` column added") and `:47-51` (**A.7** — `last_active_at` on `users` "for inactivity tracking (B.15)") · `docs/specs/state-machine-invariants.md:117-125` (INV-A1..INV-A4) + `:47` (INV-S6) · `docs/teachers/teacher-availability.md:313-315` (§6.3 — the shipped forward contract naming THIS ticket sole owner of the sweep) + `:14-19` (two-writer model) + `:174` (single `is_online` write primitive rule) + `:297` (toggle↔lifecycle sub-second race) + `:299-311` (§6.2 INV-A4 hazard) · `docs/planning/PRODUCTION_READINESS.md:131-140` (§3.1 Presence Heartbeat, rows 3.1.1-3.1.4) + `:332` (8.25) + `:314` (8.7) · `docs/planning/TEAM_ALLOCATION.md:123` ("Dev 2 guarantees: `is_online` is accurate within 15 minutes of last activity; in-session teachers have `is_online = false`") + `:57` · `docs/workflows/02-on-demand-matching-workflow.md:16-26` (state machine) + `:82-97` (state table + §5.3 Automatic Offline) + `:147` (B.15 row) · `docs/sessions/session-lifecycle.md:81` (INV-S6 seam) + `:46` (guarded-transition zero-TOCTOU discipline) + `:169-173` (§8 D3) + `:184` (gotcha (f)) · `docs/backend/cross-stream-contracts.md:117-119` (§7.3 TOCTOU re-assertion) + `:56` (no parallel `inSession` contract flag) · `docs/notifications/realtime-engine.md:197` ("Never reuse the WS sidecar for presence") · `docs/testing/workflow-journey-tests.md:159-166` (backdate-rows rule for time-based journeys).
>
> **⚠️ Load-bearing scope reconciliation (READ FIRST — shapes every section below).** The ticket's Gherkin keys inactivity to "no WebSocket heartbeat or API call" (B.15, `docs/planning/TICKETS.md:1311`). Ground truth forces a precise reading of both halves:
> - **"WebSocket heartbeat" — no client heartbeat exists and none may be added to the WS protocol.** The notification sidecar (`backend/ws/`) is a separate Bun process whose inbound protocol is PUSH-ONLY: every client application frame is discarded (`backend/ws/notification-ws-server-handlers.ts:74-77`, REQ-034 of the realtime engine), the only liveness signal is the browser's protocol-level auto-pong to the server's 30s pings (`backend/ws/notification-ws-server-constants.ts:7-11`, pong handler `notification-ws-server-handlers.ts:78-83`), and the canonical engine doc hard-forbids presence work in the sidecar (`docs/notifications/realtime-engine.md:197`). The realtime engine's own plan excluded the presence duty from the sidecar ("The WS sidecar's connection registry is delivery plumbing, NOT availability truth" — `ai/finished_plans/milestone_2_matching_notifications_escrow/real-time-notification-engine-websocket/specs.md:35`).
> - **Therefore "heartbeat" is satisfied as an API call**: a client-side presence heartbeat that periodically issues an authenticated GraphQL request while the app is open. This keeps `users.last_active_at` truthful, preserves the push-only WS contract and the sidecar boundary, and makes the B.15 disjunction ("no WebSocket heartbeat **or** API call") collapse to one measurable signal: **staleness of `users.last_active_at`**.
> - **"API call" — the only authenticated user API surface is GraphQL.** `app/api/**` contains no user-session route (health is public, set-locale is public, cron is secret-gated, payments webhook is HMAC-gated); every authenticated request resolves a verified user in exactly one place: `createGraphQLContext` (`backend/graphql/gqlContextFactory.ts:217`, user resolution `:250-274`). SSR navigation is not stamped separately because every authenticated client page immediately issues GraphQL operations, and the heartbeat covers the idle-but-open case.
> - **Zero-drift schema baseline.** Both columns already exist — `users.last_active_at` (`backend/db/schema/users/users.ts:44`, migration `backend/drizzle/20260904084151_omniscient_karen_page/migration.sql:344`) and `teacher.is_online` (`backend/db/schema/teachers/teacher.ts:28`). A.7/B.15 shipped them. This ticket adds NO table, NO column, NO enum, NO index, NO migration.
> - **The INV-A4 never-resurrect release seam is NOT absorbed.** `releaseTeacherInSessionLock` (`backend/services/classes/session-lifecycle.transitions.ts:249-257`) still restores `is_online = true` unconditionally on session exit. That gating belongs to sibling `In-Session Locking (Hide from Directory)` (`docs/planning/TICKETS.md:1338` — verified NOT implemented). This ticket's sweep CORRECTS a resurrection at its next pass (honest state within threshold + cadence); it does not modify the release path.
>
> **This ticket therefore ships exactly the slice it owns:** two `UserRepository` activity-stamp primitives, a fire-and-forget per-request activity stamp in the GraphQL context factory, an explicit-intent stamp composed into the shipped `TeacherAvailabilityService.setAvailability` transaction, a login-touch consolidation onto the new repo primitive, one argless `recordMyActivity` mutation + its Apollo document, one teacher-scoped client heartbeat hook mounted in `DashboardLayout`, one guarded batch repo primitive `TeacherRepository.sweepInactiveOnlineOnce`, one sweep service `TeacherInactivityService.sweepInactiveTeachers`, one cron route `/api/cron/sweep-inactive-teachers` riding `createCronSweepEndpoint`, one env-configured threshold (`TEACHER_INACTIVITY_TIMEOUT_MINUTES`, default 15), one route-inventory row, and full 4-tier + journey test locks. This reconciliation is the spec's governing ruling and must be ratified at Phase 1.5 plan review.

---

## 1. Executive Summary & Problem Statement

### 1.1 Feature Summary

The B.15 inactivity timeout. A certified teacher (`teacher.is_approved = true`) who has been Available (`teacher.is_online = true`) goes silent — no authenticated API call and no client heartbeat for a configurable threshold (default 15 minutes) — is automatically flipped to Unavailable (`is_online = false`) by a cron-triggered guarded batch sweep. Every authenticated API call stamps `users.last_active_at` (throttled, monotonic); an open teacher client heartbeats every 5 minutes; a teacher inside a `started` session is structurally never touched by the sweep (in-session lock priority); an auto-offlined teacher resumes by simply toggling Available again through the shipped toggle (`TeacherAvailabilityService.setAvailability`, gates intact).

### 1.2 Problem from user perspective

- **Student (actor-to-be):** must never request a session from a teacher whose app has been closed for an hour. Today `teacher.is_online` stays `true` forever once set — the only writers are the manual toggle (`teacher-availability.service.ts:230`) and the session lifecycle (`session-lifecycle.service.ts:283`, `session-lifecycle.transitions.ts:250`) — nothing ever flips it back to `false` on silence. The platform's on-demand premise (`docs/workflows/02-on-demand-matching-workflow.md:95-97` §5.3) is broken without this sweep.
- **Teacher (primary actor):** after being auto-offlined, returning to the app must "just work": his activity is recorded, and the existing `TeacherAvailabilityCard` (`frontend/views/teachers/dashboard/TeacherAvailabilityCard.tsx:62`, mounted first in the teacher slot of `frontend/views/dashboard/home/RoleDashboardPage.tsx:88-90`) lets him toggle back Available with the INV-A1/INV-A2 gates unchanged.
- **Admin (observer):** the platform presence stats (`getTeacherPresenceStats` — `backend/db/repo/admin/platform-analytics.repository.ts:320`, `onlineNowCount` = `is_approved = true and is_online = true` at `:342`) become trustworthy: `onlineNowCount` decays as idle teachers are swept.
- **Ops (sweep operator):** needs the same externally-triggered, secret-gated, replay-safe cron contract as the three shipped sweeps (`app/api/cron/sweep-sessions/route.ts:29-32`, `app/api/cron/expire-subscriptions/`, `app/api/cron/reconcile-paymob-payments/`).

### 1.3 Business value

- Honors the Dev 2 inter-team guarantee verbatim: "`is_online` is accurate within 15 minutes of last activity; in-session teachers have `is_online = false`" (`docs/planning/TEAM_ALLOCATION.md:123`) — the precondition for Dev 3's matching/directory tickets (`docs/planning/TICKETS.md:1457`, `:1509`).
- Closes the last unimplemented leg of FR-4.2 (`docs/specs/functional-requirements.md:140-142`) and PRODUCTION_READINESS §3.1 rows 3.1.1-3.1.4 + 8.25 (`docs/planning/PRODUCTION_READINESS.md:131-140`, `:332`).
- Keeps `users.last_active_at` fresh for ALL roles (A.7 governance column), which already feeds the admin "last seen" list (`backend/graphql/pothos/admin/admin-user.pothos.ts:81-84`) and the 24h recently-active analytics window (`platform-analytics.repository.ts:87-88`, `:117`).

### 1.4 Scope boundaries

**In scope (this ticket, sole owner per `docs/teachers/teacher-availability.md:313-315`):** the inactivity sweep, all `users.last_active_at` activity writers (per-request stamp, explicit-intent stamps, login consolidation), the client heartbeat, the cron route + inventory row + env threshold, and the tests/docs locks.

**Out of scope (resolved-pointers into `deferred-items.md`, never absorbed):**

| Non-goal | Owning ticket / rationale |
|---|---|
| INV-A4 never-resurrect release gating (`releaseTeacherInSessionLock` is unconditional) | "In-Session Locking (Hide from Directory)" (`docs/planning/TICKETS.md:1338`), Blocked By the same toggle; verified unimplemented. This ticket's sweep self-heals resurrections at the next pass. |
| INV-A3 directory appearance/hiding | Dev 3 — On-Demand Matching (`TICKETS.md:1457`) + Teacher Directory Browse (`TICKETS.md:1509`). The directory does not exist in-tree. |
| Any WS protocol change / sidecar presence work | Hard-forbidden by `docs/notifications/realtime-engine.md:197` + push-only contract (`backend/ws/notification-ws-server-handlers.ts:74-77`). |
| In-process scheduler / cron worker / `vercel.json` | Verified phantom anti-patterns — no scheduler exists in-tree; sweeps are externally triggered by ops (`docs/billing/subscription-validity-window-expiry.md:226-229`). |
| Schema migration, new enum, new index, new locale keys | Zero-drift ruling (REQ-003); no user-facing copy is added. |
| Auto-restore of `is_online = true` on resumed activity | Restore is the manual toggle per the state machine ("Offline → Available: Teacher reopens app **and toggles Available**" — `docs/workflows/02-on-demand-matching-workflow.md:16-26`, line 25). Activity only re-enables the toggle; it never re-onlines by itself. |

---

## 2. Actors & Definitions

| Actor | Identity source | Role in this feature |
|---|---|---|
| Teacher (primary) | `ctx.user.id`, `UserRole.Teacher` (`backend/enum/users/user-role.enum.ts:5-9`) | Subject of the sweep; heartbeats while open; re-toggles via `setTeacherAvailability` after being swept |
| Student | fixture participant only | Creates the session fixture for the in-session exemption journey; performs no action in any journey leg |
| Admin (observer) | `UserRole.Admin` | Observes `onlineNowCount` via `getTeacherPresenceStats` (`platform-analytics.repository.ts:320`); never acts on the sweep |
| System (sweep) | Cron bearer `CRON_SECRET` + `CRON_EXECUTION_MODE=external` + `CRON_EXTERNAL_ENABLED=true` (`backend/lib/gateway/cron-endpoint.ts:112-116`, `:143-148`) | The only trigger of `TeacherInactivityService.sweepInactiveTeachers`; never user-callable via GraphQL |
| Session lifecycle (system) | `SessionLifecycleService` | Owns INV-S6 (`session-lifecycle.service.ts:283`) and the release seam (`session-lifecycle.transitions.ts:249-257`) |

**Definitions:**

| Term | Definition (grounded) |
|---|---|
| Activity | Any event that stamps `users.last_active_at`: an authenticated GraphQL request, an explicit-intent operation (`setAvailability`, `recordMyActivity`), or a login (`auth.service.ts:203-206`) |
| Inactivity threshold | `TEACHER_INACTIVITY_TIMEOUT_MINUTES` (default 15; positive-integer parse with fallback per `backend/lib/env.ts:187-194` pattern) |
| Cutoff | `sweepNow − threshold`; a teacher is swept iff `last_active_at IS NULL OR last_active_at < cutoff` (strict `<`) |
| In-session | A `session` row with `status = started` for the teacher (`backend/enum/scheduling/session-status.enum.ts:7-13`; the INV-A2 oracle probes exactly this — `session-lifecycle.enforcement.ts:205`) |
| Sweep lateness bound | The sweep flips offline at most one cadence after crossing the threshold; recommended external cadence ≤ 5 minutes (ops config, not in-repo) |

---

## 3. Requirements

Requirement bands mirror the sibling toggle plan's numbering convention (decade bands with deliberate gaps for insertion). EARS format throughout; `SHALL` is binding.

### 3.1 Band REQ-001..004 — Baseline, Execution Protocol & Guards

#### REQ-001: Pre-Implementation Baseline & Deferred-Items Ledger

**User Story:** As an executing agent, I want an error baseline and a deferred-items ledger before any implementation, so that new issues are distinguishable from pre-existing ones and no deferred work is lost.

**Acceptance Criteria:**
1. WHEN implementation begins THEN the executing agent SHALL record baseline error counts (`bun tsgo 2>&1 | grep "error TS" | wc -l`, `bun biome:check 2>&1 | grep -c "warn"`, `bun run scripts/lint-service.ts --json --id baseline`) to `/tmp/baseline-*.txt` BEFORE touching any file.
2. WHEN implementation begins THEN the agent SHALL treat `ai/plans/milestone_2_matching_notifications_escrow/15_minute_inactivity_auto_offline_m2_auto_offline/deferred-items.md` as the live ledger, seeding it from the plan's DEF rows and updating statuses as items resolve.
3. WHEN any file is modified THEN the agent SHALL run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` on that file and fix until exit code 0.

#### REQ-002: Outcome Knowledge Base & Progress Tracking

**User Story:** As any executing agent, I want prior research preserved and progress tracked, so that no analysis is repeated and no subtask is silently skipped.

**Acceptance Criteria:**
1. WHEN an agent starts any task THEN it SHALL read ALL existing files in `ai/plans/milestone_2_matching_notifications_escrow/15_minute_inactivity_auto_offline_m2_auto_offline/outcome/` first (starting with `0-ground-truth-outcome.md`).
2. WHEN an agent completes any task THEN it SHALL write `outcome/<task-id>-outcome.md` covering research, changes, cross-file dependencies, and carry-overs.
3. WHEN a subtask completes THEN the agent SHALL update its checkbox `[ ]` → `[x]` in `tasks.md`.
4. WHEN any subtask is marked complete THEN the agent SHALL pass the semantic review checklist (race conditions, env-config registration, dead code, cross-layer imports, enum imports, deferred items) — `sub-loop.ts` cannot detect these.

#### REQ-003: Zero-Drift Schema & i18n Baseline

**User Story:** As a maintainer, I want this feature to add no schema or locale surface, so that the A.7/B.15 columns stay the single source of truth and the compile-time i18n system stays closed over existing namespaces.

**Acceptance Criteria:**
1. IF the implementation completes THEN the tree SHALL contain no new Drizzle table, column, enum, index, or migration for this feature — `users.last_active_at` (`backend/db/schema/users/users.ts:44`) and `teacher.is_online` (`backend/db/schema/teachers/teacher.ts:28`) already exist and are the only state carriers.
2. WHEN any user-facing copy would be needed THEN the agent SHALL use the compile-time i18n system (`useAppTranslation(<NamespaceHandle>)` per `shared/locale/client/use-app-translation.ts:8-16`, one-arg `getTranslations(locale)` per `shared/locale/server.ts:15`, one-arg `getServerTranslations(locale)` per `shared/locale/server-graphql.ts:3`); this ticket is ruled to add ZERO new locale keys (the heartbeat is silent and no new UI copy exists), so criterion 2 is a guard, not an invitation.
3. WHEN logging is needed THEN backend code SHALL import `logger` from `@/backend/lib/logger` (`backend/lib/logger.ts:64`, `logDomainError` `:92`) and frontend code from `@/frontend/lib/logger` (`frontend/lib/logger.ts:109-127`, meta-first signatures) — the `@/frontend/utils/logger` path does not exist.
4. WHEN enums are used at runtime THEN they SHALL be value imports (e.g. `SessionStatus` from `@/backend/enum/scheduling/session-status.enum`), never `import type`.

#### REQ-004: Seam & Boundary Guard

**User Story:** As the owner of the availability invariants, I want the sweep to compose only through documented seams, so that the two-writer discipline and the WS boundary survive this feature.

**Acceptance Criteria:**
1. WHEN `teacher.is_online` is written THEN the write SHALL go through `TeacherRepository.setOnline` or the new batch primitive `TeacherRepository.sweepInactiveOnlineOnce` in `backend/db/repo/teachers/teacher.repository.ts` — never a raw `db.update(teacher)` outside the repo layer (single-writer rule, `docs/teachers/teacher-availability.md:174`).
2. WHEN `users.last_active_at` is written THEN the write SHALL go through `UserRepository` in `backend/db/repo/users/user.repository.ts` — the module-private raw-db helper `touchLastActiveAt` in `backend/services/auth/auth.service.ts:514-515` SHALL be removed as part of the login consolidation (REQ-013), leaving zero non-repo writers.
3. IF the implementation touches `backend/ws/**` THEN it SHALL be rejected — presence work in the sidecar is forbidden (`docs/notifications/realtime-engine.md:197`; push-only contract `backend/ws/notification-ws-server-handlers.ts:74-77`, `backend/ws/AGENTS.md`).
4. IF the implementation introduces an in-process scheduler, cron worker script, or `vercel.json` THEN it SHALL be rejected — verified anti-patterns; the only sanctioned trigger is the external cron-route contract (`backend/lib/gateway/cron-endpoint.ts:103-105`).
5. WHEN the sweep composes the in-session exemption THEN it SHALL key on the same oracle the INV-A2 gate uses — `session.status = SessionStatus.Started` (`session-lifecycle.enforcement.ts:205`) — not on a derived or parallel notion.

### 3.2 Band REQ-010..018 — Core Feature Logic

#### REQ-010: Canonical Activity-Stamp Repository Primitives

**User Story:** As the GraphQL/service layers, I want two monotonic `last_active_at` write primitives on `UserRepository`, so that every activity writer composes one audited path with no timestamp regression.

**Acceptance Criteria:**
1. WHEN `UserRepository.updateLastActiveAt(userId: number, now: Date, tx?: DBQueryExecutor)` runs THEN it SHALL flip `last_active_at` to `now` in a single guarded `UPDATE … WHERE users.id = userId AND (last_active_at IS NULL OR last_active_at < now) RETURNING` and return whether a row updated (monotonic — never regresses; strict `<` so equal timestamps are a no-op miss); the optional executor serves both fire-and-forget callers (login) and in-transaction callers (the toggle's `innerTx`).
2. WHEN `UserRepository.updateLastActiveAtIfStale(userId: number, staleBefore: Date, now: Date, tx?: DBQueryExecutor)` runs THEN it SHALL additionally require `last_active_at IS NULL OR last_active_at < staleBefore` in the same single-statement predicate (throttle folded into the WHERE — no read-then-write), returning whether a row updated; `tx` SHALL be optional (dual-branch executor, `db`/`queryDb` fallback precedent `platform-analytics.repository.ts:117-140`).
3. WHEN either method is defined THEN `USER_ACTIVITY_COALESCE_WINDOW_MS` (60_000) SHALL be exported from `backend/db/repo/users/user.repository.ts` next to the methods (window-const precedent `RECENT_ACTIVITY_WINDOW_MS`, `platform-analytics.repository.ts:87-88`).
4. IF `userId` is not a positive safe integer THEN the repo layer behavior SHALL follow the existing repo convention (guarded UPDATE matches zero rows; the service tier disambiguates).
5. WHEN tests are authored THEN both methods SHALL reach 100% branch coverage under `runInRollback` (`backend/db/test/test-utils.ts:34`) in `backend/db/test/repo/users/user.repository.test.ts`.

#### REQ-011: Per-Request GraphQL Activity Stamp

**User Story:** As any authenticated user making an API call, I want my `users.last_active_at` stamped, so that "API call" counts as activity per B.15.

**Acceptance Criteria:**
1. WHEN `createGraphQLContext` (`backend/graphql/gqlContextFactory.ts:217`) resolves a verified user (`UserRepository.findById` at `:259`) THEN it SHALL issue a fire-and-forget `UserRepository.updateLastActiveAtIfStale(user.id, staleBefore, now)` with one captured `now` and `staleBefore = now − USER_ACTIVITY_COALESCE_WINDOW_MS`, for ALL roles (A.7 users-level column), never blocking the request.
2. WHEN the stamp fails (transient DB error) THEN the failure SHALL be swallowed with a logged catch (mirror the login precedent `auth.service.ts:203-216`) and the request SHALL proceed — activity stamping MUST NOT fail authentication or any operation.
3. IF the request is unauthenticated (no verified user) THEN no stamp SHALL be issued (anonymous requests never write).
4. WHEN the stamp is issued THEN it SHALL NOT change the `Context` interface shape (no new context keys — the context-contract test `backend/graphql/test/context-keys.test.ts` stays green) and SHALL exist at exactly one capture site in `gqlContextFactory.ts`.
5. WHEN stamps from concurrent requests land out of order THEN the monotonic predicate (REQ-010) SHALL guarantee `last_active_at` never moves backwards.

#### REQ-012: Explicit-Intent Stamp Inside the Toggle Transaction

**User Story:** As a teacher toggling Available, I want my intent to atomically count as activity, so that the sweep can never race my fresh toggle into a false offline.

**Acceptance Criteria:**
1. WHEN `TeacherAvailabilityService.setAvailability` (`backend/services/teachers/teacher-availability.service.ts:178-183`) completes its write THEN the SAME transaction (`innerTx`, `withTransaction` at `:189`) SHALL compose `UserRepository.updateLastActiveAt(teacherId, now, innerTx)` — one captured `now` — so a fresh toggle carries a fresh activity timestamp atomically.
2. WHEN the stamp runs THEN the existing gates (INV-A1 certification `:209-217`, INV-A2 in-session `:223` via `assertTeacherNotInActiveSession`) and the write path (`TeacherRepository.setOnline` at `:230`) SHALL remain byte-identical in behavior and order — this is an additive composition, not a rewrite.
3. IF a concurrent sweep serializes against the toggle THEN every interleaving SHALL be honest: sweep-first commits offline then the toggle overwrites online with a fresh stamp; toggle-first commits a fresh stamp so the sweep's staleness predicate fails.
4. WHEN tests are authored THEN the EXTENDED service SHALL re-run the existing `backend/services/teachers/teacher-availability.service.test.ts` matrix green plus new assertions that the stamp lands in-transaction (rollback-visible, `runInRollback`).

#### REQ-013: Login-Touch Consolidation onto the Repository Primitive

**User Story:** As a maintainer of the users repository, I want the login-time activity touch to use the new repo primitive, so that exactly one code path writes `last_active_at` outside the per-request stamp.

**Acceptance Criteria:**
1. WHEN `AuthService.login` (`backend/services/auth/auth.service.ts:169`) performs its fire-and-forget post-login bump (`:203-216`) THEN it SHALL call `UserRepository.updateLastActiveAt(user.id, now)` (optional-executor form, no transaction needed) instead of the module-private raw-db `touchLastActiveAt` helper.
2. WHEN the refactor lands THEN the private helper at `auth.service.ts:514-515` (direct `db.update(users)` bypassing the repo layer) SHALL be deleted — zero non-repo writers of `last_active_at` remain (REQ-004.2).
3. WHEN the refactor lands THEN the fire-and-forget contract SHALL be preserved verbatim (login never fails on stamp errors; error path logs).
4. WHEN registration (`backend/services/auth/registration.service.ts:316`) or admin user-creation (`backend/services/admin/user-management.helpers.ts:342`) insert rows with `lastActiveAt: new Date()` THEN those insert-time stamps SHALL remain untouched (inserts are not updates; no behavior change).

#### REQ-014: `recordMyActivity` Mutation (the heartbeat's server leg)

**User Story:** As an authenticated client with an open-but-idle app, I want a minimal authenticated no-op-with-stamp operation, so that my presence stays fresh without polluting domain queries.

**Acceptance Criteria:**
1. WHEN the mutation `recordMyActivity` is defined THEN it SHALL live in `backend/graphql/mutation/user.mutation.ts` (the caller-scoped user-mutations file that wires `updateMyLocale`; barrel import already present in `backend/graphql/mutation/index.ts`) with SDL `recordMyActivity: Boolean!`, ZERO arguments (identity from `ctx.user.id` — BOPLA: no client-owned value exists), and `authScopes: { authenticated: true }` (all four roles, no role gate).
2. WHEN the resolver runs THEN it SHALL delegate in one line to `AuthService.recordMyActivity(ctx.user.id)` (NEW service method in `backend/services/auth/auth.service.ts` — the service `user.mutation.ts` already imports) which captures ONE `now` and wraps one `UserRepository.updateLastActiveAt(userId, now, tx)` in `withTransaction(undefined, …)` (`backend/lib/db/with-transaction.ts:42`) and returns `true`; the resolver SHALL contain zero inline business logic and zero repository imports (resolver-delegation rule, `backend/graphql/mutation/AGENTS.md`); it SHALL NOT read or return any user data.
3. IF the caller is unauthenticated THEN the mutation SHALL be denied with the standard 401 auth-scope error BEFORE the resolver runs (no repo call).
4. WHEN the SDL changes THEN the committed schema artifact (`frontend/graphql/generated/schema.graphql`) SHALL be regenerated (`bun run generate:gqlSchema`, `bun codegen`) and the schema-surface inventory SHALL gain a `USER_ACTIVITY_MUTATION_FIELDS = ["recordMyActivity"] as const` const registered in the mutation assertions of `backend/graphql/test/schema-surface.test.ts` (sibling precedent `TEACHER_AVAILABILITY_MUTATION_FIELDS`).
5. WHEN the Apollo document is defined THEN `recordMyActivityMutationDocument` SHALL live in `frontend/graphql/sharedDocuments/auth/auth.documents.ts` (the caller-scoped document home of `updateMyLocale`) and the documents contract test (`frontend/graphql/sharedDocuments/documents.contract.test.ts`) SHALL stay green.

#### REQ-015: Teacher Client Presence Heartbeat

**User Story:** As a teacher with the app open, I want my client to heartbeat while I am present, so that an open app is never swept offline and a closed/backgrounded app reliably is.

**Acceptance Criteria:**
1. WHEN a teacher is authenticated in the dashboard shell THEN `DashboardLayout` (`frontend/views/dashboard/layout/DashboardLayout.tsx`, `useAuth()` at `:71`) SHALL mount a new hook `useTeacherPresenceHeartbeat` (new file `frontend/hooks/presence/use-teacher-presence-heartbeat.ts`, deep-imported — no barrel) gated on `user?.role === UserRole.Teacher && isAuthenticated && !isLoading`; the hook SHALL obtain the beat via `useMutation(recordMyActivityMutationDocument)` imported from `@/apollo/client/react` (never `@/apollo/client` root, never `useLazyQuery`).
2. WHILE the document is visible (`document.visibilityState === "visible"`) THEN the hook SHALL fire `recordMyActivity` every `TEACHER_PRESENCE_HEARTBEAT_INTERVAL_MS = 5 * 60_000` (module constant, co-located and exported for tests); the cadence rule is heartbeat interval < threshold / 2 (5 < 15/2 with margin), tolerating one missed beat.
3. WHEN the document is hidden or the teacher logs out THEN the heartbeat SHALL stop (timer cleared; no trailing beat) — a backgrounded/closed app goes silent and is swept after the threshold.
4. WHEN a beat fails THEN the hook SHALL log via `@/frontend/lib/logger` and continue the schedule (no toast, no user-facing copy, no state) — silence is the contract.
5. IF the user is not a teacher THEN the hook SHALL mount no timer at all (zero cost for other roles).
6. WHEN tests are authored THEN the hook SHALL be pinned by a bun test exercising interval + visibility gating with stubbed globals (timer + `document`) — `frontend/hooks/presence/use-teacher-presence-heartbeat.test.ts`.

#### REQ-016: Inactivity Threshold Environment Configuration

**User Story:** As an operator, I want the threshold configurable without code changes, so that tuning does not require a deploy.

**Acceptance Criteria:**
1. WHEN `TEACHER_INACTIVITY_TIMEOUT_MINUTES` is unset, empty, non-numeric, or < 1 THEN the resolved threshold SHALL fall back to `DEFAULT_TEACHER_INACTIVITY_TIMEOUT_MINUTES = 15` via `parsePositiveIntegerEnv` (`backend/lib/env.ts:187-194`), following the `PAYMOB_RECONCILE_PENDING_MINUTES` precedent (`backend/lib/env.ts:126-127`).
2. WHEN the environment snapshot is built THEN `EnvironmentConfig` (`backend/lib/env.ts:274`) SHALL gain `teacherInactivityTimeoutMinutes: number`, assigned in `readEnvironment()` (`:372`), exposed via a typed getter, and documented in `.env.example` next to the WS section (`:74-103` area).
3. WHEN tests stub the key THEN they SHALL call `resetEnvironmentCache()` (`backend/lib/env.ts:441-443`) — the single cache invalidator; no per-key reset functions exist or may be added.
4. IF the threshold is resolved to a value < 1 THEN the parse helper SHALL have already substituted the default (no runtime validation path beyond the parse).

#### REQ-017: The Inactivity Sweep Service

**User Story:** As the platform, I want one transactional, replay-safe sweep primitive, so that ops can flip idle teachers offline on a schedule with honest counts.

**Acceptance Criteria:**
1. WHEN the sweep runs THEN `TeacherInactivityService.sweepInactiveTeachers(outerTx?: DBTransaction): Promise<TeacherInactivitySweepReturnType>` (NEW `backend/services/teachers/teacher-inactivity.service.ts`, namespace pattern matching `TeacherAvailabilityService`) SHALL open ONE `withTransaction(outerTx, …)` (`backend/lib/db/with-transaction.ts:42`), capture ONE `now = new Date()`, compute `cutoff = now − getTeacherInactivityTimeoutMinutes() minutes`, and delegate entirely to `TeacherRepository.sweepInactiveOnlineOnce(now, cutoff, tx)` returning `{ offlined }`.
2. WHEN the return type is defined THEN `TeacherInactivitySweepReturnType { readonly offlined: number }` SHALL live additively in `backend/types/teachers/teacher.types.ts` (canonical types file; no service-local `.types.ts`).
3. IF a replay runs immediately after a successful sweep THEN it SHALL return `{ offlined: 0 }` — the guarded predicate (is_online = true) matches zero rows; the sweep is idempotent by construction.
4. WHEN the sweep is triggered in production THEN it SHALL be reachable ONLY via the cron route (REQ-063) — never via GraphQL, never client-callable; the service method's `outerTx` seam exists for tests and future composition exactly like `sweepExpiredSessions` (`backend/services/classes/session-lifecycle.service.ts:776-808`).
5. WHEN the sweep is tested at the service tier THEN boundary cases SHALL use `setSystemTime` from `bun:test` (sanctioned frozen-clock precedent `backend/services/classes/session-admin-governance.service.test.ts:727-738`): 14-min-stale stays online, 15-min-1s-stale is swept, exactly-15-min-stale stays online (strict `<`).

#### REQ-018: The Guarded Batch Sweep Repository Primitive

**User Story:** As the sweep service, I want a single-statement batch offline primitive, so that predicate and mutation share one row lock with zero TOCTOU.

**Acceptance Criteria:**
1. WHEN `TeacherRepository.sweepInactiveOnlineOnce(now: Date, cutoff: Date, tx: DBTransaction): Promise<number>` (additive in `backend/db/repo/teachers/teacher.repository.ts`) runs THEN it SHALL execute ONE guarded batch `UPDATE teacher SET is_online = false, updated_at = <now> WHERE` — all three predicates folded into the WHERE:
   - `teacher.is_online = true` (guarded-transition discipline; zero-row result = nothing to do — `backend/db/repo/AGENTS.md` "Guarded transition writes" rule, `docs/sessions/session-lifecycle.md:46`);
   - expired activity: `EXISTS (SELECT 1 FROM users WHERE users.id = teacher.id AND (users.last_active_at IS NULL OR users.last_active_at < cutoff))` (NULL ⇒ never active ⇒ swept — REQ-052);
   - in-session exemption: `NOT EXISTS (SELECT 1 FROM session WHERE session.teacher_id = teacher.id AND session.status = 'started')` (belt-and-braces on top of the `is_online = true` guard — REQ-051).
2. WHEN it completes THEN it SHALL return the count from `.returning({ id: teacher.id })` — honest counts only, no row identities cross the boundary (cron payload contract).
3. WHEN Drizzle composes the subqueries THEN table references SHALL use the schema imports (`users` from `@/backend/db/schema/users/users`, `session` from `@/backend/db/schema/classes/session` — `session` table at `:54`, `teacher_id` at `:58`, `status` at `:64`) and `SessionStatus.Started` SHALL be the runtime enum member (`backend/enum/scheduling/session-status.enum.ts:7-13`, value import), never a string literal.
4. WHEN the method is authored THEN no inline `--` comments SHALL appear inside `sql\`\`` templates (parameter-binding hazard) and no prepared statement SHALL be used (plain guarded `tx.update(...)` matching the file's existing style, e.g. `setOnline` at `:512-522`).
5. WHEN tests are authored THEN the primitive SHALL reach 100% branch coverage under `runInRollback` in `backend/db/test/repo/teachers/teacher.repository.test.ts` (new `describe("TeacherRepository.sweepInactiveOnlineOnce …")` beside the `setOnline` suite at `:393`).

### 3.3 Band REQ-030..034 — Security, Authorization & Tenancy

#### REQ-030: BOLA / Identity Defense

**Acceptance Criteria:**
1. WHEN any activity write is issued THEN the target user id SHALL be server-derived — `ctx.user.id` in the context factory (`gqlContextFactory.ts:259` area) and the mutation resolver, `ctx.user.id`/`teacherId` inside `setAvailability`, `started.teacherId` in lifecycle paths — no client-supplied id ever reaches a `last_active_at` or `is_online` write.
2. WHEN the sweep selects victims THEN selection SHALL be predicate-driven from table state only — the sweep accepts NO user ids, NO client parameters, and NO GraphQL exposure; there is no object for a caller to reference (nothing to BOLA).

#### REQ-031: BFLA / Function-Level Access

**Acceptance Criteria:**
1. WHEN `recordMyActivity` is called by any authenticated role (teacher/student/parent/admin) THEN it SHALL succeed — it is a self-scoped no-op-with-stamp, not an administrative function.
2. WHEN the sweep is invoked THEN the ONLY path SHALL be the cron route's gate chain: bare-404 unless `CRON_EXECUTION_MODE === "external"` AND `CRON_EXTERNAL_ENABLED === "true"` (`backend/lib/gateway/cron-endpoint.ts:112-116`), then timing-safe SHA-256 `bearerSecretMatches` (`backend/lib/api/cron-auth.ts:34-51`), then the `cron-sweep` rate limiter (`:79-83`).
3. IF a low-privilege token (student/parent) is used against `/api/cron/sweep-inactive-teachers` without the bearer secret THEN the route SHALL answer the standard 401 envelope; with the mode gates off it SHALL answer a bare 404 indistinguishable from an unknown path.
4. IF any proposal exposes the sweep via GraphQL or an ops script mutates `is_online` outside the repo primitives THEN it SHALL be rejected (REQ-004.1, REQ-004.4).

#### REQ-032: BOPLA / Mass-Assignment Defense

**Acceptance Criteria:**
1. WHEN `recordMyActivity` is defined THEN it SHALL declare ZERO arguments — there is no input object, no spread surface, nothing to mass-assign (identity is `ctx.user.id`, mirroring the toggle's BOPLA note at `backend/graphql/mutation/teachers/teacher-availability.mutation.ts:56-58`).
2. WHEN any new write composes THEN its `.set()` SHALL enumerate explicit fields only (`lastActiveAt`, `isOnline`, `updatedAt`) — no `{ ...input }` spread into any Drizzle update.
3. WHEN the context-factory stamp composes THEN it SHALL pass only server-computed values (userId, staleBefore, now).

#### REQ-033: Tenancy & Multi-Instance Safety

**Acceptance Criteria:**
1. WHEN multiple Next.js instances stamp concurrently THEN the monotonic predicate (REQ-010) SHALL keep `last_active_at` coherent across instances without coordination; write volume is bounded by the coalesce window (≤ 1 write/user/minute per instance).
2. WHEN the external scheduler overlaps sweep invocations THEN both runs SHALL serialize on the teacher row locks; the second is a zero-row no-op (REQ-043).
3. WHEN the WS sidecar runs THEN it SHALL remain fully decoupled: no sidecar code path reads or writes `last_active_at` or `is_online` (grep-verifiable: zero matches in `backend/ws/` — preserving today's state, `backend/ws/` has none).

#### REQ-034: WS Sidecar Boundary Preservation

**Acceptance Criteria:**
1. IF any part of the implementation writes presence state from `backend/ws/**` or adds an inbound application frame type THEN it SHALL be rejected (push-only protocol, `backend/ws/notification-ws-server-handlers.ts:74-77`; boundary, `docs/notifications/realtime-engine.md:197`).
2. WHEN the feature completes THEN `backend/ws/` SHALL be byte-untouched by this ticket (the heartbeat rides the GraphQL API — REQ-014/REQ-015).

### 3.4 Band REQ-040..043 — Atomicity, Concurrency & Data Integrity

#### REQ-040: Single-Statement Guarded Writes

**Acceptance Criteria:**
1. WHEN any new write ships (two user-repo stamps, the toggle in-tx stamp, the batch sweep) THEN each SHALL be a single guarded `UPDATE … WHERE <identity> AND <required predicate> RETURNING` — predicate evaluation and mutation share one statement under the row lock (TOCTOU zero by construction, `docs/sessions/session-lifecycle.md:46`).
2. WHEN a guarded write matches zero rows THEN the miss SHALL be expressed by the boolean/count return; the service tier disambiguates — never SELECT-then-UPDATE.

#### REQ-041: Monotonic Timestamp Discipline

**Acceptance Criteria:**
1. WHEN any `last_active_at` stamp lands THEN the stored value SHALL never regress: every writer composes the `IS NULL OR last_active_at < now` predicate (REQ-010.1).
2. WHEN out-of-order fire-and-forget stamps race (context stamp vs. mutation stamp on the same request) THEN the loser SHALL be a no-op miss — worst-case duplicate forward write, never a backwards one.
3. WHEN the sweep computes cutoff THEN it SHALL capture ONE `now` per sweep run and derive both `updated_at` and `cutoff` from it (one-now discipline, `sweepExpiredSessions` precedent `session-lifecycle.service.ts:778-780`).

#### REQ-042: Sweep ↔ Writer Serialization Matrix

**Acceptance Criteria:**
1. WHEN the sweep serializes after `TeacherAvailabilityService.setAvailability(true)` THEN the toggle's in-tx stamp (REQ-012) SHALL make the sweep's staleness predicate fail — fresh intent is never swept.
2. WHEN the sweep serializes before the toggle THEN the toggle SHALL overwrite to online with a fresh stamp — user intent wins and the next sweep leaves the teacher alone.
3. WHEN the sweep serializes against `startSession`'s lock write (`session-lifecycle.service.ts:283`) THEN both write `is_online = false` — idempotent-compatible in either order; the started teacher can never end up online.
4. WHEN the sweep serializes against `releaseTeacherInSessionLock` (`session-lifecycle.transitions.ts:249-257`) THEN the release MAY restore `true` for an inactive teacher (INV-A4 hazard, sibling `:1338` scope); the next sweep SHALL re-offline them — the invariant "`is_online` accurate within threshold + cadence" holds (D10 ruling).
5. WHEN the sweep races the toggle↔lifecycle sub-second window (`docs/teachers/teacher-availability.md:297`) THEN the in-session `NOT EXISTS` predicate (REQ-018.1c) SHALL make the sweep skip the teacher entirely — the lock always takes priority.

#### REQ-043: Idempotent Replay & Honest Counts

**Acceptance Criteria:**
1. WHEN the cron route is replayed (overlap, retry, double-fire) THEN the sweep SHALL be a safe zero-row no-op after the first pass (guarded predicate on `is_online = true`).
2. WHEN the route responds THEN the payload SHALL be honest counts only — `{ offlined: number }` — mirroring `payload: result => ({ cancelled: …, refunded: … })` (`app/api/cron/sweep-sessions/route.ts:31`); zero identities cross the wire.

### 3.5 Band REQ-050..053 — Validation, Boundary & Failure Semantics

#### REQ-050: Threshold Boundary Semantics

**Acceptance Criteria:**
1. WHEN a teacher's `last_active_at` is exactly `cutoff` old THEN the teacher SHALL NOT be swept (predicate is strict `<`; "AFTER 15 minutes pass" — `docs/planning/TICKETS.md:1311-1313`).
2. WHEN `last_active_at` is 14 minutes old (or fresher) THEN the teacher SHALL stay online (ticket scenario "Teacher inactive for 14 min — is_online stays true", `:1329`).
3. WHEN `last_active_at` is 15 minutes + 1 second old THEN the teacher SHALL be swept (ticket scenario "inactive for 15 min — is_online set to false", `:1328`).
4. WHEN the env key is malformed THEN the parse SHALL silently fall back to 15 (REQ-016.1) — the sweep never crashes on configuration garbage.

#### REQ-051: In-Session Exemption (Lock Priority)

**Acceptance Criteria:**
1. WHEN the sweep evaluates a teacher with a `started` session THEN the teacher SHALL be skipped even in the documented sub-second race window where `is_online` may still read `true` (REQ-018.1c) — "the teacher is NOT auto-set to offline (in-session lock takes priority)" (`docs/planning/TICKETS.md:1322-1324`; PRODUCTION_READINESS 3.1.3 `:134`).
2. WHEN a teacher is in-session THEN `is_online` is already `false` (INV-S6, set at `session-lifecycle.service.ts:283`) so the primary `is_online = true` predicate already excludes them; the `NOT EXISTS` guard is defense-in-depth, and both SHALL be present.
3. IF a session is `disputed`-from-`started` THEN the teacher's `is_online` stays `false` (the lock releases only at arbitration — `session-lifecycle.service.ts:663-665`); the sweep's `is_online = true` predicate skips them — no special-casing of `disputed` is introduced.

#### REQ-052: NULL-Activity Semantics

**Acceptance Criteria:**
1. WHEN a teacher row has `is_online = true` AND `last_active_at IS NULL` THEN the sweep SHALL offline them (no recorded activity ever ⇒ claiming "active within 15 minutes" is impossible — the honest reading of TEAM_ALLOCATION `:123`).
2. WHEN the sweep offlines a NULL-activity teacher THEN the write is identical to any other sweep write (no separate code path).

#### REQ-053: Failure Containment

**Acceptance Criteria:**
1. WHEN an activity stamp fails THEN the originating request SHALL succeed (fire-and-forget + catch + `logger` — REQ-011.2, REQ-013.3); a broken stamp pipeline can never take down traffic.
2. WHEN the sweep fails mid-transaction THEN the whole sweep SHALL roll back (one `withTransaction` — REQ-017.1) and the cron envelope SHALL surface the failure per the shared route contract (`backend/lib/gateway/cron-endpoint.ts:152-157` sweep invocation + error envelope).
3. WHEN the heartbeat mutation fails client-side THEN the hook SHALL log and continue (REQ-015.4) — a flaky beat never unmounts or degrades the dashboard.

### 3.6 Band REQ-060..063 — GraphQL, Frontend & Route Contracts

#### REQ-060: GraphQL SDL & Schema-Surface Contracts

**Acceptance Criteria:**
1. WHEN the SDL is regenerated THEN `Mutation.recordMyActivity: Boolean!` SHALL appear in `frontend/graphql/generated/schema.graphql` and `bun codegen` SHALL regenerate hook types.
2. WHEN the schema-surface inventory is updated THEN a new `USER_ACTIVITY_MUTATION_FIELDS` const SHALL be registered in `backend/graphql/test/schema-surface.test.ts` mutation assertions (sibling precedent: `TEACHER_AVAILABILITY_MUTATION_FIELDS` const at `:944`, spread in the single mutation-assertion block at `:1279`).
3. WHEN the mutation is wired THEN it SHALL register via the existing side-effect import of `user.mutation.ts` in `backend/graphql/mutation/index.ts` — NO barrel edit needed (the file is already imported).

#### REQ-061: Apollo Document Contract

**Acceptance Criteria:**
1. WHEN the document ships THEN `recordMyActivityMutationDocument` SHALL live in `frontend/graphql/sharedDocuments/auth/auth.documents.ts` (caller-scoped document home, `updateMyLocale` precedent), follow the `{entityName}MutationDocument` naming rule, and return a scalar `Boolean!` (no `id` field normalization requirement applies).
2. WHEN documents tests run THEN `frontend/graphql/sharedDocuments/documents.contract.test.ts` SHALL stay green (the contract test enumerates documents; the sibling added `teacher-availability.documents.test.ts` — this ticket extends `auth.documents.ts` within the existing contract).

#### REQ-062: Heartbeat Mount Contract

**Acceptance Criteria:**
1. WHEN a teacher renders any dashboard page THEN the heartbeat SHALL be mounted from `DashboardLayout` (`frontend/views/dashboard/layout/DashboardLayout.tsx:71` — the single client shell wrapping every `(dashboard)` route; server layout `app/(dashboard)/layout.tsx` stays untouched).
2. WHEN any non-teacher (student/parent/admin) renders the shell THEN no timer SHALL exist (REQ-015.5).
3. WHEN the heartbeat runs THEN it SHALL NOT render any UI, add navigation, or introduce routes — the UX surface of this ticket is ZERO (explicit no-UI ruling; the existing `TeacherAvailabilityCard` remains the only availability surface).

#### REQ-063: Cron Route & Inventory Contract

**Acceptance Criteria:**
1. WHEN the route ships THEN `app/api/cron/sweep-inactive-teachers/route.ts` SHALL be exactly the factory shape: `export const GET = createCronSweepEndpoint({ run: () => TeacherInactivityService.sweepInactiveTeachers(), payload: result => ({ offlined: result.offlined }) });` (mirror `app/api/cron/sweep-sessions/route.ts:29-32`).
2. WHEN the route ships THEN `backend/lib/gateway/route-inventory.ts` SHALL gain the row `{ path: "/api/cron/sweep-inactive-teachers", classification: "envelope" }` with a comment mirroring the siblings (`:68-77`), and the route-inventory static-assertions suite (`backend/lib/gateway/route-inventory.test.ts:135-160`) SHALL stay green (registry ↔ live-tree equality enforced).
3. WHEN the mode gates are off THEN the route SHALL answer a bare 404 (no envelope — disabled deployments indistinguishable from unknown paths, `cron-endpoint.ts:70`, `:112-116`).
4. WHEN ops schedules it THEN the documented contract from `docs/billing/subscription-validity-window-expiry.md:226-244` SHALL apply unchanged (bearer + external scheduler; recommended cadence ≤ 5 min; kill switch = `CRON_EXTERNAL_ENABLED`).

### 3.7 Band REQ-070..075 — Test Coverage Gates

#### REQ-070: Repository Tier (100% branch, `runInRollback`)

**Acceptance Criteria:**
1. WHEN repo tests ship THEN `backend/db/test/repo/users/user.repository.test.ts` SHALL cover `updateLastActiveAt` + `updateLastActiveAtIfStale` 100% (branch+statement): write, NULL-flip, monotonic-no-op (older `now`), equal-timestamp miss, stale-window hit/miss, zero-row miss on unknown id — all inside `runInRollback` with `tx` propagated to every repo call (`backend/db/test/test-utils.ts:34`).
2. WHEN repo tests ship THEN `backend/db/test/repo/teachers/teacher.repository.test.ts` SHALL cover `sweepInactiveOnlineOnce` 100%: sweeps online+stale; skips fresh-activity; skips already-offline; skips in-session (started row present); sweeps NULL-activity; replay = 0 rows; `updated_at` bumped; honest count returned — `runInRollback` throughout.
3. WHEN negative paths are tested THEN the try/catch `expectRepoError` pattern SHALL be used — NEVER `expect(...).rejects.toThrow()` inside `runInRollback` (deadlock rule).

#### REQ-071: Service Tier (frozen-clock boundaries)

**Acceptance Criteria:**
1. WHEN service tests ship THEN NEW `backend/services/teachers/teacher-inactivity.service.test.ts` SHALL pin: threshold-from-env resolution (stub key + `resetEnvironmentCache()`), cutoff arithmetic, one-transaction composition (spy on `TeacherRepository.sweepInactiveOnlineOnce` receiving `(now, cutoff, tx)` with `cutoff = now − threshold`), zero-count pass-through, and `outerTx` seam (SAVEPOINT join vs. own transaction — `withTransaction` at `backend/lib/db/with-transaction.ts:42`).
2. WHEN boundary proofs run THEN `setSystemTime` SHALL freeze the clock for 14:59 / 15:00 / 15:01 staleness legs (template: `backend/services/classes/session-admin-governance.service.test.ts:727-738`, restore in `finally`), with fixture activity timestamps backdated via `createTestUser(tx, { lastActiveAt: … })` (`backend/db/test/entity-setup.ts:74`, `:90`).
3. WHEN the EXTENDED `setAvailability` is tested THEN `backend/services/teachers/teacher-availability.service.test.ts` SHALL stay green and gain in-tx stamp assertions (rollback of the toggle rolls back the stamp).

#### REQ-072: GraphQL Integration Tier

**Acceptance Criteria:**
1. WHEN the mutation ships THEN a GraphQL integration suite (NEW `backend/graphql/test/user-activity.integration.test.ts`) SHALL run via `setupTestServerLifecycle()` + `testClient` (`test/helpers/test-lifecycle.ts:41`, `test/helpers/graphql-test-helpers.ts:8`) under `describeGraphqlSuite` (`test/helpers/skip-when-pglite.ts:56`): authenticated teacher → `true` + `users.last_active_at` fresh in DB; unauthenticated → 401 denial; all four roles accepted; no field leakage (scalar only).
2. WHEN the context stamp is pinned THEN a DB-free factory test (NEW `backend/graphql/test/context-activity-stamp.test.ts`, modeled on `backend/graphql/test/context-keys.test.ts`) SHALL assert: authenticated construction issues exactly one `updateLastActiveAtIfStale` (spy), anonymous construction issues zero, and a rejected stamp never rejects context creation.
3. WHEN GraphQL tests run THEN the mandated runner SHALL be `bun run test/scripts/run-test.ts <path>` (never raw `bun test`).

#### REQ-073: Cron Route Tier

**Acceptance Criteria:**
1. WHEN the route ships THEN NEW `app/api/cron/sweep-inactive-teachers/test/sweep-inactive-teachers-route.test.ts` SHALL mirror `app/api/cron/sweep-sessions/test/sweep-sessions-route.test.ts`: pure-function tier (no server, no DB), `mock.module` the service, per-test env stubs (`CRON_EXECUTION_MODE` / `CRON_EXTERNAL_ENABLED` / `CRON_SECRET`) restored in `afterEach`, asserting mode-gate bare-404, bad/missing bearer 401, and 200 honest counts `{ offlined }`.

#### REQ-074: Journey Tier (`test/workflows/`)

**Acceptance Criteria:**
1. WHEN the journey ships THEN NEW `test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts` SHALL encode REQ-090..REQ-095 with real services + real DB, committed fixtures in `beforeAll` + tracked hard-delete in `afterAll` (`TrackedFixtures.cleanup()` + `verifyAllAbsent()`), NO `runInRollback` (journey exception, `docs/testing/workflow-journey-tests.md:55-60`), honest authorization, denial legs via try/catch (`:77-84`).
2. WHEN a journey leg needs "the past" THEN it SHALL backdate `users.last_active_at` via a direct update (second-precision, `test/workflows/helpers/second-precision.ts:21`) — NEVER fake timers in journeys (`docs/testing/workflow-journey-tests.md:159-166`).
3. WHEN the journey runs THEN the mandated runner SHALL be `bun run test/scripts/run-test.ts test/workflows` (no raw `bun test`).

#### REQ-075: Frontend Tier

**Acceptance Criteria:**
1. WHEN the hook ships THEN `frontend/hooks/presence/use-teacher-presence-heartbeat.test.ts` SHALL pin: no timer for non-teacher/null role; timer starts for teacher; beats fire on cadence; beats stop when visibility hidden or auth lost; failures logged not thrown — with stubbed timer/`document` globals AND the `useAuth()` seam stubbed via `mock.module` on `@/frontend/hooks/auth` (or a provider-wrapped consumer component — `useAuth` throws outside `AuthProvider`, `frontend/hooks/auth/useAuth.ts:8-10`, and `renderHook` is unavailable under bun:test), plus the `useMutation` seam stubbed the same way.
2. WHEN documents change THEN `documents.contract.test.ts` SHALL stay green (REQ-061.2).
3. WHEN the whole suite runs THEN `bun run test/scripts/run-test.ts` lanes stay green and no pglite-incompatible lane is introduced (heartbeat tests are pure-JS, DB-free).

### 3.8 Band REQ-080..083 — Documentation & Knowledge Gates

#### REQ-080: Outcome Protocol Compliance

**Acceptance Criteria:**
1. WHEN each task completes THEN `outcome/<task-id>-outcome.md` SHALL be written (research, changes, cross-file dependencies, carry-overs) — REQ-002 restated as a gate: no task is `[x]` without its outcome file.

#### REQ-081: Canonical Documentation Update

**Acceptance Criteria:**
1. WHEN implementation completes THEN `docs/teachers/teacher-availability.md` §6.3 (`:313-315`) SHALL be rewritten from "related forward contract" to the SHIPPED sweep description (owners, trigger, threshold env, cadence guidance, boundary semantics), and the stale column citation `users.ts:37` SHALL be corrected to `backend/db/schema/users/users.ts:44` (`:315` today cites the wrong line).
2. WHEN the doc is updated THEN it SHALL document the third writer (inactivity sweep) alongside the two-writer model (`:14-19`) AND amend the single-primitive sentence at `:174` ("there is exactly one repo method that writes the boolean") to name BOTH `TeacherRepository` write primitives (`setOnline` + `sweepInactiveOnlineOnce`) — the rewritten doc must not self-contradict.

#### REQ-082: Deferred-Items Ledger Discipline

**Acceptance Criteria:**
1. WHEN any work is deferred THEN a ledger row SHALL exist in `deferred-items.md` before the deferring task completes; the INV-A4 release seam, INV-A3 directory, non-teacher heartbeat mounts, and sweep-cadence ops wiring SHALL be recorded as resolved-pointers (owning ticket/doc named).
2. WHEN the final gate runs THEN `grep -c "❌\|⚠️" deferred-items.md` SHALL return 0.

#### REQ-083: Knowledge Propagation

**Acceptance Criteria:**
1. WHEN all tasks complete THEN the learnings SHALL be consolidated per the skill's protocol (canonical doc update per REQ-081 + this plan's Phase 7 task) and NO AGENTS.md / `.agents/instructions/` file SHALL be modified by plan work (hand-curated only).

### 3.9 Band REQ-090..095 — Cross-Actor Workflow Scenarios (Journeys)

These six journeys map 1:1 onto `test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts` (REQ-074). Observer-perspective EARS throughout.

#### REQ-090: J-IO-1 — Idle Teacher Is Swept Offline; Admin Observes the Decay

**User Story:** As a student-to-be (future directory consumer) and as an admin watching presence stats, I want idle teachers to leave the online pool, so that availability truthfully reflects presence.

**Acceptance Criteria:**
1. WHEN a certified teacher is toggled Available and then goes silent past the threshold (fixture: backdated `last_active_at`, second-precision) AND the sweep runs THEN the system SHALL set `teacher.is_online = false` AND `users.last_active_at` SHALL remain the historical stamp (the sweep never stamps activity).
2. WHEN the sweep flips the teacher THEN an admin observing `getTeacherPresenceStats` (`platform-analytics.repository.ts:320`) SHALL see `onlineNowCount` decrease by exactly the flipped teachers (cross-actor visibility leg).
3. WHEN the same teacher is 14 minutes stale AND the sweep runs THEN the system SHALL leave `is_online = true` (REQ-050.2).

#### REQ-091: J-IO-2 — Active Teacher Is Never Swept

**Acceptance Criteria:**
1. WHEN a teacher's activity is kept fresh (heartbeat-mutation stamps or fixture-fresh `last_active_at`) AND the sweep runs repeatedly THEN `is_online` SHALL stay `true` on every pass.
2. WHEN the teacher toggles Available (explicit-intent stamp, REQ-012) at the same moment a sweep is evaluating him THEN the serialization SHALL resolve honestly per REQ-042.1/REQ-042.2 — never a false offline.

#### REQ-092: J-IO-3 — In-Session Teacher Is Exempt (Lock Priority)

**Acceptance Criteria:**
1. WHEN a teacher is inside a `started` session (via real `SessionLifecycleService.startSession` — `session-lifecycle.service.ts:249`, which itself locks `is_online = false` at `:283`) AND his `last_active_at` is backdated past the threshold AND the sweep runs THEN the sweep SHALL change nothing: `is_online` stays `false` (already locked), session state is untouched, and the teacher is NOT treated as an "offlined" count (honest zero for him).
2. WHEN the session concludes AND `releaseTeacherInSessionLock` restores him THEN the observable end state SHALL be whatever the release + subsequent sweep produce per D10 — the journey pins only that the in-session pass changed nothing.

#### REQ-093: J-IO-4 — Auto-Offlined Teacher Resumes and Re-Toggles

**Acceptance Criteria:**
1. WHEN a teacher was swept offline THEN his next authenticated activity (mutation stamp or fixture update) SHALL bump `users.last_active_at` (ticket AC-2, `docs/planning/TICKETS.md:1316-1320`).
2. WHEN he calls `TeacherAvailabilityService.setAvailability(teacherId, true, locale)` after resuming THEN the toggle SHALL succeed (gates: certified + not in-session) and `is_online` SHALL be `true` with a fresh in-tx activity stamp — "teacher.is_online can be toggled back to true by the teacher" (`:1318-1320`).
3. IF an UNCERTIFIED teacher attempts the same re-toggle THEN the system SHALL deny with `FORBIDDEN` (`teacher-availability.service.ts:209-217`) — the sweep never weakens INV-A1.

#### REQ-094: J-IO-5 — Replay Idempotency

**Acceptance Criteria:**
1. WHEN the sweep runs twice in a row over the same population THEN the second run SHALL report `{ offlined: 0 }` and mutate nothing (REQ-043.1) — the ops overlap contract.

#### REQ-095: J-IO-6 — Denial & Boundary Composite

**Acceptance Criteria:**
1. IF an unauthenticated client calls `recordMyActivity` through the real GraphQL server THEN the system SHALL deny 401 before any repo call (REQ-014.3).
2. WHEN a teacher is evaluated WHILE his `last_active_at` sits exactly at the cutoff THEN he SHALL NOT be swept (strict `<`, REQ-050.1) — boundary leg runs at the journey tier via backdating, not clock faking.
3. WHEN the journey completes THEN every fixture row SHALL be hard-deleted and `verifyAllAbsent()` SHALL pass (zero residue).

---

## 4. UX/Navigation Requirements (MANDATORY — explicit no-UI ruling)

**This feature introduces ZERO user-visible UI.** No new routes, no sidebar entries, no pages, no dialogs. The heartbeat is a silent background hook; the sweep is server-side. The teacher's only visible surface remains the SHIPPED `TeacherAvailabilityCard` (`frontend/views/teachers/dashboard/TeacherAvailabilityCard.tsx:62`, mounted in the teacher slot `frontend/views/dashboard/home/RoleDashboardPage.tsx:88-90`), which reads `myTeacherAvailability` — an auto-offlined teacher simply sees his card showing Unavailable, truthfully.

### 4.1 New Routes & Role-Based Access

| Route | Purpose | Permission | Roles with Access |
|---|---|---|---|
| `/api/cron/sweep-inactive-teachers` (GET) | Externally-triggered inactivity sweep | `CRON_SECRET` bearer + mode gates (NOT a user route) | None (ops scheduler only) |
| *(no page routes added)* | — | — | — |

### 4.2 Sidebar Navigation Placement

No navigation changes. The feature mounts no items in any group; mobile navigation is untouched.

### 4.3 Role-Based Access Matrix (mutation + mount)

| Role | `recordMyActivity` mutation | Heartbeat mounted | Sees availability state via |
|---|---|---|---|
| Teacher (`UserRole.Teacher`) | ✅ | ✅ (only role) | `TeacherAvailabilityCard` (existing) |
| Student (`UserRole.Student`) | ✅ | ❌ | — (no availability surface) |
| Parent (`UserRole.Parent`) | ✅ | ❌ | — |
| Admin (`UserRole.Admin`) | ✅ | ❌ | Admin analytics presence stats (existing, `platform-analytics.repository.ts:320`) |
| Unauthenticated | ❌ 401 | ❌ | — |

### 4.4 Per-Audience Rendering

| Audience | Differences introduced by this ticket |
|---|---|
| Student | None (no UI; no directory exists yet) |
| Parent | None |
| Teacher | None visible; background heartbeat only; card reflects swept state on next fetch |
| Supervisor/Admin | None in-app; presence stats become accurate (existing surfaces) |

### 4.5 Permission Mapping

| Surface | Required permission | Source |
|---|---|---|
| `recordMyActivity` | `authenticated: true` (no permission string, no role gate) | Pothos `authScopes` |
| `/api/cron/sweep-inactive-teachers` | Bearer `CRON_SECRET` (timing-safe) + `CRON_EXECUTION_MODE=external` + `CRON_EXTERNAL_ENABLED=true` | `createCronSweepEndpoint` gates |
| Heartbeat hook | Client-side role check `user?.role === UserRole.Teacher` | `useAuth()` (`frontend/hooks/auth/useAuth.ts:6`) |

---

## 5. Cross-Actor Workflow Scenarios (Journey Design Inputs)

The actor table and ordered steps below are the requirements-side capture; the state machine, side-effect matrix, and visibility tables live in `plan.md` §6 and become the journey's assertion set (REQ-090..095).

### 5.1 Actor Table

| Actor | Role | Can Do | Cannot Do |
|---|---|---|---|
| Teacher | `UserRole.Teacher` | toggle Available/Unavailable (existing), heartbeats while open+visible, observe own card state | escape the sweep while silent; re-online while in-session (INV-A2); re-online while uncertified (INV-A1) |
| Admin | `UserRole.Admin` | observe presence stats decay after sweeps | trigger the sweep via GraphQL; see per-teacher sweep identities (counts only) |
| Student | `UserRole.Student` | (fixture-only: participates in session rows for the in-session leg) | browse teachers (no directory exists — INV-A3 sibling scope) |
| System (sweep) | cron bearer | flip `is_online → false` for stale, online, not-in-session teachers | stamp activity; touch sessions; resurrect anyone |
| Session lifecycle | system | lock `is_online = false` at start; release at conclusion | be bypassed by the sweep (lock priority) |

### 5.2 Ordered Step Lists (per journey)

**J-IO-1 (idle sweep):** 1. Teacher → toggles Available (fresh in-tx stamp) → `is_online = true`. 2. Fixture → backdate `users.last_active_at` past threshold. 3. System → sweep → `is_online = false`, count 1. 4. Admin → reads presence stats → `onlineNowCount` decremented. 5. System → sweep replay → count 0.

**J-IO-3 (in-session exemption):** 1. Teacher → toggles Available. 2. Student fixture + Teacher → `startSession` → `is_online = false` (INV-S6). 3. Fixture → backdate teacher activity past threshold. 4. System → sweep → no change (NOT EXISTS + is_online guards), count excludes him. 5. Negative probe → concurrent `setAvailability(true)` still denied `TEACHER_IN_ACTIVE_SESSION` (INV-A2 intact).

**J-IO-4 (resume):** 1. Teacher → swept offline (as J-IO-1). 2. Teacher → `recordMyActivity` → `last_active_at` fresh. 3. Teacher → `setAvailability(true)` → `is_online = true` + fresh stamp. 4. Denial leg → uncertified teacher attempting step 3 → `FORBIDDEN`.

### 5.3 Cross-Actor EARS (observer-perspective)

- WHEN the system sweeps an idle teacher THEN an admin observing presence stats SHALL see the online count decay AND the teacher SHALL observe his card reporting Unavailable on next fetch.
- WHEN a teacher is in a started session THEN the system sweep SHALL observe the lock and change nothing, AND the teacher's concurrent toggle-to-Available SHALL be denied by the existing gate.
- IF an unauthenticated client attempts the heartbeat mutation THEN the system SHALL deny it AND no activity SHALL be recorded.
- WHEN a teacher resumes activity and toggles Available THEN the system SHALL restore `is_online = true` only if certified and not in-session (gates unchanged).

---

## 6. Non-Functional Requirements

### 6.1 Performance

1. WHEN an authenticated GraphQL request arrives THEN at most one throttled `UPDATE users` per user per coalesce window (60s) SHALL execute (predicate-in-WHERE; a no-op UPDATE on a PK is O(1)) — p99 request latency impact SHALL be ~0 (fire-and-forget, never awaited on the response path).
2. WHEN the sweep runs THEN it SHALL be ONE batch statement over the online-teacher set (table bounded by teacher population; `session_teacher_id_idx` exists at `backend/db/schema/classes/session.ts:88` for the NOT EXISTS probe) — no per-teacher query loops.

### 6.2 Reliability

1. WHEN the external scheduler is down THEN the system SHALL degrade gracefully: teachers simply stay online longer (staleness bounded by scheduler availability, not by this code); the kill switch (`CRON_EXTERNAL_ENABLED=false`) hides the route.
2. WHEN any stamp or sweep fails THEN the failure SHALL be contained per REQ-053 (request success preserved / sweep rolls back atomically).

### 6.3 Security

1. Per REQ-030..034: no client-supplied identity reaches a write; the sweep is secret-gated; the sidecar boundary is preserved; mass-assignment surfaces do not exist (argless mutation).

### 6.4 Observability

1. WHEN the sweep completes THEN the cron envelope payload SHALL carry honest counts (REQ-043.2) and service logs SHALL use `logger.logDomainError`/`logger.info` from `@/backend/lib/logger` for denials and outcomes — never `console.*`.

---

## 7. Constraints & Assumptions

### 7.1 Technical Constraints

- **Runtime:** Bun (`~/.bun/bin/bun`); tests via `bun run test/scripts/run-test.ts <path>`; never raw `bun test` on workflows.
- **No scheduler in-repo:** the sweep is externally triggered; cadence wiring is ops-owned (`docs/billing/subscription-validity-window-expiry.md:226-244`). The plan documents the recommended ≤5-min cadence but cannot enforce it in-tree.
- **Push-only WS protocol** (`backend/ws/notification-ws-server-handlers.ts:74-77`) and the sidecar presence ban (`docs/notifications/realtime-engine.md:197`) are immovable constraints — hence the API-heartbeat design (D3).
- **Single-writer discipline:** `teacher.is_online` writes only via `TeacherRepository` (`docs/teachers/teacher-availability.md:174`); `users.last_active_at` writes only via `UserRepository` after this ticket.
- **Layer separation:** repos carry no business logic; services own composition; GraphQL resolvers delegate (`backend/db/repo/AGENTS.md` Rules; root `AGENTS.md` Data Flow).

### 7.2 Business Constraints

- Threshold default 15 minutes is the B.15 decision (`docs/specs/open-decisions-and-gaps.md:159-163`); configurability must not change the default.
- The Dev 2 guarantee window ("accurate within 15 minutes of last activity") bounds observed flip time to threshold + one sweep cadence.
- Restore is manual-toggle-only (`docs/workflows/02-on-demand-matching-workflow.md:25` — "reopens app **and toggles Available**"); no auto-resurrection on activity.

### 7.3 Assumptions

- Teachers keep `last_active_at` fresh via normal dashboard traffic (Apollo queries) plus the heartbeat; a teacher actively teaching has a `started` session and is exempt regardless of stamps.
- The teacher table population is small enough that no index on `teacher.is_online` is required for the batch sweep (the column exists unindexed today, `backend/db/schema/teachers/teacher.ts:28`; check constraint only, `:37`).
- Production DB timestamps use second precision for fixture comparisons (`test/workflows/helpers/second-precision.ts:21`).
- `.env.example:155` (`CRON_EXECUTION_MODE=vercel-daily`) is pre-seed residue; the shipped gate accepts only `"external"` — out of scope to fix here (ledger pointer).

---

## 8. Success Criteria

### 8.1 Definition of Done (ticket ACs → REQs)

| Ticket AC / scenario (`docs/planning/TICKETS.md:1311-1332`) | Covered by |
|---|---|
| 15 min pass w/o heartbeat or API call → `is_online = false` | REQ-017, REQ-018, REQ-050 |
| `users.last_active_at` updated on each activity | REQ-010..REQ-013, REQ-014 |
| Auto-offlined teacher resumes → stamp + can toggle back | REQ-012, REQ-014, REQ-093 (J-IO-4) |
| In-session teacher NOT auto-offlined (lock priority) | REQ-018.1c, REQ-051, REQ-092 (J-IO-3) |
| Active teacher — `last_active_at` updated | REQ-011, REQ-091 (J-IO-2) |
| 14-min idle — stays online | REQ-050.2, REQ-071.2 |
| PRODUCTION_READINESS 3.1.1-3.1.4 (`:131-140`) + 8.25 (`:332`) | REQ-011 (3.1.1 via heartbeat-as-API), REQ-017 (3.1.2), REQ-051 (3.1.3), REQ-093 (3.1.4), traceability in outcome docs |

### 8.2 Acceptance Metrics

- [ ] All new/extended repo methods: 100% branch coverage (`runInRollback` + tx propagation).
- [ ] Journey file green: `bun run test/scripts/run-test.ts test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts`.
- [ ] Route test green: mode-gate 404 / bearer 401 / 200 honest counts matrix.
- [ ] `bun quality-gate` green; `deferred-items.md` zero ❌/⚠️.
- [ ] `grep` proofs: zero `is_online`/`last_active_at` writes outside the two repos; zero diffs under `backend/ws/`.

---

## 9. Requirements Traceability Matrix (REQ band → plan/tasks)

| Band | Subject | plan.md § | tasks.md phase |
|---|---|---|---|
| REQ-001..004 | Baseline, protocol, guards | §2 D1/D10, §8 | Task 0, 1.5 |
| REQ-010..013 | Activity writers | §4, §5 | Phase 1-2 |
| REQ-014..015 | Heartbeat (mutation + hook) | §5, §7 | Phase 3-4 |
| REQ-016 | Threshold env | §3 | Phase 1 |
| REQ-017..018 | Sweep service + repo primitive | §4, §6 | Phase 1-2 |
| REQ-030..034 | Security/tenancy/boundary | §9 | every SEC subtask |
| REQ-040..043 | Atomicity/concurrency | §6 | Phase 1-2 |
| REQ-050..053 | Boundary/failure semantics | §6.4 | Phase 2, 5 |
| REQ-060..063 | SDL/documents/route contracts | §5, §7 | Phase 3 |
| REQ-070..075 | Test gates | §10 | every TE subtask |
| REQ-080..083 | Docs/knowledge gates | §12 | Phase 6-7 |
| REQ-090..095 | Journeys | §6.5 | Phase 2 (authored), Phase 5 (expanded) |

---

## 10. Glossary

| Term | Definition |
|---|---|
| Activity stamp | A monotonic write of `users.last_active_at` through `UserRepository` |
| Coalesce window | `USER_ACTIVITY_COALESCE_WINDOW_MS` (60s) — the per-request stamp only writes when the stored value is older |
| Sweep | `TeacherInactivityService.sweepInactiveTeachers` — the cron-triggered batch flip of stale online teachers to offline |
| Cutoff | `sweepNow − threshold`; strict `<` comparison against `users.last_active_at` |
| In-session lock | INV-S6: `is_online = false` while `session.status = started` (`docs/specs/state-machine-invariants.md:47`) |
| Heartbeat | The client's periodic authenticated `recordMyActivity` call while the app is open and visible |
| Resurrection | The INV-A4 hazard: `releaseTeacherInSessionLock` unconditionally restoring `is_online = true` (sibling `:1338` scope; self-healed by next sweep) |

---

## Requirements Review Checklist (self-check)

- [x] All user roles addressed (teacher primary; admin observer; student fixture; unauthenticated denial)
- [x] EARS format throughout; WHEN/IF/WHILE used consistently; SHALL binding
- [x] Normal, edge (14:59/15:00/15:01, NULL activity, replay, race windows), and error (stamp failures, 401, 403, 409) cases covered
- [x] Cross-actor journeys captured (actor table + ordered steps + observer EARS) → map 1:1 to `test/workflows/`
- [x] UX/Navigation specified (explicit no-UI ruling + role matrix + permission mapping)
- [x] Zero-drift schema ruling grounded in verified column lines
- [x] Every ticket AC + PRODUCTION_READINESS row traced to a REQ
- [x] No conflicting requirements; restore-vs-sweep interplay resolved by D10 ruling
