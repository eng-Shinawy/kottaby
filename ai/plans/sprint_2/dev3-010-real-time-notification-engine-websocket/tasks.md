# Trackable Implementation Tasks: DEV3-010 — Real-Time Notification Engine (WebSocket)

> **Plan directory:** `ai/plans/dev3-010-realtime-notification-engine/`
> **Specs:** `specs.md` (REQ-001..REQ-083, Journeys J1–J2) · **Architecture:** `plan.md` (Decisions D1–D12)
> **Gate status:** This tasks.md is executable ONLY after `outcome/plan-review-R1.md` approves `plan.md` (Task 0.3).

---

## Non-Negotiable Execution Protocol (applies to EVERY task)

1. **Pre-Execution Outcome Knowledge Read**: Before touching any file, read the plan directory's existing `outcome/*.md` files and `deferred-items.md`. Never re-derive decisions already recorded.
2. **Post-Edit Verification**: After EVERY file creation/modification, run `bun run scripts/health/sub-loop.ts <file-path> --lifecycle duplicates` — MUST exit 0 before the task's `.QL` checkbox may be marked.
3. **Test Execution**: DB-bound suites run ONLY via `bun run test/scripts/run-test.ts <test-path>` (never raw `bun test` for DB suites). `runInRollback` isolation for repo/service suites; `test/workflows/**` journey suites NEVER use `runInRollback`.
4. **Semantic Review Self-Check**: Every `.SR` subtask self-reviews against: atomicity (single-statement writes), env-config registry parity (every new key registered + invalidated in `reset*` paths), zero dead code, zero cross-layer imports (`shared/` purity), enums as **value imports** with member access (no raw string literals), `const` arrow-function components (frontend), no `console.*`, no `await import()` in resolver trees.
5. **Outcome Documentation**: Every task writes `ai/plans/dev3-010-realtime-notification-engine/outcome/<task-id>-outcome.md` recording: what was built, verification commands + exit codes, coverage evidence, deferred items touched, baseline delta.
6. **Checkbox Tracking**: Mark `[ ]` → `[x]` only when the task AND all its subtasks pass. Never batch-check.

---

## Phase 0: Pre-Implementation Baseline

### 0.1 Baseline Recording & Deferred-Items Ledger

- [ ] 0.1 [Record error baseline and initialize the deferred-items ledger]
  - Run and record verbatim counts: `bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline`, `git diff --name-only`
  - Create `ai/plans/dev3-010-realtime-notification-engine/deferred-items.md` from the template; pre-seed as non-blocking forward items:
    - **D1** — emitter wiring per event type → DEV3-011 / DEV1-016 / DEV1-017 / DEV2-016 / DEV3-012 / DEV3-013 / DEV3-022d
    - **D2** — recipient-locale copy storage → requires future `users.locale` decision (NEVER patched inline)
    - **D3** — production WS host provisioning → deployment workstream
    - **D4** — multi-channel / unified-preferences integration → notification-preferences ticket
  - Write `outcome/phase0-baseline-outcome.md` with all counts + ledger initialization confirmation
  - _Requirements: REQ-001_
  - [ ] 0.1.SR **Semantic Review**: baseline artifact paths correct; D1–D4 each carry an owning ticket and non-blocking status

### 0.2 Prerequisite & Dependency Verification (Dependency Guard)

- [ ] 0.2 [Verify pre-existing foundations — READ-ONLY audit]
  - Verify `backend/db/schema/notifications/notifications.ts` holds exactly the A.4 columns (`id`, `user_id`, `type`, `title`, `body`, `is_read`, `related_entity_type`, `related_entity_id`, `created_at`) + `notifications_user_id_idx` + `notifications_user_id_is_read_idx`
  - Verify `notificationType` pgEnum in `backend/db/schema/enums.ts` and TS mirror `NotificationType` in `backend/enum/notifications/notification-type.enum.ts` both carry exactly the 7 sanctioned values
  - Verify the existing `backend/db/repo/notifications/` repository surface and catalogue its methods for additive extension (never re-implementation)
  - Verify DEV2-001 `verifyAccessToken`, DEV2-002 `authenticated` authScope, DEV2-003 `SessionEventNotificationContract`/`SessionEventNotificationType` in `@/backend/types/contracts`, DEV3-002 masking boundary, DEV3-003 gateway posture
  - IF any artifact is missing → record ❌ in `deferred-items.md` and block dependent tasks; NEVER patch DEV1-001-owned structures inline
  - Write audit results to `outcome/0.2-outcome.md`
  - _Requirements: REQ-004, REQ-002_
  - [ ] 0.2.IV **Instruction Verification**: validate findings against `docs/specs/open-decisions-and-gaps.md` (A.4), `docs/specs/state-machine-invariants.md` (INV-P2/P3), `docs/DATABASE_MIGRATIONS.md`

### 0.3 Plan-Review Gate

- [ ] 0.3 [Plan-review gate — REQUIRED before any Phase 1+ work]
  - Produce `outcome/plan-review-R1.md` confirming plan.md ↔ specs.md consistency (REQ coverage, D1–D12 decisions, no scope creep)
  - Implementation tasks below MUST NOT begin until this gate passes
  - _Requirements: REQ-083_

---

## Phase 1: Types, Enums & i18n (Schema Zero-Drift Phase)

> **INVARIANT**: `git diff` on `backend/db/schema/**` and `backend/db/migration/**` MUST remain empty through this entire ticket (REQ-048). No `db push`. No new enums (the 7 `NotificationType` values already exist).

### 1.1 Canonical Types Extension

- [ ] 1.1 [Extend `backend/types/notifications/notification.types.ts` — additive only]
  - Add: `NotificationReturnType` (= `NotificationSelectType` alias — GraphQL binding anchor), `NotificationEmitInput`, `NotificationEmitBatchInput`, `NotificationDeliveryReceipt`, `NotificationListFilterInput`, `NotificationListPageReturnType`, `RealtimeNotificationPayload` (exact shapes per plan §2.2)
  - `NotificationType` used at runtime = **value import** from `@/backend/enum/notifications/notification-type.enum`; `DBTransaction` from `@/backend/types`; no barrel change needed (`backend/types/notifications/index.ts` already re-exports)
  - NO service-layer `.types.ts`; NO local Pothos types
  - Applicable instructions: `backend/types/AGENTS.md` (or nearest), `shared/AGENTS.md` import-purity rules
  - _Requirements: REQ-003_
  - [ ] 1.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/types/notifications/notification.types.ts --lifecycle duplicates` (exit 0)
  - [ ] 1.1.TE **Test Engineering**: type-level compile proof via `bun tsgo`; field-shape unit assertions where runtime-relevant (receipt readonly arrays)
  - [ ] 1.1.SEC **Security & Tenancy Audit**: confirm `NotificationEmitInput`/`Batch` are structurally incapable of becoming GraphQL inputs (server-internal containment); `RealtimeNotificationPayload` field allowlist excludes PII (`user_id`, email, phone) by construction
  - [ ] 1.1.SR **Semantic Review**: no `import type`-only usage of `NotificationType` where runtime validation consumes it; zero dead exports
  - [ ] 1.1.IV **Instruction Verification**: validate against `backend/AGENTS.md` canonical-types rules
  - Outcome: `outcome/1.1-outcome.md`

### 1.2 Enum Guard + Byte-Parity Static Test

- [ ] 1.2 [Add `isNotificationType` guard + enum byte-parity static test]
  - In `backend/enum/notifications/notification-type.enum.ts` (same file, following the `isApplicantStatus` precedent): `isNotificationType(value: unknown): value is NotificationType` via `Object.values(NotificationType).includes(...)`
  - Create static-parity test `backend/enum/notifications/notification-type.enum.test.ts` (or per existing enum-test placement): assert pgEnum `notificationType.enumValues` ↔ TS mirror byte-identical (7 values, order-sensitive per `backend/db/schema/enums.ts`)
  - _Requirements: REQ-014, REQ-004_
  - [ ] 1.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/enum/notifications/notification-type.enum.ts --lifecycle duplicates` (exit 0)
  - [ ] 1.2.TE **Test Engineering**: Tier 1 — positive for all 7 members; Tier 2 — null/undefined/number/object/casing-variant rejections; run via `bun run test/scripts/run-test.ts <test-path>`
  - [ ] 1.2.SEC **Security & Tenancy Audit**: guard fails CLOSED (unknown → reject, never `as NotificationType` narrowing)
  - [ ] 1.2.SR **Semantic Review**: value import used; no string-literal type lists duplicated elsewhere
  - [ ] 1.2.IV **Instruction Verification**: validate against `backend/enum/**/AGENTS.md` conventions
  - Outcome: `outcome/1.2-outcome.md`

