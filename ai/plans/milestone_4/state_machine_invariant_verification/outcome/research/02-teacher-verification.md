# Research Dossier — Teacher Verification (INV-TV1..INV-TV7)

Domain: Teacher Verification Lifecycle (spec §2, `docs/specs/state-machine-invariants.md:53-93`).
Ticket: "State Machine Invariant Verification Tests" — `docs/planning/TICKETS.md:2873` (Milestone 4, Dev 2, 5 SP).
All citations verified on the live tree in this session (Read/Grep/sed with line numbers).

## 1. Invariants in scope

| ID | Doc line | Verbatim statement (docs/specs/state-machine-invariants.md) |
|---|---|---|
| INV-TV1 | :87 | "An applicant cannot be certified (`is_approved = true`) without either (a) completing 5 evaluation sessions with 5 distinct certified Shuyukh and passing, or (b) being directly onboarded by the Admin (cold-start)." |
| INV-TV2 | :88 | "The 5 evaluation sessions must be with 5 **distinct** certified Shuyukh (no evaluator can evaluate the same applicant twice)." |
| INV-TV3 | :89 | "A cooldown period must fully expire before an applicant can re-purchase the verification plan." |
| INV-TV4 | :90 | "Tajweed cooldown = 1 month (30 days); Hifz cooldown = 3 months (90 days). These are minimums." |
| INV-TV5 | :91 | "The Admin override can supersede the automated aggregation result in any direction (certify, reject, or grant re-evaluation)." |
| INV-TV6 | :92 | "A failed applicant who is converted to a student retains student privileges (can subscribe to plans and attend sessions) during the cooldown period." |
| INV-TV7 | :93 | "`teacher_verification` record stores `tajweed_level` and `hifz_level` assessments for the applicant." |

State carrier: `applicants.status` is a plain varchar (service-enforced state machine, no pgEnum/CHECK/trigger) — `backend/db/schema/teachers/applicants.ts:26`, doc note `:12-15`; `cooldown_until` at `applicants.ts:23`; `teacher.is_approved` at `backend/db/schema/teachers/teacher.ts:25`.

## 2. Enforcement map

| ID | Mechanism | Path:line | Symbol | Fragment |
|---|---|---|---|---|
| TV1 | Certification writers are a closed set of 3 arms (rubric-pass finalization, admin override certify, admin cold-start); no other writer of `is_approved=true` exists | `backend/db/repo/teachers/teacher.repository.ts:248` | `TeacherRepository.insertColdStartCertified` | `isApproved: true` (values at :257) |
| TV1 | Guarded elevate (precondition folded into WHERE) | `backend/db/repo/teachers/teacher.repository.ts:281` | `elevateToCertified` | `.where(and(eq(teacher.id, id), eq(teacher.isApproved, false)))` (:293) |
| TV1 | (a) pass arm: quorum gate — fewer than 5 cycle submissions ⇒ no verdict, no teacher row | `backend/services/teachers/evaluation-rubric.helpers.ts:511` | `submitRubricEvaluationInTx` | `if (submissions.length < VERIFICATION_PLAN_SESSION_COUNT) return` |
| TV1 | (a) pass arm: teacher row minted only on 5/5 pass finalize | `backend/services/teachers/evaluation-rubric.helpers.ts:347` (`insertColdStartCertified` call at :355, elevate at :365) | `finalizeRubricPass` | per-eval minimum `RUBRIC_PASS_THRESHOLD` via `deriveRubricVerdict` :294-295 |
| TV1 | (b) admin cold-start (BFLA actor gate first) | `backend/services/admin/cold-start-certification.service.ts:162` (gate :170, insert :119, elevate :139, finalize :199) | `ColdStartCertificationService.certifyTeacherColdStart` | GraphQL contract self-labels "INV-TV1(b) / FR-3.9" — `backend/graphql/mutation/admin/admin-teachers.mutation.ts:44` |
| TV1 | (b) admin override certify arm | `backend/services/teachers/applicant-lifecycle.override-arms.ts:67` (insert :77, elevate :84) | `applyCertifyOverride` | already-`passed` denied via `denyAlreadyCertified` :72-74 |
| TV1 | Terminal applicant finalize (supersedes any status, clears cooldown) | `backend/db/repo/teachers/applicant.repository.ts:543` | `finalizeOnCertification` | `status: Passed, cooldownUntil: null` |

