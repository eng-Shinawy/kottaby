/**
 * SessionRepository PK batch read — the ONE `inArray` membership read over
 * `session.id` (the session-side twin of the participant-name batch over
 * `users.id`), co-located as its own sibling helper module (the same
 * extraction pattern as the names helper; nothing else fit its shape: a
 * full-row PK membership read reusing the read machinery's shared standalone
 * column shape). The public surface stays the `SessionRepository` namespace
 * in `session.repository.ts`: this module backs the namespace's `findByIds`
 * method as a one-to-one delegation target. Nothing in this module is part
 * of the public API.
 *
 * Conventions carried over unchanged (per `backend/db/repo/AGENTS.md`):
 *  - the function takes `tx?: DBTransaction` as its LAST parameter. The
 *    read runs on the caller's transaction when supplied and falls back to
 *    raw parameterized SQL via `queryDb` (the Neon-HTTP-eligible pattern)
 *    otherwise;
 *  - the `inArray` membership is a DYNAMIC query, never a prepared
 *    statement (PostgreSQL's prepared-statement protocol cannot expand
 *    array parameters — the exact limitation the repo AGENTS.md documents);
 *  - no business logic, no permission checks, no i18n or logging — the
 *    caller decides what a missing id means.
 */

import { inArray } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { queryDb } from "@/backend/db";
import { SESSION_SELECT_COLUMNS } from "@/backend/db/repo/classes/session.repository.helpers";
import { session } from "@/backend/db/schema/classes/session";
import type { DBTransaction, SessionSelectType } from "@/backend/types";

/**
 * Batch read of session rows by primary key: every row whose id is in
 * `sessionIds` (the admin drill-down's owning-session context resolution —
 * N per-id reads collapse into ONE membership query). An EMPTY id list
 * answers `[]` WITHOUT any database round-trip (an empty `IN ()` is not
 * even formed). On the caller's transaction it runs as a Drizzle select;
 * standalone the membership predicate renders to parameterized SQL with
 * INDIVIDUAL `$n` placeholders (never an array parameter, never a prepared
 * statement) over the shared standalone column shape. No dedup and no
 * ordering contract: the caller keys the rows by id; a missing id is the
 * caller's fail-closed signal, never fabricated here.
 *
 * @param sessionIds  The session ids to resolve (an empty list short-circuits
 *     to `[]` pre-DB).
 * @param tx  Optional transaction — propagated to the read.
 */
export async function findByIds(sessionIds: readonly number[], tx?: DBTransaction): Promise<SessionSelectType[]> {
  if (sessionIds.length === 0) {
    return [];
  }
  if (tx) {
    return tx
      .select()
      .from(session)
      .where(inArray(session.id, [...sessionIds]));
  }
  const rendered = new PgDialect().sqlToQuery(inArray(session.id, [...sessionIds]));
  const result = await queryDb<SessionSelectType>(
    `SELECT ${SESSION_SELECT_COLUMNS} FROM session WHERE ${rendered.sql}`,
    rendered.params
  );
  return result.rows;
}
