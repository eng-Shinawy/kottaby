/**
 * Run-directory and report lifecycle for the performance harness library.
 *
 * Every harness tool composes these primitives the same way:
 * `openRunDirectory` stamps a fresh `logs/perf/<YYYY-MM-DDTHH-MM-SS>_<tool>/`
 * directory, `writeReport` persists the machine (report.json) and human
 * (report.md) evidence files into it, and `emitVerdict` prints the terminal
 * `VERDICT: PASS|FAIL` line operators and CI read.
 *
 * Security contract: report content is redacted before it ever touches disk —
 * credential-bearing connection strings, bearer tokens, cookie values, and
 * key/secret assignments never serialize. Run identifiers are charset-validated
 * so a tool id or run id can never traverse outside `logs/perf/`.
 */

import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import type { GateResult } from "@/scripts/perf/lib/stats";

/** Run identity echoed into both report files. */
export interface PerfRunContext {
  runId: string;
  tool: string;
  startedAt: string;
  args: Record<string, string | number | boolean>;
}

/** Raised for malformed run contexts or filesystem refusals (clobbered reports, bad ids). */
export class PerfReportError extends Error {}

const PERF_LOGS_DIR = resolve(import.meta.dir, "..", "..", "..", "logs", "perf");
const TOOL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,48}$/;
const RUN_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{1,4})?_[a-z0-9][a-z0-9-]{0,48}$/;
const CONNECTION_STRING_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>:@]+:[^\s"'<>:@]+@[^\s"'<>]+/gi;
const BEARER_PATTERN = /\b(bearer)\s+[\w.=-]+/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const VENDOR_KEY_PATTERN = /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g;
// Secret-named keys are grouped into small alternations (kept lint-simple on
// purpose): any identifier containing one of these cores is treated as a
// secret-bearing key. The `pass` core is deliberately NOT bare (`password`,
// `passwd`, `pwd` only) so report fields like `passed` are never mangled.
// `session[_-]?id` lives in its own pattern to keep each alternation small.
// Container-shaped values are exempted inside `redactSecrets`'s replacement
// callback (see there) rather than in the regex value class.
const SECRET_ASSIGNMENT_PATTERNS = [
  /\b([\w-]*(?:token|secret|cookie)[\w-]*)(["'`+]?\s*[=:]\s*)(["'][^"'\n]*["']|[^\s,;&"']+)/gi,
  /\b([\w-]*(?:password|passwd|pwd)[\w-]*)(["'`+]?\s*[=:]\s*)(["'][^"'\n]*["']|[^\s,;&"']+)/gi,
  /\b([\w-]*(?:dsn|authoriz|key)[\w-]*)(["'`+]?\s*[=:]\s*)(["'][^"'\n]*["']|[^\s,;&"']+)/gi,
  /\b([\w-]*(?:session[_-]?id)[\w-]*)(["'`+]?\s*[=:]\s*)(["'][^"'\n]*["']|[^\s,;&"']+)/gi,
];

const REDACTED = "[REDACTED]";
const REDACTED_CONNECTION_STRING = "[REDACTED-CONNECTION-STRING]";
const REDACTED_KEY = "[REDACTED-KEY]";

/**
 * Redacts credential-shaped substrings from serialized report content:
 * connection strings carrying passwords, bearer tokens, JWTs, vendor API keys,
 * and any value assigned to a secret-named key (token/cookie/password/api-key
 * and friends, quoted or bare, either side of `=` or `:`). Quote characters
 * delimiting values are preserved so redacted JSON stays parseable.
 * Over-redaction is the safe direction for operator evidence.
 */
export function redactSecrets(content: string): string {
  let redacted = content.replace(CONNECTION_STRING_PATTERN, REDACTED_CONNECTION_STRING);
  redacted = redacted.replace(JWT_PATTERN, REDACTED);
  redacted = redacted.replace(BEARER_PATTERN, `$1 ${REDACTED}`);
  redacted = redacted.replace(VENDOR_KEY_PATTERN, REDACTED_KEY);
  for (const pattern of SECRET_ASSIGNMENT_PATTERNS) {
    redacted = redacted.replace(pattern, (match, keyName: string, separator: string, value: string) => {
      // JSON containers (`[...]`, `{...}`) are never secret scalars; consuming
      // their opening bracket would splice the redaction marker into the array
      // and corrupt serialized bodies (e.g. EXPLAIN's `Sort Key`).
      if (value.startsWith("[") || value.startsWith("{")) {
        return match;
      }
      const quote = value.startsWith('"') || value.startsWith("'") ? value.charAt(0) : "";
      return `${keyName}${separator}${quote}${REDACTED}${quote}`;
    });
  }
  return redacted;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatTimestamp(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

function assertValidToolId(tool: string): void {
  if (!TOOL_ID_PATTERN.test(tool)) {
    throw new PerfReportError(
      `invalid tool id ${JSON.stringify(tool)}: must be 1-49 chars of lowercase alphanumerics and dashes`
    );
  }
}

function runDirectoryFor(runId: string): string {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new PerfReportError(
      `invalid run id ${JSON.stringify(runId)}: expected "<YYYY-MM-DDTHH-MM-SS>[-N]_<tool>" with no path separators`
    );
  }
  const runDir = resolve(join(PERF_LOGS_DIR, runId));
  if (!runDir.startsWith(resolve(PERF_LOGS_DIR) + sep)) {
    throw new PerfReportError(`run id ${JSON.stringify(runId)} resolves outside the performance logs directory`);
  }
  return runDir;
}

function assertValidRunContext(ctx: PerfRunContext): void {
  assertValidToolId(ctx.tool);
  runDirectoryFor(ctx.runId);
  if (typeof ctx.startedAt !== "string" || Number.isNaN(Date.parse(ctx.startedAt))) {
    throw new PerfReportError("run context startedAt must be an ISO-8601 date string");
  }
  for (const [key, value] of Object.entries(ctx.args)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new PerfReportError(`argument ${JSON.stringify(key)} must be a string, number, or boolean`);
    }
  }
}

/** Writes `contents` to a new file at `path` with owner-only permissions; refuses to clobber. */
function writeNewFile(path: string, contents: string): void {
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PerfReportError(`refusing to overwrite or create report file at ${path}: ${message}`);
  }
  try {
    writeSync(fd, contents);
  } finally {
    closeSync(fd);
  }
}

/** Type guard: narrows a thrown value to the fs errno-error shape (drives the EEXIST suffix loop). */
function isErrnoError(value: unknown): value is { code?: string } {
  return typeof value === "object" && value !== null && "code" in value;
}

/**
 * Creates (and returns) a fresh timestamped run directory under `logs/perf/`.
 * Same-second collisions are suffixed `-2`, `-3`, ... so concurrent or repeated
 * invocations never share a directory. The create is atomic: `mkdirSync`
 * without `recursive` fails with EEXIST when another same-second racer already
 * took the name, and that failure drives the suffix loop — the former
 * `existsSync`-then-`mkdirSync` check-then-act pair could let two same-second
 * invocations both observe "absent" and share the unsuffixed name. The shared
 * parent is created once, idempotently, up front. Mode 0700.
 */
export function openRunDirectory(tool: string): { runDir: string; runId: string } {
  assertValidToolId(tool);
  mkdirSync(PERF_LOGS_DIR, { recursive: true, mode: 0o700 });
  const stamp = formatTimestamp(new Date());
  for (let attempt = 1; ; attempt += 1) {
    const runId = attempt === 1 ? `${stamp}_${tool}` : `${stamp}-${attempt}_${tool}`;
    const runDir = join(PERF_LOGS_DIR, runId);
    try {
      mkdirSync(runDir, { mode: 0o700 });
      return { runDir, runId };
    } catch (error) {
      if (isErrnoError(error) && error.code === "EEXIST") {
        continue;
      }
      throw error;
    }
  }
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function renderMarkdownReport(
  ctx: PerfRunContext,
  gates: readonly GateResult[],
  sections: Record<string, unknown>,
  verdict: string
): string {
  const lines: string[] = [
    "# Performance Run Report",
    "",
    `- **Tool:** ${escapeTableCell(ctx.tool)}`,
    `- **Run ID:** ${escapeTableCell(ctx.runId)}`,
    `- **Started At:** ${escapeTableCell(ctx.startedAt)}`,
    `- **Verdict:** ${verdict}`,
    "",
  ];

  const argEntries = Object.entries(ctx.args);
  if (argEntries.length > 0) {
    lines.push("## Arguments", "");
    for (const [key, value] of argEntries) {
      lines.push(`- \`--${key}\` = ${typeof value === "string" ? value : String(value)}`);
    }
    lines.push("");
  }

  lines.push("## Gates", "", "| Gate | Result | Breaches |", "| --- | --- | --- |");
  if (gates.length === 0) {
    lines.push("| _none_ | — | — |");
  }
  for (const gate of gates) {
    const breaches = gate.breaches.length === 0 ? "—" : escapeTableCell(gate.breaches.join("; "));
    lines.push(`| ${escapeTableCell(gate.id)} | ${gate.passed ? "PASS" : "FAIL"} | ${breaches} |`);
  }
  lines.push("");

  for (const [key, value] of Object.entries(sections)) {
    lines.push(`## ${key}`, "", "```json", JSON.stringify(value, null, 2), "```", "");
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Persists the run's evidence: `report.json` (machine-readable) and
 * `report.md` (operator-readable) inside the run directory named by
 * `ctx.runId`. Both bodies pass through secret redaction before they reach
 * disk, and both files are created owner-only (0600). Writing twice into the
 * same run directory refuses (clobber guard) — evidence is immutable once
 * written.
 */
export function writeReport(
  ctx: PerfRunContext,
  gates: readonly GateResult[],
  sections: Record<string, unknown>
): void {
  assertValidRunContext(ctx);
  if (!Array.isArray(gates)) {
    throw new PerfReportError("gates must be an array of gate results");
  }
  const runDir = runDirectoryFor(ctx.runId);
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const verdict = gates.every(gate => gate.passed) ? "PASS" : "FAIL";
  const jsonBody = redactSecrets(
    JSON.stringify(
      { tool: ctx.tool, runId: ctx.runId, startedAt: ctx.startedAt, args: ctx.args, gates, sections, verdict },
      null,
      2
    )
  );
  const markdownBody = redactSecrets(renderMarkdownReport(ctx, gates, sections, verdict));
  writeNewFile(join(runDir, "report.json"), `${jsonBody}\n`);
  writeNewFile(join(runDir, "report.md"), markdownBody);
}

/**
 * Prints the terminal `VERDICT: PASS|FAIL` line followed by each failed gate
 * and its breaches, and returns whether the run passed. A gate list with no
 * failures passes.
 */
export function emitVerdict(gates: readonly GateResult[]): boolean {
  const failures = gates.filter(gate => !gate.passed);
  if (failures.length === 0) {
    console.log("VERDICT: PASS");
    return true;
  }
  console.log("VERDICT: FAIL");
  for (const gate of failures) {
    console.log(redactSecrets(`  - [${gate.id}] ${gate.breaches.join("; ")}`));
  }
  return false;
}
