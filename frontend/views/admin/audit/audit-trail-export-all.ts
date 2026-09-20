"use client";

/**
 * runAuditTrailFullCsvExport — the audit trail's EXPORT-ALL (FILTERED) flow.
 *
 * Companion to the page export (`audit-trail-export.ts`): where the page
 * export serializes exactly the rows already on screen, this flow walks the
 * SAME `adminAuditLogs` query page-by-page (the wire's 100-row max per
 * request) until the honest `totalCount` is satisfied or the hard export
 * ceiling is reached, then serializes the collected rows through the SAME
 * pure CSV builder — one download, localized feedback through the shared
 * snackbar record.
 *
 * Guard rails:
 *  - a bounded request loop: the walker never issues more requests than
 *    `ceil(min(totalCount, MAX_EXPORT_ROWS) / 100)`, so a huge trail costs
 *    a bounded number of reads and the feedback stays honest about the
 *    truncation (the `{count}`/`{total}` success form);
 *  - an empty page ends the walk immediately — a concurrent deletion can
 *    shrink the trail between requests, and exporting what arrived is the
 *    honest outcome (never a spin on a vanished tail);
 *  - transport/GraphQL rejections bubble out of the walker and resolve to
 *    the shared error feedback — a partial read never produces a download.
 *
 * The imperative multi-page fetch is deliberately `client.query` (not a
 * render-subscription hook): the loop is a one-shot command, not view
 * state, and no page beyond the first should enter the normalized cache.
 */

import type {
  AdminAuditLogsQuery_adminAuditLogs,
  AdminAuditLogsQuery_adminAuditLogs_items,
} from "@/frontend/graphql/generated/gql/graphql";
import { auditTrailFullCsvFilename, buildAuditTrailCsv } from "@/frontend/views/admin/audit/audit-trail-csv";
import { downloadTextFile } from "@/frontend/views/admin/audit/audit-trail-download";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/** ICU token of the `{count}` slots (one per locale, parity-pinned). */
const COUNT_PLACEHOLDER = "{count}";

/** ICU token of the export-all truncation total. */
const TOTAL_PLACEHOLDER = "{total}";

/** Rows per request of the fetch loop — the backend's per-page wire max. */
export const EXPORT_ALL_PAGE_SIZE = 100;

/** Hard ceiling of exported rows before the export reports truncation. */
const MAX_EXPORT_ROWS = 2000;

/** CSV MIME type both exports download with. */
const CSV_MIME_TYPE = "text/csv;charset=utf-8";

/** Outcome record the view surfaces through its transient feedback snackbar. */
export interface AuditExportFeedback {
  readonly kind: "success" | "error";
  readonly message: string;
}

/** Fetches one 1-based page of the APPLIED filter query (the honest envelope). */
export type AuditTrailPageFetcher = (page: number) => Promise<AdminAuditLogsQuery_adminAuditLogs>;

/**
 * Walks the paginated trail until the applied filter's match count is
 * collected or the ceiling is reached. Returns the rows plus the filter's
 * full match count so the caller can report an honest truncation.
 */
async function collectAllTrailRows(
  fetchPage: AuditTrailPageFetcher
): Promise<{ readonly rows: AdminAuditLogsQuery_adminAuditLogs_items[]; readonly totalMatched: number }> {
  const first = await fetchPage(1);
  const rows: AdminAuditLogsQuery_adminAuditLogs_items[] = [...first.items];
  const totalMatched = first.totalCount;
  const ceiling = Math.min(totalMatched, MAX_EXPORT_ROWS);
  const lastPage = Math.ceil(ceiling / EXPORT_ALL_PAGE_SIZE);
  // Sequential page walk as bounded recursion (each page awaits the next):
  // the export's honesty contract requires the strict page order, and the
  // ceiling keeps the recursion depth bounded by the same hard maximum.
  const walk = async (page: number): Promise<void> => {
    if (page > lastPage || rows.length >= ceiling) {
      return;
    }
    const next = await fetchPage(page);
    if (next.items.length === 0) {
      return;
    }
    rows.push(...next.items);
    await walk(page + 1);
  };
  await walk(2);
  return { rows, totalMatched };
}

/**
 * Runs the export-all flow end to end: paged collection → CSV build →
 * download → feedback. Resolves to the localized success (full or
 * truncated form) or the shared failure line — never throws.
 */
export async function runAuditTrailFullCsvExport(
  fetchPage: AuditTrailPageFetcher,
  labels: AdminUsersLabels
): Promise<AuditExportFeedback> {
  try {
    const { rows, totalMatched } = await collectAllTrailRows(fetchPage);
    const csv = buildAuditTrailCsv(rows, labels);
    downloadTextFile(csv, auditTrailFullCsvFilename(), CSV_MIME_TYPE);
    if (rows.length < totalMatched) {
      return {
        kind: "success",
        message: labels.auditTrail.export.exportTruncated
          .replace(COUNT_PLACEHOLDER, () => String(rows.length))
          .replace(TOTAL_PLACEHOLDER, () => String(totalMatched)),
      };
    }
    return {
      kind: "success",
      message: labels.auditTrail.export.exportedRows.replace(COUNT_PLACEHOLDER, () => String(rows.length)),
    };
  } catch {
    return { kind: "error", message: labels.auditTrail.export.exportFailed };
  }
}
