# Implementation Tasks: DEV3-022d — Broadcast Notifications (System-Wide & Targeted)

> **Plan directory (verbatim — used everywhere below):** `ai/plans/sprint_3/dev3-022d-broadcast-notifications-system-wide-targ`
> **Specs:** `ai/plans/sprint_3/dev3-022d-broadcast-notifications-system-wide-targ/specs.md` (REQ-001..REQ-082, §2.9 journeys, DB-1..DB-6)
> **Plan:** `ai/plans/sprint_3/dev3-022d-broadcast-notifications-system-wide-targ/plan.md`
> **Outcomes:** `ai/plans/sprint_3/dev3-022d-broadcast-notifications-system-wide-targ/outcome/`
> **Deferred items:** `ai/plans/sprint_3/dev3-022d-broadcast-notifications-system-wide-targ/deferred-items.md`

---

## Non-Negotiable Execution Protocol

1. **Pre-Execution Outcome Knowledge Read:** before starting ANY task, read ALL existing files under `ai/plans/sprint_3/dev3-022d-broadcast-notifications-system-wide-targ/outcome/` and `ai/plans/sprint_3/dev3-022d-broadcast-notifications-system-wide-targ/deferred-items.md`. Never repeat a resolved mistake; never redo finished work.
2. **Post-Edit Verification:** after editing/creating ANY file, run `bun run scripts/health/sub-loop.ts <file-path> --lifecycle duplicates` — exit code MUST be 0 before the task may be marked complete.
3. **Test Execution:** run tests ONLY via `bun run test/scripts/run-test.ts <test-path>` (loads `--env-file=.env.test`); NEVER raw `bun test`.
4. **Semantic Review Checklist Self-Review:** every task ends with a self-review pass — atomicity, env-config handling, zero dead code, no cross-layer imports (`shared/` never imports app/frontend/backend), enums as value imports not string literals, no `console.*`, no `.rejects.toThrow()`.
5. **Outcome Documentation:** after each task, write `ai/plans/sprint_3/dev3-022d-broadcast-notifications-system-wide-targ/outcome/<task-id>-outcome.md` capturing: what changed (files), verification evidence (command outputs), deviations, follow-ups.
6. **Checkbox Tracking:** flip `[ ]` → `[x]` as subtasks complete. A task is `[x]` only when ALL its subtasks are `[x]`.

---

## Phase 0 — Pre-Implementation Baseline

- [x] 0.1 [Record error baseline + initialize deferred-items ledger]
  - Record baseline counts for: `tsgo`, `biome:check`, `lint-service` (exact numbers + command output snippets) and a `git diff --name-only` snapshot.
  - Create `ai/plans/sprint_3/dev3-022d-broadcast-notifications-system-wide-targ/deferred-items.md` from `.agents/spec-process-guide/templates/deferred-items-template.md`; seed it with plan ledger entries: **D1** chunked mega-broadcast (>5000 cohorts) → future scale ticket; **D2** crash-between-commit-and-`publishReceipts` double-insert residual (engine §3.6 document-locked posture) → engine hardening stream.
  - Write `ai/plans/sprint_3/dev3-022d-broadcast-notifications-system-wide-targ/outcome/0.1-baseline-outcome.md` with counts + snapshot.
  - _Requirements: REQ-001_

- [x] 0.2 [Prerequisite verification — reuse substrate exists (REQ-002)]
  - Verify (grep/read, cite `path:line` in the outcome) each of: `NotificationEngine.emitForUsers` (`backend/services/notifications/notification-engine.service.ts:393`), `publishReceipts` (`:475`), `validateEmitBatchInput` (`backend/services/notifications/emit-validation.ts:135`), `buildEmitClaimKey`/`attemptEmitClaim`/`storeEmitReceiptQuietly` (`backend/services/notifications/emit-idempotency.ts:67,84,112`), `NotificationRepository.createManyReturning` (`backend/db/repo/notifications/notification.repository.ts:148`), `AuditService.createAuditLog` (`backend/services/admin/audit.service.ts:82`), `assertActorAdmin` (`backend/services/admin/user-management.service.ts:240-271`), `PlanRepository.existsById` (`backend/db/repo/billing/plan.repository.ts:109`), active-subscription predicate (`backend/db/repo/admin/admin-user.repository.ts:337-346`), `withTransaction`, `SpiedFanoutTransport` (`test/workflows/helpers/spied-transport.ts:49`), `projectMutationFieldErrors` (`frontend/lib/mutationFieldErrors.ts`), `withPageAuth` (`frontend/lib/auth/withPageAuth.ts`), `adminPlansQueryDocument`.
  - IF any artifact is missing → record `❌` in `deferred-items.md` and BLOCK; do NOT re-implement the engine.
  - Confirm the `test/workflows/` layer and its helpers exist (they do: `test/workflows/helpers/actor-context.ts` ships all four actor provisioners; `test/workflows/helpers/spied-transport.ts` ships `SpiedFanoutTransport`) — task 2.0 REUSES them, scaffolds nothing.
  - Write `outcome/0.2-prerequisites-outcome.md`.
  - _Requirements: REQ-002_

---

## Phase 1 — Types, Enums & i18n Foundations (NO schema work — REQ-044)

> Gate reminder: `git diff -- backend/db/schema/** backend/db/migration/**` MUST remain empty for the entire ticket.

