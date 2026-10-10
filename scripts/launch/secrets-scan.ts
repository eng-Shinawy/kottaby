#!/usr/bin/env bun
/**
 * Hardcoded-secret scan — a read-only filesystem probe over an explicit
 * target path list (the launch gate spawns it for the security section's
 * secrets row with the env-example corpus, and the final report emission
 * runs it against the machine launch report before that file is
 * committed).
 *
 * Probe contract (shared across the launch probes):
 *   • Read-only — the scanner opens targets for reading only; it never
 *     writes to the filesystem or any cache, and it has no database
 *     surface.
 *   • Emits one `ProbeLine` JSON record per stdout line
 *     (`{rowId, result, detail}`) and exits 0 iff every line is PASS.
 *   • Never silently skips: an empty target list is a named FAIL line, an
 *     unreadable target is a named FAIL line.
 *   • Secret discipline: the scanner NEVER emits file contents, matched
 *     literals, or secret values — a FAIL detail names the target, the
 *     finding count, and line numbers only.
 *
 * Detection inventory (per target, over ACTIVE lines only — comment lines
 * are skipped uniformly, a documented lexical caveat in the fail-closed
 * static-scan tradition):
 *   • env assignment — `NAME=value` at line start where NAME carries the
 *     secret vocabulary (SECRET / TOKEN / PASSWORD / PASSPHRASE /
 *     API_KEY / PRIVATE_KEY, case-insensitive) and the value is a
 *     non-placeholder literal. Compliant values: empty, `<…>`-wrapped,
 *     `${…}` interpolation, or quoted forms of those. This is the
 *     placeholder-only discipline the env example file must hold.
 *   • code literal — `NAME: "literal"` / `NAME = 'literal'` (object keys
 *     and bindings, quoted JSON keys included) with the same name
 *     vocabulary and a quoted non-placeholder literal on the right. Code
 *     that resolves a secret through the env accessors (`getEnv(…)` /
 *     `requireEnv(…)` / `process.env.…`) never binds a quoted literal to
 *     the name, so the accessor discipline passes by construction.
 *   • credential-bearing URL — any active line whose `scheme://user:pass@`
 *     segment carries non-placeholder credentials.
 *
 * Usage:
 *   bun run scripts/launch/secrets-scan.ts <target-path>... [--help]
 *
 * Exit codes: 0 = every emitted line PASS; 1 = any line FAIL.
 */

import { readFileSync, statSync } from "node:fs";
import type { ProbeLine } from "@/scripts/launch/shared/launch-types";
import { emitProbeLines, handleProbeUsage, parseProbeArgs, rowIdsForCommand } from "@/scripts/launch/shared/probe-cli";
import { errorMessage } from "@/scripts/ops/backup-toolchain";

/** This scanner's own invocation — the registry row cites it verbatim (targets included). */
const PROBE_COMMAND = "bun run scripts/launch/secrets-scan.ts .env.example backend/lib/env.ts";

/**
 * Checklist rows this scanner proves — derived from the row registry (the
 * single source of truth), so a registry edit re-maps the line inventory
 * automatically.
 */
export const SECRETS_SCAN_ROW_IDS: readonly string[] = rowIdsForCommand(PROBE_COMMAND);

/** rowId of the empty-target-list line (a named FAIL line, never a silent skip). */
const TARGETS_ROW_ID = "secrets-scan.targets";

const USAGE = `Usage: bun run scripts/launch/secrets-scan.ts <target-path>... [--help]

Read-only hardcoded-secret scan over an explicit target path list. Emits
one {rowId, result, detail} line per target plus the mapped row's line;
never emits file contents. Exits 0 iff every line is PASS.`;

/** Injectable seams (tests stub the stdout/stderr sinks). */
export interface SecretsScanOptions {
  readonly stdout?: (line: string) => void;
  readonly stderr?: (line: string) => void;
}

// ─── Literal-secret detection (active lines only) ─────────────────────────────

/**
 * Identifiers whose binding marks a value as secret-bearing. Case-insensitive
 * substring match over the whole identifier (`PAYMOB_HMAC_SECRET`,
 * `accessToken`, `NGROK_AUTHTOKEN` all carry a vocabulary member).
 */
const SECRET_NAME_PATTERN = /(?:SECRET|TOKEN|PASSWORD|PASSPHRASE|API_KEY|PRIVATE_KEY)/iu;

/** `NAME=value` at line start — the dotenv assignment form (no spaces around `=`). */
const ENV_ASSIGNMENT_PATTERN = /^(\w+)=(.*)$/u;

/**
 * `NAME: "literal"` / `NAME = 'literal'` — a quoted JSON key, object-literal
 * key, or binding whose right side is a string literal. The optional closing
 * quote after the name lets quoted JSON keys (`"NAME": "…"`) match too.
 */
