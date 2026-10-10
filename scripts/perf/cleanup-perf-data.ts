/**
 * Manifest-driven cleanup for performance seed data.
 *
 * One invocation hard-deletes every row a seed run created: the run is
 * selected by `--run <id>` (a specific seed run) or `--last` (the newest
 * manifest under `logs/perf/`), its manifest is the ONLY write-scope
 * contract, and the rows are deleted in the manifest's FK-safe order
 * (children first, `users` last). After the deletes, every table is
 * re-probed for rows still matching the run prefix and the run only
 * succeeds on zero residue.
 *
 * Safety contract, in order:
 *  1. The destructive-target guard runs FIRST: the resolved DATABASE_URL
 *     must name the test database or the process refuses (exit 2) before
 *     any database client is constructed. The client module is imported
 *     dynamically only after the guard has allowed the run.
 *  2. The selected manifest is validated before any database work — the
 *     prefix must match the run id and the table list must be exactly the
 *     FK-safe deletion order, so a tampered or foreign manifest can never
 *     broaden the delete scope.
 *  3. Deletes are prefix-scoped and idempotent: re-running the same command
 *     after an interrupted pass (or after a completed one) deletes whatever
 *     still matches and probes for zero again.
 *
 * Exit codes: 0 = cleaned with zero residue, 2 = usage refusal / guard
 * refusal / unusable manifest, 1 = residue after cleanup or runtime failure
 * (partial deletes stay discoverable by the prefix; re-running completes).
 */

import { type CleanupCliOptions, isCleanupCliUsageError, parseCleanupCli } from "@/scripts/perf/lib/cleanup-cli";
import { DrizzleCleanupDatabase } from "@/scripts/perf/lib/cleanup-drizzle";
import {
  CleanupManifestError,
  type CleanupManifestPlan,
  listSeedManifestEntries,
  PERF_LOGS_ROOT,
  type RawCleanupManifestEntry,
  selectCleanupManifestEntry,
  validateCleanupManifest,
} from "@/scripts/perf/lib/cleanup-manifest";
import type { CleanupDatabase, CleanupTableName, CleanupTableResult } from "@/scripts/perf/lib/cleanup-shapes";
import { assertTestDatabaseTarget, type DatabaseTargetOk } from "@/scripts/perf/lib/db-target-guard";
import { buildPrefixedLikePattern } from "@/scripts/perf/lib/seed-shapes";

const SCRIPT_LABEL = "perf:cleanup";
const EXIT_USAGE = 2;
const EXIT_FAILURE = 1;

/** Environment + effectful seams the cleanup run orchestrates over. */
export interface CleanupIo {
  env(): { databaseUrl: string };
  assertTarget(databaseUrl: string, opts: { forceFlag: boolean }): DatabaseTargetOk;
  connectDatabase(): Promise<CleanupDatabase>;
  closeDatabase(): Promise<void>;
  listManifests(): readonly RawCleanupManifestEntry[];
  log(message: string): void;
}

/** Facts every cleanup outcome carries (the plan only — never the manifest identities). */
export interface CleanupRunFacts {
  readonly plan: CleanupManifestPlan;
  readonly manifestPath: string;
  readonly runDirName: string;
  readonly deleted: readonly CleanupTableResult[];
  readonly residue: readonly CleanupTableResult[];
}

/** Terminal outcome of a cleanup run: zero residue, or residue that stays reported. */
export type CleanupRunOutcome = ({ readonly status: "clean" } | { readonly status: "residue" }) & CleanupRunFacts;

/**
 * Raised when a table delete fails mid-order. The message never masks the
 * partial deletion: it names the failed table, the tables already cleaned,
 * and the tables that remain.
 */
export class CleanupDeleteError extends Error {
  constructor(
    failedTable: CleanupTableName,
    failedIndex: number,
    plan: CleanupManifestPlan,
    deleted: readonly CleanupTableResult[],
    cause: unknown
  ) {
    const cleaned = deleted.map(result => result.table).join(", ");
    const remaining = plan.tables.slice(failedIndex + 1);
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      [
        `cleanup failed while deleting "${failedTable}": ${causeMessage}`,
        `tables already cleaned: ${cleaned.length > 0 ? cleaned : "(none)"}`,
        `tables remaining: ${remaining.join(", ")}`,
        `partial rows stay discoverable by the prefix "${plan.prefix}" — re-run the same cleanup command to complete`,
      ].join("\n")
    );
    this.name = "CleanupDeleteError";
  }
}

/**
 * Deletes every table in the manifest's FK-safe order. The recursive drain
 * keeps the deletes strictly sequential (the order is load-bearing) without
 * an await inside a loop body; a failure mid-order surfaces as a
 * `CleanupDeleteError` carrying the partial-deletion facts.
 */
