# Requirements & Specification: Load Testing & Performance Optimization

> **Plan directory (verbatim — every header, ledger path, task `0.1`, and self-reference in this document uses this exact string):** `ai/plans/milestone_4_integration_security_launch/load_testing_performance-load-testing-performance`
> **Ticket:** `Load Testing & Performance Optimization` — Owner Dev 3, Milestone 4, 8 SP, Blocked By: All Milestone 1–3 tickets (`docs/planning/TICKETS.md:2911-2948`; table rows `:2915-2918`, scope `:2921`, Gherkin `:2924-2937`, test scenarios `:2940-2945`). The blocked-by set is **verified complete**: every Milestone 1–3 stream has a finished plan under `ai/finished_plans/` (`milestone_1_core_domain_mvp/`, `milestone_2_matching_notifications_escrow/`, `milestone_3_parent_portal_admin_governance/`), and the Dev-3 dependencies this ticket exercises carry canonical "Status: Implemented and verified" markers (`docs/teachers/on-demand-matching.md:7`, `docs/teachers/teacher-availability.md:6`, `docs/sessions/session-lifecycle.md:4`, `docs/billing/escrow-and-wallet-crediting.md:4`).
> **Grounding docs:** `docs/planning/PRODUCTION_READINESS.md` §6 Performance & Load Testing (`:276-286`, items 6.1–6.7) + launch gate `:361` · `docs/planning/ROADMAP.md:111-121` (M4 scope), `:166`, `:218` (load-testing risk) · `docs/planning/MILESTONE_PLAN.md:379-380` (DoD), `:386`, `:399` (`T3_023[Load Testing] --> T3_026[Launch Checklist]`) · `docs/workflows/02-on-demand-matching-workflow.md:30-43` · `docs/notifications/realtime-engine.md:12` (persist-first), `:159-166` (§3.8 connection-cap policy) · `docs/graphql/dataloader-batching.md:7` (N+1 rationale) · `docs/drizzle/prepared-statements.md:20` (pattern) vs the repo-test prohibition (`backend/db/test/repo/teachers/teacher.repository.test.ts:643-644`) · `docs/testing/workflow-journey-tests.md:55-60` (journey rules) · `docs/specs/state-machine-invariants.md:42` (INV-S1), `:47` (INV-S6), `:122` (INV-A3), `:155` (INV-B4) · `docs/planning/TICKETS.md:2949-2984` (DR sibling), `:2985` (Financial Safety sibling), `:2798-2836` (Security Hardening sibling).
>
> **⚠️ Load-bearing scope reconciliation (READ FIRST — shapes every section below).** The ticket is a **launch-gate verification ticket**: it exists to convert PRODUCTION_READINESS §6 items 6.1–6.7 (all ☐) into executable, evidence-bearing checks, and to fix only what that evidence proves broken. Verified ground truth that governs the rulings below:
> - **The functional surfaces under test already exist and are locked by tests.** The matching filter/sort pipeline is fully implemented (`TeacherMatchingService.browseAvailableTeachers` — `backend/services/teachers/teacher-matching.service.ts:354-359`, delegating at `:421` to `TeacherRepository.listMatchingCandidates` — `backend/db/repo/teachers/teacher.repository.ts:402-408`), paginated limit/offset with a same-WHERE count in one `Promise.all` (`backend/db/repo/teachers/teacher.repository.matching.helpers.ts:223-247`). The WS sidecar ships with caps, heartbeat, throttle, and a 25-test suite (`backend/ws/notification-ws-server.ts:110-127`, `backend/ws/notification-ws-server.test.ts`). **This ticket does not rebuild any of it.**
> - **No load-testing tooling exists — proven absent.** Repo-wide grep for `autocannon|artillery|k6|soak|loadtest|clinic` matches only hash fragments in `bun.lock`, the function name `loadTestEnvFile`, and a generic skills-guide listing (`.agents/spec-process-guide/execution/quality-assurance.md:320-322`); `package.json` carries none of them. The harnesses are **CREATE** work (§2.1).
> - **Real, verified performance debt exists in exactly two code areas**, and they are this ticket's only product-code write scope: (a) **three N+1 field resolvers** on `SubscriptionPothosObject` — `plan` via `PlanCatalogService.findById` per row (`backend/graphql/pothos/billing/subscription.pothos.ts:68`), `auditEntriesCount` via `SubscriptionAdminService.auditEntriesCount` per row (`:109`), `auditTrailPeek` via `SubscriptionAdminService.auditTrailPeek` per row (`:116`) — and both list producers feed them (`SubscriptionPurchaseService.listOwn` at `backend/graphql/query/subscription.query.ts:62`, `SubscriptionAdminService.listForAdmin` at `backend/graphql/query/billing/subscription-admin.query.ts:60`), so a page of N subscriptions selecting these fields issues up to 3N+1 queries; (b) **index gaps**: the `teacher` table has **zero indexes** (`grep -c "index(" backend/db/schema/teachers/teacher.ts` → 0) despite being the matching pipeline's driving table (`is_online`, `is_approved`, `average_rating`, `subjects`, `recitations`, `languages` all filtered/sorted — `backend/db/repo/teachers/teacher.repository.matching.helpers.ts:129-141`), the `users` table has **zero indexes** (`grep -c "index(" backend/db/schema/users/users.ts` → 0; `full_name`/`country_code` are matching-pipeline join columns), and four FK-constrained columns have no index (§REQ-3 table).
> - **Two adjacent concerns are explicitly OUT of scope** (ruling + ledger pointers): GraphQL depth/complexity limiting is absent (grep `depth.?limit|query.?complexity|cost.?analysis` → 0 hits) but belongs to Security Hardening (`TICKETS.md:2798-2836`); double-spend/escrow-integrity *proofs* belong to Financial Safety Verification (`TICKETS.md:2985-3028`) — this ticket asserts only that **load never breaks** those invariants (REQ-7), not their functional depth.

> - **The environment shapes the harness design** (all verified): the pg pool is hardcoded `max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000` (`backend/db/client.ts:154-169`) — 100 concurrent users WILL queue on 10 connections, so the p95 gate is a statement about queue+query latency, and the harness must measure it as such; the WS sidecar defaults to port 3101 / host 127.0.0.1 (`backend/lib/env.ts:80,83`) with global cap 1000, per-user cap 5 (`:101-104`), and a handshake throttle of burst capacity 5 then 1 token per 2s (`backend/ws/notification-ws-server-constants.ts:14-17`) — so 100 concurrent WS connections from one harness IP require ≥20 distinct user identities and a throttle-honoring ramp of ~190s (5-connection burst, then 1 per 2s); the GraphQL in-memory rate limiter allows 100 req/60s per IP (`backend/lib/ratelimit.ts:37-41`) and is bypassed under `TEST_SERVER=1`/`TEST_CI=1` by the transport wrapper (`app/api/graphql/rate-limit.ts:34`), with the bypass hard-throwing in production mode unless `IS_DEMO` is set (`:38-43`) — the test server boot already sets `DISABLE_RATE_LIMITING: "true"` (`test/scripts/run-server-tests.ts:182-192`), and the p95 gate is ruled to measure the API, not the limiter (REQ-6); prepared statements are **prohibited by repo tests** (`backend/db/test/repo/teachers/teacher.repository.test.ts:643-644` asserts no `.prepare(`/`sql.placeholder` in matching repo source) — "query optimization" MUST NOT mean prepared statements in this codebase.
> - **"Caching strategy" is delivered as a documented strategy plus evidence, not speculative infrastructure** (REQ-9): today the only caches are the process-lifetime env snapshot (`backend/lib/env.ts:65`), the in-memory rate-limit windows (bounded, `backend/lib/ratelimit.ts:51,58`), the Redis notification claim cache (`backend/services/notifications/redis-claim-cache.ts:92,109-118`), and one request-scoped React `cache()` dedupe (`backend/lib/auth/server-auth.ts:119`); Redis is wired only for notification fan-out (`backend/services/notifications/realtime/ioredis-fanout-client.ts:16-31`), and the parsed-but-unconsumed `CACHE_PROVIDER` seam (`backend/lib/env.ts:395`, `.env.example:206`) is ledgered as a deferred pointer. The strategy is proven by meeting p95 targets **without** distributed query caching at target load.
> - **Evidence output, not a new product surface**: every harness is operator-side tooling under `scripts/perf/` (new), following the `scripts/ops/` convention (`scripts/ops/backup-database.ts`, `scripts/ops/restore-verify.ts`, co-located `*.test.ts` + `scripts/ops/scripts-registration.test.ts` pinning `package.json` entries), reporting to timestamped run directories under `logs/perf/` with a terminal `VERDICT: PASS|FAIL` line. Zero UI, zero new GraphQL SDL, zero new runtime dependencies (Bun-native `fetch`/`Bun.serve` WebSocket client, `performance.now()`), zero new locale namespaces.

