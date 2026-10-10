/**
 * Paired self-validation test for the launch gate — state-machine round-trips,
 * resume short-circuit (passed stages not re-run), `--fresh` scope, dry-run
 * read-only walk, failing-row halt, command dedupe, never-executed
 * existence rows (with the JSON-evidence verdict content check), the
 * process-lock timeout exemption, and waiver-signatory ingestion (the
 * checklist document's human record is read back read-only — signed rows
 * are ingested verbatim and can reach PASS; unsigned, missing, or malformed
 * Signatory cells stay `""` and keep the verdict FAIL; the gate never
 * fabricates a signatory).
 *
 * Subprocess execution is fully stubbed: the spawner seam (`runCommand`)
 * records calls and returns synthetic exit statuses — no real suite ever
 * runs here. The gate's state file lives at the repo root (its canonical
 * location, same as the quality gate's), so these tests back up and restore
 * any pre-existing `.launch-gate-state.json` around every run. Drill-evidence
 * boundary tests run against a temp evidence root injected via the
 * `projectRoot` seam — the repo's filed artifacts are never touched.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LAUNCH_CHECKLIST, rowsForStage, STAGES } from "@/scripts/launch/launch-checklist";
import {
  clearGateState,
  type LaunchGateOptions,
  type LaunchGateRunOptions,
  parseGateArgs,
  readGateState,
  resolveEvidenceRef,
  runLaunchGate,
  saveGateState,
} from "@/scripts/launch/launch-gate";
import { evidenceArtifactVerdict } from "@/scripts/launch/launch-gate-dryrun";
import { PRODUCTION_READINESS_DOC, parseWaiverSignatories } from "@/scripts/launch/launch-waiver-signatories";
import type { LaunchRow, LaunchStage } from "@/scripts/launch/shared/launch-types";
import { getActiveLock, isTimeoutExempt, LOCK_BASE_DIR } from "@/scripts/lib/process-lock-helpers";

const STATE_FILE = join(process.cwd(), ".launch-gate-state.json");

/** The gate CLI's own invocation — never spawned by the gate (self-referential criterion rows). */
const GATE_COMMAND = "bun run scripts/launch/launch-gate.ts";

/** Structural guard for reading back JSON artifacts without unsafe casts. */
function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null;
}

// ─── State-file stewardship ───────────────────────────────────────────────────

let originalState: string | null = null;

beforeAll(() => {
  originalState = existsSync(STATE_FILE) ? readFileSync(STATE_FILE, "utf8") : null;
});