const CODE_LITERAL_PATTERN = /\b(\w+)\s*["']?[:=]\s*(["'])(.*?)\2/gu;

/** Credential segment of a URL — `scheme://user:pass@` with non-placeholder parts. */
const URL_CREDENTIAL_PATTERN = /:\/\/([^/@\s:]+):([^/@\s:]+)@/u;

/** Line shapes that carry no active assignment (comment conventions across env/code/JSON). */
function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("#") || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/** Strips one matching pair of surrounding quotes, if present. */
function stripSurroundingQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * A compliant (non-secret) assignment value: empty, a `<…>` placeholder, a
 * `${…}` interpolation, or a quoted form of those. Anything else is a
 * literal the scanner treats as secret material.
 */
function isCompliantValue(rawValue: string): boolean {
  const value = stripSurroundingQuotes(rawValue).trim();
  return value.length === 0 || (value.startsWith("<") && value.endsWith(">")) || value.startsWith("${");
}

/** A URL credential pair where neither side is a placeholder marker. */
function carriesLiteralCredentials(line: string): boolean {
  const match = URL_CREDENTIAL_PATTERN.exec(line);
  if (match === null) {
    return false;
  }
  return !match[1].includes("<") && !match[2].includes("<");
}

/**
 * One hardcoded-secret finding in a target — a line number and the rule that
 * fired. NEVER the matched text: findings describe WHERE and WHAT KIND only.
 */
export interface SecretFinding {
  readonly line: number;
  readonly rule: "env-assignment" | "code-literal" | "url-credentials";
}

/**
 * The literal-secret grep inventory over one target's content: every active
 * line is checked against the three rules. Pure and synchronous — the caller
 * owns the read; the content never leaves this function's return shape.
 */
export function findLiteralSecrets(content: string): readonly SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    if (isCommentLine(line)) {
      continue;
    }
    const lineNumber = index + 1;
    const envAssignment = ENV_ASSIGNMENT_PATTERN.exec(line);
    if (envAssignment !== null && SECRET_NAME_PATTERN.test(envAssignment[1]) && !isCompliantValue(envAssignment[2])) {
      findings.push({ line: lineNumber, rule: "env-assignment" });
      continue;
    }
    for (const match of line.matchAll(CODE_LITERAL_PATTERN)) {
      const name = match[1];
      const rawValue = match[3] ?? "";
      if (SECRET_NAME_PATTERN.test(name) && !isCompliantValue(rawValue)) {
        findings.push({ line: lineNumber, rule: "code-literal" });
        break;
      }
    }
    if (carriesLiteralCredentials(line)) {
      findings.push({ line: lineNumber, rule: "url-credentials" });
    }
  }
  return findings;
}

/** Collapses findings into a never-leaking detail: counts and line numbers only. */
function findingsDetail(findings: readonly SecretFinding[]): string {
  const first = findings[0];
  return `${findings.length} hardcoded secret literal(s) — first at line ${first.line} (${first.rule})`;
}

/**
 * Scans one target: present, a regular file, readable, and free of
 * hardcoded secret literals. The content stays inside the scanner — a FAIL
 * detail carries the finding count and line numbers, never the material.
 */
function probeTarget(target: string): ProbeLine {
  try {
    if (!statSync(target).isFile()) {
      return { rowId: target, result: "FAIL", detail: "not a regular file" };
    }
    const content = readFileSync(target, "utf8");
    const findings = findLiteralSecrets(content);
    if (findings.length > 0) {
      return { rowId: target, result: "FAIL", detail: findingsDetail(findings) };
    }
    return {
      rowId: target,
      result: "PASS",
      detail: `target clean — no hardcoded secret literals (${content.split(/\r?\n/u).length} line(s) scanned)`,
    };
  } catch (error) {
    return { rowId: target, result: "FAIL", detail: `target unreadable: ${errorMessage(error)}` };
  }
}

/**
 * The scan body: one line per target plus the mapped row's line. An empty
 * target list is a named FAIL line — the scanner never silently scans
 * nothing. The mapped row's line PASSes only when every target was scanned
 * clean; an unreadable target fails the row too (the corpus scan is then
 * incomplete), never a silent skip.
 */
export function scanSecretsTargets(targets: readonly string[]): readonly ProbeLine[] {
  if (targets.length === 0) {
    return [
      {
        rowId: TARGETS_ROW_ID,
        result: "FAIL",
        detail: "no target paths given — pass an explicit file path list to scan",
      },
    ];
  }
  const targetLines = targets.map(target => probeTarget(target));
  const rowLines = SECRETS_SCAN_ROW_IDS.map<ProbeLine>(rowId => {
    const failed = targetLines.filter(line => line.result === "FAIL");
    if (failed.length === 0) {
      return {
        rowId,
        result: "PASS",
        detail: `corpus clean — ${targets.length} target(s) scanned, zero hardcoded secret literals`,
      };
    }
    return {
      rowId,
      result: "FAIL",
      detail: `corpus scan incomplete — ${failed.length} of ${targets.length} target(s) failed`,
    };
  });
  return [...targetLines, ...rowLines];
}

/**
 * CLI entry point. Reads args (the tokens after the interpreter and script
 * path; the positionals are the target path list) and returns the process
 * exit code.
 */
export async function main(
  args: readonly string[] = process.argv.slice(2),
  options: SecretsScanOptions = {}
): Promise<number> {
  const parsed = parseProbeArgs(args, { allowPositionals: true });
  const usageExit = handleProbeUsage(
    "secrets-scan",
    USAGE,
    parsed,
    options.stdout ?? console.log,
    options.stderr ?? console.error
  );
  if (usageExit !== null) return usageExit;
  return emitProbeLines("secrets-scan", scanSecretsTargets(parsed.positionals), options.stdout);
}

if (import.meta.main) {
  main()
    .then(code => process.exit(code))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
