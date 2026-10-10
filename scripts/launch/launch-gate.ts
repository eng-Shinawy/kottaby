/**
 * The launch gate — a resumable, process-locked CLI that executes the
 * production-readiness checklist in nine stages (modeled on
 * `scripts/quality-gate.ts`: state persistence, stage-index resumption,
 * `withProcessLock` serialization).
 *
 * Execution semantics:
 *   • Every stage's rows come from the row registry (`launch-checklist.ts`)
 *     and are proven through their canonical runner commands exactly as
 *     cited — no alternate invocations are invented here.
 *   • Repeated commands within a stage run once; sibling rows co-referencing
 *     the same command reuse the single execution's result.
 *   • MANUAL-DRILL and DOC-SIGNOFF rows are NEVER executed — they are
 *     dispositioned from the EXISTENCE of their filed evidence artifact
 *     (never auto-passed: a missing artifact is a launch-blocking FAIL). A
 *     JSON artifact is additionally content-checked: its `verdict` field
 *     must read "PASS", else the row FAILs with a named reason.
 *   • Waived rows run their command; a green result plus the registry's
 *     waiver metadata marks the row WAIVED. The signatory carried into the
 *     report is the one the humans recorded in the checklist document's own
 *     waiver row (`Signatory: …`, ingested read-only at report assembly);
 *     a waiver with no recorded signatory stays unsigned and blocks the
 *     verdict — the gate never fabricates one.
 *   • A failing row halts the stage with the failing rowId and the command's
 *     exit status; state persists after every stage so an interrupted run
 *     resumes at the last persisted stage.
 *
 * Evidence refs carry a `<run-stamp>` placeholder, substituted with this
 * run's `logs/` stamp directory at execution time (report refs keep their
 * own `<stamp>` placeholder — back-filled at run end).
 *
 * `--fresh` deletes the repo-root `.launch-gate-state.json` state file ONLY —
 * never any cache. `--dry-run` is fully read-only: zero spawns, zero state
 * writes, zero cache writes (see `launch-gate-dryrun.ts`).
 *
 * State machine: FRESH → IN_PROGRESS → DONE (all nine stages green). Resume
 * trusts the stage index over the lifecycle label.
 *
 * Logging: structured diagnostics via `@/backend/lib/logger`; printed
 * record/evidence lines use bare `console.log` (the ops stdout-line-as-record
 * pattern, lawful under `scripts/` per the ESLint no-console carve-out). The
 * gate is exempted from the process-lock 5-minute timeout — stage runs take
 * hours.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "@/backend/lib/logger";
import { LAUNCH_CHECKLIST, rowsForStage, STAGES } from "@/scripts/launch/launch-checklist";
import {
  artifactExists,
  type DryRunDeps,
  EXPECTED_TOTAL_ROWS,
  evidenceArtifactVerdict,
  runDryRun,
} from "@/scripts/launch/launch-gate-dryrun";
import { computeVerdict, writeLaunchReport } from "@/scripts/launch/launch-report";
import { waiverRecordsOf } from "@/scripts/launch/launch-waiver-signatories";
import type {
  LaunchGateState,
  LaunchReportRow,
  LaunchRow,
  LaunchStage,
  StageResult,
} from "@/scripts/launch/shared/launch-types";
import { withProcessLock } from "@/scripts/lib";
import { utcStamp } from "@/scripts/ops/backup-artifacts";

// ─── Constants ───────────────────────────────────────────────────────────────

const STATE_FILE = join(process.cwd(), ".launch-gate-state.json");
const PROJECT_ROOT = process.cwd();
const RUN_STAMP_PLACEHOLDER = "<run-stamp>";
const REPORT_STAMP_PLACEHOLDER = "<stamp>";
/** Exit status recorded for a row halted on a missing artifact or an unfilled operator placeholder. */
const FAIL_EXIT = 1;
/** Detects unfilled operator placeholder tokens (e.g. `--url <server-url>`); spawning one half-filled is a config error. */
const hasOperatorPlaceholder = (command: string): boolean => command.includes("<") || command.includes(">");

/** This gate CLI's own invocation — the self-referential Section 9 criterion rows cite it as their proof. */
const GATE_COMMAND = "bun run scripts/launch/launch-gate.ts";

