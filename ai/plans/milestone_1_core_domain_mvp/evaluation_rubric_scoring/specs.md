# Requirements & Specification: Evaluation Rubric Scoring (≥80% Threshold) — DEV2-007

> **Date**: 2026-09-21 (Milestone 1 — Core Domain MVP)
> **Target Ticket**: `Evaluation Rubric Scoring (≥80% Threshold)` (`docs/planning/TICKETS.md:764-815`; Owner: Dev 2, 5 SP; the predecessor plan DEV2-006 reserves the DEV2-007 label for this ticket)
> **Plan directory**: `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/` (this directory)
> **Specs path**: this file
> **Design path**: `plan.md` (this directory)
> **Tasks path**: `tasks.md` (this directory)
> **Deferred-items ledger**: `deferred-items.md` (this directory)
> **Outcome directory**: `outcome/` (this directory) — pre-execution reads of ALL outcome files are mandatory per task
> **Blocked By (FINISHED)**: 5-Session Evaluation Loop Booking (`ai/finished_plans/milestone_1_core_domain_mvp/5_session_evaluation_loop_booking/`) — all its surfaces verified live on this branch
> **Blocks**: Cooldown State Machine (1-Month Tajweed / 3-Month Hifz) (`docs/planning/TICKETS.md:818-871`) and, transitively, DEV2-009 Failed Applicant → Student Record Conversion (`docs/planning/TICKETS.md:872-915`) and Admin Override of Evaluation Results (`docs/planning/TICKETS.md:916-948`)
> **Decision Refs (ticket)**: B.1 (80% pass threshold, per evaluation session) — `docs/specs/open-decisions-and-gaps.md:75-79`; B.7 (teacher record only after passing verification) — `docs/specs/open-decisions-and-gaps.md:111-116`; C.3 (`evaluated_id`/`evaluator_id`) — `docs/specs/open-decisions-and-gaps.md:199-204`; INV-E1 (`evaluations.score` 0-100 check) — `docs/specs/state-machine-invariants.md:332`; FR-3.5/FR-3.6 (automated aggregation / qualification outcomes) — `docs/specs/functional-requirements.md:106-121`

---

## 1. Executive Summary & Problem Statement

**Feature:** Let each of the 5 DISTINCT certified evaluators booked by the predecessor loop submit a session-linked rubric evaluation — integer score 0-100 plus qualitative notes, plus a weakness area (Tajweed/Hifz) when and only when the score is below the pass threshold — and let the system, deterministically inside the 5th submission's own transaction, aggregate the 5 results and finalize the applicant: PASS (all 5 scores ≥ 80) creates the `teacher` row (`is_approved=true`, `is_evaluator=false`) and flips `applicants.status='passed'`; FAIL (any score < 80) flips `applicants.status='failed'` and writes `cooldown_until = now + 30 days (Tajweed) | 90 days (Hifz)` derived from the primary failure area. The applicant is notified on both outcomes through the existing notification engine.

**Problem from user perspective:**

- **Certified evaluator (Sheikha Fatima):** she can book-receive, start, and complete a `teacher_evaluation` session today (`EvaluationBookingService` + session lifecycle, all shipped by DEV2-006), but there is NO surface to actually record her verdict — no mutation, no service, no UI. The only existing `evaluations` write is the student→teacher star-rating flow (`StudentEvaluationService.submitTeacherEvaluation`, `backend/services/teachers/student-evaluation.service.ts:248`), a different actor and semantics.
- **Teacher applicant (Ibrahim):** his dashboard already renders `Failed`/`CooldownZone` and `Passed`/`CertifiedNarrative` branches (`frontend/views/teachers/dashboard/ApplicantStatusResolution.tsx:85-153`), and the lifecycle guard already reads `cooldown_until` — but nothing in the codebase ever WRITES a verdict or a cooldown: `cooldownUntil` exists with zero writers, and no `status='failed'` repo write exists at all. The loop he paid for can never resolve.
- **Platform integrity:** the ticket's "primary failure area (Tajweed or Hifz)" has no storage anywhere (no column, no enum — verified absent), the threshold has no typed constant (only prose in `backend/db/schema/teachers/evaluations.ts:29`), and the `evaluations` doc header still describes applicant evaluations as session-unlinked standalone rows (`evaluations.ts:9-13`) — contradicting the shipped session-linked loop. This plan owns those schema/type deltas and the doc correction.
- **Dev 2 (owner) / downstream tickets:** the Cooldown State Machine ticket (`TICKETS.md:818-871`) is blocked on this one and owns the `users.suspended*` writes; DEV2-009 (`TICKETS.md:872-915`) owns failed-applicant → student-record conversion. This plan must deliver the `status='failed'` + `cooldown_until` substrate WITHOUT pre-empting either — explicit ledger deferrals, not silent scope grabs.

**Business value:** This is the terminal half of the verification loop M1 advertises — purchase → book×5 → complete×5 → score×5 → verdict. Without it, DEV2-006's sessions are dead rows, no applicant can ever become a certified teacher through evaluation, and the Cooldown/Conversion/Admin-Override chain has no input. `docs/teachers/applicant-lifecycle.md:120` pre-assigns the "`in_evaluation → passed | failed` transition writes, and the `teacher` row on `passed`" to this flow.

---

## 2. Source Ticket (verbatim anchor)

`docs/planning/TICKETS.md:764-815`, titled "### Evaluation Rubric Scoring (≥80% Threshold)":

> Implement evaluation rubric scoring. Each evaluator submits an evaluation with score (0-100), notes, and pass/fail. The system aggregates 5 evaluation results and applies the ≥80% pass threshold. If the applicant meets the threshold, teacher.is_approved is set to true and a teacher record is created.

Acceptance criteria (verbatim, gherkin block from the ticket):

> Given an evaluator completing an evaluation session
> When they submit the evaluation
> Then an evaluations record is created with evaluated_id=applicant, evaluator_id=sheikh
> And evaluations.score is 0-100 (check constraint)
> And evaluations.notes contains qualitative observations
>
> Given 5 evaluation sessions are complete
> When the system aggregates results
> Then if the applicant scored >= 80 on all 5 evaluations, they PASS
> And if the applicant scored < 80 on any evaluation, they FAIL
> And the primary failure area (Tajweed or Hifz) is identified
>
> Given an applicant who passed (all 5 >= 80)
> When the aggregation completes
> Then a teacher record is created (shared PK with users)
> And teacher.is_approved = true
> And applicants.status = 'passed'
> And the applicant gains full teaching permissions
>
> Given an applicant who failed
> When the aggregation completes
> Then applicants.status = 'failed'
> And the applicant enters cooldown (1-month Tajweed or 3-month Hifz)
> And a students record is created for the failed applicant

Test scenarios named in the ticket: all 5 scores ≥ 80 → pass + teacher record; one score < 80 → fail + cooldown; exactly 80 → pass (boundary); 79 → fail (boundary); Tajweed primary failure → 1-month cooldown; Hifz primary failure → 3-month cooldown; failed applicant gets students record; evaluations record has `evaluated_id` and `evaluator_id` (C.3).

Numbered verbatim phrases from the ticket (each must trace to a REQ):

1. "Each evaluator submits an evaluation with score (0-100), notes, and pass/fail" → REQ-1 (score/notes/weakness input contract; pass/fail is DERIVED from score, never client-supplied).
2. "an evaluations record is created with evaluated_id=applicant, evaluator_id=sheikh" → REQ-1, REQ-3.
3. "evaluations.score is 0-100 (check constraint)" → REQ-1, REQ-4 (INV-E1).
4. "evaluations.notes contains qualitative observations" → REQ-1.
5. "if the applicant scored >= 80 on all 5 evaluations, they PASS" → REQ-5.
6. "if the applicant scored < 80 on any evaluation, they FAIL" → REQ-5.
7. "the primary failure area (Tajweed or Hifz) is identified" → REQ-6.
8. "a teacher record is created (shared PK with users)" / "teacher.is_approved = true" / "applicants.status = 'passed'" → REQ-7 (B.7).
9. "applicants.status = 'failed'" + "the applicant enters cooldown (1-month Tajweed or 3-month Hifz)" → REQ-8.
10. "a students record is created for the failed applicant" → DEFERRED to DEV2-009 (see §8 C5, §11 D2 — ticket-graph ownership).

## 3. Requirements Glossary (terms used throughout)

