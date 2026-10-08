# Research Dossier — Student Account Lifecycle (INV-U1..INV-U5)

Domain: Student Account Lifecycle · Spec: docs/specs/state-machine-invariants.md §6 (lines 224-255) · All paths/lines verified against the live tree on 2026-10-08.

## 1. Invariants in scope

| ID | Doc line | Verbatim statement |
|---|---|---|
| INV-U1 | docs/specs/state-machine-invariants.md:251 | "A soft-deleted student's historical sessions, reports, and financial transactions are preserved." |
| INV-U2 | docs/specs/state-machine-invariants.md:252 | "A suspended student cannot request new sessions during the suspension period." |
| INV-U3 | docs/specs/state-machine-invariants.md:253 | "A blocked student cannot access the platform." |
| INV-U4 | docs/specs/state-machine-invariants.md:254 | "No user, student, or teacher record can be hard-deleted." |
| INV-U5 | docs/specs/state-machine-invariants.md:255 | "A student's session balances are preserved across suspension/blocking/soft-delete." |

States (doc :227-232) and transitions (doc :234-246). Canonical doc: docs/admin/account-governance.md (states table + INV-U4 mandate at :15, lock citations at :96).

**CRITICAL schema note:** all governance columns live on `users`, NOT `students` — `isDeleted`/`deletedAt`/`suspended`/`suspendedAt`/`suspendedPeriodDays`/`isBlocked`/`blockedAt` (backend/db/schema/users/users.ts:37-43). `students` holds only balances/handshake/parent (backend/db/schema/students/students.ts:18-47; docblock :10 states "Governance fields live on users"). The ticket's pointer "students schema (suspended, …)" is stale — every INV-U writer targets `users`.

## 2. Enforcement map

| ID | Mechanism | path:line | Symbol | Fragment |
|---|---|---|---|---|
| U1 | Soft-delete is a narrow guarded UPDATE touching only users cols; FKs keep children rows | backend/db/repo/admin/admin-user.repository.ts:428-448 | `AdminUserRepository.setDeletedOnce` | `.set({ isDeleted, deletedAt, updatedAt })` — no other table written; `session_student_id_…_fkey ON DELETE RESTRICT` (backend/drizzle/20260904084151_omniscient_karen_page/migration.sql:442-446), `student_payments…ON DELETE RESTRICT` (:382) |
| U2 | Booking governance re-check on the student actor | backend/services/classes/session-lifecycle.service.ts:214 | `SessionLifecycleService.createSession` → `assertActorGovernanceClean` (backend/services/classes/session-lifecycle.governance.ts:47-61, denial at :53 `!actor \|\| actor.isDeleted \|\| actor.isBlocked \|\| actor.suspended`) | throws `ForbiddenError(t.forbidden)` before tx opens |
| U2 | Evaluation-booking analog (governed caller denied) | backend/services/teachers/evaluation-booking.service.test.ts:501 cites the gate | denial matrix test | governed caller (deleted/blocked/suspended) cannot book |
| U3 | Login gate | backend/services/auth/auth.service.ts:199 (call), :117-141 (`assertUserActive`: `isDeleted \|\| isBlocked \|\| isSuspensionActive(...)`) | `AuthService.login` | `ForbiddenError(t.accountBlocked)` |
| U3 | Refresh-token gate | backend/services/auth/auth.service.ts:270 | `AuthService.refreshToken` → `assertUserActive` | same denial |
| U3 | SSR gate | backend/lib/auth/server-auth.ts:119, :153 (`isSuspensionActive` consumed) | `getServerUserContext` | governed → anonymous context (fail-closed) |
| U3 | Service-tier re-checks (defense in depth for still-valid tokens) | backend/services/classes/session-lifecycle.governance.ts:47/:86 | `assertActorGovernanceClean` / `assertRoleGovernanceClean` | e.g. admin gates `assertActiveActorAdmin` (backend/services/admin/admin-gate.helpers.ts) |
| U4 | **NO DB trigger on users/students/teacher** — app-layer discipline only; locked by static scan | backend/graphql/test/inv-u4-grep-lock.test.ts:52/:61/:94 | `PRODUCTION_LAYERS`, `PROTECTED_ENTITIES` = users/students/teacher/parents/applicants, `WHITELIST` | grep-lock suite asserts zero `.delete()` in backend/db/repo + backend/services (:211-238) and zero `hardDelete*`/`deleteUser` Mutation/Query fields (:264-282) |
| U4 | Partial runtime backstop via FK `ON DELETE RESTRICT` | backend/drizzle/20260904084151_omniscient_karen_page/migration.sql:442-446, :382, :378, :398, :490 | FK constraints | session→teacher/students, student_payments→students, audit_logs→users, subscriptions→users, evaluations(evaluator)→users all RESTRICT |
| U5 | Governance UPDATEs structurally exclude balance columns | backend/db/repo/admin/admin-user.repository.ts:435-439 (delete), :517-522 (suspend), :572-576 (block) | `setDeletedOnce`/`setSuspendedOnce`/`setBlockedOnce` | SET clauses touch only their own cols + `updatedAt`; balance cols live on `students` and are unreachable |