### 1.3 `errors` Namespace Extension

- [ ] 1.3 [Add `notificationNotFound` to the errors namespace (en + ar + types)]
  - `shared/locale/types/errors/index.ts`: add `notifications: { notificationNotFound: string }` grouping to the errors MessageSchema interface
  - `shared/locale/en/errors/index.ts`: `"The notification was not found."`
  - `shared/locale/ar/errors/index.ts`: `"لم يتم العثور على الإشعار."`
  - MessageSchema parity = compile gate (`bun tsgo` must pass); NO near-duplicate keys (reuse existing generic validation keys for filter/pagination failures)
  - _Requirements: REQ-051_
  - [ ] 1.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <each-touched-file> --lifecycle duplicates` (exit 0 each)
  - [ ] 1.3.SR **Semantic Review**: property-access consumers only; full MessageSchema parity across locales; zero hardcoded strings elsewhere compensating for a missing key
  - [ ] 1.3.IV **Instruction Verification**: validate against `shared/locale/AGENTS.md` errors-namespace policy
  - Outcome: `outcome/1.3-outcome.md`

### 1.4 New `notifications` UI Namespace (Full 5-Step Registration)

- [ ] 1.4 [Register the `notifications` UI namespace per `shared/locale/AGENTS.md`]
  - Step 1: types interface in `shared/locale/types/notifications/index.ts` — feed title, empty state, error state, filter labels (`all`, `unread`), type labels for all 7 `NotificationType` values, mark-read / mark-all labels + confirm copy, badge aria label, pluralized unread-count **function** (`unreadCount: (count: number) => string`), realtime toast template, quiet reconnect affordance copy
  - Step 2: `shared/locale/en/notifications/index.ts`
  - Step 3: `shared/locale/ar/notifications/index.ts` (full Arabic copy)
  - Step 4: MessageSchema entry + namespace-paths registration + `defineNamespace("notifications", …)` handle
  - Consumers: client `useAppTranslation(Translation.Notifications)`; server shell `await getTranslations(locale)`; property access only
  - _Requirements: REQ-052, REQ-002_
  - [ ] 1.4.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <each-file> --lifecycle duplicates` (exit 0)
  - [ ] 1.4.TE **Test Engineering**: `bun tsgo` parity gate; pluralization function unit assertions (0/1/2/many in both locales)
  - [ ] 1.4.SR **Semantic Review**: zero hardcoded user-facing strings; enum-handle consumption verified; Arabic copy present for every key (no English fallthrough)
  - [ ] 1.4.IV **Instruction Verification**: `shared/locale/AGENTS.md` 5-step procedure followed verbatim
  - Outcome: `outcome/1.4-outcome.md`

### 1.5 Env-Config Registry Additions

- [ ] 1.5 [Register WS/fanout env keys in env-config registry]
  - Register: `WS_PORT`, `WS_HOST`, `WS_ALLOWED_ORIGINS`, `NOTIFICATION_FANOUT_TRANSPORT`, Redis connection knobs (reuse existing registration if present), `WS_MAX_CONNECTIONS`, `WS_MAX_CONNECTIONS_PER_USER`
  - Typed getters with dev/test defaults (localhost origins in dev); every `reset*` cache-invalidation path covers every new key
  - Applicable instructions: env-config conventions per REQ-049 + `backend/lib/` AGENTS files
  - _Requirements: REQ-049_
  - [ ] 1.5.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <each-touched-file> --lifecycle duplicates` (exit 0)
  - [ ] 1.5.TE **Test Engineering**: registry-inclusion test; invalidation-coverage test (assert each key cleared by reset path); typed-default assertions
  - [ ] 1.5.SEC **Security & Tenancy Audit**: no secrets logged; `WS_ALLOWED_ORIGINS` has NO wildcard default; transport default is in-process unless Redis config explicitly present
  - [ ] 1.5.SR **Semantic Review**: every registered key consumed via the registry (zero raw `process.env` reads in new modules)
  - [ ] 1.5.IV **Instruction Verification**: validate against env-resolve conventions documented in `backend/lib/**/AGENTS.md`
  - Outcome: `outcome/1.5-outcome.md`

---

## Phase 2: Repositories & Backend Services

> **TEST-FIRST ORDERING (MANDATORY)**: Tasks 2.1–2.3 (journey layer + J1 + J2) are written BEFORE the service surface (2.4–2.8) they cover. Journey tests WILL fail until 2.4–2.7 land — that is expected and recorded.

### 2.1 Scaffold the `test/workflows/` Journey Layer

- [ ] 2.1 [Scaffold `test/workflows/` harness layer — REQUIRED, layer does not exist]
  - Create `test/workflows/AGENTS.md` codifying: committed fixtures in `beforeAll`, tracked hard-delete in `afterAll`, NO `runInRollback` (services own their transactions), side effects SPIED never sent, permissions resolved HONESTLY via real user fixtures/permission-group membership (never monkey-patched), sequential actor-attributed steps, cross-actor visibility + denial assertions
  - Create `test/workflows/helpers/tracked-fixtures.ts` — `TrackedFixtures` helper: registry of created entity ids + hard-delete teardown with post-teardown existence checks (zero residue)
  - Create `test/workflows/helpers/actor-context.ts` — actor-context factory producing real `actorUserId`-carrying callers from `entity-setup.ts`-built user fixtures (student / certified teacher / parent / admin)
  - Create `test/workflows/helpers/spied-transport.ts` — in-process fan-out transport spy exposing publish call log (`userIds`, payload) for assertions; installed via the engine's injected transport seam
  - Applicable instructions: Architectural Invariant 10 (system prompt), `test/AGENTS.md` conventions, REQ-077
  - _Requirements: REQ-077, REQ-J5_
  - [ ] 2.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <each-file> --lifecycle duplicates` (exit 0)
  - [ ] 2.1.TE **Test Engineering**: harness self-test proving teardown leaves zero residue; verify `bun run test/scripts/run-test.ts` picks up `test/workflows/**`
  - [ ] 2.1.SEC **Security & Tenancy Audit**: actor-context factory resolves permissions only through REAL user fixtures; document that monkey-patching permission resolution is forbidden by `test/workflows/AGENTS.md`
  - [ ] 2.1.SR **Semantic Review**: helpers are reusable (no notification-domain bleed into generic helpers); spied transport implements the same `NotificationFanoutTransport` port
  - [ ] 2.1.IV **Instruction Verification**: validate against Architectural Invariant 10 + REQ-077 wording
  - Outcome: `outcome/2.1-outcome.md`

### 2.2 Journey J1 — TEST-FIRST

