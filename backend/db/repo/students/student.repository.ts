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
 * (`grantFreeTrialOnce`), the held-balance lane debit/refund methods
 * (`decrementLaneIfAvailable` / `incrementLane`) and the subscription
 * activation credit (`creditLaneBalance`) accept an optional `tx` so
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
 *
 * File layout: the subscription activation credit (`creditLaneBalance` and
 * its frozen `CREDIT_LANE_BALANCE_COLUMNS` lane→column map) lives in the
 * sibling `student.repository.credit-lane.helpers.ts` module (extracted
 * verbatim); the namespace's `creditLaneBalance` method is a one-to-one
 * delegation wrapper, so the public API (names, signatures, behavior) is
 * unchanged. The subscription-lane expiry zeroing
 * (`zeroLaneIfNoCoveringSubscription` and its frozen
 * `ZERO_LANE_BALANCE_COLUMNS` map) follows the same extraction pattern in
 * the sibling `student.repository.zero-lane.helpers.ts` module. The exact
 * lane-value settlement write (`setLaneBalanceValue` and its frozen
 * `LANE_BALANCE_VALUE_SETTERS` map) follows the same extraction pattern in
 * the sibling `student.repository.lane-value.helpers.ts` module. The admin
 * student directory listing (`listDirectory` with its filter-chain builder,
 * aliased parent join handle and the two directory contracts) follows the
 * same extraction pattern in the sibling
 * `student.repository.directory.helpers.ts` module — the namespace's
 * `listDirectory` method is a one-to-one delegation wrapper and the two
 * directory contracts are re-exported verbatim, so the public API (names,
 * signatures, behavior, import paths) is unchanged.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, queryDb } from "@/backend/db";
