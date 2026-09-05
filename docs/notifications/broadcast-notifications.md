# Admin Broadcast Notifications (System-Wide & Targeted)

Provenance: shipped as DEV3-022d ("Broadcast Notifications — System-Wide & Targeted"). Composes on the real-time notification engine (`docs/notifications/realtime-engine.md` — DEV3-010) as its `system_broadcast` emitter, and on the admin governance substrate (shared `assertActorAdmin` gate, in-tx audit writer).

## 1. What it is

An admin composes a free-text announcement (title ≤ 255 chars, optional body) addressed to one audience cohort. On accept, exactly one `system_broadcast` notification row per resolved recipient is inserted through the engine's emit path, exactly one audit row records the composition, and a real-time publish fan-out reaches connected recipients. Recipients observe the broadcast in their own self-scoped inbox (`NotificationEngine.listMyNotifications`), identical in shape to every other notification — broadcasts are NOT a separate read surface.

Live surfaces:

| Layer | Artifact |
|---|---|
| GraphQL mutation | `adminBroadcastNotification(input: AdminBroadcastNotificationInput!): Int!` — returns the persisted-recipient count (`backend/graphql/mutation/notifications/admin-broadcast.mutation.ts`) |
| Page | `/admin/broadcasts` (Server Component guarded by `withPageAuth({ roles: [UserRole.Admin] })` → `app/(dashboard)/admin/broadcasts/page.tsx`; compose UI in `frontend/views/admin/broadcasts/`) |
| Service | `AdminBroadcastService.broadcast` — the atomic composition core (`backend/services/notifications/admin-broadcast.service.ts`) |
| Repository | `BroadcastAudienceRepository.resolveAudienceIds` — cohort resolution (`backend/db/repo/notifications/broadcast-audience.repository.ts`) |
| Claim cache | `RedisClaimCache` + `resolveBroadcastClaimCache` (`backend/services/notifications/redis-claim-cache.ts`) |
| i18n | `AdminBroadcasts` namespace (en/ar, Arabic CLDR plurals for the count) + dashboard `broadcasts` nav label |

## 2. Cohort taxonomy — frozen at four kinds

`BroadcastAudienceType` is a TS-only enum (`All="all"`, `Role="role"`, `Country="country"`, `Plan="plan"` — `backend/enum/notifications/broadcast-audience-type.enum.ts`). There is deliberately NO `pgEnum` in `backend/db/schema/` — the taxonomy lives in code only, so adding a fifth kind is a code change with zero schema migration. The audience selector is a closed, type-discriminated shape: each kind carries exactly its own companion (role / country / planId) and the coherence matrix rejects any cross-kind companion presence before the database is touched.

Resolution semantics (`resolveAudienceIds`, tx and raw-SQL branches kept semantically identical):

- **all** — every user passing the governance predicate.
- **role** — every governed user whose `users.role` equals the selector role.
- **country** — every governed user whose `users.country` equals the selector country by EXACT equality (trimmed upstream; no LIKE/ILIKE — case-sensitive by design, and fully parameterized in both branches).
- **plan** — every governed user who is an active-window OWNER of a subscription to the plan. Ownership resolves on the generic `subscriptions.user_id` FK (not a student-specific join): a teacher holding a verification-plan subscription counts. "Active window" reuses the canonical active-subscription semantics byte-for-byte (`status='active' AND start_date <= now() AND (end_date IS NULL OR now() < end_date)` — cf. `studentHasActiveSubscriptionSubquery` in `backend/db/repo/admin/admin-user-query-helpers.ts`); an unknown plan id fails closed with a scoped, localized error before any write.

**Governance exclusion ruling.** Cohorts exclude soft-deleted (`isDeleted`) and blocked (`isBlocked`) users in BOTH resolution branches. **Suspended users are deliberately INCLUDED** — suspension is a permission-level sanction, not an identity deletion, and system announcements must reach suspended accounts (their session-level restrictions are enforced elsewhere). This inclusion is invariant-pinned (`docs/specs/state-machine-invariants.md` INV-U1/U2/U4 posture) and mirrored by the governance test battery.

