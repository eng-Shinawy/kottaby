/**
 * Student soft-delete history preservation — the INV-U1 preservation probe
 * (`docs/specs/state-machine-invariants.md` §6) plus the INV-U4 FK backstop.
 *
 * What this file pins (and what it deliberately does NOT duplicate):
 *  - INV-U1: a student's `session` / `reports` / `student_payments` rows
 *    stay byte-identical across the full governance ladder
 *    (suspend → block → soft-delete → reactivate → unblock → unsuspend)
 *    driven through the real admin governance mutations. Governance lives
 *    on `users` (`backend/db/schema/users/users.ts` — the role-child and
 *    history tables are never written by a governance transition), so every
 *    history row must survive every rung byte-identical.
 *  - INV-U4 backstop: the GUC-gated `prevent_users_delete` trigger on
 *    `users` is armed in production, but every pooled test connection
 *    inherits the `kottaby.users_delete_guard=off` opt-out from the DB
 *    client's startup-options packet (`backend/db/client.ts`), so this
 *    suite exercises the FK tier BEHIND it — `session.student_id`
 *    references `users.id` ON DELETE RESTRICT
 *    (`session_student_id_users_id_fkey`), so the raw DELETE is rejected
 *    with the restrict FK violation (SQLSTATE 23001 on PostgreSQL ≥ 18,
 *    23503 on PG ≤ 17 — the code is server-version dependent; the named
 *    constraint is the version-independent oracle). An UN-referenced
 *    user's raw DELETE succeeds (and cascades the role child) — the
 *    documented accepted boundary BEHIND the armed production guard.
 *    The trigger itself is probed by its own dedicated suite
 *    (`backend/db/test/logic/shared/data-integrity.probe.test.ts`) —
 *    deliberately not duplicated here.
 *  - INV-U1 (login arm): login is denied while the student is soft-deleted,
 *    and reactivation restores access with history intact. Login resolves
 *    its identity through the GLOBAL pool (`UserRepository.findByEmail`
 *    without a transaction) and cannot observe an uncommitted
 *    `runInRollback` row, so this arm runs on a committed fixture provisioned
 *    in `beforeAll` and torn down in `afterAll` (the committed-credential
 *    pattern used by the sibling `logic/auth` suites); every other case in
 *    this file runs inside `runInRollback`.
 *
 * Not re-authored here (single-home rule, `backend/db/test/logic/AGENTS.md`):
 *  - the production writer-absence grep-lock
 *    (`backend/graphql/test/inv-u4-grep-lock.test.ts`) stays THE INV-U4
 *    enforcement — this file only adds the FK backstop;
 *  - the admin-user-lifecycle journey
 *    (`test/workflows/admin/admin-user-lifecycle.journey.test.ts`) already
 *    pins the cross-actor login denial + reactivate flow;
 *  - sibling-user balance isolation is pinned in
 *    `backend/services/admin/user-management.service.test.ts` — the
 *    TARGET's own history/balance byte-identity is what this file owns.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { reports } from "@/backend/db/schema/classes/reports";
import { session } from "@/backend/db/schema/classes/session";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestAdmin,
  createTestSession,
  createTestSessionReport,
  createTestStudent,
  createTestStudentPayment,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { probeInsideSavepoint } from "@/backend/db/test/logic/invariants/invariant-probe.helpers";
import { hasPostgresRestrictCode } from "@/backend/db/test/pg-error";
import { constraintNameOf, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { ForbiddenError } from "@/backend/lib/errors";
import { AdminUserManagementService } from "@/backend/services/admin/user-management.service";
import { AuthService } from "@/backend/services/auth/auth.service";
import { RegistrationService } from "@/backend/services/auth/registration.service";
import type { DBTransaction } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
// Deep import (NOT the `@/test/helpers` barrel) — the barrel pulls the
// Apollo test client into a backend-suite module graph; the db-cleanup
// module itself only needs drizzle + the db handle.
import {
  countUsersByIds,
  deleteSessionsByParticipantUserIds,
  deleteUsersByIds,
  withImmutabilityTriggersSuspended,
} from "@/test/helpers/db-cleanup";

const LOCALE = "en";
const EN_AUTH = getServerTranslations(LOCALE).authTranslations;

/** Test credential for the committed login fixture — weak, test-only. */
const FIXTURE_PASSWORD = "StatusHistory1";