No CHECK constraint / DB trigger exists for U1-U5 on users/students. The only custom triggers cover `audit_logs`/`student_payments`/`teacher_transaction` (backend/drizzle/20260904084152_custom_3-immutability-triggers/migration.sql:30-101; sources backend/db/migration/3-immutability-triggers.sql). `wallet.repository.test.ts:893-895` warns these triggers exist only in migrate-provisioned environments.

## 3. Existing coverage

| ID | Verdict | Test path:line | Test name | What it asserts |
|---|---|---|---|---|
| U1 | GAP | — | — | No test asserts sessions/reports/payments survive soft-delete. Adjacent: admin-user-lifecycle journey (test/workflows/admin/admin-user-lifecycle.journey.test.ts:311-377) proves login denied after soft-delete + reactivate restores, but never re-reads child history rows |
| U2 | COVERED | backend/services/classes/session-lifecycle.service.test.ts:752 | "governed students are denied FORBIDDEN on create — isDeleted, isBlocked, and suspended each fail closed with zero writes" | suspended student → `createSession` throws `ForbiddenError` (`FORBIDDEN`) pre-tx with zero writes (:757-771) |
| U2 (window nuance) | PARTIAL | backend/services/admin/user-governance.service.test.ts:1357 | "ALLOWS lapsed suspension … (REQ-019)" | pins LAPSED→login ALLOWED; the booking path's stricter raw-boolean denial for lapsed suspension is unpinned |
| U3 | PARTIAL | backend/services/admin/user-governance.service.test.ts:1332 | "denies blocked → ForbiddenError(accountBlocked)" | blocked login denied (also test/workflows/admin/account-governance.journey.test.ts:481, :534) |
| U3 (SSR) | COVERED | backend/lib/auth/server-auth.test.ts:190-191 | "returns anonymous context and logs domain error for blocked user (fail-closed)" | blocked → anonymous SSR context (:186-201 covers deleted/blocked/active-suspension) |
| U3 (refresh) | GAP | — | — | `AuthService.refreshToken`'s `assertUserActive` (auth.service.ts:270) has NO test; only happy-path use at test/workflows/teachers/applicant-student-conversion.journey.test.ts:1050 |
| U4 | COVERED | backend/graphql/test/inv-u4-grep-lock.test.ts:211 | "scans backend/db/repo + backend/services for .delete() targeting protected entities — ZERO findings" | static proof: zero production hard-delete writers for users/students/teacher/parents/applicants; schema surface pinned in backend/graphql/test/schema-surface.test.ts (Mutation inventory, list at :211/:244/:314) |
| U5 | PARTIAL | backend/services/admin/user-management.service.test.ts:2151 | "admin operations on one user do NOT touch another user's row, balances, or applicant record" | SIBLING users' `students` rows (incl. balances) byte-identical across an admin create+soft-delete; same shape in user-governance.service.test.ts:976 (suspend/block) and account-governance.journey.test.ts:773 (step 10 Teacher control). Missing: the TARGET's own balance lanes byte-identical across its own governance transitions |

Suspension-window predicate semantics (fail-closed, lapse boundary) are unit-covered: backend/lib/auth/suspension-window.test.ts (import pin at :117-118).

## 4. Recommended tests for PARTIAL/GAP