| ID | Mechanism | Path:line | Symbol | Fragment |
|---|---|---|---|---|
| TV2 | Distinct-evaluator booking gate (per-cycle memory) | `backend/services/teachers/evaluation-booking.helpers.ts:177` | `assertCycleCapacity` | `if (evaluators.includes(evaluatorId)) throw new ConflictError("EVALUATOR_ALREADY_USED"...)` (:184) |
| TV2 | Cycle aggregate: distinct non-cancelled evaluator set + booked/completed counts | `backend/db/repo/classes/session.repository.evaluation.helpers.ts:245` | `countEvaluationBookingsInCycle` | `array_agg(distinct ${session.teacherId}) filter (where status <> cancelled)` (:254-256) |
| TV2 | Cycle window resolution (subscription arm pins verification plan by title) | `backend/db/repo/classes/session.repository.evaluation.helpers.ts:175` | `resolveCurrentEvaluationCycle` | `plans.title = VERIFICATION_PLAN_TITLE` (subscription arm) |
| TV2 | 5-credit ceiling is DERIVED, not stored | `backend/services/teachers/evaluation-booking.helpers.ts:159` | `assertCycleCapacity` | `if (booked >= VERIFICATION_PLAN_SESSION_COUNT)` → `NO_EVALUATION_CREDITS_REMAINING` / `EVALUATION_LOOP_COMPLETE` (:167, :175); constant = 5 at `shared/constants/verification-plan.constants.ts:21` |
| TV2 | Write-once arbiter backing one-submission-per-session | `backend/db/schema/teachers/evaluations.ts:64` | `evaluations_session_evaluator_unique` | `unique(...).on(t.sessionId, t.evaluatorId)` |
| TV3 | Cooldown gate on verification purchase (strict > = "fully expire") | `backend/services/teachers/applicant-lifecycle.service.ts:215` | `assertCanPurchaseVerification` | `if (cooldownUntil !== null && cooldownUntil > now) throw new ValidationError("APPLICANT_COOLDOWN_ACTIVE")` (:236-244) |
| TV3 | Gate consumed inside purchase transaction | `backend/services/teachers/verification-purchase.service.ts:319` | `purchase` | `await ApplicantLifecycleService.assertCanPurchaseVerification(applicantUserId, locale, tx)` |
| TV3 | Terminal certified rejection (no re-purchase once passed) | `backend/services/teachers/applicant-lifecycle.service.ts:215` (same guard, `APPLICANT_ALREADY_CERTIFIED` branch) | `assertCanPurchaseVerification` | certified denial — tests at `applicant-lifecycle.service.test.ts:598+` |
| TV4 | Cooldown durations pinned as constants | `shared/constants/evaluation-rubric.constants.ts:21` (`TAJWEED_COOLDOWN_DAYS = 30`), `:24` (`HIFZ_COOLDOWN_DAYS = 90`) | — | day-count form; failure area drives the pick |
| TV4 | Cooldown stamp on failed finalization | `backend/services/teachers/evaluation-rubric.helpers.ts:327` | `resolveFinalizationCooldownUntil` | `area === Tajweed ? TAJWEED_COOLDOWN_DAYS : HIFZ_COOLDOWN_DAYS` (:328) |
| TV4 | Guarded failed flip stamps cooldown verbatim (in_evaluation precondition in WHERE) | `backend/db/repo/teachers/applicant.repository.ts:504` | `transitionToFailed` | `.where(eq(applicants.status, ApplicantStatus.InEvaluation))` (:521) |
| TV4 | "Minimums": admin can extend (1..3650) or clear; no shorten-below arm | `backend/db/repo/teachers/applicant.repository.ts:590` (`extendCooldownOnce`), `:688` (`clearCooldownOnce`); bounds `backend/services/teachers/applicant-lifecycle.helpers.ts:222-225` | — | `COOLDOWN_EXTENSION_MIN_DAYS = 1` / `MAX = 3650` |
| TV5 | Three override directions (certify / reject / grant-re-evaluation) | `backend/services/teachers/applicant-lifecycle.override-arms.ts:67` (`applyCertifyOverride`), `:134` (`applyRejectOverride`), `:199` (`applyGrantReEvaluationOverride`) | `ApplicantLifecycleService.overrideApplicantEvaluation` | reject demotes via `TeacherRepository.demoteToUncertified` (:170, guarded `WHERE is_approved = true` — repo :327); grant clears cooldown via `clearCooldownOnce` (:222) |
| TV5 | Admin-only actor gate on override + cold-start | `backend/services/admin/admin-gate.helpers.ts` (`assertActorAdminActive`, consumed at `cold-start-certification.service.ts:170` and in the override orchestrator) | — | non-admin → ForbiddenError, zero writes (test `applicant-lifecycle.service.test.ts:2065`) |
| TV6 | Failed verdict converts applicant to student in the SAME transaction | `backend/services/teachers/evaluation-rubric.helpers.ts:399` (`finalizeRubricFail`, guarded transition at :405 then conversion) → `backend/services/teachers/applicant-conversion.service.ts:75` (`convertToStudent`) | — | zeroed `students` row + guarded role flip `UserRepository.transitionRoleOnce(..., Teacher, Student)` (applicant-conversion.service.ts:103); "makes every student-gated surface reachable while the applicant serves their re-application cooldown" (docstring :8-10) |
| TV7 | Schema ONLY: table + columns exist | `backend/db/schema/teachers/teacher-verification.ts:19-20` | `teacherVerification` | `tajweedLevel: varchar("tajweed_level", { length: 50 })`, `hifzLevel: varchar("hifz_level", ...)`; DDL `backend/drizzle/20260904084151_omniscient_karen_page/migration.sql:313-320`, FK `:502`, index `:376` |
| TV7 | **NO runtime writer/reader exists** | Global grep `teacherVerification\|teacher_verification` matches ONLY: schema file, migration.sql, `backend/db/migration/rollback-down.sql`, `test/helpers/db-cleanup.ts:19` (cleanup harness docstring) | — | no service, repo, GraphQL, or seed writes `tajweed_level`/`hifz_level`; levels actually live in `evaluations.weakness_area` (evaluations.ts:50) |

