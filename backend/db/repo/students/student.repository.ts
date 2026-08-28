/**
 * StudentRepository — data-access layer for the `students` role-child table.
 *
 * The `students` row shares its PK with `users.id` (FK ON DELETE CASCADE) and
 * carries the `handshake_code` parent-linking identifier plus the zeroed
 * credit balances (`balance_hifz`, `balance_tajweed`, `balance_reviews`) and
 * the segregated one-time free-trial lane (`balance_trial`) guarded by the
 * `trial_granted_at` marker.
 *
 * Registration-path writes (`createForRegistration`) take a REQUIRED
 * `tx: DBTransaction` (last param) so the registration transaction can roll
 * back on any child-insert failure (atomicity). The trial grant method
 * (`grantFreeTrialOnce`) accepts an optional `tx` so it can run either inside
 * the registration transaction or standalone against the global handle.
 * Read methods (`findById`) accept an optional `tx` for in-tx reads and fall
 * back to the global Drizzle handle when called standalone.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { students } from "@/backend/db/schema/students/students";
import type { DBTransaction, StudentSelectType } from "@/backend/types";

export namespace StudentRepository {
  /**
   * Inserts a `students` row for a freshly-created user during registration.
   *
   * Balances are explicitly zeroed for clarity-of-contract even though the
   * schema applies `DEFAULT 0`. `handshakeCode` is server-generated
   * by the service layer with a bounded retry loop on unique-violation.
   * `parentId` is `null` at registration — set later via the parent
   * handshake flow.
   *
   * @returns The inserted student row.
   */
  export async function createForRegistration(
    userId: number,
    handshakeCode: string,
    tx: DBTransaction
  ): Promise<StudentSelectType> {
    const [row] = await tx
      .insert(students)
      .values({
        id: userId,
        handshakeCode,
        balanceHifz: 0,
        balanceTajweed: 0,
        balanceReviews: 0,
        parentId: null,
      })
      .returning();
    if (!row) {
      throw new Error("StudentRepository.createForRegistration: insert returned no rows");
    }
    return row;
  }

  /**
   * Finds a `students` row by its primary key (shared with `users.id`).
   *
   * Read-only — used by the student trial provisioning service to look up the
   * current grant marker state before deciding whether to invoke the grant.
   * Accepts an optional transaction so the read can run inside a caller's
   * transaction scope; falls back to the global Drizzle handle when called
   * standalone.
   *
   * @returns The matching student row, or `null` if no student carries that id.
   */
  export async function findById(studentId: number, tx?: DBTransaction): Promise<StudentSelectType | null> {
    const executor = tx ?? db;
    const rows = await executor.select().from(students).where(eq(students.id, studentId)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * Atomically grants free trial session credits to a student exactly once.
   *
   * Single conditional UPDATE guarded by the trial_granted_at marker — predicate
   * evaluation and column mutation occur in the same SQL statement, so the
   * grant-once invariant holds with zero TOCTOU window. Returns true when the
   * grant was applied, false when the marker was already set (re-grant rejected);
   * the caller (student trial service) is responsible for surfacing a localized
   * conflict error on the false branch.
   */
  export async function grantFreeTrialOnce(
    studentId: number,
    trialCount: number,
    tx?: DBTransaction
  ): Promise<boolean> {
    const queryDb = tx ?? db;
    const updated = await queryDb
      .update(students)
      .set({
        balanceTrial: sql`${students.balanceTrial} + ${trialCount}`,
        trialGrantedAt: new Date(),
      })
      .where(and(eq(students.id, studentId), isNull(students.trialGrantedAt)))
      .returning({ id: students.id });
    return updated.length > 0;
  }
}