afterAll(() => {
  if (originalState === null) {
    if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  } else {
    writeFileSync(STATE_FILE, originalState);
  }
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  rmSync(join(LOCK_BASE_DIR, LOCK_TEST_NS), { recursive: true, force: true });
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

/** Deterministic, strictly increasing clock — distinct report stamps across runs. */
let clockOffset = 0;
const fixedNow = (): Date => new Date(Date.UTC(2026, 9, 9, 6, 0, 0) + clockOffset++ * 60_000);

/** Records every command the gate tried to execute; all green unless overridden. */
function recordingExecutor(
  calls: string[],
  failures: ReadonlyMap<string, number> = new Map()
): (command: string) => Promise<{ exitStatus: number; output: string }> {
  return async command => {
    calls.push(command);
    const exitStatus = failures.get(command) ?? 0;
    return { exitStatus, output: `stub output for ${command} (exit ${exitStatus})` };
  };
}

/** Common run options: recording executor + fixed clock + temp report dir. */
function runOptions(
  calls: string[],
  failures?: ReadonlyMap<string, number>,
  projectRoot?: string
): LaunchGateRunOptions {
  const dir = mkdtempSync(join(tmpdir(), "launch-gate-test-"));
  tempDirs.push(dir);
  return {
    runCommand: recordingExecutor(calls, failures),
    now: fixedNow,
    outputDir: dir,
    ...(projectRoot !== undefined ? { projectRoot } : {}),
  };
}

const plainOptions = (fresh = false, dryRun = false): LaunchGateOptions => ({ fresh, dryRun });

/** The drill-filing outcome directory the s7 existence rows' evidence refs point into. */
const DRILL_OUTCOME_DIR = join("ai", "plans", "milestone_4", "production_launch_checklist_execution", "outcome");
/** The stamped restore-report evidence ref of the restore-verify drill row (wildcard ref). */
const RESTORE_REPORT_REF = "restore-report-<drill-stamp>.json";

/** The restore-report fixture the verdict check parses — mirrors the drill tool's report shape. */
const restoreReport = (verdict: string): string =>
  JSON.stringify({ tool: "db-restore-verify", artifactSha256: "8848…", durationMs: 255, verdict });

/**
 * A temp evidence root the existence rows resolve against — never the repo's
 * filed artifacts. The drill outcome dir, the docs the DOC-SIGNOFF rows cite,
 * a stamped restore report, and/or the checklist doc's waiver-signatory
 * content are planted per the leg under test.
 */ function drillEvidenceRoot(
  options: {
    readonly timerSignoff?: boolean;
    readonly restoreReport?: string | null;
    readonly readinessDoc?: string;
  } = {}
): string {
  const root = mkdtempSync(join(tmpdir(), "launch-gate-evidence-"));
  tempDirs.push(root);
  const outcomeDir = join(root, DRILL_OUTCOME_DIR);
  mkdirSync(outcomeDir, { recursive: true });
  if (options.timerSignoff !== false)
    writeFileSync(join(outcomeDir, "backup-timer-signoff.md"), "operator timer sign-off\n");
  const report = options.restoreReport;
  if (report !== undefined && report !== null)
    writeFileSync(join(outcomeDir, "restore-report-20261009T130736Z.json"), report);
  mkdirSync(join(root, "docs", "ops"), { recursive: true });
  writeFileSync(
    join(root, "docs", "ops", "disaster-recovery.md"),
    "# DR runbook\nRTO 4 hours — Ratified\nRPO 1 hour — Ratified\n"
  );
  mkdirSync(join(root, "docs", "planning"), { recursive: true });
  writeFileSync(
    join(root, "docs", "planning", "PRODUCTION_READINESS.md"),
    options.readinessDoc ?? "# Production readiness\n"
  );
  return root;
}

/** The verdict check's failure variant — the union narrows to its `reason` on `ok: false`. */
function failureReason(artifactPath: string): string {
  const verdict = evidenceArtifactVerdict(artifactPath);
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) return verdict.reason;
  throw new Error("unreachable");
}

/** Commands of `stage` and every later stage (the resume short-circuit oracle). */
function commandsOfStagesFrom(stage: LaunchStage): Set<string> {
  const later = STAGES.slice(STAGES.indexOf(stage));
  return new Set(later.flatMap(laterStage => rowsForStage(laterStage).map(row => row.command)));
}

/** The first row of `stage` whose command the gate would actually execute. */
function firstExecutedRowOfStage(stage: LaunchStage): LaunchRow {
  const executed = rowsForStage(stage).filter(
    row =>
      (row.modality === "AUTOMATED-TEST" || row.modality === "SCRIPT-PROBE") &&
      !row.command.includes("<") &&
      row.command !== GATE_COMMAND
  );
  expect(executed.length).toBeGreaterThan(0);
  return executed[0];
}

// ─── Tier 1 — dispatch surface & state machine ───────────────────────────────

describe("launch gate — argv parsing", () => {
  it("parses no flags as a plain resumable run", () => {
    expect(parseGateArgs([])).toEqual({ fresh: false, dryRun: false });
  });

  it("parses --fresh and --dry-run independently and together", () => {
    expect(parseGateArgs(["--fresh"])).toEqual({ fresh: true, dryRun: false });
    expect(parseGateArgs(["--dry-run"])).toEqual({ fresh: false, dryRun: true });
    expect(parseGateArgs(["--fresh", "--dry-run"])).toEqual({ fresh: true, dryRun: true });
  });

  it("ignores unrelated argv entries", () => {
    expect(parseGateArgs(["--fresh", "--timeout=60000", "extra"])).toEqual({ fresh: true, dryRun: false });
  });
});

describe("launch gate — evidence-ref resolution", () => {
  it("substitutes the run stamp and the report stamp", () => {
    const resolved = resolveEvidenceRef(
      "logs/<run-stamp>/suite.log -> docs/planning/launch-report-<stamp>.json",
      "2026-10-09T06-00-00",
      "20261009T060000Z"
    );
    expect(resolved).toBe("logs/2026-10-09T06-00-00/suite.log -> docs/planning/launch-report-20261009T060000Z.json");
  });

  it("leaves refs without placeholders untouched", () => {
    expect(resolveEvidenceRef("docs/planning/PRODUCTION_READINESS.md", "a", "b")).toBe(
      "docs/planning/PRODUCTION_READINESS.md"
    );
  });

  it("is token replacement only — it cannot introduce or normalize path traversal", () => {
    const resolved = resolveEvidenceRef("../../<run-stamp>/../../etc/secret", "2026-10-09T06-00-00", "s");
    expect(resolved).toBe("../../2026-10-09T06-00-00/../../etc/secret");
    expect(resolved).not.toContain("<");
    expect(resolved).not.toContain(">");
  });
});

describe("launch gate — state file round-trip", () => {
  beforeEach(() => {
    clearGateState();
  });

  it("round-trips every stage literal with its lifecycle", () => {
    for (const [index, stage] of STAGES.entries()) {
      const lifecycle = index === STAGES.length - 1 ? "DONE" : "IN_PROGRESS";
      saveGateState(stage, lifecycle, new Date("2026-10-09T06:00:00.000Z"));
      expect(readGateState(new Date())).toEqual({
        stage,
        owner: "launch-gate",
        lifecycle,
        lastRun: "2026-10-09T06:00:00.000Z",
      });
    }
  });

  it("defaults to a FRESH state at stage 1 when no state file exists", () => {
    clearGateState();
    const state = readGateState(new Date("2026-10-09T06:00:00.000Z"));
    expect(state.stage).toBe("s1-data-integrity");
    expect(state.lifecycle).toBe("FRESH");
  });

  it("clearGateState removes exactly the state file and is a no-op when absent", () => {
    saveGateState("s5-invariants", "IN_PROGRESS", new Date());
    expect(existsSync(STATE_FILE)).toBe(true);
    clearGateState();
    expect(existsSync(STATE_FILE)).toBe(false);
    clearGateState();
    expect(existsSync(STATE_FILE)).toBe(false);
  });
});

describe("launch gate — executed-row dispatch (stubbed subprocess)", () => {
  beforeEach(() => {
    clearGateState();
    saveGateState("s9-gate", "IN_PROGRESS", new Date());
  });

  it("dispositions every executed row PASS and dedupes repeated commands", async () => {
    const calls: string[] = [];
    const result = await runLaunchGate(plainOptions(), runOptions(calls));
    const executedCommands = [
      ...new Set(
        rowsForStage("s9-gate")
          .filter(
            row =>
              (row.modality === "AUTOMATED-TEST" || row.modality === "SCRIPT-PROBE") && row.command !== GATE_COMMAND
          )
          .map(row => row.command)
      ),
    ];
    expect(calls).toEqual(executedCommands);
    expect(result.rows.every(row => row.result === "PASS")).toBe(true);
    expect(result.rows.every(row => row.exitStatus === 0)).toBe(true);
  });

  it("never executes DOC-SIGNOFF rows — they are existence-marked only", async () => {
    const calls: string[] = [];
    const result = await runLaunchGate(plainOptions(), runOptions(calls));
    const signoffs = result.rows.filter(row => row.modality === "DOC-SIGNOFF");
    expect(signoffs.length).toBeGreaterThan(0);
    expect(signoffs.every(row => row.result === "PASS" && row.exitStatus === 0)).toBe(true);
    expect(calls.every(command => command.startsWith("bun"))).toBe(true);
  });

  it("never spawns the gate itself — self-referential criterion rows are lineage-certified", async () => {
    const calls: string[] = [];
    const result = await runLaunchGate(plainOptions(), runOptions(calls));
    expect(calls).not.toContain(GATE_COMMAND);
    const selfRows = result.rows.filter(row => row.command === GATE_COMMAND);
    expect(selfRows.map(row => row.rowId)).toEqual([
      "9.6",
      "9.7",
      "9.8",
      "9.9",
      "9.10",
      "9.11",
      "9.12",
      "9.13",
      "9.16",
    ]);
    expect(selfRows.every(row => row.result === "PASS" && row.exitStatus === 0)).toBe(true);
  });

  it("emits repo-relative evidence refs only (no absolute paths, no traversal)", async () => {
    const calls: string[] = [];
    const result = await runLaunchGate(plainOptions(), runOptions(calls));
    for (const row of result.rows) {
      expect(row.evidenceRef.startsWith("logs/") || row.evidenceRef.startsWith("docs/")).toBe(true);
      expect(row.evidenceRef.includes("..")).toBe(false);
      expect(row.evidenceRef.startsWith("/")).toBe(false);
    }
  });

  it("writes the stamped report to the injected output dir — waivers stay unsigned until sign-off, verdict FAIL", async () => {
    const calls: string[] = [];
    const result = await runLaunchGate(
      plainOptions(),
      runOptions(calls, undefined, drillEvidenceRoot({ restoreReport: restoreReport("PASS") }))
    );
    const reportPath = result.reportPath;
    expect(reportPath).toBeDefined();
    if (reportPath === undefined) throw new Error("completion must write a report");
    expect(existsSync(reportPath)).toBe(true);
    const report: unknown = JSON.parse(readFileSync(reportPath, "utf8"));
    // The checklist doc records no signatories — the gate emits every waiver
    // UNSIGNED and never signs one itself, so the verdict is FAIL (the
    // sign-off contract: an empty Signatory cell is launch-blocking).
    expect(isRecord(report)).toBe(true);
    if (!isRecord(report)) throw new Error("report must be a JSON object");
    expect(Array.isArray(report.waivers)).toBe(true);
    expect(report.waivers).toHaveLength(8);
    if (!Array.isArray(report.waivers)) throw new Error("report must carry a waivers array");
    for (const waiver of report.waivers) {
      expect(isRecord(waiver) ? waiver.signatory : undefined).toBe("");
    }
    expect(result.verdict).toBe("FAIL");
    expect(report.verdict).toBe("FAIL");
  });

  it("marks WAIVED rows via the registry's waiver metadata on a green execution", async () => {
    clearGateState();
    saveGateState("s3-realtime", "IN_PROGRESS", new Date());
    const calls: string[] = [];
    const result = await runLaunchGate(plainOptions(), runOptions(calls));
    const waived = result.rows.filter(row => row.result === "WAIVED");
    expect(waived.map(row => row.rowId)).toEqual([
      "3.3.3",
      "4.2.1",
      "4.2.5",
      "4.3.4",
      "5.1.1",
      "5.1.2",
      "5.5.6",
      "8.26",
    ]);
    expect(calls).toContain(
      "bun run test/scripts/run-test.ts test/workflows/sessions/in-session-lock-release.journey.test.ts"
    );
  });
});

// ─── Waiver-signatory ingestion — the doc's human record, read-only ──────────

describe("launch gate — waiver-signatory ingestion (read-only, never fabricated)", () => {
  beforeEach(() => {
    clearGateState();
  });

  const WAIVER_ROW_IDS = LAUNCH_CHECKLIST.flatMap(row => (row.waiver ? [row.rowId] : []));
  const SIGNED_CELL = "Signatory: Product Owner (2026-10-10)";

  /** A checklist-doc fixture whose waiver rows end with the given Signatory cell text. */
  const readinessDocWithWaivers = (signatoryCellOf: (rowId: string) => string): string =>
    [
      "# Production readiness",
      "| Row | Criterion | Response | Notes |",
      "|---|---|---|---|",
      ...WAIVER_ROW_IDS.map(
        rowId => `| ${rowId} | criterion ${rowId} | ☐ WHY: waived | ledger note. ${signatoryCellOf(rowId)} |`
      ),
    ].join("\n");

  /** The signatories of the report's waiver records, in order. */
  const reportSignatories = (reportPath: string): string[] => {
    const report: unknown = JSON.parse(readFileSync(reportPath, "utf8"));
    if (!isRecord(report) || !Array.isArray(report.waivers)) throw new Error("report must carry a waivers array");
    return report.waivers.map((waiver: unknown) => (isRecord(waiver) ? String(waiver.signatory) : "?"));
  };

  /** A full fresh run over a temp evidence root whose checklist doc is the fixture. */
  const completeRunWithDoc = async (
    readinessDoc: string
  ): Promise<{ root: string; result: Awaited<ReturnType<typeof runLaunchGate>> }> => {
    const calls: string[] = [];
    const root = drillEvidenceRoot({ restoreReport: restoreReport("PASS"), readinessDoc });
    const result = await runLaunchGate(plainOptions(), runOptions(calls, undefined, root));
    return { root, result };
  };

  it("Tier 2 — ingests the human-recorded signatories verbatim and reaches VERDICT: PASS", async () => {
    const doc = readinessDocWithWaivers(() => SIGNED_CELL);
    const { root, result } = await completeRunWithDoc(doc);
    expect(result.halted).toBeUndefined();
    const reportPath = result.reportPath;
    expect(reportPath).toBeDefined();
    if (reportPath === undefined) throw new Error("completion must write a report");
    const signatories = reportSignatories(reportPath);
    expect(signatories).toEqual(WAIVER_ROW_IDS.map(() => "Product Owner (2026-10-10)"));
    // The mirror oracle: what the report carries is exactly what the parser
    // reads from the same document — the gate adds nothing of its own.
    const parsed = parseWaiverSignatories(WAIVER_ROW_IDS, join(root, PRODUCTION_READINESS_DOC));
    expect(signatories).toEqual(WAIVER_ROW_IDS.map(rowId => parsed.get(rowId) ?? ""));
    expect(result.verdict).toBe("PASS");
    const report: unknown = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(isRecord(report) && report.verdict).toBe("PASS");
  });

  it("Tier 3 — treats a malformed Signatory cell as unsigned: verdict FAIL even when every other waiver is signed", async () => {
    const doc = readinessDocWithWaivers(rowId => (rowId === "3.3.3" ? "Signatory:" : SIGNED_CELL));
    const { result } = await completeRunWithDoc(doc);
    const reportPath = result.reportPath;
    expect(reportPath).toBeDefined();
    if (reportPath === undefined) throw new Error("completion must write a report");
    const signatories = reportSignatories(reportPath);
    expect(signatories.filter(signatory => signatory === "")).toEqual([""]);
    expect(result.verdict).toBe("FAIL");
  });

  it("Tier 4 — never ingests a signatory recorded on a row outside the waiver set, or on a non-table line", async () => {
    const doc = [
      "# Production readiness",
      "| Row | Criterion | Response | Notes |",
      "|---|---|---|---|",
      "| 3.3.30 | sibling row sharing the 3.3.3 prefix. Signatory: Impostor (2026-10-10) | x | y |",
      "| 5.1.12 | sibling row. Signatory: Impostor (2026-10-10) | x | y |",
      "Free text: Signatory: Impostor (2026-10-10) — not a table row",
    ].join("\n");
    const { result } = await completeRunWithDoc(doc);
    const reportPath = result.reportPath;
    expect(reportPath).toBeDefined();
    if (reportPath === undefined) throw new Error("completion must write a report");
    expect(reportSignatories(reportPath).every(signatory => signatory === "")).toBe(true);
    expect(result.verdict).toBe("FAIL");
  });
});

// ─── Tier 2 — state-machine boundaries & resume ──────────────────────────────

describe("launch gate — failing-row halt with rowId + exit code", () => {
  beforeEach(() => {
    clearGateState();
  });

  it("halts on a failing executed row, persisting IN_PROGRESS at that stage", async () => {
    const failing = new Map([[firstExecutedRowOfStage("s1-data-integrity").command, 42]]);
    const calls: string[] = [];
    const result = await runLaunchGate(plainOptions(), runOptions(calls, failing));
    expect(result.halted).toEqual({ rowId: "1.1.1", exitStatus: 42 });
    expect(result.verdict).toBe("FAIL");
    expect(result.reportPath).toBeUndefined();
    const persisted = readGateState(new Date());
    expect(persisted.stage).toBe("s1-data-integrity");
    expect(persisted.lifecycle).toBe("IN_PROGRESS");
    expect(persisted.owner).toBe("launch-gate");
  });

  it("halts on a MANUAL-DRILL row whose filed artifact is missing — never auto-passed, never executed", async () => {
    saveGateState("s7-dr", "IN_PROGRESS", new Date());
    const calls: string[] = [];
    const result = await runLaunchGate(
      plainOptions(),
      runOptions(calls, undefined, drillEvidenceRoot({ timerSignoff: false }))
    );
    expect(result.halted).toEqual({ rowId: "7.1", exitStatus: 1 });
    expect(calls).toEqual([]);
  });

  it("halts on a MANUAL-DRILL row whose restore report is absent even with the timer sign-off filed", async () => {
    saveGateState("s7-dr", "IN_PROGRESS", new Date());
    const calls: string[] = [];
    const result = await runLaunchGate(plainOptions(), runOptions(calls, undefined, drillEvidenceRoot()));
    expect(result.halted).toEqual({ rowId: "7.7", exitStatus: 1 });
  });

  it("spawns the armed s6 load command — no executed row carries an operator placeholder today", async () => {
    saveGateState("s6-performance", "IN_PROGRESS", new Date());
    const calls: string[] = [];
    const result = await runLaunchGate(plainOptions(), runOptions(calls));
    // The load drill armed 6.1's URL, so the placeholder guard stays dormant
    // for every executed row; the only registry command still carrying a
    // placeholder is the 7.7 drill oracle, which is existence-marked and
    // never spawned.
    expect(result.halted).toBeUndefined();
    expect(calls).toContain("bun run scripts/load/load-test.ts --url http://127.0.0.1:3100");
    expect(calls.every(command => !command.includes("<") && !command.includes(">"))).toBe(true);
  });
});

// ─── Tier 2/3 — JSON drill-evidence verdict content check ────────────────────

describe("launch gate — JSON drill-evidence verdict content check", () => {
  beforeEach(() => {
    clearGateState();
    saveGateState("s7-dr", "IN_PROGRESS", new Date());
  });

  it("marks both drill rows PASS when the filed restore report's verdict reads PASS", async () => {
    const calls: string[] = [];
    const result = await runLaunchGate(
      plainOptions(),
      runOptions(calls, undefined, drillEvidenceRoot({ restoreReport: restoreReport("PASS") }))
    );
    expect(result.halted).toBeUndefined();
    expect(
      result.rows.filter(row => row.rowId === "7.1" || row.rowId === "7.7").map(row => [row.rowId, row.result])
    ).toEqual([
      ["7.1", "PASS"],
      ["7.7", "PASS"],
    ]);
  });

  it("halts on the drill row whose filed restore report's verdict is FAIL", async () => {
    const calls: string[] = [];
    const result = await runLaunchGate(
      plainOptions(),
      runOptions(calls, undefined, drillEvidenceRoot({ restoreReport: restoreReport("FAIL") }))
    );
    expect(result.halted).toEqual({ rowId: "7.7", exitStatus: 1 });
    expect(result.rows.at(-1)?.rowId).toBe("7.7");
    expect(result.rows.at(-1)?.result).toBe("FAIL");
  });

  it("halts on an unparseable restore report", async () => {
    const calls: string[] = [];
    const result = await runLaunchGate(
      plainOptions(),
      runOptions(calls, undefined, drillEvidenceRoot({ restoreReport: '{"verdict": "PA' }))
    );
    expect(result.halted).toEqual({ rowId: "7.7", exitStatus: 1 });
  });

  it("halts on a restore report missing the verdict field", async () => {
    const calls: string[] = [];
    const result = await runLaunchGate(
      plainOptions(),
      runOptions(calls, undefined, drillEvidenceRoot({ restoreReport: JSON.stringify({ oracles: [] }) }))
    );
    expect(result.halted).toEqual({ rowId: "7.7", exitStatus: 1 });
  });

  it("verdict-check unit: names each failure mode and accepts the newest matching report only", () => {
    const root = drillEvidenceRoot();
    const outcomeDir = join(root, DRILL_OUTCOME_DIR);

    expect(evidenceArtifactVerdict(join(outcomeDir, "backup-timer-signoff.md"))).toEqual({ ok: true });

    const absent = join(outcomeDir, RESTORE_REPORT_REF);
    expect(failureReason(absent)).toContain("evidence artifact missing");

    writeFileSync(join(outcomeDir, "restore-report-20261009T125929Z.json"), restoreReport("FAIL"));
    expect(failureReason(absent)).toContain('verdict is "FAIL", expected "PASS"');
    expect(failureReason(absent)).toContain("restore-report-20261009T125929Z.json");

    writeFileSync(join(outcomeDir, "restore-report-20261009T130736Z.json"), restoreReport("PASS"));
    expect(evidenceArtifactVerdict(absent)).toEqual({ ok: true });

    writeFileSync(join(outcomeDir, "restore-report-20261009T130736Z.json"), '{"verdict": "P');
    expect(failureReason(absent)).toContain("not valid JSON");

    writeFileSync(join(outcomeDir, "restore-report-20261009T130736Z.json"), JSON.stringify({ oracles: [] }));
    expect(failureReason(absent)).toContain("no verdict field");
  });

  it("verdict-check unit: the repo's filed drill report satisfies the check", () => {
    const verdict = evidenceArtifactVerdict(join(process.cwd(), DRILL_OUTCOME_DIR, RESTORE_REPORT_REF));
    expect(verdict).toEqual({ ok: true });
  });
});

describe("launch gate — resume from each of the nine stages", () => {
  // Stage-index resume: the first executed command belongs to the persisted
  // stage, and no command owned ONLY by an earlier stage ever runs. Every
  // stage completes today: s6's load URL is armed (no operator placeholder
  // remains on an executed row) and s7 verifies from the filed drill
  // evidence (existence + verdict-PASS content check), so each resume runs
  // through DONE.
  for (const stage of STAGES) {
    it(`resumes at ${stage} without re-running earlier stages, through DONE`, async () => {
      clearGateState();
      saveGateState(stage, "IN_PROGRESS", new Date());
      const calls: string[] = [];
      const result = await runLaunchGate(plainOptions(), runOptions(calls));

      const allowed = commandsOfStagesFrom(stage);
      for (const command of calls) {
        expect(allowed.has(command)).toBe(true);
      }
      if (calls.length > 0) {
        expect(calls[0]).toBe(firstExecutedRowOfStage(stage).command);
      }

      expect(result.reportPath).toBeDefined();
      expect(readGateState(new Date()).lifecycle).toBe("DONE");
    });
  }

  it("trusts the stage index over a stale DONE label on a non-final stage", async () => {
    saveGateState("s2-financial", "DONE", new Date());
    const calls: string[] = [];
    await runLaunchGate(plainOptions(), runOptions(calls));
    expect(calls[0]).toBe(firstExecutedRowOfStage("s2-financial").command);
    expect(readGateState(new Date()).stage).not.toBe("s1-data-integrity");
  });
});

describe("launch gate — fresh and dry-run scope", () => {
  beforeEach(() => {
    clearGateState();
  });

  it("--fresh resets the resume point to stage 1", async () => {
    saveGateState("s5-invariants", "IN_PROGRESS", new Date());
    const failing = new Map([[firstExecutedRowOfStage("s1-data-integrity").command, 7]]);
    const calls: string[] = [];
    await runLaunchGate(plainOptions(true), runOptions(calls, failing));
    expect(readGateState(new Date()).stage).toBe("s1-data-integrity");
    expect(readGateState(new Date()).lifecycle).toBe("IN_PROGRESS");
  });

  it("--dry-run is fully read-only: zero spawns, zero state writes, no report", async () => {
    saveGateState("s5-invariants", "IN_PROGRESS", new Date());
    const before = readGateState(new Date());
    const calls: string[] = [];
    const result = await runLaunchGate({ fresh: true, dryRun: true }, runOptions(calls));
    expect(calls).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.reportPath).toBeUndefined();
    expect(readGateState(new Date())).toEqual(before);
  });

  it("--dry-run exits PASS against the real 173-row registry inventory", async () => {
    const calls: string[] = [];
    const result = await runLaunchGate(plainOptions(false, true), runOptions(calls));
    expect(result.verdict).toBe("PASS");
    expect(LAUNCH_CHECKLIST).toHaveLength(173);
  });
});