This reconciliation is the spec's governing ruling and must be ratified at the Phase 1.5 plan review.

---

## 1. Executive Summary & Problem Statement

### 1.1 Feature Summary

Ship a Bun-native performance-verification toolchain (`scripts/perf/`: seeder, matching benchmark, index/EXPLAIN auditors, API load generator, WS stability harness) plus the two evidence-mandated code fixes (page-level batch enrichment for the three subscription N+1 resolvers; missing indexes on FK columns and the matching pipeline's driving columns), and the runbook that binds the evidence to PRODUCTION_READINESS §6 items 6.1–6.7 — turning the launch gate (`docs/planning/PRODUCTION_READINESS.md:361`) from prose into a reproducible command.

### 1.2 Problem from each actor's perspective

- **Dev 3 / launch operator (primary actor):** PRODUCTION_READINESS §6 has seven ☐ rows with named targets (`:278-286`) but no executable way to produce the evidence — no harness exists (proven absent), thresholds are not wired to any command, and the 1-hour WS soak (`:282`, item 6.3) has no tooling at all. The launch checklist ticket (`TICKETS.md:3029`) is downstream-blocked on exactly this evidence (`MILESTONE_PLAN.md:399`).
- **Student (load persona):** under 100 concurrent users, a student browsing teachers (`browseAvailableTeachers`, `frontend/views/student/teachers/TeacherDirectoryContainer.tsx:76-86`) must still receive a filtered, sorted, paginated page in <200ms, and a student booking a session must never see a 5xx, a hang, or a corrupted balance because the platform is busy.
- **Teacher (load persona):** a teacher holding a WS connection must stay connected under platform load (heartbeats answered, no eviction except by documented policy `docs/notifications/realtime-engine.md:159-166`), and their in-session unavailability must remain truthful to browsing students (INV-S6/INV-A3 as load oracles — `docs/specs/state-machine-invariants.md:47,122`).
- **Admin (observer):** admin list surfaces (`adminStudentSubscriptions` etc.) must not degrade super-linearly with page size — the 3N+1 query behavior on subscription pages is an admin-facing latency and DB-load defect today.
- **SRE / DBA:** has no in-repo way to verify "no full table scans", "all FKs indexed", or "zero N+1" — the EXPLAIN/index/query-count checks are currently manual and unreproducible.

### 1.3 Business value

- **Unblocks the launch gate**: PRODUCTION_READINESS §6 (`:276-286`) is a named sign-off block (`:361`) and MILESTONE_PLAN's DoD requires load tests passing at target concurrency (`:379-380`, `:386`); this ticket is the only producer of that evidence.
- **De-risks the M2 risk register**: ROADMAP's identified risk "Load testing reveals performance bottlenecks" (`docs/planning/ROADMAP.md:218`) is retired with measured numbers instead of hope — and the two code defects it would most plausibly reveal (3N+1 subscription queries; unindexed matching columns) are fixed preemptively as part of the same ticket.
- **Protects money-and-minors invariants under load**: the escrow hold, in-session lock, and double-spend invariants (INV-B4 `docs/specs/state-machine-invariants.md:155`, INV-S6 `:47`) are asserted under 100-way concurrency (REQ-7), which is the only regime where their locking discipline can actually fail.
- **Leaves permanent tooling**: every future regression (schema growth, new endpoints, new resolvers) can be re-verified with one command per concern, and the runbook makes the evidence reproducible at launch re-audits.

---

## 2. Scope

### 2.1 In scope

| # | Deliverable | Label | Evidence anchor |
|---|---|---|---|
| S1 | `scripts/perf/` harness library: stats/percentiles + gate evaluation, report writers (JSON+Markdown to `logs/perf/<ts>/`), query-count oracle, auth-cookie minter | **CREATE** | no perf tooling exists (grep proof, header block) |
| S2 | Bulk performance data seeding + cleanup (`scripts/perf/seed-perf-data.ts`, `cleanup-perf-data.ts`) into `kottaby_test` with prefix isolation | **CREATE** | `.env.test` `DATABASE_URL` → `kottaby_test`; entity-setup helpers are single-row (`backend/db/test/entity-setup.ts:550`) so bulk paths are new |
| S3 | Matching pipeline benchmark with <200ms gate at 100+ teachers (service-level, scale matrix) | **CREATE** (targets **EXISTING** code) | `teacher-matching.service.ts:354-359` |
| S4 | FK + hot-column index audit script, remediation of the four unindexed FK columns and EXPLAIN-justified matching indexes | **CREATE** + **EXTEND** (`backend/db/schema/`) | index table in REQ-3 |
| S5 | EXPLAIN ANALYZE auditor + scan gate over a canonical query registry at production-shaped volumes | **CREATE** | PR §6 item 6.4 (`:283`) |
| S6 | N+1 elimination: batch repo + service methods + page-level enrichment for the three subscription resolvers | **UPDATE** | `subscription.pothos.ts:68,109,116` |
| S7 | Concurrent booking journey test (100-way `Promise.allSettled`, real services, committed fixtures) | **CREATE** | `test/workflows/AGENTS.md` rules 1-13 |
| S8 | API load harness: 100 VUs over a canonical scenario registry against the production-mode server, p95<500ms gate | **CREATE** | PR §6 item 6.1 (`:278`) |
| S9 | WS stability harness: 100 concurrent connections, ≥20 identities, throttle-honoring ramp, fanout delivery check | **CREATE** | PR §6 item 6.3 (`:282`) |
| S10 | Caching strategy doc + performance runbook under `docs/performance/` | **CREATE** | no perf/caching doc exists (`find docs -iname "*optimi*" -o -iname "*cache*" -o -iname "*load*"` → 0) |
| S11 | Pagination verification sweep (directory, sessions, notifications) | **VERIFY** (fix only if a gap is proven) | PR §6 item 6.7 (`:286`) |

### 2.2 Out of scope (with owners)

- **GraphQL depth/complexity/cost limiting** — Security Hardening ticket (`TICKETS.md:2798-2836`). Ledger pointer.
- **Double-spend/escrow-immutability functional proofs** — Financial Safety Verification ticket (`TICKETS.md:2985-3028`); this plan asserts only load-time integrity (REQ-7).
- **Distributed/cross-request query caching (Redis-backed)** — no evidence of need at target load; `CACHE_PROVIDER` seam (`backend/lib/env.ts:395`) stays unconsumed. Ledger pointer (REQ-9).
- **pg_trgm/trigram indexes for ILIKE name search** — conditional on EXPLAIN evidence at seeded volume; only enters scope if the name-filter plan shows a materialized seq-scan cost (deferred-item entry with entry criteria).
- **Rate-limiter throughput tuning** — the limiter is bypassed under `TEST_SERVER=1`/`TEST_CI=1` by the transport wrapper (`app/api/graphql/rate-limit.ts:34`); its production distribution assumptions (per-IP) are a §4 Security concern.
- **Frontend rendering performance, CDN, image optimization** — ticket targets API/DB/WS only.
- **Production/staging cloud environment load runs** — harness targets local `kottaby_test` + `127.0.0.1` sidecar; staging-environment execution is runbook guidance, not tooling built here.
- **Read-side country *exclusion* filter** — the matcher implements country as an ordering-only soft tier (`teacher.repository.matching.helpers.ts:158-165`); changing matching semantics is the owning ticket's (`TICKETS.md:1509`) concern, not a performance fix.

---

## 3. Requirements

### Requirement 0: Pre-Implementation Baseline & Execution Protocol

**User Story:** As an executing agent, I want a recorded error baseline and a persistent outcome ledger before any implementation, so that new issues are distinguishable from pre-existing ones and prior research is never repeated.

#### Acceptance Criteria

1. WHEN feature implementation begins THEN system SHALL record baseline error counts (`bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline`) to `/tmp/baseline-*.txt` and the `0-baseline-outcome.md` outcome file.
2. WHEN feature implementation begins THEN system SHALL initialize the deferred-items ledger at `ai/plans/milestone_4_integration_security_launch/load_testing_performance-load-testing-performance/deferred-items.md` from the template.
3. WHEN an executing agent starts any task THEN system SHALL read ALL existing files in `ai/plans/milestone_4_integration_security_launch/load_testing_performance-load-testing-performance/outcome/`.
4. WHEN an executing agent completes any task THEN system SHALL write `outcome/<task-id>-outcome.md` with research, changes, cross-file dependencies, and carry-over points.
5. WHEN an executing agent completes any subtask THEN system SHALL update the checkbox `[ ]` → `[x]` in `tasks.md`.
6. WHEN any file is modified THEN system SHALL run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) on that file.
7. WHEN any subtask is marked complete THEN system SHALL pass the semantic review checklist (race conditions, env-config, dead code, cross-layer, enums, deferred ledger).

