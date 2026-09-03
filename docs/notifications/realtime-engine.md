# Real-Time Notification Engine (WebSocket)

> **Source of truth:** `ai/plans/sprint_2/dev3-010-real-time-notification-engine-websocket/` (specs + outcomes) and the shipped code cited below
> **Related:** `docs/specs/state-machine-invariants.md` (INV-P3), `docs/specs/open-decisions-and-gaps.md`, `docs/IDEMPOTENCY.md`, `docs/workflows/03-session-lifecycle-escrow.md`

---

## 1. Why

The platform needs one service-side substrate that (a) persists notifications into the `notifications` table, (b) fans them out to connected users over WebSocket in real time, and (c) exposes the recipient-facing GraphQL inbox. Before this engine, every future domain ticket (session requests, session completion → parent, payments, evaluation results, admin broadcasts) would have had to solve persistence ordering, delivery liveness, and connection lifecycle on its own — with divergent rules.

The engine's founding ruling is **correctness of record beats liveness**: a notification that is durably persisted but never pushed is a recoverable miss (the client catch-up refetch heals it); a notification that is pushed but not durably persisted is a lie. Everything below derives from that ordering.

This engine is the substrate that **enables INV-P3** ("a parent receives real-time notification when a linked child's session completes" — `docs/specs/state-machine-invariants.md`). The substrate shipped in DEV3-010; the semantic emitters land in DEV1-016/017 (see §3.2).

---

## 2. Pattern

Persist-first / push-second, in one pipeline:

```text
domain service (emitter)
  └─ NotificationEngine.emitForUser(s)(input, locale, tx?)     [backend/services/notifications/notification-engine.service.ts]
       1. validateEmitInput / validateEmitBatchInput           [emit-validation.ts] — fail-closed, PRE-DB, PRE-cache
       2. idempotency claim (optional key)                     [emit-idempotency.ts] — cache port, fail-OPEN
       3. INSERT inside the caller's tx (SAVEPOINT) or the engine's own tx
       4. publish AFTER commit — own-commit path publishes here;
          caller-tx path returns a receipt for the caller to publish
  └─ NotificationEngine.publishReceipts([receipt], locale)     — post-commit push (tx-owning callers)
       ↓ NotificationFanoutTransport.publishFanout(recipientIds, payload)
          [backend/services/notifications/realtime/]           — in-process tap OR Redis pub/sub
       ↓ subscribe side (sidecar)                              [backend/ws/notification-ws-server.ts]
          envelope → per-user registered sockets → ONE projected JSON frame per envelope
       ↓ frontend hook                                         [frontend/hooks/use-notification-realtime.ts]
          envelope guard → dedupe → Apollo cache merge + toast
```

**Topology ruling (Decision addendum, task 7.2):** the Next.js App Router cannot host a WebSocket server, so the WS endpoint is a **standalone sidecar** — `bun run ws` (`scripts/start-notification-ws.ts`) boots a Bun-native server on `WS_HOST:WS_PORT` (dev default `ws://127.0.0.1:3101`; run the sidecar with `WS_HOST=localhost`). It is NOT an `app/api/**` route and never enters `ROUTE_INVENTORY`. The dev default is deliberately not 3000/3001: the Next.js dev server may occupy either, and a port collision sends every browser handshake to the HTTP server (connection closed before upgrade → reconnect storm).

| Component | File | Role |
|---|---|---|
| Engine | `backend/services/notifications/notification-engine.service.ts` | Emit surface + inbox ops (`emitForUser`, `emitForUsers`, `publishReceipts`, `listMyNotifications`, `getMyUnreadCount`, `markRead`, `markAllRead`) |
| Emit validation | `backend/services/notifications/emit-validation.ts` | Pre-DB fail-closed guards (`isPositiveSafeInt` shared) |
| Emit idempotency | `backend/services/notifications/emit-idempotency.ts` | Injected claim-cache port, SHA-256 claim keys, receipt serialize/parse |
| Backplane ports | `backend/services/notifications/realtime/fanout-transport.ts` | `NotificationFanoutTransport` (publish) + `NotificationFanoutSubscriptionSource` (subscribe) |
| In-process adapter | `backend/services/notifications/realtime/in-process-transport.ts` | In-memory tap (tests / single-process) |
| Redis adapter | `backend/services/notifications/realtime/redis-pubsub-transport.ts` | Pub/sub on fixed channel `kottaby:notifications:fanout` |
| Selection factory | `backend/services/notifications/realtime/fanout-transport.factory.ts` | `resolveFanoutTransport` / `resolveFanoutSubscriptionSource` (env-driven, stateless) |
| WS sidecar | `backend/ws/notification-ws-server.ts` | Handshake pipeline, bounded registry, ping loop, fan-out, graceful shutdown |
| Sidecar entry | `scripts/start-notification-ws.ts` | `bun run ws`; owns the Redis client when the Redis bus is selected |
| Frontend hook | `frontend/hooks/use-notification-realtime.ts` | One socket per tab, cache merge, toast, reconnect + catch-up |
| Toast host | `frontend/components/ui/NotificationRealtimeToastHost.tsx` | Mounted once in the `DashboardLayout` authenticated branch |