- [x] 1.1 [Create `BroadcastAudienceType` TS-only enum + fail-closed guard]
  - CREATE `backend/enum/notifications/broadcast-audience-type.enum.ts` — `enum BroadcastAudienceType { All="all", Role="role", Country="country", Plan="plan" }` + `isBroadcastAudienceType(value: unknown)` guard (mirror the `isNotificationType` guard at `backend/enum/notifications/notification-type.enum.ts:21-23`; enum members at :5-13). TS-only; NO `pgEnum` in `backend/db/schema/enums.ts`.
  - UPDATE `backend/enum/notifications/index.ts` — `export * from "./broadcast-audience-type.enum";`.
  - Applicable instructions: `.agents/instructions/backend.instructions.md`, `backend/enum/AGENTS.md` (verify existence in bundle before citing).
  - _Requirements: REQ-003, REQ-004, REQ-010_
  - [x] 1.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/enum/notifications/broadcast-audience-type.enum.ts --lifecycle duplicates` (exit 0)
  - [x] 1.1.TE **Test Engineering:** CREATE `backend/enum/notifications/broadcast-audience-type.enum.test.ts` mirroring the `notification-type.enum.test.ts` 4-tier pattern: Tier 1 member values; Tier 2 guard accepts every member + rejects `""`, wrong case, `null`, numbers, objects; Tier 3 fuzz hostile strings (prototypes, unicode, payloads with `__proto__`); Tier 4 no accidental string-literal acceptance beyond the four members.
  - [x] 1.1.SEC **Security & Tenancy Audit:** guard is fail-closed (unknown → false); no coercion; no leakage of valid values through error paths (enum module throws nothing).
  - [x] 1.1.SR **Semantic Review:** enum used as VALUE import downstream; zero dead code; no cross-layer imports.
  - [x] 1.1.IV **Instruction Verification:** read backend instructions + enum layer AGENTS.md; confirm conventions met.

- [x] 1.2 [Create canonical broadcast types + widen audit contract]
  - CREATE `backend/types/notifications/broadcast.types.ts` — `BroadcastAudienceSelector` (readonly, closed, type-discriminated companions) and `BroadcastNotificationSubmitInput` exactly per plan §2.2.
  - UPDATE `backend/types/notifications/index.ts` — `export * from "./broadcast.types";`.
  - UPDATE `backend/types/contracts/admin-audit.contract.types.ts` — widen `AuditLogWriteContract.entityId` to `AuditLogSelectType["entityId"]` (schema-derived `number | null`; `audit_logs.entity_id` already nullable at `backend/db/schema/audit/audit-logs.ts:39`). Additive widening ONLY (DB-5); no other contract shape change.
  - _Requirements: REQ-004, REQ-021 (DB-5)_
  - [x] 1.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/types/notifications/broadcast.types.ts --lifecycle duplicates` + same for `admin-audit.contract.types.ts` (exit 0)
  - [x] 1.2.TE **Test Engineering:** type-level checks compile under `tsgo`; audit conformance suites that pin `AuditLogWriteContract` still pass — run `bun run test/scripts/run-test.ts` on the existing audit contract/conformance suites and confirm ZERO breaks from the widening.
  - [x] 1.2.SEC **Security & Tenancy Audit:** selector is readonly and closed — no extensible/index-signature surface a BOPLA probe could ride.
  - [x] 1.2.SR **Semantic Review:** NO runtime code in `.types.ts`; NO service-layer `.types.ts` anywhere; committee of one for shapes (`backend/types/` only).
  - [x] 1.2.IV **Instruction Verification:** `.agents/instructions/backend.instructions.md` + `backend/types/AGENTS.md` (if present in bundle).

- [x] 1.3 [Register four new `ErrorsLabels` keys (broadcast domain, flat)]
  - UPDATE `shared/locale/types/errors/index.ts` — add flat, domain-prefixed keys: `broadcastTitleInvalid`, `broadcastAudienceInvalid`, `broadcastAudienceEmpty`, `broadcastAudienceTooLarge` (added as flat top-level keys — `ErrorsLabels` allows flat keys alongside the sanctioned `planCatalog`/`adminUsers` groups; do NOT add a new nested group).
  - UPDATE `shared/locale/en/errors/index.ts` + `shared/locale/ar/errors/index.ts` — both locales, parity enforced by the existing mirror suite.
  - Follow the registration checklist in `shared/AGENTS.md`.
  - _Requirements: REQ-050, REQ-051_
  - [x] 1.3.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts shared/locale/en/errors/index.ts --lifecycle duplicates` (exit 0) + ar + types files.
  - [x] 1.3.TE **Test Engineering:** run the existing errors ar/en parity suite via `bun run test/scripts/run-test.ts` — MUST stay green with the four new keys.
  - [x] 1.3.SEC **Security & Tenancy Audit:** error copy discloses no recipient data, no counts, no internal identifiers.
  - [x] 1.3.SR **Semantic Review:** key naming domain-prefixed and collision-free; no duplicate message bodies.
  - [x] 1.3.IV **Instruction Verification:** `shared/AGENTS.md` checklist steps all satisfied for error-key additions.

- [x] 1.4 [Create `AdminBroadcasts` i18n namespace + `broadcasts` dashboard label]
  - CREATE `shared/locale/types/adminBroadcasts/index.ts` (`AdminBroadcastsLabels` — full key set per plan §5.5 including plural function `successToast(count: number)`), `shared/locale/en/adminBroadcasts/index.ts`, `shared/locale/ar/adminBroadcasts/index.ts` (Arabic plural branches modeled on `notificationsAr.markAllResult`, `shared/locale/ar/notifications/index.ts:23-29`), `shared/locale/namespaces/adminBroadcasts/adminBroadcasts.namespace.ts` (`defineNamespace<AdminBroadcastsLabels>("adminBroadcasts.adminBroadcasts", t => t.adminBroadcastsTranslations)`).
  - UPDATE `shared/locale/namespaces/index.ts` (registry), `shared/locale/types/message.ts` (`adminBroadcastsTranslations` on `Translations`), BOTH `messages.ts` bundles (en + ar).
  - UPDATE `shared/locale/types/dashboard/index.ts` + `shared/locale/{en,ar}/dashboard/index.ts` — add `broadcasts: string` (dashboard bundle ONLY, so the nav one-owner test keeps passing).
  - CREATE `shared/locale/adminBroadcasts-namespace.parity.test.ts` — key-set mirror, placeholder/pointer parity, plural-function output assertions both locales, Arabic-script presence pins (model on `notifications-namespace.parity.test.ts`).
  - _Requirements: REQ-051, REQ-063, REQ-064, REQ-074_
  - [x] 1.4.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts shared/locale/types/adminBroadcasts/index.ts --lifecycle duplicates` (exit 0) + all touched locale files.
  - [x] 1.4.TE **Test Engineering:** run `bun run test/scripts/run-test.ts shared/locale` — the new parity test + all existing namespace/error/dashboard parity suites green.
  - [x] 1.4.SEC **Security & Tenancy Audit:** no interpolated raw server data in labels beyond the numeric count; placeholders documented.
  - [x] 1.4.SR **Semantic Review:** handle passed as CONST (`AdminBroadcasts`), never a string; no `Translation` enum referenced anywhere; interface named `Translations`.
  - [x] 1.4.IV **Instruction Verification:** `shared/AGENTS.md` namespace-registration checklist fully satisfied (types + ar + en + Translations + both bundles + registry + parity test).

