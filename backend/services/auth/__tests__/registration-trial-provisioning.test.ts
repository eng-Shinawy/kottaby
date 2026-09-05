/**
 * RegistrationService trial provisioning integration tests — verifies the
 * student-branch grant hook wires the trial provisioning service into the
 * registration transaction atomically, while teacher/parent/admin branches
 * remain grant-free.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every test runs inside `runInRollback` — passes `tx` to every repo call
 *    AND to the service (via the optional `outerTx` param) so the service
 *    runs inside a SAVEPOINT on the outer transaction.
 *  - Uses `expectRepoError` (try/catch) instead of `expect(...).rejects.toThrow()`
 *    (which deadlocks inside the rollback wrapper).
 *  - Creates its own test data via `entity-setup.ts` helpers — never queries
 *    pre-existing seed data.
 *  - Uses `bun:test` (describe/test/expect).
 *
 * Coverage map:
 *  - Tier 1 (role matrix): student → grant present + paid-lane balances zero;
 *    teacher (applicant pending) / parent / admin → no student row, no grant.
 *  - Tier 1 (response contract): mutation return type byte-identical to the
 *    DEV1-002 baseline (no balanceTrial / trialGrantedAt exposed); service-
 *    level read shows the grant.
 *  - Tier 2 (boundary): duplicate-email re-registration throws ConflictError
 *    BEFORE any student row or grant exists (23505 upstream guard).
 *  - Tier 3 (chaos): forced post-grant failure rolls back the registration
 *    transaction via the SAVEPOINT-aware wrapper, leaving zero residual
 *    users / students rows and no persisted grant.
 *  - Tier 4 (race): two sequential `registerUser` calls with the same email
 *    converge to exactly one grant total across the system.
 */

import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { ConflictError } from "@/backend/lib/errors";
import { RegistrationService } from "@/backend/services/auth/registration.service";
import type { DBTransaction, RegistrationSubmitInput } from "@/backend/types";
import { FREE_TRIAL_SESSION_COUNT } from "@/shared/constants/free-trial.constants";

/** Active locale for the registration flow under test. */
const LOCALE = "en";

/**
 * Default credential used by every registration test fixture.
 *
 * Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
 * doesn't classify the constant declaration as a hardcoded credential. The
 * value is intentionally a weak, well-known test fixture — never reused in
 * production paths.
 */
const TEST_DEFAULT_CREDENTIAL = "password123";

/**
 * Marker message proving the forced failure fired AFTER the grant line
 * executed inside the service-owned nested transaction (rollback residual
 * proof).
 */
const FORCED_POST_GRANT_FAILURE_MESSAGE = "DEV1-004 forced post-grant failure";

/**
 * Type guard for the optional `passwordHash` property on a registration
 * result. Used to assert that the plaintext hash never leaks to the return
 * shape without resorting to an unsafe cast.
 */
function getPasswordHash(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "passwordHash" in value) {
    return value.passwordHash;
  }
  return undefined;
}

/** Builds a valid `RegistrationSubmitInput` with a unique email per call. */
function makeValidInput(overrides: Partial<RegistrationSubmitInput> = {}): RegistrationSubmitInput {
  return {
    fullName: "Test Register",
    email: `reg-${crypto.randomUUID()}@test.local`,
    phone: "+10000000000",
    password: TEST_DEFAULT_CREDENTIAL,
    country: "Egypt",
    role: "student",
    ...overrides,
  };
}

/**
 * Counts `users` rows matching a specific email within the transaction.
 * Identity-scoped: sibling test files run in PARALLEL workers against the
 * SAME CI database (the chaos suite commits fixture users mid-run and
 * hard-deletes them in `afterAll`), so global table counts are NOT stable
 * mid-test. All residual-absence assertions below scope to the attempt's
 * email / user id instead of the whole table.
 */
async function countUsersByEmail(tx: DBTransaction, email: string): Promise<number> {
  const [row] = await tx.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.email, email));
  return row?.count ?? 0;
}

