# Requirements & Specification: DEV3-022d — Broadcast Notifications (System-Wide & Targeted)

> **Plan directory (verbatim):** `ai/plans/sprint_3/dev3-022d-broadcast-notifications-system-wide-targ`
> **Ticket:** DEV3-022d — Broadcast Notifications (System-Wide & Targeted) · Dev 3 · Sprint 3 · 3 SP · Blocked by DEV3-010 (shipped)
> **Governing sources:** `docs/specs/open-decisions-and-gaps.md` (A.4, A.4.1–A.4.3, A.5, A.7, B.8/C.2) · `docs/specs/state-machine-invariants.md` (INV-U1..U5, no new INV minted) · `docs/workflows/05-admin-governance-override.md` (§2 state machine `Notification_Broadcast`, §7.2 audit list) · `docs/notifications/realtime-engine.md` (§3.2 consumption table row DEV3-022d, REQ-010/011/012/013/015/027/028, deferred items D1–D9) · `docs/admin/user-management.md` (guarded patterns, JR-C-1, scope-split) · `docs/graphql/api-gateway-and-routing.md` (REQ-018 registration contract) · `docs/IDEMPOTENCY.md` (fail-closed booking posture this feature deliberately does NOT inherit — see §3)

---

## 1. Executive Summary & Problem Statement

**Feature:** A Super Admin composes an announcement and the platform materializes one `notifications` row of type `system_broadcast` per recipient — system-wide, or targeted to a cohort (all teachers / all students / all parents / all users in a country / all users with an active subscription to a specific plan) — and pushes it in real time to every online recipient. This ticket is the `system_broadcast` *emitter* that `docs/notifications/realtime-engine.md` §3.2 explicitly assigns to DEV3-022d: **the engine ships the bulk primitive (`emitForUsers`); cohort resolution is this ticket's obligation** (engine REQ-027 — the engine never resolves roles or all-users).

**Problem from user perspective:**
- **Super Admin:** today there is no way to announce maintenance windows, plan changes, or platform news. He must either stay silent or abuse a per-user manual path that does not exist. He needs: compose once → choose cohort → confirm → every intended inbox (and every online socket) receives it exactly once, and the action is on the audit trail.
- **Student / Teacher / Parent:** receives platform announcements in the same inbox (`myNotifications`) and realtime toast lane he already knows — and NEVER receives announcements aimed at another cohort (no cross-cohort leakage).
- **Platform integrity:** a double-submitted admin form must not duplicate thousands of rows; a non-admin must never reach the broadcast write path; the quiet "who got what" question must be answerable from `audit_logs`.

**Business value:** Broadcasts are the last unimplemented notification type in the frozen 7-member `NotificationType` enum (`backend/enum/notifications/notification-type.enum.ts:5-13`) and a named Workflow 05 capability ("Notification_Broadcast" in the admin governance state machine; audit-listed in §7.2). It completes the notification surface for M3 and is a production-readiness gate item (admin governance pillars).

**Actors involved:**
- **Super Admin (caller):** composes and fires; identity from `ctx.user.id` only.
- **Students / Teachers / Parents / other Admins (recipients):** passive observers of persisted inbox rows + realtime pushes.
- **Downstream consumers:** the existing inbox queries (`myNotifications`, `myUnreadNotificationCount`) and the WS sidecar consume the rows/envelope this ticket produces — NO changes to those consumers.

