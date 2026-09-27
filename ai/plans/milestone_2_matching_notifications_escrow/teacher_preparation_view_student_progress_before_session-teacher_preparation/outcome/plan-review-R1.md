# Plan Review Gate — Round 1 (Phase 1.5)

**Plan:** `ai/plans/milestone_2_matching_notifications_escrow/teacher_preparation_view_student_progress_before_session-teacher_preparation/`
**Date:** 2026-09-27 · **Reviewers:** 3 parallel layer-scoped auditors (frontend views/documents/providers · shared/locale + journey/test conventions · full citation audit) + orchestrator self-checks
**Plan reviewed:** `specs.md` (271 ln) · `plan.md` (312 ln) · `tasks.md` · `deferred-items.md`

## R1 Findings (all resolved before gate exit)

| # | Layer | Finding | Fix applied |
|---|---|---|---|
| F1 | HIGH · i18n/API | `useAppTranslation(Sessions | Homework)` union does not compile — the hook takes exactly ONE namespace handle (`shared/locale/client/use-app-translation.ts:8-17`); the "union precedent" was a docblock phrase, not code | Plan D6/§6 row 5 + specs REQ-002.2 now prescribe TWO separate calls, precedent `StudentSessionsContainer.tsx:116-117` (`useAppTranslation(Sessions)` + `useAppTranslation(Errors)`) — verified |
| F2 | CRITICAL · tasks.md | `tasks.md` lost its first half (Tasks 0-5 gone; 54-line remnant started at Task 6) while the append-chunked writes ran | Full re-author of `tasks.md` (Tasks 0-10 + protocol + layer map + dependency graph); truncation + REQ traceability audits re-run clean |
| F3 | HIGH · dependency freshness | The blocked-by substrate LANDED CONCURRENTLY with plan authoring (ticket #227): `studentProgress` is live (`schema.graphql:1717,1948-1960`, `student-progress.service.ts:173`) and the progress plan moved to `ai/finished_plans/…` — the plan's "NOT yet implemented" framing and `ai/plans/…student_progress…` paths were stale | All headers/doc-info/REQ-003/constraints updated: shipped status, `ai/finished_plans/` path, live file:line evidence; the Task 0 gate is reframed as a regression guard that passes today |
| F4 | MED · parity belt | New function leaves would turn `shared/locale/sessions-namespace.parity.test.ts` red: function leaves must be registered in `FUNCTION_LABEL_KEYS` (`:248`) + `sampleArgsFor` (`:351`) or `nonEmptyLabelOf` throws on the non-string value | Task 1 + specs REQ-010.4 + plan D6 now mandate the registration; exact-arity precedents cited (`wallet/labels.ts:80`, `sessions/labels.ts:365`) — verified |
| F5 | MED · journey conventions | Journey drives the real lifecycle → emits shipped notification waves; `test/workflows/AGENTS.md` rules 5+12 require the dispatch boundary SPIED and a zero-fan-out assertion — the plan omitted both | Task 7 + plan §8 journey row + specs REQ-009 step 2 now mandate `spyOn(NotificationEngine, "publishReceipts")` + zero-unexpected-waves assertion, precedent `tajweed-progress-increment.test.ts:215` — verified |
| F6 | LOW · citation hygiene | Five line-range misses + two signature inaccuracies: page guard `:26-31`→`:32-34`; `SessionStatus` enum `:413`; `apolloCache.ts` wrapper family `:76-116`→`StudentHomeworkPage` at `:131`; `TeacherSessionReportDialog.tsx:49-104`→`:49-133`; `TeacherUpNextCard.tsx:86-94`→`:74-88` (+ full path); `requireTeacherOfStudent` is `(teacherUserId, studentId, locale, t, tx)`; `teacherActionsForSession` is `(session, wiring)`; matching-ticket range `:1457-1513`→`:1457-1508` with accept/decline language at `:1611-1624`; document spans `:129-160`→`:129-154`; `home-work.pothos.ts:190-208`→`:190-202`; "12 fields"→11 | All corrected in specs.md/plan.md/deferred-items.md; every patched citation re-verified against the repo (see R2) |

## Clean dimensions (R1)

- Dialog cluster design vs `frontend/AGENTS.md` (MUI v9 sx, `PermissionDeniedFallback`, no `useLazyQuery`, no `console.*`) — clean
- New document naming/typing vs `frontend/graphql/sharedDocuments/AGENTS.md` (`studentProgressQueryDocument`, `TypedDocumentNode<StudentProgressQuery, StudentProgressQueryVariables>`) — clean
- Id-less `StudentProgress` handling vs `frontend/graphql/AGENTS.md:87-96` (mandated `keyFields: false` opt-out) — clean and rule-compliant
- CTA matrix facts (`RUBRIC_SESSION_TYPES :134-138`, `teacherActionsForSession :157-198`, no-in-flight-slot docblock) — verified exact
- Journey helper signatures (`actor-context.ts:88/:105`, `journey-fixtures.ts:226`, `journey-cleanup.ts:62`), no raw `bun test`, no `expect().rejects` in rollback layers — clean
- Citation audit: 43 of ~48 citations verified exact at first pass, zero invented paths/symbols; all misses listed above and fixed

## R2 Verification (post-fix)

Every patched item was re-checked against the live repo by the orchestrator:

| Check | Evidence |
|---|---|
| Page guard at `app/(dashboard)/teacher/sessions/page.tsx:32-34` | `withPageAuth({ roles: [UserRole.Teacher] })` — exact |
| `SessionIntent` enum `graphql.ts:398`, `SessionStatus` `:413` | exact |
| `apolloCache.ts:131` = `StudentHomeworkPage: { keyFields: false }` | exact |
| Parity belt `FUNCTION_LABEL_KEYS` `:248` / `sampleArgsFor` `:351` | exact |
| Two-call translation precedent `StudentSessionsContainer.tsx:116-117` | exact |
| Notification-spy precedent `tajweed-progress-increment.test.ts:215` | exact |
| `getStudentProgress` at `student-progress.service.ts:173`; SDL at `schema.graphql:1717` | exact |
| Function-leaf arity precedents `wallet/labels.ts:80`, `sessions/labels.ts:365` | exact |
| Accept/decline ticket text `TICKETS.md:1611-1612`; matching ticket end `:1508` | exact |
| `TeacherSessionReportDialog.tsx:49-133` | exact |

Post-generation audit: truncation check (all four artifacts end on complete sections) · REQ traceability (REQ-001..REQ-011 all present in `tasks.md`, zero misses) · anti-pattern sweep (no `Translation.` enum, no two-arg `getTranslations`, no frontend-logger imports, no raw `bun test` on workflows, no bottom-nav invention) — **all clean**.

## R2 Verdict

**Plan passes all AGENTS.md rules for affected layers.** Engineering substance was confirmed by all three R1 auditors ("unusually well-evidenced" — 43/48 citations exact at first pass); every finding was mechanical (a stale dependency frame, a lost file head, a non-compiling i18n pattern, belt/spy registration, citation hygiene) and is now fixed and re-verified.

## Carry-overs for implementers

- The substrate is SHIPPED — do not reimplement any part of the progress ticket; Task 0's gate is a regression guard that passes today.
- The parity belt rejects unregistered function leaves — Task 1's registration step is mandatory, not optional polish.
- The journey MUST spy `NotificationEngine.publishReceipts` before driving the real lifecycle (AGENTS rules 5+12).
- Keep the orchestrator dialog thin: all derivation lives in the bun-tested helpers.
- `ai/plans/` is untracked in git — the plan directory is the record of truth; do not expect it in history.
