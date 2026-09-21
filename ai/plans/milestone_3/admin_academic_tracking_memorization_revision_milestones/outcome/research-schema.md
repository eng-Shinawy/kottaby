# Research: Schema & Enums — Admin Academic Tracking (Memorization & Revision Milestones)

Scope: the data model only — `home_work`, `reports`, `session`, `progress`, `students`/`users`, the `surah_juz_ref` and lesson-lane pgEnums, grade representation, schema-layer AGENTS.md rules, and whether any "milestone" table exists.

## (a) `home_work` table — Jadid & Madi homework

Real filename: `backend/db/schema/classes/home-work.ts` (TS export `homeWork`, SQL table `home_work`, snake_case two words preserved — `backend/db/schema/classes/home-work.ts:6-24`).

Export signature (`backend/db/schema/classes/home-work.ts:23`):
```ts
export const homeWork = pgTable(
  "home_work",
```

| Column (TS key) | SQL name | Drizzle type | SQL type | Null | Default | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `integer(...).primaryKey().generatedAlwaysAsIdentity()` | integer PK identity | NOT NULL | identity | line 26 |
| `sessionId` | `session_id` | `integer(...).notNull().references(() => session.id, { onDelete: "cascade" })` | integer FK | NOT NULL | — | lines 27-29 |
| `currentFromAyah` | `current_from_ayah` | `integer` | integer | nullable | — | line 30 (Jadid group) |
| `currentToAyah` | `current_to_ayah` | `integer` | integer | nullable | — | line 31 (Jadid) |
| `currentGrade` | `current_grade` | `integer` | integer | nullable | — | line 32 (Jadid) |
| `currentSurahJuz` | `current_surah_juz` | `surahJuzRef(...)` | surah_juz_ref enum | nullable | — | line 33 (Jadid) |
| `revisionFromAyah` | `revision_from_ayah` | `integer` | integer | nullable | — | line 34 (Madi) |
| `revisionToAyah` | `revision_to_ayah` | `integer` | integer | nullable | — | line 35 (Madi) |
| `revisionGrade` | `revision_grade` | `integer` | integer | nullable | — | line 36 (Madi) |
| `revisionSurahJuz` | `revision_surah_juz` | `surahJuzRef(...)` | surah_juz_ref enum | nullable | — | line 37 (Madi) |
| `createdAt` | `created_at` | `timestamp(...).defaultNow().notNull()` | timestamp | NOT NULL | now() | line 38 |
| `updatedAt` | `updated_at` | `timestamp(...).defaultNow().notNull().$onUpdate(() => new Date())` | timestamp | NOT NULL | now() + on update | lines 39-42 |

Constraints/indexes (`backend/db/schema/classes/home-work.ts:44-48`):
- `unique("home_work_session_id_unique").on(t.sessionId)` — one homework row per session (line 45)
- `check("home_work_current_grade_check", sql`>= 0 AND <= 100`)` (line 46)
- `check("home_work_revision_grade_check", sql`>= 0 AND <= 100`)` (line 47)
- `index("home_work_session_id_idx").on(t.sessionId)` (line 48)

Doc header (`backend/db/schema/classes/home-work.ts:6-22`): one row per session; `current_*` = new memorization (Jadid), `revision_*` = revision (Madi); grades are nullable integers in [0,100], CHECK-enforced; assignment rows are created ungraded and graded on a later pass; cascade delete from session.

### Static-assertions test — `report-homework-schema.static-assertions.test.ts`

File: `backend/db/schema/classes/report-homework-schema.static-assertions.test.ts` (130 lines). bun:test over `getTableConfig`/`getColumns` metadata — no database round-trip; the Drizzle table objects are the ground truth (lines 1-25).

