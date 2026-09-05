/**
 * BroadcastAudienceRepository — resolves the recipient id cohort of a
 * broadcast notification from a validated audience selector.
 *
 * One selector kind per call, four query shapes over two tables:
 *  - `all`     — every governed user.
 *  - `role`    — governed users whose `users.role` equals the selector role.
 *  - `country` — governed users whose `users.country` equals the selector
 *                country by EXACT equality. There is no LIKE/ILIKE predicate
 *                anywhere in this file, so the canonical LIKE-wildcard
 *                sanitizer (`escapeLikeWildcards`) is not applicable by
 *                construction: `%` / `_` inside the value are compared
 *                literally, never interpreted as patterns.
 *  - `plan`    — governed users holding a subscription to the selector plan
 *                that is active now. The owner FK is the generic
 *                `subscriptions.user_id`, so a subscriber of ANY role counts
 *                (a teacher's verification-plan subscription and a student's
 *                Hifz subscription are both in scope). The active-window
 *                predicate is byte-equivalent to the canonical one in
 *                `studentHasActiveSubscriptionSubquery`:
 *                `status = 'active' AND now() >= coalesce(start_date, now())
 *                AND (end_date IS NULL OR now() < end_date)` — a subscription
 *                starting exactly now is active, one ending exactly now is
 *                not (strict `<`). The join fans subscription rows out per
 *                user, so `DISTINCT` collapses a multi-subscription user to
 *                a single id.
 *
 * Governance exclusion (every shape, both execution branches): recipients
 * exclude `is_deleted` and `is_blocked` users NULL-safely — a legacy NULL
 * reads as eligible via `coalesce(..., false) = false`. Suspended users are
 * deliberately INCLUDED: suspension blocks session requests, never inbox
 * reads, so parked notification rows are correct and self-heal.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - Reads use `queryDb` (raw parameterized SQL, numbered `$n` params) on the
 *    non-transactional branch — the Neon HTTP fast path — and the Drizzle
 *    query builder on a supplied transaction, mirroring
 *    `NotificationRepository` / `UserRepository`.
 *  - Every selector value flows into a bound parameter (`$n` bind or an
 *    `eq(...)` bind) — never string-concatenated into SQL text. No
 *    `sql.placeholder` arrays, no prepared statements, no inline `--`
 *    comments inside SQL.
 *  - No business logic, no translations, no error mapping: a cohort that
 *    matches nothing surfaces as `[]`. The selector is assumed coherent
 *    (validated upstream); if a companion field its kind requires is
 *    missing, the resolution fails closed to `[]` instead of guessing.
 *  - Output is deterministic: de-duplicated ids, `ORDER BY id ASC` — callers
 *    (claim digests, tests) can rely on the exact sequence.
 */

import { and, asc, eq, isNull, or, type SQL, sql } from "drizzle-orm";
import { queryDb } from "@/backend/db";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { users } from "@/backend/db/schema/users/users";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { BroadcastAudienceType } from "@/backend/enum/notifications/broadcast-audience-type.enum";
import type { BroadcastAudienceSelector, DBQueryExecutor, DBTransaction } from "@/backend/types";

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

/** Row shape of the raw-SQL id projection. */
type AudienceIdRow = { id: number };

/**
 * Governance-exclusion WHERE text for the raw-SQL branch (the `users` table
 * is unaliased there). NULL-safe both ways: `is_deleted`/`is_blocked` NULL
 * coalesces to `false`, so legacy rows stay eligible; only explicit `true`
 * excludes. The transactional branch mirrors this byte-for-byte through the
 * `or(eq(..., false), isNull(...))` builder pair in `governanceConditions`.
 */
const GOVERNANCE_PREDICATE_SQL = "coalesce(is_deleted, false) = false AND coalesce(is_blocked, false) = false";

/**
 * Governance-exclusion conditions for the Drizzle builder branch — the
 * `or(eq(column, false), isNull(column))` pair is logically identical to the
 * raw `coalesce(column, false) = false` text (same three-valued-logic
 * outcome for NULL, `false`, and `true`).
 */
