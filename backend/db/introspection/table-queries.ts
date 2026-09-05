/**
 * Table-scoped introspection queries: per-table summaries, full column
 * inventories, and index listings. Part of the live PostgreSQL introspection
 * library — see `index.ts` for the module-level overview and security notes.
 */
import { queryDb } from "@/backend/db/index";

import type { ColumnInfo, IndexInfo, TableSummary } from "@/backend/db/introspection/types";

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

/** Identifier whitelist — table names must match this before querying. */
const TABLE_NAME_RE = /^[a-z_]+$/;

/**
 * Validates that a table-name parameter is safe to query with. Even though we
 * pass it as a `$1` parameter (so it can never be SQL-injected), we apply a
 * strict whitelist regex as defense-in-depth. Throws on invalid input.
 */
function assertValidTableName(tableName: string): void {
  if (!TABLE_NAME_RE.test(tableName)) {
    throw new Error(`Invalid table name: "${tableName}". Must match /^[a-z_]+$/.`);
  }
}

/**
 * Returns one summary row per public-schema table. Single round-trip — uses
 * correlated subqueries against `pg_constraint` and joins `pg_stat_user_tables`
 * for live row counts (n_live_tup).
 */
export async function getTableSummaries(): Promise<TableSummary[]> {
  const sql = `
    SELECT
      c.relname                                  AS table_name,
      COALESCE(s.n_live_tup, 0)::bigint          AS row_count,
      (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND table_name = c.relname)::int AS column_count,
      EXISTS (
        SELECT 1 FROM pg_trigger t
         WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
      ) AS has_triggers,
      EXISTS (
        SELECT 1 FROM pg_trigger t
         WHERE t.tgrelid = c.oid
           AND NOT t.tgisinternal
           AND t.tgname LIKE 'prevent_%_update_trigger'
      ) AS is_immutable,
      (SELECT count(*) FROM pg_constraint con
         WHERE con.conrelid = c.oid AND con.contype='p')::int AS pk_count,
      (SELECT count(*) FROM pg_constraint con
         WHERE con.conrelid = c.oid AND con.contype='f')::int AS fk_count,
      (SELECT count(*) FROM pg_constraint con
         WHERE con.conrelid = c.oid AND con.contype='u')::int AS unique_count,
      (SELECT count(*) FROM pg_constraint con
         WHERE con.conrelid = c.oid AND con.contype='c')::int AS check_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname;
  `;
  const result = await queryDb<{
    table_name: string;
    row_count: string;
    column_count: number;
    has_triggers: boolean;
    is_immutable: boolean;
    pk_count: number;
    fk_count: number;
    unique_count: number;
    check_count: number;
  }>(sql);
  return result.rows.map(r => ({
    tableName: r.table_name,
    rowCount: Number(r.row_count),
    columnCount: r.column_count,
    hasTriggers: r.has_triggers,
    isImmutable: r.is_immutable,
    constraints: {
      pk: r.pk_count,
      fks: r.fk_count,
      uniques: r.unique_count,
      checks: r.check_count,
    },
  }));
}

/**
 * SQL for `getTableColumns` — kept at module level so the function body stays
 * within the repo's max-lines-per-function budget. The query is a constant
 * (parameterized via `$1` only), so hoisting changes nothing at runtime.
 */
