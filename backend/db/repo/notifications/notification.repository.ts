/**
 * NotificationRepository — data-access layer for the `notifications` table.
 *
 * One row per recipient per notification: `user_id` scopes every read and
 * write to a single inbox (recipient rows are private by construction),
 * `type` discriminates the notification kind, and `related_entity_type` +
 * `related_entity_id` form an optional polymorphic pointer to the row the
 * notification is about. Rows are write-once apart from the `is_read` flip.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - Reads use `queryDb` (raw parameterized SQL) on the non-transactional
 *    branch — the Neon HTTP fast path — and the Drizzle query builder on a
 *    supplied transaction, mirroring `UserRepository` and
 *    `ApplicantRepository`.
 *  - Writes are single statements (no read-then-write, no prepared
 *    statements — writes are excluded from preparation) executed on the
 *    supplied transaction or, outside one, the global `db` handle.
 *  - No business logic, no translations, no error mapping: absent rows
 *    surface as `null` / `0` / `[]` and the service layer decides what they
 *    mean. Raw Drizzle errors propagate for the caller to translate.
 */

import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { notifications } from "@/backend/db/schema/notifications/notifications";
// NOTE: `NotificationType` is referenced only at type positions in this file
// (nullable filter and mark-all parameters). Filter VALUES flow through
// `eq(...)` binds untouched — the enum object itself is never dereferenced
// here — so the import is type-only, exactly like `notification.types.ts`.
import type { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import type {
  DBTransaction,
  NotificationInsertType,
  NotificationListFilterInput,
  NotificationSelectType,
} from "@/backend/types";

/**
 * Filter-only projection of the canonical inbox list filter — the optional
 * conjunctive filters accepted by `countForUser` and `listForUser`. Page
 * windowing (`limit` / `offset`) stays in dedicated method parameters.
 * `null` / `undefined` mean "no filter" for both fields.
 */
type NotificationFilterSubset = Pick<NotificationListFilterInput, "type" | "isRead">;

/**
 * Row shape of the raw-SQL count projection — PostgreSQL's `count(*)` is a
 * bigint, which the driver delivers as a string, so the raw-SQL count
 * branches normalize through `Number(...)`.
 */
type CountRow = { count: number | string };

/** Bound parameter value types accepted by the raw-SQL predicate fragments. */
type PredicateParam = number | string | boolean;

/**
 * Both execution forms of one user-scoped predicate — the output of
 * `buildUserScopedPredicate`.
 */
interface NotificationPredicate {
  /** Drizzle builder conditions for the transactional branch. */
  readonly conditions: SQL[];
  /** Parameterized `$N` WHERE text for the raw-SQL branch. */
  readonly whereSql: string;
  /** Bound parameters matching `whereSql`'s placeholder order. */
  readonly params: PredicateParam[];
}

/**
 * Raw-SQL column projection for full notification rows on the `queryDb`
 * branch — snake_case columns aliased to the camelCase field names of
 * `NotificationSelectType`, matching what the Drizzle query builder returns
 * on the transactional branch.
 */
const NOTIFICATION_COLUMNS_SQL = `id,
       user_id AS "userId",
       type,
       title,
       body,
       is_read AS "isRead",
       related_entity_type AS "relatedEntityType",
       related_entity_id AS "relatedEntityId",
       created_at AS "createdAt"`;

/**
 * User-scoped predicate for filtered inbox reads — the single source of
 * truth for the conjunctive filter family shared by `countForUser` and
 * `listForUser`, so the two can never drift apart (an inbox page's total
 * count must always describe the same row set its windowed listing draws
 * from).
 *
 * One decomposition emits both execution forms of the same predicate:
 *  - `conditions` — Drizzle builder conditions for the transactional branch;
 *  - `whereSql` + `params` — `$N`-parameterized fragments for the raw-SQL
 *    `queryDb` branch (Neon HTTP fast path).
 *
 * The mandatory `user_id = $1` equality is always present; each optional
 * filter contributes a conjunct only when it carries a non-null value.
 */
function buildUserScopedPredicate(userId: number, filters: NotificationFilterSubset): NotificationPredicate {
  const conditions: SQL[] = [eq(notifications.userId, userId)];
  const params: PredicateParam[] = [userId];
  const fragments: string[] = ["user_id = $1"];
  if (filters.type != null) {
    conditions.push(eq(notifications.type, filters.type));
    params.push(filters.type);
    fragments.push(`type = $${params.length}`);
  }
  if (filters.isRead != null) {
    conditions.push(eq(notifications.isRead, filters.isRead));
    params.push(filters.isRead);
    fragments.push(`is_read = $${params.length}`);
  }
  return { conditions, whereSql: fragments.join(" AND "), params };
}

export namespace NotificationRepository {
  /**
   * Inserts one notification row and returns it.
   *
   * A single `INSERT … RETURNING *` — the id, the `is_read` default, and
   * the `created_at` stamp are database-generated (unless the insert
   * carries them explicitly).
   *
   * @returns The inserted notification row.
   */
  export async function createReturning(
    insert: NotificationInsertType,
    tx?: DBTransaction
  ): Promise<NotificationSelectType> {
    const [row] = await (tx ?? db).insert(notifications).values(insert).returning();
    if (!row) {
      // Should be unreachable — `.returning()` always yields the inserted row.
      throw new Error("NotificationRepository.createReturning: insert returned no rows");
    }
    return row;
  }

  /**
   * Inserts many notification rows in ONE multi-row `INSERT … RETURNING *`
   * so a batch fan-out persists in a single statement — sibling rows share
   * the statement, and either every row lands or none does.
   *
   * @returns The inserted rows, in input order. Empty input inserts nothing
   *          and returns an empty array (zero rows in, zero rows out — no
   *          statement is executed).
   */
  export async function createManyReturning(
    inserts: readonly NotificationInsertType[],
    tx?: DBTransaction
  ): Promise<NotificationSelectType[]> {
    if (inserts.length === 0) {
      return [];
    }
    // Array spread only satisfies Drizzle's mutable-array parameter type —
    // the row payloads themselves are passed through untouched.
    return (tx ?? db)
      .insert(notifications)
      .values([...inserts])
      .returning();
  }

  /**
   * Counts a recipient's unread notifications — the badge count.
   *
   * Predicate: `user_id = ? AND is_read = false`, backed by the
   * `(user_id, is_read)` composite index.
   *
   * @returns The unread count; `0` when the inbox has no unread rows.
   */
  export async function countUnread(userId: number, tx?: DBTransaction): Promise<number> {
    if (tx) {
      const [row] = await tx
        .select({ count: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
      // Drizzle's `count()` already maps to a JS number.
      return row?.count ?? 0;
    }
    const result = await queryDb<CountRow>(
      "SELECT count(*) AS count FROM notifications WHERE user_id = $1 AND is_read = false",
      [userId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /**
   * Counts a recipient's notifications under the same optional conjunctive
   * filters (`type`, `isRead`) that `listForUser` windows over — the pair
   * shares one predicate builder, so the count always describes the exact
   * row set the listing paginates.
   *
   * @returns The number of matching rows; `0` when nothing matches.
   */
  export async function countForUser(
    userId: number,
    filters: NotificationFilterSubset,
    tx?: DBTransaction
  ): Promise<number> {
    const predicate = buildUserScopedPredicate(userId, filters);
    if (tx) {
      const [row] = await tx
        .select({ count: count() })
        .from(notifications)
        .where(and(...predicate.conditions));
      // Drizzle's `count()` already maps to a JS number.
      return row?.count ?? 0;
    }
    const result = await queryDb<CountRow>(
      `SELECT count(*) AS count FROM notifications WHERE ${predicate.whereSql}`,
      predicate.params
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /**
   * Lists one page of a recipient's inbox.
   *
   * Ordering is `created_at DESC, id DESC` (newest first; the id
   * tiebreaker keeps same-timestamp rows deterministic). `limit` /
   * `offset` window the result; the filters are the same conjunctive
   * optionals shared with `countForUser`.
   *
   * @returns The windowed rows, newest first; an empty array when the
   *          window or the filters match nothing.
   */
  export async function listForUser(
    userId: number,
    filters: NotificationFilterSubset,
    limit: number,
    offset: number,
    tx?: DBTransaction
  ): Promise<NotificationSelectType[]> {
    const predicate = buildUserScopedPredicate(userId, filters);
    if (tx) {
      return tx
        .select()
        .from(notifications)
        .where(and(...predicate.conditions))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(limit)
        .offset(offset);
    }
    const params: PredicateParam[] = [...predicate.params, limit, offset];
    const result = await queryDb<NotificationSelectType>(
      `SELECT ${NOTIFICATION_COLUMNS_SQL}
         FROM notifications
        WHERE ${predicate.whereSql}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return result.rows;
  }

  /**
   * Marks exactly one notification read — a guarded single
   * `UPDATE … WHERE id = ? AND user_id = ? RETURNING *`.
   *
   * The `user_id` equality in the WHERE clause is the ownership guard: a
   * row is only ever flipped by its own recipient, and a foreign or
   * nonexistent id is indistinguishable from it (zero rows matched).
   * Re-marking an already-read row still matches and returns the row
   * unchanged — the operation is idempotent.
   *
   * @returns The updated row, or `null` when no row matches the id + user
   *          pair (the service layer turns that into its not-found error).
   */
  export async function markReadOnce(
    id: number,
    userId: number,
    tx?: DBTransaction
  ): Promise<NotificationSelectType | null> {
    const [row] = await (tx ?? db)
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning();
    return row ?? null;
  }

  /**
   * Marks every unread notification of one recipient read — a single
   * set-based `UPDATE … WHERE user_id = ? AND is_read = false [AND type = ?]`.
   *
   * The `is_read = false` conjunct keeps repeat calls cheap: rows that are
   * already read never match again, so an idempotent second call reports
   * `0` affected rows.
   *
   * @param type When non-null, only unread rows of that notification kind
   *             are marked; `null` sweeps every unread row of the user.
   * @returns The number of rows the UPDATE affected (rows actually flipped
   *          from unread to read); `0` when nothing matched.
   */
  export async function markAllReadForUser(
    userId: number,
    type: NotificationType | null,
    tx?: DBTransaction
  ): Promise<number> {
    const conditions: SQL[] = [eq(notifications.userId, userId), eq(notifications.isRead, false)];
    if (type != null) {
      conditions.push(eq(notifications.type, type));
    }
    // No `.returning()` — the awaited update result is the affected-row count.
    const result = await (tx ?? db)
      .update(notifications)
      .set({ isRead: true })
      .where(and(...conditions));
    return result.rowCount ?? 0;
  }
}
