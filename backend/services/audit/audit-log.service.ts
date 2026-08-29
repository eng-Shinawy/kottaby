/**
 * AuditLogService — the write + read facade over the immutable audit trail
 * (DEV3-020 Phase 1: the `audit_logs` table and its immutability triggers
 * existed; no service owned them, and the billing seams only logged).
 *
 * WRITE side — `recordAdminAction`:
 *  - FAIL-CLOSED: the insert rides the CALLER's transaction (`tx` is
 *    mandatory for mutations), so an admin action and its audit row commit
 *    or roll back TOGETHER. An action can never land unlogged; a failed
 *    audit write aborts the action. This is the property the ticket's AC
 *    demands ("every administrative action is permanently logged") — a
 *    best-effort post-commit write would lose entries exactly when the
 *    process dies between the two statements.
 *  - Details are ID-LIMITED + MACHINE-CODE-ONLY (the codebase's logging
 *    privacy posture, mirrored from the billing services' seam contract):
 *    no field values, no user content, no messages — a fixed-size JSON the
 *    varchar(2000) bound can never truncate in practice, enforced by a
 *    guard anyway (fail-closed: an oversized payload rejects the ACTION
 *    rather than writing a truncated record).
 *
 * READ side — `listAuditTrail`:
 *  - Admin-only at the GraphQL gate; this service adds the same posture by
 *    accepting no other caller shape (the query resolver passes the admin's
 *    session through).
 *  - Filters mirror the ticket AC: actor, action type, entity type, entity
 *    id, and a created-at date range — plus bounded pagination
 *    (limit clamped to 1..100, offset floor 0). The page and its total come
 *    from the SAME predicate (one composition, two reads).
 *
 * Immutability: corrections are NEW compensating rows (the append-only
 * doctrine), never edits — the repository exposes no update/delete at all.
 */
import { type AuditLogListFilters, AuditLogRepository, type AuditLogWithActor } from "@/backend/db/repo";
import { ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import type { AuditLogInsertType, AuditLogSelectType, DBTransaction } from "@/backend/types";

/** The `details` column's varchar(2000) bound — enforced fail-closed. */
const AUDIT_DETAILS_MAX_LENGTH = 2000;

/** The page-size ceiling for the admin trail read. */
export const AUDIT_TRAIL_MAX_LIMIT = 100;

/** The default page size when the caller omits one. */
export const AUDIT_TRAIL_DEFAULT_LIMIT = 50;

/** Machine-readable action descriptor carried inside `details`. */
export type AuditEntityType = "plans" | "subscriptions";

/** Input shape for one auditable admin action. */
export interface RecordAdminActionInput {
  /** The acting admin's user id (audit_logs.actor_id — never null). */
  readonly actorId: number;
  /** The audit_action_type enum verb. */
  readonly actionType: AuditLogInsertType["actionType"];
  /** The affected entity family (machine code, never user content). */
  readonly entityType: AuditEntityType;
  /** The affected row's id, when the action targets one. */
  readonly entityId?: number;
  /** The action's machine code (e.g. PLAN_CREATED) — lands in `details`. */
  readonly actionCode: string;
  /** Additional id/machine-code context (never field values). */
  readonly details?: Record<string, string | number | readonly string[]>;
}

/** The paginated trail page + grand total behind the admin viewer. */
export interface AuditTrailPage {
  readonly items: AuditLogWithActor[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Serializes the id-limited details payload. Returns `null` when the caller
 * supplies nothing — the column is nullable and an empty `{}` record is
 * noise, not information.
 */
function serializeDetails(input: Pick<RecordAdminActionInput, "actionCode" | "details">): string | null {
  if (!input.details || Object.keys(input.details).length === 0) {
    return JSON.stringify({ code: input.actionCode });
  }
  return JSON.stringify({ code: input.actionCode, ...input.details });
}

export namespace AuditLogService {
  /**
   * Appends one audit row for an admin action INSIDE the caller's
   * transaction (fail-closed — see the module header). The action code and
   * details are machine codes/ids only; the caller is responsible for never
   * passing field values through `details`.
   *
   * @param tx  The caller's LIVE transaction (mandatory — an audit row
   *     outside the action's transaction could not guarantee the
   *     commit/rollback pairing the immutability doctrine requires).
   * @returns The persisted audit row.
   * @throws ValidationError when the serialized details exceed the column
   *     bound (the ACTION fails — a truncated record must never exist).
   */
  export async function recordAdminAction(
    input: RecordAdminActionInput,
    tx: DBTransaction
  ): Promise<AuditLogSelectType> {
    const details = serializeDetails(input);
    if (details !== null && details.length > AUDIT_DETAILS_MAX_LENGTH) {
      logger.error("Audit write rejected: details payload exceeds the column bound", {
        code: input.actionCode,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        length: details.length,
      });
      throw new ValidationError(
        `Audit details for ${input.actionCode} exceed the ${AUDIT_DETAILS_MAX_LENGTH}-char bound.`
      );
    }
    return AuditLogRepository.insertAuditLog(
      {
        actorId: input.actorId,
        actionType: input.actionType,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        details,
      },
      tx
    );
  }

  /**
   * The admin audit-trail page read. Filters are passed through verbatim —
   * the repository composes the predicate; this layer only validates the
   * pagination envelope so a caller cannot request an unbounded page.
   *
   * @param filters  Field filters + raw `limit`/`offset` (clamped here).
   * @param tx  Optional transaction — propagated verbatim (test path).
   * @returns One page of audit rows with actor summaries, newest first,
   *     plus the total matching the SAME predicate.
   */
  export async function listAuditTrail(filters: AuditLogListFilters, tx?: DBTransaction): Promise<AuditTrailPage> {
    const limit = Math.min(Math.max(Math.trunc(filters.limit) || AUDIT_TRAIL_DEFAULT_LIMIT, 1), AUDIT_TRAIL_MAX_LIMIT);
    const offset = Math.max(Math.trunc(filters.offset) || 0, 0);
    const [items, total] = await Promise.all([
      AuditLogRepository.listWithActor({ ...filters, limit, offset }, tx),
      AuditLogRepository.countWithFilters({ ...filters, limit, offset }, tx),
    ]);
    return { items, total, limit, offset };
  }
}
