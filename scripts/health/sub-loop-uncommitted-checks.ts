/**
 * SUB-LOOP-UNCOMMITTED — Checks (run once, project-wide, then filter)
 *
 * Extracted from `sub-loop-uncommitted.ts`. Contains the batch-mode check
 * functions (tsgo, biome, oxlint, lint:type-aware, check:duplicates) plus the
 * lifecycle-gated `collectResults` orchestrator.
 */

import { relative, resolve } from "node:path";
import {
  type CheckResult,
  exitCodePassed,
  logFail,
  logInfo,
  logPass,
  runCommand,
} from "@/scripts/health/shared/sub-loop-types";
import { extractFailedFiles, filterTsgoForFiles } from "@/scripts/health/sub-loop-uncommitted-filter";
import { type LintResult, requestLint } from "@/scripts/lint-service";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Batch-mode extension of {@link CheckResult} that tracks which specific
 * uncommitted files failed the check. `sub-loop-uncommitted.ts` runs each
 * check once across all uncommitted files, so per-file failure attribution
 * is needed for the summary report.
 */
export interface BatchCheckResult extends CheckResult {
  failedFiles: string[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PROJECT_ROOT = process.cwd();

// ─── Checks (run once, project-wide, then filter) ──────────────────────────

export function checkTsgoAll(files: string[]): BatchCheckResult {
  logInfo(`Running tsgo (project-wide, filtering for ${files.length} uncommitted files)...`);
  const result = runCommand("bun", ["tsgo"]);

  if (exitCodePassed(result.exitCode)) {
    logPass("tsgo passed (no errors for any uncommitted file)");
    return { name: "tsgo", passed: true, output: "", failedFiles: [] };
  }

  // tsgo failed — filter output for uncommitted files
  const filtered = filterTsgoForFiles(result.output, files);
  const failedFiles = extractFailedFiles(filtered, files);

  if (failedFiles.length === 0) {
    logPass("tsgo passed (errors exist but not in uncommitted files)");
    return { name: "tsgo", passed: true, output: "", failedFiles: [] };
  }

  logFail(`tsgo FAILED — ${failedFiles.length} uncommitted file(s) have errors`);
  console.log(filtered);
  return { name: "tsgo", passed: false, output: filtered, failedFiles };
}

export function checkBiomeAll(files: string[]): BatchCheckResult {
  if (files.length === 0) {
    return { name: "biome:check", passed: true, output: "", failedFiles: [] };
  }
  logInfo(`Running biome:check on ${files.length} uncommitted file(s)...`);
  // Run biome on all uncommitted files at once
  const result = runCommand("bunx", ["@biomejs/biome", "check", "--write", "--unsafe", ...files]);

  if (exitCodePassed(result.exitCode)) {
    logPass("biome:check passed for all uncommitted files");
    return { name: "biome:check", passed: true, output: "", failedFiles: [] };
  }

  const failedFiles = extractFailedFiles(result.output, files);
  logFail(`biome:check FAILED — ${failedFiles.length} file(s) have issues`);
  console.log(result.output);
  return { name: "biome:check", passed: false, output: result.output, failedFiles };
}

export function checkOxlintAll(files: string[]): BatchCheckResult {
  if (files.length === 0) {
    return { name: "oxlint", passed: true, output: "", failedFiles: [] };
  }
  logInfo(`Running oxlint on ${files.length} uncommitted file(s)...`);
  // Run oxlint on all uncommitted files at once, with --deny-warnings
  const result = runCommand("bunx", ["oxlint", "--deny-warnings", "--ignore-path", ".gitignore", ...files]);

  if (exitCodePassed(result.exitCode)) {
    logPass("oxlint passed for all uncommitted files");
    return { name: "oxlint", passed: true, output: "", failedFiles: [] };
  }

  const failedFiles = extractFailedFiles(result.output, files);
  logFail(`oxlint FAILED — ${failedFiles.length} file(s) have violations`);
  console.log(result.output);
  return { name: "oxlint", passed: false, output: result.output, failedFiles };
}

export async function checkLintTypeAwareAll(files: string[]): Promise<BatchCheckResult> {
  if (files.length === 0) {
    return { name: "lint:type-aware", passed: true, output: "", failedFiles: [] };
  }
  logInfo(`Submitting lint:type-aware via in-process service for ${files.length} uncommitted file(s)...`);
  try {
    const relPaths = files.map(f => relative(PROJECT_ROOT, resolve(PROJECT_ROOT, f)));
    const result: LintResult = await requestLint("sub-loop-uncommitted", relPaths, {
      typeAware: true,
      maxWarnings: 0,
    });

    if (result.success) {
      logPass("lint:type-aware passed for all uncommitted files");
      return { name: "lint:type-aware", passed: true, output: "", failedFiles: [] };
    }

    const failedFiles = extractFailedFiles(result.output || "", files);
    logFail(`lint:type-aware FAILED — ${failedFiles.length} file(s) have issues`);
    console.log(result.output);
    return { name: "lint:type-aware", passed: false, output: result.output || "", failedFiles };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logFail(`lint:type-aware errored: ${msg}`);
    return { name: "lint:type-aware", passed: false, output: msg, failedFiles: files };
  }
}

export function checkDuplicatesAll(files: string[]): BatchCheckResult {
  if (files.length === 0) {
    return { name: "check:duplicates", passed: true, output: "", failedFiles: [] };
  }
  logInfo(`Running check:duplicates (jscpd) on uncommitted files...`);
  // jscpd doesn't support per-file args well; run project-wide and filter
  const result = runCommand("bunx", ["jscpd"]);

  if (exitCodePassed(result.exitCode)) {
    logPass("check:duplicates passed");
    return { name: "check:duplicates", passed: true, output: "", failedFiles: [] };
  }

  const failedFiles = extractFailedFiles(result.output, files);
  logFail(`check:duplicates found duplicates in ${failedFiles.length} file(s)`);
  console.log(result.output);
  return { name: "check:duplicates", passed: false, output: result.output, failedFiles };
}

/** Collect BatchCheckResults for all lifecycle stages up to `depth`. */
export async function collectResults(depth: number, files: string[]): Promise<BatchCheckResult[]> {
  const results: BatchCheckResult[] = [];

  // tsgo (depth 0+)
  results.push(checkTsgoAll(files));

  // oxlint + biome (depth 1+)
  if (depth >= 1) {
    results.push(checkOxlintAll(files));
    results.push(checkBiomeAll(files));
  }

  // lint:type-aware (depth 2+)
  if (depth >= 2) {
    results.push(await checkLintTypeAwareAll(files));
  }

  // check:duplicates (depth 3+)
  if (depth >= 3) {
    results.push(checkDuplicatesAll(files));
  }

  return results;
}
