/**
 * print-export-csv — the pure CSV cell recipe of the shared print/export
 * dialog (`PrintExportDialog.tsx`). Extracted as its own module so the
 * component file exports components only (Fast Refresh rule) while the
 * byte contract of the exported cells stays testable.
 *
 * Recipe (byte contract): the shared CWE-1236 formula guard runs FIRST so
 * a cell opening with a spreadsheet formula trigger (`=`, `+`, `-`, `@`,
 * TAB, CR) exports as literal text, then the value is quoted with embedded
 * quotes doubled and newlines flattened to single spaces.
 */
import { neutralizeCsvFormulas } from "@/frontend/utils/csv-formula";

export function escapeCsv(value: string): string {
  return '"' + neutralizeCsvFormulas(value).replace(/"/g, '""').replace(/\r?\n/g, " ") + '"';
}