- [ ] 2.2 [Write Targeted Single-Recipient Delivery journey test — TEST-FIRST]
  - Create `test/workflows/notifications/j1-targeted-single-recipient.test.ts`
  - Provision the actor cast via `test/workflows/helpers/actor-context.ts` (student + certified teacher + parent-outsider) — real permission-group membership rows — NEVER monkey-patch permission resolution
  - Steps as sequential service calls with `actorUserId` (mirroring plan §4.5 J1 table):
    1. System: commit fixtures → both inboxes empty
    2. Teacher observes: `myNotifications`-equivalent service read → empty page; unread count 0
    3. Emitter: `NotificationEngine.emitForUser(teacher, session_request, entityRef)` → exactly 1 row, `is_read=false`; spied transport observed EXACTLY ONE publish addressed ONLY to teacher
    4. Teacher observes: unread=1; row content/type/entityRef correct
    5. Student (denial observation): inbox stays EMPTY, badge 0
    6. Teacher: mark-read → `is_read=true`, badge 0
    7. Teacher: repeat mark → idempotent success, no drift
    8. Parent-outsider: `markRead(teacherRowId)` → `NOTIFICATION_NOT_FOUND`; teacher row byte-identical after (oracle-safe)
    9. Teacher simulated reconnect → catch-up re-read equals DB listing exactly (no dup/loss)
  - Committed fixtures in `beforeAll` + tracked hard-delete in `afterAll` — NEVER `runInRollback`
  - Spy notification/fan-out dispatch; NEVER hit real Redis/WS channels
  - Verify: `bun run test/scripts/run-test.ts test/workflows/notifications/j1-targeted-single-recipient.test.ts` (RED until 2.4–2.7 land; GREEN after), then `bun test test/workflows`
  - _Requirements: REQ-J1, REQ-J4, REQ-J5, REQ-077_
  - Outcome: `outcome/2.2-outcome.md`

### 2.3 Journey J2 — TEST-FIRST

- [ ] 2.3 [Write Cohort Broadcast Fan-Out + Offline Persistence journey test — TEST-FIRST]
  - Create `test/workflows/notifications/j2-cohort-broadcast-offline-persistence.test.ts`
  - Actor cast via helpers: parents A/B + teacher + anonymous caller
  - Steps as sequential service calls with `actorUserId` (mirroring plan §4.5 J2 table):
    1. System: commit fixtures → empty inboxes
    2. Emitter: `emitForUsers([parentA, parentB], system_broadcast, key=K)` → exactly 2 rows, one batch timestamp; spied publish ONCE carrying BOTH ids
    3. Parent A (online path): payload shape valid; only A's copy addressable
    4. Parent B (offline): NO push observed; row persisted `is_read=false`
    5. Parent B later: list → unread=1 → `markAllRead(system_broadcast)` → affected count = 1; badge 0
    6. Teacher (denial): inbox EMPTY; foreign mark probes → oracle-safe NOT_FOUND
    7. Emitter replays SAME key → ZERO new rows, ZERO new pushes (REQ-J3); different key → fresh rows
    8. Anonymous: every inbox op → `UNAUTHORIZED`, constant response shape
  - Committed fixtures in `beforeAll` + tracked hard-delete in `afterAll` — NEVER `runInRollback`
  - Spy fan-out transport; NEVER hit real channels
  - Verify: `bun run test/scripts/run-test.ts test/workflows/notifications/j2-cohort-broadcast-offline-persistence.test.ts`, then `bun test test/workflows`
  - _Requirements: REQ-J2, REQ-J3, REQ-J4, REQ-J5, REQ-077_
  - Outcome: `outcome/2.3-outcome.md`

### 2.4 Repository — Additive Extension

- [ ] 2.4 [Extend `backend/db/repo/notifications/notification.repository.ts` — additive methods only]
  - Add: `createReturning`, `createManyReturning` (ONE multi-row INSERT … RETURNING), `countUnread`, `countForUser` (shared predicate builder with list), `listForUser` (conjunctive optional filters + `ORDER BY created_at DESC, id DESC`), `markReadOnce` (guarded single `UPDATE … WHERE id AND user_id RETURNING` → null on zero rows), `markAllReadForUser` (single set-based UPDATE with `is_read = false` + optional type)
  - Every method: `tx?: DBTransaction` LAST parameter; `queryDb(tx)` pattern for non-transactional reads; NO business logic, NO translations; reuse-any-existing-method audit from Task 0.2 honored
  - NO `inArray`; NO prepared statements (writes); NO `--` inside `sql` templates
  - Applicable instructions: `backend/db/repo/AGENTS.md`, `docs/drizzle/prepared-statements.md`
  - _Requirements: REQ-017, REQ-018, REQ-019, REQ-020, REQ-026, REQ-040, REQ-041_
  - [ ] 2.4.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/repo/notifications/notification.repository.ts --lifecycle duplicates` (exit 0)
  - [ ] 2.4.TE **Test Engineering** (`backend/db/test/logic/notifications/notification.repository.test.ts` or per existing placement): Tier 1 — every method happy path + branch coverage; Tier 2 — limit boundaries (1/50), offset 0, filter-empty; Tier 3 — concurrent mark storms via `Promise.allSettled`; Tier 4 — foreign-id mark → null (no leak). ALL inside `runInRollback`, `tx` passed to EVERY call, fixtures via `entity-setup.ts`, failures via `expectRepoError` translated-substring helper, run via `bun run test/scripts/run-test.ts <path>`
  - [ ] 2.4.SEC **Security & Tenancy Audit**: every read/write scoped by explicit `userId` parameter; guarded UPDATE proves BOLA containment; zero `{ ...input }` spread into Drizzle (grep-verified); no LIKE/ILIKE surface (wildcards N/A — documented)
  - [ ] 2.4.SR **Semantic Review**: single-statement discipline (no read-then-write); predicate builder shared between list + count (REQ-026 coherence); zero dead code; no cross-layer imports
  - [ ] 2.4.IV **Instruction Verification**: validate against `backend/db/repo/AGENTS.md`, Architectural Invariant 3 (tx propagation)
  - Outcome: `outcome/2.4-outcome.md`

### 2.5 Fan-Out Transport Port + Adapters

- [ ] 2.5 [Implement `NotificationFanoutTransport` port + `InProcessTransport` + `RedisPubSubTransport`]
  - Create `backend/services/notifications/realtime/fanout-transport.ts`: port interface `publishFanout(userIds: readonly number[], payload: RealtimeNotificationPayload): Promise<void>`
  - `in-process-transport.ts`: direct in-memory tap with subscription registration (only transport legal in tests/harnesses)
  - `redis-pubsub-transport.ts`: channel `kottaby:notifications:fanout`, JSON envelope `{ userIds, payload }`; publish + symmetric `subscribeFanout` side with runtime shape guard (malformed → drop + structured warn, NEVER crash)
  - Transport selection factory reading `NOTIFICATION_FANOUT_TRANSPORT` env key (registered in 1.5); Redis outage → callers degrade per REQ-011 (transport throws; engine swallows-with-log)
  - NO module-level mutable state in adapters beyond injected client handles (bounded ban honored)
  - Applicable instructions: `backend/services/AGENTS.md` mock-adapter discipline, REQ-024/045
  - _Requirements: REQ-024, REQ-045, REQ-011_
  - [ ] 2.5.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <each-file> --lifecycle duplicates` (exit 0)
  - [ ] 2.5.TE **Test Engineering**: Tier 1 — both adapters publish/subscribe round-trip; Tier 2 — empty userIds; Tier 3 — Redis reconnect behavior (subscriber resumes post-outage); Tier 4 — malformed envelope dropped without exception escaping. In-process adapter in unit tier; Redis adapter behind env-gated suite per existing Redis-dependent test conventions
  - [ ] 2.5.SEC **Security & Tenancy Audit**: envelope carries only allowlisted payload fields; channel name constant; no user PII on the bus
  - [ ] 2.5.SR **Semantic Review**: selection factory reads ONLY registered env keys; zero `console.*`; enums/value imports clean
  - [ ] 2.5.IV **Instruction Verification**: validate against `backend/services/AGENTS.md` + REQ-049
  - Outcome: `outcome/2.5-outcome.md`

