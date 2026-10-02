# Applicant → Student Record Conversion (Fail-Verdict Contract)

> Contract doc for the atomic conversion a failed rubric finalization applies to the
> evaluated applicant — a `students` role-child row plus the `teacher` → `student`
> role flip, committed in the SAME transaction as the verdict — and the reverse
> restoration a re-certification applies.
> Sibling docs: `docs/teachers/evaluation-rubric-scoring.md` (the finalization that
> triggers the conversion), `docs/teachers/applicant-lifecycle.md` (the `applicants`
> status machine; §2.5 is the co-existence contract), `docs/teachers/applicant-cooldown.md`
> (the cooldown the conversion co-exists with), and
> `docs/teachers/verification-plan-purchase.md` (the re-purchase the cooldown gates).

**Domain:** Teachers / applicant lifecycle — the conversion seam between the verdict write and the role-child tables
**Status:** Implemented and verified

## What the fail verdict writes

When the five-evaluator rubric finalization lands on FAIL, the finalization
transaction applies, in order:

1. **The verdict write** — ONE guarded `transitionToFailed` stamps
   `applicants.status = 'failed'` + the cooldown instant derived from the primary
   failure area. Zero rows matched ⇒ already finalized ⇒ `APPLICANT_ALREADY_FINALIZED`
   + full rollback (owned by the rubric flow; unchanged here).
2. **The conversion** — strictly after the verdict write matched:
   - a `students` role-child row on the applicant's user id (shared PK) with
     **zeroed balances**, **no parent linkage**, and a **fresh unique `KSB-XXXXXXXX`
     handshake code** (minted by the shared provisioning helper with a bounded
     collision-retry budget); and
   - the guarded `users.role` flip `teacher` → `student` — a single-statement
     UPDATE whose WHERE predicate pins the expected source role, so a stale replay
     can never re-apply an illegal transition (row count decides).

The `applicants` row is **untouched by the conversion itself** — `status='failed'`
and the stamped cooldown stand exactly as the verdict wrote them. No `teacher` row
is created and no `users.suspended*` field is written. The change is schema-neutral:
no migration, no new column, no GraphQL surface.

## Why the role flips

Two recorded spec decisions pin this shape:

- **Role inheritance** (`docs/specs/functional-requirements.md`, "Role Inheritance"):
  a user has exactly one role, and role-specific data lives in the corresponding
  role-child table sharing the `users` PK. A failed applicant exercising student
  privileges therefore needs a `students` row — the role-child record — to hold
  that data.
- **Student privileges during cooldown** (`docs/specs/state-machine-invariants.md`,
  Teacher Verification Lifecycle): *"A failed applicant who is converted to a
  student retains student privileges (can subscribe to plans and attend sessions)
  during the cooldown period."*

Student-gated GraphQL surfaces authorize on the role embedded in the caller's
context. Without the `teacher` → `student` flip, the invariant's privileges would
be claims the wire cannot enforce; with it, the existing student surfaces unlock
for the converted account with **zero resolver edits**.

## Atomicity — one transaction, fail-closed

The conversion joins the CALLER's transaction: it never opens one, and every
read and write runs on the finalization's `tx`. The verdict and the conversion
commit — or roll back — as one atomic unit. Any conversion failure (the
handshake-code retry budget exhausting, or the internal invariant below) throws
through the finalization and reverts the verdict status, the cooldown stamp, the
5th submission's evaluation row, and any in-transaction notification write
together. A half-converted applicant state cannot persist.

## Idempotency and replay safety

The conversion is existence-read + guarded write:

- **Existence-read first.** A `students` row already holding this user id means
  the conversion already happened (a replayed finalization, or a re-failure after
  a re-certification). The insert is skipped, the historical handshake code is
  never regenerated, and only the role coherence is re-ensured — the replay is a
  safe no-op.
- **The flip never double-applies.** The guarded UPDATE pins the source role in
  its WHERE predicate; on an already-`student` row it matches zero rows
  harmlessly. Role coherence runs on EVERY path (fresh conversion, idempotent
  replay, re-conversion after re-certification).
- **Invariant tripwire.** A flip that matches zero rows on a FIRST conversion (no
  prior `students` row) means the stored role was not `teacher` — contradicting
  the applicant invariant (a failing applicant IS a teacher at evaluation time).
  That is a plain internal `Error`, not a localized denial, and the caller's
  transaction rolls back.
- **Race authority.** Cross-connection finalization races serialize through the
  rubric flow's per-applicant verdict guard (the applicant row lock is the
  finalization mutex) — a losing rival finalization is denied
  `APPLICANT_NOT_IN_EVALUATION` before any conversion can run.

## Re-certification — restoring the teacher role

Both pass entry points end with the same guarded restore — a later
**rubric re-evaluation pass** (the pass finalization) and the **admin
evaluation-override certify arm** alike, which composes the same certification
primitives (the insert-or-elevate certified teacher row, then
`applicants.status='passed'` with the cooldown cleared) on its own transaction.
Once the certification write succeeds, the guarded `student` → `teacher` flip
restores the role on that same transaction:

- a converted account is flipped back to `teacher`; the `students` row is NEVER
  touched — it survives re-certification **byte-identical as historical data**;
- a never-converted applicant (role already `teacher`) makes the guarded flip
  match zero rows — the documented **silent no-op**.

The direct cold-start teacher-certification surface is out of this contract by
construction: it requires the `teacher` role before any write and answers
`TEACHER_ROLE_REQUIRED` for a converted student, so the admin evaluation-override
certify arm is the only admin certification that can target a converted applicant.

