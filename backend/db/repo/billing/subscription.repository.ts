/**
 * SubscriptionRepository — data-access layer for the `subscriptions` table.
 *
 * A subscription is owned by a generic `user_id` and links a purchaser to a
 * `plans` row. Its `status` column is the activation idempotency arbiter:
 * activation is a single guarded UPDATE (`activatePendingOnce`) whose
 * `status = 'pending'` predicate is the lock — a duplicate delivery matches
 * zero rows and the caller replays instead of re-crediting. No
 * SELECT-then-UPDATE anywhere: the WHERE clause is the atomicity guarantee.
 *
 * Reads follow the `backend/db/repo/AGENTS.md` "Neon HTTP Client for Bare
 * Reads (CRITICAL)" rule: non-transactional reads run as raw parameterized SQL
 * through `queryDb` (Neon HTTP fast path when eligible); when a transaction is
 * supplied, the read executes as a Drizzle select on that executor.
 *
 * Write methods take an optional `tx: DBTransaction` as their last parameter.
 */
import { and, desc, eq, isNotNull, lt, lte, sql } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import type { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { ConflictError } from "@/backend/lib/errors";
import type {
  DBQueryExecutor,
  DBTransaction,
  ExpiredDueSubscriptionRow,
  PlanSelectType,
  SubscriptionInsertType,
  SubscriptionSelectType,
} from "@/backend/types";

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
const SUBSCRIPTION_READ_COLUMNS = `
  id, user_id AS "userId", plan_id AS "planId", status,
  start_date AS "startDate", end_date AS "endDate",
  payment_method AS "paymentMethod", payment_reference AS "paymentReference",
  payment_verified_at AS "paymentVerifiedAt",
  created_at AS "createdAt", updated_at AS "updatedAt"
`;

export namespace SubscriptionRepository {
  /**
   * Inserts a new subscription row in the `pending` lifecycle state.
   *
   * The gateway checkout reference is carried verbatim; the partial unique
   * index on `payment_reference` guarantees at most one subscription ever
   * claims a given reference — a colliding insert raises the PostgreSQL
   * unique-violation, which this method does NOT catch (the caller
   * translates it into the duplicate-reference conflict).
   *
   * @returns The inserted subscription row with server defaults applied.
   * @throws ConflictError when the INSERT somehow returns no row — the
   *         append invariant makes that unreachable, so it can only mean a
   *         broken driver contract.
   */
  export async function insertSubscription(
    insert: SubscriptionInsertType,
    tx?: DBTransaction
  ): Promise<SubscriptionSelectType> {
    const executor = tx ?? db;
    const [row] = await executor.insert(subscriptions).values(insert).returning();
    if (!row) {
      throw new ConflictError("SubscriptionRepository.insertSubscription: insert returned no rows");
    }
    return row;
  }

  /**
   * Finds a subscription by ID.
   *
   * @returns The subscription row, or null if not found.
   */
  export async function findById(id: number, tx?: DBQueryExecutor): Promise<SubscriptionSelectType | null> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      const rows = await tx.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
      return rows[0] ?? null;
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<SubscriptionSelectType>(
      `SELECT ${SUBSCRIPTION_READ_COLUMNS} FROM subscriptions WHERE id = $1 LIMIT 1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Finds a subscription by ID under a `FOR UPDATE` row lock — the extend
   * flow's opening read (mirroring the student repository's locking read;
   * the service layer never issues `SELECT … FOR UPDATE` directly). The
   * lock is held to the transaction's end, so the row read and the
   * guarded `extendActiveOnce` write serialize against concurrent
   * extends: the audit's `previousEndDate` pre-image is the row's TRUE
   * committed state immediately before the winning write, never a stale
   * READ COMMITTED snapshot. `tx` is required — a locking read without a
   * transaction would release its lock as soon as the statement finished.
   *
   * @returns The locked subscription row, or null if not found.
   */
  export async function findByIdForUpdate(id: number, tx: DBTransaction): Promise<SubscriptionSelectType | null> {
    const rows = await tx.select().from(subscriptions).where(eq(subscriptions.id, id)).for("update");
    return rows[0] ?? null;
  }

  /**
   * Finds a subscription by its gateway-issued payment reference — the
   * webhook delivery's lookup key. The partial unique index makes the
   * reference globally unambiguous among referenced rows.
   *
   * @returns The matching subscription row, or null when the reference is
   *          unknown.
   */
  export async function findByPaymentReference(
    reference: string,
    tx?: DBQueryExecutor
  ): Promise<SubscriptionSelectType | null> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      const rows = await tx.select().from(subscriptions).where(eq(subscriptions.paymentReference, reference)).limit(1);
      return rows[0] ?? null;
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<SubscriptionSelectType>(
      `SELECT ${SUBSCRIPTION_READ_COLUMNS} FROM subscriptions WHERE payment_reference = $1 LIMIT 1`,
      [reference]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Performs the atomic pending → active activation transition.
   *
   * A single guarded `UPDATE … WHERE id = ? AND status = 'pending' …
   * RETURNING` stamps the activation window (`startDate`, `endDate`) and
   * the payment verification instant, and flips the status. The pending
   * predicate in the WHERE clause is the concurrency lock: when a second
   * delivery (or an already-activated subscription) races the first, the
   * guarded UPDATE matches zero rows and `null` is returned — the caller's
   * replay signal, with no credit side effects.
   *
   * @returns The activated row, or null when the subscription does not
   *          exist or is no longer pending (already activated — replay).
   */
  export async function activatePendingOnce(
    id: number,
    patch: { startDate: Date; endDate: Date; paymentVerifiedAt: Date },
    tx?: DBTransaction
  ): Promise<SubscriptionSelectType | null> {
    const executor = tx ?? db;
    const [row] = await executor
      .update(subscriptions)
      .set({
        status: SubscriptionStatus.Active,
        startDate: patch.startDate,
        endDate: patch.endDate,
        paymentVerifiedAt: patch.paymentVerifiedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(subscriptions.id, id), eq(subscriptions.status, SubscriptionStatus.Pending)))
      .returning();
    return row ?? null;
  }

  /**
   * Extends an `active` subscription's validity window to an absolute,
   * service-computed end date.
   *
   * A single guarded `UPDATE … WHERE id = ? AND status = 'active' AND
   * end_date < ? … RETURNING` stamps the new window end plus an explicit
   * `updated_at`. The `end_date < newEndDate` predicate is the replay
   * backstop (the extend flow's opening read takes the row's
   * `FOR UPDATE` lock, so concurrent extends serialize read→write there):
   * an identical double-submit (the window already sits
   * AT `newEndDate` after the first write) or any concurrent writer that
   * moved the window to or beyond it (the expiry sweep, a cancellation,
   * a further extension) matches zero rows and returns `null`, so a
   * replay can never shift the window a second time, while genuinely new
   * extensions stack legitimately (each caller computes its target from
   * the row's CURRENT end date, which is strictly below the new target).
   * The strict inequality is also timestamp-precision-safe: it never
   * compares a stored timestamptz against a JS `Date` for EQUALITY (a
   * sub-microsecond stored end would make any equality guard spuriously
   * fail forever). `status` is deliberately never touched — an extension
   * keeps the row `active`.
   *
   * @returns The extended row, or null when the subscription does not
   *          exist, is no longer active, or its end date already sits at
   *          or beyond `newEndDate` (replay / lost race).
   */
  export async function extendActiveOnce(
    id: number,
    patch: { previousEndDate: Date; newEndDate: Date },
    tx?: DBTransaction
  ): Promise<SubscriptionSelectType | null> {
    const executor = tx ?? db;
    const [row] = await executor
      .update(subscriptions)
      .set({
        endDate: patch.newEndDate,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(subscriptions.id, id),
          eq(subscriptions.status, SubscriptionStatus.Active),
          lt(subscriptions.endDate, patch.newEndDate)
        )
      )
      .returning();
    return row ?? null;
  }

  /**
   * Performs the atomic active → cancelled cancellation transition.
   *
   * A single guarded `UPDATE … WHERE id = ? AND status = 'active' …
   * RETURNING` flips the lifecycle state and stamps an explicit
   * `updated_at`. The `active` predicate in the WHERE clause is the
   * concurrency lock: an identical double-submit, a row that already moved
   * on (the sweep expired it, a plan change cancelled it), or an unknown id
   * matches zero rows and returns `null` — the caller's
   * replay-or-wrong-state signal, disambiguated by the service tier.
   * Deliberately BALANCE-PRESERVING: the statement patches exactly
   * `status` and `updated_at` — no lane balance column is read or written
   * here (cancel must never destroy paid value; only the expiry sweep
   * zeroes).
   *
   * @returns The cancelled row, or null when the subscription does not
   *          exist or is not `active` (already cancelled — replay).
   */
  export async function cancelActiveOnce(id: number, tx?: DBTransaction): Promise<SubscriptionSelectType | null> {
    const executor = tx ?? db;
    const [row] = await executor
      .update(subscriptions)
      .set({
        status: SubscriptionStatus.Cancelled,
        updatedAt: new Date(),
      })
      .where(and(eq(subscriptions.id, id), eq(subscriptions.status, SubscriptionStatus.Active)))
      .returning();
    return row ?? null;
  }

  /**
   * Reads one subscription row TOGETHER with its catalog plan in a single
   * round-trip — the plan-change flow's opening read (the direction
   * arithmetic and the same-lane guard both key on the pair, and the
   * `active` predicate folds into the JOIN's WHERE so a missing row and a
   * moved-on row collapse into the same `null` miss signal the service
   * tier disambiguates).
   *
   * Two executor arms per the repository's bare-read convention: on a
   * supplied transaction the read runs as a Drizzle join select on that
   * executor; standalone it runs as ONE raw parameterized SQL statement
   * through `queryDb` (the Neon-HTTP-eligible pattern) with the plan
   * columns composed into a JSON object, so both arms return the identical
   * `{ subscription, plan }` shape. The status rides a bound parameter —
   * the enum member, never an interpolated literal.
   *
   * @returns The active subscription row and its plan, or `null` when the
   *          row is unknown or not `active`.
   */
  export async function findActiveWithPlan(
    id: number,
    tx?: DBQueryExecutor
  ): Promise<{ subscription: SubscriptionSelectType; plan: PlanSelectType } | null> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle join select on the supplied executor.
      const rows = await tx
        .select({ subscription: subscriptions, plan: plans })
        .from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(and(eq(subscriptions.id, id), eq(subscriptions.status, SubscriptionStatus.Active)))
        .limit(1);
      const row = rows[0];
      return row ? { subscription: row.subscription, plan: row.plan } : null;
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path);
    // the plan columns travel as one JSON object so the two tables' shared
    // column names never collide in the flat result row. `price` is cast
    // to text FIRST (jsonb would render the numeric as a JSON number and
    // the decimal-string contract — the canonical `"200.00"` form the
    // proration arithmetic parses — would be lost to JSON.parse); the
    // JSON-borne timestamps are re-typed to `Date`s below for the same
    // reason (the Drizzle arm returns real `Date`s, and the two arms'
    // shapes must not diverge).
    const result = await queryDb<
      SubscriptionSelectType & {
        plan: Omit<PlanSelectType, "createdAt" | "updatedAt" | "deactivatedAt"> & {
          createdAt: string;
          updatedAt: string;
          deactivatedAt: string | null;
        };
      }
    >(
      `SELECT s.id AS "id", s.user_id AS "userId", s.plan_id AS "planId", s.status AS "status",
              s.start_date AS "startDate", s.end_date AS "endDate",
              s.payment_method AS "paymentMethod", s.payment_reference AS "paymentReference",
              s.payment_verified_at AS "paymentVerifiedAt",
              s.created_at AS "createdAt", s.updated_at AS "updatedAt",
              jsonb_build_object(
                'id', p.id, 'title', p.title, 'sessionCount', p.session_count,
                'price', p.price::text, 'currency', p.currency, 'intervalDays', p.interval_days,
                'balanceLane', p.balance_lane, 'isActive', p.is_active,
                'deactivatedAt', p.deactivated_at, 'createdAt', p.created_at, 'updatedAt', p.updated_at
              ) AS "plan"
       FROM subscriptions s
       INNER JOIN plans p ON p.id = s.plan_id
       WHERE s.id = $1 AND s.status = $2
       LIMIT 1`,
      [id, SubscriptionStatus.Active]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const { plan, ...subscription } = row;
    return {
      subscription,
      plan: {
        ...plan,
        createdAt: new Date(plan.createdAt),
        updatedAt: new Date(plan.updatedAt),
        deactivatedAt: plan.deactivatedAt === null ? null : new Date(plan.deactivatedAt),
      },
    };
  }

  /**
   * Lists every subscription owned by one user, newest first.
   *
   * Owner-scoped by design — the only listing predicate is `user_id`
   * equality, so a caller can never reach another user's rows through
   * this read. Ordering is `created_at DESC`.
   *
   * @returns The owner's subscription rows, newest first; empty when the
   *          user has none.
   */
  export async function listByUserId(userId: number, tx?: DBQueryExecutor): Promise<SubscriptionSelectType[]> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      return tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .orderBy(desc(subscriptions.createdAt));
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<SubscriptionSelectType>(
      `SELECT ${SUBSCRIPTION_READ_COLUMNS} FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  /**
   * Performs the batch expiry transition: ONE guarded UPDATE flipping every
   * `active` subscription whose validity window has closed to `expired`.
   *
   * The WHERE predicate is the atomicity guarantee — status, window
   * closure, and the null-`end_date` pending-shape exclusion fold into the
   * single statement evaluated under PostgreSQL's row lock, so no
   * SELECT-then-UPDATE window exists and the comparison re-evaluates
   * against the current row state when concurrent writers serialize. The
   * statement is therefore idempotent: a replay (or a second overlapping
   * sweep) matches zero rows and changes nothing, which is the caller's
   * no-op branch, not an error.
   *
   * `updated_at` is stamped explicitly (`SET updated_at = now()`) because
   * a raw set bypasses the query builder's `$onUpdate` hook — the same
   * explicit stamp every other guarded transition on this table uses.
   *
   * @param now The caller's single captured sweep instant — one clock
   *            reading governs the window comparison and, via the shared
   *            sweep transaction, every settlement consuming the returned
   *            rows.
   * @param tx  Optional transaction executor; the statement joins the
   *            caller's transaction when supplied, or runs standalone
   *            against the global handle otherwise.
   * @returns The `{ id, userId, planId }` projection of every row flipped
   *          by THIS statement — the aftermath's settlement input (resolve
   *          each row's plan credit lane, settle the owner's balances).
   *          An empty array is the replay/no-op signal.
   */
  export async function expireDueActive(now: Date, tx?: DBTransaction): Promise<ExpiredDueSubscriptionRow[]> {
    const executor = tx ?? db;
    return executor
      .update(subscriptions)
      .set({ status: SubscriptionStatus.Expired, updatedAt: sql`now()` })
      .where(
        and(
          eq(subscriptions.status, SubscriptionStatus.Active),
          isNotNull(subscriptions.endDate),
          lte(subscriptions.endDate, now)
        )
      )
      .returning({ id: subscriptions.id, userId: subscriptions.userId, planId: subscriptions.planId });
  }

  /**
   * Answers one booking-eligibility question for a single (student, lane)
   * pair: does the student hold an `expired` subscription crediting this
   * lane while nothing else still covers the lane?
   *
   * Covered means: any subscription of the same user on a plan whose
   * `balance_lane` matches is either `pending` (a not-yet-activated future
   * period) or `active` with its window still open (`end_date > now()`).
   * An `active` row whose window has already closed does NOT cover — the
   * sweep owns that transition, and until it lands the row's still-
   * spendable balance stays spendable.
   *
   * ONE read-only statement: the EXISTS/anti-EXISTS pair is fused so the
   * answer reflects a single consistent snapshot (no check-then-read
   * window). `now()` is evaluated SQL-side so the coverage predicate and
   * the caller's transaction share one clock reading. All values — the
   * owner, the lane, every status comparison — travel as bound parameters;
   * the lane is always a `SubscriptionCreditLane` enum member, never a
   * caller string.
   *
   * Transactional by contract: the probe runs strictly inside the caller's
   * booking transaction, where the answer must be consistent with the
   * debit decisions made on the same executor. It therefore has no
   * `queryDb` bare-read variant — when `tx` is omitted it degrades to the
   * global handle (the repository's standard executor convention), a shape
   * no production caller exercises.
   *
   * @param studentId The owning `user_id` of the subscriptions under test
   *                  — the probe can never see past this predicate, so one
   *                  student's expired lanes are invisible to another's.
   * @param lane      The plan credit lane under test, as a
   *                  `SubscriptionCreditLane` enum member.
   * @param tx        Optional transaction executor.
   * @returns `true` exactly when an expired, otherwise-uncovered
   *          subscription exists on the lane — the booking path's
   *          expiry-denial signal. `false` covers every other shape:
   *          no expired row on the lane, or an expired row that live
   *          coverage still backs.
   */
  export async function hasUncoveredExpiredLane(
    studentId: number,
    lane: SubscriptionCreditLane,
    tx?: DBTransaction
  ): Promise<boolean> {
    const executor = tx ?? db;
    const result = await executor.execute<{ uncovered: boolean }>(sql`
      SELECT EXISTS(
        SELECT 1
        FROM ${subscriptions}
        INNER JOIN ${plans} ON ${plans.id} = ${subscriptions.planId}
        WHERE ${subscriptions.userId} = ${studentId}
          AND ${plans.balanceLane} = ${lane}
          AND ${subscriptions.status} = ${SubscriptionStatus.Expired}
      ) AND NOT EXISTS(
        SELECT 1
        FROM ${subscriptions}
        INNER JOIN ${plans} ON ${plans.id} = ${subscriptions.planId}
        WHERE ${subscriptions.userId} = ${studentId}
          AND ${plans.balanceLane} = ${lane}
          AND (
            ${subscriptions.status} = ${SubscriptionStatus.Pending}
            OR (
              ${subscriptions.status} = ${SubscriptionStatus.Active}
              AND ${subscriptions.endDate} > now()
            )
          )
      ) AS uncovered
    `);
    return result.rows[0]?.uncovered ?? false;
  }
}
