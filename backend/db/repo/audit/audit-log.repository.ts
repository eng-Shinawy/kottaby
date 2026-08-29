/**
 * AuditLogRepository — data-access layer for the `audit_logs` table
 * (DEV3-020 Phase 1: audit integration into the live admin surfaces).
 *
 * The table is APPEND-ONLY by database trigger (`3-immutability-triggers.sql`
 * blocks UPDATE and DELETE); this repository exposes exactly one write shape
 * (a bare INSERT … RETURNING) and one filtered read. There is deliberately
 * NO update, NO delete, and NO upsert — the immutability contract is the
 * repository's API surface, not merely a database guard.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - Writes are single statements (INSERT … RETURNING) — no read-then-write.
 *  - `tx` is the LAST parameter of every method; passing it joins the
 *    caller's transaction, omitting it executes standalone.
 *  - No business rules, no translations, no log strings — callers translate
 *    empty results into domain outcomes.
 *  - The filtered list joins `users` for a NARROW actor summary
 *    (id / fullName / email — never the full `users` row), the same
 *    least-privilege projection the verification queue uses for purchasers.
 *  - The join projection is a nested shape, so BOTH paths run through the
 *    Drizzle builder (`(tx ?? db)`) — the raw `queryDb` aliasing pattern
 *    cannot express the nested projection without a fragile flat-alias
 *    mapping (same ruling as `SubscriptionRepository.listPendingForVerification`).
 */
import { and, count, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { users } from "@/backend/db/schema/users/users";
import type { AuditLogInsertType, AuditLogSelectType, DBTransaction } from "@/backend/types";

/** The narrow actor summary embedded in every audit row the admin reads. */
export interface AuditLogActorSummary {
  readonly id: number;
  readonly fullName: string;
  readonly email: string;
}

/** One audit-trail row with its actor summary embedded. */
export interface AuditLogWithActor {
  readonly id: number;
  readonly actorId: number;
  readonly actionType: AuditLogSelectType["actionType"];
  readonly entityType: string;
  readonly entityId: number | null;
  readonly details: string | null;
  readonly createdAt: Date;
  readonly actor: AuditLogActorSummary;
}

/** Every filter the admin audit-trail viewer can express (all optional). */
export interface AuditLogListFilters {
  readonly actorId?: number;
  readonly actionType?: AuditLogSelectType["actionType"];
  readonly entityType?: string;
  readonly entityId?: number;
  /** Inclusive lower bound on `created_at`. */
  readonly createdFrom?: Date;
  /** Inclusive upper bound on `created_at`. */
  readonly createdTo?: Date;
  /** Page size (the service clamps and validates; the repo does not). */
  readonly limit: number;
  /** Zero-based row offset. */
  readonly offset: number;
}

export namespace AuditLogRepository {
  /**
   * Appends one audit row. The INSERT alone is the write surface — the
   * database's immutability triggers make every later UPDATE/DELETE impossible,
   * so a caller that holds this method's result holds a permanent record.
   *
   * @returns The inserted audit row (server-owned `createdAt`).
   */
  export async function insertAuditLog(insert: AuditLogInsertType, tx?: DBTransaction): Promise<AuditLogSelectType> {
    const rows = tx
      ? await tx.insert(auditLogs).values(insert).returning()
      : await db.insert(auditLogs).values(insert).returning();
    const [row] = rows;
    if (!row) {
      throw new Error("AuditLogRepository.insertAuditLog: insert returned no rows");
    }
    return row;
  }

  /**
   * Builds the WHERE predicate shared by the page read and the count read —
   * one composition, two consumers, so the page and its total can never
   * disagree about what is being counted.
   */
  function buildFilterPredicate(filters: AuditLogListFilters): SQL | undefined {
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
    if (filters.createdFrom !== undefined) {
      conditions.push(gte(auditLogs.createdAt, filters.createdFrom));
    }
    if (filters.createdTo !== undefined) {
      conditions.push(lte(auditLogs.createdAt, filters.createdTo));
    }
    return conditions.length > 0 ? and(...conditions) : undefined;
  }

  /**
   * The admin audit-trail page read: filtered rows newest first
   * (`created_at DESC`, `id DESC` as the deterministic same-millisecond
   * tiebreak — identity monotonicity), each carrying its narrow actor
   * summary. No action may appear without its actor: the INNER JOIN turns a
   * dangling actor reference into an absent row rather than a half-rendered
   * one (FK `restrict` makes that unreachable in practice; the join keeps
   * the invariant structural).
   *
   * @returns One page of audit rows with actors embedded, newest first.
   */
  export async function listWithActor(filters: AuditLogListFilters, tx?: DBTransaction): Promise<AuditLogWithActor[]> {
    const rows = await (tx ?? db)
      .select({
        log: auditLogs,
        actorId: users.id,
        actorFullName: users.fullName,
        actorEmail: users.email,
      })
      .from(auditLogs)
      .innerJoin(users, eq(auditLogs.actorId, users.id))
      .where(buildFilterPredicate(filters))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(filters.limit)
      .offset(filters.offset);
    return rows.map(row => ({
      id: row.log.id,
      actorId: row.log.actorId,
      actionType: row.log.actionType,
      entityType: row.log.entityType,
      entityId: row.log.entityId,
      details: row.log.details,
      createdAt: row.log.createdAt,
      actor: {
        id: row.actorId,
        fullName: row.actorFullName,
        email: row.actorEmail,
      } satisfies AuditLogActorSummary,
    }));
  }

  /**
   * The total count for the SAME filter predicate `listWithActor` used —
   * the pagination footer's "N entries" comes from here, never from
   * `rows.length` (the page is bounded by `limit`).
   *
   * @returns The total number of rows matching the predicate.
   */
  export async function countWithFilters(filters: AuditLogListFilters, tx?: DBTransaction): Promise<number> {
    const rows = await (tx ?? db).select({ total: count() }).from(auditLogs).where(buildFilterPredicate(filters));
    return rows[0]?.total ?? 0;
  }
}
