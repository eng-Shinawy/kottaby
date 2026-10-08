# Research: §9 Launch Sign-Off + Master Launch Harness + PRODUCTION_READINESS.md Update Mechanics
Date: 2026-10-08

> **ERRATUM (post-audit, 2026-10-08):** the stage table below prescribes `bun run test:workflows` — that package script does NOT exist (package.json ships only `test:workflows:paymob`). The plan files corrected this: per-domain journeys run via `bun run test/scripts/run-test.ts test/workflows/<domain>` and the full layer via `bun test test/workflows` (per `test/workflows/AGENTS.md:100-107`). Read the corrected commands from specs.md/plan.md/tasks.md, not from the table below.

## Area

PRODUCTION_READINESS.md §9 (docs/planning/PRODUCTION_READINESS.md:344-369) is the final gate: a 5-role signature table (all 5 slots blank today), 12 "Final Launch Criteria" checkboxes (all `- [ ]`), and a "🚀 Launch Approved: ___ (Date: ___)" line. **No launch-report / sign-off / launch-approval artifact exists anywhere** — grep `sign-off|signoff|launch-report|launch-approval|Launch Sign` hits only PRODUCTION_READINESS.md itself, docs/ops/disaster-recovery.md, and ai/ plan files. No master launch runner exists (`scripts/launch/` MISSING). The repo already has every pattern needed to build one: progressive per-file runner (`scripts/health/sub-loop.ts`), stage-state resumption (`scripts/quality-gate.ts` + `.quality-gate-state.json` at repo root, currently `{stage:"BASIC_CHECKS",owner:"quality-gate",lifecycle:"DONE",lastRun:"2026-09-30T10:59:08.269Z"}`), parallel suite runners (`test/scripts/run-{db,services,integration}-tests-parallel.ts` over shared `test/scripts/run-parallel-tests.ts`), dev-server orchestration (`test/scripts/run-server-tests.ts`, `--e2e --port`, `TEST_ENV_FILE`), log-capture runner (`test/scripts/run-test.ts` with `--last --focus`), ops verification with machine report + `VERDICT` (`scripts/ops/restore-verify.ts`), and a DB-introspection probe precedent (`scripts/verify-unique-constraints.ts`). Checklist inventory: **156 rows across §1–§8** (17/25/17/16/34/7/7/33) **+ §9's 17 items** (5 signatures + 12 criteria); only **5 rows ✅ today** (5.3.1 L243, 5.3.2 L244, 5.3.4 L246, 5.3.5 L247, 8.21 L328) and **1 deferred ☐ WHY** (5.3.3 L245).

## Checklist → Codebase Mapping

