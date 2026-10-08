# Research: PRODUCTION_READINESS Section 8 rows 8.1-8.10 (decisions A.1-A.10) + 8.33 (all enums validated)
Date: 2026-10-08

## Area

All ten architecture decisions A.1-A.10 are structurally implemented in the Drizzle schema tree
`backend/db/schema/` and are statically verifiable today — none is missing. The planning vocabulary
maps almost 1:1 to real names, with three naming nuances a launch verifier must internalize: (1) the
teacher role table is **singular** `teacher` (file `teachers/teacher.ts`, exported const `teacher`), not
`teachers`; (2) `students.parent_id` FK targets **`users.id`** (not `parents.id`) — `parents` is a
shared-PK role-marker table; (3) `teacher.subjects` is a **JSON array in varchar(255)**, not an enum or
array column. Row 8.33 is PARTIAL: all 21 pgEnums live exclusively in `backend/db/schema/enums.ts`
(zero in domain files), but only 8 of 21 have TS-mirror parity tests and no automated census guard
pins the registry. The load-bearing immutability claim of A.5 (audit_logs append-only) is enforced by
DB triggers shipped in `backend/db/migration/3-immutability-triggers.sql` and proven by a 3-tier test
suite — the strongest verification in this area.

## Checklist → Codebase Mapping

| Row # | Criterion (short) | Actual artifact (path:line) | STATUS |
|---|---|---|---|
| 8.1 | A.1 parents table exists | `backend/db/schema/parents/parents.ts:11` — `export const parents = pgTable("parents", {...})`; shared PK `id` FK→users.id cascade (:12-14) | VERIFIED |
| 8.2 | A.2 students.parent_id FK | `backend/db/schema/students/students.ts:32` — `parentId: integer("parent_id").references(() => users.id, { onDelete: "set null" })`; index `students_parent_id_idx` :41 | VERIFIED |
| 8.3 | A.3 students.handshake_code unique | `students.ts:31` — `handshakeCode: varchar("handshake_code", { length: 50 }).notNull()`; `students.ts:40` — `unique("students_handshake_code_unique").on(t.handshakeCode)` | VERIFIED |
| 8.4 | A.4 notifications table | `backend/db/schema/notifications/notifications.ts:30` — `pgTable("notifications", {...})`; `type: notificationType("type").notNull()` :37; 3 indexes :46-48 | VERIFIED |
| 8.5 | A.5 audit_logs exists (immutable) | `backend/db/schema/audit/audit-logs.ts:30` — `pgTable("audit_logs", {...})`; triggers `backend/db/migration/3-immutability-triggers.sql:43-53` (`prevent_audit_logs_update_trigger` BEFORE UPDATE :44-47, `prevent_audit_logs_delete_trigger` BEFORE DELETE :50-53) | VERIFIED |
| 8.6 | A.6 teacher.subjects field | `backend/db/schema/teachers/teacher.ts:37` — `subjects: varchar("subjects", { length: 255 })` (JSON array in varchar; table name is `teacher`, singular) | VERIFIED |
| 8.7 | A.7 governance fields on users (not students/teachers) | `backend/db/schema/users/users.ts:37-43` — `isDeleted` :37, `suspended` :39, `isBlocked` :42 (+ `deletedAt` :38, `suspendedAt` :40, `suspendedPeriodDays` :41, `blockedAt` :43); negative: grep `is_deleted|suspended|is_blocked` over `backend/db/schema/` hits only users.ts (users.ts:37-42) — students/teacher/parents files carry none | VERIFIED |
| 8.8 | A.8 session.session_type enum | `backend/db/schema/classes/session.ts:65` — `sessionType: sessionType("session_type").notNull().default("student_session")`; pgEnum `backend/db/schema/enums.ts:40` — `session_type` = `["student_session", "teacher_evaluation", "re_evaluation"]` | VERIFIED |
| 8.9 | A.9 subscriptions.status enum | `backend/db/schema/billing/subscriptions.ts:38` — `status: subscriptionStatus("status").notNull().default("pending")`; pgEnum `enums.ts:79-85` — `subscription_status` = active/pending/expired/cancelled/suspended | VERIFIED |
| 8.10 | A.10 session.intent enum | `backend/db/schema/classes/session.ts:66` — `intent: sessionIntent("intent")` (nullable); pgEnum `enums.ts:42` — `session_intent` = `["hifz", "tajweed", "evaluation"]` | VERIFIED |
| 8.33 | All enums validated (defined in Drizzle schema) | All 21 pgEnums in `backend/db/schema/enums.ts:9-295` (header :4 "all 21 PostgreSQL enums"); grep `pgEnum\(` over `backend/db/schema/` returns 21 hits, all in enums.ts, zero in domain files | PARTIAL |

