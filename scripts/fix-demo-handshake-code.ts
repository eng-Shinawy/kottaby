/**
 * One-off: regenerate the demo student's handshake_code in the canonical
 * `KSB-<8 hex>` shape (mirrors user-provisioning.helpers generateHandshakeCode).
 * The target is the ui-audit-seed demo student (`student@demo.local`) —
 * resolved by its stable identity email, never by a positional
 * `SELECT ... LIMIT 1` (the shared db/pglite database can hold several
 * students; a positional pick can update the wrong row).
 * Run while the dev server is STOPPED.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const DEMO_STUDENT_EMAIL = "student@demo.local";

const pg = new PGlite("file://" + join(process.cwd(), "db/pglite"));
const code = `KSB-${randomUUID().replace(/-/g, "").toUpperCase().slice(0, 8)}`;
const r = await pg.query<{ id: number; handshake_code: string }>(
  `UPDATE students SET handshake_code = $1, updated_at = now()
   WHERE id = (SELECT s.id FROM students s JOIN users u ON u.id = s.id WHERE u.email = $2)
   RETURNING id, handshake_code`,
  [code, DEMO_STUDENT_EMAIL]
);
const row = r.rows[0];
if (!row) throw new Error(`demo student not found (${DEMO_STUDENT_EMAIL}) — nothing updated`);
console.log("updated:", JSON.stringify(row));
await pg.close();
