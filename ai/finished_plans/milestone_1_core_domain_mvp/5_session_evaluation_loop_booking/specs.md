# Requirements & Specification: DEV2-006 — 5-Session Evaluation Loop Booking

> **Date**: 2026-09-17 (Milestone 1 — Core Domain MVP)
> **Target Ticket**: `5-Session Evaluation Loop Booking` (`docs/planning/TICKETS.md:719-762`; Owner: Dev 2, 5 SP)
> **Plan directory**: `ai/plans/milestone_1_core_domain_mvp/5_session_evaluation_loop_booking/` (this directory)
> **Specs path**: this file
> **Design path**: `plan.md` (this directory)
> **Tasks path**: `tasks.md` (this directory)
> **Deferred-items ledger**: `deferred-items.md` (this directory)
> **Outcome directory**: `outcome/` (this directory) — pre-execution reads of ALL outcome files are mandatory per task
> **Blocked By (FINISHED)**: DEV2-005 Verification Plan Purchase (`ai/finished_plans/milestone_1_core_domain_mvp/verification-plan-purchase-5-sessions/`)
> **Blocks**: DEV2-007 Evaluation Rubric Scoring (≥80%) (`docs/planning/TICKETS.md:764-771`)
> **Decision Refs (ticket)**: A.8 (`session_type`) and A.10 (`session_intent`) — normative text in `docs/specs/open-decisions-and-gaps.md:52-57,64-72`; INV-TV2 (`docs/specs/state-machine-invariants.md:85`); FR-3.3 (`docs/specs/functional-requirements.md:96-100`); Dev2↔Dev3 Contract 4 (`docs/planning/TEAM_ALLOCATION.md:139-145`)

---

## 1. Executive Summary & Problem Statement

