/**
 * The launch gate dry-run's command-target audit — every executed row's
 * cited command must resolve before the real run ever spawns a suite.
 *
 * Extracted from `launch-gate-dryrun.ts` (which sits at the oxlint
 * `max-lines` budget) as a self-contained, dependency-light module: it reads
 * only the package manifest and the injected row inventory, so the dry-run
 * orchestrator imports it without any cycle (dependency flows one way).
 *
 * The script slot must exist in the package manifest (or be itself a file
 * path) and every cited repo path must exist on disk — a missing cited
 * target is always a finding.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LaunchRow } from "@/scripts/launch/shared/launch-types";

/** The dry-run collaborator slice the command-target audit consumes. */
interface CitedTargetDeps {
  readonly rows: readonly LaunchRow[];
  readonly projectRoot: string;
}

/** Structural guard for reading back JSON artifacts without casts. */
export function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null;
}

/** The script slot of a `bun [run] <target>` command line; null when absent. */
function scriptSlotOf(tokens: readonly string[]): string | null {
  if (tokens[0] !== "bun") return null;
  if (tokens[1] === "run") return tokens[2] ?? null;
  return tokens[1] ?? null;
}

/** URL-shaped tokens (`scheme://…`) name endpoints, never repo paths. */
const URI_TOKEN_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//iu;

/** Path-looking tokens: contain a separator, never a flag, placeholder, or URL. */
function tokenPathsOf(tokens: readonly string[]): readonly string[] {
  return tokens.filter(
    token =>
      token.includes("/") &&
      !token.startsWith("-") &&
      !token.includes("<") &&
      !token.includes(">") &&
      !URI_TOKEN_PATTERN.test(token)
  );
}

/** The script slot and every repo-path token a command cites. */
export function citedTargetsOf(command: string): { script: string | null; paths: readonly string[] } {
  const tokens = command.trim().split(/\s+/);
  return { script: scriptSlotOf(tokens), paths: tokenPathsOf(tokens) };
}

/** Reads the package manifest's script names; null when unreadable (check skipped). */
function packageScriptNames(projectRoot: string): ReadonlySet<string> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
    if (isRecord(parsed) && isRecord(parsed.scripts)) return new Set(Object.keys(parsed.scripts));
  } catch {
    // unreadable manifest — the script-name check cannot run
  }
  return null;
}

/**
 * Every executed row's command must resolve: its script slot exists in the
 * package manifest (or is itself a file path) and every cited repo path
 * exists. `pending` stays in the shape for the orchestrator's summary
 * contract and is always empty — a missing cited target is always a finding.
 */
export function auditCommandTargets(deps: CitedTargetDeps): { pending: string[]; findings: string[] } {
  const findings: string[] = [];
  const scriptNames = packageScriptNames(deps.projectRoot);
  for (const row of deps.rows) {
    if (row.modality !== "AUTOMATED-TEST" && row.modality !== "SCRIPT-PROBE") continue;
    const { script, paths } = citedTargetsOf(row.command);
    if (script !== null && !script.includes("/") && scriptNames !== null && !scriptNames.has(script))
      findings.push(`row ${row.rowId}: package script "${script}" not found in package.json`);
    for (const path of paths) {
      if (existsSync(join(deps.projectRoot, path))) continue;
      findings.push(`row ${row.rowId}: cited target missing: ${path}`);
    }
  }
  return { pending: [], findings };
}
