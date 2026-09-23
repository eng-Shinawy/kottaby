/**
 * StudentPaymentRepository — data-access layer for the `student_payments`
 * payment ledger.
 *
 * The table is IMMUTABLE at the database layer: a BEFORE UPDATE trigger
 * permits exactly one mutation — the status lifecycle `pending → paid` or
 * `pending → failed` with every financial/identity column frozen
 * (`student_id`, `subscription_id`, `amount`, `currency`, `payment_gateway`,
 * `created_at`) — and a BEFORE DELETE trigger blocks removal entirely.
 * Every violated expectation raises an exception from the trigger.
 *
 * Consequently the decision writes are single guarded UPDATEs
 * (`markPaidOnce` / `markFailedOnce`) whose `status = 'pending'` predicate
 * is the concurrency lock: a replayed delivery matches zero rows and the
 * caller replays instead of re-deciding. No SELECT-then-UPDATE anywhere.
 * No column other than `status` / `updated_at` is ever written by these
 * writers unless the caller supplies the provider transaction reference —
 * the one-time `provider_transaction_id` recording (NULL → value) the
 * trigger admits inside that same guarded decision; the repo and the
 * trigger agree on that single permitted exception.
 *
 * Reads follow the `backend/db/repo/AGENTS.md` "Neon HTTP Client for Bare
 * Reads (CRITICAL)" rule: non-transactional reads run as raw parameterized SQL
 * through `queryDb` (Neon HTTP fast path when eligible); when a transaction is
 * supplied, the read executes as a Drizzle select on that executor.
 *
 * Write methods take an optional `tx: DBTransaction` as their last parameter.
 *
 * The admin-audit row mapper (raw pgEnum → canonical TS enum narrowing)
 * lives in the sibling
 * `student-payment.repository.admin-row.helpers.ts` module — the namespace's
 * `listForAdminAudit` mapper delegates to it one-to-one.
 */
