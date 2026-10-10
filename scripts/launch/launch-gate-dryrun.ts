/**
 * The launch gate's dry-run self-verification — the harness validating itself
 * end-to-end without executing a single suite.
 *
 * The walk covers five validations:
 *   1. Registry resolvability — every row resolves to its stage, the
 *      per-stage inventory matches, and every executed row's cited command
 *      target exists on disk (or is a known pending closer artifact, reported
 *      as pending, never a failure).
 *   2. Existence-marking — MANUAL-DRILL / DOC-SIGNOFF rows resolve their
 *      evidence refs through the same artifact-existence check the real run
 *      uses, and JSON artifacts go through the same content check (a PASS
 *      verdict inside the artifact); a missing drill artifact is reported
 *      as pending (the drills file them), any other missing evidence
 *      artifact — or a present artifact whose verdict is not PASS — is a
 *      finding.
 *   3. State round-trip + resume mapping — every stage literal round-trips
 *      through the persisted state and maps back to its own resume index
 *      (the basis of the resume short-circuit: passed stages never re-run).
 *   4. Fresh scope — clearing state deletes the state file only; a sentinel
 *      file beside it survives (never any cache).
 *   5. Sample report + redaction — a hypothetical all-green report is written
 *      to a temp directory, read back, and checked for the allowlisted key
 *      sets (a planted non-allowlisted property must not survive) and the
 *      verdict rule (waiver signatories are ingested from the checklist
 *      document exactly as the real run ingests them — unsigned waivers
 *      block, and a serialized signatory may never differ from the ingested
 *      record); the temp report is deleted afterwards.
 *
 * Read-only contract: zero subprocess spawns, zero writes outside one
 * process-private temp directory — never the repo-root state file, never
 * docs/planning, never any cache. This module also hosts the evidence-
 * artifact primitives (wildcard ref resolution + the JSON verdict content
 * check) the real run and this walk share — the gate imports them from
 * here, never the reverse. The state functions and the evidence-ref
 * resolver are injected so every validated collaborator is the exact
 * function the real run uses.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { auditCommandTargets, citedTargetsOf, isRecord } from "@/scripts/launch/launch-gate-dryrun.cited-targets";
import { computeVerdict, writeLaunchReport } from "@/scripts/launch/launch-report";
import { waiverRecordsOf } from "@/scripts/launch/launch-waiver-signatories";
import type {
  LaunchGateState,
  LaunchReportRow,
  LaunchRow,
  LaunchStage,
  StageResult,
} from "@/scripts/launch/shared/launch-types";

// Re-exported for the paired test module — the command-target audit lives in
// `launch-gate-dryrun.cited-targets.ts` (this module sits at the max-lines budget).
export { citedTargetsOf };

/** The registry's mandated row inventory — the walk fails if it drifts. */
export const EXPECTED_TOTAL_ROWS = 173;

/**
 * Rows whose evidence artifacts are filed by the disaster-recovery drills.
 * The real run fail-closes on their absence; here it is pending, not a
 * defect. Any OTHER existence row with a missing artifact is a finding.
 */
const PENDING_DRILL_ROWS: ReadonlySet<string> = new Set(["7.1", "7.7"]);

/** Planted on one sample row — must never survive serialization. */
const PLANTED_REDACTION_TOKEN = "dry-run-redaction-probe-token";

/** The report envelope's allowlisted keys, exact set. */
const REPORT_ENVELOPE_KEYS = ["generatedAt", "rows", "stages", "verdict", "waivers"];
/** One report row's allowlisted keys, exact set. */
const REPORT_ROW_KEYS = ["command", "evidenceRef", "exitStatus", "modality", "result", "rowId", "section", "timestamp"];

// ─── Evidence-artifact primitives (shared with the real run) ─────────────────

/** The content check on an existence-marked row's evidence artifact: ok, or a named reason it failed. */
type EvidenceVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * All on-disk files an evidence ref resolves to, with wildcard tolerance:
 * after stamp substitution a drill row's path may still carry a
 * `<drill-stamp>`-style placeholder (the drill files its artifact with a
 * real stamp) — such a segment matches any file name in that directory.
 */
