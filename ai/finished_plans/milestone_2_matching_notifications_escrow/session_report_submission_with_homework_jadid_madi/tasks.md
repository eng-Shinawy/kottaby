# Tasks — Session Report Submission with Homework (Jadid & Madi)

**Plan Directory (verbatim):** `ai/plans/milestone_2_matching_notifications_escrow/session_report_submission_with_homework_jadid_madi/`
**Related:** `specs.md` · `plan.md` · `deferred-items.md` (same directory)
**Version:** 1.0 · **Date:** 2026-09-17

## Non-Negotiable Execution Protocol

1. **Pre-Execution Read:** read ALL files in `ai/plans/milestone_2_matching_notifications_escrow/session_report_submission_with_homework_jadid_madi/outcome/` before ANY task.
2. **Per-File Quality Loop:** `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` — exit 0 required after every modification (it auto-discovers and prints the applicable AGENTS.md + `.agents/instructions` files; the Fix-Or-Report rule applies — fix within the same file, report cross-file dependencies to the orchestrator).
3. **Semantic Review** checklist before every checkbox; **Instruction Verification** against the files the sub-loop printed.
4. **Outcome File** per completed task: `outcome/<task-id>-outcome.md` (research, changes, cross-file dependencies, carry-overs).
5. **Checkbox Tracking:** mark `[ ]` → `[x]` here on completion.
6. **GraphQL codegen:** after ANY schema or document change — `bun run generate:gqlSchema && bun codegen`.
7. **Drizzle:** zero schema changes in this plan — NO `db push`, NO migrations. (If an executor discovers otherwise, STOP and report to the orchestrator.)

## Layer-to-Instructions Mapping (applicable rows)

| Files touched | AGENTS.md (absolute paths) | .agents/instructions |
|---|---|---|
| `backend/types/classes/home-work.types.ts` | `/home/ahmed/Projects/kottaby_kottaby/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/types/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | `.agents/instructions/backend.instructions.md` |
| `backend/db/repo/classes/session.repository.ts` | root, `/home/ahmed/Projects/kottaby_kottaby/backend/db/repo/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | `.agents/instructions/backend.instructions.md` |
| `backend/db/test/repo/classes/session.repository.test.ts` | root, `/home/ahmed/Projects/kottaby_kottaby/backend/db/test/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | `.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md` |
| `backend/services/classes/student-homework.*.ts` | root, `/home/ahmed/Projects/kottaby_kottaby/backend/services/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | `.agents/instructions/backend.instructions.md` |
| `backend/graphql/pothos/classes/home-work.pothos.ts`, `backend/graphql/query/classes/session-report.query.ts`, `backend/graphql/test/student-homework-history.wire.test.ts` | root, `/home/ahmed/Projects/kottaby_kottaby/backend/graphql/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` | `.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md` |
| `frontend/graphql/sharedDocuments/scheduling/*` | root, `/home/ahmed/Projects/kottaby_kottaby/frontend/graphql/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/frontend/graphql/sharedDocuments/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/frontend/AGENTS.md` | `.agents/instructions/frontend.instructions.md` |
| `frontend/providers/apollo/apolloCache.ts` | root, `/home/ahmed/Projects/kottaby_kottaby/frontend/graphql/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/frontend/AGENTS.md` | `.agents/instructions/frontend.instructions.md` |
| `frontend/views/teacher/sessions/*` | root, `/home/ahmed/Projects/kottaby_kottaby/frontend/views/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/frontend/AGENTS.md` | `.agents/instructions/frontend.instructions.md` |
| `shared/locale/**` | root, `/home/ahmed/Projects/kottaby_kottaby/shared/AGENTS.md` | — |
| `test/workflows/classes/*` | root, `/home/ahmed/Projects/kottaby_kottaby/test/workflows/AGENTS.md` | `.agents/instructions/tests.instructions.md` |
| `docs/sessions/*` | root | — |

Ground truth: all M1 surfaces cited in `specs.md`/`plan.md` EXIST as verified; new code is limited to the components in plan §8. If a cited file:line has drifted, STOP and re-verify before proceeding.

