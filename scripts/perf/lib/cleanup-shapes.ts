/**
 * Shape contracts for the manifest-driven performance-data cleanup tool:
 * the table-name vocabulary (the seed manifest's FK-safe deletion order),
 * the database seam the cleanup orchestrator drives, and the per-table
 * result shape the operator summary reports.
 *
 * Everything here is pure — the manifest discovery/validation module owns
 * the filesystem, and the Drizzle adapter lives in its own module.
 */

import type { SEED_MANIFEST_TABLES } from "@/scripts/perf/lib/seed-shapes";

/** One table a cleanup pass can delete from or re-probe (the nine seeded tables). */
export type CleanupTableName = (typeof SEED_MANIFEST_TABLES)[number];

/** Per-table count reported for deletions and residue re-probes. */
export interface CleanupTableResult {
  readonly table: CleanupTableName;
  readonly count: number;
}

/**
 * The database seam the cleanup orchestrator drives. Both operations are
 * strictly prefix-scoped: the caller passes the escaped LIKE pattern built
 * from the manifest prefix, and the adapter may only touch rows matching it.
 */
export interface CleanupDatabase {
  deleteRows(table: CleanupTableName, pattern: string): Promise<number>;
  countResidue(table: CleanupTableName, pattern: string): Promise<number>;
}
