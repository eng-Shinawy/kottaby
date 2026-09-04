/**
 * Auto-bundles custom SQL migrations from `backend/db/migration/` into incremental
 * drizzle migration folders under `backend/drizzle/` so that `bun db migrate`
 * picks them up automatically — without requiring the (policy-disabled) `cleanGenerate`.
 *
 * Strategy (incremental, idempotent):
 *
 *   1. Build a manifest of every `backend/db/migration/*.sql` file (excluding
 *      `1-extensions.sql`, temp files, and `*.sql_ignore`), sorted alphabetically:
 *        [{ file, sha256 }]
 *      The manifest hash = SHA-256 of the JSON-serialized manifest.
 *
 *   2. Compare against the last-applied manifest hash stored in the sidecar file
 *      `backend/drizzle/.custom-migrations.json`. The sidecar records:
 *        { manifestHash, manifest, appliedFolders: string[] }
 *
 *   3. Bootstrap: if the sidecar is missing but a `*_combined_custom_logic` drizzle
 *      folder already exists (the historical baseline produced by `cleanGenerate`),
 *      seed the sidecar with the current manifest hash so the already-applied
 *      combined folder is treated as the baseline. No new folder is generated.
 *
 *   4. If the manifest hash is unchanged → nothing to bundle.
 *
 *   5. If the manifest hash changed → compute the delta (files whose sha256 differs
 *      from the sidecar's recorded manifest — i.e. new or modified files), concatenate
 *      their content with `-- Source: <file>` headers, run `withStatementBreakpoints`,
 *      and write a new drizzle migration folder `<timestamp>_custom_<shorthash>`
 *      containing only the delta SQL. Then update the sidecar.
 *
 *   6. The subsequent `drizzle-orm` migrate call scans `backend/drizzle/`, finds the
 *      new folder (its hash is not yet in `__drizzle_migrations`), and applies it.
 *
 * Why incremental and not regenerate-in-place:
 *   - Regenerating the `combined_custom_logic` folder in place would change its hash
 *     and cause Drizzle to re-run the entire ~5,500-line combined blob. While the
 *     blob is idempotent, re-running it is wasteful and fragile (relies on every
 *     future custom file being idempotent).
 *   - Incremental folders only apply the new/changed SQL, leaving the frozen baseline
 *     untouched.
 *
 * Custom SQL files MUST be idempotent (use `IF NOT EXISTS`, `ON CONFLICT`,
 * `DO $$ ... EXCEPTION WHEN duplicate_object`). The delta folder is applied exactly
 * once by Drizzle, but a file may appear in a later delta if it is modified after
 * being applied — so idempotency is still required for modified files.
 */

import crypto from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { logger } from "@/backend/lib/logger";
import { withStatementBreakpoints } from "@/scripts/dbActions/sqlBreakpoints";

const MIGRATIONS_SRC_DIR = resolve("backend/db/migration");
const DRIZZLE_DIR = resolve("backend/drizzle");
const SIDECAR_PATH = join(DRIZZLE_DIR, ".custom-migrations.json");

/** Files in backend/db/migration/ that are NOT bundled by this auto-bundler. */
const EXCLUDED_FILES = new Set<string>([
  // 1-extensions.sql is bundled into its own dedicated `extensions` drizzle folder
  // by cleanGenerate and is applied via ensureExtensions() during `db push`.
  "1-extensions.sql",
  // SQLite-specific triggers (only applied for SQLite dialect, not PG)
  "3-immutability-triggers-sqlite.sql",
  // Rollback scripts are manual down migrations, not applied automatically
  "rollback-down.sql",
]);

interface ManifestEntry {
  file: string;
  sha256: string;
}

interface Sidecar {
  manifestHash: string;
  manifest: ManifestEntry[];
  appliedFolders: string[];
}