// ─── Tier 2/4 — malformed state & lock-file handling ─────────────────────────

describe("launch gate — empty and malformed state files", () => {
  beforeEach(() => {
    clearGateState();
  });

  const malformedCases: ReadonlyArray<readonly [string, string]> = [
    ["empty file", ""],
    ["truncated JSON", '{"stage": "s2-fin'],
    [
      "wrong owner",
      JSON.stringify({ stage: "s2-financial", owner: "quality-gate", lifecycle: "IN_PROGRESS", lastRun: "x" }),
    ],
    [
      "unknown stage",
      JSON.stringify({ stage: "s10-nope", owner: "launch-gate", lifecycle: "IN_PROGRESS", lastRun: "x" }),
    ],
    [
      "invalid lifecycle",
      JSON.stringify({ stage: "s2-financial", owner: "launch-gate", lifecycle: "WEIRD", lastRun: "x" }),
    ],
    [
      "non-string lastRun",
      JSON.stringify({ stage: "s2-financial", owner: "launch-gate", lifecycle: "DONE", lastRun: 123 }),
    ],
  ];

  for (const [label, content] of malformedCases) {
    it(`treats a ${label} as a fresh start and resumes from stage 1`, async () => {
      writeFileSync(STATE_FILE, content);
      const state = readGateState(new Date());
      expect(state.stage).toBe("s1-data-integrity");
      expect(state.lifecycle).toBe("FRESH");
      const calls: string[] = [];
      await runLaunchGate(plainOptions(), runOptions(calls));
      expect(calls[0]).toBe(firstExecutedRowOfStage("s1-data-integrity").command);
    });
  }
});

