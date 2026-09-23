# Task 4 Outcome — Repository extensions + repo tests

**Plan:** `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`
**Task:** 4 — Repository extensions + repo tests (Phase 2 — Backend Foundation)
**Date:** 2026-09-21 · **Repo root:** `/home/z/my-project` (branch `main`; the working tree also carries the uncommitted Task 2/3 deltas — the orchestrator owns commits)
**Pre-execution reads:** ALL outcome files (`0-baseline-outcome.md`, `0-baseline-verified-outcome.md`, `plan-review-R1.md`, `2-schema-outcome.md`, `3-types-i18n-outcome.md`), `deferred-items.md`, `tasks.md` Task 4 + protocol, `plan.md` §4.2 (incl. the §4.2 SQL sketch: `AND session.created_at >= cycleStart`) and §10 NFR-P2, plus the rule files the sub-loop printed per file (below).
**Session note:** the session was cut off mid-task after the file edits landed; on resume the seven files were verified against plan §4.2 and driven through the full remaining gate (tests → sub-loop → semantic review → outcome → checkbox). No file was re-edited on resume — every check passed first pass.

---

## Summary

All four repository extensions landed exactly per plan §4.2, and no repository holds a business rule:

1. **`evaluation.repository.ts`** — `insertOnce`'s Pick widened with `notes`/`weaknessArea` (both optional; the student-rating call site stays type-compatible — it omits both and schema defaults store NULL); the raw-SQL read branch now projects `weakness_area`; NEW `findBySessionAndEvaluator` (the duplicate PRE-CHECK probe, soft-delete-deliberately-unfiltered) and `listCycleRubricSubmissions` (the cycle quorum read). A module-level `toWeaknessAreaMember` maps the raw pgEnum value through the fail-closed `isRubricWeaknessArea` guard so no foreign stored value can fabricate a member.
2. **`applicant.repository.ts`** — NEW `transitionToFailed(userId, cooldownUntil, tx)`: ONE guarded UPDATE (`status='in_evaluation'` folded into WHERE, `.returning()`), cooldown instant stored VERBATIM (zero duration arithmetic here), null on 0 rows — the `transitionToInEvaluation` shape.
3. **`session.repository.evaluation.helpers.ts`** — NEW `listCompletedRubricPendingSessions(evaluatorUserId, filter, tx)`: LEFT JOIN anti-join against the evaluator's OWN `evaluations` rows (join binds BOTH the session link and the evaluator id; predicate keeps `evaluations.id IS NULL`), pinned to `teacher_id = evaluator` + `TeacherEvaluation` + `Completed`, pagination normalized sane-fallback (page < 1 → 1; size outside 1..100 → 25, never throws), newest first, honest same-predicate `count(*)`. The unique arbiter caps the anti-join at one row per session so the count never multiplies.
4. **`session.repository.ts`** — the namespace-delegate const `SessionRepository.listCompletedRubricPendingSessions` (one-to-one delegation, the `listEvaluationSessionsForApplicant` pattern); header docblock updated to "four cycle reads".

Reused UNCHANGED per plan: `findForBookingGate`, `finalizeOnCertification`, `findForEvaluationGateById`, `insertColdStartCertified`, `elevateToCertified`, `resolveCurrentEvaluationCycle`, `countEvaluationBookingsInCycle`, `withTransaction`, `emitForUser`/`publishReceipts`, `transitionToInEvaluation`.

`bun tsgo` full-tree after all edits: **0 `error TS` lines** (baseline parity; artifact `/tmp/task4-tsgo.txt`).

---

## Files Modified

