# Tasks — Teacher Preparation View (Student Progress Before Session)

> **Plan directory (verbatim):** `ai/plans/milestone_2_matching_notifications_escrow/teacher_preparation_view_student_progress_before_session-teacher_preparation/`
> **Specs:** `specs.md` (REQ-001..REQ-011) · **Design:** `plan.md` · **Ledger:** `deferred-items.md` · **Outcomes:** `outcome/`
> **Ticket:** `docs/planning/TICKETS.md:1218-1252` — Dev 1 · M2 · 3 SP · Blocked By `Student Progress Tracking & Increment` (SHIPPED — ticket #227; plan archived at `ai/finished_plans/milestone_2_matching_notifications_escrow/student_progress_tracking_&_increment-progress_tracking_increment/`)

## Document Information

| Field | Value |
|---|---|
| Version / Date | 1.1 · 2026-09-27 (R1: substrate landed mid-authoring — gate re-based on the shipped surface; parity-belt registration + journey notification-spy fixes folded in) |
| Sequencing | Substrate gate (passes today — the progress ticket landed), then groundwork (i18n + document) → helpers (pure logic, tested) → UI cluster → verification (journey + stories) |
| Phase 2.5 mid-point gate | SKIPPED — frontend-consumption plan, < 10 implementation tasks, zero backend phase |
| Drizzle | ZERO schema delta → NO `db push`/`db migrate`; `bun codegen` only (the schema with `studentProgress` is already landed in `frontend/graphql/generated/schema.graphql:1717,1948-1960`) |

## Non-Negotiable Execution Protocol (all tasks)

1. Read ALL files in `outcome/` before starting a task.
2. After ANY file edit: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → exit 0 (sub-loop auto-prints applicable AGENTS.md + `.agents/instructions/*` — read them).
3. Complete the semantic-review checklist before `[x]` (tenancy, races, enums-as-values, no cross-layer imports, no dead code).
4. Write `outcome/<task-id>-outcome.md`; flip the checkbox.
5. Never `console.*`; client diagnostics go through the Apollo error-mapping seam — zero bespoke toast plumbing beyond `GraphQLErrorSurfaceHost`.
6. No `Translation.` enum, no two-arg `getTranslations` calls, no `useLazyQuery`, no `next-intl`; workflow tests run via `bun run test/scripts/run-test.ts`, never raw `bun test`.
7. Zero backend edits: if a task seems to need one, STOP — re-read plan.md §1 D1 and `deferred-items.md`; report to the orchestrator instead.

### Layer → rule-file map (absolute; sub-loop re-prints them)

| Layer touched here | AGENTS.md | `.agents/instructions/` |
|---|---|---|
| Teacher views `/home/ahmed/Projects/kottaby_kottaby/frontend/views/` | `…/frontend/views/AGENTS.md`, `…/frontend/AGENTS.md`, root | `frontend.instructions.md` |
| GraphQL documents `/home/ahmed/Projects/kottaby_kottaby/frontend/graphql/sharedDocuments/` | `…/frontend/graphql/sharedDocuments/AGENTS.md`, `…/frontend/graphql/AGENTS.md`, `…/frontend/AGENTS.md`, root | `frontend.instructions.md` |
| Providers `/home/ahmed/Projects/kottaby_kottaby/frontend/providers/` | `…/frontend/AGENTS.md`, root | `frontend.instructions.md` |
| Shared locale `/home/ahmed/Projects/kottaby_kottaby/shared/locale/` | `…/shared/locale/AGENTS.md`, `…/shared/AGENTS.md`, root | — |
| Stories `/home/ahmed/Projects/kottaby_kottaby/frontend/stories/` | `…/frontend/AGENTS.md`, root | `frontend.instructions.md` |
| Journeys `/home/ahmed/Projects/kottaby_kottaby/test/workflows/` | `…/test/workflows/AGENTS.md`, root | `tests.instructions.md` |

## Phase 0 — Baseline & Substrate Gate

- [ ] 0. Baseline + ledger check + **substrate pre-flight gate (BLOCKING)**
  - Record: `bun tsgo 2>&1 | grep -c "error TS" > /tmp/baseline-tsgo.txt`; `bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt`; `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json`
  - Read `deferred-items.md` (D1..D6 are accepted deferrals, not blockers)
  - **Substrate gate (REQ-003):** verify the SHIPPED progress surface is present and wired — `studentProgress(studentId: Int!): StudentProgress!` in `frontend/graphql/generated/schema.graphql:1717` + the `StudentProgress` type (`:1948-1960`), `StudentProgressService.getStudentProgress` at `backend/services/classes/student-progress.service.ts:173`, the query field at `backend/graphql/query/classes/student-progress.query.ts`. As of 2026-09-27 all three are LANDED (the blocked-by ticket shipped mid-authoring) — the gate is the standing guard against regressed checkouts. IF ANY IS ABSENT → write `outcome/0-baseline-outcome.md` with the HALT verdict and STOP — do not reimplement any part of that ticket.
  - If present: run `bun codegen`, confirm `StudentProgressQuery` / `StudentProgressQueryVariables` codegen types exist, write `outcome/0-baseline-outcome.md`
  - _Requirements: REQ-001, REQ-003_

## Phase 1 — Groundwork (i18n, document, cache policy)

- [ ] 1. SessionsLabels prep leaf set (types + en + ar + parity-belt registration)
  - `shared/locale/types/sessions/labels.ts`: add the prep leaves per plan §2/REQ-010.1 — `prepAction`, `prepDialogTitle`, `prepCurrentLessonLabel`, `prepLessonPositionLabel: (position: number, total: number) => string`, `prepCompletionLabel`, `prepPlanLabel`, `prepFirstSessionTitle`, `prepFirstSessionBody`, `prepPreviousHomeworkHeading`, `prepHomeworkEmptyTitle`, `prepHomeworkEmptyBody`, `prepMoreHomeworkLine: (count: number) => string`, `prepReadonlyHint`, `prepStudentLabel`, `prepLoadingLabel`
  - `shared/locale/en/sessions/labels.ts` + `shared/locale/ar/sessions/labels.ts`: identical key sets (AR: formal MSA, no identifiers in copy; the first-session body explains the diagnostic nature of a first session); field comments in the type interface, plain literals in the leaves
  - **Parity-belt registration (REQUIRED — the belt resolves function leaves specially):** add `prepLessonPositionLabel` and `prepMoreHomeworkLine` to `FUNCTION_LABEL_KEYS` (`shared/locale/sessions-namespace.parity.test.ts:248`) with sample args in `sampleArgsFor` (`:351`) — an unregistered function leaf makes the belt's non-empty-string check throw (`nonEmptyLabelOf` rejects non-string values). Exact-arity precedents for the two-arg leaf: `ledgerShownPage` (`shared/locale/types/wallet/labels.ts:80`) and in-namespace `reportGradeAriaLabel` (`shared/locale/types/sessions/labels.ts:365`)
  - Run `bun run test/scripts/run-test.ts shared/locale/sessions-namespace.parity.test.ts` → green
  - [ ] 1.QL sub-loop `--lifecycle duplicates` on all 4 files (3 labels + the parity test) → 0
  - [ ] 1.TE parity belt green; interpolating leaves take typed number params (position/total, count) AND are registered in the belt
  - [ ] 1.SEC no identifiers inside copy; no secrets
  - [ ] 1.SR `@/shared/locale/...` alias imports only inside `shared/locale/**`; leaf modules contain no logic
  - [ ] 1.IV shared/locale AGENTS.md rules
  - _Requirements: REQ-002, REQ-010_

- [ ] 2. `studentProgressQueryDocument` + cache policy + codegen
  - Create `frontend/graphql/sharedDocuments/scheduling/student-progress.documents.ts` exactly per plan §4.3 — imports `import { gql, type TypedDocumentNode } from "@apollo/client"` (never `@apollo/client/core`) + `import type { StudentProgressQuery, StudentProgressQueryVariables } from "@/frontend/graphql/generated/gql/graphql"`; 11-field selection (the full payload: `hasProgress, studentId, planId, planTitle, totalLessons, currentLessonId, currentLessonTitle, currentLessonPosition, lessonsCompleted, completionPercent, isOnFinalLesson`)
  - Add `export * from "./student-progress.documents";` to `frontend/graphql/sharedDocuments/scheduling/index.ts` (scheduling/ is already exported from the top-level barrel — verify, don't re-add)
  - `frontend/providers/apollo/apolloCache.ts`: add `StudentProgress: { keyFields: false }` to `apolloCacheTypePolicies` (block starts `:76`; wrapper family precedent `StudentHomeworkPage: { keyFields: false }` at `:131` — append after the last documented entry per the file's own rule) + one docblock inventory line (`:10-40`); this is the MANDATED opt-out for id-less types (`frontend/graphql/AGENTS.md:87-96`)
  - Run `bun codegen`; commit generated artifacts
  - [ ] 2.QL sub-loop `--lifecycle duplicates` on the 3 touched files → 0
  - [ ] 2.TE document compiles against codegen types (`bun tsgo`); zero `mutation` operations in the new document (REQ-007.1)
  - [ ] 2.SEC keyFields policy present (no cache-loss warnings on read — dev-server smoke in Task 6 confirms)
  - [ ] 2.SR no inline type defs, no type-mapping/`NonNullable<...>` workarounds (graphql AGENTS negative patterns); document name `studentProgressQueryDocument` per convention; codegen types never hand-edited
  - [ ] 2.IV sharedDocuments + providers + graphql AGENTS.md rules
  - _Requirements: REQ-003, REQ-004, REQ-007_

## Phase 2 — Pure Logic First (helpers + CTA matrix, tested)

- [ ] 3. `teacherPrepDialog.helpers.ts` + unit suite
  - Implement per plan §6 row 3: `resolvePrepSection` (firstSession vs positioned view model — REQ-004/005), `resolvePrepHomeworkRows` (jadid/madi span shaping, null-grade preservation, null-span rows kept with null spans — REQ-006), `resolveHiddenHomeworkCount` (REQ-006.5 "+N more" math), `shouldOfferPrep` (Record-gated intent predicate with the null-guard — plan D3)
  - Tests `teacherPrepDialog.helpers.test.ts` (bun test via run-test script): T1 100% branches on all four helpers; T2 boundaries — `hasProgress:false` with populated lesson fields (contract violation → still firstSession, the honesty rule wins), `isOnFinalLesson:true`, `totalLessons:0` + `hasProgress:false`, null grade on one track, null spans on both tracks, `totalCount` 0 / 5 / 12 (hidden 7), `intent:null` row, non-scheduled rows; T4 hostile — undefined payload fields, NaN position
  - [ ] 3.QL sub-loop → 0 on both files
  - [ ] 3.TE the suite IS the tier evidence; run via `bun run test/scripts/run-test.ts frontend/views/teacher/sessions/teacherPrepDialog.helpers.test.ts`
  - [ ] 3.SEC helpers never fabricate: a positioned section is impossible when `hasProgress` is false (assert)
  - [ ] 3.SR pure functions only (no React, no hooks, no imports beyond codegen types); no dead exports
  - [ ] 3.IV frontend rule files
  - _Requirements: REQ-004, REQ-005, REQ-006, REQ-008_

- [ ] 4. CTA matrix: `teacherSessionCacheArms.ts` + dialog-session triple
  - Add `PREP_SESSION_INTENTS` Record + Prepare descriptor per plan D3/§6: `TeacherActionsWiring` gains `onPrepare: (sessionId: string) => void`; scheduled branch pushes `{ id: "prepare", label: wiring.t.prepAction, onIntent: wiring.onPrepare }` FIRST when `shouldOfferPrep(session)`; no in-flight slot (dialog owns loading — matrix docblock `:150-156`)
  - Extend `teacherSessionCacheArms.test.ts`: scheduled+tajweed → `[prepare, start]` order; scheduled+hifz / scheduled+evaluation / intent null → no prepare; started/completed/cancelled/disputed → no prepare; existing rubric/start cases stay green (no regression)
  - `useTeacherSessionDialogSessions.ts`: add the `prepDialogSessionId` / `openPrepDialog` / `closePrepDialog` triple (own pattern, `:13-48`)
  - [ ] 4.QL sub-loop → 0 on all 3 files
  - [ ] 4.TE matrix suite covers the full status × intent affordance table; descriptor order asserted by index
  - [ ] 4.SEC descriptor carries no write semantics — intent-only callback; row identity (sessionId) is the only payload
  - [ ] 4.SR Record lookup over enum (no switch on enum values — oxlint `no-unsafe-enum-comparison`); null-guard before Record index (nullable `intent`, `graphql.ts:1631`)
  - [ ] 4.IV frontend rule files
  - _Requirements: REQ-002, REQ-008_

## Phase 3 — Dialog Cluster (hook, parts, orchestrator, mount, wiring)

- [ ] 5. `useTeacherPrepQueries.ts` + `TeacherPrepDialog.parts.tsx` + `TeacherPrepDialog.tsx`
  - Hook per plan §6 row 1 (model: `useTeacherSessionReportQueries.ts:28-46`): two stateful `useQuery`s from `@apollo/client/react`, `skip: !open || !studentId`, folded `loading`; homework variables `{ studentId, page: 1, pageSize: 5 }` (explicit, never null defaults)
  - Parts per plan §6 row 4: `PrepProgressCard` (positioned card: lesson title, `t.prepLessonPositionLabel(position, total)`, percent + LinearProgress, plan line, final-lesson chip; first-session banner: `prepFirstSessionTitle/Body`), `PrepHomeworkList` (newest-first rows: jadid/madi spans with `th.` homework-namespace labels, null-grade → not-yet-graded presentation, both-spans-null → no-assignment line, "+N more" via `t.prepMoreHomeworkLine`), loading skeleton (`prepLoadingLabel` aria), `FORBIDDEN` → `PermissionDeniedFallback`, uncoded error → generic body + retry (discipline: `frontend/views/teachers/dashboard/TeacherUpNextCard.tsx:74-88`)
  - Orchestrator per plan §6 row 5 (model: `TeacherSessionReportDialog.tsx:49-133`): TWO separate translation calls — `const t = useAppTranslation(Sessions); const th = useAppTranslation(Homework);` (the hook takes ONE namespace handle, `shared/locale/client/use-app-translation.ts:8-17`; two-call precedent `StudentSessionsContainer.tsx:116-117`); `<Dialog fullWidth maxWidth="sm" aria-labelledby="teacher-prep-dialog-title">`; sections branch independently (one section's failure never blanks the other — specs NFR Reliability.2); read-only hint footer (`prepReadonlyHint`)
  - [ ] 5.QL sub-loop → 0 on all 3 files
  - [ ] 5.TE visual branches exercised in Task 8 stories; logic fully covered by Task 3 helpers (keep the orchestrator thin — zero inline derivation)
  - [ ] 5.SEC `studentId` arrives ONLY via props from the mount; zero mutation imports (grep the diff: no `useMutation`, no `MutationDocument`); `PermissionDeniedFallback` for FORBIDDEN — never bare null
  - [ ] 5.SR MUI v9 sx discipline (no layout props on Typography/Stack/Box); theme-callback colors; icons `*Outlined`; no local type defs; each section folds its own loading/error state
  - [ ] 5.IV frontend + views rule files
  - _Requirements: REQ-002, REQ-004, REQ-005, REQ-006, REQ-007_

- [ ] 6. Mount + container wiring
  - Create `TeacherPrepDialogMount.tsx` (model: `TeacherSessionReportDialogMount.tsx:25-45`): resolves the row from cached `myTeacherSessions` page by `sessionId`, derives `studentId`, keyed conditional render `<TeacherPrepDialog key={sessionId} … />`
  - `TeacherSessionsOverlays.tsx:43-97`: mount `TeacherPrepDialogMount` beside the report mount (one prop set: `sessionId={prepDialogSessionId}` + `data` + `onClose` — plan §6 row 8)
  - `TeacherSessionsContainer.tsx`: destructure the new dialog triple; pass `onPrepare={openPrepDialog}` through the body wiring; `TeacherSessionsBody.tsx`: thread `onPrepare` into the `teacherActionsForSession` wiring (plan §6 rows 9-10)
  - Dev-server smoke (agent-browser, DOM-first per global AGENTS.md): login as teacher → `/teacher/sessions` → scheduled tajweed row shows Prepare BEFORE Start; dialog opens, both sections render, no console errors; screenshot to `scratch/screenshots/` for human review
  - [ ] 6.QL sub-loop → 0 on all 4 touched files
  - [ ] 6.TE matrix behavior proven at Task 4; smoke proves the wiring end-to-end (the deliverable form — the user's scenario must work)
  - [ ] 6.SEC row-derived identity only; keyed remount (no stale-dialog race); zero payload changes to existing queries
  - [ ] 6.SR container stays under the max-lines ceiling (mount extracted, not inlined — the folder's own split discipline); no nav/route file touched (REQ-011.1)
  - [ ] 6.IV frontend + views rule files
  - _Requirements: REQ-008, REQ-011_

## Phase 4 — Verification (journey, stories)

- [ ] 7. Journey `test/workflows/classes/teacher-preparation-read.journey.test.ts`
  - Test the service boundary the UI consumes (the dialog's two reads), encoding specs REQ-009 steps 1-7: fixtures (tajweed plan + 3 lessons, active subscriptions for student A + B, T1 + foreign T2 via `provisionCertifiedTeacherActor` — `test/workflows/helpers/actor-context.ts:88,105`); student A settles one prior session through the REAL lifecycle (`createSession` → `startSession` → `completeSession` → `confirmSessionCompletion`); student B books → T1 reads `getStudentProgress(B)` = `hasProgress:false` + `listStudentHomeworkHistory(B)` empty page; student A books → T1 reads A: `currentLessonPosition:2`, `totalLessons:3`, `completionPercent:33`, prior homework row visible WITH its grade; T2 reads A and B → `catchJourneyError` (`journey-fixtures.ts:226`) + `ForbiddenError` + code `FORBIDDEN` on both
  - **Notification boundary (test/workflows/AGENTS.md rules 5 + 12):** spy the dispatch boundary before driving the lifecycle — `spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {})` (exact precedent: `test/workflows/classes/tajweed-progress-increment.test.ts:215`) — and assert ZERO unexpected `notifications` rows at the end (fan-out check, precedent `:480`). The real lifecycle emits shipped booking/completion waves; they must be captured by the spy, never delivered
  - Conventions: committed fixtures + tracked `afterAll` cleanup (`journey-cleanup.ts:62`), NO `runInRollback`; unique `jrn_prep_<uuid8>` prefixes; run via `bun run test/scripts/run-test.ts test/workflows/classes/teacher-preparation-read.journey.test.ts` — expected GREEN immediately (the substrate landed with ticket #227; a RED leg means the substrate regressed → halt and report)
  - [ ] 7.QL sub-loop → 0 on the test file
  - [ ] 7.TE the journey IS the cross-actor evidence: 7 ordered steps incl. both denial probes (tier 3/4+workflow); zero residue after cleanup; notification spy + zero-fan-out assertions present
  - [ ] 7.SEC denial legs use honest roles (no role monkey-patching); constant-shape denial asserted (no existence oracle)
  - [ ] 7.SR no duplication of the progress ticket's journey (`tajweed-progress-increment.test.ts` owns settlement-advance assertions; here only the pre-session read contract)
  - [ ] 7.IV `test/workflows/AGENTS.md` + `tests.instructions.md`
  - _Requirements: REQ-003, REQ-005, REQ-006, REQ-009_

- [ ] 8. Stories `frontend/stories/teachers/TeacherPrepDialog.stories.tsx`
  - Harness: `StoryApolloProvider`/`MockLink` (`frontend/stories/lib/storyHarness.tsx:12-18`), precedent `frontend/stories/teachers/RubricEvaluationDialog.stories.tsx`; stories: positioned card (lesson 2/3, 33%, graded homework rows), first-session + homework-empty, first-session WITH a homework row (the divergence case — plan D4), null-grade tracks, "+N more" line, FORBIDDEN (denied fallback), loading skeleton
  - [ ] 8.QL sub-loop → 0 on the story file
  - [ ] 8.TE each branch of REQ-004/005/006 renders in at least one story (human-verified visually; logic already unit-proven)
  - [ ] 8.SEC story mocks carry no real ids/emails
  - [ ] 8.SR stories stay in `frontend/stories/teachers/`; no component logic added to make a story work
  - [ ] 8.IV frontend rule files
  - _Requirements: REQ-004, REQ-005, REQ-006, REQ-007_

## Phase 5 — Final Gates

- [ ] 9. Final quality gate & deferred enforcement
  - `grep -c "❌\|⚠️" ai/plans/milestone_2_matching_notifications_escrow/teacher_preparation_view_student_progress_before_session-teacher_preparation/deferred-items.md` → **exactly 0** (D1..D6 are accepted `⚪` deferrals; any blocker glyph blocks completion)
  - Baseline diff: `bun tsgo`, `bun biome:check`, full `bun run lint` vs `/tmp/baseline-*` — zero NEW errors
  - `bun run test/scripts/run-test.ts test/workflows` green (new journey + all pre-existing journeys unbroken); helper + parity suites green
  - REQ-011.2 audit: `git diff --name-only` vs baseline contains NO `backend/` path outside `frontend/graphql/generated/` artifacts, NO `app/` path, NO `navItems.ts`
  - Write `outcome/9-final-gate-outcome.md`
  - _Requirements: REQ-001, REQ-011_
- [ ] 10. Knowledge propagation
  - Read ALL outcome files; create `docs/teachers/preparation-view.md` (Why → Pattern → Rules → What NOT to Do → Rollout Summary → Related): the consume-don't-duplicate discipline (compose existing gated reads instead of new composites), the first-session honesty rule (`hasProgress` is the only signal), the row-keyed dialog mount pattern, the id-less read-model cache policy (`frontend/graphql/AGENTS.md:87-96`), the parity-belt function-leaf registration, and the journey-test contract-guard pattern with notification-spy discipline
  - Do NOT touch AGENTS.md / `.agents/instructions/*` (hand-curated)
  - Write `outcome/10-knowledge-propagation-outcome.md`
  - _Requirements: REQ-001_

## Dependency Graph

0 (blocking substrate gate — passes today) → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10

(1 and 2 are independent after 0 and may run in parallel; 3 needs 2's codegen types; 4 needs 3's `shouldOfferPrep`; 5 needs 1+3; 6 needs 4+5; 7 needs 0 only — may run any time after 0, listed at Phase 4 so the UI contract it guards is final; 8 needs 5.)
