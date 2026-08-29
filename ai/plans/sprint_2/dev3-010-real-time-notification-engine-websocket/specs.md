# Requirements & Specification: DEV3-010 — Real-Time Notification Engine (WebSocket)

> **Target ticket:** `[DEV3-010] Real-Time Notification Engine (WebSocket)` (Owner: Dev 3 · Sprint 2 · 8 SP)
> **Plan directory:** `ai/plans/dev3-010-realtime-notification-engine/`
> **Blocking dependencies:** DEV1-001 (`notifications` table + `notification_type` pgEnum — Decision A.4), DEV1-002 (user registration → `users` rows for recipient fan-out), DEV2-001 (`verifyAccessToken` token verification for the WS handshake), DEV2-002 (`authenticated`/`role` authScopes + verified `ctx.user`/`ctx.role` context), DEV2-003 (`SessionEventNotificationContract` substrate — the emit-side input vocabulary), DEV3-002 (error taxonomy + masking boundary), DEV3-003 (API gateway posture: transport guard, public-operation default-deny, route registration discipline).
> **Critical reconciliation note (transport topology):** The ticket says "WebSocket push." Next.js 16 App Router route handlers **cannot host WebSocket connections**, and the deployment lineage (serverless-cold-start docs, `app/api/graphql/route.ts`) is serverless-first. This ticket therefore delivers the engine as: (1) the **durable inbox** on the existing A.4 `notifications` table (persistence is the source of truth even when the user is offline — AC #2), (2) a **dedicated Bun-native WebSocket sidecar process** (`bun run ws`, port-separated from Next.js) that authenticates handshakes via the existing httpOnly `access_token` cookie + Origin allowlist, subscribes to a fan-out backplane, and pushes to connected users, and (3) a **client realtime hook with deterministic catch-up** (WS push for latency, refetch for truth, existing 120s polling posture as the graceful-degradation floor). The sidecar is NOT part of the Next.js gateway surface; the internal ingest/health endpoints it exposes live outside `app/api/**` and are governed by this spec rather than `ROUTE_INVENTORY`.

---

## 1. Executive Summary & Problem Statement

- **Feature**: The platform's in-app **notification engine** — the single service-side substrate that (a) persists notifications into the A.4 `notifications` table, (b) fans them out in real time to connected users over WebSocket, and (c) exposes the recipient-facing GraphQL inbox API (list with type/read filters + pagination, unread count, mark-read single/bulk). Emitters in future tickets (DEV3-011 session requests, DEV1-016/017 parent completion, DEV3-022d admin broadcast, payment/evaluation events) call the engine's `emit*` contract; the engine owns persistence ordering, realtime delivery, oracle-safe reads, and connection lifecycle. All seven `notification_type` values (`session_request`, `session_completion`, `session_cancellation`, `parent_link_request`, `system_broadcast`, `payment_confirmation`, `evaluation_result`) are engine-level citizens from day one.

- **Problem from user perspective**:
  - **Student (Yusuf)**: when something happens to *his* account — a session acceptance/cancellation, a payment confirmation — he must see it instantly in-app if online, and must never silently lose it if offline (the persisted row is the guarantee).
  - **Certified Sheikh (Sheikh Abdullah)**: a session request that arrives 30 seconds late is a dead request (Workflow 02 presence model); he needs sub-second push to his open dashboard, with the unread-badge truth always recoverable from the DB if the socket hiccups.
  - **Parent (Fatima)**: is linked and waits passively — session completion events on her child must reach her feed without her polling constantly (INV-P3's preconditions live here; the actual emitters ship in DEV1-016/017).
  - **Super Admin**: future broadcast tooling (DEV3-022d) needs a bulk fan-out primitive that can write one row per cohort member atomically and fan out cheaply — built into the engine now, exposed by that ticket later.
  - **Dev 1 / Dev 2 (consumers)**: need one exported emit contract and one read model — never a second notification writer.

- **Business value**: Real-time-ish delivery is the difference between an abandoned on-demand marketplace and a responsive one (FR-9.1/9.2/9.3). The inbox persists every event durably, which is also the audit-adjacent substrate for the M2 gate ("notifications fire" — demonstrable). Consolidating all inbox reads/writes/realtime behind one engine eliminates N divergent notification implementations across streams and makes BOLA/oracle safety enforceable in one place.

- **Actors involved**:
  - **Runtime callers (emitters, this ticket)**: none operational — no domain event sources exist yet in other tickets; the engine ships with its emit contract verified by **test-only emitter invocations** and locked by the cross-actor journey suite (Section 2.9).
  - **Recipient callers (this ticket's GraphQL surface)**: every authenticated role (student, teacher/applicant, parent, admin) reads ONLY their own inbox.
  - **Downstream emitter consumers**: DEV3-011 (session_request accept/decline wave), DEV1-016/017 (session completion → parent), DEV2-016/017 (evaluation_result), DEV3-012/013 (cancellation/payment_confirmation), DEV3-022d (system_broadcast admin surface).
  - **Explicitly NOT actors**: anonymous callers (no reads, no WS), parents writing into a child's inbox (INV-P2 — parents are read-only *recipients*), students causing writes to a teacher's inbox directly (emitters are server-side only).

- **Non-goals** (explicitly OUT of scope for DEV3-010):
  1. **Domain emitters** — no event sources are wired here; DEV3-011/DEV1-016/DEV1-017/DEV2-016/DEV3-012/013/DEV3-022d own the semantic triggers. The emit contract, its typing, and its prohibition registry ship now and are proven via test-only emitters + journey suite.
  2. **Admin broadcast mutation/UI** — DEV3-022d owns the admin-facing surface; the engine ships ONLY the internal `emitForUsers` bulk primitive it will consume.
  3. **Multi-channel fan-out** (email/SMS/WhatsApp/push, user notification preferences, `notificationDeliveries` tracking) — the pre-existing `CommunicationService`/`dispatchWithPreferences` infrastructure is a separate channel pipeline; this ticket adds the zero-channel in-app inbox lane and MUST NOT entangle with that pipeline (integration lands later — deferred item D4).
  4. **Preferred-locale persistence for notification copy** — the emitter localizes `title`/`body` at emit time (contract metadata is pre-rendered strings); a `users.locale` column and recipient-side re-localization is a deferred schema-class concern (D2), never patched inline.
  5. **Read-receipts/`readAt` timestamp, sound/vibration, mobile push registration, WebRTC, message threading, action buttons on notifications** — none exist in the A.4 schema; no schema drift is introduced to fake them.
  6. **WebSocket presence/online-status system** (teacher `is_online` heartbeat duty belongs to DEV2-011/012/013). The WS sidecar's connection registry is delivery plumbing, NOT availability truth.
  7. **Provisioning the production WS host** (container/VM deployment, TLS termination config) — documented as deferred item D3; local/dev/test topologies are fully specified and tested here.
  8. **Any change to `notifications` schema, to the `notification_type` enum values, to app route inventory, or to existing multi-channel notification flows.**

---

## 2. Requirements & Acceptance Criteria (EARS Format)

### 2.1 Baseline & Foundational Preparation (MANDATORY)

- **REQ-001 (Pre-Implementation Baseline & Ledger)**: WHEN implementation begins THEN the executing agent SHALL record baseline error counts (`bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline`, `git diff --name-only`) AND SHALL initialize `ai/plans/dev3-010-realtime-notification-engine/deferred-items.md` from the template AND SHALL write `outcome/phase0-baseline-outcome.md`. Pre-seeded non-blocking forward items: **D1** (emitter wiring per event type → DEV3-011/DEV1-016/DEV1-017/DEV2-016/DEV3-012/DEV3-013/DEV3-022d), **D2** (recipient-locale copy storage → requires future `users.locale` decision), **D3** (production WS host provisioning → deployment workstream), **D4** (multi-channel/unified-preferences integration → notification-preferences ticket).

- **REQ-002 (Type-Safe i18n & Enum Value Imports Compliance)**:
  - Client components MUST use `useAppTranslation(Translation.<Namespace>)` with the `Translation` enum and property access (`t.propertyName`); never string-literal namespaces, never `t('key')`.
  - Server components MUST use `await getTranslations(locale)` (single argument) and property access.
  - GraphQL resolvers MUST use `ctx.t("namespace")`; services/repositories/WS-sidecar modules MUST use `getServerTranslations(locale, "<namespace>")` from `@/shared/locale/server-graphql`.
  - All enum usages in runtime expressions/comparisons (`NotificationType`, `UserRole`) MUST be **value imports** (never `import type`) and enum **members** — raw string literals for types/statuses are PROHIBITED; unknown type input SHALL fail closed via enum guard, never `as NotificationType` narrowing.
  - FORBIDDEN: `next-intl`, `getBackendTranslations`, `shared/messages/` references, hardcoded user-facing strings, `console.*` in any touched file (use `logger` from `@/backend/lib/logger` or `@/frontend/utils/logger`).

- **REQ-003 (Canonical Types Discipline)**: All types SHALL come from canonical locations: `NotificationSelectType`/`NotificationInsertType` exist in `backend/types/notifications/notification.types.ts` — this ticket EXTENDS that file additively with `NotificationReturnType` (inbox projection: same row minus nothing — no forbidden fields exist, but the alias is the GraphQL binding anchor) and the input shape `NotificationListFilterInput` (`{ type?: NotificationType | null; isRead?: boolean | null; limit: number; offset: number }`) and the result shape `NotificationListPageReturnType` (`{ items: NotificationReturnType[]; totalCount: number; hasMore: boolean }`), plus `NotificationEmitInput`/`NotificationEmitBatchInput` (emit contracts). `DBTransaction` from `@/backend/types`. `SessionEventNotificationContract`/`SessionEventNotificationType` are CONSUMED from `@/backend/types/contracts` and never redefined. NO service-layer `.types.ts` files; NO local type definitions in Pothos files; NO new type file apart from the additive extension of the existing canonical file.

- **REQ-004 (Dependency Guard — Reuse, Don't Rebuild)**: WHEN domain work starts THEN the agent SHALL verify: (a) `backend/db/schema/notifications/notifications.ts` exists with exactly the A.4 columns (`id`, `user_id`, `type`, `title`, `body`, `is_read`, `related_entity_type`, `related_entity_id`, `created_at`) and the `notifications_user_id_idx` + `notifications_user_id_is_read_idx` indexes; (b) the `notificationType` pgEnum in `backend/db/schema/enums.ts` and TS mirror `NotificationType` in `backend/enum/notifications/notification-type.enum.ts` both hold exactly the 7 sanctioned values; (c) the existing `backend/db/repo/notifications/` repository surface (the pre-existing `NotificationRepository` namespace) — VERIFY its methods and EXTEND additively; if a needed method exists already it MUST be reused, never re-implemented; (d) DEV2-001 `verifyAccessToken` helper + DEV2-002 authScopes. IF any required artifact is missing THEN record a ❌ entry in `deferred-items.md` and block dependent tasks — never patch DEV1-001-owned structures inline.

### 2.2 Core Feature Logic / Happy Paths

- **REQ-010 (Single Engine Entry Point)**: WHEN any notification is created anywhere THEN it SHALL flow through `NotificationEngine` (new `backend/services/notifications/notification-engine.service.ts`): `emitForUser(input: NotificationEmitInput, locale: string, tx?: DBTransaction)` and `emitForUsers(input: NotificationEmitBatchInput, locale: string, tx?: DBTransaction)` (batch = same type/title/body/entityRef to N userIds). No repository or service outside this engine SHALL write `notifications` rows; existing pre-existing notification writers (multi-channel pipeline) are out of this ticket's authority (see Non-goal 3 / D4) — the rule binds NEW in-app inbox producers.

- **REQ-011 (Persist First, Push Second — Durable Inbox Is Truth)**: WHEN `emitForUser`/`emitForUsers` executes THEN the engine SHALL insert the inbox row(s) FIRST and ONLY THEN attempt realtime fan-out; IF no recipient is connected (OR the WS layer is unreachable/down) THEN the operation SHALL still succeed with the row persisted (`is_read=false`) and SHALL log a single structured `logger.logDomainError` (delivery-degraded, not error) — *never* fail the emit because push failed.

- **REQ-012 (Publish-After-Commit — No Ghost Pushes)**: WHEN emit runs inside a caller-provided `tx` (future tx-owning emitters like escrow completion) THEN the engine SHALL NOT publish the realtime message before the enclosing transaction's writes are durable; the engine API SHALL offer the explicit safe composition: persist within `tx`, return the created row(s) as a **delivery receipt**, and the CALLER invokes `NotificationEngine.publishReceipts(receipts)` only after its own `withTransaction(outerTx)` resolves successfully; when emit runs WITHOUT an outer transaction, emit SHALL wrap insert+publish in its own commit-then-publish sequence. A ghost push (push for a row that rolled back) SHALL be impossible by construction (test-proven via forced-rollback).

- **REQ-013 (Bulk Fan-Out Atomicity)**: WHEN `emitForUsers` executes THEN all N row inserts SHALL happen in ONE Drizzle transaction (single commit), and the fan-out publish SHALL be a single bus publish with the full recipient id list (not N publishes); partial fan-out writes SHALL NOT be observable.

- **REQ-014 (Type Enum Gates at Every Layer)**: WHEN any notification type value is consumed (emit input, list filter, WS payload payload-type) THEN it SHALL be validated against `NotificationType` via a guard (`isNotificationType`-style) or the GraphQL enum layer; a non-enum value SHALL fail closed BEFORE any DB write (`VALIDATION` semantics); the 7-value set SHALL match `backend/db/schema/enums.ts` byte-for-byte (static-assertion verified).

- **REQ-015 (Emit Input Contract)**: WHEN emitters call the engine THEN the input SHALL be `{ userId(s), type, title, body, relatedEntityType?, relatedEntityId? }` — `title`/`body` are opaque pre-rendered, pre-localized strings produced by the EMITTER (the engine performs NO translation, NO template expansion, NO mutation of copy); engine-side validation covers: non-empty `title` (≤255 chars per schema), `body` optional, `relatedEntityType`/`relatedEntityId` paired (both or neither), and all ids as positive safe integers (ID-channel guard); `SessionEventNotificationContract` payloads map onto this shape field-by-field (no spreads).

- **REQ-016 (Emit Idempotency — Best-Effort Dedupe, Fail-Open on Bus Cache Outage)**: WHEN an emitter supplies an idempotency key (the contract's optional field) THEN the engine SHALL attempt a duplicate claim via atomic cache `SET NX EX`-semantics on `notif:emit:<sha256(userId:type:key)>` with 24h TTL, and a duplicate claim attempt SHALL return the prior receipt WITHOUT inserting a second row; IF the cache backend is transiently unavailable THEN the engine SHALL fail OPEN (proceed with the write) with a structured warn log — a lost/duplicated inbox row is recoverable user noise, whereas blocking a domain event (session completion, payment confirmation) on cache health is a correctness failure. This fail-open rule is a deliberate, documented deviation from the fail-closed posture used for booking-class mutations and SHALL be documented in the canonical doc.

- **REQ-017 (Recipient Reads — Self-Only Inbox List)**: WHEN an authenticated user queries their inbox THEN the system SHALL return ONLY rows where `userId = ctx.user.id` (derived exclusively from the verified context — no user id input exists), ordered `createdAt DESC, id DESC`, paginated via `limit` (1–50, default 20, capped) + `offset` (≥0), with totals returned (`totalCount`, `hasMore`) in one round trip; optional `type` (enum) and `isRead` filters SHALL compose as conjunctive WHERE clauses. No DataLoader is needed (flat single-table rows — documented so absence isn't mistaken for omission).

- **REQ-018 (Unread Count Query)**: WHEN an authenticated user queries `myUnreadNotificationCount` THEN the system SHALL return the exact COUNT of their `is_read = false` rows via the existing `(user_id, is_read)` index — a scalar read intended for the badge and for the existing polling posture (`NOTIFICATION_COUNT_POLL_INTERVAL_MS` conventions).

- **REQ-019 (Mark Read — Single)**: WHEN an authenticated user marks one of THEIR notifications as read THEN the system SHALL execute a single guarded `UPDATE notifications SET is_read = true WHERE id = <id> AND user_id = <ctx.user.id> RETURNING *`; zero rows SHALL surface `NotFoundError("NOTIFICATION", …)` (oracle-resistant — a foreign/nonexistent id is indistinguishable); marking an already-read row SHALL succeed idempotently (returns the row, no state drift).

- **REQ-020 (Mark All Read — Bulk)**: WHEN an authenticated user marks all THEN the system SHALL execute ONE `UPDATE … SET is_read = true WHERE user_id = <ctx.user.id> AND is_read = false` (+ optional type filter) and SHALL return the affected row COUNT (Int); the operation SHALL be safe on empty reads (returns 0) and SHALL run as a single statement (no row iteration in app code).

- **REQ-021 (Realtime Push Message Shape)**: WHEN the engine delivers over WS THEN the message SHALL be a bounded JSON envelope `{ v: 1, kind: "notification", data: { id, type, title, body, relatedEntityType, relatedEntityId, createdAt } }` — only fields present in the inbox row; no WS payload SHALL ever contain the recipient's email/phone/PII, other users' data, balances, governance flags, or reduplicated history; the server protocol is **push-only** (client frames other than pong/close are ignored-closed per RFC hygiene), and every outbound message SHALL carry the DB row's `id` so the client can dedupe/cache-normalize.

- **REQ-022 (WS Handshake Auth — Cookie + Origin, Fail-Closed)**: WHEN a client opens the WS handshake THEN the sidecar SHALL: (a) enforce the Origin allowlist (reject-and-close otherwise — CSWSH defense); (b) read the `access_token` httpOnly cookie from upgrade headers and verify via DEV2-001 `verifyAccessToken` (`null`-on-any-failure → close `4401` policy code); (c) derive `userId` exclusively from the verified token (`ctx.role` NOT required — every authenticated role may receive notifications); NO token/ticket/payload from URL query strings SHALL be honored (query tokens leak into logs); Bearer-cookie garbage SHALL close, never 500.

- **REQ-023 (Connection Registry — Bounded, Per-User Caps, Heartbeat)**: WHEN the sidecar runs THEN it SHALL maintain only bounded in-process state: a connection registry (Map by connection id) with (a) global connection cap, (b) per-user cap (excess newest connection closes the OLDEST with a `4009` policy code — documented), (c) 30s server pings with 2-miss termination, (d) graceful shutdown that closes sockets with `1001` and a final goodbye frame. Module-level mutable state here is a **sanctioned, bounded exception** to the ban on module-level mutable state — caps and bounds SHALL be constants and tests SHALL assert enforcement.

- **REQ-024 (Backplane — Fan-Out Transport Port)**: WHEN the app process and the WS sidecar communicate THEN a `NotificationFanoutTransport` port SHALL define `publishFanout(userIds: readonly number[], payload: RealtimeNotificationPayload): Promise<void>`; TWO adapters SHALL ship: (a) `RedisPubSubTransport` (default when Redis env config is present; channel `kottaby:notifications:fanout`; JSON envelope), (b) `InProcessTransport` (tests + single-process harnesses); transport selection SHALL come from registered env-config (`NOTIFICATION_FANOUT_TRANSPORT`), and the sidecar's subscriber side SHALL be symmetric (Redis subscribe / in-process tap); a fan-out transport outage SHALL degrade to persisted-only delivery per REQ-011 (never block emit).

- **REQ-025 (Reconnect & Catch-Up Contract)**: WHEN a client loses and regains connectivity THEN the client's realtime hook SHALL: reconnect with bounded exponential backoff (1s→2s→4s…cap 30s + jitter, abort on explicit close codes 4401/4009 policy codes aborting retry), and AFTER reconnect SHALL refetch the inbox first page + unread count (catch-up self-heal); a message received that the cache already holds (same `id`) SHALL be a no-op; thus a dropped push NEVER becomes persistent divergence (DB truth + refetch).

- **REQ-026 (Filtering Correctness)**: WHEN `type`/`isRead` filters are applied THEN results and `totalCount` SHALL agree exactly (the same predicate feeds both list and count); combined filters SHALL use parameterized Drizzle conditions only (no string SQL building); no LIKE/ILIKE search exists on the inbox in this ticket (`escapeLikeWildcards` explicitly N/A — recorded so reviewers don't flag it as an omission).

- **REQ-027 (Broadcast Primitive — Cohort Fan-Out)**: WHEN `emitForUsers` is fed a cohort THEN it SHALL accept EXPLICIT recipient id lists from the caller (cohort resolution is the future admin mutation's concern, DEV3-022d); the engine SHALL NOT provide role/all-user resolution queries in this ticket (BFLA containment of fan-out authority).

- **REQ-028 (Content Safety on Stored Copy)**: WHEN the engine persists `title`/`body` THEN it SHALL store the emitter-provided text verbatim after length/emptiness validation (the DB is plain varchar/text); the engine does NOT sanitize HTML/script payloads itself — the FRONTEND rendering rule (REQ-063) is the XSS defense: rendering SHALL be pure text nodes via MUI Typography with no `dangerouslySetInnerHTML` anywhere in the notification UI (static-assertion enforced).

- **REQ-029 (No Notification Lifecycle Mutations Beyond Read-Flag)**: WHEN any path in this ticket executes THEN the ONLY mutation permitted on an existing notification row SHALL be `is_read → true`; there SHALL be no edit, no delete, no `is_read → false`, no body rewrite — inbox rows are append-only plus a one-way read latch (permanence posture aligning with the platform's data-retention rules).

### 2.3 Security, Authorization & Tenancy

- **REQ-030 (BOLA / IDOR — Self-Scope by Construction)**: WHEN any inbox query/mutation executes THEN scoping SHALL be `userId = ctx.user.id` exclusively — NO input parameter may target a user (`MarkNotificationRead` takes only `id`; list/count take zero identity args); foreign-id mark-read SHALL return `NOTIFICATION_NOT_FOUND` (oracle-safe; existence is never disclosed); sibling reads (even parent→child) are IMPOSSIBLE via this surface — a parent sees a child's session completion ONLY via the row emitted TO the parent by an emitter (INV-P3), never by querying the child's inbox.

- **REQ-031 (BOPLA — Whitelist Exactly)**: WHEN inputs map to queries/writes THEN ONLY whitelisted fields SHALL be consumed: list (`type`, `isRead`, `limit`, `offset`), mark-one (`id`), mark-all (`type?`); emit input is server-internal (never a GraphQL input); NO `{ ...input }` spread may reach any Drizzle call (grep-verified); smuggled fields SHALL be ignored by explicit mapping.

- **REQ-032 (BFLA — No Public Write Surface)**: WHEN the GraphQL schema ships THEN it SHALL contain ZERO mutations that create notifications (emit is service-internal only); ALL inbox operations SHALL carry `authScopes: { authenticated: true }` (401 `UNAUTHORIZED` anonymous; no role scope — every role owns an inbox); the bulk fan-out primitive SHALL NOT be reachable from ANY resolver (BFLA scan enforcement via the gateway allowlist gate + codebase grep: no resolver imports `emitForUsers`).

- **REQ-033 (CSWSH & Handshake Hardening)**: WHEN the WS handshake is evaluated THEN: Origin MUST match the allowlist (env-config registered: `WS_ALLOWED_ORIGINS`; localhost defaults in dev); cookie auth MUST verify (REQ-022); handshake bursts SHALL be throttled per-IP via a bounded in-memory token bucket (fail-closed on threshold — close `4429`); NO identity SHALL ever be accepted from query strings, headers other than Cookie/Origin, or first-frame payloads.

- **REQ-034 (WS Message Discipline)**: WHEN the sidecar receives client frames THEN it SHALL accept only protocol frames (pong/close); JSON/text payloads from clients SHALL be ignored (and the connection MAY be policy-closed after repeated abuse) — the server is push-only; the sidecar SHALL cap frame/message size defensively even though the path is unused (Bun defaults honored and asserted).

- **REQ-035 (Error Disclosure Hygiene)**: WHEN errors surface THEN messages SHALL be localized generic copy — never disclosing whether a notification id belongs to another user, recipient state, connection tables, or internal topology; masked unexpected failures follow the DEV3-002 boundary (`INTERNAL_SERVER_ERROR` with `extensions.requestId`, full fidelity server-side via `logger.error`).

- **REQ-036 (Rate Limiting Posture)**: WHEN inbox queries execute THEN they SHALL inherit the platform's existing fail-open global limiter posture (no new public surface — REQ-034 of prior tickets' precedent); pagination caps (max 50) bound read cost; the WS handshake has its own per-IP throttle (REQ-033) so socket storms cannot bypass the GraphQL limiter.

- **REQ-037 (Logging Hygiene)**: WHEN logging occurs THEN: expected domain rejections → `logger.logDomainError` with `{ code, entity: "notifications", entityId? }`; delivery degradation → warn-tier via the logger (never `console.*`); connection lifecycle logs SHALL carry connection-id + user-id only (no tokens, no IPs beyond aggregate counters, no payloads).

- **REQ-038 (Governance Interaction)**: WHEN a governed caller (suspended/blocked/deleted) reaches the GraphQL layer THEN existing DEV2-001/002 fail-closed context denies BEFORE resolvers (no inbox-specific handling); the WS handshake verifies the JWT only (freshness of governance state is NOT re-checked per socket — documented trade-off: continued socket receipt of already-emitted events after suspension is harmless read-only scope; new emit targeting a governed user remains possible server-side and is the emitter's concern per governance rules on those tickets).

- **REQ-039 (No Enumeration via Timing/Shape)**: WHEN non-participant probing occurs THEN foreign mark-read, unauthenticated reads, forged WS handshakes SHALL all fail with the same localized NOT_FOUND/UNAUTHORIZED classes regardless of target existence, and response shapes SHALL be constant across those branches.

### 2.4 Atomicity, Concurrency & Data Integrity

- **REQ-040 (tx Propagation Everywhere)**: WHEN any repository method is invoked by the engine THEN it SHALL accept `tx?: DBTransaction` as the LAST parameter and the engine SHALL thread one `tx` through every call inside a transactional unit; mixing `tx` writes with global `db` ops inside emit/mark flows is PROHIBITED; `runInRollback` test isolation SHALL remain intact via the established `withTransaction(outerTx)` SAVEPOINT-aware composition.

- **REQ-041 (Single-Statement Discipline)**: WHEN state changes THEN: insert = one `INSERT … RETURNING` (batch = one multi-row INSERT), mark-one = one guarded conditional UPDATE, mark-all = one set-based UPDATE, count/list = single SELECTs; NO read-then-write sequences exist in the engine (idempotent flag-set needs no pre-read); TOCTOU window for all engine ops = 0 by construction.

- **REQ-042 (Emit Under Outer Transaction — Deferral Rule)**: IF emit is called with an outer `tx` (future emitters) THEN rows SHALL be written inside that tx and the engine SHALL return receipt handles WITHOUT publishing (REQ-012); the engine SHALL document-and-assert (via a dedicated test using a forced rollback) that a rolled-back outer tx produces ZERO pushes AND zero rows.

- **REQ-043 (Fan-Out Order — Insert then Publish)**: WHEN the engine completes THEN within its own committed unit the ordering SHALL be strictly: transaction completes successfully → publish invoked once; an exception at any point pre-commit SHALL produce neither rows nor push; publish failure post-commit SHALL be logged-and-swallowed (persisted inbox remains true — REQ-011) with delivery-degraded metrics log.

- **REQ-044 (Concurrent Mark/Read Races Harmless)**: WHEN concurrent mark-reads hit the same rows (two tabs, two devices) THEN both SHALL converge to `is_read = true` without error; concurrent emit + mark-read SHALL be order-independent since the flag is one-directional (REQ-029); chaos tests SHALL prove `Promise.allSettled` storms (same user × 25 concurrent mark-one/mark-all mixes) resolve all-fulfilled with a consistent final state.

- **REQ-045 (Backplane Payload Integrity)**: WHEN a fan-out envelope crosses the bus THEN the sidecar SHALL validate its shape with a runtime guard before touching connections (malformed → drop + structured warn, NEVER crash a socket loop); Redis outage mid-run SHALL degrade the transport per REQ-011/REQ-024 (emit persists; push dropped; logged); reconnecting Redis SHALL resume without manual intervention.

- **REQ-046 (Bounded Process State)**: WHEN the sidecar and transports run THEN ALL module-level mutable structures SHALL be the bounded ones sanctioned by REQ-023 (+ transport subscriber handles); no unbounded Map/Set/array growth SHALL exist; queueing (if used for shutdown drain) SHALL be length-capped with drop-oldest policy and a structured warn.

- **REQ-047 (Single Time Source)**: WHEN timestamps are written THEN `createdAt` SHALL come from DB defaults/`new Date()` captured once per emit batch (one `now` per batch so sibling rows share an identical timestamp — deterministic ordering tiebreak via `id`).

- **REQ-048 (Schema Zero-Drift)**: WHEN implementation completes THEN `git diff` on `backend/db/schema/**` and `backend/db/migration/**` SHALL be EMPTY; any discovered structural gap (e.g., `read_at`, per-user locale, delivery channel columns) SHALL be recorded in `deferred-items.md` targeted at its owning future ticket — NEVER patched inline (`db reset`/`cleanGenerate` remain permanently disabled; `db push` is not run by this ticket).

- **REQ-049 (Env-Config Registry Discipline)**: WHEN new configuration is read (`WS_PORT`, `WS_HOST`, `NOTIFICATION_FANOUT_TRANSPORT`, `WS_ALLOWED_ORIGINS`, Redis connection knobs, connection caps) THEN every key SHALL be registered in `env-config-keys` per the env-resolve conventions, typed with defaults for dev/test, and cache-invalidation (`reset*`-style) paths SHALL invalidate every registered key (semantic-review checklist item enforced per task).

### 2.5 Validation & Error Contracts

- **REQ-050 (DomainError Discipline)**: WHEN any failure surfaces THEN it SHALL be a `DomainError` subclass — `NotFoundError("NOTIFICATION", …)` (auto `NOTIFICATION_NOT_FOUND`), `ValidationError(...)` (bounded input failures incl. enum guard + pagination bounds), `UnauthorizedError` (scopeAuth), plus masked `INTERNAL_SERVER_ERROR` at the boundary — with `extensions.code` per `docs/graphql/domain-error-extensions-code.md` and the DEV3-002 taxonomy; plain `new Error(...)` is PROHIBITED in any touched module.

- **REQ-051 (i18n Key Registry — errors namespace)**: WHEN errors are produced THEN new keys SHALL be minimal and live in the EXISTING `errors` namespace across `shared/locale/types/errors/index.ts`, `shared/locale/en/errors/index.ts`, `shared/locale/ar/errors/index.ts` (MessageSchema parity = compile gate): at minimum `notificationNotFound`; the list validates `notifications.*` filter/pagination failures with the existing generic validation keys where possible (NO near-duplicate keys).

- **REQ-052 (UI Namespace — `notifications`)**: WHEN the frontend ships THEN a new `notifications` UI namespace SHALL be registered per the full `shared/locale/AGENTS.md` procedure (types interface + `en` + `ar` + MessageSchema entry + namespace-paths registration), covering: feed page title/empty state/error state, type labels for all 7 `NotificationType` values (display names localized), filter labels, mark-read affordances, badge aria strings (incl. pluralized unread-count function), realtime toast template, WS state copy (reconnecting/failed silently-recovered) — property access only.

- **REQ-053 (Code Mapping Table)**: WHEN errors map to semantics THEN: anonymous → `UNAUTHORIZED` (scopeAuth); bad filter/pagination/enum input → `VALIDATION` (422 class); foreign/missing notification id → `NOTIFICATION_NOT_FOUND` (404 class, oracle-safe); WS handshake failures NEVER surface through GraphQL (socket close codes 4401/4429/4009/1001 documented as the WS contract); unexpected → masked `INTERNAL_SERVER_ERROR`.

- **REQ-054 (Boundary Validation Matrix)**: WHEN inputs are validated THEN: `limit` ∈ [1,50] (else `VALIDATION`); `offset` ≥ 0 safe-integer; `id` positive safe integer via the ID-channel type guard (no `as number` casts); `type` via enum guard; emit `title` non-empty ≤255; `relatedEntityType`/`relatedEntityId` co-presence; ALL failures occur BEFORE any DB access, with localized messages.

- **REQ-055 (No Silent Paths)**: WHEN any branch runs THEN there SHALL be no swallowed errors and no bare `catch {}`: publish failures log structured warn and degrade (REQ-011) — a documented, deliberate "expected degradation" rather than silence; validation never produces default-success on bad input; WS subsystem errors always terminate the offending connection with a logged policy code.

- **REQ-056 (Seed Parity — No Changes)**: WHEN seeds run THEN no seed modifications occur in this ticket; engine behavior SHALL be verified exclusively via `entity-setup.ts`-built fixtures (never seed rows), and `bun db seed` SHALL remain green unchanged.

### 2.6 GraphQL & Frontend Contracts

- **REQ-060 (GraphQL Surface — Exact Contract)**: WHEN the schema is built THEN it SHALL expose EXACTLY:
  ```graphql
  type Notification {
    id: ID!
    type: NotificationType!
    title: String!
    body: String
    isRead: Boolean!
    relatedEntityType: String
    relatedEntityId: Int
    createdAt: DateTime!
  }
  type NotificationListPage {
    items: [Notification!]!
    totalCount: Int!
    hasMore: Boolean!
  }
  input MyNotificationsFilterInput {
    type: NotificationType
    isRead: Boolean
    limit: Int
    offset: Int
  }
  extend type Query {
    myNotifications(filter: MyNotificationsFilterInput): NotificationListPage!
    myUnreadNotificationCount: Int!
  }
  extend type Mutation {
    markNotificationRead(id: ID!): Notification!
    markAllNotificationsRead(type: NotificationType): Int!
  }
  ```
  `NotificationPothosObject` SHALL be the single canonical object backed by `NotificationReturnType` with `id` exposed FIRST (Apollo normalization); `NotificationType` SHALL be registered ONCE in `backend/graphql/pothos/shared/enum.pothos.ts` via the enum-object form from the canonical TS enum; authScopes on all four operations = `{ authenticated: true }` per REQ-032; resolvers SHALL be thin (validation-free beyond bounded guards — services own it) with full `ctx.locale` propagation; the public-operation allowlist SHALL remain unchanged (default-deny preserved).

- **REQ-061 (Resolver/File Placement & Codegen Discipline)**: WHEN implementation completes THEN resolvers/objects SHALL follow placement conventions (`backend/graphql/pothos/notifications/` + `backend/graphql/query/notifications/…` / `mutation/notifications/…` + barrel side-effect wiring per gateway Rule 8); NO `await import()` anywhere in resolver trees; AFTER all changes `bun run generate:gqlSchema && bun codegen` SHALL run and generated artifacts SHALL be committed in the same change set.

- **REQ-062 (Frontend Documents)**: WHEN documents are authored THEN a new `frontend/graphql/sharedDocuments/notifications/notification.documents.ts` (+ sub-barrel + top-level barrel export) SHALL define `myNotificationsQueryDocument`, `myUnreadNotificationCountQueryDocument`, `markNotificationReadMutationDocument`, `markAllNotificationsReadMutationDocument` as `gql` `TypedDocumentNode`s imported from `@apollo/client` with `id` in every object selection; hooks from `@apollo/client/react` ONLY and `useQuery` stateful ONLY (NO `useLazyQuery`); consumers use codegen types directly (no inline literals, no mapping layers, no indexed-access workarounds).

- **REQ-063 (Notification UI — Feed Page + Badge + Realtime Hook)**: WHEN the UI ships THEN: (a) a feed page at `app/(dashboard)/notifications/page.tsx` (Server Component, `withPageAuth`-authenticated-all-roles posture, `getTranslations(locale)` shell, delegating to a client container at `frontend/views/notifications/…`); (b) the client feed renders filter chips (type + read state), list, mark-read per-row + mark-all action, empty state, error state (`PermissionDeniedFallback`-family / retry), loading skeletons — ALL via MUI v9 `sx`-only styling, `theme.palette.*` colors, `*Outlined` icons, RTL-correct logical properties, text-only rendering (REQ-028 — `dangerouslySetInnerHTML` PROHIBITED, static-assertion enforced); (c) an app-bar badge + dropdown (existing app bar conventions) driven by `myUnreadNotificationCount`; (d) a new `useNotificationRealtime` hook (client) owning WS lifecycle per REQ-025 with the realtime event merging into Apollo cache + a localized toast for incoming `notification` frames (via the existing GraphQLErrorSurfaceHost-adjacent snackbar conventions, never a competing global listener); NO new Zustand store (feed truth = Apollo cache; connection state is local React state) and NOTHING inside `persist` (non-serializable socket handles banned).

- **REQ-064 (Graceful Degradation Contract)**: WHEN the WS layer is unavailable (sidecar down, handshake rejected, offline) THEN the UI SHALL silently continue on the existing polling posture (count refetch cadence per `NOTIFICATION_COUNT_POLL_INTERVAL_MS` + idle/visibility pause conventions from `frontend/AGENTS.md`), surface NO alarming UI (at most a quiet reconnecting affordance), and converge to truth on refetch; a logged-out/401-token-expired socket SHALL close without retry loops (leverage the existing auth-refresh surface for re-auth flow parity).

- **REQ-065 (Per-Audience Rendering)**: WHEN notifications render THEN: student/teacher/parent/admin all see the SAME inbox component with the same mechanics (content differs only by what emitters wrote to them); no role sees cross-user data; the route is reachable from each role's navigation per existing nav conventions; applicants (role teacher, uncertified) receive surface parity (they may receive `evaluation_result` later).

- **REQ-066 (Responsive & RTL Matrix)**: WHEN the feed renders THEN: desktop (1440px) full list + filters inline; tablet (768px) stacked filters; mobile (375px) list-first layout with collapsed filter affordance; full bilingual (en/RTL-ar) rendering with logical properties and mirrored affordances; component test coverage SHALL assert both locales for headers/empty states/aria strings with translation-driven matchers ONLY (zero hardcoded strings).

- **REQ-067 (WS Connection Ownership)**: WHEN the app boots THEN at most ONE realtime socket per tab SHALL exist (the hook is mounted once at the authenticated shell level); tab close/route transition SHALL close the socket deterministically (close 1000); no duplicated listeners/toasts on remount (tested).

- **REQ-068 (Error Consumption Contract)**: WHEN frontend consumers handle failures THEN they SHALL branch on `extensions.code` ONLY via the existing `mapGraphQLErrorByCode`/errorLink contract (never HTTP status for GraphQL), field errors project via existing `fieldError` utilities where relevant, and masked 500s SHALL surface correlation guidance per the existing mapping.

- **REQ-069 (GraphQL Depth/Complexity Posture)**: WHEN the schema surface is reviewed THEN all fields SHALL be flat scalars/enum on one object with a bounded list payload (hard `limit` cap 50); no self-referential or recursive shape exists; batching abuse is structurally trivial (no N+1 possible by construction).

### 2.7 Test Coverage

- **REQ-070 (Coverage Bar)**: WHEN tests are written THEN ALL new repository/service/WS-sidecar modules SHALL reach 100% statement and branch coverage on new code (`bun test --coverage` evidence in outcomes): every guard branch (validation, enum guard, pairing), every failure class, both transports, connection-cap behaviors, publish-after-commit ordering paths.

- **REQ-071 (DB Test Discipline)**: WHEN DB tests execute THEN every test SHALL run inside `runInRollback`, pass `tx` to EVERY repository/Drizzle call (param positions verified), create ALL entities via `entity-setup.ts` helpers (never seed data), assert failures via the `expectRepoError` try/catch helper on translated-message substrings (never raw keys), NEVER use `expect(...).rejects.toThrow()` inside `runInRollback`, and run via `bun run scripts/run-test/run-test.ts <path>` (never raw `bun test` for DB-bound suites).

- **REQ-072 (Repository & Service Tiers)**: WHEN the suites run THEN they SHALL prove: list filters/type/read/pagination bounds + `totalCount`/`hasMore` coherence; mark-one (idempotent doubles; foreign id → NOT_FOUND via oracle-safe assertion); mark-all (+type-filtered variant, empty-set zero); unread counting; batch emit single-transaction semantics + one `now` per batch; idempotent emit key (dup suppressed, distinct keys independent); emit under cache outage (fail-open persists + warn logged); ghost-push impossibility via forced OUTER-tx rollback (zero rows, zero published messages via spied transport).

- **REQ-073 (WS Sidecar Tier)**: WHEN the sidecar is tested THEN: handshake matrix (valid cookie→connected; missing/tampered/expired token→4401; bad Origin→rejected; query-string token attempt→rejected); per-user cap eviction (oldest closes 4009); heartbeat liveness termination on missed pongs; push routing ONLY to the target user's sockets (two users connected, one pushed — the other provably silent); malformed bus payload dropped without socket disruption; graceful shutdown closes with 1001 + reconnect-safe client state; bound enforcement on registries; ALL via a dedicated harness booting the sidecar on an ephemeral port with native `WebSocket` clients (no Playwright needed for this tier).

- **REQ-074 (GraphQL Integration Tier)**: WHEN integration tests run via `setupTestServerLifecycle` + `testClient` THEN they SHALL prove: anonymous → `UNAUTHORIZED` on all four operations; each authenticated role reads ONLY own inbox (cross-user isolation matrix); filter→content coherence over wire; mark flows with `extensions.code` assertions per REQ-053 (via `CombinedGraphQLError`s/`expectMutationError` helpers); schema contains ZERO notification-CUD mutations (BFLA structural verdict) and `Notification` object carries `id`.

- **REQ-075 (Component Tier)**: WHEN component tests run (Happy DOM + Apollo mocks + `translation-preload.ts` + `readTranslation(handle, locale)` + shared `TestWrapper locale`) THEN they SHALL cover: populated feed / empty state / filter chips / unread badge pluralization fn / mark-one + mark-all states / error & loading skeletons / RTL rendering / incoming-realtime toast path (mocked hook event) — zero hardcoded strings.

- **REQ-076 (Chaos/Concurrency Tier)**: WHEN chaos tests run THEN: concurrent mark storms all-resolve consistent (REQ-044); parallel emits preserve full row-set ordering invariants; reconnect flicker storm (close↔open × N) ends in exactly-one live connection with no duplicated toasts; fuzz on pagination/id/type inputs (boundary + hostile strings incl. wildcard/unicode payloads in `title`/`body` asserts literal-text storage + safe render).

- **REQ-077 (Cross-Actor Journey Tests — MANDATORY)**: WHEN this ticket's engine bridges actors THEN journey tests SHALL exist at `test/workflows/notifications/` per Section 2.9, written TEST-FIRST against the real services + real test DB with committed fixtures in `beforeAll` + tracked hard-delete in `afterAll` (NO `runInRollback` — services own their transactions), side effects (WS publish) spied NOT sent, and permissions resolved HONESTLY through real context/user setup (never monkey-patched); BECAUSE `test/workflows/` does not exist in the packaged codebase, this ticket SHALL ALSO scaffold the layer: `test/workflows/AGENTS.md` (the rules below) + shared journey helpers (fixture registry, actor-context factory, cleanup tracker or a small `TrackedFixtures` helper) so this and all future journey suites share one harness.

- **REQ-078 (Baseline & Quality Gates)**: WHEN the ticket completes THEN `bun tsgo`/`biome:check`/lint counts SHALL equal baseline + 0 new errors; `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` SHALL exit 0 for every created/modified file; codegen artifacts SHALL be committed; `git diff` on schema/migration paths SHALL be empty (REQ-048); env-config registry diffs SHALL match REQ-049; and the journey + WS suites SHALL pass deterministically across two consecutive runs.

- **REQ-079 (CI Wiring)**: WHEN the ticket completes THEN the new suites SHALL be picked up by existing test runners (db/services suites via their existing globs; WS suite registered under an existing or minimally-extended runner script; journey suite registered per its new `test/workflows/AGENTS.md`) — CI topology itself is NOT restructured (no new GitHub-check job; additions slot into existing scripts).

### 2.8 Documentation & Knowledge Gates

- **REQ-080 (Canonical Doc)**: WHEN knowledge propagation runs THEN `docs/notifications/realtime-engine.md` SHALL be created (Why → Pattern → Rules → What NOT to Do → Rollout Summary → Related Documents) covering: the persist-first/push-second rule, publish-after-commit composition (incl. the caller-tx receipt pattern), emit contract + localization boundary (engine never translates), WS handshake security model (cookie + Origin, close codes), backplane port + both transports + fail-open-on-push-failure ruling, catch-up self-healing (DB truth + refetch), connection-cap policy, bounded-state exceptions, and the consumption guide for DEV3-011/DEV1-016/DEV1-017/DEV2-016/DEV3-012/013/DEV3-022d.

- **REQ-081 (Decisions & Invariant Anchoring)**: WHEN propagation runs THEN the canonical doc SHALL bind Decision A.4 (the table this engine serves) and record the ticket's reconciliation addenda in `docs/specs/open-decisions-and-gaps.md`'s addendum style: (i) WS-via-sidecar topology ruling, (ii) emit-fail-open vs booking-fail-closed distinction for idempotency, (iii) copy-localization-at-emitter ruling + the `users.locale` forward gap. NO new state-machine invariants are minted (notifications have no lifecycle beyond the one-way read latch — explicitly documented rather than INV-numbered); INV-P3 (parent session-completion notification) is referenced as ENABLED-BY this engine with emitters in follow-ups.

- **REQ-082 (AGENTS.md & Cross-Links)**: WHEN propagation runs THEN: `backend/services/AGENTS.md` gains a 1–2 line engine rule + doc link; `backend/db/repo/AGENTS.md` gains the guarded self-scope update note; `test/workflows/AGENTS.md` is authored (NEW — cross-actor journey layer rules); root `AGENTS.md` Important References gains one line for the canonical doc; a forward-link comment SHALL be added to `docs/workflows/03-session-lifecycle-escrow.md`'s notification references ONLY if the existing file's edit style permits without churn (else captured in the canonical doc's related-docs).

- **REQ-083 (Outcome & Deferred Gate)**: WHEN the plan closes THEN every task SHALL have `outcome/<task-id>-outcome.md`; the plan-review gate (`outcome/plan-review-R1.md`) SHALL predate implementation; `grep -c "❌\|⚠️" ai/plans/dev3-010-realtime-notification-engine/deferred-items.md` SHALL equal 0 EXCEPT the explicitly pre-seeded forward items D1–D4 (each with its owning ticket recorded, non-blocking per the ledger template); and the final baseline comparison SHALL show zero NEW errors.

### 2.9 Cross-Actor Workflow Scenarios (Journeys)

The engine is actor-bridging by nature (events produced in one actor's domain lands in another actor's inbox). These journeys are REQUIREMENTS on observable shared state, from the OBSERVER's perspective. Each maps 1:1 onto a `test/workflows/notifications/<journey>.test.ts` suite written TEST-FIRST, calling REAL services against the REAL test DB (committed fixtures, tracked hard-delete cleanup, spied publish side-effects — never runInRollback per the new `test/workflows/AGENTS.md`).

**Actor Table:**

| Actor | Role / Auth | CAN do | CANNOT do |
|---|---|---|---|
| Engine Emitter (system, invoked by future domain services; simulated in tests via `emitForUser`/`emitForUsers` service calls) | server-internal | persist + fan out to any userIds | never callable via GraphQL; never mutates read flags |
| Teacher (certified or applicant fixture) | `role = teacher`, authenticated | read own inbox, mark own rows | read/mark others' rows; receive nothing not emitted to them |
| Student | `role = student`, authenticated | read own inbox, mark own rows | read teacher/parent rows; trigger emits |
| Parent | `role = parent`, authenticated | read own inbox (INV-P2 read-only respected), mark own rows | read child data directly; see rows emitted to a child |
| System (journey harness) | fixtures + assertions | set up committed fixtures, spy on fan-out transport | — |
| Anonymous caller | unauthenticated | nothing | all four inbox ops → `UNAUTHORIZED`; WS handshake → 4401 |

**Journey J1 — Targeted Single-Recipient Delivery (teacher request notification):**

Ordered steps (actor → action → expected shared state):

1. System: commit fixtures — student + certified teacher users (tracked IDs) → both have ZERO inbox rows.
2. Teacher (as observer): `myNotifications` ⇒ empty page, `myUnreadNotificationCount` ⇒ 0.
3. Emitter (acting on behalf of a future DEV3-011 session-request event): `emitForUser({ userId: teacher, type: session_request, title/body pre-localized, entityRef: { type: "session", id } })` ⇒ ONE persisted row for teacher, `is_read=false`.
4. Teacher (observes): unread count ⇒ 1; first page shows the row with correct type/entity ref; and the spied fan-out transport observed EXACTLY ONE publish addressed ONLY to teacher.
5. Student (observer, denial): own inbox stays EMPTY; badge stays 0 (proves no accidental fan-out).
6. Teacher: `markNotificationRead(id)` ⇒ row read; badge back to 0; `isRead=true`.
7. Teacher: `markNotificationRead(id)` AGAIN ⇒ idempotent success, no drift.
8. Parent outsider: `markNotificationRead(teacherRowId)` ⇒ `NOTIFICATION_NOT_FOUND`; teacher row UNCHANGED (oracle-safe mutation denial).
9. Teacher reconnects (simulated drop): catch-up refetch ⇒ identical list (no duplication/loss).

**Journey J2 — Cohort Broadcast Fan-Out + Offline Persistence (system_broadcast to parents):**

1. System: fixtures — 2 parents + 1 teacher (tracked).
2. Emitter: `emitForUsers([parentA, parentB], type=system_broadcast, …)` ⇒ exactly 2 rows atomically; transport publish carries BOTH ids in ONE publish call.
3. Parent A (online, spied socket-path): observed realtime message with correct payload and ONLY her copy addressable.
4. Parent B (offline): NO push observed; row persisted `is_read=false`.
5. Parent B later: list ⇒ row present; unread ⇒ 1 ⇒ `markAllNotificationsRead(system_broadcast)` ⇒ affected count = 1; badge = 0.
6. Teacher (denial): inbox stays EMPTY for broadcast (BFLA of fan-out targeting honesty); cannot read/mark any parent row.
7. Emitter replays same idempotency key back-to-back ⇒ NO new rows; exactly-2 invariant holds; idempotency honored; a DIFFERENT key emits fresh rows.
8. Anonymous: every inbox op = `UNAUTHORIZED` (401-class), consistent shape.

**Cross-Actor EARS Acceptance Criteria:**

- **REQ-J1**: WHEN the emitter emits to the teacher THEN the teacher SHALL observe (read query) exactly one new unread row AND the student SHALL observe zero changes AND the parent outsider SHALL be denied with an oracle-safe code on mark.
- **REQ-J2**: WHEN a cohort fan-out executes THEN each parent SHALL observe their own persisted row, the teacher SHALL observe NO row, the offline parent SHALL later observe the persisted row on first read, and marking SHALL mutate ONLY that parent's own rows.
- **REQ-J3**: WHEN transport publishes are spied THEN a SAME-key replay SHALL produce zero additional rows AND zero additional pushes for prior receipts, observable by all affected actors' inboxes staying stable.
- **REQ-J4**: WHEN any actor who is NOT the row's owner attempts to read or mutate THEN the system SHALL respond oracle-safely (NOT_FOUND) or with `UNAUTHORIZED`, and the owner's row SHALL remain byte-identical.
- **REQ-J5**: WHEN the journeys execute THEN the `test/workflows` harness SHALL show committed fixtures torn down in `afterAll` with zero residue (verified by existence checks), and permissions SHALL resolve via real user fixtures (never stubs).

---

## 3. System Decisions & State Machine Invariants Alignment

### Decision References (`docs/specs/open-decisions-and-gaps.md`)

| Decision | Relevance to DEV3-010 | Binding Requirement |
|---|---|---|
| **A.4 (notifications table created)** | The entire ticket executes ON this table (the engine's durable inbox); zero schema change, verified by REQ-004/048. | REQ-004, REQ-010, REQ-048 |
| **A.1 / A.2 (parents; parent_id FK)** | Parent recipients exist as first-class users; parent inboxes behave identically (Journey J2). | REQ-017, REQ-030; §2.9 |
| **B.12 / B.13 / B.14 (parent link shape)** | Affect only WHAT future emitters emit (e.g., `parent_link_request`), not the engine's mechanics — the engine is content/type agnostic beyond the enum gate. | REQ-014, REQ-015 |
| **B.10 (on-demand matching)** | Latency matters socially (session requests); implemented as sub-second push + self-healing catch-up. | REQ-021, REQ-025 |
| **docs/IDEMPOTENCY.md** | Notification events are outside the mandated key-set (Student/Invoice/Class/Payment create); the engine nevertheless offers optional emitter-key dedupe with a deliberately FAIL-OPEN mode (documented deviation: persistence/never-blocking-domain-events wins over strict duplicate prevention). | REQ-016, REQ-081 addendum |
| **DEV2-003 Contract 5 (Session Event Notifications)** | `SessionEventNotificationContract` is CONSUMED (its field vocabulary maps into `NotificationEmitInput`); no re-definition; honoring "isRead is system-set; userId server-resolved" rules from the contract registry. | REQ-003, REQ-015 |
| **Gateway routing rules (DEV3-003)** | GraphQL ops follow the registration contract (barrel + authScopes + codegen in the same commit); the WS sidecar is explicitly NOT an `app/api` surface (its internal endpoints/health are process-internal, documented exemption to `ROUTE_INVENTORY` gating). | REQ-032, REQ-061 |
| **Pre-existing multi-channel notification infra** | `CommunicationService`/preferences/deliveries remain the OTHER channel pipeline; D4 integration is forward-deferred; REQ clauses forbid entangling now (no mixed writes). | REQ-010, Non-goal 3, §2.9-scope note |

### State Machine & Lifecycle Invariants (`docs/specs/state-machine-invariants.md`)

| Invariant | Treatment |
|---|---|
| **INV-S1..S8 (session)** | UNAFFECTED — engine never writes session rows; only FUTURE emitters reference session ids inside `related_entity_*` opaque pointers. |
| **INV-B*/W*/PAY** (billing/wallet/payments) | UNAFFECTED — zero writes. |
| **INV-P2 (parent read-only)** | UPHELD — parents receive rows but cannot create/modify notification state beyond their own read latch; their inbox UI is read-only content + mark-read. |
| **INV-P3 (child session completion → parent notified)** | ENABLED (substrate exists); EMITTERS ship in DEV1-016/017 (forward binding recorded). |
| **INV-U* (governance)** | Respected via fail-closed context parity (REQ-038); no governance mutation exists here. |
| **NEW lifecycle invariants** | NONE introduced — deliberate: the notification row has no state machine (append-only + one-way is_read latch). This absence is DOCUMENTED in the canonical doc so reviewers don't confuse it for an omission. |

### Canonical Workflow Alignment (`docs/workflows/`)

- **Workflow 02 (On-Demand Matching)**: request latency assumptions are satisfied via WS push + catch-up; presence/locking remains DEV2-011/012/013 + DEV3-004 territory.
- **Workflow 03 (Session Lifecycle & Escrow)**: the dual-confirmation/completion notifications hang off future emitters (DEV3-012/013 → parent + participants); the engine guarantees their rows durable and their pushes immediate-but-best-effort.
- **Workflow 04 (Parent Supervision Handshake)**: `parent_link_request` is a first-class type the engine already supports; emitters land with the linking ticket.
- **Workflow 05 (Admin Governance Override)**: broadcasts become admin-surfaced in DEV3-022d; the engine pre-ships ONLY the internal primitive (REQ-027) and the audit coupling remains the admin surface's obligation (A.5 untouched here).

### Architectural Standards

- **Error handling**: producer-side per `docs/graphql/domain-error-extensions-code.md`; transport/masking/dev boundaries per `docs/graphql/error-handling-contract.md`; NO HTTP-status branching on the client (REQ-068).
- **GraphQL/Pothos**: enum registered once (object form), `id` on the canonical object, scope wiring per `docs/auth/jwt-authentication-service.md` (`authenticated`), codegen per change set; DataLoader explicitly N/A (flat rows).
- **Drizzle/DB**: parameterized single-statement writes; `tx` convention; zero schema/migration drift; no prepared statements needed (all queries are dynamic filtered variants; `inArray` not used by repo methods in this ticket).
- **Testing**: unit (pure guards/validation), service (mocked transports), DB (runInRollback), GraphQL integration (harness+testClient), WS sidecar (ephemeral-port harness), component (Happy DOM + translation preload), journey (new `test/workflows/` layer) and chaos tiers; coverage per REQ-070.

---

## 4. Cross-Layer Traceability Matrix

| Requirement ID | Decision Ref / Invariant | Backend Service / Repo | GraphQL Mutation/Query | Frontend View | Test Coverage |
|---|---|---|---|---|---|
| REQ-001..004 | Baseline protocol; A.4/DEV1-001 presence verify; DEV2-003 contract substrate | Verify-only audits + deferred-items ledger | — | — | `outcome/phase0-baseline-outcome.md`; plan-review gate |
| REQ-002/051/052 | i18n rules (`shared/locale/AGENTS.md`) | `getServerTranslations(locale, "errors")` + errors key additions | resolver `ctx.t` discipline | `Translation.Notifications` property consumption | MessageSchema parity compile gate; component tests via translation-preload |
| REQ-003 | Canonical types discipline | `backend/types/notifications/notification.types.ts` (additive); contracts consumed | Pothos object/input backed by canonical types | codegen types direct | `tsgo` gate; review-types wave |
| REQ-010/011/013/043 | REQ single-writer rule; persist-first | `NotificationEngine.emit*`; `NotificationRepository.create*` additive | — (internal) | — | REQ-072 service/DB suites (fan-out atomicity, single publish, rollback safety) |
| REQ-012/042 | Publish-after-commit invariant | Receipt-type composition + caller-tx contract | — | — | forced-rollback test: zero rows AND zero publishes |
| REQ-014 | Enum single source (`enums.ts` byte-sync) | Guard function + value-import discipline | `NotificationType` Pothos enum (object-form registration) | Codegen enum consumers | Static assertion on enum byte-parity; negative-value probes |
| REQ-015/021 | Contract 5 consumption; payload minimalism | Emit validation + WS message builders | — | Realtime toast consumes `data` only | Contract-shape unit tests; payload-field allowlist assertion |
| REQ-016 | Idempotency doc deviation ruling | Cache claim adapter (mocked in service tests) | — | — | dup-key suppression; outage fail-open; new-key fresh emit |
| REQ-017/026 | BOLA self-scope; parameterized predicates | `listForUser`/counts with dynamic wheres; index-backed read paths | `myNotifications` | Feed page (filter chips) | DB matrix — filters/pagination/totalCount coherence; wire integration |
| REQ-018 | Existing polling-posture interplay | `countUnread` repo method | `myUnreadNotificationCount` | App-bar badge | DB + integration + badge component tests incl. pluralization |
| REQ-019/029 | Append-only + oracle-safe latch | guarded `UPDATE … WHERE id AND user_id RETURNING` | `markNotificationRead` | Per-row action | idempotent double-mark; foreign→NOT_FOUND; zero-write probe |
| REQ-020 | Set-based one-statement bulk | `markAllReadForUser(type?)` | `markAllNotificationsRead` | Mark-all action | affected-count assertions; empty-set zero; filtered variant |
| REQ-022/033/034 | DEV2-001 verify failures return null; CSWSH | WS sidecar handshake module (cookie read via upgrade headers + Origin check + throttle) | — | `useNotificationRealtime` handshake client | REQ-073 handshake matrix; query-token rejection; throttle probe |
| REQ-023/046 | Bounded-state sanctioned exception | Connection registry + caps + heartbeat + shutdown | — | — | cap eviction 4009; heartbeat timeout; graceful 1001; bounds assertions |
| REQ-024/045 | Env-config registry; transport port | `NotificationFanoutTransport` port + 2 adapters (Redis pub/sub, in-process) | — | — | both adapter tiers; malformed payload drop; redis reconnect behavior |
| REQ-025/064 | Self-heal-by-refetch design | — | count/list refetch contracts | hook backoff + catch-up + silent degradation | reconnect flicker storm; dedupe by id; no-toast-storm assertion |
| REQ-027/032 | BFLA containment of fan-out | `emitForUsers` internal only; grep-no-resolver-import evidence | ZERO create-mutations allowed | — | BFLA structural scan + anonymous 401 on all ops |
| REQ-030/031 | BOLA/IDOR, BOPLA whitelist | identity from `ctx.user.id`; explicit field mapping | input surfaces minimal by construction | — | REQ-074 cross-user isolation matrix; smuggled-field ignore tests |
| REQ-035/039 | Error-disclosure rules | localized generic copy; constant shapes | `extensions.code` contract | via errorLink mapping | denial-shape constancy across probes |
| REQ-036 | Limit posture precedent | pagination caps; per-IP handshake bucket | — | — | cap boundary tests; bucket-exhaust close |
| REQ-037 | Logging rules | `logger.logDomainError`/`logger.error` only | — | frontend `logger` warns only | static scan (no `console.*`); log-context field caps |
| REQ-038 | INV-U*/DEV2-001 boundaries | no governance logic here | relies on existing context | — | governed-account denies via integration suite |
| REQ-040/041 | tx/atomicity rules (DEV1-002/004 precedents) | repo `tx?: DBTransaction` LAST param; single statements | — | — | tx-propagation verification; single-statement assertions |
| REQ-047 | Time discipline | one `now` per batch + DB defaults | — | — | sibling-row identical timestamps; order tiebreak by id |
| REQ-048 | Zero-drift policy (`docs/DATABASE_MIGRATIONS.md`) | — (schema untouched) | — | — | `git diff backend/db/schema/**` empty gate |
| REQ-049 | env-config registry conventions | config module + invalidation parity | — | — | registry inclusion test; invalidation coverage |
| REQ-050/053/055 | DEV3-002 taxonomy + masking | `NotFoundError("NOTIFICATION", …)` etc. | `extensions.code` assertions | errorLink code-only behavior | code matrix tests; no-silent-path scan |
| REQ-060..062 | Pothos conventions + codegen doctrine | `pothos/notifications/*`, query/mutation subtrees | REQ-060 SDL exact | documents per REQ-062 | schema snapshot; codegen diff committed; doc naming static checks |
| REQ-063/065/066/067 | MUI v9/RTL/a11y; single-socket ownership | — | — | `frontend/views/notifications/…` + app-bar badge + hook | component matrix (both locales); dangerouslySetInnerHTML-scan; remount dedupe |
| REQ-068 | DEV3-002 client contract | — | — | errorLink branching via code | mapping assertions reuse + notification-specific paths |
| REQ-069 | Depth/complexity hygiene | flat object by design | capped list payload | — | depth/static schema review |
| REQ-070..079 | Test pyramid + quality-loop rules + journey layer | `backend/db/test/logic/notifications/*`, service tests, WS suite, integration | `test/workflows/notifications/*` + scaffolding | component tier; no E2E requirement beyond page smoke | coverage reports; deterministic double-runs; CI pickup verified |
| REQ-080..083 | Knowledge-propagation protocol | `docs/notifications/realtime-engine.md` + decisions addendum + AGENTS one-liners | — | — | doc-structure checklist; `test/workflows/AGENTS.md` authored; deferred gate grep = 0 minus D1–D4 |

**Traceability note for consumers:** DEV3-011 (session-request wave), DEV1-016/017 (parent completion consumption + portal), DEV2-016/017 (evaluation_result emitters), DEV3-012/013 (cancellation/payment_confirmation emitters), DEV3-022d (broadcast admin surface over `emitForUsers`), and DEV2-011/012/013 (availability — MUST NOT reuse the WS sidecar for presence) SHALL reference these REQ ranges in their traceability matrices, SHALL import the engine's emit contracts rather than writing `notifications` rows directly, and SHALL honor the publish-after-commit composition (REQ-012) whenever they carry their own transaction. Violations are caught at Phase-1.5 plan review and by the single-writer static scans registered in this ticket's test suite.

---

**End of Specification — DEV3-010.** Ready for `ai/plans/dev3-010-realtime-notification-engine/plan.md` (Phase 2 design), gated by `@plan-review` (Phase 1.5) before any implementation begins.
