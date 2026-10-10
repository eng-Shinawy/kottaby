/**
 * Static structural assertions suite — the `evaluations` table's schema
 * contract. bun:test over the Drizzle table's introspectable metadata
 * (`getTableConfig` / `getColumns`) — no database round-trip: the table
 * object itself is the structural ground truth.
 *
 * Pinned invariants:
 *  - The score backstop: the table's CHECK list is exactly
 *    `evaluations_score_check` (score in 0-100) — the database backstop
 *    behind the service-level score guards of the two flows sharing the
 *    table (rubric scoring and the student star rating whose 1-5 stars
 *    map to 20-100 on this scale).
 *  - The soft-delete column pair (`is_deleted`, `deleted_at`) exists —
 *    the only sanctioned removal shape is the soft-delete flag; the
 *    repository tier exposes no hard-delete surface, so the columns are
 *    the schema's whole stake in that contract.
 */
import { describe, expect, test } from "bun:test";
import { getColumns, getTableName } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { evaluations } from "@/backend/db/schema/teachers/evaluations";

/** All CHECK constraint names declared on a table, sorted. */
function checkNames(table: PgTable): string[] {
  return getTableConfig(table)
    .checks.map(check => check.name)
    .toSorted((a, b) => a.localeCompare(b));
}

describe("evaluations schema — static structural assertions", () => {
  test("INV-E1: the evaluations CHECK list is exactly [evaluations_score_check]; the is_deleted/deleted_at columns exist", () => {
    expect(getTableName(evaluations)).toBe("evaluations");

    // The score backstop is the table's single CHECK — no other range
    // guard exists at the schema tier.
    expect(checkNames(evaluations)).toEqual(["evaluations_score_check"]);

    const columns = getColumns(evaluations);
    // The soft-delete pair exists and stays optional on both legs: only
    // an explicit deleted flag excludes a row from the live reads.
    expect(columns.isDeleted).toBeDefined();
    expect(columns.deletedAt).toBeDefined();
    expect(columns.isDeleted?.notNull).toBe(false);
    expect(columns.deletedAt?.notNull).toBe(false);
  });
});
