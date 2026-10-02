/**
 * Run a WRITE SQL statement against the local PGlite data dir (db/pglite).
 * ONLY safe to run while the dev server is NOT holding the data dir.
 *
 * Usage: bun run scripts/visual-loop/pglite-exec.ts "UPDATE ..."
 */

import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const DB_URL = "file://" + join(process.cwd(), "db/pglite");
const sql = process.argv[2] ?? "SELECT 1";

const pg = new PGlite(DB_URL);
try {
  const res = await pg.exec(sql);
  // `exec` returns one Results object PER statement — take the first.
  const first = Array.isArray(res) ? res[0] : res;
  const rows = first && typeof first === "object" && "rows" in first ? first.rows : null;
  console.log("OK", JSON.stringify(rows ?? res ?? null).slice(0, 400));
} finally {
  await pg.close();
}
