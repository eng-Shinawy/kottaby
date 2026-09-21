/**
 * Admin broadcast — the read/stop lifecycle surface (`listBroadcasts` /
 * `broadcastDetail` / `stopBroadcast`), extracted from the service file
 * under the sibling-module layout (the notification-engine / session-
 * lifecycle split pattern: this module holds the full implementations, the
 * `AdminBroadcastService` namespace in `admin-broadcast.service.ts` keeps
 * the public surface through thin same-signature delegates — nothing here
 * is part of the public API).
 *
 * The lifecycle shares the send path's security and transaction posture:
 *  - every method gates pre-transaction through the shared admin gate
 *    (`assertActorAdmin` — zero writes on denial, the gate logs its own
 *    denials);
 *  - every read rides the caller's transaction when one is supplied
 *    (the test/journey seam), and the stop's CAS transition,
 *    engine-mediated retraction, and audit row are ONE unit of work;
 *  - expected rejections log exactly one bounded `logger.logDomainError`
 *    each (code + entity + id — never copy text), and happy paths log
 *    NOTHING;
 *  - the engine is consumed by reference (`retractByRelatedEntity`) and
 *    remains the single writer of the notifications table — this module
 *    never deletes notification rows itself.
 */

import { BroadcastRepository, NotificationRepository } from "@/backend/db/repo";
import type { BroadcastEntryRow } from "@/backend/db/repo/notifications/broadcast.repository";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { isBroadcastAudienceType } from "@/backend/enum/notifications/broadcast-audience-type.enum";
import { BroadcastStatus, isBroadcastStatus } from "@/backend/enum/notifications/broadcast-status.enum";
import { toUserRole } from "@/backend/enum/users/user-role.enum";
import { escapeLikeWildcards } from "@/backend/lib/db/escape-like-wildcards";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, NotFoundError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActorAdmin } from "@/backend/services/admin/admin-gate.helpers";
import { AuditService } from "@/backend/services/admin/audit.service";
import { resolvePageBounds } from "@/backend/services/admin/user-management.helpers";
import {
  AUDIT_ENTITY_TYPE,
  BROADCAST_RELATED_ENTITY_TYPE,
} from "@/backend/services/notifications/admin-broadcast.service.helpers";
import { NotificationEngine } from "@/backend/services/notifications/notification-engine.service";
import type {
  AdminBroadcastDetailReturnType,
  AdminBroadcastEntryReturnType,
  AdminBroadcastListFilters,
  AdminBroadcastPageReturnType,
  DBTransaction,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** History listing pagination default page (the audit-trail house bounds). */
const HISTORY_DEFAULT_PAGE = 1;

/** The title-search substring ceiling before wildcard escaping (mirror of the directory precedent). */
const HISTORY_MAX_SEARCH_LENGTH = 100;

/**
 * Maps one raw broadcast row to the canonical history-list entry. The raw
 * stored pgEnum strings (`status` / `audienceType` / `audienceRole`) are
 * coerced through the shared fail-closed mappers; an unrecognized stored
 * value degrades to the honest neutral form (`null` audience companion /
 * `active` status) instead of throwing — historical rows are tolerance
 * data by design. A NULL `audienceRole` snapshot (its column is nullable)
 * maps to `null` without entering the role coercion.
 */
function mapBroadcastEntry(row: BroadcastEntryRow): AdminBroadcastEntryReturnType {
  const status = isBroadcastStatus(row.status) ? row.status : BroadcastStatus.Active;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    audienceType: isBroadcastAudienceType(row.audienceType) ? row.audienceType : null,
    audienceRole: row.audienceRole === null ? null : toUserRole(row.audienceRole),
    audienceCountry: row.audienceCountry,
    audiencePlanId: row.audiencePlanId,
    status,
    recipientCount: row.recipientCount,
    sentById: row.sentById,
    sentByName: row.sentByName,
    sentAt: row.sentAt,
    stoppedById: row.stoppedById,
    stoppedByName: row.stoppedByName,
    stoppedAt: row.stoppedAt,
  };
}

/**
 * Composes the stop audit's metadata — the recorded recipient count and the
 * retracted row count ONLY (never copy text, never recipient identifiers —
 * the metadata-only audit-details discipline).
 */
function buildStopAuditDetails(recipientCount: number, retractedCount: number): string {
  return JSON.stringify({ recipientCount, retractedCount });
}