async function deleteInManifestOrder(
  database: CleanupDatabase,
  plan: CleanupManifestPlan,
  pattern: string
): Promise<readonly CleanupTableResult[]> {
  const step = async (
    index: number,
    deleted: readonly CleanupTableResult[]
  ): Promise<readonly CleanupTableResult[]> => {
    if (index >= plan.tables.length) {
      return deleted;
    }
    const table = plan.tables[index];
    let count: number;
    try {
      count = await database.deleteRows(table, pattern);
    } catch (error) {
      throw new CleanupDeleteError(table, index, plan, deleted, error);
    }
    return step(index + 1, [...deleted, { table, count }]);
  };
  return step(0, []);
}

/** Re-probes every manifest table for rows still matching the run prefix. */
async function probeResidue(
  database: CleanupDatabase,
  plan: CleanupManifestPlan,
  pattern: string
): Promise<readonly CleanupTableResult[]> {
  return Promise.all(plan.tables.map(async table => ({ table, count: await database.countResidue(table, pattern) })));
}

/** Prints the operator-facing cleanup summary (run identity, counts, residue verdict). */
function logCleanupSummary(io: CleanupIo, dbName: string, outcome: CleanupRunOutcome): void {
  io.log(`${SCRIPT_LABEL}: run ${outcome.plan.runId} cleaned against ${dbName}`);
  io.log(`${SCRIPT_LABEL}: manifest ${outcome.manifestPath}`);
  io.log(`${SCRIPT_LABEL}: prefix ${outcome.plan.prefix}`);
  const deletedSummary = outcome.deleted.map(result => `${result.table}=${result.count}`).join(" ");
  io.log(`${SCRIPT_LABEL}: deleted ${deletedSummary}`);
  if (outcome.status === "clean") {
    io.log(`${SCRIPT_LABEL}: residue re-probe: 0 rows across ${outcome.residue.length} tables — zero residue`);
    return;
  }
  io.log(`${SCRIPT_LABEL}: residue re-probe still matches rows after cleanup:`);
  for (const result of outcome.residue.filter(entry => entry.count > 0)) {
    io.log(`${SCRIPT_LABEL}:   ${result.table}: ${result.count} row(s) still match the prefix`);
  }
}

/**
 * Drives one complete cleanup run. The guard is the first effectful call;
 * the manifest is selected and validated before the database connection,
 * and the connection is closed on every path.
 */
export async function runCleanupRun(options: CleanupCliOptions, io: CleanupIo): Promise<CleanupRunOutcome> {
  const target = io.assertTarget(io.env().databaseUrl, { forceFlag: options.forceProdShapedTarget });
  const entry = selectCleanupManifestEntry(io.listManifests(), options);
  const plan = validateCleanupManifest(entry.body, entry.manifestPath);
  const pattern = buildPrefixedLikePattern(plan.prefix);
  const database = await io.connectDatabase();
  try {
    const deleted = await deleteInManifestOrder(database, plan, pattern);
    const residue = await probeResidue(database, plan, pattern);
    const outcome: CleanupRunOutcome = {
      status: residue.every(result => result.count === 0) ? "clean" : "residue",
      plan,
      manifestPath: entry.manifestPath,
      runDirName: entry.runDirName,
      deleted,
      residue,
    };
    logCleanupSummary(io, target.dbName, outcome);
    return outcome;
  } finally {
    await io.closeDatabase();
  }
}

/** Wires the real seams: the guard, the lazily imported database client, and the manifest scan. */
function createRealIo(): CleanupIo {
  return {
    env: () => ({ databaseUrl: process.env.DATABASE_URL ?? "" }),
    assertTarget: (databaseUrl, opts) => assertTestDatabaseTarget(databaseUrl, opts),
    connectDatabase: async () => {
      const { db } = await import("@/backend/db/client");
      return new DrizzleCleanupDatabase(db);
    },
    closeDatabase: async () => {
      const { closePool } = await import("@/backend/db/client");
      await closePool();
    },
    listManifests: () => listSeedManifestEntries(PERF_LOGS_ROOT),
    log: message => console.log(message),
  };
}

async function main(): Promise<void> {
  const parsed = parseCleanupCli(process.argv.slice(2));
  if (isCleanupCliUsageError(parsed)) {
    console.error(parsed.message);
    process.exit(EXIT_USAGE);
  }
  try {
    const outcome = await runCleanupRun(parsed, createRealIo());
    if (outcome.status === "residue") {
      process.exit(EXIT_FAILURE);
    }
  } catch (error) {
    if (error instanceof CleanupManifestError) {
      console.error(error.message);
      process.exit(EXIT_USAGE);
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(EXIT_FAILURE);
  }
}

if (import.meta.main) {
  void main();
}
