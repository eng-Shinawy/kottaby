# Research: PRODUCTION_READINESS §6 Performance & Load Testing (6.1–6.7) + §7 Disaster Recovery (7.1–7.7)

Date: 2026-10-08

## Area

Section 6 (Performance) is almost entirely **unverified**: the repo contains no load-test tooling of any kind (no autocannon/k6/artillery in `package.json`; grep across `scripts/`, `test/`, `backend/` for load-test/perf/bench tooling returned nothing real), and the M4 ticket that owns this area — "Load Testing & Performance Optimization" (TICKETS.md:2911, Dev 3, 8 SP) — has **no plan directory** (neither `ai/plans/` nor `ai/finished_plans/`) and zero shipped artifacts. What does exist statically: full pagination on all three checklist list surfaces (directory/sessions/notifications), a WS server with global+per-user connection caps, near-complete FK indexing, and a single-bulk-query matching pipeline — but no timing assertions, no EXPLAIN ANALYZE tooling, and **no runtime DataLoader** (plugin installed but intentionally not loaded; zero `t.loadable` usage). Section 7 (DR) is the mirror opposite — **built and largely verified** by commit f37af394 (Sep 9 2026, PR #96): `ops:db-backup` + `ops:db-restore-verify` ops scripts, a 320-line canonical runbook with **ratified RPO 1h / RTO 4h**, guarded restore with 7 invariant oracles, and an automated drill-chain test. Remaining DR gaps are operational, not code: no evidence of a live backup schedule in production, and no filed cold-operator drill evidence.

## Checklist → Codebase Mapping

| Row # | Criterion (short) | Actual artifact (path:line) | STATUS |
|---|---|---|---|
| 6.1 | API p95 < 500ms, 100+ concurrent | NONE — no load-test tooling; `grep -i autocannon\|k6\|artillery package.json` empty; no plan dir for TICKETS.md:2911 ticket | MISSING |
| 6.2 | Matching < 200ms, 100+ teachers | `backend/services/teachers/teacher-matching.service.ts` + `backend/db/repo/teachers/teacher.repository.ts` (single bulk query); NO timing assertion anywhere (`grep performance.now\|toBeLessThan teacher-matching.service.test.ts` empty); no 100-teacher fixture | MISSING |
| 6.3 | 100+ WS conns stable 1h | `backend/ws/notification-ws-server.ts` + config: global cap default 1000 (`backend/lib/env.ts:101` `DEFAULT_WS_MAX_CONNECTIONS`), per-user 5 (`env.ts:104`); unit tests `backend/ws/notification-ws-server.test.ts`; NO soak/1h test | PARTIAL |
| 6.4 | EXPLAIN ANALYZE on all queries | NONE — `grep -ri "explain analyze" scripts/ test/ backend/` returned nothing | MISSING |
| 6.5 | Zero N+1 queries | Plugin installed but **NOT loaded**: `backend/graphql/pothos/builder.ts:15-17` "intentionally NOT loaded in this builder"; zero `t.loadable()` usage (only 2 comment mentions); pattern doc `docs/graphql/dataloader-batching.md`; convention `backend/graphql/pothos/AGENTS.md:20-22` | PARTIAL |
| 6.6 | All FKs indexed | 33 `index()` defs cover most of 37 FK refs (session: `backend/db/schema/classes/session.ts:88-91` 4 indexes; notifications: `notifications.ts:46-48`; evaluations: `teachers/evaluations.ts:61-63`; audit_logs: `audit/audit-logs.ts:44-45`); GAPS: `teacher.ts:24` user_id, `students.ts:23` user_id, `parents.ts:14` user_id, `admin.ts:13` user_id, `broadcasts.ts:47,49` sentById/stoppedById, `student-subscriptions.ts:25` student_id unindexed; no automated FK-index audit | PARTIAL |
| 6.7 | All list endpoints paginated | Directory: `backend/graphql/query/teachers/teacher-matching.query.ts:50-51` (`page=1`/`pageSize=25` → `TeacherMatchingPage`); sessions: `query/classes/session-lifecycle.query.ts:9-16,124-125,215` (`myStudentSessions`/`myTeacherSessions` page/pageSize, `adminDisputedSessions` limit/offset, clamps 1..50); notifications: `query/notifications/notification.query.ts:57,84-85` (limit 1..50 default 20 / offset, `hasMore`/`totalCount`) + wire tests | VERIFIED |
| 7.1 | Daily DB backup | `package.json:68` `ops:db-backup` → `scripts/ops/backup-database.ts` (pg_dump -Fc + manifest SHA-256 + run lock); scheduling guidance only — cron/systemd stanzas at `docs/ops/disaster-recovery.md:87-125`; live production schedule is operator-side, unevidenced in repo | PARTIAL |
| 7.2 | Backup restorable to staging | `package.json:69` `ops:db-restore-verify` → `scripts/ops/restore-verify.ts` (triple gate: explicit `--target` + `assessDestructiveDbCommandSafety` guard + `--yes-i-understand`); drill-chain test `scripts/ops/backup-restore.integration.test.ts:1-19` (real PASS chain + tamper-FAIL chain vs scratch DBs) | VERIFIED |
| 7.3 | Data verified after restore | Structural verify (schema-derived tables + critical-set row counts) + 7 read-only oracles OR-W1/W2/B1/U1/U2/REQ/MIG (`scripts/ops/restore-oracles.ts`; table at `docs/ops/disaster-recovery.md:151-161`); per-run `restore-report-<stamp>.json` + `VERDICT` line | VERIFIED |
| 7.4 | RTO defined | **RTO 4 hours ratified** — `docs/ops/disaster-recovery.md:38`; budget rule: full runbook must complete ≤ 2h in a drill (≥50% headroom, line 43) | VERIFIED |
| 7.5 | RPO defined | **RPO 1 hour ratified** — `docs/ops/disaster-recovery.md:37`; cadence invariant `interval + runtime + jitter ≤ RPO` (line 42) | VERIFIED |
| 7.6 | DR plan documented | `docs/ops/disaster-recovery.md` (320 lines): runbook, disaster playbooks (a) DB-content loss / (b) full-region loss (lines 230-243), quarterly cold drill procedure (247-252), What-NOT-to-Do (265-272) | VERIFIED |
| 7.7 | DR plan tested | Automated: `scripts/ops/backup-restore.integration.test.ts` real chain vs local Postgres 17 (per appendix D-001, `docs/ops/disaster-recovery.md` ~line 302); 4-tier unit suite `restore-verify.test.ts:1-16`; BUT no filed cold-operator drill evidence: `ai/finished_plans/.../disaster-recovery-backup-verification/` has NO `outcome/` dir; `find -name "restore-report*"` returned nothing | PARTIAL |

## Existing Coverage

| Artifact | What it asserts |
|---|---|
| `backend/graphql/test/notification-query.test.ts:573-593` | Notifications `limit`/`offset` window slides without overlap; `hasMore` follows the pagination math (`offset + len < totalCount`); wire ≡ in-DB oracle equivalence incl. `totalCount` |
| `backend/graphql/test/notification-integration.matrix.test.ts:20` | Bounded page contract (items/totalCount/hasMore) and cross-actor isolation of the paginated inbox |
| `backend/graphql/test/sdl-static-assertions.test.ts:736-745` | `NotificationListPage` exposes EXACTLY items/totalCount/hasMore, no id — frozen pagination surface |
| `backend/graphql/test/admin-session-filter-input.sdl.test.ts:109-110` | Admin session filter input deliberately has NO limit/offset (window args live on the query root, not the filter) |
| `backend/services/classes/session-lifecycle.service.test.ts` (+ repo tests) | Participant session lists honor page/pageSize with 1..50 clamps (service normalizes bounds) |
| `backend/ws/notification-ws-server.test.ts` | WS server boot, ping/pong heartbeat (`pingIntervalMs`), shutdown sequence, missed-pong limit wiring |
| `scripts/ops/backup-database.test.ts` | Backup: manifest validation, artifact publish, exit codes, lock contention, 5 source-DSN refusal gates |
| `scripts/ops/restore-verify.test.ts:1-16` | Restore-verify 4-tier suite: arg refusals, verdict aggregation, oracle 0 vs errored distinction, chaos (truncated dump, hash nibble flip), guard refusal matrix, credential-leak greps |
| `scripts/ops/backup-restore.integration.test.ts:1-19` | End-to-end drill chain: template-copies dev DB to uniquely-named scratch DBs, runs real backup→restore→verify PASS chain + guard probes + tamper-FAIL chain; NO `runInRollback` (OS tools can't join a tx) |
| `scripts/ops/scripts-registration.test.ts` + `_shared.test.ts` | `ops:*` package-script registration + shared ops helpers (env loading, `--help` contract, exit codes) |
| `scripts/verify-unique-constraints.ts:1-12` | Live-DB introspection probe (unique constraints on reports/home_work session_id) — the closest existing pattern for a live-DB index probe |

## Gaps

| Row | Gap | What would be needed |
|---|---|---|
| 6.1 | No load-test harness, no baseline p95 numbers, zero concurrency evidence | A load-test script (autocannon via `bunx` or a Bun-native WS/HTTP driver) under `scripts/perf/` + a baseline report artifact (e.g. `docs/ops/performance-baseline.md`) recording p95 per endpoint at 100 concurrent users against the dev server; the M4 8-SP ticket needs its plan dir created first (`ai/plans/milestone_4/load_testing_performance_optimization/`) |
| 6.2 | Matching pipeline has no timing assertion and no 100-teacher fixture | A seeded ≥100-teacher fixture + `performance.now()` timing assertion in `backend/services/teachers/teacher-matching.service.test.ts` asserting < 200ms end-to-end (service → repo → SQL); bulk `NOT EXISTS` single-query design already favors the budget (plan `ai/finished_plans/milestone_2_matching_notifications_escrow/on_demand_matching_algorithm_filter_sort_pipeline/specs.md:95` REQ-006.3 documents the single-bulk-predicate design) |
| 6.3 | No 100-connection / 1-hour WS soak; connection caps exist but are untested at target scale | A WS soak test in `test/workflows/notifications/` (or `scripts/perf/ws-soak.ts`) opening 100+ authenticated sockets against `backend/ws` for a bounded window, asserting zero drops beyond `WS_MISSED_PONG_LIMIT=2` (`backend/ws/notification-ws-server-constants.ts:11`) |
| 6.4 | No EXPLAIN ANALYZE tooling at all | A `scripts/ops/explain-critical-queries.ts` style probe: run EXPLAIN (ANALYZE, BUFFERS) over the critical query set (directory browse, session lists, notification inbox, escrow balance read) against the dev DB and assert no `Seq Scan` on the driving tables; can reuse the introspection pattern of `scripts/verify-unique-constraints.ts` |
| 6.5 | DataLoader is documentation-only: plugin not loaded in builder, zero `t.loadable` usage, no query-count harness | Either (a) load `@pothos/plugin-dataloader` in `backend/graphql/pothos/builder.ts` where fan-out exists and apply `t.loadable`, or (b) keep flat-projection design and add a query-count harness: a test-side Drizzle logger counting SQL statements per GraphQL operation in `backend/graphql/test/`, failing if count grows with result-set size (the actual N+1 oracle) |
| 6.6 | 7 FK columns unindexed: `teacher.ts:24 user_id`, `students.ts:23 user_id`, `parents.ts:14 user_id`, `admin.ts:13 user_id`, `broadcasts.ts:47,49 sentById/stoppedById`, `student-subscriptions.ts:25 student_id`; no automated FK-index audit | Hot path first: `teacher.user_id` (JWT→user→teacher row on every authenticated teacher request) deserves an index; then a live-DB audit script (pg_indexes introspection diffed against schema `references()` set) — natural home `scripts/ops/` or extend `scripts/verify-unique-constraints.ts` pattern |
| 7.1 | Backup schedule is guidance stanzas only — no live production cron/timer evidence in repo | Launch plan must treat this as an operator sign-off item: require the operator to evidence the deployed timer (systemctl list-timers output or crontab) satisfying the RPO cadence invariant; repo side is DONE |
| 7.7 | Quarterly cold-operator drill not yet performed/evidenced: no timing table, no friction log, no `restore-report-*.json` filed anywhere in the repo | Execute one drill per the runbook (`docs/ops/disaster-recovery.md:247-252`) and file the timing table + report copy + friction log to the plan outcome directory — the doc itself mandates "evidence accumulates in the plan outcome directory" (Rollout Summary) |

## Harness Recommendations

1. **Create the missing M4 plan dir first.** Rows 6.1–6.5 cannot be "executed" by the checklist ticket alone — the 8-SP "Load Testing & Performance Optimization" ticket (TICKETS.md:2911) has no plan, no scripts, no baselines. The launch plan should either (a) scope a minimal perf-verification wave into the launch execution ticket, or (b) explicitly gate the launch ticket on that ticket landing. Recommend (a) with these concrete deliverables:
   - `scripts/perf/load-test.ts` (Bun-native HTTP+WS driver; no new dependency needed — `bunx autocannon` optional) hitting the dev/prod-mode server with 100 concurrent users across the frozen 70-op query baseline's hot reads; report p50/p95/p99 to `stdout` + a JSON artifact under `backups/`-style gitignored `scratch/perf/`.
   - `scripts/perf/ws-soak.ts` — 100+ sockets, bounded duration, assert cap + reconnect behavior against `backend/ws` (`WS_MAX_CONNECTIONS` default 1000 is comfortably above target).
2. **Timing assertion for matching (6.2):** add a perf-tier test to `backend/services/teachers/teacher-matching.service.test.ts` seeded with 100+ teachers (fixture helpers in `backend/db/test/` entity-setup), asserting < 200ms — timing tests are flaky in CI, so gate on a generous multiple (e.g. < 200ms locally, or assert single-query shape instead via a Drizzle query-count spy).
3. **EXPLAIN ANALYZE probe (6.4):** follow the live-DB introspection pattern already proven by `scripts/verify-unique-constraints.ts` — a `scripts/ops/explain-critical-queries.ts` that runs the critical query set through `EXPLAIN (ANALYZE, BUFFERS)` and fails on `Seq Scan` nodes for tables above a row threshold. Fits `test/scripts/run-test.ts` wiring used by db tests.
4. **N+1 oracle (6.5):** prefer the query-count harness over retrofitting DataLoader: a test-mode Drizzle `client`-level logger counting emitted SQL per GraphQL operation in `backend/graphql/test/` (e.g. extend the wire-test server bootstrap), asserting constant query count as page size grows. This matches the repo's oracle-parity test culture (see `notification-query.test.ts`) and avoids a risky builder change before launch. If resolvers ever fan out per-parent, `backend/graphql/pothos/AGENTS.md:20-22` already mandates `t.loadable`.
5. **FK-index audit (6.6):** static check first (grep-diff of `references(` vs `index(...on(...))` per column — cheap, deterministic, fits `scripts/ops/` or a repo test) + live-DB `pg_indexes` probe second; fix the 7 unindexed columns via a drizzle migration (only `teacher.user_id` is clearly hot; the rest are small/append-mostly tables — decide with the EXPLAIN probe).
6. **DR rows (7.1–7.7):** the launch plan should treat §7 as *sign-off collection*, not new code: re-run `bun run test/scripts/run-test.ts scripts/ops/backup-restore.integration.test.ts` as launch-day evidence, execute ONE cold-operator drill filing the timing table + `restore-report-*.json` + friction log into this ticket's outcome directory (creating the missing evidence trail), and record the operator-side production timer evidence + deferred D-001 (Neon PITR)/D-002 (scheduled CI drill)/D-003 (off-site upload) as explicit sign-off line items. The runbook already states: "checkbox authority stays with the launch-checklist gate" (`docs/ops/disaster-recovery.md` Rollout Summary).
7. **Status-column updates:** PRODUCTION_READINESS.md §6 rows should get the same treatment the §5.3 rows already have — evidence-annotated statuses (e.g. 5.3.1 shows "✅ REQ-010 (Task 1.1 — ...)" at `docs/planning/PRODUCTION_READINESS.md:243`). §6 will be mostly ☐ → annotated MISSING/partial evidence until the perf wave lands.

## Evidence Appendix

```text
backend/graphql/pothos/builder.ts:15-17
`@pothos/plugin-dataloader` is also installed (kept for the documented
batching pattern — see `docs/graphql/dataloader-batching.md`), but it is
intentionally NOT loaded in this builder.
```

```text
backend/graphql/query/classes/session-lifecycle.query.ts:9-16
`myStudentSessions(filter, page = 1, pageSize = 25): SessionPage!` —
`adminDisputedSessions(filter, limit = 25, offset = 0): SessionPage!` —
```

```text
backend/lib/env.ts:101,104
const DEFAULT_WS_MAX_CONNECTIONS = 1000;
const DEFAULT_WS_MAX_CONNECTIONS_PER_USER = 5;
```

```text
docs/ops/disaster-recovery.md:37-38
| **RPO** (Recovery Point Objective) | **1 hour** | Ratified — no longer the checklist's "e.g." placeholder |
| **RTO** (Recovery Time Objective) | **4 hours** | Ratified — no longer the checklist's "e.g." placeholder |
```

```text
package.json:68-69
"ops:db-backup": "bun run scripts/ops/backup-database.ts",
"ops:db-restore-verify": "bun run scripts/ops/restore-verify.ts",
```

```text
git log: f37af394 (2026-09-09) — feat: Add disaster recovery database backup
and restore-verify tools (#96)  → ships scripts/ops/** + docs/ops/disaster-recovery.md
```

```text
scripts/ops/backup-restore.integration.test.ts:8-9
* End-to-end disaster-recovery drill chain for the database backup pair:
* `ops:db-backup` ... and `ops:db-restore-verify` ...
```

```text
grep -ri "explain analyze" scripts/ test/ backend/  →  (no matches)
grep -i "autocannon\|artillery" package.json  →  (no matches)
find -iname "*perf*" -o -iname "*load*" scripts/ test/  →  (no real matches)
```

```text
docs/ops/disaster-recovery.md:42 (RPO cadence invariant)
the cadence invariant is `interval + runtime + jitter ≤ RPO` — an hourly
schedule alone does NOT bound loss at 1 hour.
```

**Counts:** VERIFIED 6 (6.7, 7.2, 7.3, 7.4, 7.5, 7.6) · PARTIAL 5 (6.3, 6.5, 6.6, 7.1, 7.7) · MISSING 3 (6.1, 6.2, 6.4)
