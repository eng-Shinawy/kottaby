# Research: PRODUCTION_READINESS.md §8 rows 8.22–8.32 — link/workflow decisions B.12–B.18 + C.1/C.3/C.4/C.5

Date: 2026-10-08

## Area

All eleven decision rows in this slice are grounded in shipped code. Ten of eleven are
VERIFIED end-to-end (schema column/constraint + enforcement surface + at least one test
artifact); the one exception is B.16 (row 8.26), whose pgEnum and `teacher.request_preference`
column exist exactly as decided, but whose runtime intake (queue/reject/offer_alternatives
behavior) is a formally recorded deferred item — grep for any service/GraphQL consumer of
`offer_alternatives` in `backend/` returns nothing. The parent-link trio (B.12/B.13/B.14)
is enforced by a single-writer guarded UPDATE (`linkParentIfUnlinked`) plus the
`parent_link_requests_pending_pair_unique` partial unique index, with the 7-day window
sourced from one shared constant. B.15's 15-minute window is an env-overridable default
(`TEACHER_INACTIVITY_TIMEOUT_MINUTES`, fallback 15) driving a cron sweep. B.17 proration is
exact-integer carry/forfeit arithmetic with admin upgrade/downgrade flows exposed over
GraphQL. B.18 arbitration ships two escrow generations: held disputes (Cancel|Complete)
and consumed disputes (Refund|PartialRefund|Uphold) with `arbitration_reversal` ledger rows.
C.1/C.3/C.4/C.5 are schema facts, each with a pinning test — including the C.4 negative
check (reports has NO teacher_id), which is locked by a static-assertion suite.

## Checklist → Codebase Mapping

| Row # | Criterion (short) | Actual artifact (path:line) | STATUS |
|---|---|---|---|
| 8.22 | B.12: One parent per student | `backend/db/schema/students/students.ts:32` single-valued nullable `parentId` FK (no array/join table); guarded single-writer `linkParentIfUnlinked` with `isNull(students.parentId)` predicate `backend/db/repo/students/student.repository.ts:373-384` | VERIFIED |
| 8.23 | B.13: Parent links multiple children | `students.ts:41` plain index `students_parent_id_idx` on parentId (NO unique on parent_id — repeats allowed); `backend/db/schema/parents/parents.ts:8-9` docstring "A parent can link to multiple children via students.parent_id" | VERIFIED |
| 8.24 | B.14: 7-day link request expiry | `shared/constants/parent-link-request.constants.ts:17` `PARENT_LINK_REQUEST_TTL_DAYS = 7`; `backend/db/schema/parents/parent-link-requests.ts:51` `expiresAt` notNull, app-written `createdAt + 7d`, liveness strict `expiresAt > now` (:27-30); one-live-pending partial unique index (:58-60) | VERIFIED |
| 8.25 | B.15: 15-minute inactivity timeout | `backend/lib/env.ts:135` `DEFAULT_TEACHER_INACTIVITY_TIMEOUT_MINUTES = 15` + env override (:411-413, getter :635-636); sweep `backend/services/teachers/teacher-inactivity.service.ts:72-86`; cron `app/api/cron/sweep-inactive-teachers/route.ts:34-37` | VERIFIED |
| 8.26 | B.16: teacher.request_preference enum | pgEnum `backend/db/schema/enums.ts:271` (`queue`,`reject`,`offer_alternatives`); column `backend/db/schema/teachers/teacher.ts:54` (default `queue`); TS mirror `backend/enum/teachers/teacher-request-preference.enum.ts:6-10`; repo read `backend/db/repo/teachers/teacher.repository.ts:147` — NO service/GraphQL consumer | PARTIAL (schema VERIFIED; runtime intake DEFERRED — D1 `ai/plans/milestone_2/in_session_locking_hide_from_directory/deferred-items.md:20`) |
| 8.27 | B.17: Prorated plan changes | `computeProration` `backend/services/billing/subscription-proration.helpers.ts:139`; direction `prorationDirectionOf` :114 (Upgrade/Downgrade :93-105); carry/forfeit applied `subscription-plan-change.helpers.ts:393-437`; 4 admin flows `subscription-admin.service.ts:3`; GraphQL `ProrationDirection` `backend/graphql/pothos/shared/enum.pothos.ts:441-453` | VERIFIED |
| 8.28 | B.18: Admin arbitration for disputes | `session_status` includes `disputed` `backend/db/schema/enums.ts:23`; `dispute_resolution` pgEnum (5 outcomes) :32-38; session columns `dispute_reason`/`disputed_at`/`resolution_note`/`resolution_outcome` `backend/db/schema/classes/session.ts:76-79`; consumed-family `SessionArbitrationService.arbitrateDispute` (Refund|PartialRefund|Uphold) `backend/services/classes/session-arbitration.service.ts:313-421`; held-family Cancel|Complete `session-lifecycle.service.ts:579-621`; `arbitration_reversal` ledger type `enums.ts:63` | VERIFIED |
| 8.29 | C.1: parent in user_role enum | `backend/db/schema/enums.ts:9` `userRole = pgEnum("user_role", ["admin","teacher","student","parent"])` | VERIFIED |
| 8.30 | C.3: evaluations evaluated_id/evaluator_id | `backend/db/schema/teachers/evaluations.ts:41-43` `evaluatedId` notNull FK users ON DELETE cascade; :44-46 `evaluatorId` notNull FK users ON DELETE restrict; :64 unique `(session_id, evaluator_id)` | VERIFIED |
| 8.31 | C.4: reports.teacher_id removed | `backend/db/schema/classes/reports.ts:22-33` column set is exactly {id, session_id, teacher_notes, student_rating_by_teacher, created_at, updatedAt} — NO teacher_id; explicit docstring "NO `teacher_id` column" (:14-16); pinned `backend/db/schema/classes/report-homework-schema.static-assertions.test.ts:60-70` | VERIFIED (negative check) |
| 8.32 | C.5: recitation.session_id unique 1:1 | `backend/db/schema/classes/recitation.ts:19-21` `sessionId` notNull FK session cascade; :30 `unique("recitation_session_id_unique")` | VERIFIED |

