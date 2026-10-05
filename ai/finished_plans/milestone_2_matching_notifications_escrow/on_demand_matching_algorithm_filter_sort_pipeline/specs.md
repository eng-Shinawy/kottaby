# Requirements & Specification: On-Demand Matching Algorithm (Filter/Sort Pipeline)

> **Plan directory (verbatim — every header, ledger path, task `0.1`, and self-reference in this document uses this exact string):** `ai/plans/milestone_2_matching_notifications_escrow/on_demand_matching_algorithm_filter_sort_pipeline`
> **Ticket:** `On-Demand Matching Algorithm (Filter/Sort Pipeline)` — Owner Dev 3, Milestone 2, 8 SP, blocked by `Teacher Availability Toggle (Available/Unavailable)` and `Session Creation & Lifecycle (Scheduled → Started → Completed/Cancelled)` (`docs/planning/TICKETS.md:1457-1505`; decision refs B.10 on-demand model, A.6 teacher.subjects, FR-4.4).
> **Grounding docs:** `docs/specs/functional-requirements.md` §4 **FR-4.4** Matching Algorithm table (`:148-155`) + FR-4.1 (`:135-138`) + FR-4.3 (`:144-146`) + FR-8.2 rating ranking (`:238-240`) · `docs/workflows/02-on-demand-matching-workflow.md` §3 pipeline (`:30-43`) + §4 sequence (`:49-76`) + §5 presence table (`:83-87`) + §6 criteria (`:101-125`) · `docs/specs/state-machine-invariants.md` INV-S6 (`:47`) + INV-A3 (`:122`) + read-side ownership note (`:12`) · `docs/specs/open-decisions-and-gaps.md` A.6 (`:41-46`) + B.10 (`:129-133`) + A.10 (`:65-69`) + C.5 (`:211-215`) · `docs/teachers/teacher-availability.md` §6.1 forward contract (`:287-297`) · `docs/backend/cross-stream-contracts.md` `TeacherAvailabilitySnapshotContract` row (`:12`), no-`inSession`-flag rule (`:56`), TOCTOU rule (`:117-119`) · `docs/teachers/teacher-average-rating.md` single-writer + read-only ranking contract (`:26`, `:50`, `:88-94`) · `docs/sessions/session-lifecycle.md` teacher-target oracle ruling (`:167`) + D3 directory wiring (`:171-173`) · `docs/planning/MILESTONE_PLAN.md` M2 backlog row (`:183`), DoD (`:206`), risks (`:244-245`).
>
> **⚠️ Load-bearing scope reconciliation (READ FIRST — shapes every section below).** The ticket's prose says "students browse available teachers", but the student-facing **browse API + UI is the sibling ticket** `Teacher Directory Browse & Filter API` (`docs/planning/TICKETS.md:1509-1549`), which is **Blocked By this ticket**. This ticket therefore ships **the algorithm itself — the canonical on-demand matching pipeline as a service-level read surface**: the two storage columns the pipeline needs, fail-closed parsers, canonical types, one repository read primitive, one canonical `TeacherMatchingService`, the INV-A3 read-side eligibility predicate, the canonical empty-state copy, and full 4-tier + journey test locks. **ZERO GraphQL root fields, ZERO SDL/codegen changes, ZERO frontend files, ZERO routes/nav changes, ZERO `public-operations.ts` changes ship here** — the sibling wraps this service with the paginated query, teacher-profile projection, and student UI. `docs/specs/state-machine-invariants.md:12` records that "the read-side directory filter consuming INV-S6 remains owned by the directory/alternatives surfaces", and `docs/teachers/teacher-availability.md:293-295` names THIS ticket as an INV-A3 owner — the service-level eligibility predicate below is that ownership, honored.
>
> **Two storage gaps this ticket MUST close (verified against the tree):**
> - **Qira'ah (Priority 1) has no matcher-readable home.** Post-C.5 the `recitation` table is session-linked 1:1 (`backend/db/schema/classes/recitation.ts:15-30` — `session_id` NOT NULL UNIQUE); the workflow doc's "`recitation` table linked to `users`" (`docs/workflows/02-on-demand-matching-workflow.md:106`) and FR-1.3's 1:M phrasing (`:20-23`) are STALE. A teacher's recitation certification exists NOWHERE (`teacher_verification` carries only `tajweed_level`/`hifz_level`, `backend/db/schema/teachers/teacher-verification.ts:19-20`). **Ruling:** the student's Qira'ah is a **per-browse input** (recitation is a session-scoped choice per A.10/C.5 semantics; `preferredRecitation` is explicitly non-persisted contract metadata — `backend/types/users/registration.types.ts:56-64`, `docs/auth/qiraah-selection-and-c5.md:501-531`), and the teacher's certified recitations get a **new `teacher.recitations` JSON-in-varchar column** mirroring the resolved A.6 `teacher.subjects` precedent (`backend/db/schema/teachers/teacher.ts:29`).
> - **Language (Priority 4) has no teacher-side home.** `students.primary_language`/`another_language` are student-side only (`backend/db/schema/students/students.ts:29-30`); `users.locale` is a UI-copy preference (`backend/db/schema/users/users.ts:31-36`). **Ruling:** a **new `teacher.languages` JSON-in-varchar column**, same A.6 pattern; the student side resolves from the caller's own profile rows.
>
> **This ticket therefore ships exactly the slice it owns** against the ZERO-DRIFT baseline (no student-facing matching code exists anywhere in the tree — verified: no matching service, no `availableTeachers`-style root field, no browse document; only the admin-gated `AdminTeacherDirectoryService`/`adminTeachers` and the Dev2→Dev3 contract type exist).

---

## 1. Executive Summary & Problem Statement

### 1.1 Feature Summary

The canonical on-demand matching algorithm: a student-scoped, five-priority filter/sort pipeline (`TeacherMatchingService.browseAvailableTeachers`) that returns the teachers eligible for an instant session — hard-filtered by Qira'ah certification and subject availability, hard-filtered by language fluency for non-Arabic speakers, country-prioritized with fallback, and rating-ranked — over the eligibility baseline `is_online = true AND is_approved = true`, with in-session teachers excluded by a bulk session-state predicate that is parity-identical to the canonical per-teacher oracle.