Pinned invariants (doc header, lines 7-19, plus test bodies at lines 51-130):
- One report row per session AND one homework row per session: each table carries a named UNIQUE constraint over `session_id`; the DB is the arbiter of duplicate submissions (write path maps 23505 to the domain conflict) — lines 8-11, 51-56, 74-79.
- `reports` exposes NO `teacher_id` column — teacher reached exclusively via `session_id → session.teacher_id` — lines 12-13, 57-67 (`expect(columnKeys(reports)).not.toContain("teacherId")`, line 65).
- `home_work` grade columns (`current_grade`, `revision_grade`) stay nullable — an assignment is created ungraded and graded later — lines 14-16, 80+ ("home_work grade columns remain nullable — assignment happens ungraded", line 80).
- Grade-range CHECKs (0–100) and the report rating CHECK (0–5) remain as the DB backstop behind service-level validation — lines 17-19, 68-70 (`checkNames(reports)` equals `["reports_student_rating_by_teacher_check"]`).
- `reports` column set pinned exactly to `["createdAt","id","sessionId","studentRatingByTeacher","teacherNotes","updatedAt"]` — lines 58-64.

Any schema change to these two tables must keep this test green (or consciously update it).

## (b) `reports` table — session report

File: `backend/db/schema/classes/reports.ts`. The table behind `backend/db/repo/classes/report.repository.ts` (imports `reports` at `backend/db/repo/classes/report.repository.ts:38`; doc header line 2 says "data-access layer for the `reports` table").

Export signature (`backend/db/schema/classes/reports.ts:20`):
```ts
export const reports = pgTable(
  "reports",
```

| Column (TS key) | SQL name | Drizzle type | SQL type | Null | Default | Notes |
|---|---|---|---|---|---|---|
| `id` | `id` | `integer(...).primaryKey().generatedAlwaysAsIdentity()` | integer PK identity | NOT NULL | identity | line 23 |
| `sessionId` | `session_id` | `integer(...).notNull().references(() => session.id, { onDelete: "cascade" })` | integer FK | NOT NULL | — | lines 24-26 |
| `teacherNotes` | `teacher_notes` | `text` | text | nullable | — | line 27 |
| `studentRatingByTeacher` | `student_rating_by_teacher` | `integer` | integer | nullable | — | line 28 |
| `createdAt` | `created_at` | `timestamp(...).defaultNow().notNull()` | timestamp | NOT NULL | now() | line 29 |
| `updatedAt` | `updated_at` | `updated_at` | timestamp + `$onUpdate` | NOT NULL | now() + on update | lines 30-33 |

Constraints (`backend/db/schema/classes/reports.ts:35-42`):
- `unique("reports_session_id_unique").on(t.sessionId)` (line 36)
- `check("reports_student_rating_by_teacher_check", sql`>= 0 AND <= 5`)` (lines 37-40)
- `index("reports_session_id_idx").on(t.sessionId)` (line 41)

**`teacher_id` does NOT exist on `reports`** — explicitly documented at `backend/db/schema/classes/reports.ts:14-16` ("NO `teacher_id` column... Access path: reports → session → teacher → users") and pinned by the static-assertions test (lines 12-13, 65). Ticket C.4's `session.teacher_id` access path is the only valid one.

## (c) `surahJuzRef` pgEnum

Declared at `backend/db/schema/enums.ts:112-139`:
```ts
export const surahJuzRef = pgEnum("surah_juz_ref", [ ... ]);
```
Full member list (35 values — 5 surahs, then 30 juz; exact order, verified via `backend/db/schema/enums.ts:112-139`):
`surah_al_fatihah`, `surah_al_baqarah`, `surah_aal_imran`, `surah_an_nisa`, `surah_al_maidah`, then `juz_1` … `juz_30` (contiguous, no gaps).

TS mirror: `backend/enum/shared/surah-juz-ref.enum.ts` (camelCase members, e.g. `SurahAalImran = "surah_aal_imran"`, `Juz1 = "juz_1"` — verified via file head).

Every table/column referencing `surahJuzRef` (verified by grep over `backend/db/schema/`, only non-test hits):
- `home_work.current_surah_juz` — `backend/db/schema/classes/home-work.ts:33`
- `home_work.revision_surah_juz` — `backend/db/schema/classes/home-work.ts:37`

No other schema table references it. Non-schema consumers: `backend/enum/shared/surah-juz-ref.enum.ts`, `backend/graphql/pothos/shared/enum.pothos.ts`, `backend/graphql/pothos/classes/home-work.pothos.ts`, `backend/services/parents/parent-monitoring.helpers.ts`, `backend/types/classes/report-home-work.types.conformance.test-d.ts`, `backend/db/test/repo/classes/home-work.repository.test.ts` (grep over backend/frontend/shared, this session).

