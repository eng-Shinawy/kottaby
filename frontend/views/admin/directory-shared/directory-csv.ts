/**
 * directory-csv — the shared serialization recipe of the admin directory CSV
 * exports (students / teachers / applicants). The domain modules own the
 * COLUMN layout (localized caption handles) and the per-row VALUE mapping
 * (locale-neutral wire data); this module owns the FORMAT.
 *
 * Posture — EVERYTHING here is pure and synchronous:
 *  - `buildDirectoryCsv` turns a header caption row + raw cell rows into one
 *    UTF-8 CSV document (BOM-prefixed so spreadsheet apps open the Arabic
 *    labels correctly);
 *  - `csvBoolCell` serializes booleans as the lowercase wire strings
 *    `true`/`false` — never localized chips/pills;
 *  - `directoryCsvFilename` derives the download filename from the wall
 *    clock (UTC, minute precision — the stamp recipe every directory export
 *    shares).
 *
 * Byte contract: one header record, then one `\n`-terminated record per
 * row; quoting engages only when a field carries the delimiter, a quote,
 * or a newline — inside quotes every `"` doubles; a cell opening with a
 * spreadsheet formula trigger (`=`, `+`, `-`, `@`, TAB, CR) is defused with
 * a leading single quote (CWE-1236) before the quote test runs. The only
 * non-label literals are the field separators (`,`) and the newline
 * (`\n`) — the CSV format itself.
 *
 * Formula-injection posture: every cell is routed through the shared
 * `neutralizeCsvFormulas` guard before quoting and joining, so even if
 * user-authored text ever reached a cell, it would export as inert text
 * rather than a live formula.
 */

import { csvRecord, UTF8_BOM } from "@/frontend/utils/csv-record";

/** Wire serialization of a non-nullable Boolean column. */
export function csvBoolCell(value: boolean): string {
  return value ? "true" : "false";
}

/** One directory CSV document: the localized caption row + one cell row per record. */
export interface DirectoryCsvDocument {
  /** The localized column captions, in column order. */
  readonly headers: readonly string[];
  /** The raw (unescaped) cell values of every record, in column order. */
  readonly rows: readonly (readonly string[])[];
}

/**
 * Builds the full CSV document: the BOM-prefixed header record, then one
 * record per row — escaping applied uniformly to every cell.
 */
export function buildDirectoryCsv({ headers, rows }: DirectoryCsvDocument): string {
  const lines: string[] = [csvRecord(headers)];
  for (const cells of rows) {
    lines.push(csvRecord(cells));
  }
  return `${UTF8_BOM}${lines.join("")}`;
}

/**
 * Derives the download filename from the wall clock:
 * `${prefix}-YYYY-MM-DD-HHmm.csv` (UTC, minute precision). The clock is
 * injected so callers (and tests) can pin the stamp; production uses the
 * default.
 */
export function directoryCsvFilename(prefix: string, now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = pad(now.getUTCMonth() + 1);
  const day = pad(now.getUTCDate());
  const hour = pad(now.getUTCHours());
  const minute = pad(now.getUTCMinutes());
  return `${prefix}-${year}-${month}-${day}-${hour}${minute}.csv`;
}

/** Zero-pads a number to two digits (UTC stamp components of the CSV filename). */
function pad(input: number): string {
  return String(input).padStart(2, "0");
}

/**
 * downloadTextFile — the browser download recipe shared by every admin
 * export flow (directory page exports, the audit trail's page + export-all
 * flows, the teachers' server-side export): CSV string → Blob → object URL
 * → synthetic anchor click → revoke. The anchor is appended to the
 * document before the programmatic click — Firefox ignores clicks on
 * detached anchors — and removed immediately after; the object URL
 * revocation is deferred one tick so the download request has been
 * dispatched before the blob is released.
 */
export function downloadTextFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