### 1.2 Problem from user perspective

- **Student (actor):** the platform's on-demand premise (B.10 — "students browse and request", `docs/specs/open-decisions-and-gaps.md:129-133`) requires a discovery surface that shows only teachers who can actually take an instant session RIGHT NOW; today no such read exists anywhere in the tree, and the workflow's step "Browse Available Teachers → apply five priorities → return sorted list" (`docs/workflows/02-on-demand-matching-workflow.md:56-62`) has no implementor.
- **Teacher (actor):** his availability truthfulness (INV-A1/INV-A2, shipped by the availability toggle) and his in-session lock (INV-S6, shipped by the session lifecycle) are currently INVISIBLE to any student — there is no read-side consumer, so the promise "Available teachers appear in the Available Teachers directory" (FR-4.1, `docs/specs/functional-requirements.md:138`) is unkept.
- **Sibling Dev-3 tickets:** `Teacher Directory Browse & Filter API` (`docs/planning/TICKETS.md:1509`) is Blocked By this ticket and needs ONE canonical, paginated, filter-correct service to wrap; `Session Request Notification to Teacher` (`:1601`) needs the directory's selected `teacherId` to be a teacher the matching layer vouches for.
- **INV-A3 (observer outcome):** "a teacher in In-Session state is hidden from the Available Teachers directory for all other students" (`docs/specs/state-machine-invariants.md:122`) — this ticket is the first read-side enforcement of it, at the service tier.

### 1.3 Business value

FR-4.4 is a Milestone-2 launch-gate requirement: the matching pipeline is the engine behind the release-gate journey "a student can browse available teachers, request a session, and complete the dual-confirmation escrow flow" (`docs/planning/ROADMAP.md:77`). `MILESTONE_PLAN.md:194` names this ticket Dev 3's top priority; its DoD rows "Matching algorithm filters by Qira'ah, subject, country, language, and sorts by rating" (`:206`) are discharged by this spec, while "Students can browse the teacher directory with filters" (`:207`) is the sibling's.

### 1.4 Actors involved

Student (the browsing caller; sole authorized subject) · Teacher (availability owner whose `is_online`/`is_approved`/`subjects`/`recitations`/`languages`/`average_rating` are read) · System (`SessionLifecycleService` — the INV-S6 lock/release writer; consume-only here) · Teacher/Parent/Admin users (denied actors — no `students` row ⇒ caller-miss denial) · Sibling Dev-3 tickets (read-side consumers of the service, page envelope, and canonical copy — not built here).

### 1.5 Non-goals (explicitly OUT of scope)

- NO GraphQL root field, SDL type, resolver, document, or codegen change — the student-facing `availableTeachers`-style query, its `authScopes`, and its teacher-profile projection belong to the sibling `Teacher Directory Browse & Filter API` ticket (`docs/planning/TICKETS.md:1509-1549`). `git diff backend/graphql/** frontend/graphql/**` MUST be empty.
- NO frontend file, route, nav item, sidebar entry, or bottom-nav change — the student browse UI is the sibling's; this plan's §3 UX ruling is an explicit **no-UI ruling with a forward contract**.
- NO change to the frozen public-operation allowlist (`backend/lib/gateway/public-operations.ts:36-46`) — matching is student-authenticated.
- NO production write path for the two new teacher columns (`teacher.recitations`, `teacher.languages`) — data population stays with tests/seeds/admin ops until a certification/profile surface lands (candidate owner: `Cold-Start Bootstrapping (Direct Sheikh Certification)`, `docs/planning/TICKETS.md:2314`); recorded as resolved-pointer deferrals, never open debt.
- NO change to `SessionLifecycleService`, `assertTeacherNotInActiveSession`, `TeacherRepository.setOnline`, `releaseTeacherInSessionLock`, or any session state transition — INV-A4 never-resurrect release gating stays with the In-Session Locking sibling (`:1338`); the 15-minute auto-offline sweep stays with its own sibling (`:1298`).
- NO session-request/accept/decline mechanics, no balance check at browse time (balance is verified at request time — resolved decision, `docs/workflows/02-on-demand-matching-workflow.md:150`), no notifications (browse is a pure read; the notification wave is `:1601`).
- NO second rating writer — `teacher.average_rating` is consumed READ-ONLY per the single-writer discipline (`docs/teachers/teacher-average-rating.md:26`, ranking contract `:88-94`).
- NO recitation-table change — the session-linked `recitation` table (`backend/db/schema/classes/recitation.ts`) is untouched; teacher-side certification lives on the new `teacher` columns.

---

## 2. Requirements & Acceptance Criteria (EARS Format)

### 2.1 Baseline & Foundational Preparation (MANDATORY)

- **REQ-001 (Pre-Implementation Baseline & Ledger):** WHEN implementation begins THEN the executing agent SHALL record baseline error counts and SHALL initialize the tracking artifacts.
  - **REQ-001.1:** SHALL record `bun tsgo` error count, `bun biome:check` warning count, `bun run scripts/lint-service.ts --json --id baseline` output, and `bun run check:unused` exit status into `/tmp/baseline-*.txt` files BEFORE any edit.
  - **REQ-001.2:** SHALL confirm the ledger `ai/plans/milestone_2_matching_notifications_escrow/on_demand_matching_algorithm_filter_sort_pipeline/deferred-items.md` exists (seeded from `.agents/spec-process-guide/templates/deferred-items-template.md`) and is kept current.
  - **REQ-001.3:** SHALL write `ai/plans/milestone_2_matching_notifications_escrow/on_demand_matching_algorithm_filter_sort_pipeline/outcome/0.1-baseline-outcome.md`.
  - **REQ-001.4:** Every forward item (GraphQL query, UI, write path, INV-A4 gating, auto-offline) SHALL be recorded as a resolved-pointer ledger entry naming its owning ticket — never open ❌/⚠️ debt at the final gate.
