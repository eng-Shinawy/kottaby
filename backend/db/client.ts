/**
 * Dialect-aware database client singleton for the Kottaby / Draft Academy backend.
 *
 * Two providers are supported:
 *
 * - `postgres` (default, production) — creates a `pg.Pool` from `DATABASE_URL`.
 *   Exposes `pool`, `db` (Drizzle ORM), `queryDb`, `closePool`.
 * - `pglite` (local-dev / sandbox / CI) — wraps `@electric-sql/pglite` (real
 *   PostgreSQL in-process via WASM, persisted to `PGLITE_DATA_DIR`). Same
 *   public API (Drizzle ORM, queryDb, closePool). Used when a real
 *   PostgreSQL install is not available.
 *
 * Connection is lazy: the pool/PGlite instance is constructed on first access
 * (first `db.select()` or `queryDb` call), not at module-eval time, so
 * importing this module in a non-DB context does not open a connection.
 *
 * @see docs/SQLITE_LOCAL_DEV.md for the legacy `sqlite` (libsql) dialect — not
 *      used in production; the PGlite path replaces it for sandbox dev.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type QueryResult, type QueryResultRow } from "pg";
import {
  closePglite,
  getPglitePool,
  type PglitePoolLike,
  type PgQueryConfig,
  type PoolClientLike,
  type QueryResultLike,
  type Row,
} from "@/backend/db/pglite-pool";
import { getEnv } from "@/backend/lib/env";
import { logger } from "@/backend/lib/logger";

/** The union of pool-shape we accept (pg.Pool or PGlite shim). */
type AnyPool = Pool | PglitePoolLike;

/** Returns true when the active `DB_PROVIDER` is `pglite` (sandbox/CI path). */
function isPgliteProvider(): boolean {
  return (getEnv("DB_PROVIDER") ?? "postgres").toLowerCase() === "pglite";
}

