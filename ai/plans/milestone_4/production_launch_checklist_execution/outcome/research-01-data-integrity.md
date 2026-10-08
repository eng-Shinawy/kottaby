# Research: PRODUCTION_READINESS Section 1 — Data Integrity & Governance (rows 1.1.1–1.4.3)
Date: 2026-10-08

## Area

Section 1 (soft delete, financial immutability, audit completeness, retention) is the best-covered
section of the checklist. Soft delete is a guarded one-statement UPDATE (`AdminUserRepository.setDeletedOnce`)
with login denial folded into `AuthService.assertUserActive`; financial ledgers and `audit_logs` are
protected by PostgreSQL BEFORE UPDATE/DELETE triggers installed in migration
`20260904084152_custom_3-immutability-triggers`, with two documented guarded lifecycle exceptions
(payment `pending → paid|failed`, withdrawal settlement) that the checklist's blanket "immutable"
wording does not capture. Section 1.3 was fully executed by the finished plan
`ai/finished_plans/milestone_4_integration_security_launch/audit-trail-completeness-verification/` —
its census (`test/workflows/admin/audit-completeness.catalog.ts`, 28 wired rows, all 7 enum values
wired), drift test (`backend/db/test/logic/audit/audit-census-drift.test.ts`), and completeness journey
(`test/workflows/admin/audit-completeness.journey.test.ts`) are all present in the tree. The real
gaps: (a) NO database trigger unconditionally blocks a hard DELETE on `users` — protection is
"no app path + restrict-FKs", and child profiles CASCADE, so a history-less user is SQL-deletable;
(b) no test asserts historical data remains queryable after soft delete; (c) retention (1.4) is
verified only by grep-absence today — no automated anti-drift guard exists.

## Checklist → Codebase Mapping

