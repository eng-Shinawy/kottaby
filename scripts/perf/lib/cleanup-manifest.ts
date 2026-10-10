/**
 * Manifest discovery, selection, and validation for the performance-data
 * cleanup tool. The seed manifest is the cleanup's ONLY write-scope
 * contract: every run directory under `logs/perf/` holding a
 * `seed-manifest.json` is a candidate, `--last` selects the newest and
 * `--run <id>` the newest manifest for that run id.
 *
 * A selected manifest is validated before any database work — a manifest
 * whose prefix does not match its run id, or whose table list deviates from
 * the FK-safe deletion order, is refused rather than trusted. Unreadable
 * (corrupt) manifests are skipped while scanning for a specific run but
 * surface as an actionable error when they are the newest one.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { MANIFEST_FILENAME } from "@/scripts/perf/lib/seed-manifest-file";
import { buildSeedPrefix } from "@/scripts/perf/lib/seed-random";
import { RUN_ID_PATTERN, SEED_MANIFEST_TABLES } from "@/scripts/perf/lib/seed-shapes";

/** Root directory the real io scans for seed manifests. */
export const PERF_LOGS_ROOT = resolve(import.meta.dir, "..", "..", "..", "logs", "perf");

/** Operator label for the manifests root used in error messages. */
const PERF_LOGS_LABEL = "logs/perf";

/** Actionable operator error (missing, unreadable, or invalid manifest) — usage-class exit. */
export class CleanupManifestError extends Error {}

/** One discovered manifest file: its location plus the parsed body (or the read failure). */
export interface RawCleanupManifestEntry {
  readonly runDirName: string;
  readonly manifestPath: string;
  readonly body: unknown;
  readonly readError: string | null;
}

/** The validated cleanup plan a manifest reduces to. */
export interface CleanupManifestPlan {
  readonly runId: string;
  readonly prefix: string;
  readonly tables: typeof SEED_MANIFEST_TABLES;
}

const RUN_DIR_NAME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{1,4})?_[a-z0-9][a-z0-9-]{0,48}$/;
const RUN_DIR_STAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})(?:-(\d{1,4}))?_/;

interface RunDirectorySortKey {
  readonly stamp: string;
  readonly seq: number;
}

/** Internal scan record carrying the ordering key. */
interface ScannedManifestEntry extends RawCleanupManifestEntry {
  readonly sortKey: RunDirectorySortKey;
}

