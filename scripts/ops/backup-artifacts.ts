/**
 * Backup run artifacts: the run-directory naming rules, the manifest data
 * contract (and its validator), the artifact/integrity hashing helpers, and
 * the staging-directory lifecycle. Everything here is deterministic and
 * side-effect-confined to the backup output directory.
 */

import { createHash } from "node:crypto";
import {
  chmodSync,
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, sep } from "node:path";
import { errorMessage } from "@/scripts/ops/backup-toolchain";

export const ARTIFACT_FILE_NAME = "dump.pgc";
export const MANIFEST_FILE_NAME = "manifest.json";
export const STAGING_DIR_PREFIX = "tmp-";

/**
 * Sentinel journalHash for "no migrations": recorded in the manifest when the
 * Drizzle folder contains no migration folders, and yielded by the OR-MIG
 * query when a restored database tracks no applied migrations. Sixty-four
 * zero nibbles can never be the SHA-256 of non-empty content, so it cannot
 * collide with a real trailing-migration hash. (The former `"none"` sentinel
 * violated the manifest's 64-hex contract; this is the ONE sentinel, defined
 * here and imported by the restore family.)
 */
export const MIGRATIONS_ABSENT_HASH = "0".repeat(64);

/** Machine-readable provenance + integrity record for one backup run. */
export interface BackupManifest {
  tool: "ops:db-backup";
  toolVersion: string;
  postgresServerVersion: string;
  pgDumpVersion: string;
  database: string;
  startedAtUtc: string;
  finishedAtUtc: string;
  artifactFile: string;
  artifactBytes: number;
  sha256: string;
  journalHash: string;
}