| File | Change | Sub-loop (`--lifecycle duplicates`) | Rule files read (printed by sub-loop) |
|---|---|---|---|
| `backend/db/repo/teachers/evaluation.repository.ts` | Pick widened +2 members; `weakness_area` in the raw-SQL projection; `toWeaknessAreaMember`; NEW `findBySessionAndEvaluator` + `listCycleRubricSubmissions`; header docblock corrected (rubric rows session-linked; soft-delete exclusion scoped to listing/aggregate reads) | exit **0** (tsgo ✅ oxlint ✅ biome ✅ lint:type-aware ✅ duplicates ✅) | `.agents/instructions/backend.instructions.md`; `AGENTS.md`; `backend/db/repo/AGENTS.md`; `backend/AGENTS.md` |
| `backend/db/repo/teachers/applicant.repository.ts` | NEW `transitionToFailed` (guarded single-statement write, tx REQUIRED, `ApplicantStatus` members as value imports) | exit **0** (all five ✅) | same set |
| `backend/db/repo/classes/session.repository.evaluation.helpers.ts` | NEW `RubricPendingSessionsFilter` + `RUBRIC_PENDING_MAX_PAGE_SIZE=100` + `listCompletedRubricPendingSessions` helper; `isNull` + `evaluations` imports; header updated to four reads; tx-required convention documented for the pending page | exit **0** (all five ✅) | same set |
| `backend/db/repo/classes/session.repository.ts` | + namespace-delegate const for `listCompletedRubricPendingSessions`; header docblock "three → four cycle reads" | exit **0** (all five ✅) | same set |
| `backend/db/test/repo/teachers/evaluation.repository.test.ts` | + 3 describes: `insertOnce — the rubric payload` (notes+weakness, NULL weakness, 23505 via `expectRepoError` in a SAVEPOINT bracket), `findBySessionAndEvaluator` (hit/miss/own-tx-visibility/soft-deleted-row-visible), `listCycleRubricSubmissions` (count correctness: DISTINCT pairs, `score IS NOT NULL`, half-open window, other-applicant exclusion, Tier-2 window boundary, Tier-4 absurd ids) | exit **0** (all five ✅; jscpd skipped — outside scan scope) | `.agents/instructions/tests.instructions.md`; `.agents/instructions/backend.instructions.md`; `AGENTS.md`; `backend/db/test/AGENTS.md`; `backend/AGENTS.md` |
| `backend/db/test/repo/teachers/applicant.repository.transition.test.ts` | + `ApplicantRepository.transitionToFailed` describe: flips `in_evaluation → failed` + stamps `cooldown_until` verbatim; 0-row guard on `passed`/`failed`/`pending`/absent pre-states; Tier-2 exact-instant pin; Tier-4 non-positive ids; source pins (single guarded statement, no console, no plan refs) | exit **0** (all five ✅; jscpd skipped) | same set |
| `backend/db/test/repo/classes/session.repository.evaluation.test.ts` | + `SessionRepository.listCompletedRubricPendingSessions` describe: anti-join semantics (own completed evaluation rows un-submitted only; another evaluator's submission changes nothing), pagination bounds + sane-fallback, honest total, out-of-range page; source pins (required-tx, canonical vocabularies, no plan refs, no SQL line comments) | exit **0** (all five ✅; jscpd skipped) | same set |

**Repo-layer barrels: none changed** — the three repository files are themselves the public namespace surface (the repo-layer convention); no index/barrel edit was needed.

## Files NOT Modified (scope guard)

No service, GraphQL, enum, schema, types, i18n, frontend, `app/`, seeds, AGENTS.md, or instruction file touched by THIS task. Task 2/3's uncommitted files (schema, enums, types, locale trees, error map, DBML) sit in the tree exactly as those tasks left them. No `db push` (schema unchanged by this task).

---

## Test Evidence (mandated runner only — raw `bun test` never used)

| Command | Result |
|---|---|
| `bun run test/scripts/run-test.ts backend/db/test/repo/teachers/evaluation.repository.test.ts` | exit **0** — **39 pass, 0 fail**, 142 expect() calls |
| `bun run test/scripts/run-test.ts backend/db/test/repo/teachers/applicant.repository.transition.test.ts` | exit **0** — **32 pass, 0 fail**, 103 expect() calls |
| `bun run test/scripts/run-test.ts backend/db/test/repo/classes/session.repository.evaluation.test.ts` | exit **0** — **24 pass, 0 fail**, 61 expect() calls |
| `bun tsgo 2>&1 \| grep "error TS" \| wc -l` | **0** |

All suites run under `runInRollback` (pre-existing pattern; the concurrency tier in the evaluation suite keeps its committed-fixtures + independent-transactions shape). Every denial probe goes through `expectRepoError` (7 usages in the evaluation suite) — zero `expect(...).rejects.toThrow()` (pinned by the suites' own source-scan tests). Test DB readiness: `kottaby_test` now carries `rubric_weakness_area` + `evaluations.weakness_area` (the Task 2 carry-forward was resolved by the orchestrator's refresh) — all green.

---

## Method Signatures Handed to Task 6 (exact)

```ts
// EvaluationRepository (backend/db/repo/teachers/evaluation.repository.ts)
export async function insertOnce(
  values: Pick<EvaluationInsertType,
    "evaluatedId" | "evaluatorId" | "sessionId" | "score" | "notes" | "weaknessArea">,
  tx: DBTransaction
): Promise<EvaluationSelectType>;
// → raw 23505 on `evaluations_session_evaluator_unique` propagates UNCAUGHT (service maps it to
//   EVALUATION_ALREADY_SUBMITTED via the cause-chain); notes/weaknessArea optional — omit them in
//   the student-rating path, supply notes always + weaknessArea iff score < 80 in the rubric path.

export async function findBySessionAndEvaluator(
  sessionId: number, evaluatorId: number, tx: DBTransaction
): Promise<EvaluationSelectType | null>;
// → null on miss. tx REQUIRED. Deliberately does NOT filter is_deleted: the unique arbiter sees
//   soft-deleted rows, so the pre-check must observe exactly what a colliding insert would hit.
//   Optimization only — the 23505 remains the arbiter for the race the pre-check cannot close.

export async function listCycleRubricSubmissions(
  applicantUserId: number, cycleStart: Date, tx: DBTransaction
): Promise<readonly RubricCycleSubmissionRow[]>;
// → INNER JOIN sessions; WHERE session.student_id = applicant AND session_type = TeacherEvaluation
//   AND status = Completed AND evaluations.score IS NOT NULL AND session.created_at >= cycleStart
//   (the plan §4.2 sketch's half-open window); ORDER BY evaluations.created_at ASC, id ASC — the
//   deterministic feed for the failure-area tie-break. Rows are DISTINCT (session, evaluator) pairs
//   by the unique arbiter. weaknessArea arrives fail-closed-mapped (never a foreign value).
//   tx REQUIRED: call it AFTER findForBookingGate's FOR UPDATE, in the same tx, so a rival
//   evaluator's committed submission is visible before the quorum decision (REQ-5.6).
//   The repo returns rows ONLY — count/verdict/derivation are the service's.

// ApplicantRepository (backend/db/repo/teachers/applicant.repository.ts)
export async function transitionToFailed(
  userId: number, cooldownUntil: Date, tx: DBTransaction
): Promise<ApplicantSelectType | null>;
// → ONE guarded UPDATE: SET status='failed', cooldown_until=<verbatim>, updated_at=now()
//   WHERE id = userId AND status='in_evaluation' RETURNING *. Null on 0 rows = the applicant was
//   already passed/failed, never in_evaluation (pending), or absent — service disambiguates
//   (null → APPLICANT_ALREADY_FINALIZED + rollback). NO users.suspended* write here (D1 boundary).

// SessionRepository (backend/db/repo/classes/session.repository.ts → helpers delegate)
export const listCompletedRubricPendingSessions =
  sessionRepositoryEvaluationImpl.listCompletedRubricPendingSessions;
// (evaluatorUserId: number, filter: { page: number; pageSize: number }, tx: DBTransaction)
//   => Promise<{ items: SessionSelectType[]; totalCount: number }>
// → evaluator's OWN completed teacher_evaluation sessions with NO own evaluation row (anti-join);
//   another evaluator's submission on a session does NOT hide it. Page sane-fallback (page < 1 → 1;
//   size outside 1..100 → 25; never throws); newest first (created_at DESC, id DESC); out-of-range
//   page → empty items + unchanged total. tx REQUIRED (same snapshot as the certification check).
```

---

## Semantic Self-Review (all items)

- **Guarded single-statement writes / no read-modify-write:** `transitionToFailed` = one UPDATE with the pre-state in WHERE + `.returning()`; `insertOnce` = one INSERT…RETURNING; all new reads are single SELECTs (the pending page's page+count pair is two reads over one frozen predicate, no write). No read-modify-write anywhere.
- **`tx` mandatory on every new method:** yes — `findBySessionAndEvaluator`, `listCycleRubricSubmissions`, `transitionToFailed`, `listCompletedRubricPendingSessions` all take `tx: DBTransaction` last, no standalone-executor fallback branch (the only two-branch read, `listByEvaluator`, is pre-existing and untouched).
- **Enums as value imports:** `SessionType`/`SessionStatus` (evaluation.repository.ts, helpers) and `ApplicantStatus` (applicant.repository.ts) are runtime value imports used inside typed `eq(...)` expressions — never string literals; `isRubricWeaknessArea` is a runtime value import (the fail-closed map), `RubricWeaknessArea` type-only (type positions only in this file). No `import type` on any runtime-used enum symbol.
- **No dead branches:** the guards' fallback arms (`safePage`, `safePageSize`, `?? null`, `?? 0`) are all reachable sane-fallbacks, not dead code; `toWeaknessAreaMember`'s null arm is the student-rating shape.
- **No cross-layer imports:** repo files import only `@/backend/db/**`, `@/backend/enum/**`, `@/backend/types` — no service/GraphQL/shared-locale reaches.
- **No plan-artifact references:** grep over the four repo files → zero matches (and each suite pins this with a source-scan assertion: `expect(/REQ-\d|DEV2|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(source)).toBe(false)`); docblocks describe domain behavior only.
- **No `console.*`:** zero occurrences (pinned by source-scan assertions in all three suites).
- **SEC:** all predicates are typed/bound Drizzle expressions; no LIKE, no string interpolation into SQL, no prepared statements, no SQL line-comment sequences (all pinned by the suites' source-scan tests); no wildcard selects.
- **SR (repo AGENTS):** no business rules in the repo layer — the quorum read returns rows; verdict, derivation, cooldown arithmetic, and error mapping all stay with the service (Task 6).

## Cross-File Dependencies & Carry-Forward for Task 6

1. **Ordering contract (REQ-5.6):** inside `withTransaction(outerTx, …)`: `findForBookingGate` (FOR UPDATE) → gates → `insertOnce` → `findBySessionAndEvaluator` may be used earlier as the duplicate pre-check → `listCycleRubricSubmissions(studentId, cycleStart, tx)` under the held lock; `resolveCurrentEvaluationCycle` supplies `cycleStart` (null → SESSION_NOT_FOUND fold).
2. **23505 cause-chain:** the raw error's constraint is `evaluations_session_evaluator_unique` (name pinned by the evaluation suite's `constraintNameOf` helper) — map to `EVALUATION_ALREADY_SUBMITTED`; `transitionToFailed`'s null is the `APPLICANT_ALREADY_FINALIZED` trigger.
3. **Types/enum/constants:** `RubricCycleSubmissionRow` (+ `RubricEvaluationReturnType`, `RubricSubmissionInsertInput`) from `@/backend/types`; value-import `RubricWeaknessArea` from `@/backend/enum/teachers/rubric-weakness-area.enum` when composing `RubricEvaluationReturnType`; thresholds `RUBRIC_PASS_THRESHOLD=80`, `TAJWEED_COOLDOWN_DAYS=30`, `HIFZ_COOLDOWN_DAYS=90` from `shared/constants/evaluation-rubric.constants.ts` (service, NOT repo, does the `now + N days` arithmetic).
4. **Projections:** `listCompletedRubricPendingSessions` returns full `SessionSelectType[]` + honest total — the GraphQL `SessionPage` mapping (Task 7) consumes it; `listCycleRubricSubmissions` returns the sealed ≤5-row projection for PASS/FAIL aggregation and `derivePrimaryFailureArea` (ties → earliest `created_at` — the ASC order guarantees the first minimum wins a stable scan).
5. **Test-DB state:** `kottaby_test` carries the Task 2 delta (verified: enum + column present) — Task 6's service suites can use the new columns immediately.

## Deferred-Items Check

No new deferred work discovered — the ledger stays at D1–D4 (all cross-ticket, all `Blocked`, all with target-ticket pointers). The repo layer deliberately contains no suspension-state write (D1), no students conversion (D2), no admin surface (D3), no re-evaluation/average-rating handling (D4); no row added.

## Verification Line (task-scoped)

`15 REQ targets tracked for the plan · this task verified REQ-3 + REQ-8.1-8.2 (transitionToFailed) + REQ-14.2 (Tier-2 boundary pins) + REQ-15 (tx-disciplined, arbiter-backed writes) · BUN cmd(s) that passed: bun run test/scripts/run-test.ts × 3 suites (39/32/24 pass, 0 fail); bun tsgo (0 errors); sub-loop × 7 files (all exit 0) · requirements deferred (IDs): none new (D1–D4 unchanged)`
