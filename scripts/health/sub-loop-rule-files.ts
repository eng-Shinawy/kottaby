/**
 * Instruction & AGENTS.md discovery for `sub-loop.ts`.
 *
 * Maps a target file path to the applicable `.github/instructions/*.instructions.md`
 * and layer-specific `AGENTS.md` rule files, and prints them so the subagent
 * knows exactly which rule files to read before fixing.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { BOLD, CYAN, GREEN, NC, YELLOW } from "@/scripts/health/shared/sub-loop-types";

// ─── Constants ──────────────────────────────────────────────────────────────

const PROJECT_ROOT = process.cwd();

// ─── Instruction & AGENTS.md Discovery ──────────────────────────────────────

/**
 * Map a file path to the applicable `.github/instructions/*.instructions.md` file(s).
 * Multiple instruction files can apply (e.g., a backend test file needs both
 * `backend.instructions.md` and `tests.instructions.md`).
 */
function getInstructionFiles(filePath: string): string[] {
  const instructions: string[] = [];
  const normalized = filePath.replace(/\\/g, "/");

  // Test files → tests.instructions.md
  if (
    /\.test\.tsx?$/.exec(normalized) ||
    /\.spec\.tsx?$/.exec(normalized) ||
    normalized.includes("scripts/run-test/")
  ) {
    instructions.push(".github/instructions/tests.instructions.md");
  }

  // Frontend files → frontend.instructions.md
  if (normalized.startsWith("frontend/") || normalized.startsWith("app/")) {
    instructions.push(".github/instructions/frontend.instructions.md");
  }

  // Backend files → backend.instructions.md
  if (normalized.startsWith("backend/")) {
    instructions.push(".github/instructions/backend.instructions.md");
  }

  // De-duplicate (e.g., a backend test file gets both backend + tests instructions)
  return [...new Set(instructions)];
}

/**
 * Map a file path to the applicable layer-specific `AGENTS.md` file(s).
 * Returns the paths to ALL matching AGENTS.md files (a file may match multiple layers).
 */
function getAgentsMdFiles(filePath: string): string[] {
  const agentsFiles: string[] = [];
  const normalized = filePath.replace(/\\/g, "/");

  const layerMap: Array<[string, string]> = [
    ["app/", "app/AGENTS.md"],
    ["frontend/views/", "frontend/views/AGENTS.md"],
    ["frontend/stores/", "frontend/stores/AGENTS.md"],
    ["frontend/graphql/sharedDocuments/", "frontend/graphql/sharedDocuments/AGENTS.md"],
    ["frontend/graphql/test/", "frontend/graphql/test/AGENTS.md"],
    ["frontend/graphql/", "frontend/graphql/AGENTS.md"],
    ["frontend/", "frontend/AGENTS.md"],
    ["backend/services/", "backend/services/AGENTS.md"],
    ["backend/graphql/", "backend/graphql/AGENTS.md"],
    ["backend/db/repo/", "backend/db/repo/AGENTS.md"],
    ["backend/db/seeds/", "backend/db/seeds/AGENTS.md"],
    ["backend/db/test/", "backend/db/test/AGENTS.md"],
    ["backend/types/", "backend/types/AGENTS.md"],
    ["backend/", "backend/AGENTS.md"],
    ["scripts/run-test/", "scripts/run-test/AGENTS.md"],
  ];

  // Always include root AGENTS.md
  agentsFiles.push("AGENTS.md");

  for (const [prefix, agentsPath] of layerMap) {
    if (normalized.startsWith(prefix)) {
      agentsFiles.push(agentsPath);
    }
  }

  return [...new Set(agentsFiles)];
}

/**
 * Print the instruction files and AGENTS.md files that apply to the target file.
 * This tells the subagent exactly which rule files to read before fixing.
 */
export function printApplicableRuleFiles(filePath: string): void {
  const instructionFiles = getInstructionFiles(filePath);
  const agentsMdFiles = getAgentsMdFiles(filePath);

  console.log(`${BOLD}━━━ Applicable Rule Files ━━━${NC}`);
  console.log("");

  if (instructionFiles.length > 0) {
    console.log(`${CYAN}Instruction files (read before fixing):${NC}`);
    for (const f of instructionFiles) {
      const exists = existsSync(resolve(PROJECT_ROOT, f));
      const mark = exists ? `${GREEN}✓${NC}` : `${YELLOW}⚠${NC}`;
      console.log(`  ${mark}  ${f}`);
    }
  } else {
    console.log(`${YELLOW}⚠  No applicable instruction files found for this file.${NC}`);
  }

  console.log("");
  console.log(`${CYAN}AGENTS.md files (read before fixing):${NC}`);
  for (const f of agentsMdFiles) {
    const exists = existsSync(resolve(PROJECT_ROOT, f));
    const mark = exists ? `${GREEN}✓${NC}` : `${YELLOW}⚠${NC}`;
    console.log(`  ${mark}  ${f}`);
  }

  console.log("");
  console.log(`${BOLD}Fix-Or-Report Rule:${NC}`);
  console.log(`  • If a rule violation can be fixed within THIS file: fix it.`);
  console.log(`  • If fixing requires modifying ANOTHER file: do NOT modify that file.`);
  console.log(`    Report the cross-file dependency to the orchestrator instead.`);
  console.log("");
  console.log(`${BOLD}Oxlint Fix Patterns (see \`docs/quality/linting-rules.md\` for full details):${NC}`);
  console.log(
    `  • no-unsafe-type-assertion: Use type guards ("value is Type"), instanceof Error, satisfies Partial<T>`
  );
  console.log(`  • no-await-in-loop: Use Promise.all (parallel) or recursive helper/reduce (sequential)`);
  console.log(`  • consistent-function-scoping: Move non-capturing functions to module scope`);
  console.log(`  • no-object-type-as-default-prop: Extract default to module-level const`);
  console.log(`  • no-unsafe-enum-comparison: Wrap with String() or use string literals`);
  console.log(`  • no-shadow: Destructuring rename or _ prefix for unused params`);
  console.log(`  • consistent-return: Use "return undefined" instead of bare "return"`);
  console.log(`  • no-map-spread: Use Object.assign instead of spread in .map()`);
  console.log(`  • no-underscore-dangle: Rename or use bracket notation for external APIs`);
  console.log(`  • NEVER add oxlint-disable comments — fix the root cause`);
  console.log("");
}