const STAGE_ROW_COUNTS: Readonly<Record<LaunchStage, number>> = {
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

/** One executed command's outcome. */
type CommandExecution = { exitStatus: number; output: string };
/** Executed rows resolve through this command-executor seam. */
type StageCommandExecutor = (command: string) => Promise<CommandExecution>;

const pad2 = (value: number): string => String(value).padStart(2, "0");

// ─── CLI Options & Result ────────────────────────────────────────────────────

/** Parsed argv for one gate invocation. */
export interface LaunchGateOptions {
  /** Delete the state file only (never any cache) and start from stage 1. */
  readonly fresh: boolean;
  /** Walk the registry without spawning any command or writing state. */
  readonly dryRun: boolean;
}

/** Injectable seams — tests stub the spawner, clock, and output root; a dry run passes a temp dir. */
export interface LaunchGateRunOptions {
  readonly runCommand?: StageCommandExecutor;
  readonly now?: () => Date;
  readonly outputDir?: string;
  /** Root evidence refs resolve against; defaults to the repo root. */
  readonly projectRoot?: string;
}

/** The outcome of one gate execution — per-row results, per-stage results, verdict, halt info. */
export interface LaunchGateResult {
  readonly rows: readonly LaunchReportRow[];
  readonly stages: readonly StageResult[];
  readonly verdict: "PASS" | "FAIL";
  /** Written report path; absent when the run halted before report assembly. */
  readonly reportPath?: string;
  /** The failing row that halted the run (rowId + its command's exit status), if any. */
  readonly halted?: { readonly rowId: string; readonly exitStatus: number };
}

export function parseGateArgs(argv: readonly string[]): LaunchGateOptions {
  return { fresh: argv.includes("--fresh"), dryRun: argv.includes("--dry-run") };
}

// ─── State Persistence ───────────────────────────────────────────────────────

function isLaunchGateState(val: unknown): val is LaunchGateState {
  if (typeof val !== "object" || val === null) return false;
  const [stage, owner, lifecycle, lastRun] = ["stage", "owner", "lifecycle", "lastRun"].map(key =>
    Reflect.get(val, key)
  );
  return (
    typeof stage === "string" &&
    new Set<string>(STAGES).has(stage) &&
    owner === "launch-gate" &&
    (lifecycle === "FRESH" || lifecycle === "IN_PROGRESS" || lifecycle === "DONE") &&
    typeof lastRun === "string"
  );
}

/**
 * Reads the persisted gate state. A missing or malformed (corrupted
 * mid-write) state file is treated as a fresh start — never a hard failure.
 * The optional `stateFile` lets the dry-run self-verification round-trip a
 * temp state path instead of touching the repo-root state file.
 */
export function readGateState(now: Date, stateFile: string = STATE_FILE): LaunchGateState {
  if (existsSync(stateFile)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(stateFile, "utf8"));
      if (isLaunchGateState(parsed)) return parsed;
    } catch {
      // unreadable mid-write corruption — fall through to a fresh start
    }
    logger.warn("launch-gate state file is malformed or unreadable — starting fresh");
  }
  return { stage: STAGES[0], owner: "launch-gate", lifecycle: "FRESH", lastRun: now.toISOString() };
}

/**
 * Persists the gate state (single lock-holding writer). The optional
 * `stateFile` targets the dry-run self-verification's temp state path.
 */
export function saveGateState(
  stage: LaunchStage,
  lifecycle: LaunchGateState["lifecycle"],
  now: Date,
  stateFile: string = STATE_FILE
): void {
  const state: LaunchGateState = { stage, owner: "launch-gate", lifecycle, lastRun: now.toISOString() };
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

/** Deletes the state file ONLY — never any cache. */
export function clearGateState(stateFile: string = STATE_FILE): void {
  if (existsSync(stateFile)) unlinkSync(stateFile);
}

// ─── Evidence Refs & Command Plumbing ────────────────────────────────────────

/**
 * Substitutes run-scoped placeholders in an evidence ref with this run's
 * concrete values. Only the two pre-registered placeholder tokens are
 * replaced; row data never steers the path.
 */
export function resolveEvidenceRef(evidenceRef: string, runStamp: string, reportStamp: string): string {
  return evidenceRef.replaceAll(RUN_STAMP_PLACEHOLDER, runStamp).replaceAll(REPORT_STAMP_PLACEHOLDER, reportStamp);
}

/** The gate-run `logs/` stamp directory (the runner's timestamp-directory format, local time). */
function formatRunStampDir(date: Date): string {
  const stamp = [date.getFullYear(), date.getMonth() + 1, date.getDate()].map(pad2).join("-");
  const clock = [date.getHours(), date.getMinutes(), date.getSeconds()].map(pad2).join("-");
  return `${stamp}T${clock}`;
}

/**
 * Spawns a stage command, streaming output live and capturing it for the run
 * log. Commands are registry-cited static strings — never assembled from
 * untrusted input — and the spawn is `shell: false`, so each token is a
 * literal process argument (no injection surface). A spawn error or signal
 * exit normalizes to a non-zero status.
 */
function spawnStageCommand(command: string): Promise<{ exitStatus: number; output: string }> {
  const [binary, ...args] = command.trim().split(/\s+/);
  return new Promise(resolve => {
    const child = spawn(binary, args, { cwd: PROJECT_ROOT, shell: false, stdio: ["inherit", "pipe", "pipe"] });
    let output = "";
    child.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
      process.stdout.write(data);
    });
    child.stderr?.on("data", (data: Buffer) => {
      output += data.toString();
      process.stderr.write(data);
    });
    child.on("error", err =>
      resolve({ exitStatus: 1, output: `${output}\n[launch-gate] spawn error: ${err.message}` })
    );
    child.on("close", code => resolve({ exitStatus: code ?? 1, output }));
  });
}