**Non-goals (explicitly OUT of scope):**
- No changes to the notification engine internals, inbox queries/mutations, WS sidecar, transports, or fan-out envelope shape. The engine is consumed, never edited.
- No editing/deletion of emitted notifications; no broadcast history browse UI (the audit trail IS the record — REQ-021; a read-back UI is DEV3-020's audit surface).
- No scheduled/recurring broadcasts, no email/SMS/push channels (inbox + realtime socket only, per the engine's scope).
- No per-recipient locale routing of copy: broadcasts are **admin-authored free text** (not translation keys), so the same `title`/`body` is stored verbatim for every recipient. This is the documented localization-at-emitter boundary (engine REQ-015/028) — there is nothing to localize at emit time. Recorded explicitly as decision DB-3 in §3.
- No user-preference/opt-out model for announcements (system announcements are mandatory-delivery by design; a preferences layer is the engine's deferred item D4, untouched here).
- No schema changes: `notifications`, `users`, `subscriptions`, `plans` already carry every column this ticket reads (anchor: `backend/db/schema/notifications/notifications.ts:27-46`, `backend/db/schema/billing/subscriptions.ts:19-42`). `git diff` on `backend/db/schema/**` MUST be empty.
- No chunked mega-broadcast mode: cohorts above the documented recipient cap are rejected (REQ-017); chunked emission is deferred (see §3 DB-4).
- No new WebSocket/Subscription surface (`Subscription` root remains absent — `docs/graphql/api-gateway-and-routing.md` "No WebSocket/subscription transport" rule).

---

## 2. Requirements & Acceptance Criteria (EARS Format)

### 2.1 Baseline & Foundational Preparation (MANDATORY)

- **REQ-001 (Pre-Implementation Baseline & Ledger):** WHEN implementation begins THEN the executing agent SHALL record baseline error counts (`tsgo`, `biome:check`, `lint-service`) AND initialize `ai/plans/sprint_3/dev3-022d-broadcast-notifications-system-wide-targ/deferred-items.md` from `.agents/spec-process-guide/templates/deferred-items-template.md` AND write `outcome/0-baseline-outcome.md` capturing the counts and `git diff --name-only` snapshot.
- **REQ-002 (Reuse — Never Rebuild the Engine):** WHEN domain work starts THEN the agent SHALL verify and NOT reimplement: `NotificationEngine.emitForUsers` (`backend/services/notifications/notification-engine.service.ts:393`), `publishReceipts` (`notification-engine.service.ts:475`), `validateEmitBatchInput` (`backend/services/notifications/emit-validation.ts:135`), the claim-cache port + `buildEmitClaimKey`/`attemptEmitClaim`/`storeEmitReceiptQuietly` (`backend/services/notifications/emit-idempotency.ts:67,84,112`), `NotificationRepository.createManyReturning` (`backend/db/repo/notifications/notification.repository.ts:148`), `AuditService.createAuditLog` (`backend/services/admin/audit.service.ts:82`), `assertActorAdmin` (`backend/services/admin/user-management.service.ts:240-271` — the `assertActorAdmin` span), `PlanRepository.existsById` (`backend/db/repo/billing/plan.repository.ts:109`), the active-subscription predicate (`backend/db/repo/admin/admin-user.repository.ts:337-346`, the `studentHasActiveSubscriptionSubquery` helper), and `withTransaction` (`with-transaction`, consumed at `user-management.service.ts:67`). IF any required artifact is missing THEN the agent SHALL record a ❌ entry in `deferred-items.md` and block — NEVER write `notifications` rows outside the engine (engine REQ-010 single-writer).
- **REQ-003 (Type-Safe i18n & Enum Value Imports Compliance):**
  - Client components MUST use `useAppTranslation(<NamespaceHandle>)` with `defineNamespace` handles (e.g. `AdminBroadcasts`, `Common`, `Errors`) and property access — never string literals, never a `Translation` enum (it does not exist), never `t('key')`.
  - Server components MUST use `getTranslations(locale)` (single argument, full `Translations` tree) and property access.
  - GraphQL resolvers MUST use `ctx.t("namespace")` (e.g. `ctx.t("errorsTranslations")` for the localized `unauthorized`).
  - All enums (`UserRole`, `NotificationType`, `AuditActionType`, `BroadcastAudienceType`) used at runtime MUST be value imports; enum members, never raw string literals.
- **REQ-004 (Canonical Types Discipline):** WHEN any code is authored THEN all new shapes SHALL live in `backend/types/notifications/broadcast.types.ts` (`BroadcastAudienceType` companion input `BroadcastAudienceSelector`, `BroadcastNotificationSubmitInput`) — NO local types in Pothos files, NO service-layer `.types.ts` files, and runtime-only artifacts (helpers) stay in non-`.types` files ("Nothing assertion-relevant gets defined outside `backend/types/`").

### 2.2 Core Feature Logic / Happy Paths (REQ-010 .. REQ-029)

- **REQ-010 (Audience Taxonomy):** WHEN the system accepts a broadcast THEN the audience SHALL be EXACTLY one of the four cohort kinds encoded in a new backend enum `BroadcastAudienceType { All="all", Role="role", Country="country", Plan="plan" }` (`backend/enum/notifications/broadcast-audience-type.enum.ts` + fail-closed `isBroadcastAudienceType` guard, mirroring `isNotificationType` at `backend/enum/notifications/notification-type.enum.ts:21-23`). IF a selector carries a companion field not matching its kind (e.g. `role:` without `Role`) or omits the required companion field THEN the service SHALL reject pre-DB with a localized `ValidationError` (`BROADCAST_AUDIENCE_INVALID`).
- **REQ-011 (System-Wide Cohort):** WHEN the audience is `all` THEN resolution SHALL target every `users` row that passes the governance filter of REQ-015.
- **REQ-012 (Role Cohort):** WHEN the audience is `role` with `role ∈ UserRole` THEN resolution SHALL target governed-eligible users whose `users.role = <member>`; any of the four roles (including `admin`) is a legal target.
- **REQ-013 (Country Cohort):** WHEN the audience is `country` THEN resolution SHALL match `users.country` by EXACT equality (`eq`) — trimmed, non-empty, ≤100 chars. NO LIKE/ILIKE surface exists anywhere in this feature; therefore the LIKE-wildcard sanitizer is N/A by construction (the `escapeLikeWildcards` mandate applies only to LIKE surfaces — none here).
- **REQ-014 (Plan-Subscriber Cohort):** WHEN the audience is `plan` with `planId` THEN resolution SHALL target governed-eligible users holding a subscription to that plan that is active NOW per the canonical predicate — `status = 'active' AND now() >= coalesce(start_date, now()) AND (end_date IS NULL OR now() < end_date)` — reused verbatim from `admin-user.repository.ts:337-346`, evaluated on `subscriptions.user_id` (the generic owner FK per decision B.8/C.2 — a teacher's verification-plan subscription and a student's Hifz subscription are both in scope). IF `planId` is not a positive safe integer THEN reject pre-DB with `ValidationError`; IF the plan row does not exist THEN reject with localized `NotFoundError("PLAN", …)` → `PLAN_NOT_FOUND` (via `PlanRepository.existsById`, `plan.repository.ts:109`).
- **REQ-015 (Governance-Exclusion Predicate):** WHEN ANY cohort resolves THEN the recipient set SHALL exclude users with `is_deleted = true` OR `is_blocked = true` (NULL-safe: legacy NULL rows are eligible) and SHALL INCLUDE suspended users. Rationale (binding, documented in the canonical doc): `INV-U4/INV-U1` forbid touch/interaction for deleted accounts and `blocked` accounts "cannot access the platform" (`docs/specs/state-machine-invariants.md` §6 states table); a SUSPENDED user's window can lapse (INV-U2 blocks session REQUESTS only, never inbox reads), so parked rows are correct and self-heal.
- **REQ-016 (Deterministic Dedupe & Order):** WHEN a cohort resolves THEN the id list SHALL be de-duplicated (a plan cohort joins `subscriptions` — DISTINCT is mandatory) and ordered `id ASC`, so engine claim digests (which sort internally, `emit-idempotency.ts:67-71`) and test assertions are deterministic.
- **REQ-017 (Recipient Cap — Fail-Closed):** WHEN a resolved cohort exceeds `BROADCAST_MAX_RECIPIENTS = 5000` THEN the service SHALL reject with `ValidationError("BROADCAST_AUDIENCE_TOO_LARGE", <localized>)` BEFORE any insert (the cap keeps the single `createManyReturning` statement under PostgreSQL's 65 535-parameter ceiling and the single fan-out envelope bounded; chunked emission is deferred — §3 DB-4).
- **REQ-018 (Empty Cohort):** WHEN a cohort resolves to ZERO recipients THEN the service SHALL reject with `ValidationError("BROADCAST_AUDIENCE_EMPTY", <localized>)` and perform ZERO writes (the engine's batch contract forbids empty lists — `emit-validation.ts:137` — so the service must fail first with an honest, localized reason).
- **REQ-019 (Single-Writer Emission Composition):** WHEN a broadcast is accepted THEN the ONLY write path SHALL be `NotificationEngine.emitForUsers` invoked with `type: NotificationType.SystemBroadcast` and `relatedEntityType: null, relatedEntityId: null` (strict co-presence rule, `emit-validation.ts:86-98` (the `validateEntityRef` co-presence helper)); NO file in this ticket may write the `notifications` table directly, and NO resolver may invoke engine emit primitives directly (engine REQ-010/§4 static-scan rule) — the mutation resolver delegates exclusively to the new `AdminBroadcastService`.
- **REQ-020 (Copy Is Admin-Authored, Stored Verbatim):** WHEN copy is submitted THEN `title` SHALL be trimmed, non-empty, ≤255 chars, and `body` SHALL be a nullable string; the engine SHALL receive the trimmed title/body verbatim (the engine never translates/templatizes — REQ-015/028 of the realtime doc); localized `ValidationError` codes apply: `BROADCAST_TITLE_INVALID`.
- **REQ-021 (One Transaction: Inserts + Audit Row):** WHEN the emission executes THEN the notification inserts AND exactly ONE `audit_logs` row SHALL commit or roll back atomically inside ONE `withTransaction(outerTx, tx)` block: `entityType: "notification_broadcast"`, `actionType: AuditActionType.Create`, `actorId = ctx.user.id` (NEVER from input), `details` = capped JSON metadata only (`{ scope, role?, country?, planId?, recipientCount }` — NEVER the copy text, NEVER PII). Denial paths (REQ-030 gate failure, validation failures, empty/oversized cohorts, replays per REQ-023) SHALL append ZERO audit rows (JR-C-1 per `docs/admin/user-management.md` §2.4). Elevating `AuditLogWriteContract.entityId` from `number` to `number | null` (a broadcast has no single entity) is the sanctioned additive widening this ticket performs, recorded as governed-contract change §3 DB-5; `audit_logs.entity_id` is already nullable (`backend/db/schema/audit/audit-logs.ts:39`).
- **REQ-022 (Publish-After-Commit):** WHEN the transaction commits THEN and only THEN SHALL the service call `NotificationEngine.publishReceipts([receipt], locale, { transport, cache })` — the caller-tx receipt composition in engine §3.2 — producing exactly ONE fan-out envelope carrying the FULL recipient list (engine REQ-013; the representative-id ruling is inherited unchanged). IF the publish fails THEN the rows AND audit entry remain committed and the failure degrades to the engine's structured `NOTIFICATION_DELIVERY_DEGRADED` log while the mutation still succeeds (correctness-of-record beats liveness).
- **REQ-023 (Idempotent Emission — Header Key + Claim Cache):** WHEN the admin client submits THEN the UI SHALL mint one UUID v4 per compose-session and send it as the `X-Idempotency-Key` header; the resolver SHALL pass the gateway-captured `ctx.idempotencyKey` (declared at `backend/graphql/gqlContextFactory.ts:72`, captured exactly once at `:181`; propagation-only, never auth-relevant) into the engine input's `idempotencyKey`. WHEN the engine runs THEN claiming SHALL go through the injected cache port: this ticket ships `RedisClaimCache` (`backend/services/notifications/redis-claim-cache.ts`, an `ioredis`-backed `NotificationIdempotencyClaimCache` using `SET … NX EX`) plus a stateless `resolveBroadcastClaimCache()` factory that returns `undefined` when no `REDIS_URL` is configured (hermetic default ⇒ engine's documented fail-open-with-one-warn posture; engine §3.6).
  - WHEN a duplicate submission arrives with the same key THEN the engine SHALL return the stored prior receipt, the service SHALL detect the replay structurally — a replayed receipt carries NO `emitClaimKey` while a fresh caller-tx receipt always carries one when key+cache are live — and the service SHALL return the prior recipient count while writing ZERO new rows, ZERO new audit rows, and issuing ZERO new publishes (no duplicate fan-out for a duplicate submit).
  - WHEN no cache is configured or the cache degrades THEN emit proceeds fail-open with the engine's single `NOTIFICATION_IDEMPOTENCY_DEGRADED` warn (documented deviation; engine D5/§3.6) — a cache blip never blocks an admin announcement.
  - IF a cached receipt is corrupt/unreadable THEN the engine SHALL fail open (insert + warn) per `emit-idempotency.ts:90-96` — verified by test, never by trust.
- **REQ-024 (Injection Seams for the Journey Layer):** WHEN the service is invoked THEN it SHALL accept an optional trailing options object `{ transport?, cache? }` passed through to the engine — the journey layer installs `SpiedFanoutTransport` and a scripted claim cache; production resolvers pass nothing and get the env-resolved defaults.

### 2.3 Security, Authorization & Tenancy

- **REQ-030 (BFLA — Admin-Only Gate, Double Walled):** WHEN `adminBroadcastNotification` is invoked THEN the Pothos field SHALL carry `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` — the explicit `$all` conjunction is load-bearing (anonymous → `UNAUTHORIZED`, authenticated non-admin → `FORBIDDEN` pre-resolver; precedent `backend/graphql/mutation/admin/admin-users.mutation.ts:64-69` and its documented rationale in `docs/admin/user-management.md` REQ-030/D10) — AND the service SHALL re-verify the actor is a real admin row-by-row via a shared defense-in-depth assertion (the `assertActorAdmin` discipline extracted from `user-management.service.ts:240-271` into a shared admin helper this ticket introduces; anonymous `actorId = 0` → `UnauthorizedError`, missing/non-admin row → `ForbiddenError`, BOTH pre-transaction with zero writes/audit).
- **REQ-031 (BOLA / IDOR — No Identity Surface):** WHEN the mutation executes THEN the ONLY identity input SHALL be the verified context: the mutation takes NO caller/role/entity identity arguments beyond the content/audience input; there is no parameter by which any user can read or mutate another user's inbox; recipients observe only their own row through the existing self-scoped inbox (foreign rows unreachable — the `markReadOnce` owner-pair guard at `notification.repository.ts:269-280` is unchanged).
- **REQ-032 (BOPLA — Closed Whitelist):** WHEN input maps to service/DB THEN the service SHALL map FIELD-BY-FIELD (`title`, `body`, `audience.type`, `audience.role`, `audience.country`, `audience.planId`) — NEVER `{ ...input }`; transport-smuggled fields are ignored by construction; no governance flag, balance, id, or timestamp is reachable from the client.
- **REQ-033 (Oracle Hygiene):** WHEN denials fire THEN they SHALL disclose nothing beyond the documented codes: unknown `planId` on an admin-only surface → `PLAN_NOT_FOUND` (admin-scope oracle ruling per `docs/admin/user-management.md` REQ-032/D11 — legitimate here BECAUSE the surface is admin-gated; this ruling MUST NOT be copy-pasted to any non-admin surface); audience sizes are NEVER disclosed pre-send (no count-preview query exists by design — REQ-063); the error channel never enumerates matching users.
- **REQ-034 (PII & Secret Hygiene):** WHEN anything is logged THEN `logger.logDomainError` SHALL carry `{ code, entity: "notifications"|"plans", entityId?, locale }` — NEVER recipient lists, NEVER copy payloads, NEVER the raw idempotency key (only the engine's SHA-256 digest ever persists, `emit-idempotency.ts:67-71`); audit `details` carries metadata only (REQ-021); `console.*` is forbidden everywhere.
- **REQ-035 (Rate-Limit Posture — Documented, Unchanged):** WHEN this mutation ships THEN it SHALL inherit the existing fail-open limiter stub unchanged; admin-only, low-frequency — no NEW rate-limit surface is added (mirroring the handshake-discovery ruling in `docs/parents/handshake-code-discovery.md` R6: real throttling belongs to the future rate-limiting hardening stream).

### 2.4 Atomicity, Concurrency & Data Integrity

- **REQ-040 (Single Atomic Unit):** WHEN the insert batch, audit row, and claim coexist THEN they SHALL share the service's one `withTransaction` scope (SAVEPOINT under test); a forced insert failure SHALL leave ZERO `notifications` rows AND ZERO `audit_logs` rows (rollback proof); the RECEIPT STORE and fan-out publish SHALL NEVER occur before commit (REQ-022).
- **REQ-041 (Concurrent Double-Submit):** WHEN two concurrent identical broadcasts race with the same `X-Idempotency-Key` and the claim cache is live THEN exactly ONE winner SHALL claim AND exactly one row-set SHALL exist; the loser SHALL observe the stored receipt after the winner commits OR, failing open on an in-flight claim, insert its own — the engine's documented residual. The deterministic guarantee under test: TWO SEQUENTIAL same-key submits yield one row-set; concurrent race behavior follows the engine's documented semantics (`docs/notifications/realtime-engine.md` §3.6) and is asserted as such.
- **REQ-042 (tx Propagation):** WHEN any repository/service call participates THEN `tx` SHALL propagate to EVERY repo/engine call (incl. the audience resolution read, the engine emit, and the audit write); mixing `tx` writes with global-`db` reads inside the unit is PROHIBITED; the audience read itself is idempotent and MAY run outside the write tx at the service's discretion but all writes share one tx.
- **REQ-043 (No Prepared-Statement/Neon Pitfalls):** WHEN repo methods are authored THEN the batch insert SHALL flow through Drizzle `.values([...])` (never `sql.placeholder` for arrays — `backend/db/repo/AGENTS.md` inArray/prepared prohibition), NO inline `--` comments inside `sql` templates, and reads SHALL follow the `queryDb(tx)`/tx-branch pattern established by `notification.repository.ts`.
- **REQ-044 (Schema-Drift Prohibition):** WHEN implementation completes THEN `git diff` for `backend/db/schema/**` and `backend/db/migration/**` SHALL be EMPTY (all reads reuse existing columns; the `system_broadcast` enum value already exists — `backend/db/schema/enums.ts:61`).

### 2.5 Validation & Error Contracts

- **REQ-050 (DomainError Discipline):** WHEN any rejection fires THEN it SHALL be a `DomainError` subclass with a documented `extensions.code`, per `docs/graphql/domain-error-extensions-code.md`. Full taxonomy for this feature:
  
  | Code | Producer | i18n key (errors namespace) |
  |---|---|---|
  | `UNAUTHORIZED` | scope `authenticated` (anonymous) | `unauthorized` (existing) |
  | `FORBIDDEN` | scope `role` / service re-check (non-admin) | `forbidden` (existing) |
  | `VALIDATION` + custom `BROADCAST_TITLE_INVALID` / `BROADCAST_AUDIENCE_INVALID` / `BROADCAST_AUDIENCE_EMPTY` / `BROADCAST_AUDIENCE_TOO_LARGE` | `ValidationError(code, message)` overload (`backend/lib/errors.ts:65-129` — the (code, message) overload is at :78-91) | NEW keys `broadcastTitleInvalid`, `broadcastAudienceInvalid`, `broadcastAudienceEmpty`, `broadcastAudienceTooLarge` in `shared/locale/{types,en,ar}/errors/` (flat, domain-prefixed — the `ErrorsLabels` flat-with-sanctioned-groups shape of `shared/locale/types/errors/index.ts`) |
  | `PLAN_NOT_FOUND` | `NotFoundError("PLAN", …)` auto-generation (unknown plan id) | existing `planCatalog.planNotFound` (`shared/locale/en/errors/index.ts:23`) |
  | `NOTIFICATION_DELIVERY_DEGRADED` / `NOTIFICATION_IDEMPOTENCY_DEGRADED` | engine-side structured warns (never thrown to the client) | n/a (log-only, engine-owned keys) |

- **REQ-051 (Localized Messages Only):** WHEN any message is produced THEN it SHALL resolve through compile-time i18n; the four NEW error keys SHALL be registered in BOTH `ar` and `en` (parity enforced by the existing ar/en mirror suite), and all NEW UI copy SHALL live in a NEW namespace `AdminBroadcasts` (handle `AdminBroadcasts = defineNamespace<AdminBroadcastsLabels>("adminBroadcasts.adminBroadcasts", t => t.adminBroadcastsTranslations)`) registered per the `shared/AGENTS.md` checklist (types + ar + en + `Translations` interface entry in `shared/locale/types/message.ts` + both `messages.ts` bundles + `shared/locale/namespaces/index.ts` registry + a dedicated `adminBroadcasts-namespace.parity.test.ts` pinning the key set).
- **REQ-052 (Logging Discipline):** WHEN expected rejections occur THEN exactly ONE `logger.logDomainError` per rejection with the structured context of REQ-034; happy paths (including replays and governance-filtered resolutions) SHALL log NOTHING; unexpected internals SHALL bubble uncaught to the GraphQL masking boundary (no resolver try/catch — boundary-only masking per `backend/graphql/AGENTS.md`).

### 2.6 GraphQL & Frontend Contracts

- **REQ-060 (Mutation Signature):** WHEN the schema is built THEN the surface SHALL be EXACTLY:
  ```graphql
  adminBroadcastNotification(input: AdminBroadcastNotificationInput!): Int!
  ```
  returning the persisted recipient count; input `AdminBroadcastNotificationInput { title: String!, body: String, audience: BroadcastAudienceInput! }`; `BroadcastAudienceInput { type: BroadcastAudienceType!, role: UserRole, country: String, planId: Int }` (type-discriminated companion fields; service enforces coherence per REQ-010); NO identity args anywhere.
- **REQ-061 (Enum & Input Registration):** WHEN types are registered THEN `BroadcastAudienceTypePothosEnum` SHALL be registered ONCE in `backend/graphql/pothos/shared/enum.pothos.ts` via the enum-object form from the canonical TS enum (NEVER a `values:[...]` literal — gate A2 of `backend/lib/gateway/static-assertions.test.ts`), the input types SHALL live in `backend/graphql/pothos/notifications/admin-broadcast.pothos.ts`, the mutation in `backend/graphql/mutation/notifications/admin-broadcast.mutation.ts`, and the generator SHALL be re-run (`bun run generate:gqlSchema && bun codegen`) with regenerated artifacts committed IN THE SAME change set. The public-operations allowlist (`backend/lib/gateway/public-operations.ts`) is UNTOUCHED (admin op is never public).
- **REQ-062 (Baseline Freeze Updates — Sanctioned, Enumerated):** WHEN the new field lands THEN the following DESIGNED-FOR-UPDATE baselines SHALL be extended, not bypassed: `FROZEN_MUTATION_FIELDS` in `backend/graphql/test/sdl-static-assertions.test.ts` (adds `adminBroadcastNotification`), the mutation inventory assertion in `backend/graphql/test/schema-surface.test.ts`, and the committed `frontend/graphql/generated/schema.graphql` + `graphql.ts`. Nothing else in those suites may change; the notification read-latch surfaces (`markNotificationRead*`) are unchanged.
- **REQ-063 (Frontend Document & Compose Page):** WHEN the frontend consumes the surface THEN the document SHALL be `adminBroadcastNotificationMutationDocument` in `frontend/graphql/sharedDocuments/notifications/` (barrel-wired), transactions SHALL flow through `useMutation` (never `useLazyQuery`-class patterns), and the page SHALL be a NEW route `/admin/broadcasts` — Server Component page guarded by `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/broadcasts" })` (pattern: `frontend/lib/auth/withPageAuth.ts`) rendering a client `BroadcastComposeContainer` (`frontend/views/admin/broadcasts/`) with: title/body fields, audience-type selector, conditional companion field (role select from the `UserRole` codegen enum / country free-text with exact-match helper copy / plan select fed by the EXISTING `adminPlansQueryDocument`), a confirmation dialog, and a success toast carrying the server-returned recipient count via a pluralized `AdminBroadcasts` label function (Arabic plural-branch precedent: `notificationsAr.markAllResult`, `shared/locale/ar/notifications/index.ts:23-29`).
- **REQ-064 (Navigation Integration):** WHEN the page ships THEN the admin nav in `frontend/views/dashboard/navItems.ts` SHALL gain EXACTLY ONE new item (`/admin/broadcasts`, `CampaignOutlined` icon, `labelKey: "broadcasts"` → NEW `broadcasts` key on `DashboardLabels` + both locale maps). There is NO existing ComingSoon nav entry to retarget (verified: `navItems.ts:126-135` admin list contains dashboard/notifications/users/teachers/students/plans/audit/profile — no broadcast entry, no ComingSoon entry) — this is an ADD, and non-admin role arrays SHALL remain byte-identical (the role-gating tests in `navItems.test.ts` keep proving other roles never see it). No mobile bottom-nav work exists in this codebase — the temporary-Drawer mobile nav needs no change beyond the shared list.
- **REQ-065 (MUI v9 / RTL / A11y Discipline):** WHEN UI is authored THEN all styling SHALL be `sx`-only with `theme.palette.*`, `*Outlined` icons, `focusVisibleRingSx` on interactive elements, ≥44px touch targets, `dir="auto"` on user-authored copy surfaces, and the form SHALL surface `VALIDATION` field errors through the existing `mutationFieldErrors` projection (`frontend/lib/mutationFieldErrors.ts`) — never a bespoke error renderer (the global `GraphQLErrorSurfaceHost` owns toasts per `docs/graphql/error-handling-contract.md` §4).

### 2.7 Test Coverage

- **REQ-070 (Repo & Service 4-Tier Tests):** WHEN repo/service tests run (`runInRollback`, `tx` everywhere, `expectRepoError` try/catch — NEVER `.rejects.toThrow()`, `entity-setup.ts` helpers only) THEN they SHALL cover: cohort resolution per kind incl. governance exclusion and DISTINCT dedupe (plan cohort with a user → 2 subscriptions→1 row), exact-match country, repository boundary/order behavior, and 100% statement/branch coverage on ALL new backend code.
- **REQ-071 (Service Behavior Matrix):** WHEN `AdminBroadcastService.broadcast` tests run THEN they SHALL prove: happy path per cohort kind (rows + ONE audit row + receipt), deny paths (anonymous → UNAUTHORIZED; non-admin → FORBIDDEN; zero audit rows), validation matrix (bad title, mismatched companions, unknown/missing plan, empty cohort, oversized cohort), replay path (same key → identical count, zero new rows/audit/publish), cache-outage fail-open (insert + ONE warn), forced-insert rollback (zero residuals), `tx` propagation, content verbatim storage (unicode/RTL/injection-shaped copy stored inert), and NO logging on happy paths.
- **REQ-072 (GraphQL Integration Matrix):** WHEN integration tests run over the REAL HTTP stack (`setupTestServerLifecycle` + `testClient` / raw `fetch` with `X-Idempotency-Key`) THEN they SHALL assert: anonymous → UNAUTHORIZED pre-resolver; student/teacher/parent → FORBIDDEN; admin happy-path returns the count and rows exist (DB oracle); header-key replay returns the same count with zero new rows; BOPLA probes (unknown input fields, smuggled identity args) die as `GRAPHQL_VALIDATION_FAILED` before any resolver; the authScopes declared on the field are exactly the `$all` map (extension-introspection pin, precedent `backend/graphql/test/handshake-code-surface.test.ts:9-27`).
- **REQ-073 (Journey — TEST-FIRST, Cross-Actor):** BEFORE the service surface exists, the journey `test/workflows/notifications/admin-broadcast.journey.test.ts` SHALL be authored per `docs/testing/workflow-journey-tests.md` (committed fixtures in `beforeAll`, hard-delete mandate in `afterAll`, NO `runInRollback`, honest authorization via REAL admin/role rows, `SpiedFanoutTransport` at the injection seam) and SHALL encode every step of §2.9 — including the cross-actor inbox assertions (a teacher sees the role-cohort broadcast in HIS OWN `NotificationEngine.listMyNotifications` read while a student's inbox stays byte-identical).
- **REQ-074 (Frontend Document, Namespace & Component Tests):** THEN the shared-document test SHALL pin operation name/variable surface/Int payload (pattern `notification.documents.test.ts`), the NEW `adminBroadcasts-namespace.parity.test.ts` SHALL pin ar/en key parity + plural-function output, the errors-namespace parity SHALL keep passing with the four new keys present in both locales, and the Happy DOM component suite SHALL cover: all audience-kind branches, validation field-error projection, confirm→submit→pluralized success copy in BOTH locales, and zero hardcoded strings.
- **REQ-075 (Security Tier):** THEN fuzz/class probes SHALL prove: hostile audience discriminants and hostile copy strings reject or store inertly pre-DB; BFLA probes for all non-admin roles INCLUDING a seeded second admin cannot alter another admin's audit trail; replay cannot double-insert or double-publish; and the resolver exposes ZERO identity-accepting argument (validate() probes, precedent `schema-surface.test.ts:483-500, :522-537` — identity-arg probes; BOPLA validate-probes at :625-636).
- **REQ-076 (Baseline Gates):** WHEN the ticket completes THEN `tsgo`/`biome`/`lint` deltas vs the REQ-001 baseline SHALL be ZERO, every new/modified file SHALL pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exit 0, and `grep -c "❌\|⚠️"` on `deferred-items.md` SHALL be 0 (deferred items D-entries are resolved or retargeted with an owner).

### 2.8 Documentation & Knowledge Gates

- **REQ-080 (Canonical Doc):** WHEN implementation completes THEN `docs/notifications/broadcast-notifications.md` SHALL exist documenting: the cohort taxonomy + governance-exclusion ruling (REQ-015), the header-key/replay contract, the cap + chunked-mode deferred item, the audit contract (entityType + widening rationale), and the import-by-reference rules for future emitters (engine §3.2 table link-back).
- **REQ-081 (AGENTS.md Propagation):** WHEN knowledge propagation runs THEN `backend/services/AGENTS.md` SHALL gain a broadcast-service one-liner (rules + doc link), `docs/notifications/realtime-engine.md` §3.2 table SHALL mark DEV3-022d as shipped (outcome-note link), `backend/db/repo/AGENTS.md` SHALL register the audience repository convention, and root `AGENTS.md` Important References SHALL gain one line for the canonical doc. AGENTS entries are rules/references only.
- **REQ-082 (Outcome Protocol):** WHEN every task executes THEN the executor SHALL read all prior `outcome/` files first, write `outcome/<task-id>-outcome.md` afterward, and update task checkboxes; Phase 1.5 `@plan-review` SHALL run before implementation.

### 2.9 Cross-Actor Workflow Scenarios (Journeys)

**Actor Table**

| Actor | Role / membership | Can do | Cannot do |
|---|---|---|---|
| Admin A | `UserRole.Admin` + real `admin` row | compose & fire all four cohort kinds; receive system broadcasts | nothing broadcast-scoped |
| Teacher T | `UserRole.Teacher` (+ approved teacher row) | receive `role:teacher`, `all`, country, and plan-matching broadcasts | fire a broadcast (`FORBIDDEN`) |
| Student S (country=EG, subscriber of plan P) | `UserRole.Student` + active subscription to P | receive matching cohorts | fire a broadcast |
| Parent Pa | `UserRole.Parent` | receive matching cohorts | fire a broadcast |
| Student S2 (country=US, no subscription) | `UserRole.Student` | receive `all` only | receive role/EG-country/P-plan cohorts; fire |
| Governed user G (is_deleted) | any | — | receive ANY cohort (REQ-015) |
| Anonymous | — | nothing | everything (`UNAUTHORIZED`) |

**Ordered Step List** (each maps 1:1 onto a journey assertion):

1. Admin A → fire `all` broadcast (body + title) → `notifications` rows for A, T, S, Pa, S2; ZERO for G; ONE audit row; ONE spied fan-out envelope carrying the full id list.
2. Admin A → re-submit the SAME broadcast with the SAME `X-Idempotency-Key` → identical count returned; inbox rows, audit rows, and fan-out count ALL unchanged (replay path).
3. Admin A → fire `role:teacher` → T's inbox gains one row; S/Pa/S2 unchanged.
4. Admin A → fire `country:"EG"` → S receives; T/Pa/S2 (different countries) unchanged.
5. Admin A → fire `plan:P` → only S receives (active-window subscriber); a second student holding an EXPIRED subscription to P does NOT.
6. Admin A → submit `role:teacher` with body/validation defects and hostile discriminants → `VALIDATION`-family denials; DB untouched.
7. Teacher T / Student S / Parent Pa → attempt the mutation through the real authorization path → `FORBIDDEN` before any row exists.
8. Anonymous caller → `UNAUTHORIZED`.
9. Governed exclusion step: G appears in NO cohort result on any of the above.
10. Post-hoc observer reads: each recipient's own `NotificationEngine.listMyNotifications` shows `type=system_broadcast` with the verbatim copy, `relatedEntityType=null`, `relatedEntityId=null`, `isRead=false`.

**Cross-Actor EARS Criteria (observer-perspective):**

- WHEN Admin A fires a system-wide broadcast THEN the system SHALL persist one `system_broadcast` row per governed-eligible user AND every non-admin cast member SHALL observe the row in his own self-scoped inbox.
- WHEN a duplicate submission replays under the same header key THEN every recipient observer SHALL see EXACTLY ONE row remain AND the platform SHALL record exactly ONE audit row AND emit exactly ONE fan-out envelope.
- WHEN a cohort-targeted broadcast lands THEN every non-member of the cohort SHALL observe a byte-identical inbox (no cross-cohort leakage).
- IF a non-admin actor submits the mutation THEN the request SHALL be rejected with `FORBIDDEN` and NO shared state SHALL change.
- WHEN a governed (deleted/blocked) user is part of the user base THEN that user's inbox SHALL remain unchanged by any broadcast.
- WHEN a plan-targeted broadcast fires THEN a student whose subscription to the plan lapsed SHALL NOT receive it WHILE a currently-active subscriber SHALL.

---

## 3. System Decisions & State Machine Invariants Alignment

**Decision References (`docs/specs/open-decisions-and-gaps.md`):**

| Decision | Alignment |
|---|---|
| **A.4** (`notifications` table + `notification_type` enum) | This ticket is the canonical `system_broadcast` emitter A.4 anticipates; no table/enum change (the value already exists — `enums.ts:61`). |
| **A.4.1** (WS sidecar topology) | Realtime delivery rides the EXISTING fan-out/sidecar path; no new transport, no `ROUTE_INVENTORY` row. |
| **A.4.2** (emit idempotency fail-open deviation) | The banner-class risk of this feature is why we bolt a REAL claim cache (`RedisClaimCache`) onto the engine's injected port for production; the engine's fail-open posture on cache absence/outage is inherited verbatim and test-locked. |
| **A.4.3** (localization-at-emitter) | Honored structurally: copy is admin-authored free text passed verbatim; no translation occurs at the engine boundary. |
| **A.5** (`audit_logs` append-only) | REQ-021 writes exactly one in-tx row per accepted broadcast via the existing `AuditService.createAuditLog` writer — never a second writer. |
| **A.7** (governance on `users`) | Recipient exclusion (REQ-015) reads `users.is_deleted`/`is_blocked`; suspended users remain eligible (window can lapse; INV-U2 blocks session requests, not inbox reads). |
| **B.8/C.2** (`subscriptions.user_id` generic owner FK) | The plan cohort resolves OWNERS (any role), not students specifically — a verification-plan subscriber applicant is a legitimate plan-cohort target. |
| **B.9 / INV-PAY5** | N/A — no payment surface touched. |

**New decisions recorded by this ticket (addendum-style, no renumbering of existing decision/inventory files):**

- **DB-1 — Cohort taxonomy frozen at {all, role, country, plan}**: four kinds cover the ticket contract (all users / teachers / students / parents / country / plan subscribers); `admins` is reachable via `role:admin`. Any future cohort kind (e.g. "pending applicants") is an additive enum member + repo predicate, not a redesign.
- **DB-2 — Plan cohort = active-window OWNERS of subscriptions to plan X**, reusing the canonical active predicate byte-for-byte (`admin-user.repository.ts:337-346`), evaluated on `subscriptions.user_id` (B.8/C.2).
- **DB-3 — Broadcast copy is NOT localized** (free-text admin authoring; engine's localization-at-emitter boundary is satisfied "at rest", no per-recipient fan-out of localized copy which engine D2 leaves to emitter tickets that emit TEMPLATED copy; broadcast copy is not templated).
- **DB-4 — Recipient cap 5000 (fail-closed)**; chunked mega-broadcast is a deferred-items ledger entry owned by a future scale ticket (engine contract already supports multi-call chunk patterns; not needed at current scale).
- **DB-5 — `AuditLogWriteContract.entityId: number → number | null` widening** (additive; broadcast has no single entity id; `audit_logs.entity_id` is already nullable). Governed by `docs/backend/cross-stream-contracts.md` §6 — flagged for plan-review visibility; zero existing consumer breaks (widening only relaxes).
- **DB-6 — No audience-size preview query** (pre-send recipient counts would be an enumerability surface and a second write-path rationale; the mutation result reports the count AFTER the fact).

**State-Machine & Invariants posture (`docs/specs/state-machine-invariants.md`):** NO new invariant is minted (engine doc §3.10 precedent: the engine owns the append-only/read-latch properties; this ticket inherits them). The ticket is **enabled-by, not modifies**: INV-U1/U4/U5 (soft-delete governance — excluded from cohorts), INV-P3 (unrelated), Session INV-S1..S8 (untouched), Wallet INV-W1..W8 (untouched), INV-TV1..TV7 (untouched), INV-PAY1..5 (untouched).

**Canonical Workflows:** `docs/workflows/05-admin-governance-override.md` — implements the `Notification_Broadcast` state of the admin governance state machine (§2) and the §7.2 audit requirement ("Notification Broadcast" row); `docs/notifications/realtime-engine.md` §3.2 consumption-table row for DEV3-022d gets marked shipped (REQ-081).

**Architectural standards:** `docs/IDEMPOTENCY.md` (broadcasts are NOT in the mandated key set; header-key + engine claim is a deliberate, documented elevation of the notification path's own port — see A.4.2) · `docs/DATABASE_MIGRATIONS.md` (zero migrations; `db push` never invoked) · `docs/drizzle/prepared-statements.md` + `docs/graphql/dataloader-batching.md` (no N+1 surface: single batched audience read + one multi-row insert; resolvers expose no per-parent service fetch) · `docs/graphql/api-gateway-and-routing.md` REQ-018 registration contract (side-effect barrel, codegen in set, authScopes declared, public allowlist untouched).

---

## 4. Cross-Layer Traceability Matrix

| Requirement ID | Decision Ref / Invariant | Backend Service | GraphQL Mutation/Query | Frontend View | Test Coverage |
|---|---|---|---|---|---|
| REQ-001 | Spec Phase 0 | — | — | — | `outcome/0-baseline-outcome.md` |
| REQ-002 | A.4/A.4.1/A.4.2/A.5; engine REQ-010 | Reuse verification (outcome) | — | — | `deferred-items.md` gate + plan-review |
| REQ-003/004 | i18n + canonical-types rules | all new modules | all new registrations | compose view | tsgo + parity suites + review-types wave |
| REQ-010 | DB-1 | `BroadcastAudienceSelector` validation | `BroadcastAudienceInput` | audience selector branches | service validation matrix; enum 4-tier guard test |
| REQ-011/012/013 | A.7 | `BroadcastAudienceRepository.resolveAudienceIds` | — | — | repo tests (`runInRollback`) per kind |
| REQ-014 | B.8/C.2 | same + `PlanRepository.existsById` | `planId: Int` | plan select (existing `adminPlansQueryDocument`) | plan-cohort tests incl. expired-subscription exclusion |
| REQ-015 | INV-U1/U2/U4 | governance predicate in repo | — | — | repo + journey governed-user exclusion step 9 |
| REQ-016 | engine claim-digest determinism | repo ordering (id ASC, DISTINCT) | — | — | repo dedupe/order assertions |
| REQ-017/018 | DB-4 | service pre-DB guards | — | localized guidance copy | service boundary tests + errors parity |
| REQ-019/020 | engine REQ-010/015/028 | `AdminBroadcastService.broadcast` → `NotificationEngine.emitForUsers` | resolver delegates only | document + container | static "engine-only writer" scan + verbatim-copy storage tests |
| REQ-021 | A.5; JR-C-1; DB-5 | in-tx `AuditService.createAuditLog` | — | — | atomicity + denial-zero-audit tests; rollback proof |
| REQ-022 | engine REQ-011/012/013 | `publishReceipts` post-commit | — | — | publish-after-commit + publish-outage-degradation tests |
| REQ-023 | A.4.2; IDEMPOTENCY deviation note | `RedisClaimCache` + `resolveBroadcastClaimCache` + replay detector | `X-Idempotency-Key` transport | compose-session key minting | claim/replay/corrupt-receipt/outage tiers (unit + integration) |
| REQ-024 | journey harness seams | options seam `{transport, cache}` | — | — | `test/workflows/notifications/admin-broadcast.journey.test.ts` (TEST-FIRST) |
| REQ-030 | D10 (`$all`) precedent | extracted admin-actor assertion helper | `authScopes` pin | — | scope-extension introspection test + service re-check tests |
| REQ-031/032 | BOLA/BOPLA | context-only identity; field-by-field mapping | zero identity args | — | validate() probes + BOPLA wire probes |
| REQ-033 | D11 admin-oracle ruling scope | `PLAN_NOT_FOUND` allowed here only | — | — | error-contract assertions; scope-confined |
| REQ-034/035 | log hygiene; limiter posture | `logDomainError` shapes | — | — | static scans + log-spy assertions |
| REQ-040/041/042/043 | repo/tx rules; Drizzle rules | repo+service conformance | — | — | logic tests + concurrent same-key race |
| REQ-044 | schema ground truth | — | — | — | empty `git diff` gate |
| REQ-050/051/052 | error taxonomy; REQ-055 no-duplicate-keys | error taxonomy enumeration | `extensions.code` matrix | field-error projection | error-contract matrix assertions + parity |
| REQ-060/061 | REQ-018 registration contract | input/pothos/enum registration | `adminBroadcastNotification` | document | `sdl-static-assertions` + `schema-surface` baseline updates |
| REQ-062 | baseline-freeze discipline | — | — | codegen artifacts | committed SDL ≡ built schema test stays green |
| REQ-063/064/065 | UX/i18n/MUI rules | — | — | `/admin/broadcasts` page + container + nav item | component suite + `navItems.test.ts` extension |
| REQ-070..076 | test-layer rules | repo/service suites | integration matrix | component suite | 4-tier + coverage + baseline-zero drift |
| REQ-080/081/082 | outcome protocol | canonical doc + AGENTS updates | — | — | docs existence + knowledge-propagation task |
| §2.9 journeys | Workflow 05 §2/§7.2; engine §3.2 | full pipeline | real auth denials | — | `test/workflows/notifications/admin-broadcast.journey.test.ts` (steps 1–10) |

---

**End of Specification — DEV3-022d.** Governing next step: Phase 1.5 — invoke `@plan-review` on the complete plan (`specs.md` + `plan.md` + `tasks.md`) before any implementation begins.
