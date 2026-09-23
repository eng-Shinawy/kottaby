/**
 * csv-download — the browser download recipe shared by the admin teachers
 * surfaces' server-side export flows: serialize the envelope rows through
 * the pure CSV builders, then hand the string to the shared
 * `downloadTextFile` Blob + temporary anchor click (revoked on the next
 * macrotask).
 */

import { downloadTextFile } from "@/frontend/views/admin/directory-shared/directory-csv";

/** Downloads `csv` as `filename` through a Blob + temporary anchor click. */
export function downloadCsvFile(csv: string, filename: string): void {
  downloadTextFile(csv, filename, "text/csv;charset=utf-8");
}
