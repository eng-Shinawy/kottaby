/**
 * PGlite-backed pg.Pool shim — runs real PostgreSQL in-process via WASM.
 *
 * Production deploys keep `DB_PROVIDER=postgres` (or `neon`) and use a real
 * `pg.Pool` over TCP. The sandbox/CI environment lacks a PostgreSQL install;
 * `DB_PROVIDER=pglite` activates this shim and keeps the same `db`/
 * `getDrizzleDbPool`/`queryDb`/`closePool` API the rest of the backend
 * expects — so consumers (Drizzle ORM, repos, services, migrations) stay
 * source-compatible.
 *
 * The shim:
 *  - lazily constructs a single `PGlite` instance (PGlite is single-connection;
 *    a real pool would multiplex — for local dev / tests, single-conn is fine)
 *  - persists data to a configurable `dataDir` (defaults to `./db/pglite`)
 *  - exposes `query(text, params)` -> `{ rows, fields, rowCount, command }`
 *  - exposes `connect()` -> a fake `PoolClient` with `.query()`, `.release()`
 *  - exposes `end()` -> closes the PGlite instance
 *
 * PGlite supports `pgEnum`, `IDENTITY`, `timestamp`, `defaultNow()`, `plpgsql`
 * functions, `pg_timezone_names` — i.e. everything the Drizzle schema + the
 * custom migrations use, EXCEPT the `pg_trgm` extension (the schema never
 * actually indexes with trigram GIN, so the extension is just declared and
 * unused — `runMigrations` skips `1-extensions.sql` for pglite).
 *
 * @see backend/db/client.ts — activates this when `DB_PROVIDER=pglite`.
 * @see https://pglite.dev/docs/api — PGlite API reference.
 */
import { PGlite } from "@electric-sql/pglite";
import { logger } from "@/backend/lib/logger";

/** Subset of `pg`'s `QueryResultRow` we need to type-match. */
export type Row = Record<string, unknown>;

/** Mirror of `pg`'s `QueryResult` (what Drizzle + repos destructure). */
export interface QueryResultLike<T extends Row = Row> {
  rows: T[];
  fields: ReadonlyArray<{ name: string; dataTypeID: number }>;
  rowCount: number;
  command: string;
  oid: number;
}

/**
 * Mirror of `pg`'s `QueryConfig` (object-form query argument). Drizzle's
 * `NodePgSession.prepareQuery()` calls `client.query({...}, params)` with
 * this shape (with `name`, `rowMode`, `text`, `types`). PGlite's `query`
 * accepts `(text: string, params?: ...)` only — the shim normalizes the
 * object form back to `(text, params)`.
 */
export interface PgQueryConfig {
  text?: string;
  name?: string;
  rowMode?: "array";
  values?: ReadonlyArray<unknown>;
  types?: unknown;
}

/** Mirror of `pg`'s `PoolClient`. */
export interface PoolClientLike<T extends Row = Row> {
  query(textOrConfig: string | PgQueryConfig, params?: ReadonlyArray<unknown>): Promise<QueryResultLike<T>>;
  release(): void;
}

/** Mirror of `pg`'s `Pool`. */
export interface PglitePoolLike {
  // Single-signature query (no overloads) — accepts both the SQL-text and
  // object-config forms. Matches the implementation in `getPglitePool()`
  // below and the call surface Drizzle / repos actually use.
  query<T extends Row = Row>(
    textOrConfig: string | PgQueryConfig,
    params?: ReadonlyArray<unknown>
  ): Promise<QueryResultLike<T>>;
  connect(): Promise<PoolClientLike>;
  end(): Promise<void>;
  on(_event: string, _listener: (...args: unknown[]) => void): this;
}