| Row # | Criterion (short) | Actual artifact (path:line) | STATUS |
|---|---|---|---|
| 1.1.1 | No user/student/teacher hard-delete; SQL hard-delete must fail | No production `.delete(users)` path (all 88 grep hits in `*.test.ts` teardown); but NO users-delete trigger — profiles cascade: `backend/db/schema/students/students.ts:23` `onDelete:"cascade"`; restrict only via dependents: `backend/db/schema/classes/session.ts:63` (student FK), `backend/db/schema/audit/audit-logs.ts:36` (actor FK); chaos doc `backend/services/admin/user-governance.chaos.test.ts:44-53` | PARTIAL |
| 1.1.2 | All deletions soft (`is_deleted=true`) | `backend/db/repo/admin/admin-user.repository.ts:426-448` `setDeletedOnce` sets `isDeleted:target, deletedAt: target ? new Date() : null`; via `setDeletedAxis` `backend/services/admin/user-governance.helpers.ts:177-225`; `user-management.service.ts:527-536` `setUserDeleted` | VERIFIED |
| 1.1.3 | Soft-deleted user cannot log in (403) | `backend/services/auth/auth.service.ts:117-135` `assertUserActive` throws `ForbiddenError` on `isDeleted`; called at `:199` (login) and on refresh; journey `test/workflows/admin/admin-user-lifecycle.journey.test.ts:339`, `account-governance.journey.test.ts:519` | VERIFIED |
| 1.1.4 | Historical data preserved after soft delete | Structural only: soft delete is an UPDATE (row persists); `session.studentId` restrict-FK `backend/db/schema/classes/session.ts:58-63`; ledgers survive via wallet/`actor_id` restrict FKs (`teacher-transaction.ts:35-37`, `audit-logs.ts:34-36`). No test asserts sessions/reports/payments remain queryable post-delete | PARTIAL |
| 1.1.5 | Admin can reactivate; login restored | `setDeletedOnce(target=false)` clears `deletedAt` to null (`admin-user.repository.ts:433-437`); audit `Reactivate` at `user-governance.helpers.ts:212-218`; tests: `user-management.service.test.ts:1993`, journeys `admin-user-lifecycle.journey.test.ts:357`, `account-governance.journey.test.ts:519` | VERIFIED |
| 1.2.1 | `student_payments` immutable | Trigger `backend/drizzle/20260904084152_custom_3-immutability-triggers/migration.sql:55-76` blocks UPDATE/DELETE; BUT guarded exception: status `pending → paid\|failed` (`student-payments.ts:26-38`, migrations `custom_4-student-payments-status-transition`, `custom_5-student-payments-provider-transaction`). Blanket "UPDATE must fail" is false for pending status decisions | PARTIAL |
| 1.2.2 | `teacher_transaction` immutable | Trigger `3-immutability-triggers/migration.sql:80-101` blocks UPDATE/DELETE; guarded exception: pending withdrawal settlement `pending → completed\|failed` (`teacher-transaction.ts:17-23`, `5-teacher-transaction-settlement.sql`); earning/bonus relabel UPDATE RAISEs (test `financial-immutability.test.ts:428`) | PARTIAL |
| 1.2.3 | Corrections via NEW adjustment transactions | `backend/services/billing/admin-financial-auditing.service.ts:360-430` `adjustTeacherWallet` inserts a NEW ledger row (`WalletRepository.creditBonusOnce` / `debitAdjustmentOnce`) + audit `Adjust` row; compensating-row doctrine test `backend/db/test/logic/billing/financial-immutability.test.ts:457` | VERIFIED |
| 1.2.4 | Financial records have non-null `created_at` | `student-payments.ts:67` and `teacher-transaction.ts:43`: `createdAt: timestamp("created_at").defaultNow().notNull()` | VERIFIED |
| 1.3.1 | Every admin action logged in `audit_logs` | Census `test/workflows/admin/audit-completeness.catalog.ts:84-338` (28 `wired` rows); drift test `backend/db/test/logic/audit/audit-census-drift.test.ts` (bijection vs `role:[UserRole.Admin]` mutations); journey `test/workflows/admin/audit-completeness.journey.test.ts:1581-1950` executes every census row via real services | VERIFIED |
| 1.3.2 | Audit log immutable (append-only) | Triggers `3-immutability-triggers/migration.sql:30-51` (`prevent_audit_logs_update/delete`); schema doc `audit-logs.ts:17-23` (no `updated_at`); static+trigger tiers `backend/db/test/logic/audit/audit-immutability.test.ts:208-268,429`; direct tamper tests `financial-immutability.test.ts:519,537` | VERIFIED |
| 1.3.3 | Audit row captures actor/action/entity/details/created_at | Schema `audit-logs.ts:33-41` (all NOT NULL except nullable `entity_id`/`details`); journey asserts full row shape per census action (`audit-completeness.journey.test.ts` step 2+ assertions) | VERIFIED |
| 1.3.4 | Filter by actor, action type, entity, date range | `backend/services/admin/audit-trail.service.ts` (closed-input filters: actorId, actionType, entityType, entityId, `from`/`to` window, pagination); tests `backend/services/admin/audit-trail.service.test.ts:397,419,439,486`; journey `test/workflows/admin/audit-trail.journey.test.ts:258-445` (7 action-type filters + window + exclusion) | VERIFIED |
| 1.3.5 | All 7 `audit_action_type` values exercised | `audit-completeness.catalog.ts:347-354` `ACTION_TYPE_COVERAGE` — all 7 `"wired"` incl. `Adjust` (producers `adjustTeacherWallet`, `adminExtendApplicantCooldown` at catalog `:265-270,:304-309`); enum `backend/db/schema/enums.ts:66-74` (7 values, per finished-plan G-02) | VERIFIED |
| 1.4.1 | Sessions/reports/evaluations/recitations stored permanently (no purge jobs) | Grep-absence: only cron routes `app/api/cron/{sweep-sessions,expire-subscriptions,reconcile-paymob-payments,sweep-inactive-teachers}` — none DELETE; `sweep-sessions` → `SessionLifecycleService.sweepExpiredSessions` (`session-lifecycle.service.ts:804`) cancels+refunds (UPDATE only); `scripts/ops/sweep-expired-link-requests.ts` materializes parent-link requests to `expired` only; production repo `.delete(` exists ONLY in `lesson.repository.ts:101` (curriculum) + `notification.repository.ts:346`; recitation repo closed surface `recitation.repository.ts:8-12` ("NO update, replace, or delete method") | VERIFIED |
| 1.4.2 | Evaluations only soft-deleted (`is_deleted`) | `backend/db/schema/teachers/evaluations.ts:33,51` (`is_deleted`/`deleted_at`, "no hard delete"); no evaluation delete method in production repo layer (grep `.delete(` → only lesson + notification) | VERIFIED |
| 1.4.3 | Homework permanently retained (no purge jobs) | `backend/db/schema/classes/home-work.ts:23` (no is_deleted, plain table); grep for purge/sweep targeting home_work → nothing; `home-work.repository.ts` has no delete method (grep 'delete' → 0 hits) | VERIFIED |