**Feature:** Let a teacher applicant who purchased (and whose payment confirmed) the platform's "New Teacher Verification & Evaluation Plan" (`sessionCount = 5`, `shared/constants/verification-plan.constants.ts`) book exactly up to 5 evaluation sessions, one each with 5 DISTINCT certified evaluators (`teacher.is_approved=true AND is_evaluator=true`), writing each booking as a real `session` row with `session_type='teacher_evaluation'` and `intent='evaluation'`. The loop enforces INV-TV2's distinctness, the 5-credit ceiling derived from the ACTIVE verification subscription (credit accounting is off-chain from student balance lanes — DEV2-005's activation skips the lane credit for applicants), and two polite 422-family rejections: "Evaluation loop complete" (all 5 completed) and "No evaluation sessions remaining" (credits exhausted by live bookings).

**Problem from user perspective:**

- **Teacher applicant (Ibrahim):** after paying, he is `in_evaluation` but there is NO surface to actually book his required 5 evaluations — the only bookable session today is the student-only `createSession` (which applicant teacher-role users cannot call and which books `student_session` rows with lane debits he doesn't own). He must be able to see which certified evaluators are still eligible for HIM (never a repeat: INV-TV2) and book one, with zero free-text identity input.
- **Certified evaluator (Sheikha Fatima):** a teacher with `is_evaluator=true` — she receives the newly booked evaluation session in her normal sessions read (`myTeacherSessions`) and in the real-time teacher-request notification wave, exactly like a student booking.
- **Platform integrity:** the FK on `session.student_id` currently points at `students.id`, which applicants structurally never satisfy (registration writes role `teacher` → `applicants` row only — `backend/services/shared/user-provisioning.helpers.ts:75-94`; locked by DEV2-005's journey: `test/workflows/teachers/verification-plan-purchase.journey.test.ts:429-431` asserts `students` row count 0 for every applicant). This plan resolves the impedance mismatch with the minimal, spec-conformant schema delta (§REQ-7) instead of provisioning phantom student rows.
- **Dev 2 (owner) / DEV2-007 (consumer):** rubric scoring needs the 5 `session` rows with correct type/intent and the distinct-evaluator link proven; this plan produces exactly that substrate and nothing more (rubric submission/outcomes are strictly out of scope).

**Business value:** This is the executable core of the verification loop that M1's goal advertises ("teacher verification evaluation loop … booking" — `docs/planning/MILESTONE_PLAN.md:85,98`). Without it the purchased subscription is a dead entitlement: no evaluation sessions can ever exist, and DEV2-007/DEV2-008/DEV2-009 have no input.

---

## 2. Source Ticket (verbatim anchor)

`docs/planning/TICKETS.md:719-762`, titled "### 5-Session Evaluation Loop Booking":

> Implement the 5-session evaluation loop. The applicant must book 5 evaluation sessions with 5 distinct certified Shuyukh. Each session has session_type=teacher_evaluation and intent=evaluation. The system enforces that no evaluator evaluates the same applicant twice.

Acceptance criteria (verbatim phrases from the ticket):

1. Applicant with an active verification subscription books an evaluation session → session created with `session_type='teacher_evaluation'`, `intent='evaluation'`; the evaluator (teacher) MUST have `is_approved=true AND is_evaluator=true`.
2. Applicant with 3 completed sessions with 3 distinct evaluators books a 4th → booking with any of the 3 prior evaluators is prevented, and only certified evaluators not yet used are shown.
3. Applicant with 5 completed evaluation sessions attempts a 6th → rejected 422 "Evaluation loop complete".
4. Applicant with 0 remaining evaluation credits attempts to book → rejected 422 "No evaluation sessions remaining".

Test scenarios named in the ticket: book-with-certified-evaluator succeeds; same-evaluator rebooking rejected; loop completion at 5; zero-credit rejection; evaluator certification gate. Decision refs: A.8, A.10, INV-TV2, FR-3.3 (also Contract 4 in TEAM_ALLOCATION §7).

## 3. Requirements Glossary (terms used throughout)

- **Applicant**: a `users` row with `role='teacher'` and a row in `applicants` (shared PK), never a `students` row, never a `teacher` row until passing.
- **Evaluation credit**: one of exactly `VERIFICATION_PLAN_SESSION_COUNT` (=5) booking entitlements granted by ONE ACTIVE verification subscription (`subscriptions` row owned by the applicant whose plan title = `VERIFICATION_PLAN_TITLE`, status `active`). Not a balance lane — credits are DERIVED (5 minus boundary-scoped bookings), never stored.
- **Used evaluator**: a `teacher` user id whose non-cancelled evaluation session with THIS applicant under the CURRENT loop cycle exists. Non-cancelled = `status != 'cancelled'`.
- **Loop cycle**: the set of evaluation sessions created at-or-after the LATEST active verification subscription's `startDate` (its activation instant) for this applicant. A new activation (re-purchase) starts a fresh cycle.

---

## 4. Verified Ground-Truth Inventory (grepped/viewed 2026-09-17)

Every EXISTING claim below was verified directly against source. Labels: EXISTING (use as-is) · UPDATE (touched by this plan) · CREATE (new artifact) · ABSENT (proven absent).

| # | Artifact | Verdict | Evidence (verified) |
|---|----------|---------|---------------------|
| G1 | `session` table: PK identity int; `teacher_id NOT NULL → teacher.id RESTRICT`; `student_id NOT NULL → students.id RESTRICT`; `status session_status NOT NULL default 'scheduled'`; `session_type session_type NOT NULL default 'student_session'`; `intent session_intent NULLABLE`; `fee decimal(10,2) NULL`; `fee_held bool default false`; `held_balance_lane varchar(20) NULL`; full col set confirmed | UPDATE (exactly one change: `student_id` FK target moves `students.id → users.id`) | `backend/db/schema/classes/session.ts:50-88` |
| G2 | `session_type` pgEnum `["student_session","teacher_evaluation","re_evaluation"]` + `session_intent` pgEnum `["hifz","tajweed","evaluation"]` | EXISTING | `backend/db/schema/enums.ts:40,42` |
| G3 | TS enums mirroring pgEnums: `SessionType.TeacherEvaluation="teacher_evaluation"`, `SessionIntent.Evaluation="evaluation"` | EXISTING | `backend/enum/scheduling/session-type.enum.ts:6-10`; `backend/enum/scheduling/session-intent.enum.ts:6-10` |
| G4 | Pothos enum registrations for `SessionType` + `SessionIntent` (SDL vocabulary complete) | EXISTING | `backend/graphql/pothos/shared/enum.pothos.ts:148-167` |
| G5 | `teacher` table: shared PK → users.id cascade; `is_approved bool default false`; `is_evaluator bool default false`; `is_online`; `subjects`; `average_rating decimal(3,2)` | EXISTING | `backend/db/schema/teachers/teacher.ts:22-42` |

| # | Artifact | Verdict | Evidence (verified) |
|---|----------|---------|---------------------|
| G6 | `applicants` table: shared PK → `users.id` cascade; varchar(50) status default 'pending' (no pgEnum); `verification_attempts`; `cooldown_until` | EXISTING | `backend/db/schema/teachers/applicants.ts:16-31` |
| G7 | `ApplicantStatus.InEvaluation` + `isApplicantStatus` guard | EXISTING | `backend/enum/teachers/applicant-status.enum.ts:12-27` |
| G8 | `ApplicantLifecycleService.assertCanPurchaseVerification(userId, locale, tx?)` & `recordReapplication` — purchase-time status ownership | EXISTING (compositional call only) | `backend/services/teachers/applicant-lifecycle.service.ts:202-262`; contract: `docs/teachers/applicant-lifecycle.md:117-122` |
| G9 | Verification plan seed: `VERIFICATION_PLAN_TITLE`, sessionCount=5, price 150.00 EGP, intervalDays 14, lane Reviews | EXISTING (read-only) | `backend/db/seeds/billing/seed-plans.ts:53-66`; `shared/constants/verification-plan.constants.ts:19-28` |
| G10 | Activation credit-skip: `payment.studentId===null` + applicant probe → skip lane credit; "the 5-session grant is enforced by the booking flow off the active subscription" is stated as THIS plan's hook | EXISTING (the handoff we implement) | `backend/services/billing/subscription-activation-credit.helpers.ts:100-132` |
| G11 | `subscriptions`: `user_id` generic FK, `status`, `startDate`/`endDate`; `paymentReference` partial unique | EXISTING | `backend/db/schema/billing/subscriptions.ts:28-53` |
| G12 | `SubscriptionStatus` enum values `Active`/`Pending`/`Expired`/`Cancelled`/`Suspended` | EXISTING | `backend/enum/billing/subscription-status.enum.ts:6-12` |

| # | Artifact | Verdict | Evidence (verified) |
|---|----------|---------|---------------------|
| G13 | `SubscriptionRepository.listByUserId(userId, tx?)` | EXISTING (compose) | `backend/db/repo/billing/subscription.repository.ts:169` |
| G14 | Student booking pipeline `bookSessionInTx` — certification lock → debit ladder → savepoint claim → insert+backfill; replay-by-throw | EXISTING (pattern template; NOT called for evaluation bookings) | `backend/services/classes/session-lifecycle.booking.ts:235-290` |
| G15 | `SessionRepository.insertSession(insert, tx?)` | EXISTING (reused) | `backend/db/repo/classes/session.repository.ts:111-124` |
| G16 | `SessionRequestIdempotencyRepository.insertClaim`/`findByKey`/`updateClaimSessionId` — generic `userId` claim table, 23505 replay discipline | EXISTING (reused verbatim) | `backend/db/repo/classes/session-request-idempotency.repository.ts:43-125` |
| G17 | Applicant NEVER owns a `students` row (registration writes only `users`+`applicants` for role teacher); purchase journey locks `studentsRowCount(applicant)===0` | EXISTING (must NOT be regressed) | `backend/services/shared/user-provisioning.helpers.ts:75-94`; `test/workflows/teachers/verification-plan-purchase.journey.test.ts:429-431,540` |
| G18 | DEV2-009 (Failed Applicant → Student Record Conversion) DEFERS any `students` row creation to a failure-conversion — evaluation sessions must be writable while NO `students` row exists | ABSENT upstream (boundary condition for schema choice) | `docs/planning/TICKETS.md:872-906` |
| G19 | `TeacherRepository.lockForCertificationCheck(teacherId, tx)` — `SELECT … FOR UPDATE` returning `{id, isApproved}` | EXISTING (counterpart seat for evaluator lock) | `backend/db/repo/teachers/teacher.repository.ts:192-203` |
| G20 | `session_request` notification copy already localizes `SessionIntent.Evaluation` (`intentEvaluation`) | EXISTING (reuse) | `backend/services/classes/session-request-notification.copy.ts:22-27`; `shared/locale/en/notifications/index.ts:66`; types pinned `shared/locale/types/notifications/index.ts:132` |

| # | Artifact | Verdict | Evidence (verified) |
|---|----------|---------|---------------------|
| G21 | `SessionPothosObject` + `SessionPagePothosObject` expose `sessionType`, `intent`, `fee`, hold/lane fields | EXISTING (reused) | `backend/graphql/pothos/classes/session.pothos.ts:165,273` |
| G22 | Participant session queries `myStudentSessions` (role=Student) and `myTeacherSessions` (role=Teacher), factory `registerParticipantSessionsField`, page defaults 1/25 | EXISTING (pattern + the evaluator-side read is FREE for evaluators) | `backend/graphql/query/classes/session-lifecycle.query.ts:111-152,193-203` |
| G23 | Applicant dashboard status card: `InEvaluation` branch shows attempts + hint | EXISTING (slots for new evaluation loop zone) | `frontend/views/teachers/dashboard/ApplicantStatusResolution.tsx:84-97`; `frontend/views/teachers/dashboard/ApplicantStatusZones.tsx` |
| G24 | `errors` namespace keys incl. `sessionNotFound`, `teacherNotCertified`, `invalidSessionIntent`, `duplicateRequest`, `insufficientBalance`, `subscriptionExpired`, `idempotencyKeyRequired`, `applicantNotFound`, `applicantAlreadyCertified`, `teacherNotFound` | EXISTING (this plan ADDS exactly: `evaluationLoopComplete`, `noEvaluationCreditsRemaining`, `evaluatorAlreadyUsed`, `verificationSubscriptionNotActive`) | `shared/locale/types/errors/labels.ts:49-52,172-190` + en/ar leaves; parity test `shared/locale/errors-namespace.parity.test.ts` |
| G25 | Teacher nav set: dashboard, notifications, `/teacher/sessions`, schedule, wallet, profile — NO evaluation surface | UPDATE (add evaluation item) | `frontend/views/dashboard/nav/navItems.ts:141-147` |
| G26 | Teacher-side DOM surface for booking (session rows in `myTeacherSessions` show evaluator-visible rows) | EXISTING (free evaluator-side read) | `app/(dashboard)/teacher/sessions/page.tsx` |
| G27 | `evaluations` table —`session_id` nullable FK set-null; (session, evaluator) unique; score check 0..100 | ABSENT write-path in this plan (DEV2-007 consumes `session` rows; this plan does not write `evaluations`) | `backend/db/schema/teachers/evaluations.ts:36-60` |

| # | Artifact | Verdict | Evidence (verified) |
|---|----------|---------|---------------------|
| G28 | Sweeps: `sweepExpiredScheduledOnce` cancels scheduled rows whose deadline lapses; `sweepExpiredCompletedOnce` cancels completed rows never student-confirmed after the window | EXISTING (deadline semantics deliberately reused: a booked evaluation is a booking with a confirmation deadline; the evaluator completes within the window, the loop timeouts work exactly as they do for students) | `backend/db/repo/classes/session.repository.ts:554-590` |
| G29 | `completeSessionOnce` guard: `(id, teacherId owner, status=started, EXISTS teacher—is_approved=true)` — session-type-agnostic | EXISTING (works unmodified for evaluation rows) | `backend/db/repo/classes/session.repository.lifecycle.helpers.ts:41-58` |
| G30 | `confirmStudentCompletionOnce` predicate REQUIRES `feeHeld = true`; the wallet earning write fires only there | EXISTING (invariant safety net: evaluation rows carry feeHeld=false so they can NEVER reach the wallet credit) | `backend/db/repo/classes/session.repository.ts:514-537` |
| G31 | `SessionRequestNotificationService.notifyTeacherOfSessionRequest(sessionId, locale, tx?)` — locates recipients from the session row, writes engine row in-tx | EXISTING (composed by the evaluation-booking service post-commit rule) | `backend/services/classes/session-request-notification.service.ts:217-227`; wave context read joins `users` on both session FK columns (NOT `students`) → `backend/db/repo/classes/session.repository.wave.helpers.ts:66-110` |
| G32 | Governance re-check helper `assertActorGovernanceClean(userId, t, tx?)` | EXISTING (reused) | `backend/services/classes/session-lifecycle.governance.ts:47-111` |
| G33 | Journey harness: `createJourneyFixtures(prefix)` cast incl. `applicant` + `certifiedTeacher`; registry tracked deletes | EXISTING (reused; we add an evaluator helper variant) | `test/workflows/helpers/journey-actor-fixtures.ts:141-177` |
| G34 | Backend logger `logger.logDomainError` + service-takes-`locale`-string conventions; frontend logger at `@/frontend/lib/logger` | EXISTING conventions | `backend/services/teachers/verification-purchase.service.ts:317-460`; `frontend/lib/logger.ts:109` |
| G35 | `Frontend`-side docs barrel `frontend/graphql/sharedDocuments/teachers/` (applicant.documents.ts, student-evaluation.documents.ts) | UPDATE (new documents doc module) | `frontend/graphql/sharedDocuments/teachers/index.ts` |
| G36 | TypeScript boundaries for service input typing: `SessionSubmitInput.intent` is narrowed to Hifz/Tajweed — hence a NEW sealed input type for evaluation booking (evaluation intent must not be widened onto the student booking surface) | ABSENT (CREATE in `backend/types/classes/session.types.ts`) | `backend/types/classes/session.types.ts:27-42` |

---

## 5. Requirements (EARS)

IDs are stable for the traceability matrix (`tasks.md` references them verbatim). REQ-0 and REQ-0.5 are the standard process/standards requirements; functional requirements start at REQ-1. Every AC must be testable against the real service surface; deny-path codes are named in brackets `[code]`.

### REQ-0 — Pre-Implementation Baseline & Execution Protocol (process)

**User Story:** As an executing agent, I need a recorded baseline, a deferred-items ledger, and an outcome knowledge base, so that regressions are provable and research is never repeated.

1. WHEN implementation begins THE agent SHALL record baseline counts (`bun tsgo` errors, `bun biome:check` warnings, lint JSON) into `outcome/0-baseline-outcome.md` and the returned counts SHALL be pre-existing, not new.
2. WHEN any task starts THEN the executing agent SHALL read every file in `outcome/` (at this plan's path) before acting.
3. WHEN any task completes THEN the executing agent SHALL write `outcome/<task-id>-outcome.md` AND flip the `tasks.md` checkbox.
4. WHEN a file is modified THEN the executing agent SHALL run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` and SHALL continue only on exit code 0.
5. WHEN work is deferred THEN an entry SHALL be created in `deferred-items.md` BEFORE the task is marked complete.

### REQ-0.5 — i18n & Enum Import Compliance (process)

**User Story:** As the platform, I need all user-facing strings to flow through the compile-time locale system and all enums to be value imports, so AR/EN parity and runtime type-safety are guaranteed.

1. WHEN any user-facing copy is rendered THEN the code SHALL use property access over the locale handle (client: `useAppTranslation(Namespace)`; server: `getTranslations(locale)`/service-layer `getServerTranslations(locale)`) — NEVER string literals, NEVER two-arg `getTranslations`, NEVER the `Translation` enum (does not exist), NEVER `next-intl`.
2. WHEN an enum is referenced in a runtime expression (comparison, switch, literal set) THEN the import SHALL be a value import (`import { SessionIntent } …`), never `import type`.
3. WHEN new error/notification keys are added THEN the `errors` (and other touched) namespaces SHALL gain en + ar leaves and the corresponding `*-namespace.parity.test.ts` parity cases SHALL be extended in the same task.

### REQ-1 — Evaluation booking surface (core write)

**User Story:** As an applicant with an active verification subscription, I want to book one evaluation session with an eligible evaluator of my choice, so a real `session` row is created with `session_type='teacher_evaluation'` and `intent='evaluation'`.

1. WHEN an authenticated caller with an `applicants` row in status `in_evaluation` invokes `bookEvaluationSession(input)` with a well-formed evaluator id THEN the system SHALL create ONE `session` row with `teacher_id=<evaluator>`, `student_id=<applicant>`, `status='scheduled'`, `session_type='teacher_evaluation'`, `intent='evaluation'`, `fee=null`, `fee_held=false`, `held_balance_lane=null`, `confirmation_deadline=<now+24h>` (B.2 preview), and SHALL return the created session.
2. WHEN the same caller resubmits with the same `x-idempotency-key` header THEN the system SHALL NOT create a second session and SHALL respond with `ConflictError('DUPLICATE_REQUEST')` (replay-by-throw, zero extra rows).
3. WHEN the caller passes a malformed evaluator id (NaN, ≤0, non-safe-integer) THEN the system SHALL fail with `ValidationError` pre-DB without ANY reads.
4. WHEN a caller whose idempotency key is missing/empty/oversized invokes the mutation THEN the system SHALL reject with `ValidationError` keyed `idempotencyKeyRequired`, pre-DB.
5. WHEN the request carries no authenticated user THEN the GraphQL scope SHALL deny with `UNAUTHORIZED` before resolution.
6. WHEN the created row is committed THEN the caller SHALL see the caller id inside `session.student_id` and the evaluator inside `session.teacher_id`, and a subsequent direct DB past-check SHALL prove no `widening` (no `session_type='student_session'` row was produced).

### REQ-2 — Evaluator certification gate

**User Story:** As the platform, I want bookings to target ONLY teachers who are BOTH approved and evaluators, so the loop can only run against the certified committee.

1. WHEN the targeted user lacks a `teacher` row THEN the system SHALL reject with `NotFoundError('TEACHER')` (`teacherNotFound` localized copy).
2. WHEN the targeted teacher row exists with `is_approved=false` OR `is_evaluator!==true` THEN the system SHALL reject with `ConflictError('TEACHER_NOT_CERTIFIED')` (existing copy, deliberate reuse of the certification-denial vocabulary; the loop's evaluator predicate is the certification gate at booked position).
3. WHEN an evaluator becomes decertified concurrently THEN the booking takes the certification under the row's `SELECT … FOR UPDATE` lock so the decision commits against the LOCKED value.
4. WHEN the evaluator is governance-flagged (deleted/blocked/suspended) THEN the system SHALL reject — evaluation bookings are booked through the same actor-governance posture as other writes (INV-S5).

### REQ-3 — Distinct evaluators (INV-TV2) — no repeats, ever

**User Story:** As the platform, I want to prevent any evaluator from evaluating the same applicant twice, so the five verdicts are statistically independent.

1. WHEN the applicant has ANY non-cancelled evaluation session with evaluator X in the CURRENT loop cycle THEN booking with X SHALL be rejected with `ConflictError('EVALUATOR_ALREADY_USED')`.
2. WHEN the applicant cancels a scheduled evaluation session (the only actor-allowed exit before completion) THEN that teacher id SHALL become re-bookable for the same loop cycle.
3. WHEN the applicant re-enters via a NEW active verification subscription (re-purchase after cooldown; INV-TV3 elapsed) THEN the used-evaluator memory SHALL reset (fresh cycle isolation).
4. WHEN the evaluator was booked for evaluation in an OLDER cycle and the current cycle has no non-cancelled row with that evaluator THEN booking with that evaluator SHALL be allowed.

### REQ-4 — Credit availability gate (5-session ceiling)

**User Story:** As the platform, I want bookings to occur only while the applicant's active verification subscription still has unused evaluation slots, so the loop can never exceed the paid-for 5.

1. WHEN the applicant has NO ACTIVE verification subscription (no `subscriptions` row owned by them whose plan is the verification plan AND `status='active'`) THEN booking SHALL be rejected with `ConflictError('VERIFICATION_NOT_ACTIVE')`.
2. WHEN the applicant has used ≥5 credits in the current cycle AND all 5 sessions are `completed` THEN booking SHALL be rejected with `ConflictError('EVALUATION_LOOP_COMPLETE')` (ticket's "422 'Evaluation loop complete'").
3. WHEN the applicant has used ≥5 credits in the current cycle AND fewer than 5 are `completed` THEN booking SHALL be rejected with `ConflictError('NO_EVALUATION_CREDITS_REMAINING')` (ticket's "422 'No evaluation sessions remaining'").
4. WHEN the applicant has 3 completed + 1 scheduled (`started`/filled) + 1 cancelled THEN the remaining credit count SHALL be 1 (3+1 non-cancelled used), and a booking SHALL succeed if the evaluator gates pass.
5. WHEN two concurrent booking submissions race for the applicant's final credit THEN BOTH transactions SHALL lock the applicant row (`SELECT … FOR UPDATE` on `applicants`) so exactly ONE commits and the other either fails the credit gate or, on duplicate key, replays with `DUPLICATE_REQUEST`.

### REQ-5 — Loop-cycle scoping for re-application isolation

**User Story:** As the platform, I want USED-credit and USED-evaluator memory to be scoped to a single purchase cycle, so a re-purchase after cooldown starts with a clean slate but earlier loops keep their audit trail.

1. WHEN a 2nd verification subscription activates for the applicant (after the cooldown flow) THEN the credit counter SHALL reset to 5 available for sessions whose `created_at` falls at-or-after the new subscription's `startDate`.
2. WHEN counting credits THEN sessions from prior cycles SHALL be excluded (they created history, not entitlements).
3. WHEN counting used evaluators THEN only the current cycle's sessions apply.

### REQ-6 — Free-completing session integration

**User Story:** As the evaluator, I want evaluation sessions to appear in my existing session list and drive start/complete like any session, so no new lifecycle surface is required for M1.

1. WHEN an evaluation session is created THEN the OWNing evaluator SHALL see it in `myTeacherSessions` (role Teacher) exactly as student sessions appear.
2. WHEN the evaluator starts the session (existing `startSession`) THEN the standard INV-S6 lock SHALL set `teacher.is_online=false` as today.
3. WHEN the evaluator completes the session (existing `completeSession`/`completeSessionWithReceipt`) THEN the guarded update SHALL succeed (session-type-agnostic) and the completion-prompt notification SHALL flow to the applicant with intent label `intentEvaluation` localized copy.
4. WHEN the session row is complete and the applicant triggers `confirmSessionCompletion` THEN the guarded `confirmStudentCompletionOnce` SHALL NOT match (its `fee_held=true` predicate): zero wallet write, zero trial-lane write, and the service surface level answer per the existing zero-row classification.
5. WHEN the confirmation-deadline sweeps run THEN a scheduled evaluation session whose deadline lapsed SHALL auto-cancel EXACTLY like student sessions (but with NO lane refund since `held_balance_lane=null`), and a completed evaluation session SHALL be auto-cancelled exactly like student sessions (closing the handshake; DEV2-007's rubric submission on a completed session owns the scoring write — outside this plan).
6. WHEN an evaluation booking exists THEN NO wallet, NO balance-lane, NO `students` row, NO `student_payments`, NO `teacher_transaction` rows SHALL be created by the booking.

### REQ-7 — Schema delta (binding)

**User Story:** As the platform, I need the `session` row to refer to the teaching target WITHOUT requiring a `students` child row, so evaluation bookings are storable against a bare `users` id.

1. THE `session.student_id` FK SHALL point at `users.id` (NOT at `students.id`); the column remains NOT NULL, delete rule `restrict`.
2. THE migration shall be a Drizzle schema push (`bun run db push`), not a custom SQL migration (the repo's Drizzle convention).
3. THE change SHALL NOT touch `session.teacher_id` (still → `teacher.id` RESTRICT) and SHALL NOT widen/null any other column.
4. WHEN the change is live THEN every existing `listForStudent`/`countForStudent` still pages by `student_id = users.id` (the identical semantic because `students` shared-PK mirrors `users.id`), and the inserted evaluation rows remain readable on `listForStudent` for direct callers, but no new student-facing app read surface is added.
5. WHEN a migration reviewer inspects the delta THEN the ONLY DDL change is the foreign-key target retarget, accompanied by a `docs/specs` cross-link update in the Knowledge Propagation task.

### REQ-8 — Application surface (GraphQL + documents)

**User Story:** As the applicant, I want a single mutation for booking plus readonly proxies for my evaluator choices and my evaluation session list, so the dashboard can render the loop with no new routes.

1. THE system SHALL expose `bookEvaluationSession(input: BookEvaluationSessionInput!): Session!` scoped `authenticated` (service gates handle eligibility); the mutation SHALL accept ONLY `evaluatorId` (GraphQL `ID!`).
2. THE system SHALL expose `myEvaluationLoopStatus(): EvaluationLoopStatus!` returning `{ bookedCount, completedCount, remainingCredits, cycleStartedAt }` (computed server-side), scoped `authenticated` + service-side applicant guard.
3. THE system SHALL expose `availableEvaluators(page?, pageSize?): TeacherEvaluationOptionPage!` — the certified+evaluator, governance-clean teachers NOT yet used by this applicant in the current cycle, each minimal `{id, fullName, isOnline, averageRating, subjects}` (PII-free surface), scoped `authenticated` + service-side applicant guard.
4. THE system SHALL expose `myEvaluationSessions(page?, pageSize?): SessionPage!` — the applicant's own evaluation sessions paged newest-first, scoped `authenticated` + service-side applicant guard. (Reuses the canonical `SessionPage` Pothos type.)
5. THE system SHALL NOT add any query for cross-applicant introspection, SHALL NOT add admin listing for applications in this plan, and SHALL NOT mutate via query roots.
6. THE GraphQL surfaces SHALL live under `backend/graphql/{mutation,query}/teachers/` (evidence-based folder) and side-effect registered via domain barrels, not the top-level index directly.
7. THE input/output mapping SHALL be BOPLA-whitelist (a sealed `BookEvaluationSessionInput` carrying a single numeric field after `ID` parsing); all other session row values are server-assigned.

### REQ-9 — Applicant dashboard UX (no new routes, updated zone)

**User Story:** As the applicant, I want my evaluation progress and my booking dialog on my existing dashboard status card, so I don't navigate anywhere new.

1. WHEN the applicant's profile is `in_evaluation` THEN the existing evaluation zone on the applicant status card SHALL gain: progress line (`bookedCount/5` + `completedCount/5` + `remainingCredits`), an eligible-evaluator top-N summary with a "Book evaluation" CTA opening a booking dialog.
... (continued below in §10 role/audience matrix)
   WHEN dismissing/confirming the booking dialog THEN the frontend SHALL (a) on success, invalidate/refetch `myEvaluationLoopStatus` and `availableEvaluators` (and `myApplicantProfile` for the counter stamp); (b) on domain denials map typed errors `EVALUATION_LOOP_COMPLETE`, `NO_EVALUATION_CREDITS_REMAINING`, `EVALUATOR_ALREADY_USED`, `TEACHER_NOT_CERTIFIED` to their localized taps.
2. WHEN render runs in `ar` THEN all new copy SHALL come from the namespace leaves (no layout shift placeholders, missing-key fallback surfaces the canonical string-id — never a hardcoded English fallback).
3. WHEN viewed on mobile THEN the evaluation zone SHALL compose within the existing status-card breakpoints (no new breakpoint values added).

### REQ-10 — Security & Tenancy Defense

**User Story:** As the platform owner, I want the new surfaces to be BOLA/BOPLA/BFLA-tight, so applicant and evaluator identities are never echoing client-supplied claims.

1. WHEN ANY resolver or service method for this plan runs THEN the applicant identity SHALL be `ctx.user.id` resolved server-side, and the evaluator id SHALL be a data input validated as a positive safe integer and checked against the locked `teacher` row.
2. WHEN the booking input crosses the GraphQL boundary THEN it SHALL carry ONLY `evaluatorId` (ID); any additional client-controlled field is a compile-time input-shape violation.
3. WHEN foreign idempotency-key probes occur THEN the caller SHALL receive the same response class as the claim's claimant would (`SESSION_NOT_FOUND`) and no information about an existing claim or its owner.
4. WHEN an applicant targets ANOTHER applicant (who has no `teacher` row) THEN the request SHALL fail `TEACHER_NOT_FOUND` (the `teacher` row gate is mandatory for evaluators).
5. WHEN a certified teacher who is NOT an evaluator is targeted THEN the request SHALL fail `TEACHER_NOT_CERTIFIED` (logDomainError code `TEACHER_NOT_CERTIFIED`, entity `session`, entityId = target id).
6. WHEN the status of an applicants row is stale cached (`pending` or `failed`), but the row flips mid-request, the guard SHALL execute inside the booking transaction so the TOCTOU window is closed.

### REQ-11 — Idempotency & Replay

1. WHEN a client retries an evaluation booking with the same `x-idempotency-key` THEN the SECOND attempt SHALL throw `DUPLICATE_REQUEST` and SHALL NOT create another session or claim row (savepoint-bracketed replay, mirrors the booking pipeline in `bookSessionInTx`).
2. WHEN the claim insert hits PostgreSQL `23505` (the key's unique arbiter) THEN the replay branch SHALL resolve by read (`findByKey`) and SHALL distinguish SAME-caller vs FOREIGN-caller; same-caller → `DUPLICATE_REQUEST`; foreign-caller → `SESSION_NOT_FOUND` (no information leak).
3. WHEN the SAME applicant uses a key already spent on a STUDENT booking THEN the replay logic SHALL still surface `DUPLICATE_REQUEST` (one claim table scope) and the two flows never co-create a row from a single key.
4. WHEN the evaluator's id and the applicant's id pattern collide (identical id) THEN the service SHALL reject via the FK to `users.id` being to SELF — this is impossible (ticket never books self for self; the evaluator gate `teacher.is_evaluator` plus applicant-role gate make it unreachable, and invariant is defense-in-depth only).

### REQ-12 — Journey test (first-class cross-actor flow)

**User Story:** As the QA surface, I want a real-DB journey test that runs the whole loop end to end, so the invariant chain (purchase → eligibility → distinctness → capacity) is exercised in one pass.

1. WHEN `bun run test/scripts/run-test.ts test/workflows/teachers/evaluation-loop-booking.journey.test.ts` runs THEN it SHALL succeed with zero residue.
2. THE journey SHALL provision: applicant cast (1), certified evaluators (7 — to test all boundaries), a non-evaluator certified teacher, a pending applicant with cooldown, and one seeded verification plan row — all within the harness's tracked-fixture registry.
3. THE journey SHALL include negative probes: foreign-actor replay of a spent key (oracle-denied), booking when cooldown-active (`VERIFICATION_NOT_ACTIVE`), booking with a non-evaluator (`TEACHER_NOT_CERTIFIED`), a 6th booking after 5 (`EVALUATION_LOOP_COMPLETE`), and re-purchase cycle reset confirming fresh eligibility.
4. THE journey SHALL NOT mock the DB, SHALL use real services + real repositories, and SHALL assert shared-state mutations per the Cross-Actor State Machine below.

### REQ-13 — Access Matrix (by role)

| Actor | Booking | Eval read | adminTeachers filter | Wire-level gates |
|-------|---------|-----------|---------------------|------------------|
| SUPER_ADMIN/ADMIN | ✗ (no UI) | `adminTeachers` directory (existing) | `evaluator` filter works today | `authenticated` + `role: [admin]` on admin surface |
| Teacher (certified, is_evaluator=true) | ✗ (no button; teacher panel NOT for booking) | `myEvaluationSessions` for own rows | — | `authenticated` + `role: [teacher]` |
| Applicant (in_evaluation) | ✓ `bookEvaluationSession` + `availableEvaluators` + `myEvaluationSessions` + `myEvaluationLoopStatus` | — | — | `authenticated` (any role) + service-level applicant/status gate |
| Applicant (pending/cooldown/failed) | ✗ (denied with typed code) | — | — | service-level `in_evaluation` gate |
| Student | ✗ | own sessions (existing) | — | column sharing with evaluation rows: a student id can never satisfy `is_evaluator` so they are never evaluator-targeted, and students never have `applicants` rows so they can't book |

---

## 6. Cross-Actor Workflow Scenario (Journey definition)

This feature spans 2+ actors, so the full journey artifact is specified here and becomes the assertion set for the journey test REQ-12.

### Actor table

| Actor | Role in booking | Can do | Cannot do |
|-------|-----------------|--------|-----------|
| Applicant | Requests bookings | Book with any unused certified evaluator in their current cycle; see progress/status; see own evaluation session rows | Book with a used evaluator; book >5/cycle; touch others' sessions |
| Certified Evaluator | Provides evaluations | See rows land via `myTeacherSessions`/`sessionById`; receive the request notification; drive `startSession`/`completeSession` (existing flows) | Book on behalf of the applicant; decide a second booking with the same applicant |
| Certified Teacher (not evaluator) | Not part of the evaluation committee | — | Cannot be targeted for an evaluation booking (rejection `TEACHER_NOT_CERTIFIED`) |
| Student | Not involved | — | Cannot be targeted; no `applicants` row; no overlap by construction |

### Ordered steps (test arrow notation: actor → action → shared-state change + side-effects)

1. Applicant activates verification subscription → `subscriptions.status='active'` (DEV2-005; read-only input here).
2. Applicant calls `bookEvaluationSession(evaluatorId=E1)`:
   - pre-DB governance: caller `assertActorGovernanceClean` → investment trust;
   - in-tx guard chain: applicant lock (`applicants` row), subscription active gate, distinctness probe, capacity probe, evaluator certification lock;
   - insert claim; insert session with the frozen INTENTS/type;
   - commit; then `notifyTeacherOfSessionRequest` runs post-commit (D5 rule — receipt published AFTER the commit that wrote the session).
3. Evaluator receives one `session_request` notification (recipient = evaluator users row, copy in evaluator locale, intent label "Evaluation").
4. Applicant observes `myEvaluationLoopStatus` update: `bookedCount=1`, `remainingCredits=4`.
5. Applicant attempts to book E1 again → `EVALUATOR_ALREADY_USED` at the service; zero new rows; client maps to the localized toast.
6. Applicant cancels the scheduled session with E1 → `session.status='cancelled'` (existing `cancelSession` flow; lifecycle-agnostic); the evaluator becomes re-bookable immediately (used-set exclusion is status-aware).
7. Applicant re-books E1 → succeeds (`status='scheduled'`), remaining decrement persists.
8. Complete active subscription reaches 5 evaluation sessions completed → booking attempt 6 returns `EVALUATION_LOOP_COMPLETE`.
9. (Failure trajectory, NOT exercised here) DEV2-009 will convert a failing applicant's identity — evaluation rows are intentionally untouched by any conversion.

### Cross-actor EARS criteria (observer-perspective)

1. WHEN evaluator E1 is booked THEN E1 SHALL receive a `session_request` notification AND see the row in `myTeacherSessions`; the applicant SHALL see it in `myEvaluationSessions`.
2. WHEN the applicant has 3 evaluation rows for X,Y,Z THEN the `availableEvaluators` list SHALL EXCLUDE X,Y,Z but SHALL include all other certified evaluators.
3. IF the applicant's evaluator id targets a non-evaluator certified teacher THEN the service SHALL deny with `TEACHER_NOT_CERTIFIED` and the evaluator never learns of the attempt (no notification row, no session row).
4. WHEN a key is replayed by the SAME applicant THEN the successful response row is identical to the original booking; WHEN a DIFFERENT applicant replays the same key THEN the response is `SESSION_NOT_FOUND` (constant-time — existence of the claim is invisible to the foreign caller).
5. WHEN the applicant is depleted to zero credits THEN the API response of the mutation SHALL carry code `NO_EVALUATION_CREDITS_REMAINING` with the localized message; ANY later invocation of `availableEvaluators` or `myEvaluationLoopStatus` SHALL remain READ-ONLY and accurate (no failing reads due to exhaustion).

---

## 7. Non-Functional Requirements

### Performance
- NFR-P1: `availableEvaluators` SHALL complete within the platform's normal p95 bound (the evaluator directory is already paginated by the same queries as the admin directory; this is a filtered variant bounded by `limit/offset` + indexed joins).
- NFR-P2: booking SHALL complete in one PostgreSQL round-trip transaction (plus one pre-DB gateway-free zone) per the existing booking pattern — no per-gate round trips.
- NFR-P3: the new columns/indexes SHALL NOT be added — the existing `session(teacher_id)`, `session(student_id)` indexes suffice.

### Reliability / Failure modes
- NFR-R1: if the `applicants` row is deleted while the booking transaction is underway the lock read returns null and the booking fails `APPLICANT_NOT_FOUND` INSIDE the same transaction (TOCTOU closed).
- NFR-R2: if the evaluator's `teacher` row is deleted between scope check and insert the row-level lock (`FOR UPDATE`) held from the certification probe keeps the decision committed — no phantom evaluation bookings.
- NFR-R3: if the notification emission fails post-commit, the session row MUST NOT be rolled back (session integrity precedes the notification delivery; the engine isolates the wave and logs the failure without rethrowing to caller).

### Security / Privacy
- NFR-S1: no PII beyond `fullName` on the evaluator selector surface — administrative directory fields (email/phone/country) stay off this surface.
- NFR-S2: logging uses `logDomainError` codes + entity/entity-id only; no idempotency keys, request bodies, or identity payloads in logs.
- NFR-S3: the `myEvaluationSessions` query returns the same columns as `SessionPage` — no introspective extras.

### Operability
- NFR-O1: `bun run db push` will be required in all environments after merge (FK target change; the schema diff includes no data migration and no index drops).
- NFR-O2: the new code paths SHALL be bump-free in the local-dev auth (no new env keys).
- NFR-O3: Journey test SHALL NOT depend on fixtures in the seeded DB; it SHALL provision all fixtures inside its own `beforeAll` transaction so the suite is idempotent across ANSI sequences.

---

## 8. Constraints, Assumptions & Dependencies

### Constraints
- C1. NO new table: the loop lives on `session` (A.8 explicit decision: `session_type='teacher_evaluation'`). Adding a new wrapper entity would break Contract 4 (`docs/planning/TEAM_ALLOCATION.md:139-145`) and INV-S4's all-sessions-invariant coverage.
- C2. The pre-existing `session.student_id` NOT-NULL contract is INV-S4. It holds for evaluation rows too: we retarget the FK to `users.id`, preserving the NOT NULL/restrict semantics — applicants satisfy because the applicants row shares the users PK.
- C3. The `teacher_id` column remains pinned at `teacher.id` — evaluators ARE teachers; no change there.
- C4. Rubric submission (evaluations-write surface) is DEV2-007 — this plan does NOT write `evaluations` rows.
- C5. No GraphQL resolvers, services, repositories are touched outside the files this plan's tasks enumerate.
- C6. The `evaluations` table's `session` FK is pre-checked for set-null behavior — cancellation of an evaluation session does not cascade drop `evaluations` rows: the set-null cascade only applies to deletions, which never happen via lifecycle flows (sessions are only ever `cancelled`).
- C7. Existing UNIQUENESS on a claim key means an applicant and a student cannot share a successful key — replay collision is a zero-row replay error (DUPLICATE_REQUEST), never silent crown/mixing.

### Assumptions
- A1. The `applicants.status` will be `in_evaluation` only for cycles that should permit booking — false-positives from the purchase-time flip without active subscription are resolved by the subscription-active gate (REQ-4).
- A2. `is_evaluator=false` on a certified teacher is a valid permanent state (the directory-admin mutation already exists; no toggling mutation is added).
- A3. Evaluator roles are not entitlements — the surface never promises "I'm open for N more evaluations" (the online flag is informational display only; booking doesn't require it).
- A4. Booking window alignment with the 14-day verification-plan interval is NOT a booking constraint — the subscription being `active` + the loop having credits are the only gates (a booking that outlives the plan's interval is still a valid evaluation; status lifecycle of subscriptions does not have a booking-surface dependency).
- A5. Multiple concurrent loop cycles per applicant are impossible by construction (only one verification subscription can activate per payment reference; concurrent second purchase is allowed but the in-flight first activation finishes first — REDIS-topology wisdom in DEV2-005 shared-pipeline docstrings).

### Dependencies
- D-UP-1: DEV2-004 (Applicant lifecycle) — status vocabulary is their contract; this plan reads `status`, never writes it.
- D-UP-2: DEV2-005 (Purchase) — subscriptions activation + credit-skip hook; we enrich the read model of activation (`listByUserId` collector), never the writer.
- D-UP-3: DEV2-005's middleware hook — `payment.studentId === null` → credit skip. This plan does NOT rely on it for the booking decision (decision rule is purely subscription-state + credits).
- D-DN-1: DEV2-007 (Evaluation Rubric Scoring) — owns the `in_evaluation → passed|failed` transition; consumes the produced session rows.
- D-DN-2: DEV2-009 (Failed → Student conversion) — no sequencing constraint; conversion is post-loop and orthogonal.
- D-CO: DEV3 session lifecycle (already shipped) — reused unmodified (start/complete/cancel; sweeps accept NULL holds).

---

## 9. UX / Navigation Requirements (MANDATORY)

No new routes. The evaluation loop surface is anchored on the existing `teacher/dashboard` page's applicant status card — the only applicant-facing dashboard — and the evaluator-side visibility is automatic via the existing `teacher/sessions` page.

### New routes & access

None added. No new `app/(dashboard)/teacher/...` page.

### Route & Role-Based Access Matrix (existing surfaces carry the new capabilities)

| Route | Purpose | Existing Role Gate | Added capability in this plan |
|-------|---------|--------------------|-------------------------------|
| `/teacher/dashboard` | Teacher landing (status card slot included) | `{ roles: [UserRole.Teacher] }` | In-evaluation applicant sees evaluation-progress zone + booking dialog trigger |
| `/teacher/sessions` | Teacher sessions view | `{ roles: [UserRole.Teacher] }` | Certified evaluator session rows now include teacher_evaluation rows (no routing change; existing query's teacherId predicate covers it) |
| `/teacher/dashboard` (pending/cooldown/failed branches) | Surface lifecycle status | unchanged | No evaluation controls rendered in these zones |
| `/student/*` | Student pages | unchanged | untouched |
| `/(dashboard)/admin/*` | Admin surfaces | existing | untouched |

### Sidebar Navigation Integration

- **Group**: Teacher items between existing items — **no new entry** is added. The booking trigger survives inside the in-evaluation status-card zone; the navigation policy stays minimal and keeps the sidebar tight (`frontend/views/dashboard/nav/navItems.ts:141-147` is unchanged).
- **No bottom navigation**: the project has none (the Drawer covers mobile; senior-level decision recorded in DEV2-005's plan — unchanged here).

### Per-Audience rendering

| Audience | What they see for this feature |
|----------|-------------------------------|
| Applicant (in_evaluation) | Status card progress ("X / 5 evaluation sessions booked") · "Book evaluation" CTA · evaluator chooser dialog |
| Applicant (pending / cooldown / failed / passed) | No evaluation booking UI (the zone is absent) |
| Certified teacher who IS an evaluator | Existing sessions list shows evaluation rows received; a session-intent chip reads "Evaluation" (existing copy `intentEvaluation`) |
| Certified teacher non-evaluator | Nothing |
| Student | Nothing |
| Parent | Nothing |
| Admin | Nothing new in this plan (future admin-heavy features like re-evaluation admin overrides belong to the DEV2-013+ chain) |

### Permission mapping (components)

| Component / route | Permission boundary |
|-------------------|---------------------|
| `ApplicantEvaluationZone` (new zone inside ApplicantStatusResolution path) | `authenticated` + service-level in_evaluation gate (no self-gating in the component) |
| `EvaluationBookingDialog` | Same service-level gates; it opens only from the evaluation zone (never mounted when profile does not qualify) |
| `myEvaluationLoopStatus` query | `authenticated`; service-level gate returns a fixed `null` for ineligible applicants (oracle-safe posture mirrors `myApplicantProfile` returning `null` for certified teachers) — see plan.md §5.2 for the exact type |
| `availableEvaluators` | `authenticated`; service gate rejects when the applicant cannot book (typed denial — the data surface is a booking surface, not open browsing of the certified directory) |
| `myEvaluationSessions` | `authenticated`; participant-scope predicate (`session.student_id = caller` + `session_type=teacher_evaluation`) inside the repo |

### Translation system (all strings compile-time)

- Client components: `useAppTranslation(Errors)` / `useAppTranslation(Applicant)` — property access only (`t.evaluationLoopComplete`, `t.noEvaluationSessionsRemaining`); NEVER function form.
- Server components/services: `getServerTranslations(locale)` (for resolvers use `ctx.t('...')` pattern).
- NO Translation enum; NO two-arg `getTranslations`; NO `next-intl`; NO hook-form `t('key')`.
- New keys added to `errors` and `applicant` namespaces per plan §6 (i18n spec) with en+ar leaves + parity test extension.

## 10. Success Criteria (Definition of Done)

1. INV-TV2 hold: any applicant/evaluator pair with a live (non-cancelled) evaluation session blocks a second booking between them, regardless of concurrency (race test included).
2. The capacity rules satisfy both ticket phrasings: a 6th booking after 5 completions fails `EVALUATION_LOOP_COMPLETE`; a booking with 0 remaining credits fails `NO_EVALUATION_CREDITS_REMAINING` — both as `ConflictError`s so the transport is 200 + GraphQL errors (never REST 422s).
3. All surfaces pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` and the full `bun quality-gate` run at PR head remains green.
4. The journey test runs clean including a deterministic failure assertion of the foreign-caller replay probe (test-level constant-time probe).
5. All new artifacts are recorded in `outcome/*` per task and the traceability matrix in tasks.md has zero unresolved items.
6. No `package.json`/`drizzle.config` env keys added; no new dependencies.

---

## 11. Deferred-items Ledger (seed, live file at deferred-items.md)

| ID | Deferred Item | Target owner | Notes |
|----|---------------|--------------|-------|
| D1 | Scoring/threshold (`≥80%`) surface | DEV2-007 | Not in this plan; must not create evaluation rows |
| D2 | Admin re-evaluation payment deduction | DEV2-0xx series (Re-evaluation ticket) | Contract 5 scope |
| D3 | Evaluation rubric submit endpoint | DEV2-007 | Separate surface, new GraphQL input, new table write |
| D4 | Parent-supply chain visibility of evaluation rows | DEV2/DEV3 cross (parent portal milestone) | Not part of booking |

---

## 12. Glossary

| Term | Definition |
|------|------------|
| Applicant | `users` row `role=teacher` with an `applicants` row (shared PK) and no `students` row |
| Certified | Teacher row with `is_approved=true` |
| Evaluator | Certified teacher with `is_evaluator=true` |
| Evaluation session | `session` row with `session_type='teacher_evaluation'` AND `intent='evaluation'` |
| Credit | One booking entitlement from a verification subscription; count = plan's `sessionCount` (5); never stored |
| Non-cancelled | `status != 'cancelled'` (scheduled/started/completed/disputed) |
| Used evaluator | Target teacher whose non-cancelled evaluation session exists in the applicant's current cycle |
| Cycle / loop cycle | Sessions scoped `created_at >= startDate` of the LATEST activated verification subscription owned by the applicant |
| Loop complete | Applicant has all 5 sessions `completed` in the current cycle |
| Claims / idempotency claim | `session_request_idempotency` row inserted under savepoint; key unique |
| 422 semantics | GraphQL over HTTP returns HTTP 200 + `errors[].extensions.code`; the ticket's "422" is the code-level truth not a transport status |

---

## 13. Review Checklist (exhaustive — templates/hidebox compliance)

- [x] Baseline: REQ-0 captured and first task written.
- [x] Translation system: REQ-0.5, REQ-9.
- [x] UX/Navigation: section 9 complete (no new routes; zones covered for all relevant audiences).
- [x] Cross-actor journey defined: section 6 includes actor table, ordered steps, cross-actor EARS criteria.
- [x] EARS: every acceptance criterion uses WHEN/IF/THEN phrasing (or table row shorthand) and includes denial cases.
- [x] Roles-by-actor matrix: REQ-13's table.
- [x] Edge cases: 0 remaining, evaluator decertified mid-flight, replaying idempotency keys, concurrent final-credit race, re-purchase cycle.
- [x] Dependency-wise: upstream links and downstream consumer artifacts listed.
- [x] Security: REQ-10 / REQ-11.
- [x] Performance budget declared.
- [x] No new table introduced (deliberate, invariant-compliant: the existing `session` table's A.8/A.10 columns are its designated host).

---

*End of specs.md. Cross-references: plan.md (design and concurrency); tasks.md (implementation queue); deferred-items.md (live ledger).*
