import { describe, expect, it } from "bun:test";
import { LAUNCH_CHECKLIST, rowsForStage, STAGES } from "@/scripts/launch/launch-checklist";
import type { LaunchModality } from "@/scripts/launch/shared/launch-types";

/** `<subSection>.<row>` ids for a subsection with `rowCount` rows (e.g. 1.1.1..1.1.5). */
function subSectionIds(subSection: number, item: number, rowCount: number): string[] {
  return Array.from({ length: rowCount }, (_, index) => `${subSection}.${item}.${index + 1}`);
}

/** `<section>.<row>` ids for a flat section (e.g. 6.1..6.7). */
function flatSectionIds(section: number, rowCount: number): string[] {
  return Array.from({ length: rowCount }, (_, index) => `${section}.${index + 1}`);
}

const EXPECTED_ROW_IDS: ReadonlySet<string> = new Set([
  ...subSectionIds(1, 1, 5),
  ...subSectionIds(1, 2, 4),
  ...subSectionIds(1, 3, 5),
  ...subSectionIds(1, 4, 3),
  ...subSectionIds(2, 1, 5),
  ...subSectionIds(2, 2, 6),
  ...subSectionIds(2, 3, 5),
  ...subSectionIds(2, 4, 4),
  ...subSectionIds(2, 5, 5),
  ...subSectionIds(3, 1, 4),
  ...subSectionIds(3, 2, 4),
  ...subSectionIds(3, 3, 4),
  ...subSectionIds(3, 4, 5),
  ...subSectionIds(4, 1, 6),
  ...subSectionIds(4, 2, 5),
  ...subSectionIds(4, 3, 5),
  ...subSectionIds(5, 1, 8),
  ...subSectionIds(5, 2, 6),
  ...subSectionIds(5, 3, 6),
  ...subSectionIds(5, 4, 8),
  ...subSectionIds(5, 5, 6),
  ...flatSectionIds(6, 7),
  ...flatSectionIds(7, 7),
  ...flatSectionIds(8, 33),
  ...flatSectionIds(9, 17),
]);

const EXPECTED_SECTION_COUNTS: Readonly<Record<number, number>> = {
  1: 17,
  2: 25,
  3: 17,
  4: 16,
  5: 34,
  6: 7,
  7: 7,
  8: 33,
  9: 17,
};

const WAIVED_ROW_IDS: ReadonlySet<string> = new Set([
  "3.3.3",
  "4.2.1",
  "4.2.5",
  "4.3.4",
  "5.1.1",
  "5.1.2",
  "5.5.6",
  "8.26",
]);

const MANUAL_DRILL_IDS: ReadonlySet<string> = new Set(["7.1", "7.7"]);

const DOC_SIGNOFF_IDS: ReadonlySet<string> = new Set([
  "7.4",
  "7.5",
  "7.6",
  "8.13",
  "9.1",
  "9.2",
  "9.3",
  "9.4",
  "9.5",
  "9.17",
]);

const SCRIPT_PROBE_IDS: ReadonlySet<string> = new Set([
  "1.4.1",
  "1.4.3",
  "4.3.5",
  "5.4.1",
  "5.4.2",
  "5.4.3",
  "5.4.8",
  "6.1",
  "6.2",
  "6.3",
  "6.4",
  "6.6",
  "8.1",
  "8.2",
  "8.4",
  "8.6",
  "8.8",
  "8.9",
  "8.10",
  "8.18",
  "8.19",
  "8.20",
  "8.26",
]);

function idsWithModality(modality: LaunchModality): ReadonlySet<string> {
  return new Set(LAUNCH_CHECKLIST.filter(row => row.modality === modality).map(row => row.rowId));
}

function expectSameIds(actual: ReadonlySet<string>, expected: ReadonlySet<string>): void {
  expect(actual.size).toBe(expected.size);
  for (const id of expected) {
    expect(actual.has(id)).toBe(true);
  }
}

