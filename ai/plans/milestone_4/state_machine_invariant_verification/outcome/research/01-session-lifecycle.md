# Research Dossier — Session Lifecycle (INV-S1..INV-S8)

Scope: `docs/specs/state-machine-invariants.md` §1 (lines 8-49). Ticket: `docs/planning/TICKETS.md:2873-2910`.
All path:line citations below were verified against the live tree in this session.

## 1. Invariants in scope (ID | doc line | verbatim statement)

| ID | Doc line | Verbatim statement |
|---|---|---|
| INV-S1 | docs/specs/state-machine-invariants.md:42 | "A session cannot transition from `completed` back to `started` or `scheduled`." |
| INV-S2 | docs/specs/state-machine-invariants.md:43 | "A session cannot transition from `cancelled` to any other state." |
| INV-S3 | docs/specs/state-machine-invariants.md:44 | "A `teacher_transaction` (type = earning) can only be created when a session transitions to `completed` AND the student confirms (dual confirmation)." |
| INV-S4 | docs/specs/state-machine-invariants.md:45 | "A session must have both `teacher_id` and `student_id` (NOT NULL)." |
| INV-S5 | docs/specs/state-machine-invariants.md:46 | "The teacher must be a certified Sheikh (`teacher.is_approved = true`) at the time of session creation." |
| INV-S6 | docs/specs/state-machine-invariants.md:47 | "While a session is in `started` state, the teacher's `is_online` must be `false` (in-session lock)." |
| INV-S7 | docs/specs/state-machine-invariants.md:48 | "A session report (`reports`) can only be submitted for a session that has reached `completed` state." |
| INV-S8 | docs/specs/state-machine-invariants.md:49 | "Homework (`home_work`) is linked to a session and can only be created when the session report is submitted." |