A subsequent re-failure converts again; the idempotency contract above keeps that
replay safe (the existing `students` row is kept, only the role flips back).

## Wire consequences

| Surface | Converted account | Why |
|---|---|---|
| `purchaseSubscription`, `createSession`, `myStudentSessions`, `myHandshakeCode` | authorization-SUCCESS | the role flip satisfies the existing `UserRole.Student` gates — zero resolver edits |
| `purchaseVerificationPlan` | unaffected — the re-apply path stays `authenticated`-only; an active cooldown returns the typed `APPLICANT_COOLDOWN_ACTIVE` (carrying the expiry), never a 403 | the flip changes no gate on this surface |
| `myApplicantProfile` | `FORBIDDEN` — **deliberate** (see boundaries) | the field's gate remains Teacher-only |

**Token self-heal.** Access tokens embed the role at signing time. A token minted
before the flip keeps asserting `teacher` — and stays denied on student surfaces —
until its next refresh. The refresh flow re-signs from the CURRENT database row,
so the staleness self-heals on the next (typically silent) refresh. There is **no
forced revocation or logout** on flip: that is a permanent design decision, not a
gap — a revocation path would add a session-store dependency the auth model does
not have.

## Deliberate boundaries (what this slice does NOT do)

All of the following are intentional, tracked decisions — none is a blocker. The
authoritative ledger with dispositions and cross-plan pointers is
`ai/plans/milestone_1_core_domain_mvp/failed_applicant_student_record_conversion/deferred-items.md`.

- **`myApplicantProfile` stays Teacher-only.** A converted account cannot read the
  applicant cooldown read-model on the wire. Deliberate minimal blast radius on a
  shipped, test-locked surface; the re-apply path is unaffected either way. This
  is pinned by the wire suite — a future gate widening must flip that assertion
  in the same change (it is the change under review).
- **No audit-log row for the conversion event.** The conversion is observable via
  the DB rows (`applicants.status` + the `students` row + `users.role`); durable
  role-transition auditing belongs to the audit-completeness stream.
- **The admin-override REJECT path does not convert.** The override surface's
  rejection write is a different code path (it genuinely performs no role flip);
  wiring the conversion there is a child ticket's job, reusing the SAME
  conversion primitive shipped here.
- **No frontend surfacing.** This slice is backend-only: zero routes, zero nav
  items, zero Apollo documents. Rendering cooldown/re-apply UX for converted
  students is a separate UI ticket.

## Error contract

| Code | Producer | Semantics |
|---|---|---|
| `HANDSHAKE_EXHAUSTED` | the conversion's handshake provisioning helper, on retry-budget exhaustion (localized conflict carrying the collision cause) | the finalization transaction rolls back fail-closed; the applicant stays `in_evaluation` |
| `APPLICANT_ALREADY_FINALIZED` | the rubric flow's zero-row verdict write (unchanged) | the verdict already exists; nothing to retry |

`HANDSHAKE_EXHAUSTED` is the code already established by the handshake-code
machinery (`docs/parents/handshake-code-discovery.md`); its localized copy resolves
through the compile-time server translations. The internal invariant tripwire
(non-teacher applicant on a first conversion) is deliberately a plain `Error` —
an internal consistency failure, never a user-facing denial shape.

## Authoritative implementations & test locks

| Role | File |
|---|---|
| Conversion service (`convertToStudent` / `restoreTeacherRole`) | `backend/services/teachers/applicant-conversion.service.ts` |
| Guarded role-flip primitive (`transitionRoleOnce`) | `backend/db/repo/users/user.repository.ts` |
| Call-sites (fail + pass finalizations + the admin override certify restore) | `backend/services/teachers/evaluation-rubric.helpers.ts` (`finalizeRubricFail` / `finalizeRubricPass`) and `backend/services/teachers/applicant-lifecycle.override-arms.ts` (`applyCertifyOverride`) |
| Shared provisioning helper (handshake retry) | `backend/services/shared` (`createStudentWithHandshakeRetry`) |

Test locks: `backend/db/test/logic/users/user.repository.test.ts` (flip primitive),
`backend/services/teachers/applicant-conversion.service.test.ts` (conversion +
restore contracts), `backend/services/teachers/evaluation-rubric.service.test.ts`
(wiring, atomic rollback, replay),
`backend/services/teachers/applicant-lifecycle.service.test.ts` (the admin
override certify arm's restore leg), `test/workflows/teachers/applicant-student-conversion.journey.test.ts`
(end-to-end fail → cooldown → re-certification cycle),
`frontend/graphql/test/teachers/applicant-conversion-role-surface.test.ts` (wire
gates, token self-heal, the intentional `myApplicantProfile` lock).

## Related documents

- `docs/teachers/evaluation-rubric-scoring.md` — the finalization transaction the
  conversion rides inside (FAIL verdict + PASS certification).
- `docs/teachers/applicant-lifecycle.md` — the `applicants` state machine; §2.5
  records the students/applicants co-existence this conversion creates.
- `docs/teachers/applicant-cooldown.md` — the cooldown write/read contracts the
  converted account serves.
- `docs/teachers/verification-plan-purchase.md` — the re-purchase flow that ends a
  cooldown (and the activation lane-credit probe that handles the re-purchaser's
  existing `students` row).
- `docs/parents/handshake-code-discovery.md` — the handshake-code machinery whose
  provisioning helper and error code this conversion reuses.