---

## 3. Rules

### 3.1 Persist-first / push-second (REQ-011)

A row must be committed before any push referencing it may exist. The engine's own-commit path makes this **provable from code structure**: the function resolves only once the `withTransaction` await resolves, and no publish line is reachable before it. Push failure NEVER rolls back or fails the emit — every publish failure (own-commit, `publishReceipts`, default-transport resolution) degrades to exactly one structured `logger.logDomainError` with `{ code: "NOTIFICATION_DELIVERY_DEGRADED", entity: "notifications" }` and **resolves** (REQ-011/043). Correctness of record never depends on the bus.

### 3.2 Publish-after-commit + caller-tx receipt composition (REQ-012/042)

When the emitter owns a transaction, the engine joins it as a **SAVEPOINT** (`outerTx.transaction(fn)` — the DEV1-002 pattern) and returns a `NotificationDeliveryReceipt` **without publishing**. The caller publishes only after its unit resolves:

```typescript
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { NotificationEngine } from "@/backend/services/notifications";

// A tx-owning emitter (e.g. session completion inside the session unit):
const receipt = await db.transaction(async (tx) => {
  // … your domain writes …
  return NotificationEngine.emitForUsers(
    {
      userIds: [parentId],
      type: NotificationType.SessionCompletion, // NotificationType member (wire name)
      title, body,                            // caller-composed copy — stored VERBATIM (§3.3)
      relatedEntityType: "session",
      relatedEntityId: session.id,
      idempotencyKey: "session:42:completion" // optional — emitter-owned dedupe (§3.6)
    },
    locale,                                   // localizes ValidationError messages ONLY (§3.3)
    tx                                        // ← caller-tx: NO publish happens yet
  );
  // … more domain writes …
});

// The unit has committed — now (and only now) push:
await NotificationEngine.publishReceipts([receipt], locale);
```

Emitters that do NOT own a transaction call `emitForUser(input, locale)` (or `emitForUsers(input, locale)`) with no `tx`: the engine commits its own unit, stores the receipt (when a claim cache is injected), and publishes exactly one `publishFanout` carrying the **full recipient list** — a batch is one insert unit, one `new Date()` (REQ-047), and one publish (REQ-013). `publishReceipts` sweeps receipts strictly in order, one publish per receipt; `[]` and row-less receipts are no-ops.

**Batch publish id ruling (REQ-013 × REQ-021):** a batch publish's envelope carries the FIRST sibling row's `id` (the representative projection — journey J2 pins `[rowA.id, rowB.id]` acceptance). Per-recipient ids cannot ride a single envelope without N publishes, which REQ-013 forbids; a recipient that acts on the representative id before the next refetch hits the repository ownership guard, and REQ-025's refetch-is-truth self-healing replaces the client cache entry with the caller's own row on the next list read. Do not "fix" this into per-recipient publishes without amending REQ-013.

**Emit contract (fail-closed, pre-DB, pre-cache — `ValidationError` before any DB/cache access):** `title` non-empty-after-trim ≤ 255 (stored verbatim; the emptiness check is validation, never transformation) · `body` nullable string · `type` via the fail-closed `isNotificationType` guard · `relatedEntityType`/`relatedEntityId` strict co-presence (type ≤ 100, id positive safe int) · recipient ids positive safe ints · batch lists non-empty with no duplicate recipient ids (a duplicated cohort member is a caller bug) · optional `idempotencyKey` non-empty ≤ 128.

**Consumption guide — the emitter tickets (deferred item D1):**

