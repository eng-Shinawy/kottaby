# Caching Strategy — Evidence-Bound Posture (§6 Closing Evidence)

> **Scope:** the platform's complete caching posture — what caches exist today, with their exact bounds; the rules that decide when a new cache may be added; the deferred distributed-cache seam; and the load evidence that justifies the current "no distributed query cache" stance.
> **Audience:** any engineer proposing a cache for a hot path, and the launch operator reading the §6 sign-off table in `docs/performance/load-testing.md`.
> **Posture:** caching strategy is delivered as **documentation plus evidence, not speculative infrastructure**. Every cache listed below was added for a stated, bounded reason; no cache was added because "it should help".

---

## Why

A cache is the most expensive kind of performance work: it trades freshness for latency, adds an invalidation surface (a bug class this platform's financial invariants — wallet balances, escrow holds, append-only audit — cannot tolerate), and once wired it is nearly impossible to remove. The mirror of the index discipline (REQ-3.5: *"an index without an EXPLAIN case is not added — no speculative indexes"*, adjudicated live in outcome 3.4) applies verbatim:

> **A cache without a measured evidence case is not added — no folklore caches.**

This document exists so that the next caching decision follows a strategy rather than folklore. It invents no infrastructure: the load-test plan behind the sibling runbook proved every passing p95 gate **without** a distributed query cache, and diagnosed the one failing gate (§6 6.1) as server-side saturation: the 2026-10-10 fixed-sampler re-run measured the database measurably busy but not the bottleneck — peak **8 non-idle connections of the 10-connection pool**, dominated by write-path lock waits and connections stalled on `ClientRead` (waiting for the server process), not read amplification. A cache would not have rescued it.

---

## Cache Inventory (every existing surface, with bounds)

The platform runs **four caches**. Each entry records its scope, TTL / staleness window, size/memory bound, and invalidation trigger. No other cache exists: `grep` for cache libraries (`lru-cache`, `node-cache`, `cache-manager`) finds none in `package.json`, and Redis is wired **only** for notification fan-out and the idempotency claim cache — never for query results.

### 1. Process-lifetime environment snapshot

| Property | Value |
|---|---|
| Surface | `cachedConfig` — `backend/lib/env.ts:65` |
| Scope | One `EnvironmentConfig` object per process, built once by `readEnvironment()` (`backend/lib/env.ts:471-479`) |
| TTL / staleness window | Process lifetime — configuration is static per deployment |
| Size bound | One object; no growth |
| Invalidation | Process restart, or `resetEnvironmentCache()` (`backend/lib/env.ts:488-490`) — called by the `bun db` CLI after applying a new env file and by env-override tests |
| Permission posture | Configuration data only — no user data, no authorization surface. Consumers (e.g. the login-account limiter, `backend/lib/ratelimit.ts:336-343`) re-read the snapshot lazily on every check so a reset is observable |

### 2. In-memory rate-limit sliding windows

| Property | Value |
|---|---|
| Surface | `windows` — `Map<string, WindowEntry>` of per-identifier request timestamps, `backend/lib/ratelimit.ts:96` |
| Scope | Per-process, per-limiter-key (`"<limiter>:<identifier>"`) — limiter configs: GraphQL public 100 req/60 s (`backend/lib/ratelimit.ts:61-65`), portal-read 30/60 s, auth-IP 10/60 s, auth-identity 20/60 s, login-account 5/15 min (factory-resolved, env-cached) |
| TTL / staleness window | Each limiter's `windowMs` — timestamps older than the window are pruned on every check (`pruneWindow`, `backend/lib/ratelimit.ts:98-101`) |
| Size bound | **10,000 tracked identifiers** (`MAX_TRACKED_IDENTIFIERS`, `backend/lib/ratelimit.ts:88-89`); when exceeded, the least-recently-accessed entries are evicted down to 80 % of the cap (`evictStaleEntries`, `backend/lib/ratelimit.ts:103-112`) |
| Invalidation | Sliding-window expiry + LRU eviction + `clearRateLimitStore()` (test helper, `backend/lib/ratelimit.ts:288-290`) |
| Permission posture | Not payload data — these are **traffic gates**, never a source of user-visible content; keys are client IPs and SHA-256 identity digests (plaintext emails are never stored, `backend/lib/ratelimit.ts:175-181`). Fail-open on internal errors with one observable warn (`backend/lib/ratelimit.ts:223-230`) |

### 3. Redis notification idempotency claim cache

| Property | Value |
|---|---|
| Surface | `RedisClaimCache` — the `NotificationIdempotencyClaimCache` port adapter, `backend/services/notifications/redis-claim-cache.ts:53-82`; process-lifetime shared client memoized at `backend/services/notifications/redis-claim-cache.ts:92` |
| Scope | Emit-claims for keyed notification emissions only — `SET key "1" NX EX ttl` (`backend/services/notifications/redis-claim-cache.ts:65-68`) and post-commit receipt stores (plain `SET … EX`, `:74-76`); keys are SHA-256 digests of `<recipients>:<type>:<idempotencyKey>`, never raw keys |
| TTL / staleness window | **24 h** (`NOTIFICATION_EMIT_CLAIM_TTL_SECONDS = 86_400`, `backend/services/notifications/emit-idempotency.ts:30`) — matching the `docs/IDEMPOTENCY.md` idempotency-key window |
| Size bound | Redis-side TTL expiry only; process side holds one lazily-constructed connection with bounded command/connect timeouts of 2 s and `maxRetriesPerRequest: 1` (`backend/services/notifications/redis-claim-cache.ts:109-118`) so a dropping Redis can never hold a caller's open transaction |
| Invalidation | TTL expiry only (plus the receipt `store` resetting the window); no delete path — a claim is monotonic for its 24 h life |
| Permission posture | Not a data cache — idempotency receipts are never served to users; emission happens only after resolver-level authorization. **Fail-open**: any cache error proceeds with the write plus one structured warn (the documented §3.6 deviation — a Redis blip must not block a session-completion or payment notification; see `docs/notifications/realtime-engine.md:149`) |

### 4. Request-scoped React `cache()` auth dedupe

| Property | Value |
|---|---|
| Surface | `getServerUserContext` wrapped in `react.cache()` — `backend/lib/auth/server-auth.ts:119` |
| Scope | A single HTTP request: multiple Server Components + layouts in the same request share one access-token verify + one DB user fetch |
| TTL / staleness window | Request lifetime — the memo dies with the request; nothing survives across requests |
| Size bound | One auth-context entry per request |
| Invalidation | Request end (structural — React's `cache()` has no cross-request reach) |
| Permission posture | This **is** the permission resolution, not a bypass of it: it caches the verified-token → user-context lookup for the caller's own cookies. Every downstream gate (`authScopes`, role checks, owner-scoped service predicates) still runs per operation on the returned context — no authorization decision is ever served from this memo |

### Adjacent bounded state — not caches, listed for completeness

To keep this inventory honest, three bounded in-memory structures exist that are registries/counters rather than caches of data, so a future reader does not mistake the inventory as having "missed" them:

- **WebSocket connection registries** (`backend/ws/notification-ws-server-state.ts:43-44` — per-connection and per-user maps; bounded by the connection-cap policy: 1000 global / 5 per user, `docs/notifications/realtime-engine.md` §3.8).
- **Handshake token-bucket throttle** (`backend/ws/notification-ws-server-throttle.ts` — capacity 5, refill 1 token / 2 s, **≤ 10,000 tracked IPs** at `backend/ws/notification-ws-server-constants.ts:20`).
- **In-process fan-out transport listener registry** (`backend/services/notifications/realtime/in-process-transport.ts` — a registration-bounded tap, never a payload cache).

Equally explicit non-surfaces: **Apollo Client's normalized store is client-side request state, not a server cache** (out of scope here); and the "Hot-Resolver & Read Caching: `cachedRead` from `@/backend/services/cache`" line in `backend/AGENTS.md:34` describes an **entity cache that does not exist yet** — no `backend/services/cache` module and no `cachedRead` symbol can be found in the tree. If that module is ever built, it must enter through this document's evidence threshold and obey the permission-before-cache rule below.

---

## When to Cache — the Evidence-Threshold Rules

A new cache is **last** in a fixed funnel. Every earlier stage is cheaper and carries no staleness or invalidation surface:

```
1. MEASURE       — reproduce the problem with the perf toolchain (docs/performance/load-testing.md).
                   No measurement, no cache. "It feels slow" is not evidence.
2. FIX THE QUERY — EXPLAIN it (perf:analyze-queries): is the plan sane? Is an index
                   evidence-justified (the 3.4 discipline: index only on a materialized
                   scan at seeded volume or a threatened gate — never speculatively)?
3. FIX THE SHAPE — eliminate N+1 with batch enrichment (below). A page whose cost
                   grows with page size is a shape bug, not a caching opportunity.
4. CACHE LAST    — only if 1–3 are exhausted AND the entry criteria below all hold.
5. ANYTHING ELSE — ledger with evidence (the D14 precedent) and re-measure.
```

**Entry criteria — ALL must hold before a cache is added** (mirroring the specs' requirement that when-to-cache rules be evidence-threshold rules):

1. **Measured p95 breach on a hot path** at target-or-representative load, from a retained `logs/perf/` artifact or an equivalent production measurement — not a projection, not a hunch.
2. **Cheaper levers adjudicated and exhausted**: the query plan is clean (or its index case is resolved per the 3.4 ruling) and the statement count is already constant (per the K=6 lock) — i.e. the residual cost is genuinely repeated identical reads, not a query defect.
3. **Permission-compatible read path**: authorization can resolve BEFORE the cache lookup (see the rule below) — a read whose authorization is data-dependent on the very rows being cached cannot be cached without a permission-scoped key design.
4. **Staleness window decided in writing**: what TTL, what invalidation trigger (mutation-tag, TTL-only, manual flush), and what the business tolerates for each affected surface. Financial surfaces (balances, escrow, audit) default to **no staleness** — if the answer is "none tolerable", the answer is "no cache".
5. **A revert path**: the cache behind a seam that can be turned off (the `CACHE_PROVIDER` shape) so a bad cache is a config change, not a code rollback.

A proposal that cannot show all five is closed with **"no folklore cache"** and, if the concern persists, ledgered with evidence.

---

## Batch Enrichment Is the First Line; Caching Is the Second

The canonical proof that shape-beats-cache is the subscription-page N+1 elimination (plan Phases 5.1–5.3), which **removed the per-row fan-out entirely with zero caching semantics**:

| Operation | Before (per-row resolvers) | After (page-level batch) |
|---|---|---|
| `mySubscriptions`, page size 1 | 4 | 4 |
| `mySubscriptions`, page size 25 | **76** (= 1 + 3×25) | **4** |
| `mySubscriptions`, page size 100 | **301** (= 1 + 3×100) | **4** |
| `adminStudentSubscriptions`, page size 1 | 5 | 5 |
| `adminStudentSubscriptions`, page size 25 | **77** | **5** |
| `adminStudentSubscriptions`, page size 100 | **302** | **5** |

Statement counts are **constant at 4/5 ≤ K=6 across every page size** — locked on the wire by the CI oracle (`backend/graphql/test/subscription-enrichment.query-count.test.ts`, exact-constancy semantics) and at the service seam by the per-page call-count lock (one batch call per page at sizes 1/25/100/1001). The pattern is the established service convention (`backend/services/classes/session-lifecycle.queries.ts:113-121`): read the caller-authorized page, batch-resolve the enrichment relations in one keyed read per relation, merge onto row copies — and the dataloader plugin stays intentionally unloaded (`backend/graphql/pothos/builder.ts:15-17`, rationale in `docs/graphql/dataloader-batching.md`) precisely because it would smuggle per-request cache semantics into the resolver layer.

Why caching would have been the wrong second tool here: the N+1 fix needed **no invalidation design, no TTL, no stale reads, no new Redis dependency** — and it cannot drift from the source of truth because every page reads the live rows. A cache over the same page would add all four of those costs to serve a page that is already 3 batch statements away.

---

## The `CACHE_PROVIDER` Seam — a Deferred Pointer (ledger D2)

The environment exposes a cache-provider knob that is **parsed but consumed by nothing**:

- Declared in the tracked-env key list — `backend/lib/env.ts:26`.
- Typed as `cacheProvider: string` (`"redis" | "postgres"`) — `backend/lib/env.ts:303`.
- Parsed with default `"postgres"` — `backend/lib/env.ts:421`; `.env.example:206` ships `CACHE_PROVIDER=postgres`.
- **Zero consumers**: the only references to `cacheProvider` in the entire tree are the three above — no service, repository, or resolver branches on it. There is no query-result cache to switch.

Wiring this seam to a distributed/cross-request query cache is a **deferred, separately-ticketed decision** (deferred-items ledger row **D2** — "Distributed/cross-request query caching + wiring the unconsumed `CACHE_PROVIDER` seam", resolved as a pointer to this document). It must not be wired speculatively; the entry path is the funnel above.

**What load evidence WOULD justify escalation to a distributed cache** (the D2 entry criteria):

1. A re-executed staging/cloud load run (the §6 6.1 resolution path in the runbook) shows a hot-read path breaching its p95 gate where the `pg_stat_activity` snapshot shows the **database** as the bottleneck — sustained non-idle pool utilization at the `max: 10` ceiling (`backend/db/client.ts:175`), not server-side saturation (the local 6.1 counter-example: the 2026-10-10 fixed-sampler re-run measured peak 8 non-idle of 10 with `ClientRead`-dominated waits — see Closing Evidence).
2. The read path has already passed the query-shape and index adjudication (clean plans, constant statement counts) — i.e. the cost is genuinely repeated identical reads across requests.
3. The read is permission-compatible (authorization resolves before lookup, or the key encodes the permission scope) and its staleness window is decided and acceptable for the surface.

If all three hold, the seam is the wiring point: a provider abstraction over the existing ioredis plumbing (the claim-cache adapter's injected-port shape, `backend/services/notifications/redis-claim-cache.ts:39-46`, is the in-repo precedent for a thin, test-double-friendly Redis command surface).

---

## Permission Before Cache — the Non-Negotiable Ordering

Restating the service-layer rule (`backend/services/AGENTS.md:14`) precisely:

> **Permission gating (`assert*`, `hasPermission`, role/owner scopes) MUST run BEFORE cache lookups. Authorization checks stay outside cached reads so unauthorized users never receive cached payloads or execute cache queries.** Equivalently: if a cached read cannot be reordered so the authorization decision precedes the cache consultation, then the cache key must be permission-scoped (the key itself encodes the caller's role/identity so a hit can only ever return what that caller was already allowed to read).

This ordering is what prevents a cache from becoming an authorization-bypass: a cached payload keyed only by entity id would hand any caller who can reach the lookup the result of a *previous, differently-authorized* caller's read. The rule forbids that construction outright.

**How every inventory surface complies:**

| Surface | Compliance |
|---|---|
| Env snapshot | No user data — nothing to authorize |
| Rate-limit windows | Traffic gates, not payload sources; they throttle before/around handlers, never serve data |
| Redis claim cache | Receipts are never user-visible; emissions run post-authorization at the resolver; keys are content digests, not entity ids a caller can probe |
| `cache()` auth dedupe | Caches the caller's **own** permission resolution, keyed by the request's cookies — the memo cannot cross callers, and every per-operation scope decision still runs after it |

Any future entity cache (`cachedRead`-style) must repeat this table's third column in its proposal before the entry criteria are even considered.

---

## Closing Evidence — the p95 Gates Passed (and the One That Failed) Without Distributed Caching

The load-test plan's §6 bundle is the empirical basis for this posture:

- **§6 6.2 (matching pipeline): PASS** — worst 100-teacher cell p95 **6.85 ms** against a 200 ms budget (28.7× headroom); 2,000-teacher worst p95 11.46 ms at a 20× volume regime — all against live PostgreSQL, no cache in front.
- **§6 6.3 (WebSocket stability): PASS** — 100/100 handshakes, zero drops, 3× 100/100 fan-out — Redis used **only** as the pub/sub bus + claim cache, never for query results.
- **§6 6.5 (N+1 elimination): PASS** — constant 4/5 statements ≤ K=6 via batching alone (the table above).
- **§6 6.6 (index coverage): PASS** — 37/37 FK indexes covered.
- **§6 6.7 (pagination bounds): PASS** — 47/47 wire probes, every list surface bounded.
- **§6 6.1 (API p95 @ 100 VUs): FAIL-local** — and the failure is the strongest evidence in this document. The original run's `pg_stat_activity` "peak non-idle = 0 / DB idle" snapshot was **retracted on 2026-10-10** (the sampler was defective: it bound the DSN instead of the database name and misread the `QueryResult` shape — a 0 by construction, not an observation). The **2026-10-10 fixed-sampler re-run** (seed `8a2c3e56`, `logs/perf/2026-10-10T00-19-16_load-api/`, verdict unchanged: all 7 scenarios p95 3,323–5,753 ms, zero errors) measured the honest picture: **peak 8 non-idle connections across 33 samples (0 read failures)** against the 10-connection pool — the database was measurably busy but not saturated. The peak rows show where the activity sat: connections `idle in transaction` holding savepoints on the booking path, three queries blocked on `teacher … FOR UPDATE` row locks (`transactionid` ×2 + `tuple` ×1), and the rest stalled on `ClientRead` — connections waiting for the single `next start` server process to issue work. The bottleneck remained server-side (bcryptjs 12-round login compares + GraphQL execution serialized on one process), not query throughput — `my-subscriptions` p95 was 5,603 ms with a constant 4-statement page and no pool-ceiling utilization.

The conclusion holds on the measured evidence: **a distributed query cache would not have rescued the 6.1 gate** — the re-run's peak snapshot shows the database's non-idle time dominated by write-path lock contention (booking `FOR UPDATE`) and `ClientRead` stalls, not repeated identical reads a query cache could absorb. The correct resolutions were shape (batching, done), the honest FAIL verdict, and the staging/cloud re-execution path (ledger D9/D14, documented in the runbook). Caching added on this evidence would have been pure folklore: cost and staleness risk purchased against a bottleneck it cannot touch.

**No distributed query cache is justified at ~100 concurrent users on the measured stack.** Revisit only through the funnel and the D2 entry criteria above.

---

## What NOT to Do

1. **No folklore caches** — a cache without a retained measurement, exhausted cheaper levers, and a decided staleness window does not get added, no matter how "obviously hot" the path feels.
2. **No cache-before-permission** — never consult a cache before the authorization decision, and never key a cached read by a bare entity id on an authorization-gated surface.
3. **Do not wire `CACHE_PROVIDER` speculatively** — the seam stays unconsumed until the D2 entry criteria hold; parsing a value is not consuming it.
4. **Do not cache a broken shape** — page-size-growing statement counts are an N+1, not a caching opportunity; fix the shape (the batch-enrichment pattern) first. And never let a cache mask a broken batch: the carried-null honesty contract (a truncated batch surfaces its denial rather than silently re-reading) is the load-bearing seam check.
5. **Do not treat the claim cache as a data cache** — it stores 24 h idempotency receipts, not domain rows; nothing may read user-visible state from it.
6. **Do not add an entity cache without an invalidation design** — a TTL without a named invalidation trigger (and a written staleness tolerance per surface) is an unbounded risk on financial surfaces; balances, escrow holds, and audit state default to zero staleness, i.e. no cache.
7. **Do not blame the database without the snapshot** — the 6.1 diagnosis is the precedent, twice over: the original run's "peak non-idle = 0" was a **defective-sampler artifact** (retracted 2026-10-10 — see the Closing Evidence section), and the fixed-sampler re-run measured the honest peak (8 non-idle of 10, `ClientRead`-dominated). Any future "the DB is slow, add a cache" claim must show the same artifact, captured with the fixed sampler.
8. **Do not bypass the runbook's gates to manufacture a cache case** — lowering a gate, shrinking a seed, or testing at toy volume to make a path look cache-worthy is evidence fabrication, not measurement (the D6 scale-aware-threshold ruling applies to caches exactly as it does to indexes).

---

## Related

- `docs/performance/load-testing.md` — the operator runbook: every harness, gate, and retained artifact cited above.
- `docs/performance/harness-engineering.md` — the engineering-knowledge layer: harness invariants, measurement-oracle discipline, and the evidence rules this strategy's funnel leans on.
- `docs/notifications/realtime-engine.md` — the Redis fan-out bus and the claim cache's §3.6 fail-open posture.
- `docs/graphql/dataloader-batching.md` — the batching-first rationale behind the intentionally-unloaded dataloader plugin.
- `docs/IDEMPOTENCY.md` — the idempotency-key window the claim cache's 24 h TTL matches.
- `docs/billing/subscription-validity-window-expiry.md` — the financial-surface example of zero-tolerance staleness.
- Deferred-items ledger row **D2** — `ai/plans/milestone_4_integration_security_launch/load_testing_performance-load-testing-performance/deferred-items.md` (the deferred distributed-cache decision this document resolves as a pointer).
- Plan artifacts — `ai/plans/milestone_4_integration_security_launch/load_testing_performance-load-testing-performance/` (`specs.md` REQ-9, outcomes 3.4 / 5.1–5.3 / 6.2).