/**
 * A row halted on a missing artifact or an unfilled operator placeholder —
 * logged, printed, and returned as a launch-blocking FAIL disposition.
 */
function failDisposition(buildRow: ReportRowBuilder, row: LaunchRow, detail: string): RowDisposition {
  logger.warn(`row ${row.rowId} (${row.modality}): ${detail}`);
  console.log(`  ✗ ${row.rowId} — ${detail}`);
  return { reportRow: buildRow(FAIL_EXIT, "FAIL"), halt: { exitStatus: FAIL_EXIT } };
}

// ─── Row Disposition ─────────────────────────────────────────────────────────

/** Printed disposition mark per row result (ops stdout-line-as-record). */
const RESULT_MARKS: Readonly<Record<LaunchReportRow["result"], string>> = { PASS: "✓", WAIVED: "○", FAIL: "✗" };

/** One row's disposition outcome: its report tuple and, on failure, the halt signal. */
interface RowDisposition {
  readonly reportRow: LaunchReportRow;
  readonly halt: { readonly exitStatus: number } | null;
}

/** One stage's row-walk outcome: its report tuples and, on failure, the halting row. */
type StageWalkOutcome = { rows: readonly LaunchReportRow[]; halted: { rowId: string; exitStatus: number } | null };

/** Builds a row's report tuple — the exact evidence-row shape the report serializes. */
type ReportRowBuilder = (exitStatus: number, result: LaunchReportRow["result"]) => LaunchReportRow;

/** Binds one row's identity + evidence to a tuple builder (the exact report row shape). */
function reportRowBuilder(row: LaunchRow, evidenceRef: string, timestamp: string): ReportRowBuilder {
  const { rowId, section, modality, command } = row;
  return (exitStatus, result) => ({ rowId, section, modality, command, exitStatus, result, evidenceRef, timestamp });
}

/**
 * Dispositions one registry row into its report tuple.
 *
 * EXISTENCE rows (MANUAL-DRILL / DOC-SIGNOFF) are marked from the EXISTENCE
 * of their filed evidence artifact — the row's command is a human oracle and
 * is never executed; a missing artifact is a FAIL (never auto-passed). A
 * JSON artifact is additionally content-checked: its `verdict` field must
 * read "PASS", else the row FAILs with a named reason.
 *
 * EXECUTED rows (AUTOMATED-TEST / SCRIPT-PROBE) run their command through the
 * stage's dedupe cache — a repeated command runs once, sibling rows reuse the
 * first execution's result (their evidence refs co-reference the shared
 * log). Waived rows with a green execution are marked WAIVED.
 */