## (d) Lesson-lane enums (hifz / tajweed / reviews)

The pgEnum near `enums.ts:81` is `subscriptionCreditLane` (`backend/db/schema/enums.ts:86`):
```ts
export const subscriptionCreditLane = pgEnum("subscription_credit_lane", ["hifz", "tajweed", "reviews"]);
```
Doc (`backend/db/schema/enums.ts:75-84`): balance lane a subscription plan credits on activation (`plans.balance_lane`); `hifz` and `tajweed` are the two memorization lesson lanes, `reviews` is the revision-session lane. Sole schema usage: `plans.balanceLane` at `backend/db/schema/billing/plans.ts:29` (import at line 3).

Related lane/track representations:
- `sessionIntent` pgEnum at `backend/db/schema/enums.ts:42`: `["hifz", "tajweed", "evaluation"]` — nullable classification on `session.intent` (`backend/db/schema/classes/session.ts:66`).
- `session.heldBalanceLane` — `varchar("held_balance_lane", { length: 20 }).$type<HeldBalanceLane>()`, nullable, permanent refund provenance (`backend/db/schema/classes/session.ts:69`); `HeldBalanceLane` TS type imported from `backend/enum/scheduling/held-balance-lane.enum` (`backend/db/schema/classes/session.ts:5`), doc says values `'trial' | 'hifz' | 'tajweed'` (`backend/db/schema/classes/session.ts:38`).
- `students` balance columns per lane: `balance_hifz`, `balance_reviews`, `balance_tajweed`, `balance_trial` — `backend/db/schema/students/students.ts:24-27`.

## (e) `progress` table (behind progress.repository.ts)

File: `backend/db/schema/classes/progress.ts`; imported by `backend/db/repo/classes/progress.repository.ts` (import confirmed this session; repo doc lines 1-11: "data-access layer for the `progress` table").

Export signature (`backend/db/schema/classes/progress.ts:19`):
```ts
export const progress = pgTable(
  "progress",
```

| Column (TS key) | SQL name | Drizzle type | Null | Default | Notes |
|---|---|---|---|---|---|
| `id` | `id` | `integer(...).primaryKey().generatedAlwaysAsIdentity()` | NOT NULL | identity | line 22 |
| `studentId` | `student_id` | `integer(...).notNull().references(() => students.id, { onDelete: "cascade" })` | NOT NULL | — | lines 23-25 |
| `lessonId` | `lesson_id` | `integer(...).references(() => lessons.id, { onDelete: "set null" })` | nullable | — | line 26 |
| `createdAt` | `created_at` | `timestamp(...).defaultNow().notNull()` | NOT NULL | now() | line 27 |
| `updatedAt` | `updated_at` | `timestamp` + `$onUpdate` | NOT NULL | now() | lines 28-31 |

Indexes (`backend/db/schema/classes/progress.ts:33`): `progress_student_id_idx` on `student_id`; `progress_lesson_id_idx` on `lesson_id`.

Key doc fact (`backend/db/schema/classes/progress.ts:13-14`): **"NO `completed_at` or `score` columns"** — it is a skeleton (student, lesson) pair table. Repo doc adds (`backend/db/repo/classes/progress.repository.ts:4-11`): writers and richer readers are deferred to later curriculum tickets; the parent portal renders a row count from this table plus the latest homework position per track via `HomeWorkRepository.findLatestByStudentId`. So there is NO numeric progress percentage / score anywhere in the schema today.

`lessons` table (referenced by `progress.lesson_id`) — `backend/db/schema/classes/lessons.ts:16-29`: `id` (PK identity), `plan_id` (FK plans.id, set null), `title` varchar(255) nullable, timestamps; index `lessons_plan_id_idx`. No surah/juz/ayah columns on lessons.

## (f) `session` table — homework→session→student→teacher link

File: `backend/db/schema/classes/session.ts`. Export signature (line 54): `export const session = pgTable("session", {`. Columns relevant to admin academic linking (verified line numbers via grep this session):