import * as studentRepositoryCreditLaneImpl from "@/backend/db/repo/students/student.repository.credit-lane.helpers";
import type {
  AdminStudentDirectoryRow,
  NormalizedAdminStudentFilters,
} from "@/backend/db/repo/students/student.repository.directory.helpers";
import * as studentRepositoryDirectoryImpl from "@/backend/db/repo/students/student.repository.directory.helpers";
import * as studentRepositoryLaneValueImpl from "@/backend/db/repo/students/student.repository.lane-value.helpers";
import * as studentRepositoryZeroLaneImpl from "@/backend/db/repo/students/student.repository.zero-lane.helpers";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import type { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import type {
  DBQueryExecutor,
  DBTransaction,
  HandshakeDiscoveryRowType,
  ParentLinkedChildReturnType,
  StudentLinkTargetRowType,
  StudentSelectType,
} from "@/backend/types";

export type {
  AdminStudentDirectoryRow,
  NormalizedAdminStudentFilters,
} from "@/backend/db/repo/students/student.repository.directory.helpers";

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

/**
 * Shared joined projection for handshake-code lookups: the users-side
 * governance columns plus the display name, composed once and reused by both
 * public read methods (`findDiscoveryByHandshakeCode`,
 * `findLinkTargetByHandshakeCode`) — never re-derived per call site.
 */
const HANDSHAKE_GOVERNANCE_SHAPE = {
  parentId: students.parentId,
  fullName: users.fullName,
  isDeleted: users.isDeleted,
  isBlocked: users.isBlocked,
  suspended: users.suspended,
  suspendedAt: users.suspendedAt,
  suspendedPeriodDays: users.suspendedPeriodDays,
} as const;

/**
 * Shared joint reader behind BOTH handshake-code lookups: resolves the
 * student by a single parameterized equality on `handshake_code`, joining
 * `users` on the shared PK. Drizzle select on the supplied transaction, or
 * raw parameterized SQL via `queryDb` (Neon HTTP fast path) when called
 * standalone — identical column aliases on both branches.
 *
 * The ONLY predicate is the equality on `handshake_code` (`WHERE
 * s.handshake_code = $1`); no LIKE/ILIKE, no `sql` templates, no `inArray`.
 * Governance filtering is a service concern — the row is returned
 * faithfully, or `null` on miss.
 */
async function readHandshakeCodeJoinRow(code: string, tx?: DBTransaction): Promise<StudentLinkTargetRowType | null> {
  // Shared parameterized read — identical column aliases on both branches.
  const readSql = `SELECT s.id AS "studentId",
          s.parent_id AS "parentId",
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
      .select({ studentId: students.id, ...HANDSHAKE_GOVERNANCE_SHAPE })
      .from(students)
      .innerJoin(users, eq(users.id, students.id))
      .where(eq(students.handshakeCode, code))
      .limit(1);
    return rows[0] ?? null;
  }
  // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
  const result = await queryDb<StudentLinkTargetRowType>(readSql, [code]);
  return result.rows[0] ?? null;
}

export namespace StudentRepository {
  /** * Inserts a `students` row for a freshly-created user during registration. */
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
   * Implemented on top of the shared `readHandshakeCodeJoinRow` reader (which
   * also backs `findLinkTargetByHandshakeCode`); the student id fetched
   * internally is dropped here — this shape never carries the raw identity.
   *
   * @returns The joined discovery row, or `null` when no student carries that
   *          handshake code.
   */
  export async function findDiscoveryByHandshakeCode(
    code: string,
    tx?: DBTransaction
  ): Promise<HandshakeDiscoveryRowType | null> {
    const row = await readHandshakeCodeJoinRow(code, tx);
    if (!row) {
      return null;
    }
    // Exact picked shape — the raw student id is intentionally NOT part of
    // the discovery contract (the parent-facing lookup must never carry it).
    return {
      parentId: row.parentId,
      fullName: row.fullName,
      isDeleted: row.isDeleted,
      isBlocked: row.isBlocked,
      suspended: row.suspended,
      suspendedAt: row.suspendedAt,
      suspendedPeriodDays: row.suspendedPeriodDays,
    };
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
   * Reads a `students` row by primary key under a `FOR UPDATE` row lock —
   * the subscription plan-change flow's owner-row certification read. The
   * lock (held to the transaction's end) serializes the balance read with
   * the caller's later exact-value lane settlement, so a concurrent booking
   * debit can never commit in between.
   *
   * `tx` is REQUIRED (not optional): a locking read without a transaction
   * releases its lock as soon as the statement finishes, which would make
   * the read→settle serialization meaningless (mirrors the teacher
   * repository's `lockForCertificationCheck` convention).
   *
   * @returns The locked student row, or `null` when no `students` row
   *          exists for the id (the caller owns the not-found handling).
   */
  export async function findByIdForUpdate(studentId: number, tx: DBTransaction): Promise<StudentSelectType | null> {
    const rows = await tx.select().from(students).where(eq(students.id, studentId)).for("update");
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
   * Server-internal joint read for the parent-link WRITE path: resolves the
   * link target by handshake code, returning the raw student id plus the
   * parent FK and the users-side governance columns the discovery exclusion
   * predicate consumes (`StudentLinkTargetRowType` — service-internal, never
   * serialized; the parent-facing payload remains `HandshakeDiscoveryRowType`
   * → `HandshakeCodeLookupReturnType` via `findDiscoveryByHandshakeCode`).
   *
   * Delegates to the shared `readHandshakeCodeJoinRow` reader (also backing
   * `findDiscoveryByHandshakeCode`): single parameterized equality on
   * `handshake_code` (no LIKE/ILIKE), dual executor branch,
   * `LIMIT 1`. Mirrors `findDiscoveryByHandshakeCode` with `s.id` added so
   * the write path can address the target row directly. Governance filtering
   * is a service concern — the row is returned faithfully, or `null` on miss.
   *
   * @returns The link-target row, or `null` when no student carries that
   *          handshake code.
   */
  export async function findLinkTargetByHandshakeCode(
    code: string,
    tx?: DBTransaction
  ): Promise<StudentLinkTargetRowType | null> {
    return readHandshakeCodeJoinRow(code, tx);
  }

  /**
   * Atomically links a parent to an UNLINKED student — ONE guarded
   * statement: `UPDATE students SET parent_id = $2, updated_at = now()
   * WHERE id = $1 AND parent_id IS NULL RETURNING *`. The `parent_id IS
   * NULL` conjunct is the guard: predicate evaluation and column mutation
   * occur in the same SQL statement, so the once-only invariant holds with
   * zero TOCTOU window (no read-then-write, no locks).
   *
   * This is THE only production writer of a non-null `students.parent_id`
   * (pinned by the static-locks suite). Requires a transaction so
   * the write joins the caller's atomic unit — in the link-request accept
   * path a lost race here (null return → conflict error) rolls back the
   * whole claim transaction, making ghost confirmations impossible.
   *
   * @returns The updated student row, or `null` when the student does not
   *          exist or already carries a `parent_id` (zero-row collapse).
   */
  export async function linkParentIfUnlinked(
    studentId: number,
    parentId: number,
    tx: DBTransaction
  ): Promise<StudentSelectType | null> {
    const [row] = await tx
      .update(students)
      .set({ parentId, updatedAt: sql`now()` })
      .where(and(eq(students.id, studentId), isNull(students.parentId)))
      .returning();
    return row ?? null;
  }

  /** lane when the lane still holds a positive balance. */
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

  /**
   * Credits `amount` session units to ONE student balance lane — the
   * activation-time write for a purchased subscription (one unguarded
   * `COALESCE(balance_<lane>, 0) + amount` UPDATE returning the updated
   * row). Implementation lives in the sibling
   * `student.repository.credit-lane.helpers.ts` module (behavior-identical
   * extraction); this method is a one-to-one delegation wrapper, so the
   * public API (name, signature, behavior) is unchanged.
   *
   * @returns The updated student row, or null when the student does not
   *   exist (the caller decides what the miss means — the repository raises
   *   nothing).
   */
  export async function creditLaneBalance(
    studentId: number,
    lane: SubscriptionCreditLane,
    amount: number,
    tx?: DBTransaction
  ): Promise<StudentSelectType | null> {
    return studentRepositoryCreditLaneImpl.creditLaneBalance(studentId, lane, amount, tx);
  }

  /**
   * Sets ONE student balance lane to an EXACT value (`SET balance_<lane> =
   * <value> ... RETURNING`) — the admin plan-change settlement write: the
   * old lane's remaining contribution is superseded by the new plan's
   * prepared total (its full session count plus a computed carry on the
   * upgrade leg) in a single statement, so a concurrent booking debit
   * cannot interleave a relative increment. The lane column resolves
   * exclusively through the frozen `SubscriptionCreditLane`-keyed setter
   * map (caller strings can never select a column); the `balance_* >= 0`
   * CHECK constraints backstop the server-computed value — a violation
   * (a negative target, unreachable through the service's arithmetic)
   * surfaces as the raw 23514 for the service tier to translate into the
   * localized conflict.
   *
   * Implementation lives in the sibling
   * `student.repository.lane-value.helpers.ts` module (same extraction
   * convention as `creditLaneBalance`); this method is a one-to-one
   * delegation wrapper, so the public API (name, signature, behavior) is
   * unchanged.
   *
   * @returns The updated student row, or null when the student does not
   *   exist (the caller decides what the miss means — the repository raises
   *   nothing).
   */
  export async function setLaneBalanceValue(
    studentId: number,
    lane: SubscriptionCreditLane,
    newValue: number,
    tx?: DBTransaction
  ): Promise<StudentSelectType | null> {
    return studentRepositoryLaneValueImpl.setLaneBalanceValue(studentId, lane, newValue, tx);
  }

  /** boolean for lanes-zeroed counting). */
  export async function zeroLaneIfNoCoveringSubscription(
    studentId: number,
    lane: SubscriptionCreditLane,
    tx?: DBTransaction
  ): Promise<boolean> {
    return studentRepositoryZeroLaneImpl.zeroLaneIfNoCoveringSubscription(studentId, lane, tx);
  }

  /**
   * Lists the admin student directory: `students` rows INNER JOINed to
   * their `users` accounts on the shared PK, with the linked parent's
   * display identity resolved via a LEFT JOIN on `users`-as-parent.
   *
   * Implementation lives in the sibling
   * `student.repository.directory.helpers.ts` module (same extraction
   * convention as `creditLaneBalance`); this method is a one-to-one
   * delegation wrapper, so the public API (name, signature, behavior) is
   * unchanged. Statement-shape notes — the dynamic AND filter chain (search
   * pattern bound as a parameter, case-insensitive language equality), the
   * deterministic newest-account-first ordering, the page+count round-trip
   * pair and the page-query-only parent join — are documented on the
   * implementation.
   *
   * @returns The raw directory rows plus the unfiltered-by-page total (NOT
   *          the return type — the service layer maps rows →
   *          `AdminStudentItemReturnType`).
   */
  export async function listDirectory(
    filters: NormalizedAdminStudentFilters,
    limit: number,
    offset: number,
    tx?: DBTransaction
  ): Promise<{ rows: AdminStudentDirectoryRow[]; total: number }> {
    return studentRepositoryDirectoryImpl.listDirectory(filters, limit, offset, tx);
  }

  /**
   * Lists the caller's confirmed-linked children, oldest-first. Soft-deleted
   * excluded — the severance predicate lives in the JOIN, never the service.
   *
   * Read-only, two executor arms (per backend/AGENTS.md "Bare Reads"): on the
   * caller's transaction it runs as a Drizzle join select; standalone it runs
   * as raw parameterized SQL via `queryDb` (the parent id rides a bound
   * parameter — the Neon-HTTP-eligible pattern, never the global Drizzle
   * handle). The raw-SQL column aliases mirror the Drizzle projection keys so
   * both arms return the identical `ParentLinkedChildReturnType` shape.
   */
  export async function listLinkedChildrenByParentId(
    parentId: number,
    tx?: DBTransaction
  ): Promise<ParentLinkedChildReturnType[]> {
    if (tx) {
      return tx
        .select({ id: students.id, fullName: users.fullName, createdAt: students.createdAt })
        .from(students)
        .innerJoin(users, eq(users.id, students.id))
        .where(and(eq(students.parentId, parentId), eq(users.isDeleted, false)))
        .orderBy(asc(students.createdAt), asc(students.id));
    }
    const result = await queryDb<{ id: number; fullName: string; createdAt: Date | string }>(
      `SELECT s.id AS id, u.full_name AS "fullName", s.created_at AS "createdAt"
       FROM students s
       INNER JOIN users u ON u.id = s.id
       WHERE s.parent_id = $1 AND u.is_deleted = false
       ORDER BY s.created_at ASC, s.id ASC`,
      [parentId]
    );
    return result.rows.map(row => ({
      id: row.id,
      fullName: row.fullName,
      createdAt: new Date(row.createdAt),
    }));
  }
}
