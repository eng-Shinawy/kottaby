# Implementation Tasks: Teacher Average Rating Aggregation & Update

> **Plan of record:** `ai/plans/milestone_3_parent_portal_admin_governance/teacher_average_rating_aggregation_update/`
> **Specs:** `specs.md` REQ-001..REQ-012 (incl. REQ-J1..J3) · **Design:** `plan.md` D1–D13
> **Ticket:** DEV2-017 (`docs/planning/TICKETS.md:2108`) · Dev 2 · Milestone 3 · 3 SP · Blocker DEV2-016 shipped
> **Deliverables in this directory:** `specs.md` · `plan.md` · `tasks.md` · `deferred-items.md` · `outcome/`

## Non-Negotiable Execution Protocol

1. **Pre-execution read:** before ANY task, read ALL files under `ai/plans/milestone_3_parent_portal_admin_governance/teacher_average_rating_aggregation_update/outcome/` (baseline, review verdicts, prior task outcomes).
2. **Per-file quality loop:** after every file edit run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) before moving on.
3. **Test commands:** DB/service/journey tests run via `bun run test/scripts/run-test.ts <path>` (NEVER raw `bun test`); journey tests live under `test/workflows/` with committed fixtures + tracked cleanup, NO `runInRollback` there; DB/service tests DO use `runInRollback` + `tx`.
4. **Outcome write-back:** after each task, write `outcome/<task-id>-outcome.md`; flip the checkbox only after its gates pass.
5. **Semantic review:** complete the SR checklist (atomicity, env-config, dead code, cross-layer imports, value-imported enums, zero plan-artifact references in code comments) per subtask.
6. **Fix-or-report:** fix violations inside your assigned file; cross-file dependencies are reported to the orchestrator in the outcome file.

## Layer → Instructions Mapping (applies to every task)

| Path prefix | Read before editing |
|---|---|
| `backend/types/` | `backend/types/AGENTS.md`, `backend/AGENTS.md` + `.agents/instructions/backend.instructions.md` |
| `backend/db/repo/` | `backend/db/repo/AGENTS.md`, `backend/AGENTS.md` + backend + tests instructions |
| `backend/services/` | `backend/services/AGENTS.md`, `backend/AGENTS.md` + backend instructions |
| `backend/db/test/` | `backend/db/test/AGENTS.md` (if present), `backend/AGENTS.md` + tests instructions |
| `test/workflows/` | `test/workflows/AGENTS.md`, `test/workflows/helpers/` + tests instructions |
| `docs/` | root `AGENTS.md` doc conventions only |

(`scripts/health/sub-loop.ts` auto-prints the exact set per file — follow its output.)

---

## Phase 0 — Baseline & Gate

### - [x] 0.1 Baseline & Ledger Verification — `outcome/phase0-baseline-outcome.md`, `deferred-items.md`
- Re-run and record: `bun tsgo 2>&1 | grep -c "error TS"`, `bun run biome:check`, `bun run scripts/lint-service.ts --json --id baseline-dev2-017` — compare against the planning-time baseline (tsgo 0 errors · biome clean/2037 files · lint `success: true` exit 0 @ 2026-09-17); record delta, if any.
- Confirm `deferred-items.md` entries D1–D4 are present and still accurate.
- _Requirements: REQ-001_
- [x] 0.1.QL **Quality Loop**: not a code task — no sub-loop run; record commands' raw output in the outcome.
- [x] 0.1.TE **Test Engineering**: n/a.
- [x] 0.1.SEC **Security & Tenancy Audit**: n/a.
- [x] 0.1.SR **Semantic Review**: baseline numbers quoted from real command output, never from memory.
- [x] 0.1.IV **Instruction Verification**: root `AGENTS.md` quality-workflow section re-read.

### - [x] 0.2 Plan-Review Gate — `outcome/plan-review-R1.md`
- Confirm the generation-time Phase 1.5 review verdict (already recorded in `outcome/plan-review-R1.md` by the planning session) is present and clean; if implementation reveals drift, re-run the review and record R2 before continuing.
- _Requirements: REQ-001_
- [x] 0.2.QL/.TE/.SEC: n/a (verification task).
- [x] 0.2.SR **Semantic Review**: any spec↔code drift discovered during implementation is written back into specs/plan/tasks in the same commit.
- [x] 0.2.IV **Instruction Verification**: `.agents/spec-process-guide/` templates re-read.