### Requirement 0.5: Operator-Output & Enum Compliance

**User Story:** As a developer, I want the toolchain's output conventions fixed up front, so that no operator-facing string or enum import violates project rules late in implementation.

#### Acceptance Criteria

1. WHEN harness/report code emits operator-facing output (stdout, Markdown reports, `VERDICT:` lines) THEN it SHALL use plain operator prose — these are not user-facing UI strings, so **zero new locale namespaces are created** (ruling mirrors the `scripts/ops/` precedent: `scripts/ops/backup-cli.ts`, `scripts/ops/restore-cli.ts` emit plain English and no locale namespace exists for them).
2. WHEN any code path would surface an error to an end user (services touched by REQ-5) THEN existing translation discipline is preserved unchanged — the N+1 fix SHALL NOT alter any user-facing message.
3. WHEN an enum is used in a runtime expression (e.g., `SessionStatus`, `UserRole`, `SessionIntent` in harness/seed code) THEN it SHALL be imported as a value import (`import { SessionStatus } from "@/backend/enum/..."`), never `import type`.
4. WHEN the harness asserts translated domain rejections THEN it SHALL assert via `getServerTranslations("en").errorsTranslations` substrings — no hardcoded-English expectation drift (mirrors `test/workflows/AGENTS.md` rule 6).

### Requirement 1: Isolated Bulk Performance Data Seeding

**User Story:** As a launch operator, I want one command to create a production-shaped, prefix-isolated dataset (100+ certified online teachers, 100+ funded students, sessions, subscriptions, notifications) in the test database, and one command to remove every trace of it, so that benchmarks and load runs are reproducible and never pollute shared test data.

#### Acceptance Criteria