### 2.6 Engine Service — Emit Paths

- [ ] 2.6 [Implement `NotificationEngine` emit surface — `backend/services/notifications/notification-engine.service.ts` (part 1)]
  - `emitForUser(input, locale, tx?)` + `emitForUsers(input, locale, tx?)` + `publishReceipts(receipts, locale)`
  - Validation guard module (`emit-validation.ts` or per service conventions): title non-empty ≤255, entityRef co-presence, positive-safe-int ids, `isNotificationType` enum guard, optional idempotencyKey ≤128 — ALL failures throw `ValidationError` BEFORE any DB access
  - Idempotency claim helper: cache SET-NX-EX on `notif:emit:<sha256(userId:type:key)>` 24h TTL; duplicate → return prior receipt (NO insert, NO publish); cache outage → FAIL OPEN + one structured warn (documented deviation D5); cache adapter INJECTED (no module state)
  - Transaction composition: own-commit path = insert → commit → single `publishFanout` (batch = ONE publish with full recipient list); caller-tx path = insert in caller tx → return `NotificationDeliveryReceipt` WITHOUT publishing; `publishReceipts` = post-commit publisher; publish failure post-commit → `logger.logDomainError({ code: "NOTIFICATION_DELIVERY_DEGRADED", entity: "notifications" })` and RESOLVE
  - One `now` per batch (REQ-047); batch insert in ONE statement via repo (REQ-013); `withTransaction(outerTx)` SAVEPOINT-aware composition
  - i18n via `getServerTranslations(locale, "errors")` — property access; zero translation/templating of `title`/`body` (verbatim storage, REQ-015/028)
  - Applicable instructions: `backend/services/AGENTS.md`, `docs/IDEMPOTENCY.md` (deviation ruling), DEV1-002 tx-composition precedent
  - _Requirements: REQ-010, REQ-011, REQ-012, REQ-013, REQ-015, REQ-016, REQ-040, REQ-042, REQ-043, REQ-047_
  - [ ] 2.6.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <each-file> --lifecycle duplicates` (exit 0)
  - [ ] 2.6.TE **Test Engineering** (`backend/services/notifications/notification-engine.emit.test.ts` + DB-bound tier): Tier 1 — emit single/batch happy paths, validation branch matrix, duplicate-key suppression; Tier 2 — boundary titles (0/1/255/256 chars), entityRef half-pairs; Tier 3 — **forced-OUTER-tx rollback → ZERO rows AND ZERO publishes** (spied transport), cache outage fail-open persists + warns, publish-failure post-commit swallowed-with-log; Tier 4 — hostile id/type/key fuzz. Service tier with mocked transport+cache; DB tier in `runInRollback` via `bun run test/scripts/run-test.ts`
  - [ ] 2.6.SEC **Security & Tenancy Audit**: emit NEVER exposed via GraphQL (imports only by services/tests — grep evidence recorded); BOPLA: field-by-field mapping into `NotificationInsertType`, no spreads; idempotency key hashed (no raw key storage); BFLA containment of `emitForUsers` (REQ-027)
  - [ ] 2.6.SR **Semantic Review**: publish-after-commit ordering provable from code structure (no publish reachable before commit); zero swallowed errors outside the documented degradation path; enums as value imports; `tx` threaded everywhere
  - [ ] 2.6.IV **Instruction Verification**: validate against `backend/services/AGENTS.md`, `docs/IDEMPOTENCY.md`, Architectural Invariants 2/3/7
  - Outcome: `outcome/2.6-outcome.md`

### 2.7 Engine Service — Inbox Surface

- [ ] 2.7 [Implement `NotificationEngine` inbox surface (part 2 of the same service file)]
  - `listMyNotifications(userId, filter, locale)`: validate limit ∈ [1,50] (default 20), offset ≥ 0 safe-int, type via enum guard → repo `listForUser` + `countForUser` (shared predicate) → `{ items, totalCount, hasMore }` (hasMore = offset + items.length < totalCount)
  - `getMyUnreadCount(userId, locale)` → repo `countUnread` (composite-index read)
  - `markRead(callerUserId, notificationId, locale)`: id via positive-safe-int guard → repo `markReadOnce` → null → `NotFoundError("NOTIFICATION", t.notifications.notificationNotFound)` (entity name only — double-suffix rule); already-read returns row idempotently
  - `markAllRead(callerUserId, type, locale)` → repo `markAllReadForUser` → affected count (0 on empty set)
  - Identity = `callerUserId` parameter ONLY (resolvers pass `ctx.user.id`); no identity accepted from any input object
  - _Requirements: REQ-017, REQ-018, REQ-019, REQ-020, REQ-026, REQ-029, REQ-030, REQ-035, REQ-050_
  - [ ] 2.7.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/services/notifications/notification-engine.service.ts --lifecycle duplicates` (exit 0)
  - [ ] 2.7.TE **Test Engineering** (`notification-engine.inbox.test.ts`): Tier 1 — list filters × pagination coherence (`totalCount` agreement per REQ-026), mark-one/mark-all happy paths; Tier 2 — pagination bounds, default limit, empty inbox; Tier 3 — idempotent double mark, mark-all during interleaved emit (new row stays unread — user-favorable), 25-way `Promise.allSettled` mark storms all-fulfilled consistent; Tier 4 — foreign id → `NOTIFICATION_NOT_FOUND` indistinguishable from nonexistent. DB tier `runInRollback` via runner; failure assertions via `expectRepoError` on translated substrings
  - [ ] 2.7.SEC **Security & Tenancy Audit**: BOLA self-scope by construction (no userId input anywhere on inbox ops); BOPLA whitelist mapping only; oracle-safe denial shape constancy; zero disclosure of foreign-row existence
  - [ ] 2.7.SR **Semantic Review**: `NotFoundError("NOTIFICATION", …)` entity-name discipline; `logger.logDomainError` with `{ code, entity: "notifications", entityId? }`; no read-then-write; enum guard defense-in-depth
  - [ ] 2.7.IV **Instruction Verification**: validate against `docs/graphql/domain-error-extensions-code.md`, `backend/services/AGENTS.md`
  - Outcome: `outcome/2.7-outcome.md`
  - **Post-2.7 check**: J1/J2 journeys (2.2/2.3) now run GREEN: `bun run test/scripts/run-test.ts` both files + `bun test test/workflows`

### 2.8 WS Sidecar Server