- **Rubric submission**: one write to `evaluations` by an evaluator for a COMPLETED `teacher_evaluation` session in the applicant's current cycle: `session_id` (NOT NULL link), `evaluated_id=applicant`, `evaluator_id=<session's evaluator>`, `score` (required integer 0-100), `notes` (required text), `weakness_area` (required iff score < 80, forbidden otherwise).
- **Evaluator**: a `users` row with `role='teacher'` whose `teacher` row has `is_approved=true AND is_evaluator=true`. No sheikh/evaluator role exists (`UserRole` = Admin/Teacher/Student/Parent only, `backend/enum/users/user-role.enum.ts:5-10`).
- **Evaluation cycle**: the applicant's ACTIVE verification-plan subscription window (`resolveCurrentEvaluationCycle`, `backend/db/repo/classes/session.repository.evaluation.helpers.ts:138`) — the scoping boundary DEV2-006 shipped.
- **Scored submission**: a rubric submission with a non-NULL `score`. NULL/absent scores are NOT aggregable (REQ-5).
- **Aggregation quorum**: 5 distinct scored submissions, linked to 5 DISTINCT completed `teacher_evaluation` sessions of the applicant's current cycle, each owned by a distinct certified evaluator.
- **Threshold (per-evaluation minimum)**: PASS iff EVERY one of the 5 scores is ≥ 80. This is NOT a mean — "≥80% threshold" per B.1 is per evaluation session (`docs/specs/open-decisions-and-gaps.md:75-79`). Boundary: 80 passes, 79 fails.
- **Primary failure area**: on FAIL, the `weakness_area` of the single lowest-scoring failing evaluation; ties broken by earliest `created_at`. Deterministic, derived — never client-chosen.
- **Cooldown write**: `applicants.cooldown_until = now + TAJWEED_COOLDOWN_DAYS (30) | HIFZ_COOLDOWN_DAYS (90)`. This ticket writes ONLY `status` + `cooldown_until` on the applicants row.
- **Finalization**: the single-transaction PASS or FAIL outcome write (teacher row + `finalizeOnCertification`, or guarded failed+cooldown write) plus the post-commit applicant notification.

---

## 4. Verified Ground-Truth Inventory (grepped/viewed 2026-09-21)

Every EXISTING claim below was verified directly against the working tree (branch `plans`). Labels: EXISTING (use as-is) · UPDATE (touched by this plan) · CREATE (new artifact) · ABSENT (proven absent).

| # | Artifact | Verdict | Evidence (verified) |
|---|----------|---------|---------------------|
| G1 | `evaluations` table: identity PK; `evaluated_id NOT NULL → users.id cascade`; `evaluator_id NOT NULL → users.id restrict`; `session_id` nullable FK set-null; `score integer nullable` with `evaluations_score_check` 0..100; `notes text`; soft-delete pair; `unique("evaluations_session_evaluator_unique").on(sessionId, evaluatorId)` | UPDATE (one added column: nullable `weakness_area`; see G8) | `backend/db/schema/teachers/evaluations.ts:34-62` |
| G2 | `evaluations` doc header documents applicant evaluations as "`session_id = NULL` (standalone, not tied to a session)" — stale vs the shipped session-linked loop | UPDATE (doc corrected: rubric submissions are session-linked; the `(session_id, evaluator_id)` unique index is the write-once arbiter) | `backend/db/schema/teachers/evaluations.ts:9-13` |
| G3 | `applicants` table: shared PK → users.id cascade; `verification_attempts`; `last_attempt_at`; `cooldown_until` nullable (NO writer today); `status varchar(50)` default 'pending' (no pgEnum, service-enforced) | UPDATE (this plan adds the `failed`+`cooldown_until` guarded write) | `backend/db/schema/teachers/applicants.ts:14-31` |
| G4 | `teacher` table: shared PK → users.id cascade; `is_approved` default false; `is_evaluator` default false; `average_rating` 0..5 check | EXISTING (PASS target of this plan's insert) | `backend/db/schema/teachers/teacher.ts:19-38` |
| G5 | `ApplicantStatus` enum `{Pending, InEvaluation, Failed, Passed}` + `isApplicantStatus` fail-closed guard — `'passed'`/`'failed'` vocabulary already exists | EXISTING | `backend/enum/teachers/applicant-status.enum.ts:12-27` |
| G6 | `session` table: `student_id NOT NULL → users.id restrict` (bare-user link, no `students` child needed); `status` incl. `'completed'`; `session_type` default `'student_session'`; `intent` nullable incl. `'evaluation'` | EXISTING (read for the quorum check; untouched) | `backend/db/schema/classes/session.ts:53-92`; pgEnums `backend/db/schema/enums.ts:40,42` |
| G7 | TS enums `SessionType.TeacherEvaluation="teacher_evaluation"`, `SessionIntent.Evaluation="evaluation"` + Pothos registrations | EXISTING (value imports for the gate/quorum predicates) | `backend/enum/scheduling/session-type.enum.ts:8`; `backend/enum/scheduling/session-intent.enum.ts:9` |
| G8 | Weakness/failure-area enum: NOTHING exists — no pgEnum, no TS mirror, no column on any table. `session_intent` has `hifz`/`tajweed` but is a session classification, NOT a failure-area vocabulary — reuse would conflate semantics | CREATE (pgEnum `["tajweed","hifz"]` in `backend/db/schema/enums.ts` + TS mirror + guard + `.enum.test.ts` in `backend/enum/teachers/`; nullable `weakness_area` column on `evaluations`) | verified absent: `backend/db/schema/enums.ts` (no weakness pgEnum); `backend/enum/` (no weakness file) |
| G9 | Cooldown-duration and threshold constants: `shared/constants/` contains NO cooldown/threshold constants (verified listing); only `VERIFICATION_PLAN_TITLE`/`VERIFICATION_PLAN_SESSION_COUNT=5` in the verification-plan file | CREATE (new `shared/constants/evaluation-rubric.constants.ts`: `RUBRIC_PASS_THRESHOLD=80`, `TAJWEED_COOLDOWN_DAYS=30`, `HIFZ_COOLDOWN_DAYS=90`) | `shared/constants/` listing; `shared/constants/verification-plan.constants.ts:18,21` |
| G10 | `TeacherRepository.insertColdStartCertified(id, makeEvaluator, tx)` — the ONLY teacher-row INSERT (inserts `isApproved:true`); `elevateToCertified` — guarded UPDATE `is_approved` false→true | EXISTING (shape reused by the PASS path: insert with `isEvaluator=false`, or elevate on defense-in-depth existing row) | `backend/db/repo/teachers/teacher.repository.ts:286,319` |
| G11 | `ApplicantRepository.finalizeOnCertification(userId, tx?) → boolean` — single guarded UPDATE `status='passed'`, `cooldown_until=NULL`; today called only from admin cold-start | EXISTING (reused as the final applicants write on PASS) | `backend/db/repo/teachers/applicant.repository.ts:459` |
| G12 | `ApplicantRepository.transitionToInEvaluation` — guarded single UPDATE with pre-state folded into WHERE (`pending|failed → in_evaluation`) | EXISTING (pattern template for the new guarded failed+cooldown write) | `backend/db/repo/teachers/applicant.repository.ts:407` |
| G13 | `status='failed'` + `cooldown_until` write path: NOTHING writes either today (`cooldownUntil` has zero writers; `finalizeOnCertification` and `transitionToInEvaluation` are the only status transitions) | CREATE (new guarded repo method on `ApplicantRepository`, e.g. `transitionToFailed(userId, cooldownUntil, tx)`, WHERE-folded `status='in_evaluation'`) | verified absent: `backend/db/repo/teachers/applicant.repository.ts:407,459` (only transitions) |
| G14 | `EvaluationRepository.insertOnce(insert, tx)` — the one evaluation INSERT; its insert Pick excludes `notes` (student-rating shape) | UPDATE (widen the Pick; route rubric submissions through it) | `backend/db/repo/teachers/evaluation.repository.ts:89-98` |
| G15 | `EvaluationRepository.aggregateLiveRatings` — student star-rating live mean; NOT the rubric aggregation | EXISTING (left untouched; the rubric aggregation is a new service-side read, not this method) | `backend/db/repo/teachers/evaluation.repository.ts:171` |
| G16 | `EvaluationReturnType = Omit<EvaluationSelectType,"isDeleted"\|"deletedAt"\|"notes"\|"updatedAt">`; `EvaluationSubmitInput = { rating: number }` (student-only) | UPDATE (new `RubricEvaluationSubmitInput` + rubric-facing return shape in `backend/types/teachers/`; NO local types in Pothos files) | `backend/types/teachers/evaluation.types.ts:14,32` |
| G17 | `EvaluationSessionContract`: `sessionType: TeacherEvaluation\|ReEvaluation`, `intent=Evaluation`, evaluated/evaluator ids FK `users.id`, `completedEvaluatorIds`, idempotencyKey | EXISTING (composed input to the aggregation read) | `backend/types/contracts/evaluation-session.contract.types.ts:12-27` |
| G18 | Cycle read helpers: `resolveCurrentEvaluationCycle`, `countEvaluationBookingsInCycle`, `listEvaluationSessionsForApplicant` | EXISTING (composed by the aggregation engine to scope the quorum to the current cycle) | `backend/db/repo/classes/session.repository.evaluation.helpers.ts:138,180,225` |
| # | Artifact | Verdict | Evidence (verified) |
|---|----------|---------|---------------------|
| G19 | `EvaluationBookingService` (`bookEvaluation :104`, `myEvaluationLoopStatus :161`, `availableEvaluators :212`, `myEvaluationSessions :308`) — the shipped loop | EXISTING (upstream substrate; unmodified — the rubric flow consumes its rows) | `backend/services/teachers/evaluation-booking.service.ts:104,161,212,308` |
| G20 | `NotificationEngine.emitForUser(input, locale, tx?, options?)` — insert rides the caller's tx, returns UNPUBLISHED receipt; `publishReceipts(receipts, locale, options?)` for strictly-post-commit publish | EXISTING (used for both PASS and FAIL notifications) | `backend/services/notifications/notification-engine.service.ts:42,116` |
| G21 | `NotificationType.EvaluationResult="evaluation_result"` ALREADY exists with localized type labels — NO new notification enum value is needed | EXISTING (reused verbatim) | `backend/enum/notifications/notification-type.enum.ts:13-18`; `shared/locale/en/notifications/index.ts:20`; `shared/locale/types/notifications/index.ts:59` |
| G22 | Cold-start precedent: `EvaluationResult` emitted via `emitForUser(..., tx)` inside the tx, `publishReceipts` strictly after commit | EXISTING (pattern template for REQ-9) | `backend/services/admin/cold-start-certification.service.ts:216-237` |
| G23 | `errors` namespace already carries rubric-adjacent keys: `evaluationAlreadySubmitted`, `evaluationSessionNotCompleted`, `applicantNotInEvaluation`, `evaluationLoopComplete`, `noEvaluationCreditsRemaining`, `evaluatorAlreadyUsed`, `applicantAlreadyCertified` | UPDATE (add the new rubric codes of REQ-10; extend the errors parity test in the same task) | `shared/locale/types/errors/labels.ts:298,300,304-312` |
| G24 | Bijective machine-code ↔ i18n-key error contract (SCREAMING_SNAKE code ↔ camelCase key), documented domain-error transport | EXISTING (binding convention for REQ-10) | `docs/graphql/domain-error-extensions-code.md`; `docs/teachers/applicant-lifecycle.md:162` (§8 Error Contract) |
| G25 | Lifecycle consumer-guidance table pre-assigns the `in_evaluation → passed \| failed` writes and the `teacher` row on `passed` to this flow | EXISTING (normative handoff; this plan fulfills it) | `docs/teachers/applicant-lifecycle.md:19,120` |
| G26 | Cooldown read side: `assertCanPurchaseVerification` denies `APPLICANT_COOLDOWN_ACTIVE` reading `cooldown_until` STRICTLY against a captured now; header pins "cooldown durations belong to the write side" | EXISTING (the read side this plan's FAIL write feeds; duration-agnostic by design) | `backend/services/teachers/applicant-lifecycle.service.ts:27-30,185-190,202` |
| G27 | `users` governance columns `suspended`, `suspended_at`, `suspended_period_days` exist but are written by NOBODY today | EXISTING but NOT this ticket (deferred to the Cooldown State Machine ticket — ledger D1) | `backend/db/schema/users/users.ts:32-34` |
| G28 | Applicant result UX already exists: `ApplicantStatusResolution` renders `InEvaluation` (:85-98), `Failed`/`CooldownZone`+`EligibleZone` (:99-144), `Passed`/`CertifiedNarrative` (:145-153), driven by `myApplicantProfile` | EXISTING (the status flip lights existing branches — zero new applicant UI) | `frontend/views/teachers/dashboard/ApplicantStatusResolution.tsx:85-153` |
| G29 | Evaluator session surface: `teacherActionsForSession(session, wiring)` row actions per status (scheduled→start, started→complete, completed→report); NO "submit evaluation" action exists | UPDATE (add a submit-evaluation action for completed `teacher_evaluation` rows lacking a submission) | `frontend/views/teacher/sessions/teacherSessionCacheArms.ts:132-165` |
| G30 | `/teacher/sessions` page + `myTeacherSessions` document (carries `sessionType` + `intent`) render evaluator rows | EXISTING (host surface for the rubric dialog — no routing change) | `app/(dashboard)/teacher/sessions/page.tsx`; `frontend/graphql/sharedDocuments/scheduling/session-reads.documents.ts:117-127` |
| G31 | Teacher nav set: dashboard, notifications, sessions, schedule, wallet, profile — no evaluation entries; project has NO bottom nav | UNCHANGED (zero nav items added) | `frontend/views/dashboard/nav/navItems.ts:141-148` |
| G32 | `UserRole` enum = Admin/Teacher/Student/Parent exactly — no sheikh/evaluator role | EXISTING (constraint: evaluator is a Teacher-role user with `teacher.is_evaluator=true`; do NOT invent a role) | `backend/enum/users/user-role.enum.ts:5-10` |
| G33 | Permission model is role-based ONLY: page `withPageAuth({roles})`, Pothos `authScopes: { $all: { authenticated: true, role: [...] } }`, service-level state gates — NO permission-string tables exist | EXISTING (constraint: invent no permission strings) | `backend/graphql/mutation/classes/student-evaluation.mutation.ts:54-70`; `frontend/lib/auth/withPageAuth.ts` |
| G34 | Applicants NEVER own a `students` row: registration role `'teacher'` provisions ONLY `users`+`applicants` | EXISTING (must not regress; failed→student conversion is DEV2-009's whole ticket) | `backend/services/shared/user-provisioning.helpers.ts:86-100` |
| G35 | Journey harness `createJourneyFixtures(prefix)` (applicant + certifiedTeacher fixtures), committed fixtures + tracked teardown + mandatory residue probes; `runInRollback` FORBIDDEN in this layer | EXISTING (reused; add an evaluator-variant helper) | `test/workflows/helpers/journey-actor-fixtures.ts:141`; `test/workflows/AGENTS.md` (hard rules 1-2) |
| G36 | Cooldown State Machine ticket ACs claim the SAME fail path plus `users.suspended*=…` writes — overlap resolved by ledger D1 (this plan = applicants-row writes only) | ABSENT upstream (boundary condition, not a source) | `docs/planning/TICKETS.md:818-871` |
| G37 | DEV2-009 owns failed→student conversion semantics (handshake code, zeroed balances) — BLOCKED two tickets downstream | ABSENT upstream (boundary condition; ticket-graph rationale for D2) | `docs/planning/TICKETS.md:872-915` |
| G38 | GraphQL mutation convention: flat root file, no named exports, `gqlSchemaBuilder.mutationField(...)`, resolver delegates to service with `ctx.user.id`/`ctx.locale`/`ctx.idempotencyKey` | EXISTING (template for the rubric mutation) | `backend/graphql/mutation/evaluation-booking.mutation.ts:55`; `backend/graphql/AGENTS.md:14` |

---

## 5. Requirements (EARS)

IDs are stable for the traceability matrix (`tasks.md` references them verbatim). REQ-0 and REQ-0.5 are the standard process/standards requirements; functional requirements run REQ-1..REQ-15 contiguously. Every AC is testable against the real service surface; deny-path codes are named in brackets `[CODE]`.

### REQ-0 — Pre-Implementation Baseline & Execution Protocol (process)

**User Story:** As an executing agent, I need a recorded baseline, a deferred-items ledger, and an outcome knowledge base, so that regressions are provable and research is never repeated.

1. WHEN implementation begins THE agent SHALL record baseline counts (`bun tsgo` errors, `bun biome:check` warnings, `bun run scripts/lint-service.ts --json --id baseline` lint JSON) into `outcome/0-baseline-outcome.md` and the returned counts SHALL be pre-existing, not new.
2. WHEN any task starts THEN the executing agent SHALL read every file in `outcome/` (at `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/outcome/`) before acting.
3. WHEN any task completes THEN the executing agent SHALL write `outcome/<task-id>-outcome.md` AND flip the `tasks.md` checkbox.
4. WHEN a file is modified THEN the executing agent SHALL run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` and SHALL continue only on exit code 0.
5. WHEN work is deferred THEN an entry SHALL be created in `deferred-items.md` BEFORE the task is marked complete.

