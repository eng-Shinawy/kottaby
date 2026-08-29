/**
 * Environment configuration utilities for the Kottaby / Draft Academy backend.
 *
 * Single source of truth for reading + caching process.env values. All backend
 * modules that need secrets or config read through here so env-file swaps
 * (e.g. `bun db --env-file=.env.test`) invalidate the cache cleanly.
 *
 * This module is safe to import from the `bun db` CLI, API routes, and services.
 * It never imports Drizzle or opens DB connections — it only reads env vars.
 *
 * NOTE on OS-env override: the sandbox/runtime may inject a stale placeholder
 * `DATABASE_URL=file:...custom.db` (SQLite) into the OS environment, which
 * dotenv does NOT override by default. For local dev, the project `.env` is the
 * source of truth, so DB-specific keys are force-overridden from `.env` at module
 * load. Production deploys set real OS env vars and typically do not ship a
 * `.env` file (so the override is a no-op there).
 */
import { config as loadDotenv } from "dotenv";

/** DB-specific keys that the project `.env` always overrides (local-dev truth). */
const DB_ENV_KEYS = [
  "DATABASE_URL",
  "DB_PROVIDER",
  "DB_FILE_NAME",
  "DATABASE_ENCRYPTION_KEY",
  "CACHE_PROVIDER",
] as const;

/**
 * Force `.env` DB keys to win over stale OS-env placeholders (one-time, idempotent).
 *
 * SKIPPED for test processes (`TEST_SERVER=1` present at module-eval time):
 * those launch with an explicit `--env-file=.env.test` whose DB config is the
 * deliberate source of truth. Without this gate the override silently
 * redirected every `bun test` / test-server process back to the DEV database,
 * leaking test fixtures into `kottaby` (the file exists locally; in CI it
 * does not, which is why CI never observed the clobber).
 *
 * Test-process flag sources (all land BEFORE this module evaluates):
 * - the materialized `.env.test` itself (`TEST_SERVER=1`, loaded via
 *   `bun --env-file=.env.test`) — runners `test:db`, `test:services`, …
 * - `run-server-tests.ts` `serverEnv` for the spawned `next dev` test server;
 * - CI materialization of `.env.test.ci` (same key, same semantics).
 */
function applyDbEnvOverride(): void {
  if (process.env.TEST_SERVER === "1") {
    return;
  }
  const result = loadDotenv({ path: ".env", quiet: true });
  if (!result.parsed) {
    return;
  }
  for (const key of DB_ENV_KEYS) {
    const fileValue = result.parsed[key];
    if (fileValue && fileValue.trim().length > 0) {
      process.env[key] = fileValue;
    }
  }
}

// Apply once at module load (before any getEnvironmentConfig() call).
applyDbEnvOverride();

/** Cached environment configuration (invalidated by {@link resetEnvironmentCache}). */
let cachedConfig: EnvironmentConfig | null = null;

export interface EnvironmentConfig {
  /** Active database provider: "postgres" | "neon" | "sqlite". */
  dbProvider: string;
  /** Postgres connection string (required for postgres/neon). */
  databaseUrl: string | undefined;
  /** SQLite file path (only when dbProvider === "sqlite"). */
  dbFileName: string | undefined;
  /** Cache provider: "redis" | "postgres". */
  cacheProvider: string;
  /** AES-256-GCM key for column-level encryption (optional for schema-only work). */
  databaseEncryptionKey: string | undefined;
  /** Node environment. */
  nodeEnv: string;
}

/**
 * Builds a snapshot of the relevant environment variables from `process.env`.
 * Pure function — does not mutate state.
 */
function readEnvironment(): EnvironmentConfig {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  return {
    dbProvider: (process.env.DB_PROVIDER ?? "postgres").toLowerCase(),
    databaseUrl: process.env.DATABASE_URL,
    dbFileName: process.env.DB_FILE_NAME,
    cacheProvider: (process.env.CACHE_PROVIDER ?? "postgres").toLowerCase(),
    databaseEncryptionKey: process.env.DATABASE_ENCRYPTION_KEY,
    nodeEnv,
  };
}

/**
 * Returns the cached environment configuration, building it on first access.
 * Subsequent calls return the cached snapshot until {@link resetEnvironmentCache}
 * is called (e.g. after an env-file swap).
 */
export function getEnvironmentConfig(): EnvironmentConfig {
  if (cachedConfig) {
    return cachedConfig;
  }
  cachedConfig = readEnvironment();
  return cachedConfig;
}

/**
 * Invalidates the cached environment configuration so the next
 * {@link getEnvironmentConfig} call re-reads `process.env`.
 *
 * Called by the `bun db` CLI after applying a new env file.
 */
export function resetEnvironmentCache(): void {
  cachedConfig = null;
}

/**
 * Reads a single env var value (no caching, no throw).
 */
export function getEnv(key: string): string | undefined {
  return process.env[key];
}

/**
 * Reads a single env var or returns a default when missing/empty.
 */
export function optionalEnv(key: string, defaultValue: string): string {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value : defaultValue;
}

/**
 * Reads a required env var. Throws when missing or empty.
 *
 * Used by DB migrations / extensions setup where a missing secret is fatal.
 */
export function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim().length === 0) {
    throw new Error(`Required environment variable "${key}" is not set. Add it to your .env file (see .env.example).`);
  }
  return value;
}

/**
 * Resolves an env-config value by key (alias for {@link getEnv}).
 *
 * Used by config modules that enumerate keys dynamically.
 */
export function resolveEnvConfig(key: string): string | undefined {
  return getEnv(key);
}

/**
 * Validates that the minimum environment required for the app to boot is present.
 *
 * For schema/DB-CLI work only `DATABASE_URL` (or `DB_FILE_NAME` for SQLite) is
 * required. Other secrets are warned about but do not throw — the app routes
 * that need them will fail loudly at request time if missing.
 *
 * @returns The validated environment configuration.
 * @throws When `DATABASE_URL` is missing for postgres/neon provider.
 */
export function ensureEnvironmentValidated(): EnvironmentConfig {
  const config = getEnvironmentConfig();

  if (config.dbProvider === "sqlite") {
    if (!config.dbFileName && !config.databaseUrl) {
      throw new Error("DB_PROVIDER=sqlite requires DB_FILE_NAME (or a file:/libsql: DATABASE_URL) in your .env file.");
    }
    return config;
  }

  // postgres / neon
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is not set. Add DATABASE_URL=postgresql://... to your .env file (see .env.example).");
  }

  if (!config.databaseEncryptionKey && config.nodeEnv === "production") {
    throw new Error("DATABASE_ENCRYPTION_KEY is required in production (AES-256-GCM column-level encryption).");
  }

  return config;
}
