# Requirements & Specification: In-Session Locking (Hide from Directory)

> **Plan directory (verbatim — every header, ledger path, task `0.1`, and self-reference in this document uses this exact string):** `ai/plans/milestone_2/in_session_locking_hide_from_directory`
> **Ticket:** `In-Session Locking (Hide from Directory)` — Owner Dev 2, Milestone 2, 3 SP, blocked by `Teacher Availability Toggle (Available/Unavailable)` (`docs/planning/TICKETS.md:1338-1372`; decision refs INV-A2, INV-A3, INV-A4, FR-4.3 at `:1372`). The blocked-by ticket is **verified implemented** (`backend/services/teachers/teacher-availability.service.ts` + GraphQL wire + dashboard card + canonical doc `docs/teachers/teacher-availability.md:6` "Status: Implemented and verified").
> **Grounding docs:** `docs/specs/functional-requirements.md` §4 **FR-4.3** (`:144-146`) + FR-4.1 (`:135-138`) + FR-4.2 (`:140-142`) · `docs/specs/state-machine-invariants.md` §3 Teacher Availability Lifecycle (`:97-127`; INV-A1 `:120`, INV-A2 `:121`, INV-A3 `:122`, INV-A4 `:123`, implementation pointer `:125`) + INV-S6 (`:47`) + header note (`:12`) · `docs/planning/TICKETS.md:1338-1372` (this ticket) and sibling rows `:1298-1334` (15-Minute Inactivity Auto-Offline), `:1457-1505` (On-Demand Matching Algorithm — Dev 3), `:1509-1549` (Teacher Directory Browse & Filter API — Dev 3) · `docs/backend/cross-stream-contracts.md` `TeacherAvailabilitySnapshotContract` (row `:12`, consumer binding `:83`, TOCTOU rule §7.3 `:117-119`, forbidden-field registry `:56`) · `docs/workflows/02-on-demand-matching-workflow.md` §2 (`:16-26`), §5.1 (`:83-88`), §5.2 In-Session Locking Rules (`:90-93`) · `docs/teachers/teacher-availability.md` §6.1 forward contract (`:287-297`) + §6.2 hazard & prescribed fix (`:299-313`) · `docs/sessions/session-lifecycle.md` D3 pointer (`:171-173`).
>
> **⚠️ Load-bearing scope reconciliation (READ FIRST — shapes every section below).** The ticket's Gherkin names three observable outcomes, but the tree already ships one of them, one has no consumer surface, and one is this ticket's genuine build item:
> - **"Teacher accepts a session request → is_online=false" (the LOCK).** Already shipped: `SessionLifecycleService.startSession` composes `TeacherRepository.setOnline(started.teacherId, false, tx)` inside the start transaction (`backend/services/classes/session-lifecycle.service.ts:283`), with a full INV-S6 test suite (`backend/services/classes/session-lifecycle.service.test.ts:3246-3440`). There is **NO accept/decline production flow** for student sessions — `bookSessionInTx` inserts directly at `status: scheduled` with no `is_online` write (`backend/services/classes/session-lifecycle.booking.ts:179,235-289`), and the accept/decline/queued/alternatives notification emitters have **zero production callers** (`backend/services/classes/session-request-notification.service.ts:229-276`; only `notifyTeacherOfSessionRequest` is wired, from `backend/services/teachers/evaluation-booking.service.ts:130`). **Ruling (REQ-004):** in the shipped state machine the teacher's accept-moment ≙ `startSession` (`scheduled → started`), which is exactly where INV-A2 (`state-machine-invariants.md:121`) and INV-S6 (`:47`) bind `is_online=false`. This ticket re-locks that behavior with tests; it does not move the lock to booking, and it does not build an accept/decline intake (Dev-3 matching vocabulary — deferred pointer D1).
> - **"Hidden from the Available Teachers directory" (INV-A3).** Grep-verified: **no student-facing directory exists** — no `availableTeachers`-style root field in `backend/graphql/query/`, no matching service in `backend/services/`, no student browse view in `frontend/views/student/`; the only directories are admin surfaces (`backend/services/admin/teacher-directory.service.ts`). The read-side filter is Dev 3 (`TICKETS.md:1457`, `:1509`), with the forward contract pre-written at `docs/teachers/teacher-availability.md:297` (compose `is_online=true` AND the session-state oracle — never `is_online` alone). **Ruling (REQ-011):** this ticket's whole INV-A3 obligation is **data-level truthfulness** — a locked teacher is excludable because `is_online=false` is factually correct at every moment — plus keeping the forward contract intact. No directory code is written here.
> - **"Returns to Available only if they are still active (app open)" (INV-A4).** **NOT implemented — this is the genuine build item.** `releaseTeacherInSessionLock` restores `is_online=true` unconditionally (`backend/services/classes/session-lifecycle.transitions.ts:249-257`); the prior-online capture at start is a discarded transient local (`session-lifecycle.service.ts:274`), and no marker column exists (`backend/db/schema/teachers/teacher.ts:19-37`). The canonical doc prescribes the exact fix for THIS ticket (`docs/teachers/teacher-availability.md:309-313`): persist a prior-online marker and amend the release to restore the marker's value inside the release transaction. "Still active (app open)" has **no real-time evaluator today** — `users.last_active_at` is stamped only at login (`backend/services/auth/auth.service.ts:514-516`, fire-and-forget at `:203-207`) and the 15-min auto-offline ticket (`TICKETS.md:1298-1334`) is unbuilt. **Ruling (REQ-006):** the implementable INV-A4 semantics today = **restore the teacher's persisted pre-lock availability intent** (never-resurrect); convergence to the literal "app closed → Unavailable" outcome is owned by the `:1298` sweep, whose own AC composes with this lock ("in-session lock takes priority", `TICKETS.md:1322-1324`). Composition contract in REQ-011/§7; deferred pointer D3.
> - **Two discovered defects enter scope because INV-A2/INV-A4 cannot be honest without them:** (a) **admin-governance cancel of a `started` session never releases the lock** (`backend/services/classes/session-admin-governance.helpers.ts:298-366` — `guardCancelPreTerminal` matches `scheduled|started` at `backend/db/repo/classes/session.repository.helpers.ts:436-441,459-468`, but zero release calls exist in the file) — a teacher stuck `is_online=false` forever; (b) the `startedAt !== null` release classifier is polluted by admin reschedule, which writes planned timing onto scheduled rows (`session.repository.helpers.ts:443-457`) — the marker becomes the authoritative lock-held oracle and the classifier is retired (REQ-008).
>
> **This ticket therefore ships exactly the slice it owns:** ONE new nullable `teacher` column, THREE single-statement atomic repository writers (acquire / release / toggle-intent) that replace `setOnline`, the marker-gated release composed on **every** terminal session exit (including the admin leak), the race-closed Available-direction toggle write, zero GraphQL schema change, zero new notification waves, zero UI, canonical-doc + docblock hygiene, and journey + 4-tier test locks. This reconciliation is the spec's governing ruling and must be ratified at the Phase 1.5 plan review.