/** Normalizes a pg.QueryConfig | string input into `(text, params, rowMode, types)`. */
function normalizeArgs(
  textOrConfig: string | PgQueryConfig,
  params?: ReadonlyArray<unknown>
): {
  text: string;
  params: ReadonlyArray<unknown> | undefined;
  rowMode?: "array";
  types: unknown;
} {
  if (typeof textOrConfig === "string") {
    return { text: textOrConfig, params, rowMode: undefined, types: undefined };
  }
  // Object form — Drizzle passes { name, rowMode, text, types } and a
  // separate `params` array (or `values` inside the config). Prefer the
  // explicit `params` argument when supplied (Drizzle always supplies it).
  const config = textOrConfig;
  return {
    text: typeof config.text === "string" ? config.text : "",
    params: params ?? config.values,
    rowMode: config.rowMode,
    types: config.types,
  };
}

/** PostgreSQL type OIDs of the temporal scalar family (see DRIZZLE_NOOP_OIDS). */
const OID_DATE = 1082;
const OID_TIMESTAMP = 1114;
const OID_TIMESTAMPTZ = 1184;
const OID_INTERVAL = 1186;

/**
 * Scalar temporal OIDs Drizzle's `NodePgSession` handles itself.
 *
 * Drizzle passes `types: { getTypeParser }` on every query, registering a
 * NOOP parser for the temporal family (see `node-postgres/session.ts →
 * typeConfig`): on the `postgres` provider the driver therefore delivers RAW
 * column text (e.g. `"2026-09-10 11:41:37.454"`) and Drizzle's codecs
 * rehydrate it (`textToDateWithTz = v => new Date(v + "+0000")` for
 * `timestamp`), preserving fractional seconds.
 *
 * Without the same passthrough here, PGlite pre-parses the column into a JS
 * `Date`, and Drizzle's string-concatenating codec then does
 * `new Date(Date + "+0000")` — JSC re-parses the `Date.toString()` output and
 * SILENTLY DROPS the milliseconds (`.454` → `.000`). Every Drizzle read of a
 * `timestamp` column on PGlite truncated to whole seconds, while the raw-SQL
 * `queryDb` path kept full precision — the two surfaces drifted apart (caught
 * by the notifications J1 journey step 9).
 *
 * Identity parsers restore the real-pg contract: raw text in, Drizzle codecs
 * parse. Scoped to scalars — the schema uses no temporal array columns.
 */
const DRIZZLE_NOOP_OIDS: readonly number[] = [OID_DATE, OID_TIMESTAMP, OID_TIMESTAMPTZ, OID_INTERVAL];

/**
 * Detects Drizzle's `types` config (a `{ getTypeParser }` object, mirroring
 * `pg.types`) so the passthrough parsers below are applied ONLY to callers
 * that opted into driver-level parsing control. Raw `queryDb(text, params)`
 * calls keep PGlite's default parsing (JS `Date` values), which the
 * repositories' `QueryResultRow` contracts expect on both providers.
 */
function isDriverTypesConfig(
  types: unknown
): types is { getTypeParser: (typeId: number, format?: string) => (value: string) => unknown } {
  return (
    typeof types === "object" && types !== null && "getTypeParser" in types && typeof types.getTypeParser === "function"
  );
}

let pgliteSingleton: PGlite | null = null;
let pgliteInitPromise: Promise<PGlite> | null = null;

/**
 * Cross-module-graph singleton carrier.
 *
 * Next.js dev (Turbopack) evaluates the server module graph MORE THAN ONCE
 * per process — route handlers and server components resolve this module
 * through separate module-graph copies, so a plain module-level `let`
 * singleton silently produces TWO PGlite instances against ONE data dir.
 * PGlite is a single-connection embedded Postgres: the second instance's
 * first write hits the other instance's WAL/checkpoint state and aborts the
 * WASM (`RuntimeError: Aborted()`), which Node escalates to an
 * unhandledRejection process crash.
 *
 * Attaching the singleton to `globalThis` (the same trick Prisma's dev
 * client uses for hot-reload) makes every module-graph copy in the process
 * share ONE instance. Cross-PROCESS access (CLI seed scripts, the lint
 * service) must still target a different `PGLITE_DATA_DIR` while the dev
 * server is running — a data dir is single-process by design.
 */
