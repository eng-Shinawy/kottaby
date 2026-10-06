/**
 * SessionRepository participant-name batch read — the ONE `inArray`
 * membership read behind the participant session lists, co-located as its
 * own sibling helper module (the same extraction pattern as the wave/gate
 * helpers; nothing else fit its shape: a closed two-column projection with
 * no shared predicate). The public surface stays the `SessionRepository`
 * namespace in `session.repository.ts`: this module backs the namespace's
 * `listNamesByIds` method as a one-to-one delegation target. Nothing in
 * this module is part of the public API.
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
 *    caller decides what the resolved names mean.
 */

import { inArray } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { queryDb } from "@/backend/db";
import { users } from "@/backend/db/schema/users/users";
import type { DBTransaction, SessionParticipantNameRowType } from "@/backend/types";

/**
 * Batch read of participant display names: `{ id, fullName }` for every id
 * in `ids` (duplicates collapse harmlessly in the caller's map — the read
 * itself is a plain `IN` membership over the shared `users` PK).
 *
 * `users.full_name` is NOT NULL at the schema, so the projection is a
 * closed non-nullable pair. An EMPTY id list answers `[]` WITHOUT any
 * database round-trip (an empty `IN ()` is not even formed). On the
 * caller's transaction it runs as a Drizzle select; standalone the
 * membership predicate renders to parameterized SQL with INDIVIDUAL `$n`
 * placeholders (never an array parameter, never a prepared statement) and
 * executes via `queryDb`. No dedup and no ordering contract: the caller
 * keys the rows by id.
 *
 * @param ids  The user ids to resolve (an empty list short-circuits to
 *     `[]` pre-DB).
 * @param tx  Optional transaction — propagated to the read.
 */
export async function listNamesByIds(ids: number[], tx?: DBTransaction): Promise<SessionParticipantNameRowType[]> {
  if (ids.length === 0) {
    return [];
  }
  if (tx) {
    return tx.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, ids));
  }
  // Standalone read — the membership predicate renders to individual bound
  // parameters and executes via the queryDb pool path.
  const rendered = new PgDialect().sqlToQuery(inArray(users.id, ids));
  const result = await queryDb<SessionParticipantNameRowType>(
    `SELECT id, full_name AS "fullName" FROM users WHERE ${rendered.sql}`,
    rendered.params
  );
  return result.rows;
}
