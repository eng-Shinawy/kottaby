/**
 * Paired self-validation test for the launch gate's dry-run walk — the
 * harness validating itself without executing a single suite. The real
 * registry is walked with the gate's own collaborators (state functions,
 * evidence-ref resolver); boundary behavior is pinned against small
 * synthetic registries. Everything the walk touches lives in
 * process-private temp directories — the repo-root state file, docs/planning,
 * and every cache stay untouched.
 */

import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAUNCH_CHECKLIST, rowsForStage, STAGES } from "@/scripts/launch/launch-checklist";
import { clearGateState, readGateState, resolveEvidenceRef, saveGateState } from "@/scripts/launch/launch-gate";
import {
  citedTargetsOf,
  type DryRunDeps,
  evidenceArtifactVerdict,
  runDryRun,
} from "@/scripts/launch/launch-gate-dryrun";
import {
  PRODUCTION_READINESS_DOC,
  parseWaiverSignatories,
  waiverRowIdsOf,
} from "@/scripts/launch/launch-waiver-signatories";
import type { LaunchRow, LaunchStage } from "@/scripts/launch/shared/launch-types";

const STATE_FILE = join(process.cwd(), ".launch-gate-state.json");

/** The mandated per-stage inventory, pinned independently of the registry. */
const EXPECTED_COUNTS: Readonly<Record<LaunchStage, number>> = {
  "s1-data-integrity": 17,
  "s2-financial": 25,
  "s3-realtime": 17,
  "s4-security": 16,
  "s5-invariants": 34,
  "s6-performance": 7,
  "s7-dr": 7,
  "s8-decisions": 33,
  "s9-gate": 17,
};

// ─── State-file stewardship (defensive — the walk never touches it) ───────────

let originalState: string | null = null;

beforeAll(() => {
  originalState = existsSync(STATE_FILE) ? readFileSync(STATE_FILE, "utf8") : null;
});

