/**
 * Database-wide catalog introspection queries: enum types, triggers, and
 * high-level database statistics. Part of the live PostgreSQL introspection
 * library — see `index.ts` for the module-level overview and security notes.
 */
import { queryDb } from "@/backend/db/index";

import type { DbStats, EnumInfo, TriggerInfo } from "@/backend/db/introspection/types";

/**
 * Returns all public-schema enum types with their ordered values. Aggregates
 * `pg_enum.enumlabel` per `pg_type.typname` via `array_agg`.
 */
export async function getEnums(): Promise<EnumInfo[]> {
  const sql = `
    SELECT
      t.typname AS enum_name,
      coalesce(json_agg(e.enumlabel ORDER BY e.enumsortorder) FILTER (WHERE e.enumlabel IS NOT NULL), '[]'::json) AS values
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    GROUP BY t.typname
    ORDER BY t.typname;
  `;
  const result = await queryDb<{
    enum_name: string;
    values: string[];
  }>(sql);
  return result.rows.map(r => ({
    enumName: r.enum_name,
    values: r.values,
  }));
}

/**
 * Returns all public-schema triggers. Joins `information_schema.triggers`
 * with `pg_trigger` (for `tgenabled`) so we can report the live enabled/
 * disabled state. The schema ships six immutability triggers — see
 * `backend/db/migration/3-immutability-triggers.sql`.
 */
export async function getTriggers(): Promise<TriggerInfo[]> {
  const sql = `
    SELECT
      it.trigger_name,
      it.event_object_table AS table_name,
      it.event_manipulation,
      it.action_timing AS timing,
      (pt.tgenabled = 'O') AS is_enabled
    FROM information_schema.triggers it
    LEFT JOIN pg_trigger pt
      ON pt.tgname = it.trigger_name
     AND pt.tgrelid = (
       SELECT c.oid FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname='public' AND c.relname = it.event_object_table
       LIMIT 1
     )
    WHERE it.trigger_schema = 'public'
    ORDER BY it.event_object_table, it.event_manipulation, it.trigger_name;
  `;
  const result = await queryDb<{
    trigger_name: string;
    table_name: string;
    event_manipulation: string;
    timing: string;
    is_enabled: boolean;
  }>(sql);
  return result.rows.map(r => ({
    triggerName: r.trigger_name,
    tableName: r.table_name,
    eventManipulation: r.event_manipulation,
    timing: r.timing,
    isEnabled: r.is_enabled,
  }));
}

/**
 * Returns high-level database statistics for the dashboard header. Pulls the
 * PG version string, table count, enum count, trigger count, total live row
 * count, and a human-readable DB size via `pg_size_pretty(pg_database_size)`.
 */
export async function getDbStats(): Promise<DbStats> {
  const sql = `
    SELECT
      current_database() AS db_name,
      version() AS postgres_version,
      (SELECT count(*) FROM pg_tables WHERE schemaname='public')::int AS table_count,
      (SELECT count(DISTINCT t.typname)
         FROM pg_type t
         JOIN pg_enum e ON e.enumtypid = t.oid
         JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname='public')::int AS enum_count,
      (SELECT count(*) FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname='public' AND NOT t.tgisinternal)::int AS trigger_count,
      COALESCE((SELECT sum(n_live_tup)::bigint FROM pg_stat_user_tables), 0)::bigint AS total_rows,
      pg_size_pretty(pg_database_size(current_database())) AS schema_size;
  `;
  const result = await queryDb<{
    db_name: string;
    postgres_version: string;
    table_count: number;
    enum_count: number;
    trigger_count: number;
    total_rows: bigint;
    schema_size: string;
  }>(sql);
  const r = result.rows[0];
  if (!r) {
    throw new Error("getDbStats: empty result set");
  }
  return {
    dbName: r.db_name,
    postgresVersion: r.postgres_version,
    tableCount: r.table_count,
    enumCount: r.enum_count,
    triggerCount: r.trigger_count,
    totalRows: Number(r.total_rows),
    schemaSize: r.schema_size,
  };
}