async function dispositionRow(
  row: LaunchRow,
  stage: LaunchStage,
  evidenceRef: string,
  ctx: StageRunContext,
  executedCommands: Map<string, CommandExecution>
): Promise<RowDisposition> {
  const buildRow = reportRowBuilder(row, evidenceRef, ctx.now().toISOString());

  // Self-referential criterion rows never spawn a nested gate: the process
  // lock is descendant-re-entrant, so a spawned gate would recurse the whole
  // run. Their proof is the resumable lineage itself — the gate only reaches
  // the final stage after every earlier stage passed, so a criterion row
  // evaluated in the final stage is certified by that lineage.
  if (row.command === GATE_COMMAND) {
    const proven = STAGES.indexOf(stage) === STAGES.length - 1;
    const result = proven ? "PASS" : "FAIL";
    console.log(
      `  ${RESULT_MARKS[result]} ${row.rowId} — gate lineage ${proven ? "certifies" : "cannot certify"} this criterion`
    );
    return { reportRow: buildRow(proven ? 0 : FAIL_EXIT, result), halt: proven ? null : { exitStatus: FAIL_EXIT } };
  }

  if (row.modality === "MANUAL-DRILL" || row.modality === "DOC-SIGNOFF") {
    const evidencePath = join(ctx.projectRoot, evidenceRef);
    const verdict = evidenceArtifactVerdict(evidencePath);
    if (!verdict.ok) return failDisposition(buildRow, row, verdict.reason);
    console.log(`  ☑ ${row.rowId} (${row.modality}) — evidence artifact present: ${evidencePath}`);
    return { reportRow: buildRow(0, "PASS"), halt: null };
  }

  if (hasOperatorPlaceholder(row.command)) {
    return failDisposition(buildRow, row, `operator placeholder in command: ${row.command}`);
  }

  let execution = executedCommands.get(row.command);
  if (execution === undefined) {
    execution = await ctx.runCommand(row.command);
    executedCommands.set(row.command, execution);
  }
  const exitStatus = execution.exitStatus;
  const green = exitStatus === 0;
  let result: LaunchReportRow["result"] = green ? "PASS" : "FAIL";
  if (row.waiver !== undefined) result = green ? "WAIVED" : "FAIL";
  console.log(`  ${RESULT_MARKS[result]} ${row.rowId} — exit ${exitStatus}`);
  return { reportRow: buildRow(exitStatus, result), halt: result === "FAIL" ? { exitStatus } : null };
}

// ─── Dry-Run Walk ────────────────────────────────────────────────────────────

/**
 * The harness self-verification walk — delegates to `runDryRun`
 * (`launch-gate-dryrun.ts`), which walks every registry row, audits every
 * cited command target, validates the state cycle (round-trip, resume
 * mapping, fresh scope, corrupted-state fallback), and writes + deletes a
 * redacted sample report in a temp directory. Fully read-only: zero spawns,
 * zero repo writes.
 */
function dryRunWalk(ctx: Pick<StageRunContext, "now" | "runStamp" | "reportStamp" | "projectRoot">): number {
  const deps: DryRunDeps = {
    now: ctx.now,
    runStamp: ctx.runStamp,
    reportStamp: ctx.reportStamp,
    projectRoot: ctx.projectRoot,
    resolveRef: resolveEvidenceRef,
    artifactExists,
    artifactVerdict: evidenceArtifactVerdict,
    saveState: saveGateState,
    readState: readGateState,
    clearState: clearGateState,
    stages: STAGES,
    rows: LAUNCH_CHECKLIST,
    rowsForStage,
    expectedStageCounts: STAGE_ROW_COUNTS,
    expectedTotalRows: EXPECTED_TOTAL_ROWS,
  };
  return runDryRun(deps).exitCode;
}

// ─── Stage Execution ─────────────────────────────────────────────────────────

/** Per-run mutable accumulators shared across the recursive stage walk. */
interface StageRunContext {
  readonly now: () => Date;
  readonly runCommand: StageCommandExecutor;
  readonly runStamp: string;
  readonly reportStamp: string;
  readonly projectRoot: string;
  readonly reportRows: LaunchReportRow[];
  readonly stageResults: StageResult[];
}

/**
 * Executes one stage's rows in order (recursive row walk — the first FAIL
 * halts the stage). Command dedupe rides the stage's `executedCommands` map
 * inside `dispositionRow`: a repeated command runs once, sibling rows reuse
 * the first execution's result.
 */
async function executeStage(
  stage: LaunchStage,
  ctx: StageRunContext,
  rowIndex: number,
  executedCommands: Map<string, CommandExecution>,
  reportRows: LaunchReportRow[]
): Promise<StageWalkOutcome> {
  const rows = rowsForStage(stage);
  if (rowIndex >= rows.length) return { rows: reportRows, halted: null };

  const row = rows[rowIndex];
  const evidenceRef = resolveEvidenceRef(row.evidenceRef, ctx.runStamp, ctx.reportStamp);
  const disposition = await dispositionRow(row, stage, evidenceRef, ctx, executedCommands);

  reportRows.push(disposition.reportRow);
  if (disposition.halt) {
    return { rows: reportRows, halted: { rowId: row.rowId, exitStatus: disposition.halt.exitStatus } };
  }

  return executeStage(stage, ctx, rowIndex + 1, executedCommands, reportRows);
}

/**
 * Recursive stage walk from `index`: persists state per stage, executes it,
 * and either halts (failing rowId + exit status), or advances. The final
 * stage assembles the machine launch report and prints the `VERDICT:` line.
 */