- **REQ-002 (i18n & Enum Value-Import Compliance):**
  - **REQ-002.1 (Service i18n):** the service SHALL resolve error copy via `getServerTranslations(locale)` from `@/shared/locale/server-graphql` — ONE argument returning the full `Translations` tree, then property access `.errorsTranslations` (VERIFIED signature, `shared/locale/server-graphql.ts:3-5`; `getTranslations(locale)` at `shared/locale/server.ts:15-17` is likewise one-arg). Two-arg forms do not exist and MUST NOT be written.
  - **REQ-002.2 (Namespace wiring):** the new `teacherDirectory` namespace SHALL follow the verified 6-step registration recipe (`shared/AGENTS.md:201-216`): `*Labels` interface in `shared/locale/types/teacherDirectory/labels.ts`, en/ar leaf implementations (`teacherDirectoryEn` / `teacherDirectoryAr`) exported through their per-namespace directory barrels (`types/`, `en/`, `ar/`, `namespaces/` each carry an `index.ts` — verified: every existing namespace dir has one, e.g. `shared/locale/types/availability/index.ts`), `defineNamespace` handle in `shared/locale/namespaces/teacherDirectory/teacherDirectory.namespace.ts` (reached via `shared/locale/namespaces/teacherDirectory/index.ts`) + `registry.ts` member + `namespaces/index.ts` re-export, `Translations` member in `shared/locale/types/message.ts`, bundle slices in `shared/locale/en/messages.ts` + `shared/locale/ar/messages.ts`, colocated parity test `shared/locale/teacherDirectory-namespace.parity.test.ts`. The legacy `Translation` enum does NOT exist and MUST NOT be invented (forbidden pattern; current namespaces use `defineNamespace` handles — see `shared/locale/namespaces/availability/availability.namespace.ts:4-7`).
  - **REQ-002.3 (Enum value imports):** WHEN `SessionStatus`, `SessionIntent`, `UserRole`, or `RecitationReading` appear in runtime expressions (patterns, comparisons, Object.values checks) THEN they SHALL be imported as values, never `import type`. `isRecitationReading` is a runtime guard from `@/shared/constants/recitation-reading.enum` (`:81-83`) and SHALL be used for recitation validation.
  - **REQ-002.4 (Logging):** WHEN the service logs THEN it SHALL use `logger` from `@/backend/lib/logger` (never `console.*`), with bounded `logger.logDomainError` for domain denials per the root AGENTS.md discipline (mirrors `backend/services/teachers/teacher-availability.service.ts:115-120`).

### 2.2 Matcher Storage (closes the two verified gaps)

