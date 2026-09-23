import type { recitation } from "@/backend/db/schema/classes/recitation";

export type RecitationSelectType = typeof recitation.$inferSelect;
export type RecitationInsertType = typeof recitation.$inferInsert;

/**
 * Canonical GraphQL/API read shape for a recitation row.
 *
 * Derived straight from the table's select row — identical to
 * `RecitationSelectType`. The schema columns flow through with no
 * Omit/re-typing. No forbidden fields exist on this table: the owning
 * session id is already known to every authorized viewer of the row by
 * construction, and the two content columns are the row's read payload.
 */
export type RecitationReturnType = typeof recitation.$inferSelect;

/**
 * Recitation submission input: the client-controlled whitelist ONLY (BOPLA).
 *
 * The recitation text recorded against a session — a short label and
 * optional free-form notes. Every server-controlled column is structurally
 * absent by construction — row identity, the owning session (resolved from
 * the session lifecycle by the producing service), and timestamps are
 * resolved or written server-side. A client payload structurally cannot
 * carry, spoof, or influence any of them; `description` is submitted as an
 * explicit string or `null`, never `undefined`.
 */
export interface SessionRecitationSubmitInput {
  readonly name: string;
  readonly description: string | null;
}
