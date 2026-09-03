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
 * (`grantFreeTrialOnce`) and the held-balance lane debit/refund methods
 * (`decrementLaneIfAvailable` / `incrementLane`) accept an optional `tx` so
 * they can run either inside a caller's transaction or standalone against
 * the global handle.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - Writes (`createForRegistration`) take a REQUIRED `tx` (atomicity);
 *    debit/refund use `queryDb` raw parameterized SQL on the
 *    non-transactional branch and the Drizzle builder on the transactional
 *    branch.
 *  - Reads are read-only, single-scalar/parameterized equality lookups that
 *    take an OPTIONAL `tx` (last param) and use `queryDb` (raw parameterized
 *    SQL) on the non-transactional branch, mirroring `UserRepository`
 *    `findByEmail` / `findById` — Neon HTTP fast path when eligible, Drizzle
 *    select inside a supplied transaction. No prepared statements (single
 *    equality, no reuse win), no `inArray`, no LIKE/ILIKE, no `sql` templates.
 *  - Zero business rules, zero log strings, zero i18n imports — reads return
 *    `null` on miss; the service layer owns validation, governance filtering
 *    and error mapping.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, queryDb } from "@/backend/db";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import type { DBQueryExecutor, DBTransaction, HandshakeDiscoveryRowType, StudentSelectType } from "@/backend/types";

/**
 * Frozen held-balance-lane → `students` balance-column resolution map.
 *
 * Keys are the `HeldBalanceLane` enum members themselves — never caller
 * strings — so a debit/refund statement can only ever target one of the
 * three real balance columns. The `Record<HeldBalanceLane, AnyPgColumn>`
 * annotation makes a missing enum member a compile error, and
 * `Object.freeze` blocks any runtime mutation of the resolution table.
 * The `reviews` lane is deliberately absent: it never funds held fees.
 */
const LANE_BALANCE_COLUMNS: Readonly<Record<HeldBalanceLane, AnyPgColumn>> = Object.freeze({
  [HeldBalanceLane.Trial]: students.balanceTrial,
  [HeldBalanceLane.Hifz]: students.balanceHifz,
  [HeldBalanceLane.Tajweed]: students.balanceTajweed,
});