Context lines: states table at docs/specs/state-machine-invariants.md:15-21; transition mermaid at :25-37
(the mermaid's `completed --> [*]` has no `completed --> cancelled` edge — see §6 note 1).
Canonical impl binding: docs/sessions/session-lifecycle.md:76-83 (INV-S1..S8 binding table).

## 2. Enforcement map (ID | mechanism | path:line | symbol | short fragment)

| ID | Mechanism | path:line | Symbol | Fragment |
|---|---|---|---|---|
| S1 | guarded UPDATE pre-state predicates | backend/db/repo/classes/session.repository.ts:191-204 | `SessionRepository.startSessionOnce` | `.where(and(eq(session.id,id), eq(session.teacherId,teacherId), eq(session.status, SessionStatus.Scheduled)))` — a completed row can never match |
| S1 | guarded completion | backend/db/repo/classes/session.repository.ts:222-228 | `SessionRepository.completeSessionOnce` | requires pre-state `started` (impl delegated to session.repository.lifecycle.helpers.ts) |
| S1 | transition matrix constant | backend/services/classes/session-lifecycle.enforcement.ts:72-86 | `SESSION_TRANSITION_MATRIX` | `[SessionStatus.Completed]: new Set([])` (terminal) |
| S1 | pure lookup | backend/services/classes/session-lifecycle.enforcement.ts:94-96 | `isSessionTransitionAllowed` | matrix membership test |
| S2 | cancel predicate (live states only) | backend/db/repo/classes/session.repository.ts:248-262 | `SessionRepository.cancelSessionOnce` | `.where(buildLiveParticipantTransitionPredicate(id, participantId))` (:259) — cancelled rows unreachable |
| S2 | arbitration guards | backend/db/repo/classes/session.repository.ts:311-332, :373-395 | `resolveDisputeCancelOnce` / `resolveDisputeCompleteOnce` | both require `eq(session.status, SessionStatus.Disputed)` (:329, :392) |
| S2 | admin cancel guard | backend/db/repo/classes/session.repository.helpers.ts:459-468 | `guardCancelPreTerminal` | live-state predicate via `buildAdminLiveStatePredicate` (:436-441: scheduled OR started only) |
| S3 | exactly-once dual-confirmation stamp | backend/db/repo/classes/session.repository.ts:543-565 | `confirmStudentCompletionOnce` | predicate: `status=Completed AND feeHeld=true AND confirmedByTeacherAt IS NOT NULL AND confirmedByStudentAt IS NULL` |
| S3 | earning credit slice | backend/services/classes/session-lifecycle.confirmation.ts:58-68, :129, :140 | `creditTeacherEarning` → `WalletRepository.creditEarningOnce` | the ONLY earning writer (see §6 note 5) |
| S3 | earning ledger insert | backend/db/repo/billing/wallet.repository.ts:78-110 | `WalletRepository.creditEarningOnce` | `type: TransactionType.Earning` at :95 |
| S4 | schema NOT NULL FKs | backend/db/schema/classes/session.ts:58-63 | `session.teacherId` / `session.studentId` | `.notNull().references(…, { onDelete: "restrict" })` |
| S5 | creation-time certification lock | backend/services/classes/session-lifecycle.booking.ts:245-261 | `bookSessionInTx` | `lockForCertificationCheck` FOR UPDATE; `if (lockedTeacher.isApproved !== true) throw ConflictError("TEACHER_NOT_CERTIFIED")` (:254-260) |
| S5 | certification re-assertion fused into completion | backend/db/repo/classes/session.repository.ts:222-228 (docblock :207-216) | `completeSessionOnce` | `EXISTS (SELECT 1 FROM teacher …)` inside the guarded UPDATE |
| S5 | column | backend/db/schema/teachers/teacher.ts:25 | `teacher.isApproved` | `boolean("is_approved").default(false)` (nullable — strict `!== true` check) |

| ID | Mechanism | path:line | Symbol | Fragment |
|---|---|---|---|---|
| S6 | lock acquire (capture + offline in one statement) | backend/db/repo/teachers/teacher.repository.ts:460-468 | `TeacherRepository.acquireInSessionLock` | `wasOnlineBeforeLock: sql\`COALESCE(${teacher.wasOnlineBeforeLock}, ${teacher.isOnline})\`` (:464) + drives `is_online=false`; REQUIRED `tx` |
| S6 | acquire composed into start tx | backend/services/classes/session-lifecycle.service.ts:298-319 | `SessionLifecycleService.startSession` | `TeacherRepository.acquireInSessionLock(started.teacherId, tx)` (:312); zero-row acquire fails the flow closed (:313-318) |
| S6 | marker column | backend/db/schema/teachers/teacher.ts:36 | `teacher.wasOnlineBeforeLock` | `boolean("was_online_before_lock")` — NULL = no lock held |
| S6 | release (restore-once, last-exit guard) | backend/db/repo/teachers/teacher.repository.ts:558-601 | `TeacherRepository.releaseInSessionLock` | `isOnline: sql\`${teacher.wasOnlineBeforeLock}\`` (:578); `isNotNull(teacher.wasOnlineBeforeLock)` gate (:585); verdicts `no_lock_held` / `active_sessions_remain` (:601) |
| S6 | release wrapper | backend/services/classes/session-lifecycle.transitions.ts:265-286 | `releaseTeacherInSessionLock` | throws on zero teacher rows; no-op/defer are debug logs |
| S6 | release composed on ALL started-exits | backend/services/classes/session-lifecycle.service.ts:433 (complete), :521 (cancel), :693 (arbitration); backend/services/classes/session-admin-governance.helpers.ts:387 (admin-governance cancel) | — | unconditional on pre-state; persisted marker is the single gate |
| S7 | shared gate (no production consumer — §6 note 3) | backend/services/classes/session-lifecycle.enforcement.ts:127-141 | `assertSessionCompletedForReport` | `if (row?.status !== SessionStatus.Completed) throw ConflictError("SESSION_INVALID_TRANSITION")` |
| S7 | production gate (inline, FOR UPDATE) | backend/services/classes/session-report.service.ts:261-278 | `submitReportAndHomeworkInTx` | `lockForReportGate` (:261); `if (probe.status !== SESSION_COMPLETED_STATUS) throw ConflictError("SESSION_INVALID_TRANSITION")` (:272-278) |
| S7 | repo row lock | backend/db/repo/classes/session.repository.gate.helpers.ts:52 | `lockForReportGate` | SELECT … FOR UPDATE probe projection |
| S8 | shared gate (no production consumer — §6 note 3) | backend/services/classes/session-lifecycle.enforcement.ts:164-178 | `assertReportSubmittedForHomework` | denies when `!ReportRepository.existsReportForSession(sessionId, tx)` with `HOMEWORK_REQUIRES_REPORT` |
| S8 | report-exists probe | backend/db/repo/classes/report.repository.ts:151 | `ReportRepository.existsReportForSession` | EXISTS-style read |
| S8 | production enforcement = composition | backend/services/classes/session-report.service.ts:227 (insert inside report tx, after `ReportRepository.insertReport` :279-284) | `HomeWorkRepository.insertHomeWork` | the ONLY production homework insert call site (verified via repo-wide grep) |
| S8 | schema link | backend/db/schema/classes/home-work.ts:27-29, :45 | `homeWork.sessionId` | NOT NULL FK + `home_work_session_id_unique` |
| S7/S8 | schema | backend/db/schema/classes/reports.ts:24-26, :36 | `reports.sessionId` | NOT NULL FK + `reports_session_id_unique` (one report per session) |

## 3. Existing coverage (ID | verdict | test path:line | test name | what it asserts)

| ID | Verdict | Test path:line | Test name | What it asserts |
|---|---|---|---|---|
| S1 | COVERED | backend/services/classes/session-lifecycle.enforcement.test.ts:193 | "every off-matrix pair is denied (5×5 sweep: terminals, no-ops, backwards moves)" | pure-matrix truth table: all 25 pairs pinned, completed/cancelled allow nothing (incl. no-ops) |
| S1 | COVERED | test/workflows/sessions/session-state-machine.journey.test.ts:426 | "completed → start is denied (INV-S1: completed is terminal), zero writes" | real-service denial + full-row byte-equality before/after |
| S1 | COVERED | backend/graphql/test/session-lifecycle-mutations.test.ts:579 | "start after completed → SESSION_INVALID_TRANSITION (terminal state)" | GraphQL mutation surface denial |
| S1 | COVERED | backend/services/classes/session-lifecycle.service.test.ts:974 | "cancel probe: a completed session and a foreign caller are both denied" | completed row unreachable by cancel; :1785-1799 dispute on completed row denied |
| S1 | COVERED | test/workflows/sessions/session-lifecycle.journey.test.ts:661 | "Teacher T cancels the COMPLETED session A: SESSION_INVALID_TRANSITION; row byte-identical" | committed-fixture cross-actor denial |

| ID | Verdict | Test path:line | Test name | What it asserts |
|---|---|---|---|---|
| S2 | COVERED | backend/services/classes/session-lifecycle.enforcement.test.ts:193 | (same 5×5 sweep) | cancelled row allows nothing |
| S2 | COVERED | test/workflows/sessions/session-state-machine.journey.test.ts:434, :442 | "cancelled → cancel is denied (INV-S2…)", "cancelled → start is denied" | both off-matrix exits of cancelled denied, zero delta |
| S2 | COVERED | backend/services/classes/session-lifecycle.service.test.ts:1465 | "REQ-042: double-cancel refunds EXACTLY once — the second cancel is a SESSION_INVALID_TRANSITION with the balance unchanged" | cancelled terminality + no double refund |
| S2 | COVERED | backend/db/test/repo/classes/session.repository.test.ts:659 | "cancelSessionOnce returns null and writes nothing for: non-participant caller, terminal states, unknown id" | guarded-UPDATE zero-row on terminal rows |
| S2 | COVERED | backend/graphql/test/session-lifecycle-mutations.test.ts:660 | "double cancel → SESSION_INVALID_TRANSITION (never double-refunds)" | GraphQL surface |
| S3 | COVERED | backend/services/classes/session-lifecycle.service.test.ts:2505 | "confirmSessionCompletion happy path: student stamp + hold release + EXACTLY ONE earning credit (ledger row + wallet increment) in one flow" | earning ledger row (type `earning`, fee verbatim, sessionId linked, wallet +fee) exists only after student confirm |
| S3 | COVERED | backend/services/classes/session-lifecycle.service.test.ts:2548, :2578 | idempotent replay / teacher-caller no-op tests | "ZERO new financial writes" on replays |
| S3 | COVERED | test/workflows/sessions/session-lifecycle.journey.test.ts:571 | "step 6 — Teacher T completes session A: … zero wallet/ledger/audit deltas" | completion ALONE creates no earning (committed fixtures) |
| S3 | COVERED | backend/services/classes/session-lifecycle.service.test.ts:1900 | "resolveSessionDispute COMPLETE outcome: consumes the hold with NO wallet credit…" | arbitration path credits nothing |
| S3 | COVERED | backend/services/classes/session-lifecycle.service.test.ts:1517 | "source: the unit's cross-surface channels… imports are a pinned allowlist" | grep-gate: wallet-credit slice is the only financial channel (docs/sessions/session-lifecycle.md:78 binding) |
| S4 | COVERED | backend/db/test/repo/classes/session.repository.test.ts:2311 | "INV-S4: a session row without its teacher party is rejected by the NOT NULL constraint (23502)" | raw `INSERT INTO session (teacher_id, student_id) VALUES (NULL/…)` inside savepoint → PG 23502 for both columns |
| S5 | COVERED | backend/services/classes/session-lifecycle.service.test.ts:854 | "teacher-lock certification branches: an unapproved teacher AND a null-flag teacher are both TEACHER_NOT_CERTIFIED" | creation-time gate incl. strict-true null boundary, zero writes |
| S5 | COVERED | backend/services/classes/session-lifecycle.service.test.ts:944 | "complete probe: an owned in-progress session that fails the fused certification predicate is TEACHER_NOT_CERTIFIED" | decertified teacher cannot complete |
| S5 | COVERED | backend/db/test/repo/classes/session.repository.test.ts:575 | "completeSessionOnce returns null and writes nothing for: decertified teacher, null certification, wrong state, non-owner, unknown id" | guarded-UPDATE level |
| S5 | COVERED | backend/graphql/test/session-lifecycle-mutations.test.ts:601 | "decertified owner completeSession → TEACHER_NOT_CERTIFIED (fused EXISTS)" | GraphQL surface |

| ID | Verdict | Test path:line | Test name | What it asserts |
|---|---|---|---|---|
| S6 | COVERED | backend/services/classes/session-lifecycle.service.test.ts:3463-3927 | describe "INV-S6 in-session lock" — 12 tests, e.g. :3464 "start ⇒ the teacher is locked offline in the SAME transaction", :3597/:3616/:3655/:3713 release on every started-exit, :3750/:3927 never-resurrect, :3863 two-session deferral | full lock lifecycle in runInRollback |
| S6 | COVERED | backend/db/test/repo/teachers/teacher.repository.test.ts:674, :894 | "TeacherRepository.acquireInSessionLock (the capture-and-lock primitive)" / "…releaseInSessionLock (the marker-gated last-exit release)" | primitive-level capture/first-lock-wins/release verdicts |
| S6 | COVERED | test/workflows/sessions/in-session-lock-release.journey.test.ts:426, :452, :597, :635, :709-726 | REQ-016..019 journeys | start locks offline; mid-session Available toggle denied `TEACHER_IN_ACTIVE_SESSION`; admin-governance cancel restores; reschedule-polluted scheduled row is a `no_lock_held` no-op; last-exit deferral |
| S6 | COVERED | test/workflows/sessions/session-state-machine.journey.test.ts:239, :345-393 | J1 step 1 / J2 legs | lock applied on start; cancel and complete both restore (committed fixtures) |
| S7 | COVERED | backend/services/classes/session-lifecycle.enforcement.test.ts:227-326 | "assertSessionCompletedForReport (INV-S7) — pass paths"/"denials" (:276 started, :286 disputed/cancelled/scheduled, :308 unknown id, :317 locale fallback, :397 concurrent reads) | the shared gate denies every non-completed state |
| S7 | COVERED | backend/services/classes/session-report.service.test.ts:532 | "wrong status for each of scheduled/started/cancelled/disputed ⇒ SESSION_INVALID_TRANSITION; zero rows" | the PRODUCTION surface (inline FOR UPDATE gate) denies all four wrong states |
| S8 | PARTIAL | backend/services/classes/session-lifecycle.enforcement.test.ts:243-360 | "assertReportSubmittedForHomework (INV-S8) — pass paths"/"denials" (:331 completed w/o report denied, :345 unknown id, :420 rolled-back report does not satisfy the gate) | the shared gate's semantics are directly asserted |
| S8 | PARTIAL | backend/services/classes/session-report.service.test.ts:628 | "pre-existing assignment WITHOUT a report ⇒ the home_work arbiter maps to SESSION_REPORT_ALREADY_EXISTS and the report insert rolls back with it" | the DB unique arbiter blocks report-less homework duplicates (inverse direction) |
| S8 | PARTIAL | backend/services/classes/session-report.service.test.ts:667, :710 | "happy path WITHOUT homework ⇒ … zero home_work rows" / "happy path WITH homework (jadid + madi) ⇒ assignment row mapped field-by-field" | homework co-created only inside the report tx |
| S8 | PARTIAL | backend/db/schema/classes/report-homework-schema.static-assertions.test.ts:76-91 | "home_work carries the home_work_session_id_unique constraint over session_id", grade CHECK pins | structural link pins (unique, checks) — but NOT the session_id NOT NULL pin |

Coverage summary: 7 COVERED, 1 PARTIAL (S8), 0 GAP. S8 gap detail: nothing pins that `HomeWorkRepository.insertHomeWork` has exactly ONE production call site (the report tx), and no static/data-level test asserts `home_work.session_id` NOT NULL + "every homework row implies a report row".

## 4. Recommended tests for PARTIAL/GAP (ID | target test file | layer rules | assertion approach | fixtures)

| ID | Target test file | Layer rules | Assertion approach | Fixtures |
|---|---|---|---|---|
| S8 | backend/db/schema/classes/report-homework-schema.static-assertions.test.ts (extend) | schema static-assertion layer (no DB; mirror the existing `columns`/`uniqueConstraint` helpers at :32-49) | pin `homeWork.sessionId.notNull === true` and `reports.sessionId.notNull === true` plus the FK targets, same style as the existing nullable-grade pin at :84-87 | none (pure Drizzle table introspection via `getTableConfig`) |
| S8 | backend/services/classes/session-report.service.test.ts (extend, new "source pin" describe) | co-located service test; follows the established source-pin pattern (session-lifecycle.service.test.ts:1517-1624, session-repository.admin.test.ts:892) | readFileSync the services tree and assert `insertHomeWork(` occurs in exactly one non-test production file (session-report.service.ts:227) — proving no report-less creation path exists | none |

| ID | Target test file | Layer rules | Assertion approach | Fixtures |
|---|---|---|---|---|
| S8 (optional data-level) | backend/db/test/logic/classes/ (new small file, runInRollback + tx everywhere; never `expect(...).rejects` inside runInRollback — use the try/catch `expectRepoError` helper from backend/db/test/test-utils) | DB logic test | inside one `runInRollback(async tx => …)`: `createTestSession` → `createTestSessionReport` → `createTestHomeWork`, then raw `SELECT count(*) FROM home_work hw LEFT JOIN reports r ON r.session_id = hw.session_id WHERE r.id IS NULL` via `tx.execute(sql…)` expecting 0 — the data-level reading of "homework implies report" | `createTestSession`, `createTestSessionReport`, `createTestHomeWork` (§5) |
| S1/S2 (residual cells) | test/workflows/sessions/session-state-machine.journey.test.ts (extend the "Sweep — every off-matrix transition denied" block at :395-460) | cross-actor journey: NO runInRollback; committed fixtures via `buildSessionJourneyCast` + `createSessionFixtureRegistry` with afterAll hard-delete and twice-green reruns (test/workflows/AGENTS.md) | add `cancelled → complete` and `cancelled → dispute` denial cells through the real service (`completeSession` / `openSessionDispute` on a cancelled fixture), asserting `DomainError` code `SESSION_INVALID_TRANSITION` + full-row equality (copy the `expectServiceDenial` + `readFullSessionRow` helpers at :106-120); the pure 5×5 matrix test (enforcement.test.ts:193) already covers these at the constant level — this closes the service-level sweep | existing journey cast + one cancelled fixture (J2 cancel leg already leaves one; reuse the `readFullSessionRow` pattern) |

NOT recommended for this slice: a generic "all session writers obey SESSION_TRANSITION_MATRIX" consistency test — two shipped writers are documented off-matrix amendments (§6 note 1) and a naive consistency sweep would false-fail. If the plan wants one, it must hard-code the two-amendment whitelist.

## 5. Fixture/helper needs (verified signatures)

| Helper | Path:line | Verified signature |
|---|---|---|
| `createTestSession` | backend/db/test/entity-setup.ts:303 | `(tx: DBTransaction, teacherId: number, studentId: number, overrides: Partial<SessionSelectType> = {}) => Promise<SessionSelectType>` — defaults `status: Scheduled`, `feeHeld: false`, null lane/stamps |
| `createTestSessionReport` | backend/db/test/entity-setup.ts:344 | `(tx: DBTransaction, sessionId: number, overrides: Partial<ReportSelectType> = {}) => Promise<ReportSelectType>` — default rating 5 |
| `createTestHomeWork` | backend/db/test/entity-setup.ts:376 | `(tx: DBTransaction, sessionId: number, overrides: Partial<HomeWorkSelectType> = {}) => Promise<HomeWorkSelectType>` — both grade tracks NULL |
| `createTestUser` | backend/db/test/entity-setup.ts:74 | `(tx: DBTransaction, overrides: Partial<UserSelectType> = {}) => Promise<UserSelectType>` — role default "student" |
| `createTestStudent` | backend/db/test/entity-setup.ts:104 | `(tx: DBTransaction, userId: number, overrides: Partial<StudentSelectType> = {}) => Promise<StudentSelectType>` — lane balances default 0 |
| `createTestTeacherRow` | backend/db/test/entity-setup.ts:550 | `(tx: DBTransaction, userId: number, overrides: Partial<TeacherSelectType> = {}) => Promise<TeacherSelectType>` — defaults `isApproved: true`; pass `{ isApproved: null }` for the strict-true boundary |
| `createTestAdmin` | backend/db/test/entity-setup.ts:169 | `(tx: DBTransaction, userId: number) => Promise<AdminSelectType>` |
| `runInRollback` / `expectRepoError` | backend/db/test/test-utils.ts (imported at backend/services/classes/session-lifecycle.service.test.ts:140) | DB-test transaction wrapper / safe try-catch rejection oracle |
| `hasPostgresErrorCode` | backend/db/test/pg-error.ts (imported at session-lifecycle.service.test.ts:139) | PG error-code matcher (e.g. 23502 NOT NULL — used by the INV-S4 probe) |
| journey cast/registry | test/workflows/helpers (imported at session-state-machine.journey.test.ts:56-61) | `buildSessionJourneyCast`, `createSessionFixtureRegistry`, `journeyPrefix("session-state-machine")` |
| test-local actor helper (pattern) | backend/services/classes/session-lifecycle.service.test.ts:234 | `createSessionActors(tx)` builds certified teacher + student pair; its local `createTestTeacherRow(tx, userId, isApproved: boolean | null)` (:230) exists precisely to pin the null-certification boundary — reuse this pattern for S5 boundary cells |

## 6. Notes for the plan (scope risks, sibling overlap, ambiguities)

1. **The closed matrix has TWO shipped, documented off-matrix writers** — the plan's INV-S1/S2 tests must treat them as amendments, not defects: (a) `SessionRepository.sweepExpiredCompletedOnce` (backend/db/repo/classes/session.repository.ts:613-627) flips `completed → cancelled` when the student-confirmation window lapses (B.4 reconciliation; the doc's mermaid at :35 has no such edge); (b) `openPostConfirmationDisputeOnce` (session.repository.ts:353) flips a dual-confirmed `completed → disputed` (docs/sessions/session-lifecycle.md:93 §2.4). INV-S1's literal text ("no completed → started/scheduled") holds under both.

