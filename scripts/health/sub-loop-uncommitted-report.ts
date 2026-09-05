/**
 * SUB-LOOP-UNCOMMITTED — Reporting, Staging & Summary
 *
 * Extracted from `sub-loop-uncommitted.ts`. Contains the console-output
 * helpers (header, staging preview, summary), the clean-file derivation, and
 * the `git add` staging helper.
 */

import {
  BOLD,
  CYAN,
  GREEN,
  LIFECYCLE_ORDER,
  type Lifecycle,
  logFail,
  logInfo,
  logPass,
  logWarn,
  NC,
  RED,
  runCommand,
} from "@/scripts/health/shared/sub-loop-types";
import type { BatchCheckResult } from "@/scripts/health/sub-loop-uncommitted-checks";

// ─── Helpers ───────────────────────────────────────────────────────────────

export function logFile(msg: string): void {
  console.log(`${CYAN}  📄${NC} ${msg}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

/**
 * Derive the set of files that have ZERO issues across all completed checks.
 * A file is clean iff it never appears in any BatchCheckResult.failedFiles.
 * Files that were not reached (due to short-circuit in a previous loop) are
 * NOT included — we only call this after all checks have run to completion.
 */
export function computeCleanFiles(allFiles: string[], results: BatchCheckResult[]): string[] {
  const failedEverywhere = new Set<string>();
  for (const r of results) {
    for (const f of r.failedFiles) {
      failedEverywhere.add(f);
    }
  }
  return allFiles.filter(f => !failedEverywhere.has(f));
}

/**
 * Print a staging preview: which files would be staged.
 * Does NOT call `git add` — that is gated by STAGING_ENABLED.
 */
export function printStagingPreview(cleanFiles: string[], stageEnabled: boolean): void {
  console.log("");
  console.log(`${BOLD}━━━ Staging Preview ━━━${NC}`);

  if (cleanFiles.length === 0) {
    logWarn("No zero-issue files to stage.");
    return;
  }

  const verb = stageEnabled ? "Will stage" : "Would stage (dry run — pass --stage to enable)";
  console.log(`  ${verb} ${cleanFiles.length} zero-issue file(s):`);
  for (const f of cleanFiles) {
    logFile(f);
  }
}

/**
 * Stage the given files using `git add -- <files>`.
 * Called ONLY when stageEnabled is true and cleanFiles is non-empty.
 * Uses `--` to prevent any path from being misinterpreted as a flag.
 */
export function stageCleanFiles(cleanFiles: string[]): void {
  if (cleanFiles.length === 0) return;
  logInfo(`Staging ${cleanFiles.length} zero-issue file(s)...`);
  // `git add --` ensures no path can be interpreted as a git flag.
  const result = runCommand("git", ["add", "--", ...cleanFiles]);
  if (result.exitCode !== 0) {
    logFail(`git add failed:\n${result.output}`);
    // Do NOT throw — the quality checks already completed. Just report.
  } else {
    logPass(`Successfully staged ${cleanFiles.length} file(s).`);
  }
}

/** Print the header and uncommitted files list. */
export function printHeader(lifecycle: Lifecycle, stageEnabled: boolean, files: string[]): void {
  const stagingLabel = stageEnabled ? `${GREEN}enabled${NC}` : "disabled (--no-stage / --dry-run)";
  console.log(`${BOLD}━━━ SUB-LOOP-UNCOMMITTED ━━━${NC}`);
  console.log(`  Lifecycle:  ${lifecycle} (depth: ${LIFECYCLE_ORDER[lifecycle]})`);
  console.log(`  Staging:    ${stagingLabel}`);
  console.log("");
  console.log(`${BOLD}Uncommitted files (${files.length}):${NC}`);
  for (const f of files) {
    logFile(f);
  }
  console.log("");
}

/** Print hint when one or more checks/files failed. */
export function printFailureHint(
  cleanCount: number,
  failedCount: number,
  firstFailedCheck: string,
  stageEnabled: boolean
): void {
  const stagedStatus = stageEnabled
    ? `Staged ${cleanCount} zero-issue file(s)`
    : `Identified ${cleanCount} zero-issue file(s) for staging (dry run — pass --stage to stage)`;

  console.log(`${RED}${BOLD}  First failing check: ${firstFailedCheck}${NC}`);
  console.log(
    `${CYAN}${BOLD}💡 Hint: ${stagedStatus}, while ${failedCount} file(s) are failing. First failing check: ${firstFailedCheck}.${NC}`
  );
}

export function printSummary(
  results: BatchCheckResult[],
  files: string[],
  cleanFiles: string[],
  stageEnabled: boolean
): void {
  // Build a set of all files that failed at least one check.
  const failedSet = new Set<string>();
  for (const r of results) {
    for (const f of r.failedFiles) {
      failedSet.add(f);
    }
  }

  const firstFailedCheck = results.find(r => !r.passed)?.name;

  console.log("");
  console.log(`${BOLD}━━━ Summary ━━━${NC}`);
  console.log(`  Files checked: ${files.length}`);
  for (const r of results) {
    const mark = r.passed ? `${GREEN}✅${NC}` : `${RED}❌${NC}`;
    const failedInfo = r.failedFiles.length > 0 ? ` (${r.failedFiles.length} failed)` : "";
    console.log(`  ${mark} ${r.name}${failedInfo}`);
  }

  console.log("");
  console.log(`${BOLD}Per-file status:${NC}`);
  for (const f of files) {
    if (failedSet.has(f)) {
      console.log(`  ${RED}❌${NC} ${f}`);
    } else {
      console.log(`  ${GREEN}✅${NC} ${f}`);
    }
  }

  const allPassed = cleanFiles.length === files.length && !firstFailedCheck;
  console.log("");
  if (allPassed) {
    console.log(`${GREEN}${BOLD}✅ All checks passed for all ${files.length} uncommitted file(s).${NC}`);
  } else {
    console.log(
      `${GREEN}${BOLD}✅ ${cleanFiles.length}/${files.length} file(s) are clean.${NC}` +
        `  ${RED}${BOLD}❌ ${failedSet.size}/${files.length} file(s) have issues.${NC}`
    );
    printFailureHint(cleanFiles.length, failedSet.size, firstFailedCheck ?? "unknown", stageEnabled);
  }
}