## Existing Coverage

| Decision | Test artifact | What it asserts |
|---|---|---|
| B.12 | `backend/db/test/repo/students/student.repository.test.ts:318-339` | Winner claims unlinked student; SECOND call collapses to null; a RIVAL parent cannot steal the link; winning parent_id persists (guarded UPDATE … RETURNING) |
| B.12 | `backend/services/parents/parent-link.static-locks.test.ts:533-598` | Corpus scan: `linkParentIfUnlinked` is the ONLY production writer of non-null `students.parent_id` (INV-P1 single-writer lock) |
| B.13 | `backend/db/test/repo/students/student.parent-monitoring.repository.test.ts:111-115,180-184` | One parent with three linked children (childA/B/C) returns all three in stable order — same parentId on multiple students |
| B.13/B.12 | `backend/services/parents/parent-link-request.service.test.ts:953-1000` | Rival-pending fixtures per (parent, student) pair against the partial unique index |
| B.14 | `backend/services/parents/parent-link-request.service.test.ts:501-502` | `windowMs = expiresAt − createdAt ≈ PARENT_LINK_REQUEST_MS` (7 days, ±1s); Tier 2 boundary tier at :46 (claim/liveness at expiresAt exactly now, now−1ms) |
| B.14 | `backend/services/parents/parent-link-request.helpers.test.ts:173-174,197` | Stored `pending` row with `expiresAt <= now` surfaces as `Expired` in both outgoing and incoming mappings |
| B.14 | `backend/services/parents/parent-link-request.service.test.ts:1273` | Direct expiry-materialization probe: guarded UPDATE of stale `pending` rows (`lte(expiresAt, now)`) |
| B.14 | `backend/services/parents/parent-link-request.chaos.test.ts:373` | Concurrent double-respond on ONE pending: exactly one claim wins, loser gets typed conflict |
| B.15 | `backend/services/teachers/teacher-inactivity.service.test.ts:164-169` | Garbage `TEACHER_INACTIVITY_TIMEOUT_MINUTES` env value → getter returns 15 (safe-default fallback); composition describe :178+ asserts one-transaction, in-session teachers spared |
| B.15 | `app/api/cron/sweep-inactive-teachers/test/sweep-inactive-teachers-route.test.ts:50-52` | Cron route delegates to the sweep service (module-mocked, no server boot) |
| B.16 | `backend/db/test/repo/teachers/teacher.repository.test.ts:2436` | `requestPreference` survives round-trip unchanged; `backend/db/test/repo/classes/session.repository.wave-context.test.ts:101-109` fixtures insert with a preference — schema-level only, no behavioral test exists |
| B.17 | `backend/services/billing/subscription-admin.service.test.ts:1693,1783,1828,1900,1913,1941` | `ProrationDirection.Upgrade`/`Downgrade` on plan-change results; ceiling denial `prorationOverflow` :717,1055,2037-2043; carry credited separately :1586,2384; replay idempotency :2437-2438 |
| B.18 | `backend/graphql/test/session-arbitration.wire.test.ts:54-58,144-145` | Wire-level: Refund on held-escrow dispute → family-mismatch denial; Uphold = zero financial writes; full Refund reverses teacher earning; PartialRefund shape validation |
| B.18 | `backend/services/classes/session-arbitration.service.test.ts` | Service-level arbitration flows (open dispute, three outcomes, audit row, notifications) |
| C.1 | `backend/db/test/logic/admin/admin-user.repository.test.ts:234,265` | User role round-trips over all four values including `parent` |
| C.3 | `backend/db/test/repo/teachers/evaluation.repository.test.ts:142-143,155-166,237` | `evaluatedId`/`evaluatorId` in canonical column set + insert fixtures for both rubric and rating flows |
| C.4 | `backend/db/schema/classes/report-homework-schema.static-assertions.test.ts:60-70` | reports columns equal exactly [createdAt,id,sessionId,studentRatingByTeacher,teacherNotes,updatedAt] and `not.toContain("teacherId")` |
| C.5 | `backend/db/test/repo/classes/recitation.repository.test.ts:287-297` | Second insert for same session surfaces RAW 23505 carrying `recitation_session_id_unique` constraint name (Tier 3 chaos) |

