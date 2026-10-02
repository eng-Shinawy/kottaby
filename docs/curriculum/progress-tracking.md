# Student Progress Tracking — Pointer-Row Increment

This doc consolidates the durable engineering patterns from the Student Progress Tracking &
Increment implementation — the writer that connects the settled Tajweed-session confirmation
arm to the curriculum, and the gated read that exposes a student's curriculum position. It
exists so the next curriculum-adjacent ticket (Teacher Preparation View, Hifz tracking,
arbitration-path increments) starts from proven rails instead of re-deriving them.

## Why

The `progress` table existed (`backend/db/schema/classes/progress.ts`: `student_id`,
`lesson_id`, timestamps, student-cascade / lesson-set-null FKs) with **no writer at all** —
`ProgressRepository` exposed only `countForStudent`. Sessions completed and settled with no
connection to the curriculum they teach. This feature made the table live with the smallest
possible blast radius: **zero schema delta** (the table consumed exactly as shipped), one new
service, one new read query, and exactly one added `await` on the shipped dual-confirmation
settlement path.

The pointer semantics: a student has **at most one progress row per governing plan**; its
`lesson_id` IS the student's current lesson (one slot ahead of the last completed one) in the
plan's `id ASC` curriculum sequence — the ordering contract shipped by the lessons CRUD.
"Completing" a session advances the pointer to the next lesson; finishing the curriculum pins
it at the final lesson forever.

## Pattern — exactly-once side effect anchored on a guarded transition

When a domain side effect must fire exactly once per state transition and share the
transition's atomicity, **anchor it inside the transition's already-exactly-once success arm**
rather than building a new idempotency mechanism:

1. **Find the guarded arm.** `confirmCompletionInTx` already had one: `confirmStudentCompletionOnce`
   is a guarded UPDATE whose zero-row result routes replays (double-confirm, retries,
   admin-consumed holds) into `resolveSettledOrConflict`, which returns the settled row
   untouched. The progress increment sits inside the non-null arm, strictly after the wallet
   credit, on the SAME transaction — the credit and the pointer advance commit or roll back
   together (fail-closed on genuine DB errors; proven by a trigger-injected failure test).
2. **Gate on semantics, never on finance.** Sessions carry `intent` (hifz / tajweed /
   evaluation) AND settle through balance *lanes* — and `intentLaneFor` maps BOTH tajweed and
   evaluation to the tajweed lane. The lane is financial; only `intent === SessionIntent.Tajweed`
   advances curriculum progress. Evaluation sessions settle through the same lane and
   provably never move the pointer.
3. **Serialize on a row that always exists.** A `FOR UPDATE` on the pointer row cannot close
   the first-insert race (the row does not exist yet — locking nothing). The per-student
   serializer is `StudentRepository.findByIdForUpdate` on the always-existing `students` row,
   taken BEFORE any context or pointer read. Two different sessions of one student settling
   concurrently advance the pointer exactly two slots with exactly one row; the same session
   confirming twice advances it once.
4. **Log-and-skip context misses; fail-closed on real errors.** A settlement must never roll
   back because curriculum context is absent. No active tajweed-lane subscription, an empty
   plan, a vanished pointer row on update — each emits exactly one structured domain log
   (`logSkip` with machine reasons: `no-active-tajweed-subscription` / `no-lessons` /
   `pointer-reanchored` / `pointer-row-missing-on-update`) and returns. An unexpected throw
   propagates and rolls back the whole confirmation.

## Rules — the pointer-row model

- **Plan resolution is lane-keyed and deterministic.** The governing plan = the student's
  most recent ACTIVE subscription whose plan's `balance_lane` is tajweed:
  `subscriptions ⋈ plans`, `ORDER BY start_date DESC NULLS LAST, id DESC LIMIT 1`, status and
  lane bound as enum members (never literals). Nullable `start_date` sorts LAST on the DESC
  scan — Postgres's implicit NULLS FIRST for DESC would let a never-stamped row win "latest".
- **Lazy initialization, no empty rows.** The first settled completion INSERTS the pointer
  (at lesson 2 for multi-lesson plans, at the single lesson otherwise). Students who never
  finish a session have zero rows; the read API reports `hasProgress: false` with null lesson
  fields — honest zero, never a fabricated percentage.
- **In-place re-anchor for lesson-less rows.** When an admin deletes the lesson a pointer
  references, the FK sets `lesson_id` NULL — which makes the row INVISIBLE to a plan-scoped
  join read. The increment probes `findNullLessonRowForStudent` (newest lesson-less row) on a
  join miss and re-anchors that SAME row in place (one row stays one row; the
  `pointer-reanchored` log fires from real traffic). A row whose lesson moved to a DIFFERENT
  plan is a plan-switch: it stays dormant and the new plan's first completion inserts a fresh
  pointer — the plan-scoped join makes the old row invisible without mutating it.
