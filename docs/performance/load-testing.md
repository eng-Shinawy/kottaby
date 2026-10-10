# Load Testing — Performance Verification Runbook (§6 Evidence Bundle)

> **Scope:** operator runbook for the `scripts/perf/` verification toolchain — how to run each harness, what gate it enforces, where the evidence lands, and what to do when a gate fails.
> **Audience:** the launch operator executing `docs/planning/PRODUCTION_READINESS.md` §6 (items 6.1–6.7) and any engineer re-running a gate after a change.
> **Posture:** shell-only tooling under `bun run perf:*`; every tool hard-refuses any database target other than `kottaby_test` (destructive-target guard); no secrets ever appear in reports; all run artifacts are gitignored under `logs/perf/`.

---

## Why

The launch-readiness checklist blocks launch on seven performance rows (`docs/planning/PRODUCTION_READINESS.md` §6, items 6.1–6.7) that were prose targets with no executable evidence path. This runbook binds each row to one reproducible command, one gate, one artifact path, and one interpretation — turning the sign-off into a checklist walk instead of an investigation.

The platform holds **wallet balances, escrow holds, and append-only audit logs**; a matching pipeline that degrades under load or an API that collapses at 100 concurrent users is a financial-truth incident, not a cosmetic one. Every gate below therefore measures the real stack: the real PostgreSQL database, the real login mutation, the real GraphQL schema, the real WebSocket sidecar — never a mock.

**Verdict discipline:** every harness prints a terminal `VERDICT: PASS|FAIL` and exits 0 on PASS / 1 on FAIL (or runtime failure) / 2 on usage, guard, or configuration refusal. A FAIL is recorded honestly — this document's sign-off table (below) carries the FAIL rows verbatim, including the §6 6.1 row that failed on local hardware, with the sanctioned resolution path (staging/cloud re-execution) spelled out.

---

## The Toolchain

Seven commands, registered in `package.json` (each pinned byte-exact by `scripts/perf/scripts-registration.test.ts`):

| Command | Purpose | §6 item(s) |
|---|---|---|
| `bun run perf:seed` | Bulk production-shaped dataset (2,000 teachers / 120 funded students / 5,000 sessions / 20,000 notifications / 500 subscriptions, prefix-isolated per run id) | precondition for all |
| `bun run perf:cleanup` | Manifest-driven hard-delete of one seed run, zero-residue re-probe | lifecycle |
| `bun run perf:bench-matching` | Matching-pipeline latency benchmark, 36-cell volume × sort × filter matrix | 6.2 |
| `bun run perf:verify-indexes` | FK-index coverage audit (live catalog) + hot-column planner check | 6.6 |
| `bun run perf:analyze-queries` | EXPLAIN (ANALYZE, BUFFERS) auditor over a canonical 18-query registry with a scan gate | 6.4 |
| `bun run perf:load-api` | 100-VU weighted GraphQL load generator against a production-mode server | 6.1 |
| `bun run perf:load-ws` | 100-connection WebSocket stability + fan-out harness | 6.3 |

Items 6.5 (N+1) and 6.7 (pagination) are evidenced by their dedicated regression suites and sweep probe (sections below) — the numbers they need are not reproducible from a single `perf:*` invocation by design (6.5 is a code-invariant lock; 6.7 is a surface census).

**Artifact convention:** every run writes `logs/perf/<YYYY-MM-DDTHH-MM-SS>_<tool>/` containing `report.md` (human) + `report.json` (machine), plus tool-specific sidecars (`fk-coverage.md`, `explain/<id>.json`, `pagination-evidence.md`, `pagination-surface-table.md`). `logs/perf/` is gitignored — artifacts are local evidence, cited by path in the sign-off table and plan outcomes.

---

## Per-§6-Item Operating Procedure

### Quick reference

| §6 item | Command | Key preconditions | Gate |
|---|---|---|---|
| 6.1 API p95 | `perf:load-api` | `build:test` prod dist; fresh seed; `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` exported; `TEST_SERVER_MODE=production` | per-scenario p95 < 500 ms @ 100 VUs + zero errors |
| 6.2 matching | `perf:bench-matching` | active full-volume seed | p95 < 200 ms at the 12 volume-100 cells |
| 6.3 WebSocket | `perf:load-ws` | Redis up; seed with ≥21 ws identities; `REDIS_URL` exported; reachable server for minting | 100/100 handshakes, zero drops, liveness, fan-out 100 % + p95 < 2000 ms, zero residue |
| 6.4 query plans | `perf:analyze-queries` | active full-volume seed | zero Seq Scans with `Plan Rows` ≥ 1000 at seeded volume + NOT EXISTS served by `session_teacher_id_status_idx` |
| 6.5 N+1 | wire oracle suite + evidence probe | dev/test server + live DB | constant ≤ 6 SQL statements per page across page sizes {1, 25, 100} |
| 6.6 FK indexes | `perf:verify-indexes` | none (catalog-based) | zero uncovered FK columns (37/37) |
| 6.7 pagination | sweep probe (scratch) | prod dist; fresh seed; JWT secrets exported | every list surface bounded (clamp or `VALIDATION` reject) |

