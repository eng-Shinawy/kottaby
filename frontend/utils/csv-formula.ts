/**
 * CSV formula-injection guard (CWE-1236): an exported value could open with
 * a spreadsheet formula trigger (`=`, `+`, `-`, `@`, TAB, CR) and be
 * evaluated as a formula by Excel/Sheets on import. Prefixing a single
 * quote defuses the cell — the viewer renders it as literal text. Every CSV
 * cell builder applies this BEFORE quoting and joining cells into records,
 * so free-text columns are neutralized wherever they appear.
 */
export function neutralizeCsvFormulas(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