- **Curriculum-complete cap.** When the pointer is at the final lesson, further completions
  are byte-identical no-ops (no lesson change, no `updated_at` touch). The read API reports
  `isOnFinalLesson` — the zero-column model cannot distinguish "on the final lesson" from
  "finished the curriculum", and `isOnFinalLesson` communicates exactly what the data knows.
- **Read authorization is role-scoped with a relationship gate.** GraphQL scope
  `$all { authenticated, role: [Admin, Teacher, Student] }` stops parents (403) and anonymous
  callers (401) BEFORE the resolver runs — and the explicit `$all` conjunction is REQUIRED:
  Pothos combines keys of ONE scope map with ANY semantics, so a plain map would grant any
  authenticated caller. Inside the service: students are locked to `studentId === caller.id`
  (the arg is a selector, never an identity claim); teachers need
  `countTeacherStudentSessions ≥ 1` on the SAME transaction/snapshot as every data read
  (repeatable read); denials are constant-shape `ForbiddenError` before any existence probe
  (no existence oracle). The writer is internal-only — never exported through GraphQL.
- **DTOs are computed, never spreads.** The read payload is field-picked composition over
  real rows; `completionPercent = floor(lessonsCompleted × 100 / totalLessons)` has ONE
  definition (the service helper) that tests pin with literals (33/66 on a 3-lesson plan).

## Anti-patterns (each cost a review round)

- **Lane used as the trigger.** Evaluation sessions share the tajweed balance lane; gating
  the increment on the lane would corrupt the pointer on every settled evaluation.
- **`FOR UPDATE` on a not-yet-existing row.** It locks nothing — the first-insert race
  survives. Lock the student row instead.
- **Plan-scoped join as the only pointer read on the write path.** A lesson-less (or
  moved-lesson) row reads as no-row → the increment inserts a duplicate pointer and the
  orphan accumulates. Probe the lesson-less row on a join miss; classify explicitly.
- **Spy-probe tests for a dead branch.** If a branch is only reachable by mocking the read
  that feeds it, the branch is dead in production — fix the read, not the test.
- **`ORDER BY <nullable> DESC` without NULLS LAST.** "Latest" silently becomes "the
  never-stamped row".
- **Hardcoded English in resolver-thrown errors.** Resolver errors localize via
  `ctx.t("errorsTranslations")`; the anonymous-narrowing branch is not an exception.
- **A test reusing the production helper as its own oracle.** Pin literals (33, 66) instead.
- **Stale TDD-status comments shipped in the final test.** If a header claims legs fail "by
  design" and they now pass, the header lies — keep test prose in present tense.
- **`git add` with any nonexistent path.** It aborts the ENTIRE staging operation, including
  the valid paths listed before the bad one — verify `git show HEAD --stat` against the
  intended file list after every commit.

## Rollout & operational notes

- Deployment: nothing to migrate — schema untouched; the GraphQL additions are purely
  additive (`bun run generate:gqlSchema` + `bun codegen` artifacts committed). Rollback =
  revert the one hook line in `session-lifecycle.confirmation.ts`; the read query is harmless
  left in place.
- Consumer contract for the next UI ticket: `studentProgress(studentId: Int!)` returns
  `hasProgress`, plan echo, `totalLessons`, current-lesson trio (1-based position),
  `lessonsCompleted`, floor `completionPercent`, `isOnFinalLesson`. `hasProgress: false`
  (no row, no subscription) is the machine signal for "First session — diagnostic"; a
  lesson-less row in recovery displays as position 1 / 0% with `hasProgress: true`.
- Parent portal (`parentChildProgress`) intentionally unchanged: it keeps rendering the raw
  `countForStudent` (0 → 1 once tracking begins). Percentage/lesson-name upgrade for parents
  is future scope; per-lesson completion history is future scope; arbitration-path increments
  are future scope (those paths complete without wallet settlement — progress follows
  money-settlement, consistently).

## Related

- `docs/curriculum/lessons-crud.md` — the `id ASC` ordering contract this feature consumes.
- `docs/billing/escrow-and-wallet-crediting.md` — the settlement slice the increment anchors on.
- `docs/specs/state-machine-invariants.md` §9.2 (INV-PR1..3) · `docs/specs/functional-requirements.md` §6 (FR-6.1..6.3).
- Plan (archived): `ai/finished_plans/milestone_2_matching_notifications_escrow/student_progress_tracking_&_increment-progress_tracking_increment/`.
- Journey conventions: `test/workflows/AGENTS.md` — the cross-actor journey
  (`test/workflows/classes/tajweed-progress-increment.test.ts`) is the reference for
  committed fixtures + tracked zero-residue cleanup, honest role provisioning, and
  real-Postgres concurrency legs (`Promise.allSettled` double-confirm; two-teacher settle race).
