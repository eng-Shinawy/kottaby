# Performance Harness Engineering — Durable Patterns, Gotchas, and Evidence Discipline

> Knowledge layer. The **operator runbook** (`docs/performance/load-testing.md`) is the how-to-run reference — commands, gates, preconditions, and the §6 sign-off table. This document is the why/how/gotchas layer for engineers building or extending performance harnesses, measurement oracles, and evidence-gated optimization work in this repo. The full task-by-task provenance lives in the plan's `outcome/` corpus (`ai/plans/milestone_4_integration_security_launch/load_testing_performance-load-testing-performance/outcome/`); everything below is the recurring, architecture-relevant distillation.

---

## 1. Harness architecture invariants

These invariants held across all seven `perf:*` tools and should be treated as binding for any new one.

### Guard-first database targeting

Every entrypoint that can touch a database calls `assertTestDatabaseTarget(process.env.DATABASE_URL ?? "")` as its **first effectful call**, before any DB client object exists. The mechanism that makes this provable:

- The `@/backend/db/client` module (which constructs the `pg.Pool` at import time) is imported **dynamically, strictly after the guard allows**. The entrypoint's static imports contain no client reference — this is pinned by source-scan tests, not convention.
- Refusal prints the resolved database **name and host only** (never the DSN, never credentials) to stderr and calls `process.exit(2)`; there is no catchable exception, so no caller can accidentally continue.
- The guard resolves the database name **exactly the way `pg`'s own connection-string parser does** (branch-for-branch parity with `pg-connection-string`, proven by a fuzz oracle that imports the real parser). Parity matters: a trailing-space DSN resolves to the literal name `"kottaby_test "` and `pg` would connect to it — refusing is correctness, not a false positive.
- The force override requires the explicit flag **plus** a typed stdin confirmation repeating the resolved name. Unresolvable DSNs are unforceable (there is no name to confirm against).
- Fail-closed superset: any explicitly-set non-`postgres` `DB_PROVIDER` is refused outright. The shared client ignores `DATABASE_URL` under `pglite`, so a DSN-based guard alone would validate a connection string the harness never uses — the guard must refuse the provider too, or it is moot.

**Lesson (11.1 review wave):** the provider arm was added *inside* the guard's side-effectful entry layer so all seven entrypoints inherited it with zero entrypoint changes. When a cross-cutting refusal belongs in shared infrastructure, add it to the one function every consumer already calls.

### CLI exit-code contract

| Code | Meaning |
|---|---|
| 0 | success / all gates PASS (a gate-free `--self-check` passes vacuously) |
| 1 | a gate FAILED, or a runtime failure — the run executed; the evidence is in the report |
| 2 | refusal: usage error, guard refusal, or configuration problem — **fix the environment, do not re-run as-is** |

Refusals happen **before any run directory is created** — a refused run leaves nothing on disk. Unknown `--flags` exit 2 with the accepted-flag list; non-`--` tokens are treated as flag values and ignored (never usage errors on their own). CI and triage scripts should treat 2 as "environment/config", 1 as "genuinely failed gates".

### Report-writer discipline (`scripts/perf/lib/report.ts`)

Every tool composes `openRunDirectory(tool)` → `writeReport(...)` → `emitVerdict(...)` and all persisted bytes share these properties:

