/**
 * Paired self-validation test for waiver-signatory ingestion — the parser
 * that reads the human-recorded `Signatory:` cells from the
 * production-readiness checklist document.
 *
 * The contract under test is fail-closed: the parser ingests exactly what a
 * row's own table line records, and every other shape (missing file, missing
 * row, missing token, empty value, malformed cell, signatory-looking text on
 * any other line) maps to the unsigned state `""`.
 *
 * Every fixture is a process-private temp file — the repo's real checklist
 * document is never read here.
 */

import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAUNCH_CHECKLIST } from "@/scripts/launch/launch-checklist";
import {
  PRODUCTION_READINESS_DOC,
  parseWaiverSignatories,
  waiverRowIdsOf,
} from "@/scripts/launch/launch-waiver-signatories";
import type { LaunchRow } from "@/scripts/launch/shared/launch-types";

const tempDirs: string[] = [];

/** The registry's waiver rowIds — the exact set the gate ingests. */
const WAIVER_ROW_IDS = waiverRowIdsOf(LAUNCH_CHECKLIST);

/** A temp evidence root holding a checklist document with the given content. */
function evidenceRootWithDoc(content: string): string {
  const root = mkdtempSync(join(tmpdir(), "launch-waiver-signatory-test-"));
  tempDirs.push(root);
  mkdirSync(join(root, "docs", "planning"), { recursive: true });
  writeFileSync(join(root, PRODUCTION_READINESS_DOC), content);
  return root;
}

/** The doc path inside a temp evidence root. */
const docPathOf = (root: string): string => join(root, PRODUCTION_READINESS_DOC);

/** A checklist-doc fixture whose waiver rows end with the given Signatory cell text. */
function readinessDoc(signatoryCellOf: (rowId: string) => string): string {
  const lines = [
    "# Production readiness",
    "",
    "| Row | Criterion | Response | Notes |",
    "|---|---|---|---|",
    ...WAIVER_ROW_IDS.map(
      rowId => `| ${rowId} | criterion ${rowId} | ☐ WHY: waived | ledger note. ${signatoryCellOf(rowId)} |`
    ),
  ];
  return `${lines.join("\n")}\n`;
}

/** The registry's waived row — the shape `waiverRowIdsOf` selects on. */
const waivedRow = (rowId: string): LaunchRow => ({
  rowId,
  section: 3,
  modality: "AUTOMATED-TEST",
  command: "bun tsgo",
  evidenceRef: "logs/<run-stamp>/x.log",
  waiver: { why: "waived with sign-off", owner: "Dev 3" },
});

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("waiverRowIdsOf", () => {
  it("selects exactly the registry's waived rows, in registry order", () => {
    expect(WAIVER_ROW_IDS).toEqual(["3.3.3", "4.2.1", "4.2.5", "4.3.4", "5.1.1", "5.1.2", "5.5.6", "8.26"]);
    expect(waiverRowIdsOf([waivedRow("5.5.6"), { ...waivedRow("9.14"), waiver: undefined }])).toEqual(["5.5.6"]);
  });
});

// ─── Tier 1 — happy path: signed rows are ingested verbatim ────────────────────

describe("parseWaiverSignatories — Tier 1 (signed rows ingest verbatim)", () => {
  it("extracts each waiver row's recorded signatory, value untouched", () => {
    const root = evidenceRootWithDoc(readinessDoc(() => "Signatory: Product Owner (2026-10-10)"));
    const parsed = parseWaiverSignatories(WAIVER_ROW_IDS, docPathOf(root));
    for (const rowId of WAIVER_ROW_IDS) {
      expect(parsed.get(rowId)).toBe("Product Owner (2026-10-10)");
    }
  });

  it("signatory values may contain any non-pipe text and lose only surrounding whitespace", () => {
    const root = evidenceRootWithDoc(
      "| Row | Notes |\n|---|---|\n| 3.3.3 | why text. Signatory:   دكتور نامي — 中文 (2026-10-10)   |\n"
    );
    const parsed = parseWaiverSignatories(["3.3.3"], docPathOf(root));
    expect(parsed.get("3.3.3")).toBe("دكتور نامي — 中文 (2026-10-10)");
  });

  it("a row line without a trailing table pipe still yields the cell to end-of-line", () => {
    const root = evidenceRootWithDoc("| Row | Notes |\n| 3.3.3 | why. Signatory: Product Owner (2026-10-10)\n");
    expect(parseWaiverSignatories(["3.3.3"], docPathOf(root)).get("3.3.3")).toBe("Product Owner (2026-10-10)");
  });
});

// ─── Tier 2 — boundaries: every unsigned shape maps to "" ─────────────────────