export namespace AdminBroadcastLifecycleService {
  /**
   * Lists one page of the broadcast history, newest-first, behind the
   * shared admin gate.
   *
   * The title search is the ONLY injection-sensitive surface: the caller's
   * substring is trimmed, bounded, escaped through `escapeLikeWildcards`,
   * and wrapped as `%…%` BEFORE the repository sees it (the repository
   * binds the final pattern verbatim). Status derives from the header row
   * only. An out-of-range page yields an empty `items` array with the
   * honest `totalCount`.
   *
   * @param filters  Closed, request-scoped filter surface; absent/null
   *                 members drop out of the query entirely.
   * @param page     1-based page number (non-positive rejects localized).
   * @param pageSize Page size; values outside `1..100` reject localized (undefined → 25).
   * @param actorId  The verified caller (`ctx.user.id` — never input);
   *                 re-verified against a real admin row by the gate.
   * @param locale   Actor locale for localized rejections.
   * @param outerTx  Optional caller-owned transaction (test/journey seam).
   */
  export async function listBroadcasts(
    filters: AdminBroadcastListFilters,
    page: number,
    pageSize: number | undefined,
    actorId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<AdminBroadcastPageReturnType> {
    await assertActorAdmin(actorId, locale, outerTx);

    const resolvedPage = page ?? HISTORY_DEFAULT_PAGE;
    const { resolvedPageSize, offset } = resolvePageBounds(resolvedPage, pageSize, locale);

    const rawSearch = filters.titleSearch;
    const titleSearch =
      typeof rawSearch === "string" && rawSearch.trim().length > 0
        ? `%${escapeLikeWildcards(rawSearch.trim().slice(0, HISTORY_MAX_SEARCH_LENGTH))}%`
        : null;
    const normalizedFilters = {
      titleSearch,
      status: filters.status ?? null,
      audienceType: filters.audienceType ?? null,
    };

    return withTransaction(outerTx, async tx => {
      const [rows, totalCount] = await Promise.all([
        BroadcastRepository.list(normalizedFilters, resolvedPageSize, offset, tx),
        BroadcastRepository.count(normalizedFilters, tx),
      ]);
      return { items: rows.map(mapBroadcastEntry), totalCount, page: resolvedPage, pageSize: resolvedPageSize };
    });
  }

  /**
   * Resolves the detail view payload for one broadcast: the header entry
   * (joined display names included) plus the LIVE delivery/read aggregates
   * derived from the broadcast's still-present notification rows. For a
   * stopped broadcast both live counts are 0 (the rows were retracted);
   * the entry's `recipientCount` preserves the original reach.
   *
   * @param broadcastId The history entry id.
   * @param actorId     The verified caller; re-verified by the gate.
   * @param locale      Actor locale for localized rejections.
   * @param outerTx     Optional caller-owned transaction (test/journey seam).
   */
  export async function broadcastDetail(
    broadcastId: number,
    actorId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<AdminBroadcastDetailReturnType> {
    const tErrors = getServerTranslations(locale).errorsTranslations;
    await assertActorAdmin(actorId, locale, outerTx);

    return withTransaction(outerTx, async tx => {
      const row = await BroadcastRepository.findById(broadcastId, tx);
      if (row === null) {
        logger.logDomainError("Admin broadcast detail rejected: broadcast id does not exist", {
          code: "BROADCAST_NOT_FOUND",
          entity: "notifications",
          entityId: broadcastId,
          locale,
        });
        throw new NotFoundError("BROADCAST", tErrors.broadcastNotFound);
      }
      const stats = await NotificationRepository.readStatsByRelatedEntity(BROADCAST_RELATED_ENTITY_TYPE, row.id, tx);
      return {
        entry: mapBroadcastEntry(row),
        liveDeliveredCount: stats.total,
        liveReadCount: stats.read,
      };
    });
  }

  /**
   * Stops an ACTIVE broadcast — the one-way `active → stopped` lifecycle
   * transition with engine-mediated recipient retraction, behind the shared
   * admin gate.
   *
   * ONE unit of work: the CAS transition (`WHERE status = 'active'`), the
   * engine's set-based retraction, and exactly ONE Suspend audit row. A
   * zero-row CAS result is arbitrated on the SAME transaction — a
   * nonexistent id rejects localized (`BROADCAST_NOT_FOUND`), a
   * present-but-already-stopped broadcast rejects localized
   * (`BROADCAST_ALREADY_STOPPED`) — and neither writes anything.
   *
   * @param broadcastId The broadcast header id to stop.
   * @param actorId     The verified caller (recorded as the stopper).
   * @param locale      Actor locale for localized rejections.
   * @param outerTx     Optional caller-owned transaction (test/journey seam).
   * @returns The retracted notification-row count (0 when the broadcast had
   *          no still-present rows).
   */
  export async function stopBroadcast(
    broadcastId: number,
    actorId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<number> {
    const tErrors = getServerTranslations(locale).errorsTranslations;
    await assertActorAdmin(actorId, locale, outerTx);

    return withTransaction(outerTx, async tx => {
      const stopped = await BroadcastRepository.transitionToStopped(broadcastId, actorId, tx);
      if (stopped === null) {
        const existing = await BroadcastRepository.findById(broadcastId, tx);
        if (existing === null) {
          logger.logDomainError("Admin broadcast stop rejected: broadcast id does not exist", {
            code: "BROADCAST_NOT_FOUND",
            entity: "notifications",
            entityId: broadcastId,
            locale,
          });
          throw new NotFoundError("BROADCAST", tErrors.broadcastNotFound);
        }
        logger.logDomainError("Admin broadcast stop rejected: broadcast is already stopped", {
          code: "BROADCAST_ALREADY_STOPPED",
          entity: "notifications",
          entityId: broadcastId,
          locale,
        });
        throw new ConflictError("BROADCAST_ALREADY_STOPPED", tErrors.broadcastAlreadyStopped);
      }

      const retractedCount = await NotificationEngine.retractByRelatedEntity(
        BROADCAST_RELATED_ENTITY_TYPE,
        broadcastId,
        tx
      );

      await AuditService.createAuditLog(
        {
          actorId,
          actionType: AuditActionType.Suspend,
          entityType: AUDIT_ENTITY_TYPE,
          entityId: broadcastId,
          details: buildStopAuditDetails(stopped.recipientCount, retractedCount),
        },
        tx
      );

      return retractedCount;
    });
  }
}
