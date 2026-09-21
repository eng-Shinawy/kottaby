# Tasks — Student Progress Tracking & Increment

> **Plan directory (verbatim):** `ai/plans/milestone_2_matching_notifications_escrow/student_progress_tracking_&_increment-progress_tracking_increment/`
> **Specs:** `specs.md` (REQ-001..REQ-012) · **Design:** `plan.md` · **Ledger:** `deferred-items.md` · **Outcomes:** `outcome/`
> **Ticket:** `docs/planning/TICKETS.md:1180-1217` — Dev 1 · M2 · 5 SP

## Document Information

| Field | Value |
|---|---|
| Version / Date | 1.0 · 2026-09-21 |
| Sequencing | Foundation-first with interleaved tests; journey authored test-first (Task 5 red) before the hook (Task 6 green) |
| Phase 2.5 mid-point gate | SKIPPED — backend-only plan, < 15 implementation tasks, no frontend phase |
| Drizzle | ZERO schema delta → NO `db push`/`db migrate`; GraphQL additions require `bun run generate:gqlSchema` + `bun codegen` (Task 7) |

## Non-Negotiable Execution Protocol (all tasks)

1. Read ALL files in `outcome/` before starting a task.
2. After ANY file edit: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → exit 0 (sub-loop auto-prints applicable AGENTS.md + `.agents/instructions/*` — read them).
3. Complete the semantic-review checklist before `[x]` (tenancy, races, enums-as-values, no cross-layer imports, no dead code).
4. Write `outcome/<task-id>-outcome.md`; flip the checkbox.
5. Never `console.*` — `logger` from `@/backend/lib/logger`; domain rejections via `logger.logDomainError`.
6. No `Translation.` enum, no two-arg `getTranslations` calls, no frontend logging imports (this plan ships zero frontend code); workflow tests run via `bun run test/scripts/run-test.ts`, never raw `bun test`.

### Layer → rule-file map (absolute; sub-loop re-prints them)

| Layer touched here | AGENTS.md | `.agents/instructions/` |
|---|---|---|
| Types `/home/ahmed/Projects/kottaby_kottaby/backend/types/` | `…/backend/types/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md` |
| Repos `/home/ahmed/Projects/kottaby_kottaby/backend/db/repo/` | `…/backend/db/repo/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md` |
| DB tests `/home/ahmed/Projects/kottaby_kottaby/backend/db/test/` | `…/backend/db/test/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md`, `tests.instructions.md` |
| Services `/home/ahmed/Projects/kottaby_kottaby/backend/services/` | `…/backend/services/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md` |
| GraphQL `/home/ahmed/Projects/kottaby_kottaby/backend/graphql/` | `…/backend/graphql/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md` |
| Shared locale `/home/ahmed/Projects/kottaby_kottaby/shared/locale/` | `…/shared/locale/AGENTS.md`, `…/shared/AGENTS.md`, root | — |
| Journeys `/home/ahmed/Projects/kottaby_kottaby/test/workflows/` | `…/test/workflows/AGENTS.md`, root | `tests.instructions.md` |

## Phase 0 — Baseline

- [ ] 0. Baseline + ledger check
  - Record: `bun tsgo 2>&1 | grep -c "error TS" > /tmp/baseline-tsgo.txt`; `bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt`; `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json`
  - Read `deferred-items.md` (D1 ledger understanding; items D2..D7 are intentional deferrals, not blockers)
  - Write `outcome/0-baseline-outcome.md`
  - _Requirements: REQ-001_

## Phase 1 — Types, Repositories, i18n