**Ordering/dedup.** The plan cohort applies `SELECT DISTINCT … ORDER BY id ASC` (the subscriptions join can fan out); the single-row-per-id cohorts rely on the PK. Recipient order is deterministic in both branches.

## 3. Authorization — the double wall

1. **Outer wall (GraphQL):** the mutation registers `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` — enforced from the JWT/actor claim before any resolver body.
2. **Inner wall (service):** `assertActorAdmin` re-verifies the actor against the LIVE `users` row (`backend/services/admin/admin-gate.helpers.ts`), pre-transaction.

Denial ordering is strict: validation → gate → claim → cohort read → writes. A denial (non-admin role, missing actor, validation defect, empty cohort, cap breach, unknown plan) produces **zero rows, zero audit, zero publishes** — nothing is written before the gate passes, so denial and acceptance are never distinguishable by side effects. Known substrate residual: the inner wall re-verifies `role` only (a soft-deleted/blocked admin with a still-valid short-TTL token passes both walls until refresh re-checks governance) — inherited from the admin-governance substrate, ledgered as the deferred governance-hardening item.

## 4. Idempotency — header contract, claim cache, replay

**Header contract.** The compose surface mints one UUID per compose session and sends it as the `X-Idempotency-Key` HTTP header — the key rides HEADERS ONLY, never the input DTO, so the GraphQL schema carries no idempotency field. The key rotates ONLY after an accepted send (failed submits retry under the same key so the server-side dedupe stays effective). The frontend's authLink merge forwards the header additively without clobbering fixed keys.

**Claim cache.** `resolveBroadcastClaimCache()` returns `undefined` unless `REDIS_URL` is configured (hermetic/test default — the engine then proceeds fail-open with its single documented degrade warn and emits anyway). With Redis, a lazily-constructed shared ioredis client backs `SET NX EX` claim semantics (`RedisClaimCache`), bounded by 2s `commandTimeout`/`connectTimeout` so a silently dropping Redis cannot hold the caller's open transaction; timed-out commands reject into the engine's fail-open path.

**Replay semantics.**
- Two SEQUENTIAL same-key submits with the same intent ⇒ exactly ONE row-set, one audit row, one publish — the second submit reads the stored receipt and returns the PRIOR count with zero new state.
- The parallel same-key window follows the engine's documented in-flight sentinel posture (engine doc §3.6): the claim loser reads no receipt and deterministically fails open (insert + audit + publish with exactly one warn) — the engine owns these semantics; the broadcast emitter does not fork them.
- A corrupt or absent cached receipt ⇒ fail-open: the emission proceeds (insert + audit + publish) with one warn. Verified by test, never by trust.
- **Ledgered residual:** the claim digest binds the key to the RESOLVED cohort, and the cohort is re-resolved fresh per call — a membership change between submit and a deliberate same-key retry (signup, soft-delete, subscription lapse) yields a fresh accept. The deterministic double-click case is fully absorbed; the residual is cross-time retries after membership churn, owned by the engine hardening stream (deferred-items RV-1).

## 5. Atomicity — one transaction, publish strictly post-commit

`AdminBroadcastService.broadcast` runs as ONE `withTransaction` unit: optional cohort read, the `emitForUsers` insert (the engine is the SINGLE writer of `notifications` rows — the emitter never inserts directly), and the audit row share one savepoint; any failure rolls the WHOLE unit back (verified: forced insert failure leaves zero notifications, zero audit, no publish, and the outer transaction usable). `publishReceipts` runs strictly AFTER the caller's commit — a pre-commit push is structurally unreachable through this composition.

## 6. Recipient cap — fail-closed at 5000

The resolved cohort length is checked against the 5000 cap BEFORE any write; a breach rejects with a localized error and zero state. There is NO chunking and NO pre-send audience-size preview query (the count is returned only after the write succeeds — `previewDisclaimer` states this in the UI; the mutation surface has no count-preview oracle). Chunked mega-broadcasts are deferred to a future scale ticket (deferred-items RV row under the phase-0 seed).

## 7. Audit contract