Counts: **VERIFIED 10, PARTIAL 1 (8.33), MISSING 0, DEFERRED 0.**

8.33 PARTIAL rationale: the registry is complete and centralized (census confirmed statically), but
(1) only 8/21 pgEnums have mirror-parity tests, (2) no test pins the registry count or the
"pgEnums-only-in-enums.ts" convention, so drift is undetectable today.

Vocabulary → real-name notes: `teachers` table → `teacher` (singular, `teacher.ts:19`); `parents`
row exists but the FK from students points at `users.id` (`students.ts:11` comment: "One parent per
student via parent_id → users.id"); `handshake_code` nullable? — no, `.notNull()` :31; `session.intent`
nullable (no `.notNull()`) :66; `subscriptions.status` enum is named `subscription_status` (matches
planning).

## Existing Coverage

| Artifact | What it already asserts |
|---|---|
| `backend/db/test/logic/audit/audit-immutability.test.ts:1-120` | 3-tier A.5 proof: (1) fs walk proving zero production `update(auditLogs)`/`delete(auditLogs)` callsites and `AuditService` exposes only the append writer; (2) environment-branched `pg_trigger` probe + live fixture INSERT ok / UPDATE+DELETE throw via `expectRepoError` (trigger names pinned :59-60); (3) migration-DDL pin reading `3-immutability-triggers.sql` from disk (:75) asserting idempotent CREATE OR REPLACE + DROP IF EXISTS. |
| `backend/db/test/logic/audit/audit-trail.repository.test.ts:1-30` | Read-path on `audit_logs`: filter matrix by actorId/actionType/entityType/entityId, half-open time window, ordering, pagination, projection (covers checklist 1.3.4/1.3.5 adjacency). |
| `backend/db/test/logic/audit/audit-census-drift.test.ts:1-40` | Static bijection between admin-gated GraphQL mutations and the audit census — guards "every admin action is audited" (1.3.1 adjacency). |
| `backend/db/test/repo/parents/parent.repository.test.ts` | `parents` role-row lifecycle: shared-PK insert, cascade delete via users, exact column key set of a parents row (:32, :87, :111-112). Direct A.1 behavioral coverage. |
| `backend/db/test/repo/parents/parent-link-request.repository.test.ts` | Parent link-request flow on `parent_link_requests` (linkStatus enum consumer; 7-day expiry B.14 adjacency). |
| `backend/db/test/repo/students/student.repository.test.ts` | Handshake code write/read contract (registration insert with verbatim code :150, `findDiscoveryByHandshakeCode` :138-188, `findLinkTargetByHandshakeCode` :281-312), `parentId` link/unlink mapping :206-239, zeroed balances :151-154. Direct A.2/A.3 read-path coverage. |
| `backend/db/test/repo/students/student.parent-monitoring.repository.test.ts` | Parent→child read path over `students.parent_id` (A.2 consumer). |
| `backend/db/test/logic/notifications/notification.repository.test.ts` | `notifications` table read-path (per-user feed, unread flag) — A.4 behavioral coverage. |
| `backend/db/test/logic/classes/session-schema-deltas.test.ts:1-60` | Live-PG schema pin on `session` table: `held_balance_lane` round-trip, unique-violation 23505 probe on the idempotency claim, static reachability pins (Tier 4 :39-46) proving server-internal columns never appear under `backend/graphql/`. Pattern precedent for enum/column probes. |
| `backend/db/test/logic/billing/subscription.repository.test.ts` | Contains a 22P02 (invalid enum input) probe against `subscriptions` — DB-level enum rejection (A.9). |
| `backend/db/test/repo/teachers/teacher.repository.test.ts:853,1308,1815-1822` | 22P02 invalid-value probes on `teacher` columns — DB-level type validation (A.6 adjacency). |
| `backend/enum/**/​*.enum.test.ts` (12 files) | pgEnum↔TS mirror parity for 8 of 21: `notification-type` (`backend/enum/notifications/notification-type.enum.test.ts:54-67`, 9 members byte-identical), `surah-juz-ref` (`backend/enum/shared/surah-juz-ref.enum.test.ts:165-174`, 144 members), `broadcast-status`, `broadcast-audience-type`, `dispute-resolution`, `link-status`, `rubric-weakness-area`, `app-locale`. |
| `backend/db/schema/classes/report-homework-schema.static-assertions.test.ts` | Precedent: static-assertion test living inside the schema tree (pins table shape without a DB) — the pattern an A.7 negative pin should follow. |

## Gaps

1. **8.3 — no DB-level unique-violation probe for `students_handshake_code_unique`.** Grep for
   `handshake_code_unique|23505` across `backend/db/test/repo/students/` returned nothing. The
   constraint exists in schema (`students.ts:40`) but no test proves a duplicate insert raises 23505.
   Needed: a `runInRollback` + `expectRepoError` duplicate-insert probe in
   `backend/db/test/repo/students/student.repository.test.ts` (or a sibling schema-probe file).
2. **8.33 — 13 of 21 pgEnums have no mirror-parity test.** `find backend/enum -name "*.enum.test.ts"`
   yields 12 test files; only 8 mirror pgEnums. Missing mirrors: `user_role`, `gender`,
   `session_status`, `session_type`, `session_intent`, `payment_status`, `transaction_type`,
   `transaction_status`, `payment_gateway`, `subscription_status`, `subscription_credit_lane`,
   `audit_action_type`, `teacher_request_preference` — note this includes the exact enums rows
   8.8/8.9/8.10 point at.
3. **8.33 — no registry census guard.** No test pins (a) the pgEnum count (21), (b) that every pgEnum
   is declared in `enums.ts` (AGENTS.md:37 states the convention; nothing enforces it), or (c) that
   domain schema files contain zero `pgEnum(` declarations. Drift (an enum added to a domain file, or
   a value edited in enums.ts without its TS mirror) is silent today.
4. **8.7 — the negative half (governance NOT on students/teachers) is comment-only.**
   `students.ts:10` and `users.ts:7` assert it in prose; no static-assertion test pins that the
   students/teacher/parents modules export no `isDeleted`/`suspended`/`isBlocked` columns.
5. **8.6 nuance — `teacher.subjects` is JSON-in-varchar with no schema-level validation** (nullable
   varchar(255), `teacher.ts:37,14-15`). Parse discipline (fail-closed) is documented for
   `recitations`/`languages` (:39-45) but the subjects payload parse is not test-pinned. Low launch
   risk (A.6 only asks "verify column"), recorded for the verifier's awareness.
6. **8.2 nuance — FK target is `users.id`, not `parents.id`** (`students.ts:32`). "One parent per
   student" is enforced by a single nullable FK (B.12 adjacency), and `parent_id` is nullable
   (set-null on delete) — the launch verifier must not expect a NOT NULL or a parents.id target.

## Harness Recommendations

These rows are schema-presence checks; the right verification tier is (a) static pins + (b) short
DB probes, not new journey tests. One exception: A.5 already has a full harness and just needs a
recorded run.

1. **Enum census + parity guard (closes 8.33, gaps 2+3) — highest value.** One DB-free static test,
   e.g. `backend/db/test/logic/schema-registry-census.test.ts` (sibling to
   `backend/db/test/logic/classes/session-schema-deltas.test.ts`, which already does fs scans):
   - import `* as enums from "@/backend/db/schema/enums"` and assert the exported pgEnum count;
   - fs-walk `backend/db/schema/**` (excluding `enums.ts`) asserting zero `pgEnum(` occurrences
     (scanner pattern precedent: `audit-immutability.test.ts:1-39` corpus walk; non-vacuity via
     crafted in-memory fixtures);
   - parity-assert each pgEnum's `enumValues` against its `backend/enum/**` TS mirror
     (byte-identical, order-sensitive — copy the assertion shape from
     `backend/enum/notifications/notification-type.enum.test.ts:63-67` and
     `backend/enum/shared/surah-juz-ref.enum.test.ts:165-174`). Mirror tests may alternatively live
     beside each TS enum (`backend/enum/scheduling/session-type.enum.test.ts`, etc.) following the
     12 existing files.
2. **Handshake unique probe (closes 8.3, gap 1).** Add to
   `backend/db/test/repo/students/student.repository.test.ts` (or a sibling): inside `runInRollback`,
   insert a second student row with a fixture student's `handshakeCode` as the LAST statement, assert
   23505 via `hasPostgresErrorCode` (`backend/db/test/pg-error`) + `expectRepoError` — never
   `rejects.toThrow()` (deadlock rule, `backend/db/test/AGENTS.md`).
3. **A.7 negative pin (closes gap 4).** Static-assertion test in the schema tree, precedent
   `backend/db/schema/classes/report-homework-schema.static-assertions.test.ts`: assert the
   `students`/`teacher`/`parents` table column sets (via `getTableColumns`) contain none of
   `isDeleted`/`suspended`/`isBlocked` and that `users` contains all seven governance columns.
4. **A.5 (8.5) — reuse, do not rebuild.** The launch checklist run should execute
   `backend/db/test/logic/audit/audit-immutability.test.ts` against the production-schema DB and
   record the `pg_trigger` probe result (migrate-provisioned ⇒ both triggers enabled; push-provisioned
   environments lack them — the push-vs-migrate caveat is documented in `docs/admin/audit-trail.md:58`).
5. **Production sign-off probe script.** A read-only script, e.g. `scripts/launch/verify-decisions.ts`
   (sibling to existing `scripts/health/` pattern), querying `information_schema`/`pg_enum`/
   `pg_trigger` for the 11 row checks (table existence, FK, unique constraint, trigger presence,
   enum values) and emitting the Section 8 rows 8.1-8.10+8.33 sub-report for the sign-off record.
   No schema writes; safe against prod.
6. **Run discipline.** DB probes via `bun run test/scripts/run-test.ts <path>` (mandatory log capture
   for db tests); static census test is DB-free and safe in any parallel wave (`bun run test` lane).

## Evidence Appendix

A.1 — `backend/db/schema/parents/parents.ts:11-14`:
```ts
export const parents = pgTable("parents", {
  id: integer("id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
```
A.2 — `backend/db/schema/students/students.ts:32`:
```ts
parentId: integer("parent_id").references(() => users.id, { onDelete: "set null" }),
```
A.3 — `backend/db/schema/students/students.ts:31,40`:
```ts
handshakeCode: varchar("handshake_code", { length: 50 }).notNull(),   // :31
unique("students_handshake_code_unique").on(t.handshakeCode),         // :40
```
A.4 — `backend/db/schema/notifications/notifications.ts:30,37`:
```ts
export const notifications = pgTable("notifications", {   // :30
  type: notificationType("type").notNull(),               // :37
```
A.5 — `backend/db/migration/3-immutability-triggers.sql:44-47,50-53`:
```sql
CREATE TRIGGER prevent_audit_logs_update_trigger BEFORE UPDATE ON audit_logs ... EXECUTE FUNCTION prevent_audit_logs_update();
CREATE TRIGGER prevent_audit_logs_delete_trigger BEFORE DELETE ON audit_logs ... EXECUTE FUNCTION prevent_audit_logs_delete();
```
A.6 — `backend/db/schema/teachers/teacher.ts:37` (note: table `teacher`, singular):
```ts
subjects: varchar("subjects", { length: 255 }),
```
A.7 — `backend/db/schema/users/users.ts:37-42` (governance ONLY here):
```ts
isDeleted: boolean("is_deleted").default(false),        // :37
suspended: boolean("suspended").default(false),          // :39
isBlocked: boolean("is_blocked").default(false),        // :42
```
A.8 — `backend/db/schema/classes/session.ts:65` + `backend/db/schema/enums.ts:40`:
```ts
sessionType: sessionType("session_type").notNull().default("student_session"),
export const sessionType = pgEnum("session_type", ["student_session", "teacher_evaluation", "re_evaluation"]);
```
A.9 — `backend/db/schema/billing/subscriptions.ts:38` + `backend/db/schema/enums.ts:79-85`:
```ts
status: subscriptionStatus("status").notNull().default("pending"),
export const subscriptionStatus = pgEnum("subscription_status", ["active","pending","expired","cancelled","suspended"]);
```
A.10 — `backend/db/schema/classes/session.ts:66` + `backend/db/schema/enums.ts:42`:
```ts
intent: sessionIntent("intent"),
export const sessionIntent = pgEnum("session_intent", ["hifz", "tajweed", "evaluation"]);
```
8.33 — census: grep `pgEnum\(` over `backend/db/schema/` → 21 hits, ALL at `backend/db/schema/enums.ts`
lines 9,11,21,23,32,40,42,53,55,63,65,67,79,97,99,101,114,124,271,281,295; zero in domain files.
Names (21): user_role, gender, app_locale, session_status, dispute_resolution, session_type,
session_intent, rubric_weakness_area, payment_status, transaction_type, transaction_status,
payment_gateway, subscription_status, subscription_credit_lane, link_status, notification_type,
audit_action_type, surah_juz_ref (144 members), teacher_request_preference, broadcast_status,
broadcast_audience_type. TS side: 31 enum files in `backend/enum/` (21 pgEnum mirrors + 10 app-only:
proration-direction, wallet-adjustment-direction, held-balance-lane, recitation-reading,
applicant-cooldown-state, applicant-override-action, applicant-status, teacher-matching-sort,
admin-user-governance-filter, register-public-role). Mirror-parity tests exist for 8 (notification-type,
surah-juz-ref, broadcast-status, broadcast-audience-type, dispute-resolution, link-status,
rubric-weakness-area, app-locale); 13 lack one.