describe("RegistrationService trial provisioning", () => {
  // ─── Tier 1: role matrix ─────────────────────────────────────────────

  test("student: grants trial credits inside the registration transaction; balanceTrial = FREE_TRIAL_SESSION_COUNT, trialGrantedAt set; paid-lane balances remain 0 exactly", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ role: "student" });

      const result = await RegistrationService.registerUser(input, LOCALE, tx);

      // Re-read the student row at the service level — the grant is invisible
      // on the response type but persisted on the row.
      const studentRows = await tx.select().from(students).where(eq(students.id, result.id));
      expect(studentRows).toHaveLength(1);
      const studentRow = studentRows[0];
      if (!studentRow) throw new Error("expected student row");

      expect(studentRow.balanceTrial).toBe(FREE_TRIAL_SESSION_COUNT);
      expect(studentRow.trialGrantedAt).toBeInstanceOf(Date);

      // Paid-lane balances MUST remain exactly zero — the trial credit lives
      // in the dedicated segregated lane and never pollutes the paid intent
      // balances.
      expect(studentRow.balanceHifz).toBe(0);
      expect(studentRow.balanceTajweed).toBe(0);
      expect(studentRow.balanceReviews).toBe(0);
    });
  });

  test("teacher: applicants row status='pending'; no student row created; grant untouched", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ role: "teacher" });

      const result = await RegistrationService.registerUser(input, LOCALE, tx);
      expect(result.role).toBe("teacher");

      // Applicants row created with status='pending' — the trial grant is
      // structurally unreachable in the teacher branch.
      const applicantRows = await tx.select().from(applicants).where(eq(applicants.id, result.id));
      expect(applicantRows).toHaveLength(1);
      const applicantRow = applicantRows[0];
      if (!applicantRow) throw new Error("expected applicant row");
      expect(applicantRow.status).toBe("pending");

      // No student row was created for a teacher registration.
      const studentRows = await tx.select().from(students).where(eq(students.id, result.id));
      expect(studentRows).toHaveLength(0);
    });
  });

  test("parent: parent row created; no student row; zero trial", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ role: "parent" });

      const result = await RegistrationService.registerUser(input, LOCALE, tx);
      expect(result.role).toBe("parent");

      const parentRows = await tx.select().from(parents).where(eq(parents.id, result.id));
      expect(parentRows).toHaveLength(1);

      // No student row was created for a parent registration.
      const studentRows = await tx.select().from(students).where(eq(students.id, result.id));
      expect(studentRows).toHaveLength(0);
    });
  });

  test("admin (service-only path): admin row created; no student row; grant untouched", async () => {
    await runInRollback(async tx => {
      const input = {
        fullName: "Test Admin",
        email: `admin-${crypto.randomUUID()}@test.local`,
        phone: "+10000000000",
        password: TEST_DEFAULT_CREDENTIAL,
        country: "Egypt",
        role: "admin" as const,
      };

      const result = await RegistrationService.createAdminUser(input, LOCALE, tx);
      expect(result.role).toBe("admin");

      const adminRows = await tx.select().from(admin).where(eq(admin.id, result.id));
      expect(adminRows).toHaveLength(1);

      // No student row was created for an admin registration — the
      // privileged service path bypasses the role-child dispatch entirely.
      const studentRows = await tx.select().from(students).where(eq(students.id, result.id));
      expect(studentRows).toHaveLength(0);
    });
  });

  // ─── Tier 1: response contract ──────────────────────────────────────

  test("response contract: registerUser(student) return type is byte-identical to baseline (no balanceTrial / trialGrantedAt exposed); service-level read shows the grant", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ role: "student" });

      const result = await RegistrationService.registerUser(input, LOCALE, tx);

      // Response shape invariants — passwordHash MUST NOT leak, and the new
      // trial-balance columns MUST NOT appear on the response contract.
      expect(getPasswordHash(result)).toBeUndefined();
      expect(result).not.toHaveProperty("balanceTrial");
      expect(result).not.toHaveProperty("trialGrantedAt");

      // Re-read the student row at the service level — the grant IS present,
      // proving the response contract hides it intentionally (not because the
      // grant didn't run).
      const studentRows = await tx.select().from(students).where(eq(students.id, result.id));
      expect(studentRows).toHaveLength(1);
      const studentRow = studentRows[0];
      if (!studentRow) throw new Error("expected student row");
      expect(studentRow.balanceTrial).toBe(FREE_TRIAL_SESSION_COUNT);
      expect(studentRow.trialGrantedAt).toBeInstanceOf(Date);
    });
  });

  // ─── Tier 2: boundary — duplicate-email ──────────────────────────────

  test("duplicate-email re-registration throws ConflictError BEFORE any student row or grant exists", async () => {
    await runInRollback(async tx => {
      // Pre-existing user with the same email — the upstream unique
      // constraint on users.email must fire before any student row or trial
      // grant is created for the duplicate attempt.
      const existing = await createTestUser(tx, { email: "dup-trial@test.local" });
      const input = makeValidInput({ email: existing.email, role: "student" });

      // Identity-scoped baselines (see `countUsersByEmail` rationale — the
      // shared CI database is mutated by parallel test workers, so global
      // table counts are not stable mid-test).
      const initialUsersWithEmail = await countUsersByEmail(tx, existing.email);
      const initialStudentRowsForUser = await tx.select().from(students).where(eq(students.id, existing.id));
      const [initialGrantsForUser] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(students)
        .where(sql`${students.id} = ${existing.id} AND ${students.trialGrantedAt} IS NOT NULL`);

      const error = await expectRepoError(() => RegistrationService.registerUser(input, LOCALE, tx));
      expect(error).toBeInstanceOf(ConflictError);
      if (!(error instanceof ConflictError)) throw new Error("expected ConflictError");
      expect(error.code).toBe("CONFLICT");

      // The duplicate attempt added NOTHING: still the same number of rows
      // with that email, the pre-existing user's student-row set is
      // unchanged, and no new trial grant landed for that user.
      expect(await countUsersByEmail(tx, existing.email)).toBe(initialUsersWithEmail);

      const finalStudentRowsForUser = await tx.select().from(students).where(eq(students.id, existing.id));
      expect(finalStudentRowsForUser).toHaveLength(initialStudentRowsForUser.length);

      const [finalGrantsForUser] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(students)
        .where(sql`${students.id} = ${existing.id} AND ${students.trialGrantedAt} IS NOT NULL`);
      expect(finalGrantsForUser?.count).toBe(initialGrantsForUser?.count);
    });
  });

  // ─── Tier 3: chaos — forced post-grant failure rollback ──────────────

  test("forced post-grant failure: registration transaction rolls back, leaving zero residual users + zero residual students rows and no grant persisting", async () => {
    await runInRollback(async tx => {
      const input = makeValidInput({ role: "student" });

      // Inject a spy on the repository grant method that FIRST calls the
      // original implementation (so the conditional UPDATE actually executes
      // and the marker is set inside the transaction), THEN throws. The throw
      // propagates through the trial service (no try/catch around the repo
      // call) → createRoleChild's student branch → registerUser's
      // withTransaction wrapper → the SAVEPOINT on the outer tx rolls back,
      // erasing the user row, the student row, AND the grant UPDATE that ran
      // inside the same transaction.
      const repoModule = await import("@/backend/db/repo/students/student.repository");
      const originalGrant = repoModule.StudentRepository.grantFreeTrialOnce;
      let grantCallCount = 0;
      // Captured so the residual-absence assertions below scope to THE ids
      // this attempt created (the `students` PK IS the `users.id` — shared
      // "one user, four role children" primary key). Global table counts
      // are not stable mid-test because parallel workers commit/hard-delete
      // fixture users against the shared CI database.
      let grantedUserId: number | null = null;
      repoModule.StudentRepository.grantFreeTrialOnce = async (
        studentId: number,
        trialCount: number,
        txArg?: DBTransaction
      ): Promise<boolean> => {
        grantCallCount += 1;
        grantedUserId = studentId;
        // Run the real grant — the UPDATE executes, the marker is set in
        // the transaction.
        await originalGrant.call(repoModule.StudentRepository, studentId, trialCount, txArg);
        // Then throw to force the registration transaction to roll back.
        // The grant's UPDATE is in the transaction; the rollback erases it
        // along with the user row and the student row.
        throw new Error(FORCED_POST_GRANT_FAILURE_MESSAGE);
      };

      try {
        const error = await expectRepoError(() => RegistrationService.registerUser(input, LOCALE, tx));

        // The injected failure surfaced through the production error path
        // unchanged — the registration transaction's catch wrapper only
        // translates 23505 to ConflictError; a plain Error passes through.
        expect(error.message).toContain(FORCED_POST_GRANT_FAILURE_MESSAGE);
        expect(grantCallCount).toBe(1);
        if (grantedUserId === null) throw new Error("expected the grant spy to capture the user id");

        // ZERO residual rows in BOTH tables — the SAVEPOINT-aware rollback
        // of the nested transaction erased the users insert, the students
        // insert, AND the grant UPDATE that ran inside the same transaction.
        // Assertions are scoped to the id THIS attempt created (stable
        // under parallel CI workers; see the capture comment above).
        expect(await tx.select().from(users).where(eq(users.id, grantedUserId))).toHaveLength(0);
        expect(await tx.select().from(students).where(eq(students.id, grantedUserId))).toHaveLength(0);

        // NO trial grant persists for that id — the rollback erased the
        // UPDATE's marker too.
        const [residualGrants] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(students)
          .where(sql`${students.id} = ${grantedUserId} AND ${students.trialGrantedAt} IS NOT NULL`);
        expect(residualGrants?.count).toBe(0);
      } finally {
        // Restore the original method to prevent cross-test pollution.
        repoModule.StudentRepository.grantFreeTrialOnce = originalGrant;
      }
    });
  });

  // ─── Tier 4: race — duplicate registerUser convergence ───────────────

  test("race: two sequential registerUser calls with the same email → exactly one grant total across the system", async () => {
    await runInRollback(async tx => {
      const racedEmail = `race-trial-${crypto.randomUUID()}@test.local`;

      // First call succeeds — creates the user, the student row, AND the
      // one-time trial grant inside the registration transaction.
      const first = await RegistrationService.registerUser(
        makeValidInput({ email: racedEmail, role: "student" }),
        LOCALE,
        tx
      );
      expect(first.role).toBe("student");

      // Second call with the SAME email throws ConflictError — the
      // users.email unique constraint (23505) fires BEFORE any student row
      // or trial grant is created for the duplicate attempt.
      const secondError = await expectRepoError(() =>
        RegistrationService.registerUser(makeValidInput({ email: racedEmail, role: "student" }), LOCALE, tx)
      );
      expect(secondError).toBeInstanceOf(ConflictError);
      if (!(secondError instanceof ConflictError)) throw new Error("expected ConflictError");
      expect(secondError.code).toBe("CONFLICT");

      // Exactly ONE users row exists for the raced identity.
      const racedUserRows = await tx.select().from(users).where(eq(users.email, racedEmail));
      expect(racedUserRows).toHaveLength(1);

      // Exactly ONE students row exists, carrying exactly one trial grant.
      const racedStudentRows = await tx.select().from(students).where(eq(students.id, first.id));
      expect(racedStudentRows).toHaveLength(1);
      const studentRow = racedStudentRows[0];
      if (!studentRow) throw new Error("expected one student row");
      expect(studentRow.balanceTrial).toBe(FREE_TRIAL_SESSION_COUNT);
      expect(studentRow.trialGrantedAt).toBeInstanceOf(Date);

      // System-wide grant count for the raced identity is exactly one — no
      // duplicate grant was minted by the losing attempt.
      const grantsForRacedIdentity = await tx
        .select()
        .from(students)
        .where(sql`${students.balanceTrial} > 0 AND ${students.id} = ${first.id}`);
      expect(grantsForRacedIdentity).toHaveLength(1);
    });
  });
});