interface PgliteGlobalCarrier {
  kottabyPgliteSingleton?: PGlite | null;
  kottabyPgliteInitPromise?: Promise<PGlite> | null;
}
const pgliteGlobal = globalThis as typeof globalThis & PgliteGlobalCarrier;
pgliteSingleton = pgliteGlobal.kottabyPgliteSingleton ?? null;
pgliteInitPromise = pgliteGlobal.kottabyPgliteInitPromise ?? null;

/** Returns the singleton PGlite instance. Initial construction is async
 * (PGlite loads WASM + opens the data dir); concurrent first-callers await
 * the same promise.
 */
async function getPglite(): Promise<PGlite> {
  if (pgliteSingleton) {
    return pgliteSingleton;
  }
  if (!pgliteInitPromise) {
    const dataDir = process.env.PGLITE_DATA_DIR ?? "./db/pglite";
    pgliteInitPromise = (async () => {
      logger.warn(`[PglitePool] initializing PGlite at ${dataDir} (DB_PROVIDER=pglite)`);
      const instance = new PGlite({ dataDir });
      // Touch a trivial query to ensure WASM is loaded before returning, so
      // downstream `db.select(...)` calls don't race initialization.
      await instance.query("SELECT 1 AS ok");
      // Pin the (single) session timezone explicitly — the guarantee must be
      // structural, not incidental to PGlite's default: naive `timestamp
      // without time zone` columns store the session wall clock through
      // `defaultNow()`, and the platform-analytics trend readers decode that
      // wall clock as UTC. Mirrors the `options: "-c timezone=UTC"` startup
      // pin on the postgres Pool (`backend/db/client.ts`) so both providers
      // yield identical trend buckets under any host timezone.
      await instance.query("SET TIME ZONE 'UTC'");
      // Session-scope test-path opt-out for the users hard-delete guard —
      // the same pin the postgres Pool rides on its startup-options packet.
      // PGlite is single-connection in-process, so session scope IS
      // connection scope here. The guard trigger is armed when the GUC is
      // unset (production default); test teardown hard-deletes fixture
      // users, so the opt-out must be inherited with zero test-helper edits.
      // Production fail-fast shape mirrors the gateway rate-limit bypass:
      // a production deployment must never run with the test flags set.
      if (process.env.TEST_CI === "1" || process.env.TEST_SERVER === "1") {
        if (process.env.NODE_ENV === "production" && process.env.IS_DEMO !== "1" && process.env.IS_DEMO !== "true") {
          throw new Error(
            "getPglite: TEST_CI/TEST_SERVER users-delete-guard opt-out is forbidden outside the test harness (set IS_DEMO=1 for the sanctioned test server)"
          );
        }
        await instance.query("SET kottaby.users_delete_guard = 'off'");
      }
      pgliteSingleton = instance;
      pgliteGlobal.kottabyPgliteSingleton = instance;
      logger.warn(`[PglitePool] PGlite initialized successfully`);
      return instance;
    })();
    pgliteGlobal.kottabyPgliteInitPromise = pgliteInitPromise;
    try {
      await pgliteInitPromise;
    } catch (err) {
      pgliteInitPromise = null;
      pgliteGlobal.kottabyPgliteInitPromise = null;
      throw err;
    }
  }
  return pgliteInitPromise;
}

/**
 * Builds a `pg.Pool`-compatible wrapper over a single PGlite instance.
 *
 * The wrapper is intentionally minimal: `query`, `connect`, `end`, `on`. It
 * does NOT support `pool.on("error")`-style event subscription (Drizzle +
 * repos never subscribe) — `on()` is a no-op to keep TypeScript happy.
 */