/** Runtime guard over a parsed manifest body (never a blind cast). */
function isCleanupManifestValue(value: unknown): value is { runId: string; prefix: string; tables: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "runId" in value &&
    typeof value.runId === "string" &&
    "prefix" in value &&
    typeof value.prefix === "string" &&
    "tables" in value &&
    Array.isArray(value.tables)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Parses a run-directory name into its ordering key, or null when the name is not a run directory. */
function parseRunDirectorySortKey(name: string): RunDirectorySortKey | null {
  if (!RUN_DIR_NAME_PATTERN.test(name)) {
    return null;
  }
  const match = RUN_DIR_STAMP_PATTERN.exec(name);
  if (match === null) {
    return null;
  }
  return { stamp: match[1] ?? "", seq: match[2] === undefined ? 1 : Number(match[2]) };
}

/**
 * Scans a manifests root for seed run directories, returning entries sorted
 * newest first. Directories whose names do not follow the run-directory
 * convention, non-directories, run directories without a manifest, and paths
 * that would resolve outside the root are never candidates.
 */
export function listSeedManifestEntries(logsDir: string): RawCleanupManifestEntry[] {
  let names: string[];
  try {
    names = readdirSync(logsDir);
  } catch {
    return [];
  }
  const root = resolve(logsDir);
  const scanned: ScannedManifestEntry[] = [];
  for (const name of names) {
    const sortKey = parseRunDirectorySortKey(name);
    if (sortKey === null) {
      continue;
    }
    const runDir = resolve(join(root, name));
    if (!runDir.startsWith(root + sep)) {
      continue;
    }
    if (!isDirectory(runDir)) {
      continue;
    }
    const manifestPath = join(runDir, MANIFEST_FILENAME);
    if (!existsSync(manifestPath)) {
      continue;
    }
    let body: unknown = null;
    let readError: string | null = null;
    try {
      body = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      readError = errorMessage(error);
    }
    scanned.push({ runDirName: name, manifestPath, body, readError, sortKey });
  }
  scanned.sort((left, right) => {
    if (left.sortKey.stamp !== right.sortKey.stamp) {
      return left.sortKey.stamp < right.sortKey.stamp ? 1 : -1;
    }
    return right.sortKey.seq - left.sortKey.seq;
  });
  return scanned;
}

/** Unique run ids of every readable, shape-valid manifest, newest first. */
function readableRunIds(entries: readonly RawCleanupManifestEntry[]): string[] {
  const runIds: string[] = [];
  for (const entry of entries) {
    if (entry.readError === null && isCleanupManifestValue(entry.body) && !runIds.includes(entry.body.runId)) {
      runIds.push(entry.body.runId);
    }
  }
  return runIds;
}

/**
 * Selects the manifest entry to clean: the newest one for `--last`, or the
 * newest readable manifest whose run id matches for `--run <id>`. Throws an
 * actionable operator error when nothing can be selected.
 */
export function selectCleanupManifestEntry(
  entries: readonly RawCleanupManifestEntry[],
  selector: { readonly runId: string | null; readonly last: boolean }
): RawCleanupManifestEntry {
  if (selector.last) {
    if (entries.length === 0) {
      throw new CleanupManifestError(`no seed manifests found under ${PERF_LOGS_LABEL} — nothing to clean up`);
    }
    const newest = entries[0];
    if (newest.readError !== null) {
      throw new CleanupManifestError(
        [
          `the newest seed manifest (${newest.runDirName}) could not be read: ${newest.readError}`,
          `fix or remove ${newest.manifestPath}, or clean a specific run with --run <id>`,
        ].join("\n")
      );
    }
    return newest;
  }
  const runId = selector.runId;
  if (runId === null) {
    throw new CleanupManifestError("no run selected: pass --run <id> or --last");
  }
  let unreadable = 0;
  for (const entry of entries) {
    if (entry.readError !== null) {
      unreadable += 1;
      continue;
    }
    if (isCleanupManifestValue(entry.body) && entry.body.runId === runId) {
      return entry;
    }
  }
  const available = readableRunIds(entries);
  const lines = [
    `no seed manifest found for run "${runId}" under ${PERF_LOGS_LABEL}`,
    `available runs: ${available.length > 0 ? available.join(", ") : "(none)"}`,
  ];
  if (unreadable > 0) {
    lines.push(`${unreadable} seed manifest(s) could not be read and were skipped`);
  }
  throw new CleanupManifestError(lines.join("\n"));
}

function matchesCanonicalTableOrder(tables: readonly unknown[]): boolean {
  return (
    tables.length === SEED_MANIFEST_TABLES.length &&
    SEED_MANIFEST_TABLES.every((table, index) => tables[index] === table)
  );
}

/**
 * Validates a selected manifest body into a cleanup plan. The prefix must
 * be exactly the run id's seed prefix and the table list exactly the FK-safe
 * deletion order — anything else is a tampered or foreign contract and is
 * refused before any database seam runs.
 */
export function validateCleanupManifest(body: unknown, manifestPath: string): CleanupManifestPlan {
  if (!isCleanupManifestValue(body)) {
    throw new CleanupManifestError(
      `the seed manifest at ${manifestPath} is malformed: expected runId, prefix, and tables fields`
    );
  }
  if (!RUN_ID_PATTERN.test(body.runId)) {
    throw new CleanupManifestError(
      `the seed manifest at ${manifestPath} records an invalid run id "${body.runId}" (expected 8 lowercase hex characters)`
    );
  }
  const expectedPrefix = buildSeedPrefix(body.runId);
  if (body.prefix !== expectedPrefix) {
    throw new CleanupManifestError(
      `the seed manifest at ${manifestPath} records prefix "${body.prefix}", which does not match its run id ` +
        `"${body.runId}" (expected "${expectedPrefix}") — refusing to clean an untrusted write scope`
    );
  }
  if (!matchesCanonicalTableOrder(body.tables)) {
    throw new CleanupManifestError(
      `the seed manifest at ${manifestPath} lists the tables [${body.tables.map(String).join(", ")}] — ` +
        `expected the FK-safe deletion order [${SEED_MANIFEST_TABLES.join(", ")}]`
    );
  }
  return { runId: body.runId, prefix: body.prefix, tables: SEED_MANIFEST_TABLES };
}