---

## 1. Executive Summary & Problem Statement

### 1.1 Feature Summary

Complete the teacher in-session availability lock: when a teacher starts a session their availability flag goes Unavailable and is restored on session conclusion **according to the teacher's persisted pre-lock intent** (INV-A4 never-resurrect), with the restore composed on every terminal exit path and guarded against concurrent-session races — so that whatever directory later reads `teacher.is_online` reads truth (INV-A3 data-level).

### 1.2 Problem from user perspective

- **Teacher (actor):** a teacher who deliberately toggled Unavailable before a session (or mid-session) is **resurrected to Available** when the session concludes — `releaseTeacherInSessionLock` writes `is_online=true` unconditionally (`session-lifecycle.transitions.ts:250`), contradicting INV-A4 (`state-machine-invariants.md:123`) and the teacher's expressed intent. A teacher whose `started` session is cancelled by an admin is **never restored at all** (leak at `session-admin-governance.helpers.ts:298-366`) and stays invisible to future students until they notice and manually toggle.
- **Student (observer):** a student browsing teachers must never be offered an in-session teacher. No directory exists yet (Dev 3), so the student's protection today is the **truthfulness of the data** the future directory will read; a leaky or resurrecting lock corrupts that data.
- **Admin (actor):** admin governance cancels a started session believing the platform self-heals; today it silently strands the teacher offline.
- **Dev 3 / future matching consumers:** need ONE canonical, race-free write-side story for `is_online` — lock, release, and manual toggle must compose through single-statement atomic primitives with a documented state machine (`docs/teachers/teacher-availability.md:174` single-writer rule).

### 1.3 Business value

- Closes the last write-side gap of the on-demand matching premise (`docs/workflows/02-on-demand-matching-workflow.md:10`): the availability flag becomes trustworthy end-to-end, which is Milestone 2's release-gate dependency ("Dev 3's Matching Engine (M2) depends on Dev 2's Teacher Availability toggle", `docs/planning/ROADMAP.md:187`).
- Eliminates the stranded-teacher support burden (admin-cancel leak) and the false-availability misleading behavior (resurrection).
- Honors the canonical doc's pre-assigned ownership: "Owner ticket: In-Session Locking (Hide from Directory) — owns the release transaction" (`docs/teachers/teacher-availability.md:305`).

---

## 2. Scope

### 2.1 In scope

| # | Slice | Evidence-driven rationale |
|---|-------|---------------------------|
| S1 | `teacher.was_online_before_lock` nullable column + Drizzle push | Prescribed at `docs/teachers/teacher-availability.md:311`; no marker exists today (`backend/db/schema/teachers/teacher.ts:19-37`) |
| S2 | Atomic acquire primitive (marker capture + lock in one statement) | Replaces the discarded transient capture (`session-lifecycle.service.ts:274`) + separate lock write (`:283`) |
| S3 | Marker-gated release primitive with last-started-exit guard | INV-A4 (`:123`); concurrent-session race (booking has no availability gate, `session-lifecycle.booking.ts:245-261`) |
| S4 | Release composed on ALL terminal exits incl. admin governance cancel | Leak (`session-admin-governance.helpers.ts:298-366`); classifier pollution (`session.repository.helpers.ts:443-457`) |
| S5 | Toggle-intent primitive replacing `setOnline` (marker-aware + direction-guarded) | Resurrection via mid-session Unavailable; TOCTOU window documented at `docs/teachers/teacher-availability.md:297` |
| S6 | Canonical docs + stale docblock hygiene | `session-lifecycle.service.ts:230-234` stale seam note; `teacher.repository.ts:473-511` stale docblock; docs misstate release coverage (`state-machine-invariants.md:12` overclaims "every started-exit" while the admin-cancel path leaks; `docs/sessions/session-lifecycle.md:81` lists only the three legacy exits); 19 present-tense `setOnline` doc references that retire with the method (`grep -rn "setOnline" docs/`) |
| S7 | Journey + 4-tier test locks (repo/service/journey) | `test/workflows/AGENTS.md` rules; INV-S6 suite extension |

### 2.2 Out of scope (each with a ledger pointer — see `deferred-items.md`)

- Student-facing directory read/filter API + matching pipeline — Dev 3 (`TICKETS.md:1457`, `:1509`) — D2.
- Real accept/decline session-request intake (queue/reject/offer-alternatives) — Dev 3 matching; seams are the unused `teacher.request_preference` pgEnum (`backend/db/schema/enums.ts:162`) and the unwired emitters — D1.
- 15-minute inactivity auto-offline sweep ("app open" real-time detection) — `TICKETS.md:1298-1334` — D3.
- Booking-time availability gate (student booking an offline teacher) — matching-flow decision, Dev 3 — D4.
- Widening the INV-A2 toggle gate to `disputed`-from-started sessions — invariant text binds `started` only; product ruling pending — D5.
- Any GraphQL schema change, UI change, or new locale namespace — REQ-012, REQ-020 (exclusions-by-design, not deferred work; the only flag-shaped variant, an `inSession` field, is ledger D6 — rejected by contract).