const TABLE_COLUMNS_SQL = `
    SELECT
      cols.column_name,
      cols.data_type,
      cols.udt_name,
      (cols.is_nullable = 'YES') AS is_nullable,
      cols.column_default,
      EXISTS (
        SELECT 1 FROM pg_constraint con
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
        JOIN pg_class tc ON tc.oid = con.conrelid
        JOIN pg_namespace tn ON tn.oid = tc.relnamespace
        WHERE tn.nspname='public' AND tc.relname = $1
          AND a.attname = cols.column_name
          AND con.contype='p'
      ) AS is_primary_key,
      EXISTS (
        SELECT 1 FROM pg_constraint con
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
        JOIN pg_class tc ON tc.oid = con.conrelid
        JOIN pg_namespace tn ON tn.oid = tc.relnamespace
        WHERE tn.nspname='public' AND tc.relname = $1
          AND a.attname = cols.column_name
          AND con.contype='u'
      ) AS is_unique,
      EXISTS (
        SELECT 1 FROM pg_constraint con
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
        JOIN pg_class tc ON tc.oid = con.conrelid
        JOIN pg_namespace tn ON tn.oid = tc.relnamespace
        WHERE tn.nspname='public' AND tc.relname = $1
          AND a.attname = cols.column_name
          AND con.contype='f'
      ) AS is_foreign_key,
      (
        SELECT rf.relname || '.' || ra.attname
        FROM pg_constraint con
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
        JOIN pg_class rf ON rf.oid = con.confrelid
        JOIN pg_attribute ra ON ra.attrelid = con.confrelid AND ra.attnum = ANY(con.confkey)
        JOIN pg_class tc ON tc.oid = con.conrelid
        JOIN pg_namespace tn ON tn.oid = tc.relnamespace
        WHERE tn.nspname='public' AND tc.relname = $1
          AND a.attname = cols.column_name
          AND con.contype='f'
        LIMIT 1
      ) AS fk_references,
      (
        SELECT pg_get_constraintdef(con.oid)
        FROM pg_constraint con
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
        JOIN pg_class tc ON tc.oid = con.conrelid
        JOIN pg_namespace tn ON tn.oid = tc.relnamespace
        WHERE tn.nspname='public' AND tc.relname = $1
          AND a.attname = cols.column_name
          AND con.contype='c'
        LIMIT 1
      ) AS check_constraint
    FROM information_schema.columns cols
    WHERE cols.table_schema='public' AND cols.table_name = $1
    ORDER BY cols.ordinal_position;
  `;

/**
 * Returns the full column inventory for a single table — including PK/FK/
 * UNIQUE/CHECK flags and the FK reference target (`table.col`) when applicable.
 * Single round-trip via correlated subqueries.
 */
export async function getTableColumns(tableName: string): Promise<ColumnInfo[]> {
  assertValidTableName(tableName);
  const result = await queryDb<{
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: boolean;
    column_default: string | null;
    is_primary_key: boolean;
    is_unique: boolean;
    is_foreign_key: boolean;
    fk_references: string | null;
    check_constraint: string | null;
  }>(TABLE_COLUMNS_SQL, [tableName]);
  return result.rows.map(r => ({
    columnName: r.column_name,
    dataType: r.data_type,
    udtName: r.udt_name,
    isNullable: r.is_nullable,
    columnDefault: r.column_default,
    isPrimaryKey: r.is_primary_key,
    isForeignKey: r.is_foreign_key,
    fkReferences: r.fk_references,
    isUnique: r.is_unique,
    checkConstraint: r.check_constraint,
  }));
}

/**
 * Returns all public-schema indexes (optionally filtered to one table).
 * Unnests `pg_index.indkey` to expand column names into an ordered array.
 */
export async function getIndexes(tableName?: string): Promise<IndexInfo[]> {
  const sql = `
    SELECT
      i.relname AS index_name,
      c.relname AS table_name,
      coalesce(json_agg(a.attname ORDER BY k.ord) FILTER (WHERE a.attname IS NOT NULL), '[]'::json) AS column_names,
      ix.indisunique AS is_unique,
      ix.indisprimary AS is_primary
    FROM pg_index ix
    JOIN pg_class c ON c.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
    WHERE n.nspname = 'public'
      AND ($1::text IS NULL OR c.relname = $1)
    GROUP BY i.relname, c.relname, ix.indisunique, ix.indisprimary
    ORDER BY c.relname, i.relname;
  `;
  const result = await queryDb<{
    index_name: string;
    table_name: string;
    column_names: string[];
    is_unique: boolean;
    is_primary: boolean;
  }>(sql, [tableName ?? null]);
  return result.rows.map(r => ({
    indexName: r.index_name,
    tableName: r.table_name,
    columnNames: r.column_names,
    isUnique: r.is_unique,
    isPrimary: r.is_primary,
  }));
}