| Ticket | Semantic trigger | What it consumes |
|---|---|---|
| DEV3-011 | `session_request` accept/decline wave | `emitForUser` per recipient |
| DEV1-016 / DEV1-017 | Session completion → parent (INV-P3's emitters) + parent portal consumption | `emitForUser(s)` inside the session-completion tx + `publishReceipts` |
| DEV2-016 / DEV2-017 | `evaluation_result` | `emitForUser` per teacher/applicant |
| DEV3-012 / DEV3-013 | `session_cancellation` / `payment_confirmation` | Same receipt composition as above |
| DEV3-022d | `system_broadcast` admin surface — **SHIPPED** (canonical reference: `docs/notifications/broadcast-notifications.md`) | `emitForUsers` bulk primitive; cohort resolution is the admin mutation's concern (REQ-027 BFLA containment — the engine provides NO role/all-user resolution queries) |

Binding rules for all of them: **import the engine's emit contracts — never write `notifications` rows directly** (REQ-010 single-writer; static scans pin that emit primitives appear in zero resolver files); **honor the publish-after-commit composition** (REQ-012) whenever the emitter carries its own transaction; keyless emits are the emitter's dedupe obligation.

### 3.3 Emit contract + localization-at-emitter boundary (REQ-015/028)

The engine **never translates**: `title`/`body` cross it verbatim — zero translation, zero templating, zero mutation. Localized copy composition is the **emitter's** responsibility; the engine's `locale` parameter exists only to localize its own `ValidationError` messages (via `getServerTranslations(locale).errorsTranslations`). The per-recipient locale source (`users.locale` — persisted, exposed via `User.locale` + the `updateMyLocale` mutation since the R2-users-locale-a backend vertical) exists, but emitter consumption — reading per-recipient locales (`UserRepository.findLocalesByIds`) and composing localized copy per recipient — remains deferred item **D2**, owned by the emitter tickets; never patched inline by an unrelated emitter ticket.

### 3.4 WS handshake security model + close-code vocabulary

The handshake pipeline runs in a **fixed order** (REQ-022/033) in `backend/ws/notification-ws-server.ts`:

1. Non-WebSocket requests → HTTP `426`.
2. **Origin allowlist FIRST** — missing/non-allowlisted → HTTP `403`, socket never upgraded (the cross-site WebSocket hijacking defense). Defaults: `http://localhost:3000`, `http://127.0.0.1:3000`; extend via `WS_ALLOWED_ORIGINS`.
3. **Per-IP token-bucket throttle** — capacity 5, 1 token / 2s sustained, over a bounded tracked-IP map (drop-oldest at 10 000) → close `4429`.
4. **Cookie-only auth** — the `access_token` httpOnly cookie is the ONLY identity source; query-string tokens are never honored → `4401`.
5. `verifyAccessToken` (null on ANY failure → `4401`), then `userId` from the `sub` claim with a positive-safe-int re-assertion (defense in depth → `4401`).
6. `server.upgrade` — registration and both caps enforced atomically in `open()`.

**Complete close-code vocabulary** (`NOTIFICATION_WS_CLOSE_CODES`):

| Code | Constant | Meaning | Client action |
|---|---|---|---|
| `4401` | `unauthenticated` | Cookie auth failed / unusable `sub` | **Abort retrying** (re-auth required) |
| `4429` | `throttled` | Per-IP handshake bucket exhausted | Back off |
| `4009` | `superseded` | Per-user cap eviction — this socket was the OLDEST for the user | **Abort retrying** (newest tab wins; the evicted tab backs off to avoid flicker) |
| `1013` | `overloaded` | Global connection cap reached | Retry later |
| `1001` | `shutdown` | Graceful server shutdown (SIGTERM/SIGINT → close-all) | Reconnect with backoff **+ catch-up refetch** |

Client-side semantics (shipped in `frontend/hooks/use-notification-realtime.ts`): `4401`/`4009` abort; `4429`/`1013`/`1001`/abnormal closure back off `1s → 2s → 4s … cap 30s` with ±20% jitter (`getNotificationReconnectDelay`). Degradation is silent (REQ-064): no toasts or banners on outage — at most one `logger.warn` per disconnected episode.

### 3.5 Backplane port + both adapters + fail-open push (REQ-013/021/045)

The bus is a port pair (`fanout-transport.ts`): `publishFanout(userIds, payload)` on the engine side, `subscribeFanout(listener)` on the sidecar side. Two adapters, selected by the stateless factory from `NOTIFICATION_FANOUT_TRANSPORT` (+ `REDIS_URL`):

- **In-process** (`in-process-transport.ts`) — in-memory tap for tests and single-process runs; registration-bounded listener registry.
- **Redis pub/sub** (`redis-pubsub-transport.ts`) — fixed channel **`kottaby:notifications:fanout`** (`NOTIFICATIONS_FANOUT_CHANNEL`), JSON envelope `{ userIds, payload }` through an allowlisted field projection; the subscribe side re-validates every message with the `parseFanoutEnvelope` runtime guard (malformed → drop + one structured warn, never a crash).

The egress projection is the REQ-021 allowlist — no recipient ids or PII ever cross the socket; the sidecar re-uses the exported `projectFanoutPayload` so the single projection implementation holds on both bus mediums. **Push failures fail open** (§3.1): a Redis outage mid-run degrades at publish time with `NOTIFICATION_DELIVERY_DEGRADED` and resolution. Two fail-FAST exceptions, both static misconfigurations rather than outages: the factory throws when `redis` is selected without a `REDIS_URL`; the sidecar boot fails when the Redis bus is selected but the server is unreachable (a sidecar without a backplane serves nothing).

### 3.6 Idempotency — the fail-open deviation, and why

When an `idempotencyKey` is supplied, the engine claims `notif:emit:<sha256("<sorted recipient ids>:<type>:<key>")>` via cache **SET-NX-EX with a 24 h TTL** (`NOTIFICATION_EMIT_CLAIM_TTL_SECONDS = 86_400`, the `docs/IDEMPOTENCY.md` window). The raw key is never stored or logged — only its SHA-256 digest. Claim outcomes: **won** → proceed; **held + replayable receipt** → `duplicate`, the prior receipt revived, no insert/publish; **held + unreadable, or ANY cache error** → `unavailable` → **fail open**: proceed with the write plus ONE structured warn.

The rationale (plan decision D5, REQ-016): this is a deliberate, documented deviation from `docs/IDEMPOTENCY.md`'s fail-closed posture for booking-class mutations — a Redis blip must not block session completion or payment confirmation, turning a notification-dedupe nicety into a domain outage. Worst case is a duplicate row the user dismisses — recoverable noise. Notification emission is outside that doc's mandated key set. Two structural supports: the claim cache is an **injected port with no default** (keyed emits without a cache run fail-open with a warn), and the receipt is stored **only after the insert's transaction has committed** — a pre-commit receipt could outlive a rolled-back emission and ghost future replays. On the caller-tx path the durable equivalent is the receipt the caller hands to `publishReceipts`; on the own-commit path the engine stores it itself.

### 3.7 Catch-up self-heal (REQ-025)

The server is the source of truth; pushes are best-effort hints. On **re-connect only** (the first connect never refetches), the hook issues network-only queries for `myNotifications` page 1 and `myUnreadNotificationCount`. Divergence from any outage is therefore bounded by one refetch round-trip. Browser-verified end-to-end: a row emitted during a sidecar outage was recovered at the page-1 head on reconnect — with no toast for the recovered row (catch-up is a refetch, not a push).

### 3.8 Connection-cap policy

| Policy | Value | Enforcement |
|---|---|---|
| Global connection cap | `1000` (`WS_MAX_CONNECTIONS`) | New handshake → close `1013` |
| Per-user cap | `5` (`WS_MAX_CONNECTIONS_PER_USER`) | OLDEST connection for that user evicted with `4009` (insertion-order scan) |
| Liveness | 30 s ping × 2 missed pongs (`WS_PING_INTERVAL_MS`, `WS_MISSED_PONG_LIMIT`) | App-owned cadence (`sendPings: false` — Bun's internal auto-ping disabled); 2 consecutive missed pongs → terminate; Bun `idleTimeout` derived above the liveness window so app-owned termination always fires first |
| Inbound frame cap | `4096` bytes (`WS_MAX_INBOUND_FRAME_BYTES`) | Protocol is push-only (REQ-034): `message()` is empty — every client application frame is ignored; the cap is defensive only (tightened from Bun's 16 MiB default in review R1 triage — deferred item D9(c)) |
| Handshake throttle | capacity 5, 1 token / 2 s, ≤ 10 000 tracked IPs | Bucket exhaustion → `4429` |

Deployment posture notes (deferred item D9, deployment workstream — same owner as D3): throttle keys use the immediate peer address and `X-Forwarded-For` is deliberately never trusted, so behind a proxy/NAT one client can starve the shared bucket; global-cap exhaustion requires ≥ 200 authenticated live accounts at the default caps — accepted residual risk.

### 3.9 Bounded-state exception scope (REQ-023/046)

The sidecar's per-instance registry (`Map<connId, ConnState>`), its per-user index, and the tracked-IP throttle map are the **sanctioned exception** — per-server-instance and explicitly capped. Everything else is stateless: the adapters hold instance-scoped, registration-bounded state only (zero module-level mutable state), the factory is stateless, and the engine's only module-level state is a single-slot bounded promise memo resolving the default transport once per process.

### 3.10 Invariants posture — nothing new minted

This engine mints **NO new state-machine invariants**. Two properties are documented here rather than INV-numbered:

- **Append-only rows:** `notifications` rows are append-only from the recipient's perspective — emitters create; nothing edits or deletes recipient-visible history.
- **One-way read latch:** `is_read` moves `false → true` only, via the self-scoped `markRead` / `markAllRead` inbox ops (guarded `WHERE id AND user_id` — foreign ids answer `NOTIFICATION_NOT_FOUND`, BOLA posture pinned). **Mark-read is NOT a realtime event** — no push is emitted on read-state change.

INV-P3 is referenced as **ENABLED-BY** this engine (`docs/specs/state-machine-invariants.md`): the substrate exists; the semantic emitters ship in DEV1-016/017.

**Documented governance window (deferred item D5):** `createGraphQLContext` verifies the JWT but does not re-check governance flags, so a governed caller holding a pre-issued, unexpired access token retains its full self-scoped inbox surface (reads AND mark ops) until token expiry — analogous to REQ-038's documented WS-socket JWT-only trade-off, pinned by the integration matrix suite; owned by a future governance-context gate ticket.

---

## 4. What NOT to Do

- **Never write `notifications` rows directly** — the engine is the single writer (REQ-010). Import the emit contracts; static scans enforce that emit primitives never appear in resolvers.
- **Never publish before the caller's transaction commits** — a pre-commit push advertises an emission that may roll back. Use the receipt composition (§3.2); the engine's own-commit path makes the violation structurally unreachable.
- **Never translate, templatize, or mutate `title`/`body` in the engine** — copy composition is the emitter's job (REQ-015/028). Do not "fix" missing per-user locale here; per-recipient localization is the emitter's D2 concern (the `users.locale` column now exists — emitters batch-read it via `UserRepository.findLocalesByIds`; the engine still never localizes).
- **Never authenticate a WS handshake by anything but the httpOnly cookie** — no query-string tokens, ever (REQ-033). Never trust `X-Forwarded-For` for throttle keys.
- **Never log recipient PII, raw idempotency keys, or IPs** — lifecycle logs carry `connId` + `userId` only (REQ-037); the throttle IP is a bucket key and is never logged; only the SHA-256 claim digest is stored.
- **Never add module-level mutable state** outside the sanctioned sidecar registry (§3.9) — including "just a small cache" in an adapter or service.
- **Never block a domain flow on push or cache failure** — the fail-open rulings (§3.1, §3.6) are load-bearing; a transport outage must degrade, not throw.
- **Never re-mount `useNotificationRealtime` per page** — the `DashboardLayout`-mounted toast host owns the tab's single socket (REQ-067); pages and badges consume the Apollo cache the hook maintains. Sign-out unmounts it.
- **Never refetch on first connect, and never emit a realtime event for mark-read** — catch-up is reconnect-only (REQ-025); read-state changes are not pushes.
- **Never reuse the WS sidecar for presence** — availability is DEV2-011/012/013's own surface.
- **Never resolve roles or all-users inside the engine** — `emitForUsers` takes EXPLICIT recipient id lists only (REQ-027); broadcast cohort composition is DEV3-022d's obligation.
- **Never import the sidecar module from app code to "reach the registry"** — the handle is process-local by design; cross-process fan-out goes through the transport port.

---

## 5. Rollout Summary

Shipped in DEV3-010 (`feat/dev3-010-real-time-notification-engine-websocket`), all gates green:

- **Persistence + emit surface** — engine namespace, fail-closed validation, injected idempotency port (33 tests / 288 expects, task 2.6).
- **Backplane** — port pair + in-process and Redis adapters + stateless factory (task 2.5); the channel literal exists only in `NOTIFICATIONS_FANOUT_CHANNEL`.
- **Inbox API** — GraphQL list/unread-count/mark-read/mark-all-read with self-scope guards (tasks 2.7 / 3.x).
- **WS sidecar** — handshake pipeline, bounded registry, ping loop, graceful shutdown (23 tests / 77 expects, task 2.8); `bun run ws` entry with SIGTERM/SIGINT graceful `1001` shutdown.
- **Frontend realtime lane** — hook + shell toast host (18 tests, task 4.2) and browser-verified flows: exactly one socket per tab; emit → one toast; cache merge with zero refetch; sidecar kill → silent degradation; restart → reconnect + catch-up convergence.
- **Deferred ledger** (`deferred-items.md`, all non-blocking with owning tickets): **D1** emitter wiring per event type (the §3.2 tickets) · **D2** recipient-locale copy storage (`users.locale` column + `AppLocale` enum + `User.locale` + `updateMyLocale` + repo locale helpers shipped in the R2-users-locale-a backend vertical; emitter consumption + UI locale sync remain with the owning tickets) · **D3** production WS host provisioning (deployment workstream — production must add the public app origin to `WS_ALLOWED_ORIGINS` and route `wss://` to the sidecar endpoint). **Verified 2026-08-30 against Vercel docs (`/docs/functions/websockets`):** Vercel Functions CAN serve WebSockets when Fluid compute is enabled (default for projects created after 2025-04-23). Two production paths: (a) deploy the sidecar as a Vercel **Bun-runtime** function — our sidecar is already `Bun.serve()` + `server.upgrade()`, which the Bun runtime supports natively (caveats: `upgrade()` response headers are dropped, no `drain` handler, `send()` has no `-1` backpressure — none affect this sidecar); or (b) a Next.js route handler with `experimental_upgradeWebSocket()` from `@vercel/functions`. Constraints that apply either way: each connection pins to one function instance (cross-instance fan-out must use the Redis pub/sub adapter — already the design); connections close at function max-duration (client reconnect backoff + catch-up refetch already cover this); usage bills per active connection time. Production sets `NEXT_PUBLIC_NOTIFICATION_WS_URL` to the `wss://` endpoint; the port-based dev default never applies on Vercel · **D4** multi-channel / unified-preferences integration · **D5** GraphQL governance window (§3.10) · **D6** coverage ruling (branch% unmeasurable under the bun 1.3.14 toolchain; statement coverage 100% on 12 of 22 executable modules, gap characterization on file) · **D7** review-wave ruling: boot-time config guards in the factory and sidecar throw plain `Error` — a sanctioned carve-out from the DomainError-only rule because they fire pre-DI · **D8** JWT `sub` coercion hardening (pre-existing auth code; the sidecar already re-asserts positive-int) · **D9** deployment posture (§3.8 notes; the 4 KiB frame cap fix already applied).
- **Runbook (local dev):** app at `http://localhost:3000` (or whatever port the dev server binds — auto-increments when 3000 is taken, e.g. 3001), sidecar as `WS_HOST=localhost bun run ws` (dev default port 3101 — deliberately NOT shared with any dev-server port, so a dev server bound to 3001 no longer collides with browser WS handshakes), Redis on `:6379` with `NOTIFICATION_FANOUT_TRANSPORT=redis`; frontend override `NEXT_PUBLIC_NOTIFICATION_WS_URL` for production `wss://` (D3 — Vercel Bun-runtime function or `experimental_upgradeWebSocket()` route; see verified notes above). Env keys: `WS_HOST`, `WS_PORT`, `WS_ALLOWED_ORIGINS`, `WS_MAX_CONNECTIONS`, `WS_MAX_CONNECTIONS_PER_USER`, `NOTIFICATION_FANOUT_TRANSPORT`, `REDIS_URL`.

---

## 6. Related Documents

- `docs/specs/state-machine-invariants.md` — INV-P3 (enabled-by this engine; emitters in DEV1-016/017)
- `docs/specs/open-decisions-and-gaps.md` — decisions addendum: WS-via-sidecar topology, emit fail-open idempotency, localization-at-emitter (task 7.2)
- `docs/specs/functional-requirements.md` — the REQ catalog cited throughout
- `docs/IDEMPOTENCY.md` — the fail-closed posture this engine's emit path deliberately deviates from (§3.6)
- `docs/workflows/03-session-lifecycle-escrow.md` — completion/cancellation notifications hang off the future emitters (DEV3-012/013, DEV1-016/017)
- `docs/workflows/05-admin-governance-override.md` — broadcasts become admin-surfaced in DEV3-022d over the engine's bulk primitive
- `backend/services/AGENTS.md`, `backend/ws/AGENTS.md` — layer rules (single-writer; handshake order, close-code vocabulary, bounded-state contract)
- `ai/plans/sprint_2/dev3-010-real-time-notification-engine-websocket/` — specs, deferred-items ledger, and per-task outcomes (binding summaries: 2.5, 2.6, 2.7, 2.8, 4.2)
