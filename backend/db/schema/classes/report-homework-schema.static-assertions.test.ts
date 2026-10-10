/**
 * Static structural assertions suite — `reports` / `home_work` session
 * binding. bun:test over the Drizzle tables' introspectable metadata
 * (`getTableConfig` / `getColumns`) — no database round-trip: the
 * table objects themselves are the structural ground truth.
 *
 * Pinned invariants:
 *  - One report row per session and one homework row per session: each
 *    table carries a named UNIQUE table constraint over `session_id`
 *    (the database is the arbiter of duplicate submissions; the write
 *    path maps the resulting 23505 to its domain conflict).
 *  - `reports` exposes NO `teacher_id` column — the teacher is reached
 *    exclusively through `session_id → session.teacher_id`.
 *  - `home_work` grade columns (`current_grade`, `revision_grade`) stay
 *    nullable: an assignment row is created ungraded and graded on a
 *    later pass (first session assigns, subsequent sessions grade).
 *  - The grade-range CHECK constraints (0–100) and the report rating
 *    CHECK (0–5) remain in place as the database backstop behind the
 *    service-level validation.
 *  - `session_id` stays NOT NULL on both tables — a report or homework row
 *    can never exist detached from its session (the session link is the
 *    sole access path to the participants).
 */
import { describe, expect, test } from "bun:test";
import { getColumns, getTableName } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { homeWork } from "@/backend/db/schema/classes/home-work";
import { reports } from "@/backend/db/schema/classes/reports";

/** DB column keys of a table, sorted for order-insensitive comparison. */
function columnKeys(table: PgTable): string[] {
  return Object.keys(getColumns(table)).toSorted((a, b) => a.localeCompare(b));
}

/** The named unique constraint of a table, or undefined when absent. */
function uniqueConstraint(table: PgTable, name: string) {
  return getTableConfig(table).uniqueConstraints.find(constraint => constraint.name === name);
}

/** All CHECK constraint names declared on a table, sorted. */
function checkNames(table: PgTable): string[] {
  return getTableConfig(table)
    .checks.map(check => check.name)
    .toSorted((a, b) => a.localeCompare(b));
}

/** DB column names covered by a unique constraint, sorted. */
function uniqueColumnNames(table: PgTable, name: string): string[] {
  const constraint = uniqueConstraint(table, name);
  if (!constraint) return [];
  return constraint.columns.map(column => column.name).toSorted((a, b) => a.localeCompare(b));
}

describe("reports/home_work session binding — static structural assertions", () => {
  test("reports carries the reports_session_id_unique constraint over session_id", () => {
    expect(getTableName(reports)).toBe("reports");

    const constraint = uniqueConstraint(reports, "reports_session_id_unique");
    expect(constraint).toBeDefined();
    expect(uniqueColumnNames(reports, "reports_session_id_unique")).toEqual(["session_id"]);
  });

  test("reports exposes exactly the report columns — no teacherId key (teacher via session)", () => {
    expect(columnKeys(reports)).toEqual([
      "createdAt",
      "id",
      "sessionId",
      "studentRatingByTeacher",
      "teacherNotes",
      "updatedAt",
    ]);
    expect(columnKeys(reports)).not.toContain("teacherId");
  });

  test("reports keeps the 0–5 rating CHECK as the database backstop", () => {
    expect(checkNames(reports)).toEqual(["reports_student_rating_by_teacher_check"]);
  });

  test("home_work carries the home_work_session_id_unique constraint over session_id", () => {
    expect(getTableName(homeWork)).toBe("home_work");

    const constraint = uniqueConstraint(homeWork, "home_work_session_id_unique");
    expect(constraint).toBeDefined();
    expect(uniqueColumnNames(homeWork, "home_work_session_id_unique")).toEqual(["session_id"]);
  });

  test("INV-S8: homeWork.sessionId.notNull === true and reports.sessionId.notNull === true (schema pins)", () => {
    const homeWorkColumns = getColumns(homeWork);
    expect(homeWorkColumns.sessionId?.notNull).toBe(true);

    const reportColumns = getColumns(reports);
    expect(reportColumns.sessionId?.notNull).toBe(true);
  });

  test("home_work grade columns remain nullable — assignment happens ungraded", () => {
    const columns = getColumns(homeWork);
    expect(columns.currentGrade?.notNull).toBe(false);
    expect(columns.revisionGrade?.notNull).toBe(false);
  });

  test("home_work keeps both 0–100 grade CHECKs unchanged", () => {
    expect(checkNames(homeWork)).toEqual(["home_work_current_grade_check", "home_work_revision_grade_check"]);
  });
});
