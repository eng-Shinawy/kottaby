/**
 * BroadcastRepository — data-access layer for the `broadcasts` header table.
 *
 * One row per accepted admin broadcast send: the verbatim message copy,
 * the audience snapshot (`audience_type`/`audience_role`/`audience_country`/
 * `audience_plan_id` — nullable by design), the sender, the recipient count,
 * and the one-way `active → stopped` lifecycle state (`stopped` is terminal).
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - The Drizzle builder API is shared by `db` and `tx`, so the same chain
 *    runs on either executor. WRITES take a REQUIRED `tx: DBTransaction` as
 *    the last parameter — the header row must land inside the caller's send
 *    transaction (fate-sharing with the notification batch and the audit
 *    row), and the stop's CAS + retraction + audit are one unit of work;
 *    enforcing the transaction at the signature removes the unguarded
 *    committed-write footgun entirely (mirroring the `UserRepository`
 *    write discipline). READS take `tx?` as the optional-last parameter and
 *    fall back to the global `db` handle.
 *  - Guarded transition writes: the stop is a single-statement guarded
 *    UPDATE (id + status folded into the WHERE predicate, with `RETURNING`)
 *    — never SELECT-then-UPDATE. A zero-row result is the miss signal; the
 *    CALLER arbitrates between "nonexistent id" (not found) and
 *    "present-but-already-stopped" (conflict) — this layer never guesses.
 *  - No prepared statements, no `sql.placeholder` usage of any kind — every
 *    filter and predicate value is bound as a Drizzle parameter; zero string
 *    interpolation reaches the SQL text.
 *  - No business logic, no permission checks, no translations, no logging:
 *    absent rows surface as `null` / `0` / `[]` and the service layer
 *    decides what they mean. Raw Drizzle errors propagate for the caller to
 *    translate — the single exception is `create`, which translates the
 *    PostgreSQL unique-violation (`23505` on the nullable-unique
 *    `idempotency_key`, the send-path replay arbiter) into a `ConflictError`
 *    via the canonical `translateDbError` walker.
 *
 * Search sanitization boundary (mirrors the admin-user directory precedent):
 *  - The title search is the ONLY injection-sensitive surface. The service
 *    layer MUST escape LIKE wildcards (`escapeLikeWildcards` from
 *    `@/backend/lib/db`) AND wrap the escaped substring as `%…%` BEFORE
 *    composing the filters shape. The repository receives the final escaped
 *    AND `%…%`-wrapped pattern string in `titleSearch` and binds it directly
 *    to the `ilike(broadcasts.title, pattern)` predicate — never re-escaping
 *    or re-wrapping. One canonical escape point (the service) + one canonical
 *    binding point (this file's `ilike`).
 */

