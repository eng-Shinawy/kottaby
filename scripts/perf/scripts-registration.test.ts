import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Registration tests for the perf tooling. These are pure manifest checks:
 * no database, no servers, no external processes. They pin the package.json
 * perf:* entries to the real entrypoint files on disk, keep the entries
 * adjacent to the existing ops:* tooling block, and pin the .gitignore rule
 * that keeps perf run directories out of version control.
 */

const REPO_ROOT = join(import.meta.dir, "..", "..");
const PACKAGE_JSON_PATH = join(REPO_ROOT, "package.json");
const GITIGNORE_PATH = join(REPO_ROOT, ".gitignore");

const PERF_COMMAND_PREFIX = "bun --env-file=.env.test scripts/perf/";

const PERF_SCRIPT_COMMANDS = {
  "perf:seed": `${PERF_COMMAND_PREFIX}seed-perf-data.ts`,
  "perf:cleanup": `${PERF_COMMAND_PREFIX}cleanup-perf-data.ts`,
  "perf:bench-matching": `${PERF_COMMAND_PREFIX}bench-matching.ts`,
  "perf:verify-indexes": `${PERF_COMMAND_PREFIX}verify-indexes.ts`,
  "perf:analyze-queries": `${PERF_COMMAND_PREFIX}analyze-queries.ts`,
  "perf:load-api": `${PERF_COMMAND_PREFIX}load-api.ts`,
  "perf:load-ws": `${PERF_COMMAND_PREFIX}load-ws.ts`,
} as const;

const PERF_SCRIPT_NAMES = Object.keys(PERF_SCRIPT_COMMANDS);

interface PackageJson {
  scripts: Record<string, string>;
}

function isPackageJson(value: unknown): value is PackageJson {
  if (typeof value !== "object" || value === null || !("scripts" in value)) {
    return false;
  }
  const { scripts } = value;
  return (
    typeof scripts === "object" &&
    scripts !== null &&
    Object.values(scripts).every(command => typeof command === "string")
  );
}

function readRawPackageJson(): string {
  return readFileSync(PACKAGE_JSON_PATH, "utf8");
}

function readPackageJson(): PackageJson {
  const parsed: unknown = JSON.parse(readRawPackageJson());
  if (!isPackageJson(parsed)) {
    throw new Error("package.json does not match the expected manifest shape");
  }
  return parsed;
}

/** Resolves the .ts entrypoint referenced by a perf script command. */
function scriptPathFromCommand(command: string): string {
  const entrypoint = command.split(" ").find(token => token.endsWith(".ts"));
  if (entrypoint === undefined) {
    throw new Error(`Script command does not reference a .ts entrypoint: ${command}`);
  }
  return join(REPO_ROOT, entrypoint);
}

function trimmedScriptLines(raw: string): string[] {
  return raw.split("\n").map(line => line.trim());
}

function lineIndexOfKey(lines: readonly string[], key: string): number {
  return lines.findIndex(line => line.startsWith(`"${key}":`));
}

function countKeyLines(lines: readonly string[], key: string): number {
  return lines.filter(line => line.startsWith(`"${key}":`)).length;
}

/**
 * Detects manifest drift: a perf entry that is missing, bound to the wrong
 * command, or declared more than once (JSON.parse silently keeps the last
 * duplicate key, so duplicates need the raw-line scan).
 */
function collectPerfRegistrationDefects(raw: string): string[] {
  const defects: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return ["package.json does not parse as JSON"];
  }
  if (!isPackageJson(parsed)) {
    return ["package.json does not match the expected manifest shape"];
  }
  const lines = trimmedScriptLines(raw);
  for (const [name, command] of Object.entries(PERF_SCRIPT_COMMANDS)) {
    if (parsed.scripts[name] !== command) {
      defects.push(`${name} is missing or does not run its registered entrypoint command`);
    }
    if (countKeyLines(lines, name) !== 1) {
      defects.push(`${name} must be declared exactly once in the scripts block`);
    }
  }
  return defects;
}