---

## 3. Requirements

Numbering is `REQ-NNN` (zero-padded, sibling-plan convention). Every requirement is testable; every code anchor cited was grep/read-verified on 2026-10-04.

### REQ-001: Pre-Implementation Baseline & Execution Protocol

**User Story:** As an executing agent, I want an error baseline and a persistent outcome protocol, so that I can distinguish new issues from pre-existing ones and never repeat past research.

**Acceptance Criteria:**
1. WHEN implementation begins THEN the system SHALL record baseline counts (`bun tsgo 2>&1 | grep "error TS" | wc -l`, `bun biome:check 2>&1 | grep -c "warn"`, `bun run scripts/lint-service.ts --json --id baseline`) into `/tmp/baseline-*.txt` and mirror them into `outcome/0-baseline-outcome.md`.
2. WHEN implementation begins THEN the system SHALL initialize `ai/plans/milestone_2/in_session_locking_hide_from_directory/deferred-items.md` from `.agents/spec-process-guide/templates/deferred-items-template.md`, seeded with the resolved-pointer entries D1–D7 (defined in §2.2 for D1–D5, in REQ-011 AC-5 for D6, and in §7 assumption (c) for D7).
3. WHEN an executing agent starts any task THEN it SHALL read ALL existing files in `ai/plans/milestone_2/in_session_locking_hide_from_directory/outcome/` (lexical order) before touching code.
4. WHEN an executing agent completes any task THEN it SHALL write `outcome/<task-id>-outcome.md` (research findings, exact anchors touched, cross-file dependencies, carry-over points) BEFORE the next task begins.
5. WHEN any subtask completes THEN the agent SHALL flip its checkbox `[ ]` → `[x]` in `tasks.md` — only when ALL its subtasks are complete.
6. WHEN any file is created/modified THEN the agent SHALL pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0) on that file.
7. WHEN any database test runs THEN it SHALL run via `bun run test/scripts/run-test.ts <path>` — never raw `bun test` (which skips the `--env-file=.env.test` preload).

### REQ-002: Translation-System & Enum-Import Compliance (repo-verified variant)

**User Story:** As a developer, I want compile-time i18n and value-import discipline, so that no runtime i18n or enum failures ship.

**Acceptance Criteria:**
1. WHEN any user-facing string is needed THEN the system SHALL reuse existing `errors` namespace keys (`teacherInActiveSession`, `teacherNotCertified`, `teacherNotFound` — `shared/locale/types/errors/labels.ts:293-299`) — this ticket mints ZERO new locale keys because it adds no user-facing surface.
2. WHEN services resolve translations THEN they SHALL call `getServerTranslations(locale)` (ONE arg, from `@/shared/locale/server-graphql`) and read `.errorsTranslations` — the verified pattern at `backend/services/teachers/teacher-availability.service.ts:108,184`.
3. WHEN client components translate THEN they SHALL use namespace handles from `defineNamespace` (e.g. `useAppTranslation(Availability)` — `shared/locale/namespaces/availability/availability.namespace.ts:4-6`, consumed at `frontend/views/teachers/dashboard/TeacherAvailabilityCard.tsx:63`). The legacy `Translation.` enum, two-arg `getTranslations`, `next-intl`, and `shared/messages/` are FORBIDDEN (removed systems).
4. WHEN `SessionStatus` (or any enum) is used in a runtime expression (SQL predicates, `eq(...)`, object literals) THEN it SHALL be a value import from `@/backend/enum/scheduling/session-status.enum` (`:7-13`) — never `import type`.

### REQ-003: In-Session Lock at Session Start (INV-A2 / INV-S6 — existing, re-locked)

**User Story:** As a student, I want an in-session teacher to be flagged Unavailable the instant their session starts, so that no future directory can offer them to me mid-session.

**Acceptance Criteria:**
1. WHEN a teacher starts a session (`scheduled → started`) THEN the system SHALL set `teacher.is_online = false` **in the same transaction** as the status transition, keyed on the transitioned row's `teacherId` (never caller input) — the shipped discipline at `backend/services/classes/session-lifecycle.service.ts:266-283` which this ticket preserves via the new acquire primitive (REQ-005).
2. WHEN the lock write matches zero teacher rows THEN the system SHALL roll back the start transition and throw (fail-closed — existing contract `session-lifecycle.service.ts:284-289`).
3. WHILE a session is in `started` state THEN the teacher's `is_online` SHALL be `false` (INV-S6, `state-machine-invariants.md:47`).
4. WHEN a teacher is in a `started` session and attempts to toggle Available THEN the system SHALL deny with `ConflictError("TEACHER_IN_ACTIVE_SESSION", t.teacherInActiveSession)` disclosing NO session id — the existing gate `assertTeacherNotInActiveSession` (`backend/services/classes/session-lifecycle.enforcement.ts:200-214`) is consumed verbatim.
5. IF a mid-flow fault occurs between the transition and the lock write THEN both SHALL roll back together (single transaction — existing test `session-lifecycle.service.test.ts:3259`).

### REQ-004: Accept-Moment Ruling — the Lock Fires at Start, Not at Booking

**User Story:** As a teacher with upcoming booked sessions, I want to remain Available for other students until a session actually starts, so that my calendar capacity is not falsely consumed at booking time.

**Acceptance Criteria:**
1. WHEN a student books a session (createSession) THEN the system SHALL NOT write `teacher.is_online` — the row is born `scheduled` (`session-lifecycle.booking.ts:179`) and the teacher remains bookable (existing behavior, now codified).
2. WHEN the ticket's "teacher accepts a session request" is evaluated THEN the system SHALL interpret the accept-moment as `startSession` — the only teacher-driven session entrypoint (`backend/graphql/mutation/classes/session-lifecycle.mutation.ts:181`), matching INV-A2's `started` binding (`state-machine-invariants.md:121`) and the transition matrix (`session-lifecycle.enforcement.ts:72-86`).
3. IF a real accept/decline intake is later built (Dev 3) THEN the lock composition SHALL move with it — recorded as ledger pointer D1; this ticket ships no intake.