1. WHEN `bun run scripts/perf/seed-perf-data.ts --teachers <N> --students <M> ...` runs THEN system SHALL create all rows inside the database named by `.env.test` `DATABASE_URL` (`kottaby_test`) with a per-run prefix (`` `perf_<8hex>` ``) in emails/names so runs are collision-proof and identifiable.
2. WHEN seeding teachers THEN every teacher row SHALL satisfy the matching pipeline's eligibility predicate as built: `is_online=true` + `is_approved=true` + non-deleted/suspended/blocked user row (`teacher.repository.matching.helpers.ts:129-141`), with a deterministic distribution across recitations/subjects/languages/countries/ratings so filter/sort branches are all exercised.
3. WHEN seeding students THEN each SHALL hold subscription balance sufficient for at least one session booking (INV-B4 precondition — `docs/specs/state-machine-invariants.md:155`).
4. WHEN seeding THEN system SHALL include a configurable volume of `session` rows (including `started` rows for a hot-teacher subset, exercising the matcher's NOT EXISTS predicate — `teacher.repository.matching.helpers.ts:140`), `notifications` rows, and `subscriptions` rows so list queries and EXPLAIN gates run at production-shaped volumes (defaults: 5,000 sessions, 20,000 notifications, 500 subscriptions; all knobs CLI-overridable).
5. WHEN seeding completes THEN system SHALL write a `seed-manifest.json` (run id, prefix, created counts by table, timestamp) into the run directory under `logs/perf/` consumed by cleanup.
6. WHEN `bun run scripts/perf/cleanup-perf-data.ts --run <runId>` (or `--last`) runs THEN system SHALL hard-delete every row created by that run, in FK-safe order, and re-probe for zero residue (mirrors `test/workflows/AGENTS.md` rules 2/12 discipline).
7. IF the resolved `DATABASE_URL` does not target `kottaby_test` THEN the seeder/cleanup SHALL refuse to run (destructive-target guard, extending the `scripts/lib/destructiveDbGuard.ts` precedent) unless `--force-prod-shaped-target` is explicitly passed AND the guard's confirm flow is answered.
8. WHEN seeding THEN the tool SHALL use bulk multi-row inserts (chunked `.values([...])` batches) — not per-row helper loops — for volume tables, while reusing entity-shape conventions from `backend/db/test/entity-setup.ts` (column shapes, defaults like `isApproved: true` — `:558-563`).

**Additional Details** — Priority: High · Complexity: Medium · Dependencies: REQ-0 (baseline) · Assumptions: local Postgres `kottaby_test` has capacity for ~30k rows per run; multiple runs may coexist via distinct prefixes.

### Requirement 2: Matching Filter/Sort Pipeline Benchmark (< 200ms)

**User Story:** As a launch operator, I want a reproducible benchmark proving the matching filter/sort pipeline completes within 200ms with 100+ teachers available, so that PRODUCTION_READINESS §6 item 6.2 flips from ☐ to evidenced.

#### Acceptance Criteria

1. WHEN `bun run scripts/perf/bench-matching.ts` runs against the seeded volume THEN it SHALL measure the **service-level pipeline** (`TeacherMatchingService.browseAvailableTeachers(studentUserId, input, locale, tx?)` — `teacher-matching.service.ts:354-359`) end-to-end (validation + caller resolution + filter build + repo query + envelope assembly).
2. WHEN benchmarking THEN the matrix SHALL cover, at minimum: teacher volumes {100, 500, 2,000}; sort keys {RATING_DESC, NAME_ASC, NEWEST} (`backend/enum/teachers/teacher-matching-sort.enum.ts:21-25`); and filter variants {no extra filters, subject+language filter, name search, minRating floor}, each with the default page size 25 (`backend/graphql/query/teachers/teacher-matching.query.ts:118-119`).
3. WHEN measuring THEN each cell SHALL report p50/p95/p99/max over ≥30 samples after ≥5 warmup iterations, using `performance.now()`; sample set SHALL exclude seed one-time costs.
4. WHEN the p95 of any cell at the 100-teacher volume (the ticket's named regime — `TICKETS.md:2933-2936`) exceeds 200ms THEN the harness SHALL emit `VERDICT: FAIL` naming the offending cell; ELSE `VERDICT: PASS`.
5. WHEN the benchmark runs THEN pagination correctness SHALL be asserted on every sampled call (returns `total`, `page`, `pageSize`, `pageCount` — `teacher-matching.service.ts:423-429`) — a wrong page is a FAIL even if fast.
6. WHEN the in-session exclusion is exercised (hot teachers with `started` sessions) THEN the benchmark SHALL assert those teachers are absent from results (INV-A3 as an oracle — `docs/specs/state-machine-invariants.md:122`).
7. IF the 200ms budget fails at 100 teachers THEN the follow-up optimization (indexes — REQ-4; or query shape) is in scope until the gate passes; IF it fails only at 2,000+ teachers THEN the 2,000-cell is reported as scale-evolution evidence, not a launch gate (the ticket's regime is 100+).

**Additional Details** — Priority: High · Complexity: Medium · Dependencies: REQ-1 (seed) · PR §6 ref: 6.2.

### Requirement 3: Index Verification on All Foreign Keys & Hot Columns

**User Story:** As an SRE, I want a script that enumerates every FK-constrained column and every matching-pipeline hot column, verifies each has a usable index, and reports gaps, so that "all FKs indexed" is a reproducible check instead of an assumption.

#### Acceptance Criteria

1. WHEN `bun run scripts/perf/verify-indexes.ts` runs THEN it SHALL enumerate FK constraints from the live catalog (`pg_constraint` `contype='f'`) joined against `pg_indexes` and report, per FK column: covered / not-covered-by-any-index (leading-column match or exact match, including unique/partial indexes and PK/unique-constraint coverage).
2. WHEN the audit completes THEN the report SHALL name the four verified-absent gaps and their remediation: `session_request_idempotency.session_id` (`backend/db/schema/classes/session-request-idempotency.ts:32`), `subscription_purchase_idempotency.subscription_id` (`backend/db/schema/billing/subscription-purchase-idempotency.ts:32`), `broadcasts.sent_by_id` (`backend/db/schema/notifications/broadcasts.ts:45-47`), `broadcasts.stopped_by_id` (`:49-51`) — and any others the live catalog reveals.
3. WHEN remediating THEN the schema additions SHALL be Drizzle `.index()` definitions in the owning schema files applied via `bun run db push` (repo policy — root `AGENTS.md` "Drizzle Schema Convention"), each new index asserted by a co-located repo/schema test.
4. WHEN the audit examines hot columns THEN it SHALL verify coverage for the matching pipeline's driving columns (`teacher.is_online`, `teacher.is_approved`, `teacher.average_rating` — filter/sort at `teacher.repository.matching.helpers.ts:129-141,176-194`) and report the planner's actual index choice from `EXPLAIN` (not just index existence).
5. WHEN matching-column indexes are added THEN each SHALL be justified by REQ-4's EXPLAIN evidence at seeded volume (≥2,000 teachers) — an index without an EXPLAIN case is not added (no speculative indexes).
6. WHEN the run completes THEN exit code SHALL be 0 only if zero uncovered FK columns remain; the Markdown report SHALL include the full covered/uncovered table.

**Additional Details** — Priority: High · Complexity: Medium · Dependencies: REQ-1 (seed for EXPLAIN context) · PR §6 ref: 6.6 (`:285`).

### Requirement 4: EXPLAIN Query Auditor & Scan Gate (No Full Table Scans)

**User Story:** As an SRE, I want a canonical query registry executed under `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` at production-shaped volumes with a scan gate, so that "no full table scans" (PR §6 item 6.4) is measured, not asserted by hand.

#### Acceptance Criteria

1. WHEN `bun run scripts/perf/analyze-queries.ts` runs THEN it SHALL execute a **canonical query registry** — at minimum: the matching candidates query (all filter/sort variants), `mySubscriptions` page query, `adminStudentSubscriptions` page query, notifications list query, session list queries, and the context-per-request `UserRepository.findById` — each against the seeded volume.
2. WHEN plans are collected THEN the gate SHALL flag any `Seq Scan` node whose row estimate on the scanned relation exceeds the volume threshold (default 1,000 rows) — scale-aware by design: a seq scan over a 100-row table is the planner being correct, not a defect (ruling; see header).
3. WHEN a scan-gate violation is found THEN the harness SHALL emit `VERDICT: FAIL` with the query id, node, and estimated rows; ELSE `VERDICT: PASS` with the plan-cost table.
4. WHEN the registry runs THEN each query's plan SHALL be persisted into the run directory (`explain/<queryId>.json`) so index-evolution comparisons across runs are possible.
5. WHEN the matching query's plan shows the NOT EXISTS subquery (`:140`) driven by anything other than the existing `session_teacher_id_status_idx` (`backend/db/schema/classes/session.ts:91`) THEN the report SHALL flag it (index-choice verification, complements REQ-3.4).
6. WHEN new hot paths are added to the registry (future) THEN the registry file is the single source (no scattered EXPLAIN calls) — the runbook documents how to add entries.

**Additional Details** — Priority: High · Complexity: Medium · Dependencies: REQ-1 (seed), REQ-3 (indexes may change plans) · PR §6 ref: 6.4 (`:283`).

### Requirement 5: N+1 Query Elimination (Subscription Page Resolvers)

**User Story:** As an admin and as a student, I want subscription list pages to issue a constant number of DB queries regardless of page size, so that list latency and DB load do not grow super-linearly (PR §6 item 6.5).

#### Acceptance Criteria

1. WHEN the query-count oracle measures `mySubscriptions` (with `plan`, `auditEntriesCount`, `auditTrailPeek` selected — the fields at `backend/graphql/pothos/billing/subscription.pothos.ts:68,109,116`) THEN total DB round trips SHALL be ≤ a page-size-independent constant K (target K ≤ 6) — measured by a `pg` `Client.prototype.query` patching oracle in the harness process (`scripts/perf/lib/query-counter.ts`, test-harness-only module, never imported by app code).
2. WHEN the same oracle measures `adminStudentSubscriptions` THEN the same constant-bound SHALL hold.
3. WHEN the fix lands THEN the three field resolvers SHALL read page-level precomputed data produced by batch loading in the two list services (`SubscriptionPurchaseService.listOwn` — `backend/graphql/query/subscription.query.ts:62`; `SubscriptionAdminService.listForAdmin` — `backend/graphql/query/billing/subscription-admin.query.ts:60`), using new batch methods: `PlanCatalogService.findByIds` → `PlanRepository.findByIds` (new, `inArray` dynamic query — never prepared, `backend/db/repo/AGENTS.md:29`), `SubscriptionAdminService.auditEntriesCountBatch` / `auditTrailPeekBatch` → `AuditTrailRepository.countEntriesByEntityIds` / `listLatestEntriesByEntityIds` (new, conditional aggregation via `sql<number>` + `.mapWith(Number)` — `backend/db/repo/AGENTS.md:34`). Service-layer batch mandate followed with a recorded deviation: number-keyed batch maps (int4 PKs; in-repo precedents `user.repository.ts:244-247`, `parent-link-request-reminder.repository.ts:93-95`); the rule's literal `ids: string[]` shape (`backend/services/AGENTS.md:10`) targets the Pothos dataloader plugin, which this codebase intentionally does not load (`backend/graphql/pothos/builder.ts:15-17`).
4. WHEN the enrichment runs THEN it SHALL run as ONE batch pass per page over the page's rows (the established counter-pattern — `backend/services/classes/session-lifecycle.queries.ts:113-121`), NOT a DataLoader plugin load (the Pothos dataloader plugin is intentionally not loaded — `backend/graphql/pothos/builder.ts:15-17`; `docs/graphql/dataloader-batching.md:252` tracks the batching surface). Ruling: the `t.loadable()` MUST in `backend/graphql/pothos/AGENTS.md:20-22` is unsatisfiable while the plugin stays unloaded, so page-level enrichment + parent-carried fast path is the sanctioned interim pattern per `docs/graphql/dataloader-batching.md`, and dynamic `inArray` wins over the placeholder form shown in `backend/graphql/pothos/AGENTS.md:26` (locked by `backend/db/repo/AGENTS.md:29` + the repo source test).
5. WHEN the fix lands THEN the GraphQL SDL SHALL be byte-identical (same fields, same shapes — resolver-internal change only), and all existing subscription suites stay green.
6. WHEN the before/after evidence is produced THEN the run directory SHALL contain both counts (before: up to 3N+1; after: ≤ K) per page size {1, 25, 100} — the numeric proof for §6 item 6.5 (`:284`).
7. WHEN any future list producer returns `SubscriptionPothosObject` rows without enrichment THEN the query-count oracle regression (a GraphQL integration assertion wired into the benchmark self-check) SHALL fail it.

**Additional Details** — Priority: High · Complexity: High · Dependencies: REQ-0; wire tests via `test/scripts/run-server-tests.ts` conventions · PR §6 ref: 6.5.

### Requirement 6: API Load Harness — p95 < 500ms at 100 Concurrent Users

**User Story:** As a launch operator, I want a 100-virtual-user HTTP/GraphQL load generator with a p95 gate per scenario, so that PRODUCTION_READINESS §6 item 6.1 flips from ☐ to evidenced with a reproducible command.

#### Acceptance Criteria

1. WHEN `bun run scripts/perf/load-api.ts` runs THEN it SHALL drive ≥100 concurrent virtual users (VUs) against a **production-mode server** (`TEST_SERVER_MODE=production`, dist dir `.next-test-prod` — `test/scripts/run-server-tests.ts:171-196` and `scripts/lib/test-build-env.ts:6,81`), each VU authenticated with a real minted session cookie via the `login` mutation (`backend/graphql/mutation/auth.mutation.ts:80`; cookie name `access_token` — `backend/lib/auth/cookies.ts:37`).
2. WHEN scenarios execute THEN the registry SHALL cover, at minimum: `login` (auth surface), `browseAvailableTeachers` with and without filters (student read), `mySubscriptions` with the enriched fields selected (post-REQ-5 surface), student notifications list, session booking (write path with escrow hold; every request mints the mandatory unique `x-idempotency-key` header — `backend/graphql/gqlContextFactory.ts:242`), and an admin list read — weighted to a realistic mix (default: 10% auth, 40% matching reads, 20% list reads, 20% booking writes, 10% admin reads; weights CLI-overridable).
3. WHEN the run completes THEN the report SHALL include per-scenario p50/p95/p99/max, throughput, and error counts; the **gate** SHALL be p95 < 500ms per scenario AND zero transport-level errors (5xx/network) — domain rejections of intentionally-invalid probes are not scenario errors.
4. WHEN the session-booking scenario runs THEN 100 concurrent booking requests from distinct funded students SHALL all succeed (`TICKETS.md:2940` "100 concurrent session requests — all succeed"): every request yields either a created session or a translated domain rejection, and the count of `5xx`/`network`/`deadlock` failures SHALL be zero.
5. WHEN load is applied THEN ramp-up SHALL be honored (default: 10 VUs per 5s to 100 — gentle enough for the in-memory handshake/limiter bypass documented in the header) and steady-state duration SHALL be CLI-configurable (default 120s).
6. WHEN load is applied THEN the server SHALL run under the test-harness boot env (`TEST_SERVER=1` + `IS_DEMO=true` — the operative limiter bypass at `app/api/graphql/rate-limit.ts:34-48`; the runner also sets the set-but-unconsumed `DISABLE_RATE_LIMITING` flag — `test/scripts/run-server-tests.ts:182-192`) — ruling: the per-IP limiter (`backend/lib/ratelimit.ts:37-41`, 100 req/60s/IP) would measure itself, not the API, under a single-origin load generator; the ruling and its implications are documented in the runbook (REQ-11).
7. WHEN the run completes THEN a `VERDICT: PASS|FAIL` line SHALL terminate the report; a FAIL SHALL name every breached scenario/threshold.
8. IF the p95 gate fails THEN the measured breakdown (scenario latency decomposition, DB-side `pg_stat_activity` snapshot at peak, query-count oracle samples) SHALL be included in the run directory so optimization work is evidence-directed.

**Additional Details** — Priority: High · Complexity: High · Dependencies: REQ-1 (seeded users), REQ-5 (N+1 fix changes list latency), server boot via `run-server-tests.ts` conventions · PR §6 ref: 6.1 (`:280`).

### Requirement 7: Concurrent Booking Integrity Journey (Load Oracles)

**User Story:** As a platform owner, I want a cross-actor journey proving that 100 concurrent session requests produce 100 correct, invariant-holding bookings through the real service layer, so that concurrency itself is proven safe — not just fast.

#### Acceptance Criteria

1. WHEN the journey runs (`test/workflows/sessions/concurrent-booking-load.journey.test.ts`) THEN it SHALL follow all 13 rules of `test/workflows/AGENTS.md`: NO `runInRollback` (rule 1), committed `beforeAll` fixtures + tracked hard-delete `afterAll` with zero-residue re-probe (rule 2), `` `jrn_sessions_${8hex}` `` prefix (rule 3), honest real-role actors (rule 4), spied notification dispatch (rule 5), try/catch negative steps (rule 6), `bun:test` + `@/` aliases (rules 7-8), own entities via `entity-setup` helpers (rule 9), and a DIAGRAMS.md mermaid entry validated by `bun run validate:mermaid` (rule 13).
2. WHEN 100 distinct funded students concurrently request sessions against a shared hot-teacher subset via `Promise.allSettled` THEN every outcome SHALL be either a created session or a translated domain rejection, and the created count + rejected count SHALL equal 100 with zero unexplained outcomes.
3. WHEN bookings complete THEN escrow/balance invariants SHALL hold for every student (INV-B4 preconditions — `docs/specs/state-machine-invariants.md:155`): no student's balance went negative, holds correspond 1:1 to created sessions.
4. WHEN the same teacher is concurrently booked by multiple students THEN no duplicate-start violation shall be possible at `scheduled` state and INV-S6 (`:47`) remains true for any teacher whose session reaches `started` (verified post-journey).
5. WHEN notifications fire THEN the spied fan-out transport (`SpiedFanoutTransport`) SHALL record teacher-targeted dispatches matching the created sessions, and no foreign inbox receives rows (cross-actor visibility, both directions).
6. WHEN the journey is run twice consecutively THEN both runs SHALL be green (idempotent-teardown proof — `test/workflows/AGENTS.md` helpers section).
7. WHEN the journey executes THEN it SHALL run via `bun run test/scripts/run-test.ts test/workflows/sessions/concurrent-booking-load.journey.test.ts` — never raw `bun test` (root `AGENTS.md` test-runner rule).

**Additional Details** — Priority: High · Complexity: High · Dependencies: REQ-1 patterns (actor shapes), REQ-6 shares the booking surface · Ticket scenario ref: `TICKETS.md:2940`.

### Requirement 8: WebSocket Stability Harness — 100 Concurrent Connections

**User Story:** As a launch operator, I want a WS harness that holds 100 authenticated connections stable through heartbeats and proves fan-out delivery to all of them, so that PRODUCTION_READINESS §6 item 6.3 is evidenced (including the 1-hour soak command).

#### Acceptance Criteria

1. WHEN `bun run scripts/perf/load-ws.ts` runs THEN it SHALL open ≥100 authenticated connections to the sidecar (`ws://127.0.0.1:3101` default — `backend/lib/env.ts:80,83`) using ≥21 distinct seeded identities (per-user cap 5 — `backend/lib/env.ts:101-104`; eviction policy `docs/notifications/realtime-engine.md:159-166`), supplying an allowlisted `Origin` header (`backend/ws/notification-ws-server-handshake.ts:62-73`; defaults at `backend/lib/env.ts:93-98`) alongside the auth cookie.
2. WHEN connections are established THEN the ramp SHALL honor the handshake throttle exactly (burst capacity 5, then 1 token per 2s — `backend/ws/notification-ws-server-constants.ts:14-17`): an initial 5-connection burst, then 1 connection per 2s sustained (~190s for 100 connections; no env override exists — the constants are code and this plan adds none); the ~190s ramp cost is runbook-documented for soak runs.
3. WHEN all connections are live THEN the harness SHALL keep them stable for a CLI-configurable window (default 300s; `--duration 3600` produces the §6 item 6.3 one-hour soak evidence), asserting: zero server-initiated disconnects (other than documented policy codes), pong responses to every 30s ping within the 2-miss window (`backend/ws/notification-ws-server-constants.ts:8-11`), and stable registry growth (no leak).
4. WHEN a fan-out is published (harness publishes to `kottaby:notifications:fanout` — `backend/services/notifications/realtime/redis-pubsub-transport.ts:27` — via the already-present ioredis dependency, as a guard-valid fan-out envelope `{ userIds, payload }` whose `userIds` covers ALL connected identities and whose `data.id` is unique per burst — envelopes are validated by `parseFanoutEnvelope` and delivered only to member userIds — `redis-pubsub-transport.ts:31,57-67`) THEN ≥100 connected clients SHALL each receive the payload within the delivery-latency budget (assert p95 ≤ 2s), and the report SHALL include delivery latency distribution.
5. WHEN the sidecar is not running or `NOTIFICATION_FANOUT_TRANSPORT` resolves to `in-process` THEN the harness SHALL fail fast with the same actionable message the sidecar entry emits (`scripts/start-notification-ws.ts:27-40` — the sidecar requires the Redis bus) instead of hanging.
6. WHEN the stability window completes THEN the report SHALL include per-connection uptime, reconnect counts (client backoff curve `frontend/hooks/notifications/use-notification-realtime.helpers.ts:12-18` is the product behavior under test — harness clients deliberately do NOT auto-reconnect during the window so drops are visible), and a `VERDICT: PASS|FAIL` (FAIL if any connection dropped, any pong missed twice, or fan-out delivery < 100%).
7. WHEN the run completes THEN the harness SHALL close all sockets and verify zero residue by client-observable means (all sockets closed cleanly; zero deliveries after close) — the sidecar exposes no registry-count surface (its single `fetch` is the handshake — `backend/ws/notification-ws-server.ts:126`).

**Additional Details** — Priority: High · Complexity: High · Dependencies: REQ-1 (identities), Redis bus available (sidecar requirement) · PR §6 ref: 6.3 (`:282`).

### Requirement 9: Caching Strategy — Documented, Evidence-Bound

**User Story:** As a platform architect, I want the platform's caching posture written down and bound to load evidence, so that future caching decisions follow a strategy rather than folklore.

#### Acceptance Criteria

1. WHEN the strategy doc lands (`docs/performance/caching-strategy.md`) THEN it SHALL inventory the existing caches with their bounds: process-lifetime env snapshot (`backend/lib/env.ts:65`), bounded in-memory rate-limit windows (cap 10,000 identifiers — `backend/lib/ratelimit.ts:51`), Redis notification claim cache (SET-NX-EX 24h — `docs/notifications/realtime-engine.md:149-151`), and the request-scoped React `cache()` dedupe (`backend/lib/auth/server-auth.ts:119`).
2. WHEN the doc defines "when to cache" rules THEN they SHALL be evidence-threshold rules (measured p95 breach + hot-path proof), with the batch-enrichment counter-pattern (`backend/services/classes/session-lifecycle.queries.ts:113-121`, now extended by REQ-5) as the first-line tool and cross-request caching as a gated escalation.
3. WHEN the doc covers the `CACHE_PROVIDER` seam THEN it SHALL record that the value is parsed but unconsumed (`backend/lib/env.ts:395`, `.env.example:206`) and that wiring it is a deferred, separately-ticketed decision (ledger pointer).
4. WHEN the p95 gates pass at target load (REQ-6) THEN that fact is the doc's closing evidence: no distributed query cache is justified at 100 concurrent users on the measured stack; the doc SHALL state what load evidence WOULD justify escalation.
5. WHEN permission ordering is discussed THEN the doc SHALL restate the existing rule: permission gating runs BEFORE cache lookups (`backend/services/AGENTS.md:14`).

**Additional Details** — Priority: Medium · Complexity: Low · Dependencies: REQ-6 (evidence) · Ticket scope ref: "caching strategy" (`TICKETS.md:2921`).

### Requirement 10: Pagination Verification Sweep

**User Story:** As an SRE, I want a verification pass proving all list endpoints (directory, sessions, notifications) are paginated, so that PR §6 item 6.7 is evidenced without new product code unless a gap is proven.

#### Acceptance Criteria

1. WHEN the sweep runs THEN it SHALL verify pagination (bounded page size, envelope with total/offset semantics) for: teacher directory (`browseAvailableTeachers` — verified paginated, page/pageSize defaults at `backend/graphql/query/teachers/teacher-matching.query.ts:118-119`), student/admin session lists, and notification lists — via the GraphQL integration layer against the seeded volume.
2. WHEN a list surface is found unbounded (no page-size cap) THEN the finding SHALL be fixed in-scope (bounded page size with the existing `resolvePageBounds` conventions — `backend/services/admin/user-management.query.helpers.ts:27-45`) and ledgered; IF no gap exists THEN the sweep output itself is the evidence.
3. WHEN the sweep completes THEN the run directory SHALL contain the per-surface pagination evidence table (surface, cap, envelope fields, evidence query).

**Additional Details** — Priority: Medium · Complexity: Low · Dependencies: REQ-1 (seeded volume makes caps observable) · PR §6 ref: 6.7 (`:286`).

### Requirement 11: Performance Runbook & §6 Evidence Bundle

**User Story:** As the launch-checklist executor, I want one runbook that turns every §6 item into a command plus a filled evidence table, so that sign-off (`docs/planning/PRODUCTION_READINESS.md:361`) is a checklist walk, not an investigation.

#### Acceptance Criteria

1. WHEN the runbook lands (`docs/performance/load-testing.md`) THEN it SHALL map each §6 item 6.1–6.7 to: the exact command, preconditions (seed, server mode, sidecar, Redis), the gate, the artifact path, and interpretation guidance — mirroring the ops-runbook shape of `docs/ops/disaster-recovery.md`.
2. WHEN the evidence bundle is produced THEN a single "§6 sign-off table" SHALL be generated by the harnesses (each writes its row: item, gate result, run id, artifact path, timestamp) so the runbook's final table is mechanically filled.
3. WHEN the runbook documents environment caveats THEN it SHALL include: rate-limit bypass ruling (REQ-6.6), scale-aware scan gate ruling (REQ-4.2), pool-queue reality at 100 VUs vs `max: 10` (`backend/db/client.ts:156`), and the sidecar Redis requirement (`scripts/start-notification-ws.ts:27-40`).
4. WHEN a harness fails its gate THEN the runbook SHALL define the triage order (report → EXPLAIN artifact → query-count sample → fix → re-run) so operators never guess.

**Additional Details** — Priority: High · Complexity: Low-Medium · Dependencies: REQ-2..REQ-10 artifacts · PR §6 ref: all.

### Requirement 12: Harness Reliability, Guards & Resource Bounds

**User Story:** As a developer sharing this machine/repo, I want the toolchain to be side-effect-free and bounded, so that running performance checks never poisons the database, leaks processes, or exhausts memory.

#### Acceptance Criteria

1. WHEN any `scripts/perf/` tool starts against a non-`kottaby_test` database THEN it SHALL refuse (guard per REQ-1.7); the seed manifest is the only write-scope contract and cleanup honors it exactly.
2. WHEN harnesses spawn processes (server, sidecar) THEN they SHALL reuse the port/kill discipline of `test/scripts/kill-test-servers.ts` and `test/scripts/run-server-tests.ts:676-681` (SIGKILL + port cleanup on exit paths), and every harness SHALL register exit handlers that close sockets/clients it opened.
3. WHEN harnesses buffer measurements THEN buffers SHALL be bounded (streamed/aggregated samples, no per-request unbounded arrays at 100 VUs × duration; summarize incrementally).
4. WHEN the query-counter oracle is installed THEN it SHALL be a harness-process-only patch (installed in `scripts/perf/lib/`, never imported from `app/`, `backend/`, `frontend/`, `shared/`) and SHALL restore the original on uninstall.
5. WHEN co-located tests run (`scripts/perf/*.test.ts`) THEN they SHALL follow the `scripts/ops/` precedent (pure manifest/unit tests, no live DB in unit tests; DB-dependent behavior covered by `runInRollback` suites in `backend/db/test/` and by the journey test) and SHALL pin the new `package.json` script entries (a `scripts/perf/scripts-registration.test.ts` mirroring `scripts/ops/scripts-registration.test.ts:59-103`).
6. WHEN reports are written THEN the run directory `logs/perf/<timestamp>/` SHALL be gitignored (pattern added alongside the ops precedent) and no secret value (DSN password, tokens, cookie values) SHALL appear in any report — cookies live in memory only.

**Additional Details** — Priority: High · Complexity: Medium · Dependencies: none (applies to all harness tasks).

---

## 4. UX/Navigation Requirements (No-UI Ruling)

**Ruling (ratified in header reconciliation):** this ticket ships operator-side tooling and documentation. It creates **no routes, no pages, no sidebar items, no navigation changes** — the DR sibling ticket set the precedent (`ai/finished_plans/milestone_4_integration_security_launch/disaster-recovery-backup-verification/plan.md`: "operator tooling, not application code"). The tables below are filled with the explicit no-UI verdict as the template requires.

### New Routes & Role-Based Access

| Route | Purpose | Permission | Roles with Access | Verdict |
|-------|---------|------------|-------------------|---------|
| — (none created) | n/a | n/a | n/a | No new routes; CLI-only surfaces under `scripts/perf/` |

### Sidebar Navigation Integration

- **Group/Parent/Children**: none — no navigation item is added anywhere.
- **Mobile Bottom Nav**: unchanged.

### Role-Based Access Matrix

| Role | Routes Accessible | New Permissions Granted |
|------|-------------------|------------------------|
| SUPER_ADMIN / ACADEMY_ADMIN / SUPERVISOR / TEACHER / PARENT / STUDENT / STAFF / USER / GUEST | unchanged | none — no new routes or SDL fields |

### Per-Audience Rendering

| Audience | Differences |
|----------|-------------|
| All audiences | none — users observe only the *effect* (unchanged latency envelope of existing surfaces); no new UI exists |

### Harness Identity & Authorization Note

- Harness identities are **seeded test users with real roles** logging in through the real `login` mutation (`backend/graphql/mutation/auth.mutation.ts:80`) — no token forging, no monkey-patched auth. Student scenarios run with student-role cookies only; the admin scenario runs with an admin-role cookie; cross-role probes (student invoking admin fields) remain covered by existing wire tests and are NOT re-tested here (Security Hardening owns depth).

---

## 5. Cross-Actor Workflow Scenarios (Journeys)

**Journey J1 — Concurrent Booking Under Load** (spans 3 actors over shared state; maps 1:1 to `test/workflows/sessions/concurrent-booking-load.journey.test.ts`, REQ-7).

### Actor Table

| Actor | Role | Can Do | Cannot Do |
|-------|------|--------|-----------|
| Student ×100 | `student` | request a session against the shared teacher pool (real `browse` → book path) | book with zero balance (INV-B4), see other students' rows |
| Teacher (hot subset) | `teacher` | hold `started` sessions; appear/disappear from matching per INV-S6/INV-A3 | accept bookings outside the state machine |
| System (notification engine) | — | persist notification first, then fan out (persist-first — `docs/notifications/realtime-engine.md:12`) | push what was not persisted |

### Ordered Step List (per actor → action → shared-state change + side effects)

1. System → provision 100 funded students + shared teacher cast (committed `beforeAll`; prefix `jrn_sessions_<8hex>`).
2. Students ×100 → concurrently request sessions against overlapping hot teachers (`Promise.allSettled`).
3. System → per outcome: session row at `scheduled` with escrow hold, or translated domain rejection; balance debits 1:1 with created sessions.
4. System → persist teacher-targeted notifications, then dispatch through the **spied** fan-out transport (assert target userIds).
5. One hot-subset teacher → starts one of the shared scheduled sessions (`SessionLifecycleService.startSession(teacherUserId, ...)` — the start transition is teacher-owned, `backend/services/classes/session-lifecycle.service.ts:282-299`) → teacher `is_online=false` (INV-S6) and the teacher vanishes from other students' matching results (INV-A3, observed by a second student's browse call).
6. Negative probe → an unfunded student's concurrent request is rejected through the real path with a translated error; no row side effects.

### Cross-Actor EARS Criteria (observer perspective)

1. WHEN 100 students concurrently request sessions THEN the system SHALL produce exactly 100 accounted outcomes AND every other student's subsequent browse SHALL reflect only committed state.
2. WHEN a teacher's session reaches `started` THEN every other student's matching result SHALL exclude that teacher AND the teacher's own notification inbox SHALL contain the persisted request notifications.
3. IF an unfunded student requests a session THEN the system SHALL reject it with a translated domain error AND no session/hold rows SHALL exist for that student.
4. WHEN the journey's `afterAll` completes THEN zero tracked rows SHALL remain (re-probe enforced — `test/workflows/AGENTS.md` rule 2).

---

## 6. Non-Functional Requirements

### Performance (the ticket's core — all bound to PR §6)

| NFR | Gate | Harness | PR §6 |
|---|---|---|---|
| API p95 @100 VUs | < 500ms per scenario | REQ-6 | 6.1 |
| Matching pipeline @100+ teachers | p95 < 200ms | REQ-2 | 6.2 |
| WS stability | 100 conns, zero drops, 100% fan-out delivery; 1h soak command provided | REQ-8 | 6.3 |
| Query plans | zero materialized Seq Scans at seeded volume | REQ-4 | 6.4 |
| N+1 | list ops ≤ constant K round trips | REQ-5 | 6.5 |
| FK index coverage | zero uncovered FK columns | REQ-3 | 6.6 |
| Pagination | all list surfaces bounded | REQ-10 | 6.7 |

### Reliability

1. WHEN any harness exits (success, failure, signal) THEN all spawned processes/sockets/clients SHALL be cleaned up (REQ-12.2).
2. WHEN a harness crashes mid-run THEN seed data SHALL remain discoverable/removable via the manifest + cleanup script (no orphaned bulk data).

### Security

1. WHEN seeding/cleaning THEN the DB guard SHALL prevent any non-test target from being written (REQ-1.7).
2. WHEN auth cookies are minted THEN they SHALL exist only in harness memory, never logged or reported (REQ-12.6).
3. WHEN harness users are provisioned THEN their credentials SHALL be random per run and their rows SHALL be removed by cleanup.
4. WHEN the sidecar is load-tested THEN it binds `127.0.0.1` (`backend/lib/env.ts:83`) and origin allowlists (`WS_ALLOWED_ORIGINS`) are honored by the real handshake — the harness never bypasses auth (`backend/ws/notification-ws-server-handshake.ts:89-91`).

---

## 7. Constraints and Assumptions

### Technical Constraints

- **Bun-only runtime** (`package.json:5` `bun@1.4.0`); harnesses use Bun-native `fetch`, `WebSocket`, `performance.now()` — zero new runtime or dev dependencies (k6/artillery/autocannon proven absent; adding one is out of scope).
- **Pool ceiling**: `max: 10` is hardcoded (`backend/db/client.ts:156`) — changing pool sizing is NOT in this ticket; the harness measures reality under it (any pool-size proposal would be a ledgered follow-up with its own evidence).
- **Prepared statements prohibited** by repo test locks (`backend/db/test/repo/teachers/teacher.repository.test.ts:643-644`) — optimization work must not use them.
- **WS sidecar requires the Redis bus** (`scripts/start-notification-ws.ts:27-40`); `in-process` transport fails fast.
- **Drizzle discipline**: schema index additions via `bun run db push`; custom SQL (e.g., pg_trgm) only via `bun db migrate` if EXPLAIN evidence demands (deferred entry criteria).
- **Test-runner discipline**: DB tests via `bun run test/scripts/run-test.ts`; journeys via the same; workflows never raw `bun test` (root `AGENTS.md`).

### Business Constraints

- 8 SP budget (Dev 3 stream) — harnesses are small, composable CLIs, not a platform.
- All §6 evidence must be reproducible on a developer machine plus (documented) staging guidance.

### Assumptions

- Local Postgres (`kottaby_test` at `127.0.0.1:5432` per `.env.test`) can absorb ~30k seed rows/run.
- Redis is available locally for sidecar transport (it is a hard requirement of the existing sidecar, not new scope).
- The 100-VU load is generated from one host; results are comparative (gate vs threshold on this machine class) and the runbook records machine-class guidance.

---

## 8. Success Criteria

### Definition of Done

- [ ] All REQ-0..REQ-12 acceptance criteria met; every §6 item 6.1–6.7 has a passing evidence row in the generated bundle.
- [ ] N+1 before/after counts recorded; constant-K regression wired.
- [ ] Journey J1 green twice consecutively; DIAGRAMS.md updated and mermaid-validated.
- [ ] `bun quality-gate` clean; all touched files pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`.
- [ ] Ledger gate: `grep -cE '^\s*\| D[0-9]+ \|.*(❌|⚠️)' deferred-items.md` = 0 (D-row-scoped — excludes the template legend and the fenced example row).

### Acceptance Metrics

- p95 < 500ms per scenario at 100 VUs (prod-mode server); matching p95 < 200ms @100+ teachers; 100 WS conns stable (default window) + soak command delivered; zero uncovered FK columns; zero scan-gate violations; list-op round trips ≤ K; pagination sweep table complete.

---

## 9. Requirements Traceability Matrix

| REQ | Ticket scenario (`TICKETS.md:2940-2945`) | PR §6 (`:278-286`) | Journey | Tasks (tasks.md) |
|---|---|---|---|---|
| REQ-0 / REQ-0.5 | (execution protocol) | — | — | 0.1, all `.IV` |
| REQ-1 (seed/cleanup) | all scenarios' substrate | — | J1 fixtures | 2.1, 2.2 |
| REQ-2 (matching bench) | "Matching algorithm with 100+ teachers — < 200ms" | 6.2 | — | 4.1, 4.2 |
| REQ-3 (index verify) | "Index verification — all FKs indexed" | 6.6 | — | 3.1, 3.2 |
| REQ-4 (EXPLAIN gate) | "Database query analysis — no full table scans" | 6.4 | — | 3.3 (4.2 triage re-enters) |
| REQ-5 (N+1) | N+1 elimination (`:2921`) | 6.5 | — | 5.1–5.3 |
| REQ-6 (API load) | "API response times — < 500ms (95th percentile)" | 6.1 | — | 6.1, 6.2 |
| REQ-7 (concurrent booking) | "100 concurrent session requests — all succeed" | 6.1 (write leg) | J1 | 7.1 |
| REQ-8 (WS stability) | "100 concurrent WebSocket connections — stable" | 6.3 | — | 8.1 |
| REQ-9 (caching strategy) | "caching strategy" (`:2921`) | — | — | 10.2 |
| REQ-10 (pagination) | paginated results (`:2936`) | 6.7 | — | 9.1 |
| REQ-11 (runbook/evidence) | launch-gate substrate | 6.1–6.7 bundle | — | 10.1, 11.2 |
| REQ-12 (guards/bounds) | harness reliability | — | — | 1.x, 11.1, 11.2 (cross-cutting) |

---

## 10. Glossary

| Term | Definition |
|---|---|
| VU | Virtual user — one concurrent authenticated load-generator identity/loop |
| p50/p95/p99 | Latency percentile: the ms below which 50%/95%/99% of samples fall |
| Seq Scan | PostgreSQL full-table scan plan node; "materialized" here = over a relation ≥ the volume threshold at seeded scale |
| N+1 | One list query plus one query per row for a relation field (docs/graphql/dataloader-batching.md:7) |
| Round trip | One `pg` client query call (counted by the harness oracle), including inside transactions |
| Soak | Long-duration stability run (WS: the 1-hour §6.3 evidence window) |
| Ramp | Gradual VU/connection arrival schedule honoring server throttle/caps |
| Sidecar | The standalone `Bun.serve` WebSocket process (`bun run ws`, `package.json:70`), separate from Next.js |
| Enrichment (page-level) | One batch pass over a page's rows preloading relation data, served to field resolvers via the parent row |
| Query-count oracle | Harness-only `pg` `Client.prototype.query` patch counting round trips per measured operation |
| Seed run / manifest | One bulk-data creation execution and its `seed-manifest.json` (run id, prefix, counts) consumed by cleanup |
| §6 | `docs/planning/PRODUCTION_READINESS.md` §6 Performance & Load Testing (`:276-286`) |

---

## 11. Requirements Review Checklist

- [x] All user roles identified (operator, student, teacher, admin, SRE personas; harness identities real-role)
- [x] Normal, edge, and error cases covered (domain rejections vs transport errors; zero-residue cleanup; fail-fast sidecar paths)
- [x] Requirements testable and measurable (every gate names a threshold, a command, and an artifact)
- [x] No conflicting requirements (rate-limit bypass ruling + scan-gate scale ruling pre-resolve the two classic conflicts)
- [x] EARS format used consistently
- [x] Cross-actor journey captured (J1 actor table + ordered steps + observer EARS; maps to test/workflows)
- [x] Navigation/sidebar/tabs defined for all user types (explicit no-UI ruling tables in §4)
- [x] Permissions mapped (no new routes; harness identity note in §4)