async function runStagesFrom(
  index: number,
  state: LaunchGateState,
  ctx: StageRunContext,
  outputDir?: string
): Promise<LaunchGateResult> {
  if (index >= STAGES.length) return assembleReport(ctx, outputDir);

  const stage = STAGES[index];
  const startedAt = ctx.now().toISOString();
  saveGateState(stage, index === 0 && state.lifecycle === "FRESH" ? "FRESH" : "IN_PROGRESS", ctx.now());
  console.log(`\n── Stage ${index + 1}/${STAGES.length}: ${stage} (${rowsForStage(stage).length} rows) ──`);

  const { rows, halted } = await executeStage(stage, ctx, 0, new Map(), []);
  ctx.reportRows.push(...rows);
  ctx.stageResults.push({ stage, status: halted ? "FAIL" : "PASS", startedAt, finishedAt: ctx.now().toISOString() });

  if (halted) {
    saveGateState(stage, "IN_PROGRESS", ctx.now());
    console.error(`\n❌ Row ${halted.rowId} FAILED (exit ${halted.exitStatus}) in stage ${stage}. Halting.`);
    logger.error(`launch-gate halted on row ${halted.rowId}`, { stage, exitStatus: halted.exitStatus });
    return { rows: ctx.reportRows, stages: ctx.stageResults, verdict: "FAIL", halted };
  }

  saveGateState(stage, index === STAGES.length - 1 ? "DONE" : "IN_PROGRESS", ctx.now());
  console.log(`✅ Stage ${stage} PASS`);
  return runStagesFrom(index + 1, state, ctx, outputDir);
}

/**
 * Assembles the machine launch report from the run's collected rows and
 * stage results. Waiver records carry the signatory the humans recorded in
 * the checklist document's own waiver rows, ingested read-only at assembly
 * time; a waiver with no recorded signatory stays `""` — unsigned, and
 * blocking the verdict. The gate never writes or fabricates a signatory.
 */
function assembleReport(ctx: StageRunContext, outputDir?: string): LaunchGateResult {
  const waivers = waiverRecordsOf(LAUNCH_CHECKLIST, ctx.projectRoot);
  const reportPath = writeLaunchReport(ctx.reportRows, ctx.stageResults, waivers, { outputDir, now: ctx.now() });
  console.log(`\nLaunch report written: ${reportPath}`);
  const verdict = computeVerdict(ctx.reportRows, waivers);
  return { rows: ctx.reportRows, stages: ctx.stageResults, verdict, reportPath };
}

// ─── Gate Body & CLI Entry ───────────────────────────────────────────────────

/**
 * The resumable gate run. Reads (or resets) the state file, executes the
 * stages from the resumed index, persists state after each stage, and —
 * when all nine stages complete — assembles the machine launch report and
 * prints the final `VERDICT:` line. Interrupted runs leave state at the last
 * persisted stage and resume from there on the next invocation.
 */
export async function runLaunchGate(
  options: LaunchGateOptions,
  runOptions: LaunchGateRunOptions = {}
): Promise<LaunchGateResult> {
  const now = runOptions.now ?? (() => new Date());
  const runStart = now();
  const ctx: StageRunContext = {
    now,
    runCommand: runOptions.runCommand ?? spawnStageCommand,
    runStamp: formatRunStampDir(runStart),
    reportStamp: utcStamp(runStart),
    projectRoot: runOptions.projectRoot ?? PROJECT_ROOT,
    reportRows: [],
    stageResults: [],
  };

  if (options.dryRun) return { rows: [], stages: [], verdict: dryRunWalk(ctx) === 0 ? "PASS" : "FAIL" };
  if (options.fresh) {
    console.log("🧹 Fresh start requested. Deleting state file ONLY (caches are preserved)...");
    clearGateState();
  }

  const state = readGateState(runStart);
  const startIndex = STAGES.indexOf(state.stage);
  console.log(
    `🚀 Launch Gate: Stage=${state.stage}, Lifecycle=${state.lifecycle} (resuming at ${startIndex + 1}/${STAGES.length})`
  );
  return runStagesFrom(startIndex, state, ctx, runOptions.outputDir);
}

/**
 * CLI entry point. Reads argv (`--fresh`, `--dry-run`), wraps the gate in
 * `withProcessLock("launch-gate", …)`, and returns the process exit code:
 * 0 iff the final verdict is PASS; a halted run exits with the failing
 * row's exit status.
 */
export async function main(argv: readonly string[] = process.argv): Promise<number> {
  const result = await withProcessLock("launch-gate", () => runLaunchGate(parseGateArgs(argv)));
  if (result.halted) return result.halted.exitStatus ?? 1;
  return result.verdict === "PASS" ? 0 : 1;
}

if (import.meta.main) {
  main()
    .then(code => process.exit(code))
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