/** Type guard — narrows `DBQueryExecutor` to `DBTransaction`. */
function isDBTransaction(tx: DBQueryExecutor): tx is DBTransaction {
  return typeof tx === "object" && "select" in tx;
}

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
   * The insert runs inside its own savepoint (a Drizzle nested transaction
   * opened on the supplied `tx`): a unique-constraint rejection rolls back
   * ONLY this insert and rethrows the driver error unchanged, leaving the
   * caller's transaction usable. That is what lets the registration
   * service's bounded collision retry regenerate a fresh code and insert
   * again on the SAME transaction — without the savepoint, a rejected
   * insert aborts the surrounding transaction and every subsequent
   * statement on it fails with an aborted-transaction error. On success the
   * savepoint is released, which is transparent to the surrounding
   * registration transaction (same atomicity as a bare insert).
   *
   * @returns The inserted student row.
   */
  export async function createForRegistration(
    userId: number,
    handshakeCode: string,
    tx: DBTransaction
  ): Promise<StudentSelectType> {
    return tx.transaction(async sp => {
      const [row] = await sp
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
    });
  }

  /**
   * Reads the `handshake_code` of the `students` row sharing the given user id
   * (shared PK ≡ `users.id`).
   *
   * Single-column equality read — Drizzle select on the supplied transaction,
   * or raw parameterized SQL via `queryDb` (Neon HTTP fast path) when called
   * outside a transaction. Acquires no locks (pure read).
   *
   * @returns The row's `handshakeCode`, or `null` when no `students` row has
   *          that id (the caller owns not-found handling).
   */
  export async function findHandshakeCodeByStudentId(studentId: number, tx?: DBTransaction): Promise<string | null> {
    if (tx) {
      // Transactional read — Drizzle select on the supplied executor.
      const rows = await tx
        .select({ handshakeCode: students.handshakeCode })
        .from(students)
        .where(eq(students.id, studentId))
        .limit(1);
      return rows[0]?.handshakeCode ?? null;
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<{ handshakeCode: string }>(
      `SELECT handshake_code AS "handshakeCode" FROM students WHERE id = $1 LIMIT 1`,
      [studentId]
    );
    return result.rows[0]?.handshakeCode ?? null;
  }

  /**
   * Discovery read for parent-side handshake-code lookup: joins `students` to
   * `users` on the shared PK and returns EXACTLY the columns the service layer
   * needs for governance evaluation, name masking and the `linkable` signal —
   * a fixed column list, never spread-driven.
   *
   * The ONLY predicate is the parameterized equality on `handshake_code`
   * (`WHERE handshake_code = $1`); no LIKE/ILIKE, no `sql` templates, no
   * `inArray`. Governance filtering (deleted/blocked/suspended) is a service
   * concern — this method returns the row faithfully, or `null` on miss.
   *
   * @returns The joined discovery row, or `null` when no student carries that
   *          handshake code.
   */
  export async function findDiscoveryByHandshakeCode(
    code: string,
    tx?: DBTransaction
  ): Promise<HandshakeDiscoveryRowType | null> {
    // Shared parameterized read — identical column aliases on both branches.
    const readSql = `SELECT s.parent_id AS "parentId",
            u.full_name AS "fullName",
            u.is_deleted AS "isDeleted",
            u.is_blocked AS "isBlocked",
            u.suspended,
            u.suspended_at AS "suspendedAt",
            u.suspended_period_days AS "suspendedPeriodDays"
     FROM students s
     JOIN users u ON u.id = s.id
     WHERE s.handshake_code = $1
     LIMIT 1`;
    if (tx) {
      // Transactional read — Drizzle select on the supplied executor.
      const rows = await tx
        .select({
          parentId: students.parentId,
          fullName: users.fullName,
          isDeleted: users.isDeleted,
          isBlocked: users.isBlocked,
          suspended: users.suspended,
          suspendedAt: users.suspendedAt,
          suspendedPeriodDays: users.suspendedPeriodDays,
        })
        .from(students)
        .innerJoin(users, eq(users.id, students.id))
        .where(eq(students.handshakeCode, code))
        .limit(1);
      return rows[0] ?? null;
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<HandshakeDiscoveryRowType>(readSql, [code]);
    return result.rows[0] ?? null;
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
  export async function findById(studentId: number, tx?: DBQueryExecutor): Promise<StudentSelectType | null> {
    if (tx && isDBTransaction(tx)) {
      const rows = await tx.select().from(students).where(eq(students.id, studentId)).limit(1);
      return rows[0] ?? null;
    }
    const result = await queryDb<StudentSelectType>(
      `SELECT id, balance_hifz AS "balanceHifz", balance_reviews AS "balanceReviews",
              balance_tajweed AS "balanceTajweed", balance_trial AS "balanceTrial",
              trial_granted_at AS "trialGrantedAt",
              primary_language AS "primaryLanguage", another_language AS "anotherLanguage",
              handshake_code AS "handshakeCode", parent_id AS "parentId",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM students WHERE id = $1 LIMIT 1`,
      [studentId]
    );
    return result.rows[0] ?? null;
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
    const executor = tx ?? db;
    const updated = await executor
      .update(students)
      .set({
        balanceTrial: sql`${students.balanceTrial} + ${trialCount}`,
        trialGrantedAt: new Date(),
      })
      .where(and(eq(students.id, studentId), isNull(students.trialGrantedAt)))
      .returning({ id: students.id });
    return updated.length > 0;
  }

  /**
   * Atomically debits ONE allowance unit from the student's held-balance
   * lane when the lane still holds a positive balance.
   *
   * ONE guarded conditional UPDATE per call: the balance predicate
   * (`balance_<lane> > 0`) and the decrement share a single statement, so
   * the check-and-subtract happens atomically under PostgreSQL's row lock
   * (zero TOCTOU — a concurrent debit serializes on the same row and
   * re-evaluates the predicate against the post-decrement value). The lane
   * column is resolved exclusively through the frozen `LANE_BALANCE_COLUMNS`
   * map keyed by `HeldBalanceLane` enum members; caller strings can never
   * select a column.
   *
   * `updated_at` is stamped explicitly because the raw-SQL statement bypasses
   * the query-builder's `$onUpdate` hook. The `balance_* >= 0` CHECK
   * constraints stay untouched as the DB-layer backstop — the guarded
   * predicate prevents the negative write from ever being attempted.
   *
   * @returns `true` when the row matched and the unit was debited, `false`
   *   when the student is unknown or the lane balance was already zero (the
   *   caller decides what the miss means — the repository raises nothing).
   */
  export async function decrementLaneIfAvailable(
    studentId: number,
    lane: HeldBalanceLane,
    tx?: DBTransaction
  ): Promise<boolean> {
    const balanceColumn = LANE_BALANCE_COLUMNS[lane];
    const executor = tx ?? db;
    const result = await executor.execute<{ id: number }>(sql`
      UPDATE ${students}
      SET ${sql.identifier(balanceColumn.name)} = ${balanceColumn} - 1,
          ${sql.identifier(students.updatedAt.name)} = now()
      WHERE ${students.id} = ${studentId} AND ${balanceColumn} > 0
      RETURNING ${students.id}
    `);
    return result.rows.length > 0;
  }

  /**
   * Refunds ONE allowance unit to the student's held-balance lane
   * (unguarded `+ 1`). No upper bound exists on any lane, so the
   * `balance_* >= 0` CHECK constraints cannot trip on an increment; the
   * caller guarantees the student row exists (a refund targets the lane
   * recorded on a held session whose student FK is restrict-bound).
   *
   * Same-lane rule: the refunded lane is the caller's choice — refunds must
   * target the exact lane that funded the hold. `updated_at` is stamped
   * explicitly (raw SQL bypasses the `$onUpdate` hook), mirroring the debit
   * statement so both mutation shapes advance the row's audit timestamp.
   */
  export async function incrementLane(studentId: number, lane: HeldBalanceLane, tx?: DBTransaction): Promise<void> {
    const balanceColumn = LANE_BALANCE_COLUMNS[lane];
    const executor = tx ?? db;
    await executor.execute(sql`
      UPDATE ${students}
      SET ${sql.identifier(balanceColumn.name)} = ${balanceColumn} + 1,
          ${sql.identifier(students.updatedAt.name)} = now()
      WHERE ${students.id} = ${studentId}
    `);
  }
}
