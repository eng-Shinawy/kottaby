import type { Interface } from "node:readline";
import { cleanGenerate } from "@/scripts/dbActions/cleanGenerate";
import {
  isDestructiveActionBlocked,
  isPermanentlyDisabled,
  printDestructiveActionBlock,
  printPermanentlyDisabledBlock,
} from "@/scripts/dbActions/destructive";
import { drizzleConfigPathForDialect, resolveDialectFromSelectedEnvFile } from "@/scripts/dbActions/dialect";
import { ensureExtensions } from "@/scripts/dbActions/ensureExtensions";
import { getSelectedEnvFile } from "@/scripts/dbActions/envFile";
import { generateMigrations } from "@/scripts/dbActions/generate";
import { runBunCommand } from "@/scripts/dbActions/runCommand";

export const ACTIONS: Record<string, { label: string; name: string }> = {
  "1": { label: "Reset Database", name: "reset" },
  "2": { label: "Seed Database", name: "seed" },
  "3": { label: "Generate Drizzle Schema", name: "generate" },
  "4": { label: "Drop Drizzle Schema", name: "drop" },
  "5": { label: "Run Migrations", name: "migrate" },
  "6": { label: "Push Schema to DB", name: "push" },
  "7": { label: "Open Drizzle Studio", name: "studio" },
  "8": { label: "Clean Generate (Reset -> Gen -> Migrate -> Seed)", name: "cleanGenerate" },
};

/**
 * Asks a question to the user.
 */
export async function askQuestion(rl: Interface, query: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(query, answer => {
      resolve(answer);
    });
  });
}

/**
 * Dispatches the action based on internal key (1-8).
 */
export async function dispatchAction(key: string): Promise<number> {
  // Check for permanently disabled actions first
  if (isPermanentlyDisabled(key)) {
    printPermanentlyDisabledBlock(key);
    return 1;
  }

  if (isDestructiveActionBlocked(key)) {
    printDestructiveActionBlock();
    return 1;
  }

  // Resolve the active dialect from the selected env file (default postgres).
  // SQLite uses drizzle.config.sqlite.ts + backend/drizzle-sqlite/; skips PG-only steps.
  const dialect = resolveDialectFromSelectedEnvFile(getSelectedEnvFile);
  const configPath = drizzleConfigPathForDialect(dialect);

  switch (key) {
    case "1":
      return runBunCommand(["run", "backend/db/scripts/resetDb.ts"]);
    case "2":
      return runBunCommand(["run", "backend/db/scripts/drizzleSeed.ts"]);
    case "3":
      return generateMigrations();
    case "4":
      return runBunCommand(["drizzle-kit", "drop", "--config", configPath]);
    case "5":
      return runBunCommand(["run", "backend/db/scripts/migrate.ts"]);
    case "6":
      // ensureExtensions applies pg_trgm + is_valid_timezone (PG-only); skip for sqlite.
      if (dialect === "postgres") {
        await ensureExtensions();
      }
      return runBunCommand(["drizzle-kit", "push", "--force", "--config", configPath]);
    case "7":
      return runBunCommand(["drizzle-kit", "studio", "--config", configPath]);
    case "8":
      return cleanGenerate();
    default:
      globalThis.console.error(`Invalid action key: "${key}". Please select a valid option.`);
      return 1;
  }
}

/**
 * Handles the execution of an action by its key (1-8).
 * Returns process exit code (0 = success, 1 = failure or blocked).
 */
export async function executeAction(key: string, rl?: Interface): Promise<number> {
  const action = ACTIONS[key];
  if (!action) return 1;

  // Check for permanently disabled actions first
  if (isPermanentlyDisabled(key)) {
    globalThis.console.log(`\nRunning: ${action.label}...\n`);
    printPermanentlyDisabledBlock(key);
    globalThis.console.log("\n✗ Failed (code 1)");

    if (rl) {
      await askQuestion(rl, "\nPress Enter to continue...");
    }
    return 1;
  }

  if (isDestructiveActionBlocked(key)) {
    globalThis.console.log(`\nRunning: ${action.label}...\n`);
    printDestructiveActionBlock();
    globalThis.console.log("\n✗ Failed (code 1)");

    if (rl) {
      await askQuestion(rl, "\nPress Enter to continue...");
    }
    return 1;
  }

  globalThis.console.log(`\nRunning: ${action.label}...\n`);
  const code = await dispatchAction(key);
  globalThis.console.log(code === 0 ? "\n✓ Success" : `\n✗ Failed (code ${code})`);

  if (rl) {
    await askQuestion(rl, "\nPress Enter to continue...");
  }

  return code;
}

/**
 * Finds action key by name or flag.
 */
export function findActionKey(input: string): string | undefined {
  const normalized = input.startsWith("--") ? input.slice(2) : input;
  for (const [key, action] of Object.entries(ACTIONS)) {
    if (action.name === normalized) {
      return key;
    }
  }
  return undefined;
}