### REQ-0.5 — i18n & Enum Import Compliance (process)

**User Story:** As the platform, I need all user-facing strings to flow through the compile-time locale system and all enums to be value imports, so AR/EN parity and runtime type-safety are guaranteed.

1. WHEN any user-facing copy is rendered THEN the code SHALL use property access over the locale handle (client: `useAppTranslation(Namespace)`; server: `getTranslations(locale)` single-arg / service-layer `getServerTranslations(locale)`; resolvers: `ctx.t("errorsTranslations")`) — NEVER string literals, NEVER two-arg `getTranslations`, NEVER a `Translation` enum (does not exist), NEVER `next-intl`.
2. WHEN an enum is referenced in a runtime expression (comparison, switch, literal set) THEN the import SHALL be a value import (`import { SessionType } …`, `import { RubricWeaknessArea } …`), never `import type`.
3. WHEN new error/notification/dialog keys are added THEN the touched namespaces (`errors`, `applicant`, `sessions`) SHALL gain type leaf + en leaf + ar leaf and the corresponding `*-namespace.parity.test.ts` SHALL be extended in the same task.

### REQ-1 — Rubric submission input contract & validation

**User Story:** As a certified evaluator, I want a typed submission contract (score, notes, weakness when failing), so my verdict is recorded exactly once per evaluation session with validation enforced before any DB work.

