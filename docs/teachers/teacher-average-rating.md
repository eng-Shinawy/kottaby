# Teacher Average Rating — Canonical Reference

**Domain:** Teachers / Cached average rating (`teacher.average_rating`) over the live student-rating family
**Related:** [`docs/teachers/student-evaluation-submission.md`](./student-evaluation-submission.md) (the rating write contract whose aggregation forward contract this doc implements), `docs/specs/state-machine-invariants.md` (INV-E4), `docs/specs/functional-requirements.md` (FR-8.2), [`docs/admin/platform-analytics.md`](../admin/platform-analytics.md) (the sibling live-average metric — a different number)
**Status:** Implemented and verified

This document is the single canonical reference for the teacher's cached average rating: where the aggregation runs, exactly which rows it reads, the honest-null ruling, the concurrency model, the ranking contract it serves, and the anti-patterns every future consumer or writer MUST avoid. All layers (schema, repository, service, frontend readers) conform to what is described here; code blocks are **illustrative and NON-authoritative** — the authoritative implementations are cited by path in each section.

---

## 1. What the Column Is — and Is Not

`teacher.average_rating` is a **cached, denormalized 0–5 average of the teacher's live student ratings**, maintained as a side effect of rating submission:

| Property | Value | Where |
|---|---|---|
| Column | `average_rating` — `decimal(3,2)`, NULL-able, **no default** | `backend/db/schema/teachers/teacher.ts:27` |
| Clamp | `teacher_average_rating_check` — `>= 0 AND <= 5` | `backend/db/schema/teachers/teacher.ts:37` |
| Source family | the `evaluations` rows selected by §3 below | `backend/db/schema/teachers/evaluations.ts` |
| Writer | the student rating submission transaction — the ONLY writer | `backend/services/teachers/student-evaluation.service.ts:189-197` |

It is a **write-time cache, not a live view**: the value is recomputed from the stored rows on every submission and read directly wherever it renders. It is NOT the platform-analytics average (§7 — different metric, different scale, different family).

## 2. Aggregation Trigger — Inside the Submission Transaction

**Single-writer discipline:** the rating's own transaction is the only code path in the system that writes `average_rating`. There is no trigger, no cron, no queue, no admin knob, no backfill job. The aggregation is not a step that happens *after* a rating — it is part of the rating commit itself.

The submission pipeline (`StudentEvaluationService.submitTeacherEvaluation`, `backend/services/teachers/student-evaluation.service.ts` — the pipeline order is the contract, each stage fails closed before the next):

| # | Stage | Where | What happens |
|---|---|---|---|
| 1 | Pre-DB shape guards | `:262-278` | target session id + whole-star 1..5 — garbage dies as `VALIDATION` before any database read |
| 2 | ONE transaction | `:281-283` | `withTransaction` wraps the whole body (a caller-supplied outer tx turns it into a SAVEPOINT) |
| 3 | Eligibility probe | `:145` | non-locking read of the session's `studentId` / `teacherId` / status / both confirmation stamps |
| 4 | Participant oracle | `:146-157` | foreign ≡ nonexistent — one byte-identical `SESSION_NOT_FOUND` denial |
| 5 | Completion gate | `:166-178` | status `completed` AND both stamps present, else `EVALUATION_SESSION_NOT_COMPLETED` |
| 6 | Rating insert | `:180-188` | `score = rating × SCORE_POINTS_PER_STAR` (`:185`); the per-(session, evaluator) unique index (`evaluations.ts:60`) arbitrates write-once |
| 7 | **Aggregate** | `:189` | `EvaluationRepository.aggregateLiveRatings(probe.teacherId, tx)` — the live family mean, SAME transaction (read-your-write: the just-inserted row is visible) |
| 8 | **Convert** | `:196` | `(aggregate.averageScore / SCORE_POINTS_PER_STAR).toFixed(2)` — star scale, exact 2-decimal string |
| 9 | **Guarded update** | `:197` | `TeacherRepository.updateAverageRating(probe.teacherId, averageRating, tx)` — one statement, `WHERE id = $1 RETURNING` |
| 10 | Commit | — | rating row and moved average commit together or roll back together |

