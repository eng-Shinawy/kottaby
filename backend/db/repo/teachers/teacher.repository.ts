/**
 * TeacherRepository — data-access layer for the `teacher` table.
 *
 * The `teacher` row shares its PK with `users.id` (FK ON DELETE CASCADE) and
 * exists only for users who passed the verification pipeline; a failed
 * applicant keeps an `applicants` row and never gets a `teacher` row.
 *
 * `is_approved` is the certification flag. Booking flows must re-assert it
 * against the SAME transaction that later writes the dependent rows, so the
 * flag cannot flip between the check and the write. The single method here
 * takes that lock (`SELECT ... FOR UPDATE`) and hands the caller the
 * certification state for the duration of the caller's transaction.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - One `namespace` per repository file; the namespace name is the canonical
 *    export `{Entity}Repository`.
 *  - Locking reads belong to the write path: they always run inside a
 *    caller-supplied transaction (a row lock that is released when the
 *    statement ends, i.e. one taken outside a transaction, protects nothing)
 *    and therefore never use prepared statements
 *    (`docs/drizzle/prepared-statements.md`).
 *  - No business logic, no permission checks, no i18n or logging imports —
 *    the caller decides what `isApproved = false` or a `null` row means.
 */
import { eq } from "drizzle-orm";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import type { DBTransaction } from "@/backend/types";

export namespace TeacherRepository {
  /**
   * Locks the `teacher` row for the supplied transaction and reads its
   * certification state (`SELECT id, is_approved FROM teacher WHERE id = $1
   * FOR UPDATE` via Drizzle `.for("update")`).
   *
   * The row lock is held until the caller's transaction commits or rolls
   * back: any concurrent transaction that locks the same row serializes
   * behind it, and the certification value read here is the value the
   * caller's subsequent writes commit against, with no window for the flag
   * to flip in between.
   *
   * `tx` is REQUIRED (not optional): a locking read without a transaction
   * releases its lock as soon as the statement finishes, which would make
   * the certification re-assertion meaningless.
   *
   * @returns The minimal `{ id, isApproved }` projection, or `null` when no
   *          `teacher` row exists for the id (e.g. a teacher-applicant's
   *          `users.id` — holding an applicant row never mints certification).
   *          `isApproved` mirrors the column's DB-level nullability
   *          (`boolean | null`); treating `null` as "not certified" is the
   *          caller's decision.
   */
  export async function lockForCertificationCheck(
    teacherId: number,
    tx: DBTransaction
  ): Promise<{ id: number; isApproved: boolean | null } | null> {
    const rows = await tx
      .select({ id: teacher.id, isApproved: teacher.isApproved })
      .from(teacher)
      .where(eq(teacher.id, teacherId))
      .for("update");
    return rows[0] ?? null;
  }
}