| ID | Target test file | Layer rules | Assertion approach | Fixtures |
|---|---|---|---|---|
| U1 | backend/db/test/logic/students/student_status_history.test.ts (name pre-documented in backend/db/test/logic/AGENTS.md:23; subdir exists) | runInRollback + tx everywhere; expectRepoError try/catch; bun:test | Snapshot `session`/`reports`/`student_payments` rows for the student, run `AdminUserManagementService.setUserDeleted(id, true, …)` (and a full suspend→block→soft-delete ladder), re-select by ids → `toEqual` byte-identical; also assert login denied + `setUserDeleted(false)` reactivate keeps history | createTestUser(role:"student") + createTestStudent + createTestTeacherRow + createTestSession + createTestSessionReport + createTestStudentPayment (needs createTestSubscription for non-null sub id — verify signature entity-setup.ts:222 before use) |
| U2 (pin stricter semantics) | backend/services/classes/session-lifecycle.service.test.ts (extend the Tier-1 governance block at :752) | service test co-located; runInRollback + tx | Seed a LAPSED suspension (`suspended: true, suspendedAt: now-15d, suspendedPeriodDays: 7` via createTestUser overrides); assert `createSession` STILL denies FORBIDDEN (raw-boolean guard, session-lifecycle.governance.ts:53) — pins the deliberate stricter-than-login behavior; comment cites the doc-vs-code mismatch | createTestUser overrides only |
| U3 (refresh) | backend/db/test/logic/auth/auth.service.test.ts (sibling of the login/changeMyPassword suites) | runInRollback + tx | Committed-credential fixture (bcrypt hash via RegistrationService — copy the D11 pattern at user-governance.service.test.ts:1227-1302); `AuthService.refreshToken` on a token issued pre-block → `ForbiddenError(accountBlocked)`; also suspended-active and deleted arms | RegistrationService.registerUser + setUserBlocked/setUserSuspended/setUserDeleted; note refreshToken opens its own `db.transaction` — committed fixtures + deleteUsersByIds teardown, NOT runInRollback (mirror D11 at :1205-1319) |
| U3 (runtime delete-arm pin) | same file | — | assert blocked/deleted users with still-valid tokens are denied by the service-tier re-checks on every governed mutation surface (already covered for sessions); document the GraphQL-context governance window as out of scope (notification-integration.matrix.test.ts:1190-1194) | — |
| U4 (runtime complement) | backend/db/test/logic/students/student_status_history.test.ts (or shared/) | runInRollback + tx; NEVER expect(...).rejects | FK-RESTRICT probe, savepoint-bracketed per the canonical pattern (backend/db/test/repo/billing/wallet.repository.test.ts:475-520): `savepoint u4_probe` → `tx.execute(sql`DELETE FROM users WHERE id = ${id}`)` inside try/catch → expect PG FK violation (23503) message (`session_student_id_…_fkey`) → `rollback to savepoint`; ALSO pin the negative: raw DELETE on an un-referenced user SUCCEEDS inside the same savepoint then rolls back — this documents that INV-U4 is app-layer (the grep-lock) + FK backstop, NOT a trigger. Do NOT write a test expecting a `prevent_users_delete` trigger — none exists | student + teacher row + one session row (createTestSession) |
| U5 | backend/db/test/logic/students/student_status_transition.test.ts (name pre-documented in logic/AGENTS.md:23) | runInRollback + tx | Seed non-zero lanes via createTestStudent overrides (`balanceHifz: 3, balanceTajweed: 2, balanceReviews: 1, balanceTrial: 1`); snapshot `students` row; run setUserSuspended(true)→setUserBlocked(true)→setUserDeleted(true)→reactivate→unblock→unsuspend ladder; re-read `students` row → `toEqual` byte-identical (incl. trialGrantedAt) | createTestUser + createTestStudent(overrides) + provisionAdminActor pattern (user-governance.service.test.ts:164-171) |

Optional journey (test/workflows/admin/): one cross-actor extension of account-governance.journey.test.ts step-flow — S books a session pre-suspension, is suspended, tries createSession (denied), is unsuspended, books again, is soft-deleted, history re-read byte-identical. NO runInRollback (test/workflows/AGENTS.md:8); committed fixtures + registry cleanup + DIAGRAMS.md mermaid update (rule 13, :55-62).

## 5. Fixture/helper needs (verified signatures)