**Count: VERIFIED 13 · PARTIAL 4 (1.1.1, 1.1.4, 1.2.1, 1.2.2) · MISSING 0 · DEFERRED 0**

## Existing Coverage

| Artifact | What it asserts | Rows covered |
|---|---|---|
| `backend/services/admin/user-management.service.test.ts:1978` | soft-delete happy path: `is_deleted=true`, `deleted_at` set, audit(Delete) | 1.1.2 |
| `backend/services/admin/user-management.service.test.ts:1993` | reactivate: `is_deleted=false`, `deleted_at` null, audit(Reactivate); conflicts `:2031/:2047`; guarded-UPDATE race `:2079` | 1.1.5 |
| `test/workflows/admin/admin-user-lifecycle.journey.test.ts:311,339,357` | real-path journey: soft-delete → login denied at governance gate → reactivate → login restored | 1.1.2, 1.1.3, 1.1.5 |
| `test/workflows/admin/account-governance.journey.test.ts:519` | step 7: soft-delete → login denied; suspend on deleted → USER_ALREADY_DELETED + zero audit; reactivate → login succeeds | 1.1.3, 1.1.5 |
| `backend/db/test/logic/auth/auth.service.test.ts:304,618-692` | soft-deleted caller denied (zero writes); mid-flight soft-delete in-tx guard re-checks written row | 1.1.3 |
| `backend/db/test/logic/billing/financial-immutability.test.ts:319-340` | trigger presence + exactly-two-triggers census on all 3 immutable tables (PG tier, skipped on pglite) | 1.2.1, 1.2.2, 1.3.2 |
| `backend/db/test/logic/billing/financial-immutability.test.ts:364-457` | direct teacher_transaction UPDATE/DELETE rejected + row unchanged; relabel settlement UPDATE RAISEs; compensating INSERT succeeds | 1.2.2, 1.2.3 |
| `backend/db/test/logic/billing/financial-immutability.test.ts:482-537` | student_payments decided-row UPDATE/DELETE rejected; audit_logs UPDATE/DELETE rejected | 1.2.1, 1.3.2 |
| `test/workflows/billing/financial-safety-verification.journey.test.ts:714` | adversarial journey: direct ledger UPDATE blocked by trigger, row reads back byte-identical | 1.2.2 |
| `backend/db/test/logic/audit/audit-immutability.test.ts:208-268` | static tier: zero `update(auditLogs)`/`delete(auditLogs)` callsites + zero raw-SQL UPDATE/DELETE in production corpus; scanner non-vacuity | 1.3.2 |
| `backend/db/test/logic/audit/audit-census-drift.test.ts` | census ↔ shipped admin-gated mutations bijection (corpus-walk of `backend/graphql/mutation/**`) | 1.3.1 |
| `test/workflows/admin/audit-completeness.journey.test.ts:1581-1950` | every census `wired` action executed through real service/DB path; row shape, chronology, zero-missing/zero-phantom oracles | 1.3.1, 1.3.3, 1.3.5 |
| `test/workflows/admin/audit-trail.journey.test.ts:258-445` | filter by entityType+entityId, each of 7 action types, time window; exclusion filters; non-admin denial | 1.3.4 |
| `backend/services/admin/audit-trail.service.test.ts:397-538` | filter validation (enum re-assertion, window bounds, pagination arithmetic, honest empty pages) | 1.3.4 |
| `test/workflows/admin/academic-tracking.journey.test.ts:527` | post-soft-delete academic rows still queryable with `isDeleted:false` targets filtered (adjacent, not a preservation oracle) | (1.1.4 adjacent) |