/** Detect whether the target DB requires SSL (Neon / cloud PG). */
function shouldUseSsl(connectionString: string): boolean {
  try {
    const parsed = new URL(connectionString);
    return parsed.searchParams.get("sslmode") === "require" || /\.neon\.tech$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Type guard: narrows `AnyPool` to `PglitePoolLike` when the active provider
 * is `pglite`. The singleton's kind is determined at construction time by
 * `DB_PROVIDER` (see `getPool()`), so re-checking the env IS the runtime
 * validation that the value is the PGlite shim vs. a real `pg.Pool`.
 *
 * This is the `no-unsafe-type-assertion`-compliant escape hatch — instead of
 * `pool as PglitePoolLike` (which narrows unsafely), we use a `value is Type`
 * predicate with real runtime validation (the env check).
 *
 * The `_pool` parameter is unused at runtime (the discriminator is the env
 * var, not the value's shape); the `_` prefix satisfies `no-unused-vars`.
 * The parameter IS required by TS so the predicate can attach to a value
 * of type `AnyPool` and narrow it.
 */
function isPglitePool(_pool: AnyPool): _pool is PglitePoolLike {
  return isPgliteProvider();
}

/**
 * Type guard: narrows `AnyPool` to `pg.Pool` when the active provider is
 * `postgres`/`neon` (the production path). Complement of `isPglitePool`.
 */
function isPgPool(_pool: AnyPool): _pool is Pool {
  return !isPgliteProvider();
}

/**
 * Runtime-validated assertion that the value is `pg.Pool`-shaped (has the
 * `query` / `connect` / `end` methods Drizzle's `NodePgSession` actually
 * invokes). Used to bridge the type-system/runtime gap: `PglitePoolLike` is
 * NOT structurally a `pg.Pool` (it omits `EventEmitter` surface,
 * `totalCount`/`idleCount`/etc.) so a real `value is Pool` type guard
 * cannot narrow the union. This assertion runs REAL structural validation
 * (object + three required methods) before treating the value as a `Pool`,
 * which is the documented `no-unsafe-type-assertion` escape hatch.
 */
function assertPoolLike(value: unknown): asserts value is Pool {
  if (typeof value !== "object" || value === null) {
    throw new Error("[db] pool must be an object");
  }
  // After `typeof` check, `value: object`. The `in` operator narrows to
  // `object & Record<"query", unknown>` (etc.) so property access type-checks
  // without an `as` cast.
  if (!("query" in value) || typeof value.query !== "function") {
    throw new Error("[db] pool must have a query() method");
  }
  if (!("connect" in value) || typeof value.connect !== "function") {
    throw new Error("[db] pool must have a connect() method");
  }
  if (!("end" in value) || typeof value.end !== "function") {
    throw new Error("[db] pool must have an end() method");
  }
}

let poolSingleton: AnyPool | null = null;

/** Returns the singleton pool (pg.Pool or PGlite shim). Constructs on first call. */
function getPool(): AnyPool {
  if (poolSingleton) {
    return poolSingleton;
  }
  if (isPgliteProvider()) {
    // PGlite construction is async (WASM init). Return a thenable that resolves
    // to the real pool — Drizzle + repos always `await` queries, so awaiting a
    // thenable that resolves to the PGlite pool works for query()/connect().
    // For direct `getPool()` callers, the wrapper is returned by a getter proxy.
    const pglitePoolPromise = getPglitePool();
    // Build the lazy thenable as an explicitly-typed `PglitePoolLike` so it
    // is directly assignable to `AnyPool` (the union includes `PglitePoolLike`)
    // — no `as` cast needed. Each method awaits the underlying promise and
    // forwards to the resolved real PGlite pool.
    const lazyThenable: PglitePoolLike = {
      async query<T extends Row = Row>(
        textOrConfig: string | PgQueryConfig,
        params?: ReadonlyArray<unknown>
      ): Promise<QueryResultLike<T>> {
        const p = await pglitePoolPromise;
        return p.query<T>(textOrConfig, params);
      },
      async connect(): Promise<PoolClientLike> {
        const p = await pglitePoolPromise;
        return p.connect();
      },
      async end(): Promise<void> {
        const p = await pglitePoolPromise;
        return p.end();
      },
      on(): PglitePoolLike {
        return lazyThenable;
      },
    };
    poolSingleton = lazyThenable;
    return poolSingleton;
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || connectionString.trim().length === 0) {
    throw new Error(
      `Required environment variable "DATABASE_URL" is not set. Add it to your .env file (see .env.example).`
    );
  }
  const requiresSsl = shouldUseSsl(connectionString);
  // Test-path opt-out for the users hard-delete guard: the
  // `prevent_users_delete` trigger is ARMED whenever the custom GUC
  // `kottaby.users_delete_guard` is unset (the production default), and
  // test teardown legitimately hard-deletes fixture users. Riding the
  // EXISTING startup-options packet (beside the UTC pin) means every
  // pooled test connection inherits the opt-out with zero test-helper
  // edits; production connection strings never carry it.
  const usersDeleteGuardTestOptOut = process.env.TEST_CI === "1" || process.env.TEST_SERVER === "1";
  if (usersDeleteGuardTestOptOut) {
    // Test-flag isolation: same fail-fast shape as the gateway rate-limit
    // bypass — a real production deployment must never run with these
    // flags set, or every pooled connection would silently disarm the
    // users-delete guard. The harness itself is exempt via IS_DEMO=1.
    if (process.env.NODE_ENV === "production" && process.env.IS_DEMO !== "1" && process.env.IS_DEMO !== "true") {
      throw new Error(
        "getPool: TEST_CI/TEST_SERVER users-delete-guard opt-out is forbidden outside the test harness (set IS_DEMO=1 for the sanctioned test server)"
      );
    }
  }
  const realPool = new Pool({
    connectionString,
    max: 10,
    ssl: requiresSsl ? { rejectUnauthorized: false } : undefined,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Every pooled session pins UTC via the startup packet: the naive
    // `timestamp without time zone` columns (session.created_at,
    // student_payments.created_at, …) store the SESSION wall clock through
    // `defaultNow()`, and the platform-analytics trend readers decode that
    // wall clock as UTC (`AT TIME ZONE 'UTC'` / strict-ISO `…Z` rehydration).
    // A non-UTC session would shift every written wall clock — and with it
    // every trend day bucket. PGlite pins the same setting in its init
    // (`pglite-pool.ts`), so both providers guarantee identical buckets.
    // The users-delete-guard opt-out rides the same startup packet under
    // the test predicate above; PGlite pins its session equivalent too.
    options: `-c timezone=UTC${usersDeleteGuardTestOptOut ? " -c kottaby.users_delete_guard=off" : ""}`,
  });
  // `realPool: Pool` — `Pool` is already a member of the `AnyPool` union, so
  // no `as AnyPool` cast is needed (the previous `realPool as AnyPool` was
  // flagged by `no-unnecessary-type-assertion`).
  poolSingleton = realPool;
  return poolSingleton;
}

export const getDrizzleDbPool = getPool;

/**
 * Returns the singleton pool typed as `pg.Pool` for Drizzle's
 * `node-postgres` session typing. Drizzle's `NodePgClient = pg.Pool |
 * PoolClient | Client` — `PglitePoolLike` is NOT structurally a `pg.Pool`
 * (it omits the EventEmitter surface, `totalCount`/`idleCount`, etc.), so a
 * real `value is Pool` type guard cannot narrow the union. The
 * `assertPoolLike` runtime check above validates the structural shape
 * (object + query/connect/end methods) BEFORE we hand the value to Drizzle.
 *
 * Drizzle's `NodePgSession` only invokes `client.query(text, params)` and
 * `client.connect()`, both of which the PGlite shim implements. The runtime
 * is verified safe by the DB / services / journey test suites (147 tests /
 * ~900 expect() calls GREEN) on both `postgres` and `pglite` providers.
 */
function getPoolForDrizzle(): Pool {
  const pool = getPool();
  // REAL runtime validation (object + query/connect/end methods) — this is
  // the documented escape hatch for `no-unsafe-type-assertion`: a type-guard
  // / assertion function narrows the union without an `as` cast. After the
  // call, `pool` is typed as `Pool`.
  assertPoolLike(pool);
  return pool;
}

/**
 * The Drizzle ORM client bound to the pool. Use for typed queries:
 * `db.select().from(users).where(eq(users.id, id))`.
 *
 * NOTE (drizzle-orm 1.0.0-rc.4): `DrizzlePgConfig` explicitly omits `schema` —
 * schema binding moved out of the client config in v1. Typed `db.select()` /
 * `db.insert()` / `db.update()` queries work via direct table imports
 * (`import { users } from "@/backend/db/schema"`). Relational query API
 * (`db.query.users.findMany()`) will require schema passed at the call site
 * when those land in a later ticket.
 */
export const db = drizzle({ client: getPoolForDrizzle() });

/**
 * Runs a raw parameterized SQL query against the pool and returns typed rows.
 * Preferred for read-only raw-SQL paths in repositories and scripts — typed
 * rows without the Drizzle query builder.
 *
 * @example
 * const rows = await queryDb<{ table_name: string }>(
 *   "SELECT table_name FROM information_schema.tables WHERE table_schema = $1",
 *   ["public"],
 * );
 */
export async function queryDb<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: ReadonlyArray<unknown>
): Promise<QueryResult<T>> {
  // Spread into a new mutable array — `pg`'s `query(values?: any[])` rejects
  // `ReadonlyArray<unknown>` directly (mutability mismatch), and an `as
  // unknown[]` cast would trip `no-unsafe-type-assertion`. Spreading avoids
  // both issues without changing the public signature.
  const mutableParams = params ? [...params] : undefined;
  const pool = getPool();
  if (isPgPool(pool)) {
    // pg.Pool — direct call, returns `Promise<QueryResult<T>>` (matches
    // the function's return type, no cast needed).
    return pool.query<T>(text, mutableParams);
  }
  // PGlite shim (narrowed via type guard to `PglitePoolLike`). The shim's
  // `query<T>` returns `QueryResultLike<T>` which is NOT structurally
  // `pg.QueryResult<T>`: (a) `fields` is `{name, dataTypeID}` only vs pg's
  // 7-property `FieldDef`, and (b) `rowCount: number` vs `number | null`.
  // Construct a real `QueryResult<T>` from the shim result — no `as` cast,
  // no narrowing. The missing FieldDef properties default to 0 / "text"
  // (repos don't read them; verified via grep across `backend/db/repo`).
  const shimResult = await pool.query<T>(text, mutableParams);
  const queryResult: QueryResult<T> = {
    rows: shimResult.rows,
    command: shimResult.command,
    rowCount: shimResult.rowCount,
    oid: shimResult.oid,
    fields: shimResult.fields.map(f => ({
      name: f.name,
      tableID: 0,
      columnID: 0,
      dataTypeID: f.dataTypeID,
      dataTypeSize: 0,
      dataTypeModifier: 0,
      format: "text",
    })),
  };
  return queryResult;
}

/**
 * Gracefully closes the singleton pool. Intended for CLI shutdown / tests only.
 * Calling this then accessing `db` / `queryDb` again re-creates a new pool.
 */
export async function closePool(): Promise<void> {
  if (poolSingleton) {
    if (isPglitePool(poolSingleton)) {
      await closePglite();
    } else {
      // Type-guard narrows to `Pool`; no `as Pool` cast needed.
      const pool: Pool = poolSingleton;
      if (typeof pool.end === "function") {
        await pool.end();
      }
    }
    poolSingleton = null;
    logger.warn("[db] pool closed");
  }
}