## 3. Existing coverage

| ID | Verdict | Test path:line | Test name | What it asserts |
|---|---|---|---|---|
| TV1 | COVERED | `backend/services/teachers/evaluation-rubric.service.test.ts:443` | "below-quorum submission: commits alone, the read-model is sealed…" | 4/5 quorum ⇒ no verdict write, applicant unchanged (cannot certify without 5) |
| TV1 | COVERED | `backend/services/teachers/evaluation-rubric.service.test.ts:490` | "five 80s PASS: the teacher row is minted certified…" | 5 passing submissions mint `teacher` row `is_approved=true` + applicant `passed` |
| TV1 | COVERED | `backend/services/teachers/evaluation-rubric.service.test.ts:535` | "FAIL finalization… no teacher row appears" | failed cycle stamps cooldown and never mints a teacher row |
| TV1 | COVERED | `test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts:1027` | step 8 "ONE submission finalizes PASS — teacher row minted, status passed" | end-to-end 5-distinct-evaluator pass mints certification |
| TV1 | COVERED | `test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts:1296` | step 16 "the verdict is terminal: a post-finalization submission is rejected with zero rows" | terminal `passed`/`failed`; no re-entry without a new cycle |
| TV1 | COVERED | `backend/services/admin/cold-start-certification.service.test.ts:186` (+ :273, :462) | "row-absent create with makeEvaluator=true: certified row, finalized applicant…" / elevation / already-certified denial | the admin cold-start arm (INV-TV1(b)) works and is the only other certifier |
| TV1 | COVERED | `backend/services/teachers/applicant-lifecycle.service.test.ts:1524` | "certify a FAILED applicant inserts the teacher row certified (is_approved=true…)" | override certify arm inserts certified row + finalizes applicant |
| TV2 | COVERED | `backend/services/teachers/evaluation-booking.service.test.ts:650` | "distinctness — the same evaluator cannot be booked twice in one cycle" | re-booking the same evaluator ⇒ `EVALUATOR_ALREADY_USED` ConflictError, zero rows |
| TV2 | COVERED | `backend/services/teachers/evaluation-booking.service.test.ts:671` | "cancellation re-opens the evaluator — a cancelled row occupies NEITHER a credit NOR a used-evaluator slot" | cancel frees the distinctness slot (matches doc note :68(c)) |
| TV2 | COVERED | `backend/services/teachers/evaluation-booking.service.test.ts:588` | "capacity boundary — booked 4/5: the last free slot books; the 6th attempt is the zero-trap denial" | 5-credit ceiling boundary |
| TV2 | COVERED | `test/workflows/teachers/evaluation-loop-booking.journey.test.ts:660` | step 5 "EVALUATOR_ALREADY_USED, TEACHER_NOT_CERTIFIED … all silent, zero rows" | journey-level distinctness denial |
| TV2 | COVERED | `test/workflows/teachers/evaluation-loop-booking.journey.test.ts:780` | step 3 "five distinct scheduled evaluation sessions, remaining credits 0" | five distinct evaluators actually bookable |
| TV2 | COVERED | `test/workflows/teachers/admin-ordered-re-evaluation.journey.test.ts:869` | step 3 "distinct evaluators, ceiling 5 enforced" | per-cycle distinctness on the paid re-evaluation cycle too |
| TV2 | COVERED | `backend/db/test/repo/teachers/evaluation.repository.test.ts:460` | "a duplicate (session, evaluator) insert raises the RAW 23505 on evaluations_session_evaluator_unique" | DB write-once arbiter behind one-submission-per-session |
| TV2 | COVERED | `backend/db/test/repo/teachers/evaluation.repository.test.ts:698` | "returns the scored submissions across DISTINCT completed evaluation sessions, earliest first" | quorum read counts distinct completed sessions |
| TV3 | COVERED | `backend/services/teachers/applicant-lifecycle.service.test.ts:433` | "ALLOWS when cooldown expires EXACTLY now (strict > comparator)" | "fully expire" boundary semantics |
| TV3 | COVERED | `backend/services/teachers/applicant-lifecycle.service.test.ts:447` | "blocks a FUTURE cooldown with APPLICANT_COOLDOWN_ACTIVE…" | active cooldown denies purchase guard |
| TV3 | COVERED | `backend/services/teachers/verification-purchase.service.test.ts:301` | "cooldown-active applicant → localized cooldown denial — zero writes" | the purchase flow itself denies during cooldown |
| TV3 | COVERED | `test/workflows/teachers/cooldown-state-machine.test.ts:1002` | step 4 "the verification purchase is denied while the cooldown is active (422 family, zero writes)" | end-to-end denial during cooldown |
| TV3 | COVERED | `test/workflows/teachers/cooldown-state-machine.test.ts:1129` | step 8 "the re-application purchase SUCCEEDS — attempt counter increments, failed → in_evaluation" | end-to-end re-purchase after expiry |
| TV3 | COVERED | `test/workflows/teachers/verification-plan-purchase.journey.test.ts:594` (+ :623) | step 4 cooldown-active denial / step 5 expired re-purchase | cross-actor journey coverage of the gate |