| Column (TS key) | SQL name | Drizzle type | Null | Default | Line |
|---|---|---|---|---|---|
| `id` | `id` | `integer(...).primaryKey().generatedAlwaysAsIdentity()` | NOT NULL | identity | 57 |
| `teacherId` | `teacher_id` | `integer(...).notNull().references(() => teacher.id, { onDelete: "restrict" })` | NOT NULL | — | 58-60 |
| `studentId` | `student_id` | `integer(...).notNull().references(() => users.id, { onDelete: "restrict" })` | NOT NULL | — | 61-63 |
| `status` | `status` | `sessionStatus("status").notNull().default("scheduled")` | NOT NULL | `"scheduled"` | 64 |
| `sessionType` | `session_type` | `sessionType("session_type").notNull().default("student_session")` | NOT NULL | `"student_session"` | 65 |
| `intent` | `intent` | `sessionIntent("intent")` (hifz/tajweed/evaluation) | nullable | — | 66 |
| `fee` / `feeHeld` / `heldBalanceLane` | `fee` / `fee_held` / `held_balance_lane` | decimal(10,2), boolean, varchar(20)+`$type<HeldBalanceLane>` | nullable | feeHeld false | 67-69 |
| `startedAt` / `endedAt` | `started_at` / `ended_at` | `timestamp` | nullable | — | 70-71 |
| `confirmedByStudentAt` / `confirmedByTeacherAt` / `confirmationDeadline` | timestamps | `timestamp` | nullable | — | 72-74 |
| `cancelReason` / `disputeReason` / `disputedAt` | varchar(500) ×2 / timestamp | nullable | — | 75-77 |
| `resolutionNote` / `resolutionOutcome` / `resolvedAt` | varchar(500) / `disputeResolution` enum / timestamp | nullable | — | 78-80 |
| `createdAt` / `updatedAt` | `created_at` / `updated_at` | `timestamp` defaultNow, `$onUpdate` | NOT NULL | now() | 81-85 |

Indexes (lines 87-90): `session_teacher_id_idx` (teacher_id), `session_student_id_idx` (student_id), `session_teacher_id_student_id_idx` (teacher_id, student_id).

Key facts:
- `session_status` pgEnum members (`backend/db/schema/enums.ts:23`): `["scheduled", "started", "completed", "cancelled", "disputed"]`. Lifecycle doc: scheduled → started → completed | cancelled, disputed as arbitration state (`backend/db/schema/classes/session.ts:19-23`).
- `session_type` pgEnum members (`backend/db/schema/enums.ts:40`): `["student_session", "teacher_evaluation", "re_evaluation"]`.
- `session.student_id` → **`users.id`** (NOT students.id) — but "the same values `students.id` re-uses" (shared-PK child table), so a student session joins both ways (`backend/db/schema/classes/session.ts:11-17`).
- **No scheduled-date column exists on `session`** (no `scheduled_at`; only `startedAt`/`endedAt`/confirmation timestamps). Grep for `scheduled_at|scheduledAt|slot|Slot` across `backend/db/schema/` (non-test) returned zero hits; no `scheduling.ts` file exists under `backend/db/schema/classes/` (directory listing this session).
- Homework→student→teacher path: `home_work.session_id` → `session.id`; `session.student_id` → `users.id`; `session.teacher_id` → `teacher.id` (restrict). `teacher` is a shared-PK child of users: `id integer primaryKey references(() => users.id, { onDelete: "cascade" })` at `backend/db/schema/teachers/teacher.ts:21-23`; teacher name comes from `users.fullName`.

## (g) `students` + `users` — admin listing / student linkage

`users` table (`backend/db/schema/users/users.ts:11-45`), admin-identity-relevant columns:

| Column (TS key) | SQL name | Type | Null | Default | Line |
|---|---|---|---|---|---|
| `id` | `id` | integer PK `generatedAlwaysAsIdentity()` | NOT NULL | identity | 14 |
| `fullName` | `full_name` | varchar(255) `.notNull()` | NOT NULL | — | 15 |
| `email` | `email` | varchar(255) `.notNull()`, `unique("users_email_unique")` (line 45) | NOT NULL | — | 16 |
| `role` | `role` | `userRole` pgEnum `.notNull()` — `["admin","teacher","student","parent"]` (`backend/db/schema/enums.ts:9`) | NOT NULL | — | 19 |
| `locale` | `locale` | `appLocale` pgEnum `["ar","en"]` (`backend/db/schema/enums.ts:21`), nullable — unset until user chooses | nullable | — | 29 |
| `isDeleted` | `is_deleted` | boolean `.default(false)` (soft delete) | nullable | false | 30 |
| `deletedAt` | `deleted_at` | timestamp | nullable | — | 31 |
| `suspended` / `suspendedAt` / `suspendedPeriodDays` | booleans/int | nullable | false / — | 32-34 |
| `isBlocked` / `blockedAt` | booleans | nullable | false / — | 35-36 |
| `lastActiveAt` | `last_active_at` | timestamp | nullable | — | 37 |
| `createdAt` / `updatedAt` | timestamps defaultNow + `$onUpdate` | NOT NULL | now() | 38-42 |

Also on users: `phone` varchar(20) (line 17), `dateOfBirth` date (line 20), `gender` pgEnum (line 21), `country` varchar(100) (line 22). Only unique constraint: `users_email_unique` (line 45).

`students` table (`backend/db/schema/students/students.ts:18-47`) — student→user linkage:
- `id: integer("id").primaryKey().references(() => users.id, { onDelete: "cascade" })` — **shared PK = FK to users.id**, created only after a users row with role 'student' (lines 21-23; doc lines 8-9).
- Governance fields (is_deleted, suspended, is_blocked) live on `users`, not students (doc line 10).
- Lane balances: `balance_hifz`/`balance_reviews`/`balance_tajweed` integer default 0 nullable; `balance_trial` integer NOT NULL default 0; each with CHECK `>= 0` (lines 24-27, 42-45).
- `primaryLanguage` varchar(100), `anotherLanguage` varchar(100) (lines 29-30); `handshakeCode` varchar(50) NOT NULL + `students_handshake_code_unique` (lines 31, 40); `parentId` → users.id set null + `students_parent_id_idx` (lines 32, 41); timestamps (lines 33-37).

## (h) Grade representation

- Homework grades (Jadid & Madi): plain `integer`, nullable, DB-enforced range **[0, 100]** via named CHECKs `home_work_current_grade_check` / `home_work_revision_grade_check` (`backend/db/schema/classes/home-work.ts:32,36,46-47`). No grade pgEnum exists — grep for `grade` in `backend/db/schema/enums.ts` returned zero hits; grep over `backend/enum/` found `grade` only in `backend/enum/billing/proration-direction.enum.ts` (billing, unrelated).
- Teacher's session rating of student: `reports.student_rating_by_teacher` — plain `integer`, nullable, CHECK **[0, 5]** `reports_student_rating_by_teacher_check` (`backend/db/schema/classes/reports.ts:28,37-40`).
- Teacher's own average rating: `teacher.averageRating` decimal(3,2), CHECK 0–5 (`backend/db/schema/teachers/teacher.ts:32-38`).
- No score/percentage on `progress` (no `score`/`completed_at` columns — `backend/db/schema/classes/progress.ts:13-14`).

## (i) `backend/db/schema/AGENTS.md` — rules relevant to adding/extending tables