- **REQ-003 (Schema additions — Drizzle push, no custom SQL):** WHEN the matcher storage lands THEN the schema SHALL gain, via `bun run db push` (repo policy: push for schema; `cleanGenerate`/reset disabled):
  - **REQ-003.1:** nullable `teacher.recitations` — `varchar("recitations", { length: 255 })` holding a JSON array of `RecitationReading` values (the teacher's certified recitations), mirroring the A.6 `teacher.subjects` column precedent (`backend/db/schema/teachers/teacher.ts:29`; A.6 at `docs/specs/open-decisions-and-gaps.md:41-46`). Capacity verified: all 10 catalog values serialized fit within 255 chars.
  - **REQ-003.2:** nullable `teacher.languages` — `varchar("languages", { length: 255 })` holding a JSON array of lowercase language tokens the teacher is fluent in (student-facing matching only; `users.locale` remains untouched).
  - **REQ-003.3:** composite index `session_teacher_id_status_idx` on `session(teacher_id, status)` (`backend/db/schema/classes/session.ts:87-91` currently has single-column `session_teacher_id_idx` only) — serves the in-session NOT EXISTS predicate on the hot student browse path; the risk "matching algorithm performance with many teachers → add database indexes" is pre-authorized by `docs/planning/MILESTONE_PLAN.md:244`.
  - **REQ-003.4:** `TeacherSelectType` SHALL pick both columns up automatically via `$inferSelect` (`backend/types/teachers/teacher.types.ts:3`) — no manual select-type edit; `git diff backend/db/migration/**` MUST be empty (push, not migrate).
  - **REQ-003.5:** no CHECK constraint is added on the JSON columns (Postgres cannot validate JSON-in-varchar cheaply); write-path strictness is a forward contract and read-path safety comes from fail-closed parsers (REQ-005).

### 2.3 Canonical Types & Parsers

- **REQ-004 (Canonical matcher types — `backend/types/teachers/teacher-matching.types.ts`):** all matcher types SHALL live in this ONE new file (types-layer rule: service files define no types; `backend/types/AGENTS.md:51-56`):
  - **REQ-004.1:** `TeacherMatchingIntent = Exclude<SessionIntent, SessionIntent.Evaluation>` (session requests use Hifz/Tajweed only — `docs/backend/cross-stream-contracts.md:59`; `SessionIntent` members hifz/tajweed/evaluation at `backend/enum/scheduling/session-intent.enum.ts:6-10`).
  - **REQ-004.2:** `TeacherMatchingSubmitInput { readonly recitation: RecitationReading; readonly intent: TeacherMatchingIntent; readonly page: number | null; readonly pageSize: number | null }` — explicit `null` means "use default"; there is NO `studentId`, NO `teacherId`, NO client-controlled country/language override (BOLA/BOPLA posture, REQ-018).
  - **REQ-004.3:** `TeacherMatchingItemReturnType { readonly id: number; readonly fullName: string; readonly country: string | null; readonly countryCode: string | null; readonly subjects: TeacherSubjectsParsed; readonly recitations: readonly RecitationReading[]; readonly languages: readonly string[]; readonly averageRating: number | null; readonly isOnline: boolean }` — `subjects` consumes the exported contract type `TeacherSubjectsParsed` (`backend/types/contracts/teacher-availability.contract.types.ts:22`); `averageRating` is the parsed float (`number | null`), NOT the raw Drizzle decimal string; email/phone/password hashes and timestamps are FORBIDDEN in the item (student-facing PII rule).
  - **REQ-004.4:** `TeacherMatchingPageReturnType { readonly items: readonly TeacherMatchingItemReturnType[]; readonly total: number; readonly page: number; readonly pageSize: number; readonly pageCount: number }` — mirrors the admin page-envelope shape precedent (`AdminTeacherPage`, `backend/graphql/pothos/admin/admin-teachers.pothos.ts:68-81`).
  - **REQ-004.5:** `TeacherMatchingStudentContext` SHALL extend the contract shape `TeacherMatchingLanguagesInput` (the Pick of `primaryLanguage`/`anotherLanguage`, `backend/types/contracts/teacher-availability.contract.types.ts:25`) adding `countryCode: string | null` + `country: string | null`; to make the contract type consumable it SHALL first be exported in the contract file (additive `export` keyword on the existing type — no shape change; the contracts static-assertion suite pins field shapes, `backend/types/contracts/contracts.static-assertions.test.ts`).
  - **REQ-004.6:** a colocated static-assertion test (`backend/types/teachers/teacher-matching.types.static-assertions.test.ts`, mirroring `teacher-availability.types.static-assertions.test.ts`) SHALL pin the item type's exact field set and assert the absence of PII fields — so the sibling ticket cannot silently widen the projection.
- **REQ-005 (Shared teacher-profile parsers — extraction + extension):** the matcher SHALL reuse ONE canonical parser home instead of duplicating logic:
  - **REQ-005.1:** `parseSubjectsJson(raw: string | null): string[]` and `parseAverageRating(raw: string | null): number | null` SHALL move verbatim from their current file-local home (`backend/services/admin/teacher-directory.mappers.ts:17-30`, `:38-44`) to a new canonical teachers-domain home `backend/services/teachers/teacher-profile.mappers.ts`, and the admin mapper SHALL import them from there (no re-export shim — the admin file keeps `mapTeacherDirectoryRow` and consumes the imports).
  - **REQ-005.2:** new `parseTeacherRecitations(raw: string | null): RecitationReading[]` — JSON-array parse whose members are filtered through `isRecitationReading` (`shared/constants/recitation-reading.enum.ts:81-83`); every non-conforming payload (null, empty, unparseable, non-array root, non-string or non-catalog members) degrades to `[]`.
  - **REQ-005.3:** new `parseTeacherLanguages(raw: string | null): string[]` — same fail-safe shape as `parseSubjectsJson` (string members only), degrade-to-`[]`.
  - **REQ-005.4:** fail-closed DIRECTION (load-bearing): a teacher with a corrupt/empty `recitations` payload is EXCLUDED from any recitation-filtered browse (cannot confirm certification ⇒ do not show); a corrupt `subjects` payload fails the subject token match for the same reason. Parsers degrade the projection only; the SQL token predicate independently fails the row.

### 2.4 The Five-Priority Filter/Sort Pipeline

- **REQ-006 (Eligibility predicate — the INV-A3 read-side baseline):** WHEN the matching read runs THEN the returned set SHALL contain ONLY teacher rows satisfying ALL of:
  - **REQ-006.1:** `teacher.is_online = true` AND `teacher.is_approved = true` (ticket AC; both columns are nullable-default-false booleans — `eq(col, true)` is fail-closed correct: unknown availability is never shown; `backend/db/schema/teachers/teacher.ts:25,28`).
  - **REQ-006.2:** caller-side governance exclusion — `users.is_deleted`, `users.suspended`, `users.is_blocked` each `IS DISTINCT FROM true` (all three are NULLABLE booleans — `backend/db/schema/users/users.ts:37,39,42`; plain `eq(col, false)` would wrongly drop legacy NULL rows).
  - **REQ-006.3:** in-session exclusion — NO row may own a `session` row with `status = 'started'` (bulk `NOT EXISTS` correlated predicate). This predicate SHALL be **oracle-parity** with the canonical per-teacher gate `assertTeacherNotInActiveSession` (`backend/services/classes/session-lifecycle.enforcement.ts:200-214`, which probes `SessionRepository.listForTeacher(teacherId, { status: SessionStatus.Started }, 1, 0, tx)` — `backend/db/repo/classes/session.repository.ts:635-643`): same table, same status value, and a test SHALL cross-check the two on a mixed fixture set (a teacher the oracle rejects is never in the browse result, and vice versa).
  - **REQ-006.4 (the compose rule — forward contract honored):** the read MUST compose `is_online = true` with the session-state check and MUST NOT rely on `is_online` alone (`docs/teachers/teacher-availability.md:297`): a teacher can be `is_online = true` AND in a `started` session during the INV-A4 release-race window, and the matching read still excludes them. The per-teacher oracle is N+1-hostile on a paginated list; the NOT EXISTS bulk predicate is its list-scale equivalent — NOT a re-invented in-session definition.
- **REQ-007 (Priority 1 — Qira'ah hard filter):**
  - WHEN a student browses with `recitation = R` THEN only teachers whose `recitations` JSON array contains the exact token `R` are returned (quoted-token `LIKE` match, REQ-015).
  - WHEN a teacher's recitations payload is empty, corrupt, or lacks `R` THEN the system SHALL exclude that teacher (ticket AC "non-Hafs teachers are excluded").
  - IF `input.recitation` is not a `RecitationReading` catalog member THEN the system SHALL reject with `ValidationError` (localized `errorsTranslations.validation`) — service re-validates even though the future resolver will GraphQL-validate the enum.
- **REQ-008 (Priority 2 — subject/intent hard filter):**
  - WHEN a student browses with `intent = hifz` THEN only teachers whose `subjects` JSON array contains the exact token `"hifz"` are returned; likewise `"tajweed"` (ticket AC "teachers without Hifz subject are excluded"; subject tokens are the session-intent vocabulary — `docs/workflows/02-on-demand-matching-workflow.md:108-111` "Hifz only / Tajweed only / Both", A.6 resolution `:146`).
  - IF `input.intent` is `evaluation` or not an intent member THEN the system SHALL reject with `ValidationError` (evaluation sessions are staff-driven flows, never student browse intents — `docs/backend/cross-stream-contracts.md:59`).

- **REQ-009 (Priority 3 — country priority, soft tiering with fallback — NEVER an exclusion):**
  - WHEN the student's `users.country_code` is non-null THEN teachers whose `users.country_code` equals it sort in tier 0 and all others in tier 1 (ticket AC "teachers in the student's country are prioritized… fallback to others"; `docs/workflows/02-on-demand-matching-workflow.md:113-117`).
  - IF the student has no `country_code` but a legacy free-text `country` THEN tier 0 is `lower(users.country) = lower(student_text)`; IF neither exists THEN every candidate is tier 1 (no teacher is EXCLUDED by country).
  - THEN the country tier SHALL precede rating in the ORDER BY — a same-country teacher with a lower rating sorts BEFORE a foreign teacher with a higher rating (ticket AC 2: "Hafs-certified teachers in Egypt … appear first / … in other countries appear next").
- **REQ-010 (Priority 4 — language hard filter, non-Arabic speakers only):**
  - IF the student's resolved language — `primaryLanguage ?? anotherLanguage` (both from the caller's own `students` row, `backend/db/schema/students/students.ts:29-30`), trimmed + lowercased — is null or an Arabic-baseline token THEN the system SHALL apply NO language filter (Arabic is the shared lingua franca of Quran teaching; the platform default is Arabic-first).
  - WHEN the resolved language is a non-Arabic token THEN only teachers whose `languages` JSON array contains that exact token are returned (ticket AC "only teachers fluent in the student's language are shown"); teachers with empty/absent languages are excluded for such students (fluency unconfirmed ⇒ not shown — fail-closed).
  - IF the normalized token is empty, longer than 50 chars, or contains `"` or `\` THEN the system SHALL reject with `ValidationError` (sanitization before the token ever reaches a LIKE pattern).
- **REQ-011 (Priority 5 — rating sort):**
  - THEN results SHALL sort within each country tier by `teacher.average_rating DESC NULLS LAST`, tiebroken by `id DESC` (deterministic; house tiebreak convention — `backend/db/repo/teachers/teacher.repository.ts:461`).
  - IF a teacher is unrated (`average_rating` null) THEN they SHALL sort after every rated teacher in their tier — "no ratings yet" is honest-null, NOT zero, preserving new-teacher discoverability (the DB CHECK already bounds rated values to 0..5 — `backend/db/schema/teachers/teacher.ts:37`; rating is consumed read-only per `docs/teachers/teacher-average-rating.md:88-94`).
- **REQ-012 (Pagination & page envelope):**
  - WHEN called THEN the service SHALL resolve bounds via the canonical `resolvePageBounds(page, pageSize | undefined, locale)` (`backend/services/admin/user-management.query.helpers.ts:45-62`: page ≥ 1, pageSize 1..100, default 25, out-of-range ⇒ localized `ValidationError`) — explicit `null` inputs restore defaults (`input.page ?? 1`, `input.pageSize ?? undefined`).
  - WHEN a page beyond the last is requested THEN the system SHALL return empty `items` with an honest `total` (admin directory precedent, `backend/services/admin/teacher-directory.service.ts:89-112`).
  - THEN the envelope SHALL be `TeacherMatchingPageReturnType` (REQ-004.4) with `pageCount = Math.ceil(total / pageSize)`.

### 2.5 Empty-Result Contract & Canonical Copy

- **REQ-013 (No teachers available — honest empty page + canonical copy):**
  - WHEN no teacher satisfies all criteria THEN the system SHALL return `total = 0`, `items = []` (an empty page, NOT a `NotFoundError`, NOT a null) — zero matches is a valid browse state (ticket AC 4).
  - THEN the canonical student-facing copy SHALL exist as a new `teacherDirectory` i18n namespace with the key `noTeachersAvailable` — en `"No teachers available"`, ar `"لا يوجد معلمون متاحون"` — (verified: NO such key exists anywhere today; the only teacher empty-state copy is admin-gated `shared/locale/en/adminTeachers/index.ts:56`); the sibling directory ticket's UI renders it. The service returns data only; presentation copy lives in `shared/locale/`.
  - IF the caller's `students` row is missing THEN the system SHALL reject with `NotFoundError("STUDENT", …)` using the existing top-level key `studentHandshakeNotFound` (doc: "caller has no students row → NotFoundError('STUDENT')" — `shared/locale/types/errors/labels.ts:254-255`; usage precedent `backend/services/students/student-handshake.service.ts:85`) — a caller-miss, distinct from an empty browse.

### 2.6 Service & Repository Surface

- **REQ-014 (Canonical service — `backend/services/teachers/teacher-matching.service.ts`):**
  - `TeacherMatchingService.browseAvailableTeachers(studentUserId: number, input: TeacherMatchingSubmitInput, locale: string, tx?: DBQueryExecutor): Promise<TeacherMatchingPageReturnType>` — a namespace of exactly ONE public method (mirrors `TeacherAvailabilityService` shape at `backend/services/teachers/teacher-availability.service.ts:103-125`); pure read ⇒ optional `tx?: DBQueryExecutor`, never `withTransaction`.
  - The caller identity SHALL be the authenticated user id only — the service resolves `users` via `UserRepository.findById(studentUserId, tx)` (`backend/db/repo/users/user.repository.ts:78`) and `students` via `StudentRepository.findById(studentUserId, tx)` (`backend/db/repo/students/student.repository.ts:266`); no id is accepted from the input.
  - WHEN validation fails THEN the service SHALL throw `ValidationError` with localized copy; WHEN the caller has no `students` row THEN `NotFoundError("STUDENT", t.studentHandshakeNotFound)`; happy path is silent except bounded `logger.logDomainError` on denials (REQ-002.4).
- **REQ-015 (Repository read primitive — `TeacherRepository.listMatchingCandidates`):**
  - `listMatchingCandidates(filters: NormalizedTeacherMatchingFilters, limit: number, offset: number, tx?: DBQueryExecutor): Promise<{ rows: TeacherMatchingRowType[]; total: number }>` — added to the EXISTING `backend/db/repo/teachers/teacher.repository.ts` namespace (no new repo file, no new barrel entry; mirrors `listDirectory` at `:432-471` including the joined count sibling query with the same predicate and `count(*)::int`).
  - `NormalizedTeacherMatchingFilters { recitationPattern: string; subjectPattern: string; languagePattern: string | null; studentCountryCode: string | null; studentCountryText: string | null }` and `TeacherMatchingRowType` SHALL be repo-file-local shapes (verbatim precedent: `NormalizedAdminTeacherFilters` `:81-86`, `AdminTeacherDirectoryRow` `:95`).
  - **One-escape-point discipline:** the SERVICE escapes each token via `escapeLikeWildcards` (`backend/lib/db/escape-like-wildcards.ts:37-41`), wraps it in JSON quotes + `%…%`, and the REPO binds the finished pattern with `ilike(column, pattern)` and NEVER re-escapes (verified rule from the admin precedent, `backend/services/admin/teacher-directory.service.ts:66-78`).
  - The row SELECT SHALL join `users` (`innerJoin(users, eq(users.id, teacher.id))` — shared-PK join precedent `:459`) and carry `id, fullName, country, countryCode, subjects, recitations, languages, averageRating, isOnline`.

### 2.7 i18n Namespace

- **REQ-016 (New `teacherDirectory` namespace):** WHEN the empty-state copy lands THEN the system SHALL create the namespace per REQ-002.2 with exactly ONE seed key `noTeachersAvailable` (this ticket's AC-owned copy); the sibling extends it additively. The namespace is consumed by the translation system itself (bundle wiring), so no UI consumer is required for it to be live; en/ar parity is enforced by the colocated parity test.

### 2.8 Cross-Actor Journey, Security, Testing & Closure

- **REQ-017 (Cross-actor journey — directory visibility lifecycle):** the feature spans 3 actors over shared state (teacher availability ↔ student directory visibility ↔ system session lifecycle), so the requirements in §4 SHALL be locked by ONE journey test `test/workflows/teachers/on-demand-matching.journey.test.ts` written TEST-FIRST (before the service surface exists), per `test/workflows/AGENTS.md` (committed fixtures in one committing `beforeAll`, tracked `afterAll` hard-delete + zero-residue re-probes, honest roles via `provisionStudentActor`/`provisionCertifiedTeacherActor` — `test/workflows/helpers/actor-context.ts:88,105`, NO `runInRollback`, never `.rejects.toThrow()`).
- **REQ-018 (Security & tenancy):**
  - **BOLA:** WHEN the browse is invoked THEN the system SHALL accept no client-supplied `studentId`/`teacherId`/ids of any kind (the caller is `ctx.user.id`-scoped by construction), AND IF a teacher/parent user id resolves to no `students` row THEN the system SHALL deny with `NotFoundError("STUDENT")` (honest caller-miss).
  - **BOPLA:** WHEN the normalized filter object is built THEN the service SHALL map field-by-field from validated input, and NO `{ ...input }` spread SHALL reach any query builder.
  - **BFLA:** WHEN the browse is exposed at the API tier (sibling's future resolver) THEN it SHALL be student-role gated (`authScopes: { $all: { authenticated: true, role: [UserRole.Student] } }` — idiom verified at `backend/graphql/mutation/classes/student-evaluation.mutation.ts:66-71`); this ticket's service contract documents student-only callership, and the journey SHALL assert non-student actors are denied.
  - **Injection:** WHEN any token reaches a LIKE pattern THEN it SHALL pass `escapeLikeWildcards` (`%`, `_`, `\` — REQ-015), and recitation/intent tokens SHALL additionally be enum-validated; Tier-4 tests SHALL probe `%`/`_`/`\` payloads.
  - **No public-operations change:** WHEN the slice completes THEN `PUBLIC_OPERATION_NAMES` (`backend/lib/gateway/public-operations.ts:36-46`) SHALL remain byte-identical.
  - **PII:** WHEN an item is projected THEN it SHALL carry NO email, phone, password hash, or timestamps (REQ-004.3/REQ-004.6); teacher existence becomes public WITH the directory per the sanctioned oracle ruling (`docs/sessions/session-lifecycle.md:167`).
- **REQ-019 (4-tier test engineering):**
  - **Repo tests** (extend `backend/db/test/repo/teachers/teacher.repository.test.ts` with a `listMatchingCandidates` suite): `runInRollback` + `tx` to every repo call, `expectRepoError` try/catch (never `.rejects.toThrow()`), data via `createTestUser`/`createTestTeacherRow`/`createTestSession` overrides — never seeds (`backend/db/test/AGENTS.md` Rules 1-3, 15-17; helpers at `backend/db/test/entity-setup.ts:74,303,550`).
  - **Service tests** (`backend/services/teachers/teacher-matching.service.test.ts`): 4 tiers per the availability-suite contract (Tier 1 branch matrix incl. the language-resolution and country-tier Cartesians, Tier 2 boundaries — null/empty/unicode tokens, max-length, unrated teachers, Tier 3 chaos — parallel `Promise.allSettled` browses, Tier 4 security — wildcard probes, invalid enum payloads, non-student callers); messages asserted against `getServerTranslations(locale).errorsTranslations`, never hardcoded English.
  - **Oracle-parity test:** on a fixture set mixing free/in-session/governed/offline/uncertified teachers, the browse exclusion set SHALL equal the set for which `assertTeacherNotInActiveSession` throws (REQ-006.3).
- **REQ-020 (Concurrency & snapshot semantics):**
  - The browse path is READ-ONLY — no locks, no transactions of its own; concurrent browses (`Promise.allSettled`) are safe and Tier-3-verified.
  - Browse results are a POINT-IN-TIME SNAPSHOT: the system SHALL disclose (docblock + plan §4.3) that session creation MUST re-assert `isOnline` + `is_approved` under its `SELECT FOR UPDATE` transaction per the `TeacherAvailabilitySnapshotContract` TOCTOU rule (`backend/types/contracts/teacher-availability.contract.types.ts:8-14`, `docs/backend/cross-stream-contracts.md:117-119`) — that re-assert belongs to the session-request flow, NOT this ticket.
  - No module-level mutable state beyond bounded frozen constants (Arabic token set, lengths).
- **REQ-021 (Knowledge propagation & final gate):**
  - The final task SHALL consolidate learnings into `docs/teachers/on-demand-matching.md` (canonical home: the per-surface docs discipline already used by `docs/teachers/teacher-availability.md` and `teacher-average-rating.md`) — AGENTS.md / `.agents/instructions/**` are NEVER edited from plan work.
  - The ledger gate SHALL pass: `grep -cE '^\s*\|.*(❌|⚠️)' deferred-items.md` = 0, with every forward item a resolved-pointer entry naming its owning ticket.

---

## 3. UX/Navigation Requirements (MANDATORY — Explicit No-UI Ruling)

### 3.1 New Routes & Role-Based Access

| Route | Purpose | Permission | Roles with Access | Shipped by THIS ticket |
|-------|---------|------------|-------------------|----------------------|
| (none) | Student browse surface | — | — | **NO** — route + UI owned by sibling `Teacher Directory Browse & Filter API` (`docs/planning/TICKETS.md:1509`) |

**Ruling:** this ticket ships a backend service surface ONLY. Zero files under `app/`, `frontend/`, zero nav items (`frontend/views/dashboard/nav/navItems.ts:129-142` student list untouched), zero sidebar/bottom-nav changes. The student's future browse route (sibling's design decision) will render the `TeacherMatchingPageReturnType` envelope and the `teacherDirectory.noTeachersAvailable` empty state shipped here.

### 3.2 Forwardconsumed UX contract (for the sibling ticket)

| Surface (sibling-owned) | Consumes from THIS ticket |
|---|---|
| Student "Available Teachers" page (route TBD by sibling) | `TeacherMatchingService.browseAvailableTeachers` — page envelope, per-item projection (REQ-004.3), ordering guarantees (REQ-009/011) |
| Empty state | `teacherDirectory.noTeachersAvailable` (REQ-013) |
| Session-request CTA per teacher card | the item's `id` feeds `SessionSubmitInput { teacherId, intent }` (`backend/types/classes/session.types.ts:39-42`) — booking-side TOCTOU re-assert stays in the session-request flow |

---

## 4. Cross-Actor Workflow Scenarios (Journeys)

The shared state is the teacher's availability triple (`teacher.is_online`, `teacher.is_approved`, the teacher's live `started` session). Three actors interact over it; the STUDENT is the observer whose visibility changes. This journey maps 1:1 onto `test/workflows/teachers/on-demand-matching.journey.test.ts` (REQ-017).

### 4.1 Actor Table

| Actor | Role | Can Do | Cannot Do |
|-------|------|--------|-----------|
| Student | `student` | browse eligible teachers (specify recitation + intent); observe visibility changes | see ineligible teachers; browse as teacher/parent (no `students` row ⇒ STUDENT_NOT_FOUND) |
| Teacher | `teacher` | toggle own availability (`TeacherAvailabilityService.setAvailability`); hold a started session | appear in the directory while offline, uncertified, in-session, or governed; see governance flags of others |
| System (session lifecycle) | — | start/complete sessions; apply + release the INV-S6 `is_online` lock (`session-lifecycle.service.ts:283`, `session-lifecycle.transitions.ts:249-257`) | be bypassed — the matching read composes its own session-state predicate regardless of flag races |
| Admin/Parent/other | `admin`/`parent` | (own surfaces) | call the browse as a student (caller-miss denial) |

### 4.2 Ordered Step List (per journey, `actor → action → expected shared-state change + side effects`)

1. System → provision cast (committed `beforeAll`): student (EG, Arabic baseline), teachers T1 (Hafs, hifz, EG, rated 4.50), T2 (Hafs, hifz, EG, unrated), T3 (Hafs, hifz, MA, rated 5.00), T4 (Warsh-only), T5 (tajweed-only), T6 (uncertified, online), T7 (certified, offline), T8 (Hafs/hifz/EG but in a `started` session), T9 (governed user) → no shared-state change yet; fixtures tracked for hard-delete.
2. Student → browse (Hafs, hifz) → **observes exactly [T1, T2, T3] in that order** (country tier before rating: T1 rated-4.5-EG before T3 rated-5.0-MA; unrated T2 after T1, before T3 by tier) AND T4-T9 absent — no writes, no notifications.
3. Teacher T1 → toggle Unavailable (`setAvailability`) → `T1.is_online = false` → Student's next browse excludes T1.
4. Teacher T1 → toggle Available → `T1.is_online = true` → Student's next browse includes T1 again.
5. System → T2 enters a `started` session (`SessionLifecycleService.startSession`) → INV-S6 lock sets `T2.is_online = false` → Student's next browse excludes T2; the per-teacher oracle `assertTeacherNotInActiveSession(T2)` throws (parity anchor).
6. System → the session completes (`completeSession`) → `releaseTeacherInSessionLock` restores `T2.is_online = true` → Student's next browse includes T2 again. **Verified shipped side effects the journey MUST honor:** the completion transaction also inserts a student confirm-prompt notification row via `SessionRequestNotificationService.notifyStudentOfCompletionPrompt` and publishes its delivery receipt via `NotificationEngine.publishReceipts` after commit (`backend/services/classes/session-lifecycle.service.ts:402-418`) — the journey spies `NotificationEngine.publishReceipts` (precedent: `spyPublication` at `test/workflows/sessions/session-lifecycle.journey.test.ts:238-244`), asserts the receipt targets the session's student, and registers the notification row in the fixture registry for tracked teardown (`test/workflows/AGENTS.md` Rules 2 + 5).
7. Student → browse with a recitation/intent combination no teacher satisfies → `total = 0`, `items = []`, NO error (empty state; canonical copy key exists).
8. Non-Arabic student (primaryLanguage `"french"`) → browse → only teachers with `"french"` in `languages` are visible; the Arabic-baseline student still sees all eligible teachers.
9. Teacher actor (a teacher user) → attempts browse → `NotFoundError("STUDENT")` (caller-miss denial; honest role, no monkey-patching).

### 4.3 Cross-Actor EARS Criteria (observer perspective)

- WHEN a certified teacher toggles Available THEN the system SHALL surface him in every eligible student's browse result AND WHEN he toggles Unavailable THEN the system SHALL remove him from every student's result.
- WHEN a teacher's session transitions to `started` THEN the system SHALL hide him from all students' browse results (INV-A3) AND the hiding SHALL hold even if `is_online` is stale-true (compose rule).
- WHEN the session concludes and the lock releases THEN the system SHALL surface the teacher again for as long as he remains `is_online = true`.
- WHEN a student browses THEN the system SHALL order same-country teachers before foreign teachers AND, within each tier, rated teachers before unrated teachers.
- IF the browsing actor has no `students` row (teacher/parent/admin user) THEN the system SHALL deny with `NotFoundError("STUDENT")` and disclose nothing.
- WHEN any browse runs THEN the system SHALL emit zero notifications and zero writes (pure read; snapshot only — session-request flows MUST re-assert availability under lock per the contract TOCTOU rule).

---

## 5. Non-Functional Requirements

### 5.1 Performance

- WHEN the student browse runs THEN the in-session exclusion SHALL be index-served (`session_teacher_id_status_idx`, REQ-003.3) and the page SHALL require exactly TWO sibling queries (rows + count, `Promise.all` — the `listDirectory` precedent `backend/db/repo/teachers/teacher.repository.ts:455-469`), never per-teacher probes.
- WHEN the teacher table is large THEN the pipeline SHALL stay single-query-per-page (no in-memory re-filtering after pagination — filters live in SQL so page sizes stay honest).

### 5.2 Security

- See REQ-018. WHEN any token reaches SQL THEN it SHALL be enum-validated or sanitized + escaped (defense in depth: enum members cannot contain wildcards; free-text tokens are length- and character-gated BEFORE escaping).

### 5.3 Reliability

- WHEN a teacher row carries corrupt JSON in `subjects`/`recitations`/`languages` THEN the browse SHALL degrade that teacher's eligibility/projection (fail-closed) and NEVER fail the whole page read (parser degrade-to-`[]` discipline, REQ-005.4).

---

## 6. Constraints and Assumptions

### 6.1 Technical Constraints

- Bun runtime; Drizzle + PostgreSQL; schema via `bun run db push` (reset/cleanGenerate disabled by policy); Pothos/SDL untouched in this slice.
- All filters MUST be applied in SQL (paginated correctness); JSON-in-varchar token matching uses quoted-token `LIKE` (`ilike`) with escaped tokens — precise for JSON arrays because the surrounding quotes anchor the token boundary (`"hifz"` never matches `"hifz_jadid"`).
- The two new columns reuse the verified A.6 varchar(255) JSON-array pattern (NO junction tables — none exist in the schema; NO new pgEnums — `RecitationReading` is already the shared catalog, `shared/constants/recitation-reading.enum.ts:37-58`).

### 6.2 Business Constraints

- Priorities are FIXED by FR-4.4 (`docs/specs/functional-requirements.md:148-155`): Qira'ah and subject are HARD filters; country is a SOFT tier with fallback; language is a HARD filter only for non-Arabic speakers; rating is the ONLY sort key.
- Country tier precedes rating (Egypt AC). Balance checks do NOT run at browse time (resolved decision, `docs/workflows/02-on-demand-matching-workflow.md:150`).

### 6.3 Assumptions

- Legacy rows may carry `users.country` text without `country_code` (documented at `backend/db/schema/users/users.ts:24-28`) — hence the code-first/text-fallback tier rule (REQ-009).
- `students.primary_language`/`another_language` are free text with no production writer today (tests only) — the normalization rule (trim+lowercase, Arabic baseline) tolerates that.
- Teacher-side data for the new columns is test/seed-provided until the write-path owner lands (deferred resolved-pointer; candidate `Cold-Start Bootstrapping (Direct Sheikh Certification)`, `docs/planning/TICKETS.md:2314`).

---

## 7. Success Criteria

### 7.1 Definition of Done

- [ ] Every REQ-001…REQ-021 acceptance criterion is met and locked by a passing test (journey + 4-tier suites).
- [ ] All seven ticket test scenarios covered: all filters applied; country priority with fallback; rating sort descending; empty result; in-session excluded; non-certified excluded; unavailable excluded (map: REQ-006/007/008/009/010/011/013 + §4.2 steps 2-8).
- [ ] `bun quality-gate` green; per-file `sub-loop.ts --lifecycle duplicates` exit 0 on every touched file; ledger gate zero ❌/⚠️.
- [ ] `git diff` proves the no-GraphQL/no-frontend/no-public-operations ruling (§1.5) held.

### 7.2 Acceptance Metrics

- 100% branch coverage on `TeacherMatchingService.browseAvailableTeachers`, the filter builder, and all four parsers; oracle-parity assertion green; en/ar parity test green; zero new tsgo/biome/lint errors vs baseline.

---

## 8. Glossary

| Term | Definition |
|------|------------|
| On-Demand Matching | P2P non-dedicated discovery — students browse available teachers per session instead of fixed assignments (B.10; `docs/domain/GLOSSARY.md:70`) |
| Qira'ah / Recitation | The recitation reading style (e.g. Hafs 'an 'Asim); the 10-value catalog is `RecitationReading` (`docs/domain/GLOSSARY.md:30`; `shared/constants/recitation-reading.enum.ts:37-58`) |
| Intent | The student's session purpose for THIS browse — `hifz` or `tajweed` (A.10; evaluation excluded from student requests) |
| Eligibility predicate | `is_online = true AND is_approved = true AND not governed AND NOT EXISTS started session` — the INV-A3 read-side baseline |
| Country tier | Sort-only grouping: tier 0 = same country as the student, tier 1 = everyone else (never an exclusion) |
| Arabic baseline | A student whose resolved language is absent or Arabic gets NO language filter; non-Arabic students get a hard fluency filter |
| Oracle parity | The bulk NOT EXISTS in-session predicate excludes exactly the teacher set the per-teacher `assertTeacherNotInActiveSession` gate rejects |
| Honest null | `average_rating = null` means "unrated" — sorts last within a tier, never as zero |
| Fail-closed | Unverifiable data (corrupt/empty certification or fluency payloads) excludes the teacher rather than surfacing them |

---

## 9. Requirements Review Checklist

- [x] All user roles identified (student caller; teacher as read subject; system lifecycle; non-student denials)
- [x] Normal, edge, and error cases covered (empty result, corrupt payloads, invalid enum inputs, out-of-range pages, non-student callers)
- [x] EARS format used consistently; every criterion testable
- [x] Cross-actor journey captured (§4: actor table + ordered steps + observer-perspective EARS) — 3 actors over shared availability state
- [x] UX/Navigation ruled explicitly (§3 no-UI ruling + forward-consumed contract)
- [x] No conflicting requirements (hard-vs-soft filter semantics resolved per FR-4.4; compose rule resolved per the availability forward contract)
- [x] Requirements numbered REQ-001…REQ-021; tasks reference them 1:1 (see `tasks.md` Requirement Coverage Index)