export function buildBackupManifest(input: Omit<BackupManifest, "tool">): BackupManifest {
  return { tool: "ops:db-backup", ...input };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Contract problems of a parsed manifest object (empty array = valid). */
export function manifestProblems(manifest: unknown): string[] {
  if (!isRecord(manifest)) {
    return ["manifest is not an object"];
  }

  const problems: string[] = [];
  const requiredStringFields = [
    "tool",
    "toolVersion",
    "postgresServerVersion",
    "pgDumpVersion",
    "database",
    "startedAtUtc",
    "finishedAtUtc",
    "artifactFile",
    "sha256",
    "journalHash",
  ] as const;

  for (const field of requiredStringFields) {
    const value = manifest[field];
    if (typeof value !== "string" || value.length === 0) {
      problems.push(`field ${field} must be a non-empty string`);
    }
  }
  if (manifest.tool !== undefined && manifest.tool !== "ops:db-backup") {
    problems.push(`field tool must be "ops:db-backup"`);
  }
  const bytes = manifest.artifactBytes;
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
    problems.push("field artifactBytes must be a positive integer");
  }
  for (const field of ["sha256", "journalHash"] as const) {
    const value = manifest[field];
    if (typeof value === "string" && !/^[0-9a-f]{64}$/.test(value)) {
      problems.push(`field ${field} must be 64 lowercase hex characters`);
    }
  }
  for (const field of ["startedAtUtc", "finishedAtUtc"] as const) {
    const value = manifest[field];
    if (typeof value === "string" && Number.isNaN(Date.parse(value))) {
      problems.push(`field ${field} must be a parseable timestamp`);
    }
  }
  return problems;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** UTC timestamp in the `YYYYmmddTHHMMSSZ` run-directory format. */
export function utcStamp(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}` +
    `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`
  );
}

/** SHA-256 of a file, streamed (no whole-file buffering). */
export async function sha256File(filePath: string): Promise<string> {
  const hasher = createHash("sha256");
  const stream = Bun.file(filePath).stream();
  for await (const chunk of stream) {
    hasher.update(chunk);
  }
  return hasher.digest("hex");
}

/**
 * The EXPECTED trailing `__drizzle_migrations.hash` for the Drizzle folder —
 * derived exactly as drizzle-orm's migrator derives it when applying
 * migrations (node_modules/drizzle-orm/migrator.cjs, `readMigrationFiles`):
 *
 *  1. every direct subdirectory of `drizzleDir` that contains a
 *     `migration.sql` file is a migration (the installed drizzle-orm does NOT
 *     read `meta/_journal.json` — it refuses that legacy layout — so a
 *     whole-journal aggregate was structurally unable to match any stored
 *     row);
 *  2. migrations are ordered by folder name (`localeCompare`);
 *  3. each applied migration's stored `hash` is the SHA-256 of the FULL raw
 *     content of its `migration.sql`.
 *
 * The migrator inserts one row per applied migration, in application order,
 * into a table with a SERIAL `id`, so the trailing row (`ORDER BY id DESC
 * LIMIT 1`) carries the hash of the LAST migration folder's `migration.sql`.
 * This function therefore returns exactly that value.
 *
 * A Drizzle folder with no migrations yields {@link MIGRATIONS_ABSENT_HASH}
 * (drizzle writes no hash rows in that case).
 */
export function computeJournalHash(drizzleDir: string): string {
  let dirents: Dirent[];
  try {
    dirents = readdirSync(drizzleDir, { withFileTypes: true });
  } catch {
    throw new Error(`migration journal directory not found: ${drizzleDir}`);
  }

  const migrationFolderNames = dirents
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .toSorted((a, b) => a.localeCompare(b));
  for (const name of migrationFolderNames.toReversed()) {
    const migrationSqlPath = join(drizzleDir, name, "migration.sql");
    if (!existsSync(migrationSqlPath)) {
      continue;
    }
    return createHash("sha256").update(readFileSync(migrationSqlPath)).digest("hex");
  }
  return MIGRATIONS_ABSENT_HASH;
}

/** Staging directories left behind by crashed runs (reported, never deleted). */
export function listLeftoverStagingDirs(outDir: string): string[] {
  return readdirSync(outDir)
    .filter(name => name.startsWith(STAGING_DIR_PREFIX))
    .toSorted((a, b) => a.localeCompare(b));
}

/**
 * First available directory name derived from `baseName`: `baseName`, then
 * `baseName-2`, `baseName-3`, … — deterministic, never overwrites.
 */
export function nextAvailableRunDirName(outDir: string, baseName: string): string {
  if (!existsSync(join(outDir, baseName))) {
    return baseName;
  }
  let n = 2;
  while (existsSync(join(outDir, `${baseName}-${n}`))) {
    n += 1;
  }
  return `${baseName}-${n}`;
}

/** True when the output directory is outside the repo (or the repo root itself). */
export function isLikelyNonDisposable(outDir: string, repoRoot: string): boolean {
  return outDir === repoRoot || !outDir.startsWith(`${repoRoot}${sep}`);
}

/**
 * System directories a backup output must NEVER live in (nor under). Writing
 * pg_dump artifacts into `/etc`, `/usr`, `/boot`, `/proc`, `/sys`, `/dev`,
 * `/var/run` (or the filesystem root itself) is never a disposable backup
 * location, so the backup tool REFUSES these outright; merely-unusual paths
 * outside this list only draw the non-disposable warning.
 */
const SYSTEM_OUT_DIRS = ["/etc", "/usr", "/boot", "/proc", "/sys", "/dev", "/var/run"] as const;

/** True when `outDir` is the filesystem root, a system directory, or inside one. */
export function isSystemOutDir(outDir: string): boolean {
  if (outDir === "/") {
    return true;
  }
  return SYSTEM_OUT_DIRS.some(systemDir => outDir === systemDir || outDir.startsWith(`${systemDir}/`));
}

/** True when `path` exists in ANY form — including a symlink, even a dangling one. */
function existsInAnyForm(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates the staging directory `tmp-<pid>-<ts>` (first collision-free
 * name) with a pre-created empty artifact file, so a failed dump always
 * leaves inspectable evidence and pg_dump never invents file permissions.
 *
 * The collision probe does NOT follow symlinks: an entry that exists in any
 * form — including a symlink, even a dangling one — takes the name, and the
 * run falls back to the `-2` suffix rather than creating (or writing)
 * through a pre-existing link. After the mkdir, the created directory is
 * resolved to its REAL path and must live inside the resolved `outDir`
 * before any artifact byte is written (a name swapped for a symlink between
 * probe and mkdir, or an out-dir reached through links, would otherwise
 * steer the dump write outside the operator-chosen directory); a violation
 * preserves the escaped (still empty) directory as `<stamp>_FAILED` and
 * throws, which the caller maps to the failed-run path (exit 1).
 */
export function createStagingDir(outDir: string, pid: number, stamp: string): string {
  const baseName = `${STAGING_DIR_PREFIX}${pid}-${stamp}`;
  let candidateName = baseName;
  let suffix = 2;
  while (existsInAnyForm(join(outDir, candidateName))) {
    candidateName = `${baseName}-${suffix}`;
    suffix += 1;
  }
  const stagingDir = join(outDir, candidateName);
  mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
  const outDirReal = realpathSync(outDir);
  const stagingReal = realpathSync(stagingDir);
  if (stagingReal !== outDirReal && !stagingReal.startsWith(`${outDirReal}${sep}`)) {
    // Containment violation: the dump must never be written through whatever
    // swapped in under the staging name. Preserve the (empty) directory as
    // `<stamp>_FAILED` — the same failed-run evidence path as a crashed dump
    // — and abort before any artifact exists.
    const failedPath = join(outDir, nextAvailableRunDirName(outDir, `${stamp}_FAILED`));
    let preserved = false;
    try {
      renameSync(stagingReal, failedPath);
      preserved = true;
    } catch {
      // Cross-device or vanished target: keep the escape visible at its real
      // path in the error message instead.
    }
    throw new Error(
      preserved
        ? `staging directory resolved outside the output directory — preserved as ${failedPath} for inspection`
        : `staging directory resolved outside the output directory (${stagingReal}) — refusing to write the dump`
    );
  }
  writeFileSync(join(stagingDir, ARTIFACT_FILE_NAME), "", { flag: "wx", mode: 0o600 });
  return stagingDir;
}

/**
 * Preserves a failed run's staging directory as `<stamp>_FAILED` — the
 * failed-run evidence path the backup tool's header contract promises
 * ("never silently deleted"). Best-effort by design: the run is already
 * failing, so a rename error is reported, never thrown.
 */
export function preserveFailedStaging(
  outDir: string,
  stamp: string,
  error: (line: string) => void,
  stagingDir: string | null
): void {
  if (stagingDir === null) {
    return;
  }
  try {
    const failedPath = join(outDir, nextAvailableRunDirName(outDir, `${stamp}_FAILED`));
    renameSync(stagingDir, failedPath);
    error(`[backup] failed-run artifacts kept in ${failedPath}`);
  } catch (renameError) {
    error(`[backup] could not preserve the failed staging directory: ${errorMessage(renameError)}`);
  }
}

/** Writes the manifest with 0600 permissions and returns its path. */
export function writeManifestFile(stagingDir: string, manifest: BackupManifest): string {
  const manifestPath = join(stagingDir, MANIFEST_FILE_NAME);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  chmodSync(manifestPath, 0o600);
  return manifestPath;
}