| # | Item (my area) | Actual artifact (path:line) | STATUS |
|---|---|---|---|
| 1 | §9 signature table, 5 blank role rows (L346-352) | The table itself is the sign-off record; no secondary artifact | MISSING (empty, by design — DOC-SIGNOFF target) |
| 2 | Final criterion "Drizzle schema type-checks (`bun tsgo`)" (L364) | scripts/quality-gate.ts:127 — BASIC_CHECKS runs `bun tsgo` | VERIFIED |
| 3 | Final criterion "`bun run scripts/validate-mermaid.ts` passes" (L365) | Real path is **scripts/validation/validate-mermaid.ts**; package.json:73 `"validate:mermaid": "bun run scripts/validation/validate-mermaid.ts"` | PARTIAL (checklist path drift; `scripts/validate-mermaid.ts` does NOT exist) |
| 4 | Final criterion "All Milestone 4 tickets completed" (L366) | docs/planning/TICKETS.md:3029-3059 — ticket itself is "Blocked By: All Milestone 4 tickets" | MANUAL (ticket-state audit, human) |
| 5 | Master launch-verification runner | No scripts/launch/ dir; model on scripts/health/sub-loop.ts + scripts/quality-gate.ts | MISSING (to build — the ticket's core deliverable) |
| 6 | Stage-state resumption for long gates | scripts/quality-gate.ts:14 `STATE_FILE = .quality-gate-state.json`; :19-24 `QualityState {stage,owner,lifecycle,lastRun}`; :115-117 saveState | VERIFIED (proven resumable-stage pattern) |
| 7 | Parallel suite orchestration | test/scripts/run-parallel-tests.ts:17-24 `RunParallelTestsConfig {pattern,cwd,maxWorkers,label,timeoutMs}`; consumed by run-db-tests-parallel.ts:14-19 | VERIFIED |
| 8 | Server-mode orchestration (GraphQL API + E2E) | test/scripts/run-server-tests.ts:17-35 (DEFAULT_PORT 3066, `--e2e`, `--port`, `SERVER_READY_TIMEOUT_MS 180_000`) | VERIFIED |
| 9 | Drill/test log capture for evidence | test/scripts/run-test.ts (`--last`, `--last --focus "<pattern>"` per root AGENTS.md) | VERIFIED |
| 10 | Machine report + final verdict precedent | scripts/ops/restore-verify.ts:213 `stdout(\`VERDICT: ${report.verdict}\`)`; scripts/ops/restore-shared.ts:31 `RESTORE_REPORT_FILE = "restore-report.json"` + per-run stamp | VERIFIED |
| 11 | ✅ evidence row format in PRODUCTION_READINESS.md | L243 + L328 (quoted in Evidence Appendix) | VERIFIED |
| 12 | Deferred-row format (no-verify escape hatch) | L245 `☐ WHY: expiry invariant is DEV1-008 scope (deferred item D5)…` | VERIFIED |
| 13 | Prior row-update task precedents | ai/finished_plans/milestone_1_core_domain_mvp/segregated_session_balance-crediting/tasks.md:95; ai/finished_plans/milestone_2_matching_notifications_escrow/surah_juz_enum_homework_tracking/tasks.md:299 | VERIFIED |
| 14 | DB introspection probe precedent (for §8 schema-shape rows) | scripts/verify-unique-constraints.ts:2-11 — live-DB probe asserting UNIQUE constraints / absent columns, "no schema-code involvement" | VERIFIED |
| 15 | Timeout/expiry sweep surfaces (rows 2.1.2, 3.1.2, 5.3.3 mechanics) | app/api/cron/{sweep-sessions,sweep-inactive-teachers,expire-subscriptions,reconcile-paymob-payments}/route.ts (each with `test/` dir); package.json `test:cron` | VERIFIED |
| 16 | Load-test tooling (6.1, 6.2, 6.3) | No autocannon/k6/artillery anywhere; no load script in package.json | MISSING |
| 17 | `test/simulate/` layer (concurrency simulation) | package.json `"test:simulate": … test/simulate/` but the directory is **empty** (`ls test/simulate/` → nothing) | MISSING (dangling package script) |
| 18 | Rate limiting (4.2.5) | backend/lib/errors.ts:186 `export class RateLimitExceededError extends DomainError` — error taxonomy only; no enforcement middleware found (grep `rateLimit(` in backend/ app/ → no implementation) | PARTIAL |
| 19 | CSRF protection (4.2.4) | backend/lib/gateway/transport-guard.ts:1-3 (method/content-type/length/JSON guards, "no raw header echoes"); backend/lib/auth/cookies.ts; app/api/graphql/route.ts composes `guardTransport(request)` FIRST (app/AGENTS.md:64) | PARTIAL (guard exists; no explicit CSRF-verification row/test) |
| 20 | Security-headers verification (§4 support) | test/config/security-headers.test.ts:2-20 — asserts X-Frame-Options/DENY, CSP, HSTS, nosniff, Referrer-Policy from next.config | VERIFIED |
| 21 | Launch report destination | docs/planning/ holds governed planning docs (README.md indexes ROADMAP/TEAM_ALLOCATION/MILESTONE_PLAN/TICKETS/PRODUCTION_READINESS); no LAUNCH_REPORT doc | MISSING (decide destination, see Harness Recommendations) |
| 22 | DR runbook + RTO/RPO (7.4-7.6) | docs/ops/disaster-recovery.md:41-42 — RPO **1 hour** / RTO **4 hours** "Ratified — no longer the checklist's 'e.g.' placeholder"; doc explicitly consumes PRODUCTION_READINESS.md §7 | VERIFIED |
| 23 | WS layer + disconnection recovery (3.2.x) | backend/ws/notification-ws-server.test.ts exists; 13-file backend/ws/ module (handlers/handshake/lifecycle/state/throttle); no reconnect-recovery test found | PARTIAL |
| 24 | Heartbeat → `users.last_active_at` (3.1.1) | "heartbeat" appears in backend/db/repo/users/user.repository.ts, backend/graphql/mutation/user.mutation.ts, backend/services/auth/auth.service.ts; no automated verify of the WS-heartbeat→timestamp link | PARTIAL |

**Mapping STATUS counts:** VERIFIED 13 · PARTIAL 6 (3,18,19,23,24 → 5 rows + drift) · MISSING 5 (1,5,16,17,21) · MANUAL 1 (4).

### Modality categorization — all sections (row counts, from the 369-line read)

| § | Rows | AUTOMATED-TEST (existing/new bun suites) | SCRIPT-PROBE (new verify script) | MANUAL-DRILL (human + recorded evidence) | DOC-SIGNOFF | Notes |
|---|---|---|---|---|---|---|
| 1 Data Integrity | 17 | 15 | 2 | 0 | 0 | 1.4.1/1.4.3 = static "no purge jobs exist" probe |
| 2 Financial/Escrow | 25 | 25 | 0 | 0 | 0 | 2.3.2 concurrency via existing chaos lanes (backend/lib/errors/test/concurrency-chaos.contract.test.ts) |
| 3 Real-Time | 17 | 12 | 1 | 4 | 0 | 3.1.1 = SCRIPT-PROBE; 3.2.1-3.2.4 disconnection drill has no automation |
| 4 Security | 16 | 11 | 2 | 3 | 0 | probes: 4.2.2 SQLi, 4.3.5 secrets scan; drills: 4.2.4 CSRF, 4.2.5 rate-limit, 4.3.4 DB SSL |
| 5 Invariants | 34 | 33 | 0 | 0 | 0 | 5.3.3 stays DEFERRED (☐ WHY, DEV1-008 scope); 4 rows already ✅ |
| 6 Performance | 7 | 0 | 4 | 3 | 0 | probes: 6.4 EXPLAIN, 6.5 N+1, 6.6 index coverage, 6.7 pagination; drills: 6.1/6.2/6.3 load |
| 7 DR | 7 | 2 | 2 | 2 | 1 | 7.2/7.3 automated by ops:db-restore-verify + backup-restore.integration.test.ts; 7.4-7.6 DOC (ratified); 7.1/7.7 drills |
| 8 Decisions | 33 | 21 | 11 | 0 | 1 | ~11 schema-shape rows probe-able via introspection; behavior rows covered by journeys; 8.21 already ✅ |
| 9 Sign-Off | 17 | 11 harness-checkable criteria | — | — | 6 (5 signatures + "All 5 sign-offs obtained") | 11 criteria map to harness stages 1-8 + tsgo + validate:mermaid + tickets audit |
| **Σ** | **173** | **119** (§1-8) + 11 (§9 criteria) | **22** | **12** | **8** | 156 §1-8 rows + 17 §9 items; 5 already ✅, 1 DEFERRED |

## Existing Coverage

- **test/workflows/ — 54 journey tests across 9 domains** (committed-fixture, zero-residue layer per test/workflows/AGENTS.md): admin/ (account-governance, admin-user-lifecycle, admin-user-denials, audit-trail, audit-completeness.journey + audit-completeness.catalog, cold-start-certification, admin-session-governance, platform-analytics); billing/ (financial-safety-verification, admin-financial-auditing, subscription-{purchase,full-lifecycle,expiry,admin-lifecycle}, paymob-live-tunnel); sessions/ (session-state-machine, session-dual-confirmation, session-lifecycle, in-session-lock-release, post-confirmation-dispute, session-lifecycle-denials); teachers/ (cooldown-state-machine, teacher-inactivity-auto-offline, on-demand-matching, evaluation-loop-booking, verification-plan-purchase); parents/ (parent-full-journey, parent-monitoring, parent-link-request, student-confirmation-of-link, handshake-discovery, parent-session-completion-deep-link); classes/ (session-report-homework, session-request-notifications, session-report-cross-teacher); notifications/ (admin-broadcast, broadcast-retraction, j1-targeted-single-recipient, j2-cohort-broadcast-offline-persistence); auth/ (registration-phone). These mechanically verify the majority of §1, §2, §3, §5, §8 behavior rows.
- **backend/db/test + backend/services: 145 test files** (rollback-wrapped repo tests + service tests), incl. evidence cited by existing ✅ rows: student.repository.test.ts, session-lifecycle.service.test.ts, subscription-activation.service.test.ts (PRODUCTION_READINESS.md:243-247).
- **frontend/graphql/test: 21 API tests** (gateway/, auth/, admin/…) run via `bun run test:graphql` → run-server-tests.ts.
- **test/ui/e2e/:** paymob-checkout.e2e.test.ts, admin-country-filter.e2e.test.ts (server-mode `--e2e`).
- **test/integration/:** db/, redis/, meeting/, paymob/ provider smokes (opt-in env gates per test/integration/AGENTS.md).
- **scripts/ops/ DR toolchain (§7):** backup-database.ts (+ .test.ts), restore-verify.ts (+ .test.ts), backup-restore.integration.test.ts, restore-oracles.ts, restore-guard.ts — `bun run ops:db-backup` / `ops:db-restore-verify` produce manifest.json + restore-report-<stamp>.json + `VERDICT: PASS|FAIL`.
- **Cron routes with tests:** app/api/cron/{sweep-sessions,sweep-inactive-teachers,expire-subscriptions,reconcile-paymob-payments}/route.ts + `test:cron` suite.
- **Finished Milestone-4 plans already executing checklist areas:** ai/finished_plans/milestone_4_integration_security_launch/{audit-trail-completeness-verification, disaster-recovery-backup-verification, financial-safety-verification, workflow_tests_parent_journey_and_subscription_lifecycle}/ (each specs.md/plan.md/tasks.md).
- **scripts/validation/validate-mermaid.ts + validate-mermaid.test.ts** — offline deterministic Mermaid checker, final-criteria item.
- **scripts/escrow-e2e/** — shell drill harness precedent (boot-server.sh, leg1-booking.sh, vlm-verify.sh) for MANUAL-DRILL evidence recording.

## Gaps

1. **Master launch runner — MISSING.** No scripts/launch/; nothing orchestrates the suites per checklist row. This is the ticket's core deliverable. Nothing similar exists beyond quality-gate.ts (code-quality stages, not checklist stages).
2. **Load testing (6.1, 6.2, 6.3) — MISSING.** No autocannon/k6/artillery; `test/simulate/` is empty yet package.json:34 `test:simulate` targets it (dangling script). Needs either a new probe tool decision or an explicit MANUAL-DRILL with recorded evidence.
3. **Rate-limit enforcement (4.2.5) — PARTIAL.** Only `RateLimitExceededError` (backend/lib/errors.ts:186) + 429 taxonomy; no limiter middleware. Cannot be "verified" without an implementation — must be downgraded to a documented drill/deferred row or built.
4. **WS disconnection recovery (3.2.1-3.2.4) — no automated tests.** backend/ws/notification-ws-server.test.ts covers server behavior, not reconnect/journey recovery; 3.2 rows land in MANUAL-DRILL.
5. **Heartbeat→last_active_at link (3.1.1) — no automated verify** (only service/mutation references to heartbeat).
6. **CSRF explicit verification (4.2.4) — PARTIAL** (transport-guard + SameSite cookies exist; no test asserting the CSRF posture).
7. **Launch report + sign-off record — MISSING.** No artifact; Section 9 table is blank. Destination must be decided (docs/planning/ vs ai/finished_plans evidence pack).
8. **Checklist path drift — L365** cites `scripts/validate-mermaid.ts`; the real file is scripts/validation/validate-mermaid.ts (alias `validate:mermaid`). The launch criteria line should be corrected during execution.
9. **§8 schema-shape rows lack a general probe.** scripts/verify-unique-constraints.ts verifies only 3 constraints (reports/home_work UNIQUE, missing teacher_id); ~11 more §8 rows (A.1-A.10 enums/tables/columns, B.18/B.19 fields, C.1/C.3/C.4/C.5) need a generalized introspection probe.
10. **Backup schedule evidence (7.1) — no scheduler in repo.** docs/ops/disaster-recovery.md:42 gives cadence arithmetic (30-min interval ≤ RPO 1h) but actual scheduling (systemd timer/cron) is environment-side — needs MANUAL-DRILL evidence (log of ops:db-backup runs + schedule definition).
11. **§9 machine-verifiable criteria** — 11 of 12 criteria are harness-checkable (sections 1-8 gates + tsgo + validate:mermaid), but "All Milestone 4 tickets completed" needs a ticket-state audit (TICKETS.md grep / gh) and "All 5 sign-offs obtained" is irreducibly human.

## Harness Recommendations

**(b) Location — `scripts/launch/`, NOT `test/launch/`.** Rationale from layout conventions: every orchestration CLI lives in `scripts/` subdirs (scripts/health/ = sub-loop.ts + shared/sub-loop-types.ts + sub-loop-args/checks; scripts/ops/ = backup/restore with reports; scripts/validation/ = validate-mermaid; scripts/qa/, scripts/escrow-e2e/ = drills). `test/` dirs are bun-test layers governed by per-dir AGENTS.md rules (test/workflows/AGENTS.md, test/integration/AGENTS.md) — a stateful orchestrator that shells out to suites and writes a state file is a script, not a test. Proposed layout mirroring scripts/health/:

```
scripts/launch/
  launch-gate.ts          # thin CLI (model: scripts/health/sub-loop.ts:29-48 thin-composer pattern)
  launch-checklist.ts     # single source of truth: all 156+17 rows → modality → command/oracle
  launch-report.ts        # report writer (model: scripts/ops/restore-shared.ts:31-43 stamped JSON)
  shared/launch-types.ts  # model: scripts/health/shared/sub-loop-types (LIFECYCLE_ORDER, logPass/logFail)
```

**Stage/state design — copy scripts/quality-gate.ts verbatim in shape:** state file `.launch-gate-state.json` with `{stage, owner, lifecycle, lastRun}` (quality-gate.ts:19-24, saveState :115-117); resume from failed stage via `STAGES.indexOf(state.stage)` (quality-gate.ts:203); wrap in `withProcessLock("launch-gate", …)` from `@/scripts/lib` (quality-gate.ts:207); `--fresh` clears state file only. Stage order mirrors checklist sections:

| Stage | Invokes | Backing rows |
|---|---|---|
| s1-data-integrity | `bun run test:db` + `bun run test:workflows` (admin domain) + retention probe | §1 (17) |
| s2-financial | test:workflows (billing, sessions domains) + test:services | §2 (25) |
| s3-realtime | test:workflows (teachers, notifications) + `test:cron` + ws drill gate | §3 (17) |
| s4-security | frontend/graphql/test via `test:graphql`, test/config/security-headers.test.ts, secrets-scan probe | §4 (16) |
| s5-invariants | test:db + test:workflows (sessions, teachers, parents) | §5 (34) |
| s6-performance | NEW probes (index coverage, EXPLAIN, N+1, pagination) + load-drill evidence check | §6 (7) |
| s7-dr | `bun run ops:db-restore-verify` → parse restore-report VERDICT (scripts/ops/restore-verify.ts:213) + drill evidence | §7 (7) |
| s8-decisions | NEW probe-decisions.ts (model: scripts/verify-unique-constraints.ts) + journeys | §8 (33) |
| s9-gate | tsgo + `validate:mermaid` + ticket audit + checklist-completeness audit | §9 (17) |

**New SCRIPT-PROBE scripts** (all under scripts/launch/): `probe-decisions.ts` — generalize verify-unique-constraints.ts introspection for §8 schema-shape rows (tables exist, FK/UNIQUE/enum columns, absent `reports.teacher_id`); `probe-retention.ts` — static grep that no purge/delete jobs touch session logs/reports/evaluations/homework (§1.4); `probe-indexes.ts` (§6.6) + `probe-explain.ts` (§6.4) — pg_catalog/`EXPLAIN ANALYZE` against the live DB; `secrets-scan.ts` (§4.3.5).

**(c) Evidence recording in PRODUCTION_READINESS.md — exact format of existing ✅ rows** (status column, replacing `☐`; keep the 4-column row structure): `✅ <PR-or-ticket ref> (<task ref> — <evidence: test files, schema refs, doc refs>)`. Two real examples at L243 and L328 (quoted in Evidence Appendix). Deferred rows keep `☐` plus `WHY:` + scope owner (L245). Hard rule from precedent tasks: "only tick boxes whose evidence actually executed" (segregated_session_balance-crediting/tasks.md:95) and "tick row 8.21 with verification reference" (surah_juz_enum_homework_tracking/tasks.md:299). Launch execution should follow the same discipline: each of the 156 rows gets either a ✅ with command + artifact refs or a ☐ WHY with named owner/scope. **PRODUCTION_READINESS.md §9 completion:** fill the 5 signature rows (Name/Signature/Date), tick the 12 `- [x]` criteria, fill "🚀 Launch Approved: <date>".

**(d) Launch report + sign-off record.** Recommend a machine-generated JSON report `docs/planning/launch-report-<UTC-stamp>.json` (model: scripts/ops restore-report-<stamp>.json + `VERDICT: PASS`) holding per-row {rowId, modality, command, exitStatus, evidenceRef, timestamp}, plus a final `VERDICT` the s9-gate prints. The **human sign-off record stays in PRODUCTION_READINESS.md §9 itself** (the table + criteria checkboxes + Launch Approved line ARE the record — the doc says "Every item must be verified and signed off"); no separate sign-off markdown. If a companion narrative doc is wanted, it belongs in docs/planning/ and must be added to docs/planning/README.md's planning-hierarchy index. NOTE: root AGENTS.md forbids agent-created summary MD files — the launch report must be an explicitly planned, ticket-required artifact, not an agent-generated summary.

**(e) No existing launch-report/sign-off artifact** — grep returned nothing (finding #7 above). The only adjacent precedents: ops restore-reports (machine JSON) and the audit/DR plan evidence packs under ai/finished_plans/milestone_4_integration_security_launch/*/.

## Evidence Appendix

Key excerpts proving load-bearing claims (≤3 lines each):

1. **Stage-state resumption pattern** — scripts/quality-gate.ts:14,19-24:
   `const STATE_FILE = join(process.cwd(), ".quality-gate-state.json");` / `interface QualityState { stage: QualityStage; owner: "quality-gate" | "duplicates"; lifecycle: QualityLifecycle; lastRun: string; }`
2. **Resumable stage execution** — scripts/quality-gate.ts:203,207: `const startIndex = STAGES.indexOf(state.stage); await executeStages(startIndex, state.lifecycle);` / `await withProcessLock("quality-gate", async () => { await runQualityGate(); });`
3. **Progressive short-circuit runner** — scripts/health/sub-loop.ts:71-73: `const tsgoResult = checkTsgo(filePath); if (failOnResult(tsgoResult, "tsgo FAILED — stopping here…")) return 1;`
4. **Parallel runner config** — test/scripts/run-db-tests-parallel.ts:14-19: `await runParallelTests({ pattern: "**/*.test.ts", cwd: "backend/db/test", maxWorkers: isEmbeddedDb ? 1 : 8, label: "database", timeoutMs: 60_000, });`
5. **✅ row format (canonical example)** — PRODUCTION_READINESS.md:243:
   `| 5.3.1 | INV-B1: Balances are non-negative integers | Verify check constraints and default 0 | ✅ REQ-010 (Task 1.1 — CHECK-floor tiers \`student.repository.test.ts\`, schema \`students.ts:42-45\`) |`
6. **✅ row format (decision example)** — PRODUCTION_READINESS.md:328:
   `| 8.21 | B.11: Surah/Juz enum for homework | Verify surah_juz_ref enum and columns | ✅ kottaby#300 (Tasks 2/5 — \`surah_juz_ref\` pgEnum + TS enum at 144 members (114 surahs + 30 juz); mirror-parity + 22P02 backstop green; see \`docs/curriculum/surah-juz-ref-vocabulary.md\`) |`
7. **Deferred row format** — PRODUCTION_READINESS.md:245: `| 5.3.3 | INV-B3: … | ☐ WHY: expiry invariant is DEV1-008 scope (deferred item D5) — no expiry surface exists this milestone |`
8. **Row-update discipline precedent** — segregated_session_balance-crediting/tasks.md:95: "Tick \`docs/planning/PRODUCTION_READINESS.md:243-248\` §5.3.1–5.3.5 with evidence refs … — only tick boxes whose evidence actually executed"
9. **DR gate precedent (§7 automation)** — scripts/ops/restore-verify.ts:213: `stdout(\`VERDICT: ${report.verdict}\`);` and restore-shared.ts:31: `export const RESTORE_REPORT_FILE = "restore-report.json";`
10. **RTO/RPO ratified** — docs/ops/disaster-recovery.md:41-42: `| **RPO** … | **1 hour** | Ratified — no longer the checklist's "e.g." placeholder |` / `| **RTO** … | **4 hours** | Ratified … |` — and :22 "This runbook is the procedure that checklist consumes."
11. **validate-mermaid real path** — package.json:73: `"validate:mermaid": "bun run scripts/validation/validate-mermaid.ts",` (checklist L365's `scripts/validate-mermaid.ts` does not exist — `ls` confirmed).
12. **Rate-limit gap** — backend/lib/errors.ts:186: `export class RateLimitExceededError extends DomainError {` (taxonomy only; no enforcement middleware found via grep).
13. **Transport-guard posture (4.2.4 partial)** — backend/lib/gateway/transport-guard.ts:2-3: "Pure transport guards for the GraphQL route's pre-engine tier (method, content-type, declared-length, drained-length, and JSON parse)." + app/AGENTS.md:64: "`/api/graphql` additionally composes `guardTransport(request)` FIRST".
14. **Security-headers assertion** — test/config/security-headers.test.ts:14: `expect(headersMap.get("X-Frame-Options")).toBe("DENY");` (also CSP/HSTS/nosniff asserts, :15-20).
15. **DB-introspection probe precedent** — scripts/verify-unique-constraints.ts:2-4: "DB introspection probe … Verifies, against the live database (no schema-code involvement): 1. `reports.session_id` and `home_work.session_id` each carry a UNIQUE table constraint."
16. **Journey-layer zero-residue discipline** — test/workflows/AGENTS.md:17-18: "teardown must leave ZERO residue … a leaking `afterAll` must fail the suite".
17. **§9 sign-off table is blank** — PRODUCTION_READINESS.md:346-352: five rows `| Engineering Manager | | | |` … `| Product Owner | | | |` (no names/dates).
18. **Live state file shape** — `.quality-gate-state.json` (repo root): `{ "stage": "BASIC_CHECKS", "owner": "quality-gate", "lifecycle": "DONE", "lastRun": "2026-09-30T10:59:08.269Z" }`.

**Cron sweep surfaces (rows 2.1.2 / 3.1.2 / 5.3.3 mechanics):** app/api/cron/sweep-sessions, sweep-inactive-teachers, expire-subscriptions, reconcile-paymob-payments (each `route.ts` + `test/`), run via package.json `test:cron`.