### REQ-005: Persisted Prior-Online Marker, Captured Atomically at Lock Acquisition

**User Story:** As a teacher who was deliberately Unavailable before a session, I want my pre-session choice remembered across the session, so that concluding the session does not silently flip me to Available.

**Acceptance Criteria:**
1. WHEN a teacher row is locked for a session start THEN the system SHALL, in ONE atomic statement, capture the pre-lock `is_online` value into `teacher.was_online_before_lock` and set `is_online = false` — `COALESCE(was_online_before_lock, is_online)` semantics so a pre-existing marker (concurrent session) is never overwritten (first-lock-wins).
2. WHEN the teacher row does not exist THEN the acquire primitive SHALL return `null` and the service SHALL fail the start closed (existing error contract preserved).
3. WHEN `was_online_before_lock` is `NULL` THEN the system SHALL interpret it as "no in-session lock held" — the authoritative lock-held oracle replacing the `startedAt !== null` classifier (retired per REQ-008).
4. WHEN the column is added THEN it SHALL be a nullable `boolean` with no default on `backend/db/schema/teachers/teacher.ts` (alongside `isOnline` at `:28`), applied via the repo's Drizzle schema flow (`bun run db push` — no custom SQL, hence no `migrate`).

### REQ-006: Never-Resurrect, Marker-Gated Release (INV-A4)

**User Story:** As a teacher, I want my availability restored on session conclusion according to my persisted pre-lock intent, so that a concluded session never silently resurrects me to Available.

