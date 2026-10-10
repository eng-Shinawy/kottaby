/**
 * Waiver-signatory ingestion for the launch gate.
 *
 * The production-readiness checklist document is the canonical human
 * sign-off record: each waived row's checklist table row carries a trailing
 * `Signatory: <name> (<date>)` cell, written by the accountable owner at
 * sign-off. The gate reads those recorded signatories back at report
 * assembly time so the machine report reflects the human record.
 *
 * Fail-closed contract — the parser never fabricates a signatory:
 *   • A row counts as signed iff its own checklist table row carries a
 *     well-formed `Signatory:` cell with a non-empty value. Every other
 *     shape — row absent from the document, token missing, empty or
 *     whitespace-only value, malformed cell — maps to `""` (the unsigned
 *     state, which stays launch-blocking in the verdict).
 *   • A missing or unreadable document maps every requested rowId to `""`.
 *   • A signatory-looking string on any other line — a different row
 *     (including a decoy rowId the waiver set does not contain), a
 *     non-table line — is never ingested.
 *
 * This ingestion is deliberately separate from the DOC-SIGNOFF existence
 * rule: `.md` evidence artifacts remain existence-checked only, and this
 * module is the single place the gate reads signatory content.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "@/backend/lib/logger";
import type { SignedWaiver } from "@/scripts/launch/launch-report";
import type { LaunchRow } from "@/scripts/launch/shared/launch-types";

/** Repo-relative path of the production-readiness checklist document (the sign-off record). */
export const PRODUCTION_READINESS_DOC = "docs/planning/PRODUCTION_READINESS.md";

/** Row identifiers of every registry row carrying waiver metadata, in registry order. */
export function waiverRowIdsOf(rows: readonly LaunchRow[]): string[] {
  return rows.flatMap(row => (row.waiver !== undefined ? [row.rowId] : []));
}

/** The first markdown-table cell of a line, trimmed — `""` when the line is not a table row. */
function firstTableCell(line: string): string {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("|")) return "";
  const cells = trimmed.split("|");
  return (cells[1] ?? "").trim();
}

const SIGNATORY_TOKEN = "Signatory:";

/**
 * The signatory recorded after a cell's last standalone `Signatory:` token,
 * or `null` when the cell carries no token. A token that is only a suffix
 * (`Co-Signatory:`) counts as a malformed occurrence — its value is the
 * empty string, never the surrounding text.
 */
function signatoryInCell(cell: string): string | null {
  const index = cell.lastIndexOf(SIGNATORY_TOKEN);
  if (index < 0) return null;
  const preceding = index === 0 ? "" : cell.charAt(index - 1);
  if (/[A-Za-z-]/.test(preceding)) return "";
  return cell.slice(index + SIGNATORY_TOKEN.length).trim();
}

/**
 * The signatory a row line records: the value after the last standalone
 * `Signatory:` token, searched from the trailing cell backwards so the
 * row's trailing record cell wins. An empty value — missing token, blank
 * cell, malformed occurrence — is the unsigned state `""`.
 */
function signatoryCellOf(rowLine: string): string {
  for (const cell of rowLine.split("|").toReversed()) {
    const signatory = signatoryInCell(cell);
    if (signatory !== null) return signatory;
  }
  return "";
}

/**
 * Extracts the human-recorded signatory of each requested checklist row
 * from the checklist document's markdown table.
 *
 * Returns a map holding every requested rowId; an unsigned, missing, or
 * malformed row maps to `""`. See the module header for the fail-closed
 * contract.
 */
export function parseWaiverSignatories(rowIds: readonly string[], docPath: string): ReadonlyMap<string, string> {
  let lines: string[] = [];
  try {
    lines = readFileSync(docPath, "utf8").split("\n");
  } catch {
    logger.warn(`waiver-signatory ingestion: checklist document unreadable (${docPath}) — every waiver stays unsigned`);
  }
  const signatories = new Map<string, string>();
  for (const rowId of rowIds) {
    const rowLine = lines.find(line => firstTableCell(line) === rowId);
    signatories.set(rowId, rowLine === undefined ? "" : signatoryCellOf(rowLine));
  }
  return signatories;
}

/**
 * The report's waiver records for a row set: the registry's waiver metadata
 * with the signatory each row's own checklist line records, ingested
 * read-only. A waiver with no recorded signatory carries `""` — the single
 * construction the gate run and its dry-run walk share, so both mirror the
 * human record exactly.
 */
export function waiverRecordsOf(rows: readonly LaunchRow[], projectRoot: string): SignedWaiver[] {
  const signatories = parseWaiverSignatories(waiverRowIdsOf(rows), join(projectRoot, PRODUCTION_READINESS_DOC));
  return rows.flatMap(row =>
    row.waiver
      ? [
          {
            rowId: row.rowId,
            why: row.waiver.why,
            owner: row.waiver.owner,
            signatory: signatories.get(row.rowId) ?? "",
          },
        ]
      : []
  );
}