- [ ] 1. Create `backend/types/classes/progress.types.ts`
  - Contents exactly per plan §3.2 (`ProgressSelectType`, `ProgressInsertType`, `ProgressReturnType`, `StudentProgressReturnType`); add `export * from "./progress.types";` to `backend/types/classes/index.ts` (named export only on TS2308 collision)
  - [ ] 1.QL `bun run scripts/health/sub-loop.ts backend/types/classes/progress.types.ts --lifecycle duplicates` → 0
  - [ ] 1.TE type-level: compile-time usage probe inside repo tests (Task 2 covers runtime); no runtime behavior to test
  - [ ] 1.SEC DTO has no `Date` leaks to wire (`toISOString` at Pothos layer if ever needed — none currently); no row spread
  - [ ] 1.SR semantic: readonly fields; no invented optional fields
  - [ ] 1.IV read printed rule files (types layer)
  - _Requirements: REQ-003, REQ-009_
- [ ] 2. Repository additions (+ repo tests)
  - `backend/db/repo/classes/progress.repository.ts`: add `findRowForStudentPlan` (plan-scoped join read, `progress.id DESC` determinism), `insertRow`, `updateRowLesson` (set `lessonId` + `updatedAt: new Date()`; null on zero-row) — plan §5.3. NOTE: concurrency serialization lives in the SERVICE via `StudentRepository.findByIdForUpdate` (student row lock, already shipped at `student.repository.ts:299`) — no `FOR UPDATE` repo variant is added to the progress repo
  - `backend/db/repo/billing/subscription.repository.ts`: add `findLatestActivePlanIdForLane` (active + lane join + `start_date DESC, id DESC` LIMIT 1)
  - `backend/db/repo/classes/session.repository.ts`: add `countTeacherStudentSessions` (mirror `countForStudent`/`countForTeacher` :649-673)
  - Extend tests: `backend/db/test/repo/classes/progress.repository.test.ts`, `backend/db/test/logic/billing/subscription.repository.test.ts` (the subscription repo test lives under `logic/billing/`, not `repo/billing/`), `backend/db/test/repo/classes/session.repository.test.ts` — all `runInRollback` + `tx` propagation + `expectRepoError` try/catch (never `.rejects`)
  - [ ] 2.QL sub-loop `--lifecycle duplicates` → 0 on all 6 files
  - [ ] 2.TE T1 100% branches; T2: null row, multi-plan partitioning, lane mismatch, zero sessions; T3: `Promise.allSettled` concurrent increments (driven via the SERVICE in Task 4 — the student-row lock, not this repo's read, is the serializer); T4: hostile ids (0, negative, SQL-shaped strings coerced by typed drivers)
  - [ ] 2.SEC raw SQL parameterized only; no new indexes assumed (verify `session_teacher_id_student_id_idx` name in schema before asserting)
  - [ ] 2.SR reads run via `queryDb` fallback where repo convention requires; tx-last signatures
  - [ ] 2.IV rule files per table above
  - _Requirements: REQ-003, REQ-004, REQ-008, REQ-010_

- [ ] 3. i18n errors leaf group `studentProgress`
  - `shared/locale/types/errors/labels.ts`: add `interface StudentProgressErrorsLabels { readonly studentNotFound: string; }` + `readonly studentProgress: StudentProgressErrorsLabels;` on `ErrorsLabels` (after `lessonCatalog` block, mirroring :16-22/:116)
  - `shared/locale/en/errors/index.ts` + `shared/locale/ar/errors/index.ts`: add `studentProgress: { studentNotFound: <localized> }` (Arabic: formal MSA, generic — no ids in copy)
  - Run existing errors-parity test to green
  - [ ] 3.QL sub-loop `--lifecycle duplicates` on all 3 files → 0
  - [ ] 3.TE parity test green; copy contains no interpolations (static leaf)
  - [ ] 3.SEC no identifiers inside copy
  - [ ] 3.SR no `Translation.` enum, no two-arg `getTranslations` anywhere in diff
  - [ ] 3.IV shared/locale AGENTS.md rules
  - _Requirements: REQ-002, REQ-009, REQ-010_

## Phase 2 — Service, Journey (test-first), Hook

- [ ] 4. `StudentProgressService` (`backend/services/classes/student-progress.service.ts` + `student-progress.helpers.ts`)
  - Implement exactly per plan §5.1/§5.2 (`getStudentProgress`, `incrementForConfirmedSession`, helpers `emptyProgress`/`computePosition`/`computePercent`/`logSkip`)
  - Tests `backend/db/test/logic/classes/student-progress.service.test.ts` (rollback-based logic tests; lessons-plan precedent `backend/db/test/logic/classes/lesson.service.test.ts`):
    - increment: insert-on-first (2-lesson+ plan), insert-single-lesson pinned, advance middle, pin-at-last, intent gate (evaluation/hifz skip), no-subscription skip+1 log, zero-lessons skip, null-pointer re-anchor
    - read: full DTO composition, percent floor math (0/33/66/…), `hasProgress:false` shapes, all 4 role paths + malformed id + admin-missing-student 404
  - [ ] 4.QL sub-loop on all 3 files → 0
  - [ ] 4.TE T1 100% on both service paths; T2 boundaries above; T3 double-increment race (`Promise.allSettled` on two sessions); T4 role probes
  - [ ] 4.SEC student arg forced for student callers; teacher gate count on same tx; no client input reaches writes
  - [ ] 4.SR no `session-lifecycle.*` import (cycle); `SessionIntent`/`SubscriptionCreditLane`/`SubscriptionStatus` imported as VALUES; `getServerTranslations(locale ?? "en").errorsTranslations` only for the NotFoundError copy; increment takes the student-row lock BEFORE reading the pointer
  - [ ] 4.IV services-layer rule files
  - _Requirements: REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011_

- [ ] 5. Journey test FIRST — `test/workflows/classes/tajweed-progress-increment.test.ts`
  - Actor cast via `test/workflows/helpers` (`provisionStudentActor`, `provisionCertifiedTeacherActor`, `provisionAdminActor`); second teacher for the foreign-denial probe; fixtures: tajweed plan + 3 lessons (service-level creation or repo insert inside the committing fixture tx — check `entity-setup.ts` first per convention), ACTIVE tajweed subscription
  - Encode REQ-010 steps 1–10 as sequential `test("…step N…")` blocks; service-level calls (`startSession`/`completeSession`/`confirmSessionCompletion`, `StudentProgressService.getStudentProgress`); spy the notification transport (`SpiedFanoutTransport`); DENIAL legs use `catchJourneyError` + `toBeInstanceOf(ForbiddenError)` + `code === "FORBIDDEN"`
  - Concurrency legs: `Promise.allSettled` double-confirm on ONE session ⇒ exactly one pointer advance; two DIFFERENT sessions (different teachers) settling concurrently for the same student ⇒ pointer advances exactly twice (student-row lock serialization) and no duplicate pointer row exists
  - Run: `bun run test/scripts/run-test.ts test/workflows/classes/tajweed-progress-increment.test.ts` — EXPECTED RED on the advance assertions (hook not landed yet); all denial/read-shape legs may pass
  - [ ] 5.QL sub-loop → 0 on the test file
  - [ ] 5.TE the journey IS the Tier-3/4+workflow evidence; zero `runInRollback`; `afterAll` hard-cleanup with re-probe (zero residue)
  - [ ] 5.SEC denial probes included (foreign teacher, parent-scope is Task 7 wire-level)
  - [ ] 5.SR honest authorization (no role monkey-patching); unique `jrn_prog_<uuid8>` prefix; never `bun test` directly
  - [ ] 5.IV `test/workflows/AGENTS.md` + `tests.instructions.md`
  - _Requirements: REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-010, REQ-011_
- [ ] 6. Hook the increment into the settlement slice
  - Edit `backend/services/classes/session-lifecycle.confirmation.ts`: after `await creditTeacherEarning(confirmed, confirmed.fee, tx);` (line 129) insert `await StudentProgressService.incrementForConfirmedSession(confirmed, tx);`; add import `@/backend/services/classes/student-progress.service`
  - Update the module docblock (top-of-file behavior contract) to mention the progress side effect — keep it domain-worded, no REQ/task references
  - Extend `session-lifecycle.service.test.ts` confirm-path tests: pointer advances on first confirm; replay (second confirm via `resolveSettledOrConflict`) does NOT advance; evaluation-intent confirm does NOT advance
  - Re-run journey → GREEN (Task 5 flips)
  - [ ] 6.QL sub-loop → 0 on both code files + test file
  - [ ] 6.TE covered by service tests + journey green; T3: `Promise.allSettled` double-confirm at the service surface
  - [ ] 6.SEC writer reachable ONLY internally (never exported through GraphQL); unexpected throw ⇒ whole confirmation rolls back (assert via failure-injection test)
  - [ ] 6.SR one added await, one import; no other behavior touched; no dead branches
  - [ ] 6.IV services-layer rule files
  - _Requirements: REQ-004, REQ-005, REQ-006, REQ-007, REQ-008_

## Phase 3 — GraphQL Surface

- [ ] 7. Pothos object + query + codegen + tests
  - Create `backend/graphql/pothos/classes/student-progress.pothos.ts` (plan §4.2) and `backend/graphql/query/classes/student-progress.query.ts` (plan §4.3; `$all { authenticated, role: [Admin, Teacher, Student] }`)
  - Add `import "./student-progress.query";` to `backend/graphql/query/classes/index.ts`
  - Run `bun run generate:gqlSchema` + `bun codegen`; commit generated artifacts
  - Update `backend/graphql/test/schema-surface.test.ts` and `backend/graphql/test/sdl-static-assertions.test.ts` for the new field/type
  - New tests: `backend/graphql/test/student-progress.wire.test.ts` (payload shapes via `setupTestServerLifecycle` + `testClient`) and role tests (parent 403, foreign teacher 403, anon 401, student self OK, admin OK)
  - [ ] 7.QL sub-loop `--lifecycle duplicates` on every new/modified file → 0
  - [ ] 7.TE wire: happy path each role; denial matrix; malformed id rejected pre-service
  - [ ] 7.SEC scope-layer parent rejection verified WITHOUT service invocation (401/403 before DB)
  - [ ] 7.SR `ctx.user.id` is the only identity source; arg is a selector only; no local type defs in pothos (imports from `@/backend/types`)
  - [ ] 7.IV GraphQL-layer rule files
  - _Requirements: REQ-009, REQ-010, REQ-011, REQ-012_

## Phase 5 — Final Gates

- [ ] 8. Final quality gate & deferred enforcement
  - `grep -c "❌\|⚠️" ai/plans/milestone_2_matching_notifications_escrow/student_progress_tracking_&_increment-progress_tracking_increment/deferred-items.md` → **≤ 0 new** (D2..D7 are pre-approved ADR deferrals carried as `⚪ Deferred (accepted)` — tolerated; any ❌/⚠️ blocks completion)
  - Baseline diff: `bun tsgo`, `bun biome:check`, full `bun run lint` vs `/tmp/baseline-*` — zero NEW errors
  - Full sweep: `bun run test/scripts/run-test.ts test/workflows` green; `bun run test:db` green for touched suites
  - Write `outcome/8-final-gate-outcome.md`
  - _Requirements: REQ-001_
- [ ] 9. Knowledge propagation
  - Read ALL outcome files; write `docs/curriculum/progress-tracking.md` (Why → Pattern → Rules → Anti-patterns → Rollout → Related: pointer-row model, exactly-once anchoring, lane-vs-intent discipline, student-row-lock serialization, journey test conventions)
  - Do NOT touch AGENTS.md / `.agents/instructions/*` (hand-curated)
  - sub-loop `--lifecycle duplicates` on the doc (if lintable) → 0
  - Write `outcome/9-knowledge-propagation-outcome.md`
  - _Requirements: REQ-001_

## Dependency Graph

0 → 1 → 2 → 3 → 4 → 5 (red) → 6 (green) → 7 → 8 → 9

(1–3 are mutually independent after 0: types, repos, i18n can run in parallel; 4 needs 1–3; 5 needs 4's service surface to exist as code but must land BEFORE 6's hook; 7 needs 4 only.)
