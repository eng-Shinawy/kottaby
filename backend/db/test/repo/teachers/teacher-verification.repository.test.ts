/**
 * `teacher_verification` schema-contract suite.
 *
 * The table records a verification attempt's tajweed/hifz level outcomes
 * for a teacher. No runtime writer or reader exists today — the levels the
 * evaluation rubric flow actually records live in
 * `evaluations.weakness_area` — so the honest coverage for this table is
 * its schema contract plus a rollback-isolated round-trip. The table has
 * no repository of its own; nothing in this file exercises a rubric
 * producer.
 *
 * The certification/cooldown behavior of the verification state machine is
 * owned by the services and journey suites (evaluation-rubric,
 * evaluation-booking, applicant-lifecycle, applicant-student-conversion)
 * and is deliberately not duplicated here.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - every probe runs inside `runInRollback`; `tx` is threaded to every
 *    entity-setup helper and direct query;
 *  - fixtures come from `entity-setup.ts` helpers — never seed data, and
 *    every count is scoped to the fixture teacher;
 *  - schema introspection goes through the PostgreSQL catalogs with bound
 *    parameters (`tx.execute(sql`...`)`), never string interpolation.
 */

import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { teacherVerification } from "@/backend/db/schema/teachers/teacher-verification";
import { createTestTeacherRow, createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import type { DBTransaction } from "@/backend/types";

/** Catalog metadata for one column, as `information_schema.columns` reports it. */
interface ColumnContract {
  readonly columnName: string;
  readonly dataType: string;
  readonly maxLength: number | null;
  readonly isNullable: string;
}

/** Reads every catalog row for the `teacher_verification` columns, keyed by name. */
async function readTableColumns(tx: DBTransaction): Promise<Map<string, ColumnContract>> {
  const discovered = await tx.execute<{
    column_name: string;
    data_type: string;
    character_maximum_length: number | null;
    is_nullable: string;
  }>(sql`SELECT column_name, data_type, character_maximum_length, is_nullable
         FROM information_schema.columns
         WHERE table_name = 'teacher_verification'`);
  const columns = new Map<string, ColumnContract>();
  for (const row of discovered.rows) {
    columns.set(row.column_name, {
      columnName: row.column_name,
      dataType: row.data_type,
      maxLength: row.character_maximum_length,
      isNullable: row.is_nullable,
    });
  }
  return columns;
}

/** Asserts one level column's full catalog shape: nullable varchar(50). */
function expectNullableVarchar50(column: ColumnContract | undefined, name: string): void {
  if (!column) {
    throw new Error(`teacher_verification.${name} is missing from the catalog`);
  }
  expect(column.dataType).toBe("character varying");
  expect(column.maxLength).toBe(50);
  expect(column.isNullable).toBe("YES");
}

describe("teacher_verification schema contract", () => {
  test("INV-TV7 schema contract: tajweed_level and hifz_level are nullable varchar(50) columns with the teacher FK and index", async () => {
    await runInRollback(async tx => {
      const columns = await readTableColumns(tx);
      expectNullableVarchar50(columns.get("tajweed_level"), "tajweed_level");
      expectNullableVarchar50(columns.get("hifz_level"), "hifz_level");

      const teacherIdColumn = columns.get("teacher_id");
      if (!teacherIdColumn) {
        throw new Error("teacher_verification.teacher_id is missing from the catalog");
      }
      expect(teacherIdColumn.dataType).toBe("integer");
      expect(teacherIdColumn.isNullable).toBe("NO");

      const foreignKey = await tx.execute<{
        delete_action: string;
        references_teacher: boolean;
        on_teacher_verification: boolean;
      }>(
        sql`SELECT confdeltype::text AS delete_action,
                   (confrelid = 'teacher'::regclass) AS references_teacher,
                   (conrelid = 'teacher_verification'::regclass) AS on_teacher_verification
            FROM pg_constraint
            WHERE conname = 'teacher_verification_teacher_id_teacher_id_fkey'`
      );
      expect(foreignKey.rows).toHaveLength(1);
      expect(foreignKey.rows[0]?.references_teacher).toBe(true);
      expect(foreignKey.rows[0]?.on_teacher_verification).toBe(true);
      // ON DELETE CASCADE — verification history is removed with the teacher row.
      expect(foreignKey.rows[0]?.delete_action).toBe("c");

      const index = await tx.execute<{ indexdef: string }>(
        sql`SELECT indexdef FROM pg_indexes
            WHERE tablename = 'teacher_verification'
              AND indexname = 'teacher_verification_teacher_id_idx'`
      );
      expect(index.rows).toHaveLength(1);
      expect(index.rows[0]?.indexdef).toContain("ON");
      expect(index.rows[0]?.indexdef).toContain("teacher_id");
    });
  });

  test("INV-TV7: a round-trip insert inside runInRollback reads back verbatim", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const teacherRow = await createTestTeacherRow(tx, user.id);

      const [assessed] = await tx
        .insert(teacherVerification)
        .values({
          teacherId: teacherRow.id,
          tajweedLevel: "advanced",
          hifzLevel: "juz-30-complete",
        })
        .returning();
      if (!assessed) {
        throw new Error("round-trip insert returned no rows");
      }
      expect(assessed.teacherId).toBe(teacherRow.id);
      expect(assessed.tajweedLevel).toBe("advanced");
      expect(assessed.hifzLevel).toBe("juz-30-complete");

      const readBack = await tx
        .select()
        .from(teacherVerification)
        .where(eq(teacherVerification.teacherId, teacherRow.id));
      expect(readBack).toHaveLength(1);
      expect(readBack[0]?.tajweedLevel).toBe("advanced");
      expect(readBack[0]?.hifzLevel).toBe("juz-30-complete");

      // The level columns are nullable by contract — a history row may
      // predate either level assessment, and multiple rows per teacher are
      // allowed (verification history), so the second row coexists.
      await tx.insert(teacherVerification).values({ teacherId: teacherRow.id, tajweedLevel: null, hifzLevel: null });
      const history = await tx
        .select()
        .from(teacherVerification)
        .where(eq(teacherVerification.teacherId, teacherRow.id));
      expect(history).toHaveLength(2);
      expect(history.filter(row => row.tajweedLevel === null && row.hifzLevel === null)).toHaveLength(1);
    });
  });
});
