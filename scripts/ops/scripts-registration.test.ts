import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Registration tests for the ops database tooling. These are pure manifest
 * checks: no database, no external processes. They pin the package.json
 * script entries to the real entrypoint files on disk and keep the entries
 * adjacent to the existing ops:* block, plus the .gitignore rule that keeps
 * backup run directories out of version control.
 */

const REPO_ROOT = join(import.meta.dir, "..", "..");
const PACKAGE_JSON_PATH = join(REPO_ROOT, "package.json");
const GITIGNORE_PATH = join(REPO_ROOT, ".gitignore");

const BACKUP_COMMAND = "bun run scripts/ops/backup-database.ts";
const RESTORE_VERIFY_COMMAND = "bun run scripts/ops/restore-verify.ts";
const OPS_COMMAND_PREFIX = "bun run scripts/ops/";

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

function readPackageJson(): PackageJson {
  const parsed: unknown = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8"));
  if (!isPackageJson(parsed)) {
    throw new Error("package.json does not match the expected manifest shape");
  }
  return parsed;
}

function readGitignore(): string {
  return readFileSync(GITIGNORE_PATH, "utf8");
}

/** Resolves the .ts entrypoint referenced by a `bun run <path>` script command. */
function scriptPathFromCommand(command: string): string {
  const entrypoint = command.split(" ").find(token => token.endsWith(".ts"));
  if (entrypoint === undefined) {
    throw new Error(`Script command does not reference a .ts entrypoint: ${command}`);
  }
  return join(REPO_ROOT, entrypoint);
}

describe("ops script registration (package.json)", () => {
  it("registers ops:db-backup pointing at the existing backup entrypoint", () => {
    const { scripts } = readPackageJson();
    expect(scripts["ops:db-backup"]).toBe(BACKUP_COMMAND);
    expect(existsSync(scriptPathFromCommand(BACKUP_COMMAND))).toBe(true);
  });

  it("registers ops:db-restore-verify pointing at the existing restore-verify entrypoint", () => {
    const { scripts } = readPackageJson();
    expect(scripts["ops:db-restore-verify"]).toBe(RESTORE_VERIFY_COMMAND);
    expect(existsSync(scriptPathFromCommand(RESTORE_VERIFY_COMMAND))).toBe(true);
  });

  it("keeps every ops:* entry in the sibling bun run scripts/ops/ invocation shape", () => {
    const { scripts } = readPackageJson();
    const opsEntries = Object.entries(scripts).filter(([name]) => name.startsWith("ops:"));
    expect(opsEntries.length).toBeGreaterThanOrEqual(4);
    for (const [, command] of opsEntries) {
      expect(command.startsWith(OPS_COMMAND_PREFIX)).toBe(true);
    }
  });

  it("places the db tooling entries immediately after the existing ops:* block", () => {
    const raw = readFileSync(PACKAGE_JSON_PATH, "utf8");
    const lines = raw.split("\n").map(line => line.trim());
    const indexOf = (needle: string): number => lines.findIndex(line => line.startsWith(`"${needle}"`));
    const sweepIndex = indexOf("ops:sweep-link-requests");
    const remindIndex = indexOf("ops:remind-link-requests");
    const backupIndex = indexOf("ops:db-backup");
    const restoreIndex = indexOf("ops:db-restore-verify");
    const wsIndex = indexOf("ws");

    expect(backupIndex).toBe(remindIndex + 1);
    expect(restoreIndex).toBe(backupIndex + 1);
    expect(wsIndex).toBe(restoreIndex + 1);
    expect(sweepIndex).toBeLessThan(remindIndex);
  });
});

describe("backup artifact exclusion (.gitignore)", () => {
  it("ignores the /backups/ run-directory root", () => {
    const rules = readGitignore()
      .split("\n")
      .map(line => line.trim());
    expect(rules).toContain("/backups/");
  });
});