### Task 0: Pre-Implementation Baseline (MANDATORY)

- [x] 0. Baseline + ledger
  - `bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/baseline-tsgo.txt`; `bun biome:check 2>&1 | grep -c warn > /tmp/baseline-biome.txt`; `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json`
  - Copy ALL three counts verbatim into `outcome/0-baseline-outcome.md` — the outcome file is the durable baseline record Task 7's regression audit compares against (`/tmp` files are scratch and may be swept)
  - Verify `deferred-items.md` exists in the plan directory (created with this plan — if missing, create from template `.agents/spec-process-guide/templates/deferred-items-template.md`)
  - Read ALL existing files in `outcome/`; write `outcome/0-baseline-outcome.md` documenting the three counts
  - _Requirements: REQ-0, REQ-0.5 (protocol head)_

### Task 1: Cross-Teacher Read Surface — journey-first (types + repo + service until the journey is green)

- [x] 1. Author the RED journey, then implement the service surface beneath it
  - **1.1 Journey FIRST:** `test/workflows/classes/session-report-cross-teacher.journey.test.ts` — write the full REQ-8 workflow (ordered steps 1-7 of specs "Ordered Steps") BEFORE any implementation code in this task: one student S + two certified teachers T1/T2 + foreign teacher Ft via `createTestUser`/`createTestStudent`/`createTestTeacherRow` (`backend/db/test/entity-setup.ts:72,102,522`) in ONE committing `beforeAll` transaction; sessions provisioned through the REAL `SessionLifecycleService.createSession/startSession/completeSession` (outerTx seam — the M1 journey recipe, `session-report-homework.journey.test.ts:361-374,497-561`); `TrackedFixtures` tracking every created row incl. service-created reports/home_work/notifications; `SpiedFanoutTransport` + suite-local `createMemoryClaimCache` wired through `NotificationEngineCallOptions`; denials via try/catch + `getServerTranslations("en").errorsTranslations` substrings; NO `runInRollback`. The file imports `listStudentHomeworkHistory` from `@/backend/services/classes/student-homework.service` — RED until 1.4 lands.
  - **1.2 Types:** `backend/types/classes/home-work.types.ts` — add `StudentHomeworkPageInput` + `StudentHomeworkPageReturnType` exactly per plan §8.A
  - **1.3 Repo:** `backend/db/repo/classes/session.repository.ts` — add `existsSessionForTeacherStudent(teacherUserId, studentId, tx?): Promise<boolean>` per plan §8.B (query-builder EXISTS-select on `session_teacher_id_student_id_idx`; no raw-SQL comments)
  - **1.4 Service:** NEW `backend/services/classes/student-homework.service.ts` + `student-homework.helpers.ts` per plan §8.C — bare exports; pre-DB id guard (`assertPositiveSafeSessionId` from `@/backend/services/classes/session-lifecycle.guards`, the exact helper `session-report.guards.ts:82` delegates to); ONE `withTransaction(outerTx, { isolationLevel: "repeatable read" })` wrapping `requireTeacherOfStudent` (constant `ForbiddenError(errorsTranslations.forbidden)` + exactly ONE bounded `logDomainError`) → `HomeWorkRepository.listForStudent` + `countForStudent`; `clampHomeworkHistoryPage` (page≥1, pageSize 25 default / 50 max) in the helpers module; read silence on success (no governance re-check — D9)
  - **1.5 Drive to green:** run `bun run test/scripts/run-test.ts test/workflows/classes/session-report-cross-teacher.journey.test.ts` until the full REQ-8 step set passes (both-teacher visibility, one-shot grade across teachers, symmetric history, constant FORBIDDEN for Ft, role denial for the student caller, notification spy deltas)
  - [ ] 1.QL: sub-loop `duplicates` on every touched file (types, repo, service, helpers, journey) — exit 0
  - [ ] 1.TE Test Engineering:
    • Repo: EXTEND `backend/db/test/repo/classes/session.repository.test.ts` — `existsSessionForTeacherStudent` truth table (linked via `scheduled`/`started`/`completed`/`cancelled`/`disputed` rows; unlinked teacher; unknown student; tx propagation), `runInRollback` + `tx`, 100% branch coverage
    • Service: NEW `backend/services/classes/student-homework.service.test.ts` — constant-FORBIDDEN byte-identity (unknown id ≡ unlinked ≡ 0/-1/junk), happy path with rows authored by TWO teachers visible newest-first, clamp boundaries (page 0→1; pageSize 0→25, 51→50, omitted→25), envelope echo `{items,totalCount,page,pageSize}`, outerTx SAVEPOINT seam, read-silence (spy `logger.logDomainError` — zero calls on success, exactly one per denial), tiers 1-4 (fuzz ids via `Promise.allSettled`; probe invalid-role shapes honestly through the role gate's seam)
  - [ ] 1.SEC: probe BOLA — caller identity ONLY from the argument threaded by the resolver contract (never client-suppliable teacherId); assert the tenancy predicate is fused in the EXISTS (no post-filter); assert no `...input` spread; assert pageSize clamp bounds abusive paging
  - [ ] 1.SR: single REPEATABLE READ transaction; no module-level mutable state; no cross-layer imports; enum/value-import discipline (`ForbiddenError` value import); no dead branches; deferred items logged
  - [ ] 1.IV: read + validate against every AGENTS.md / instructions file the sub-loop printed
  - Write `outcome/1-cross-teacher-read-surface-outcome.md`; mark `[x]`
  - _Requirements: REQ-4 (all), REQ-8 (all), REQ-1/REQ-2/REQ-3 (journey re-locks the shipped semantics across teachers), REQ-0.5_

### Task 2: GraphQL Surface + Documents + Wire Suite

- [x] 2. Expose `studentHomeworkHistory` end to end
  - **2.1 Pothos:** `backend/graphql/pothos/classes/home-work.pothos.ts` — add `StudentHomeworkPagePothosObject` exactly per plan §8.D (items → `[SessionHomeWorkPothosObject]`, totalCount/page/pageSize exposed ints; the sanctioned list-wrapper over the CANONICAL object — no duplicate homework projection)
  - **2.2 Query registration:** `backend/graphql/query/classes/session-report.query.ts` — add the `studentHomeworkHistory` field exactly per plan §8.D: `studentId: t.arg.id({ required: true })` + `page`/`pageSize` `t.arg.int()` (NO GraphQL defaults — the service clamps); `authScopes: { $all: { authenticated: true, role: [UserRole.Teacher] } }` with `UserRole` as a VALUE import; thin resolver — `requirePositiveIntId(Number(args.studentId), "studentId")` then delegate; no try/catch; no repo calls
  - **2.3 Codegen:** `bun run generate:gqlSchema && bun codegen` — schema + generated types land before any frontend consumption
  - **2.4 Documents:** `frontend/graphql/sharedDocuments/scheduling/session-report.documents.ts` — add `studentHomeworkHistoryQueryDocument` exactly per plan §8.E (`id` FIRST on the item selection, exact 12 `SessionHomeWork` fields + envelope, nothing extra); EXTEND `session-report.documents.test.ts` with a contract block pinning the selection
  - **2.5 Wire suite:** NEW `backend/graphql/test/student-homework-history.wire.test.ts` — the `session-report.wire.test.ts` recipe (`setupTestServerLifecycle()`, `buildSessionJourneyCast`, per-actor `signAccessToken` clients, `expectDenialCode`): anonymous → `UNAUTHORIZED`; student/parent/admin → `FORBIDDEN` (role scope); linked teacher → envelope happy path incl. rows authored by a second teacher; unlinked teacher vs unknown student → byte-identical `FORBIDDEN`; id-shape junk (`"abc"`, `"0"`, `"-1"`) → `VALIDATION`; paging args echoed
  - **2.6 Cache policy:** `frontend/providers/apollo/apolloCache.ts` — register the id-less envelope `StudentHomeworkPage: { keyFields: false }` beside the `ParentHomeworkPage` precedent (`apolloCache.ts:114-115`); without it every history read trips "Cache data may be lost" normalization warnings
  - [ ] 2.QL: sub-loop `duplicates` per touched file (pothos, query registration, documents, documents test, wire suite, apolloCache.ts) + codegen committed cleanly
  - [ ] 2.TE: wire tiers — happy path, all denial rows of plan §10's permission matrix, envelope shape, replay; documents contract assertions (id-first, exact fields)
  - [ ] 2.SEC: verify field-level role scope fires BEFORE the resolver (low-privilege tokens cannot reach the service); verify constant-oracle byte-identity on the wire; no BOPLA surface (read-only)
  - [ ] 2.SR: thin-delegation discipline (zero repo imports in the resolver); value imports (`UserRole`, `StudentHomeworkPagePothosObject`); no schema-echo drift between SDL and documents
  - [ ] 2.IV: read + validate against the printed rule files (backend/graphql + frontend/graphql AGENTS.md rows)
  - Write `outcome/2-graphql-surface-outcome.md`; mark `[x]`
  - _Requirements: REQ-4 (AC 2, 4, 5, 6 wire-locked), REQ-0.5 (enum value-import discipline)_

### Task 3: i18n — Sessions Copy + Localized SurahJuzRef Labels (en + ar)

- [x] 3. Extend the sessions namespace trio + parity registry
  - **3.1 Type:** `shared/locale/types/sessions/labels.ts` — add the new `readonly` keys per plan §5's inventory (dialog titles, section titles, field labels, validation messages, notices, CTA labels) + the function-valued `surahJuzLabel: (ref: string) => string`
  - **3.2 en leaf:** `shared/locale/en/sessions/labels.ts` — implement all additions; `surahJuzLabel` resolves the FULL 35-value vocabulary (`surah_al_fatihah`, `surah_al_baqarah`, `surah_aal_imran`, `surah_an_nisa`, `surah_al_maidah`, `juz_1`…`juz_30`) to display names ("Surah Al-Fātihah"…"Juz 30"), fail-closed to the raw ref on an unknown key
  - **3.3 ar leaf:** `shared/locale/ar/sessions/labels.ts` — Arabic twins for every key incl. the label map (سورة الفاتحة، سورة البقرة، سورة آل عمران، سورة النساء، سورة المائدة، الجزء 1…الجزء 30), same fail-closed fallback
  - **3.4 Parity registry:** `shared/locale/sessions-namespace.parity.test.ts` — register every new key in the mandated registry; list `surahJuzLabel` in the function-keys registry and assert non-empty outputs across the full 35-value vocabulary in BOTH locales; keep the existing assertions untouched
  - **3.5 Run:** `bun run test/scripts/run-test.ts shared/locale/sessions-namespace.parity.test.ts` + `bun tsgo` (the typed leaves are the compile-time parity gate)
  - [ ] 3.QL: sub-loop `duplicates` on all four files — exit 0
  - [ ] 3.TE: parity suite green; ar values sampled for Arabic script (the suite's existing check); function-key fallback behavior asserted (unknown ref → raw ref, both locales)
  - [ ] 3.SEC: no user-content interpolation in these keys (all static) — no bidi injection surface; `iso(...)` wrappers only if interpolated names ever enter (none here)
  - [ ] 3.SR: no hardcoded UI strings shipped in Task 4/5 outside these keys; keys named consistently with the existing `caseReview*`/`teacher*` vocabulary
  - [ ] 3.IV: read + validate against `shared/AGENTS.md` (the sub-loop printed row)
  - Write `outcome/3-i18n-sessions-copy-outcome.md`; mark `[x]`
  - _Requirements: REQ-7 (all), REQ-0.5 (AC 1, 2, 4)_

### Task 4: Teacher Sessions CTA — Row Actions + Container Wiring

- [x] 4. Completed-row "Session report" + started-row "Homework" affordances
  - **4.1 Action union:** `frontend/views/student/sessions/sessionRowAction.ts:15` — extend the id union with `"homework" | "report"`
  - **4.2 Arms:** `frontend/views/teacher/sessions/teacherSessionCacheArms.ts` — extend `TeacherActionsWiring` with `onHomework`/`onReport` (`(sessionId: string) => void`); add the two branches to `teacherActionsForSession`: Started → `{ id: "homework", label: t.viewHomeworkAction, onIntent: onHomework }`; Completed → `{ id: "report", label: t.sessionReportAction, onIntent: onReport }` (labels from Task 3 keys; terminal Cancelled/Disputed still fall through to `[]`)
  - **4.3 Container:** `frontend/views/teacher/sessions/TeacherSessionsContainer.tsx` — add the `reportDialogSessionId` state slot (the `caseDialogSessionId` pattern, `:140-148`); wire `onHomework`/`onReport` through the body → `actionsFor` path (the existing `onStart`/`onComplete` wiring); add the conditional dialog mount resolved from the cached `myTeacherSessions` data by id. Sequencing rule: land Task 4 and Task 5 in order — Task 4 ships the union, arms, state slot, and handlers; Task 5 ships `TeacherSessionReportDialog` and the single mount line that consumes the slot. Until Task 5 lands, nothing references the slot (an unused state field + handlers wired into `actionsFor` is dead-code-free: the handlers ARE consumed by the arms matrix, and the mount line belongs to Task 5 — do NOT ship commented-out stubs or placeholder components).
  - **4.4 Unit test:** NEW `frontend/views/teacher/sessions/teacherSessionCacheArms.test.ts` — pure matrix: scheduled → `["start"]`; started → `["complete","homework"]` (order stable); completed → `["report"]`; cancelled → `[]`; disputed → `[]`; labels come from the `Sessions` labels type
  - [ ] 4.QL: sub-loop `duplicates` on the three touched files + the new test — exit 0
  - [ ] 4.TE: matrix test green (tier 1/2: every status branch + label identity); RTL label assertion via the `sessionsEn` leaf
  - [ ] 4.SEC: no new data fetched per row (the CTA is status-pure — no N+1); the action id union stays closed (no string widening)
  - [ ] 4.SR: `SessionStatus` VALUE import from codegen (existing idiom `teacherSessionCacheArms.ts:15-17`); no `bottom-nav`, no nav edits (grep `navItems.ts` unchanged)
  - [ ] 4.IV: read + validate against `frontend/AGENTS.md` + `frontend/views/AGENTS.md`
  - Write `outcome/4-teacher-cta-outcome.md`; mark `[x]`
  - _Requirements: REQ-5 (AC 1-5), REQ-0.5 (AC 3)_

### Task 5: Session Report Submission Dialog — prepare / submit / review

- [x] 5. The dialog (largest task — full pipeline)
  - **5.1 Helpers first:** NEW `frontend/views/teacher/sessions/teacherSessionReportDialog.helpers.ts` — pure: `buildSubmitPayload(form)` → `SubmitSessionReportInput` (field-by-field BOPLA: notes, rating, jadid?/madi? blocks, previousGrades — never a spread); `validateReportForm(form, t)` mirroring the server vocabulary (`session-report.guards.ts:51-60,95-160`: trim/required/2000, 0-5, positive safe ayahs from≤to, ≥1 block, 0-100); `resolveNewestRow(page)`; `isNewestRowUngraded(row)` (both grade columns null — the same predicate `gradeHomeWorkOnce` guards, `home-work.repository.ts:185`)
  - **5.2 Hook:** NEW `frontend/views/teacher/sessions/useTeacherSessionReportSubmit.ts` — `useMutation(submitSessionReportMutationDocument)` from `@apollo/client/react`; `onCompleted` → success notice + refetch `myTeacherSessionsQueryDocument` + flip to review; `onError` → the code→behavior arm of plan §8.H (`SESSION_REPORT_ALREADY_EXISTS` → info + close + refetch; `SESSION_INVALID_TRANSITION` → inline; `FORBIDDEN` → `te.forbidden`; `VALIDATION` → `mutationFieldErrors` projection; default → generic)
  - **5.3 Parts:** NEW `TeacherSessionReportDialog.parts.tsx` — assignment block (Jadid/Madi sub-forms: from/to ayah number fields + SurahJuz `Select` over `Object.values(SurahJuzRef)` labeled via `t.surahJuzLabel(ref)`), grade-previous block (pre-filled from `history.items[0]`; per-track spans rendered from the row's actual tracks; grade inputs 0-100; read-only + `reportAlreadyGradedLabel` when graded), first-session hint, history list (compact read-only rows), review state (reuses the `caseReview*` vocabulary — `shared/locale/en/sessions/labels.ts:108-128`)
  - **5.4 Dialog:** NEW `TeacherSessionReportDialog.tsx` — mode resolution (`prepare` when session `started`; `review` when `sessionReport` non-null; else `submit`); THREE parallel stateful `useQuery`s (sessionReport, sessionHomework, studentHomeworkHistory keyed by the row's `studentId`) — NO `useLazyQuery`; `Dialog` with `slotProps={{ paper: { component: "form", onSubmit } }}` (`SessionConfirmDialogLayout.tsx:94-99`), `React.SubmitEvent` (never `FormEvent`), submit disabled + backdrop/Escape gated while loading, `fullScreen` on `xs`, aria-invalid on failed fields, live notes counter; mount it in `TeacherSessionsContainer` (Task 4.3's slot)
  - **5.5 Unit tests:** NEW `frontend/views/teacher/sessions/teacherSessionReportDialog.helpers.test.ts` — payload building (BOPLA field assertions, grades structurally absent on the assignment block, both-grade pair always present in previousGrades when grading), validation mirror (every guard bound incl. unicode/RTL strings and 2001-char notes), newest-row/ungraded derivation table
  - [ ] 5.QL: sub-loop `duplicates` on every file in 5.1-5.5 — exit 0
  - [ ] 5.TE: helpers test green (tiers 1-2); mutation-arm behavior asserted through the hook via the consumer-component pattern (bun:test has no `renderHook` — `frontend/AGENTS.md:50`); boundaries: empty history ⇒ prepare/submit hides grade section + shows hint (REQ-2); graded newest row ⇒ read-only grade display (REQ-3 AC 2 posture); already-submitted session ⇒ review state (REQ-6 AC 2)
  - [ ] 5.SEC: no client-side trust — the server re-validates everything (client mirror is UX only); no echoed server strings; `studentHomeworkHistory` args derive `studentId` from the session row in cache, never from user input
  - [ ] 5.SR: MUI v9 sx-only (no style props on Typography/Stack/Box — `frontend/AGENTS.md:30-33`); theme-palette colors only; `useQuery` from `@apollo/client/react`; typed codegen documents consumed with NO mapping layers; zero hardcoded strings (every label from Task 3 keys)
  - [ ] 5.IV: read + validate against `frontend/AGENTS.md`, `frontend/views/AGENTS.md`, `frontend/graphql/sharedDocuments/AGENTS.md`
  - Write `outcome/5-session-report-dialog-outcome.md`; mark `[x]`
  - _Requirements: REQ-6 (all), REQ-2 (AC 2), REQ-3 (AC 4), REQ-5 (AC 3-4 mount)_

### Task 6: Canonical Doc Update + Browser Verification

- [x] 6. Docs + live-flow verification
  - **6.1 Docs:** update `docs/sessions/session-report-homework.md` — §5 Consumer Guidance: Submit UX section flips from forward-note to shipped (cite `frontend/views/teacher/sessions/TeacherSessionReportDialog.tsx` + the CTA arms); document the teacher homework-history query (`studentHomeworkHistory`, gate, envelope) beside the existing participant reads; §6 Rollout gains the new files + the cross-teacher journey row. Verify the root `AGENTS.md` Important References line for this doc stays accurate (description check only — do NOT edit AGENTS.md)
  - **6.2 Browser verification (DOM & accessibility first):** with the dev server up, `bun run scripts/browser-login.ts --inject` for the teacher identity; verify `/teacher/sessions` via `agent-browser snapshot -i -c` (accessible DOM): completed rows expose the "Session report" action; open the dialog — assert form fields (notes, rating, Jadid/Madi blocks with the 35-option Surah/Juz picker showing localized labels), the grade-previous state on a student WITH prior homework, and the first-session hint on a fresh student; submit one real report; assert the review state + the success notice; `agent-browser console --level error` = zero errors. Screenshots to `scratch/screenshots/` — inspected by an ISOLATED visual subagent returning a text summary ONLY (never `ReadMediaFile` in the main loop)
  - **6.3 RTL spot-check:** switch locale to `ar` (the `NEXT_LOCALE` cookie via `app/api/set-locale/`), reopen the dialog, assert RTL mirroring + Arabic Surah labels via the accessible snapshot (no `ReadMediaFile` in main context)
  - [ ] 6.QL: sub-loop `duplicates` on the doc file — exit 0
  - [ ] 6.TE: the browser verification IS the live test (session-report service suite + journey already lock the data path); record console/network evidence in the outcome file
  - [ ] 6.SEC: verification uses the dedicated test identity; no production data touched; screenshots land under `scratch/` only
  - [ ] 6.SR: docs state the SHIPPED behavior (no plan-artifact references in doc prose — no REQ-/Task- citations inside `docs/`)
  - [ ] 6.IV: docs follow the domain-doc structure of the existing file
  - Write `outcome/6-docs-browser-verification-outcome.md`; mark `[x]`
  - _Requirements: REQ-9, REQ-6 (AC 9 live-verified), REQ-5 (AC 1-4 live-verified)_

### Task 7: Final Quality Gate + Knowledge Propagation

- [x] 7. Full verification + propagation
  - `bun quality-gate` green end-to-end (tsgo → oxlint → biome → lint → duplicates); any pre-existing failures must match the Task-0 baseline (baseline-diff discipline — new failures are this plan's to fix)
  - Journey + wire + service + repo + parity + frontend unit suites re-run green via their run-test wrappers; M1 regression suites green (session-report service/guards/repo/wire/journey UNTOUCHED files — any red there = plan regression)
  - `deferred-items.md` audited: every row resolved or explicitly parked with an owning follow-up; zero ❌
  - Knowledge propagation: `docs/sessions/session-report-homework.md` update landed in Task 6 is the canonical doc — NO new docs file, NO AGENTS.md / `.agents/instructions` edits (hand-curated only)
  - Post-implementation review wave (per the SDD skill): dispatch `review-types` + `review-backend` + `review-frontend` + `security-probing` scoped to `git diff --name-only` vs the Task-0 baseline; dedupe, filter pre-existing, fix feature-specific findings; re-run until zero; write `outcome/post-implementation-review.md`
  - Write `outcome/7-final-gate-outcome.md`; mark `[x]`
  - _Requirements: REQ-0 (AC 4-5), REQ-9 (AC 2)_

## Traceability Matrix

| REQ | Tasks |
|---|---|
| REQ-0 (baseline & protocol) | Task 0, Task 7 |
| REQ-0.5 (translation & enum compliance) | Task 0, Task 1, Task 2, Task 3, Task 4, Task 5 |
| REQ-1 (submission semantics — regression lock) | Task 1 (journey re-locks), Task 5 (consumes) |
| REQ-2 (first session diagnostic) | Task 1 (journey), Task 5 (hint UI) |
| REQ-3 (grade previous + assign new) | Task 1 (journey), Task 5 (pre-fill UI) |
| REQ-4 (teacher homework history — NEW) | Task 1, Task 2 |
| REQ-5 (teacher sessions CTA) | Task 4, Task 6 (live) |
| REQ-6 (submission dialog) | Task 5, Task 6 (live) |
| REQ-7 (localized labels + copy) | Task 3 |
| REQ-8 (cross-teacher journey) | Task 1 |
| REQ-9 (canonical docs) | Task 6, Task 7 |
