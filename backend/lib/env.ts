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

/** Payment-gateway intention-API base host used when `PAYMOB_API_BASE_URL` is unset or empty. */
const DEFAULT_PAYMOB_API_BASE_URL = "https://accept.paymob.com";

/**
 * Hosted-checkout URL prefix used when `PAYMOB_CHECKOUT_BASE_URL` is unset or
 * empty. The checkout URL is assembled from this prefix, so it carries the
 * full host (+ optional path) — the upstream hosted-checkout host has moved
 * before, and this default is the current documented one (the earlier
 * `https://accept.paymob.com/unifiedcheckout/` value remains a valid
 * operator-configured fallback).
 */
const DEFAULT_PAYMOB_CHECKOUT_BASE_URL = "https://eg.checkout.paymob.com";

/** Upstream gateway HTTP timeout (ms) used when `PAYMOB_HTTP_TIMEOUT_MS` is unset or unusable. */
const DEFAULT_PAYMOB_HTTP_TIMEOUT_MS = 10000;

/**
 * Age (in minutes) a pending gateway payment may reach before the
 * reconciliation sweep inquires about it, used when
 * `PAYMOB_RECONCILE_PENDING_MINUTES` is unset or unusable.
 */
const DEFAULT_PAYMOB_RECONCILE_PENDING_MINUTES = 30;

/**
 * Inactivity window (minutes) after which the auto-offline sweep marks an
 * online teacher unavailable, used when `TEACHER_INACTIVITY_TIMEOUT_MINUTES`
 * is unset or unusable. The 15-minute default is the resolved inactivity-
 * timeout decision B.15 (docs/specs/open-decisions-and-gaps.md:159-163).
 */
const DEFAULT_TEACHER_INACTIVITY_TIMEOUT_MINUTES = 15;

/**
 * Per-account failed-login attempt budget (`LOGIN_RATE_LIMIT_MAX`) — the
 * account-keyed login lockout tier. 5 attempts per 15-minute window by
 * default (the REQ-006 failed-login lockout pin).
 */
const DEFAULT_LOGIN_RATE_LIMIT_MAX = 5;

/**
 * Per-account login lockout window in milliseconds
 * (`LOGIN_RATE_LIMIT_WINDOW_MS`; default 15 minutes).
 */
const DEFAULT_LOGIN_WINDOW_MS = 900_000;

/** Local dev-server port the ngrok tunnel forwards to when `NGROK_PORT` is unset or unusable. */
const DEFAULT_NGROK_PORT = 3000;

/**
 * Parses an HTTPS-only URL env value. A configured value is accepted only
 * when it parses as an absolute URL with the `https:` protocol — these
 * members feed outbound Paymob requests and hosted-checkout URLs that carry
 * API credentials and checkout client secrets, so an `http:` (or any other
 * scheme) value would leak them in cleartext. Anything else — missing,
 * empty, unparseable, or non-HTTPS — falls back to the provided default so
 * a bad operator value degrades to the documented host instead of being
 * cached and used upstream.
 */
function parseHttpsUrlEnv(raw: string | undefined, fallback: string): string {
  const trimmed = trimmedEnvValue(raw);
  if (!trimmed) {
    return fallback;
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" ? trimmed : fallback;
  } catch {
    return fallback;
  }
}

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
 * Parses a positive-integer env value (connection caps, timeouts, sweep
 * windows). Accepts plain decimal integers `>= 1`; anything else falls back
 * to the provided default.
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
 * Parses an optional integer env value (provider integration IDs). Accepts
 * plain non-negative decimal integers within the safe-integer range;
 * ANYTHING else — missing, empty, fractional, signed, garbage, or a value
 * beyond `Number.MAX_SAFE_INTEGER` (which `Number.parseInt` would round) —
 * resolves to `null` so the receiving configuration counts the key as
 * unconfigured and provider guards fail closed at request time instead of
 * sending a guessed identifier upstream.
 */