export function matchingEvidenceFiles(artifactPath: string): string[] {
  const name = basename(artifactPath);
  if (!name.includes("<")) return existsSync(artifactPath) ? [artifactPath] : [];
  const prefix = name.slice(0, name.indexOf("<"));
  const suffix = name.slice(name.indexOf(">") + 1);
  const dir = dirname(artifactPath);
  return readdirSync(dir)
    .filter(file => file.startsWith(prefix) && file.endsWith(suffix))
    .map(file => join(dir, file));
}

/** Evidence-artifact existence with the same wildcard tolerance. */
export function artifactExists(artifactPath: string): boolean {
  return matchingEvidenceFiles(artifactPath).length > 0;
}

/**
 * Content check for existence-marked rows: the evidence artifact must exist,
 * and a JSON artifact must carry a `verdict` field reading "PASS" — the
 * newest matching file is parsed (stamped file names sort chronologically).
 * A missing file, an unparseable body, a missing field, or a non-PASS
 * verdict fails with a named reason, never silently. Non-JSON artifacts
 * are existence-only.
 */
export function evidenceArtifactVerdict(artifactPath: string): EvidenceVerdict {
  const matches = matchingEvidenceFiles(artifactPath).toSorted((a, b) => b.localeCompare(a));
  if (matches.length === 0) return { ok: false, reason: `evidence artifact missing: ${artifactPath}` };
  const newest = matches[0];
  if (!artifactPath.endsWith(".json")) return { ok: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(newest, "utf8"));
  } catch {
    return { ok: false, reason: `evidence artifact is not valid JSON: ${newest}` };
  }
  if (!isRecord(parsed) || typeof parsed.verdict !== "string")
    return { ok: false, reason: `evidence artifact has no verdict field: ${newest}` };
  if (parsed.verdict !== "PASS")
    return {
      ok: false,
      reason: `evidence artifact verdict is ${JSON.stringify(parsed.verdict)}, expected "PASS": ${newest}`,
    };
  return { ok: true };
}

// ─── Injected collaborators ───────────────────────────────────────────────────

/** The gate collaborators the dry run validates — the exact real-run functions. */
export interface DryRunDeps {
  readonly now: () => Date;
  readonly runStamp: string;
  readonly reportStamp: string;
  readonly projectRoot: string;
  readonly resolveRef: (evidenceRef: string, runStamp: string, reportStamp: string) => string;
  readonly artifactExists: (artifactPath: string) => boolean;
  readonly artifactVerdict: (artifactPath: string) => EvidenceVerdict;
  readonly saveState: (
    stage: LaunchStage,
    lifecycle: LaunchGateState["lifecycle"],
    now: Date,
    stateFile: string
  ) => void;
  readonly readState: (now: Date, stateFile: string) => LaunchGateState;
  readonly clearState: (stateFile: string) => void;
  readonly stages: readonly LaunchStage[];
  readonly rows: readonly LaunchRow[];
  readonly rowsForStage: (stage: LaunchStage) => readonly LaunchRow[];
  readonly expectedStageCounts: Readonly<Record<LaunchStage, number>>;
  readonly expectedTotalRows: number;
  /** Record-line sink (ops stdout-line-as-record pattern; defaults to console.log). */
  readonly stdout?: (line: string) => void;
}

/** The structured outcome of one dry-run walk. */
export interface DryRunSummary {
  readonly exitCode: number;
  readonly findings: readonly string[];
  readonly totalRows: number;
  readonly stageCounts: readonly (readonly [LaunchStage, number])[];
  readonly waiverRows: readonly string[];
  readonly existenceRows: readonly string[];
  readonly pendingTargets: readonly string[];
  readonly pendingArtifacts: readonly string[];
  readonly stateChecks: readonly string[];
  readonly sampleReport: { readonly path: string; readonly rows: number; readonly verdict: "PASS" | "FAIL" } | null;
}

/** The walk's registry inventory. */
interface RegistryInventory {
  readonly totalRows: number;
  readonly stageCounts: [LaunchStage, number][];
  readonly waiverRows: string[];
  readonly existenceRows: string[];
}

/** Deterministic key-set rendering for exact-allowlist comparisons. */
function sortedKeysOf(keys: readonly string[]): string {
  return keys.toSorted((a, b) => a.localeCompare(b)).join(",");
}

