/**
 * Audit-trail CSV export — the pure client-side serialization of the trail
 * page the view currently holds (no second fetch, no backend change: the
 * export reflects EXACTLY the rows on screen — the same honesty contract as
 * the directory exports).
 *
 * This module owns the COLUMN layout (localized caption handles) and the
 * per-row VALUE mapping (locale-neutral wire data); the FORMAT — RFC-4180
 * escaping, BOM prefix, record structure, filename stamp — lives in the
 * shared `directory-shared/directory-csv`.
 *
 * Honesty contract (mirrors the render surface):
 *  - the WHEN column flows verbatim as the ISO wire string (locale digit
 *    shaping and date re-formatting are display-only);
 *  - ACTION and ENTITY TYPE serialize as their RAW wire values (the chips
 *    are localized display labels; a machine-consumable export keeps the
 *    canonical vocabulary — the same values the filters match);
 *  - honest-null entity ids and details payloads serialize as EMPTY cells
 *    (the `—` is a display affordance, not a value);
 *  - the DETAILS column carries the raw JSON payload verbatim — the RFC-4180
 *    escaper handles the embedded quotes/newlines it legitimately contains.
 */

import type { AdminAuditLogsQuery_adminAuditLogs_items } from "@/frontend/graphql/generated/gql/graphql";
import { buildDirectoryCsv, directoryCsvFilename } from "@/frontend/views/admin/directory-shared/directory-csv";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/** Download filename prefix of the audit-trail page export. */
const AUDIT_CSV_FILENAME_PREFIX = "audit-trail-page";

/** Download filename prefix of the audit-trail export-all (filtered) flow. */
const AUDIT_FULL_CSV_FILENAME_PREFIX = "audit-trail-filtered";

/** One trail entry as the query delivered it (the extracted item type). */
type AuditTrailRow = AdminAuditLogsQuery_adminAuditLogs_items;

/**
 * Builds the full CSV document for the CURRENT page: one localized header
 * record, then one record per on-screen entry — when, actor, action, entity
 * type/id, and the verbatim details payload (empty cell when absent).
 */
export function buildAuditTrailCsv(items: readonly AuditTrailRow[], labels: AdminUsersLabels): string {
  const table = labels.auditTrail.table;
  return buildDirectoryCsv({
    headers: [
      table.whenHeader,
      table.actorHeader,
      table.actionHeader,
      table.entityTypeHeader,
      table.entityIdHeader,
      table.detailsHeader,
    ],
    rows: items.map(entry => [
      entry.createdAt,
      entry.actorName,
      entry.actionType,
      entry.entityType,
      entry.entityId === null ? "" : String(entry.entityId),
      entry.details ?? "",
    ]),
  });
}

/** Derives the stamped download filename via the shared minute-precision recipe. */
export function auditTrailCsvFilename(now: Date = new Date()): string {
  return directoryCsvFilename(AUDIT_CSV_FILENAME_PREFIX, now);
}

/** Stamped download filename of the export-all (filtered) CSV. */
export function auditTrailFullCsvFilename(now: Date = new Date()): string {
  return directoryCsvFilename(AUDIT_FULL_CSV_FILENAME_PREFIX, now);
}