1. WHEN an evaluator submits a rubric evaluation THEN the input SHALL carry `sessionId` plus `{ score, notes, weaknessArea? }` where `score` is a REQUIRED integer in [0,100], `notes` is a REQUIRED trimmed-non-empty string (bounded length, ≤ 2000 chars — "qualitative observations" per the ticket), and `weaknessArea` is `RubricWeaknessArea.Tajweed | RubricWeaknessArea.Hifz | null`.
2. WHEN `score` is not an integer in [0,100] THEN the system SHALL reject with `ValidationError` `[RUBRIC_SCORE_INVALID]` pre-DB, without ANY reads.
3. WHEN `notes` is missing, empty after trim, or over the length bound THEN the system SHALL reject with `ValidationError` `[RUBRIC_NOTES_REQUIRED]` pre-DB.
4. WHEN `score < 80` AND `weaknessArea` is absent THEN the system SHALL reject with `ValidationError` `[RUBRIC_WEAKNESS_REQUIRED]` pre-DB (a failing submission MUST record its weakness).
5. WHEN `score >= 80` AND `weaknessArea` is present THEN the system SHALL reject with `ValidationError` `[RUBRIC_WEAKNESS_NOT_ALLOWED]` pre-DB (a passing submission MUST NOT record a weakness).
6. WHEN `weaknessArea` is present but not a valid `RubricWeaknessArea` member THEN the system SHALL reject with `ValidationError` `[RUBRIC_WEAKNESS_INVALID]` (fail-closed guard) pre-DB.
7. THE per-evaluation pass/fail verdict SHALL be DERIVED server-side (`score >= RUBRIC_PASS_THRESHOLD`); the client SHALL NOT submit a pass/fail flag and NO pass/fail column is added (B.1 resolves the threshold to the score itself).

### REQ-2 — Evaluator identity & session-ownership gate

**User Story:** As the platform, I want only the assigned certified evaluator of a completed teacher_evaluation session to score it, so verdicts are attributable and independent.

1. WHEN a rubric submission arrives THEN the caller SHALL be a `UserRole.Teacher` user whose `teacher` row satisfies `is_approved=true AND is_evaluator=true`; otherwise the system SHALL reject with `ConflictError` `[TEACHER_NOT_CERTIFIED]`.
2. WHEN the target session does not exist, is not `session_type='teacher_evaluation'` with `intent='evaluation'`, or is not owned by the caller (`session.teacherId` ≠ caller's teacher row) THEN the system SHALL reject — an unknown, foreign, or untyped session SHALL be indistinguishable from `NotFoundError` `[SESSION_NOT_FOUND]` (no information leak).
3. WHEN the session is owned but not yet `status='completed'` THEN the system SHALL reject with `ConflictError` `[RUBRIC_SESSION_NOT_COMPLETED]`.
4. WHEN the evaluated subject (`session.studentId`) has no `applicants` row in status `in_evaluation` THEN the system SHALL reject with `ConflictError` `[APPLICANT_NOT_IN_EVALUATION]` (existing key) — the evaluated applicant MUST equal `session.studentId`; it is never client-supplied.
5. WHEN the caller is a student, parent, admin, or an anonymous request THEN the GraphQL scope SHALL deny: anonymous → `UNAUTHORIZED`; authenticated non-teacher → `FORBIDDEN` via the `$all: { authenticated: true, role: [UserRole.Teacher] }` conjunction.
6. WHEN an evaluator is governance-flagged (deleted/blocked/suspended) THEN the submission SHALL be rejected by the same actor-governance posture as other writes.

### REQ-3 — Session linkage & write-once submission

**User Story:** As the platform, I want every rubric submission linked to its booked session and recorded exactly once, so the 5-verdict quorum is structurally un-forgeable.

1. WHEN a submission passes REQ-1/REQ-2 THEN the system SHALL insert ONE `evaluations` row with `session_id = <the completed session>` (NOT NULL for rubric rows), `evaluated_id = session.studentId`, `evaluator_id = <caller user id>` (C.3: both legs FK `users.id`, NEVER `teacher.id`), the validated `score`, `notes`, and `weakness_area`.
2. WHEN a second submission targets a (session, evaluator) pair that already has a rubric row THEN the system SHALL reject with `ConflictError` `[EVALUATION_ALREADY_SUBMITTED]` (existing key) — enforced BOTH by the service pre-check inside the submission transaction AND by the existing `evaluations_session_evaluator_unique (session_id, evaluator_id)` index as the last-resort arbiter.
3. WHEN the unique index is hit by a concurrent race the service pre-check missed THEN the DB 23505 SHALL surface as the same `EVALUATION_ALREADY_SUBMITTED` typed error (zero extra rows).
4. WHEN the submission commits THEN a direct DB check SHALL show `session_id IS NOT NULL` on the new row — the stale "standalone `session_id = NULL`" doc claim (G2) is corrected in the same task.

### REQ-4 — Schema delta: weakness enum, column, and constants

**User Story:** As the platform, I need typed storage for the failure area and the threshold/cooldown numbers, so the verdict derivation is data-driven and compile-time checked.

1. THE system SHALL add a new pgEnum `rubric_weakness_area` with values `["tajweed","hifz"]` in `backend/db/schema/enums.ts`, mirrored by a TS enum `RubricWeaknessArea` (`Tajweed="tajweed"`, `Hifz="hifz"`) plus a fail-closed guard and a colocated `.enum.test.ts` under `backend/enum/teachers/` (the backend/enum convention, `applicant-status.enum.ts` style).
2. THE `evaluations` table SHALL gain a nullable `weakness_area rubric_weakness_area` column (nullable because the student-rating flow shares the table and never records one; the rubric service enforces the iff-threshold rule of REQ-1).
3. THE new constants SHALL live in `shared/constants/evaluation-rubric.constants.ts`: `RUBRIC_PASS_THRESHOLD = 80`, `TAJWEED_COOLDOWN_DAYS = 30`, `HIFZ_COOLDOWN_DAYS = 90` — none exist today (G9); the ticket's "1 month / 3 months" prose is pinned to the 30/90-day day-count form (the ticket's own parenthetical).
4. THE migration SHALL be a Drizzle schema push (`bun run db push`); after any enum/GraphQL exposure the plan SHALL run `bun run generate:gqlSchema` + `bun codegen`.
5. WHEN the delta lands THEN nothing else in the schema SHALL change — no new table, no pass/fail column, no applicants-column additions.

### REQ-5 — Aggregation engine: trigger, threshold semantics, boundary

**User Story:** As the platform, I want a deterministic aggregation that fires exactly when the 5th scored submission lands, so the verdict never races a background job or a session-completion side effect.

1. WHEN a rubric submission commits inside its transaction THEN the system SHALL, in the SAME transaction, count the applicant's current-cycle scored submissions linked to DISTINCT completed `teacher_evaluation` sessions; IF the count is < 5 THEN the transaction SHALL commit the submission alone and return it (no verdict writes).
2. WHEN the count reaches exactly 5 (5 distinct scored submissions ↔ 5 distinct completed sessions ↔ 5 distinct evaluators) THEN the system SHALL aggregate and finalize INSIDE the same transaction — NO background job, NO cron, NO session-completion trigger (a session can complete before its rubric is submitted; the 5th submission is the only deterministic trigger).
3. THE threshold SHALL be a per-evaluation minimum: PASS iff ALL 5 scores are `>= RUBRIC_PASS_THRESHOLD (80)`; FAIL iff ANY score is `< 80`. This is NOT an average — B.1 pins "score ≥ 80 out of 100 on each evaluation session" (`docs/specs/open-decisions-and-gaps.md:75-79`), matching the ticket's own AND-semantics and FR-3.5's "passing 3 and failing 2 results in automated fail" (`docs/specs/functional-requirements.md:106-110`).
4. THE boundary SHALL be exact: a score of 80 PASSES; a score of 79 FAILS (Tier-2 boundary tests, REQ-14).
5. WHEN any of the 5 cycle submissions has a NULL score or a submission is absent THEN it SHALL NOT be aggregable and the quorum SHALL NOT fire (a NULL score satisfies the check constraint vacuously — the rubric service never writes NULL, and only a 5-scored set finalizes).
6. WHEN aggregation runs THEN the applicant's `applicants` row SHALL be locked (`SELECT … FOR UPDATE`) from the REQ-2 status read onward, so the verdict commits against a frozen status.

### REQ-6 — Primary failure-area derivation & cooldown duration

**User Story:** As the platform, I want a deterministic primary failure area on FAIL, so the 30/90-day cooldown never depends on operator or client judgment.