## Gaps

1. **B.16 runtime behavior (row 8.26)** — the checklist row only demands the enum's existence
   (which passes), but the DECISION "Configurable request handling" is unimplemented end-to-end:
   no service reads `request_preference` to branch queue/reject/offer-alternatives, and there is
   no GraphQL field for a teacher to set it. Recorded as deferred item D1
   (`ai/plans/milestone_2/in_session_locking_hide_from_directory/deferred-items.md:20`).
   Launch-gate need: an explicit signed deferral note (or D1 lands before launch) plus a
   no-consumer grep probe so the checkbox is honest, not silently green.
2. **No single launch script/probe bundles these rows** — each row is verified by a different
   suite (repo tests, static-locks scans, static schema assertions, wire tests). A launch
   executor has no one command that flips 8.22–8.32. Need a `scripts/` probe (or test/config
   runner list) that executes the covering suites and emits a per-row table.
3. **B.12 has no DB-level probe** — enforcement is application-level (guarded single-writer
   UPDATE); nothing at the pure-SQL layer prevents a manual `UPDATE students SET parent_id=...`
   on an already-linked row. Acceptable for launch (single-writer is corpus-locked), but the
   launch plan should record that B.12 is enforced by writer discipline, not a DB constraint.
4. **B.14 has no proactive sweep** — expiry is lazily materialized at first write interaction
   (guarded UPDATE); stale `pending` rows past 7 days sit in the table until touched. The
   reminder claim (`reminderSentAt`, parent-link-requests.ts:53) is the only system-side
   touch. A launch "verify expiry after 7 days" check needs the boundary tier (already at
   service test :46) — no new harness needed, just pointing the executor at it.
5. **C.1 enum mirror-parity** — `user_role` pgEnum vs `backend/enum/users/user-role.enum.ts`
   TS mirror has no dedicated static mirror-parity test in this slice (the surah_juz_ref row
   8.21 got one); C.1 is only incidentally covered by admin-user repo tests.

## Harness Recommendations

- **DB probe script** (`scripts/` or `test/config/`): a read-only introspection script that
  connects once and prints per-row evidence: enum members of `user_role` /
  `teacher_request_preference` / `session_status` / `dispute_resolution`, presence of
  `recitation_session_id_unique` + `reports` column list (asserting teacher_id absent),
  `evaluations` FKs, `parent_link_requests.expiresAt` nullability. This covers
  8.26/8.28/8.29/8.30/8.31/8.32 mechanically against the LIVE database, not just Drizzle
  metadata (complements the existing static-assertion suites).
- **Journey tests** (`test/workflows/parents/`, `test/workflows/teachers/`): one launch-journey
  per decision cluster — (a) parent links child A + rival parent rejected + second child linked
  (8.22+8.23 together); (b) freeze clock at day 7 boundary → request expired (8.24);
  (c) teacher heartbeat gap > 15 min → `is_online=false`, in-session teacher spared (8.25 —
  already largely covered by the inactivity service test; journey adds the WS/cron leg).
- **No-consumer grep probe for B.16** (`scripts/health/` pattern, like existing static-locks
  scans): fail if a consumer appears without updating the launch ledger, or annotate deferral.
- **Reuse, don't rebuild**: the repo's `bun run test:services:sequential` already runs
  `parent-link-request.service.test.ts`, `teacher-inactivity.service.test.ts`,
  `subscription-admin.service.test.ts`, `session-arbitration.service.test.ts`;
  `bun run test:db` runs the repo/chaos tests. The launch plan should map each row to these
  existing suites in a verification matrix rather than authoring new tests for already-green
  rows.
