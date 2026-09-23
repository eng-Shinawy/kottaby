/**
 * RecitationRepository — data-access layer for the `recitation` table.
 *
 * The `recitation` row is the write-once companion of a `session`: the
 * owning `session_id` is NOT NULL, cascades on session deletion, and is
 * UNIQUE (`recitation_session_id_unique`) — one recitation record per
 * session, enforced by the database itself. The repository mirrors that
 * contract with a deliberately CLOSED two-method surface: a single
 * insert primitive and a single lookup. There is intentionally NO update,
 * replace, or delete method — a stored record is permanent, and the
 * unique constraint is the arbiter of the write-once rule: a second
 * insert for an already-recorded session surfaces the RAW driver `23505`
 * untranslated, and the CALLER (service layer) owns the mapping of that
 * violation into a domain error.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - One `namespace` per repository file; the namespace name is the
 *    canonical export.
 *  - Every method takes the transaction executor as its LAST parameter.
 *    The insert runs on the caller's transaction when supplied and falls
 *    back to the global `db` handle otherwise (`tx ?? db`, the same
 *    single-statement write shape `SessionRepository.insertSession`
 *    uses). The lookup runs as a Drizzle select on the caller's
 *    executor and falls back to raw parameterized SQL via `queryDb`
 *    (the Neon-HTTP-eligible bare-read pattern, as in
 *    `TeacherRepository.findById`) when called standalone.
 *  - NO prepared statements — the write is excluded by definition
 *    (`docs/drizzle/prepared-statements.md`) and the standalone read
 *    branch runs on the `queryDb` pool path. The read predicate is a
 *    single parameterized equality (`$1`) — no LIKE/ILIKE, no string
 *    interpolation, no SQL line-comment sequences.
 *  - Types flow from `backend/types` (`RecitationInsertType` /
 *    `RecitationSelectType`), never raw schema derivations.
 *  - No business logic, no permission checks, no i18n or logging — the
 *    caller decides what `null` (miss) or a `23505` (duplicate) means.
 */

import { eq } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { recitation } from "@/backend/db/schema/classes/recitation";
import type { DBQueryExecutor, DBTransaction, RecitationInsertType, RecitationSelectType } from "@/backend/types";

/**
 * Type guard — narrows `DBQueryExecutor` to `DBTransaction`.
 *
 * `DBTransaction` (Drizzle's transaction handle) exposes the `.select()`
 * builder API; raw `Pool` / `PoolClient` from `pg` do not. The presence of
 * `.select` therefore distinguishes the two at runtime without an unsafe
 * cast.
 */
function isDBTransaction(tx: DBQueryExecutor): tx is DBTransaction {
  return typeof tx === "object" && "select" in tx;
}

export namespace RecitationRepository {
  /**
   * Inserts the one recitation record for a session and returns the
   * created row (`INSERT … RETURNING`).
   *
   * The payload is the mapped insert DTO exactly as handed over: the
   * owning session id is resolved by the caller (the session lifecycle),
   * never derived or overridden here, and schema defaults fill the
   * identity and audit columns. The statement is a single INSERT — no
   * read-then-write window — so the per-session uniqueness is decided
   * atomically by `recitation_session_id_unique`: a duplicate insert
   * surfaces the RAW driver `23505` violation unchanged, with NO
   * translation or wrapping at this layer (the service layer owns
   * mapping it to a domain conflict).
   *
   * @returns The inserted row with all server-generated columns populated.
   */
  export async function insertOnce(insert: RecitationInsertType, tx?: DBTransaction): Promise<RecitationSelectType> {
    const executor = tx ?? db;
    const [row] = await executor.insert(recitation).values(insert).returning();
    if (!row) {
      throw new Error("RecitationRepository.insertOnce: insert returned no rows");
    }
    return row;
  }

  /**
   * Finds the recitation record of a session (the 1:1 read).
   *
   * Read-only: on the caller's transaction executor it runs as a Drizzle
   * select; standalone it runs as raw parameterized SQL via `queryDb`.
   *
   * @returns The matching recitation row, or `null` when the session
   *          carries no record yet — a miss is a normal outcome here
   *          (read-before-write), never an error, and distinguishing a
   *          sessionless id from an unrecorded session is the caller's
   *          decision.
   */
  export async function findBySessionId(sessionId: number, tx?: DBQueryExecutor): Promise<RecitationSelectType | null> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      const rows = await tx.select().from(recitation).where(eq(recitation.sessionId, sessionId)).limit(1);
      return rows[0] ?? null;
    }
    // Standalone read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<RecitationSelectType>(
      `SELECT id,
              session_id AS "sessionId",
              name,
              description,
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM recitation WHERE session_id = $1 LIMIT 1`,
      [sessionId]
    );
    return result.rows[0] ?? null;
  }
}