import { and, asc, desc, eq, gte, ilike, lt, lte, sql } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { toAdminPaymentRow } from "@/backend/db/repo/billing/student-payment.repository.admin-row.helpers";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import type { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { ConflictError } from "@/backend/lib/errors";
import type {
  AdminStudentPaymentRow,
  DBQueryExecutor,
  DBTransaction,
  NormalizedAdminPaymentFilters,
  StudentPaymentInsertType,
  StudentPaymentSelectType,
} from "@/backend/types";

/**
 * One stale-pending ledger row joined with the subscription's payment
 * reference — the provider correlation key a gateway transaction inquiry
 * needs. Derived from the canonical select row, so the ledger columns stay
 * single-sourced.
 */
export type StalePendingPaymentWithReferenceRow = StudentPaymentSelectType & {
  paymentReference: string | null;
};

/**
 * Type guard — narrows `DBQueryExecutor` to `DBTransaction`.
 *
 * `DBTransaction` (Drizzle's `PgAsyncTransaction`) exposes the `.select()`
 * builder API; raw `Pool` / `PoolClient` from `pg` do not. The presence of
 * `.select` therefore distinguishes the two at runtime without an unsafe
 * cast.
 */
function isDBTransaction(tx: DBQueryExecutor): tx is DBTransaction {
  return typeof tx === "object" && "select" in tx;
}

/** Shared column projection with camelCase aliasing for raw `queryDb` reads. */
const PAYMENT_READ_COLUMNS = `
  id, student_id AS "studentId", subscription_id AS "subscriptionId",
  amount, currency, payment_gateway AS "paymentGateway", status,
  provider_transaction_id AS "providerTransactionId",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

/**
 * Column projection for the payment ⟕ subscription read: both tables share
 * `id` / `status` / `created_at` / `updated_at` column names, so every
 * ledger column is qualified by table and aliased to its camelCase shape.
 */
const PAYMENT_WITH_REFERENCE_READ_COLUMNS = `
  student_payments.id,
  student_payments.student_id AS "studentId",
  student_payments.subscription_id AS "subscriptionId",
  student_payments.amount,
  student_payments.currency,
  student_payments.payment_gateway AS "paymentGateway",
  student_payments.status,
  student_payments.provider_transaction_id AS "providerTransactionId",
  student_payments.created_at AS "createdAt",
  student_payments.updated_at AS "updatedAt",
  subscriptions.payment_reference AS "paymentReference"
`;

/**
 * Admin-audit column projection for raw `queryDb` reads — the payment
 * columns plus the student's display name resolved through the
 * `students` → `users` join (students share their PK with `users.id`;
 * email is not wired to the admin surface). Payment columns are qualified
 * with `student_payments.` because the join makes the bare `id` ambiguous.
 */
const ADMIN_PAYMENT_READ_COLUMNS = `
  student_payments.id, student_payments.student_id AS "studentId",
  student_payments.subscription_id AS "subscriptionId",
  student_payments.amount AS "amount", student_payments.currency AS "currency",
  student_payments.payment_gateway AS "paymentGateway",
  student_payments.status AS "status",
  student_payments.provider_transaction_id AS "providerTransactionId",
  student_payments.created_at AS "createdAt",
  student_payments.updated_at AS "updatedAt",
  users.full_name AS "studentName"
`;

/**
 * Builds the ANDed predicate chain from the normalized admin-audit filters.
 * Absent or null members are skipped (the audit view falls back to the
 * unfiltered listing rather than erroring). `studentNameSearch` carries the
 * service-escaped, `%..%`-wrapped pattern and is bound directly to the
 * `ilike` predicate — never re-escaped. Returns `undefined` when no filter
 * applies (Drizzle treats it as no WHERE clause).
 */
function buildAdminPaymentFilterChain(filters: NormalizedAdminPaymentFilters) {
  const conditions = [];
  if (filters.studentId !== null) {
    conditions.push(eq(studentPayments.studentId, filters.studentId));
  }
  if (filters.studentNameSearch !== null) {
    conditions.push(ilike(users.fullName, filters.studentNameSearch));
  }
  if (filters.status !== null) {
    conditions.push(eq(studentPayments.status, filters.status));
  }
  if (filters.paymentGateway !== null) {
    conditions.push(eq(studentPayments.paymentGateway, filters.paymentGateway));
  }
  if (filters.from !== null) {
    conditions.push(gte(studentPayments.createdAt, filters.from));
  }
  if (filters.to !== null) {
    conditions.push(lte(studentPayments.createdAt, filters.to));
  }
  if (conditions.length === 0) {
    return undefined;
  }
  if (conditions.length === 1) {
    return conditions[0];
  }
  return and(...conditions);
}

/**
 * Builds the raw-SQL predicate chain for the non-transactional
 * `queryDb` admin-audit branch, mirroring `buildAdminPaymentFilterChain`
 * exactly. `params` collects the bound values in order; every predicate
 * uses a positional placeholder — no string interpolation of values.
 * Returns the empty string when no filter applies.
 */
function buildAdminPaymentRawFilterChain(filters: NormalizedAdminPaymentFilters, params: unknown[]): string {
  const clauses: string[] = [];
  if (filters.studentId !== null) {
    clauses.push(`student_payments.student_id = $${params.push(filters.studentId)}`);
  }
  if (filters.studentNameSearch !== null) {
    clauses.push(`users.full_name ILIKE $${params.push(filters.studentNameSearch)}`);
  }
  if (filters.status !== null) {
    clauses.push(`student_payments.status::text = $${params.push(filters.status)}`);
  }
  if (filters.paymentGateway !== null) {
    clauses.push(`student_payments.payment_gateway::text = $${params.push(filters.paymentGateway)}`);
  }
  if (filters.from !== null) {
    clauses.push(`student_payments.created_at >= $${params.push(filters.from)}`);
  }
  if (filters.to !== null) {
    clauses.push(`student_payments.created_at <= $${params.push(filters.to)}`);
  }
  return clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
}
/**
 * One guarded status decision — the shared body of the paid/failed
 * writers. The update touches ONLY the lifecycle status (plus the bookkeep
 * timestamp) and, when the caller supplies it, the one-time provider
 * transaction reference; the DB trigger re-verifies that every frozen
 * financial column is unchanged, so a pending payment is the only row that
 * can ever match.
 *
 * The optional reference rides INSIDE the same single statement: the
 * amended trigger admits it only as a NULL → value write during the
 * guarded transition, so it can never be recorded after the fact, never be
 * overwritten, and never be erased — and a replayed delivery (zero rows)
 * records nothing.
 */
async function markStatusOnce(
  subscriptionId: number,
  targetStatus: PaymentStatus,
  tx?: DBTransaction,
  providerTransactionId?: string
): Promise<StudentPaymentSelectType | null> {
  const executor = tx ?? db;
  const [row] = await executor
    .update(studentPayments)
    .set(
      providerTransactionId === undefined
        ? { status: targetStatus, updatedAt: new Date() }
        : { status: targetStatus, updatedAt: new Date(), providerTransactionId }
    )
    .where(and(eq(studentPayments.subscriptionId, subscriptionId), eq(studentPayments.status, PaymentStatus.Pending)))
    .returning();
  return row ?? null;
}

export namespace StudentPaymentRepository {
  /**
   * Inserts a new payment ledger row in the `pending` lifecycle state —
   * the append-only ledger's only writer. The amount is the plan's decimal
   * string carried verbatim by the caller.
   *
   * @returns The inserted payment row with server defaults applied.
   * @throws ConflictError when the INSERT somehow returns no row — the
   *         ledger's append invariant makes that unreachable, so it can
   *         only mean a broken driver contract.
   */
  export async function insertPayment(
    insert: StudentPaymentInsertType,
    tx?: DBTransaction
  ): Promise<StudentPaymentSelectType> {
    const executor = tx ?? db;
    const [row] = await executor.insert(studentPayments).values(insert).returning();
    if (!row) {
      throw new ConflictError("StudentPaymentRepository.insertPayment: insert returned no rows");
    }
    return row;
  }

  /**
   * Finds the payment row attached to one subscription.
   *
   * A subscription pair carries exactly one ledger row (created with the
   * subscription at purchase time), so the read takes the lowest id for
   * determinism and returns it alone.
   *
   * @returns The payment row, or null when the subscription has no payment.
   */
  export async function findBySubscriptionId(
    subscriptionId: number,
    tx?: DBQueryExecutor
  ): Promise<StudentPaymentSelectType | null> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      const rows = await tx
        .select()
        .from(studentPayments)
        .where(eq(studentPayments.subscriptionId, subscriptionId))
        .orderBy(asc(studentPayments.id))
        .limit(1);
      return rows[0] ?? null;
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<StudentPaymentSelectType>(
      `SELECT ${PAYMENT_READ_COLUMNS} FROM student_payments
       WHERE subscription_id = $1 ORDER BY id ASC LIMIT 1`,
      [subscriptionId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Performs the atomic pending → paid decision for one subscription's
   * payment: a single guarded `UPDATE … WHERE subscription_id = ? AND
   * status = 'pending' … RETURNING` that touches only the status (plus
   * `updated_at`). The pending predicate is the lock — a replayed
   * `confirmed` delivery, or a `confirmed` arriving after a `failed`
   * decision, matches zero rows.
   *
   * When `providerTransactionId` is supplied it is recorded in the same
   * guarded statement (the one-time NULL → value allowance the trigger
   * admits); omitting it decides the payment without recording a provider
   * reference.
   *
   * @returns The paid row, or null when no pending payment exists for the
   *          subscription (already decided — replay or terminal state).
   */
  export async function markPaidOnce(
    subscriptionId: number,
    tx?: DBTransaction,
    providerTransactionId?: string
  ): Promise<StudentPaymentSelectType | null> {
    return markStatusOnce(subscriptionId, PaymentStatus.Paid, tx, providerTransactionId);
  }

  /**
   * Performs the atomic pending → failed decision for one subscription's
   * payment — the same guarded single UPDATE as the paid writer, with the
   * failed outcome. A failed payment is terminal: no later writer can
   * match it.
   *
   * When `providerTransactionId` is supplied it is recorded in the same
   * guarded statement (the one-time NULL → value allowance the trigger
   * admits); omitting it decides the payment without recording a provider
   * reference.
   *
   * @returns The failed row, or null when no pending payment exists for
   *          the subscription (already decided — replay or terminal state).
   */
  export async function markFailedOnce(
    subscriptionId: number,
    tx?: DBTransaction,
    providerTransactionId?: string
  ): Promise<StudentPaymentSelectType | null> {
    return markStatusOnce(subscriptionId, PaymentStatus.Failed, tx, providerTransactionId);
  }

  /**
   * Finds the pending payments of one gateway that have been undecided
   * longer than a cutoff instant — the reconciliation sweep's read.
   *
   * Each row is joined with the subscription's `payment_reference`, the
   * merchant-order key the gateway inquiry is addressed by (a pending
   * payment is always created alongside its subscription, but the FK is
   * nullable, so the join is a LEFT JOIN and the reference degrades to
   * `null` rather than nulling the row). Ordering is oldest-first with the
   * row id as the deterministic tiebreaker, and `limit` caps the batch so
   * one sweep pass stays bounded.
   *
   * Read-only by design: the sweep never updates here — every outcome is
   * routed through the guarded decision writers by the caller.
   *
   * @returns The stale pending rows (possibly empty), oldest first.
   */
  export async function findStalePendingByGateway(
    gateway: PaymentGateway,
    olderThan: Date,
    limit: number,
    tx?: DBQueryExecutor
  ): Promise<StalePendingPaymentWithReferenceRow[]> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      return tx
        .select({
          id: studentPayments.id,
          studentId: studentPayments.studentId,
          subscriptionId: studentPayments.subscriptionId,
          amount: studentPayments.amount,
          currency: studentPayments.currency,
          paymentGateway: studentPayments.paymentGateway,
          status: studentPayments.status,
          providerTransactionId: studentPayments.providerTransactionId,
          createdAt: studentPayments.createdAt,
          updatedAt: studentPayments.updatedAt,
          paymentReference: subscriptions.paymentReference,
        })
        .from(studentPayments)
        .leftJoin(subscriptions, eq(subscriptions.id, studentPayments.subscriptionId))
        .where(
          and(
            eq(studentPayments.paymentGateway, gateway),
            eq(studentPayments.status, PaymentStatus.Pending),
            lt(studentPayments.createdAt, olderThan)
          )
        )
        .orderBy(asc(studentPayments.createdAt), asc(studentPayments.id))
        .limit(limit);
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<StalePendingPaymentWithReferenceRow>(
      `SELECT ${PAYMENT_WITH_REFERENCE_READ_COLUMNS} FROM student_payments
       LEFT JOIN subscriptions ON subscriptions.id = student_payments.subscription_id
       WHERE student_payments.payment_gateway = $1
         AND student_payments.status = $2
         AND student_payments.created_at < $3
       ORDER BY student_payments.created_at ASC, student_payments.id ASC
       LIMIT $4`,
      [gateway, PaymentStatus.Pending, olderThan, limit]
    );
    return result.rows;
  }

  /**
   * Newest-first admin-audit page over the `student_payments` ledger, each
   * row joined with its student's display identity (`students.id` shares the
   * `users` PK, so one join resolves both name and email).
   *
   * Follows the dual-branch bare-read idiom: a Drizzle select on the
   * supplied transaction executor when one is passed, raw parameterized SQL
   * via `queryDb` (Neon HTTP fast path) otherwise. The `studentNameSearch`
   * filter carries the service-escaped, `%..%`-wrapped pattern and is bound
   * directly to the `ilike` comparison — the repository never re-escapes.
   *
   * @returns Up to `limit` audit rows starting at `offset`, newest first.
   */
  export async function listForAdminAudit(
    filters: NormalizedAdminPaymentFilters,
    limit: number,
    offset: number,
    tx?: DBTransaction
  ): Promise<AdminStudentPaymentRow[]> {
    if (tx) {
      const rows = await tx
        .select({
          id: studentPayments.id,
          studentId: studentPayments.studentId,
          subscriptionId: studentPayments.subscriptionId,
          amount: studentPayments.amount,
          currency: studentPayments.currency,
          paymentGateway: studentPayments.paymentGateway,
          status: studentPayments.status,
          providerTransactionId: studentPayments.providerTransactionId,
          createdAt: studentPayments.createdAt,
          updatedAt: studentPayments.updatedAt,
          studentName: users.fullName,
        })
        .from(studentPayments)
        .innerJoin(students, eq(students.id, studentPayments.studentId))
        .innerJoin(users, eq(users.id, students.id))
        .where(buildAdminPaymentFilterChain(filters))
        .orderBy(desc(studentPayments.id))
        .limit(limit)
        .offset(offset);
      return rows.map(toAdminPaymentRow);
    }
    const params: unknown[] = [];
    const whereClause = buildAdminPaymentRawFilterChain(filters, params);
    const result = await queryDb<AdminStudentPaymentRow>(
      `SELECT ${ADMIN_PAYMENT_READ_COLUMNS}
         FROM student_payments
         JOIN students ON students.id = student_payments.student_id
         JOIN users ON users.id = students.id${whereClause}
        ORDER BY student_payments.id DESC
        LIMIT $${params.push(limit)} OFFSET $${params.push(offset)}`,
      params
    );
    return result.rows;
  }

  /**
   * Count of the admin-audit ledger view — the exact same predicate chain
   * AND join semantics as `listForAdminAudit`: the students→users INNER
   * join is applied unconditionally so the counted row-set equals the
   * listed row-set for every filter combination (owner-less ledger rows
   * are excluded from BOTH surfaces consistently; the 1:1 PK join leaves
   * owner-bearing counts unchanged). Mirrors the dual-branch idiom.
   *
   * @returns The number of ledger rows the filtered audit page contains.
   */
  export async function countForAdminAudit(
    filters: NormalizedAdminPaymentFilters,
    tx?: DBTransaction
  ): Promise<number> {
    if (tx) {
      const rows = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(studentPayments)
        .innerJoin(students, eq(students.id, studentPayments.studentId))
        .innerJoin(users, eq(users.id, students.id))
        .where(buildAdminPaymentFilterChain(filters));
      return rows[0]?.total ?? 0;
    }
    const params: unknown[] = [];
    const whereClause = buildAdminPaymentRawFilterChain(filters, params);
    const result = await queryDb<{ total: number }>(
      `SELECT count(*)::int AS "total"
         FROM student_payments
         JOIN students ON students.id = student_payments.student_id
         JOIN users ON users.id = students.id${whereClause}`,
      params
    );
    return result.rows[0]?.total ?? 0;
  }
}
