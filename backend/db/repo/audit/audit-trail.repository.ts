/**
 * AuditTrailRepository — read-only data-access layer for the global admin
 * audit trail (`audit_logs`).
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - All methods take `tx?: DBTransaction` as the OPTIONAL-LAST parameter.
 *    Reads branch on the supplied executor (`tx` when supplied, the global
 *    `db` handle when not); the Drizzle builder API is shared by both `db`
 *    and `tx` so the same chain runs on either.
 *  - No prepared statements: trail filters compose a dynamic AND chain of
 *    scalar predicates, and the batch enrichment methods use dynamic
 *    `inArray` with plain arrays (the repo batch-lookup rule), so every
 *    query is built fresh with Drizzle-bound parameters — no
 *    `sql.placeholder` usage of any kind.
 *  - No business logic, no permission checks, no localized error strings —
 *    the service layer owns filter normalization, raw-enum coercion, and
 *    the typed-error surface. Filters reach this repository as DATA
 *    (already validated); they are never authorization inputs.
 *  - READ-ONLY surface: `audit_logs` is append-only (UPDATE/DELETE are
 *    blocked at the DB layer by an immutability trigger) and this
 *    repository exposes no write path — list and count only. The batch
 *    enrichment reads (per-entity count + latest-entry peek, keyed by
 *    one entity-type label) stay inside that surface: plain selects,
 *    one grouped count and one DISTINCT ON latest-per-entity read.
 *  - No governance filtering of any kind: the trail renders an entity's
 *    full history regardless of any actor's current governance state.
 *    The `users` inner join projects the acting account's CURRENT display
 *    name for every row (`actor_id` is NOT NULL with ON DELETE RESTRICT,
 *    so the join never drops a row and never orphans an entry).
 */
