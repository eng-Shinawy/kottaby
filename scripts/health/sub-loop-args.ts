/**
 * CLI argument parsing, validation, and help output for `sub-loop.ts`.
 *
 * CLI contract (preserved exactly — do not change):
 *   bun run scripts/health/sub-loop.ts <file-path> --lifecycle <stage>
 *
 * Exit codes: 0 = checks passed, 1 = failing check, 2 = invalid arguments.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  BOLD,
  CYAN,
  isLifecycle,
  LIFECYCLE_ORDER,
  type Lifecycle,
  logFail,
  NC,
} from "@/scripts/health/shared/sub-loop-types";

// ─── Constants ──────────────────────────────────────────────────────────────

const PROJECT_ROOT = process.cwd();

// ─── Argument Parsing ──────────────────────────────────────────────────────

interface ParsedArgs {
  filePath: string | null;
  lifecycle: string | null;
}

export function parseArgs(args: string[]): ParsedArgs {
  let filePath: string | null = null;
  let lifecycle: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--lifecycle") {
      lifecycle = args[i + 1] ?? null;
      i++;
    } else if (!args[i].startsWith("--")) {
      filePath = args[i];
    }
  }

  return { filePath, lifecycle };
}

// ─── Validation ────────────────────────────────────────────────────────────

export interface ValidatedArgs {
  filePath: string;
  lifecycle: Lifecycle;
}

export function validateArgs(filePath: string | null, lifecycle: string | null): ValidatedArgs {
  if (!filePath) {
    logFail("Missing <file-path> argument.");
    console.error("Usage: bun run scripts/health/sub-loop.ts <file-path> --lifecycle <stage>");
    process.exit(2);
  }

  const validLifecycles = Object.keys(LIFECYCLE_ORDER).join(", ");
  if (!lifecycle || !isLifecycle(lifecycle)) {
    logFail(`Invalid or missing --lifecycle argument.`);
    console.error(`Valid stages: ${validLifecycles}`);
    process.exit(2);
  }

  const absPath = resolve(PROJECT_ROOT, filePath);
  if (!existsSync(absPath)) {
    logFail(`File not found: ${filePath}`);
    process.exit(2);
  }

  return { filePath, lifecycle };
}

// ─── Help ───────────────────────────────────────────────────────────────────

export function printHelp(): void {
  console.log(`
${CYAN}Sub-Loop — Per-File Progressive Quality Verification${NC}

${BOLD}Usage:${NC}
  bun run scripts/health/sub-loop.ts <file-path> --lifecycle <stage>

${BOLD}Lifecycle stages (controls depth of checks):${NC}
  tsgo          Only run tsgo (type checking)
  biome         Run tsgo, then oxlint, then biome:check
  lint          Run tsgo, oxlint, biome, then lint:type-aware via lint service
  duplicates    Run tsgo, oxlint, biome, lint:type-aware, then check:duplicates

${BOLD}Check order (always strict, no skipping):${NC}
  1. tsgo (project-wide, filtered for this file)
  2. oxlint (file-level)
  3. biome:check (file-level)
  4. lint:type-aware via lint service (file-level)
  5. check:duplicates via jscpd (intra-file clones only)

${BOLD}Exit codes:${NC}
  0 = all checks up to lifecycle stage passed
  1 = stopped at a failing check (errors printed)
  2 = invalid arguments
`);
}