// ─── Registry walk ────────────────────────────────────────────────────────────

/** Walks every stage's rows, printing what would run / what is existence-marked. */
function walkRegistry(deps: DryRunDeps, out: (line: string) => void): RegistryInventory {
  const inventory: RegistryInventory = {
    totalRows: deps.rows.length,
    stageCounts: [],
    waiverRows: [],
    existenceRows: [],
  };
  for (const stage of deps.stages) {
    const rows = deps.rowsForStage(stage);
    inventory.stageCounts.push([stage, rows.length]);
    const expected = deps.expectedStageCounts[stage];
    const suffix = rows.length === expected ? "" : ` (MISMATCH — expected ${expected})`;
    out(`— ${stage}: ${rows.length} rows${suffix}`);
    for (const row of rows) {
      const executed = row.modality === "AUTOMATED-TEST" || row.modality === "SCRIPT-PROBE";
      if (row.waiver !== undefined) inventory.waiverRows.push(row.rowId);
      if (!executed) inventory.existenceRows.push(row.rowId);
      const proof = executed ? row.command : deps.resolveRef(row.evidenceRef, deps.runStamp, deps.reportStamp);
      out(
        `  ${executed ? "would run" : "existence"}  ${row.rowId} (${row.modality}) → ${proof}${row.waiver ? "  [waived]" : ""}`
      );
    }
  }
  return inventory;
}

/** Stage-inventory and total-row-count checks. */
function auditRegistry(deps: DryRunDeps, stageCounts: readonly (readonly [LaunchStage, number])[]): string[] {
  const findings: string[] = [];
  for (const [stage, count] of stageCounts) {
    if (count !== deps.expectedStageCounts[stage])
      findings.push(`stage ${stage}: ${count} rows, expected ${deps.expectedStageCounts[stage]}`);
  }
  if (deps.rows.length !== deps.expectedTotalRows)
    findings.push(`registry holds ${deps.rows.length} rows, expected ${deps.expectedTotalRows}`);
  return findings;
}

// ─── Existence-marking audit ──────────────────────────────────────────────────

/**
 * MANUAL-DRILL / DOC-SIGNOFF rows are never executed — their proof is the
 * existence of the filed evidence artifact, and JSON artifacts additionally
 * carry their verdict inside the body (a PASS verdict is required). Missing
 * drill artifacts are pending (the drills file them); any other missing
 * artifact — or a present JSON artifact whose content check fails — is a
 * finding, never a silent pass.
 */
function auditExistenceRows(deps: DryRunDeps): { pending: string[]; findings: string[] } {
  const pending: string[] = [];
  const findings: string[] = [];
  for (const row of deps.rows) {
    if (row.modality !== "MANUAL-DRILL" && row.modality !== "DOC-SIGNOFF") continue;
    const ref = deps.resolveRef(row.evidenceRef, deps.runStamp, deps.reportStamp);
    const artifactPath = join(deps.projectRoot, ref);
    if (deps.artifactExists(artifactPath)) {
      const verdict = deps.artifactVerdict(artifactPath);
      if (!verdict.ok) findings.push(`row ${row.rowId} (${row.modality}): ${verdict.reason}`);
      continue;
    }
    if (PENDING_DRILL_ROWS.has(row.rowId)) pending.push(`${row.rowId} → ${ref}`);
    else findings.push(`row ${row.rowId} (${row.modality}): evidence artifact missing: ${ref}`);
  }
  return { pending, findings };
}

// ─── State round-trip, resume mapping & fresh scope ──────────────────────────

/**
 * Round-trips every stage literal through the persisted state (into a temp
 * state path — never the repo-root state file), checks each round-trip maps
 * back to its own resume index, proves the fresh reset deletes the state file
 * only (a sentinel beside it survives), and proves a corrupted state file
 * falls back to a fresh start without throwing.
 */