import { and, desc, eq, gte, inArray, lt, type SQL, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { users } from "@/backend/db/schema/users/users";
import type { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import type { DBTransaction } from "@/backend/types";

/**
 * `NormalizedAuditTrailFilters` — repo-internal filter shape (the
 * null-stripped post-normalization counterpart of the service-layer
 * submit input). Absent members drop out of the WHERE chain entirely, so
 * an empty filter object yields the unfiltered trail (the fallback —
 * never an error).
 *
 * The service layer guarantees BEFORE calling:
 *  - `actorId` / `entityId` are positive safe integers (no `0`, no
 *    negatives, no fractions);
 *  - `entityType` is trimmed, non-empty, and within the column's
 *    varchar(100) ceiling;
 *  - `actionType` is a verified member of the canonical `AuditActionType`
 *    enum (fail-closed membership assertion);
 *  - `from` / `to` are valid `Date`s with `from` strictly before `to`.
 *
 * The time window is HALF-OPEN: `created_at >= from AND created_at < to`
 * — a boundary row at `from` is included, a boundary row at `to` is
 * excluded, and adjacent windows never overlap.
 */
export interface NormalizedAuditTrailFilters {
  readonly actorId?: number;
  readonly actionType?: AuditActionType;
  readonly entityType?: string;
  readonly entityId?: number;
  readonly from?: Date;
  readonly to?: Date;
}

/**
 * `AuditTrailEntryRow` — raw DB row shape returned by `listEntries`.
 *
 * Module-local repo projection (mirroring the admin-directory row-type
 * precedent): these shapes describe raw Drizzle rows; the service layer
 * maps them to the canonical return types. `actionType` carries the RAW
 * stored pgEnum string — the repository never coerces; the service maps
 * it to the canonical `AuditActionType` enum at projection time.
 * `actorName` is resolved via the INNER JOIN on `users.id = actor_id` —
 * the actor's CURRENT `users.full_name` (documented, not a snapshot).
 * `entityId` and `details` are nullable per the schema (not every audit
 * event targets a single row, and `details` is optional context).
 */
export interface AuditTrailEntryRow {
  readonly id: number;
  readonly actionType: string;
  readonly actorId: number;
  readonly actorName: string;
  readonly entityType: string;
  readonly entityId: number | null;
  readonly details: string | null;
  readonly createdAt: Date;
}

/**
 * `AuditTrailLatestEntryRow` — raw DB row shape returned by
 * `listLatestEntriesByEntityIds`: one row per matched entity id, the
 * entity's MOST RECENT trail entry under the requested entity-type label.
 *
 * Module-local repo projection mirroring `AuditTrailEntryRow`: the
 * repository never coerces — `actionType` carries the RAW stored pgEnum
 * string, and the fail-closed canonical-enum certification stays above
 * the repo seam (the service layer maps this row onto the canonical
 * peek shape and withholds an uncertifiable literal as `null`).
 */
export interface AuditTrailLatestEntryRow {
  readonly entityId: number;
  readonly actionType: string;
  readonly createdAt: Date;
}

/**
 * Upper bound on entity ids per single batch statement — the explicit
 * cap that keeps every `inArray` expansion bounded. Longer id lists are
 * transparently split into chunks whose results merge into the returned
 * map, so a caller never manages chunking and a page-sized batch (well
 * under the cap) still costs exactly one round trip.
 */
export const AUDIT_ENTITY_ID_BATCH_LIMIT = 1000;

/**
 * Splits an entity-id list into `AUDIT_ENTITY_ID_BATCH_LIMIT`-sized
 * chunks for the batch reads. A plain synchronous slicer — chunking is
 * invisible to callers and never widens a single statement's parameter
 * list past the cap.
 */
function chunkEntityIds(entityIds: readonly number[]): number[][] {
  const chunks: number[][] = [];
  for (let index = 0; index < entityIds.length; index += AUDIT_ENTITY_ID_BATCH_LIMIT) {
    chunks.push(entityIds.slice(index, index + AUDIT_ENTITY_ID_BATCH_LIMIT));
  }
  return chunks;
}

/**
 * Builds the ANDed WHERE chain from the normalized filters — the ONE
 * shared predicate builder for both the listing and the count, so the
 * two queries can never drift apart. Every value is bound as a Drizzle
 * parameter (`eq` / `gte` / `lt`); absent members drop out entirely and
 * an all-absent filter yields `undefined` (no WHERE clause — the
 * unfiltered trail). Zero string interpolation reaches the SQL text.
 */
function buildWhere(filters: NormalizedAuditTrailFilters): SQL | undefined {
  const conditions: SQL[] = [];
  if (filters.actorId !== undefined) {
    conditions.push(eq(auditLogs.actorId, filters.actorId));
  }
  if (filters.actionType !== undefined) {
    conditions.push(eq(auditLogs.actionType, filters.actionType));
  }
  if (filters.entityType !== undefined) {
    conditions.push(eq(auditLogs.entityType, filters.entityType));
  }
  if (filters.entityId !== undefined) {
    conditions.push(eq(auditLogs.entityId, filters.entityId));
  }
  if (filters.from !== undefined) {
    conditions.push(gte(auditLogs.createdAt, filters.from));
  }
  if (filters.to !== undefined) {
    conditions.push(lt(auditLogs.createdAt, filters.to));
  }
  if (conditions.length === 0) {
    return undefined;
  }
  return and(...conditions);
}

export namespace AuditTrailRepository {
  /**
   * Lists trail rows by filter + page bounds, newest-first.
   *
   * Single query: `audit_logs INNER JOIN users` on the acting account
   * (`actor_id` FK is NOT NULL RESTRICT, so the join resolves an actor
   * name for every row). Ordering is `created_at DESC, id DESC` — the
   * deterministic tiebreak keeps same-timestamp entries (batch mutations
   * share a transaction timestamp) in a stable insertion-latest order, so
   * consecutive pages never duplicate or drop a row.
   *
   * @param filters The normalized, service-validated filter shape
   *                (absent members are simply not filtered on).
   * @param limit   Maximum rows to return (the service layer clamps the
   *                page size; the repository is un-opinionated).
   * @param offset  Rows to skip (page window start).
   * @param tx      Optional transaction executor.
   * @returns The raw rows (NOT the canonical return type — the service
   *          layer coerces the raw `actionType` string). An offset past
   *          the end of the filtered set yields an empty array (the
   *          service surfaces the honest `totalCount` alongside).
   */
  export async function listEntries(
    filters: NormalizedAuditTrailFilters,
    limit: number,
    offset: number,
    tx?: DBTransaction
  ): Promise<AuditTrailEntryRow[]> {
    return (tx ?? db)
      .select({
        id: auditLogs.id,
        actionType: auditLogs.actionType,
        actorId: auditLogs.actorId,
        actorName: users.fullName,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        details: auditLogs.details,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .innerJoin(users, eq(users.id, auditLogs.actorId))
      .where(buildWhere(filters))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Counts trail rows matching the same filter chain (no join, no
   * pagination). The service layer pairs this with `listEntries` inside
   * one read snapshot to surface an honest `totalCount` — an
   * out-of-range page returns an empty `items` array with the unchanged
   * count (never an error, never clamped). The join-free count is
   * join-equivalent because `actor_id` is NOT NULL with ON DELETE
   * RESTRICT: an audit row cannot exist without its actor.
   */
  export async function countEntries(filters: NormalizedAuditTrailFilters, tx?: DBTransaction): Promise<number> {
    const rows = await (tx ?? db)
      .select({ count: sql<number>`count(*)::int`.as("count") })
      .from(auditLogs)
      .where(buildWhere(filters));
    return rows[0]?.count ?? 0;
  }

  /**
   * Counts trail entries per entity id under ONE entity-type label —
   * the batched twin of `countEntries`: a single grouped query
   * (`GROUP BY entity_id`) instead of one count per id, so a page's
   * per-row trail-depth badges cost one round trip regardless of page
   * size. The entity-type label is DATA (the canonical audit label the
   * service mints); rows carrying the same entity id under a different
   * label never match.
   *
   * The returned `Map` is pre-initialized with EVERY requested id mapped
   * to the honest `0` (mirroring the single-row count's never-error,
   * never-clamp contract), then filled from the grouped counts — an id
   * with no entries stays `0`, never an absence. Duplicate ids collapse
   * to one key. Empty input returns an empty map without executing a
   * statement. ID lists longer than `AUDIT_ENTITY_ID_BATCH_LIMIT` are
   * chunked and the per-chunk counts merged.
   *
   * @returns `Map<entityId, entryCount>` — exactly one entry per
   *          requested id, present-or-not.
   */
  export async function countEntriesByEntityIds(
    entityType: string,
    entityIds: readonly number[],
    tx?: DBTransaction
  ): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    for (const id of entityIds) {
      counts.set(id, 0);
    }
    if (entityIds.length === 0) {
      return counts;
    }
    // `inArray` with a PLAIN array (never `sql.placeholder`) per the repo
    // prepared-statement rule; `sql<number>` + `.mapWith(Number)` per the
    // conditional-aggregation rule (count(*) arrives as an int8 string).
    // Chunks are read SEQUENTIALLY: the shared `(tx ?? db)` executor may
    // be a transaction's single client, which must not pipeline
    // concurrent statements.
    const chunkRows = await chunkEntityIds(entityIds).reduce<
      Promise<Array<{ entityId: number | null; count: number }>>
    >(
      async (accumulated, chunk) => [
        ...(await accumulated),
        ...(await (tx ?? db)
          .select({ entityId: auditLogs.entityId, count: sql<number>`count(*)`.mapWith(Number) })
          .from(auditLogs)
          .where(and(eq(auditLogs.entityType, entityType), inArray(auditLogs.entityId, [...chunk])))
          .groupBy(auditLogs.entityId)),
      ],
      Promise.resolve([])
    );
    for (const row of chunkRows) {
      // `inArray` never matches NULL entity ids, so a null here is a
      // structural impossibility — the guard only satisfies the column's
      // nullable type.
      if (row.entityId !== null) {
        counts.set(row.entityId, row.count);
      }
    }
    return counts;
  }

  /**
   * The MOST RECENT trail entry per entity id under ONE entity-type
   * label — the batched twin of the service's single-row peek read: one
   * `DISTINCT ON (entity_id)` query instead of one `limit: 1` read per
   * id, so a page's per-row trail teasers cost one round trip regardless
   * of page size. The entity-type label is DATA, exactly as above.
   *
   * `DISTINCT ON` keeps, per entity, the row winning the
   * `created_at DESC, id DESC` order — the SAME deterministic ordering
   * `listEntries` exposes (the id tiebreak keeps same-timestamp entries
   * in stable insertion-latest order), so the batched peek can never
   * disagree with the single-row peek on which entry is "latest".
   *
   * The returned `Map` is pre-initialized with EVERY requested id mapped
   * to `null`, then filled from the matched rows — an entity with no
   * entries under the label stays `null` (the honest empty arm, mirroring
   * the single-row peek). Duplicate ids collapse to one key. Empty input
   * returns an empty map without executing a statement. ID lists longer
   * than `AUDIT_ENTITY_ID_BATCH_LIMIT` are chunked and the per-chunk
   * latest rows merged (the per-chunk DISTINCT ON is per-chunk-exact, so
   * the merged map is identical to an unchunked read).
   *
   * Rows are RAW (the `AuditTrailLatestEntryRow` projection): the
   * repository never coerces — the fail-closed action-type
   * certification stays above the repo seam.
   *
   * @returns `Map<entityId, AuditTrailLatestEntryRow | null>` — exactly
   *          one entry per requested id; present rows carry the raw
   *          latest-entry projection, absent ids carry `null`.
   */
  export async function listLatestEntriesByEntityIds(
    entityType: string,
    entityIds: readonly number[],
    tx?: DBTransaction
  ): Promise<Map<number, AuditTrailLatestEntryRow | null>> {
    const latest = new Map<number, AuditTrailLatestEntryRow | null>();
    for (const id of entityIds) {
      latest.set(id, null);
    }
    if (entityIds.length === 0) {
      return latest;
    }
    // `inArray` with a PLAIN array (never `sql.placeholder`) per the repo
    // prepared-statement rule; the DISTINCT ON expression must lead the
    // ORDER BY (PostgreSQL requirement), and the trailing `id DESC`
    // tiebreak mirrors `listEntries`'s deterministic newest-first order.
    // Chunks are read SEQUENTIALLY (single-client executor discipline);
    // the per-chunk DISTINCT ON is per-chunk-exact, so the merged map is
    // identical to an unchunked read.
    const chunkRows = await chunkEntityIds(entityIds).reduce<
      Promise<Array<{ entityId: number | null; actionType: string; createdAt: Date }>>
    >(
      async (accumulated, chunk) => [
        ...(await accumulated),
        ...(await (tx ?? db)
          .selectDistinctOn([auditLogs.entityId], {
            entityId: auditLogs.entityId,
            actionType: auditLogs.actionType,
            createdAt: auditLogs.createdAt,
          })
          .from(auditLogs)
          .where(and(eq(auditLogs.entityType, entityType), inArray(auditLogs.entityId, [...chunk])))
          .orderBy(auditLogs.entityId, desc(auditLogs.createdAt), desc(auditLogs.id))),
      ],
      Promise.resolve([])
    );
    for (const row of chunkRows) {
      if (row.entityId !== null) {
        latest.set(row.entityId, {
          entityId: row.entityId,
          actionType: row.actionType,
          createdAt: row.createdAt,
        });
      }
    }
    return latest;
  }
}