The honest-null skip sits between stages 7 and 8 (`:190-195`): a `null` aggregate writes nothing and returns the rating row (§4). A `null` update return — no `teacher` row for the probe's id — is an invariant break: one bounded `logDenial` entry (`TEACHER_PROFILE_MISSING`, `:198-207`), then a plain internal `Error` that rolls the transaction back with zero residual rows. The `23505` duplicate map (`:289-298`) sits outside the aggregation entirely: the duplicate's insert fails first, so the loser's transaction never reaches stage 7 (§5).

## 3. Formula & Row-Selection Contract

**Formula** (the aggregation forward contract's own words, `docs/teachers/student-evaluation-submission.md:65-68`):

```
average_rating = ROUND(AVG(score) / 20, 2)
```

The shipped implementation splits the formula across two tiers on purpose (one conversion constant, one site):

- **Repository** — `EvaluationRepository.aggregateLiveRatings` (`backend/db/repo/teachers/evaluation.repository.ts:171-193`) computes the raw 0–100 mean in SQL: `avg(${evaluations.score})::float8` + `count(*)::int` on one row (`:177-178`). The `::float8` cast is load-bearing — Drizzle `sql` templates bypass column mappers, and pg returns a bare `numeric` mean as a JavaScript string.
- **Service** — divides by `SCORE_POINTS_PER_STAR` (= 20, `student-evaluation.service.ts:83`) and formats to exactly two decimals (`:196`). The rounding lives HERE; SQL never rounds (§7).

**Row-selection contract** — the live student-rating family, all four filters in one WHERE (`evaluation.repository.ts:181-188`):

| Filter | Excludes | Why |
|---|---|---|
| `evaluated_id` = the rated teacher's id | other subjects' rows | the family is per-teacher (served by `evaluations_evaluated_id_idx`, `evaluations.ts:57`) |
| `session_id IS NOT NULL` | **applicant evaluations** | `NULL session_id` rows are the applicant-lifecycle flow's scores on the shared table — a different flow, never folded in (PostgreSQL unique semantics treat NULLs as distinct, which is why both consumers coexist on one table) |
| `score IS NOT NULL` | unrated rows | keeps the mean and the count agreeing on the same family |
| soft-deleted excluded — `or(isDeleted, false) / isNull(isDeleted)` | explicitly deleted rows | NULL-safe form: only an explicit deleted flag excludes |

The submission flow guarantees every rating row is "clean" enough that the aggregator needs no self-defense beyond the filters above (the DEV2-016 guarantees, `docs/teachers/student-evaluation-submission.md:69-73`): at most one row per (session, student); `score` non-null and in {20, 40, 60, 80, 100}; `session_id` always populated; immutability (no update/delete surface — soft-delete exclusion is the only removal channel).

## 4. The Honest-Null Ruling

**Zero live ratings ⇒ `NULL` — never a fabricated 0.**

- An empty family yields `{ averageScore: null, ratingCount: 0 }` from the aggregate (SQL `avg` over zero rows is NULL, `count(*)` is 0 — `evaluation.repository.ts:189-192`); the service then skips the teacher write (`student-evaluation.service.ts:190-195`).
- A stored 0 would be an impossible rating: the minimum producible average is one 1★ rating ⇒ `1.00` (scores are 20–100). A 0 would read as "rated zero stars" — a value no rater can produce.
- The platform-wide precedent is explicit: "Rating averages are `null` when the family has no rated rows ('no ratings yet' is not 'rated zero')" (`backend/db/repo/admin/platform-analytics.repository.ts:39-41`).
- Every renderer treats `null` as genuinely-unrated: the localized em-dash "—" (`frontend/views/admin/teachers/adminTeachersDirectory.helpers.ts:78-80`), the detail cell (`frontend/views/admin/teachers/AdminTeacherDetailCells.tsx:30-33`), and empty CSV cells (`frontend/views/admin/teachers/teachers-directory-csv.ts:80`).

The original ticket's literal "average_rating = 0 (default)" wording is a **recorded deferred ruling, not a shipped behavior**: the column is nullable with no default, and whether a 0 default is ever wanted is owned by the feature's deferred ruling **D1**, recorded in the archived plan bundle (`ai/finished_plans/milestone_3_parent_portal_admin_governance/teacher_average_rating_aggregation_update/`; ledger and outcome records live in the branch/PR history, PR #212). Through the submission flow the zero-family case is unreachable by construction anyway — the just-inserted row is live, so the aggregate always sees ≥ 1 row — but the contract is defended at both tiers regardless.

## 5. Concurrency Model — Recompute-from-Source

**The cache is a pure function of the live family the transaction sees. Never an incremental merge.** An `(old × (n−1) + new) / n` update under two concurrent submissions is a lost-update corruption; a full `AVG` over the stored rows cannot double-count, because it reads what is actually committed.

- **READ COMMITTED convergence (honest invariant):** two students rating the same teacher concurrently may each recompute over a subset of the final family (the later-committing transaction may have aggregated *before* the earlier one committed). Every committed value is still an average over a **valid subset** of the family — never double-counted, always within the CHECK bounds — and the family is monotonic inside a committed tx (this flow never removes rows). A committed subset average **self-heals at the next submission**, which recomputes from source again. Sequential submissions converge exactly.
- **Duplicate submissions never reach the aggregation:** the unique index `evaluations_session_evaluator_unique` (`evaluations.ts:60`) arbitrates at the insert — the duplicate's `23505` fails stage 6 and rolls back everything, so no stale or extra average can be written by a losing transaction.
- **No locks, by design:** no `SELECT FOR UPDATE`, no advisory locks, no queue. The read-then-write pair (aggregate → teacher UPDATE) is a cache recompute whose correctness never depends on the read staying true — a lock would serialize two students' unrelated sessions for zero correctness gain. The rating insert's own write-once race is arbitrated by the unique index exactly as the submission contract requires.

## 6. Ranking Forward Contract

FR-8.2 (`docs/specs/functional-requirements.md:238-240`) makes teacher ratings a direct input to search ranking and visibility. The student-facing teacher search/browse surface does **not exist yet** — there is no student-facing teacher browse query in the codebase. This column is its prepared input, per the feature's deferred-items ledger (row **D2**):

- The **maintained cached column** (`teacher.average_rating`, 0–5, honest-null) is the canonical ranking input for that future surface.
- The future surface consumes the column **READ-ONLY** — it never recomputes the average and never writes it.
- **Single-writer discipline holds across the contract:** the submission transaction remains the only writer. Any future surface that wants to move the value composes the two repository methods (§8) inside its own transaction — it does not become a second ad-hoc writer.

## 7. What NOT to Do

- **No incremental updates.** Never maintain the average as `(old × (n−1) + new) / n` or any running merge — concurrent submissions corrupt it (lost update), and only a recompute-from-source is a pure function of the committed rows (§5).
- **No separate transaction, event, queue, or trigger.** The aggregation MUST run inside the submission's existing transaction, between the insert and the commit (`:189-197`). A post-commit event/queue/trigger leaves a window where a committed rating coexists with a stale average — an explainability hole — and makes the pipeline order untestable.
- **No SQL-side rounding.** Do not write `round(avg(score)::numeric / 20, 2)` into the aggregate. That duplicates the star constant (20) into a second site; the repo returns the unrounded 0–100 mean (`::float8`) and the service owns scale conversion + 2-decimal formatting through `SCORE_POINTS_PER_STAR` (`student-evaluation.service.ts:83,196`).
- **No second ad-hoc writer.** Never UPDATE `average_rating` from a new surface with its own arithmetic. The one sanctioned future writer is the rating soft-delete / moderation recompute hook (recorded as a documented seam in the deferred-items ledger, row **D3**): when that surface ships, it MUST compose `EvaluationRepository.aggregateLiveRatings` + `TeacherRepository.updateAverageRating` inside ITS OWN transaction — the aggregate already excludes soft-deleted rows, so the hook is a two-line composition, never a reimplementation.
- **Do not conflate with the platform-analytics average.** `getRatingStats` (`backend/db/repo/admin/platform-analytics.repository.ts:366-403`) computes a LIVE `avg(score)` over ALL evaluation kinds (applicant evaluations included) on the 0–100 scale, unrounded into a read model. The cached column is a 0–5 average of student session ratings only. Different metric, different scale, different family — switching analytics to the cached column (or pointing ranking at analytics) corrupts both.
- **Never catch or translate the `teacher_average_rating_check` violation.** A `23514` on the write is unreachable through the flow (scores are CHECK-bound 0–100 ⇒ the converted average is ≤ 5.00) and is deliberately un-handled: it must fail the transaction loudly, untranslated, as every other constraint surfacing in this repo does.
- **No locks on the path.** Do not add `FOR UPDATE` to the eligibility probe or wrap the aggregation in advisory locks — the concurrency argument in §5 does not depend on serialization.

## 8. API Surface & Repository Contracts

**Zero GraphQL surface.** No mutation return field, no query, no SDL byte moved — the mutation still returns the caller's own `Evaluation` row. The value is observable through the existing admin reads, which started reflecting the maintained column with zero code change on their side:

| Read surface | Path | Projection |
|---|---|---|
| `adminTeachers` directory | `backend/graphql/query/admin/admin-teachers.query.ts:58` → `TeacherRepository.listDirectory` (`backend/db/repo/teachers/teacher.repository.ts:296`) | `averageRating: string \| null` per row (`:314`) |
| `adminUserDetail` | `backend/graphql/query/admin/admin-users.query.ts:97` → `backend/db/repo/admin/admin-user.repository.ts:300` | `teacherAverageRating: string \| null` |

The two repository methods are the entire write-side contract:

```ts
// backend/db/repo/teachers/evaluation.repository.ts:171
export async function aggregateLiveRatings(
  evaluatedId: number,
  tx: DBTransaction
): Promise<EvaluationRatingAggregateType>;
// `tx` is REQUIRED (no cold branch): the result feeds the caller's
// same-transaction write, so the read must share the write's snapshot.
// Returns the live family mean on the 0-100 scale (`::float8` ⇒ a real JS
// number) + the sample size; an empty family yields
// { averageScore: null, ratingCount: 0 }.

// backend/db/repo/teachers/teacher.repository.ts:415
export async function updateAverageRating(
  teacherId: number,
  averageRating: string,
  tx: DBTransaction
): Promise<TeacherSelectType | null>;
// Guarded single-statement UPDATE … SET { averageRating, updatedAt: now() }
// WHERE id = $1 RETURNING. Decimal string in, full row out; zero rows ⇒
// null (no teacher row for the id — the CALLER owns that semantics: it is
// an invariant break on the submission path, not a recoverable miss).
// The CHECK clamp surfaces as the raw 23514, untranslated.
```

Consumers outside the submission flow must not call `updateAverageRating` (§7); reads go through the surfaces above.

## 9. References

- **Origin contract:** [`docs/teachers/student-evaluation-submission.md`](./student-evaluation-submission.md) — the rating write-once contract; its §3 forward-contract block (`:65-74`) is the aggregation clause this doc implements
- **Schema:** `backend/db/schema/teachers/teacher.ts` (`:27` column, `:37` clamp), `backend/db/schema/teachers/evaluations.ts` (score CHECK `:56`, evaluated-id index `:57`, write-once arbiter `:60`)
- **Implementation:** `backend/db/repo/teachers/evaluation.repository.ts` (`aggregateLiveRatings` `:171-193`), `backend/db/repo/teachers/teacher.repository.ts` (`updateAverageRating` `:415-426`), `backend/services/teachers/student-evaluation.service.ts` (pipeline `:137-209`, public entry `:248-301`)
- **Honest-null precedent:** `backend/db/repo/admin/platform-analytics.repository.ts:39-41` (ruling) and `:366-403` (the sibling live-average metric — see §7 before touching either)
- **Deferred rulings:** archived with the plan bundle at `ai/finished_plans/milestone_3_parent_portal_admin_governance/teacher_average_rating_aggregation_update/` — row **D1** (honest-null vs "default 0" ruling), row **D2** (ranking consumer, READ-ONLY), row **D3** (moderation recompute hook); per-row records live in the branch/PR history (PR #212)
- **Requirement anchors:** `docs/specs/state-machine-invariants.md` (INV-E4 — teacher evaluations update `teacher.average_rating`), `docs/specs/functional-requirements.md` (FR-8.2 — ratings influence search ranking)
- **Test locks:** `backend/db/test/repo/teachers/evaluation.repository.test.ts`, `backend/db/test/repo/teachers/teacher.repository.test.ts`, `backend/services/teachers/student-evaluation.service.test.ts`, `test/workflows/teachers/student-teacher-rating.journey.test.ts`
- **Sibling canonical docs:** [`docs/teachers/student-evaluation-submission.md`](./student-evaluation-submission.md), [`docs/teachers/applicant-lifecycle.md`](./applicant-lifecycle.md) (the `evaluations` table's other consumer), [`docs/admin/platform-analytics.md`](../admin/platform-analytics.md)
