import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyCustomMigrations } from "@/backend/db/scripts/applyCustomMigrations";
import { ensureIdempotentMigrations } from "@/backend/db/scripts/ensureIdempotentMigrations";
import { drizzleConfigPathForDialect, resolveDialectFromSelectedEnvFile } from "@/scripts/dbActions/dialect";
import { getSelectedEnvFile } from "@/scripts/dbActions/envFile";
import { runBunCommand } from "@/scripts/dbActions/runCommand";
import { withStatementBreakpoints } from "@/scripts/dbActions/sqlBreakpoints";

const DRIZZLE_DIR = "./backend/drizzle";
const EXTENSIONS_SQL_PATH = "backend/db/migration/1-extensions.sql";

/**
 * Generates a custom migration and populates it with SQL content from a source file.
 */
export async function generateCustomMigration(
  sqlFilePath: string,
  customName: string,
  configPath: string
): Promise<number> {
  const result = await runBunCommand([
    "drizzle-kit",
    "generate",
    "--custom",
    `--name=${customName}`,
    "--config",
    configPath,
  ]);
  if (result !== 0) return result;

  if (!existsSync(DRIZZLE_DIR)) {
    globalThis.console.error(`Drizzle directory "${DRIZZLE_DIR}" not found after custom generation`);
    return 1;
  }

  const folders = readdirSync(DRIZZLE_DIR).filter(f => statSync(join(DRIZZLE_DIR, f)).isDirectory());
  const targetFolder = folders.find(f => f.endsWith(`_${customName}`));
  if (!targetFolder) {
    globalThis.console.error(`Could not find generated folder for "${customName}" in ${DRIZZLE_DIR}`);
    return 1;
  }

  const migrationFile = join(DRIZZLE_DIR, targetFolder, "migration.sql");
  const sqlContent = withStatementBreakpoints(readFileSync(sqlFilePath, "utf8"));
  writeFileSync(migrationFile, sqlContent);
  globalThis.console.log(`✓ Updated ${migrationFile} with content from ${sqlFilePath}`);
  return 0;
}

/**
 * Checks if the extensions custom migration exists in the drizzle folder.
 */
function hasExtensionsMigration(): boolean {
  if (!existsSync(DRIZZLE_DIR)) return false;
  const folders = readdirSync(DRIZZLE_DIR).filter(f => statSync(join(DRIZZLE_DIR, f)).isDirectory());
  return folders.some(f => f.endsWith("_extensions"));
}

/**
 * Custom Generate workflow:
 * 1. For PostgreSQL:
 *    - If extensions migration doesn't exist yet and 1-extensions.sql is present,
 *      generate the custom extensions migration first (so base schema can depend on it).
 *    - Run standard Drizzle Kit generate for schema diffs.
 *    - Auto-bundle pending custom SQL files (functions, triggers, RLS) via applyCustomMigrations().
 *    - Ensure all generated migrations are idempotent via ensureIdempotentMigrations().
 * 2. For SQLite:
 *    - Run standard Drizzle Kit generate with sqlite config.
 */
export async function generateMigrations(): Promise<number> {
  const dialect = resolveDialectFromSelectedEnvFile(getSelectedEnvFile);
  const configPath = drizzleConfigPathForDialect(dialect);

  globalThis.console.log(`\n[Generate] Starting migration generation (dialect: ${dialect}, config: ${configPath})...`);

  if (dialect === "postgres") {
    // 1. Extensions prerequisite
    if (!hasExtensionsMigration() && existsSync(EXTENSIONS_SQL_PATH)) {
      globalThis.console.log("[Generate] Generating prerequisite extensions migration...");
      const extCode = await generateCustomMigration(EXTENSIONS_SQL_PATH, "extensions", configPath);
      if (extCode !== 0) {
        globalThis.console.error("[Generate] Failed to generate extensions migration.");
        return extCode;
      }
    }

    // 2. Normal schema diff generation
    globalThis.console.log("[Generate] Generating schema migration via Drizzle Kit...");
    const schemaCode = await runBunCommand(["drizzle-kit", "generate", "--ignore-conflicts", "--config", configPath]);
    if (schemaCode !== 0) {
      globalThis.console.error("[Generate] Failed to generate schema migration.");
      return schemaCode;
    }

    // 3. Auto-bundle custom migrations (functions, triggers, RLS, etc.)
    globalThis.console.log("[Generate] Checking and bundling custom SQL migrations...");
    try {
      const bundled = applyCustomMigrations();
      if (bundled.length > 0) {
        globalThis.console.log(`[Generate] Auto-bundled ${bundled.length} custom migration(s): ${bundled.join(", ")}`);
      } else {
        globalThis.console.log("[Generate] No new custom migrations to bundle.");
      }
    } catch (err) {
      globalThis.console.error("[Generate] Failed to bundle custom migrations:", err);
      return 1;
    }

    // 4. Ensure idempotency for all migrations
    globalThis.console.log("[Generate] Ensuring migration idempotency...");
    ensureIdempotentMigrations();

    globalThis.console.log("✓ [Generate] Migration generation completed successfully.\n");
    return 0;
  }

  // SQLite dialect
  globalThis.console.log("[Generate] Generating SQLite schema migration via Drizzle Kit...");
  const sqliteCode = await runBunCommand(["drizzle-kit", "generate", "--ignore-conflicts", "--config", configPath]);
  if (sqliteCode !== 0) {
    globalThis.console.error("[Generate] Failed to generate SQLite schema migration.");
    return sqliteCode;
  }

  globalThis.console.log("✓ [Generate] SQLite migration generation completed successfully.\n");
  return 0;
}