2. **Admin reschedule writes timing onto scheduled rows** — `guardReschedule` (backend/db/repo/classes/session.repository.helpers.ts:443-457) rewrites only `started_at`/`ended_at` on `scheduled` AND `started` rows (admin test backend/db/test/repo/classes/session-repository.admin.test.ts:553; terminal/disputed refused at :587). Consequence: `startedAt !== null` does NOT imply the session ever started. The INV-S6 release is marker-gated, never stamp-gated (proven by test/workflows/sessions/in-session-lock-release.journey.test.ts:635). Any new invariant test must never infer "started" from the stamp. Related nuance: `resolveDisputeCompleteOnce` fuses `isNotNull(session.startedAt)` (session.repository.ts:392), and the pre-write never-started VALIDATION (session-lifecycle.service.ts:663-671) keys on the same stamp — a reschedule-polluted scheduled-then-disputed row is therefore admin-completable. Documented behavior; do not "fix".
3. **The shared INV-S7/S8 gates have NO production consumer.** `assertSessionCompletedForReport` / `assertReportSubmittedForHomework` (session-lifecycle.enforcement.ts:127/:164) are exported and unit-tested, but the live report surface inlines its own FOR UPDATE gate (session-report.service.ts:261-278) and homework gating is purely compositional (single insert call site at :227 inside the report tx). The ticket's "every invariant tested" should cite the production-surface tests (session-report.service.test.ts:532) as the load-bearing ones; the gate unit tests are already exhaustive (enforcement.test.ts:227-436).
4. **INV-S3 exclusivity is enforced by single-writer composition**: `WalletRepository.creditEarningOnce` (backend/db/repo/billing/wallet.repository.ts:78, `type: TransactionType.Earning` at :95) is the only earning INSERT; its only caller is `creditTeacherEarning` (backend/services/classes/session-lifecycle.confirmation.ts:58-68), reached only after `confirmStudentCompletionOnce` matched (session-lifecycle.confirmation.ts:129-141) — the guarded predicate IS the dual-confirmation proof. Keep the import-allowlist source pin (session-lifecycle.service.test.ts:1517) green; any new earning path must extend it.
5. **INV-S5 is creation-time only by design**: the booking gate (session-lifecycle.booking.ts:254-260) checks `isApproved !== true` under a FOR UPDATE certification lock; `startSession` does NOT re-check certification, but `completeSessionOnce` fuses the re-assertion. Tests exist at all three layers (booking :854, completion :944/:575, GraphQL :601). `teacher.is_approved` is nullable — the strict-true boundary (`null` ⇒ denied) is already pinned at service.test.ts:854.
6. **INV-S4 is schema-enforced, not service-enforced**: NOT NULL FKs (session.ts:58-63) + the raw-SQL 23502 probe (session.repository.test.ts:2311) are the complete story. No service-level test needed — the repo probe with savepoint-bracketed raw INSERT is the canonical pattern for tripping a column constraint safely inside runInRollback (never let the 23502 poison the outer tx; the test rolls back to `savepoint session_notnull_probe`).
7. **Layer placement for new tests** (per backend/db/test/AGENTS.md + test/workflows/AGENTS.md): DB predicate probes → backend/db/test/repo/classes (runInRollback + tx everywhere); service denial cells → backend/services/classes/*.test.ts co-located; cross-actor committed journeys → test/workflows/sessions/ with registry cleanup + twice-green. The INV-S6 suite is already the deepest in the repo — new S6 work should extend it rather than fork it.
8. **Sibling-plan overlap**: the arbitration consumed-escrow legs (session-arbitration.service.test.ts:606/:782 wallet-reversal assertions) and the escrow/hold flows belong to the wallet (INV-W4) and escrow dossiers; the teacher-availability toggle seam (assertTeacherNotInActiveSession, enforcement.ts:203) is INV-A2 territory (dossier 03) even though it composes the S6 lock. Keep S-domain tests off those surfaces to avoid duplicate maintenance.
9. **No DB trigger guards the session table's status column** — backend/drizzle custom migrations contain immutability triggers for `audit_logs`, `student_payments`, `teacher_transaction` (backend/drizzle/20260904084152_custom_3-immutability-triggers/migration.sql:30-98) but nothing on `session`; terminality is enforced ONLY by guarded-UPDATE predicates + the app-side matrix. That makes the guarded-writer tests (zero-rows assertions) the only line of verification — a raw `UPDATE session SET status=…` would succeed; do not attempt to add a DB-level trigger in this TEST-WRITING ticket, but the plan may note it as a future hardening option.
10. **Session status enum**: `backend/enum/scheduling/session-status.enum.ts:7-13` (5 values, mirrors `session_status` pgEnum); matrix keys are the enum members — any new status value must extend `SESSION_TRANSITION_MATRIX` (its key type is the full enum, so tsgo fails closed on omissions).
