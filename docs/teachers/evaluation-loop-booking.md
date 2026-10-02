# Teacher Evaluation Loop Booking (5 Distinct Evaluators)

> Contract doc for the teacher-applicant evaluation-loop booking flow (DEV2-006).
> Sibling docs: `docs/teachers/applicant-lifecycle.md` (the `in_evaluation` state this
> flow reads), `docs/teachers/verification-plan-purchase.md` (the purchase that starts
> the cycle), and `docs/sessions/session-lifecycle.md` (the session state machine the
> evaluation rows ride).

**Domain:** Teachers / applicant evaluation loop
**Status:** Implemented and verified (service + GraphQL + journey landed; docs
cross-verified against the shipped surface by the Task 13 knowledge-propagation agent).

## What this flow does

An applicant whose `applicants.status='in_evaluation'` and whose verification
subscription is ACTIVE books evaluation sessions with certified evaluators, one mutation
call per session, up to the paid-for 5. Each booking materializes as a real `session`
row — `session_type='teacher_evaluation'`, `intent='evaluation'`, `status='scheduled'`,
`fee=null`, `fee_held=false`, `held_balance_lane=null`,
`confirmation_deadline = now + 24h` — with the evaluator in `teacher_id` and the
applicant's `users.id` in `student_id` (see "FK retarget" below for why that is not a
`students` row). No wallet, balance-lane, `students`, `student_payments`, or
`teacher_transaction` rows are ever created by a booking: the loop is paid for up front
by the verification-plan purchase, so the session itself is money-free.

The full journey: registration lands `pending` → the verification-plan purchase flips
`pending → in_evaluation` and activates the subscription (5 credits) → the applicant
books up to 5 evaluation sessions with 5 distinct certified evaluators → each evaluator
sees the row in `myTeacherSessions` and runs the existing start/complete lifecycle →
evaluation-aggregation (a downstream flow) eventually writes the `in_evaluation →
passed | failed` verdict. This flow owns ONLY the middle leg: booking, its gates, and
the read surfaces that expose loop progress.

**Cross-actor loop state (what each side sees):**

| Transition | Shared-state change | Observer effect |
|---|---|---|
| subscription activates (purchase flow) | cycle starts — 5 credits | applicant sees progress; evaluators see nothing yet |
| applicant books evaluator E | +session row; booked=1, remaining=4 | E gets the `session_request` notification (recipient and locale server-derived); applicant sees the row |
| applicant cancels a booking | booked decremented; E's slot freed | row appears cancelled in both views |
| evaluator starts / completes | status transitions; completed++ | applicant's progress grows; row persists |
| booked=5, all completed | further booking attempt | `EVALUATION_LOOP_COMPLETE` |
| booked=5, not all completed | further booking attempt | `NO_EVALUATION_CREDITS_REMAINING` |
| new subscription activates (re-purchase after cooldown) | fresh cycle | booked/completed/used-evaluator memory resets |

## Credit derivation (5 credits, one cycle per activation)

Credits are NOT a stored counter — they are derived per cycle, inside the booking
transaction, under the applicant row lock:

- **Cycle identity** — the CURRENT ACTIVE verification subscription owned by the
  applicant (plan resolved by the shared `VERIFICATION_PLAN_TITLE` constant, the same
  source the seed uses). `cycleStartDate` is that subscription's start; no active row
  means no cycle (`VERIFICATION_NOT_ACTIVE`). A NEW activation (re-purchase after the
  cooldown, per the lifecycle guard) starts a FRESH cycle — counts and evaluator memory
  reset; older cycles never leak into the current one.
- **Counts** — `booked` = non-cancelled evaluation sessions in the current cycle;
  `completed` = the `completed` subset; `remaining = 5 − booked` (5 =
  `VERIFICATION_PLAN_SESSION_COUNT`). Because cancelled rows drop out of `booked`, a
  cancel immediately restores the credit.
- **Exposure** — `myEvaluationLoopStatus` returns
  `{ bookedCount, completedCount, remainingCredits, cycleStartDate }` as a zero-shape
  (all-zero counts, `cycleStartDate: null`) when no cycle is active; certified teachers
  and non-applicants get the same zero-shape — no read leak. `availableEvaluators`
  returns the certified evaluators NOT
  yet used in the current cycle (paginated; defaults page=1, pageSize=25, pageSize max
  100), gated to in-loop applicants — reads are booking surface, so an out-of-loop
  caller learns nothing (`VERIFICATION_NOT_ACTIVE`, oracle-safe).
- **Evaluator eligibility** — a `teacher` row with `is_approved = true` AND
  `is_evaluator = true`, locked `FOR UPDATE` at booking time; the locked values are
  what the insert commits against.

## Distinct-evaluator rule (INV-TV2)

The 5 verdicts must come from 5 **distinct** certified evaluators. The used-evaluator
memory (`usedEvaluatorIds`) is computed ONLY from non-cancelled evaluation rows in the
CURRENT cycle:

- Booking an evaluator with any non-cancelled evaluation row in this cycle →
  `EVALUATOR_ALREADY_USED` (`evaluatorAlreadyUsed`).
- Cancelling a scheduled (or started) evaluation session frees that evaluator — a
  cancelled evaluation session is "no evaluation happened" — and re-booking the SAME
  evaluator afterwards is allowed.
- The memory resets with a new cycle: an evaluator used in an OLDER cycle is bookable
  again as soon as the current cycle has no non-cancelled row with them.
- Memory is per-cycle and one-directional: "booked-but-not-in-this-cycle" never
  applies.

## Booking, cancel, and rebook semantics

**Booking** (`bookEvaluationSession`) is ONE transaction with a fixed gate order —
status/subscription/capacity/distinctness probed under the applicant `FOR UPDATE` lock
before any write:

1. Pre-DB boundary guards: positive-safe-integer caller/evaluator ids, carryable
   idempotency key (`VALIDATION` denials before any read) → actor-governance re-check
   (deleted/blocked/suspended cannot book).
2. In-tx: applicant lock-read — no `applicants` row → `APPLICANT_NOT_FOUND`;
   `status !== 'in_evaluation'` → `APPLICANT_NOT_IN_EVALUATION` (this status gate fires
   FIRST — the in-tx ordering is binding).
3. Cycle probe under the same lock — no active verification subscription →
   `VERIFICATION_NOT_ACTIVE`.
4. Capacity: `booked >= 5` → `EVALUATION_LOOP_COMPLETE` if all 5 are completed, else
   `NO_EVALUATION_CREDITS_REMAINING`.
5. Distinctness: evaluator in `usedEvaluatorIds` → `EVALUATOR_ALREADY_USED`.
6. Evaluator certification + governance lock: missing `teacher` row → `TEACHER_NOT_FOUND`;
   `is_approved !== true` or `is_evaluator !== true` → `TEACHER_NOT_CERTIFIED`;
   a governance-unclean account (deleted, blocked, or suspended) collapses into the same
   `TEACHER_NOT_FOUND` (checked after certification, before the claim).
7. Idempotency claim insert (savepoint-bracketed), session insert, claim `session_id`
   backfill — claim and session commit atomically.
8. Post-commit only: the existing `session_request` notification wave reaches the
   evaluator (recipients and locale server-derived). Zero `notifications` rows exist
   before commit.

**Cancel / start / complete** ride the EXISTING session-lifecycle primitives —
evaluation rows add no new lifecycle surface:

- `cancelSessionOnce` — either participant, from `scheduled`/`started`; sets
  `fee_held=false` (already false), decrements `booked` (non-cancelled projection),
  frees the evaluator slot, and restores the credit. No new notification fires.
- `startSessionOnce` / `completeSessionOnce` — session-type-agnostic; the evaluator
  starts and completes from `myTeacherSessions` exactly like student sessions, with the
  same `teacher.is_online` lock lifecycle. No money moves at completion because
  nothing was ever held.
- `confirmStudentCompletionOnce` never matches an evaluation row (its guarded predicate
  requires `fee_held = true`) — zero wallet writes, zero lane writes.
- Confirmation sweeps treat evaluation rows exactly like student rows: a scheduled
  row whose deadline lapsed auto-cancels (with NO lane refund, since
  `held_balance_lane = null`), and an unconfirmed completed row auto-cancels the same
  way — closing the handshake on either leg.

**Rebook** is just another booking: the applicant picks any still-eligible evaluator
(distinctness re-evaluated against the current non-cancelled set) while credits remain.

## 6th-booking denial codes