function parseOptionalIntegerEnv(raw: string | undefined): number | null {
  const trimmed = raw?.trim() ?? "";
  if (!/^\d+$/u.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Resolves a secret-bearing env value. Returns the trimmed value, or `null`
 * when the key is missing/empty/whitespace-only — an empty string is NEVER a
 * configured secret, so callers can distinguish "unset" from `""` uniformly
 * via `null`.
 */
function nullableSecretEnvValue(raw: string | undefined): string | null {
  return trimmedEnvValue(raw) ?? null;
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
  /**
   * Teacher inactivity timeout in minutes (`TEACHER_INACTIVITY_TIMEOUT_MINUTES`;
   * default 15 — the resolved inactivity-timeout decision B.15). The
   * auto-offline sweep marks an online teacher whose last activity is older
   * than this window unavailable.
   */
  teacherInactivityTimeoutMinutes: number;
  /**
   * Per-account failed-login attempt budget (`LOGIN_RATE_LIMIT_MAX`;
   * default 5) enforced by the account-keyed login limiter
   * (`loginAccountLimiter` in `backend/lib/ratelimit.ts`). The limit is
   * re-resolved lazily on every check so `resetEnvironmentCache()` is
   * observable in override tests.
   */
  loginRateLimitMax: number;
  /**
   * Per-account login lockout window in milliseconds
   * (`LOGIN_RATE_LIMIT_WINDOW_MS`; default 15 minutes).
   */
  loginRateLimitWindowMs: number;
  /**
   * Active payment gateway provider for the billing purchase flow
   * (`PAYMENT_GATEWAY_PROVIDER`, trimmed + lowercased; default `"mock"`).
   * Only adapters with a matching gateway implementation can be selected;
   * any other value makes the gateway factory fail closed.
   */
  paymentGatewayProvider: string;
  /**
   * Shared secret verifying payment gateway webhook signatures
   * (`PAYMENT_WEBHOOK_SECRET`). `undefined` means no secret is configured —
   * the webhook surface must then reject every callback (fail closed).
   */
  paymentWebhookSecret: string | undefined;
  /**
   * Whether the payment webhook surface accepts gateway callbacks
   * (`PAYMENT_WEBHOOK_ENABLED === "true"` after trimming; default `false`).
   * A disabled surface must be indistinguishable from an unknown path.
   */
  paymentWebhookEnabled: boolean;
  /**
   * Provider-facing configuration for the Paymob payment gateway. Secret
   * members are resolved server-side only; every nullable member is `null`
   * when its key is unset/empty so request-time provider guards can fail
   * closed on a partially configured gateway.
   */
  paymob: {
    /** Server-side token used to authenticate intention creation; `null` = unconfigured. */
    secretKey: string | null;
    /** Client-safe public key carried (as a URL parameter) by the hosted-checkout URL. */
    publicKey: string | null;
    /** Shared HMAC-SHA512 secret verifying gateway callbacks; `null` = unconfigured. */
    hmacSecret: string | null;
    /** Server-to-server API key enabling reconciliation inquiries; `null` = unconfigured. */
    apiKey: string | null;
    /** Card integration ID (integer); `null` = unconfigured → the gateway guard fails closed. */
    integrationIdCard: number | null;
    /** Mobile-wallet integration ID (integer); optional even when the card ID is configured. */
    integrationIdWallet: number | null;
    /** Intention-API base host (no path). */
    apiBaseUrl: string;
    /** Hosted-checkout URL prefix (full host + optional path) checkout URLs are assembled from. */
    checkoutBaseUrl: string;
    /** Upstream gateway HTTP timeout in milliseconds. */
    httpTimeoutMs: number;
    /** Pending-payment age (minutes) that triggers a reconciliation inquiry. */
    reconcilePendingMinutes: number;
  };
  /**
   * ngrok tunnel configuration for non-production callback delivery. Purely
   * a dev/test convenience — never read on the production path — and both
   * nullable members are `null` unless explicitly configured (the tunnel
   * callback channel is only eligible when BOTH are set).
   */
  ngrok: {
    /** ngrok authtoken; `null` = not configured (tunnel channel ineligible). */
    authtoken: string | null;
    /** Reserved public ngrok domain; `null` = not configured (tunnel channel ineligible). */
    domain: string | null;
    /** Local dev-server port the tunnel forwards to (default 3000). */
    port: number;
  };
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
    teacherInactivityTimeoutMinutes: parsePositiveIntegerEnv(
      process.env.TEACHER_INACTIVITY_TIMEOUT_MINUTES,
      DEFAULT_TEACHER_INACTIVITY_TIMEOUT_MINUTES
    ),
    loginRateLimitMax: parsePositiveIntegerEnv(process.env.LOGIN_RATE_LIMIT_MAX, DEFAULT_LOGIN_RATE_LIMIT_MAX),
    loginRateLimitWindowMs: parsePositiveIntegerEnv(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, DEFAULT_LOGIN_WINDOW_MS),
    paymentGatewayProvider: (trimmedEnvValue(process.env.PAYMENT_GATEWAY_PROVIDER) ?? "mock").toLowerCase(),
    paymentWebhookSecret: trimmedEnvValue(process.env.PAYMENT_WEBHOOK_SECRET),
    paymentWebhookEnabled: trimmedEnvValue(process.env.PAYMENT_WEBHOOK_ENABLED) === "true",
    paymob: {
      secretKey: nullableSecretEnvValue(process.env.PAYMOB_SECRET_KEY),
      publicKey: nullableSecretEnvValue(process.env.PAYMOB_PUBLIC_KEY),
      hmacSecret: nullableSecretEnvValue(process.env.PAYMOB_HMAC_SECRET),
      apiKey: nullableSecretEnvValue(process.env.PAYMOB_API_KEY),
      integrationIdCard: parseOptionalIntegerEnv(process.env.PAYMOB_INTEGRATION_ID_CARD),
      integrationIdWallet: parseOptionalIntegerEnv(process.env.PAYMOB_INTEGRATION_ID_WALLET),
      apiBaseUrl: parseHttpsUrlEnv(process.env.PAYMOB_API_BASE_URL, DEFAULT_PAYMOB_API_BASE_URL),
      checkoutBaseUrl: parseHttpsUrlEnv(process.env.PAYMOB_CHECKOUT_BASE_URL, DEFAULT_PAYMOB_CHECKOUT_BASE_URL),
      httpTimeoutMs: parsePositiveIntegerEnv(process.env.PAYMOB_HTTP_TIMEOUT_MS, DEFAULT_PAYMOB_HTTP_TIMEOUT_MS),
      reconcilePendingMinutes: parsePositiveIntegerEnv(
        process.env.PAYMOB_RECONCILE_PENDING_MINUTES,
        DEFAULT_PAYMOB_RECONCILE_PENDING_MINUTES
      ),
    },
    ngrok: {
      authtoken: nullableSecretEnvValue(process.env.NGROK_AUTHTOKEN),
      domain: nullableSecretEnvValue(process.env.NGROK_DOMAIN),
      port: parsePortEnv(process.env.NGROK_PORT, DEFAULT_NGROK_PORT),
    },
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

// ─── Payment gateway (billing purchase flow) typed getters ──────────────────
// Every getter reads through getEnvironmentConfig(), so all of these keys are
// covered by resetEnvironmentCache(): after a reset the next call re-reads
// process.env from scratch. The gateway factory's resetPaymentGateway()
// drops its resolved adapter AND this snapshot, so provider/secret/enabled
// swaps take effect without a process restart.

/**
 * Active payment gateway provider (`PAYMENT_GATEWAY_PROVIDER`).
 *
 * Trimmed + lowercased; missing/empty/whitespace values resolve to the
 * built-in `"mock"` provider. Must be compared against gateway enum members
 * — anything without an adapter makes the factory fail closed.
 */
export function getPaymentGatewayProvider(): string {
  return getEnvironmentConfig().paymentGatewayProvider;
}

/**
 * Shared secret verifying payment gateway webhook signatures
 * (`PAYMENT_WEBHOOK_SECRET`). `undefined` means "no secret configured" —
 * consumers must treat every callback as unauthentic (fail closed).
 */
export function getPaymentWebhookSecret(): string | undefined {
  return getEnvironmentConfig().paymentWebhookSecret;
}

/**
 * Whether the payment webhook surface accepts gateway callbacks
 * (`PAYMENT_WEBHOOK_ENABLED`). Only the exact value `"true"` (after
 * trimming) enables the surface; every other value — including unset —
 * keeps it disabled so an unconfigured deployment leaks nothing.
 */
export function isPaymentWebhookEnabled(): boolean {
  return getEnvironmentConfig().paymentWebhookEnabled;
}

/**
 * Provider-facing Paymob gateway configuration (the `paymob` members of
 * {@link EnvironmentConfig}).
 *
 * Reads through {@link getEnvironmentConfig}, so the snapshot — including
 * every secret — is cached until {@link resetEnvironmentCache} runs (e.g.
 * after an env-file swap). Nullable members are `null` when their key is
 * unset/empty; consumers (adapter guards, the reconciliation sweep) must
 * treat `null` credentials as "gateway not configured" and fail closed at
 * request time. Secrets here are server-side only — this module must never
 * be imported by client code, and the values must never be logged.
 */
export function getPaymobConfig(): EnvironmentConfig["paymob"] {
  return getEnvironmentConfig().paymob;
}

// ─── Teacher availability (auto-offline sweep) typed getters ────────────────
// Every getter reads through getEnvironmentConfig(), so all of these keys are
// covered by resetEnvironmentCache(): after a reset the next call re-reads
// process.env from scratch.

/**
 * Teacher inactivity timeout in minutes (`TEACHER_INACTIVITY_TIMEOUT_MINUTES`;
 * default 15 — the resolved inactivity-timeout decision B.15). The auto-offline
 * sweep marks an online teacher whose last activity is older than this window
 * unavailable.
 *
 * Positive integers only; anything else (zero, negative, garbage) falls back
 * to the default so a bad operator value can neither disable the sweep nor
 * hyper-accelerate it.
 */
export function getTeacherInactivityTimeoutMinutes(): number {
  return getEnvironmentConfig().teacherInactivityTimeoutMinutes;
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

  if (!getEnv("JWT_ACCESS_SECRET") && config.nodeEnv === "production") {
    throw new Error("JWT_ACCESS_SECRET is required in production environment.");
  }

  if (!getEnv("JWT_REFRESH_SECRET") && config.nodeEnv === "production") {
    throw new Error("JWT_REFRESH_SECRET is required in production environment.");
  }

  return config;
}