- [ ] 2.8 [Implement Bun-native WS sidecar — `backend/ws/notification-ws-server.ts` + entry `scripts/start-notification-ws.ts` + `bun run ws` package script]
  - Handshake pipeline (FIXED order): Origin allowlist (`WS_ALLOWED_ORIGINS`) → per-IP token bucket (exceed → close `4429`) → cookie header `access_token` read → `verifyAccessToken` (null → close `4401`) → userId from `sub` claim (positive-int coerce) → register
  - Connection registry (sanctioned bounded exception): `Map<connId, ConnState>`; global cap → reject `1013`; per-user cap → evict OLDEST with `4009`; 30s ping cadence, 2 missed pongs → terminate; graceful shutdown closes `1001`
  - Subscriber wiring: transport-selected subscription (Redis subscribe / in-process tap) → runtime shape guard → fan-out to recipient socket sets; outbound frame = `RealtimeNotificationPayload` JSON only
  - Client frames: pong/close accepted; all other inbound ignored (repeated abuse MAY policy-close); frame size caps asserted
  - Logging: connection lifecycle logs carry connId + userId ONLY (no tokens/IPs/payloads); `logger` from `@/backend/lib/logger` exclusively
  - Query-string tokens REFUSED by construction (never read); no other-header identity
  - _Requirements: REQ-021, REQ-022, REQ-023, REQ-033, REQ-034, REQ-037, REQ-045, REQ-046_
  - [ ] 2.8.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <each-file> --lifecycle duplicates` (exit 0)
  - [ ] 2.8.TE **Test Engineering** (dedicated WS suite, ephemeral-port harness + native `WebSocket` clients — NO Playwright at this tier): Tier 1 — valid cookie handshake → connected → push received; two-user routing isolation (one pushed, other provably silent); Tier 2 — malformed bus payload dropped, socket loop intact; graceful shutdown `1001` observed; Tier 3 — missed-pong ×2 termination; reconnect flicker ×N ends with exactly-one live connection; Tier 4 — missing/tampered/expired token → `4401`; bad Origin → reject; query-token attempt → reject; bucket exhaustion → `4429`; cap overflow → oldest evicted `4009`; registry bounds asserted
  - [ ] 2.8.SEC **Security & Tenancy Audit**: CSWSH defense (Origin FIRST), no identity from URL/headers-payload, fail-closed auth, throttle fail-closed, payload allowlist on outbound frames (no `user_id`/PII)
  - [ ] 2.8.SR **Semantic Review**: bounded-state exception confined to this module with cap constants; zero unbounded growth; close-code vocabulary matches doc contract exactly (4401/4429/4009/1013/1001)
  - [ ] 2.8.IV **Instruction Verification**: validate against REQ-022/023/033/034 + process-topology ruling (sidecar NOT under `app/api/**`, exempt from ROUTE_INVENTORY per plan §1.1)
  - Outcome: `outcome/2.8-outcome.md`

### 2.M Mid-Point Review Gate

- [ ] 2.M [Mid-point review — consolidate Phases 0–2 before GraphQL work]
  - Consolidate outcomes 0.1–2.8; re-run baseline counters (`bun tsgo`, `bun biome:check`, lint) and record delta vs 0.1 baseline (target: 0 new errors)
  - Confirm: `git diff backend/db/schema/** backend/db/migration/**` EMPTY; enum parity test green; journey suites 2.2/2.3 GREEN across two consecutive runs
  - Confirm deferred-items ledger: zero ❌/⚠️ beyond pre-seeded D1–D4
  - Write `outcome/2M-midpoint-review-outcome.md`; ANY red finding blocks Phase 3
  - _Requirements: REQ-048, REQ-078, REQ-070_

---

## Phase 3: GraphQL Resolvers & API Handlers

### 3.1 Enum Registration + Pothos Objects

- [ ] 3.1 [Register `NotificationType` enum + `Notification` / `NotificationListPage` Pothos objects]
  - `backend/graphql/pothos/shared/enum.pothos.ts`: ADD `NotificationTypePothosEnum` via enum-object form `gqlSchemaBuilder.enumType(NotificationType, { name: "NotificationType" })` — registered ONCE
  - Create `backend/graphql/pothos/notifications/notification.pothos.ts`: single canonical `NotificationPothosObject` = `objectRef<NotificationReturnType>("Notification")`, `id` exposed FIRST, `createdAt` via existing DateTime scalar convention; NO local type defs
  - Create `backend/graphql/pothos/notifications/notification-list-page.pothos.ts`: `NotificationListPage` wrapper (allowed pagination wrapper) backed by `NotificationListPageReturnType`
  - Barrel wiring per gateway Rule 8 + `pothos/index.ts` domain export
  - Applicable instructions: `backend/graphql/AGENTS.md` (single-canonical-type CRITICAL rule, enum-registration CRITICAL rule), `docs/graphql/api-gateway-and-routing.md`
  - _Requirements: REQ-060, REQ-061, REQ-014_
  - [ ] 3.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <each-file> --lifecycle duplicates` (exit 0)
  - [ ] 3.1.TE **Test Engineering**: schema-build smoke assertion — `Notification` object present with `id`, enum carries exactly 7 values
  - [ ] 3.1.SEC **Security & Tenancy Audit**: object exposes ONLY REQ-060 fields (no `userId` surface)
  - [ ] 3.1.SR **Semantic Review**: single object per entity; enum object-form (no literal arrays); top-level static imports only
  - [ ] 3.1.IV **Instruction Verification**: validate against `backend/graphql/AGENTS.md` + gateway Rule 8
  - Outcome: `outcome/3.1-outcome.md`

### 3.2 Query Resolvers

- [ ] 3.2 [Implement `myNotifications` + `myUnreadNotificationCount` query resolvers]
  - Create `backend/graphql/query/notifications/notification.query.ts`: `authScopes: { authenticated: true }` on BOTH; thin bodies delegating to `NotificationEngine.listMyNotifications(ctx.user.id, filter, ctx.locale)` / `getMyUnreadCount(ctx.user.id, ctx.locale)`; `MyNotificationsFilterInput` input ref bound to Pothos input shape (`type` via registered enum)
  - Domain query barrel side-effect registration per conventions; NO `await import()`; NO business logic/respository imports in resolvers
  - Public-operation allowlist UNCHANGED (default-deny preserved — verify byte-identical `backend/lib/gateway/public-operations.ts`)
  - _Requirements: REQ-017, REQ-018, REQ-032, REQ-060, REQ-061_
  - [ ] 3.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <each-file> --lifecycle duplicates` (exit 0)
  - [ ] 3.2.TE **Test Engineering** (integration tier via `setupTestServerLifecycle` + `testClient`): anonymous → `UNAUTHORIZED` on both ops; each role reads ONLY own inbox; filter-over-wire coherence; `id` in selection normalizes
  - [ ] 3.2.SEC **Security & Tenancy Audit**: zero identity args accepted; scope exactly `{ authenticated: true }` (no role/permission/superAdmin); BFLA: no emit imports anywhere under `backend/graphql/**` (grep evidence recorded)
  - [ ] 3.2.SR **Semantic Review**: resolvers validation-free (service owns bounds); `ctx.locale` propagated; localized copy via `ctx.t("errors")` only where needed
  - [ ] 3.2.IV **Instruction Verification**: validate against `backend/graphql/AGENTS.md`, gateway rules 4/8
  - Outcome: `outcome/3.2-outcome.md`

### 3.3 Mutation Resolvers

- [ ] 3.3 [Implement `markNotificationRead` + `markAllNotificationsRead` mutation resolvers]
  - Create `backend/graphql/mutation/notifications/notification.mutation.ts`: `authScopes: { authenticated: true }`; `markNotificationRead(id: ID!)` → `markRead(ctx.user.id, id, ctx.locale)`; `markAllNotificationsRead(type: NotificationType)` → `markAllRead(ctx.user.id, type, ctx.locale)` returning Int
  - ID-channel discipline: `id` parsed via positive-safe-int guard (no `as number` casts)
  - Domain mutation barrel registration per conventions
  - _Requirements: REQ-019, REQ-020, REQ-030, REQ-031, REQ-032, REQ-060, REQ-061_
  - [ ] 3.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <each-file> --lifecycle duplicates` (exit 0)
  - [ ] 3.3.TE **Test Engineering** (integration tier): foreign/nonexistent id → `extensions.code === "NOTIFICATION_NOT_FOUND"` via `expectMutationError`/`CombinedGraphQLError` helpers; idempotent double mark; mark-all + type-filtered + empty-set 0; anonymous → `UNAUTHORIZED`; constant response shapes across denial branches
  - [ ] 3.3.SEC **Security & Tenancy Audit**: oracle-safe denial constancy (REQ-039); smuggled input fields ignored (BOPLA probe); NO notification-CUD mutations elsehere in schema (structural scan pre-wired for 3.4)
  - [ ] 3.3.SR **Semantic Review**: thin resolvers; `DomainError` subclasses only (no plain `new Error`); i18n via `ctx.t`
  - [ ] 3.3.IV **Instruction Verification**: validate against `docs/graphql/domain-error-extensions-code.md`, `backend/graphql/AGENTS.md`
  - Outcome: `outcome/3.3-outcome.md`

### 3.4 Schema Generation, Codegen & Structural Assertions

- [ ] 3.4 [Run schema/codegen + commit generated artifacts + structural schema assertions]
  - Run `bun run generate:gqlSchema && bun codegen`; commit ALL generated artifacts in the same change set
  - Add static schema assertion test: generated `schema.graphql` contains ZERO `createNotification`/`updateNotification`/`deleteNotification` operations (BFLA verdict); `Notification` type carries `id`; all four ops present per REQ-060 SDL
  - Verify public-operation allowlist byte-unchanged (`git diff` evidence in outcome)
  - _Requirements: REQ-032, REQ-060, REQ-061, REQ-069_
  - [ ] 3.4.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <touched-source-files> --lifecycle duplicates` (exit 0)
  - [ ] 3.4.TE **Test Engineering**: structural assertion suite green; depth/complexity posture documented (flat object, capped list)
  - [ ] 3.4.SEC **Security & Tenancy Audit**: BFLA structural verdict recorded; default-deny posture intact
  - [ ] 3.4.SR **Semantic Review**: generated diff contains ONLY notification additions (no unrelated schema drift)
  - [ ] 3.4.IV **Instruction Verification**: validate against gateway Rule 8 + REQ-061 (artifacts committed in same change set)
  - Outcome: `outcome/3.4-outcome.md`

---

## Phase 4: Frontend GraphQL Documents, Stores & UI Views

> **NO new Zustand store** (REQ-063). Feed truth = Apollo cache; socket handles never enter `persist`. Zero `dangerouslySetInnerHTML` anywhere in `frontend/views/notifications/**` (static-assertion enforced).

### 4.1 Frontend GraphQL Documents

- [ ] 4.1 [Author notification GraphQL documents + barrel exports]
  - Create `frontend/graphql/sharedDocuments/notifications/notification.documents.ts`: `myNotificationsQueryDocument`, `myUnreadNotificationCountQueryDocument`, `markNotificationReadMutationDocument`, `markAllNotificationsReadMutationDocument` as `gql` `TypedDocumentNode`s from `@apollo/client` (never `/core`); `id` in EVERY `Notification` selection; codegen types from `@/frontend/graphql/generated/gql/graphql` only
  - Create sub-barrel `index.ts`; verify top-level barrel re-export path; NO inline literals, NO mapping layers, NO indexed-access workarounds
  - Applicable instructions: `frontend/graphql/AGENTS.md` (or shared documents conventions), REQ-062
  - _Requirements: REQ-062_
  - [ ] 4.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <each-file> --lifecycle duplicates` (exit 0)
  - [ ] 4.1.TE **Test Engineering**: codegen type-binding compile gate (`bun tsgo`); document-shape snapshot assertions
  - [ ] 4.1.SEC **Security & Tenancy Audit**: documents request ONLY self-scoped operations (no identity variables anywhere)
  - [ ] 4.1.SR **Semantic Review**: hooks discipline preserved for consumers (`@apollo/client/react`, `useQuery` stateful only — documented note); zero dead documents
  - [ ] 4.1.IV **Instruction Verification**: validate against frontend shared-documents conventions + REQ-062
  - Outcome: `outcome/4.1-outcome.md`

### 4.2 `useNotificationRealtime` Client Hook

- [ ] 4.2 [Implement the realtime client hook (WS lifecycle + cache merge + toast)]
  - Create `frontend/hooks/use-notification-realtime.ts` (or views-adjacent placement per `frontend/AGENTS.md` conventions): opens at most ONE WebSocket per mounted authenticated shell (REQ-067); cookie-based handshake (browser sends httpOnly cookie automatically — NO token handling in JS)
  - Backoff: 1s→2s→4s…cap 30s + jitter; ABORT retry on close codes 4401/4009; deterministic `close(1000)` on unmount; NO toasts on clean close
  - Message handler: JSON shape-guard → `RealtimeNotificationPayload` → dedupe by `data.id` → Apollo cache merge (badge + list update without refetch spam) → localized toast via existing snackbar conventions (`Translation.Notifications` property access)
  - Post-reconnect CATCH-UP: refetch `myNotifications` page 1 + `myUnreadNotificationCount` (REQ-025); silent degradation when sidecar down (existing 120s polling posture continues; at most client-side `logger` warn — REQ-064)
  - Local React state/refs ONLY (no stores, no persist); connection state never escapes the hook
  - Applicable instructions: `frontend/AGENTS.md`, `frontend/hooks/AGENTS.md` (if present)
  - _Requirements: REQ-021, REQ-025, REQ-063, REQ-064, REQ-067_
  - [ ] 4.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0)
  - [ ] 4.2.TE **Unit / Component Tests**: Happy DOM tier — mocked `WebSocket`: connect message → cache merge dedupe by id; duplicate id → no-op; reconnect → refetch invoked; close(4401) → no retry; unmount → single `close(1000)`; no listener/toast duplication across remounts
  - [ ] 4.2.BF **Agent-Browser Functional Self-Loop**:
    • Launch dev server + `bun run ws` sidecar; connect via agent-browser (Playwright)
    • Authenticated session → open any dashboard page → confirm exactly ONE WS connection established (network inspection)
    • Trigger a test emit (service harness) → assert toast appears once + badge increments without page refetch
    • Kill sidecar → confirm silent continued polling + no error toasts; restart sidecar → reconnect with catch-up refetch producing identical feed
    • Iterative self-loop: patch and re-test until all flows clean
  - [ ] 4.2.BS **Agent-Browser Visual & Styling Self-Loop (Screenshot Analysis)**:
    • Capture toast + badge at Desktop 1440x900, Tablet 768x1024, Mobile 375x812 × locales en (LTR) + ar (RTL)
    • Inspect: badge anchoring on app bar in both directions, toast positioning (bottom-center mobile per plan), palette compliance (`theme.palette.*` only), unread-count pluralization rendering in Arabic
    • Iterative self-loop: screenshot → identify defect → patch `sx` tokens → re-capture → repeat until polished
  - [ ] 4.2.SR **Semantic Review**: no `console.*`; no hardcoded strings/colors; enum-handle translation access; `*Outlined` icons if any; non-serializable socket kept out of stores
  - [ ] 4.2.IV **Instruction Verification**: validate against `frontend/AGENTS.md` (`.instructions.md` files auto-discovered), REQ-025/064/067
  - Outcome: `outcome/4.2-outcome.md`

### 4.3 Notifications Feed Page (Server Shell + Client Container)

- [ ] 4.3 [Implement `/notifications` feed page + full client view tree]
  - Create `app/(dashboard)/notifications/page.tsx` — Server Component: `withPageAuth`-class authenticated-all-roles guard (anonymous → redirect to `/login`); `await getTranslations(locale)`; delegates to client container
  - Create `frontend/views/notifications/NotificationsFeedContainer.tsx` (+ `NotificationFilterChips`, `NotificationList`, `NotificationRow`, `MarkAllButton`, empty state, skeleton rows, error surface): `useAppTranslation(Translation.Notifications)`; `useQuery(myNotificationsQueryDocument)` + `useQuery(myUnreadNotificationCountQueryDocument)` (polling posture per conventions); filter state (type chips for all 7 types + read toggle) + pagination in local state; per-row mark-read + mark-all with affected-count snackbar
  - MUI v9 discipline: `sx`-only styling, `theme.palette.*` via theme callback (zero hex/rgb), `*Outlined` icons only, logical RTL properties (`marginInlineStart` etc.), unread rows via `theme.palette.action.selected`-class tokens, `React.SubmitEvent` where applicable
  - Content rendered as TEXT nodes via `Typography` — `dangerouslySetInnerHTML` PROHIBITED (static-assertion test scans `frontend/views/notifications/**`)
  - Accessibility: `aria-busy` on list region, translated per-row action `aria-label`s, `PermissionDeniedFallback`-family error surface
  - Applicable instructions: `frontend/AGENTS.md`, `frontend/views/AGENTS.md`, `frontend/components/ui/AGENTS.md`
  - _Requirements: REQ-028, REQ-063, REQ-065, REQ-066, REQ-068_
  - [ ] 4.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <each-file> --lifecycle duplicates` (exit 0)
  - [ ] 4.3.TE **Unit / Component Tests**: Happy DOM + Apollo `MockedProvider` + `translation-preload.ts` + `readTranslation(handle, locale)` + shared `TestWrapper locale`: populated feed / empty state / filter chips / mark-one + mark-all flows / error + loading skeletons / RTL rendering / realtime-toast path (mocked hook event) — translation-driven matchers ONLY, zero hardcoded strings; `dangerouslySetInnerHTML` static scan green
  - [ ] 4.3.BF **Agent-Browser Functional Self-Loop**:
    • Launch dev server; connect via agent-browser (Playwright)
    • Anonymous `GET /notifications` → redirect to `/login?redirect=/notifications` asserted
    • Login as student fixture → feed renders; empty state → (emit via service harness) → row appears; mark-one transitions row; badge decrements; filter chips (type + unread) filter correctly over the wire; mark-all returns affected count snackbar
    • Error-state drill (blocked route / forced failure) → retry button recovers
    • Iterative self-loop: patch interactions/validation defects → re-run until clean
  - [ ] 4.3.BS **Agent-Browser Visual & Styling Self-Loop (Screenshot Analysis)**:
    • Screenshots at 1440x900 / 768x1024 / 375x812 × en + ar: inline filters desktop, wrapped chips tablet, collapsed filter affordance mobile; RTL mirroring of row icon→content→action ordering; unread tint tokens; skeleton geometry matches final rows; Arabic chip heights (no glyph clipping); empty/error states centered with generous rhythm
    • Analyze for: palette-token compliance, typography hierarchy, margin/padding rhythm, truncation/overflow, contrast
    • Iterative self-loop: screenshot → identify defect → patch `sx` → re-capture → repeat until polished; ReviewMediaFile images handled ONE at a time
  - [ ] 4.3.SR **Semantic Review**: zero direct style props; zero hardcoded strings/colors; `useAppTranslation` enum handle + property access; `*Outlined` icons; text-only content rendering
  - [ ] 4.3.IV **Instruction Verification**: validate against `frontend.instructions.md`, `mobile-desktop.instructions.md` (auto-discovered), layer AGENTS.md files
  - Outcome: `outcome/4.3-outcome.md`

### 4.4 App-Bar Badge + Navigation Integration

- [ ] 4.4 [Integrate unread badge + navigation entry across all role shells]
  - Wire app-bar bell (`NotificationsOutlined`) + badge bound to `myUnreadNotificationCount` (existing polling posture cadence preserved); badge aria uses the namespace pluralization function; link → `/notifications`
  - Add "Notifications" sidebar entry under the existing general nav group for each role (student / parent / teacher-applicant / teacher-certified / super admin) per current nav config — NO new nav group, NO new bottom-nav slot unless the role's bottom nav already carries a notifications affordance
  - Verify per-role reachability (REQ-065) and single-socket ownership with badge mounted at authenticated shell level
  - _Requirements: REQ-063, REQ-065, REQ-066, REQ-067_
  - [ ] 4.4.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts <each-touched-file> --lifecycle duplicates` (exit 0)
  - [ ] 4.4.TE **Unit / Component Tests**: badge rendering + pluralization (0/1/N, en + ar); nav entry presence per role; mount/unmount remount stability (no duplicate listeners)
  - [ ] 4.4.BF **Agent-Browser Functional Self-Loop**:
    • For EACH role fixture: login → badge visible → navigate via bell/sidebar to `/notifications` → count on badge equals unread rows in feed
    • Realtime arrival (harness emit) → badge +1 instantly, no full-page refetch
    • Iterative loop until all roles clean
  - [ ] 4.4.BS **Agent-Browser Visual & Styling Self-Loop (Screenshot Analysis)**:
    • Badge + bell across 3 viewports × 2 locales; badge overflow typography (99+), RTL badge anchoring, focus/hover states, contrast in dark/light if theme supports
    • Iterative screenshot → defect → `sx` patch → re-capture loop
  - [ ] 4.4.SR **Semantic Review**: nav additions follow existing config shape; zero hardcoded strings; `*Outlined` icon naming
  - [ ] 4.4.IV **Instruction Verification**: validate against nav/app-bar conventions in `frontend/AGENTS.md`
  - Outcome: `outcome/4.4-outcome.md`

---

## Phase 5: Integration & Differential Testing

### 5.1 GraphQL Integration Tier (Consolidated)

- [ ] 5.1 [Assemble full GraphQL integration suite — role × operation matrix]
  - Via `setupTestServerLifecycle` + `testClient`: anonymous → `UNAUTHORIZED` × 4 ops; each role reads ONLY own inbox (cross-user isolation matrix incl. parent-outsider probes); filter→content coherence over wire; mark flows with `extensions.code` assertions (`NOTIFICATION_NOT_FOUND`, `VALIDATION`, `UNAUTHORIZED`) via `expectMutationError`/`CombinedGraphQLError` helpers; governed (suspended/blocked/deleted) caller → context-level denial (REQ-038)
  - Denial-shape constancy probes (REQ-039); pagination cap probes (limit 51 rejected)
  - Run via `bun run test/scripts/run-test.ts <path>`; deterministic double-run evidence recorded
  - _Requirements: REQ-030, REQ-032, REQ-036, REQ-038, REQ-039, REQ-053, REQ-074_

### 5.2 WS Sidecar Suite Consolidation

- [ ] 5.2 [Final WS harness consolidation + transport-degradation path]
  - Consolidate 2.8.TE harness into the committed suite location (runner-registered per REQ-079); add Redis-outage degradation test: emit during outage → row persisted, zero pushes, structured warn logged, subscriber resumes post-recovery
  - Deterministic double-run evidence (two consecutive green runs recorded)
  - _Requirements: REQ-011, REQ-045, REQ-073, REQ-078, REQ-079_

### 5.3 Chaos / Concurrency Tier

- [ ] 5.3 [Chaos & concurrency suite]
  - 25-way concurrent mark-one/mark-all storms (`Promise.allSettled`, same user) → all-fulfilled + consistent final state (REQ-044)
  - Parallel emit batches → full row-set + ordering invariants (`createdAt` batch-equal, `id` tiebreak)
  - Reconnect flicker storm (close↔open × N) → exactly-one live connection, zero duplicated toasts (client harness)
  - Fuzz: hostile ids/types/pagination + unicode/RTL/control-char `title`/`body` payloads → literal-text storage + safe rendering asserted
  - _Requirements: REQ-044, REQ-076_

### 5.4 Coverage & Final Gates

- [ ] 5.4 [Coverage evidence + baseline + zero-drift gates]
  - `bun test --coverage` evidence: 100% statement/branch on ALL new modules (repo additions, engine service, guard helpers, transports, WS server, realtime hook); recorded in `outcome/5.4-outcome.md`
  - `git diff backend/db/schema/** backend/db/migration/**` EMPTY (REQ-048); `backend/lib/gateway/public-operations.ts` byte-unchanged
  - Baseline re-run vs 0.1: `bun tsgo`, `bun biome:check`, lint counts — delta = 0 NEW errors
  - Journey + WS suites two consecutive green runs recorded; seed check `bun db seed` unchanged-green (REQ-056)
  - Verify CI pickup: new suites reachable via existing runner globs/scripts (no CI topology restructure)
  - _Requirements: REQ-048, REQ-056, REQ-070, REQ-078, REQ-079_

---

## Phase 6: Post-Implementation Review Waves

### 6.1 Parallel Review Waves

- [ ] 6.1 [Run parallel review waves — all four, findings triaged before Phase 7]
  - **Wave A — review-types**: canonical types extended additively only; zero service-layer `.types.ts`; zero local Pothos types; enum value-import discipline; `DBTransaction` sourcing
  - **Wave B — review-backend**: engine single-writer rule (no other NEW `notifications` writers — grep evidence); publish-after-commit ordering; tx propagation; guarded self-scope updates; bounded sidecar state; transports/env-registry parity; error-taxonomy compliance (`DomainError` subclasses only); logging hygiene (`logger` only, context caps)
  - **Wave C — review-frontend**: sx-only, palette-token colors, `*Outlined` icons, enum-handle i18n with property access, no `dangerouslySetInnerHTML` in notification subtree, Apollo-only state truth, `useQuery`-stateful-only, no stores/persist involvement
  - **Wave D — pentester**: BOLA self-scope by construction (no identity inputs); oracle-safe denial constancy; BOPLA spread-scan (grep-verified zero spreads into Drizzle); BFLA (zero notification-CUD ops; no resolver imports of `emitForUsers`); CSWSH (Origin-first handshake); query-token refusal; throttle fail-closed; payload allowlist (no PII on bus/wire); wildcard-escaping N/A documented (no LIKE surfaces)
  - Record wave reports under `outcome/review-waves/`; every finding → fixed immediately OR recorded in `deferred-items.md` with an owning ticket
  - _Requirements: REQ-078, REQ-083; Security REQs 030–039_

### 6.2 Deferred-Items & Ledger Gate

- [ ] 6.2 [Deferred-items gate]
  - `grep -c "❌\|⚠️" ai/plans/dev3-010-realtime-notification-engine/deferred-items.md` equals 0 EXCLUDING the pre-seeded forward items D1–D4 (each with owning ticket recorded, non-blocking)
  - Any newly-discovered gap (e.g., `read_at`, per-user locale) recorded against its owning future ticket — NEVER patched inline
  - _Requirements: REQ-048, REQ-083_

---

## Phase 7: Knowledge Propagation & Documentation

### 7.1 Canonical Document

- [ ] 7.1 [Author `docs/notifications/realtime-engine.md`]
  - Structure: Why → Pattern → Rules → What NOT to Do → Rollout Summary → Related Documents
  - Mandatory content: persist-first/push-second rule (REQ-011); publish-after-commit + caller-tx receipt composition (REQ-012/042) with consumption-guide code sketch; emit contract + localization-at-emitter boundary (engine never translates — REQ-015/028); WS handshake security model + full close-code vocabulary (4401/4429/4009/1013/1001); backplane port + both adapters + fail-open-on-push-failure ruling; fail-open idempotency deviation rationale (D5); catch-up self-heal contract; connection-cap policy; bounded-state exception scope; consumption guide for DEV3-011 / DEV1-016 / DEV1-017 / DEV2-016 / DEV3-012 / DEV3-013 / DEV3-022d (import engine contracts, never write rows directly, honor publish-after-commit)
  - Explicit statement: NO new state-machine invariants minted (append-only + one-way read latch is documented, not INV-numbered); INV-P3 referenced as ENABLED-BY this engine
  - _Requirements: REQ-080, REQ-081_

### 7.2 Decisions Addendum

- [ ] 7.2 [Record reconciliation addenda in `docs/specs/open-decisions-and-gaps.md`]
  - (i) WS-via-sidecar topology ruling (App Router cannot host WS; sidecar not an `app/api` surface)
  - (ii) emit-fail-open vs booking-fail-closed idempotency distinction (with `docs/IDEMPOTENCY.md` cross-ref)
  - (iii) copy-localization-at-emitter ruling + the `users.locale` forward gap (owned by deferred item D2)
  - Addendum style matching the file's existing convention; bind Decision A.4 as the table this engine serves
  - _Requirements: REQ-081_

### 7.3 AGENTS.md & Cross-Link Updates

- [ ] 7.3 [Layer knowledge propagation]
  - `backend/services/AGENTS.md`: +1–2 lines — NotificationEngine single-writer rule + canonical doc link
  - `backend/db/repo/AGENTS.md`: +1 line — guarded self-scope update pattern note (`WHERE id AND user_id` precedent)
  - `test/workflows/AGENTS.md`: VERIFY authored content from Task 2.1 is final (journey-layer rules: committed fixtures, tracked teardown, spied side effects, honest permissions, NO `runInRollback`)
  - Root `AGENTS.md`: +1 line in Important References for `docs/notifications/realtime-engine.md`
  - `docs/workflows/03-session-lifecycle-escrow.md`: forward-link comment to the engine doc at its notification references ONLY if the existing edit style permits without churn (else record the related-docs entry in the canonical doc)
  - _Requirements: REQ-082_

### 7.4 Outcome Synthesis & Final Gate

- [ ] 7.4 [Close the plan]
  - Verify EVERY task has its `outcome/<task-id>-outcome.md`; `outcome/plan-review-R1.md` predates implementation tasks
  - Final verification bundle re-run and recorded: baseline delta = 0; schema drift empty; codegen artifacts committed; all suites (`backend/db/test/logic/notifications`, engine services, WS, GraphQL integration, component, chaos, `bun test test/workflows`) green across two consecutive runs
  - Deferred-items final grep gate (REQ-083) executed and recorded
  - All checkboxes in this file marked `[x]`
  - Write `outcome/final-outcome.md` summarizing: shipped surface (4 GraphQL ops + engine + sidecar + transports + UI), test evidence index, deferred items D1–D4 handoff, consumer-ticket guidance pointer
  - _Requirements: REQ-078, REQ-083_

---

### Coverage Note — Requirement-to-Task Completeness
REQ-001/083 → 0.1/0.3/5.4/6.2/7.4 · REQ-002/051/052 → 1.3/1.4 (+consumers 2.6/2.7/3.x/4.x) · REQ-003/014 → 1.1/1.2/2.6/3.1 · REQ-004 → 0.2/1.2 · REQ-010–016/040–047 → 2.5/2.6 (+J1/J2) · REQ-017–020/026/029/030 → 2.4/2.7/3.2/3.3/5.1 · REQ-021–025/033/034/045/046 → 2.5/2.8/4.2/5.2 · REQ-027/031/032/035/036/038/039 → 2.6/3.2/3.3/3.4/5.1/6.1 · REQ-037/050/053/055 → all backend `.SR`/`.SEC` subtasks · REQ-048/049/056 → 1.5/2.M/5.4 · REQ-060–062/069 → 3.1–3.4/4.1 · REQ-063–068 → 4.2/4.3/4.4 · REQ-070–076 → per-task `.TE` + 5.1–5.4 · REQ-077 + REQ-J1..J5 → 2.1/2.2/2.3 · REQ-080–082 → 7
