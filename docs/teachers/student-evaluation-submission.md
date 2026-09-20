# Student→Teacher Session Rating — Canonical Reference

**Domain:** Teachers / Student evaluation submission (the student's once-per-session teacher rating)
**Related:** `docs/sessions/session-lifecycle.md` (the completion handshake this flow consumes — see its Consumer Guidance ratings row), `docs/graphql/error-handling-contract.md` (transport taxonomy + masking), `docs/teachers/applicant-lifecycle.md` (the `evaluations` table's other consumer)
**Status:** Implemented and verified

This document is the single canonical reference for the student→teacher session rating: the write-once contract on the shared `evaluations` table, the eligibility gate, the star→score conversion and the aggregation forward contract it guarantees, the error contract, the security posture, and the anti-patterns every future consumer MUST avoid. All layers (schema, repository, service, GraphQL, frontend) already conform to what is described here; code blocks are **illustrative and NON-authoritative** — the authoritative implementations are cited by path in each section.

---

## 1. Scope & Surfaces

A student who participated in a session may rate its teacher **exactly once**, and only after the session's completion handshake has finished (teacher completed + both participants confirmed). The rating lives on the pre-existing `evaluations` table, which has exactly two consumers:

| Consumer | `session_id` | `score` meaning |
|---|---|---|
| Applicant evaluation (a certified sheikh evaluates a teacher candidate) | `NULL` | 0–100 evaluation score |
| **Student→teacher session rating (this document)** | the rated session's id | `rating × 20` (whole stars 1–5 → 20–100) |

Surfaces (no new route, no new page — the entry point is a row action on the existing student sessions list):

| Surface | Path |
|---|---|
| Mutation | `submitTeacherEvaluation(sessionId: ID!, input: SubmitTeacherEvaluationInput!): Evaluation!` — `backend/graphql/mutation/classes/student-evaluation.mutation.ts` (field registered at :54) |
| Read-back | `myTeacherEvaluations: [Evaluation!]!` — zero arguments, caller-scoped, non-paginated — `backend/graphql/query/teachers/student-evaluation.query.ts` (:46) |
| GraphQL object / input | `backend/graphql/pothos/teachers/evaluation.pothos.ts` |
| Generated SDL | `frontend/graphql/generated/schema.graphql` (:624 mutation, :936 query) |
| UI | `frontend/views/student/sessions/RateTeacherDialog.tsx` (dialog), `useStudentSessionConfirm.ts` (row-action gate, :184–195), `useMyTeacherEvaluations.ts` (rated set + cache writer) |

The completion notification deep-links to the sessions list (`STUDENT_SESSIONS_ROUTE`, `frontend/lib/notification-route-resolution.ts:26`, mapped for `NotificationType.SessionCompletion` at :48) so the hand-shake funnel ends on the Rate action.

---

## 2. Rating Write Contract

**Write-once per (session, evaluator).** The arbiter is the database, never a pre-check: `evaluations_session_evaluator_unique` — `UNIQUE (session_id, evaluator_id)` at `backend/db/schema/teachers/evaluations.ts:60`. A duplicate insert fails with PG `23505`; there is no code path that reads "has this been rated?" before writing.

**Insert pipeline** (`EvaluationRepository.insertOnce`, `backend/db/repo/teachers/evaluation.repository.ts:73`):

- ONE `INSERT … RETURNING` statement; the caller supplies exactly the four meaningful columns (`evaluatedId`, `evaluatorId`, `sessionId`, `score`) as a typed `Pick` payload — schema defaults fill the rest.
- `tx: DBTransaction` is REQUIRED — the write always joins the caller's atomic unit of work.
- The raw `23505` is **not caught or translated** in the repository. Mapping it is the service's decision (§2.1).
- Soft-deleted rows can never be produced by this path: no update or delete surface exists for ratings. A stored rating is immutable.

### 2.1 Service mapping (`StudentEvaluationService.submitTeacherEvaluation`, `backend/services/teachers/student-evaluation.service.ts`)

The pipeline order is the contract (each stage fails closed before the next):

1. **Pre-DB shape guards** (:224–240) — the target session id via the shared `assertPositiveSafeSessionId` guard (`backend/services/classes/session-lifecycle.guards.ts:123`) and the rating as a whole star in 1..5. Garbage shapes die as `VALIDATION` before any database read.
2. **One transaction** — `withTransaction(outerTx, …)`; a caller-supplied `outerTx` turns the flow into a SAVEPOINT, production callers omit it.
3. **Eligibility probe** — `SessionRepository.findRatingEligibilityProbe` (`backend/db/repo/classes/session.repository.ts:370`, body in `session.repository.gate.helpers.ts:61`): a non-locking six-column projection (`id`, `studentId`, `teacherId`, `status`, `confirmedByTeacherAt`, `confirmedByStudentAt`) or `null`.
4. **Participant oracle** (:131) — `probe?.studentId !== caller` ⇒ `NotFoundError("SESSION")`. A foreign id and a nonexistent id are byte-identical denials (§5).
5. **Completion gate** (:151–163) — status `completed` AND both confirmation stamps present, else `ConflictError("EVALUATION_SESSION_NOT_COMPLETED")`.
6. **Insert** (:165–174) — every stored column derived server-side: rated subject = probe row's teacher, rater = caller, `score = rating × 20`.
7. **23505 map** (:251–259) — only a unique violation on the cause chain (`isUniqueViolation`, `backend/services/shared/user-provisioning.helpers.ts:54`) becomes `ConflictError("EVALUATION_ALREADY_SUBMITTED")`; every other failure is rethrown untouched and the transaction rolls back with zero residual rows.

**Why a non-locking probe is safe:** post-confirmation session state is monotonic (stamps are never cleared; `completed` is terminal), and nothing in this flow writes the session row. The only read-then-write pair is probe → insert, and its correctness does not depend on the probe staying true — participation is immutable for a session row, and duplicate arbitration belongs to the unique index, which is race-free. Concurrent double-submits (retry storm, two tabs) converge on exactly one stored row: one winner, one typed conflict, the loser's transaction inserts nothing.

---

## 3. Score Conversion & the Average-Rating Forward Contract

**Conversion is centralized server-side.** The client sends whole stars (`rating: Int!`, 1..5); the service stores `score = rating × 20` (`SCORE_POINTS_PER_STAR`, service :74, applied :170) onto the column's 0–100 scale (CHECK `evaluations_score_check`, `backend/db/schema/teachers/evaluations.ts:56`). Never store raw 1–5 in `score`: the 0–100 meaning is shared by the table's CHECK, both consumers, and the existing aggregate readers (e.g. `backend/db/repo/admin/platform-analytics.repository.ts:359–403` already computes `avg(score)` on that meaning).

**Forward contract for the `teacher.average_rating` aggregation** (the consumer that computes the teacher's 0–5 average; column at `backend/db/schema/teachers/teacher.ts:27`, clamped by `teacher_average_rating_check` 0–5 at :37):

- Conversion back: `average_rating = ROUND(AVG(score) / 20, 2)` over the rating rows.
- Row selection: all non-soft-deleted `evaluations` rows where `evaluated_id` = the teacher's `users.id`, **AND `session_id IS NOT NULL`**. `NULL session_id` rows are applicant evaluations — they are a different flow's scores on the same table and MUST be excluded from the session-rating aggregation (PostgreSQL unique semantics treat NULLs as distinct, which is why both consumers coexist on one table).
- What this flow guarantees every rating row to be "clean" enough that the aggregator needs no self-defense beyond the filters above:
  1. at most one row per (session, student) — the unique arbiter;
  2. `score` non-null and in {20, 40, 60, 80, 100} (whole-star × 20);
  3. `session_id` always populated (and SET NULL only if the session row itself is ever deleted — a historical rating then becomes a standalone record);
  4. immutability — no update/delete surface exists; exclusion is soft-delete (`is_deleted`/`deleted_at`) only.
- The ratings themselves are **not** exposed on any teacher-facing surface yet; visibility/averaging surfaces are the aggregation consumer's scope. Until then, `myTeacherEvaluations` (the rater's own history, newest first — `EvaluationRepository.listByEvaluator`, repo :100) is the only read surface.
- **Shipped status:** this aggregation contract is now IMPLEMENTED by the submission flow itself — the cached average is recomputed from the live family and written to the teacher row inside the rating's OWN transaction (insert → aggregate → convert → guarded update → commit). Canonical contract: [`docs/teachers/teacher-average-rating.md`](./teacher-average-rating.md). The two repository methods (`EvaluationRepository.aggregateLiveRatings`, `TeacherRepository.updateAverageRating`) compose ONLY inside this submission flow's transaction — TODAY the submission is the column's single writer, and that same-transaction discipline is the guarantee over the column. The one sanctioned future composer is the documented moderation-recompute hook (`docs/teachers/teacher-average-rating.md` §6–§7): when it ships, it MUST run the same two methods inside ITS OWN transaction, never as a second ad-hoc writer.

---

## 4. Error Contract

All domain denials are `DomainError` subclasses whose `extensions.code` follows `docs/graphql/domain-error-extensions-code.md`. GraphQL responses are delivered over the standard envelope; **clients branch on `extensions.code` ONLY — never on HTTP status** (`docs/graphql/error-handling-contract.md`). Custom domain codes (`SESSION_NOT_FOUND`, `EVALUATION_*`) never resolve through the shared HTTP taxonomy; the taxonomy-classified codes below keep their reserved classes for non-GraphQL boundaries. Every message arrives localized for the request locale; the mapping lives in `frontend/providers/apollo/error-link.map.ts` (:290, :302 for the two evaluation codes) plus the dialog-level classifier `frontend/views/student/sessions/rateTeacherMutationError.ts`.

| `extensions.code` | Producer | Wire semantics (HTTP-free) | Client surface | i18n key (`errors` namespace) |
|---|---|---|---|---|
| `UNAUTHORIZED` | builder `authenticated` scope | 401-class taxonomy code on the error envelope | redirect-to-login (existing behavior) | `unauthorized` |
| `FORBIDDEN` | builder `role` scope (any authenticated non-student; no admin bypass) | 403-class taxonomy code | existing denial surface | `forbidden` |
| `SESSION_NOT_FOUND` | service participant oracle (unknown id **or** non-participant — identical) | custom domain code; indistinguishable for foreign ≡ nonexistent | localized notice; the session is evicted from the client's local list/rated-candidate state | `sessionNotFound` |
| `EVALUATION_SESSION_NOT_COMPLETED` | service completion gate | custom domain code; conflict notice | error-tone notice with the code's OWN copy (not the generic conflict copy); non-retryable; the Rate action stays available for the finished handshake | `evaluationSessionNotCompleted` (`shared/locale/en/errors/index.ts:105`) |
| `EVALUATION_ALREADY_SUBMITTED` | service 23505 map | custom domain code; the rating EXISTS | **info-tone** notice (never an error treatment); the row is marked rated locally so the UI converges on the stored truth. Deliberately NOT the success-equivalent replay flag — that stays exclusive to the idempotency replay code | `evaluationAlreadySubmitted` (:107) |
| `VALIDATION` + `extensions.fields[]` | pre-DB shape guards | 422-class taxonomy code; the star-range denial projects exactly `[{ field: "rating", code: "TEACHER_RATING_INVALID", message }]`; a malformed session id carries NO fields (bare message) | inline field error under the stars (server-localized pair echoed verbatim); dialog stays open for retry | `teacherRatingInvalid` (:108) |

Log discipline: every denial emits exactly ONE bounded `logger.logDomainError` entry — `{ code, entity, entityId, locale }` where `entity` names the table `entityId` points at (`"session"` throughout this flow, label-follows-id). Never the submitted payload, never a counterparty value. Happy paths and the read surface log nothing.

---

## 5. Security Posture

| Property | Implementation |
|---|---|
| Server-derived identity | The rater is ALWAYS the verified context's user id (`ctx.user.id`); the rated subject is the session probe row's teacher. Neither is ever accepted from the client — the ONLY client-owned value in the whole flow is `{ rating }`. A client-supplied evaluator/subject cannot exist on the wire (the query takes no arguments; the mutation takes no identity fields). |
| Role gate | Both operations declare the explicit `$all { authenticated, role: [Student] }` conjunction. The `$all` wrapper is load-bearing: a plain scope map combines its keys with ANY semantics, and a bare role map would answer anonymous callers with FORBIDDEN instead of UNAUTHORIZED. Teacher/parent/admin ⇒ `FORBIDDEN`; anonymous ⇒ `UNAUTHORIZED`; no admin bypass. |
| Oracle byte-identity | `SESSION_NOT_FOUND` for a foreign participant is byte-identical (same class, code, and translated message) to the unknown-id denial — session existence is never an oracle. Wire tests pin `code\|message` signature equality. |
| Read scoping | `myTeacherEvaluations` is zero-argument and caller-scoped by construction: the evaluator id is the read's only filter and no widening parameter exists (`listByEvaluator` signature, repo :100). Soft-delete exclusion is NULL-safe (only an explicit deleted flag excludes). |
| Mass assignment | Member-by-member payload mapping at the resolver and the service; no spread of client input anywhere on the path. |
| Wire fidelity | The wire `ID` is coerced by the strict decimal coercion guard at the mutation boundary (non-decimal shapes — hex, underscores, exponent notation — arrive at the service as `NaN` and die in the pre-DB VALIDATION guard rather than silently addressing a different session). |
| Bounded denial logs | Exactly one log entry per denial with the bounded key set above; entity ids only, no PII, no payloads. |
| Cross-surface purity | The flow writes ONLY to `evaluations`: zero notification, audit, wallet, ledger, or session-row writes, and no imports from those surfaces. The session lifecycle is consumed read-only. |

---

## 6. What NOT to Do

- **No pre-check SELECT before insert.** Do not probe `evaluations` for an existing (session, evaluator) row and then insert — that is a TOCTOU window the unique index already closes race-free. Insert and let `23505` arbitrate; map it to the typed conflict (§2.1).
- **No lifecycle writes from the rating path.** The rating flow consumes session state read-only via the non-locking probe. Do not add `.for("update")` to the probe, do not write stamps/flags/fee columns, and do not route rating side-effects through the lifecycle service — the write-purity of the session row is a pinned contract.
- **No reuse of `sessionRatingRange`.** That `errors` key belongs to the report flow's 0–5 score-scale copy. The rating input's whole-star denial is `teacherRatingInvalid` (1..5 stars). Adding a second producer for the old key corrupts its meaning and its parity pins.
- **No client-supplied evaluator/subject.** Never accept an evaluator or evaluated id as an argument or input field, on the mutation or the query. Identity is server-derived end-to-end (§5); a new identity parameter is a BOLA hole, not a feature.
- **No notes / free-text.** The `evaluations.notes` column stays unused by this flow and server-side — it is stripped from the returned shape and there is no input field for it. Free-text review is deferred; do not quietly widen `SubmitTeacherEvaluationInput`.
- **No notifications, no audit rows.** The submission emits nothing beyond the `evaluations` row. Notification fan-out and audit trails are deferred concerns with their own owners; adding them here would couple the rating path to surfaces it must stay independent of.
- **Do not store raw 1–5 in `score`,** and do not convert in the client. The server-side `rating × 20` conversion is what keeps one canonical 0–100 scale on the table (§3).
- **Do not force the custom codes into the HTTP taxonomy.** `EVALUATION_ALREADY_SUBMITTED` and friends are legal transport values outside the nine categories; inventing an HTTP status mapping for them breaks the code-only client contract (§4).

---

## 7. References

- **Table & arbiter:** `backend/db/schema/teachers/evaluations.ts` (dual-consumer doc-comment :6–33, score CHECK :56, unique arbiter :60)
- **Repository:** `backend/db/repo/teachers/evaluation.repository.ts` (`insertOnce` :73, `listByEvaluator` :100)
- **Eligibility probe:** `backend/db/repo/classes/session.repository.ts:370` + `session.repository.gate.helpers.ts:61`
- **Service:** `backend/services/teachers/student-evaluation.service.ts` (pipeline per §2.1)
- **GraphQL:** `backend/graphql/mutation/classes/student-evaluation.mutation.ts`, `backend/graphql/query/teachers/student-evaluation.query.ts`, `backend/graphql/pothos/teachers/evaluation.pothos.ts`, SDL pins in `backend/graphql/test/sdl-static-assertions.test.ts` + `backend/graphql/test/student-evaluation.wire.test.ts`
- **Frontend:** `frontend/views/student/sessions/` (`RateTeacherDialog.tsx`, `useMyTeacherEvaluations.ts`, `useStudentSessionConfirm.ts`, `rateTeacherMutationError.ts`), mapping table `frontend/providers/apollo/error-link.map.ts`
- **i18n:** `shared/locale/en/errors/index.ts:105–108` (+ `ar` mirror; en/ar parity mechanically pinned)
- **Average-rating target column:** `backend/db/schema/teachers/teacher.ts:27,37`; existing 0–100 aggregate-reader precedent `backend/db/repo/admin/platform-analytics.repository.ts:359–403`
- **Test locks:** `backend/db/test/repo/teachers/evaluation.repository.test.ts`, `backend/services/teachers/student-evaluation.service.test.ts`, `test/workflows/teachers/student-teacher-rating.journey.test.ts`
- **Sibling canonical docs:** `docs/sessions/session-lifecycle.md` (completion handshake + consumer guidance), `docs/teachers/applicant-lifecycle.md` (the table's other consumer), `docs/graphql/error-handling-contract.md` + `docs/graphql/domain-error-extensions-code.md` (error transport)
