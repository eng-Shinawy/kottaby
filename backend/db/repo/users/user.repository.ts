/**
 * UserRepository — data-access layer for the `users` table.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - Reads use `queryDb` (raw parameterized SQL) per the Neon-HTTP-client rule.
 *    We avoid pulling Drizzle relational query API (not bound to the v1 client
 *    config) and keep read queries stateless + transport-cheap.
 *  - Writes take a REQUIRED `tx: DBTransaction` (last param) — every insert
 *    must run inside a caller-supplied transaction so the registration flow
 *    can guarantee atomicity. The single exception is the activity-stamp
 *    pair: a bare single-row guarded UPDATE needs no wrapping transaction,
 *    so those two primitives accept an OPTIONAL dual-branch executor
 *    (fire-and-forget callers omit it; in-tx callers pass their `innerTx`).
 *  - No business logic, no permission checks, no hardcoded error strings —
 *    repository methods surface raw Drizzle errors; the service layer maps
 *    `23505` → `ConflictError` via `translateDbError`.
 */
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db, queryDb } from "@/backend/db";
import { users } from "@/backend/db/schema/users/users";
import type { UserRole } from "@/backend/enum/users/user-role.enum";
import type { DBQueryExecutor, DBTransaction, UserInsertType, UserSelectType } from "@/backend/types";
import type { AppLocale } from "@/shared/locale/AppLocale";

/**
 * Coalesce window for per-request activity stamps — a request only commits a
 * write when the stored stamp is older than this (throttle folded into the
 * UPDATE predicate, never a read-then-write). At one minute the stamp is
 * coarsened by at most one minute of drift — negligible against the
 * inactivity threshold the stamp feeds, and well within the accuracy the
 * recently-active analytics window needs.
 */
export const USER_ACTIVITY_COALESCE_WINDOW_MS = 60_000;

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

/**
 * Narrows the optional dual-branch executor down to a Drizzle query builder.
 *
 * `DBQueryExecutor` unions the transaction with raw `pg` pool/client handles,
 * which cannot build queries. The `isDBTransaction` guard picks the
 * transactional branch; everything else (no executor, or a bare pool
 * handle) falls back to the pool-backed `db` singleton — the same dual-branch
 * convention the read methods express with `queryDb`, kept on the Drizzle
 * side so a write stays a single composable statement.
 */
function drizzleExecutorOf(tx: DBQueryExecutor | undefined): DBTransaction | typeof db {
  return tx && isDBTransaction(tx) ? tx : db;
}

/**
 * WHERE predicate shared by both activity-stamp primitives — pins the row to
 * the caller's id and composes the monotonic guard: the stored stamp must be
 * NULL or STRICTLY older than the incoming instant (strict `<` keeps an
 * equal-timestamp re-stamp a zero-row miss, so an out-of-order or duplicate
 * write can never move `last_active_at` backwards). When `staleBefore` is
 * supplied the coalesce throttle is folded into the same statement: the
 * stored stamp must ALSO be NULL or strictly older than the coalesce
 * boundary, bounding write amplification to at most one committing write per
 * user per window (fresh-stamp arrivals are zero-row primary-key probes).
 */
function activityStampWhere(userId: number, now: Date, staleBefore?: Date) {
  const monotonic = or(isNull(users.lastActiveAt), lt(users.lastActiveAt, now));
  const throttle =
    staleBefore === undefined ? undefined : or(isNull(users.lastActiveAt), lt(users.lastActiveAt, staleBefore));
  return and(eq(users.id, userId), monotonic, throttle);
}