/** Type guard: validates that an unknown value is a valid Sidecar object. */
function isSidecar(value: unknown): value is Sidecar {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return (
    "manifestHash" in value &&
    typeof value.manifestHash === "string" &&
    "manifest" in value &&
    Array.isArray(value.manifest) &&
    value.manifest.every(
      (e): e is ManifestEntry =>
        typeof e === "object" &&
        e !== null &&
        !Array.isArray(e) &&
        "file" in e &&
        typeof e.file === "string" &&
        "sha256" in e &&
        typeof e.sha256 === "string"
    ) &&
    "appliedFolders" in value &&
    Array.isArray(value.appliedFolders) &&
    value.appliedFolders.every((f): f is string => typeof f === "string")
  );
}

/** Returns true for files that should be excluded from custom-migration bundling. */
function isExcluded(filename: string): boolean {
  if (EXCLUDED_FILES.has(filename)) return true;
  // Temp files produced by cleanGenerate and other scratch files.
  if (filename.startsWith("temp_")) return true;
  if (filename.endsWith(".sql_ignore")) return true;
  return false;
}

/** Lists the custom SQL files to bundle, sorted alphabetically. */
function listCustomSqlFiles(): string[] {
  if (!existsSync(MIGRATIONS_SRC_DIR)) return [];
  return readdirSync(MIGRATIONS_SRC_DIR)
    .filter(f => f.endsWith(".sql") && !isExcluded(f))
    .toSorted((a, b) => a.localeCompare(b));
}

/** Builds the manifest: one entry per custom SQL file with its SHA-256. */
function buildManifest(): ManifestEntry[] {
  return listCustomSqlFiles().map(file => ({
    file,
    sha256: crypto
      .createHash("sha256")
      .update(readFileSync(join(MIGRATIONS_SRC_DIR, file), "utf8"))
      .digest("hex"),
  }));
}

