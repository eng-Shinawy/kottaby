"use client";

/**
 * runAuditTrailCsvExport — the audit trail's EXPORT-PAGE flow, extracted
 * from `AuditTrailView` so the view stays a thin composer (the students
 * directory's `runStudentsCsvExport` recipe).
 *
 * The CSV serializes from the rows the view ALREADY holds (no second
 * fetch — the export reflects exactly the on-screen page), downloads via
 * the same Blob/anchor/revoke recipe, and reports the outcome through the
 * returned feedback record: success carries the exported row count (the
 * ICU `{count}` token replaced here, never interpolated), a failed
 * download preparation carries the error lane without any download.
 */

import type { AdminAuditLogsQuery_adminAuditLogs_items } from "@/frontend/graphql/generated/gql/graphql";
import { auditTrailCsvFilename, buildAuditTrailCsv } from "@/frontend/views/admin/audit/audit-trail-csv";
import { downloadTextFile } from "@/frontend/views/admin/audit/audit-trail-download";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/** ICU token of `export.exportedRows` (one per locale, parity-pinned). */
const EXPORTED_ROWS_PLACEHOLDER = "{count}";

/** CSV MIME type the page export downloads with (shared by the export-all flow). */
const CSV_MIME_TYPE = "text/csv;charset=utf-8";

/** Outcome record the view surfaces through its transient feedback snackbar. */
export interface AuditExportFeedback {
  readonly kind: "success" | "error";
  readonly message: string;
}

export function runAuditTrailCsvExport(
  items: readonly AdminAuditLogsQuery_adminAuditLogs_items[],
  labels: AdminUsersLabels
): AuditExportFeedback {
  try {
    const csv = buildAuditTrailCsv(items, labels);
    downloadTextFile(csv, auditTrailCsvFilename(), CSV_MIME_TYPE);
    return {
      kind: "success",
      message: labels.auditTrail.export.exportedRows.replace(EXPORTED_ROWS_PLACEHOLDER, () => String(items.length)),
    };
  } catch {
    return { kind: "error", message: labels.auditTrail.export.exportFailed };
  }
}
