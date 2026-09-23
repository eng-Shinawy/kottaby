/**
 * ParentRepository — data-access layer for the `parents` role-child table.
 *
 * The `parents` row shares its PK with `users.id` (FK ON DELETE CASCADE).
 * Parent-child linking happens later via the `students.parent_id` FK; at
 * registration time we only create the empty parent row to
 * establish the persistence home.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - Writes take a REQUIRED `tx: DBTransaction` (last param) — every insert
 *    must run inside a caller-supplied transaction so registration flows can
 *    guarantee atomicity.
 *  - Reads take an OPTIONAL `tx?: DBQueryExecutor`: Drizzle select on the
 *    supplied transaction, or raw parameterized SQL via `queryDb` (the
 *    bare-reads rule) when called standalone.
 *  - No business logic, no permission checks — the owning user's role and
 *    identity are validated by the service layer; this repo certifies only
 *    the existence of the role-child row itself.
 */
import { eq } from "drizzle-orm";
import { queryDb } from "@/backend/db";
import { parents } from "@/backend/db/schema/parents/parents";
import type { DBQueryExecutor, DBTransaction, ParentSelectType } from "@/backend/types";

/**
 * Type guard — narrows `DBQueryExecutor` to `DBTransaction`.
 *
 * `DBTransaction` (Drizzle's `PgAsyncTransaction`) exposes the `.select()`
 * builder API; raw `Pool` / `PoolClient` from `pg` do not. The presence of
 * `.select` therefore distinguishes the two at runtime without an unsafe
 * cast.
 */
function isDBTransaction(tx: DBQueryExecutor): tx is DBTransaction {
  return typeof tx === "object" && "select" in tx;
}

export namespace ParentRepository {
  /**
   * Inserts a `parents` row for a freshly-created user during registration.
   *
   * The row carries only the shared PK + timestamps (schema defaults); all
   * parent-child relationships are established by later flows.
   *
   * @returns The inserted parent row.
   */
  export async function createForRegistration(userId: number, tx: DBTransaction): Promise<ParentSelectType> {
    const [row] = await tx.insert(parents).values({ id: userId }).returning();
    if (!row) {
      throw new Error("ParentRepository.createForRegistration: insert returned no rows");
    }
    return row;
  }

  /**
   * Reads a parent role-child row by its shared PK (= the owner user's id).
   *
   * A bare PK read: the row carries only the shared PK + timestamps, so the
   * result certifies exactly one fact — whether the user owns a `parents`
   * row. The owning user's role and identity are the service layer's concern
   * (resolved via `UserRepository.findById`), never this read's.
   *
   * @param userId The shared PK — the parent user's id.
   * @param tx Optional query executor — an in-tx read joins the caller's
   *           transaction snapshot; a standalone read runs raw parameterized
   *           SQL via `queryDb`.
   * @returns The parent row, or `null` when the user has no role-child row.
   */
  export async function findById(userId: number, tx?: DBQueryExecutor): Promise<ParentSelectType | null> {
    if (tx && isDBTransaction(tx)) {
      const rows = await tx.select().from(parents).where(eq(parents.id, userId)).limit(1);
      return rows[0] ?? null;
    }
    const result = await queryDb<ParentSelectType>(
      `SELECT id, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM parents
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] ?? null;
  }
}
