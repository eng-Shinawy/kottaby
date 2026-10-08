# Session Report & Homework — Canonical Reference

**Domain:** Sessions (P2P `session` → the post-completion academic record: `reports` + `home_work`)
**Status:** Implemented and verified
**Source of truth for:** the report write gate and its governance re-check, the atomic report+homework co-creation contract, the one-report-per-session unique arbiter, the first-vs-subsequent grading ruling and its one-shot grade guard, the oracle-collapse read posture, the report-ready notification choreography, and the consumer guidance for every downstream ticket that touches `reports` or `home_work`.

This document is the single canonical reference for the session report and homework surface. Downstream consumers (submit UX, Surah/Juz UI, rating aggregation, admin tracking, parent portal, dual confirmation/escrow) MUST read it before touching `reports`, `home_work`, or the report mutation. The record is written **exactly once per session** — the guarded primitives live in `ReportRepository`/`HomeWorkRepository` and are composed by `SessionReportService`; consumers extend them, never re-implement them.

---

## 1. Why

A completed session is an academic event, and the report is its permanent record: the teacher's notes, the student rating, and the optional homework composite (the previous assignment's grades + the new assignment). When homework is assigned, it is **co-created atomically** with the report — a homework assignment can never exist without the report that carries it — and the composite must land or not land as one unit (a report can exist without homework, but homework without a report or a split commit is a corrupted transcript). Three failure modes drove every ruling here: a double submit producing two records, a grade racing itself (two teachers grading the same prior homework), and a ghost notification pushed for a submission that rolled back. Each was either proven or ruled out during the surface's review waves; nothing in this document is aspirational.

## 2. Pattern

### 2.1 The write gate (INV-S7)