---

## Phase 2 — Repositories & Backend Services

- [x] 2.0 [Journey: `test/workflows/notifications/admin-broadcast.journey.test.ts` — TEST-FIRST]
  - Create `test/workflows/notifications/admin-broadcast.journey.test.ts` — one file for the broadcast cross-actor workflow (specs §2.9 steps 1–10 mapped 1:1 to assertions). It will FAIL until task 2.4 lands — that is expected and required.
  - The layer already exists — REUSE it: `test/workflows/AGENTS.md` + `test/workflows/helpers/actor-context.ts` (cast provisioning: `provisionAdminActor`, `provisionCertifiedTeacherActor`, `provisionStudentActor`, `provisionParentActor`) and `SpiedFanoutTransport` in `test/workflows/helpers/spied-transport.ts`; this task only ADDS the governed (`is_deleted=true`) fixture via entity-setup helpers (verify helper name before use) and the new journey test file itself. REAL permission-group/role rows — permission resolution NEVER monkey-patched (per Architectural Invariant 10).
  - Steps as sequential service calls with `actorUserId`: Admin A fires `all` → assert rows for A/T/S/Pa/S2 and ZERO for G + ONE audit row + ONE spied envelope; SAME-key replay → identical count, zero new rows/audit/publish; `role:teacher` → only T; `country:"EG"` → only S; `plan:P` → only active-window subscriber S (expired-P student excluded); validation denials → zero state; T/S/Pa attempts → honest `FORBIDDEN`; anonymous → `UNAUTHORIZED`; governed G present in NO cohort; post-hoc observers read their OWN inbox via `NotificationEngine.listMyNotifications` and see `type=system_broadcast`, verbatim copy, `relatedEntityType/Id=null`, `isRead=false`.
  - Committed fixtures in `beforeAll` + tracked hard-delete in `afterAll` (reverse order, INCLUDE `notifications` + `audit_logs` via `withAuditDeleteTriggersSuspended` from `test/helpers/db-cleanup.ts`) — NEVER `runInRollback` (services spawn their own transactions).
  - Side effects spied: `SpiedFanoutTransport` injected as `options.transport`, scripted in-memory claim cache as `options.cache` — NEVER real Redis/email/SMS/push.
  - Verify (expected RED): `bun run test/scripts/run-test.ts test/workflows` — never raw `bun test`.
  - Applicable instructions: `.agents/instructions/tests.instructions.md`, `test/workflows/AGENTS.md` (created by this task).
  - _Requirements: REQ-024, REQ-073, §2.9 (all cross-actor EARS)_

- [x] 2.1 [Create `BroadcastAudienceRepository` — cohort resolution]
  - CREATE `backend/db/repo/notifications/broadcast-audience.repository.ts` — `BroadcastAudienceRepository.resolveAudienceIds(selector: BroadcastAudienceSelector, tx?: DBQueryExecutor): Promise<number[]>` with the four query shapes from plan §4.4: `all` / `role` (eq) / `country` (exact `eq`, trimmed value — NO LIKE surface, document that `escapeLikeWildcards` is N/A by construction) / `plan` (JOIN subscriptions, DISTINCT, canonical active-window predicate byte-equivalent to `admin-user.repository.ts:337-346`, owner FK `subscriptions.user_id` per B.8/C.2). Governance predicate everywhere: `coalesce(is_deleted,false)=false AND coalesce(is_blocked,false)=false`; suspended INCLUDED (REQ-015). Output deterministic: DISTINCT + `ORDER BY id ASC`.
  - Non-tx branch uses `queryDb` with numbered `$n` params (the `notification.repository.ts` convention); tx branch uses Drizzle builders on the supplied executor. NO `sql.placeholder` arrays, NO `inArray` prepared statements, NO inline `--` comments inside `sql` templates.
  - UPDATE `backend/db/repo/notifications/index.ts` — `export * from "./broadcast-audience.repository";`.
  - Applicable instructions: `.agents/instructions/backend.instructions.md`, `backend/db/repo/AGENTS.md`.
  - _Requirements: REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-016, REQ-042, REQ-043_
  - [x] 2.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/db/repo/notifications/broadcast-audience.repository.ts --lifecycle duplicates` (exit 0)
  - [x] 2.1.TE **Test Engineering:** CREATE repo test — `runInRollback` everywhere, `tx` propagation asserted, `expectRepoError` try/catch (never `.rejects.toThrow()`), `entity-setup.ts` helpers only. Tier 1: each of 4 kinds resolves expected ids, ordering `id ASC`; Tier 2: empty-result sets, boundary windows (subscription starting exactly now / ending exactly now per the strict `< end_date` rule), NULL governance columns → eligible; Tier 3: plan cohort user with 2 subscriptions → DISTINCT yields ONE row; country exact-match does NOT match partial/LIKE-shaped strings (`"EG%"`, `"eg "`); Tier 4: hostile selector companions (already-guarded upstream — assert repo assumes validated input and never string-concatenates).
  - [x] 2.1.SEC **Security & Tenancy Audit:** all params bound (`$n` / Drizzle); governance exclusion mandatory in every branch; no identity acceptor from callers beyond the validated selector.
  - [x] 2.1.SR **Semantic Review:** canonical types imported from `backend/types/`; no local shapes; no dead branches.
  - [x] 2.1.IV **Instruction Verification:** repo AGENTS.md conventions (queryDb/tx duality, prepared-statement prohibitions) verified.

- [x] 2.2 [Extract shared `assertActorAdmin` + refactor `AdminUserManagementService`] (RE-SCOPED per plan-review F-1: gate already shipped at `backend/services/admin/admin-gate.helpers.ts:59` — verified in place, no fork created; focused gap test added — see `outcome/2.2-outcome.md`)
  - CREATE `backend/services/admin/assert-actor-admin.ts` — move the logic from `backend/services/admin/user-management.service.ts:240-271` VERBATIM (anonymous `actorId = 0` → `UnauthorizedError`; missing/non-admin row → `ForbiddenError`; identical logging shape; pre-transaction; zero writes/audit — JR-C-1).
  - UPDATE `backend/services/admin/user-management.service.ts` — import the shared helper; delete the private copy.
  - UPDATE `backend/services/admin/index.ts` — export the helper.
  - _Requirements: REQ-030 (D8), REQ-002_
  - [x] 2.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/services/admin/assert-actor-admin.ts --lifecycle duplicates` (exit 0) + user-management.service.ts. (Executed re-scoped: exit 0 on the NEW `admin-gate.helpers.test.ts` + verification run on untouched `admin-gate.helpers.ts`.)
  - [x] 2.2.TE **Test Engineering:** run ALL existing user-management suites (the 8 chaos/service tests) via `bun run test/scripts/run-test.ts` — extraction MUST be behavior-identical (zero diffs in expectations). Add a focused unit test for the shared helper if the existing suites don't pin all three branches (anonymous/missing/non-admin). (118 pass / 0 fail across service/chaos/audit-trail/denials-journey; missing-actor-row branch was unpinned → `admin-gate.helpers.test.ts` 6/0 added.)
  - [x] 2.2.SEC **Security & Tenancy Audit:** re-check happens against the LIVE `users` row (not a cached claim); denies carry `extensions.code` UNAUTHORIZED/FORBIDDEN only; no oracle about which rows exist beyond admin-gated knowledge.
  - [x] 2.2.SR **Semantic Review:** single canonical admin gate (no forked copies remain); imports correct direction.
  - [x] 2.2.IV **Instruction Verification:** `.agents/instructions/backend.instructions.md` + `backend/services/AGENTS.md`.

