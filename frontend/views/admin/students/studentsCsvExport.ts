/**
 * runStudentsCsvExport — the admin student directory's EXPORT-ALL flow,
 * extracted from `AdminStudentsDirectoryContainer` so the container stays a
 * thin composer.
 *
 * The dedicated export query runs with the CURRENT filter state (the hook
 * owns the filter-to-variables mapping), then the returned rows serialize
 * through the EXISTING pure CSV builder (same item shape as the listing)
 * and download via the same Blob/anchor/revoke recipe. Feedback through the
 * shared snackbar: success reports the exported row count; a capped dump
 * reports the truncation warning instead (it implies completion); a failed
 * query reports the error lane without any download.
 */

import type { useAdminStudentsDirectory } from "@/frontend/views/admin/students/hooks";
import {
  buildStudentsDirectoryCsv,
  studentsDirectoryCsvFilename,
} from "@/frontend/views/admin/students/students-directory-csv";
import type { AdminStudentsLabels } from "@/shared/locale/types/adminStudents";

/** ICU token of `export.exportedRows` (one per locale, parity-pinned). */
const EXPORTED_ROWS_PLACEHOLDER = "{count}";

/** Directory state slice the export flow consumes. */
type CsvExportDirectory = Pick<ReturnType<typeof useAdminStudentsDirectory>, "exportAll" | "showSnackbar">;

export async function runStudentsCsvExport(directory: CsvExportDirectory, labels: AdminStudentsLabels): Promise<void> {
  const envelope = await directory.exportAll();
  if (envelope === null) {
    directory.showSnackbar(labels.export.exportCsvFailed, "error");
    return;
  }
  if (envelope.truncated) {
    // A capped dump still downloads its EXPORT_MAX_ROWS rows — the
    // warning lane reports the cap instead of the plain success copy.
    directory.showSnackbar(labels.export.exportTruncated, "warning");
  } else {
    directory.showSnackbar(
      labels.export.exportedRows.replace(EXPORTED_ROWS_PLACEHOLDER, () => String(envelope.rows.length))
    );
  }
  const csv = buildStudentsDirectoryCsv(envelope.rows, labels);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = studentsDirectoryCsvFilename();
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