/** Suspension window (days) for the ladder's suspend rung. */
const SUSPEND_PERIOD_DAYS = 7;

/** Provisions a super-admin actor (users row + admin role-child row). */
async function provisionAdminActor(tx: DBTransaction) {
  const actor = await createTestUser(tx, { role: "admin" });
  await createTestAdmin(tx, actor.id);
  return actor;
}

/** Full-row snapshot helpers keyed by the fixture's own ids. */
async function readSessionRow(tx: DBTransaction, id: number) {
  const [row] = await tx.select().from(session).where(eq(session.id, id)).limit(1);
  return row ?? null;
}

async function readReportRow(tx: DBTransaction, sessionId: number) {
  const [row] = await tx.select().from(reports).where(eq(reports.sessionId, sessionId)).limit(1);
  return row ?? null;
}

async function readPaymentRow(tx: DBTransaction, id: number) {
  const [row] = await tx.select().from(studentPayments).where(eq(studentPayments.id, id)).limit(1);
  return row ?? null;
}

async function readUsersRow(tx: DBTransaction, id: number) {
  const [row] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

/**
 * Seeds one student's full history set (teacher + session + report + payment)
 * inside the supplied transaction. The payment carries a null subscription
 * (the column is a nullable FK — the financial-transaction row itself is
 * what INV-U1 preserves).
 */
async function seedStudentHistory(tx: DBTransaction, studentUserId: number) {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  const teacherRow = await createTestTeacherRow(tx, teacherUser.id);
  const sessionRow = await createTestSession(tx, teacherRow.id, studentUserId);
  await createTestSessionReport(tx, sessionRow.id);
  const paymentRow = await createTestStudentPayment(tx, studentUserId, null);
  return { teacherUserId: teacherUser.id, sessionId: sessionRow.id, paymentId: paymentRow.id };
}

describe("INV-U1 — soft-delete history preservation (rollback tier)", () => {
  test("INV-U1: session/reports/student_payments rows are byte-identical across the full suspend→block→soft-delete→reactivate ladder", async () => {
    await runInRollback(async tx => {
      const actor = await provisionAdminActor(tx);
      const studentUser = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, studentUser.id);
      const { sessionId, paymentId } = await seedStudentHistory(tx, studentUser.id);

      const sessionBefore = await readSessionRow(tx, sessionId);
      const reportBefore = await readReportRow(tx, sessionId);
      const paymentBefore = await readPaymentRow(tx, paymentId);

      // Outbound ladder: suspend → block → soft-delete. Every rung goes
      // through the real guarded admin mutation on the SAME transaction.
      await AdminUserManagementService.setUserSuspended(
        studentUser.id,
        true,
        SUSPEND_PERIOD_DAYS,
        actor.id,
        LOCALE,
        tx
      );
      await AdminUserManagementService.setUserBlocked(studentUser.id, true, actor.id, LOCALE, tx);
      await AdminUserManagementService.setUserDeleted(studentUser.id, true, actor.id, LOCALE, tx);

      // Liveness proof at the ladder's peak — the history rows must be
      // preserved WHILE the account is fully governed, not only after.
      expect((await readUsersRow(tx, studentUser.id))?.isDeleted).toBe(true);
      expect(await readSessionRow(tx, sessionId)).toEqual(sessionBefore);
      expect(await readReportRow(tx, sessionId)).toEqual(reportBefore);
      expect(await readPaymentRow(tx, paymentId)).toEqual(paymentBefore);

      // Return ladder: reactivate → unblock → unsuspend.
      await AdminUserManagementService.setUserDeleted(studentUser.id, false, actor.id, LOCALE, tx);
      await AdminUserManagementService.setUserBlocked(studentUser.id, false, actor.id, LOCALE, tx);
      await AdminUserManagementService.setUserSuspended(studentUser.id, false, null, actor.id, LOCALE, tx);

      // Governance is fully restored AND every history row is byte-identical.
      const userAfter = await readUsersRow(tx, studentUser.id);
      expect(userAfter?.isDeleted).toBe(false);
      expect(userAfter?.isBlocked).toBe(false);
      expect(userAfter?.suspended).toBe(false);
      expect(await readSessionRow(tx, sessionId)).toEqual(sessionBefore);
      expect(await readReportRow(tx, sessionId)).toEqual(reportBefore);
      expect(await readPaymentRow(tx, paymentId)).toEqual(paymentBefore);
    });
  });

  test("INV-U4 backstop: a referenced-user raw DELETE raises the restrict FK violation in a savepoint (SQLSTATE 23001 on PG≥18, 23503 on PG≤17); an unreferenced-user DELETE succeeds then rolls back", async () => {
    await runInRollback(async tx => {
      // Referenced leg: the user is the direct RESTRICT target of the
      // session FK (`session.student_id` → `users.id`) — the raw DELETE
      // must raise the named restrict violation inside the savepoint
      // bracket and the row must survive it.
      const referencedUser = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, referencedUser.id);
      const { sessionId } = await seedStudentHistory(tx, referencedUser.id);

      const restrictError = await probeInsideSavepoint(tx, "u4 referenced user delete", () =>
        tx.execute(sql`DELETE FROM users WHERE id = ${referencedUser.id}`)
      );
      // The restrict FK rejection — SQLSTATE 23001 on PG ≥ 18, 23503 on
      // PG ≤ 17 (version-dependent; see hasPostgresRestrictCode). Assert
      // the FK-rejection code + named constraint + cause-chain text.
      expect(hasPostgresRestrictCode(restrictError)).toBe(true);
      expect(constraintNameOf(restrictError)).toBe("session_student_id_users_id_fkey");
      expect((await readUsersRow(tx, referencedUser.id))?.id).toBe(referencedUser.id);
      expect((await readSessionRow(tx, sessionId))?.id).toBe(sessionId);

      // Unreferenced leg: a user with only its role-child student row (no
      // sessions, no payments, no audit rows) deletes cleanly — the role
      // child cascades away with it. No database trigger exists to raise;
      // the outer rollback discards the delete.
      const unreferencedUser = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, unreferencedUser.id);

      await tx.delete(users).where(eq(users.id, unreferencedUser.id));
      expect(await readUsersRow(tx, unreferencedUser.id)).toBeNull();
      const [orphanedChild] = await tx.select().from(students).where(eq(students.id, unreferencedUser.id)).limit(1);
      expect(orphanedChild).toBeUndefined();
    });
  });
});