- **Locations consistent with repo layout**: static schema pins belong in
  `backend/db/schema/**` (pattern: `report-homework-schema.static-assertions.test.ts`);
  DB-level immutability probes in `backend/db/test/logic/`; end-to-end in
  `test/workflows/<domain>/`; the live-DB introspection script in `scripts/`.

## Evidence Appendix

B.12 — single-valued column + guarded single writer:
```ts
// students.ts:32
parentId: integer("parent_id").references(() => users.id, { onDelete: "set null" }),
// student.repository.ts:381
.where(and(eq(students.id, studentId), isNull(students.parentId)))
```

B.13 — plain index (no unique) on parent_id; multi-child docstring:
```ts
// students.ts:41
index("students_parent_id_idx").on(t.parentId),
// parents.ts:8-9
// is created only after a users row with role 'parent' is inserted). A parent
// can link to multiple children via students.parent_id → users.id.
```

B.14 — 7-day constant + one-live-pending partial unique index:
```ts
// parent-link-request.constants.ts:17,20
export const PARENT_LINK_REQUEST_TTL_DAYS = 7;
export const PARENT_LINK_REQUEST_MS = PARENT_LINK_REQUEST_TTL_DAYS * 86_400_000;
// parent-link-requests.ts:58-60
uniqueIndex("parent_link_requests_pending_pair_unique").on(t.parentId, t.studentId).where(sql`${t.status} = 'pending'`),
```

B.15 — 15-minute default + env override + sweep cutoff:
```ts
// env.ts:135
const DEFAULT_TEACHER_INACTIVITY_TIMEOUT_MINUTES = 15;
// teacher-inactivity.service.ts:77
const cutoff = new Date(now.getTime() - getTeacherInactivityTimeoutMinutes() * 60_000);
```

B.16 — enum exists; runtime intake deferred:
```ts
// enums.ts:271
export const teacherRequestPreference = pgEnum("teacher_request_preference", ["queue", "reject", "offer_alternatives"]);
// teacher.ts:54
requestPreference: teacherRequestPreference("request_preference").default("queue"),
// deferred-items.md:20 — "unused `teacher.request_preference` pgEnum … D1 Real accept/decline session-request intake"
```

B.17 — exact proration with direction + carry/forfeit:
```ts
// subscription-proration.helpers.ts:139
export function computeProration(
// subscription-admin.service.ts:3
 * `subscriptions` root (the four admin lifecycle flows — extend, renew,
```

B.18 — disputed status + five-outcome resolution vocabulary + arbitration entry:
```ts
// enums.ts:23,32-38
export const sessionStatus = pgEnum("session_status", ["scheduled", "started", "completed", "cancelled", "disputed"]);
export const disputeResolution = pgEnum("dispute_resolution", ["Cancel", "Complete", "Refund", "PartialRefund", "Uphold"]);
// session-arbitration.service.ts:313
export async function arbitrateDispute( // (Refund | PartialRefund | Uphold; teacher debit + student lane credit)
```

C.1 — parent is a first-class user_role member:
```ts
// enums.ts:9
export const userRole = pgEnum("user_role", ["admin", "teacher", "student", "parent"]);
```

C.3 — both evaluator columns are NOT NULL FKs with distinct delete semantics:
```ts
// evaluations.ts:41-46
evaluatedId: integer("evaluated_id").notNull().references(() => users.id, { onDelete: "cascade" }),
evaluatorId: integer("evaluator_id").notNull().references(() => users.id, { onDelete: "restrict" }),
```

C.4 — reports column set excludes teacher_id (pinned):
```ts
// report-homework-schema.static-assertions.test.ts:60-69
test("reports exposes exactly the report columns — no teacherId key (teacher via session)", () => {
  expect(columnKeys(reports)).toEqual(["createdAt","id","sessionId","studentRatingByTeacher","teacherNotes","updatedAt"]);
  expect(columnKeys(reports)).not.toContain("teacherId");
```

C.5 — recitation is 1:1 with session at the DB layer:
```ts
// recitation.ts:19-21,30
sessionId: integer("session_id").notNull().references(() => session.id, { onDelete: "cascade" }),
unique("recitation_session_id_unique").on(t.sessionId)
```

### Count summary

| STATUS | Rows |
|---|---|
| VERIFIED | 8.22, 8.23, 8.24, 8.25, 8.27, 8.28, 8.29, 8.30, 8.31 (negative), 8.32 |
| PARTIAL (schema VERIFIED, runtime DEFERRED) | 8.26 (B.16 — deferred item D1) |
| MISSING | none |
