/**
 * TrackedFixtures — journey-layer fixture registry with verified hard-delete
 * teardown.
 *
 * Journey suites commit their fixtures (they never run inside `runInRollback`,
 * because the services under test own their transactions), so cleanup has to be
 * explicit and provable. Every committed row is registered here as it is
 * created; `afterAll` then calls `cleanup()`, which:
 *
 *  1. hard-deletes every registered row in REVERSE registration order
 *     (role-child rows register after their owning user, so parents are
 *     deleted last — FK-safe by construction), tolerating rows that are
 *     already gone;
 *  2. re-probes the database for EVERY registered row and throws if any still
 *     exists — teardown must leave zero residue, and the check is
 *     load-bearing, not advisory;
 *  3. empties the registry on full success, making a repeated `cleanup()` a
 *     safe no-op (a suite may clean up inside a test and again in `afterAll`).
 *
 * The helper is table-generic: it knows nothing about any particular domain.
 */
import { eq, getColumns, getTableName } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/backend/db";

/** Options for `TrackedFixtures.register`. */
export interface TrackedFixtureRegisterOptions {
  /**
   * Registry key for the tracked row. Defaults to the table's physical name —
   * used only in error/report messages, so `afterAll` failures name the exact
   * rows that leaked.
   */
  readonly key?: string;
  /**
   * Primary-key column override for tables whose key column is not named
   * `id`. Defaults to the table's `id` column.
   */
  readonly idColumn?: PgColumn;
}

/** One registered fixture row: enough metadata to hard-delete and re-probe it. */
export interface TrackedFixtureRecord {
  /** Registry key (defaults to the physical table name). */
  readonly key: string;
  /** Drizzle table the row lives in. */
  readonly table: PgTable;
  /** Primary-key column used for both deletion and existence probing. */
  readonly idColumn: PgColumn;
  /** Primary-key value of the tracked row. */
  readonly id: number;
}

/** Outcome of a successful `cleanup()` sweep. */
export interface TrackedFixtureCleanupReport {
  /** Number of DELETE statements executed (already-absent rows included). */
  readonly deletedCount: number;
  /** Number of registered rows proven absent after teardown. */
  readonly verifiedAbsentCount: number;
  /** Registry keys in the order their DELETE statements ran. */
  readonly deletedKeys: readonly string[];
}

/** Outcome of one full residue sweep. */
interface ResidueSweep {
  /** `key#id` strings for tracked rows that still exist. */
  readonly residue: readonly string[];
}

/** Outcome of one full reverse-order delete sweep. */
interface DeleteSweep {
  /** Registry keys in the order their DELETE statements ran. */
  readonly deletedKeys: readonly string[];
  /** `key#id: message` strings for DELETE statements that threw. */
  readonly failures: readonly string[];
}

/**
 * Resolves the `id` column of a generic table, refusing tables whose `id`
 * column is absent or not a primary key (a non-key column would silently
 * under-delete and let the residue check pass vacuously).
 */
function resolveIdColumn(table: PgTable): PgColumn {
  const columns: Record<string, PgColumn | undefined> = getColumns(table);
  const idColumn = columns.id;
  if (!idColumn) {
    throw new Error(
      `TrackedFixtures: table "${getTableName(table)}" has no "id" column — pass an explicit idColumn option`
    );
  }
  if (!idColumn.primary) {
    throw new Error(
      `TrackedFixtures: "id" of table "${getTableName(table)}" is not a primary key — pass an explicit idColumn option`
    );
  }
  return idColumn;
}

/** Probes whether the row behind `record` currently exists. */
async function fixtureRowExists(record: TrackedFixtureRecord): Promise<boolean> {
  const count = await db.$count(record.table, eq(record.idColumn, record.id));
  return count > 0;
}

/**
 * Recursively sweeps `records` from `index` onward, collecting `key#id`
 * strings for rows that still exist. Recursion (instead of a loop) keeps the
 * sequential probes await-safe under the await-in-loop lint rule.
 */
async function collectResidueNext(
  records: readonly TrackedFixtureRecord[],
  index: number,
  residue: readonly string[]
): Promise<ResidueSweep> {
  if (index >= records.length) {
    return { residue };
  }
  const record = records[index];
  const exists = await fixtureRowExists(record);
  return collectResidueNext(records, index + 1, exists ? [...residue, `${record.key}#${record.id}`] : residue);
}

/**
 * Recursively hard-deletes `records` from `index` onward. Deletion is strictly
 * sequential (one statement must finish before the next starts) so FK-safe
 * ordering holds; recursion keeps that explicit without tripping the
 * await-in-loop lint rule. A throwing DELETE never aborts the sweep — the
 * remaining rows are still deleted so cleanup makes maximal progress, and the
 * failure is reported for the final aggregate error.
 */