function validateStateCycle(deps: DryRunDeps, tempRoot: string): { checks: string[]; findings: string[] } {
  const checks: string[] = [];
  const findings: string[] = [];
  const stateDir = join(tempRoot, "state");
  mkdirSync(stateDir, { recursive: true });
  const stateFile = join(stateDir, ".launch-gate-state.json");

  for (const [index, stage] of deps.stages.entries()) {
    deps.saveState(stage, "IN_PROGRESS", deps.now(), stateFile);
    const read = deps.readState(deps.now(), stateFile);
    const roundTrips = read.stage === stage && read.owner === "launch-gate" && read.lifecycle === "IN_PROGRESS";
    const resumesHere = deps.stages.indexOf(read.stage) === index;
    if (roundTrips && resumesHere) checks.push(`state round-trip ${stage} → resumes at index ${index}`);
    else
      findings.push(
        `state round-trip failed at ${stage}: read back ${read.stage}/${read.lifecycle}, resume index ${deps.stages.indexOf(read.stage)} (expected ${index})`
      );
  }

  const sentinel = join(stateDir, "cache-sentinel.txt");
  writeFileSync(sentinel, "dry-run sentinel — must survive a fresh reset");
  deps.saveState(deps.stages[0], "IN_PROGRESS", deps.now(), stateFile);
  deps.clearState(stateFile);
  if (!existsSync(stateFile) && existsSync(sentinel))
    checks.push("fresh reset deletes the state file only — sentinel intact, no cache touched");
  else findings.push("fresh reset scope broken: state file or sentinel in unexpected state");

  writeFileSync(stateFile, '{"stage": "s2-fin');
  const fallback = deps.readState(deps.now(), stateFile);
  if (fallback.stage === deps.stages[0] && fallback.lifecycle === "FRESH")
    checks.push("corrupted state file falls back to a fresh start (never throws)");
  else findings.push(`corrupted state file did not fall back to fresh: ${fallback.stage}/${fallback.lifecycle}`);

  return { checks, findings };
}

// ─── Sample report + redaction check ──────────────────────────────────────────

/**
 * Writes a hypothetical all-green sample report into a temp directory, reads
 * it back, and asserts the serialized key sets are exactly the allowlisted
 * ones — a planted non-allowlisted property must not survive — and that the
 * verdict obeys the waiver rule with the signatories ingested from the
 * checklist document exactly as the real run ingests them (unsigned waivers
 * block; a serialized signatory may never differ from the ingested record).
 * The temp report is deleted afterwards.
 */