export namespace UserRepository {
  /**
   * Finds a user by email (case-sensitive on the DB side; PG collation is
   * case-insensitive by default for `varchar`, matching the email-uniqueness
   * contract).
   *
   * Read-only — uses `queryDb` for the Neon HTTP fast path when eligible.
   *
   * @returns The matching user row, or `null` if no user has that email.
   */
  export async function findByEmail(email: string, tx?: DBQueryExecutor): Promise<UserSelectType | null> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      const rows = await tx.select().from(users).where(eq(users.email, email)).limit(1);
      return rows[0] ?? null;
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<UserSelectType>(
      `SELECT id, full_name AS "fullName", email, phone, password_hash AS "passwordHash",
              must_change_password AS "mustChangePassword",
              role, date_of_birth AS "dateOfBirth", gender, country,
              country_code AS "countryCode", locale,
              is_deleted AS "isDeleted", deleted_at AS "deletedAt",
              suspended, suspended_at AS "suspendedAt",
              suspended_period_days AS "suspendedPeriodDays",
              is_blocked AS "isBlocked", blocked_at AS "blockedAt",
              last_active_at AS "lastActiveAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Finds a user by primary key.
   *
   * Used by the auth flow (`gqlContextFactory`, `AuthService.refreshToken`)
   * to resolve the authenticated user from the JWT `sub` claim. Mirrors the
   * `findByEmail` shape — read-only, supports an optional transaction
   * executor for in-tx reads.
   *
   * @returns The matching user row, or `null` if no user has that id.
   */
  export async function findById(id: number, tx?: DBQueryExecutor): Promise<UserSelectType | null> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      const rows = await tx.select().from(users).where(eq(users.id, id)).limit(1);
      return rows[0] ?? null;
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<UserSelectType>(
      `SELECT id, full_name AS "fullName", email, phone, password_hash AS "passwordHash",
              must_change_password AS "mustChangePassword",
              role, date_of_birth AS "dateOfBirth", gender, country,
              country_code AS "countryCode", locale,
              is_deleted AS "isDeleted", deleted_at AS "deletedAt",
              suspended, suspended_at AS "suspendedAt",
              suspended_period_days AS "suspendedPeriodDays",
              is_blocked AS "isBlocked", blocked_at AS "blockedAt",
              last_active_at AS "lastActiveAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM users WHERE id = $1 LIMIT 1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Inserts a new user row inside the supplied transaction.
   *
   * The caller is responsible for hashing the password BEFORE calling this
   * method. Field-by-field mapping keeps mass-assignment out of
   * the insert payload (BOPLA defense).
   *
   * @returns The inserted row (Drizzle `.returning()` yields all columns).
   */
  export async function create(insert: UserInsertType, tx: DBTransaction): Promise<UserSelectType> {
    const [row] = await tx.insert(users).values(insert).returning();
    if (!row) {
      // Should be unreachable — `.returning()` always yields the inserted row.
      throw new Error("UserRepository.create: insert returned no rows");
    }
    return row;
  }

  /**
   * Updates one user's app locale (UI + copy preference) — a guarded single
   * `UPDATE … WHERE id = ? SET locale = ? RETURNING *` on the supplied
   * transaction.
   *
   * The service layer validates the locale value (closed `app_locale` enum —
   * the pgEnum rejects anything else at the database boundary as
   * defense-in-depth). `updated_at` re-stamps automatically via the column's
   * `$onUpdate` hook. Re-writing the same locale is idempotent (the row
   * returns unchanged).
   *
   * @returns The updated row (passwordHash included — service layers must
   *          strip it before exposure), or `null` when no user has that id
   *          (zero rows matched — the service layer decides what that means).
   */
  export async function updateLocale(
    userId: number,
    locale: AppLocale,
    tx: DBTransaction
  ): Promise<UserSelectType | null> {
    const [row] = await tx.update(users).set({ locale }).where(eq(users.id, userId)).returning();
    return row ?? null;
  }

  /**
   * Updates one user's credential pair (password hash + force-reset flag) —
   * a guarded single `UPDATE … WHERE id = ? RETURNING *` on the supplied
   * transaction.
   *
   * The caller MUST hash the plaintext password BEFORE calling this method
   * (same contract as `create` — the repository never sees plaintext, only
   * the finished hash). The force-reset flag is persisted exactly as given:
   * `true` marks a credential the user must replace, `false` clears the
   * mark. `updated_at` re-stamps automatically via the column's `$onUpdate`
   * hook.
   *
   * Optional optimistic fence: when `expectedCurrentHash` is supplied, the
   * WHERE predicate gains `AND password_hash = $expectedCurrentHash` — the
   * write only lands if the stored credential is still the one the caller
   * observed when it authorized the change. Zero matched rows (concurrent
   * rotation between the caller's read and this write) yield `null`, the
   * same miss signal as an absent id; the service tier disambiguates (and
   * may deliberately NOT disambiguate, keeping a single client-facing
   * denial shape). Admin override paths omit the fence entirely.
   *
   * @returns The updated FULL row (passwordHash included — service layers
   *          must strip it before exposure; it never reaches GraphQL), or
   *          `null` when zero rows matched — absent id, or a fenced write
   *          whose expected hash no longer matches (the service layer
   *          decides what that means).
   */
  export async function updatePassword(
    userId: number,
    passwordHash: string,
    mustChangePassword: boolean,
    tx: DBTransaction,
    expectedCurrentHash?: string
  ): Promise<UserSelectType | null> {
    const where =
      expectedCurrentHash === undefined
        ? eq(users.id, userId)
        : and(eq(users.id, userId), eq(users.passwordHash, expectedCurrentHash));
    const [row] = await tx.update(users).set({ passwordHash, mustChangePassword }).where(where).returning();
    return row ?? null;
  }

  /**
   * Batch locale lookup for a set of user ids — the read the notification
   * emitters use to localize per-recipient copy (the D2 locale vertical).
   *
   * Follows the repo batch-lookup convention: the returned `Map` is
   * pre-initialized with EVERY requested id mapped to `null`, then filled
   * from the matched rows — a missing user and a user with no locale set
   * are both `null` (the emitter's fallback locale applies). Empty input
   * returns an empty map without executing a statement.
   *
   * @returns `Map<userId, locale | null>` — exactly one entry per requested
   *          id, present-or-not.
   */
  export async function findLocalesByIds(
    userIds: readonly number[],
    tx?: DBQueryExecutor
  ): Promise<Map<number, AppLocale | null>> {
    const locales = new Map<number, AppLocale | null>();
    for (const id of userIds) {
      locales.set(id, null);
    }
    if (userIds.length === 0) {
      return locales;
    }
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      // `inArray` with a PLAIN array (never `sql.placeholder`) per the repo
      // prepared-statement rule.
      const rows = await tx
        .select({ id: users.id, locale: users.locale })
        .from(users)
        .where(inArray(users.id, [...userIds]));
      for (const row of rows) {
        locales.set(row.id, row.locale);
      }
      return locales;
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path);
    // `= ANY($1)` binds the id array as a single parameterized value.
    const result = await queryDb<{ id: number; locale: AppLocale | null }>(
      "SELECT id, locale FROM users WHERE id = ANY($1)",
      [[...userIds]]
    );
    for (const row of result.rows) {
      locales.set(row.id, row.locale);
    }
    return locales;
  }

