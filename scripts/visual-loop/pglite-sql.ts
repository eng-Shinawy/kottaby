/**
 * Run a read-only SQL query against the local PGlite data dir (db/pglite).
 * ONLY safe to run while the dev server is NOT holding the data dir.
 *
 * Usage: bun run scripts/visual-loop/pglite-sql.ts "SELECT ..."
 */

import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const DB_URL = "file://" + join(process.cwd(), "db/pglite");
const sql = process.argv[2] ?? "SELECT 1";

const pg = new PGlite(DB_URL);
try {
  const res = await pg.query(sql);
  console.log(JSON.stringify(res.rows, null, 2));
} finally {
  await pg.close();
}