// ─── Tier 3 — chaos: randomized persistence attempts ─────────────────────────

describe("launch gate — randomized state persistence", () => {
  it("round-trips every seeded-shuffled stage attempt exactly", () => {
    // Deterministic LCG (seed 42) — a random-looking sequence of stage writes.
    let seed = 42;
    const next = (modulus: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % modulus;
    };
    const attempted = new Set<LaunchStage>();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const stage = STAGES[next(STAGES.length)];
      attempted.add(stage);
      saveGateState(stage, "IN_PROGRESS", new Date("2026-10-09T06:00:00.000Z"));
      expect(readGateState(new Date()).stage).toBe(stage);
    }
    expect(attempted.size).toBeGreaterThan(5);
  });

  it("never throws on interrupted-write corruption (every JSON prefix)", () => {
    const valid = JSON.stringify({
      stage: "s2-financial",
      owner: "launch-gate",
      lifecycle: "IN_PROGRESS",
      lastRun: "2026-10-09T06:00:00.000Z",
    });
    for (let cut = 0; cut <= valid.length; cut += 7) {
      writeFileSync(STATE_FILE, valid.slice(0, cut));
      expect(() => readGateState(new Date())).not.toThrow();
      expect(readGateState(new Date()).owner).toBe("launch-gate");
    }
  });
});