1. WHEN the verdict is FAIL THEN the primary failure area SHALL be the `weakness_area` of the single LOWEST-scoring failing evaluation (score < 80).
2. WHEN two or more failing evaluations share the lowest score THEN the tie SHALL be broken by earliest `created_at` (the first-submitted one wins); the derivation SHALL be total (every failing evaluation carries a weakness by REQ-1).
3. WHEN the primary failure area is `tajweed` THEN the cooldown duration SHALL be `TAJWEED_COOLDOWN_DAYS (30)`; WHEN it is `hifz` THEN the duration SHALL be `HIFZ_COOLDOWN_DAYS (90)`.
4. WHEN the verdict is PASS THEN NO cooldown value SHALL be computed and NO weakness shall influence anything (passing submissions carry none by REQ-1).

### REQ-7 — PASS finalization (single transaction)

**User Story:** As an applicant who passed all 5 evaluations, I want my teacher record created and my status finalized atomically, so I gain full teaching permissions with zero partial states.

1. WHEN the verdict is PASS THEN the SAME transaction SHALL (a) create the applicant's `teacher` row with shared PK = `users.id`, `is_approved=true`, `is_evaluator=false` — reusing the insert shape of `TeacherRepository.insertColdStartCertified` (`backend/db/repo/teachers/teacher.repository.ts:286`) with `isEvaluator=false` (B.7: the teacher record is created only after passing verification); (b) if a `teacher` row already exists (defense-in-depth), elevate it via `elevateToCertified` (`backend/db/repo/teachers/teacher.repository.ts:319`); (c) finalize the applicant via `ApplicantRepository.finalizeOnCertification` (`backend/db/repo/teachers/applicant.repository.ts:459`) which sets `status='passed'` and clears `cooldown_until`.
2. WHEN the PASS transaction commits THEN the applicant "gains full teaching permissions" in the platform's real model: `teacher.is_approved=true` is the teaching gate (no permission-string tables exist — G33); NO `users.role` flip occurs in this ticket.
3. WHEN any write in the PASS chain fails THEN the whole transaction SHALL roll back — no teacher row without a finalized applicant, and vice versa.

### REQ-8 — FAIL finalization & cooldown write (single transaction)

**User Story:** As an applicant who failed, I want my status flipped and my cooldown stamped atomically, so the existing re-application guard takes effect immediately and exactly once.

1. WHEN the verdict is FAIL THEN the SAME transaction SHALL perform ONE guarded UPDATE on `applicants` setting `status='failed'` AND `cooldown_until = <transaction-captured now> + 30/90 days (REQ-6)` with the precondition `status='in_evaluation'` folded into the WHERE — a new `ApplicantRepository` method modeled on `transitionToInEvaluation` (`backend/db/repo/teachers/applicant.repository.ts:407`).
2. WHEN the guarded FAIL write matches 0 rows (status already `passed`/`failed`/`pending` — a concurrent finalization won) THEN the submission SHALL surface `ConflictError` `[APPLICANT_ALREADY_FINALIZED]` and the whole transaction SHALL roll back (exactly one verdict ever commits).
3. THE FAIL path SHALL write ONLY `applicants.status` and `applicants.cooldown_until` — NO `users.suspended`/`suspended_at`/`suspended_period_days` writes (those belong to the Cooldown State Machine ticket — ledger D1) and NO `users.role` flip (stated explicitly: none in this ticket).
4. WHEN the FAIL write commits THEN the existing strict-boundary read side (`assertCanPurchaseVerification`, `cooldownUntil > capturedNow` — G26) SHALL honor the stored instant verbatim; the writer performs no additional duration enforcement.
5. THE "students record is created for the failed applicant" ticket AC SHALL be DEFERRED to DEV2-009 "Failed Applicant → Student Record Conversion" (`docs/planning/TICKETS.md:872-915`) — that ticket owns the whole conversion semantics (handshake code, zeroed balance lanes) and DEV2-006's G18 already recorded the same deferral; doing it here would pre-empt DEV2-009's acceptance criteria (ledger D2).

### REQ-9 — Applicant notifications on PASS and FAIL

**User Story:** As the applicant, I want to be notified of my evaluation outcome, so I learn the verdict without polling my dashboard.