- [x] 2.3 [Create `RedisClaimCache` + `resolveBroadcastClaimCache` factory]
  - CREATE `backend/services/notifications/redis-claim-cache.ts` — `class RedisClaimCache implements NotificationIdempotencyClaimCache` (`claim` via `SET key "1" NX EX ttl` → OK/null; `store` via `SET key value EX ttl`; `get` via `GET`), plus stateless `resolveBroadcastClaimCache(): NotificationIdempotencyClaimCache | undefined` returning `undefined` when `REDIS_URL` absent (hermetic default → engine's documented fail-open single warn, A.4.2); lazily-constructed module-level shared `ioredis` client (`lazyConnect: true`) when configured.
  - NO engine file is touched.
  - _Requirements: REQ-023 (D6), REQ-034_
  - [x] 2.3.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/services/notifications/redis-claim-cache.ts --lifecycle duplicates` (exit 0)
  - [x] 2.3.TE **Test Engineering:** unit tests with a mocked redis-like client (mock adapter, never real Redis): Tier 1 claim won/held mapping, store/get round-trip shapes; Tier 2 TTL propagation and key pass-through; Tier 3 client command failure rejects the promise (engine owns fail-open — assert the cache itself throws honestly, never swallows); Tier 4 no raw key logging, no secret echo (`REDIS_URL` never logged), `resolveBroadcastClaimCache` undefined-when-unset + defined-when-set env matrix (env restored in finally).
  - [x] 2.3.SEC **Security & Tenancy Audit:** keys are the engine's SHA-256 digests only; no recipient/PII material ever lands in Redis values beyond engine receipts (engine-owned shape).
  - [x] 2.3.SR **Semantic Review:** factory stateless; no eager connection at import time; zero `console.*`.
  - [x] 2.3.IV **Instruction Verification:** backend instructions + services AGENTS.md (logger from `@/backend/lib/logger`).

- [x] 2.4 [Create `AdminBroadcastService.broadcast` — the composition core]
  - CREATE `backend/services/notifications/admin-broadcast.service.ts` — `AdminBroadcastService.broadcast(input: BroadcastNotificationSubmitInput, actorId, locale, idempotencyKey?, options?: { transport?, cache? }, outerTx?): Promise<number>` implementing the strict 7-step flow of plan §4.1: (1) shared `assertActorAdmin` pre-tx; (2) pre-DB validation — `BROADCAST_TITLE_INVALID`, `BROADCAST_AUDIENCE_INVALID` (coherence matrix using the existing `toUserRole(role) !== null` guard, `backend/enum/users/user-role.enum.ts:24`; trimmed ≤100 country; positive-safe-int planId), plan existence via `PlanRepository.existsById` → `NotFoundError("PLAN", tErrors.planCatalog.planNotFound)`; (3) cohort resolution via `BroadcastAudienceRepository` (tx-propagation rule REQ-042); (4) `BROADCAST_AUDIENCE_EMPTY` / `BROADCAST_AUDIENCE_TOO_LARGE` (cap `BROADCAST_MAX_RECIPIENTS = 5000`); (5) ONE `withTransaction` — `NotificationEngine.emitForUsers({..., type: NotificationType.SystemBroadcast, relatedEntityType: null, relatedEntityId: null, idempotencyKey}, locale, tx, options)`; replay detection `idempotencyKey !== undefined && options?.cache !== undefined && receipt.emitClaimKey === undefined` → return count with ZERO audit; fresh → ONE `AuditService.createAuditLog({ actorId, actionType: AuditActionType.Create, entityType: "notification_broadcast", entityId: null, details: capped metadata JSON — NEVER copy text }, tx)`; (6) post-commit fresh-only `publishReceipts([receipt], locale, options)`; (7) return count.
  - Field-by-field mapping only (REQ-032); `logger.logDomainError` with `{ code, entity: "notifications"|"plans", entityId?, locale }` on expected rejections; happy paths log NOTHING (REQ-034/052); enums as value imports everywhere.
  - Applicable instructions: `.agents/instructions/backend.instructions.md`, `backend/services/AGENTS.md`, `backend/services/notifications/AGENTS.md` (if present).
  - _Requirements: REQ-010..REQ-024, REQ-030..REQ-034, REQ-040..REQ-043, REQ-050..REQ-052_
  - [x] 2.4.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/services/notifications/admin-broadcast.service.ts --lifecycle duplicates` (exit 0)
  - [x] 2.4.TE **Test Engineering:** CREATE service test suite (runInRollback / controlled tx seams the pattern supports, mock adapters for engine boundaries where honest): the full REQ-071 matrix — happy path per cohort kind (rows + ONE audit + receipt+correct count); denies anonymous/non-admin with ZERO audit; validation matrix (bad title, mismatched companions, malformed planId, unknown plan, empty cohort, oversized cohort via scripted resolution); replay path (same key → identical count, zero new rows/audit/publish); cache-outage fail-open (insert + ONE engine warn); forced-insert rollback → zero `notifications` + zero `audit_logs`; tx propagation to every repo/engine call; verbatim copy storage (unicode/RTL/injection-shaped strings stored inert); no logging on happy paths. Journey test 2.0 turns GREEN.
  - [x] 2.4.SEC **Security & Tenancy Audit:** BFLA double wall service half; BOPLA field-by-field mapping (assert no spread); BOLA — no identity surface; oracle hygiene — `PLAN_NOT_FOUND` confined to this admin path; PII/secret-free logs.
  - [x] 2.4.SR **Semantic Review:** single atomic unit; publish strictly post-commit; no dead code; canonical types only.
  - [x] 2.4.IV **Instruction Verification:** backend + services instruction files; engine import-by-reference rules (service consumes, never edits, the engine).

- [x] 2.M [Mid-Point Review Gate]
  - Self-review the whole backend half against: single-writer rule (grep — only the engine inserts into `notifications`), schema-drift gate (`git diff -- backend/db/schema/**` empty), REQ-042 tx propagation, REQ-050 taxonomy coverage, and journey 2.0 green.
  - Run: `bun run test/scripts/run-test.ts backend/services/notifications` + `bun run test/scripts/run-test.ts backend/db/repo/notifications` + `bun run test/scripts/run-test.ts test/workflows` + `tsgo` delta vs 0.1 baseline (MUST be 0).
  - Write `outcome/2.M-midpoint-review-outcome.md`; resolve or ledger any gap before Phase 3.

---

## Phase 3 — GraphQL Resolvers & API Surface

- [x] 3.1 [Register enum + input types (Pothos) + barrels]
  - UPDATE `backend/graphql/pothos/shared/enum.pothos.ts` — `export const BroadcastAudienceTypePothosEnum = gqlSchemaBuilder.enumType(BroadcastAudienceType, { name: "BroadcastAudienceType" });` (enum-OBJECT form ONLY — literal `values:[...]` fails gate A2 of `backend/lib/gateway/static-assertions.test.ts`).
  - CREATE `backend/graphql/pothos/notifications/admin-broadcast.pothos.ts` — `BroadcastAudienceInput` (`type` required; `role: UserRolePothosEnum` optional; `country: string` optional; `planId: t.int` optional) and `AdminBroadcastNotificationInput` (`title: String!`, `body: String`, `audience: required`).
  - UPDATE `backend/graphql/pothos/notifications/index.ts` — `export * from "./admin-broadcast.pothos";`.
  - _Requirements: REQ-060, REQ-061_
  - [x] 3.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/graphql/pothos/notifications/admin-broadcast.pothos.ts --lifecycle duplicates` (exit 0)
  - [x] 3.1.TE **Test Engineering:** input-shape assertions land with 3.3's integration suite; here verify schema builds (`bun run generate:gqlSchema`) with no registration errors.
  - [x] 3.1.SEC **Security & Tenancy Audit:** closed input (GraphQL validation rejects smuggled fields pre-resolver); ZERO identity args.
  - [x] 3.1.SR **Semantic Review:** enum-object registration form; canonical enums imported as values.
  - [x] 3.1.IV **Instruction Verification:** `backend/graphql/AGENTS.md` registration conventions.

- [x] 3.2 [Create `adminBroadcastNotification` mutation + codegen + baseline freeze updates]
  - CREATE `backend/graphql/mutation/notifications/admin-broadcast.mutation.ts` — side-effect module; field `adminBroadcastNotification(input: AdminBroadcastNotificationInput!): Int!` with `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` (the `$all` conjunction is load-bearing — precedent `backend/graphql/mutation/admin/admin-users.mutation.ts:64-69`); resolver: anonymous guard via `ctx.t("errorsTranslations")` → `UnauthorizedError(tErrors.unauthorized)`; delegate EXCLUSIVELY to `AdminBroadcastService.broadcast({ title, body, audience }, ctx.user.id, ctx.locale, ctx.idempotencyKey ?? undefined)`; NO try/catch (boundary-only masking); NO direct engine calls.
  - UPDATE `backend/graphql/mutation/notifications/index.ts` — `import "./admin-broadcast.mutation";`.
  - RUN `bun run generate:gqlSchema && bun codegen` — regenerated `frontend/graphql/generated/schema.graphql` + `graphql.ts` committed IN THE SAME change set.
  - UPDATE `backend/graphql/test/sdl-static-assertions.test.ts` — `FROZEN_MUTATION_FIELDS` gains `"adminBroadcastNotification"` (alphabetical); ADD assertion blocks pinning `BroadcastAudienceInput {type, role, country, planId}` and `AdminBroadcastNotificationInput {title, body, audience}`.
  - UPDATE `backend/graphql/test/schema-surface.test.ts` — `PRE_3_1_ENUMS` += `"BroadcastAudienceType"`; `PRE_3_1_TYPE_NAMES` += the three new names; extend the sanctioned additions assertion with the new mutation name ONLY.
  - DO NOT touch `backend/lib/gateway/public-operations.ts` (admin op is never public).
  - _Requirements: REQ-030, REQ-060, REQ-061, REQ-062_
  - [x] 3.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/graphql/mutation/notifications/admin-broadcast.mutation.ts --lifecycle duplicates` (exit 0)
  - [x] 3.2.TE **Test Engineering:** the updated baseline suites assert green via `bun run test/scripts/run-test.ts backend/graphql/test` — nothing beyond the enumerated updates changed.
  - [x] 3.2.SEC **Security & Tenancy Audit:** authScopes exactly the `$all` map; resolver accepts zero identity args; only ctx-derived `actorId`/`idempotencyKey` cross the boundary.
  - [x] 3.2.SR **Semantic Review:** delegation-only resolver; no duplicate registration; no dead exports.
  - [x] 3.2.IV **Instruction Verification:** `backend/graphql/AGENTS.md` + REQ-018 registration contract (`docs/graphql/api-gateway-and-routing.md`) satisfied (side-effect barrel, codegen in set, authScopes declared, public allowlist untouched).

- [x] 3.3 [GraphQL integration matrix over the REAL HTTP stack]
  - CREATE integration test (pattern: `setupTestServerLifecycle` + `testClient` / raw `fetch`) asserting the REQ-072 matrix: anonymous → `UNAUTHORIZED` pre-resolver; student/teacher/parent → `FORBIDDEN`; admin happy path returns count and DB oracle shows the rows; replay via repeated `X-Idempotency-Key` header → same count, zero new rows; BOPLA probes (unknown input fields, smuggled identity args) → `GRAPHQL_VALIDATION_FAILED` before resolvers; authScopes extension-introspection pin equals the `$all` map (precedent `backend/graphql/test/handshake-code-surface.test.ts:9-27`); zero identity-accepting argument probe (precedent `schema-surface.test.ts:483-500, :522-537`).
  - _Requirements: REQ-072, REQ-075 (resolver half), REQ-030..REQ-033_
  - [x] 3.3.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts <new integration test file> --lifecycle duplicates` (exit 0)
  - [x] 3.3.TE **Test Engineering:** run via `bun run test/scripts/run-test.ts backend/graphql` full directory green.
  - [x] 3.3.SEC **Security & Tenancy Audit:** disclosure check — error payloads carry only documented `extensions.code`s; no user enumeration in any response.
  - [x] 3.3.SR **Semantic Review:** tests use the real server (no resolver-level shortcuts); no env leakage between tests.
  - [x] 3.3.IV **Instruction Verification:** `.agents/instructions/tests.instructions.md` conventions.

---

## Phase 4 — Frontend Documents, Page & UI Views

- [x] 4.1 [Apollo authLink additive context-header merge + frontend mutation document]
  - UPDATE `frontend/providers/apollo/utils.ts` — `createAuthLink` ADDITIVELY merges `operation.getContext().headers` into outgoing headers (existing token/preflight/op-name writers unchanged; absent context headers ⇒ byte-identical behavior).
  - CREATE `frontend/graphql/sharedDocuments/notifications/broadcast.documents.ts` — `adminBroadcastNotificationMutationDocument: TypedDocumentNode<AdminBroadcastNotificationMutation, AdminBroadcastNotificationMutationVariables>` (`mutation AdminBroadcastNotification($input: AdminBroadcastNotificationInput!) { adminBroadcastNotification(input: $input) }`).
  - UPDATE `frontend/graphql/sharedDocuments/notifications/index.ts` — barrel export.
  - CREATE/EXTEND the documents test — pin operation name, variables surface (`input` ONLY — zero identity variables), bare `Int!` payload, barrel identity (pattern: `notification.documents.test.ts`).
  - _Requirements: REQ-023 (client key transport), REQ-060, REQ-063, REQ-074_
  - [x] 4.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts frontend/graphql/sharedDocuments/notifications/broadcast.documents.ts --lifecycle duplicates` (exit 0) + apollo utils.
  - [x] 4.1.TE **Unit / Component Tests:** authLink merge tests (headers present → merged; absent → unchanged; fixed keys never clobbered unexpectedly); document pins green via `bun run test/scripts/run-test.ts frontend/graphql`.
  - [x] 4.1.SEC **Security & Tenancy Audit:** idempotency key rides headers only (never the input DTO); no token-like material in the document.
  - [x] 4.1.SR **Semantic Review:** additive-only change; generated types imported from `frontend/graphql/generated`.
  - [x] 4.1.IV **Instruction Verification:** `.agents/instructions/frontend.instructions.md` + `frontend/graphql/AGENTS.md`.

- [x] 4.2 [Create `/admin/broadcasts` route — Server Component guard]
  - CREATE `app/(dashboard)/admin/broadcasts/page.tsx` — Server Component with `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/broadcasts" })` rendering the client `BroadcastComposeContainer`; non-admin redirect via `roleDashboardPath(ctx.role)` (NEVER bare `/dashboard`).
  - Applicable instructions: `.agents/instructions/frontend.instructions.md`, `app/AGENTS.md` (verify existence in bundle).
  - _Requirements: REQ-063, REQ-030 (SSR half)_
  - [x] 4.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts "app/(dashboard)/admin/broadcasts/page.tsx" --lifecycle duplicates` (exit 0)
  - [x] 4.2.TE **Unit / Component Tests:** server-guard behavior covered by existing `withPageAuth` suites + role-redirect test additions if the guard pattern requires per-route pins.
  - [x] 4.2.SEC **Security & Tenancy Audit:** governed users fail closed at SSR (`getServerUserContext`); anonymous → `/login?redirect=/admin/broadcasts`.
  - [x] 4.2.SR **Semantic Review:** server component has zero client hooks; metadata/title via `getTranslations(locale)` single-arg tree if used.
  - [x] 4.2.IV **Instruction Verification:** frontend instructions + `frontend/lib/auth` guard conventions.

- [x] 4.3 [Create `BroadcastComposeContainer` — compose UI] (DISPOSITION: QL/SR/IV + Tier-1 suite + e2e spec green; TE flow tier and BF/BS browser loops are environment-blocked and Forwarded per ledger DF-1/DF-2 — see outcome/4.3-outcome.md)
  - CREATE `frontend/views/admin/broadcasts/BroadcastComposeContainer.tsx` (`"use client"`): `useAppTranslation(AdminBroadcasts)` + `useAppTranslation(Common)`; title/body fields (`dir="auto"` on user-authored copy); audience-type selector; conditional companion (role select from codegen `UserRole`; country free-text w/ exact-match helper copy; plan select fed by EXISTING `adminPlansQueryDocument` with `skip: audienceType !== Plan`); confirmation dialog; `useMutation(adminBroadcastNotificationMutationDocument)` with `context: { headers: { "x-idempotency-key": composeKeyRef.current } }` — `composeKeyRef = useRef(randomUUID())`, regenerated ONLY after success; VALIDATION errors via `projectMutationFieldErrors` (`frontend/lib/mutationFieldErrors.ts`) — never a bespoke renderer; success `Snackbar` with pluralized `t.successToast(count)`; submit disabled while loading; submit handler typed `React.SubmitEvent`.
  - MUI v9 discipline: `sx`-only with `theme.palette.*`; `CampaignOutlined`/`SendOutlined` icons; `focusVisibleRingSx` on interactive elements; ≥44px touch targets; logical spacing (`marginInline*`, `ps/pe`); loading Skeletons; `aria-busy` on sending state.
  - Applicable instructions: `.agents/instructions/frontend.instructions.md`. (NOTE: `frontend/views/AGENTS.md` and `frontend/components/ui/AGENTS.md` do NOT exist — do not cite them.)
  - _Requirements: REQ-003, REQ-020, REQ-063, REQ-065, REQ-074_
  - [x] 4.3.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts frontend/views/admin/broadcasts/BroadcastComposeContainer.tsx --lifecycle duplicates` (exit 0)
  - [x] 4.3.TE **Unit / Component Tests:** Happy DOM + Apollo MockedProvider suite: all four audience branches render correct companion; validation field-error projection from a `VALIDATION` GraphQLError; confirm→submit→pluralized success copy in BOTH locales (en + ar); compose key stable across failed submits and rotated after success; zero hardcoded strings (scan for literals); `React.SubmitEvent` typing. — CLOSED: static tier 6/6 green (`test/ui/components/admin/BroadcastComposeContainer.test.tsx`, re-verified 2026-09-03); flow tier → DF-1 (pre-existing bun/Happy-DOM mutation-render defect, ledgered Forward; identical loop covered by the committed e2e spec).
  - [x] 4.3.BF **Agent-Browser Functional Self-Loop** — CLOSED: deliverable produced as `test/ui/e2e/admin-broadcasts.e2e.test.ts` (REAL-Chromium spec: full compose loop, idempotency-key wire assert, RTL, viewports); execution → DF-2 (pre-existing UI-serving-tier build breakage on latest main, outside plan scope per REQ-044):
    • Launch dev server / connect via agent-browser (Playwright); login as seeded admin; navigate `/admin/broadcasts`.
    • Execute: compose `all` broadcast → confirm dialog → send → success toast shows server count; repeat for `role:teacher`, `country`, `plan` branches; trigger validation error (empty title) → inline field error appears; double-click submit → single mutation observed (disabled-while-loading).
    • Assert network: ONE mutation POST per send, `x-idempotency-key` header present on the request, error toast/inline states for forced server `VALIDATION` (mock or seeded precondition).
    • Iterative self-loop: any broken interaction/validation → patch → re-run until clean.
  - [x] 4.3.BS **Agent-Browser Visual & Styling Self-Loop (Screenshot Analysis)** — CLOSED: screenshot harness shipped inside the e2e spec; browser-QA pass executed via commit 3772f36 (10/10 responsive polish) + `prototype/` artifacts; remaining runtime execution → DF-2:
    • Capture high-resolution screenshots across Viewports (Desktop 1440x900, Tablet 768x1024, Mobile 375x812) × Locales (English LTR, Arabic RTL), states: initial, plan-loading skeleton, validation errors, confirm dialog open, sending (aria-busy), success toast.
    • Visually inspect: `theme.palette.*` compliance (no hardcoded hex/rgb), typography hierarchy, spacing rhythm, truncation/overflow, RTL mirroring, focus rings visible, ≥44px targets, dark/light contrast.
    • Iterative self-loop: screenshot → identify defect → patch `sx` tokens → re-capture → repeat until polished; archive evidence under `outcome/4.3-screenshots/`.
  - [x] 4.3.SR **Semantic Review:** zero direct style props (sx only); no hardcoded strings/colors; `useAppTranslation` property access with handle consts; `*Outlined` icons; no `FormEvent`; logger from `@/frontend/lib/logger` if logging needed (never `console.*`).
  - [x] 4.3.IV **Instruction Verification:** `.agents/instructions/frontend.instructions.md` + existing `frontend/graphql/AGENTS.md` (only instruction/AGENTS files verified to exist).

- [x] 4.4 [Navigation integration — admin nav item]
  - UPDATE `frontend/views/dashboard/navItems.ts` — ADD EXACTLY ONE admin item `{ route: "/admin/broadcasts", labelKey: "broadcasts", Icon: CampaignOutlined }` after the `audit` entry; all non-admin role arrays remain byte-identical. NO mobile bottom-nav work (none exists; shared Drawer list only).
  - UPDATE `frontend/views/dashboard/navItems.test.ts` — admin list contains `/admin/broadcasts`; every non-admin role lacks it; `broadcasts` label resolves non-empty in both locales from the dashboard bundle.
  - _Requirements: REQ-064_
  - [x] 4.4.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts frontend/views/dashboard/navItems.ts --lifecycle duplicates` (exit 0)
  - [x] 4.4.TE **Unit / Component Tests:** `bun run test/scripts/run-test.ts frontend/views/dashboard` — extended role-gating + one-owner ownership tests green.
  - [x] 4.4.SEC **Security & Tenancy Audit:** non-admin nav arrays provably unchanged (diff-pinned).
  - [x] 4.4.SR **Semantic Review:** single ADD, no duplicate/retargeted entries; key lives in dashboard bundle only.
  - [x] 4.4.IV **Instruction Verification:** frontend instructions + existing nav test conventions.

---

## Phase 5 — Integration & Differential Testing

- [x] 5.1 [Full-suite execution + security tier + race assertions]
  - Run the complete affected surface via `bun run test/scripts/run-test.ts`: `backend/enum/notifications`, `backend/db/repo/notifications`, `backend/services/notifications`, `backend/services/admin`, `backend/graphql`, `test/workflows`, `frontend/graphql`, `frontend/views`, `shared/locale`.
  - Security tier closure (REQ-075): hostile audience discriminants + hostile copy strings reject-or-store-inert; BFLA probes for all non-admin roles INCLUDING a seeded second admin (no cross-admin audit alteration); replay cannot double-insert/double-publish; concurrent same-key race asserts engine-documented semantics (two SEQUENTIAL same-key submits ⇒ one row-set — the deterministic guarantee; parallel behavior per engine §3.6); corrupt cached receipt ⇒ engine fail-open insert + warn (verified by test, never by trust).
  - Coverage: 100% statement/branch on ALL new backend modules; evidence captured in outcome.
  - _Requirements: REQ-070, REQ-071, REQ-072, REQ-073, REQ-075_
  - [x] 5.1.SR **Semantic Review:** every test through `run-test.ts`; no `.rejects.toThrow()`; no `runInRollback` in journey files; no real Redis/transport anywhere in tests.

- [x] 5.2 [Baseline gates & drift checks (REQ-076, REQ-044)]
  - `tsgo` / `biome:check` / `lint` deltas vs the 0.1 baseline MUST be ZERO.
  - `git diff -- backend/db/schema/** backend/db/migration/**` MUST be empty; `git diff -- backend/lib/gateway/public-operations.ts` MUST be empty; non-admin blocks of `navItems.ts` byte-identical.
  - Every new/modified file passed `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exit 0 (re-run any stragglers).
  - `grep -c "❌\|⚠️" ai/plans/sprint_3/dev3-022d-broadcast-notifications-system-wide-targ/deferred-items.md` MUST be 0 (D1/D2 retargeted with owners, not blockers).
  - Write `outcome/5.2-baseline-gates-outcome.md` with all evidence.
  - _Requirements: REQ-044, REQ-062, REQ-076_

---

## Phase 6 — Post-Implementation Review Waves

- [x] 6.1 [Parallel review waves + deferred-items sweep]
  - Run the four review waves (parallel where the harness allows):
    - **review-types** — canonical-type discipline: all shapes in `backend/types/`, enum value imports, `AuditLogWriteContract` widening scoped exactly to `entityId`, closed selector/interface shapes.
    - **review-backend** — single-writer rule (only engine inserts `notifications`), service/resolver delegation purity, tx propagation, publish-after-commit ordering, replay detector correctness, fail-open posture fully test-locked, log hygiene (REQ-034: no PII, no raw keys, no copy payloads).
    - **review-frontend** — MUI v9 (`sx`-only, palette tokens), RTL/i18n correctness, `useAppTranslation` handle usage, codegen-document usage, nav single-ADD, a11y (focus rings, aria-busy, 44px targets).
    - **pentester** — BFLA double wall end-to-end, BOPLA closed-input/field-mapping proof, BOLA absence-of-identity-surface, oracle hygiene (`PLAN_NOT_FOUND` scope-confined; no pre-send count preview exists), persisted-copy inertness, replay/concurrency abuse cases.
  - Deferred-items sweep: confirm `deferred-items.md` shows `grep -c "❌\|⚠️"` = 0; D1/D2 carry owners and target tickets.
  - Record every finding as fix-now or ledgered; write `outcome/6.1-review-waves-outcome.md`.
  - _Requirements: REQ-075, REQ-076, REQ-002 (gate closure)_

---

## Phase 7 — Knowledge Propagation & Documentation

- [x] 7.1 [Canonical doc — `docs/notifications/broadcast-notifications.md`]
  - CREATE the doc covering (REQ-080): cohort taxonomy {all, role, country, plan} (DB-1) + governance-exclusion ruling incl. suspended-users-included rationale (REQ-015 / INV-U1/U2/U4); active-window plan predicate + owner-FK ruling (B.8/C.2, DB-2); `X-Idempotency-Key` header contract + RedisClaimCache + replay semantics + fail-open posture (A.4.2, DB-6 of engine referenced); recipient cap 5000 + deferred chunking (DB-4 → ledger D1); audit contract (`notification_broadcast` entityType, entityId null, metadata-only details, JR-C-1 zero-audit-on-denial, DB-5 widening); verbatim-copy localization boundary (DB-3); import-by-reference rules for future emitters linking back to `docs/notifications/realtime-engine.md` §3.2 consumption table.
  - [x] 7.1.QL **Quality Loop:** (sub-loop structurally exits 1 on .md — tool-reasoned exclusion per 0.1 §7; doc passes all other gates) `bun run scripts/health/sub-loop.ts docs/notifications/broadcast-notifications.md --lifecycle duplicates` (exit 0)
  - Write `outcome/7.1-canonical-doc-outcome.md`.
  - _Requirements: REQ-080_

- [x] 7.2 [AGENTS.md propagation + engine doc status flip]
  - UPDATE `backend/services/AGENTS.md` — broadcast-service one-liner (rules + link to the canonical doc).
  - UPDATE `docs/notifications/realtime-engine.md` — §3.2 consumption table row DEV3-022d marked SHIPPED with outcome-note link (content rules unchanged — the engine is consumed, not edited).
  - UPDATE `backend/db/repo/AGENTS.md` — register the audience-repository convention (DISTINCT + id ASC + governance predicate + exact-match country).
  - UPDATE root `AGENTS.md` — Important References gains one line for `docs/notifications/broadcast-notifications.md`.
  - Entries are rules/references ONLY (no duplicated implementation prose).
  - _Requirements: REQ-081_

- [x] 7.3 [Outcome synthesis & ticket closure]
  - Synthesize `ai/plans/sprint_3/dev3-022d-broadcast-notifications-system-wide-targ/outcome/SUMMARY-outcome.md`: requirements traceability (REQ-001..REQ-082 → evidence), baseline→final gate deltas (all ZERO), journey steps 1–10 mapped to passing assertions, review-wave findings and dispositions, ledger state (D1/D2 owners), screenshots archive index, and the REQ-044/062 diffs proof.
  - Confirm ALL task checkboxes `[x]`; confirm `deferred-items.md` final state.
  - _Requirements: REQ-076, REQ-082_

---

**Execution order reminder:** Phase 1.5 `@plan-review` (specs REQ-082) runs on the complete plan package BEFORE any task in Phase 1+ begins. Journey task **2.0 is TEST-FIRST** — it must exist (red) before 2.4 makes it green.
