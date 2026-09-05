/**
 * SessionRequestIdempotencyRepository — data-access layer for the
 * `session_request_idempotency` claim table.
 *
 * A claim is the durable record that an idempotency key has already been
 * spent on a booking: the producing service inserts it IN-PHASE with the
 * session insert (transactional fate-sharing), so a replayed request either
 * joins the same transaction (duplicate claim insert → PostgreSQL
 * unique-violation, code `23505`) or — after the original committed — finds
 * the claim by key and replays the already-created session id.
 *
 * The `23505` raised by a duplicate `insertClaim` is deliberately NOT
 * caught or translated here: it bubbles to the service's cause-chain
 * handler, which traverses the Drizzle error wrapper (`cause` chain, never
 * the top-level message) and decides between the duplicate-conflict and
 * replay outcomes. This repository stays a pure data-access surface.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - One `namespace` per repository file; the namespace name is the
 *    canonical export.
 *  - Every method takes `tx?: DBTransaction` as its LAST parameter. Reads
 *    run on the caller's transaction when supplied and fall back to raw
 *    parameterized SQL via `queryDb` (the Neon-HTTP-eligible pattern)
 *    otherwise; writes execute on `tx ?? db`.
 *  - NO prepared statements and NO array-membership operators — the key is
 *    an opaque bound parameter in every statement. The key is never logged,
 *    never coerced, and carried verbatim (≤128 chars, DB-enforced).
 *  - No business logic, no permission checks, no i18n or logging imports —
 *    the caller decides what a miss means.
 */

import { eq } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import type {
  DBTransaction,
  SessionRequestIdempotencyInsertType,
  SessionRequestIdempotencySelectType,
} from "@/backend/types";

/** Column alias list for standalone reads — mirrors `$inferSelect` typing 1:1. */
const CLAIM_SELECT_COLUMNS = `
  id, idempotency_key AS "idempotencyKey", user_id AS "userId",
  session_id AS "sessionId", created_at AS "createdAt"`;

export namespace SessionRequestIdempotencyRepository {
  /**
   * Inserts one idempotency claim row and returns it
   * (`INSERT … RETURNING`).
   *
   * The caller supplies the raw opaque key (the `x-idempotency-key` header
   * value, carried verbatim) and the claiming user; `sessionId` is left
   * null at claim time and backfilled by `updateClaimSessionId` once the
   * session row exists, and the schema default stamps `createdAt`. A
   * duplicate key violates `session_request_idempotency_key_unique` and
   * raises PostgreSQL `23505`, which this method does NOT catch — the error
   * bubbles to the service cause-chain handler exactly as the driver
   * produced it (constraint name, schema, and diagnostic intact).
   *
   * @returns The inserted claim row with all server-generated columns
   *          populated.
   */
  export async function insertClaim(
    insert: SessionRequestIdempotencyInsertType,
    tx?: DBTransaction
  ): Promise<SessionRequestIdempotencySelectType> {
    const executor = tx ?? db;
    const [row] = await executor.insert(sessionRequestIdempotency).values(insert).returning();
    if (!row) {
      throw new Error("SessionRequestIdempotencyRepository.insertClaim: insert returned no rows");
    }
    return row;
  }

  /**
   * Backfills the session id onto an existing claim (the creation flow's
   * final write: claim insert → session insert → this backfill, all in
   * ONE transaction). The key itself is never re-written — only the
   * nullable `session_id` pointer, so the claim's duplicate-blocking
   * identity is untouched.
   *
   * @throws The defensive invariant when zero rows matched — inside the
   *         creation flow this is unreachable (the claim was inserted in
   *         the same transaction) and can only mean a broken contract.
   */
  export async function updateClaimSessionId(claimId: number, sessionId: number, tx?: DBTransaction): Promise<void> {
    const executor = tx ?? db;
    const rows = await executor
      .update(sessionRequestIdempotency)
      .set({ sessionId })
      .where(eq(sessionRequestIdempotency.id, claimId))
      .returning({ id: sessionRequestIdempotency.id });
    if (!rows[0]) {
      throw new Error("SessionRequestIdempotencyRepository.updateClaimSessionId: update matched no rows");
    }
  }

  /**
   * Finds a claim row by its opaque idempotency key — the replay-branch
   * lookup. The key is an equality-bound parameter in both executor
   * branches: never interpolated, never logged, never coerced or
   * truncated.
   *
   * @returns The matching claim row (with the replayed `sessionId` when the
   *          backfill landed), or `null` when the key is unclaimed. Whether
   *          the claiming user matches the replaying caller is the
   *          service's decision — this method is the raw key read.
   */
  export async function findByKey(
    key: string,
    tx?: DBTransaction
  ): Promise<SessionRequestIdempotencySelectType | null> {
    if (tx) {
      const rows = await tx
        .select()
        .from(sessionRequestIdempotency)
        .where(eq(sessionRequestIdempotency.idempotencyKey, key))
        .limit(1);
      return rows[0] ?? null;
    }
    const result = await queryDb<SessionRequestIdempotencySelectType>(
      `SELECT ${CLAIM_SELECT_COLUMNS}
       FROM session_request_idempotency WHERE idempotency_key = $1 LIMIT 1`,
      [key]
    );
    return result.rows[0] ?? null;
  }
}