describe("launch-checklist row registry", () => {
  it("holds exactly the 173 checklist rows with zero duplicate ids", () => {
    expect(LAUNCH_CHECKLIST).toHaveLength(173);
    expect(new Set(LAUNCH_CHECKLIST.map(row => row.rowId)).size).toBe(173);
  });

  it("covers exactly the expected row-id set (no invented, no missing rows)", () => {
    const actual = new Set(LAUNCH_CHECKLIST.map(row => row.rowId));
    expectSameIds(actual, EXPECTED_ROW_IDS);
  });

  it("matches the per-section row counts of the readiness document", () => {
    const counts = new Map<number, number>();
    for (const row of LAUNCH_CHECKLIST) {
      counts.set(row.section, (counts.get(row.section) ?? 0) + 1);
    }
    for (const [section, expected] of Object.entries(EXPECTED_SECTION_COUNTS)) {
      expect(counts.get(Number(section)) ?? 0).toBe(expected);
    }
    expect([...counts.keys()].toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("keeps every row's section consistent with its row-id prefix", () => {
    for (const row of LAUNCH_CHECKLIST) {
      expect(Number(row.rowId.split(".")[0])).toBe(row.section);
    }
  });

  it("carries a non-empty command and evidence reference on every row", () => {
    for (const row of LAUNCH_CHECKLIST) {
      expect(row.command.trim().length).toBeGreaterThan(0);
      expect(row.evidenceRef.trim().length).toBeGreaterThan(0);
    }
  });

  it("lists the nine stages in canonical order", () => {
    expect(STAGES).toEqual([
      "s1-data-integrity",
      "s2-financial",
      "s3-realtime",
      "s4-security",
      "s5-invariants",
      "s6-performance",
      "s7-dr",
      "s8-decisions",
      "s9-gate",
    ]);
  });

  it("maps every stage to exactly its section's rows — full coverage, no overlap, no orphans", () => {
    expect(STAGES).toHaveLength(9);
    const seen = new Set<string>();
    for (const [index, stage] of STAGES.entries()) {
      const stageRows = rowsForStage(stage);
      const expectedSection = index + 1;
      expect(stageRows).toHaveLength(EXPECTED_SECTION_COUNTS[expectedSection] ?? 0);
      for (const row of stageRows) {
        expect(expectedSection).toBe(row.section);
        expect(seen.has(row.rowId)).toBe(false);
        seen.add(row.rowId);
      }
    }
    expectSameIds(seen, new Set(LAUNCH_CHECKLIST.map(row => row.rowId)));
  });

  it("carries waivers on exactly the known waiver set, each with a rationale and a named owner", () => {
    const waivedIds = new Set(LAUNCH_CHECKLIST.filter(row => row.waiver).map(row => row.rowId));
    expectSameIds(waivedIds, WAIVED_ROW_IDS);
    for (const row of LAUNCH_CHECKLIST) {
      if (!row.waiver) {
        continue;
      }
      expect(row.waiver.why.trim().length).toBeGreaterThan(0);
      expect(row.waiver.owner.trim().length).toBeGreaterThan(0);
    }
  });

  it("matches the as-built modality census exactly", () => {
    expectSameIds(idsWithModality("MANUAL-DRILL"), MANUAL_DRILL_IDS);
    expectSameIds(idsWithModality("DOC-SIGNOFF"), DOC_SIGNOFF_IDS);
    expectSameIds(idsWithModality("SCRIPT-PROBE"), SCRIPT_PROBE_IDS);
    const automated = idsWithModality("AUTOMATED-TEST");
    expect(automated.size).toBe(173 - MANUAL_DRILL_IDS.size - DOC_SIGNOFF_IDS.size - SCRIPT_PROBE_IDS.size);
    const nonAutomated = new Set([...MANUAL_DRILL_IDS, ...DOC_SIGNOFF_IDS, ...SCRIPT_PROBE_IDS]);
    for (const rowId of automated) {
      expect(nonAutomated.has(rowId)).toBe(false);
    }
  });

  it("splits the sign-off section into its five signature rows and twelve criteria rows", () => {
    const sectionNine = rowsForStage("s9-gate");
    expect(sectionNine).toHaveLength(17);
    const signatures = sectionNine.filter(row => row.modality === "DOC-SIGNOFF");
    expect(signatures.map(row => row.rowId)).toEqual(["9.1", "9.2", "9.3", "9.4", "9.5", "9.17"]);
    const criteria = sectionNine.filter(row => row.modality === "AUTOMATED-TEST");
    expect(criteria.map(row => row.rowId)).toEqual([
      "9.6",
      "9.7",
      "9.8",
      "9.9",
      "9.10",
      "9.11",
      "9.12",
      "9.13",
      "9.14",
      "9.15",
      "9.16",
    ]);
  });
});