## Gaps

| Row | Gap | What would close it |
|---|---|---|
| 1.1.1 | No unconditional DB guard: raw `DELETE FROM users WHERE id=X` succeeds for a user with no restrict-FK dependents (child profiles CASCADE: students.ts:23, teacher.ts:24, parents.ts:14, admin.ts:13). "Must fail" holds only when audit rows/sessions/broadcasts exist. No test attempts a hard-delete probe of a fixture user | Either (a) a `prevent_users_delete()` trigger migration mirroring the ledger triggers, or (b) a DB probe test asserting `DELETE FROM users` fails for a user WITH session history (restrict chain) + amend the checklist row to its real semantics ("no application hard-delete path; FK-restrict for any user with history") |
| 1.1.4 | No verification artifact asserts historical data remains after soft delete. Preservation is structural (UPDATE-only delete, restrict FKs), never asserted: sessions, reports, recitations, homework, payments, wallet, audit rows all still queryable post-soft-delete | A journey/db-logic test: soft-delete a student WITH prior sessions/reports/payments → re-query each table → rows present and unchanged; plus assert teacher's earning rows survive teacher soft-delete |
| 1.2.1 | Checklist wording mismatch: blanket "UPDATE must fail" is false for the documented status decision `pending → paid\|failed` + one-time `provider_transaction_id` write (`student-payments.ts:26-46`). Verification must probe: financial-column UPDATE → RAISE; pending→paid guarded UPDATE → succeeds; decided-row UPDATE → RAISE | Re-scope row 1.2.1 verification to the guarded-exception matrix (already mostly tested in `financial-immutability.test.ts:482-501` + `student-payment.repository.test.ts`); add explicit probe for UPDATE of a financial column on a PENDING row if absent there |
| 1.2.2 | Same mismatch: settlement UPDATE `pending → completed\|failed` on a withdrawal row is permitted (`teacher-transaction.ts:17-23`); everything else frozen | Re-scope row verification to guarded-settlement semantics; `financial-immutability.test.ts:364,428` already prove the freeze + relabel-RAISE |
| 1.4.1/1.4.3 | Retention is verified only by grep-absence TODAY — nothing prevents a future `sweep-*` cron or repo delete method from purging sessions/reports/recitations/homework (the audit trail has an anti-drift static test; retention has none) | A static anti-drift test (mirror `audit-census-drift.test.ts`): scan `backend/db/repo/**` for `.delete(` against `session/reports/recitation/homeWork/evaluations` tables + scan `app/api/cron/` + `scripts/ops/` for DELETE statements targeting them → assert zero |

## Harness Recommendations

1. **DB probe tier (new `backend/db/test/logic/`)**: a `data-integrity.probe.test.ts` executing the
   checklist's literal SQL attempts against the real DB (PG tier, pglite-skip like
   `financial-immutability.test.ts:427`): (a) `DELETE FROM users` on a user with session history →
   FK violation (row 1.1.1 conditional proof); (b) `UPDATE student_payments SET amount=...` → RAISE;
   (c) `UPDATE teacher_transaction SET type=...` on earning row → RAISE; (d) `UPDATE/DELETE audit_logs` → RAISE.
2. **Preservation journey (`test/workflows/admin/`)**: extend the existing
   `admin-user-lifecycle.journey.test.ts` pattern with a "delete-with-history" lane — student fixture
   with committed session/report/payment/wallet rows, soft-delete, re-read every table, byte-identical.
