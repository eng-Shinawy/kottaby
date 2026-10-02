# Evaluation Rubric Scoring (≥80 Per-Evaluation Threshold)

> Contract doc for the evaluator-facing rubric submission flow and the five-evaluator
> finalization that writes the applicant verdict (and, on FAIL, the atomic
> applicant → student conversion — `docs/teachers/applicant-student-conversion.md`).
> Sibling docs: `docs/teachers/evaluation-loop-booking.md` (how the five evaluation
> sessions were booked and completed), `docs/teachers/applicant-lifecycle.md` (the
> `applicants` status machine this flow finalizes), `docs/teachers/student-evaluation-submission.md`
> (the `evaluations` table's other writer), `docs/teachers/verification-plan-purchase.md`
> (the purchase that opens the cycle and, after a failure, the re-purchase the cooldown gates),
> and `docs/teachers/applicant-student-conversion.md` (the conversion the FAIL verdict applies).

**Domain:** Teachers / applicant evaluation rubric scoring & finalization
**Status:** Implemented and verified

## What this flow does

The last leg of the teacher-verification loop. An applicant's five booked evaluation
sessions (5 distinct certified evaluators, per the booking flow) are completed one by
one; each evaluator then scores the applicant ONCE against the rubric — a 0–100 score,
mandatory observations, and a weakness area exactly when the score is below 80. The
submission is write-once per (session, evaluator). The **5th submission is the only
trigger for the verdict**: inside that submission's own transaction, the flow reads the
cycle's quorum and, at exactly 5 scored submissions, finalizes the applicant — `passed`
(mints or elevates the teacher row, flips `applicants.status` to `passed`) or `failed`
(stamps `applicants.status='failed'` + `cooldown_until` from the primary weakness area's
duration, then atomically converts the applicant to a `student` — see the conversion
contract). Below the quorum, a submission returns alone: the row is stored, the applicant
stays `in_evaluation`, nothing else changes.

No money moves anywhere in this flow, no wallet rows exist (the loop was prepaid), and
the flow writes ONLY to `evaluations`, `teacher` (PASS certification), `students` +
`users.role` (the FAIL conversion — `docs/teachers/applicant-student-conversion.md`),
and the two lifecycle columns on `applicants` (`status`, `cooldown_until`). It never
touches `users.suspended*`.

**Surfaces** (no new routes — the evaluator acts from the existing sessions list):

| Surface | Path |
|---|---|
| Mutation | `submitRubricEvaluation(input: RubricEvaluationSubmitInput!, sessionId: ID!): RubricEvaluation!` — `backend/graphql/mutation/evaluation-rubric.mutation.ts` |
| Pending read | `myRubricPendingSessions(page, pageSize): SessionPage!` — `backend/graphql/query/teachers/evaluation-rubric.query.ts` |
| Own-submission read | `myRubricEvaluation(sessionId: ID!): RubricEvaluation` (nullable — unsubmitted reads null) — same file |
| Service | `EvaluationRubricService` — `backend/services/teachers/evaluation-rubric.service.ts` (boundary + composition), `evaluation-rubric.helpers.ts` (in-tx pipeline) |
| Pothos types | `backend/graphql/pothos/teachers/evaluation-rubric.pothos.ts` (backed by `@/backend/types` only) |
| UI | `frontend/views/teacher/sessions/` (`RubricEvaluationDialog.tsx`, `useRubricEvaluation.ts`, `teacherSessionCacheArms.ts`) |

Every surface declares the explicit `$all { authenticated, role: [UserRole.Teacher] }`
scope conjunction (the `$all` wrapper is load-bearing — see
`docs/teachers/applicant-lifecycle.md` §3 for the UNAUTHORIZED/FORBIDDEN pairing).
Identity is server-derived end-to-end: the resolver delegates `ctx.user.id` + `ctx.locale`
only; the ONLY client-owned values are the session locator and the sealed
`{ score, notes, weaknessArea }` payload.

## The submission pipeline (fixed gate order — never reordered)

`EvaluationRubricService.submitRubricEvaluation` runs, in order:

1. **Pre-DB validation (zero reads)** — malformed ids die as `VALIDATION`; then the input
   contract in one pass: score a whole number 0–100 (`RUBRIC_SCORE_INVALID`), observations
   non-empty and ≤ 2000 chars (`RUBRIC_NOTES_REQUIRED`), the weakness iff-rule in BOTH
   directions (`RUBRIC_WEAKNESS_REQUIRED` below threshold / `RUBRIC_WEAKNESS_NOT_ALLOWED`
   at or above), and the fail-closed weakness vocabulary (`RUBRIC_WEAKNESS_INVALID` — only
   `tajweed`/`hifz` pass `isRubricWeaknessArea`). Notes are TRIMMED here; the trimmed value
   is the only thing ever persisted.
2. **Actor governance** — a deleted/blocked/suspended evaluator cannot score
   (`assertActorGovernanceClean`).
3. **One transaction** (`withTransaction`) with the in-tx gates in fixed order:
   - **Session gate** — the session must exist, be `teacher_evaluation` + `evaluation`
     intent, be OWNED by the caller (`teacher_id` = the evaluator), and be `Completed`.
     Unknown / foreign / mistyped / prior-cycle sessions share ONE byte-identical
     `SESSION_NOT_FOUND` (no existence oracle; history is not scorable — a session created
     before the applicant's current cycle start folds into the same denial). An owned
     but uncompleted session is the distinct `RUBRIC_SESSION_NOT_COMPLETED`.
   - **Certification re-check, fresh in-tx** (`FOR UPDATE`) — `TEACHER_NOT_CERTIFIED`
     unless `is_approved && is_evaluator` hold on the locked row.
   - **Applicant lock + status gate** — `findForBookingGate` locks the evaluated row
     (`FOR UPDATE` from the status read onward). This lock is the per-applicant
     finalization mutex: concurrent 4th/5th submissions serialize through it so EXACTLY
     one finalizes. Non-`in_evaluation` is `APPLICANT_NOT_IN_EVALUATION`. The evaluated
     subject is ALWAYS `session.student_id` — never a client-supplied id (BOLA).
   - **Duplicate pre-check** (optimization only) → `EVALUATION_ALREADY_SUBMITTED`.
   - **Sealed insert** — the payload is built field-by-field (evaluated/evaluator/session
     resolved server-side; never spread from client input). A PG `23505` on the unique
     arbiter maps to the SAME `EVALUATION_ALREADY_SUBMITTED` — the index, not the
     pre-check, is the race authority, and there is NO idempotency-key machinery on this
     flow: replay protection IS the write-once index plus the terminal-verdict gates.
   - **Quorum read under the held lock** — the cycle's scored submissions
     (`listCycleRubricSubmissions`: same applicant, `teacher_evaluation` + `completed`
     sessions, `score IS NOT NULL`, `session.created_at >= cycleStart`). Below 5 → return
     alone. At 5 → finalize in the SAME transaction (below).

Every denial emits exactly ONE bounded `logger.logDomainError` (code + entity + entity id
only — never the observations, never a counterparty value); happy paths log nothing.

## Per-evaluation ≥80 semantics — the 80/79 boundary

The pass decision is a **per-evaluation minimum, never a mean**:

```text
PASS  ⇔  every one of the 5 scores ≥ 80        (RUBRIC_PASS_THRESHOLD = 80)
FAIL  ⇔  at least one of the 5 scores < 80
```

A mean of 80+ does NOT pass while any single evaluation sits below 80:
`{100, 100, 79, 100, 100}` has mean 95.8 and FAILS. Exactly-80 passes (the boundary is
inclusive on the pass side; 79 is the highest failing score). The boundary pair is pinned
by tests at both the service and journey layers.

The weakness area is governed by the **iff-rule per submission**: a weakness area is
REQUIRED exactly when that submission's own score is below 80, and FORBIDDEN exactly when
it is 80 or above — even though the weakness only ever influences the verdict of a FAILING
finalization. The evaluator dialog mirrors the rule client-side (the weakness select
renders only while the entered score is below 80, and resets when the score leaves the
band); the server remains the authority.

## Failure-area derivation & cooldowns

On FAIL the flow derives the **primary failure area** from the cycle's submissions:

- **Lowest score wins.** Ties resolve to the **earliest `created_at`** — the quorum feed
  is ordered `created_at ASC, id ASC`, so the first minimum wins a stable scan.
- The derived area's weakness column is fail-closed: a missing or foreign stored value is
  a tripwire, not a default.

The cooldown is then computed from the ONE captured instant:

| Primary failure area | Cooldown |
|---|---|
| `tajweed` | `now + 30 days` |
| `hifz` | `now + 90 days` |

`transitionToFailed(userId, cooldownUntil, tx)` (`backend/db/repo/teachers/applicant.repository.ts`)
stores the instant **verbatim** — ONE guarded UPDATE (`status='in_evaluation'` folded into
WHERE, `.returning()`). Zero rows matched ⇒ the applicant was already `passed`/`failed`,
never `in_evaluation`, or absent ⇒ the service raises `APPLICANT_ALREADY_FINALIZED` and
rolls the whole transaction back. The write is duration-agnostic by design: durations are
a write-time concern of THIS flow; the re-purchase reader documented in
`docs/teachers/applicant-lifecycle.md` (§2) implements a pure strict-`>` read of
`cooldown_until` at `backend/services/teachers/applicant-lifecycle.service.ts` — a
cooldown that expires exactly NOW no longer blocks. That deliberate two-source split is
recorded there and is not re-litigated here. The cooldown state machine that consumes this
stamp — the derived `cooldownState` read-model, the admin extension primitive, and the
account-governance boundary — is specified in `docs/teachers/applicant-cooldown.md`.

## Finalization paths (count = 5, in the SAME transaction)

**PASS** — every score ≥ 80:

1. On a nested savepoint, `insertColdStartCertified(studentId, false, tx)` mints the
   teacher row certified but NOT an evaluator (`is_approved = true, is_evaluator = false`).
2. A `23505` there (the applicant somehow already has a teacher row) takes the **elevate
   arm**: lock the pre-existing teacher row and — demotion guard — either no-op it
   (already approved) or `elevateToCertified` it **with the LOCKED row's own `isEvaluator`
   flag**. A certified evaluator who passes the loop stays an evaluator; the flow never
   minted the new teacher as one, and never demotes an existing one to satisfy the fresh-
   teacher default.
3. `finalizeOnCertification` flips `applicants.status → 'passed'` and clears
   `cooldown_until`. A zero-row finalize ⇒ `APPLICANT_ALREADY_FINALIZED` + full rollback
   (whole-transaction atomicity: no committed state can exist between the 5th submission and the
   verdict — a rejected in-tx notification emit rolls the verdict back with it).

Result state on PASS: `teacher` row (`is_approved=true`, `is_evaluator=false` unless it
pre-existed as an evaluator), `applicants.status='passed'`, `cooldown_until` NULL, and
`users.role` restored to `teacher` — the certification finalization applies the guarded
`student` → `teacher` flip (a never-converted applicant is already `teacher`: silent
no-op), and any `students` row left by a prior conversion is preserved untouched as
historical data (`docs/teachers/applicant-student-conversion.md`).

**FAIL** — any score < 80: derive the primary failure area (above) → compute the cooldown
→ ONE guarded `transitionToFailed` → then, in the SAME transaction, the atomic
applicant → student conversion: a `students` role-child row on the shared PK (zeroed
balances, no parent linkage, a fresh unique `KSB-` handshake code) plus the guarded
`users.role` flip `teacher` → `student`. No `teacher` row, no `users.suspended*` write.
The `applicants` row is untouched by the conversion itself — `status='failed'` and the
stamped cooldown stand as the verdict wrote them, so the `students` record co-exists
with the applicant row (the lifecycle doc's co-existence contract). The conversion makes
the student-class privileges real: the account IS a student while it serves the cooldown
(subscribe + attend are authorization-reachable), and re-entry is the re-purchase flow's
job after the cooldown. A conversion failure rolls the whole verdict transaction back
(fail-closed); a replayed finalization is a safe no-op. Full contract — atomicity,
idempotency, re-certification restoration, token self-heal, deferred boundaries:
`docs/teachers/applicant-student-conversion.md`.

## Notifications — receipt discipline

The finalization notification (pass or fail) is composed INSIDE the transaction in the
APPLICANT'S persisted locale (`users.locale`, fallback `defaultLocale`) from the
`applicant` namespace keys (`evaluationPassedTitle/Body`, `evaluationFailedTitle/Body`;
the failed body carries exactly one `{cooldownUntil}` placeholder, expanded server-side
with a locale-formatted stamp through the shared `expandCooldownTemplate` composer).
`emitForUser(…, tx)` runs in-tx; the receipt + recipient locale are returned OUT of the
transaction; `publishReceipts` runs STRICTLY post-commit on the production path only
(suppressed entirely on a caller-owned transaction). The publish can therefore never be
retried into existence and never rolls back the verdict. Under-quorum submissions emit
nothing.

## Reads

- **`myRubricPendingSessions`** — the caller's own completed `teacher_evaluation` sessions
  with NO own evaluation row yet (LEFT JOIN anti-join on the caller's `evaluations` rows,
  the join binding BOTH the session link and the evaluator id). Another evaluator's
  submission on a session does NOT hide it from a different evaluator. Certification-gated
  with an oracle-safe EMPTY page for non-certified callers (one bounded log, never an
  error). Pagination normalizes sane-fallback (page ≥ 1, pageSize 1..100 default 25, never
  throws) and echoes honestly. A session vanishes from the caller's pending page the
  moment that caller submits — the anti-join IS the progress projection.
- **`myRubricEvaluation`** — the (session, evaluator) pair is the only scope; unknown and
  foreign pairs share the identical `SESSION_NOT_FOUND`. A hit returns the sealed read
  model: id, sessionId, evaluatorId, evaluatedId, score, weaknessArea, createdAt, and the
  LIVE `applicantStatus` — deliberately NO `notes` (observations stay server-side; their
  visibility beyond the writing evaluator is a future administrative surface). A missing
  applicant row or a foreign stored status fails closed (`APPLICANT_STATUS_CORRUPT`).

## Error codes

All denials ride `errors[].extensions.code` with localized messages (the
code ↔ `errors`-key bijection and the Apollo map rows live in
`docs/graphql/domain-error-extensions-code.md`); the flow's seven custom codes are
registered there.

| `extensions.code` | Producer | Client semantics | i18n key (`errors`) |
|---|---|---|---|
| `RUBRIC_SCORE_INVALID` | pre-DB input validation | score must be a whole number 0–100; dialog stays open for retry | `rubricScoreInvalid` |
| `RUBRIC_NOTES_REQUIRED` | pre-DB input validation | observations required (1–2000 chars) | `rubricNotesRequired` |
| `RUBRIC_WEAKNESS_REQUIRED` | pre-DB iff-rule (below 80) | pick a weakness area before submitting | `rubricWeaknessRequired` |
| `RUBRIC_WEAKNESS_NOT_ALLOWED` | pre-DB iff-rule (at/above 80) | clear the weakness area to submit | `rubricWeaknessNotAllowed` |
| `RUBRIC_WEAKNESS_INVALID` | fail-closed vocabulary guard | weakness must be Tajweed or Hifz | `rubricWeaknessInvalid` |
| `RUBRIC_SESSION_NOT_COMPLETED` | completion gate | the owned session is not completed yet | `rubricSessionNotCompleted` |
| `APPLICANT_ALREADY_FINALIZED` | zero-row finalize (`transitionToFailed` / `finalizeOnCertification`) | the verdict already exists; nothing to retry | `applicantAlreadyFinalized` |

Reused codes with established meanings: `VALIDATION` (malformed ids), `SESSION_NOT_FOUND`
(unknown/foreign/mistyped/prior-cycle session and read pairs — oracle-safe),
`TEACHER_NOT_CERTIFIED`, `APPLICANT_NOT_IN_EVALUATION`, `EVALUATION_ALREADY_SUBMITTED`
(both the pre-check and the `23505` map), plus the scope-level `UNAUTHORIZED`/`FORBIDDEN`
and `HANDSHAKE_EXHAUSTED` — the conversion's handshake-retry exhaustion, which rolls the
whole verdict transaction back (see the conversion contract's error table).

## The two write paths on the `evaluations` table

The `evaluations` table has exactly two writers, both session-linked and both arbitrated
write-once by the SAME index — `evaluations_session_evaluator_unique`
(`UNIQUE (session_id, evaluator_id)`, `backend/db/schema/teachers/evaluations.ts`):

| | Student→teacher session rating | Rubric scoring (this flow) |
|---|---|---|
| Mutation | `submitTeacherEvaluation` | `submitRubricEvaluation` |
| `score` meaning | `rating × 20` (whole stars 1–5) | direct 0–100 rubric score |
| `notes` | unused (no input field exists) | mandatory, trimmed, ≤ 2000 chars |
| `weakness_area` | always NULL | set iff score < 80 |
| Row visibility | feeds the teacher `average_rating` aggregation (`session_id`-scoped) | feeds the cycle quorum read + verdict |
| 23505 mapping | `EVALUATION_ALREADY_SUBMITTED` | `EVALUATION_ALREADY_SUBMITTED` |

The raw `23505` is never caught in the repository — mapping it is each service's decision.
Both insert paths join the caller's transaction (`tx` required); the unique index is the
race authority for both. `session_id` is nullable at the column level (SET NULL if the
session row itself is ever deleted — the evaluation survives as a standalone record), but
both live write paths always populate it: today's NULL rows can only be historical
debris, which the NULL-distinct unique semantics leave inert for write-once arbitration.

## Related documents

- `docs/teachers/applicant-student-conversion.md` — the atomic applicant → student
  conversion the FAIL verdict applies in this same transaction, and the pass-path
  role restoration.
- `docs/teachers/applicant-lifecycle.md` — the `applicants` state machine this flow
  finalizes; the strict-`>` cooldown read and the failed-applicant privilege rules.
- `docs/teachers/evaluation-loop-booking.md` — the booking leg (5 credits, 5 distinct
  evaluators, the FK retarget that makes the applicant the session's student leg).
- `docs/teachers/student-evaluation-submission.md` — the `evaluations` table's other
  writer and the average-rating forward contract.
- `docs/teachers/verification-plan-purchase.md` — the purchase that opens the cycle and
  the guarded re-purchase that ends a cooldown.
- `docs/graphql/domain-error-extensions-code.md` — the custom-code registry these seven
  codes are registered in; `docs/graphql/error-handling-contract.md` — transport taxonomy
  and client mapping.