### 6.1 — API response time, p95 < 500 ms @ 100 VUs

```bash
bun run build:test                                   # prod dist .next-test-prod (required for production mode)
bun run perf:seed -- --run-id <hex8>                 # fresh full-volume seed (defaults: 2000/120/5000/20000/500/8)
JWT_ACCESS_SECRET=<value> JWT_REFRESH_SECRET=<value> \
  TEST_SERVER_MODE=production TEST_SERVER=1 \
  bun run perf:load-api -- --run <hex8>
```

- **Preconditions:** production-mode boot requires the two JWT secrets in the parent environment (see caveat 1 — `.env.test` does not carry them; the harness's spawned server inherits `process.env`). A fresh seed is required: booking consumes student balances, and a spent seed yields mostly `INSUFFICIENT_BALANCE` rejections (valid accounted outcomes, but not the booking-success volume the gate wants to observe).
- **Defaults:** 100 VUs (91 student + 9 admin), 120 s steady window after a `10/5s` ramp, gate 500 ms, harness boots `bun run next start` over `.next-test-prod` on port **3066**. Scenario weights (relative, sum 110): login 10 · browse 20 · browse-filtered 20 · my-subscriptions 20 · my-notifications 20 · book-session 10 · admin 10. `book-session` is `mustSucceed: false` — domain rejections are accounted outcomes, never errors.
- **Gate:** per-scenario `p95 < 500 ms` (exactly-at-limit fails; zero-sample gates fail closed) **and** zero errors (transport + unexpected-shape + domain rejections on mustSucceed scenarios). On FAIL the harness captures a `pg_stat_activity` peak snapshot (first sample + every 5 s; full peak rows retained on FAIL only).
- **Artifacts:** `logs/perf/<stamp>_load-api/` (`report.json` + `report.md`, incl. per-scenario histograms, error taxonomy, `bookingOutcomeAccounting`, pg snapshot).
- **Interpretation:** decompose by scenario first. A bimodal split (cheap scenario with low p50 but high p95 — e.g. admin p50 21 ms vs p95 3.8 s) is the signature of single-process serialization, not query cost. A pg snapshot showing peak non-idle connections = 0 rules the database out entirely. The booking accounting must reconcile: `created + translated-domain-rejection + transport-error == attempts`, zero transport/5xx.
- **Budget:** ~191 s wall for the full-defaults run (50 s ramp + 120 s window + boot/mint/teardown ≈ 21 s).

### 6.2 — Matching pipeline, p95 < 200 ms with 100+ teachers

```bash
bun run perf:seed            # full defaults (or: bun run perf:seed -- --run-id <hex8>)
bun run perf:bench-matching  # defaults: --volumes 100,500,2000 --samples 30 --warmup 5 --gate-ms 200
```

- **Preconditions:** an active full-volume seed (the benchmark filters the seeded set to the volume head; a cleaned seed run triggers the designed exit-2 headroom refusal). No server needed — the benchmark calls `TeacherMatchingService.browseAvailableTeachers` directly through the global `db` pool.
- **Gate:** p95 < 200 ms at the **12 volume-100 cells** (3 sorts × 4 filter variants). The 500- and 2,000-teacher cells are **scale-evolution evidence, not the launch gate** — do not treat a 2,000-cell miss as a gate failure.
- **Artifacts:** `logs/perf/<stamp>_bench-matching/` (`report.json` + `report.md`); every sample carries the INV-A3 exclusion oracle (no `started`-session teacher in a result page) and envelope consistency (`page`/`pageSize`/`pageCount`/`total`).
- **Interpretation:** 36 cells × 5 warmups + 30 samples = 1,080 recorded samples, zero errors expected. Windowing math: browsable pool = volume − 8 hot teachers (the hot subset holds the `started` sessions the matcher's NOT EXISTS excludes). A gate FAIL at the 100-teacher cells re-enters the conditional-index decision (task 3.4's trigger-2 path: add `teacher_matching_online_approved_idx` + `teacher_average_rating_idx` per the documented entry criteria); a FAIL only at 2,000 teachers does not.

### 6.3 — WebSocket stability, 100 concurrent connections

```bash
redis-cli ping                                        # must answer PONG
# a reachable Next.js server for minting (dev-mode convention works):
REDIS_URL=redis://localhost:6379 bun run perf:load-ws -- \
  --connections 100 --identities 21 --duration-s 300 --fanout-bursts 3 \
  --run <hex8> --base-url http://127.0.0.1:3100
```

- **Preconditions:** Redis up; `REDIS_URL` **exported in the parent shell** (`.env.test` does not carry it — see caveat 2); an active completed seed manifest with ≥ 21 ws identities (the 2.1 manifest caps at 25); a reachable server at `--base-url` for login minting. When nothing listens on port 3101 the harness **boots its own sidecar** (`scripts/start-notification-ws.ts`) and tears it down on every exit path — no manual sidecar management needed.
- **Gate (5 gates, all must pass):** handshake 100/100 (classified close-code vocabulary: `4401` unauthenticated, `4429` throttled, `1013` overloaded); stability — zero drops through the window (harness-initiated teardown closes are never drops); liveness — no connection reaches 2 consecutive missed 30 s observations; fan-out — per burst 100 % delivery + p95 strictly < 2000 ms (0 bursts fails closed); residue — zero post-close deliveries, zero unclosed sockets.
- **Artifacts:** `logs/perf/<stamp>_load-ws/` (`report.json` + `report.md`); the report's environment section embeds the **soak command** verbatim.
- **Interpretation:** the ramp (`5/2s` burst-then-drip + 250 ms safety margin) mirrors the server's token bucket — a `4429` in the report means the ramp was tightened improperly, not a server defect. Dropped connections are recorded, never retried (`--no-reconnect` is always the behavior). Budget: ~190 s ramp + window + teardown ≈ 8.5 min at defaults.
- **Soak (operator work):** `bun run perf:load-ws --duration-s 3600` — the §6 6.3 one-hour evidence window. Budget ≈ 190 s ramp + 3,600 s window + teardown ≈ 65 min. Same preconditions as the stability run.

### 6.4 — Database query performance, no full table scans

```bash
bun run perf:seed            # seeded volume required for the EXPLAIN context
bun run perf:analyze-queries  # default --scan-threshold-rows 1000
```

- **Preconditions:** an active full-volume seed — the gate is scale-aware and defined **at seeded volume** (see caveat 4). The auditor executes the **real repository reads** (18-registry entries: 12 matching variants, both subscription lists, notifications list, both session lists, user-by-id) inside a pg capture window, then re-executes each captured statement under `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` with parameters re-bound positionally.
- **Gate:** `scan-gate` — zero `Seq Scan`/`Parallel Seq Scan` nodes with `Plan Rows >= --scan-threshold-rows` (default 1000, inclusive; null/unreadable rows count as a breach — fail closed; CTE scans are reported but exempt) **and** `matching-session-index` — every matching entry's NOT EXISTS subplan reads `session` through `session_teacher_id_status_idx`.
- **Artifacts:** `logs/perf/<stamp>_analyze-queries/` (`report.json` + `report.md` + `explain/<entryId>.json` per registry entry).
- **Interpretation — the honest verdict is FAIL at seeded volume, adjudicated:** the retained full-volume evidence run (below) breaches on exactly two surfaces, both adjudicated to no-action by the evidence-gated index decision (outcome 3.4):
  1. `Seq Scan on users (1931 >= 1000)` in the 3 plain matching variants — the scan's filter is the `is_deleted/suspended/is_blocked` triple matching ~91 % of the 2,121-row users table; the only candidate users indexes are ruled out (leading-wildcard ILIKE cannot use btree on `full_name`; the country tier is a 2-valued CASE with no selectivity on `country_code`). The scan is the planner being correct at this data shape.
  2. `Materialize → Seq Scan on session` on the same 6 statements — a cost-based planner choice **with the index present** (every filtered variant chooses `Index Only Scan session_teacher_id_status_idx`); no missing index exists to add.
  3. The `teacher` scan estimates only 48 rows after the `is_online AND is_approved` filter — far below the 1,000-row "materialized" threshold; both conditional-index entry triggers are unmet (no materialized teacher scan ≥ threshold; the 200 ms gate is not threatened — direct timings ≤ 101.3 ms/statement at 20× the launch regime's volume).
  Residual risk is bounded by direct timing evidence: ≤ 101.3 ms per statement at the full 2,000-teacher volume. **Structural note:** while the registry includes the plain variants, the users scan will breach the scan gate at any full-seed-volume run under the current no-index rulings — re-interpret new FAILs against this adjudication before treating them as regressions.

### 6.5 — N+1 query elimination

Two evidence surfaces (no single command by design — one is a CI lock, one is a measurement):

```bash
# CI regression lock — K=6 wire oracle (real schema + real services + real PostgreSQL):
bun run test:graphql backend/graphql/test/subscription-enrichment.query-count.test.ts
# service-seam mock-call-count lock (one batch call per page at sizes 1/25/100/1001):
bun run test/scripts/run-test.ts backend/services/billing/subscription-admin-enrichment.service.test.ts
# before/after measurement (harness process only — imports scripts/perf/lib/query-counter):
bun --env-file=.env.test scratch/5.3-n1-evidence.ts
```

- **Gate:** the statement count per enriched subscription page is **constant** across page sizes {1, 25, 100} and ≤ K = 6 (exact constancy asserted — any per-row fan-out fails before the bound applies). Measured: own list **4** (1 listing + 3 batch reads), admin list **5** (+1 BFLA gate read), empty page 2.
- **Artifacts:** `logs/perf/<stamp>_n1-evidence/` (`report.json` with per-operation before/after counts + `report.md`).
- **Interpretation:** the before shape was 3N+1 / 3N+2 (own: 4/76/301; admin: 5/77/302 at page sizes 1/25/100); the after shape is flat 4/5 at every size. The fix is parent-carried enrichment at the resolvers with the single-row reads kept as the non-list-producer fallback; the SDL is byte-identical (sha256 `e63700bb…61689`, 66,978 bytes, before == after). Any future list producer returning plain rows fails the wire oracle's constancy assertion by construction.

### 6.6 — Index coverage, all FKs indexed

```bash
bun run perf:verify-indexes            # human output; VERDICT + uncovered list
bun run perf:verify-indexes -- --json  # machine body on stdout (report files still written)
```

- **Preconditions:** none for the FK audit (live-catalog based). Re-seed only when the hot-column EXPLAIN context (matching plan scans at ≥ 2,000-teacher volume) is wanted.
- **Gate:** zero uncovered FK columns. Coverage rule: an FK column is covered iff some **btree** index on the same table lists it as its **leading** key column, or the constraint's referencing columns form a **prefix** of the index's key columns (PK/unique-constraint backing counts — PostgreSQL implements both as btree; partial indexes count; non-btree and unparseable definitions never cover, conservatively).
- **Artifacts:** `logs/perf/<stamp>_verify-indexes/` (`report.md` + `report.json` + `fk-coverage.md` — the full 37-row covered/uncovered table).
- **Interpretation:** the documented-baseline drift flag (`observedMatchesBaseline`) exists to prove remediation — it is `true` while the four historical gaps are present, and flips `false` once the gap set is empty (or a novel gap appears). Remediation is already shipped: the four FK indexes (`broadcasts_sent_by_id_idx`, `broadcasts_stopped_by_idx`, `session_request_idempotency_session_id_idx`, `subscription_purchase_idempotency_subscription_id_idx`) are in the schema and applied to `kottaby_test`. A fresh `true` verdict after this point means either a new uncovered FK appeared (fix it) or the audit ran against a stale catalog.

### 6.7 — Pagination, all list endpoints bounded

The evidence sweep runs through a scratch wire probe (not a registered `perf:*` command — the census spans 20 wire-probed + 13 code-cited surfaces):

```bash
bun run build:test
bun run perf:seed -- --run-id <hex8>
JWT_ACCESS_SECRET=<value> JWT_REFRESH_SECRET=<value> \
  bun --env-file=.env.test scratch/probe-9-1-pagination-sweep.ts <hex8>
```

- **Preconditions:** prod dist; fresh seed (browse-volume evidence needs the full pool live — see caveat 7); JWT secrets exported (the probe boots the same production-mode server as the 6.1 harness on port 3066); the probe mints caller-authorized identities (student/teacher/admin) through the real `login` mutation.
- **Gate:** every list surface is bounded — oversized args (`pageSize=5000`/`limit=5000`) are either REJECTED with `extensions.code=VALIDATION` before any database work, or CLAMPed to the default window with an honest echo; absence-of-args applies the documented default window; deep offsets return empty items next to the honest unfiltered total; zero-arg surfaces are owner/catalog-bounded.
- **Artifacts:** `logs/perf/<stamp>_pagination-sweep/` (`report.json` with the 47-probe matrix rows, `pagination-evidence.md`, `pagination-surface-table.md` — the per-surface cap/bound-source/envelope table).
- **Interpretation:** 47/47 probes PASS across the 20 wire-probed surfaces. The full-volume browse evidence (`total=1992`) lives in the **first** retained run (`2026-10-09T22-10-22_pagination-sweep`): the presence-decay sweep (caveat 7) had zeroed the browsable pool by the later runs, and an empty pool (`total=0`) is a valid browse state, not a bounds failure.

---

## Seed & Cleanup Lifecycle

Every harness consumes a **seed run**: an isolated, prefix-scoped dataset (`perf_<runId>_%` on emails/names/handshakes/references/titles) recorded in a manifest before the first insert.

**Seed (defaults produce the full production-shaped volume):**

```bash
bun run perf:seed -- --run-id <hex8>   # flags: --teachers 2000 --students 120 --sessions 5000
                                       #         --notifications 20000 --subscriptions 500
                                       #         --hot-teachers 8 --seed <n> (determinism knob)
                                       #         --force-prod-shaped-target (guard override, stdin re-confirm)
```

- Re-running the same `--run-id` **refuses** (exit 2) until the prior run is cleaned — the designed concurrent-seeder guard.
- The manifest (`logs/perf/<stamp>_seed/seed-manifest.json`) records counts, identities (ws identities capped at 25), the FK-safe `tables` order, and a bcrypt **hash** of the per-run credential — the plaintext is never persisted (it is derived from the run id at mint time).

**Cleanup (manifest-driven, zero residue):**

```bash
bun run perf:cleanup -- --run <hex8>   # or --last (newest completed manifest)
```

- Deletes strictly in the manifest's FK-safe order (children first, `users` last — `session`/`subscriptions` are RESTRICT and must precede `users`), then re-probes all nine tables with the escaped prefix pattern. Exit 1 on any residue with the offending table listed. Idempotent — a second run deletes 0 rows and exits 0.
- **Discipline:** clean every seed run when its evidence work ends; verify zero residue with an independent probe (the 4.2/8.2 precedent: direct-prefix + join-armed SQL across every users-referencing table). Booking-created rows are user-join-scoped and die with the user delete.

---

## §6 Sign-Off Table

Assembled from the retained evidence runs (each row cites its harness report; verdicts are the honest current state — a FAIL is never softened):

| §6 item | NFR gate | Harness | Verdict | Run id / artifact | Timestamp (report start) |
|---|---|---|---|---|---|
| **6.1** — API p95 @ 100 VUs | p95 < 500 ms per scenario, zero errors | `perf:load-api` (production mode, seed `196f67b5`) | **FAIL-local** — all 7 scenarios p95 2,473–4,288 ms; zero errors; booking accounting holds (603 created + 50 domain rejections + 0 transport). **[2026-10-10 correction: the "DB idle at every sample (peak non-idle 0 / 33 samples)" clause recorded here is RETRACTED — the harness's pg_stat_activity sampler was defective at run time (bound the DSN instead of the db name; misread the `QueryResult` shape), so the 0 was an artifact, not an observation. The FAIL verdict stands on the latency/error gates, which are sampler-independent. DB-pressure re-measured the same day with the fixed sampler (fresh seed `8a2c3e56` re-run): **peak 8 non-idle connections of the 10-connection pool across 33 samples, 0 read failures** — the DB was measurably busy but not saturated (peak rows: booking-path `FOR UPDATE` lock waits + `ClientRead`-stalled connections); verdict unchanged — all 7 p95s 3,323–5,753 ms, zero errors, booking accounting holds (415 created + 15 domain rejections + 0 transport).]** Bottleneck adjudicated to single-process server CPU saturation (bcryptjs 12-round login + GraphQL execution), not the DB; in-scope levers exhausted → ledgered (D14). Resolution path: staging/cloud re-execution (see below) | `logs/perf/2026-10-09T21-00-14_load-api/` (+ 10-VU contrast `…T21-10-52_load-api/`; fixed-sampler re-run `logs/perf/2026-10-10T00-19-16_load-api/`) | 2026-10-09T18:00:14Z |
| **6.2** — matching pipeline | p95 < 200 ms at the 12 volume-100 cells | `perf:bench-matching` (seed `a591b17d`) | **PASS** — worst 100-teacher-cell p95 **6.85 ms** (28.7× headroom); 1,080 samples, zero errors, INV-A3 exact on every sample; scale-evolution: 2,000-teacher worst p95 **11.46 ms** (under budget at 20× the regime) | `logs/perf/2026-10-09T13-28-27_bench-matching/` | 2026-10-09T10:28:31Z |
| **6.3** — WebSocket stability | 100 conns held, zero drops, fan-out 100 % + p95 < 2000 ms, zero residue | `perf:load-ws` (seed `51ee076f`, 25 ws identities) | **PASS** — 100/100 handshakes, zero throttle refusals, zero drops through 300 s, zero liveness misses, 3× 100/100 fan-out at p95 37/2/3 ms. One-hour soak command delivered: `bun run perf:load-ws --duration-s 3600` (operator work) | `logs/perf/2026-10-09T15-48-02_load-ws/` | 2026-10-09T12:48:02Z |
| **6.4** — query plans | zero materialized Seq Scans at seeded volume (≥ 1,000-row threshold) + matching NOT EXISTS on index | `perf:analyze-queries` (seed `034957e6`, full volume) | **FAIL-at-seeded-volume, adjudicated** — 6 scan-gate breaches (`users` 1931-row scans, 3 plain variants × count/page) + 6 session-index breaches (planner-choice Materialize with the index present); `teacher` scan 48-row estimate, far below threshold. Every breached surface adjudicated no-action with evidence (users → no-index ruling; session materialize → cost choice; teacher → below threshold); residual bounded by ≤ 101.3 ms/statement direct timings at 20× regime | `logs/perf/2026-10-09T10-57-45_analyze-queries/` (18 explain artifacts) | 2026-10-09T07:57:45Z |
| **6.5** — N+1 elimination | constant ≤ 6 SQL statements per page across sizes {1, 25, 100} | wire oracle suite + `scratch/5.3-n1-evidence.ts` | **PASS** — before 3N+1/3N+2 (own 4/76/301, admin 5/77/302) → after constant **4/5** at every size; K=6 lock CI-wired; SDL byte-identical (`e63700bb…`, 66,978 bytes) | `logs/perf/2026-10-09T14-41-33_n1-evidence/` | 2026-10-09T14:41:33Z |
| **6.6** — index coverage | zero uncovered FK columns | `perf:verify-indexes` | **PASS (before → after)** — before: exactly the 4 documented gaps (`observedMatchesBaseline: true`); after: **37/37 covered**, zero uncovered, `observedMatchesBaseline: false` (remediation proven against the live catalog) | before `logs/perf/2026-10-09T08-47-32_verify-indexes/` (+ `…T09-13-53_…`); after `logs/perf/2026-10-09T09-18-56_verify-indexes/` | after run 2026-10-09T09:18:56 |
| **6.7** — pagination | every list surface bounded (clamp or `VALIDATION` reject) | sweep probe (seed `196f67b5`, production mode) | **PASS** — 47/47 wire probes across 20 surfaces (+13 code-cited; no seeded identity of those roles); every surface clamps with an honest echo or rejects oversized args before any DB work; full-volume browse evidence (`total=1992`) in run `…T22-10-22_…` (pre-decay) | `logs/perf/2026-10-09T22-20-09_pagination-sweep/` (+ runs `…T22-10-22_…`, `…T22-14-19_…`) | 2026-10-09T22:20:09+03:00 |

> **Row provenance:** each verdict is read from the cited run's `report.json` (`verdict` field) or the owning task outcome in the plan directory (`ai/plans/milestone_4_integration_security_launch/load_testing_performance-load-testing-performance/outcome/`). The final quality gate (plan task 11.2) re-verifies every row and mirrors this table into the launch checklist — this table is the working sign-off, not a copy-paste into `PRODUCTION_READINESS.md`.

---

## Environment Caveats

1. **Production-mode boot needs two JWT secrets in the parent shell.** `backend/lib/env.ts:695-702` throws when `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` are absent in production mode; `.env.test` deliberately carries neither (dev derives both from `DATABASE_ENCRYPTION_KEY` — `backend/lib/auth/jwt.ts:74-84`). The harness's spawned server inherits `process.env` (`scripts/perf/lib/load-api-server.ts`), so export them in the invoking shell. **Secret hygiene:** use throwaway random values that exist nowhere on disk; never add them to committed env files; never print them — this document intentionally shows `<value>` placeholders only.
2. **`REDIS_URL` is not in `.env.test`** — and `--env-file` suppresses Bun's `.env` auto-load. Every `perf:load-ws` invocation must export it explicitly (`REDIS_URL=redis://localhost:6379 …`). Without it the transport resolves to `in-process`, which the standalone sidecar cannot use (`scripts/start-notification-ws.ts:27-40` fail-fasts with an actionable message), and the harness refuses pre-report (exit 2).
3. **Rate-limit bypass is the documented test-harness posture (not a harness cheat).** Gates run under the test-server boot env: `TEST_SERVER=1` + `IS_DEMO=true` are the operative limiter bypass (`app/api/graphql/rate-limit.ts:41-48` skips limiting when either test flag is set); the runner also sets the currently-unconsumed `DISABLE_RATE_LIMITING`. Rationale: the per-IP limiter (`backend/lib/ratelimit.ts:63-64`, 100 req/60 s/IP) would measure the limiter itself under a single-origin load generator. **A real production deployment must never run with these flags set.**
4. **The scan gate is scale-aware by design.** `perf:analyze-queries` flags Seq Scan nodes only when `Plan Rows ≥ --scan-threshold-rows` (default 1,000, inclusive) — at seeded volume only tables ≥ the threshold can breach, so small-table seq scans are honest planner choices, not violations. Do not lower the threshold to chase a PASS; interpret breaches against the seeded data shape (see 6.4's adjudication).
5. **The pg pool ceiling is part of every measured latency.** `backend/db/client.ts:175` hardcodes `max: 10`. At 100 VUs the pool queue is real; any pool-resize proposal must cite the 6.1 evidence artifacts — **the 2026-10-10 fixed-sampler re-run (`logs/perf/2026-10-10T00-19-16_load-api/`) is the citable pool measurement: peak 8 non-idle connections of the 10-connection pool across 33 samples (0 read failures), with the peak rows showing booking-path `FOR UPDATE` lock waits and `ClientRead`-stalled connections — busy but below the ceiling**; the resize decision still belongs to that evidence.
6. **Machine class must be recorded with every gate run.** The p95 gates are comparative on the machine class (single load-generator host assumption). Capture cores, load average, available memory, and swap at run time and keep it with the report. The 6.1 evidence run executed on 16 cores with load average ≈ 4–6.7 under concurrent sibling streams and 15 GiB RAM under heavy swap pressure — a calmer machine moves the low-concurrency numbers, but the 100-VU superlinear collapse (10–17× the 10-VU p50s) is structural.
7. **Presence decay silently zeroes the seeded browse pool.** The seeder leaves `users.last_active_at` NULL, so every seeded non-hot teacher is decay-eligible: any event triggering the teacher presence-decay sweep (`backend/db/repo/teachers/teacher.repository.ts:780-811` — flips `is_online=false` for stale/NULL-activity teachers, sparing active `started`-session holders) empties the browsable pool mid-session. **Before any browse-volume run (bench, load, sweep): re-seed, or stamp `last_active_at` immediately before the run.** An observed `total=0` browse result after a decay event is a valid state, not a defect — but it invalidates full-volume browse evidence, so capture such evidence early in a fresh seed's life.
8. **`kottaby_test` is a shared database.** Sibling work streams run DB tests against it concurrently. Rules: never leave a seed live after its evidence work ends (clean to zero residue and re-probe); never leave harness servers/sidecars running (ports 3066/3100/3101 must be free); every tool hard-refuses any DSN not naming `kottaby_test` (exit 2, no run directory created).
9. **`drizzle-kit push` may bundle an enum recreation (the D13 precedent).** Migration `20261006205033` appended 109 `surah_juz_ref` values via `ALTER TYPE ADD VALUE` (PostgreSQL appends only), while the schema declares canonical order — so pushes to `kottaby_test` can bundle a cast-preserving `recreate_enum` alongside intended changes (`--tablesFilter` cannot exclude global enum diffs; no data loss — value sets identical). The sanctioned procedure (proven in the FK-index push): dry-run first (`drizzle-kit push --explain --output json`), verify no `missing_hints`/`confirm_data_loss`, check `pg_stat_activity` for a quiet window (the recreate takes an ACCESS EXCLUSIVE lock), prove row counts before/after, then push.

---

## Triage Order (when a gate FAILs)

Never guess; work the funnel from the report down to the plan:

1. **Read the report first** — per-scenario / per-cell / per-gate decomposition. Which surface breached, and how: uniform inflation (capacity), bimodal split (serialization — cheap requests stalled behind CPU-bound ones), or a single scenario (a query-shape problem)?
2. **`pg_stat_activity`** — the load harness captures the peak snapshot automatically on FAIL. Peak non-idle connections = 0 across samples rules the database out entirely. **[2026-10-10 correction: the 6.1 run's snapshot recorded 0 because the sampler was defective, not because the DB was idle — that specific citation is retracted; the rule itself stands for runs made with the fixed sampler, which measured the 6.1 re-run honestly: peak 8 non-idle of 10 (busy but below the ceiling — see the 6.1 sign-off row).]**
3. **EXPLAIN artifacts** — run `bun run perf:analyze-queries` and read `explain/<id>.json`: Seq Scan breaches against the threshold, plan shapes, index choices. Compare against the 6.4 adjudication before treating a breach as new.
4. **Query-count sample** — if latency grows with page size, run the N+1 lens (`scratch/5.3-n1-evidence.ts` semantics; the K=6 wire oracle is the CI-side proof). Statement counts growing with N = a producer regressed to plain rows.
5. **Apply the two in-scope levers, in this order:**
   - **Indexes (the 3.4 decision)** — applies when the matching plan shows a materialized teacher scan ≥ the 1,000-row threshold at seeded volume, **or** Phase-4/6 evidence shows the 200 ms / 500 ms gate is threatened by plan cost. Entry criteria are evidence-gated ("no folklore indexes" — an index without an EXPLAIN case is not added); re-entry path and the exact triggers are recorded in outcome 3.4.
   - **N+1 (the 5.x fix)** — applies when per-page statement counts grow with page size; the page-level batch enrichment + parent-carried resolver fast path is the shipped pattern, and any new list producer must return enriched rows (the wire oracle fails plain-row producers by construction).
6. **Anything else → ledger with evidence** (the D14 precedent). If the DB is idle, both levers are exhausted, and the report shows single-process CPU saturation, the remaining suspects are **out of this plan's scope** and owned by future tickets: lower bcrypt rounds (code + security tradeoff — `backend/lib/auth/password.ts:12` hardcodes `BCRYPT_ROUNDS = 12` with zero env override), a native bcrypt binding (dependency change), multi-process/clustered deployment (infra), or a dedicated load host (staging — see below). Record the verdict honestly and ledger it; do not soften a FAIL.

---

## Staging / Cloud Re-execution Path (§6 6.1 resolution)

The local 6.1 verdict stands as **FAIL-local** — recorded honestly, not retried into a pass. The designed resolution surface (deferred items D9/D14) is re-executing the harness on staging/cloud where the load generator gets a dedicated host and the server is not competing with sibling streams:

1. **Provision a staging-shaped environment** — production-mode server dist (the `build:test` equivalent for the staging build), Redis for the WS surface, and a PostgreSQL database with the current schema.
2. **Guard interplay (important):** every harness hard-refuses any DSN not naming `kottaby_test` (`assertTestDatabaseTarget`, exit 2 before any effect). Two sanctioned options: (a) name the staging database `kottaby_test` (simplest — the guard then accepts it by name), or (b) use `--force-prod-shaped-target` where the tool plumbs it (`perf:seed`, `perf:cleanup`, `perf:load-api`, `perf:load-ws` — it requires an explicit stdin re-confirmation). The catalog auditors (`perf:verify-indexes`, `perf:analyze-queries`) accept no override flag — point them at a `kottaby_test`-named staging DB or run them locally.
3. **Seed + run** — same commands as §6 6.1 above, with the secrets/Redis exports adapted to the staging env. Record the machine class (cores / load / memory / swap) and whether the load generator is single-origin (the specs' comparative ruling assumes one host; a distributed generator changes the interpretation).
4. **Acceptance** — the passing row replaces FAIL-local in the sign-off table only when the same defaults (100 VUs, 120 s, ramp 10/5s, gate 500 ms, full weights) run on the staging host; a calmer machine alone does not retroactively pass the local run. Budget ~4 min per run including boot; expect a fresh seed (booking balances) if booking-success volume matters to the re-run.
5. **What NOT to expect:** the 100-VU superlinear collapse is structural to the single-process `next start` + bcryptjs-12 login path — staging re-execution with a dedicated host moves the absolute numbers, but a persistent breach there is the signal to open the out-of-scope follow-up tickets (D14's list), not to keep re-running.

---

## What NOT to Do

- **Never** point a `perf:*` tool at a database other than `kottaby_test`, and never bypass the guard casually — `--force-prod-shaped-target` requires an explicit stdin re-confirmation by design.
- **Never** write JWT secret values into committed files, reports, or shell history you share — shell-only, throwaway values (caveat 1).
- **Never** treat the 2,000-teacher benchmark cells, or any scale-matrix cell, as the 6.2 launch gate — the gate is the 100-teacher cells (REQ-2.7 ruling).
- **Never** add an index without an EXPLAIN case (REQ-3.5): "no folklore indexes" — the conditional teacher indexes and every users-column candidate have documented evidence-backed no-action rulings (outcomes 3.4/D3/D10).
- **Never** raise the WS `--ramp` above the `5/2s` bucket defaults — a `4429` in the report means the ramp was tightened improperly, not a server defect.
- **Never** re-run booking load against a spent seed and expect created bookings — `INSUFFICIENT_BALANCE` is a valid accounted outcome; re-seed to restore booking-success volume.
- **Never** interpret a `total=0` browse result mid-plan as a pagination or matching defect without first checking the presence-decay state (caveat 7).
- **Never** force a `db push` whose dry-run bundle contains statements you did not intend — check `--explain --output json` first (the D13 enum-recreation precedent, caveat 9).
- **Never** delete or prune `logs/perf/` artifacts while an evidence row cites them, and never commit them (gitignored by design).
- **Never** leave a seed live, a harness server on 3066/3100/3101, or an orphaned sidecar after evidence work — clean up and re-probe zero residue.

---

## Related

- `docs/planning/PRODUCTION_READINESS.md` §6 — the seven launch-gate rows this runbook evidences (the checklist cells are flipped by the plan's final gate, not by this document).
- `docs/ops/disaster-recovery.md` — the ops-runbook shape this document mirrors (guard-first posture, exit-code discipline, artifact conventions).
- `docs/notifications/realtime-engine.md` — the WS sidecar, Redis fan-out bus, and connection-cap policy behind §6 6.3.
- `docs/graphql/dataloader-batching.md` — the N+1 rationale behind §6 6.5's page-level enrichment pattern.
- `docs/specs/state-machine-invariants.md` — INV-A3 (started-session exclusion) and INV-B4 (booking balance eligibility), both exercised by the seed + harness oracles.
- Plan artifacts — `ai/plans/milestone_4_integration_security_launch/load_testing_performance-load-testing-performance/` (`specs.md` §6 evidence bundle, per-task outcomes under `outcome/`, the deferred-items ledger under D1–D14).
- `docs/performance/caching-strategy.md` — the companion strategy doc (why no distributed cache was needed at target load; escalation criteria for the `CACHE_PROVIDER` seam; created by the plan's Task 10.2 alongside this runbook).
- `docs/performance/harness-engineering.md` — the engineering-knowledge layer behind this runbook (harness invariants, oracle discipline, gotchas) for engineers extending the toolchain.