  /**
   * Batch display-name lookup for a set of user ids — the read the admin
   * dispute queue uses to render participant names without per-row probes.
   *
   * Follows the repo batch-lookup convention: the returned `Map` is
   * pre-initialized with EVERY requested id mapped to `null`, then filled
   * from the matched rows — an id with no user row stays `null` and the
   * view falls back to the numeric identity. Empty input returns an empty
   * map without executing a statement.
   *
   * @returns `Map<userId, fullName | null>` — exactly one entry per
   *          requested id, present-or-not.
   */
  export async function findNamesByIds(
    userIds: readonly number[],
    tx?: DBQueryExecutor
  ): Promise<Map<number, string | null>> {
    const names = new Map<number, string | null>();
    for (const id of userIds) {
      names.set(id, null);
    }
    if (userIds.length === 0) {
      return names;
    }
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      // `inArray` with a PLAIN array (never `sql.placeholder`) per the repo
      // prepared-statement rule.
      const rows = await tx
        .select({ id: users.id, fullName: users.fullName })
        .from(users)
        .where(inArray(users.id, [...userIds]));
      for (const row of rows) {
        names.set(row.id, row.fullName);
      }
      return names;
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path);
    // `= ANY($1)` binds the id array as a single parameterized value.
    const result = await queryDb<{ id: number; fullName: string }>(
      'SELECT id, full_name AS "fullName" FROM users WHERE id = ANY($1)',
      [[...userIds]]
    );
    for (const row of result.rows) {
      names.set(row.id, row.fullName);
    }
    return names;
  }

  /**
   * Flips one user's `role` from `fromRole` to `toRole` in ONE guarded
   * atomic UPDATE on the supplied transaction:
   * `SET role = <toRole> WHERE id = <userId> AND role = <fromRole>`.
   *
   * The expected source role is folded into the WHERE predicate — there is
   * no read-then-write window, so a stale read can never replay a transition
   * the row has already left, and under concurrent writers the row lock
   * serializes the statements: exactly one flip wins and the loser matches
   * zero rows. The predicate pins BOTH the id and the expected source role,
   * so an id alone can never move a row whose stored role differs from the
   * caller's expectation (defense-in-depth behind the service tier, which
   * derives the id server-side).
   *
   * A zero-row match returns `false` and is a SIGNAL, never an error: the
   * user is absent, or their stored role is no longer `fromRole` (the
   * transition already happened — replaying it is a safe no-op). Deciding
   * what `false` means is a service-layer decision, not a repository one.
   * A self-transition (`fromRole == toRole`) on a row currently storing that
   * role matches and rewrites the same value.
   *
   * `tx` is REQUIRED (last parameter): the flip commits — or rolls back —
   * atomically with the surrounding writes of the caller's transaction.
   * `updated_at` re-stamps automatically via the column's `$onUpdate` hook.
   * Parameterized always; the id and both role members are bound values,
   * never concatenated; no prepared statement (writes are excluded —
   * `docs/drizzle/prepared-statements.md`).
   *
   * @returns `true` when the guarded predicate matched and the role was
   *          written, `false` when it matched zero rows.
   */
  export async function transitionRoleOnce(
    userId: number,
    fromRole: UserRole,
    toRole: UserRole,
    tx: DBTransaction
  ): Promise<boolean> {
    // Single guarded statement — the expected source role IS the WHERE
    // predicate, so a stale read can never replay an illegal transition.
    const rows = await tx
      .update(users)
      .set({ role: toRole })
      .where(and(eq(users.id, userId), eq(users.role, fromRole)))
      .returning({ id: users.id });
    return rows.length > 0;
  }

  /**
   * Monotonic activity stamp — flips `last_active_at` to `now` in ONE
   * guarded UPDATE whose WHERE carries the guard: the row must belong to
   * `userId` and its stored stamp must be NULL or strictly older than `now`
   * (strict `<` makes an equal-timestamp re-stamp a no-op miss). Predicate
   * and mutation share the single statement under the row lock — there is no
   * read-then-write window, and an out-of-order or duplicate stamp can never
   * move the stored value backwards.
   *
   * The write is identity-scoped by construction: the row is pinned by the
   * bound `userId` alone, so no other user's row can ever match, and every
   * parameter is a server-captured value (identity + instant), never a
   * client-owned payload. A zero-row match is a SIGNAL, never an error — the
   * id is absent, or the stored stamp already matches or exceeds `now`
   * (replaying the same instant is a safe no-op); the service tier decides
   * what that means.
   *
   * `tx` is OPTIONAL: a single-row guarded UPDATE needs no wrapping
   * transaction, so standalone (fire-and-forget) callers omit it and the
   * write runs on the pool; in-transaction callers pass their `innerTx` and
   * the stamp commits — or rolls back — atomically with the surrounding
   * writes. No prepared statement (writes are excluded —
   * `docs/drizzle/prepared-statements.md`).
   *
   * @returns `true` when the guarded predicate matched and the stamp was
   *          written, `false` when it matched zero rows.
   */
  export async function updateLastActiveAt(userId: number, now: Date, tx?: DBQueryExecutor): Promise<boolean> {
    const rows = await drizzleExecutorOf(tx)
      .update(users)
      .set({ lastActiveAt: now })
      .where(activityStampWhere(userId, now))
      .returning({ id: users.id });
    return rows.length > 0;
  }

  /**
   * Throttled activity stamp — the monotonic write of `updateLastActiveAt`
   * with the coalesce throttle folded into the SAME single statement: the
   * stored stamp must additionally be NULL or strictly older than
   * `staleBefore` (the coalesce boundary — callers derive it as
   * `now − USER_ACTIVITY_COALESCE_WINDOW_MS`). Requests arriving while the
   * stored stamp is still fresh match zero rows and write nothing — bounded
   * primary-key probes, not deferred writes — so stamping on every
   * request/heartbeat costs at most one committing write per user per
   * coalesce window while the monotonic guarantee stays unchanged.
   *
   * Same single-statement discipline, identity scoping, optional-executor
   * and boolean-miss contract as `updateLastActiveAt`.
   *
   * @returns `true` when the stored stamp was stale enough to write, `false`
   *          when the throttle, the monotonic guard, or the id matched zero
   *          rows.
   */
  export async function updateLastActiveAtIfStale(
    userId: number,
    staleBefore: Date,
    now: Date,
    tx?: DBQueryExecutor
  ): Promise<boolean> {
    const rows = await drizzleExecutorOf(tx)
      .update(users)
      .set({ lastActiveAt: now })
      .where(activityStampWhere(userId, now, staleBefore))
      .returning({ id: users.id });
    return rows.length > 0;
  }
}
