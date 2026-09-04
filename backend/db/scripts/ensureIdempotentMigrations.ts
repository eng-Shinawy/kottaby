import { existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { logger } from "@/backend/lib/logger";

const DRIZZLE_DIR = resolve("backend/drizzle");

function transformCreateType(trimmed: string): string | null {
  if (/\bCREATE\s+TYPE\b/i.test(trimmed) && !/DO\s+\$\$/i.test(trimmed) && !/IF\s+NOT\s+EXISTS/i.test(trimmed)) {
    const match = /\bCREATE\s+TYPE\s+("?(\w+)"?)\s+AS\s+ENUM/i.exec(trimmed);
    if (match) {
      const typeName = match[2];
      const body = trimmed.endsWith(";") ? trimmed : `${trimmed};`;
      return `DO $$ BEGIN\n    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${typeName}') THEN\n        ${body}\n    END IF;\nEND $$;`;
    }
  }
  return null;
}

function transformAddColumn(trimmed: string): string {
  if (/\bADD\s+COLUMN\b/i.test(trimmed) && !/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i.test(trimmed)) {
    return trimmed.replace(/\bADD\s+COLUMN\b/gi, "ADD COLUMN IF NOT EXISTS");
  }
  return trimmed;
}

function transformAddConstraint(trimmed: string): string | null {
  if (/\bADD\s+CONSTRAINT\b/i.test(trimmed) && !/DO\s+\$\$/i.test(trimmed)) {
    const body = trimmed.endsWith(";") ? trimmed : `${trimmed};`;
    return `DO $$ BEGIN\n    ${body}\nEXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;\nEND $$;`;
  }
  return null;
}

/**
 * Wraps `ALTER TYPE <type> ADD VALUE '<val>'` in a `DO $$` PL/pgSQL block that checks `pg_enum`
 * before attempting the addition.
 *
 * This prevents PostgreSQL from marking an active transaction as modifying the enum type when the
 * value is already present in `pg_enum` (which would trigger error 55P04 on subsequent queries).
 */
function transformAlterTypeAddValue(trimmed: string): string | null {
  if (/\bALTER\s+TYPE\b/i.test(trimmed) && /\bADD\s+VALUE\b/i.test(trimmed) && !/DO\s+\$\$/i.test(trimmed)) {
    const match = /\bALTER\s+TYPE\s+("?(\w+)"?)\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?('[^']+')/i.exec(trimmed);
    if (match) {
      const fullType = match[1];
      const typeName = match[2];
      const enumVal = match[3];
      return `DO $$ BEGIN\n    IF NOT EXISTS (\n        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = '${typeName}' AND e.enumlabel = ${enumVal}\n    ) THEN\n        ALTER TYPE ${fullType} ADD VALUE ${enumVal};\n    END IF;\nEND $$;`;
    }
  }
  return null;
}

function transformAlterColumnType(trimmed: string): string | null {
  if (
    /\bALTER\s+COLUMN\b/i.test(trimmed) &&
    /\bTYPE\b/i.test(trimmed) &&
    !/DROP\s+DEFAULT/i.test(trimmed) &&
    !/DO\s+\$\$/i.test(trimmed)
  ) {
    const match = /ALTER\s+TABLE\s+(\S+)\s+ALTER\s+COLUMN\s+(\S+)\s+TYPE\s+(\S+)(?:\s+USING\s+([^;]+))?/i.exec(trimmed);
    if (match) {
      const fullTable = match[1];
      const tableName = fullTable.replace(/"/g, "");
      const fullCol = match[2];
      const colName = fullCol.replace(/"/g, "");
      const fullType = match[3];
      const usingClause = match[4] ? ` USING ${match[4]}` : "";
      const body = `ALTER TABLE ${fullTable} ALTER COLUMN ${fullCol} DROP DEFAULT;\n    ALTER TABLE ${fullTable} ALTER COLUMN ${fullCol} TYPE ${fullType}${usingClause};`;
      return `DO $$ BEGIN\n    IF EXISTS (\n        SELECT 1 FROM information_schema.columns WHERE table_name = '${tableName}' AND column_name = '${colName}' AND data_type = 'character varying'\n    ) THEN\n        ${body}\n    END IF;\nEXCEPTION WHEN OTHERS THEN NULL;\nEND $$;`;
    }
  }
  return null;
}

function transformInsertGroupPermissions(trimmed: string): string | null {
  if (
    /\bINSERT\s+INTO\s+(group_permissions|user_permission_groups)\b/i.test(trimmed) &&
    !/ON\s+CONFLICT/i.test(trimmed)
  ) {
    const body = trimmed.endsWith(";") ? trimmed.slice(0, -1) : trimmed;
    return `${body} ON CONFLICT DO NOTHING;`;
  }
  return null;
}

/**
 * Wraps `DROP INDEX` / `DROP CONSTRAINT` in `IF EXISTS` so a re-run after a partial
 * migration (where the object was already dropped) does not raise `undefined_object`
 * (PG 42704). Only transforms bare `DROP INDEX`/`DROP CONSTRAINT` statements that are
 * NOT already inside a `DO $$` block and NOT already `IF EXISTS`.
 */
function transformDropObject(trimmed: string): string | null {
  if (/DO\s+\$\$/i.test(trimmed)) return null;
  if (/\bDROP\s+(?:INDEX|CONSTRAINT)\s+IF\s+EXISTS\b/i.test(trimmed)) return null;
  if (/\bDROP\s+CONSTRAINT\b/i.test(trimmed)) {
    return trimmed.replace(/\bDROP\s+CONSTRAINT\b/gi, "DROP CONSTRAINT IF EXISTS");
  }
  if (/\bDROP\s+INDEX\b/i.test(trimmed)) {
    return trimmed.replace(/\bDROP\s+INDEX\b/gi, "DROP INDEX IF EXISTS");
  }
  return null;
}

/**
 * Wraps a `CREATE TABLE` statement with `IF NOT EXISTS` so that a partially-applied
 * migration (table already created on a prior failed run) re-executes without raising
 * `relation "<table>" already exists` (PG 42P07).
 *
 * PostgreSQL's `CREATE TABLE IF NOT EXISTS` skips the entire DDL block when the table
 * exists — acceptable here because the table's columns/constraints were written in full
 * by the original attempt, and any follow-up `ADD COLUMN` / `ADD CONSTRAINT` statements
 * in the same migration are already independently idempotent (see {@link transformAddColumn}
 * and {@link transformAddConstraint}). Indexes are handled separately by
 * {@link transformCreateIndex}.
 */
function transformCreateTable(trimmed: string): string | null {
  if (
    /\bCREATE\s+TABLE\b/i.test(trimmed) &&
    !/\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i.test(trimmed) &&
    !/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[^\s(]+\s+AS\b/i.test(trimmed) &&
    !/DO\s+\$\$/i.test(trimmed)
  ) {
    return trimmed.replace(/\bCREATE\s+TABLE\b/gi, "CREATE TABLE IF NOT EXISTS");
  }
  return null;
}

/**
 * Wraps a `CREATE [UNIQUE] INDEX` statement with `IF NOT EXISTS`. This makes index
 * creation idempotent against partially-applied migrations where the index was already
 * created before the migration aborted.
 *
 * PostgreSQL's `CREATE INDEX IF NOT EXISTS` is the documented idempotent form and is
 * safe for both fresh and partial-apply scenarios.
 */
function transformCreateIndex(trimmed: string): string | null {
  if (
    /\bCREATE\s+(UNIQUE\s+)?INDEX\b/i.test(trimmed) &&
    !/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\b/i.test(trimmed) &&
    !/DO\s+\$\$/i.test(trimmed)
  ) {
    return trimmed.replace(/\bCREATE\s+(UNIQUE\s+)?INDEX\b/gi, "CREATE $1INDEX IF NOT EXISTS");
  }
  return null;
}

function transformRenameConstraint(trimmed: string): string | null {
  if (/\bRENAME\s+CONSTRAINT\b/i.test(trimmed) && !/DO\s+\$\$/i.test(trimmed)) {
    const body = trimmed.endsWith(";") ? trimmed : `${trimmed};`;
    return `DO $$ BEGIN\n    ${body}\nEXCEPTION WHEN undefined_object OR duplicate_object OR duplicate_table THEN NULL;\nEND $$;`;
  }
  return null;
}

/**
 * Transforms a single SQL statement to be idempotent for PostgreSQL.
 * Handles `CREATE TYPE`, `CREATE TABLE`, `CREATE [UNIQUE] INDEX`, `ADD COLUMN`, `ADD CONSTRAINT`, `RENAME CONSTRAINT`, `ALTER TYPE ... ADD VALUE`, `ALTER COLUMN ... TYPE`, and join-table `INSERT`s.
 *
 * @param stmt The SQL statement string to transform.
 * @returns The transformed, idempotent SQL statement.
 */
export function transformStatementIdempotent(stmt: string): string {
  const trimmed = stmt.trim();
  if (!trimmed) return stmt;

  const alterColumnType = transformAlterColumnType(trimmed);
  if (alterColumnType) return alterColumnType;

  const alterTypeAddValue = transformAlterTypeAddValue(trimmed);
  if (alterTypeAddValue) return alterTypeAddValue;

  const createType = transformCreateType(trimmed);
  if (createType) return createType;

  const createTable = transformCreateTable(trimmed);
  if (createTable) return createTable;

  const createIndex = transformCreateIndex(trimmed);
  if (createIndex) return createIndex;

  const dropObject = transformDropObject(trimmed);
  if (dropObject) return dropObject;

  const renameConstraint = transformRenameConstraint(trimmed);
  if (renameConstraint) return renameConstraint;

  const withColumn = transformAddColumn(trimmed);

  const addConstraint = transformAddConstraint(withColumn);
  if (addConstraint) return addConstraint;

  const insertPermissions = transformInsertGroupPermissions(withColumn);
  if (insertPermissions) return insertPermissions;

  return withColumn;
}

/**
 * Transforms an entire migration SQL string (containing Drizzle `--> statement-breakpoint` markers) into idempotent SQL.
 *
 * @param sql The full raw SQL file content.
 * @returns The transformed SQL string with breakpoints preserved.
 */
export function makeMigrationSqlIdempotent(sql: string): string {
  const parts = sql.split(/--> statement-breakpoint\r?\n?/g);
  const transformedParts = parts.map(part => transformStatementIdempotent(part));
  return transformedParts.join("--> statement-breakpoint\n");
}

/**
 * Scans `backend/drizzle/` and rewrites all `migration.sql` files to be fully idempotent for PostgreSQL.
 *
 * @returns The list of relative migration file paths that were modified.
 */
export function ensureIdempotentMigrations(): string[] {
  if (!existsSync(DRIZZLE_DIR)) return [];

  const updatedFiles: string[] = [];
  const folders = readdirSync(DRIZZLE_DIR).filter(f => {
    try {
      return statSync(join(DRIZZLE_DIR, f)).isDirectory();
    } catch {
      return false;
    }
  });

  for (const folder of folders) {
    const sqlPath = join(DRIZZLE_DIR, folder, "migration.sql");
    if (!existsSync(sqlPath)) continue;

    const originalSql = readFileSync(sqlPath, "utf8");
    const idempotentSql = makeMigrationSqlIdempotent(originalSql);

    if (originalSql !== idempotentSql) {
      const tmpPath = `${sqlPath}.tmp`;
      writeFileSync(tmpPath, idempotentSql);
      try {
        renameSync(tmpPath, sqlPath);
      } catch (err) {
        try {
          unlinkSync(tmpPath);
        } catch {
          // best-effort cleanup of the orphaned temp file; ignore errors
        }
        throw err;
      }
      updatedFiles.push(`${folder}/migration.sql`);
    }
  }

  if (updatedFiles.length > 0) {
    logger.info(
      `Ensure Idempotent Migrations: Updated ${updatedFiles.length} migration file(s):\n  ${updatedFiles.join("\n  ")}`
    );
  } else {
    logger.info("Ensure Idempotent Migrations: All migration files already idempotent — no changes needed.");
  }

  return updatedFiles;
}

const ENUM_ADD_VALUE_PATTERN = /\bALTER\s+TYPE\s+("?\w+"?)\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?('[^']+')/gi;

/**
 * Extracts `ALTER TYPE ... ADD VALUE` statements from a migration SQL file.
 */
export function extractEnumAddValueStatementsFromSql(content: string): string[] {
  const statements: string[] = [];
  for (const match of content.matchAll(ENUM_ADD_VALUE_PATTERN)) {
    const fullType = match[1];
    const enumVal = match[2];
    if (!fullType || !enumVal) continue;
    statements.push(`ALTER TYPE ${fullType} ADD VALUE IF NOT EXISTS ${enumVal};`);
  }
  return statements;
}

async function enumTypeExists(typeName: string): Promise<boolean> {
  const { db } = await import("@/backend/db");
  const { sql } = await import("drizzle-orm");
  const result = await db.execute(sql`SELECT 1 FROM pg_type WHERE typname = ${typeName} LIMIT 1`);
  return result.rows.length > 0;
}

/**
 * Pre-executes enum `ADD VALUE` statements outside any migration transaction.
 *
 * Skips statements whose enum type does not exist yet (fresh databases where the type is
 * created in an earlier migration folder).
 */
export async function preCommitEnumStatements(statements: string[]): Promise<void> {
  if (statements.length === 0) return;

  const { db } = await import("@/backend/db");
  const { sql } = await import("drizzle-orm");

  // Sequential execution is required: statements may target the same enum type,
  // and PostgreSQL does not allow concurrent `ALTER TYPE ... ADD VALUE` operations.
  // `reduce` chains the promises so each statement awaits the previous one.
  await statements.reduce<Promise<void>>(async (previous, stmt) => {
    await previous;
    const typeMatch = /\bALTER\s+TYPE\s+("?(\w+)"?)\s+ADD\s+VALUE/i.exec(stmt);
    const typeName = typeMatch?.[2];
    if (!typeName) return;

    if (!(await enumTypeExists(typeName))) return;

    try {
      await db.execute(sql.raw(stmt));
    } catch (err) {
      logger.warn(`Failed to pre-commit enum statement "${stmt}":`, err);
    }
  }, Promise.resolve());
}

/**
 * Pre-commits enum additions declared in a single migration file before that folder runs.
 */
export async function preCommitEnumStatementsForMigrationFile(migrationPath: string): Promise<void> {
  if (!existsSync(migrationPath)) return;

  const content = readFileSync(migrationPath, "utf8");
  const statements = extractEnumAddValueStatementsFromSql(content);
  if (statements.length === 0) return;

  logger.info(
    `Ensure Enum Values Committed: Pre-executing ${statements.length} enum addition(s) from ${migrationPath}...`
  );
  await preCommitEnumStatements(statements);
}

/**
 * Scans all migration SQL files and pre-commits enum additions (legacy bulk entry point).
 *
 * Prefer {@link preCommitEnumStatementsForMigrationFile} per migration folder via
 * {@link runDrizzleMigrations}, which handles fresh databases correctly.
 */
export async function ensureEnumValuesCommitted(): Promise<void> {
  if (!existsSync(DRIZZLE_DIR)) return;

  const folders = readdirSync(DRIZZLE_DIR).filter(f => {
    try {
      return statSync(join(DRIZZLE_DIR, f)).isDirectory();
    } catch {
      return false;
    }
  });

  // Migration folders must be processed in order; chain the promises to keep
  // sequential execution without awaiting inside a loop construct.
  await folders.reduce<Promise<void>>(async (previous, folder) => {
    await previous;
    const sqlPath = join(DRIZZLE_DIR, folder, "migration.sql");
    await preCommitEnumStatementsForMigrationFile(sqlPath);
  }, Promise.resolve());
}