- **Redaction before disk.** `redactSecrets` runs over every report byte (connection strings with `user:password@`, JWTs, `Bearer` tokens, vendor key shapes, secret-named key assignments). Keep the regexes lint-simple (small alternation groups, quote-preserving value classes, no bare `pass`/`session` cores — a bare `pass` core would redact the report's own `"passed": true`). **A JSON container value (starting `[` or `{`) is never a secret scalar** — without this exemption, an EXPLAIN plan's `Sort Key` array gets spliced into invalid JSON by the `key`-core assignment pattern. This was found live: the first smoke run's artifacts did not parse.
- **Modes and clobber guards.** Run directories are `0700`; report/artifact files are `0600` and opened `wx` — reports are immutable, a second write refuses. Manifest replacement is atomic (sibling `.tmp` write + rename).
- **Path confinement.** Tool ids and run ids are charset-validated (`^[a-z0-9][a-z0-9-]{0,48}$`, run id `<stamp>[-N]_<tool>`) and re-checked against the resolved path after `resolve()`. Traversal-shaped inputs are rejected before any `mkdir`/write.
- **Atomic directory creation.** Same-second run-dir collision avoidance must be `mkdirSync` (atomic) + `EEXIST`-driven suffix ladder (`-2`, `-3`, …), never `existsSync`-then-`mkdir` — the check-then-act window is a real TOCTOU (two same-second invocations can share the unsuffixed directory).
- **Machine body.** `report.json` carries `{tool, runId, startedAt, args, gates, sections, verdict}`; tools add environment/scenarios/evidence as section keys. `--json`-style stdout modes must route through the same redaction.

### Io-seam design for testability

Pure libraries under `scripts/perf/lib/` take an injected **io seam** (guard call, clock, db adapter, socket adapter, publisher), so the entire orchestration is unit-testable with fakes:

- **Determinism without real sleeps:** fake clocks where the first fetch of a "wave" advances virtual time make ramp/window tests exact. Scheduled effects must be hooked to completion events (e.g. a socket's open listener), not creation-time sleeps, so they land after the real-world prerequisite.
- **Real-subprocess proofs for exit codes:** guard refusals and usage errors are proven by spawning the real entrypoint (`bun -e` with env-carried module paths) and asserting the exit code plus the absence of secrets in captured stdout/stderr — never by mocking `process.exit`.
- **The db-client adapter is the only module that references the client type** (type-only), imported dynamically post-guard. This keeps the guard-before-pool proof structural.
- **Lint-forced decomposition is a feature:** the repo's `max-lines: 300` / `max-lines-per-function: 75` oxlint caps force the entrypoint-orchestrates / pure-lib-holds-logic split. Plan for it up front rather than fighting it at review time (the shared `cli-flag-scan.ts` and `report-seam.ts` modules are the end-state of that pressure — extract the shared scaffolds once a second consumer appears).

---

## 2. Seed & cleanup engineering

The seeder/cleaner pair (`perf:seed` / `perf:cleanup`) establishes the pattern for reversible bulk fixtures against the shared test database.

- **Manifest written BEFORE the first insert**, with `completedAt: null` (crash discoverability), finalized atomically after the last one. A crashed run is therefore fully cleanable — `completedAt: null` manifests are first-class cleanup targets.
- **Prefix isolation.** Every row a run creates is discoverable by the prefix `perf_<hex8>_` stamped into a natural column (emails, full names, titles, handshake codes, payment references). The scan pattern is `escapeLikeWildcards(prefix) + "%"` (backslash-escaped, bound as a parameter). Tables without a prefix column are reached by join to prefixed `users` rows; RESTRICT edges (`session`, `subscriptions`) must be deleted **before** `users`.
- **The manifest is the only write-scope contract.** Cleanup validates the manifest before any DB work: prefix must equal `perf_<runId>_` and the `tables` list must deep-equal the canonical FK-safe order — a tampered or foreign manifest can never broaden the delete scope. Deletes are prefix-predicate-based, so cleanup is idempotent by construction and an interrupted pass is completed by re-running the same command.
- **Zero-residue is a two-step proof:** the tool's own re-probe over all tables, plus an **independent SQL re-probe** (direct-prefix and join-armed) after cleanup. The tool probe alone once missed orphaned bench-caller rows a stale run left behind; the independent probe is what makes "zero residue" a measurement instead of a claim.
- **Idempotency asymmetry:** re-running a seed with the same run-id refuses (preflight collision probe doubles as the concurrent-seeder guard); re-running a cleanup is a no-op that still re-probes.
- **Batch discipline:** volume inserts flow through a streaming batch pump (≤500-row multi-row INSERTs, one batch materialized at a time — bounded memory is unit-proven by a laziness test). Watch the batch boundary: an early implementation had an off-by-one in `takeBatch` that silently dropped the row after each full batch — boundary tests at 499/500/501 are what catch this class.
- **Credentials:** per-run password is deterministically derived from the persisted run id (`perf-load-<runId>`) and never stored in plaintext — only its bcrypt hash. Document derivation honestly ("derivable by design, acceptable because the guard confines identities to the test DB") rather than overclaiming "random".

---

## 3. Measurement oracles and their discipline

### The pg prototype-patch query counter (`scripts/perf/lib/query-counter.ts`)

The N+1 oracle patches `pg.Client.prototype.query` — **one patch covers pooled AND transaction round trips**, because pg's `Pool` borrows a `Client` per query and delegates to the client's `query` method.

- **Bun/JSC seam quirk:** the class `prototype` property is `{writable: false}` in Bun — prototype-**object** swaps are impossible; property-level `Object.defineProperty` on `Client.prototype.query` is the only patch seam. Any "make the patch fail" test must use a scoped `defineProperty` interception, never a prototype swap, and never `configurable: false`/`Object.freeze` (irreversible — would brick the shared prototype for the whole test process).
- **Exact-descriptor restoration:** uninstall restores the FULL captured property descriptor (value identity + writable/enumerable/configurable flags), asserted byte-exact against the pristine method. Every suite using the patch carries an `afterEach` identity guard (`Client.prototype.query === REAL_QUERY`) so the patch never leaks into sibling suites — this is what allows the whole harness test set to run green in one process.
- **Single-owner + idempotent uninstall:** double install throws; double uninstall is a no-op (safe for `try/finally`). Snapshots are defensively copied point-in-time Maps; `deltaSince` is pure arithmetic.
- **Count at entry, before delegation** — including invocations the base method rejects synchronously. A harness bug then fails loudly instead of hiding in a count delta. Error passthrough is exact (the base error object propagates unchanged).
- **Fingerprints exclude binding values** — secret hygiene AND correct N+1 grouping (the same statement with different params groups to one fingerprint carrying count N, which is the N+1 lens). Fingerprint = whitespace-collapsed first-120-chars prefix; differences past the prefix intentionally collapse.
- **Import boundary:** the module is harness-process-only — nothing under `app/`, `backend/`, `frontend/`, `shared/` may import it. The sanctioned in-repo expression of the same oracle for product-side test layers is `spyOn(pg.Client.prototype, "query")` (the pre-existing `query-count-regression.test.ts` mechanism) — same counting semantics, no cross-layer import.

**The K-assertion pattern** (wire-level N+1 lock): install → snapshot → measured operation → `deltaSince` → assert ≤ K, with **exact constancy asserted across page sizes** so a per-row fan-out fails the constancy check before the bound even applies. Lock it at every layer you can reach: wire oracle (real schema + real services + real PostgreSQL), service-seam call-count lock (one batch call per page at sizes 1/25/100/1001), and the harness counter for evidence. A producer that forgets to enrich fails the wire oracle **by construction** — that is the point.

### Gate contracts and percentile math

- **Integer-first percentile math:** nearest-rank must be computed as `ceil((p*n)/100 - 1e-9)`. The naive `(p/100)*n` floating-point form drifts upward at exact boundaries (p99.9 @ n=1000 → rank 1000 instead of 999) and silently inflates percentiles. Any future percentile math in perf tooling uses the integer-first form.
- **Gate boundaries are part of the contract and must be tested on both sides:** p95 strictly below the limit passes (exactly-at-limit FAILS); error-count is inclusive; a latency gate over zero samples **fails closed** (an unverifiable gate is never a pass); a threshold with no bounds is a config error. Zero requested connections / zero bursts / zero samples all fail closed rather than passing vacuously — the only vacuous pass is an explicitly gate-free run (self-check).
- **Warmup is never recorded, but a FAILED warmup is recorded as an error sample** — a cell that cannot warm up can never pass.
- **Per-sample oracles, not aggregates:** every sampled call is checked against correctness oracles (envelope consistency; business-invariant exclusion) inside that sample's try. The chaos test injects a poisoned page mid-stream and proves the single bad sample is caught — an aggregate union check would have missed it.
- **Clock guards:** NaN or backwards-running clock readings become `clock-error` samples rather than corrupting percentiles.

### Volume windows: flip and restore

When a benchmark needs to exercise "the first N eligible rows" of a shared seeded set, it temporarily marks out-of-window rows (e.g. `is_online=false`) in **cumulative descending-volume steps** (each step flips only its delta) and **restores on every path in `finally`** — unit-proven for mid-run failure, and proven live with a restore probe (all rows back online) before cleanup. The windowing facts (sizes, flips, estimates) land in the report so the reader can audit what was measured.

### Throttle-aware ramps — derive from the enforcement code, not docs

The WS handshake ramp (burst 5, then 1 per 2s + 250ms client-side margin) is derived from the sidecar's **token-bucket constants imported from the server code** (`WS_HANDSHAKE_BUCKET_CAPACITY`, `WS_HANDSHAKE_BUCKET_REFILL_INTERVAL_MS`) — asserted in tests so the harness cannot drift from the server. The counter-intuitive part: the bucket's *sustained* rate sizes the ramp (~190s for 100 connections), not its burst capacity. A client that races the refill boundary gets refused `4429`; the safety margin keeps the client strictly behind it. **A `4429` in a report means the ramp was tightened improperly — never raise the ramp above the bucket defaults.**

Similarly, liveness accounting mirrors the server's ping constants **by import** (30s cadence, 2-consecutive-miss threshold) and disambiguates structurally: a close event is a drop (stability gate); an open-but-unresponsive observation is a liveness miss; a dropped connection is excluded from later rounds (no double-counting).

### Scale-aware scan gates

The EXPLAIN scan gate flags `Seq Scan` nodes only when the relation's **estimated rows ≥ threshold** (default 1,000) at the seeded volume — CTE scans are reported but never breaches; null/unreadable plan rows count as breaches (fail closed); the plan walker is iterative + visited-set (1000-deep and cyclic plan graphs must not crash it). Two durable rulings around it:

- The gate regime and the scale evidence are different things: gate at the launch-regime cells; larger volumes are scale-evolution evidence, never the gate. Do not lower a threshold to chase a PASS.
- **The captured SQL must be the production SQL.** The query registry executes the *real repository methods* inside the capture window, so every EXPLAINed statement is the repo query byte-for-byte — drift-proof by construction. Re-typed SQL copies are forbidden.

---

## 4. N+1 elimination: the batch-first pattern

The subscription-page enrichment (before: 3N+1/3N+2 per page — 4/76/301 own, 5/77/302 admin; after: constant 4/5 ≤ K=6 at every size) is the canonical instance of a pattern that generalizes:

1. **Batch-first, before dataloader or cache.** Page-level enrichment via ≤3 batch reads (plans by id list; grouped counts; `DISTINCT ON` latest-per-entity) needs no invalidation design, no TTL, no stale reads, no new dependency. The dataloader plugin stays intentionally unloaded; a distributed query cache is the *last* lever (see `docs/performance/caching-strategy.md`'s evidence-threshold funnel).
2. **Repo seams return raw rows; certification stays above the repo seam.** Raw pgEnum strings cross the repo boundary as data; the service maps them through a shared raw-string-keyed member map with fail-closed withholding (`null` + one bounded domain log on an uncertifiable literal). One source of certification truth shared by single-row and batch paths.
3. **Honest maps:** pre-initialize every requested id (absent → `0`/`null` as *values*, never missing keys); duplicate ids collapse pre-read; results keyed by row id, never input order; deactivated parents still enrich historical rows (no active predicate on enrichment reads).
4. **Explicit chunk caps in the repo, invisible to callers:** a single statement's id list caps at 1000 with sequential chunk reads (a transaction's single client must never pipeline concurrent statements) — chunking stays repo-internal; a page-sized batch costs exactly one round trip. An explicit chunk cap beats a throwing bound (no error branch in a read path).
5. **D4 key-presence semantics at the resolver:** prefer the value CARRIED on the parent; **a carried `null` is the honest answer and must never trigger a fallback re-read** (that would mask a broken batch). Key *absence* alone triggers the single-row fallback — so the single-row methods are kept as the fallback, not deleted as dead code. TypeScript detail: `in`-narrowing does not strip `undefined`/`null` from optional intersection members, so spell presence as `!== undefined` / `=== undefined` guards; `??` is sound only where the carried type cannot be null (a carried `0` count must be preserved); for a non-nullable field whose carried null is contract-violating, surface the localized domain denial instead of silently re-reading (the seam bug becomes loud, not invisible).
6. **Flat structural supertype, never a wrapper:** Pothos `objectRef` enrichment must be a flat intersection (`RowType & { plan?, count?, peek? }`) merged onto row copies with the repo's `Object.assign` idiom — a `{ row: … }` wrapper breaks every `t.expose*` passthrough.
7. **SDL byte-identity when changing resolver behavior:** capture the generated schema hash before and after; a resolver-behavior change that adds no fields must leave the SDL byte-identical (`generate:gqlSchema` diff empty, codegen a no-op). The hash is the structural proof that no field was added, removed, or re-nullabled.

---

## 5. Evidence discipline

### No folklore indexes, no folklore caches

An index is added **only** against an EXPLAIN case (a materialized scan at/above the volume threshold, or a gate threatened by plan cost — the decision is a conditional with explicit entry triggers, and "no-change" is a complete verdict: *both paths of the decision are deliverables*). A cache is added only against a measured evidence case with the cheaper levers adjudicated exhausted (the full funnel lives in `docs/performance/caching-strategy.md`). Two corollaries that recur:

- **A predicate matching ~100% of a table's rows has no btree case** — if the EXPLAIN filter matches every seeded row, an index on that predicate would scan the whole table anyway; the seq scan is the planner being correct.
- **A missing index is not the only explanation for a scan.** A `Materialize → Seq Scan` with the covering index *present and chosen in every filtered variant* is a cost-based planner choice; adding an index elsewhere does not change that tradeoff. Probe the live catalog before concluding coverage gaps.

### Honest FAIL verdicts and adjudication

A gate verdict is recorded as measured, never softened — FAIL rows travel through the sign-off table with their adjudication (which surface breached, why, what was ruled out, what the bounded residual risk is) and their designed resolution path. The plan-level pattern worth keeping: a FAIL with both in-scope levers exhausted goes to the ledger **with evidence**, and the re-entry loop is explicit (a later FAIL at the gate regime re-opens the conditional index decision with real cost data). "Both paths are complete — the gate outcome is the deliverable" is the honest shape of a conditional optimization decision.

### Instrument your instruments — the dead `pg_stat_activity` sampler

The most expensive lesson in the corpus. The load harness's DB-activity sampler was doubly defective: it bound the **full DSN** where `datname` expects the **bare database name** (zero rows matched), and treated the pg `QueryResult` as a bare array (`Array.isArray(rows) ? rows : []` — always empty), so `nonIdleCount` was **structurally 0 at every sample**. The resulting "database is idle" observation was an artifact, not a measurement — it was retracted, the sampler fixed, and the re-run captured the honest picture (peak 8 non-idle of the 10-connection pool).

Three durable rules fall out:

1. **A structurally-zero reading is indistinguishable from a zero observation until you verify the evidence channel end-to-end** — bind the same value the query compares against, and consume the result in the shape the driver actually returns (`QueryResult.rows`).
2. **When an instrument is found defective, retract everything downstream of it and re-measure; keep the verdicts that were instrument-independent** (the latency/error gates were unaffected; the DB-ruled-out claim was not).
3. **Measured-vs-claimed numbers must match the retained artifact exactly.** A follow-up micro-fix corrected docs that said "two lock-blocked queries / three active connections" where the artifact recorded three and four. Cite artifacts, not memory — re-read the `report.json` before writing any number into a durable doc.

### Machine-class capture

Every gate run records the machine class (cores, load average, available memory/swap) and the one-host assumption (load generator same-host as the server). p95 gates are comparative on the machine class; a verdict without its environment context is not reproducible evidence.

---

## 6. Durable performance findings (this stack, at ~100 concurrent users)

- **Single-process `next start` CPU saturation.** Under a 100-VU login-heavy API load, per-request latency degrades **superlinearly** with concurrency (10 VUs → 100 VUs is a 10–17× collapse in p50s) while the DB pool stays busy-but-not-saturated (peak 8/10 non-idle). The signature: a bimodal per-scenario split (admin p50 21–390ms vs p95 3,831–5,753ms) — cheap requests stall behind CPU-bound ones in a single-process queue. The dominant suspect is the pure-JS `bcryptjs` compare at hardcoded `BCRYPT_ROUNDS = 12` on the login path (no env override exists — 12 rounds is the deliberate production-grade setting, identical in test and prod) plus GraphQL parse/execute serialized on one process. `next start` has no cluster/worker knob.
- **What the fixed-sampler re-run actually showed:** peak-rows are `ClientRead`-dominant (`idle in transaction` waiting for the server to send the next command) with booking-path `FOR UPDATE` lock waits on `teacher` rows — connections wait for the server, not vice versa. The DB contributed lock-queue latency to the booking path and held connections open during server-side stalls, but was not read-throughput-saturated; a distributed query cache would not have rescued the gate (the caching-strategy doc's closing evidence).
- **Resolution surface:** staging/cloud re-execution is the designed path to a passing gate on dedicated hardware; the out-of-scope levers (lower bcrypt rounds, native bcrypt binding, multi-process deployment, dedicated load host) each require code or infra changes and are named for a future owner. The runbook carries the re-execution path and the guard-interplay warning (staging DB must be named `kottaby_test` or the guard refuses).
- **Pool ceiling:** the shared client's `max: 10` pool is hardcoded; this plan measured reality under the ceiling — any resize proposal must cite the retained `pg_stat_activity` peak artifacts.
- **Presence decay vs. seeded data:** the product's teacher presence-decay sweep flips `users.last_active_at`-NULL teachers offline; the seeder does not stamp `last_active_at`, so any event that triggers the sweep silently zeroes the browsable pool mid-run (hot teachers with `started` sessions are spared). Re-seed or refresh `last_active_at` immediately before browse-volume work — this is an environment interaction, not a pagination/matching defect.
- **Env preconditions that bite prod-mode boots:** production-mode boots require `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET` in the parent env (`.env.test` carries neither; dev derives them from `DATABASE_ENCRYPTION_KEY`). `--env-file` suppresses Bun's `.env` auto-load, so `REDIS_URL` must be exported explicitly for the WS tooling. Both are documented with the runbook's environment caveats.

---

## 7. Schema & migration gotchas (Drizzle-adjacent)

The FK-index remediation (4 uncovered columns → 37/37 covered) established a workflow worth reusing; the push friction it surfaced is a general Drizzle lesson.

- **Index-verification workflow:** add the `.index()` definitions in the schema files (name convention `<table>_<column>_idx`) → `bun run db push --env-file=.env.test` → lock the indexes in the **owning repo test suites** with `pg_indexes` catalog probes (exactly one row, `USING btree`, the column as leading key) → re-run the coverage auditor, whose `observedMatchesBaseline` drift flag flips false precisely when the documented gap set is gone. The audit derives its expectations from the **live catalog**, never a hardcoded covered-list; the documented baseline exists only as a drift flag to prove remediation.
- **`drizzle-kit push` cannot scope global enum diffs.** PostgreSQL can only `ALTER TYPE … ADD VALUE` (append), so a migration that appended enum values leaves the live DB's enum order permanently different from the committed schema's canonical order — **every subsequent push bundles a `recreate_enum`** alongside the intended statements, and `--tablesFilter` (verified both forms) cannot exclude it; the SDK has no statement filter either. The value *set* is identical (cast-preserving, no data loss), so drizzle-kit raises no hints. The sanctioned procedure when the bundle appears: `--explain --output json` dry run first, diagnose the fifth statement, get a ruling, execute in a verified quiet window (`pg_stat_activity` zero non-idle, zero locks), and prove data integrity with a pre/post row count on the affected table.
- **Readiness + lifecycles:** the harness-booted server health probe is a HEAD request expecting a bare status (no body parse); teardown must be signal-safe (SIGTERM → grace period → SIGKILL) with exit codes preserved (SIGINT/SIGTERM → 130/143) so orphaned children are structurally impossible.

See `docs/drizzle/` for driver-level topics (prepared statements, the Neon HTTP client).

---

## 8. Testing gotchas (DB and journey layers)

Compact, repeatedly-rediscovered items — the layer AGENTS files state the rules; these are the failure modes that kept recurring:

- **`runInRollback` discipline:** pass `tx` to ALL repository methods inside the transaction — mixing `tx` queries with `db`-backed repo calls deadlocks. Never use `expect(...).rejects.toThrow()` inside a rollback (deadlock class); use a try/catch capture helper. Never query seed data — create fixtures via `entity-setup.ts` helpers (verify signatures first; they vary).
- **Journey-test shape:** ONE committing `beforeAll` transaction (commit-or-nothing) scales fine to ~200 fixture rows; provisioning loops must be recursive helpers (`no-await-in-loop` is deny-warnings). Register **every** service-created row for teardown (query rows scoped to fixture ids — never assume the service's return values are the complete worklist) and make the fixture registry's `cleanup()` **re-probe every registered row**; a double-run green is the idempotent-teardown proof. Immutable trigger tables (audit logs) are asserted-zero via counters, never tracked/deleted.
- **Spied seams:** when a flow has no transport-injection parameter, the spy sits on the engine's publish boundary (namespace import + `spyOn`), restored in `afterAll`; recorded receipts must carry the target ids so per-recipient assertions stay exact. Zero realtime/network delivery occurs through a spied boundary.
- **Per-occurrence oracles:** expected per-actor state must derive from that actor's OWN outcome (a rejection is accounted honestly, not assumed away). Deadlock detection must walk Drizzle's error **cause chain** (`hasPgCode`) — the pg error code hides a level down.
- **Fixture-scoped visibility probes on a shared DB:** unscoped "browse page 1" containment assertions are nondeterministic when sibling suites seed rated teachers into the same database. Scope the probe by a per-run-unique fixture name (the matcher's search path) so only this run's row can match — the plain browse is kept only for envelope-shape checks. This class of flake bit twice (the J1 journey and a sibling suite).
- **Type/lint trivia that recurred:** no `noUncheckedIndexedAccess` in this repo, so `arr[i] === undefined` reads as always-false to `sonarjs/different-types-comparison` — use `.at(i)`/`.find(...)` for genuine `T | undefined`. `toSorted` needs an explicit comparator for strings. JWT-shaped string literals trip `no-hardcoded-secrets` — assemble fixtures via `join(".")`. Bun's `fs.readSync` needs the 5-arg overload with explicit `position: null`; plain-HTTP stub servers type as `ReturnType<typeof Bun.serve>`. `bun biome:check` is repo-wide `--write --unsafe` — it can reformat sibling files mid-write; expect sibling mtimes to move. Cognitive-complexity budget is 15 per function at the type-aware lint stage — split large tests into module-level helpers.

---

## 9. Cross-stream shared-tree lessons

This plan ran concurrently with sibling plan streams editing the same tree and the same shared `kottaby_test` database. What kept attribution honest:

- **Capture the baseline at a fixed commit with on-disk artifacts** (`/tmp/baseline-*`), and diff against that — never against the current mixed working tree. Pre-existing errors are baseline noise, not yours to fix; **never "fix" a sibling-owned file** from another plan's task (the ledger records it as a resolved pointer instead).
- **Surgical edits only:** byte-exact diffs (single-line insertions, repointed sentinels with a two-line comment) so the review wave can attribute every changed line. When replacing a shared stub that other tests still reference, grep for consumers before deleting (the shared runner dies only when the LAST stub consumer is gone).
- **Zero-residue DB hygiene is a cross-stream obligation:** seed → evidence → cleanup-to-zero-residue (tool probe + independent SQL re-probe) after every run, so concurrent suites never observe your fixtures. Shared-DB race attribution: a failing sibling test that asserts global table counts inside a READ COMMITTED transaction across two statements will flake against any parallel writer — verify in isolation before blaming either side.
- **Line anchors drift in a live tree:** re-verify every `path:line` citation against the current tree before acting on it; a stale-`HEAD`-based "this symbol does not exist" claim needs live-tree adjudication (two such findings were false in plan review R1).
- **Concurrent-format collisions are real:** a repo-wide formatter run reflowing a file while a type checker reads it produced a one-off transient type error that vanished when the write settled — re-verify before "fixing" ghosts.

---

## Related

- `docs/performance/load-testing.md` — the operator runbook: every harness command, gate, precondition, retained artifact, and the honest §6 sign-off table. **Read that first when you want to RUN something.**
- `docs/performance/caching-strategy.md` — the cache-inventory and evidence-threshold funnel (when a cache is justified; the `CACHE_PROVIDER` seam's entry criteria).
- `docs/graphql/dataloader-batching.md` — the batching-first rationale behind §6 6.5's page-level enrichment.
- `docs/notifications/realtime-engine.md` — the WS sidecar, Redis fan-out bus, and connection-cap policy the WS harness exercises.
- `docs/ops/disaster-recovery.md` — the guard-first / exit-code / artifact-convention posture this toolchain mirrors.
- `docs/drizzle/` — driver-level topics (prepared statements, Neon HTTP client).
- Plan artifacts — `ai/plans/milestone_4_integration_security_launch/load_testing_performance-load-testing-performance/` (the per-task `outcome/` corpus this document distills; the deferred-items ledger D1–D17).
