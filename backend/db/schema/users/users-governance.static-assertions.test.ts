/**
 * Static structural assertions suite — the governance-column decision pin
 * (§8 row 8.7: governance flags live on `users` ONLY, never on the role
 * tables). bun:test over the Drizzle tables' introspectable metadata
 * (`getColumns` / `getTableName`) — no database round-trip: the table
 * objects themselves are the structural ground truth (same pattern as
 * the classes report-homework static-assertions suite).
 *
 * Pinned invariants:
 *  - `users` carries the full governance column family: the three lifecycle
 *    flags (`isDeleted`, `suspended`, `isBlocked`) plus their supporting
 *    timestamp columns (`deletedAt`, `suspendedAt`, `blockedAt`) and the
 *    suspension length (`suspendedPeriodDays`), under their exact DB names.
 *  - The role-marker / role-data tables (`students`, `teacher`, `parents`,
 *    `admin`) export NONE of those governance columns — governance lives on
 *    the shared user row ONLY, so one governance write reaches every role.
 *  - Table-name grounding for the naming nuances the decision ledger rides
 *    on: the teacher role table is singular `teacher`, the parent role
 *    marker is `parents`, and the admin role marker is `admin`.
 */
import { describe, expect, test } from "bun:test";
import { type Column, getColumns, getTableName } from "drizzle-orm";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";

/** The governance column family — declared ONLY on `users`. */
const GOVERNANCE_COLUMNS = [
  "isDeleted",
  "deletedAt",
  "suspended",
  "suspendedAt",
  "suspendedPeriodDays",
  "isBlocked",
  "blockedAt",
] as const;

/** The exact DB names of the governance columns, keyed by their property names. */
const GOVERNANCE_DB_NAMES: Record<(typeof GOVERNANCE_COLUMNS)[number], string> = {
  isDeleted: "is_deleted",
  deletedAt: "deleted_at",
  suspended: "suspended",
  suspendedAt: "suspended_at",
  suspendedPeriodDays: "suspended_period_days",
  isBlocked: "is_blocked",
  blockedAt: "blocked_at",
};

/** The role tables that must stay governance-free (shared-PK children of `users`). */
const ROLE_TABLES = [students, teacher, parents, admin] as const;

/** A column of a table, or undefined when the key is absent. */
function columnOf(columns: Record<string, Column>, key: string): Column | undefined {
  return columns[key];
}

describe("users governance columns — A.7 static structural assertions (§8 row 8.7)", () => {
  test("users carries the full governance column family under its exact DB names", () => {
    expect(getTableName(users)).toBe("users");

    const columns = getColumns(users);
    for (const key of GOVERNANCE_COLUMNS) {
      const column = columnOf(columns, key);
      if (!column) throw new Error(`users is missing governance column "${key}"`);
      expect(column.name).toBe(GOVERNANCE_DB_NAMES[key]);
    }
  });

  test("the three governance flags are boolean columns", () => {
    const columns = getColumns(users);
    for (const key of ["isDeleted", "suspended", "isBlocked"] as const) {
      const column = columnOf(columns, key);
      if (!column) throw new Error(`users is missing governance flag "${key}"`);
      expect(column.dataType).toBe("boolean");
    }
  });

  describe("role tables export NONE of the governance columns", () => {
    for (const table of ROLE_TABLES) {
      test(`${getTableName(table)} carries no governance column`, () => {
        const columns = getColumns(table);
        expect(columns.id).toBeDefined();
        expect(Object.keys(columns).length).toBeGreaterThan(0);
        for (const key of GOVERNANCE_COLUMNS) {
          expect(columnOf(columns, key)).toBeUndefined();
        }
      });
    }
  });

  test("role-table name grounding: teacher is singular, parents and admin are the role markers", () => {
    expect(getTableName(students)).toBe("students");
    expect(getTableName(teacher)).toBe("teacher");
    expect(getTableName(parents)).toBe("parents");
    expect(getTableName(admin)).toBe("admin");
  });
});
