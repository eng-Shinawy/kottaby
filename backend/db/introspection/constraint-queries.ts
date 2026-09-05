/**
 * Constraint introspection queries: foreign keys and CHECK constraints.
 * Part of the live PostgreSQL introspection library — see `index.ts` for the
 * module-level overview and security notes.
 */
import { queryDb } from "@/backend/db/index";

import type { CheckInfo, FkInfo } from "@/backend/db/introspection/types";

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

/**
 * Translates PostgreSQL's `confdeltype` single-char code to a readable string.
 * See https://www.postgresql.org/docs/current/catalog-pg-constraint.html
 */
function decodeOnDelete(code: string): string {
  switch (code) {
    case "a":
      return "NO ACTION";
    case "r":
      return "RESTRICT";
    case "c":
      return "CASCADE";
    case "n":
      return "SET NULL";
    case "d":
      return "SET DEFAULT";
    default:
      return code;
  }
}

/**
 * Returns all public-schema foreign-key constraints (optionally filtered to
 * one table). Unnests `conkey` + `confkey` in lockstep to pair local →
 * foreign columns. Translates `confdeltype` to a readable ON DELETE string.
 */
export async function getForeignKeys(tableName?: string): Promise<FkInfo[]> {
  const sql = `
    SELECT
      con.conname AS constraint_name,
      tbl.relname AS table_name,
      attr.attname AS column_name,
      ftbl.relname AS foreign_table_name,
      fattr.attname AS foreign_column_name,
      con.confdeltype AS on_delete_code
    FROM pg_constraint con
    JOIN pg_class tbl  ON tbl.oid  = con.conrelid
    JOIN pg_class ftbl ON ftbl.oid = con.confrelid
    JOIN pg_namespace n ON n.oid = tbl.relnamespace
    JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)  ON true
    JOIN pg_attribute attr  ON attr.attrelid  = tbl.oid  AND attr.attnum  = k.attnum
    JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS fk(attnum, ord) ON fk.ord = k.ord
    JOIN pg_attribute fattr ON fattr.attrelid = ftbl.oid AND fattr.attnum = fk.attnum
    WHERE n.nspname = 'public'
      AND con.contype = 'f'
      AND ($1::text IS NULL OR tbl.relname = $1)
    ORDER BY tbl.relname, con.conname, k.ord;
  `;
  const result = await queryDb<{
    constraint_name: string;
    table_name: string;
    column_name: string;
    foreign_table_name: string;
    foreign_column_name: string;
    on_delete_code: string;
  }>(sql, [tableName ?? null]);
  return result.rows.map(r => ({
    constraintName: r.constraint_name,
    tableName: r.table_name,
    columnName: r.column_name,
    foreignTableName: r.foreign_table_name,
    foreignColumnName: r.foreign_column_name,
    onDelete: decodeOnDelete(r.on_delete_code),
  }));
}

/**
 * Returns all public-schema CHECK constraints (optionally filtered to one
 * table). Uses `pg_get_constraintdef` to render the human-readable clause.
 */
export async function getCheckConstraints(tableName?: string): Promise<CheckInfo[]> {
  const sql = `
    SELECT
      con.conname AS constraint_name,
      tbl.relname AS table_name,
      pg_get_constraintdef(con.oid) AS check_clause
    FROM pg_constraint con
    JOIN pg_class tbl ON tbl.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = tbl.relnamespace
    WHERE n.nspname = 'public'
      AND con.contype = 'c'
      AND ($1::text IS NULL OR tbl.relname = $1)
    ORDER BY tbl.relname, con.conname;
  `;
  const result = await queryDb<{
    constraint_name: string;
    table_name: string;
    check_clause: string;
  }>(sql, [tableName ?? null]);
  return result.rows.map(r => ({
    constraintName: r.constraint_name,
    tableName: r.table_name,
    checkClause: r.check_clause,
  }));
}
