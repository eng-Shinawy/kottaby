import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  computeVerdict,
  type LaunchReport,
  type LaunchReportWriteOptions,
  type SignedWaiver,
  writeLaunchReport,
} from "@/scripts/launch/launch-report";
import type { LaunchReportRow, StageResult } from "@/scripts/launch/shared/launch-types";

/** A passing report row with overridable fields. */
function reportRow(overrides: Partial<LaunchReportRow> = {}): LaunchReportRow {
  return {
    rowId: "1.1.1",
    section: 1,
    modality: "AUTOMATED-TEST",
    command: "bun run test/scripts/run-test.ts backend/db/test/logic/shared/data-integrity.probe.test.ts",
    exitStatus: 0,
    result: "PASS",
    evidenceRef: "logs/20261009T000000Z/data-integrity.probe.log",
    timestamp: "2026-10-09T00:00:00.000Z",
    ...overrides,
  };
}

/** A passing stage result with overridable fields. */
function stageResult(overrides: Partial<StageResult> = {}): StageResult {
  return {
    stage: "s1-data-integrity",
    status: "PASS",
    startedAt: "2026-10-09T00:00:00.000Z",
    finishedAt: "2026-10-09T00:01:00.000Z",
    ...overrides,
  };
}

/** A signed waiver record with overridable fields. */
function signedWaiver(overrides: Partial<SignedWaiver> = {}): SignedWaiver {
  return {
    rowId: "3.3.3",
    why: "booking-time availability re-assertion waived",
    owner: "Dev 3",
    signatory: "Product Owner",
    ...overrides,
  };
}

const ROW_KEYS = ["command", "evidenceRef", "exitStatus", "modality", "result", "rowId", "section", "timestamp"];
const STAGE_KEYS = ["finishedAt", "stage", "startedAt", "status"];
const WAIVER_KEYS = ["owner", "rowId", "signatory", "why"];
const REPORT_KEYS = ["generatedAt", "rows", "stages", "verdict", "waivers"];

/** Alphabetical comparator for key-set comparisons. */
const alphabetical = (a: string, b: string): number => a.localeCompare(b);

const tempDirs: string[] = [];

/** A fresh temp output directory (removed in afterAll). */
function tempOutputDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "launch-report-test-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("computeVerdict", () => {
  it("returns PASS when every row passed", () => {
    const rows = [reportRow(), reportRow({ rowId: "2.1.1", section: 2 }), reportRow({ rowId: "9.17", section: 9 })];
    expect(computeVerdict(rows)).toBe("PASS");
  });

  it("returns PASS for an empty row set", () => {
    expect(computeVerdict([])).toBe("PASS");
  });

  it("returns FAIL if any row failed", () => {
    const rows = [reportRow(), reportRow({ rowId: "4.3.5", section: 4, result: "FAIL", exitStatus: 1 })];
    expect(computeVerdict(rows)).toBe("FAIL");
  });

  it("returns FAIL for a waived row with no waiver record", () => {
    const rows = [reportRow(), reportRow({ rowId: "5.1.1", section: 5, result: "WAIVED" })];
    expect(computeVerdict(rows)).toBe("FAIL");
  });

  it("returns FAIL for a waived row whose waiver record is unsigned", () => {
    const rows = [reportRow({ rowId: "5.1.1", section: 5, result: "WAIVED" })];
    expect(computeVerdict(rows, [signedWaiver({ rowId: "5.1.1", signatory: "" })])).toBe("FAIL");
  });

  it("returns FAIL for a waived row whose waiver signatory is whitespace-only", () => {
    const rows = [reportRow({ rowId: "5.1.1", section: 5, result: "WAIVED" })];
    expect(computeVerdict(rows, [signedWaiver({ rowId: "5.1.1", signatory: "   " })])).toBe("FAIL");
  });

  it("returns PASS for a waived row with a signed waiver record", () => {
    const rows = [
      reportRow(),
      reportRow({ rowId: "8.26", section: 8, result: "WAIVED" }),
      reportRow({ rowId: "9.14", section: 9 }),
    ];
    expect(computeVerdict(rows, [signedWaiver({ rowId: "8.26" })])).toBe("PASS");
  });

  it("returns PASS when every row is waived and every waiver is signed", () => {
    const rows = [
      reportRow({ rowId: "3.3.3", section: 3, result: "WAIVED" }),
      reportRow({ rowId: "4.2.1", section: 4, result: "WAIVED" }),
    ];
    const waivers = [signedWaiver({ rowId: "3.3.3" }), signedWaiver({ rowId: "4.2.1", owner: "Dev 2" })];
    expect(computeVerdict(rows, waivers)).toBe("PASS");
  });

  it("returns FAIL when any waiver record lacks a signatory, even if every row passed", () => {
    const rows = [reportRow({ rowId: "2.1.1", section: 2 })];
    const waivers = [signedWaiver({ rowId: "4.3.4", signatory: "" })];
    expect(computeVerdict(rows, waivers)).toBe("FAIL");
  });

  it("treats a FAIL row as blocking even when its waiver is signed", () => {
    const rows = [reportRow({ rowId: "6.1", section: 6, result: "FAIL", exitStatus: 1 })];
    expect(computeVerdict(rows, [signedWaiver({ rowId: "6.1" })])).toBe("FAIL");
  });

  it("matches a waiver to its row by rowId only", () => {
    const rows = [reportRow({ rowId: "5.5.6", section: 5, result: "WAIVED" })];
    expect(computeVerdict(rows, [signedWaiver({ rowId: "8.26" })])).toBe("FAIL");
  });
});