| ID | Verdict | Test path:line | Test name | What it asserts |
|---|---|---|---|---|
| TV4 | COVERED | `backend/services/teachers/evaluation-rubric.service.test.ts:535` | "FAIL finalization: the guarded transition stamps the tajweed cooldown exactly" | fail ⇒ `cooldown_until ≈ now+30d` stored verbatim |
| TV4 | COVERED | `backend/services/teachers/evaluation-rubric.service.test.ts:985` | "tie-break — two submissions tied at the lowest failing score resolve to the FIRST-SUBMITTED area (tajweed → 30 days, never hifz)" | primary-failure-area derivation picks 30d |
| TV4 | COVERED | `backend/services/teachers/evaluation-rubric.service.test.ts:1011` | "hifz cooldown — the single failing area stamps exactly now+90d" | 90-day stamp exactness |
| TV4 | COVERED | `test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts:1149` | step 12 "finalizes FAIL: cooldown ≈ now+30d, re-purchase denied, no teacher/students rows, no suspension writes" | 30d + no suspension fields (impl-shape, see §6) |
| TV4 | COVERED | `test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts:1243` | step 15 "finalizes FAIL: cooldown ≈ now+90d (hifz variant)" | 90d hifz arc |
| TV4 | COVERED | `test/workflows/teachers/cooldown-state-machine.test.ts:964` (+ :1218) | step 2 tajweed 30d / step 12 hifz 90-day minimum arc | both cooldown lengths at journey level |
| TV4 | COVERED | `backend/services/teachers/applicant-lifecycle.service.test.ts:984` (+ :1116, :1199) | "lengthens an ACTIVE cooldown verbatim…" / bounds denials / boundary lengths 1 and 3650 | the "minimums" leg: admin can only extend, never shorten below stamp |
| TV5 | COVERED | `backend/services/teachers/applicant-lifecycle.service.test.ts:1524` | "certify a FAILED applicant inserts the teacher row certified…" | override supersedes automated fail → certified |
| TV5 | COVERED | `backend/services/teachers/applicant-lifecycle.service.test.ts:1817` | "reject a PASSED applicant demotes the teacher row, flips the applicant to failed with the stamped cooldown" | override supersedes automated pass → rejected+cooldown |
| TV5 | COVERED | `backend/services/teachers/applicant-lifecycle.service.test.ts:1959` | "grant re-evaluation CLEARS an active cooldown without touching the status (purchasability flips true)" | override grants re-evaluation |
| TV5 | COVERED | `backend/services/teachers/applicant-lifecycle.service.test.ts:1888` (+ :2041) | "reject a NON-passed applicant denies…" / "grant on a PASSED applicant denies…" | direction preconditions (terminal guards) |
| TV5 | COVERED | `backend/services/teachers/applicant-lifecycle.service.test.ts:2065` | "a NON-ADMIN actor is denied by the service-side admin gate with zero writes and zero audit rows" | admin-only surface |
| TV5 | COVERED | `test/workflows/teachers/cooldown-state-machine.test.ts:1046` (+ :1183, :1201) | step 5 admin extension / step 9 non-admin FORBIDDEN / step 10 certified terminal guard | admin supersede at journey level |
| TV6 | COVERED | `test/workflows/teachers/applicant-student-conversion.journey.test.ts:927` | step 7 "ONE submission finalizes FAIL — the verdict converts the applicant in the SAME transaction (zeroed students row + role flip)" | conversion is atomic with the fail verdict |
| TV6 | COVERED | `test/workflows/teachers/applicant-student-conversion.journey.test.ts:1020` | step 8 "the converted actor logs in and rotates a refresh token; the minted tokens carry role student" | converted actor operates as a student |
| TV6 | COVERED | `test/workflows/teachers/applicant-student-conversion.journey.test.ts:1063` | step 9 "the converted actor purchases a STUDENT plan during the cooldown and books a real session against the credited lane" | **direct INV-TV6 assertion**: student privileges (subscribe + attend) retained during cooldown |
| TV6 | COVERED | `test/workflows/teachers/applicant-student-conversion.journey.test.ts:1135` | step 10 "the admin clears the cooldown; the converted actor re-purchases verification and the cycle re-opens" | cooldown exit re-entry into the loop |
| TV6 | COVERED | `backend/services/teachers/evaluation-rubric.service.test.ts:1301` (+ :1398, :1441) | "FAIL finalization conversion — the failed applicant gains a zeroed students row and the student role…" / rollback-on-conversion-failure / replay no-op | conversion unit-level + atomicity |
| TV6 | COVERED | `backend/services/teachers/applicant-conversion.service.test.ts:129` (+ :161, :183, :202, :233) | "fresh conversion inserts a zeroed student row and flips the role" / idempotency / non-teacher internal trip / duplicate replay | conversion seam unit coverage |
| TV7 | **GAP** | none | none | No test anywhere references `teacher_verification`; the only repo-adjacent mention is the cleanup-harness docstring `test/helpers/db-cleanup.ts:19`. The table has no producer (see §2), so there is no behavior to assert |

