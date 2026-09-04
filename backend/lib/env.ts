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

/** Force `.env` DB keys to win over stale OS-env placeholders (one-time, idempotent). */
function applyDbEnvOverride(): void {
  // ONLY defeat the SANDBOX PLACEHOLDER: an OS env whose DATABASE_URL is
  // missing or a `file:`/`libsql:` SQLite stub. When a real (non-placeholder)
  // URL is already pinned — an OS env var, or a sanctioned runner's
  // `--env-file=.env.test` / db-CLI `--env-file` load — that pin MUST win:
  // force-overriding it from the dev `.env` silently retargeted test
  // processes and test-targeted CLI invocations at the DEV database.
  const currentUrl = process.env.DATABASE_URL;
  // Trim before classifying: a blank or whitespace-only URL is as unusable
  // as a missing one and must not pin the process against loading `.env`.
  const trimmedUrl = currentUrl?.trim();
  const isPlaceholder =
    trimmedUrl === undefined ||
    trimmedUrl.length === 0 ||
    trimmedUrl.startsWith("file:") ||
    trimmedUrl.startsWith("libsql:");
  if (!isPlaceholder) {
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

/**
 * Fan-out transport selection for realtime notification delivery.
 *
 * - `"redis"` — Redis pub/sub bus; required whenever the emitting process
 *   and the WebSocket sidecar are separate processes.
 * - `"in-process"` — direct in-memory tap; the only transport that can work
 *   in single-process dev and in tests/harnesses.
 */
export type NotificationFanoutTransport = "redis" | "in-process";

/** WebSocket sidecar listen port used when `WS_PORT` is unset or unusable.
 *  NOT 3000/3001 — those belong to the Next.js dev server (which may run on
 *  either); the sidecar must never collide with the HTTP app. */
const DEFAULT_WS_PORT = 3101;

/** WebSocket sidecar listen host used when `WS_HOST` is unset or empty. */
const DEFAULT_WS_HOST = "127.0.0.1";

/**
 * Dev/test origin allowlist used when `WS_ALLOWED_ORIGINS` is unset or
 * unusable — the loopback hostnames of the Next.js dev server on BOTH :3000
 * and :3001 (Next auto-increments to 3001 whenever 3000 is occupied).
 * A wildcard (`"*"`) is NEVER a default: the WebSocket handshake carries
 * credentials, so an allow-all origin would re-open the cross-site
 * WebSocket hijacking hole the allowlist exists to close.
 */
const DEFAULT_WS_ALLOWED_ORIGINS: readonly string[] = Object.freeze([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
]);

/** Global connection cap used when `WS_MAX_CONNECTIONS` is unset or unusable. */
const DEFAULT_WS_MAX_CONNECTIONS = 1000;

/** Per-user connection cap used when `WS_MAX_CONNECTIONS_PER_USER` is unset or unusable. */
const DEFAULT_WS_MAX_CONNECTIONS_PER_USER = 5;

/**
 * Trims an env value; empty and whitespace-only values count as "not set"
 * (same emptiness semantics as {@link optionalEnv}).
 */
function trimmedEnvValue(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (trimmed) {
    return trimmed;
  }
  return undefined;
}

/**
 * Parses a TCP listen port env value. Accepts plain decimal integers in
 * `[0, 65535]` (0 asks the OS for an ephemeral port — how sidecar test suites
 * bind); anything else (missing, partial like `"3001abc"`, fractional, out
 * of range) falls back to the provided default.
 */
function parsePortEnv(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim() ?? "";
  if (!/^\d+$/u.test(trimmed)) {
    return fallback;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return parsed <= 65535 ? parsed : fallback;
}

/**
 * Parses a positive-integer env value (connection caps). Accepts plain
 * decimal integers `>= 1`; anything else falls back to the provided default.
 */
function parsePositiveIntegerEnv(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim() ?? "";
  if (!/^\d+$/u.test(trimmed)) {
    return fallback;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return parsed >= 1 ? parsed : fallback;
}

/**
 * Parses a comma-separated origin allowlist. Entries are trimmed and
 * case-normalized (origins are case-insensitive), empty entries are dropped,
 * and a wildcard (`"*"`) entry is DISCARDED — the handshake is credentialed,
 * so an allow-all origin must never come out of this resolver. Returns
 * `undefined` when nothing usable remains so the caller falls back to the
 * dev allowlist (fail-closed: an all-wildcard value degrades to localhost
 * origins, never to allow-all).
 */
function parseOriginAllowlistEnv(raw: string | undefined): readonly string[] | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  const origins = trimmed
    .split(",")
    .map(origin => origin.trim().toLowerCase())
    .filter(origin => origin.length > 0 && origin !== "*");
  return origins.length > 0 ? Object.freeze(origins) : undefined;
}

/**
 * Parses the fan-out transport selection (case-insensitive). Returns
 * `undefined` for missing/empty/unknown values so the caller applies the
 * default ladder instead of guessing.
 */
function parseFanoutTransportEnv(raw: string | undefined): NotificationFanoutTransport | undefined {
  const trimmed = raw?.trim().toLowerCase();
  if (trimmed === "redis" || trimmed === "in-process") {
    return trimmed;
  }
  return undefined;
}

/**
 * Applies the transport default ladder: an explicit valid selection wins;
 * otherwise a configured Redis URL selects the Redis bus (cross-process
 * fan-out needs it), and no Redis config keeps the in-process tap
 * (single-process dev / tests).
 */
function resolveFanoutTransport(
  explicit: NotificationFanoutTransport | undefined,
  redisConfigured: boolean
): NotificationFanoutTransport {
  if (explicit !== undefined) {
    return explicit;
  }
  return redisConfigured ? "redis" : "in-process";
}

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
  /** WebSocket sidecar listen port (0 = ephemeral port; dev default 3101). */
  wsPort: number;
  /** WebSocket sidecar listen host (dev default `"127.0.0.1"`). */
  wsHost: string;
  /**
   * Exact-match allowlist of browser origins accepted by the WebSocket
   * handshake (comma-separated env value; dev default = localhost origins).
   * Never contains a wildcard.
   */
  wsAllowedOrigins: readonly string[];
  /** Redis connection URL, when configured (fan-out bus + emit idempotency claims). */
  redisUrl: string | undefined;
  /** Realtime notification fan-out transport selection. */
  notificationFanoutTransport: NotificationFanoutTransport;
  /** Global WebSocket connection cap (the sidecar refuses connections beyond it). */
  wsMaxConnections: number;
  /** Per-user WebSocket connection cap (the sidecar evicts the oldest beyond it). */
  wsMaxConnectionsPerUser: number;
}

/**
 * Builds a snapshot of the relevant environment variables from `process.env`.
 * Pure function — does not mutate state.
 */
function readEnvironment(): EnvironmentConfig {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const redisUrl = trimmedEnvValue(process.env.REDIS_URL);
  const wsHost = trimmedEnvValue(process.env.WS_HOST);
  return {
    dbProvider: (process.env.DB_PROVIDER ?? "postgres").toLowerCase(),
    databaseUrl: process.env.DATABASE_URL,
    dbFileName: process.env.DB_FILE_NAME,
    cacheProvider: (process.env.CACHE_PROVIDER ?? "postgres").toLowerCase(),
    databaseEncryptionKey: process.env.DATABASE_ENCRYPTION_KEY,
    nodeEnv,
    wsPort: parsePortEnv(process.env.WS_PORT, DEFAULT_WS_PORT),
    wsHost: wsHost ?? DEFAULT_WS_HOST,
    wsAllowedOrigins: parseOriginAllowlistEnv(process.env.WS_ALLOWED_ORIGINS) ?? DEFAULT_WS_ALLOWED_ORIGINS,
    redisUrl,
    notificationFanoutTransport: resolveFanoutTransport(
      parseFanoutTransportEnv(process.env.NOTIFICATION_FANOUT_TRANSPORT),
      redisUrl !== undefined
    ),
    wsMaxConnections: parsePositiveIntegerEnv(process.env.WS_MAX_CONNECTIONS, DEFAULT_WS_MAX_CONNECTIONS),
    wsMaxConnectionsPerUser: parsePositiveIntegerEnv(
      process.env.WS_MAX_CONNECTIONS_PER_USER,
      DEFAULT_WS_MAX_CONNECTIONS_PER_USER
    ),
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

// ─── Realtime notification (WebSocket sidecar + fan-out) typed getters ──────
// Every getter reads through getEnvironmentConfig(), so all of these keys are
// covered by resetEnvironmentCache(): after a reset the next call re-reads
// process.env from scratch.

/**
 * WebSocket sidecar listen port (`WS_PORT`).
 *
 * Valid values are integers 0–65535 (0 binds an ephemeral OS port — used by
 * sidecar test suites); anything else falls back to the dev default (3101).
 */
export function getWebSocketPort(): number {
  return getEnvironmentConfig().wsPort;
}

/**
 * WebSocket sidecar listen host (`WS_HOST`; dev default `"127.0.0.1"`).
 * Whitespace-only values count as unset.
 */
export function getWebSocketHost(): string {
  return getEnvironmentConfig().wsHost;
}

/**
 * Exact-match allowlist of browser origins accepted by the WebSocket
 * handshake (`WS_ALLOWED_ORIGINS`, comma-separated).
 *
 * Entries are trimmed + case-normalized at resolution and wildcard entries
 * are discarded; the dev default is the localhost origins of the :3000 dev
 * server and NEVER widens to `"*"` — the handshake is credentialed.
 */
export function getWebSocketAllowedOrigins(): readonly string[] {
  return getEnvironmentConfig().wsAllowedOrigins;
}

/**
 * Redis connection URL (`REDIS_URL`), when one is configured. Consumed by the
 * Redis fan-out transport and the emit-idempotency claims. `undefined` means
 * "no Redis configured" (in-process fan-out).
 */
export function getRedisUrl(): string | undefined {
  return getEnvironmentConfig().redisUrl;
}

/**
 * Realtime notification fan-out transport selection
 * (`NOTIFICATION_FANOUT_TRANSPORT`).
 *
 * Resolution ladder:
 *  1. an explicit `"redis"` / `"in-process"` (case-insensitive) wins;
 *  2. unset/empty/unknown → `"redis"` when a Redis URL is explicitly
 *     configured (cross-process fan-out needs the bus), otherwise
 *     `"in-process"` (single-process dev / tests).
 */
export function getNotificationFanoutTransport(): NotificationFanoutTransport {
  return getEnvironmentConfig().notificationFanoutTransport;
}

/**
 * Global WebSocket connection cap (`WS_MAX_CONNECTIONS`; dev default 1000).
 * Positive integers only; anything else falls back to the default.
 */
export function getWebSocketMaxConnections(): number {
  return getEnvironmentConfig().wsMaxConnections;
}

/**
 * Per-user WebSocket connection cap (`WS_MAX_CONNECTIONS_PER_USER`; dev
 * default 5 — a few browser tabs + devices). Positive integers only;
 * anything else falls back to the default.
 */
export function getWebSocketMaxConnectionsPerUser(): number {
  return getEnvironmentConfig().wsMaxConnectionsPerUser;
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