---

## Phase 1 — Data Substrate (types only — zero schema change)

### - [x] 1.1 Canonical Aggregate Type — `backend/types/teachers/evaluation.types.ts` (EXTEND)
- Add `EvaluationRatingAggregateType` exactly per `plan.md` §2.3 (`{ readonly averageScore: number | null; readonly ratingCount: number }` with the doc-comment). All four existing exports stay byte-identical.
- `teacher.types.ts` is NOT touched (the UPDATE returns the existing `TeacherSelectType` — `plan.md` §2.3).
- Verify the barrel picks it up (`backend/types/teachers/index.ts` uses `export *` — no edit; prove with a type-level consumer import in the outcome).
- _Requirements: REQ-004_
- [x] 1.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/types/teachers/evaluation.types.ts --lifecycle duplicates` (exit 0).
- [x] 1.1.TE **Test Engineering**: type-level correctness is tsgo-enforced (Tier 1); no runtime tests for a type alias.
- [x] 1.1.SEC **Security & Tenancy Audit**: n/a (pure type).
- [x] 1.1.SR **Semantic Review**: no duplicate aggregate types anywhere; no new type in a service file.
- [x] 1.1.IV **Instruction Verification**: read `backend/types/AGENTS.md`, `backend/AGENTS.md` + printed instructions.

---

## Phase 2 — Backend (repository → journey-first → service)

### - [x] 2.1 Repository: Aggregate Read + Guarded Update — `backend/db/repo/teachers/evaluation.repository.ts` (EXTEND), `backend/db/repo/teachers/teacher.repository.ts` (EXTEND)
- Add `EvaluationRepository.aggregateLiveRatings(evaluatedId: number, tx: DBTransaction): Promise<EvaluationRatingAggregateType>` exactly per `plan.md` §4.2: single-row Drizzle select with `sql<number | null>`avg(${evaluations.score})::float8`` + `sql<number>`count(*)::int``, WHERE `eq(evaluatedId)` ∧ `isNotNull(sessionId)` ∧ `isNotNull(score)` ∧ `or(eq(isDeleted, false), isNull(isDeleted))` (NULL-safe soft-delete exclusion — precedent `platform-analytics.repository.ts:386-389`); `tx` REQUIRED; empty family ⇒ `{ averageScore: null, ratingCount: 0 }`. The `::float8` cast is load-bearing (pg returns bare `numeric` as a JS string — the repo's own aggregate precedent casts to float for exactly this reason, `platform-analytics.repository.ts:366-403`). Add `isNotNull` to the `drizzle-orm` import (`:39`).
- Add `TeacherRepository.updateAverageRating(teacherId: number, averageRating: string, tx: DBTransaction): Promise<TeacherSelectType | null>` exactly per `plan.md` §4.2: guarded single-statement `UPDATE … SET { averageRating, updatedAt: sql`now()` } WHERE id = $1 RETURNING`; zero rows ⇒ `null` (service owns semantics); the rating is a decimal string (Drizzle numeric mode).
- Amend BOTH file-header doc-comments (method inventories `teacher.repository.ts:2-38`, `evaluation.repository.ts:2-38`) in the same change.
- Repo tests: EXTEND `backend/db/test/repo/teachers/evaluation.repository.test.ts` with the aggregate matrix (live family mean; applicant rows `sessionId: null` excluded; soft-deleted excluded; NULL-score excluded from both mean and count; empty family ⇒ `{ null, 0 }`; boundaries 20/100 ⇒ the conversion 1.00/5.00 is NOT asserted here — the repo asserts the 0-100 mean as exact JS numbers `20` and `100`, which the float8 cast guarantees; a bare `::numeric` would arrive as a pg string) and EXTEND `backend/db/test/repo/teachers/teacher.repository.test.ts` with the update matrix (stores the exact decimal string + refreshes `updatedAt`; unknown id ⇒ `null` + zero writes; CHECK violation via a `> 5` input asserted with `expectRepoError` + `constraintNameOf(err) === "teacher_average_rating_check"` — never `expect().rejects`). Fixtures: `createTestUser` + `createTestTeacherRow` + `createTestEvaluation` (`entity-setup.ts:72,524,412`); `runInRollback` + `tx` everywhere.
- Run: `bun run test/scripts/run-test.ts backend/db/test/repo/teachers/evaluation.repository.test.ts` and `… teacher.repository.test.ts`.
- _Requirements: REQ-005, REQ-003, REQ-011.1_
- [x] 2.1.QL **Quality Loop**: sub-loop on both repository files + both test files (exit 0).
- [x] 2.1.TE **Test Engineering**: Tier 1 100% branch (empty family, non-empty, missing row); Tier 2 boundaries (score 20/100, teacher with only applicant rows); Tier 3 concurrent `aggregateLiveRatings` pair under `Promise.allSettled` (both read the same committed family — no corruption possible, assert stability); Tier 4 absurd ids (0, negative — bound-parameter safe; `Number.MAX_SAFE_INTEGER + 1` exceeds the int4 range and is asserted to surface the raw untranslated `22003` error — DRIFT NOTE: implementation-time finding, the plan's "empty family" wording was empirically wrong for that input; honest-behavior assertion is stronger).
- [x] 2.1.SEC **Security & Tenancy Audit**: the aggregate's only input is the teacher id — no parameter exists that could widen the family; the UPDATE takes no client value (server-computed string arrives at the service tier); no error translation in repos.
- [x] 2.1.SR **Semantic Review**: no SELECT-then-UPDATE guardlessness (identity-guarded update is the sanctioned form); `tx` unoptional on both writes; no prepared statements; no `inArray`; no business logic.
- [x] 2.1.IV **Instruction Verification**: read `backend/db/repo/AGENTS.md`, `backend/AGENTS.md` + printed instructions.

### - [x] 2.2 Journey Test Extension (test-first, RED) — `test/workflows/teachers/student-teacher-rating.journey.test.ts` (EXTEND)
- Extend the EXISTING journey (same describe, same cast, same registry) with the aggregation legs BEFORE the service step exists (RED by failure). NO new file, NO new cast, NO registry changes (`evaluations` + `teacher` are already tracked — `journey-fixture-registry.ts:81,102`; the teacher row is a fixture created by `buildSessionJourneyCast` and already registered for teardown).
- New steps (append after the existing step-9 read-back, renumber-free — insert as steps 9a/9b/9c or extend step bodies; keep the existing 10 steps' behavior byte-equivalent):
  1. after the existing 4★ submission: read the teacher row directly (`TeacherRepository.findById` or a raw `db` select on `teacher`) ⇒ `averageRating === "4.00"` (one live row, score 80 ⇒ 80/20).
  2. book + dual-confirm a SECOND session with the SAME teacher and rate it 2★ (score 40) through the real service ⇒ `averageRating === "3.00"` ((80+40)/2/20) — recomputed-from-source, not incremented.
  3. admin-observation leg: `TeacherRepository.listDirectory({}, 10, 0)` (raw repo read, journey-side — no GraphQL tier in journeys) returns the teacher with `averageRating === "3.00"` (the directory's exact projected shape, `AdminTeacherDirectoryRow.averageRating: string | null`, `teacher.repository.ts:97`).
  4. denial-purity: snapshot the teacher row before each existing denial step (duplicate re-submit, concurrent duplicate, `scheduled` denial, stamp-only denial, oracle denial) and byte-compare after ⇒ unchanged.
  5. applicant-evaluation exclusion: `createTestEvaluation` an applicant row (`sessionId: null`, e.g. `score: 90`) for the SAME teacher inside the fixture tx; submit a third rating (5★ ⇒ 100) ⇒ average reflects ONLY the three live rating rows ⇒ ((80+40+100)/3)/20 = `"3.67"` (assert the exact string), NOT the 90.
- Denial/purity assertions via the existing try/catch + `DomainError.code` helper pattern; teacher-row reads through the repo (no raw table import where a repo method exists — `TeacherRepository.findById` takes an optional `tx`; journeys call it cold).
- NO `runInRollback` (`test/workflows/AGENTS.md:8-11`); committed fixtures + `registry.track` every new row (the second + third sessions, their idempotency claims, the new rating rows, the applicant evaluation); run twice to prove idempotent teardown.
- Run (RED expected pre-2.3): `bun run test/scripts/run-test.ts test/workflows/teachers/student-teacher-rating.journey.test.ts`.
- _Requirements: REQ-J1, REQ-J2, REQ-J3, REQ-011.3_
- [x] 2.2.QL **Quality Loop**: sub-loop on the journey file (exit 0; the file may fail tests — type/lint must pass).
- [x] 2.2.TE **Test Engineering**: this IS the journey deliverable (Tier 1-4 legs: recompute, convergence, exclusion, denial purity, bounds).
- [x] 2.2.SEC **Security & Tenancy Audit**: cross-actor visibility asserted (student acts, admin-observation leg sees the value; denials leave the teacher row byte-identical).
- [x] 2.2.SR **Semantic Review**: fixtures committed + tracked; no seed rows; existing steps not weakened (diff-check step bodies).
- [x] 2.2.IV **Instruction Verification**: read `test/workflows/AGENTS.md` + tests instructions.

### - [x] 2.3 Service: Atomic Aggregation Step — `backend/services/teachers/student-evaluation.service.ts` (EXTEND)
- Implement the pipeline exactly per `plan.md` §4.1: inside `submitWithinTransaction` (`:122-175`), after `EvaluationRepository.insertOnce` (`:165-173`): (a) `aggregateLiveRatings(probe.teacherId, tx)`; (b) honest-null skip when `averageScore === null`; (c) `const averageRating = (aggregate.averageScore / SCORE_POINTS_PER_STAR).toFixed(2)` (reuse the existing constant `:74` — no second constant); (d) `TeacherRepository.updateAverageRating(probe.teacherId, averageRating, tx)`; (e) on `null` return — one bounded `logDenial(... "TEACHER_PROFILE_MISSING", "teacher", probe.teacherId, locale)` then `throw new Error(...)` (plain internal error, NOT a DomainError — D8).
- Import `TeacherRepository` from the already-imported `@/backend/db/repo` barrel (`:47` — extend the existing named import, never add a second import statement of the same module).
- Update the file header doc-comment: the cross-surface purity paragraph (`:35-37`) now names the teacher row's cached average as the second, same-transaction write target (keep: zero notification/audit/wallet/ledger/session-row writes); the pipeline-order paragraph names the aggregation step; `logDenial`'s JSDoc (`:79-86`) amended — the entity label follows `entityId`'s target table (`"teacher"` here, first non-session use).
- The public signatures, guard order, denial codes, and return shape are UNCHANGED (`plan.md` §4.1).
- Service tests (EXTEND `backend/services/teachers/student-evaluation.service.test.ts`): single 4★ rating on a fresh teacher ⇒ stored `"4.00"`; pre-seeded live ratings (e.g. two rows 60/50 via `createTestEvaluation` per the suite's existing fixture style) ⇒ exact recomputed mean `"3.50"` (DRIFT NOTE: the original wording "two rows 60/80 … ⇒ 3.50" was arithmetically inconsistent — (60+80+100)/3/20 = 4.00; implementation seeds 60+50 + a 5★ submission ⇒ (60+50+100)/3/20 = "3.50" exactly; recorded in `outcome/2.3-outcome.md` §Deviation #1); applicant rows seeded ⇒ excluded; soft-deleted rating seeded ⇒ excluded; duplicate submission ⇒ teacher row byte-identical (snapshot); every existing denial leg ⇒ teacher row byte-identical; write-purity oracles stay green (zero `notifications`/`audit_logs` rows — the suite's existing oracles, header `:28-31`); the returned `EvaluationReturnType` shape unchanged (existing assertions untouched).
- Journey (2.2) MUST go green here; capture run output in the outcome.
- Run: `bun run test/scripts/run-test.ts backend/services/teachers/student-evaluation.service.test.ts` and re-run the journey.
- _Requirements: REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011.2_
- [x] 2.3.QL **Quality Loop**: sub-loop on the service file + its test file (exit 0).
- [x] 2.3.TE **Test Engineering**: Tier 1 full branch (happy + the honest-null skip — covered via the aggregate's empty-family unit tests and a direct-note in the outcome, since the branch is unreachable through the public flow by construction); Tier 2 boundaries (all-20 ⇒ `"1.00"`, all-100 ⇒ `"5.00"`); Tier 3 concurrent same-teacher submissions (`Promise.allSettled` — both commit, final value within family bounds, CHECK never violated); Tier 4 role/oracle matrix re-run green.
- [x] 2.3.SEC **Security & Tenancy Audit**: BOLA (server-derived teacher id), BOPLA (member-built payload), purity oracles, zero new denials/codes/keys.
- [x] 2.3.SR **Semantic Review**: no module-level state; no `finally`-side aggregation; no second 20 constant; zero plan-artifact references in comments; value-imported enums unchanged.
- [x] 2.3.IV **Instruction Verification**: read `backend/services/AGENTS.md`, `backend/AGENTS.md` + printed instructions.

---

## Phase 3 — Integrity Gates (zero-surface proof)

### - [x] 3.1 SDL + Schema Integrity Verification — no file edits (verification task)
- Run `bun run generate:gqlSchema` and verify `git diff --stat frontend/graphql/generated/schema.graphql` is EMPTY (record raw output in the outcome). Do NOT run `bun codegen` (no SDL change).
- Verify `git status backend/db/schema/ backend/drizzle/` shows zero modifications (zero-schema gate, `plan.md` §7).
- Re-run the DEV2-016 GraphQL wire suite to prove the extension added no auth-bypass leg: `bun run test:graphql` (the existing `backend/graphql/test/student-evaluation.wire.test.ts` role/oracle matrix must stay green unmodified).
- IF either gate shows a diff THEN STOP and record the drift in the outcome + re-open the review gate (0.2) — the plan's zero-surface claims are load-bearing.
- _Requirements: REQ-008, REQ-003, REQ-002, REQ-009_
- [x] 3.1.QL **Quality Loop**: n/a (no edits; record the two diff-gates' raw output).
- [x] 3.1.TE **Test Engineering**: the wire-suite re-run IS the test leg (record suite counts).
- [x] 3.1.SEC **Security & Tenancy Audit**: the wire role matrix (student ✅ / teacher-parent-admin FORBIDDEN / anonymous UNAUTHORIZED) re-proven over the extended mutation.
- [x] 3.1.SR **Semantic Review**: confirm no stray edits escaped the planned file set (`git diff --name-only` vs the plan's artifact list).
- [x] 3.1.IV **Instruction Verification**: n/a (no code touched).

---

## Phase 4 — Review Wave & Knowledge Propagation

### - [x] 4.1 Post-Implementation Review Wave (parallel subagents)
- Dispatch scoped reviewers (types / backend / security — no frontend reviewer: zero frontend files change in this plan) over the plan's file set only: `backend/types/teachers/evaluation.types.ts`, `backend/db/repo/teachers/evaluation.repository.ts`, `backend/db/repo/teachers/teacher.repository.ts`, `backend/services/teachers/student-evaluation.service.ts`, `backend/db/test/repo/teachers/{evaluation,teacher}.repository.test.ts`, `backend/services/teachers/student-evaluation.service.test.ts`, `test/workflows/teachers/student-teacher-rating.journey.test.ts`, `docs/teachers/teacher-average-rating.md`. Aggregate findings CRITICAL→LOW; fix per-file with sub-loop verification; repeat until zero feature-specific findings. Record verdicts in `outcome/4.1-review-wave-outcome.md`.
- _Requirements: REQ-001, REQ-009, REQ-010_
- [x] 4.1.QL **Quality Loop**: sub-loop exit 0 on every file touched by fixes.
- [x] 4.1.TE **Test Engineering**: every fix re-runs its owning suite from `plan.md` §7.
- [x] 4.1.SEC **Security & Tenancy Audit**: reviewers reproduce the REQ-009 matrix from the service tests + wire suite.
- [x] 4.1.SR **Semantic Review**: zero deferred items created without a `deferred-items.md` entry.
- [x] 4.1.IV **Instruction Verification**: reviewers read each file's printed rule set.

### - [x] 4.2 Knowledge Propagation — `docs/teachers/teacher-average-rating.md` (NEW) + `docs/teachers/student-evaluation-submission.md` (pointer)
- Author the canonical doc per the propagation template: aggregation trigger (inside the submission tx — single-writer discipline), formula + row-selection contract (`ROUND(AVG(score)/20, 2)`, `session_id IS NOT NULL`, soft-deleted excluded — citing the DEV2-016 forward contract at `docs/teachers/student-evaluation-submission.md:65-68` as the origin), honest-null ruling vs the ticket's literal "default 0" (ledger D1), concurrency model (recompute-from-source, READ COMMITTED convergence), ranking forward contract (ledger D2), and what-NOT-to-do (no incremental updates, no separate tx/event/trigger, no SQL-side rounding duplicating the 20 constant, no second writer, no conflation with platform-analytics' live 0–100 AVG).
- Append a shipped-status pointer in `docs/teachers/student-evaluation-submission.md` §3's forward-contract block (`:65-74` — link only; the DEV2-016 contract text stays as history).
- Do NOT touch AGENTS.md / `.agents/instructions/` (hand-curated).
- _Requirements: REQ-012_
- [x] 4.2.QL **Quality Loop**: docs-only; run the markdown surface checks available in sub-loop and record the rest as n/a with evidence.
- [x] 4.2.TE **Test Engineering**: n/a (documentation).
- [x] 4.2.SEC **Security & Tenancy Audit**: doc discloses the contract accurately (no new denials, no new surfaces).
- [x] 4.2.SR **Semantic Review**: links resolve; line refs current at write time.
- [x] 4.2.IV **Instruction Verification**: n/a beyond root `AGENTS.md` doc conventions.

### - [x] 4.3 Final Gate & Definition-of-Done Audit
- `bun quality-gate` green; re-record tsgo/biome/lint counts against the 0.1 baseline (no regressions attributable to this plan).
- Full relevant suites green: both repo files' tests, the service suite, the journey, the wire suite (`test:graphql`).
- DoD sweep against `specs.md` §5; close the ledger (D1–D4 statuses updated); final checkbox sweep.
- _Requirements: REQ-001, REQ-011, all others transitively_
- [x] 4.3.QL **Quality Loop**: `bun quality-gate` exit 0.
- [x] 4.3.TE **Test Engineering**: suite table pasted into the outcome with counts.
- [x] 4.3.SEC **Security & Tenancy Audit**: REQ-009 matrix re-run once, end to end.
- [x] 4.3.SR **Semantic Review**: every REQ id from `specs.md` appears in this file (traceability command below).
- [x] 4.3.IV **Instruction Verification**: sweep — every edited file's printed rule set was read (attest in outcome).

## Traceability Command (run at 4.3)

```bash
cd ai/plans/milestone_3_parent_portal_admin_governance/teacher_average_rating_aggregation_update
for r in $(grep -oE 'REQ-[0-9]+' specs.md | sort -u); do grep -q "$r" tasks.md || echo "MISSING: $r"; done
for j in REQ-J1 REQ-J2 REQ-J3; do grep -q "$j" tasks.md || echo "MISSING: $j"; done
```

## Dependency Graph

```
0.1 → 0.2 → 1.1 → 2.1 → 2.2 (RED) → 2.3 (GREEN) → 3.1 → 4.1 → 4.2 → 4.3
```

(1.1 precedes 2.1 because the repo import consumes the type; 2.2 and 2.3 are a red/green pair and must not be reordered; 3.1 runs only after 2.3 is green; 4.2 may run in parallel with 4.1's review loop but precedes 4.3.)