async function deleteRecordsNext(
  records: readonly TrackedFixtureRecord[],
  index: number,
  deletedKeys: readonly string[],
  failures: readonly string[]
): Promise<DeleteSweep> {
  if (index >= records.length) {
    return { deletedKeys, failures };
  }
  const record = records[index];
  const nextKeys = [...deletedKeys, record.key];
  try {
    await db.delete(record.table).where(eq(record.idColumn, record.id));
    return deleteRecordsNext(records, index + 1, nextKeys, failures);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return deleteRecordsNext(records, index + 1, nextKeys, [
      ...failures,
      `${record.key}#${record.id} delete failed: ${message}`,
    ]);
  }
}

/**
 * Registry of committed fixture rows for one journey suite.
 *
 * Typical usage inside a journey file:
 *
 * ```ts
 * const tracked = new TrackedFixtures();
 *
 * beforeAll(async () => {
 *   await db.transaction(async tx => {
 *     const actor = await provisionStudentActor(tx, { tracked });
 *     // further fixtures, registering every created row id…
 *   });
 * });
 *
 * afterAll(async () => {
 *   await tracked.cleanup(); // hard-delete + zero-residue existence checks
 * });
 * ```
 */
export class TrackedFixtures {
  private entries: TrackedFixtureRecord[] = [];

  /** Snapshot of every currently registered row (frozen, order-stable). */
  get records(): readonly TrackedFixtureRecord[] {
    return Object.freeze([...this.entries]);
  }

  /** Number of currently registered rows. */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Registers a committed row for tracked teardown.
   *
   * @param table - Drizzle table the row lives in.
   * @param id - primary-key value of the created row (positive safe integer).
   * @param options - registry-key / primary-key-column overrides.
   *
   * Registering the exact same (table, id) pair twice is a no-op. A garbage id
   * (non-integer, non-positive) throws: a bogus id would delete nothing and
   * then pass the post-teardown existence check vacuously, letting a real row
   * leak.
   */
  register(table: PgTable, id: number, options: TrackedFixtureRegisterOptions = {}): void {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error(
        `TrackedFixtures.register: "${id}" is not a positive safe integer row id — refusing to track a value that would silently pass the teardown existence check`
      );
    }
    if (this.entries.some(entry => entry.table === table && entry.id === id)) {
      return;
    }
    const idColumn = options.idColumn ?? resolveIdColumn(table);
    this.entries.push({ key: options.key ?? getTableName(table), table, idColumn, id });
  }

  /**
   * Probes whether the row behind `record` still exists. Works for records
   * captured before a `cleanup()` emptied the registry — the probe is
   * independent of registry state.
   */
  async exists(record: TrackedFixtureRecord): Promise<boolean> {
    return fixtureRowExists(record);
  }

  /**
   * Verifies that every registered row is absent, throwing an error naming
   * each `key#id` that still exists. Called by `cleanup()` after its delete
   * sweep, and independently callable whenever a suite wants to assert
   * zero residue at an arbitrary point.
   */
  async verifyAllAbsent(): Promise<void> {
    const { residue } = await collectResidueNext(this.entries, 0, []);
    if (residue.length > 0) {
      throw new Error(`TrackedFixtures teardown residue — registered rows still exist: ${residue.join(", ")}`);
    }
  }

  /**
   * Hard-deletes every registered row in reverse registration order, then
   * verifies (existence probes) that zero residue remains.
   *
   * @returns per-sweep counts and the deletion order (registry keys), for
   * suites that assert on the teardown itself.
   *
   * Throws a single aggregate error if any DELETE threw or any row still
   * exists afterwards — a leaking `afterAll` must fail the suite loudly. On
   * full success the registry is emptied, so a repeated call is a no-op.
   */
  async cleanup(): Promise<TrackedFixtureCleanupReport> {
    const reversed = [...this.entries].toReversed();
    const { deletedKeys, failures } = await deleteRecordsNext(reversed, 0, [], []);
    const { residue } = await collectResidueNext(this.entries, 0, []);

    const problems = [...failures, ...residue.map(keyedId => `${keyedId} still exists after cleanup`)];
    if (problems.length > 0) {
      throw new Error(
        `TrackedFixtures cleanup failed — journey fixtures must leave zero residue (${problems.join("; ")})`
      );
    }

    const verifiedAbsentCount = this.entries.length;
    this.entries = [];
    return {
      deletedCount: reversed.length,
      verifiedAbsentCount,
      deletedKeys: Object.freeze(deletedKeys),
    };
  }
}
