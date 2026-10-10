/**
 * Shared CSV record serialization (CWE-1236 posture): the conditional-quote
 * cell builder and the record joiner every CSV export composes over the
 * formula-injection guard. Quoting engages only when a field carries the
 * delimiter, a quote, or a newline — inside quotes every `"` doubles —
 * and a cell opening with a spreadsheet formula trigger (`=`, `+`, `-`,
 * `@`, TAB, CR) is defused by `neutralizeCsvFormulas` BEFORE the quote
 * test runs, so free-text columns export as inert text wherever they
 * appear.
 */

import { neutralizeCsvFormulas } from "@/frontend/utils/csv-formula";

/** UTF-8 BOM — spreadsheet apps detect the encoding and render Arabic labels. */
export const UTF8_BOM = "\uFEFF";

/**
 * Escapes one CSV cell: formula triggers are defused first (CWE-1236),
 * then quoting engages only when the field contains the delimiter, a
 * quote, or a newline — inside quotes every `"` doubles.
 */
function csvCell(value: string): string {
  const safe = neutralizeCsvFormulas(value);
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}

/** Joins cells with the comma delimiter and terminates the record. */
export function csvRecord(cells: readonly string[]): string {
  return `${cells.map(csvCell).join(",")}\n`;
}