/** Computes the manifest hash: SHA-256 of the JSON-serialized manifest. */
function computeManifestHash(manifest: ManifestEntry[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

/** Reads the sidecar file, or null if it does not exist. */
function readSidecar(): Sidecar | null {
  if (!existsSync(SIDECAR_PATH)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(SIDECAR_PATH, "utf8"));
    if (!isSidecar(parsed)) {
      logger.warn("⚠️  .custom-migrations.json sidecar has invalid structure; ignoring it.");
      return null;
    }
    return parsed;
  } catch {
    logger.warn("⚠️  Could not parse .custom-migrations.json sidecar; ignoring it.");
    return null;
  }
}

/** Writes the sidecar file. */
function writeSidecar(sidecar: Sidecar): void {
  writeFileSync(SIDECAR_PATH, `${JSON.stringify(sidecar, null, 2)}\n`);
}

/** Returns the existing `*_combined_custom_logic` drizzle folder name, or null. */
function findCombinedFolder(): string | null {
  if (!existsSync(DRIZZLE_DIR)) return null;
  const folders = readdirSync(DRIZZLE_DIR).filter(f => statSync(join(DRIZZLE_DIR, f)).isDirectory());
  return folders.find(f => f.endsWith("_combined_custom_logic")) ?? null;
}

/**
 * Parses the `-- Source: <file>` headers from a combined migration's `migration.sql`
 * and returns the set of source filenames that were bundled into it. Used during
 * bootstrap to determine which custom files were already applied via the historical
 * combined folder (so files added AFTER the combined folder was generated are
 * correctly treated as a delta rather than silently absorbed into the baseline).
 */
function parseBundledSources(combinedFolder: string): Set<string> {
  const sqlPath = join(DRIZZLE_DIR, combinedFolder, "migration.sql");
  if (!existsSync(sqlPath)) return new Set();
  const content = readFileSync(sqlPath, "utf8");
  const sources = new Set<string>();
  for (const line of content.split("\n")) {
    // Strip the `-- Source:` prefix in JS to avoid a regex with a capture group,
    if (line.startsWith("-- Source:")) {
      sources.add(line.slice("-- Source:".length).trim());
    }
  }
  return sources;
}

/** Returns the manifest entries from the sidecar keyed by filename. */
function indexByFile(manifest: ManifestEntry[]): Map<string, ManifestEntry> {
  return new Map(manifest.map(e => [e.file, e]));
}

/** Computes the delta: files that are new or whose sha256 changed vs the sidecar. */
function computeDelta(current: ManifestEntry[], previous: ManifestEntry[]): ManifestEntry[] {
  const prev = indexByFile(previous);
  return current.filter(entry => {
    const old = prev.get(entry.file);
    return old?.sha256 !== entry.sha256;
  });
}

/**
 * Generates an individual Drizzle migration folder for a single custom SQL file in the delta.
 * Generating separate folders per file preserves transaction boundaries between individual
 * custom SQL files (e.g. enum additions vs data insertions).
 *
 * @param entry The manifest entry for the custom SQL file.
 * @param index The ordinal index within the delta sequence.
 * @param baseMs The base timestamp millisecond value used to generate sequential folder names.
 * @returns The created migration folder name.
 */
function generateFolderForFile(entry: ManifestEntry, index: number, baseMs: number): string {
  const ts = new Date(baseMs + index * 1000).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const fileSlug = entry.file.replace(/\.sql$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
  const folderName = `${ts}_custom_${fileSlug}`;
  const folderPath = join(DRIZZLE_DIR, folderName);
  mkdirSync(folderPath, { recursive: true });

  const rawContent = readFileSync(join(MIGRATIONS_SRC_DIR, entry.file), "utf8");
  const sql = withStatementBreakpoints(`-- Source: ${entry.file}\n${rawContent.trimEnd()}`);
  writeFileSync(join(folderPath, "migration.sql"), `${sql}\n`);
  return folderName;
}

/**
 * Auto-bundles pending custom SQL migrations into incremental drizzle migration folders.
 * Safe to call before every `bun db migrate`. Returns the list of newly generated
 * folder names (empty if nothing was bundled).
 */
export function applyCustomMigrations(): string[] {
  if (!existsSync(DRIZZLE_DIR)) {
    mkdirSync(DRIZZLE_DIR, { recursive: true });
  }

  const currentManifest = buildManifest();
  const currentHash = computeManifestHash(currentManifest);
  let sidecar = readSidecar();

  // Bootstrap: no sidecar yet. If the historical combined folder already exists,
  // build the baseline manifest from the files actually bundled into it (parsed
  // from its `-- Source:` headers) so that files added AFTER the combined folder
  // was generated are correctly treated as a delta. Files not in the combined
  // folder become the first delta and get their own incremental folder.
  if (!sidecar) {
    const combined = findCombinedFolder();
    if (combined) {
      const bundledSources = parseBundledSources(combined);
      const baselineManifest = currentManifest.filter(e => bundledSources.has(e.file));
      const baselineHash = computeManifestHash(baselineManifest);
      sidecar = {
        manifestHash: baselineHash,
        manifest: baselineManifest,
        appliedFolders: [combined],
      };
      writeSidecar(sidecar);
      const unbundledCount = currentManifest.length - baselineManifest.length;
      logger.info(
        `Custom migrations: initialized sidecar from ${combined} baseline (${baselineManifest.length} files bundled, ${unbundledCount} new file(s) will be applied as delta).`
      );
    } else {
      sidecar = { manifestHash: "", manifest: [], appliedFolders: [] };
    }
  }

  if (sidecar.manifestHash === currentHash) {
    logger.info("Custom migrations: no new or changed custom SQL files detected.");
    return [];
  }

  const delta = computeDelta(currentManifest, sidecar.manifest);
  if (delta.length === 0) {
    writeSidecar({ manifestHash: currentHash, manifest: currentManifest, appliedFolders: sidecar.appliedFolders });
    logger.info("Custom migrations: manifest changed (file removed) but no delta to apply.");
    return [];
  }

  const baseMs = Date.now();
  const newFolders: string[] = [];
  for (let index = 0; index < delta.length; index++) {
    const entry = delta[index];
    if (entry) {
      const folderName = generateFolderForFile(entry, index, baseMs);
      newFolders.push(folderName);
    }
  }

  const appliedFolders = [...sidecar.appliedFolders, ...newFolders];
  writeSidecar({ manifestHash: currentHash, manifest: currentManifest, appliedFolders });

  logger.info(`Custom migrations: generated ${newFolders.length} migration folder(s): ${newFolders.join(", ")}`);
  return newFolders;
}