3. **Retention anti-drift (`backend/db/test/logic/`)**: static scanner test listing the protected
   retention tables (`session`, `reports`, `recitation`, `home_work`, `evaluations`) and asserting the
   production corpus + cron/ops surfaces contain zero DELETE paths against them (allowlist:
   `lesson.repository.ts` curriculum delete, `notification.repository.ts`).
4. **Reuse, don't rebuild**: rows 1.3.x already have their harness (census/drift/journey triad).
   The launch plan should simply RUN `bun run test/scripts/run-test.ts backend/db/test/logic/audit/*`,
   `test/workflows/admin/audit-completeness.journey.test.ts`, `audit-trail.journey.test.ts`,
   `account-governance.journey.test.ts`, `admin-user-lifecycle.journey.test.ts`, and
   `backend/db/test/logic/billing/financial-immutability.test.ts` and record results as §1.3 sign-off.
5. **Wording amendments** (launch-plan deliverable): rows 1.2.1/1.2.2 should be re-worded to
   "immutable except the documented guarded lifecycle transitions" citing the migrations; row 1.1.1
   should distinguish app-layer (proven) from DB-layer (conditional via FK-restrict).

## Evidence Appendix

```ts
// backend/db/repo/admin/admin-user.repository.ts:429-437 — guarded soft-delete (1.1.2/1.1.5)
const [row] = await (tx ?? db).update(users).set({
  isDeleted: target, deletedAt: target ? new Date() : null, updatedAt: new Date(),
}).where(and(eq(users.id, id), /* inverse-state guards */ ...
```
```ts
// backend/services/auth/auth.service.ts:127-135 — login denial fold (1.1.3)
if (user.isDeleted || user.isBlocked || isSuspensionActive({ ... }, new Date())) {
  throw new ForbiddenError(message);   // called at :199 "deleted / blocked / suspended accounts can't log in"
```
```sql
-- backend/drizzle/20260904084152_custom_3-immutability-triggers/migration.sql:30-33 (audit_logs)
CREATE OR REPLACE FUNCTION prevent_audit_logs_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_logs is immutable — UPDATE is not permitted'; END;
```
```ts
// backend/db/schema/classes/session.ts:58-63 — restrict FKs preserve history (1.1.4)
teacherId: integer("teacher_id").notNull().references(() => teacher.id, { onDelete: "restrict" }),
studentId: integer("student_id").notNull().references(() => users.id, { onDelete: "restrict" }),
```
```ts
// backend/db/schema/students/students.ts:23 — CASCADE child profile (1.1.1 gap)
.references(() => users.id, { onDelete: "cascade" }),  // teacher.ts:24, parents.ts:14, admin.ts:13 same
```
```ts
// backend/db/schema/billing/student-payments.ts:26-31 — guarded immutability exception (1.2.1)
// UPDATE is permitted for exactly one guarded exception: the status decision
// `pending → paid | failed` ... every other mutation raises.
```
```ts
// backend/services/billing/admin-financial-auditing.service.ts:399-404 — adjustment = NEW row (1.2.3)
const ledger = await WalletRepository.creditBonusOnce(
  { walletId: walletRow.id, amount, description: composeCreditDescription(normalizedReason) }, tx);
```
```ts
// backend/db/schema/teachers/evaluations.ts:33 + :51 — evaluation soft-delete only (1.4.2)
* Soft-delete is via `is_deleted`/`deleted_at` (no hard delete).
isDeleted: boolean("is_deleted").default(false),
```
```ts
// backend/db/repo/classes/recitation.repository.ts:10-11 — closed permanence surface (1.4.1)
// There is intentionally NO update, replace, or delete method — a stored record is permanent
```
```ts
// test/workflows/admin/audit-completeness.catalog.ts:347-354 — all 7 enum values wired (1.3.5)
export const ACTION_TYPE_COVERAGE: Record<AuditActionType, "wired" | "fixture" | "deferred"> = {
  [AuditActionType.Create]: "wired", ... [AuditActionType.Adjust]: "wired", };
```