Verdict tally: **COVERED 6, PARTIAL 0, GAP 1** (INV-TV7).


## 4. Recommended tests for PARTIAL/GAP

| ID | Target test file | Layer rules | Assertion approach | Fixtures |
|---|---|---|---|---|
| TV7 | `backend/db/test/repo/teachers/teacher-verification.repository.test.ts` (new) | DB repo/logic test under `backend/db/test/` wrapped in `runInRollback` + `tx` (rules per `backend/db/test/AGENTS.md`); no `expect().rejects` inside the rollback block — use try/catch for the negative probe | **Schema-contract probe** (the only honest coverage — the invariant's producer does not exist): (1) read `information_schema.columns` for table `teacher_verification` and assert columns `tajweed_level`, `hifz_level` exist, data_type `character varying`, max_length 50, nullable (DDL ground truth `backend/drizzle/20260904084151_omniscient_karen_page/migration.sql:313-320`); (2) assert FK `teacher_verification_teacher_id_teacher_id_fkey` → `teacher.id` ON DELETE CASCADE (`migration.sql:502`) and index `teacher_verification_teacher_id_idx` (`migration.sql:376`); (3) optional functional smoke: inside the rollback `tx`, `insert into teacherVerification` for a `createTestTeacherRow` teacher with the two levels set, read back, assert round-trip — rolls back with the block, no committed state. **Do NOT write a test asserting the levels are recorded by the rubric flow — that behavior does not exist; flag it (see §6) instead of fabricating coverage** | `createTestUser` + `createTestTeacherRow` (§5); raw `information_schema` reads need no fixture |
| TV4 (optional hardening) | `shared/constants/evaluation-rubric.constants.test.ts` (new) | Plain constants test, same shape as existing `shared/constants/verification-plan.constants.test.ts:55-69` (which already pins `VERIFICATION_PLAN_SESSION_COUNT = 5` at :65-69) | Pin `TAJWEED_COOLDOWN_DAYS === 30` and `HIFZ_COOLDOWN_DAYS === 90` as literal types — makes the INV-TV4 numeric contract a one-line regression tripwire; behavioral 30/90 exactness is already covered (§3) | none |

No other new tests required for TV1..TV6 — the plan should instead **point** at the existing suites (§3) as the invariant's verification, optionally adding one cross-reference map (invariant ID → existing test) so the ticket's "every invariant is tested" acceptance criterion is auditable.

## 5. Fixture/helper needs (verified signatures)

All from `backend/db/test/entity-setup.ts` and `backend/db/test/test-utils.ts` — verified by reading the files in this session:

| Helper | Path:line | Signature (verified) |
|---|---|---|
| `runInRollback` | `backend/db/test/test-utils.ts:34` | `runInRollback<T>(fn: (tx: DBTransaction) => Promise<T>): Promise<T \| undefined>` |
| `createTestUser` | `backend/db/test/entity-setup.ts:74` | `(tx: DBTransaction, overrides: Partial<UserSelectType> = {}) => Promise<UserSelectType>` (role defaults `"student"` — override to `"teacher"`) |
| `createTestApplicant` | `backend/db/test/entity-setup.ts:143` | `(tx, userId, overrides: Partial<ApplicantSelectType> = {})` — defaults `status: "pending"`, `cooldownUntil: null` |
| `createTestTeacherRow` | `backend/db/test/entity-setup.ts:550` | `(tx, userId, overrides: Partial<TeacherSelectType> = {})` — defaults `isApproved: true`, `isEvaluator: false` |
| `createTestEvaluation` | `backend/db/test/entity-setup.ts:440` | `(tx, evaluatedId, evaluatorId, sessionId: number \| null, overrides)` — defaults `score: 85` |
| `createTestPlan` | `backend/db/test/entity-setup.ts:180` | `(tx, overrides: Partial<PlanSelectType> = {})` — defaults `isActive: true` (title NOT unique — see journey-suite plan-teardown note, `evaluation-booking.service.test.ts:1270-1277`) |
| `createTestSubscription` | `backend/db/test/entity-setup.ts:222` | `(tx, userId, planId, overrides)` — defaults `status: Active`, `startDate: now`, `endDate: null` |
| `createTestSession` | `backend/db/test/entity-setup.ts:303` | `(tx, teacherId, studentId, overrides)` — defaults `SessionStatus.Scheduled` / `SessionType.StudentSession`; evaluation sessions need `{ sessionType: SessionType.TeacherEvaluation }` |
| `createTestAdmin` | `backend/db/test/entity-setup.ts:169` | `(tx, userId)` |
| `createTestStudent` | `backend/db/test/entity-setup.ts:104` | `(tx, userId, overrides)` — zeroed balances + unique `KSB-…` handshake code |

Cross-actor journeys (if the plan adds any): committed fixtures + registry cleanup via `test/workflows/helpers/journey-fixture-registry.ts` and `test/workflows/helpers/journey-cleanup.ts`; **NO `runInRollback`** in workflow tests (pattern confirmed in `test/workflows/teachers/*.journey.test.ts` and the committed-fixture race suites, e.g. `evaluation-booking.service.test.ts:1235-1277`).

## 6. Notes for the plan

1. **INV-TV7 has no producer — doc-vs-implementation mismatch (the plan's biggest scope risk).** The doc statement (`state-machine-invariants.md:93`) implies the rubric/certification flow writes `tajweed_level`/`hifz_level` into `teacher_verification`. In the shipped code the table exists (`teacher-verification.ts:19-20`, DDL `migration.sql:313-320`) but NOTHING writes or reads it — the levels actually recorded are `evaluations.weakness_area` per submission (`evaluations.ts:50`) plus the final verdict on `applicants`. A test-writing plan must not add a writer (that's a product feature); achievable coverage is the schema-contract probe (§4) plus an explicit "KNOWN-UNIMPLEMENTED" annotation on the invariant so the ticket's "every invariant is tested and passes" criterion doesn't silently pass on an unenforced statement. Recommend the plan also (out of its own scope, as a follow-up note) flag `docs/specs/state-machine-invariants.md:93` for amendment.

2. **Cooldown state representation mismatches the doc's state table.** Spec §2.1 (`:63-64`) maps Cooldown_Tajweed/Hifz to `students.suspended = true, suspended_period_days = 30/90`. The implementation stores cooldown on the APPLICANT row — `applicants.cooldown_until` (`applicants.ts:23`) with `status='failed'` — and explicitly writes no suspension fields (`evaluation-rubric.helpers.ts:387-389` docstring "no suspension fields are written"; asserted at `evaluation-rubric-scoring.journey.test.ts:1149` "no suspension writes"; `applicant-lifecycle.service.ts:19` "reads `applicants.cooldown_until` ONLY — never `users.suspended`"). New tests MUST assert the implemented shape (`applicants.cooldown_until`), not the doc's `students.suspended` mapping; the plan should record this as a doc drift, not a code defect.

3. **No DB-level guards exist for this state machine.** `applicants.status` is a plain varchar with no pgEnum/CHECK/trigger (`applicants.ts:26`, enum doc note `backend/enum/teachers/applicant-status.enum.ts:2-5`); certification (`teacher.is_approved`) likewise has no CHECK. Enforcement is 100% service-gate + guarded single-statement UPDATEs. Tests that try raw SQL to "trip a constraint" will find none — the correct assertion style here is service-level denial (typed Conflict/Validation errors) and guarded-UPDATE zero-row returns, exactly as the existing suites do. Do not write trigger-probe tests for TV invariants.

4. **Per-cycle semantics matter for INV-TV2 wording.** Doc note `:68(c)` (implementation reference) says distinct-evaluator memory is per-cycle and a fresh activation re-admits previously used evaluators; the plain invariant text `:88` ("no evaluator can evaluate the same applicant twice") reads as lifetime. Tests follow the per-cycle implementation (`assertCycleCapacity` — `evaluation-booking.helpers.ts:177`; `admin-ordered-re-evaluation.journey.test.ts:1054-1070` books the same evaluator set in a new cycle). The plan should pin the per-cycle reading, citing doc `:68(c)` as the authoritative implementation reference.

5. **"5 distinct certified Shuyukh" is enforced across two seams.** Distinctness + certification at booking (`evaluation-booking.helpers.ts:177-185`, `:199-213`); certification + quorum + per-eval pass threshold at scoring (`evaluation-rubric.helpers.ts:174-181`, `:511`, `:294-295`). INV-TV1 negative coverage (no certification below quorum / on fail) is already strong (§3); the certification-writer closure (only 3 arms — §2) is the structural argument and can be asserted cheaply with a source-level grep test if the plan wants belt-and-braces (repo tests already use source-assertion style, e.g. `applicant.repository.transition.test.ts:325-347`).

6. **Sibling-plan overlap.** (a) The booking evaluator-certification gate is documented as the "INV-S5 analog" (doc `:68(d)`) — the Session dossier may claim the same booking-gate tests; coordinate so the plan cross-references rather than duplicates. (b) The cooldown journey also exercises admin extension (INV-TV5-adjacent) and the suspension gates of INV-U2 — the Student Account dossier should own INV-U2 proper. (c) `teacher.is_approved` checks in directory/matching (`teacher.repository.matching.helpers.ts:132`) belong to INV-A/PC surfaces, not TV.

7. **Run commands.** DB/logic tests: `bun run test/scripts/run-test.ts <path>` (mandatory log capture); services tests co-located under `backend/services/teachers/` run via the same runner; journeys under `test/workflows/teachers/` use committed fixtures + registry cleanup. Do not run tests as part of plan authoring (research-only discipline).

— End of dossier. 7 invariants in scope; 6 COVERED, 0 PARTIAL, 1 GAP (INV-TV7, no producer).