afterAll(() => {
  if (originalState === null) {
    if (existsSync(STATE_FILE)) rmSync(STATE_FILE);
  } else if (!existsSync(STATE_FILE) || readFileSync(STATE_FILE, "utf8") !== originalState) {
    writeFileSync(STATE_FILE, originalState);
  }
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

/** A temp evidence root holding one JSON drill report with the given body. */
function jsonEvidenceRoot(reportBody: string): string {
  const root = mkdtempSync(join(tmpdir(), "launch-gate-dryrun-evidence-"));
  tempDirs.push(root);
  mkdirSync(join(root, "evidence"), { recursive: true });
  writeFileSync(join(root, "evidence", "restore-report.json"), reportBody);
  return root;
}

/** Records the walk's stdout lines instead of printing them. */
function makeDeps(lines: string[], overrides: Partial<DryRunDeps> = {}): DryRunDeps {
  return {
    now: () => new Date("2026-10-09T07:00:00.000Z"),
    runStamp: "2026-10-09T07-00-00",
    reportStamp: "20261009T070000Z",
    projectRoot: process.cwd(),
    resolveRef: resolveEvidenceRef,
    artifactExists: (artifactPath: string) => existsSync(artifactPath),
    artifactVerdict: evidenceArtifactVerdict,
    saveState: saveGateState,
    readState: readGateState,
    clearState: clearGateState,
    stages: STAGES,
    rows: LAUNCH_CHECKLIST,
    rowsForStage,
    expectedStageCounts: EXPECTED_COUNTS,
    expectedTotalRows: 173,
    stdout: (line: string) => lines.push(line),
    ...overrides,
  };
}

/** One synthetic registry row for boundary tests. */
function makeRow(rowId: string, modality: LaunchRow["modality"], command: string, evidenceRef: string): LaunchRow {
  return { rowId, section: 1, modality, command, evidenceRef };
}

/** Minimal deps over a tiny synthetic single-stage registry. */
function syntheticDeps(rows: readonly LaunchRow[], overrides: Partial<DryRunDeps> = {}): DryRunDeps {
  const lines: string[] = [];
  return makeDeps(lines, {
    rows,
    stages: ["s1-data-integrity"],
    rowsForStage: () => rows,
    expectedStageCounts: { ...EXPECTED_COUNTS, "s1-data-integrity": rows.length },
    expectedTotalRows: rows.length,
    ...overrides,
    stdout: (line: string) => lines.push(line),
  });
}

// ─── The real walk ────────────────────────────────────────────────────────────

describe("dry run — the real registry walk", () => {
  it("walks 173/173 rows green: mandated stage counts, 8 waivers, 12 existence rows, zero findings", () => {
    const lines: string[] = [];
    const summary = runDryRun(makeDeps(lines));
    expect(summary.exitCode).toBe(0);
    expect(summary.findings).toEqual([]);
    expect(summary.totalRows).toBe(173);
    expect(summary.stageCounts).toEqual(STAGES.map(stage => [stage, EXPECTED_COUNTS[stage]]));
    expect(summary.waiverRows).toEqual(["3.3.3", "4.2.1", "4.2.5", "4.3.4", "5.1.1", "5.1.2", "5.5.6", "8.26"]);
    expect(summary.existenceRows).toEqual([
      "7.1",
      "7.4",
      "7.5",
      "7.6",
      "7.7",
      "8.13",
      "9.1",
      "9.2",
      "9.3",
      "9.4",
      "9.5",
      "9.17",
    ]);
    expect(lines.some(line => line === "— s1-data-integrity: 17 rows")).toBe(true);
    expect(lines.some(line => line === "— s9-gate: 17 rows")).toBe(true);
    expect(lines[lines.length - 1]).toContain("Dry-run complete");
  });

  it("performs the state cycle: 9 round-trips with resume mapping, fresh scope, corrupted fallback", () => {
    const summary = runDryRun(makeDeps([]));
    expect(summary.stateChecks).toHaveLength(11);
    for (const [index, stage] of STAGES.entries())
      expect(summary.stateChecks).toContain(`state round-trip ${stage} → resumes at index ${index}`);
    expect(summary.stateChecks).toContain(
      "fresh reset deletes the state file only — sentinel intact, no cache touched"
    );
    expect(summary.stateChecks).toContain("corrupted state file falls back to a fresh start (never throws)");
  });

  it("writes the sample report to a temp dir, redacts a planted property, and deletes it", () => {
    const summary = runDryRun(makeDeps([]));
    const sample = summary.sampleReport;
    expect(sample).not.toBeNull();
    if (sample === null) throw new Error("green walk must produce a sample report");
    expect(sample.rows).toBe(173);
    // The sample report's verdict mirrors the checklist document's sign-off
    // state exactly as the real run's report would: PASS iff every waiver
    // row carries a recorded signatory, FAIL while any stays unsigned.
    const signatories = parseWaiverSignatories(
      waiverRowIdsOf(LAUNCH_CHECKLIST),
      join(process.cwd(), PRODUCTION_READINESS_DOC)
    );
    const expected = [...signatories.values()].every(signatory => signatory !== "") ? "PASS" : "FAIL";
    expect(sample.verdict).toBe(expected);
    expect(sample.path.startsWith(join(tmpdir(), "launch-gate-dryrun-"))).toBe(true);
    expect(existsSync(sample.path)).toBe(false);
  });

  it("never touches the repo-root state file or any real report location", () => {
    const before = existsSync(STATE_FILE) ? readFileSync(STATE_FILE, "utf8") : null;
    runDryRun(makeDeps([]));
    const after = existsSync(STATE_FILE) ? readFileSync(STATE_FILE, "utf8") : null;
    expect(after).toBe(before);
  });

  it("reports zero pending closer targets — the tolerance set is retired, every cited target resolves on disk", () => {
    const summary = runDryRun(makeDeps([]));
    expect(summary.exitCode).toBe(0);
    expect(summary.findings).toEqual([]);
    expect(summary.pendingTargets).toEqual([]);
  });

  it("reports the drill artifacts (7.1/7.7) as pending, never as findings", () => {
    const summary = runDryRun(makeDeps([]));
    expect(summary.findings).toEqual([]);
    for (const entry of summary.pendingArtifacts) expect(["7.1", "7.7"]).toContain(entry.split(" → ")[0]);
  });
});

// ─── Sample-report signatory ingestion on a synthetic registry ────────────────

/** A temp evidence root holding a checklist document with the given content. */
function signatoryEvidenceRoot(readinessDoc: string): string {
  const root = mkdtempSync(join(tmpdir(), "launch-gate-dryrun-signatory-"));
  tempDirs.push(root);
  mkdirSync(join(root, "docs", "planning"), { recursive: true });
  writeFileSync(join(root, PRODUCTION_READINESS_DOC), readinessDoc);
  return root;
}

/** One synthetic waived row — the shape whose signatory the walk ingests. */
const waivedRow = (): LaunchRow => ({
  rowId: "3.3.3",
  section: 3,
  modality: "AUTOMATED-TEST",
  command: "bun tsgo",
  evidenceRef: "logs/<run-stamp>/x.log",
  waiver: { why: "waived with sign-off", owner: "Dev 3" },
});

describe("dry run — sample report ingests the checklist doc's waiver signatories", () => {
  it("reaches PASS when the row records its signatory — the mirror of the real run's ingestion", () => {
    const root = signatoryEvidenceRoot("| Row | Notes |\n| 3.3.3 | why. Signatory: Product Owner (2026-10-10) |\n");
    const summary = runDryRun(syntheticDeps([waivedRow()], { projectRoot: root }));
    expect(summary.exitCode).toBe(0);
    expect(summary.findings).toEqual([]);
    expect(summary.sampleReport?.verdict).toBe("PASS");
  });

  // Each fail-closed shape below stays launch-blocking: the sample verdict is
  // FAIL and the walk reports it as the doc's honest state — never a finding,
  // never a self-signed signatory.
  test.each([
    ["no Signatory token", "| Row | Notes |\n| 3.3.3 | why. |\n"],
    ["malformed Signatory cell", "| Row | Notes |\n| 3.3.3 | why. Signatory: |\n"],
    [
      "decoy row outside the waiver set",
      "| Row | Notes |\n| 3.3.30 | sibling row. Signatory: Impostor (2026-10-10) |\n",
    ],
  ])("stays FAIL, unsigned never self-signed (%s)", (_label, readinessDoc) => {
    const root = signatoryEvidenceRoot(readinessDoc);
    const summary = runDryRun(syntheticDeps([waivedRow()], { projectRoot: root }));
    expect(summary.exitCode).toBe(0);
    expect(summary.findings).toEqual([]);
    expect(summary.sampleReport?.verdict).toBe("FAIL");
  });
});

// ─── Boundary behavior on synthetic registries ───────────────────────────────

describe("dry run — command-target audit boundaries", () => {
  it("flags a cited target missing from disk — no tolerated set remains", () => {
    const rows = [
      makeRow(
        "X.1",
        "AUTOMATED-TEST",
        "bun run test/scripts/run-test.ts scripts/nope/missing.test.ts",
        "logs/<run-stamp>/x.log"
      ),
    ];
    const summary = runDryRun(syntheticDeps(rows));
    expect(summary.exitCode).toBe(1);
    expect(summary.findings.join("\n")).toContain("cited target missing: scripts/nope/missing.test.ts");
  });

  it("flags a package script that does not exist", () => {
    const rows = [makeRow("X.2", "AUTOMATED-TEST", "bun run no-such-script", "logs/<run-stamp>/x.log")];
    const summary = runDryRun(syntheticDeps(rows));
    expect(summary.exitCode).toBe(1);
    expect(summary.findings.join("\n")).toContain('package script "no-such-script" not found');
  });

  it("does not flag a URL-valued flag as a cited repo path", () => {
    const rows = [
      makeRow(
        "X.3",
        "SCRIPT-PROBE",
        "bun run scripts/load/ws-soak.ts --url ws://127.0.0.1:3101",
        "logs/<run-stamp>/x.log"
      ),
    ];
    const summary = runDryRun(syntheticDeps(rows));
    expect(summary.exitCode).toBe(0);
    expect(summary.findings).toEqual([]);
  });

  it("flags an existence row whose artifact is missing outside the drill set", () => {
    const rows = [makeRow("9.99", "DOC-SIGNOFF", "human oracle", "docs/no-such-signoff.md")];
    const summary = runDryRun(syntheticDeps(rows));
    expect(summary.exitCode).toBe(1);
    expect(summary.findings.join("\n")).toContain("evidence artifact missing: docs/no-such-signoff.md");
  });

  it("tolerates a MANUAL-DRILL row's missing artifact by row id (the drills file it)", () => {
    const rows = [makeRow("7.1", "MANUAL-DRILL", "bun run ops:db-backup", "ai/plans/no-such-signoff.md")];
    const summary = runDryRun(syntheticDeps(rows));
    expect(summary.exitCode).toBe(0);
    expect(summary.findings).toEqual([]);
    expect(summary.pendingArtifacts).toHaveLength(1);
  });

  it("accepts a present JSON drill report whose verdict reads PASS", () => {
    const root = jsonEvidenceRoot('{"verdict": "PASS", "oracles": []}');
    const rows = [makeRow("7.7", "MANUAL-DRILL", "bun run ops:db-restore-verify", "evidence/restore-report.json")];
    const summary = runDryRun(syntheticDeps(rows, { projectRoot: root }));
    expect(summary.exitCode).toBe(0);
    expect(summary.findings).toEqual([]);
    expect(summary.pendingArtifacts).toEqual([]);
  });

  const badReportCases: ReadonlyArray<readonly [string, string, string]> = [
    [
      'verdict "FAIL"',
      '{"verdict": "FAIL", "offendingCount": 6}',
      'evidence artifact verdict is "FAIL", expected "PASS"',
    ],
    ["unparseable body", '{"verdict": "PA', "evidence artifact is not valid JSON"],
    ["missing verdict field", '{"oracles": []}', "evidence artifact has no verdict field"],
  ];

  for (const [label, reportBody, expectedReason] of badReportCases) {
    it(`flags a present JSON drill report whose content check fails (${label}) — never a silent pass`, () => {
      const root = jsonEvidenceRoot(reportBody);
      const rows = [makeRow("7.7", "MANUAL-DRILL", "bun run ops:db-restore-verify", "evidence/restore-report.json")];
      const summary = runDryRun(syntheticDeps(rows, { projectRoot: root }));
      expect(summary.exitCode).toBe(1);
      expect(summary.findings).toHaveLength(1);
      expect(summary.findings[0]).toContain(`row 7.7 (MANUAL-DRILL): ${expectedReason}`);
    });
  }

  it("turns a broken state round-trip into a finding", () => {
    const rows = [makeRow("X.3", "AUTOMATED-TEST", "bun tsgo", "logs/<run-stamp>/x.log")];
    const summary = runDryRun(
      syntheticDeps(rows, {
        readState: (now: Date) => ({
          stage: "s9-gate",
          owner: "launch-gate",
          lifecycle: "DONE",
          lastRun: now.toISOString(),
        }),
      })
    );
    expect(summary.exitCode).toBe(1);
    expect(summary.findings.join("\n")).toContain("state round-trip failed at s1-data-integrity");
  });

  it("flags a stage-count mismatch against the expected inventory", () => {
    const rows = [makeRow("X.4", "AUTOMATED-TEST", "bun tsgo", "logs/<run-stamp>/x.log")];
    const summary = runDryRun(
      syntheticDeps(rows, { expectedStageCounts: { ...EXPECTED_COUNTS, "s1-data-integrity": 5 }, expectedTotalRows: 5 })
    );
    expect(summary.exitCode).toBe(1);
    expect(summary.findings.join("\n")).toContain("stage s1-data-integrity: 1 rows, expected 5");
  });
});

describe("dry run — command parsing", () => {
  it("extracts the script slot and path tokens of a runner command", () => {
    expect(citedTargetsOf("bun run test:graphql path/to/suite.test.ts")).toEqual({
      script: "test:graphql",
      paths: ["path/to/suite.test.ts"],
    });
    expect(citedTargetsOf("bun tsgo")).toEqual({ script: "tsgo", paths: [] });
  });

  it("never treats operator placeholders or flags as cited paths", () => {
    expect(citedTargetsOf("bun run scripts/load/load-test.ts --url <server-url>")).toEqual({
      script: "scripts/load/load-test.ts",
      paths: ["scripts/load/load-test.ts"],
    });
  });
});