The two ceiling denials are DISTINCT on purpose (the ticket's two 422 phrases):

| Situation | Code |
|---|---|
| `booked >= 5` AND all 5 completed | `EVALUATION_LOOP_COMPLETE` — the loop is genuinely finished |
| `booked >= 5` AND fewer than 5 completed | `NO_EVALUATION_CREDITS_REMAINING` — slots exhausted with unfinished sessions; nothing to do but wait for completion/cancel |
| Any other denial | see the error-code table below |

## Replay & idempotency

Same contract as student booking, same table — the generic
`session_request_idempotency` claim model, no evaluation-specific idempotency table:

- The key rides the `x-idempotency-key` header (client-minted UUID), captured once in
  `createGraphQLContext`; it is never an argument, never trimmed, never logged.
- The claim's `user_id` is the APPLICANT's `users.id`; claim insert is
  savepoint-bracketed, the claim's `session_id` is backfilled in the same transaction,
  and a failed booking rolls its claim back with the transaction (the key is released
  and reusable).
- **Replay-by-throw:** a same-caller key replay raises `ConflictError('DUPLICATE_REQUEST')`
  and NEVER returns the pre-existing session row — the replayed attempt's own partial
  writes roll back, so a network retry can never book twice. The success-equivalent
  experience is the client's (map the 409 to an info notice).
- **Foreign-caller key:** a key spent by a different user is denied with the
  oracle-safe `SESSION_NOT_FOUND` — another user's claim is never surfaced.
- PG `23505` is detected via a cycle-safe cause-chain walker on the error code, never
  by branching off the message.

## Wire contract

`bookEvaluationSession(input: BookEvaluationSessionInput!): Session!`
(`backend/graphql/mutation/evaluation-booking.mutation.ts`) — the ONLY client-owned field
is `evaluatorId`; identity comes from the session, the idempotency key from the header.
BOLA-proof by construction: `evaluatorId` is a data input, not an identity.

Reads (`backend/graphql/query/teachers/evaluation-booking.query.ts`):

- `myEvaluationLoopStatus: EvaluationLoopStatus` —
  `{ bookedCount, completedCount, remainingCredits, cycleStartDate }`; zero-shape
  (`null`) when no active cycle.
- `availableEvaluators(page, pageSize): EvaluationEvaluatorOptionPage` —
  `{ id, fullName, isOnline, averageRating (decimal-as-string), subjects }` per item;
  used-in-cycle evaluators excluded; denied outside an active cycle
  (`VERIFICATION_NOT_ACTIVE` — oracle-safe: no evaluator identities revealed).
- `myEvaluationSessions(filter, page, pageSize): SessionPage` — the caller's own
  `session_type='teacher_evaluation'` rows, optional status filter; empty page for
  non-applicants by construction (the predicate never matches them).

The existing `Session`/`SessionPage` types are reused verbatim; every page member
carries `id` for Apollo cache normalization. All mutations/queries are
`authenticated: true` at the GraphQL layer — the applicant/status gates are
service-level, so post-certification or wrong-role callers resolve cleanly instead of
being hidden by a scope.

## Error codes (all ride `errors[].extensions.code`, HTTP 200)

`UNAUTHORIZED` · `VALIDATION` · `FORBIDDEN` (governed caller — deleted, blocked, or
suspended actor cannot book; raised by the shared
`assertActorGovernanceClean` re-check before any read) · `APPLICANT_NOT_FOUND` ·
`APPLICANT_NOT_IN_EVALUATION`
(`applicantNotInEvaluation`) · `VERIFICATION_NOT_ACTIVE`
(`verificationSubscriptionNotActive`) · `EVALUATION_LOOP_COMPLETE`
(`evaluationLoopComplete`) · `NO_EVALUATION_CREDITS_REMAINING`
(`noEvaluationCreditsRemaining`) · `EVALUATOR_ALREADY_USED` (`evaluatorAlreadyUsed`) ·
`TEACHER_NOT_FOUND` (also the governance-collapse denial: a governed-but-certified
evaluator — deleted, blocked, or suspended — is denied with the SAME oracle-safe
not-found code as an unknown id; the picker already hides such evaluators, so "not
found" is the honest, privacy-preserving answer that burns no credit) ·
`TEACHER_NOT_CERTIFIED` · `DUPLICATE_REQUEST` · `SESSION_NOT_FOUND`.

Denials are localized through the compile-time translation system (`errors` and
`applicant` namespaces); no user-facing string is hardcoded. UI copy keys include the
zone title (`evaluationZoneTitle`), progress line
(`evaluationProgressLine` — `{booked} of {total} booked · {completed} completed ·
{remaining} left`), the booking dialog labels, and the empty-evaluators notice
(`availableEvaluatorsEmpty`); Arabic translations ship alongside.

## FK retarget: `session.student_id` → `users.id`

Evaluation bookings exposed a structural, not behavioral, problem: `session.student_id`
was NOT NULL referencing `students.id`, but applicant teacher-role users have NO
`students` row (an invariant locked by both registration and the verification-purchase
journey). The single schema delta of DEV2-006 retargets that FK to `users.id`
(shipped at `backend/db/schema/classes/session.ts:63`; `db/schema.dbml` edge
retargeted to match):

- `students.id` re-uses the `users.id` PK — identical values — so existing rows need no
  data migration and every student flow is unaffected.
- Every existing consumer of `student_id` already treated it as a `users.id`
  semantically (wave-context reads join `users` on both legs).
- Evaluation sessions are therefore first-class `session` rows with the applicant as
  the "student" leg — the applicant-as-student projection — without any widening: no
  `student_session` row can ever be produced by this flow, and no `students` row is
  ever created for an applicant.

## Related documents

- `docs/teachers/applicant-lifecycle.md` — the `applicants` state machine; this flow
  READS `in_evaluation` and owns its own gates; it writes nothing to the lifecycle.
- `docs/teachers/verification-plan-purchase.md` — the purchase that activates the
  subscription and starts the cycle (credit source: 5 sessions per activation).
- `docs/sessions/session-lifecycle.md` — the session state machine, guarded transitions,
  idempotency claim design, and sweeps that evaluation rows ride unchanged.
- Plan of record: `ai/plans/milestone_1_core_domain_mvp/5_session_evaluation_loop_booking/`.