describe("parseWaiverSignatories — Tier 2 (fail-closed boundaries)", () => {
  it("maps every rowId to the empty string when the document is missing", () => {
    const parsed = parseWaiverSignatories(WAIVER_ROW_IDS, join(tmpdir(), "no-such-dir", PRODUCTION_READINESS_DOC));
    expect(parsed.size).toBe(WAIVER_ROW_IDS.length);
    for (const value of parsed.values()) expect(value).toBe("");
  });

  it("maps a rowId to the empty string when its row is absent from the document", () => {
    const root = evidenceRootWithDoc(readinessDoc(() => "Signatory: Product Owner (2026-10-10)"));
    const parsed = parseWaiverSignatories(["9.14"], docPathOf(root));
    expect(parsed.get("9.14")).toBe("");
  });

  it("maps a row to the empty string when it carries no Signatory token", () => {
    const root = evidenceRootWithDoc(readinessDoc(() => ""));
    const parsed = parseWaiverSignatories(WAIVER_ROW_IDS, docPathOf(root));
    for (const value of parsed.values()) expect(value).toBe("");
  });

  it("maps a whitespace-only signatory value to the empty string", () => {
    const root = evidenceRootWithDoc(readinessDoc(() => "Signatory:    "));
    const parsed = parseWaiverSignatories(WAIVER_ROW_IDS, docPathOf(root));
    for (const value of parsed.values()) expect(value).toBe("");
  });

  it("ignores a signatory-looking string on a non-table line", () => {
    const root = evidenceRootWithDoc(
      "# Production readiness\n\nFree text: Signatory: Impostor (2026-10-10) — not a table row\n"
    );
    const parsed = parseWaiverSignatories(["3.3.3"], docPathOf(root));
    expect(parsed.get("3.3.3")).toBe("");
  });
});

// ─── Tier 3 — malformed shapes are treated as unsigned, never coerced ─────────

describe("parseWaiverSignatories — Tier 3 (malformed cells stay unsigned)", () => {
  it("treats a valueless `Signatory:` cell as unsigned", () => {
    const root = evidenceRootWithDoc(readinessDoc(() => "Signatory:"));
    const parsed = parseWaiverSignatories(WAIVER_ROW_IDS, docPathOf(root));
    for (const value of parsed.values()) expect(value).toBe("");
  });

  it("treats a `Signatory` token without its colon as unsigned", () => {
    const root = evidenceRootWithDoc(readinessDoc(() => "Signatory | Product Owner (2026-10-10)"));
    const parsed = parseWaiverSignatories(WAIVER_ROW_IDS, docPathOf(root));
    for (const value of parsed.values()) expect(value).toBe("");
  });

  it("takes the trailing occurrence when a row line carries more than one Signatory cell", () => {
    const root = evidenceRootWithDoc(
      "| Row | Notes |\n| 3.3.3 | Signatory: stale (2026-01-01). Ledger note. Signatory: Product Owner (2026-10-10) |\n"
    );
    expect(parseWaiverSignatories(["3.3.3"], docPathOf(root)).get("3.3.3")).toBe("Product Owner (2026-10-10)");
  });

  it("treats a `Co-Signatory:` suffix token as malformed — unsigned, never its surrounding text", () => {
    const root = evidenceRootWithDoc("| Row | Notes |\n| 3.3.3 | why. Co-Signatory: Impostor (2026-10-10) |\n");
    expect(parseWaiverSignatories(["3.3.3"], docPathOf(root)).get("3.3.3")).toBe("");
  });
});

// ─── Tier 4 — hostile inputs: no cross-row or cross-line fabrication ───────────

describe("parseWaiverSignatories — Tier 4 (never ingests another row's signatory)", () => {
  it("a decoy rowId sharing a numeric prefix never signs the waived row", () => {
    const root = evidenceRootWithDoc(
      [
        "| Row | Notes |",
        "|---|---|",
        "| 3.3.30 | sibling row. Signatory: Impostor (2026-10-10) |",
        "| 5.1.12 | sibling row. Signatory: Impostor (2026-10-10) |",
        "| 8.261 | sibling row. Signatory: Impostor (2026-10-10) |",
      ].join("\n")
    );
    for (const rowId of ["3.3.3", "5.1.1", "8.26"]) {
      expect(parseWaiverSignatories([rowId], docPathOf(root)).get(rowId)).toBe("");
    }
  });

  it("an unsigned row stays unsigned even when every other waived row is signed", () => {
    const root = evidenceRootWithDoc(
      readinessDoc(rowId => (rowId === "4.3.4" ? "" : "Signatory: Product Owner (2026-10-10)"))
    );
    const parsed = parseWaiverSignatories(WAIVER_ROW_IDS, docPathOf(root));
    expect(parsed.get("4.2.1")).toBe("Product Owner (2026-10-10)");
    expect(parsed.get("4.3.4")).toBe("");
  });

  it("a large noisy document yields the same result as a minimal one", () => {
    const noise = Array.from(
      { length: 500 },
      (_, index) => `| 2.${index} | filler ${index}. Signatory: Noise ${index} (2026-01-01) |`
    );
    const doc = [
      "# Production readiness",
      "| Row | Notes |",
      "|---|---|",
      ...noise,
      "| 3.3.3 | why. Signatory: Product Owner (2026-10-10) |",
    ].join("\n");
    const root = evidenceRootWithDoc(doc);
    expect(parseWaiverSignatories(["3.3.3"], docPathOf(root)).get("3.3.3")).toBe("Product Owner (2026-10-10)");
  });
});