export async function getPglitePool(): Promise<PglitePoolLike> {
  const pglite = await getPglite();
  const pool: PglitePoolLike = {
    async query<T extends Row = Row>(
      textOrConfig: string | PgQueryConfig,
      params?: ReadonlyArray<unknown>
    ): Promise<QueryResultLike<T>> {
      const { text, params: resolvedParams, rowMode, types } = normalizeArgs(textOrConfig, params);
      // PGlite accepts an options object as the 3rd arg: `{ rowMode: "array" }`.
      // When Drizzle requests `rowMode: "array"` (INSERT/UPDATE with RETURNING,
      // SELECT with fields), PGlite returns rows as arrays — Drizzle's mapper
      // expects that shape (it indexes by field position).
      //
      // PGlite's native `query<T>(text, params?, options?: QueryOptions)`
      // already accepts this exact call shape, so no `as` cast on `pglite` is
      // required. `Results<T>.rows` is `T[]` and `fields[].dataTypeID` is
      // already `number`, so the `as T[]` and `Number(...)` coercion that used
      // to live here are unnecessary — the type contract is enforced by PGlite.
      // When the caller supplies a pg-style `types` config (Drizzle always
      // does), delegate each temporal scalar OID to the CALLER's own parser
      // for raw-text delivery. Drizzle's typeConfig registers a NOOP parser
      // for exactly this family, so its codecs rehydrate the raw column
      // text themselves (mirroring the `postgres` provider, where the NOOP
      // parser receives raw text from `pg`) — and any other pg-style caller
      // gets its own parser choice honored instead of a forced identity.
      // See DRIZZLE_NOOP_OIDS above for the full precision-loss explanation.
      const options: {
        rowMode?: "array";
        parsers?: Record<number, (value: string) => unknown>;
      } = {};
      if (rowMode === "array") {
        options.rowMode = "array";
      }
      if (isDriverTypesConfig(types)) {
        const parsers: Record<number, (value: string) => unknown> = {};
        for (const oid of DRIZZLE_NOOP_OIDS) {
          parsers[oid] = types.getTypeParser(oid, "text");
        }
        options.parsers = parsers;
      }
      const result = await pglite.query<T>(
        text,
        resolvedParams ? [...resolvedParams] : undefined,
        Object.keys(options).length > 0 ? options : undefined
      );
      return {
        rows: result.rows ?? [],
        fields: (result.fields ?? []).map(f => ({ name: f.name, dataTypeID: f.dataTypeID ?? 0 })),
        rowCount: typeof result.rowCount === "number" ? result.rowCount : (result.rows?.length ?? 0),
        command: typeof result.command === "string" ? result.command : "",
        oid: 0,
      };
    },
    async connect(): Promise<PoolClientLike> {
      // PGlite is single-connection — return a stateless fake client that
      // forwards to the singleton. `release()` is a no-op (no real pool slot
      // to return).
      return {
        // Forward to the pool's `query` — with the single-signature
        // `PglitePoolLike.query` interface, the union argument matches
        // directly (no overload-resolution branch or `as` cast required).
        query: <T extends Row = Row>(textOrConfig: string | PgQueryConfig, params?: ReadonlyArray<unknown>) =>
          pool.query<T>(textOrConfig, params),
        release: () => undefined,
      };
    },
    async end(): Promise<void> {
      if (pgliteSingleton) {
        await pgliteSingleton.close();
        pgliteSingleton = null;
        pgliteInitPromise = null;
      }
    },
    on() {
      return pool;
    },
  };
  return pool;
}

/** Closes the singleton PGlite instance (CLI/tests only). */
export async function closePglite(): Promise<void> {
  if (pgliteSingleton) {
    await pgliteSingleton.close();
    pgliteSingleton = null;
    pgliteInitPromise = null;
    pgliteGlobal.kottabyPgliteSingleton = null;
    pgliteGlobal.kottabyPgliteInitPromise = null;
  }
}