`submitSessionReport` is teacher-only end to end. The mutation carries the explicit `$all { authenticated: true, role: [Teacher] }` conjunction (anonymous → `UNAUTHORIZED`/401; authenticated non-teacher → `FORBIDDEN`/403), and the service re-asserts **governance** on the acting teacher pre-DB (deleted/blocked/suspended → `FORBIDDEN`) because the GraphQL context applies no governance filter. Then, inside the transaction, the session row is classified under a `FOR UPDATE` lock (`SessionRepository.lockForReportGate` — tx REQUIRED, the one locking exception among SessionRepository's reads):

- probe `null` (nonexistent id or non-owner teacher — byte-identical) → `SESSION_NOT_FOUND`;
- probe `status ≠ completed` → `SESSION_INVALID_TRANSITION` (the same reused code denies `cancelled` and `disputed` sessions — a report on a dead session is unreachable);
- probe owner + `completed` → the gate opens and the write proceeds.

The row lock serializes against any concurrent writer of that session row (e.g. an arbitration flipping status mid-gate): whoever holds the lock first decides, and the loser sees the flipped state. There is no read-then-write window.

### 2.2 Atomic co-creation (INV-S8)

Everything settles in **one** `withTransaction(outerTx)`: report insert → optional previous-grade write → optional homework insert → notification emissions. The homework composite is optional; the report is not. Because both inserts share the transaction, a homework row without its report is **structurally unreachable** — the unique arbiter plus the shared tx mean any failure after the report insert rolls the report back with it. Rollback is total: in-tx notification rows die with the transaction, and no push has happened yet (see §2.6), so a failed submission leaves zero rows everywhere.

### 2.3 One report per session

`reports.session_id` carries the `reports_session_id_unique` constraint; `home_work.session_id` carries `home_work_session_id_unique`. The constraints are the **arbiter**, not any pre-read: a duplicate submission (double click, retry storm, parallel connections) loses the insert race and its whole transaction dies with the 23505. The service translates a 23505 whose constraint name matches `reports_session_id_unique` into the typed `ConflictError("SESSION_REPORT_ALREADY_EXISTS", …)` — cause-chain walked by constraint name, never by message text. The paired `home_work_session_id_unique` violation maps to the same conflict (it can only fire if a homework row outlived a report, which §2.2 makes unreachable — the mapping is defense in depth, not a second path). Callers may rely on the 23505 → `SESSION_REPORT_ALREADY_EXISTS` mapping staying keyed to these two constraint names.

### 2.4 First-vs-subsequent grading (INV-HW3/HW4)

A homework **assignment** row is always born ungraded — all grade columns NULL (INV-HW3: the first session has no prior homework to evaluate; homework is assigned, not graded). Grades enter the system only through `previousGrades` on a **later** session's submission (INV-HW4), and they route to the **newest prior row** for that student via two composed primitives:

1. `HomeWorkRepository.findLatestByStudentId` — newest-first read over the student's homework rows (any grade state).
2. `HomeWorkRepository.gradeHomeWorkOnce` — **one** guarded UPDATE: `SET grades … WHERE id = $1 AND current_grade IS NULL AND revision_grade IS NULL RETURNING *`. Predicate and mutation are one statement under the row lock — the TOCTOU window is zero by construction, and a concurrent grading of the same row serializes into a zero-row miss.

The zero-row miss is classified honestly: a genuinely-first session (no prior row exists at all) absorbs `previousGrades` as a **valid no-op** (INV-HW3 — there is nothing to grade, and that is not an error); a prior row that is already graded surfaces as the typed `ConflictError` (`homeworkAlreadyGraded`). "No prior row" and "already graded" are deliberately different outcomes — conflating them silently discards a teacher's grade.

### 2.5 Oracle-collapse reads

`sessionReport` and `sessionHomework` carry `{ authenticated: true }` only; the participant predicate (session teacher or session student) lives service-side. A foreign id, a nonexistent id, and a participant reading a session with no report yet all resolve to the **same indistinguishable `null`** — parents, admins, and foreign teachers get exactly what a hostile prober gets: nothing. Reads are **silent** — no domain-error log fires on a read denial (logging a read denial is itself a disclosure channel). Sessions are disclosure-sensitive; the collapse ruling follows the lifecycle's precedent without exception.

### 2.6 Notification choreography

One report-ready wave per submission, emitted through `SessionReportNotificationService.notifySessionReportReady` inside the caller's transaction:

1. **One** wave-context read (`SessionRepository.findReportWaveContextById`): student, teacher, and linked parent (id + full name + persisted locale) in a single joined query.
2. Copy composed per **recipient's** persisted locale — never the caller's locale.
3. Recipients: the student always; the linked parent only when the parent link exists (INV-P1 — no notification without a confirmed link).
4. Bodies interpolate **names only** (bidi-isolated) — never grades, never note content, never identifiers.
5. Emissions carry `type = SessionCompletion`, `relatedEntityType = "session"`, and the idempotency key `` `session:{id}:report` `` — the engine's per-recipient claim digest differentiates recipients, so a replay returns the stored receipt with zero new rows and zero new pushes.
6. The engine persists in-tx and returns receipts; **publishing is strictly post-commit** (`NotificationEngine.publishReceipts`). A rolled-back submission can never ghost-push — publish is structurally unreachable for it.

### 2.7 Posture of the record

- **Append-only.** No edit, delete, or re-grade surface exists for `reports` or for homework grades. A wrong report is corrected by process, not by mutation — do not add an amendment path without re-opening this document.
- **Pure-wallet.** ZERO wallet/fee/transaction writes exist on this surface. `status = completed` is only a gate predicate; the earning side belongs to the dual-confirmation/escrow flow. This mirrors the lifecycle's earning-only-on-confirmation ruling (INV-S3) — grep-gated so the absence stays a decision, not a gap.
- **Bounded logging.** Every write denial logs exactly ONE domain error with `{ code, entity, entityId, locale }` — never note content, never grades, never recipient PII. Happy paths log nothing.

## 3. Rules

- **The unique constraints are the arbiters.** Never "check-then-insert" for report existence; the 23505 translation is the duplicate path.
- **Field-by-field inserts.** Every insert maps validated service state member by member (BOPLA) — `sessionId`, `studentId`, `teacherId`, grades at assignment time, and timestamps are server-controlled and structurally unreachable from client input. Smuggled fields die pre-resolver as `GRAPHQL_VALIDATION_FAILED`.
- **Pre-DB id guards.** The GraphQL boundary parses `ID` shape-only; every service entry point re-asserts the positive-safe-integer shape before any database work — a garbage id never spends a read.
- **Grades route through the guarded primitive.** Any new grading path must go through `gradeHomeWorkOnce` (or a composition of it) — never a bare UPDATE on grade columns.
- **Notification rows through the engine only.** `notifySessionReportReady` is the sole emitter of this wave; the engine remains the single writer of `notifications` rows, and publishing stays caller-side post-commit.
- **One wave-context read.** Recipient identity derives exclusively from `findReportWaveContextById` — never from caller-supplied participant snapshots.

## 4. What NOT to Do

- **Never submit a report for a session you don't own or that isn't `completed`.** The gate denies both; do not widen the probe classification for "helpful" error messages (foreign ≡ nonexistent is the oracle ruling).
- **Never create a homework row outside a report submission.** INV-S8 is structural; a standalone homework insert path re-opens the corruption the shared transaction prevents.
- **Never grade an assignment row at insert time.** Assignment rows are born ungraded; grading happens exclusively via `previousGrades` on a later submission.
- **Never treat "no prior homework" as an error** — it is the INV-HW3 no-op. Only "prior row exists but already graded" is the conflict.
- **Never widen the read authScope for parents or admins.** Participant-only is the contract; a parent/admin read surface is a NEW ruling with its own oracle posture, not a scope tweak.
- **Never put grades or note content in notification copy.** Names only. The body is a link invite, not a content mirror.
- **Never publish notifications before the caller's commit** — the post-commit publish is what makes rollback mean zero pushes.

## 5. Consumer Guidance

| Ticket | What each may rely on (and must not do) |
|---|---|
| **Submit UX** | The typed documents at `frontend/graphql/sharedDocuments/scheduling/session-report.documents.ts` (`submitSessionReportMutationDocument`, `sessionReportQueryDocument`, `sessionHomeworkQueryDocument`, `studentHomeworkHistoryQueryDocument`) are the wire contract. The teacher submit UX ships in `frontend/views/teacher/sessions/TeacherSessionReportDialog.tsx` — a mode-resolved dialog (`prepare` / `submit` / `review`) that consumes the three query documents in parallel (stateful `useQuery` re-keyed by session id; NO `useLazyQuery`) + the submit mutation with the `extensions.code` arm mapping (`SESSION_REPORT_ALREADY_EXISTS` → info notice + close + refetch; `SESSION_INVALID_TRANSITION` → row alert; `FORBIDDEN` / `VALIDATION` / default → generic notice). May rely on: pre-DB typed `VALIDATION` denials, the 401/403 scope split, `SESSION_REPORT_ALREADY_EXISTS` as the duplicate signal (safe to present as "already submitted"), oracle-identical denials, the cross-teacher history read (`studentHomeworkHistory`, role-scoped to `Teacher`, constant FORBIDDEN for unlinked teachers, hostile id shapes hit the pre-DB `VALIDATION` guard before the relationship gate). Must not re-implement validation client-side as the authority or add client-side fields beyond the object contract. |
| **Surah/Juz UI** | The `SurahJuzRef` enum (114 surahs + 30 juz — the full mushaf canon, `backend/enum/shared/surah-juz-ref.enum.ts`) is the assignment-block vocabulary. Form state carries the backend enum (`block.surahJuz` is a `SurahJuzRef` member, guarded by value-based `isSurahJuzRef`); wire values are the codegen enum's keys (PascalCase wire names — the Pothos registration maps TS keys to the wire, and the codegen enum mirrors them). The backend↔codegen translation is the module-scope, membership-guarded `CODEGEN_WIRE_BY_REF` lookup in `frontend/views/teacher/sessions/sessionReportConversions.ts` — cast-free, fail-closed (an unmapped value throws, never silently passes), and its totality is parity-tested (full round-trip + order-insensitive key-parity in `frontend/views/teacher/sessions/sessionReportConversions.test.ts`). Localized display labels resolve through `t.surahJuzLabel(ref)` — a record-literal map (`SURAH_JUZ_LABELS`) in `shared/locale/en/sessions/labels.ts` + `shared/locale/ar/sessions/labels.ts`, exhaustive over the 144-member vocabulary with a `?? ref` fail-visible fallback — enforced from both directions by the literal-list parity belt (`shared/locale/sessions-namespace.parity.test.ts`) and the backend-side conformance suite (`backend/enum/shared/surah-juz-ref.locale-conformance.test.ts`). The teacher picker is a grouped, searchable Autocomplete (114 surahs / 30 juzs, two locale-provided group headings). The full mirror map, naming rules, and fixture near-collision rules live in `docs/curriculum/surah-juz-ref-vocabulary.md`. `from ≤ to` cohesiveness and ayah bounds are validated server-side — the UI may pre-check for UX but the typed denial is authoritative. |
| **Parent portal** | Parent reads resolve to `null` today — participant-only collapse is by design, byte-identical to a foreign read. The parent's channel is the report-ready notification only. A parent read surface is a new ruling to be made with its own oracle review, not a widening of these queries. |
| **Rating aggregation** | The 0..5 `studentRatingByTeacher` lives on `reports` rows — read-only consumption. Do not add write surfaces to this domain to support aggregation; ratings are teacher-authored at submission and immutable (append-only posture). |
| **Dual confirmation / escrow** | This surface never touches `fee_held`, lanes, or wallet rows — settlement reads nothing from reports/homework and vice versa. `status = completed` is only this surface's gate; the confirmation flow owns the money side exactly as the lifecycle defines it. |
| **Admin tracking** | Admins are non-participants here: `null` reads and the standard denials, no bypass exists. A future admin oversight surface ships under its own authScopes with its own oracle ruling. |

### 5.1 Teacher Homework History Read

The `studentHomeworkHistory(studentId: ID!, page: Int, pageSize: Int)` query is the teacher-scoped cross-teacher homework history read. The role scope (`Teacher` only) fires BEFORE the resolver runs — a student/parent/admin token is denied at the scope layer with `FORBIDDEN` regardless of any caller-supplied identity surface. The resolver is thin delegation: identity comes EXCLUSIVELY from `ctx.user.id`, the `studentId` arg is parsed by the house `requirePositiveIntId` guard, and the service runs the relationship gate (`SessionRepository.existsSessionForTeacherStudent`) + reads (`HomeWorkRepository.listForStudent` + `countForStudent`) inside ONE REPEATABLE READ transaction — a session that is created/cancelled/disputed mid-flight cannot extend or shrink the returned payload.

The constant-FORBIDDEN oracle: any miss (unknown student id, foreign teacher, non-teacher caller) yields the same byte-identical `ForbiddenError` + exactly ONE bounded `logDomainError`. Hostile `studentId` shapes (`"abc"`, `"0"`, `"-1"`, `"1.5"`, overflow) hit the pre-DB `assertPositiveSafeSessionId` guard BEFORE the relationship gate and surface as `VALIDATION` (zero `logDomainError` calls). The two denial shapes are distinguishable on the wire (`FORBIDDEN` for valid-shape-but-unlinked; `VALIDATION` for hostile-shape).

The pagination clamp is **reset-to-default, NOT clamp-to-cap**: a hostile `pageSize: 51` collapses to `25` (the default), `pageSize: 50` stays `50` (the max kept), `page: 0` collapses to `1`. The effective values echo back in the envelope so an out-of-range page yields an empty `items` array next to the honest `totalCount`.

## 6. Rollout Summary

Shipped in two milestones: M1 wrote the entire backend surface + the typed documents (zero UI); M2 ships the teacher-facing submission UX on top of it + the cross-teacher homework history read.

### M1 — Backend + documents (shipped)

| File | Change |
|---|---|
| `backend/db/schema/classes/reports.ts`, `home-work.ts` | Unique constraints `reports_session_id_unique` / `home_work_session_id_unique`; grade columns nullable for ungraded assignment rows (push-only) |
| `backend/db/repo/classes/report.repository.ts` | **Created** — `ReportRepository.insertReport` / `findBySessionId` |
| `backend/db/repo/classes/home-work.repository.ts` | **Created** — `HomeWorkRepository.insertHomeWork` / `findBySessionId` / `findLatestByStudentId` / `gradeHomeWorkOnce` (guarded one-shot UPDATE) |
| `backend/db/repo/classes/session.repository.ts` (+ helpers) | Extended — `lockForReportGate` (FOR UPDATE gate probe, tx REQUIRED) + `findReportWaveContextById` (single joined student/teacher/parent locale read) |
| `backend/types/classes/report.types.ts`, `home-work.types.ts` | Canonical types: `Report*`/`HomeWork*` Select/Insert/Return, `SessionReportSubmitInput`, `HomeWorkAssignInput`/`HomeWorkBlockInput`/`HomeWorkGradeFieldsInput` |
| `backend/services/classes/session-report.guards.ts` | **Created** — pure pre-DB validators (id, notes, rating, grade, block cohesiveness, ayah bounds, assignment/previous-grades shapes) |
| `backend/services/classes/session-report.service.ts` | **Created** — `submitSessionReport` (gate → co-creation → notifications) + participant-only `getSessionReport` / `getSessionHomework` |
| `backend/services/classes/session-report-notification.service.ts` | **Created** — `notifySessionReportReady` (wave-context read, recipient-locale composition, in-tx emissions, receipts) |
| `backend/enum/shared/surah-juz-ref.enum.ts` | **Extended** — the `SurahJuzRef` vocabulary (created in M1; now the full 144-member mushaf canon — 114 surahs + 30 juz; see `docs/curriculum/surah-juz-ref-vocabulary.md`) |
| `backend/graphql/pothos/classes/report.pothos.ts`, `home-work.pothos.ts`, `session-report-input.pothos.ts` | **Created** — `SessionReport`/`SessionHomeWork` objects + the closed submit input |
| `backend/graphql/pothos/shared/enum.pothos.ts` | `SurahJuzRef` enum registration (enum-object form) |
| `backend/graphql/mutation/classes/session-report.mutation.ts` | **Created** — `submitSessionReport` (`$all { authenticated, role: [Teacher] }`) |
| `backend/graphql/query/classes/session-report.query.ts` | **Created** — `sessionReport` / `sessionHomework` (`{ authenticated: true }`, nullable, oracle-collapse) |
| `shared/locale/types/errors/*`, `en/`, `ar/` | Flat keys: `sessionReportAlreadyExists`, `homeworkAlreadyGraded`, + the validation set (`sessionReportNotesRequired`, `sessionReportNotesTooLong`, `sessionRatingRange`, `homeworkGradeRange`, `homeworkAyahRangeInvalid`, `homeworkSurahJuzInvalid`, `homeworkAssignmentBlocksRequired`) |
| `shared/locale/types/notifications/*`, `en/`, `ar/` | Report-ready slots: `eventSessionReportReadyTitle`, `eventSessionReportReadyBody(teacherName)`, `eventSessionReportReadyParentBody(studentName, teacherName)` |
| `frontend/graphql/sharedDocuments/scheduling/session-report.documents.ts` | **Created** — the three typed documents (+ scheduling barrel exports) |
| `test/workflows/classes/session-report-homework.journey.test.ts` | **Created** — the cross-actor journey (double-submit storm, grade race, oracle reads, rollback-with-zero-pushes) |

### M2 — Teacher-facing submission UX (this ticket)

| File | Change |
|---|---|
| `backend/types/classes/home-work.types.ts` | Extended — `StudentHomeworkPageInput` + `StudentHomeworkPageReturnType` (the id-less pagination envelope) |
| `backend/db/repo/classes/session.repository.ts` | Extended — `existsSessionForTeacherStudent(teacherUserId, studentId, tx?)` (query-builder EXISTS probe on the `session_teacher_id_student_id_idx`) |
| `backend/services/classes/student-homework.service.ts` (+ helpers) | **Created** — `listStudentHomeworkHistory` (REPEATABLE READ, constant-FORBIDDEN gate) + `clampHomeworkHistoryPage` (page ≥1, pageSize 25 default / 50 max — reset-to-default, NOT clamp-to-cap) |
| `backend/graphql/pothos/classes/home-work.pothos.ts` | Extended — `StudentHomeworkPagePothosObject` (the sanctioned list-wrapper; items reuse the canonical `SessionHomeWork` object) |
| `backend/graphql/query/classes/session-report.query.ts` | Extended — `studentHomeworkHistory` query field (`authScopes: { $all { authenticated, role: [Teacher] } }`, thin resolver, no GraphQL defaults on paging args) |
| `frontend/graphql/sharedDocuments/scheduling/session-report.documents.ts` | Extended — `studentHomeworkHistoryQueryDocument` (`id` first on items + the 4-field envelope) |
| `frontend/providers/apollo/apolloCache.ts` | Extended — `StudentHomeworkPage: { keyFields: false }` (id-less envelope normalization, the `ParentHomeworkPage` precedent) |
| `shared/locale/types/sessions/labels.ts` + `en/` + `ar/` + parity registry | Extended — 36 new keys incl. the function-valued `surahJuzLabel(ref: string) => string` (record-literal map, now exhaustive over the full 144-member vocabulary, fail-closed to the raw ref) |
| `frontend/views/student/sessions/sessionRowAction.ts` | Extended — `SessionRowAction["id"]` union gains `"homework" | "report"` |
| `frontend/views/teacher/sessions/teacherSessionCacheArms.ts` | Extended — `TeacherActionsWiring` gains `onHomework`/`onReport`; matrix: Started → `[complete, homework]`; Completed → `[report]` |
| `frontend/views/teacher/sessions/TeacherSessionsBody.tsx` | Extended — destructures `onHomework`/`onReport` + threads them to `actionsFor` |
| `frontend/views/teacher/sessions/TeacherSessionsContainer.tsx` | Extended — `reportDialogSessionId` state slot (setter-only at this tier; the dialog mount line lands in 5.4) + `openReportDialog`/`openHomeworkDialog` handlers |
| `frontend/views/teacher/sessions/teacherSessionReportDialog.helpers.ts` | **Created** — `buildSubmitPayload` (BOPLA field-by-field) + `validateReportForm` (mirrors server vocabulary) + `resolveNewestRow` + `isNewestRowUngraded` |
| `frontend/views/teacher/sessions/TeacherSessionReportDialog.parts.tsx` | **Created** — `AssignmentBlock` (Jadid/Madi sub-forms) + `ReviewState` (read-only report) |
| `frontend/views/teacher/sessions/useTeacherSessionReportQueries.ts` | **Created** — parallel `useQuery` bundle (sessionReport + sessionHomework + studentHomeworkHistory; skips when dialog closed; NO `useLazyQuery`) |
| `frontend/views/teacher/sessions/useTeacherSessionReportSubmit.ts` | **Created** — `useMutation` wrapper with the `extensions.code` → behavior arm mapping (SESSION_REPORT_ALREADY_EXISTS → info + close + refetch; SESSION_INVALID_TRANSITION → row alert; default → generic notice) |
| `frontend/views/teacher/sessions/TeacherSessionReportDialog.tsx` | **Created** — the mode-resolved dialog (`prepare` / `submit` / `review`) composing the parts + queries hook + mutation |
| `test/workflows/classes/session-report-cross-teacher.journey.test.ts` | **Created** — the cross-teacher journey (T1 submits H1 → T2 reads → T2 submits σ2 with previousGrades → T1 sees symmetric history → foreign teacher constant FORBIDDEN → student role denial → replay safety) |
| `backend/graphql/test/student-homework-history.wire.test.ts` | **Created** — the wire suite (anonymous → UNAUTHORIZED; student/parent/admin → FORBIDDEN role scope; teacher happy path with rows authored by TWO teachers; constant-oracle byte-identity foreign vs unknown; id-shape fuzz → VALIDATION; paging args echo; replay safety) |
| `backend/db/test/repo/classes/session.repository.test.ts` | Extended — `existsSessionForTeacherStudent` truth table (linked via any status; unlinked; unknown; tx propagation; 100% branch coverage) |
| `backend/services/classes/student-homework.service.test.ts` | **Created** — 4-tier suite (constant-FORBIDDEN byte-identity; happy path with TWO-teachers rows visible; clamp boundaries; outerTx SAVEPOINT seam; read silence via `logger.logDomainError` spy; hostile id matrix → VALIDATION) |

## 7. Related Documents

- `docs/sessions/session-lifecycle.md` — the state machine this surface gates on (`status = completed` is this surface's required report-gate state); the guarded-transition pattern the write gate extends; the sessions-are-sensitive oracle ruling the reads inherit.
- `docs/notifications/session-request-notifications.md` — the sibling session-notification seam (recipient-locale composition, caller-tx receipts, publish-after-commit) this wave follows.
- `docs/graphql/error-handling-contract.md` — the transport taxonomy (`SESSION_REPORT_ALREADY_EXISTS` / `SESSION_INVALID_TRANSITION` / `VALIDATION` codes → HTTP semantics, client mapping).
- `docs/graphql/domain-error-extensions-code.md` — the DomainError → `extensions.code` throw conventions this surface's denials follow.