function validateSampleReport(
  deps: DryRunDeps,
  tempRoot: string
): { sample: DryRunSummary["sampleReport"]; findings: string[] } {
  const findings: string[] = [];
  const outputDir = join(tempRoot, "report");
  mkdirSync(outputDir, { recursive: true });
  const timestamp = deps.now().toISOString();
  const rows: LaunchReportRow[] = deps.rows.map(row => ({
    rowId: row.rowId,
    section: row.section,
    modality: row.modality,
    command: row.command,
    exitStatus: 0,
    result: row.waiver !== undefined ? "WAIVED" : "PASS",
    evidenceRef: deps.resolveRef(row.evidenceRef, deps.runStamp, deps.reportStamp),
    timestamp,
  }));
  if (rows.length > 0) rows[0] = Object.assign({}, rows[0], { dryRunRedactionProbe: PLANTED_REDACTION_TOKEN });
  const stages: StageResult[] = deps.stages.map(stage => ({
    stage,
    status: "PASS",
    startedAt: timestamp,
    finishedAt: timestamp,
  }));
  const waivers = waiverRecordsOf(deps.rows, deps.projectRoot);
  // The sample write's own VERDICT print is suppressed — the walk's summary
  // line reports the sample verdict; a bare VERDICT line mid-walk would read
  // as the dry run's verdict.
  const reportPath = writeLaunchReport(rows, stages, waivers, { outputDir, now: deps.now(), stdout: () => {} });
  if (dirname(reportPath) !== outputDir) findings.push(`sample report escaped the temp dir: ${reportPath}`);

  const text = readFileSync(reportPath, "utf8");
  const report: unknown = JSON.parse(text);
  let rowCount = 0;
  let verdict: "PASS" | "FAIL" = "FAIL";
  if (isRecord(report)) {
    const envelope = sortedKeysOf(Object.keys(report));
    if (envelope !== sortedKeysOf(REPORT_ENVELOPE_KEYS))
      findings.push(`sample report envelope keys drifted: ${envelope}`);
    if (Array.isArray(report.rows)) {
      rowCount = report.rows.length;
      const first = report.rows[0];
      if (isRecord(first)) {
        const rowKeys = sortedKeysOf(Object.keys(first));
        if (rowKeys !== sortedKeysOf(REPORT_ROW_KEYS)) findings.push(`sample report row keys drifted: ${rowKeys}`);
      }
    } else findings.push("sample report rows is not an array");
    verdict = report.verdict === "PASS" ? "PASS" : "FAIL";
    if (rowCount !== deps.rows.length) findings.push(`sample report rows: ${rowCount}, expected ${deps.rows.length}`);
    if (Array.isArray(report.waivers)) {
      for (const [index, waiver] of waivers.entries()) {
        const serialized = report.waivers[index];
        if (!isRecord(serialized) || serialized.signatory !== waiver.signatory)
          findings.push(
            `sample report waiver ${waiver.rowId}: serialized signatory disagrees with the ingested record — the gate never fabricates one`
          );
      }
    } else findings.push("sample report waivers is not an array");
  } else findings.push("sample report is not a JSON object");
  if (text.includes(PLANTED_REDACTION_TOKEN))
    findings.push("redaction failed: planted property survived serialization");
  if (verdict !== computeVerdict(rows, waivers))
    findings.push(`sample report verdict ${verdict} disagrees with the waiver rule`);
  if (waivers.length > 0 && waivers.every(waiver => waiver.signatory === "") && verdict !== "FAIL")
    findings.push(`unsigned waivers must block the sample verdict (got ${verdict})`);

  rmSync(outputDir, { recursive: true, force: true });
  return { sample: { path: reportPath, rows: rowCount, verdict }, findings };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Runs the full self-verification walk. Returns the structured summary;
 * `exitCode` is 0 iff there are no findings. The process-private temp
 * directory is removed in every case.
 */
export function runDryRun(deps: DryRunDeps): DryRunSummary {
  const out = deps.stdout ?? console.log;
  const tempRoot = mkdtempSync(join(tmpdir(), "launch-gate-dryrun-"));
  try {
    out("🧪 Launch gate DRY RUN — zero suite spawns, zero state/cache writes\n");
    const inventory = walkRegistry(deps, out);
    const findings = [...auditRegistry(deps, inventory.stageCounts)];

    const targets = auditCommandTargets(deps);
    findings.push(...targets.findings);
    for (const entry of targets.pending) out(`  ⧗ pending closer target: ${entry}`);

    const existence = auditExistenceRows(deps);
    findings.push(...existence.findings);
    for (const entry of existence.pending) out(`  ⧗ pending drill artifact: ${entry}`);

    const state = validateStateCycle(deps, tempRoot);
    findings.push(...state.findings);
    for (const check of state.checks) out(`  ✓ ${check}`);

    const sample = validateSampleReport(deps, tempRoot);
    findings.push(...sample.findings);
    if (sample.sample !== null)
      out(
        `  ✓ sample report: ${sample.sample.rows} rows, verdict ${sample.sample.verdict} (waiver signatories ingested from the checklist doc; unsigned stays blocking), redaction verified — written to ${sample.sample.path} and deleted`
      );

    out(`\nWaiver rows: ${inventory.waiverRows.length} (each needs a human signatory recorded in the checklist doc)`);
    out(`Existence-marked rows: ${inventory.existenceRows.length}`);
    out(`Registry rows resolved: ${inventory.totalRows} / ${deps.expectedTotalRows} expected`);
    const summary: DryRunSummary = {
      exitCode: findings.length > 0 ? 1 : 0,
      findings,
      totalRows: inventory.totalRows,
      stageCounts: inventory.stageCounts,
      waiverRows: inventory.waiverRows,
      existenceRows: inventory.existenceRows,
      pendingTargets: targets.pending,
      pendingArtifacts: existence.pending,
      stateChecks: state.checks,
      sampleReport: sample.sample,
    };
    if (findings.length > 0) {
      for (const finding of findings) out(`  ✗ ${finding}`);
      out("❌ Dry-run found harness findings — fix them before executing stages.");
    } else {
      out("✅ Dry-run complete — registry resolvable, targets audited, state cycle and sample report verified.");
    }
    return summary;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