describe("writeLaunchReport", () => {
  const fixedNow = new Date("2026-01-02T03:04:05.678Z");
  const writerOptions = (outputDir: string, stdoutLines?: string[]): LaunchReportWriteOptions => ({
    outputDir,
    now: fixedNow,
    ...(stdoutLines ? { stdout: (line: string) => stdoutLines.push(line) } : {}),
  });

  it("writes the stamped report and returns its path", () => {
    const outputDir = tempOutputDir();
    const rows = [reportRow()];
    const stages = [stageResult()];
    const waivers = [signedWaiver({ rowId: "3.3.3" })];
    const waivedRows = [reportRow({ rowId: "3.3.3", section: 3, result: "WAIVED" }), ...rows];

    const reportPath = writeLaunchReport(waivedRows, stages, waivers, writerOptions(outputDir));

    expect(reportPath).toBe(join(outputDir, "launch-report-20260102T030405Z.json"));
    expect(basename(reportPath)).toBe("launch-report-20260102T030405Z.json");
    expect(dirname(reportPath)).toBe(outputDir);

    const report: LaunchReport = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(report.generatedAt).toBe("2026-01-02T03:04:05.678Z");
    expect(report.verdict).toBe("PASS");
    expect(report.rows).toEqual(waivedRows);
    expect(report.stages).toEqual(stages);
    expect(report.waivers).toEqual(waivers);
  });

  it("prints exactly the VERDICT line for a passing report", () => {
    const stdoutLines: string[] = [];
    writeLaunchReport([reportRow()], [stageResult()], [], writerOptions(tempOutputDir(), stdoutLines));
    expect(stdoutLines).toEqual(["VERDICT: PASS"]);
  });

  it("prints VERDICT: FAIL for a failing report", () => {
    const stdoutLines: string[] = [];
    const rows = [reportRow({ result: "FAIL", exitStatus: 1 })];
    writeLaunchReport(rows, [stageResult({ status: "FAIL" })], [], writerOptions(tempOutputDir(), stdoutLines));
    expect(stdoutLines).toEqual(["VERDICT: FAIL"]);
  });

  it("drops non-allowlisted runtime properties from rows, stages, and waivers", () => {
    const outputDir = tempOutputDir();
    const plantedRow = {
      ...reportRow({ rowId: "4.3.5", section: 4 }),
      secret: "hunter2-password",
      env: "postgres://user:pass@db.internal:5432/kottaby",
      nestedToken: { accessToken: "ya29.planted" },
    } as LaunchReportRow;
    const plantedStage = {
      ...stageResult({ stage: "s4-security" }),
      connectionString: "postgres://admin:pw@prod:5432/db",
    } as StageResult;
    const plantedWaiver = {
      ...signedWaiver(),
      bearer: "cron-secret-value",
    } as SignedWaiver;

    const reportPath = writeLaunchReport([plantedRow], [plantedStage], [plantedWaiver], writerOptions(outputDir));

    const raw = readFileSync(reportPath, "utf8");
    expect(raw.includes("hunter2-password")).toBe(false);
    expect(raw.includes("postgres://")).toBe(false);
    expect(raw.includes("ya29.planted")).toBe(false);
    expect(raw.includes("cron-secret-value")).toBe(false);

    const report: LaunchReport = JSON.parse(raw);
    expect(Object.keys(report.rows[0]).toSorted(alphabetical)).toEqual(ROW_KEYS);
    expect(Object.keys(report.stages[0]).toSorted(alphabetical)).toEqual(STAGE_KEYS);
    expect(Object.keys(report.waivers[0]).toSorted(alphabetical)).toEqual(WAIVER_KEYS);
    expect(Object.keys(report).toSorted(alphabetical)).toEqual(REPORT_KEYS);
  });

  it("round-trips unicode evidence strings byte-identically", () => {
    const outputDir = tempOutputDir();
    const unicode = "✅ ☐ ελληνικά 中文 — کارا";
    const rows = [
      reportRow({ command: `bun run probe --label ${unicode}`, evidenceRef: `logs/20260102T030405Z/${unicode}.log` }),
    ];

    const reportPath = writeLaunchReport(rows, [], [], writerOptions(outputDir));

    const report: LaunchReport = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(report.rows[0].command).toBe(`bun run probe --label ${unicode}`);
    expect(report.rows[0].evidenceRef).toBe(`logs/20260102T030405Z/${unicode}.log`);
  });

  it("derives the file path from the clock only — row data cannot traverse paths", () => {
    const outputDir = tempOutputDir();
    const hostileRows = [
      reportRow({ rowId: "../../../etc/cron.d/evil", evidenceRef: "../../secrets/.env" }),
      reportRow({ rowId: "6.1", command: "bun ../../escape.js" }),
    ];

    const reportPath = writeLaunchReport(hostileRows, [], [], writerOptions(outputDir));

    expect(basename(reportPath)).toBe("launch-report-20260102T030405Z.json");
    expect(dirname(reportPath)).toBe(outputDir);
  });

  it("fails closed when the stamped report already exists instead of clobbering it", () => {
    const outputDir = tempOutputDir();
    const options = writerOptions(outputDir);
    writeLaunchReport([reportRow()], [], [], options);
    expect(() => writeLaunchReport([reportRow()], [], [], options)).toThrow();
  });

  it("handles a large shuffled row set with the correct verdict", () => {
    const outputDir = tempOutputDir();
    const stdoutLines: string[] = [];
    const rowCount = 2000;

    // Deterministic LCG shuffle so the row order is randomized but reproducible.
    let seed = 42;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const rows: LaunchReportRow[] = Array.from({ length: rowCount }, (_, index) => {
      if (index % 97 === 0) {
        return reportRow({ rowId: `5.${index}.waived`, section: 5, result: "WAIVED" });
      }
      return reportRow({ rowId: `9.${index}`, section: 9 });
    });
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const swap = rows[i];
      rows[i] = rows[j];
      rows[j] = swap;
    }
    const waivers = Array.from({ length: Math.ceil(rowCount / 97) }, (_, index) =>
      signedWaiver({ rowId: `5.${index * 97}.waived` })
    );

    const reportPath = writeLaunchReport(rows, [], waivers, writerOptions(outputDir, stdoutLines));

    const report: LaunchReport = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(report.rows).toHaveLength(rowCount);
    expect(report.waivers).toHaveLength(Math.ceil(rowCount / 97));
    expect(report.verdict).toBe("PASS");
    expect(stdoutLines).toEqual(["VERDICT: PASS"]);

    const failing = [...rows];
    failing[failing.length - 1] = reportRow({ rowId: "9.last", section: 9, result: "FAIL", exitStatus: 1 });
    const failDir = tempOutputDir();
    const failPath = writeLaunchReport(failing, [], waivers, writerOptions(failDir));
    const failReport: LaunchReport = JSON.parse(readFileSync(failPath, "utf8"));
    expect(failReport.verdict).toBe("FAIL");
  });
});