- `createTestUser(tx: DBTransaction, overrides: Partial<UserSelectType> = {}): Promise<UserSelectType>` — backend/db/test/entity-setup.ts:74-77. Governance defaults false; overrides accept `suspended/suspendedAt/suspendedPeriodDays/isBlocked/blockedAt/isDeleted/deletedAt` (used at user-governance.service.test.ts:250-255, :353, :427-431).
- `createTestStudent(tx, userId, overrides: Partial<StudentSelectType> = {}): Promise<StudentSelectType>` — entity-setup.ts:104-108; defaults `balanceHifz/Tajweed/Reviews: 0` (:114-116); `balanceTrial` overridable via overrides (schema default 0, students.ts:27).
- `createTestAdmin(tx, userId)` — entity-setup.ts:169; `createTestParent(tx, userId)` — :131; `createTestApplicant` — :143.
- `createTestTeacherRow(tx, userId, overrides: Partial<TeacherSelectType> = {})` — entity-setup.ts:550-554 (isApproved: true default — satisfies booking's certification gate).
- `createTestSession(tx, teacherId, studentId, overrides)` — entity-setup.ts:303-308 (status `scheduled` default).
- `createTestSessionReport(tx, sessionId, overrides)` — entity-setup.ts:344-348.
- `createTestStudentPayment(tx, studentId, subscriptionId: number | null, overrides)` — entity-setup.ts:264-269 (signature verified; needs `createTestSubscription` — entity-setup.ts:222, signature NOT verified).
- `runInRollback` / `expectRepoError` from `@/backend/db/test/test-utils` (imported at user-governance.service.test.ts:78).
- `deleteUsersByIds` / `countUsersByIds` from `@/test/helpers/db-cleanup` (committed-fixture teardown; wraps `withAuditDeleteTriggersSuspended` — account-governance.journey.test.ts:266-273).
- Savepoint-bracket pattern for raw-SQL constraint trips: `tx.execute(sql`savepoint …`)` … `rollback to savepoint` (wallet.repository.test.ts:485-520).

## 6. Notes for the plan

1. **Doc-vs-schema drift:** the ticket pointer says governance flags live on the students schema; they live on `users` (users.ts:37-43, students.ts:10 docblock). Tests must target `AdminUserRepository`/`users` writers; the doc §6.1 table itself is column-name-only, so no doc edit is strictly required, but the plan should say so once.
2. **INV-U4 is app-layer-only.** No `BEFORE DELETE` trigger on users/students/teacher/evaluations exists (only audit_logs/student_payments/teacher_transaction, custom_3-immutability-triggers). Raw `DELETE FROM users` succeeds for un-referenced users and CASCADE-deletes role children (students/teacher/admin/parents/applicants FKs are CASCADE — migration :470-:506). The invariant is enforced and locked by the static grep-lock suite; the plan's runtime tests must assert FK-RESTRICT backstop + NOT expect a trigger. `evaluations` are outside `PROTECTED_ENTITIES` (inv-u4-grep-lock.test.ts:61) and were even raw-DELETE-deduped once (backend/drizzle/20260913160232_elite_gambit/migration.sql:5) — INV-E2 (evaluations) belongs to the Evaluations dossier.
3. **INV-U2 enforcement is stricter than the doc:** the booking guard denies on the raw `suspended` boolean (session-lifecycle.governance.ts:53), so a LAPSED suspension still blocks booking, while login/SSR use the window predicate (`isSuspensionActive`, suspension-window.ts:46). The plan should pin the stricter behavior with a comment, not "fix" it (test-writing plan, no product changes).
4. **Transition-matrix mismatch:** doc §6.2 (:235-246) omits Suspended→Blocked and Blocked→Suspended, but `setSuspendedOnce`/`setBlockedOnce` predicates (admin-user.repository.ts:523-529/:577-583) permit both (they exclude only `is_deleted`). Tests should codify shipped semantics (cross-axis transitions succeed) and record the doc gap; doc-matrix tests as written would fail.
5. **Trigger-provision caveat:** custom SQL triggers only exist on migrate-provisioned DBs (wallet.repository.test.ts:893-895). The U1/U5 tests here need no triggers; any sibling-plan trigger-trip tests must run against a migrate-provisioned `kottaby_test`.
6. **Scope boundaries:** INV-U3's "platform access" is enforced at login/refresh/SSR + per-service re-checks; the GraphQL bearer-token context deliberately does NOT re-check governance (documented window, notification-integration.matrix.test.ts:1190-1194) — the plan must scope INV-U3 tests to the enforced tiers and cite that window, not attempt a context-tier denial test. Parent-portal read path deliberately allows a blocked parent (parent-monitoring.service.test.ts:1143) — do not conflate with student access.
7. **Sibling-plan overlap:** INV-U2 shares the booking gate with INV-B4/B8 (Session Balance dossier — same `createSession` flow, different assertions); INV-U4's schema-surface pin overlaps the Plans dossier (INV-PC3) only by pattern, not by file. Coordination point: extend the existing Tier-1 block at session-lifecycle.service.test.ts:752 rather than creating a parallel file.