function governanceConditions(): (SQL | undefined)[] {
  return [
    or(eq(users.isDeleted, false), isNull(users.isDeleted)),
    or(eq(users.isBlocked, false), isNull(users.isBlocked)),
  ];
}

/**
 * Transactional branch — Drizzle query builders on the supplied transaction,
 * so cohort resolution participates in the caller's unit of work and sees
 * its uncommitted state. `coalesce(...)`/`now()` window comparisons that the
 * builder API cannot express natively ride the `sql` template with bound
 * column references (never interpolated values).
 *
 * `limit` bounds the id projection with SQL LIMIT after the deterministic
 * `ORDER BY id ASC` — never changing WHICH ids resolve for cohorts within
 * the bound, only capping how many transfer (undefined = unbounded).
 */
async function resolveViaTransaction(
  selector: BroadcastAudienceSelector,
  tx: DBTransaction,
  limit: number | undefined
): Promise<number[]> {
  switch (selector.type) {
    case BroadcastAudienceType.All: {
      const query = tx
        .select({ id: users.id })
        .from(users)
        .where(and(...governanceConditions()))
        .orderBy(asc(users.id))
        .$dynamic();
      const rows = await (limit === undefined ? query : query.limit(limit));
      return rows.map(row => row.id);
    }
    case BroadcastAudienceType.Role: {
      if (selector.role == null) {
        return [];
      }
      const query = tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, selector.role), ...governanceConditions()))
        .orderBy(asc(users.id))
        .$dynamic();
      const rows = await (limit === undefined ? query : query.limit(limit));
      return rows.map(row => row.id);
    }
    case BroadcastAudienceType.Country: {
      if (selector.country == null) {
        return [];
      }
      const query = tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.country, selector.country), ...governanceConditions()))
        .orderBy(asc(users.id))
        .$dynamic();
      const rows = await (limit === undefined ? query : query.limit(limit));
      return rows.map(row => row.id);
    }
    case BroadcastAudienceType.Plan: {
      if (selector.planId == null) {
        return [];
      }
      const query = tx
        .selectDistinct({ id: users.id })
        .from(users)
        .innerJoin(subscriptions, eq(subscriptions.userId, users.id))
        .where(
          and(
            eq(subscriptions.planId, selector.planId),
            eq(subscriptions.status, SubscriptionStatus.Active),
            sql`now() >= coalesce(${subscriptions.startDate}, now())`,
            or(isNull(subscriptions.endDate), sql`now() < ${subscriptions.endDate}`),
            ...governanceConditions()
          )
        )
        .orderBy(asc(users.id))
        .$dynamic();
      const rows = await (limit === undefined ? query : query.limit(limit));
      return rows.map(row => row.id);
    }
    default: {
      // TypeScript enums are erased at runtime, so a caller that bypasses the
      // upstream validation can still hand over a foreign kind. Fail loudly
      // instead of silently resolving nobody (or everybody).
      throw new Error("BroadcastAudienceRepository: unhandled audience selector kind");
    }
  }
}

/**
 * SQL LIMIT clause + bind params for the raw-SQL branch (undefined =
 * unbounded). `nextParamIndex` is the bind index following the shape's own
 * parameters — LIMIT always binds LAST so the statement text stays stable.
 */
function limitClause(limit: number | undefined, nextParamIndex: number): { clause: string; params: number[] } {
  if (limit === undefined) {
    return { clause: "", params: [] };
  }
  return { clause: ` LIMIT $${nextParamIndex}`, params: [limit] };
}

/**
 * Non-transactional branch — raw parameterized SQL over the pool (Neon HTTP
 * fast path when eligible). The single-table shapes filter `users` directly;
 * the plan shape joins `subscriptions` and dedupes with `DISTINCT`.
 * `s.status = 'active'` is a fixed state literal, not caller input, matching
 * the canonical active-window predicate verbatim.
 *
 * `limit` rides a bound `LIMIT $n` parameter appended after the existing
 * bindings (undefined = no LIMIT clause) — same semantics as the
 * transactional branch.
 */
