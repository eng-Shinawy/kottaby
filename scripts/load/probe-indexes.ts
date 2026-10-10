#!/usr/bin/env bun
/**
 * True-coverage FK index audit — the row 6.6 CLI (REQ-008 AC-4).
 *
 * Two halves:
 *  1. STATIC — enumerate every foreign-key column from the Drizzle schema
 *     itself (real `getTableConfig` introspection of `references()`, never
 *     a regex walk of source text).
 *  2. LIVE — for every one of those (table, column) pairs, check the
 *     database's `pg_index`/`pg_constraint` catalogs for TRUE coverage:
 *     any index — primary-key, unique-constraint backing index, or plain
 *     index — whose FIRST column is the FK column covers it. This is the
 *     honest coverage rule: shared-PK children (teacher.id / students.id /
 *     parents.id / admin.id / applicants.id, each `.primaryKey().references(users.id)`),
 *     composite-PK leading columns (student_subscriptions.student_id), and
 *     unique-constraint backing indexes (wallet.teacher_id via
 *     wallet_teacher_id_unique) all count as covered; there is no phantom
 *     `teacher.user_id` column to invent.
 *
 * The audit FAILs on any FK column without live coverage — future schema
 * drift adding an unindexed FK turns this probe red.
 *
 * Usage:
 *   bun run scripts/load/probe-indexes.ts [--out <path>]
 *
 * Exit codes: 0 = every FK column covered; 1 = any uncovered FK column.
 */

import { applyEnvFile } from "@/scripts/dbActions/envFile";
import { writeLoadArtifact } from "@/scripts/load/lib/artifact";
import { type LoadArgSpec, parseLoadCliArgs } from "@/scripts/load/lib/cli";

const ARGS: readonly LoadArgSpec[] = [
  { name: "out", kind: "string", help: "Explicit artifact output path (default: scratch/load/<stamp>.json)" },
];

/** One statically-enumerated FK column. */
interface FkColumn {
  readonly table: string;
  readonly column: string;
}

/** Live coverage facts for one (table, column) pair. */
interface CoverageFacts {
  readonly coveringIndexes: readonly { readonly name: string; readonly kind: "primary" | "unique" | "index" }[];
  readonly uniqueConstraints: readonly string[];
}

/** Enumerates every FK column across the Drizzle schema via getTableConfig. */
async function enumerateFkColumns(): Promise<FkColumn[]> {
  const { is, Table } = await import("drizzle-orm");
  const { getTableConfig } = await import("drizzle-orm/pg-core");
  const schemaNS = await import("@/backend/db/schema");
  const fkColumns: FkColumn[] = [];
  const seen = new Set<string>();
  for (const value of Object.values(schemaNS)) {
    if (!is(value, Table)) {
      continue;
    }
    const config = getTableConfig(value);
    for (const foreignKey of config.foreignKeys) {
      for (const column of foreignKey.reference().columns) {
        const entry: FkColumn = { table: config.name, column: column.name };
        const key = `${entry.table}.${entry.column}`;
        if (!seen.has(key)) {
          seen.add(key);
          fkColumns.push(entry);
        }
      }
    }
  }
  return fkColumns.toSorted((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));
}

/**
 * Fetches live coverage facts: every index whose FIRST column is the FK
 * column, plus the named unique constraints backing them.
 */
async function fetchCoverageFacts(
  db: Awaited<typeof import("@/backend/db")>["db"],
  table: string,
  column: string
): Promise<CoverageFacts> {
  const { sql } = await import("drizzle-orm");
  const indexRows = await db.execute<{
    index_name: string;
    kind: string;
    constraint_name: string | null;
  }>(sql`
    SELECT ic.relname AS index_name,
           CASE WHEN i.indisprimary THEN 'primary' WHEN i.indisunique THEN 'unique' ELSE 'index' END AS kind,
           COALESCE(con.conname, NULL) AS constraint_name
    FROM pg_index i
    JOIN pg_class tc ON tc.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tc.relnamespace
    JOIN pg_attribute a ON a.attrelid = tc.oid AND a.attnum = i.indkey[0]
    JOIN pg_class ic ON ic.oid = i.indexrelid
    LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid
    WHERE n.nspname = 'public' AND tc.relname = ${table} AND a.attname = ${column}
      AND i.indkey[0] != 0`);
  const coveringIndexes = indexRows.rows.map(row => {
    let kind: "primary" | "unique" | "index" = "index";
    if (row.kind === "primary" || row.kind === "unique") {
      kind = row.kind;
    }
    return { name: row.index_name, kind };
  });
  const uniqueConstraints = indexRows.rows
    .map(row => row.constraint_name)
    .filter((name): name is string => name !== null);
  return { coveringIndexes, uniqueConstraints };
}

async function main(): Promise<number> {
  const args = parseLoadCliArgs("probe-indexes.ts", ARGS);
  if (args === null) {
    return 1;
  }

  const fkColumns = await enumerateFkColumns();
  console.log(`[probe-indexes] static enumeration: ${fkColumns.length} FK columns across the Drizzle schema`);

  applyEnvFile(".env");
  const { db, closePool } = await import("@/backend/db");

  interface AuditRow {
    readonly fk: string;
    readonly covered: boolean;
    readonly coveringIndex: string | null;
    readonly kind: "primary" | "unique" | "index" | null;
  }

  const audits = await Promise.all(
    fkColumns.map(async ({ table, column }) => {
      const facts = await fetchCoverageFacts(db, table, column);
      const primary = facts.coveringIndexes.find(entry => entry.kind === "primary");
      const unique = facts.coveringIndexes.find(entry => entry.kind === "unique");
      const plain = facts.coveringIndexes.find(entry => entry.kind === "index");
      const covering = primary ?? unique ?? plain ?? null;
      let kind: AuditRow["kind"] = null;
      if (primary !== undefined) {
        kind = "primary";
      } else if (unique !== undefined) {
        kind = "unique";
      } else if (plain !== undefined) {
        kind = "index";
      }
      const row: AuditRow = {
        fk: `${table}.${column}`,
        covered: kind !== null,
        coveringIndex: covering?.name ?? null,
        kind,
      };
      if (row.kind === null) {
        console.log(`FAIL  ${table}.${column}: no PK / unique / index coverage`);
      } else {
        console.log(`PASS  ${table}.${column}: covered by ${row.kind} ${row.coveringIndex}`);
      }
      return row;
    })
  );
  await closePool();

  const rows: readonly AuditRow[] = audits;
  const failures = audits.filter(row => !row.covered).length;
  const coveredCount = rows.filter(row => row.covered).length;
  const payload = {
    tool: "probe-indexes",
    fkColumnCount: rows.length,
    coveredCount,
    rows,
  };
  const artifact = args.string("out") ?? writeLoadArtifact("probe-indexes", payload);
  console.log(`[probe-indexes] artifact: ${artifact}`);

  if (failures > 0) {
    console.error(`[probe-indexes] FAIL — ${failures} FK column(s) without coverage`);
    return 1;
  }
  console.log(`[probe-indexes] PASS — all ${rows.length} FK columns covered (${coveredCount} PASS lines)`);
  return 0;
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    console.error("[probe-indexes] FAILED:", error);
    process.exit(1);
  });