**Acceptance Criteria:**
1. WHEN a session that held the in-session lock reaches a terminal state (`completed` or `cancelled`) THEN the system SHALL restore `teacher.is_online` to the value persisted in `was_online_before_lock` and clear the marker to `NULL`, inside the same transaction as the terminal transition (the fix prescribed at `docs/teachers/teacher-availability.md:309-313`).
2. IF `was_online_before_lock = false` (teacher was deliberately Unavailable before start, or toggled Unavailable mid-session per REQ-009) THEN the release SHALL leave `is_online = false` (never-resurrect; ticket AC "stays Unavailable").
3. IF the marker is `NULL` at release time (no lock held — e.g. a never-started row, a reschedule-polluted `startedAt`, or a double release) THEN the release SHALL be a benign no-op that writes nothing ( REQ-008's classifier retirement depends on this).
4. WHEN the release write matches zero teacher rows (teacher deleted) THEN the system SHALL fail closed with the existing error contract (`session-lifecycle.transitions.ts:251-256` — `logger.error` + throw).
5. WHEN the ticket's "returns to Available only if still active (app open)" is evaluated THEN the system SHALL treat the persisted pre-lock intent as the restore-truth; literal app-open detection is the `TICKETS.md:1298` sweep's job (composition contract REQ-011 AC-5, ledger D3).

### REQ-007: Last-Started-Exit Guard (Concurrent Sessions)

**User Story:** As a student, I want a teacher who is still in a second active session to remain Unavailable after their first session concludes, so that INV-A2 is never transiently violated.

**Acceptance Criteria:**
1. WHEN a terminal exit fires for one session and the teacher has ANOTHER session in `started` state THEN the release SHALL defer — write nothing, keep the marker — because the teacher is still in-session (INV-A2 continues to hold).
2. WHEN the LAST `started` session for that teacher exits THEN the release SHALL perform the marker-gated restore (REQ-006).
3. WHEN two terminal exits race (two sessions concluding concurrently for one teacher) THEN the guard SHALL decide atomically inside the release statement itself (`NOT EXISTS (SELECT 1 FROM session WHERE teacher_id = … AND status = 'started')` evaluated under the teacher-row write lock) — database-level constraint discipline per `docs/planning/MILESTONE_PLAN.md:245` ("In-session locking race conditions → Database-level constraints; atomic updates").
   - **Post-review ratification amendment:** serialization is attributed to the teacher-row `SELECT … FOR UPDATE` serialization preamble plus row-lock-held probe evaluation — the last-started-exit probe is evaluated under the row lock against fresh committed state (plan §4.2 amendment; the guard alone was empirically disproven for the both-defer interleaving, where both exits defer and neither writes). The guard statement remains the last-exit predicate.
4. WHILE the teacher row is locked by one release transaction THEN a concurrent release SHALL serialize on that row lock and re-evaluate the guard (no lost updates, no double restore).

### REQ-008: Release Composed on Every Terminal Exit — Admin-Cancel Leak Fix + Classifier Retirement

**User Story:** As a teacher whose started session is cancelled by an admin, I want my availability restored exactly as if I had concluded it myself, so that no governance path strands me offline.

**Acceptance Criteria:**
1. WHEN `completeSessionWithReceipt` completes a session THEN the release SHALL compose in the same transaction (existing call site `session-lifecycle.service.ts:404` — preserved).
2. WHEN a participant cancels a session THEN the release SHALL compose unconditionally (the `startedAt !== null` guard at `session-lifecycle.service.ts:489` is REMOVED — the marker oracle makes it redundant and it is polluted by admin reschedule at `session.repository.helpers.ts:443-457`).
3. WHEN admin arbitration resolves a dispute (cancel or complete) THEN the release SHALL compose unconditionally (guard at `session-lifecycle.service.ts:663` removed, same rationale).
4. WHEN admin governance cancels a session (`SessionAdminGovernanceService.cancel` → `cancelSessionInTx`, `backend/services/classes/session-admin-governance.helpers.ts:298-366`) THEN the release SHALL compose in the same transaction — closing the verified leak (zero release references in that file today) — placed so the teacher row is acquired after the session-row transition and before the notification-receipt writes — the same lock order as the completion path (session row → teacher row → notification-receipt rows), which is the deadlock-safety argument.
5. WHEN a never-started (`scheduled`) session is cancelled or swept THEN the release call SHALL remain a benign no-op via REQ-006 AC-3 (marker `NULL`), preserving today's observable behavior for pre-start cancels.
6. IF any new terminal exit path is added later THEN it SHALL compose the release (documented rule in the canonical docs — REQ-015).

### REQ-009: Mid-Session Deliberate Unavailable Wins Over the Marker

**User Story:** As a teacher who toggles Unavailable while a session is running, I want that explicit choice to survive the session's conclusion, so that ending the session does not override my latest intent.

**Acceptance Criteria:**
1. WHEN the manual toggle writes `is_online = false` while a lock marker exists THEN the same atomic statement SHALL overwrite `was_online_before_lock = false` (the teacher's live intent becomes the restore-truth).
2. WHEN the manual toggle writes `is_online = true` THEN the statement SHALL apply the same marker overwrite rule (only reachable while no `started` session exists — the INV-A2 gate) — e.g. during a `disputed`-from-started window; the later arbitration release then restores consistently.
3. WHEN no marker exists THEN the toggle SHALL write only `is_online`, leaving `was_online_before_lock` `NULL` (pure toggle, unchanged behavior).
4. IF the toggle and a concurrent release race THEN the single-statement semantics SHALL decide (row-lock serialization; last committed write wins on `is_online`, and the marker write is either applied pre-clear or the release has already cleared it — both orders converge to a consistent state; pinned by chaos tests, Tier 3).

### REQ-010: Race-Closed Available-Direction Toggle Write (INV-A2 TOCTOU Backstop)

**User Story:** As a student, I want the Available toggle to be impossible to land while a session start is concurrently committing, so that `is_online=true` can never coexist with a `started` session.

**Acceptance Criteria:**
1. WHEN the toggle writes the Available direction THEN the write statement SHALL carry the not-in-started-session predicate (`AND NOT EXISTS (SELECT 1 FROM session WHERE teacher_id = … AND status = 'started')`) — closing the sub-second gate-read vs start-commit window documented at `docs/teachers/teacher-availability.md:297`.
2. WHEN the guarded write returns zero rows on the Available direction THEN the service SHALL throw `ConflictError("TEACHER_IN_ACTIVE_SESSION", t.teacherInActiveSession)` — the same denial the pre-check gate uses (teacher-row existence is already proven in-transaction by `lockForCertificationCheck`, `teacher-availability.service.ts:190`).
3. WHEN the toggle writes the Unavailable direction THEN no session predicate SHALL apply (going offline is always safe; gate intentionally skipped today at `teacher-availability.service.ts:201`).

### REQ-011: INV-A3 Data-Level Truthfulness + Dev-3 Forward Contract

**User Story:** As a future directory consumer (Dev 3), I want `teacher.is_online` to be truthful at every instant and a documented exclusion oracle, so that the directory can hide in-session teachers without re-deriving lock semantics.

**Acceptance Criteria:**
1. WHILE a teacher holds the in-session lock THEN `teacher.is_online` SHALL be `false` — the data-level guarantee that makes the (unbuilt) directory's `is_online = true` filter truthful; no directory code is written in this ticket.
2. WHEN the directory later ships THEN it SHALL follow the pre-written forward contract (`docs/teachers/teacher-availability.md:297`): filter `is_online = true` AND exclude teachers with a `started` session via the canonical oracle (`assertTeacherNotInActiveSession` as the "is this teacher in a session?" probe) — NEVER `is_online` alone (the toggle-vs-lifecycle race window).
3. WHEN this ticket completes THEN the canonical docs SHALL record that the write-side of INV-A3 is complete and the read-side remains Dev 3 (`TICKETS.md:1457`, `:1509`).
4. WHEN the `TICKETS.md:1298` sweep later ships THEN it SHALL compose with this lock per its own AC (`TICKETS.md:1322-1324`): a teacher holding a `started` session is NOT auto-offlined (in-session lock priority), and the sweep owns converging a restored-Available teacher to Unavailable when they are truly inactive.
5. IF a consumer needs an `inSession`-style flag THEN it SHALL be refused — the forbidden-field registry forbids a parallel flag (`docs/backend/cross-stream-contracts.md:56`); excludability is expressed ONLY via `is_online` (`backend/types/teachers/teacher.types.ts:21-22`).

### REQ-012: Zero GraphQL Schema Change

**Acceptance Criteria:**
1. WHEN this ticket completes THEN the GraphQL schema SHALL be byte-identical for roots/fields/args: no new query, mutation, object, or argument (the feature is service+repo level; `myTeacherAvailability` / `setTeacherAvailability(isOnline: Boolean!)` already expose everything a teacher needs — `backend/graphql/query/teachers/teacher-availability.query.ts:50-75`, `backend/graphql/mutation/teachers/teacher-availability.mutation.ts:53-89`).
2. WHEN the schema-surface pins run THEN they SHALL stay green unedited: mutation-args pin `["isOnline"]` and `TeacherAvailabilityState` fields `{id, isOnline, isApproved}` (`backend/graphql/test/teacher-availability.integration.test.ts:807-849`; `backend/graphql/test/schema-surface.test.ts:1200-1205`).

### REQ-013: Zero New Notification Waves

**Acceptance Criteria:**
1. WHEN a lock is acquired or released THEN the system SHALL NOT dispatch any notification (the existing waves are unaffected: completion prompt at `session-lifecycle.service.ts:409`, governance waves at `session-admin-governance.helpers.ts:275,359,438`).
2. WHEN the release composes into admin governance cancel THEN the existing governance-cancel wave SHALL remain the only student-facing side effect (composition order: release is internal to the same transaction; wave receipts unchanged).

### REQ-014: Observability & Failure Discipline

**Acceptance Criteria:**
1. WHEN the release restores per marker THEN the system SHALL log nothing (happy path silent — existing discipline).
2. WHEN the release is a benign no-op (`no_lock_held`) or a deferral (`active_sessions_remain`) THEN the system SHALL emit at most ONE bounded `logger.debug`/`logger.logDomainError` entry with a fixed key shape (no session or teacher identifiers beyond ids).
3. WHEN a fail-closed error occurs (zero teacher rows at acquire/release) THEN the system SHALL `logger.error` and throw, rolling back the whole terminal transition — never partially commit (existing pattern `session-lifecycle.service.ts:284-289`, `session-lifecycle.transitions.ts:251-256`).
4. WHEN errors surface to users THEN they SHALL reuse existing localized codes (`TEACHER_IN_ACTIVE_SESSION`, `TEACHER_NOT_FOUND`, `VALIDATION`) — zero new error taxonomy entries.

### REQ-015: Canonical Docs & Docblock Hygiene

**Acceptance Criteria:**
1. WHEN the release ships THEN `docs/specs/state-machine-invariants.md` SHALL be updated: INV-A4 implemented note at the `:125` implementation pointer; the `:12` header note's release-coverage claim becomes true (every started-exit, including admin cancel).
2. WHEN the hazard is fixed THEN `docs/teachers/teacher-availability.md` §6.2 (`:299-313`) SHALL be updated from "MUST add a persisted prior-online marker" to the shipped semantics (marker column + gated release), and the `users.ts:37` line-drift at `:315` corrected to `:44`.
3. WHEN the release semantics change THEN `docs/sessions/session-lifecycle.md` release section SHALL document the marker oracle, the four composed exit paths, and the last-started-exit guard.
4. WHEN code docblocks are touched THEN the stale seam notes SHALL be rewritten: `session-lifecycle.service.ts:230-234` ("no availability-toggle surface yet" — false since the toggle shipped) and the `setOnline` docblock (`teacher.repository.ts:474-511`, replaced by the three new primitives' docs).
5. WHEN the enforcement docstring is touched THEN the DEF-6 drift SHALL be fixed: `assertTeacherNotInActiveSession`'s docblock says "FORBIDDEN-class" while the code throws `ConflictError`/409 (`session-lifecycle.enforcement.ts:186-189` vs `:212`) — code is authoritative; fix the docstring.

### REQ-016: Journey J1 — Book → Start (Locked) → Complete → Restored (Multi-Actor)

**User Story:** As a student, I want the full cross-actor lifecycle proven end-to-end against the real database, so that the lock and restore are known to compose across booking, teaching, and completion actors.

**Acceptance Criteria:**
1. WHEN the journey runs THEN it SHALL use committed fixtures in one committing `beforeAll` transaction with tracked `afterAll` hard-delete cleanup and zero-residue re-probes (`test/workflows/AGENTS.md:8-26`) — NO `runInRollback`.
2. GIVEN a certified Available teacher (`is_online=true`) and a student with a booked `scheduled` session, WHEN the teacher starts the session THEN a direct-DB oracle SHALL observe `is_online=false` AND the student's own teacher-facing reads (if any) SHALL reflect the lock; AND a toggle-to-Available attempt SHALL be denied `TEACHER_IN_ACTIVE_SESSION` with oracle safety (no session id in the denial).
3. WHEN the teacher completes the session THEN the oracle SHALL observe `is_online=true` (restored per marker) and `was_online_before_lock IS NULL` (cleared).

### REQ-017: Journey J2 — Never-Resurrect (Deliberately Unavailable Teacher)

**Acceptance Criteria:**
1. GIVEN a certified teacher who toggled Unavailable (`is_online=false`) before starting a session, WHEN the session completes THEN the oracle SHALL observe `is_online=false` (stays Unavailable — ticket AC "stays Unavailable if app closed" mapped to persisted intent) AND the marker cleared.
2. GIVEN a teacher Available at start who toggles Unavailable MID-session, WHEN the session completes THEN the oracle SHALL observe `is_online=false` (REQ-009: latest intent wins) AND the marker cleared.

### REQ-018: Journey J3 — Admin Governance Cancel Releases the Lock

**Acceptance Criteria:**
1. GIVEN a teacher in a `started` session, WHEN an admin cancels it via `SessionAdminGovernanceService.cancel` THEN the oracle SHALL observe the restore (marker-gated: Available-when-locked teachers return to `is_online=true`; deliberately-offline teachers stay `false`) in the same transaction as the cancel, with the governance-cancel notification wave still firing exactly once.
2. GIVEN a teacher whose `scheduled` session (never started, possibly reschedule-polluted `startedAt`) is admin-cancelled THEN the oracle SHALL observe NO availability change (no-op release).

### REQ-019: Journey J4 — Concurrent Started Sessions (Deferred Restore)

**Acceptance Criteria:**
1. GIVEN a teacher with TWO `started` sessions, WHEN the first completes THEN the oracle SHALL observe `is_online=false` still (guard defers) and the marker intact; WHEN the second completes THEN the oracle SHALL observe the restore per the ORIGINAL pre-lock marker (first-lock-wins) and the marker cleared.
2. WHEN the journey asserts THEN it SHALL use only real services and honest roles (`test/workflows/AGENTS.md:23-26`) — the concurrent cast is two students, one teacher, one admin.

### REQ-020: UX/Navigation — Explicit No-UI Ruling

**User Story:** As a teacher, I want my existing availability card to keep working unchanged, so that this backend-hardening ticket ships zero UI risk.

**Acceptance Criteria:**
1. WHEN this ticket completes THEN there SHALL be NO new routes, NO sidebar/nav changes, NO new components, NO new stories, NO new locale namespaces. The existing surfaces are consumed unchanged: `TeacherAvailabilityCard` (`frontend/views/teachers/dashboard/TeacherAvailabilityCard.tsx:62`), `useTeacherAvailabilityToggle` (`frontend/views/teachers/dashboard/useTeacherAvailabilityToggle.ts:79`), and the existing `TEACHER_IN_ACTIVE_SESSION` inline hint + error-link row (`frontend/providers/apollo/error-link.map.ts:480-482`) already render every user-visible consequence of the lock.
2. IF the release changes observable toggle behavior THEN it SHALL NOT: an Unavailable-direction toggle behaves exactly as before; an Available-direction toggle either succeeds or yields the SAME existing `TEACHER_IN_ACTIVE_SESSION` hint (REQ-010's race-closed denial reuses the existing code/message).
3. WHEN the future directory ships (Dev 3) THEN the route/nav matrix for student browsing is ITS deliverable — this plan's UX table records only the data contract it must consume (see `plan.md` §UX).

### REQ-021: Security & Tenancy Posture

**Acceptance Criteria:**
1. WHEN any lock/release/toggle write executes THEN the teacher row SHALL be addressed only by server-derived ids (the transitioned session row's `teacherId`, or `ctx.user.id` via the toggle service) — no client-supplied id reaches these primitives (BOLA/IDOR defense by construction; the mutation's only client-owned value remains `isOnline: Boolean!`).
2. WHEN the release composes into admin flows THEN admin authorization SHALL remain the governance service's existing role gates — the release adds NO new admin-reachable surface (BFLA: no new function level exposure).
3. WHEN inputs cross layers THEN DTO mapping SHALL stay strict — no `{ ...input }` spread into any update (BOPLA); the acquire/release primitives take only `(id, tx)`.
4. WHEN low-privilege tokens (student/parent) probe the toggle THEN the existing `$all { authenticated: true, role: [UserRole.Teacher] }` scope SHALL continue to deny (`teacher-availability.mutation.ts:64-69`).

### REQ-022: Non-Functional — Performance, Reliability, Compatibility

**Acceptance Criteria:**
1. WHEN the lock or release executes THEN each SHALL be exactly ONE guarded `UPDATE … RETURNING` statement (plus at most one disambiguation read on no-op paths) — no multi-statement read-then-write sequences (concurrency NFR; also the existing `setOnline` cost profile is preserved).
   - **Post-review ratification amendment:** the pin is now **at most one guarded `UPDATE … RETURNING` statement, preceded by a teacher-row `FOR UPDATE` serialization preamble (post-review ratification — see plan §4.2 amendment) and at most one cold-path disambiguation read**. The release opens with the preamble, which locks and never writes (the no-op write contract of REQ-006 AC-3 is preserved); the preamble is a locking read rather than a snapshot read, so the read-then-write TOCTOU hazard this criterion targets does not reintroduce. "Exactly ONE" remains true of the guarded write itself.
2. WHEN the release no-ops (marker `NULL` / concurrent guard) THEN the statement cost SHALL be a zero-row indexed update by PK — negligible on the scheduled-cancel hot path.
3. WHEN existing tests run THEN the shipped INV-S6 suite assertions SHALL keep their observable outcomes (start⇒locked, fault⇒rollback, complete⇒unlocked, cancel-from-scheduled⇒untouched, arbitration⇒unlocked) — the last one now justified by the marker rather than `startedAt`, same verdicts.
4. WHEN the schema column ships THEN existing rows SHALL read `was_online_before_lock = NULL` (nullable, no default, no backfill — `is_online` continues to mean exactly what it meant).
5. WHEN the release races with the cron sweeper THEN no interference SHALL exist: the sweeper only touches `scheduled`/`completed` rows (`backend/db/repo/classes/session.repository.ts:570,601-607`), never `started`, and marker-less rows no-op.

### REQ-023: Definition of Done & Quality Gates

**Acceptance Criteria:**
1. WHEN the plan completes THEN `bun quality-gate` SHALL pass and every task file SHALL have passed `sub-loop.ts --lifecycle duplicates` (exit 0).
2. WHEN the final gate runs THEN `grep -cE '^\s*\|.*(❌|⚠️)' ai/plans/milestone_2/in_session_locking_hide_from_directory/deferred-items.md` SHALL equal 0 (resolved-pointers only).
3. WHEN traceability is audited THEN every `REQ-NNN` in this file SHALL appear in `tasks.md` (zero misses).
4. WHEN all suites run THEN repo (100% branch/statement on the three new primitives), service (INV-S6 + never-resurrect matrix), journey (J1–J4), and GraphQL integration/pin suites SHALL be green via `bun run test/scripts/run-test.ts`.

---

## 4. UX/Navigation Requirements (No-UI Ruling)

### New Routes & Role-Based Access

| Route | Purpose | Permission | Roles with Access | Status |
|-------|---------|------------|-------------------|--------|
| — (none) | This ticket ships no UI surface | — | — | Explicit no-UI ruling (REQ-020) |

### Sidebar/Navigation & Per-Audience Impact

| Audience | What changes for them | Where |
|----------|----------------------|------|
| Teacher | Nothing visible; availability card behaves identically (restore now honors their intent instead of resurrecting) | `frontend/views/teachers/dashboard/TeacherAvailabilityCard.tsx:62` (consumed, unchanged) |
| Student | Nothing yet — the directory that would consume the truthful flag is Dev 3 | future `TICKETS.md:1509` |
| Admin | Nothing visible; governance cancel silently stops stranding teachers | `app/(dashboard)/admin/*` (unchanged) |
| Parent | No interaction | — |

### Permission Mapping (unchanged, verified)

| Surface | Scope | Evidence |
|----------|-------|----------|
| `myTeacherAvailability` query | teacher-only | `backend/graphql/query/teachers/teacher-availability.query.ts:54-59` |
| `setTeacherAvailability(isOnline: Boolean!)` mutation | teacher-only | `backend/graphql/mutation/teachers/teacher-availability.mutation.ts:64-69` |
| Session lifecycle mutations (start/complete/cancel) | teacher/student participant scopes | `backend/graphql/mutation/classes/session-lifecycle.mutation.ts:156-370` (consumed, unchanged) |
| Admin governance cancel | admin role gates in `SessionAdminGovernanceService` | `backend/services/classes/session-admin-governance.ts:325-332` (consumed, unchanged) |

---

## 5. Cross-Actor Workflow Scenarios (Journeys)

Four journeys, one `test/workflows/sessions/in-session-lock-release.journey.test.ts` file, written test-first (skill rule). Journey layer rules: committed fixtures, tracked cleanup, honest roles, no `runInRollback`, denial assertions via try/catch + translated substrings (`test/workflows/AGENTS.md:8-39`).

### Actor Table

| Actor | Role | Can Do | Cannot Do |
|-------|------|--------|-----------|
| Student | `student` | book a session (`createSession`), cancel own session, observe own session state | start/complete a session; read `teacher.is_online` (no surface); toggle teacher availability |
| Teacher | `teacher` | start a session (applies lock), complete a session (releases per marker), toggle own availability Unavailable mid-session, toggle Available when not in-session | toggle Available while a `started` session exists (INV-A2 denial); toggle another teacher's availability |
| Admin | `admin` | cancel/reschedule/reassign sessions via governance (cancel now releases the lock) | bypass the marker semantics (restore is intent-driven, not admin-chosen) |
| Future Directory (Dev 3, observer) | — | filter on `is_online=true` composed with the session-state oracle | rely on `is_online` alone (forbidden by forward contract) |

### Ordered Step Lists

**J1 — happy restore:** 1. Student books → session `scheduled`, teacher still `is_online=true`. 2. Teacher starts → `started`, `is_online=false`, marker captured (`=true`). 3. Teacher attempts Available toggle → denied `TEACHER_IN_ACTIVE_SESSION` (oracle-safe). 4. Teacher completes → `completed`, `is_online=true`, marker `NULL`.
**J2 — never-resurrect:** 1. Teacher toggles Unavailable (`is_online=false`). 2. Teacher starts booked session → marker captured `=false`. 3. (Variant B: teacher was Available at start, toggles Unavailable mid-session → marker overwritten `false`.) 4. Teacher completes → `is_online=false` (stays Unavailable), marker `NULL`.
**J3 — admin cancel:** 1. Teacher starts → locked. 2. Admin governance-cancels → `cancelled`, release composed in-tx → restore per marker. 3. Variant: admin cancels a never-started `scheduled` row → availability untouched.
**J4 — concurrency:** 1. Two students book; teacher starts both (booking has no availability gate — verified `session-lifecycle.booking.ts:245-261`). 2. Teacher completes session A → guard defers, `is_online=false`. 3. Teacher completes session B → restore per original marker, marker `NULL`.

### Cross-Actor EARS (observer-perspective)

1. WHEN the teacher starts the student's booked session THEN the system SHALL set `is_online=false` AND the teacher SHALL observe the existing in-session lock hint on any Available-toggle attempt (`TeacherAvailabilityCard` consumed unchanged).
2. WHEN the teacher completes or an admin cancels the started session THEN the system SHALL restore availability per the persisted pre-lock intent in the same transaction AND the teacher SHALL observe the restored state on the next `myTeacherAvailability` read.
3. IF the teacher deliberately toggled Unavailable before or during the session THEN the system SHALL keep them Unavailable after conclusion AND no future directory consumer SHALL see them.
4. IF the teacher still holds another `started` session THEN the system SHALL defer the restore AND the teacher SHALL remain hidden from any `is_online=true` consumer.

---

## 6. Non-Functional Requirements (summary)

- **Performance:** one-statement writers (REQ-022.1); no new indexes required (all writes are PK-keyed on `teacher.id`; the release's `NOT EXISTS` probe rides the existing `session` teacher/status filtering — verify via `EXPLAIN` in the repo test task, ledger a pointer if a partial index is ever needed).
- **Reliability:** fail-closed zero-row handling at acquire and release (REQ-003.2, REQ-006.4); no partial commits (single-transaction composition everywhere).
- **Compatibility:** zero GraphQL schema change (REQ-012); existing denials keep codes/messages; `TeacherAvailabilitySnapshotContract` consumers unaffected (the contract's `isOnline` field keeps its meaning — `backend/types/contracts/teacher-availability.contract.types.ts:27-41`).
- **Security:** tenancy-by-construction (REQ-021); no new exposed functions.

## 7. Constraints & Assumptions

**Constraints:** Bun runtime + Drizzle + Pothos layering (root `AGENTS.md`); repo policy `bun run db push` for schema, `migrate` only for custom SQL; no `console.*` (use `@/backend/lib/logger`); deep imports only; types live in `backend/types/` (no service-layer `.types.ts`); tests via `run-test.ts` wrapper; DB tests `runInRollback` + `tx` everywhere; journeys committed-fixtures only.
**Assumptions:** (a) The `:1298` sweep will honor its own composition AC (`TICKETS.md:1322-1324`) and own app-open detection; (b) Dev 3 will build the directory read-side against the documented forward contract; (c) `users.last_active_at` remains login-stamped until `:1298` changes it — this ticket does not read it (rejecting the alternative: gating the restore on `last_active_at` freshness would misclassify hours-active teachers as inactive, since the column is login-only — `auth.service.ts:514-516`).
**Standard criteria:** Feature 6 (outcome knowledge base + progress tracking) is REQ-001; it is non-negotiable across all tasks.

## 8. Success Criteria

- INV-A2/INV-S6 re-locked green; INV-A4 never-resurrect implemented and journey-proven (J2); admin-cancel leak closed (J3); concurrent guard proven (J4); zero schema/API/UI drift beyond the one column; docs truthful; quality gates + traceability audits pass.

## 9. Glossary

| Term | Definition |
|------|------------|
| In-session lock | `teacher.is_online = false` while a session the teacher owns is `started`, applied atomically with the `scheduled → started` transition |
| Marker | `teacher.was_online_before_lock` — nullable boolean persisting the pre-lock availability intent; `NULL` = no lock held |
| Release | The marker-gated restore composed on terminal session exits (`completed`/`cancelled`) |
| Never-resurrect | INV-A4 rule: conclusion restores the persisted intent; a deliberately-offline teacher is never flipped to Available |
| Oracle | `assertTeacherNotInActiveSession` (`session-lifecycle.enforcement.ts:200-214`) — the canonical "is this teacher in a session?" probe; denials disclose no session id |
| Accept-moment | This ticket's ruling: the teacher's accept ≙ `startSession` (no request/accept intake exists in the shipped model) |

---

**Requirements review checklist (self-verification):** all user roles addressed (teacher/student/admin + future Dev-3 consumer) · normal/edge/error covered (incl. concurrency, pollution, leak) · EARS used consistently · journeys captured with actor table + ordered steps + observer EARS · UX/nav section present (explicit no-UI ruling) · traceable REQ-001..REQ-023 · no conflicting requirements.