1. WHEN the finalization transaction runs (PASS or FAIL) THEN the system SHALL emit ONE notification to the applicant via `NotificationEngine.emitForUser` ON THE OWNING TRANSACTION with the EXISTING `NotificationType.EvaluationResult` type (no new enum value — G21), `relatedEntityType` per the cold-start precedent, and localized title/body copy from the `applicant` namespace (new keys: pass title/body, fail title/body, the fail body interpolating the cooldown expiry).
2. WHEN the finalization transaction commits THEN the system SHALL call `NotificationEngine.publishReceipts` STRICTLY post-commit (the G22 discipline); a publish failure SHALL NOT roll back or retry the verdict (NFR-R1).
3. WHEN the finalization rolls back THEN the receipt SHALL remain unpublished and zero notification rows SHALL remain (the engine's in-tx insert rides the rollback).

### REQ-10 — Error-code / i18n-key contract

**User Story:** As the frontend, I want every rubric denial to arrive as a typed machine code with a bijective localized key, so toasts and tests can match deterministically.

1. THE new codes SHALL be SCREAMING_SNAKE_CASE `extensions.code` values, each with a bijective camelCase key in the `errors` namespace (type leaf + en + ar + parity-test extension, per `docs/graphql/domain-error-extensions-code.md` and `docs/teachers/applicant-lifecycle.md:162` §8): `RUBRIC_SCORE_INVALID → rubricScoreInvalid` · `RUBRIC_NOTES_REQUIRED → rubricNotesRequired` · `RUBRIC_WEAKNESS_REQUIRED → rubricWeaknessRequired` · `RUBRIC_WEAKNESS_NOT_ALLOWED → rubricWeaknessNotAllowed` · `RUBRIC_WEAKNESS_INVALID → rubricWeaknessInvalid` · `RUBRIC_SESSION_NOT_COMPLETED → rubricSessionNotCompleted` · `APPLICANT_ALREADY_FINALIZED → applicantAlreadyFinalized`.
2. THE reused codes SHALL keep their existing keys: `SESSION_NOT_FOUND → sessionNotFound`, `TEACHER_NOT_CERTIFIED → teacherNotCertified`, `EVALUATION_ALREADY_SUBMITTED → evaluationAlreadySubmitted`, `APPLICANT_NOT_IN_EVALUATION → applicantNotInEvaluation` (all verified in `shared/locale/types/errors/labels.ts:298-312`).
3. WHEN any new key lands THEN the `errors`-namespace parity test SHALL be extended in the same task; the transport is GraphQL 200 + `errors[].extensions.code` (the ticket prose's "422" is code-level truth, never a REST status).

### REQ-11 — GraphQL contract (mutation + read surfaces)

**User Story:** As the evaluator's app, I want a typed mutation to submit a rubric evaluation and a read that tells me which of my completed evaluation sessions still await one, so the dialog only opens where it is valid.

1. THE system SHALL expose `submitRubricEvaluation(sessionId: ID!, input: RubricEvaluationSubmitInput!): Evaluation!` as a flat root mutation file under `backend/graphql/mutation/` (no named exports; `gqlSchemaBuilder.mutationField`), scoped `authScopes: { $all: { authenticated: true, role: [UserRole.Teacher] } }`, delegating to the service with `ctx.user.id`, `ctx.locale` (resolver i18n via `await ctx.t("errorsTranslations")` per `backend/graphql/AGENTS.md:14`).
2. THE input type SHALL live in `backend/types/teachers/evaluation.types.ts` (`RubricEvaluationSubmitInput` — `score`, `notes`, optional `weaknessArea`) and the Pothos input/object wrappers under `backend/graphql/pothos/teachers/` backed exclusively by canonical `@/backend/types` types (never local); `id` first on every object; the single canonical `Evaluation` object is extended, never duplicated.
3. THE system SHALL expose an evaluator-scoped read `myRubricPendingSessions(page?, pageSize?): SessionPage!` (final name pinned by plan.md) returning the caller's OWN completed `teacher_evaluation` sessions with NO rubric submission yet — scoped `authenticated` + `role: [UserRole.Teacher]`, service-gated to certified evaluators; it SHALL reuse the canonical `SessionPage` object.
4. THE system SHALL NOT expose cross-applicant introspection, admin rubric listings (the Admin Override ticket owns them — ledger D3), or any query that mutates; the applicant's verdict read is the EXISTING `myApplicantProfile` (status/cooldown fields already exposed) — no new applicant read surface is added.
5. THE frontend documents SHALL live in `frontend/graphql/sharedDocuments/teachers/` (`TypedDocumentNode`, `id` first, `{entity}QueryDocument`/`{verb}MutationDocument` naming), and `bun run generate:gqlSchema` + `bun codegen` SHALL run after the SDL changes.

### REQ-12 — Evaluator UI surface & i18n (no new routes, no new nav)

**User Story:** As the evaluator, I want a submit-evaluation action on my existing sessions rows, so I record my verdict without any new navigation.

1. WHEN an evaluator views `/teacher/sessions` THEN completed `teacher_evaluation` rows without a rubric submission SHALL offer a "submit evaluation" row action (added to the `teacherActionsForSession` wiring, G29) opening a dialog: score 0-100, notes, and a Tajweed/Hifz weakness selector rendered ONLY when the entered score is < 80 (client mirrors REQ-1's iff rule; the server remains the authority).
2. WHEN the dialog submits successfully THEN the frontend SHALL refetch the pending-sessions read (the row loses its action) and surface localized success copy; WHEN the typed denials of REQ-10 return THEN the frontend SHALL map each `extensions.code` to its localized toast.
3. WHEN render runs in `ar` THEN all new copy SHALL come from namespace leaves (evaluator rubric-dialog copy in the `sessions` namespace; applicant outcome-notification copy in the `applicant` namespace) with en+ar+types+parity extensions — never hardcoded strings.
4. THE UI SHALL add ZERO routes, ZERO nav items, ZERO bottom-nav (the project has none, G31); the applicant-side result UX is the EXISTING `ApplicantStatusResolution` Failed/Passed branches (G28), which light up on the status flip with no applicant-UI change in this ticket.
5. THE dialog SHALL follow the house dialog conventions (MUI v9 `Dialog`, `fullWidth`/`maxWidth="xs"`, `sx`-only, theme-palette callbacks, `*Outlined` icons — the `EvaluationBookingDialog`/`RateTeacherDialog` precedents) and gain a colocated Storybook story for visual QA (no UI E2E — Playwright is Paymob-only).

### REQ-13 — Journey test (first-class cross-actor flow)

**User Story:** As the QA surface, I want a real-DB journey that runs purchase → book×5 → complete×5 → submit×5 → verdict in one pass, so the invariant chain is exercised end to end.

1. WHEN `bun run test/scripts/run-test.ts test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts` runs THEN it SHALL succeed with zero residue (committed fixtures + tracked teardown + mandatory residue probes per `test/workflows/AGENTS.md`).
2. THE journey SHALL provision via `createJourneyFixtures(prefix)` (plus an evaluator-variant helper): an applicant cast, FIVE distinct certified evaluators, one non-evaluator certified teacher, and a verification plan row — real users, real role-child rows, honest authorization only.
3. THE PASS trajectory SHALL: activate the subscription (DEV2-005 fixture), book 5 evaluation sessions with 5 distinct evaluators (DEV2-006 service), start+complete each (existing session lifecycle), submit 5 rubric evaluations with all scores ≥ 80, and assert the 5th submission returns the finalization result: `teacher` row created with `is_approved=true AND is_evaluator=false`, `applicants.status='passed'`, `cooldown_until` NULL, and exactly one `evaluation_result` notification to the applicant.
4. THE FAIL trajectory SHALL: same shape, at least one score < 80 with its weakness recorded, and assert `applicants.status='failed'`, `cooldown_until ≈ now+30d` (tajweed) or `now+90d` (hifz), NO teacher row, NO `students` row, NO `users.suspended*` write, and the fail notification.
5. THE denial steps SHALL include: a non-assigned certified evaluator submitting on a foreign session (`SESSION_NOT_FOUND`), a student calling the mutation (FORBIDDEN via the role scope), a duplicate submission (`EVALUATION_ALREADY_SUBMITTED`), a submission on a non-completed session (`RUBRIC_SESSION_NOT_COMPLETED`), a score < 80 without weakness (`RUBRIC_WEAKNESS_REQUIRED`), and a score ≥ 80 with weakness (`RUBRIC_WEAKNESS_NOT_ALLOWED`).
6. THE journey SHALL NOT mock the DB, SHALL spy the notification dispatch boundary (asserting the target userId), and SHALL assert shared-state mutations per §6.

### REQ-14 — Test-tier coverage (incl. the 80/79 boundary as Tier-2)

**User Story:** As the platform, I want the four live test tiers to cover the rubric engine, so no tier gap hides a boundary bug.

1. Tier-1 (enum): the new `RubricWeaknessArea` enum + guard SHALL carry a colocated `.enum.test.ts` mirroring `applicant-status.enum.ts`'s test (value-for-value pgEnum parity, fail-closed guard probes).
2. Tier-2 (repo + service, via `bun run test:db` / `bun run test:services` wrapped in `bun run test/scripts/run-test.ts <path>`; DB tests use `runInRollback` + `expectRepoError`, never `rejects.toThrow`): repo tests SHALL cover the widened `insertOnce` (notes + weakness), the guarded FAIL write (match + 0-row guard), `finalizeOnCertification` reuse, and the teacher-row insert/elevate branches; service tests SHALL cover REQ-1 validation rejections pre-DB, REQ-5 quorum logic (a 4-submission no-op vs a 5th that fires), the BOUNDARY pair — a cycle of five 80s PASSES and a cycle with one 79 FAILS — and REQ-6 tie-breaking (two lowest scores equal → earliest `created_at` wins).
3. Tier-3 (GraphQL integration via `bun run test:graphql` + `testClient`): the mutation's scope behavior (anonymous → 401, non-teacher → 403) and typed-code surfacing SHALL be asserted at the transport level, mirroring `frontend/graphql/test/teachers/evaluation-booking.test.ts`.
4. Tier-4 (journey): REQ-13.
5. NO UI-component/E2E test layer SHALL be created (none exists; Playwright is reserved for the Paymob suite).

### REQ-15 — Idempotency & concurrency

**User Story:** As the platform owner, I want the write-once and exactly-once-finalization invariants to hold under concurrency, so no double verdict or double submission can ever commit.

1. WHEN two evaluators submit concurrently for DIFFERENT sessions of the same applicant THEN both SHALL commit; the quorum check SHALL serialize on the applicant-row lock (REQ-5.6) so exactly ONE of them observes count=5 and finalizes; the other SHALL commit its submission with no verdict writes.
2. WHEN the same evaluator double-submits the same session concurrently THEN the `evaluations_session_evaluator_unique` index (23505) SHALL collapse the race to one row and one `[EVALUATION_ALREADY_SUBMITTED]` (the service pre-check is an optimization; the index is the arbiter).
3. WHEN a finalization already committed (status `passed`/`failed`) and a late rubric submission arrives for another cycle session THEN the `in_evaluation` gates (REQ-2.4) and the guarded WHERE preconditions (REQ-7.1/REQ-8.1) SHALL reject with `[APPLICANT_NOT_IN_EVALUATION]` / `[APPLICANT_ALREADY_FINALIZED]` — zero partial writes.
4. WHEN the finalization transaction aborts at ANY point (submission insert, teacher insert, status write, notification emit) THEN the whole transaction SHALL roll back atomically — there is no committed state between the 5th submission and the verdict.

---

## 6. Cross-Actor Workflow Scenario (Journey definition)

This feature spans 2+ actors (applicant + 5 evaluators + system), so the full journey artifact is specified here and becomes the assertion set for the journey test REQ-13.

### Actor table

| Actor | Role in scoring | Can do | Cannot do |
|-------|-----------------|--------|-----------|
| Applicant (in_evaluation) | Subject of the verdict | Book sessions (DEV2-006 surface); observe status/cooldown via `myApplicantProfile`; receive the outcome notification | Submit or influence a rubric submission; see individual evaluator notes |
| Evaluator E1..E5 (certified teachers, is_evaluator=true) | Verdict providers | See their own completed evaluation sessions on `/teacher/sessions`; submit ONE rubric evaluation per assigned session (score, notes, weakness when failing) | Score another evaluator's session; score twice; score a non-completed session; supply the verdict flag |
| Student / Parent / non-evaluator teacher | Not involved | — | Call the rubric mutation (role scope); qualify as evaluator (is_evaluator gate) |
| System | Aggregator + finalizer | Finalize deterministically on the 5th scored submission (same transaction); derive the primary failure area; write the verdict + cooldown; notify the applicant | Flip `users.role`; write `users.suspended*` (Cooldown ticket); create `students` rows (DEV2-009) |

### Ordered steps (actor → action → shared-state change + side-effects)

1. Applicant purchases the verification plan and the subscription activates → `applicants.status='in_evaluation'` (DEV2-005; read-only precondition here).
2. Applicant books 5 evaluation sessions with 5 distinct certified evaluators E1..E5 → 5 `session` rows `session_type='teacher_evaluation'`, `intent='evaluation'` (DEV2-006 surface; read-only input here).
3. Each Evaluator Ei starts and completes their session via the EXISTING session lifecycle → 5 `session` rows `status='completed'`; NO evaluations rows exist yet (completion writes none).
4. Evaluator E1 opens the submit-evaluation dialog on her completed row and submits `{score:92, notes:"…"}` → one `evaluations` row (`session_id=S1`, `evaluator_id=E1`, `evaluated_id=applicant`, `weakness_area=NULL`); quorum count 1/5; no verdict writes.
5. E2, E3, E4 submit similarly (scores ≥ 80 for the PASS cast) → quorum 4/5; the applicant's dashboard still shows `in_evaluation`.
6. E5 submits the 5th scored submission → SAME transaction: quorum observed at 5, threshold evaluated (all ≥ 80) → PASS: `teacher` row created (`is_approved=true`, `is_evaluator=false`), `applicants.status='passed'`, `cooldown_until=NULL`, `evaluation_result` notification emitted on the tx.
7. Commit; then `publishReceipts` → the applicant observes the notification AND the `Passed`/`CertifiedNarrative` dashboard branch (existing UX, no code change).
8. Denial step: E1 attempts a second submission on S1 → `[EVALUATION_ALREADY_SUBMITTED]`; zero rows.
9. Denial step: certified non-assigned teacher E6 submits on S3 → `[SESSION_NOT_FOUND]` (indistinguishable from unknown); zero rows; E3 never learns of the attempt.
10. Denial step: a student calls `submitRubricEvaluation` → FORBIDDEN at the GraphQL role scope (never reaches the service).
11. FAIL trajectory (separate cast/scenario): one of the five submits `{score:65, weaknessArea:"tajweed"}`; the others ≥ 80; the 5th submission → FAIL: `applicants.status='failed'`, `cooldown_until = now+30d`, NO teacher row, NO students row, NO `users.suspended*` write; fail notification published post-commit; the existing `CooldownZone` branch renders on the dashboard.

### Cross-actor EARS criteria (observer-perspective)

1. WHEN E5's 5th scored submission commits THEN the applicant SHALL observe `status='passed'` via `myApplicantProfile` AND exactly one `evaluation_result` notification — with no further action by any evaluator.
2. WHEN the verdict is FAIL THEN the applicant SHALL observe `status='failed'` AND a `cooldown_until` exactly 30/90 days out per the primary weakness area, and the EXISTING `assertCanPurchaseVerification` guard SHALL immediately deny re-purchase with `APPLICANT_COOLDOWN_ACTIVE` (strict boundary: a cooldown expiring exactly NOW no longer blocks).
3. WHEN any evaluator Ei has NOT yet submitted THEN the evaluator SHALL still see her completed row in the pending-sessions read; WHEN she has submitted THEN the row SHALL disappear from that read (write-once visible both ways).
4. IF an unauthorized actor attempts any submission THEN the system SHALL reject with the typed code and zero rows, and the assigned evaluator learns nothing of the attempt.
5. WHEN finalization has committed THEN any further rubric submission for the applicant's cycle sessions SHALL be rejected — the verdict is terminal for the cycle (exactly one finalization per cycle, ever).

---

## 7. Non-Functional Requirements

### Performance
- NFR-P1: the 5th-submission transaction SHALL be the ONLY finalization path — one transaction round-trip chain (submission insert + quorum read + verdict writes + notification emit); no polling job, no scheduler, no extra passes.
- NFR-P2: the pending-sessions read SHALL stay index-backed (`evaluations_session_evaluator_unique` + the existing session indexes; no new index is required by this plan).
- NFR-P3: the aggregation read SHALL be bounded by the cycle window (≤ 5 submissions per applicant by construction) — no unbounded scans.

### Reliability / Failure modes
- NFR-R1: a post-commit `publishReceipts` failure SHALL NOT roll back or retry the verdict — finalization integrity precedes notification delivery (the engine isolates and logs).
- NFR-R2: a crash at any point mid-transaction SHALL leave ZERO partial state (atomic chain per REQ-15.4) — no `evaluations` row without its session link, no teacher row without a finalized applicant.
- NFR-R3: if the applicant row vanishes mid-transaction, the locked read returns null and the submission fails `[APPLICANT_NOT_IN_EVALUATION]` inside the same transaction (TOCTOU closed).

### Security / Privacy
- NFR-S1: evaluator identity, evaluated subject, and session linkage are ALL resolved server-side from `ctx.user.id` + the session row — the client submits only `sessionId` + score/notes/weakness (BOPLA minimal input).
- NFR-S2: `notes` is free text and SHALL NEVER be logged; rejections use `logger.logDomainError` with code + entity/entityId only; no request bodies or scores in logs.
- NFR-S3: an unknown, foreign, or untyped session SHALL be indistinguishable from `SESSION_NOT_FOUND` to the caller (no existence oracle).

### Operability
- NFR-O1: `bun run db push` SHALL be required in all environments after merge (one enum + one nullable column; no data migration, no index changes).
- NFR-O2: `bun run generate:gqlSchema` + `bun codegen` SHALL be re-run after the SDL changes; no new package.json env keys, no new dependencies.
- NFR-O3: journey/DB/service tests SHALL provision their own fixtures (no seeded-DB dependence); the applicant-dashboard UX needs zero component tests (G28 behavior is already covered by existing suites).

---

## 8. Constraints, Assumptions & Dependencies

### Constraints
- C1. NO new table: the rubric lives on the existing `evaluations` table (dual-purpose with the student rating flow); the only schema delta is the weakness enum + nullable column (REQ-4).
- C2. The evaluator is a `UserRole.Teacher` user with `teacher.is_approved=true AND is_evaluator=true` — there is NO sheikh/evaluator role and none may be invented (G32).
- C3. Permission model is role-based ONLY (page `withPageAuth` roles, Pothos `$all` role scopes, service-level state gates). NO permission-string tables exist; the ticket's "full teaching permissions" is realized as `teacher.is_approved=true` (G33).
- C4. NO `users.role` flip in this ticket — passed applicants keep `role='teacher'`; failed applicants keep `role='teacher'` too (the role question belongs to DEV2-009's conversion semantics).
- C5. The ticket's "a students record is created for the failed applicant" is DEFERRED to DEV2-009 (`docs/planning/TICKETS.md:872-915`): that ticket owns conversion semantics including the NOT-NULL unique `handshakeCode` and the zeroed balance lanes; DEV2-006's G18 set the deferral precedent. This plan writes neither.
- C6. `users.suspended`/`suspended_at`/`suspended_period_days` writes are DEFERRED to the Cooldown State Machine ticket (`docs/planning/TICKETS.md:818-871`), which is Blocked By THIS ticket — this plan delivers only `applicants.status='failed'` + `cooldown_until` (the guard reads only `cooldown_until`, G26).
- C7. Teacher `average_rating` semantics and the student→teacher rating flow (`StudentEvaluationService`) are OUT OF SCOPE and untouched; admin override / re-evaluation flows are other tickets (`docs/planning/TICKETS.md:916-948`; the M3 re-evaluation ticket).
- C8. No GraphQL resolvers, services, repositories, or views are touched outside the files this plan's tasks enumerate.
- C9. The rubric submission carries no idempotency-key claim machinery: write-once is structurally enforced by `evaluations_session_evaluator_unique` (REQ-3/REQ-15) — an idempotency claim table would be redundant.

### Assumptions
- A1. Every rubric submission supplies a non-NULL score (the rubric service is the only writer of rubric rows and REQ-1 makes score required); NULL scores therefore only ever exist via the student-rating flow, which is out of scope.
- A2. A cycle's sessions are only ever completed by their booked evaluator (the session lifecycle guarantees `teacherId` ownership), so the (session, evaluator) pair uniquely identifies a verdict slot.
- A3. Applicants cannot reach `in_evaluation` without an ACTIVE verification subscription (DEV2-005/006 gates), so the cycle window used by the quorum read is always resolvable.
- A4. Cooldown months are pinned to day counts (30/90) per the ticket's parenthetical — calendar-month arithmetic is deliberately NOT used.
- A5. The existing applicant dashboard copy (`statusFailed`, `cooldownExpiryLine` with its `{cooldownUntil}` interpolation, `certifiedSummary`) renders the new states without copy changes; only the applicant-notification outcome copy is new.

### Dependencies
- D-UP-1: DEV2-006 5-Session Evaluation Loop Booking (FINISHED) — provides the session rows, cycle window helpers, certification gate, and the journey harness precedent.
- D-UP-2: DEV2-005 Verification Plan Purchase (FINISHED) — the activation that flips `in_evaluation`; read-only here.
- D-UP-3: Session lifecycle (FINISHED) — `completeSession` etc. reused unmodified; completion itself writes no `evaluations` row (REQ-5.2 makes the 5th submission the only trigger).
- D-DN-1: Cooldown State Machine (`docs/planning/TICKETS.md:818-871`) — consumes `status='failed'` + `cooldown_until`; owns `users.suspended*` (ledger D1).
- D-DN-2: DEV2-009 Failed Applicant → Student Record Conversion (`docs/planning/TICKETS.md:872-915`) — consumes the failed state; owns the students row (ledger D2).
- D-DN-3: Admin Override of Evaluation Results (`docs/planning/TICKETS.md:916-948`) — will consume rubric visibility; this plan exposes no admin read (ledger D3).

---

## 9. UX / Navigation Requirements (MANDATORY)

**Explicit no-new-route / no-new-nav ruling:** zero new routes, zero new nav items, zero bottom-nav (the project has none). The evaluator submission surface attaches to the EXISTING `/teacher/sessions` row actions; the applicant-side result UX is the EXISTING `ApplicantStatusResolution` branches (G28), which render on the status flip with no applicant-UI work in this ticket.

### New routes & access

None added. No new `app/(dashboard)/...` page.

### Route & Role-Based Access Matrix (existing surfaces carry the new capability)

| Route | Purpose | Existing Role Gate | Added capability in this plan |
|-------|---------|--------------------|-------------------------------|
| `/teacher/sessions` | Teacher sessions view | `withPageAuth` roles `[UserRole.Teacher]` (existing) | Completed `teacher_evaluation` rows without a submission gain a "submit evaluation" action + dialog (REQ-12) |
| `/teacher/dashboard` | Teacher landing (applicant status card) | `{ roles: [UserRole.Teacher] }` (existing) | NOTHING — the Failed/CooldownZone and Passed/CertifiedNarrative branches light up via the existing `myApplicantProfile` |
| `/student/*`, `/parent/*`, `/(dashboard)/admin/*` | Other audiences | unchanged | untouched (admin rubric visibility is the Admin Override ticket, ledger D3) |

### Sidebar Navigation Integration

- **No new entry.** The teacher nav set stays exactly as today (`frontend/views/dashboard/nav/navItems.ts:141-148`); no `NavLabelKey` additions, no `navItems.test.ts` churn.
- **No bottom navigation**: the project has none (the Drawer covers mobile; unchanged from the DEV2-005/006 rulings).

### Real permission model (no invented permission strings)

| Layer | Mechanism (real, verified) | Applied to |
|-------|---------------------------|------------|
| Page guard (SSR) | `withPageAuth({ roles: [UserRole.Teacher] })` — `frontend/lib/auth/withPageAuth.ts` | `/teacher/sessions` (already guarded; no change) |
| GraphQL scope | `authScopes: { $all: { authenticated: true, role: [UserRole.Teacher] } }` — the conjunction form, never a plain map (`backend/graphql/mutation/classes/student-evaluation.mutation.ts:54-70`) | `submitRubricEvaluation` mutation + pending-sessions read |
| Service-level state gates | evaluator certification (`is_approved AND is_evaluator`), session ownership, session completed, applicant `in_evaluation` | the rubric service gate chain (REQ-2) |
| Permission strings | NONE EXIST — none invented (G33) | — |

### Per-Audience rendering

| Audience | What they see for this feature |
|----------|-------------------------------|
| Applicant (in_evaluation) | Existing evaluation-loop zone; after finalization the existing Failed or Passed branch renders (no new code) |
| Applicant (passed) | Existing `CertifiedNarrative` branch + the `evaluation_result` notification |
| Applicant (failed, cooldown active) | Existing `CooldownZone` with `cooldownExpiryLine` interpolated from the newly written `cooldown_until` |
| Certified evaluator | Submit-evaluation action + dialog on their own completed evaluation rows (REQ-12) |
| Certified teacher (non-evaluator) | Nothing |
| Student / Parent | Nothing |
| Admin | Nothing in this plan (Admin Override ticket owns rubric visibility — ledger D3) |

### Translation system (all strings compile-time)

- Client components: `useAppTranslation(<Namespace handle>)` with property access only (rubric dialog copy via the `sessions` namespace handle); NEVER function form, NEVER string-literal namespaces.
- Services: `getServerTranslations(locale).errorsTranslations` (services take `locale: string`); resolvers: `await ctx.t("errorsTranslations")`.
- NO `Translation` enum; NO two-arg `getTranslations`; NO `next-intl`; NO hook-form `t('key')`.
- New keys (errors: REQ-10; applicant outcome-notification copy: REQ-9; sessions rubric-dialog copy: REQ-12) each gain type leaf + en + ar + parity-test extension in the same task.

---

## 10. Success Criteria (Definition of Done)

1. Threshold semantics hold exactly: five 80s → PASS with teacher row created; any cycle containing a 79 → FAIL with cooldown (the Tier-2 boundary pair is asserted, REQ-14.2).
2. Verdict atomicity: the 5th submission's transaction is the only finalizer — verdicts commit with their submission or not at all; no second finalization is reachable under concurrency (REQ-15).
3. PASS state per ticket: `teacher` row (shared PK, `is_approved=true`, `is_evaluator=false`) + `applicants.status='passed'` + `cooldown_until` NULL + applicant notified.
4. FAIL state per ticket-as-scoped: `applicants.status='failed'` + `cooldown_until = now+30d (tajweed) / now+90d (hifz)` from the deterministic primary failure area; NO teacher row, NO students row, NO `users.suspended*` write, NO `users.role` change; the existing `APPLICANT_COOLDOWN_ACTIVE` guard blocks re-purchase immediately.
5. Write-once holds: the `(session_id, evaluator_id)` unique index + service gate reject every duplicate submission with `[EVALUATION_ALREADY_SUBMITTED]`, zero extra rows.
6. All touched files pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`; the full `bun quality-gate` run at PR head is green; `bun run test:db`, `bun run test:services`, `bun run test:graphql`, and the journey (via `bun run test/scripts/run-test.ts test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts`) all pass.
7. The deferred ledger is live (`deferred-items.md`) with D1–D4 recorded before the corresponding tasks complete; all research is captured in `outcome/*` per task; the tasks.md traceability matrix has zero unresolved items.
8. No new routes/nav items, no new env keys, no new dependencies; `bun run db push` + `bun run generate:gqlSchema` + `bun codegen` are the only environment/SDL steps.

---

## 11. Deferred-items Ledger (seed, live file at deferred-items.md)

| ID | Deferred Item | Target owner | Notes |
|----|---------------|--------------|-------|
| D1 | `users.suspended` / `suspended_at` / `suspended_period_days` writes on failure (user-level suspension + reactivation after cooldown) | Cooldown State Machine (`docs/planning/TICKETS.md:818-871`, Blocked By this ticket) | This ticket writes ONLY `applicants.status` + `cooldown_until` (the guard reads only `cooldown_until`, G26); the overlap is an explicit ownership decision, not a silent scope grab |
| D2 | "A students record is created for the failed applicant" (ticket AC; conversion semantics: NOT-NULL unique `handshakeCode`, zeroed balance lanes, role question) | DEV2-009 Failed Applicant → Student Record Conversion (`docs/planning/TICKETS.md:872-915`) | Ticket-graph rationale: DEV2-009 owns the whole conversion and is Blocked By Cooldown (two tickets downstream); DEV2-006's G18 set the deferral precedent; doing it here would pre-empt DEV2-009's acceptance criteria |
| D3 | Admin visibility of rubric detail (per-evaluation scores & notes) and result override | Admin Override of Evaluation Results (`docs/planning/TICKETS.md:916-948`) | This plan exposes no admin read surface; `notes` stay server-side (the G16 posture) |
| D4 | `teacher.average_rating` recompute / any average-rating semantics tied to evaluation rows, and the re-evaluation loop (`session_type='re_evaluation'` exists but is unused) | Out of scope for the student-rating flow (`aggregateLiveRatings` untouched); re-evaluation → Admin-Ordered Re-Evaluation (Milestone 3, `docs/planning/TICKETS.md:2143+`, DEV2-006 deferred-item D2 lineage) | The rubric flow neither reads nor writes `average_rating`; the aggregation engine stays cycle-scoped and re-evaluation gets its own plan |

---

## 12. Glossary

| Term | Definition |
|------|------------|
| Rubric submission | One `evaluations` write by an evaluator for a completed `teacher_evaluation` session: score (0-100), notes, weakness iff score < 80, session-linked |
| Evaluator | `users.role='teacher'` + `teacher.is_approved=true` + `is_evaluator=true`; no sheikh role exists |
| Applicant | `users.role='teacher'` user with an `applicants` row (shared PK); never a `students` row; never a `teacher` row until passing |
| Evaluation cycle | The applicant's ACTIVE verification-plan subscription window (`resolveCurrentEvaluationCycle`); DEV2-006's scoping boundary |
| Scored submission | A rubric row with non-NULL score; NULL scores are not aggregable |
| Aggregation quorum | 5 distinct scored submissions ↔ 5 distinct completed evaluation sessions ↔ 5 distinct evaluators, all within the current cycle |
| Threshold | Per-evaluation minimum: PASS iff ALL 5 scores ≥ `RUBRIC_PASS_THRESHOLD` (80); NOT an average; 80 passes, 79 fails |
| Primary failure area | On FAIL: the weakness of the lowest-scoring failing evaluation (ties → earliest `created_at`); tajweed ⇒ 30 days, hifz ⇒ 90 days |
| Cooldown write | `applicants.cooldown_until = now + 30/90 days`, written by the guarded FAIL repo method; the strict-boundary read side honors it verbatim |
| Finalization | The single-transaction verdict: submission insert + quorum check + PASS/FAIL writes (+ teacher row on PASS) + in-tx notification, published post-commit |
| Write-once | At most one `evaluations` row per (session, evaluator) — `evaluations_session_evaluator_unique` is the arbiter; the service pre-check is an optimization |
| 422 semantics | GraphQL over HTTP returns 200 + `errors[].extensions.code`; the ticket prose's "422" is code-level truth, never a REST status |

---

*End of specs.md. Cross-references: plan.md (design, concurrency, exact i18n key table); tasks.md (implementation queue + traceability matrix); deferred-items.md (live ledger); outcome/ (per-task research).*