/**
 * Committed fixture for the INV-U1 login arm: `AuthService.login` resolves
 * its identity through the GLOBAL db (`UserRepository.findByEmail` without
 * a transaction — the production bare-pool read), which cannot observe an
 * uncommitted `runInRollback` row. The fixture is therefore committed in
 * `beforeAll` and removed in `afterAll` — first the append-only payment row
 * (its immutability guard is suspended for the teardown window only), then
 * the sessions (reports cascade with them), then the users via
 * `deleteUsersByIds`.
 */
const loginArmFixtureIds: number[] = [];
let loginArmEmail = "";
let loginArmStudentId = 0;
let loginArmAdminId = 0;
let loginArmHistory: { sessionId: number; paymentId: number } | null = null;

describe("INV-U1 — login denial while deleted (committed fixture)", () => {
  beforeAll(async () => {
    loginArmHistory = await db.transaction(async tx => {
      const actor = await provisionAdminActor(tx);
      loginArmAdminId = actor.id;
      loginArmFixtureIds.push(actor.id);

      // Registered through the production registration path so the student
      // gets a REAL bcrypt credential the login gate can verify.
      const registered = await RegistrationService.registerUser(
        {
          fullName: "Status History Student",
          email: `status-history-${randomUUID()}@test.local`,
          phone: "+10000000000",
          password: FIXTURE_PASSWORD,
          country: "EG",
          role: "student",
        },
        LOCALE,
        tx
      );
      loginArmStudentId = registered.id;
      loginArmEmail = registered.email;
      loginArmFixtureIds.push(registered.id);

      const history = await seedStudentHistory(tx, registered.id);
      loginArmFixtureIds.push(history.teacherUserId);
      return { sessionId: history.sessionId, paymentId: history.paymentId };
    });
  });

  afterAll(async () => {
    if (loginArmFixtureIds.length === 0) return;
    // The student_payments ledger is append-only at runtime — its delete
    // guard is suspended ONLY for this teardown window (harness helper).
    await withImmutabilityTriggersSuspended(["student_payments"], () =>
      db.execute(sql`DELETE FROM student_payments WHERE student_id = ${loginArmStudentId}`)
    );
    // Sessions RESTRICT-delete their participants; reports cascade with
    // the session row.
    await deleteSessionsByParticipantUserIds(loginArmFixtureIds);
    const deleted = await deleteUsersByIds(loginArmFixtureIds);
    expect(deleted).toBe(loginArmFixtureIds.length);
    expect(await countUsersByIds(loginArmFixtureIds)).toBe(0);
  });

  test("INV-U1: login is denied while deleted; reactivation keeps history intact", async () => {
    if (!loginArmHistory) throw new Error("login-arm fixture not provisioned");
    const { sessionId, paymentId } = loginArmHistory;

    // Baseline: the history rows exist while the account is live.
    const [sessionBefore] = await db.select().from(session).where(eq(session.id, sessionId)).limit(1);
    const [reportBefore] = await db.select().from(reports).where(eq(reports.sessionId, sessionId)).limit(1);
    const [paymentBefore] = await db.select().from(studentPayments).where(eq(studentPayments.id, paymentId)).limit(1);

    // Soft-delete commits on its own transaction (the production shape).
    await AdminUserManagementService.setUserDeleted(loginArmStudentId, true, loginArmAdminId, LOCALE);

    // Login is denied while the account is soft-deleted.
    const error = await expectRepoError(() => AuthService.login(loginArmEmail, FIXTURE_PASSWORD, LOCALE));
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.message).toContain(EN_AUTH.accountBlocked);

    // The denial wrote nothing: history rows are byte-identical.
    const [sessionWhileDeleted] = await db.select().from(session).where(eq(session.id, sessionId)).limit(1);
    const [reportWhileDeleted] = await db.select().from(reports).where(eq(reports.sessionId, sessionId)).limit(1);
    const [paymentWhileDeleted] = await db
      .select()
      .from(studentPayments)
      .where(eq(studentPayments.id, paymentId))
      .limit(1);
    expect(sessionWhileDeleted).toEqual(sessionBefore);
    expect(reportWhileDeleted).toEqual(reportBefore);
    expect(paymentWhileDeleted).toEqual(paymentBefore);

    // Reactivation restores access — and the history is still intact.
    await AdminUserManagementService.setUserDeleted(loginArmStudentId, false, loginArmAdminId, LOCALE);
    const authSession = await AuthService.login(loginArmEmail, FIXTURE_PASSWORD, LOCALE);
    expect(authSession.user.id).toBe(loginArmStudentId);

    const [sessionAfter] = await db.select().from(session).where(eq(session.id, sessionId)).limit(1);
    const [reportAfter] = await db.select().from(reports).where(eq(reports.sessionId, sessionId)).limit(1);
    const [paymentAfter] = await db.select().from(studentPayments).where(eq(studentPayments.id, paymentId)).limit(1);
    expect(sessionAfter).toEqual(sessionBefore);
    expect(reportAfter).toEqual(reportBefore);
    expect(paymentAfter).toEqual(paymentBefore);
  });
});