describe("perf script registration (package.json)", () => {
  it("registers every perf tool with its exact entrypoint command", () => {
    const { scripts } = readPackageJson();
    for (const [name, command] of Object.entries(PERF_SCRIPT_COMMANDS)) {
      expect(scripts[name]).toBe(command);
    }
  });

  it("pins exactly seven perf entries, each in the env-file test-database invocation shape", () => {
    const { scripts } = readPackageJson();
    const perfEntries = Object.entries(scripts).filter(([name]) => name.startsWith("perf:"));
    expect(perfEntries).toHaveLength(PERF_SCRIPT_NAMES.length);
    for (const [, command] of perfEntries) {
      expect(command.startsWith(PERF_COMMAND_PREFIX)).toBe(true);
    }
  });

  it("points every perf command at a real entrypoint file on disk", () => {
    for (const command of Object.values(PERF_SCRIPT_COMMANDS)) {
      expect(existsSync(scriptPathFromCommand(command))).toBe(true);
    }
  });

  it("places the perf block immediately after the ops tooling block, before the ws entry", () => {
    const lines = trimmedScriptLines(readRawPackageJson());
    const restoreVerifyIndex = lineIndexOfKey(lines, "ops:db-restore-verify");
    expect(restoreVerifyIndex).toBeGreaterThan(-1);
    let expectedLine = restoreVerifyIndex + 1;
    for (const name of PERF_SCRIPT_NAMES) {
      expect(lineIndexOfKey(lines, name)).toBe(expectedLine);
      expectedLine += 1;
    }
    expect(lineIndexOfKey(lines, "ws")).toBe(expectedLine);
  });

  it("declares each perf script key exactly once", () => {
    const lines = trimmedScriptLines(readRawPackageJson());
    for (const name of PERF_SCRIPT_NAMES) {
      expect(countKeyLines(lines, name)).toBe(1);
    }
  });

  it("reports no registration defects for the live manifest", () => {
    expect(collectPerfRegistrationDefects(readRawPackageJson())).toEqual([]);
  });

  it("keeps perf commands repo-relative and free of embedded credentials", () => {
    for (const command of Object.values(PERF_SCRIPT_COMMANDS)) {
      expect(command.startsWith(PERF_COMMAND_PREFIX)).toBe(true);
      expect(command).not.toContain("://");
      expect(command).not.toContain("/home/");
      expect(command).not.toContain("~");
      expect(command).not.toMatch(/password|secret|token|credential/i);
    }
  });
});

function fixtureWithoutKey(source: string, key: string): string {
  return source
    .split("\n")
    .filter(line => !line.trim().startsWith(`"${key}":`))
    .join("\n");
}

function fixtureWithDuplicatedKey(source: string, key: string): string {
  const lines = source.split("\n");
  const keyLineIndex = lines.findIndex(line => line.trim().startsWith(`"${key}":`));
  const mutated = [...lines];
  mutated.splice(keyLineIndex + 1, 0, lines[keyLineIndex] ?? "");
  return mutated.join("\n");
}

function fixtureWithReindentedPerfBlock(source: string): string {
  return source
    .split("\n")
    .map(line => (line.trim().startsWith('"perf:') ? `  ${line}` : line))
    .join("\n");
}

describe("perf registration defect detection (mutated manifest fixtures)", () => {
  it("detects a missing perf entry", () => {
    const defects = collectPerfRegistrationDefects(fixtureWithoutKey(readRawPackageJson(), "perf:seed"));
    expect(defects.some(defect => defect.includes("perf:seed"))).toBe(true);
  });

  it("detects a command mutated away from its registered entrypoint", () => {
    const mutated = readRawPackageJson().replaceAll("seed-perf-data.ts", "seed.ts");
    const defects = collectPerfRegistrationDefects(mutated);
    expect(defects.some(defect => defect.includes("perf:seed"))).toBe(true);
  });

  it("detects a duplicated script key even though JSON.parse keeps the last value", () => {
    const defects = collectPerfRegistrationDefects(fixtureWithDuplicatedKey(readRawPackageJson(), "perf:cleanup"));
    expect(defects.some(defect => defect.includes("perf:cleanup"))).toBe(true);
  });

  it("tolerates indentation drift without reporting defects", () => {
    expect(collectPerfRegistrationDefects(fixtureWithReindentedPerfBlock(readRawPackageJson()))).toEqual([]);
  });

  it("refuses a manifest that no longer parses as JSON", () => {
    expect(collectPerfRegistrationDefects("{ not json")).toEqual(["package.json does not parse as JSON"]);
  });

  it("refuses a manifest without a scripts object", () => {
    expect(collectPerfRegistrationDefects('{"name": "kottaby"}')).toEqual([
      "package.json does not match the expected manifest shape",
    ]);
  });
});

describe("perf artifact exclusion (.gitignore)", () => {
  it("ignores the logs/perf/ run-directory root", () => {
    const rules = readFileSync(GITIGNORE_PATH, "utf8")
      .split("\n")
      .map(line => line.trim());
    expect(rules).toContain("logs/perf/");
  });
});