- Drizzle ORM only, `pgTable(...)` from `drizzle-orm/pg-core`; no raw SQL DDL (schema/AGENTS.md:35).
- One table per domain file; distinct domains in distinct files (schema/AGENTS.md:36). Domain layout mirrors repo/services/types/enum layout (schema/AGENTS.md:5); classes domain currently holds home-work, lessons, progress, recitation, reports, session, session-request-idempotency (directory listing this session).
- `enums.ts` is the single registry for every Drizzle enum color value, top-level, never moved into a subdirectory (schema/AGENTS.md:37,12).
- **Enum verification**: PostgreSQL enums must be matched EXACTLY; check `enums.ts`, never guess values (schema/AGENTS.md:38).
- **Schema synchronization**: after schema edits run `bun run db push`; `db reset`/`db cleanGenerate` permanently disabled by repo policy (schema/AGENTS.md:39).
- **Structural ground truth**: `backend/db/schema/` is the sole structural ground truth; verify a new table/enum does not already exist before authoring (schema/AGENTS.md:40).
- Import convention: consumers import tables via the top-level barrel `@/backend/db/schema`; within a schema file `@/` aliases for cross-domain refs, relative only for same-subdir siblings (schema/AGENTS.md:43-45).
- Cross-directory enum registration pattern: TS enums in `backend/enum/<subdir>/`, Drizzle colors in `backend/db/schema/enums.ts`, GraphQL registration in `backend/graphql/pothos/shared/enum.pothos.ts` (schema/AGENTS.md:46).
- Adding new tables checklist (schema/AGENTS.md:53-58): pick/create sub-directory → `<entity>.ts` with `export const <entity> = pgTable(...)` → add `export * from "./<entity>";` to the sub-directory `index.ts` → if new sub-directory, re-export from top-level `backend/db/schema/index.ts` → new enum values registered in `enums.ts` + `backend/enum/<subdir>/` + `bun run generate:gqlSchema` / `bun codegen` if GraphQL-exposed.

## (j) Memorization "milestone" table — does NOT exist

Grep for `milestone` (case-insensitive) across `backend/db/` returned zero matches (this session). Repo-wide, only two non-schema hits: `backend/services/teachers/student-evaluation.service.test.ts` and `shared/locale/en/landing/index.ts` — neither is a table or schema artifact. Surah/Juz "milestones" are only representable today as the per-session `home_work.current_surah_juz` / `revision_surah_juz` enums plus `progress` row counts — no dedicated milestone/progress-percentile/aggregation table exists.

## Blocked-by verification: "Session Report Submission with Homework (Jadid & Madi)" is IMPLEMENTED

The upstream feature already exists end-to-end: schema (`home-work.ts`, `reports.ts`), repository (`backend/db/repo/classes/home-work.repository.ts`, `backend/db/repo/classes/report.repository.ts:38`), services (`backend/services/classes/session-report.service.ts`, `backend/services/classes/student-homework.service.ts`, guards at `backend/services/classes/session-report.guards.ts`), GraphQL (`backend/graphql/mutation/classes/session-report.mutation.ts`, `backend/graphql/pothos/classes/home-work.pothos.ts`, `backend/graphql/pothos/classes/session-report-input.pothos.ts`), tests (`session-report.service.test.ts`, `student-homework.service.test.ts`, `backend/db/test/repo/classes/home-work.repository.test.ts`), and the schema static-assertions suite. (File list via grep this session; contents of service/mutation layers out of scope for this digest.)

## GAPS (verified NOT to exist)

| Missing item | Evidence |
|---|---|
| Any `milestone`-named table or column anywhere in the schema | grep `milestone` over `backend/db/` — zero hits |
| A scheduled-date column on `session` (or any scheduling table in schema) | grep `scheduled_at|scheduledAt|slot|Slot` over `backend/db/schema/` non-test — zero hits; no `scheduling.ts` in classes dir (dir listing) |
| `score` / `completed_at` on `progress` | `backend/db/schema/classes/progress.ts:13-14` explicitly documents their absence |
| `teacher_id` on `reports` | `backend/db/schema/classes/reports.ts:14-16` + static-assertions test lines 12-13, 65 |
| A grade pgEnum (grades are plain integer + CHECK) | grep `grade` in `backend/db/schema/enums.ts` — zero hits |
| Surah/Juz columns on `lessons` | `backend/db/schema/classes/lessons.ts:16-29` — only id/plan_id/title/timestamps |
| Surah/Juz/progress columns anywhere except `home_work` | `surahJuzRef` referenced only by `home-work.ts:33,37` in schema |
| Ayah-count / surah metadata tables (for computing "how far along" percentages) | no hits for `surah` outside enums + the files listed in section (c); no `ayah` table |
| Any academic-history/aggregation table (per-student academic snapshot) | none exists — academic history is derivable only by joining `home_work`/`reports`/`recitation`/`progress` over `session` |