// ─── Tier 4 — security: fixed state path & lock-file integrity ────────────────

describe("launch gate — state-file path is fixed (no traversal surface)", () => {
  beforeEach(() => {
    clearGateState();
  });

  it("always writes the repo-root state file, never a path derived from inputs", () => {
    for (const stage of STAGES) {
      saveGateState(stage, "IN_PROGRESS", new Date());
      expect(existsSync(STATE_FILE)).toBe(true);
      expect(existsSync(join(process.cwd(), ".launch-gate-state.json"))).toBe(true);
      expect(readGateState(new Date()).owner).toBe("launch-gate");
    }
  });
});

const LOCK_TEST_NS = "launchgatetest";

/** Fabricates an active-lock file in a scratch namespace (never a real lane). */
function fabricateActiveLock(description: string, pid: number, ageMs: number): void {
  const dir = join(LOCK_BASE_DIR, LOCK_TEST_NS);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "active.json"),
    JSON.stringify({ pid, acquiredAt: Date.now() - ageMs, description, reentryCount: 1 })
  );
}

describe("process-lock timeout exemption", () => {
  it("exempts the launch-gate description", () => {
    expect(isTimeoutExempt("launch-gate")).toBe(true);
    expect(isTimeoutExempt("sub-loop: launch-gate")).toBe(true);
  });

  it("still rejects non-exempt names", () => {
    expect(isTimeoutExempt("some-random-build")).toBe(false);
    expect(isTimeoutExempt("build")).toBe(false);
    expect(isTimeoutExempt("a default task")).toBe(false);
  });

  it("keeps the pre-existing exempt set intact", () => {
    expect(isTimeoutExempt("quality-gate")).toBe(true);
    expect(isTimeoutExempt("duplicates")).toBe(true);
    expect(isTimeoutExempt("lint-service")).toBe(true);
    expect(isTimeoutExempt("test:db")).toBe(true);
  });

  it("does NOT let an old launch-gate lock be treated as stale", () => {
    fabricateActiveLock("launch-gate", process.pid, 10 * 60_000);
    const active = getActiveLock(LOCK_TEST_NS);
    expect(active?.description).toBe("launch-gate");
    expect(existsSync(join(LOCK_BASE_DIR, LOCK_TEST_NS, "active.json"))).toBe(true);
  });

  it("cleans a stale non-exempt lock past the 5-minute window", () => {
    fabricateActiveLock("build-stuff", process.pid, 10 * 60_000);
    expect(getActiveLock(LOCK_TEST_NS)).toBeNull();
    expect(existsSync(join(LOCK_BASE_DIR, LOCK_TEST_NS, "active.json"))).toBe(false);
  });

  it("cleans a tampered (malformed) active-lock file", () => {
    const dir = join(LOCK_BASE_DIR, LOCK_TEST_NS);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "active.json"), "not json at all");
    expect(getActiveLock(LOCK_TEST_NS)).toBeNull();
    expect(existsSync(join(dir, "active.json"))).toBe(false);
  });

  it("cleans a lock held by a dead PID", () => {
    fabricateActiveLock("launch-gate", 4_194_303, 1_000);
    expect(getActiveLock(LOCK_TEST_NS)).toBeNull();
    expect(existsSync(join(LOCK_BASE_DIR, LOCK_TEST_NS, "active.json"))).toBe(false);
  });
});