import { and, desc, eq, ilike, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/backend/db";
import { broadcasts } from "@/backend/db/schema/notifications/broadcasts";
import { users } from "@/backend/db/schema/users/users";
import { BroadcastStatus } from "@/backend/enum/notifications/broadcast-status.enum";
import { ConflictError, translateDbError } from "@/backend/lib/errors";
import type {
  AdminBroadcastListFilters,
  BroadcastInsertType,
  BroadcastSelectType,
  DBTransaction,
} from "@/backend/types";

/**
 * `BroadcastEntryRow` — raw DB row shape returned by `list` and `findById`.
 *
 * Module-local repo projection (mirroring the audit-trail entry-row
 * precedent): the shape describes raw Drizzle rows; the service layer maps
 * them to the canonical return types. `status` / `audienceType` /
 * `audienceRole` carry the RAW stored pgEnum strings — the repository never
 * coerces; the service maps them through total-over-vocabulary mappers at
 * projection time. `sentByName` / `stoppedByName` are resolved via the SQL
 * joins in the SAME query (never per-row service fetches) and project the
 * senders'/stopper's CURRENT `users.full_name` (documented, not a snapshot):
 * `sent_by_id` is NOT NULL with ON DELETE RESTRICT, so the sender join never
 * drops a row; `stopped_by_id` is nullable, so the stopper join is LEFT and
 * `stoppedByName` is `null` for an active broadcast.
 */
export interface BroadcastEntryRow {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  readonly audienceType: string | null;
  readonly audienceRole: string | null;
  readonly audienceCountry: string | null;
  readonly audiencePlanId: number | null;
  readonly status: string;
  readonly recipientCount: number;
  readonly sentById: number;
  readonly sentByName: string;
  readonly sentAt: Date;
  readonly stoppedById: number | null;
  readonly stoppedByName: string | null;
  readonly stoppedAt: Date | null;
}

/**
 * Aliased `users` join for the stopper's display name — the second join on
 * the same table needs a distinct alias or Drizzle collapses the two joins
 * into one ON clause and mis-resolves the names.
 */
const stoppedByUsers = alias(users, "stopped_by_users");

/**
 * Column projection shared by `list` and `findById` — the ONE source of
 * truth for the entry row shape, so the two query shapes can never drift
 * apart. `sentByName` projects the sender join; `stoppedByName` the LEFT
 * stopper join.
 */
const BROADCAST_ENTRY_PROJECTION = {
  id: broadcasts.id,
  title: broadcasts.title,
  body: broadcasts.body,
  audienceType: broadcasts.audienceType,
  audienceRole: broadcasts.audienceRole,
  audienceCountry: broadcasts.audienceCountry,
  audiencePlanId: broadcasts.audiencePlanId,
  status: broadcasts.status,
  recipientCount: broadcasts.recipientCount,
  sentById: broadcasts.sentById,
  sentByName: users.fullName,
  sentAt: broadcasts.sentAt,
  stoppedById: broadcasts.stoppedById,
  stoppedByName: stoppedByUsers.fullName,
  stoppedAt: broadcasts.stoppedAt,
} as const;

/**
 * Builds the ANDed WHERE chain from the filters — the ONE shared predicate
 * builder for both the listing and the count, so the count always describes
 * the exact row set the windowed listing draws from. Every value is bound
 * as a Drizzle parameter (`ilike` / `eq`); absent members drop out entirely
 * and an all-absent filter yields `undefined` (no WHERE clause — the
 * unfiltered history).
 */
function buildWhere(filters: AdminBroadcastListFilters): SQL | undefined {
  const conditions: SQL[] = [];
  if (filters.titleSearch != null) {
    // The final escaped + `%…%`-wrapped pattern (service-escaped) — bound
    // directly, never re-escaped. `%` / `_` / `\` in the pattern stay
    // literal, so wildcard-shaped search terms cannot widen the match.
    conditions.push(ilike(broadcasts.title, filters.titleSearch));
  }
  if (filters.status != null) {
    conditions.push(eq(broadcasts.status, filters.status));
  }
  if (filters.audienceType != null) {
    conditions.push(eq(broadcasts.audienceType, filters.audienceType));
  }
  if (conditions.length === 0) {
    return undefined;
  }
  return and(...conditions);
}

export namespace BroadcastRepository {
  /**
   * Inserts one broadcast header row and returns it
   * (`INSERT … RETURNING *`). A single statement — the id, the `active`
   * status default, and the `sent_at` stamp are database-generated (unless
   * the insert carries them explicitly).
   *
   * The idempotency key is nullable and unique: only key-declaring sends
   * participate in replay dedupe, and a duplicate key violates the unique
   * index — PostgreSQL raises `23505`, which is translated into a
   * `ConflictError` via the canonical `translateDbError` walker (other
   * errors pass through unchanged, raw for the caller to translate).
   * Non-23505 errors are never masked here.
   *
   * @param insert The broadcast insert payload (copy + `recipientCount` +
   *               `sentById` required; defaulted/nullable columns optional).
   * @param tx     REQUIRED transaction executor — the header row fate-shares
   *               the caller's send transaction.
   * @returns The inserted broadcast row with all server-generated columns
   *          populated.
   * @throws ConflictError on a duplicate `idempotencyKey` (the `23505`
   *         replay arbiter), or when the INSERT somehow returns no row —
   *         the insert invariant makes that unreachable, so it can only
   *         mean a broken driver contract.
   */
  export async function create(insert: BroadcastInsertType, tx: DBTransaction): Promise<BroadcastSelectType> {
    try {
      const [row] = await tx.insert(broadcasts).values(insert).returning();
      if (!row) {
        throw new ConflictError("BroadcastRepository.create: insert returned no rows");
      }
      return row;
    } catch (err) {
      // The conflict message is a technical descriptor, not user-facing
      // copy — the service layer owns the localized error surface.
      throw translateDbError(err, "BroadcastRepository.create: duplicate idempotency key");
    }
  }

  /**
   * Finds a broadcast header row by its idempotency key — the send-path
   * replay-branch lookup. The key is an equality-bound parameter (never
   * interpolated, never coerced); `null` keys never match (Postgres permits
   * multiple NULLs in a unique index, so only key-declaring sends are
   * discoverable this way).
   *
   * @param key The caller-owned dedupe key, carried verbatim.
   * @param tx  Optional transaction executor — the replay lookup runs on the
   *            caller's transaction (seeing its uncommitted state) when
   *            supplied, the global `db` handle otherwise.
   * @returns The matching header row, or `null` when the key is unclaimed.
   *          Whether the recorded send matches the replaying caller is the
   *          service's decision — this is the raw key read.
   */
  export async function findByIdempotencyKey(key: string, tx?: DBTransaction): Promise<BroadcastSelectType | null> {
    const rows = await (tx ?? db).select().from(broadcasts).where(eq(broadcasts.idempotencyKey, key)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * Lists one page of the broadcast history, newest-first.
   *
   * Single query: `broadcasts INNER JOIN users` on the sender (`sent_by_id`
   * FK is NOT NULL RESTRICT, so the join resolves a sender name for every
   * row) `LEFT JOIN users` (aliased) on the stopper (`stopped_by_id` is
   * nullable — an active broadcast carries no stopper). Ordering is
   * `sent_at DESC, id DESC` — the deterministic tiebreak keeps
   * same-timestamp entries in a stable insertion-latest order, so
   * consecutive pages never duplicate or drop a row. Filters are the
   * conjunctive optionals shared with `count` via the one predicate builder.
   *
   * @param filters The filter shape (`titleSearch` is the final escaped +
   *                `%…%`-wrapped ILIKE pattern; absent members are simply
   *                not filtered on).
   * @param limit   Maximum rows to return (the service layer clamps the
   *                page size; the repository is un-opinionated).
   * @param offset  Rows to skip (page window start; the service layer
   *                converts the 1-based page).
   * @param tx      Optional transaction executor.
   * @returns The raw rows (NOT the canonical return type — the service
   *          layer coerces the raw pgEnum strings). An offset past the end
   *          of the filtered set yields an empty array (the service
   *          surfaces the honest `totalCount` alongside — never clamped,
   *          never an error).
   */
  export async function list(
    filters: AdminBroadcastListFilters,
    limit: number,
    offset: number,
    tx?: DBTransaction
  ): Promise<BroadcastEntryRow[]> {
    return (tx ?? db)
      .select(BROADCAST_ENTRY_PROJECTION)
      .from(broadcasts)
      .innerJoin(users, eq(users.id, broadcasts.sentById))
      .leftJoin(stoppedByUsers, eq(stoppedByUsers.id, broadcasts.stoppedById))
      .where(buildWhere(filters))
      .orderBy(desc(broadcasts.sentAt), desc(broadcasts.id))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Counts broadcast rows matching the same filter chain (no join, no
   * pagination). The service layer pairs this with `list` to surface an
   * honest `totalCount` — an out-of-range page returns an empty `items`
   * array with the unchanged count (never an error, never clamped). The
   * join-free count is join-equivalent because `sent_by_id` is NOT NULL
   * with ON DELETE RESTRICT: a broadcast row cannot exist without its
   * sender.
   *
   * @returns The number of matching rows; `0` when nothing matches.
   */
  export async function count(filters: AdminBroadcastListFilters, tx?: DBTransaction): Promise<number> {
    const rows = await (tx ?? db)
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(broadcasts)
      .where(buildWhere(filters));
    return rows[0]?.count ?? 0;
  }

  /**
   * Finds one broadcast by id — the detail/CAS-arbitration read. Joins
   * resolve the sender/stopper display names in the SAME query (never
   * per-row service fetches).
   *
   * @param id The broadcast header id.
   * @param tx Optional transaction executor — the stop path's arbitration
   *           read runs on the SAME transaction as the CAS attempt, so the
   *           not-found vs already-stopped disambiguation sees the
   *           transaction's own uncommitted state.
   * @returns The raw entry row, or `null` when the id does not exist (the
   *          caller turns that into its not-found error).
   */
  export async function findById(id: number, tx?: DBTransaction): Promise<BroadcastEntryRow | null> {
    const [row] = await (tx ?? db)
      .select(BROADCAST_ENTRY_PROJECTION)
      .from(broadcasts)
      .innerJoin(users, eq(users.id, broadcasts.sentById))
      .leftJoin(stoppedByUsers, eq(stoppedByUsers.id, broadcasts.stoppedById))
      .where(eq(broadcasts.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * Transitions an ACTIVE broadcast to `stopped` — the CAS stop write.
   *
   * Single guarded UPDATE: `status = 'active'` folds the lifecycle guard
   * into the WHERE predicate (riding the primary key for the id equality),
   * and the stopper id + the `now()` stamp (DB clock) are set in the same
   * statement, with `RETURNING *` delivering the updated row. `stopped` is
   * terminal: a stopped broadcast can never match again, so repeat calls
   * report zero rows. Exactly one concurrent stop wins — the row lock held
   * by the UPDATE IS the serialization point (no `SELECT FOR UPDATE`, no
   * advisory locks).
   *
   * @param broadcastId The broadcast header id to stop.
   * @param stoppedById The stopping actor's user id (recorded as the
   *                    stopper; set-null on user deletion).
   * @param tx          REQUIRED transaction executor — the CAS rides the
   *                    caller's stop transaction (retraction + audit
   *                    fate-share it).
   * @returns The updated row (status `stopped`, stopper + `stoppedAt`
   *          populated), or `null` when the CAS missed — either the id does
   *          not exist or the broadcast is already stopped. The CALLER
   *          arbitrates the two cases (a same-transaction `findById`
   *          distinguishes them without a second round-trip race); this
   *          layer never guesses.
   */
  export async function transitionToStopped(
    broadcastId: number,
    stoppedById: number,
    tx: DBTransaction
  ): Promise<BroadcastSelectType | null> {
    const [row] = await tx
      .update(broadcasts)
      .set({ status: BroadcastStatus.Stopped, stoppedById, stoppedAt: sql`now()` })
      .where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.status, BroadcastStatus.Active)))
      .returning();
    return row ?? null;
  }
}