async function resolveViaQueryDb(selector: BroadcastAudienceSelector, limit: number | undefined): Promise<number[]> {
  switch (selector.type) {
    case BroadcastAudienceType.All: {
      const bound = limitClause(limit, 1);
      const result = await queryDb<AudienceIdRow>(
        `SELECT id FROM users WHERE ${GOVERNANCE_PREDICATE_SQL} ORDER BY id ASC${bound.clause}`,
        bound.params
      );
      return result.rows.map(row => row.id);
    }
    case BroadcastAudienceType.Role: {
      if (selector.role == null) {
        return [];
      }
      const bound = limitClause(limit, 2);
      const result = await queryDb<AudienceIdRow>(
        `SELECT id FROM users WHERE ${GOVERNANCE_PREDICATE_SQL} AND role = $1 ORDER BY id ASC${bound.clause}`,
        [selector.role, ...bound.params]
      );
      return result.rows.map(row => row.id);
    }
    case BroadcastAudienceType.Country: {
      if (selector.country == null) {
        return [];
      }
      const bound = limitClause(limit, 2);
      const result = await queryDb<AudienceIdRow>(
        `SELECT id FROM users WHERE ${GOVERNANCE_PREDICATE_SQL} AND country = $1 ORDER BY id ASC${bound.clause}`,
        [selector.country, ...bound.params]
      );
      return result.rows.map(row => row.id);
    }
    case BroadcastAudienceType.Plan: {
      if (selector.planId == null) {
        return [];
      }
      const bound = limitClause(limit, 2);
      const result = await queryDb<AudienceIdRow>(
        `SELECT DISTINCT u.id
           FROM users u
           JOIN subscriptions s ON s.user_id = u.id
          WHERE s.plan_id = $1
            AND s.status = 'active'
            AND now() >= coalesce(s.start_date, now())
            AND (s.end_date IS NULL OR now() < s.end_date)
            AND coalesce(u.is_deleted, false) = false
            AND coalesce(u.is_blocked, false) = false
          ORDER BY u.id ASC${bound.clause}`,
        [selector.planId, ...bound.params]
      );
      return result.rows.map(row => row.id);
    }
    default: {
      throw new Error("BroadcastAudienceRepository: unhandled audience selector kind");
    }
  }
}

export namespace BroadcastAudienceRepository {
  /**
   * Resolves the recipient user ids for one audience selector.
   *
   * The selector arrives already validated (kind/coherence enforced
   * upstream); this layer only translates it into SQL. Every selector value
   * is bound as a parameter, so hostile companions can never alter the
   * statement shape — an exact-match cohort simply matches nothing.
   *
   * @param selector The validated audience selector (kind + companion).
   * @param tx       Optional transaction executor. When a transaction is
   *                 supplied the read runs on it (Drizzle builders); when
   *                 absent the read runs on the pool via `queryDb`.
   * @param limit    Optional SQL LIMIT applied AFTER the deterministic
   *                 `ORDER BY id ASC` projection. Bounding never changes
   *                 WHICH ids resolve for cohorts within the bound — it only
   *                 caps how many rows transfer, so a caller may pass
   *                 `cap + 1` to detect over-cap cohorts without
   *                 materializing the full audience. Undefined = unbounded
   *                 (the historical behavior; every existing two-arg caller
   *                 is unaffected).
   * @returns The resolved user ids — de-duplicated, `id ASC` — or `[]` when
   *          the cohort matches nobody (or a required companion is absent).
   */
  export async function resolveAudienceIds(
    selector: BroadcastAudienceSelector,
    tx?: DBQueryExecutor,
    limit?: number
  ): Promise<number[]> {
    if (tx && isDBTransaction(tx)) {
      return resolveViaTransaction(selector, tx, limit);
    }
    return resolveViaQueryDb(selector, limit);
  }
}
