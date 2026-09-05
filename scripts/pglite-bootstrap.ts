/**
 * Apply all drizzle migrations to a fresh PGlite instance.
 * Reads migration.sql files in order from backend/drizzle/<timestamp>_<name>/
 * and executes them inside PGlite (single-connection WASM Postgres).
 *
 * Usage: bun run scripts/pglite-bootstrap.ts
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = "/home/z/my-project/backend/drizzle";
const DB_URL = "file:///home/z/my-project/db/pglite";

async function main() {
  console.log("[pglite-bootstrap] Opening PGlite at", DB_URL);
  const pg = new PGlite(DB_URL);

  // Ensure drizzle migrations tracking table
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    );
  `);

  const entries = readdirSync(MIGRATIONS_DIR)
    .filter(name => {
      const stat = statSync(join(MIGRATIONS_DIR, name));
      return stat.isDirectory();
    })
    .sort();

  let applied = 0;
  for (const dir of entries) {
    const migrationFile = join(MIGRATIONS_DIR, dir, "migration.sql");
    try {
      const sql = readFileSync(migrationFile, "utf-8");
      // PGlite executes multiple statements OK with exec()
      // Split on --> statement-breakpoint to be safe
      const statements = sql
        .split("--> statement-breakpoint")
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith("--"));

      for (const stmt of statements) {
        try {
          await pg.exec(stmt);
        } catch (e) {
          const msg = String((e instanceof Error ? e.message : null) ?? e);
          // Tolerate "already exists" errors (re-running migrations)
          if (/already exists|duplicate_|conflicts with/i.test(msg)) {
            // continue
          } else {
            throw new Error(`In ${dir}: ${msg}\n---Statement---\n${stmt.slice(0, 200)}`);
          }
        }
      }
      applied++;
      console.log(`[pglite-bootstrap] Applied: ${dir}`);
    } catch (e) {
      console.error(
        `[pglite-bootstrap] FAILED: ${dir} — ${String((e instanceof Error ? e.message : null) ?? e).slice(0, 300)}`
      );
    }
  }

  // Also apply custom immutability triggers + functions if present
  const customFiles = [
    "/home/z/my-project/backend/db/migration/1-extensions.sql",
    "/home/z/my-project/backend/db/migration/2-functions.sql",
    "/home/z/my-project/backend/db/migration/3-immutability-triggers.sql",
  ];
  for (const file of customFiles) {
    try {
      const sql = readFileSync(file, "utf-8");
      await pg.exec(sql);
      console.log(`[pglite-bootstrap] Applied custom: ${file.split("/").pop()}`);
    } catch (e) {
      const msg = String((e instanceof Error ? e.message : null) ?? e);
      if (/already exists|duplicate_/i.test(msg)) {
        // continue
      } else {
        console.warn(`[pglite-bootstrap] Custom ${file.split("/").pop()} warning: ${msg.slice(0, 200)}`);
      }
    }
  }

  console.log(`[pglite-bootstrap] DONE — ${applied} drizzle migrations applied`);
  await pg.close();
}

main().catch(e => {
  console.error("[pglite-bootstrap] FATAL:", e);
  process.exit(1);
});