- Exactly ONE `audit_logs` row per ACCEPTED broadcast, written inside the same transaction.
- `actionType: create`, `entityType: "notification_broadcast"`, `entityId: NULL` (a broadcast has no single backing entity — the audit write contract admits a null `entityId`; the schema column is nullable and `AuditLogWriteContract.entityId` is widened to the schema-derived `number | null`).
- `details` carries metadata ONLY — `{ scope, <companion>, recipientCount }`. Never the title, never the body, never recipient identifiers (log hygiene: the same metadata-only discipline applies to every log line on the path).
- Zero audit rows on denial (see §3 ordering).
- The `audit_logs` immutability triggers (update/delete blocks from the audit hardening migration) do not interfere: the path only ever INSERTs.

## 8. Copy is verbatim — the localization boundary

Admin-authored title/body are stored byte-for-byte (unicode, RTL, and injection-shaped strings pass through inert; the title is not even trimmed). Broadcast copy is NOT localized: the engine's localization-at-emitter boundary is satisfied "at rest" — what the admin wrote is what every recipient observes. UI copy around the compose surface is fully localized (`AdminBroadcasts` namespace, en/ar parity); the recipient-count toast is the ONLY carrier of a dynamic value, pluralized with Arabic CLDR classes cycling by `count % 100` (so 100/101/…/5000 re-enter the zero/one/two/few/many cycle instead of one flat form). Copy is rendered inert client-side through React's escaping (`dir="auto"` on user-authored fields).

## 9. What NOT to do

- **Never insert `notifications` rows directly** — the engine is the single writer; emitters compose through `emitForUsers`.
- **Never publish before the caller's transaction commits** — use the engine's receipt composition; the broadcast path gets this structurally right.
- **Never fork the claim-cache/idempotency semantics** — the claim digest, receipt shapes, and fail-open ladder are engine-owned (engine doc §3.6); the broadcast layer only supplies the header-captured key and the scripted/injected cache port.
- **Never add a fifth audience kind via schema** — the taxonomy is TS-only by design; a new kind is an enum + repo-branch + input-registration change with zero migration.
- **Never move the governance predicate** — the tx and raw branches must stay semantically identical; the exclusion set (deleted/blocked out, suspended in) is invariant-pinned.
- **Never expose a pre-send audience-size count** — no preview query exists; the persisted count returns only after the write.

## 10. Test map (evidence)

- **Cross-actor journey** — `test/workflows/notifications/admin-broadcast.journey.test.ts`: all ten lifecycle steps over the REAL service + real DB (all-cohort fan-out, same-key replay absorption, role/country/plan cohorts with governance exclusion, validation denials, BFLA denials for every non-admin role, anonymous wall, post-hoc per-actor inbox reads).
- **Service behavior matrix** — `backend/services/notifications/admin-broadcast.service.test.ts`: every cohort branch, the full validation matrix with hostile inputs, gate ordering with zero state on denial, replay/fail-open ladder (scripted claim caches), forced-rollback atomicity, tx/savepoint propagation, verbatim-copy storage, second-admin append-only audit.
- **Repository suite** — `backend/db/test/logic/notifications/broadcast-audience.repository.test.ts`: both resolution branches, governance predicates, active-window boundaries (inclusive start / exclusive end), wildcard-shaped countries matching nobody.
- **Wire integration** — `backend/graphql/test/admin-broadcast.integration.test.ts`: UNAUTHORIZED/FORBIDDEN wall over the REAL HTTP stack, BOPLA smuggled-field probes, `$all` snapshot pin, single-arg surface.
- **Component + guards** — `test/ui/components/admin/BroadcastComposeContainer.test.tsx` (render tiers + audience branches + copy-preservation pin; the mutation-flow tier is blocked by a documented bun/Happy-DOM runtime defect, deferred) and `test/ui/page-guards/admin-broadcasts-page.test.ts`.
- **Locale parity** — `shared/locale/adminBroadcasts-namespace.parity.test.ts`: en/ar key parity, Arabic plural boundary pins (incl. ≥100 cycles), zero hardcoded copy across the surface.

Import-by-reference: future emitters and reviewers should read `docs/notifications/realtime-engine.md` §3.2 (consumption table + receipt composition) and §3.6 (idempotency posture) alongside this doc — the engine's rules are cited there and are NOT duplicated here.
