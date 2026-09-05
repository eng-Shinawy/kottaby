/**
 * Progressive quality checks for `sub-loop.ts`.
 *
 * Implements the per-file checks and their output filtering:
 *   tsgo → oxlint → biome:check → lint:type-aware (via lint service) → check:duplicates
 *
 * Every check is scoped to the target file — tsgo runs project-wide and its
 * output is filtered for the target file; the rest run file-level.
 */

import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { type CheckResult, exitCodePassed, logInfo, runCommand } from "@/scripts/health/shared/sub-loop-types";
import { type LintResult, requestLint } from "@/scripts/lint-service";

// ─── Constants ──────────────────────────────────────────────────────────────

const PROJECT_ROOT = process.cwd();

// ─── Helpers ───────────────────────────────────────────────────────────────

function toCheckResult(name: string, passed: boolean, output: string): CheckResult {
  return { name, passed, output };
}

/**
 * Submit a lint request to the in-process lint service.
 */
async function lintViaQueue(filePath: string): Promise<LintResult> {
  const relPath = relative(PROJECT_ROOT, resolve(PROJECT_ROOT, filePath));
  return requestLint("sub-loop", [relPath], { typeAware: true, maxWarnings: 0 });
}

function eslintOutputHasProblems(output: string): boolean {
  const summary = /\((\d+) errors?, (\d+) warnings?\)/.exec(output);
  if (summary) {
    return Number(summary[1]) > 0 || Number(summary[2]) > 0;
  }

  for (const line of output.split("\n")) {
    if (/^\s+\d+:\d+\s+(?:error|warning) /.test(line)) {
      return true;
    }
  }
  return false;
}

function oxlintOutputHasDiagnostics(output: string): boolean {
  return /:\d+:\d+:\s+(error|warning)\s/.test(output);
}

function biomeOutputHasDiagnostics(output: string): boolean {
  return output.includes("×") || output.includes("⚠");
}

/**
 * Check if a line mentions the target file.
 */
function lineMentionsFile(line: string, relPath: string, filePath: string): boolean {
  return line.includes(relPath) || line.includes(filePath);
}

/**
 * Collect an error block: the header line plus subsequent continuation lines.
 */
function collectErrorBlock(lines: string[], startIndex: number, errorBlockRegex: RegExp): string[] {
  const block: string[] = [lines[startIndex]];
  for (let j = startIndex + 1; j < lines.length; j++) {
    if (errorBlockRegex.exec(lines[j]) || lines[j].trim() === "") break;
    block.push(lines[j]);
  }
  return block;
}

/**
 * Filter tsgo output for lines mentioning the target file.
 * tsgo runs project-wide, so we need to extract only relevant errors.
 */
function filterTsgoForFile(tsgoOutput: string, filePath: string): string {
  const relPath = relative(PROJECT_ROOT, resolve(PROJECT_ROOT, filePath));
  const lines = tsgoOutput.split("\n");
  const matchingLines: string[] = [];
  const errorBlockRegex = /^(.+\.tsx?)\(\d+,\d+\):/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isErrorBlock = errorBlockRegex.exec(line);

    if (isErrorBlock && lineMentionsFile(line, relPath, filePath)) {
      matchingLines.push(...collectErrorBlock(lines, i, errorBlockRegex));
    } else if (!isErrorBlock && !line.startsWith("$ ") && lineMentionsFile(line, relPath, filePath)) {
      matchingLines.push(line);
    }
  }

  return matchingLines.length > 0 ? matchingLines.join("\n") : "";
}

// ─── Checks ────────────────────────────────────────────────────────────────

export function checkTsgo(filePath: string): CheckResult {
  logInfo(`Running tsgo (project-wide, filtering for ${filePath})...`);
  const result = runCommand("bun", ["tsgo"]);
  const relevantDiagnostics = filterTsgoForFile(result.output, filePath);

  if (relevantDiagnostics) {
    return toCheckResult("tsgo", false, relevantDiagnostics);
  }

  return toCheckResult("tsgo", true, "");
}

