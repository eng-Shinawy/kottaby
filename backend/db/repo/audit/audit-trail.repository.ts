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
 *    scalar predicates (no `inArray`), so every query is built fresh with
 *    Drizzle-bound parameters — no `sql.placeholder` usage of any kind.
 *  - No business logic, no permission checks, no localized error strings —
 *    the service layer owns filter normalization, raw-enum coercion, and
 *    the typed-error surface. Filters reach this repository as DATA
 *    (already validated); they are never authorization inputs.
 *  - READ-ONLY surface: `audit_logs` is append-only (UPDATE/DELETE are
 *    blocked at the DB layer by an immutability trigger) and this
 *    repository exposes no write path — list and count only.
 *  - No governance filtering of any kind: the trail renders an entity's
 *    full history regardless of any actor's current governance state.
 *    The `users` inner join projects the acting account's CURRENT display
 *    name for every row (`actor_id` is NOT NULL with ON DELETE RESTRICT,
 *    so the join never drops a row and never orphans an entry).
 */
import { and, desc, eq, gte, lt, type SQL, sql } from "drizzle-orm";
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
}
