import { existsSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { drizzleConfigPathForDialect, resolveDialectFromSelectedEnvFile } from "@/scripts/dbActions/dialect";
import { getSelectedEnvFile } from "@/scripts/dbActions/envFile";
import { generateCustomMigration } from "@/scripts/dbActions/generate";
import { runBunCommand } from "@/scripts/dbActions/runCommand";

/**
 * Performs a clean generation of migrations.
 */
export async function cleanGenerate(): Promise<number> {
  // 0. Clear existing migrations for a truly clean start
  globalThis.console.log("Clearing existing migrations in backend/drizzle...");
  const drizzleDir = "./backend/drizzle";
  if (existsSync(drizzleDir)) {
    rmSync(drizzleDir, { recursive: true, force: true });
  }

  const dialect = resolveDialectFromSelectedEnvFile(getSelectedEnvFile);
  const configPath = drizzleConfigPathForDialect(dialect);

  // 1. Reset Database (drop/create only — migrations are regenerated and applied below)
  globalThis.console.log("Resetting database (drop/create only)...");
  const resetCode = await runBunCommand(["run", "backend/db/scripts/resetDb.ts", "--skip-migrate"]);
  if (resetCode !== 0) return resetCode;

  // 2. Extensions
  globalThis.console.log("\nGenerating extensions migration...");
  let code = await generateCustomMigration("backend/db/migration/1-extensions.sql", "extensions", configPath);
  if (code !== 0) return code;

  // 3. Normal migration
  globalThis.console.log("\nGenerating normal migration...");
  code = await runBunCommand(["drizzle-kit", "generate", "--ignore-conflicts", "--config", configPath]);
  if (code !== 0) return code;

  // 4. Combine all other migrations into a single temporary file
  const migrationsDir = "backend/db/migration";
  const customFiles = readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql") && f !== "1-extensions.sql")
    .toSorted((a, b) => a.localeCompare(b));

  if (customFiles.length > 0) {
    globalThis.console.log(`\nCombining ${customFiles.length} custom migrations into one...`);
    const tempCombinedFile = join(migrationsDir, "temp_combined_custom.sql_ignore");

    try {
      let combinedContent = "";
      for (const file of customFiles) {
        const content = readFileSync(join(migrationsDir, file), "utf8");
        combinedContent += `-- Source: ${file}\n${content}\n\n`;
      }

      writeFileSync(tempCombinedFile, combinedContent);

      globalThis.console.log("Generating single custom migration for all custom logic...");
      code = await generateCustomMigration(tempCombinedFile, "combined_custom_logic", configPath);
      if (code !== 0) return code;
    } finally {
      if (existsSync(tempCombinedFile)) {
        globalThis.console.log("Cleaning up temporary migration file...");
        unlinkSync(tempCombinedFile);
      }
    }
  }

  // 5. Apply migrations
  globalThis.console.log("\nApplying all migrations...");
  code = await runBunCommand(["run", "backend/db/scripts/migrate.ts"]);
  if (code !== 0) {
    globalThis.console.warn("⚠️  Migration failed. Seeding might fail if tables are missing.");
  }

  // 6. Seed
  // globalThis.console.log("\nSeeding database...");
  // code = await runBunCommand(["run", "backend/db/scripts/drizzleSeed.ts"]);
  // if (code !== 0) return code;

  return 0;
}