export function checkBiome(filePath: string): CheckResult {
  const relPath = relative(PROJECT_ROOT, resolve(PROJECT_ROOT, filePath));
  logInfo(`Running biome:check on ${relPath}...`);
  const result = runCommand("bunx", ["@biomejs/biome", "check", "--write", "--unsafe", "--error-on-warnings", relPath]);
  return toCheckResult(
    "biome:check",
    exitCodePassed(result.exitCode) && !biomeOutputHasDiagnostics(result.output),
    result.output
  );
}

export function checkOxlint(filePath: string): CheckResult {
  const relPath = relative(PROJECT_ROOT, resolve(PROJECT_ROOT, filePath));
  logInfo(`Running oxlint on ${relPath}...`);
  const result = runCommand("bunx", ["oxlint", "--deny-warnings", "--ignore-path", ".gitignore", relPath]);
  const passed = exitCodePassed(result.exitCode) && !oxlintOutputHasDiagnostics(result.output);
  return toCheckResult("oxlint", passed, result.output);
}

export async function checkLint(filePath: string): Promise<CheckResult> {
  logInfo(`Submitting lint:type-aware via in-process service for ${filePath}...`);
  try {
    const result = await lintViaQueue(filePath);
    const passed = result.success && !eslintOutputHasProblems(result.output);
    return toCheckResult("lint:type-aware", passed, result.output);
  } catch (err) {
    return toCheckResult(
      "lint:type-aware",
      false,
      `In-process lint service (type-aware) failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function jscpdFoundIntraFileClones(output: string): boolean {
  return /Clone found/.test(output) || /Found [1-9]\d* clones/.test(output);
}

/** Type guard for `.jscpd.json` config shape. */
function isJscpdConfig(value: unknown): value is { ignore?: string[] } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (!("ignore" in value)) return true;
  const ignore = value.ignore;
  if (ignore === undefined) return true;
  return Array.isArray(ignore) && ignore.every((v): v is string => typeof v === "string");
}

/** Patterns ignored by `.jscpd.json` — read at runtime to avoid drift. */
let jscpdIgnorePatterns: string[] | null = null;

function getJscpdIgnorePatterns(): string[] {
  if (jscpdIgnorePatterns !== null) return jscpdIgnorePatterns;
  try {
    const configPath = resolve(PROJECT_ROOT, ".jscpd.json");
    const raw = readFileSync(configPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    jscpdIgnorePatterns = isJscpdConfig(parsed) ? (parsed.ignore ?? []) : [];
  } catch {
    jscpdIgnorePatterns = [];
  }
  return jscpdIgnorePatterns;
}

/** Convert a glob-like pattern from .jscpd.json to a regex. */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::GLOBSTAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::GLOBSTAR::/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`(^|/)${escaped}(/|$)`);
}

function shouldSkipJscpd(filePath: string): boolean {
  const relPath = relative(PROJECT_ROOT, resolve(PROJECT_ROOT, filePath)).replace(/\\/g, "/");

  if (!/\.(ts|tsx)$/.test(relPath) || relPath.endsWith(".d.ts") || relPath === "next-env.d.ts") {
    return true;
  }
  if (/\.test\.(ts|tsx)$/.test(relPath)) {
    return true;
  }

  const ignorePatterns = getJscpdIgnorePatterns();
  for (const pattern of ignorePatterns) {
    if (globToRegex(pattern).test(relPath)) {
      return true;
    }
  }

  return false;
}

export function checkDuplicates(filePath: string): CheckResult {
  const relPath = relative(PROJECT_ROOT, resolve(PROJECT_ROOT, filePath)).replace(/\\/g, "/");

  if (shouldSkipJscpd(filePath)) {
    logInfo(`Skipping check:duplicates for ${relPath} (outside jscpd scan scope)...`);
    return { name: "check:duplicates", passed: true, output: "" };
  }

  logInfo(`Running check:duplicates (jscpd, intra-file only) on ${relPath}...`);
  const result = runCommand("bunx", ["jscpd", "-c", ".jscpd.json", relPath]);
  const hasClones = jscpdFoundIntraFileClones(result.output);
  const passed = exitCodePassed(result.exitCode) && !hasClones;

  return toCheckResult("check:duplicates", passed, hasClones || !exitCodePassed(result.exitCode) ? result.output : "");
}
