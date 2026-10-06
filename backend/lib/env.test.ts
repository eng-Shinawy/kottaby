/**
 * `backend/lib/env.ts` — env-seam registration suite
 * (realtime-notification keys + Paymob gateway provider keys + ngrok
 * dev-tunnel keys + the teacher-inactivity auto-offline sweep knob).
 *
 * Coverage map (the three mandated tiers + the guard/security tiers of the
 * repo's env-manipulating suites):
 *  - Registry inclusion: every registered key is wired through the env-config
 *    seam — a distinctive explicit value is observable through its typed
 *    getter, and the cached snapshot carries all seven realtime fields plus
 *    the full `paymob` and `ngrok` configuration objects.
 *  - Invalidation coverage: every key is resolved from the CACHED snapshot
 *    (stale-env proof), is re-read after `resetEnvironmentCache()` (set
 *    value → reset → custom value), and falls back to its default once the
 *    env value is removed and the cache is reset again (remove → reset →
 *    default returns).
 *  - Typed defaults: with every realtime key absent, the getters return the
 *    documented dev/test defaults (port / host / origins / transport / caps),
 *    and the transport default flips to "redis" ONLY when a Redis URL is
 *    explicitly present. With every paymob/ngrok key absent, the config
 *    resolves to its inert snapshot (null credentials/IDs, documented base
 *    URLs, timeout 10000, sweep window 30, tunnel port 3000).
 *  - Parsing boundaries: port bounds (0 = ephemeral … 65535), positive-int
 *    caps, host emptiness semantics, origin-list splitting/trimming/case
 *    normalization, transport vocabulary (case-insensitive); integration-ID
 *    integer coercion (floats, signs, garbage → null), empty-string secrets
 *    rejected (never observable as empty strings), timeout/sweep-window
 *    positive-int fallbacks, checkout-URL override verbatim (including the
 *    legacy unifiedcheckout fallback value), tunnel-port bounds, and the
 *    teacher-inactivity window (unset → 15; garbage/zero/negative → 15
 *    without ever throwing).
 *  - Security: a wildcard origin is unreachable in ANY resolution shape
 *    (default, explicit mixed, all-wildcard); credential-bearing Redis URLs
 *    never cross the non-URL config disclosure surface; paymob secret
 *    material is exposed ONLY through the `paymob` members (never the ngrok
 *    or realtime surfaces); the module performs zero logging (source-pinned)
 *    — connection strings and secrets stay off every log.
 *  - Test-CI contract: the shared `TEST_CI_UNSET_PAYMOB_ENV_KEYS` list stays
 *    pinned to exactly the ten PAYMOB_* keys (tunnel keys excluded), so test
 *    CI keeps the gateway inert and the tunnel channel unselectable.
 *
 * Pure unit tier — NO DB, NO server boot. Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/lib/env.test.ts`
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getEnvironmentConfig,
  getNotificationFanoutTransport,
  getPaymobConfig,
  getRedisUrl,
  getTeacherInactivityTimeoutMinutes,
  getWebSocketAllowedOrigins,
  getWebSocketHost,
  getWebSocketMaxConnections,
  getWebSocketMaxConnectionsPerUser,
  getWebSocketPort,
  resetEnvironmentCache,
} from "@/backend/lib/env";
import { TEST_CI_UNSET_PAYMOB_ENV_KEYS } from "@/backend/lib/test-ci-env";

// ─── Env-manipulation fixture (restored after every case) ───────────────────

/** Every realtime key registered in this change set. */
const REALTIME_ENV_KEYS = [
  "WS_PORT",
  "WS_HOST",
  "WS_ALLOWED_ORIGINS",
  "NOTIFICATION_FANOUT_TRANSPORT",
  "REDIS_URL",
  "WS_MAX_CONNECTIONS",
  "WS_MAX_CONNECTIONS_PER_USER",
] as const;

const originalEnv: Record<string, string | undefined> = {};
for (const key of REALTIME_ENV_KEYS) {
  originalEnv[key] = process.env[key];
}

/** Removes every realtime key — the deterministic base for default probes. */
function clearRealtimeEnv(): void {
  for (const key of REALTIME_ENV_KEYS) {
    delete process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of REALTIME_ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetEnvironmentCache();
}

/** The dev/test default allowlist, asserted in several suites below. */
const DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
];

// ─── Registry inclusion ─────────────────────────────────────────────────────

describe("registry inclusion — every realtime key resolves through the env seam", () => {
  beforeEach(() => {
    clearRealtimeEnv();
    resetEnvironmentCache();
  });
  afterEach(restoreEnv);

  test("WS_PORT is observable through getWebSocketPort()", () => {
    process.env.WS_PORT = "4321";
    resetEnvironmentCache();
    expect(getWebSocketPort()).toBe(4321);
  });

  test("WS_HOST is observable through getWebSocketHost()", () => {
    process.env.WS_HOST = "ws.local.test";
    resetEnvironmentCache();
    expect(getWebSocketHost()).toBe("ws.local.test");
  });

  test("WS_ALLOWED_ORIGINS is observable through getWebSocketAllowedOrigins()", () => {
    process.env.WS_ALLOWED_ORIGINS = "https://one.example.com,https://two.example.com";
    resetEnvironmentCache();
    expect(getWebSocketAllowedOrigins()).toEqual(["https://one.example.com", "https://two.example.com"]);
  });

  test("NOTIFICATION_FANOUT_TRANSPORT is observable through getNotificationFanoutTransport()", () => {
    process.env.NOTIFICATION_FANOUT_TRANSPORT = "redis";
    resetEnvironmentCache();
    expect(getNotificationFanoutTransport()).toBe("redis");
  });

  test("REDIS_URL is observable through getRedisUrl()", () => {
    process.env.REDIS_URL = "redis://127.0.0.1:6390";
    resetEnvironmentCache();
    expect(getRedisUrl()).toBe("redis://127.0.0.1:6390");
  });

  test("WS_MAX_CONNECTIONS is observable through getWebSocketMaxConnections()", () => {
    process.env.WS_MAX_CONNECTIONS = "42";
    resetEnvironmentCache();
    expect(getWebSocketMaxConnections()).toBe(42);
  });

  test("WS_MAX_CONNECTIONS_PER_USER is observable through getWebSocketMaxConnectionsPerUser()", () => {
    process.env.WS_MAX_CONNECTIONS_PER_USER = "3";
    resetEnvironmentCache();
    expect(getWebSocketMaxConnectionsPerUser()).toBe(3);
  });

  test("the cached snapshot carries all seven realtime fields", () => {
    const config = getEnvironmentConfig();
    expect(typeof config.wsPort).toBe("number");
    expect(typeof config.wsHost).toBe("string");
    expect(Array.isArray(config.wsAllowedOrigins)).toBe(true);
    expect(config.redisUrl === undefined || typeof config.redisUrl === "string").toBe(true);
    expect(["redis", "in-process"]).toContain(config.notificationFanoutTransport);
    expect(typeof config.wsMaxConnections).toBe("number");
    expect(typeof config.wsMaxConnectionsPerUser).toBe("number");
  });
});

// ─── Invalidation coverage (resetEnvironmentCache) ──────────────────────────

describe("invalidation coverage — resetEnvironmentCache re-reads every realtime key", () => {
  beforeEach(() => {
    clearRealtimeEnv();
    resetEnvironmentCache();
  });
  afterEach(restoreEnv);

  test("WS_PORT: stale until reset, re-read after reset, default after removal", () => {
    expect(getWebSocketPort()).toBe(3101); // builds the cache from cleared env
    process.env.WS_PORT = "4321";
    expect(getWebSocketPort()).toBe(3101); // STALE — reads go through the cache
    resetEnvironmentCache();
    expect(getWebSocketPort()).toBe(4321); // reset re-reads the key
    delete process.env.WS_PORT;
    resetEnvironmentCache();
    expect(getWebSocketPort()).toBe(3101); // removal + reset → default returns
  });

  test("WS_HOST: stale until reset, re-read after reset, default after removal", () => {
    expect(getWebSocketHost()).toBe("127.0.0.1");
    process.env.WS_HOST = "0.0.0.0";
    expect(getWebSocketHost()).toBe("127.0.0.1");
    resetEnvironmentCache();
    expect(getWebSocketHost()).toBe("0.0.0.0");
    delete process.env.WS_HOST;
    resetEnvironmentCache();
    expect(getWebSocketHost()).toBe("127.0.0.1");
  });

  test("WS_ALLOWED_ORIGINS: stale until reset, re-read after reset, default after removal", () => {
    expect(getWebSocketAllowedOrigins()).toEqual(DEFAULT_ORIGINS);
    process.env.WS_ALLOWED_ORIGINS = "https://custom.example.com";
    expect(getWebSocketAllowedOrigins()).toEqual(DEFAULT_ORIGINS);
    resetEnvironmentCache();
    expect(getWebSocketAllowedOrigins()).toEqual(["https://custom.example.com"]);
    delete process.env.WS_ALLOWED_ORIGINS;
    resetEnvironmentCache();
    expect(getWebSocketAllowedOrigins()).toEqual(DEFAULT_ORIGINS);
  });

  test("NOTIFICATION_FANOUT_TRANSPORT: stale until reset, re-read after reset, default after removal", () => {
    expect(getNotificationFanoutTransport()).toBe("in-process");
    process.env.NOTIFICATION_FANOUT_TRANSPORT = "redis";
    expect(getNotificationFanoutTransport()).toBe("in-process");
    resetEnvironmentCache();
    expect(getNotificationFanoutTransport()).toBe("redis");
    delete process.env.NOTIFICATION_FANOUT_TRANSPORT;
    resetEnvironmentCache();
    expect(getNotificationFanoutTransport()).toBe("in-process");
  });

  test("REDIS_URL: stale until reset, re-read after reset, default after removal", () => {
    expect(getRedisUrl()).toBeUndefined();
    process.env.REDIS_URL = "redis://127.0.0.1:6390";
    expect(getRedisUrl()).toBeUndefined();
    resetEnvironmentCache();
    expect(getRedisUrl()).toBe("redis://127.0.0.1:6390");
    delete process.env.REDIS_URL;
    resetEnvironmentCache();
    expect(getRedisUrl()).toBeUndefined();
  });

  test("WS_MAX_CONNECTIONS: stale until reset, re-read after reset, default after removal", () => {
    expect(getWebSocketMaxConnections()).toBe(1000);
    process.env.WS_MAX_CONNECTIONS = "42";
    expect(getWebSocketMaxConnections()).toBe(1000);
    resetEnvironmentCache();
    expect(getWebSocketMaxConnections()).toBe(42);
    delete process.env.WS_MAX_CONNECTIONS;
    resetEnvironmentCache();
    expect(getWebSocketMaxConnections()).toBe(1000);
  });

  test("WS_MAX_CONNECTIONS_PER_USER: stale until reset, re-read after reset, default after removal", () => {
    expect(getWebSocketMaxConnectionsPerUser()).toBe(5);
    process.env.WS_MAX_CONNECTIONS_PER_USER = "3";
    expect(getWebSocketMaxConnectionsPerUser()).toBe(5);
    resetEnvironmentCache();
    expect(getWebSocketMaxConnectionsPerUser()).toBe(3);
    delete process.env.WS_MAX_CONNECTIONS_PER_USER;
    resetEnvironmentCache();
    expect(getWebSocketMaxConnectionsPerUser()).toBe(5);
  });
});

// ─── Typed dev/test defaults ────────────────────────────────────────────────

describe("typed dev/test defaults — every realtime key absent", () => {
  beforeEach(() => {
    clearRealtimeEnv();
    resetEnvironmentCache();
  });
  afterEach(restoreEnv);

  test("WS_PORT defaults to 3101", () => {
    expect(getWebSocketPort()).toBe(3101);
  });

  test("WS_HOST defaults to the loopback address", () => {
    expect(getWebSocketHost()).toBe("127.0.0.1");
  });

  test("WS_ALLOWED_ORIGINS defaults to the localhost dev origins (never a wildcard)", () => {
    const origins = getWebSocketAllowedOrigins();
    expect(origins).toEqual(DEFAULT_ORIGINS);
    expect(origins.includes("*")).toBe(false);
  });

  test("NOTIFICATION_FANOUT_TRANSPORT defaults to in-process without Redis config", () => {
    expect(getNotificationFanoutTransport()).toBe("in-process");
  });

  test("NOTIFICATION_FANOUT_TRANSPORT defaults to redis when REDIS_URL is explicitly present", () => {
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    resetEnvironmentCache();
    expect(getNotificationFanoutTransport()).toBe("redis");
  });

  test("an explicit in-process selection still wins when REDIS_URL is present", () => {
    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    process.env.NOTIFICATION_FANOUT_TRANSPORT = "in-process";
    resetEnvironmentCache();
    expect(getNotificationFanoutTransport()).toBe("in-process");
  });

  test("REDIS_URL defaults to undefined (no Redis configured)", () => {
    expect(getRedisUrl()).toBeUndefined();
  });

  test("WS_MAX_CONNECTIONS defaults to 1000", () => {
    expect(getWebSocketMaxConnections()).toBe(1000);
  });

  test("WS_MAX_CONNECTIONS_PER_USER defaults to 5", () => {
    expect(getWebSocketMaxConnectionsPerUser()).toBe(5);
  });
});

// ─── Parsing boundaries ─────────────────────────────────────────────────────

describe("parsing boundaries", () => {
  beforeEach(() => {
    clearRealtimeEnv();
    resetEnvironmentCache();
  });
  afterEach(restoreEnv);

  test("WS_PORT accepts 0 (ephemeral bind) and the 65535 upper bound", () => {
    process.env.WS_PORT = "0";
    resetEnvironmentCache();
    expect(getWebSocketPort()).toBe(0);

    process.env.WS_PORT = "65535";
    resetEnvironmentCache();
    expect(getWebSocketPort()).toBe(65535);
  });

  test("WS_PORT rejects malformed/out-of-range values → default 3101", () => {
    const invalidValues = ["-1", "65536", "abc", "3.5", "", "   ", "3001abc", "0x10", "99999999999999999999"];
    for (const invalid of invalidValues) {
      process.env.WS_PORT = invalid;
      resetEnvironmentCache();
      expect(getWebSocketPort()).toBe(3101);
    }
  });

  test("WS_MAX_CONNECTIONS accepts the 1 lower bound, rejects non-positive/garbage → default 1000", () => {
    process.env.WS_MAX_CONNECTIONS = "1";
    resetEnvironmentCache();
    expect(getWebSocketMaxConnections()).toBe(1);

    const invalidValues = ["0", "-5", "2.5", "abc", "", "12abc"];
    for (const invalid of invalidValues) {
      process.env.WS_MAX_CONNECTIONS = invalid;
      resetEnvironmentCache();
      expect(getWebSocketMaxConnections()).toBe(1000);
    }
  });

  test("WS_MAX_CONNECTIONS_PER_USER accepts the 1 lower bound, rejects non-positive/garbage → default 5", () => {
    process.env.WS_MAX_CONNECTIONS_PER_USER = "1";
    resetEnvironmentCache();
    expect(getWebSocketMaxConnectionsPerUser()).toBe(1);

    const invalidValues = ["0", "-2", "1.5", "abc", "", "  "];
    for (const invalid of invalidValues) {
      process.env.WS_MAX_CONNECTIONS_PER_USER = invalid;
      resetEnvironmentCache();
      expect(getWebSocketMaxConnectionsPerUser()).toBe(5);
    }
  });

  test("WS_HOST trims surrounding whitespace and treats whitespace-only as unset", () => {
    process.env.WS_HOST = "  0.0.0.0  ";
    resetEnvironmentCache();
    expect(getWebSocketHost()).toBe("0.0.0.0");

    process.env.WS_HOST = "   ";
    resetEnvironmentCache();
    expect(getWebSocketHost()).toBe("127.0.0.1");
  });

  test("WS_ALLOWED_ORIGINS splits on commas, trims entries, drops empties, case-normalizes", () => {
    process.env.WS_ALLOWED_ORIGINS = "  https://App.Example.com ,, , https://b.example.com  ";
    resetEnvironmentCache();
    expect(getWebSocketAllowedOrigins()).toEqual(["https://app.example.com", "https://b.example.com"]);
  });

  test("WS_ALLOWED_ORIGINS whitespace-only value falls back to the dev default", () => {
    process.env.WS_ALLOWED_ORIGINS = " , , ";
    resetEnvironmentCache();
    expect(getWebSocketAllowedOrigins()).toEqual(DEFAULT_ORIGINS);
  });

  test("REDIS_URL whitespace-only counts as absent (getter undefined, transport stays in-process)", () => {
    process.env.REDIS_URL = "   ";
    resetEnvironmentCache();
    expect(getRedisUrl()).toBeUndefined();
    expect(getNotificationFanoutTransport()).toBe("in-process");
  });

  test("REDIS_URL value is returned trimmed", () => {
    process.env.REDIS_URL = "  redis://127.0.0.1:6390  ";
    resetEnvironmentCache();
    expect(getRedisUrl()).toBe("redis://127.0.0.1:6390");
  });

  test("NOTIFICATION_FANOUT_TRANSPORT is case-insensitive and whitespace-tolerant", () => {
    process.env.NOTIFICATION_FANOUT_TRANSPORT = "REDIS";
    resetEnvironmentCache();
    expect(getNotificationFanoutTransport()).toBe("redis");

    process.env.NOTIFICATION_FANOUT_TRANSPORT = "  In-Process ";
    resetEnvironmentCache();
    expect(getNotificationFanoutTransport()).toBe("in-process");
  });

  test("an unknown transport value never selects redis on its own — the default ladder applies", () => {
    process.env.NOTIFICATION_FANOUT_TRANSPORT = "kafka";
    resetEnvironmentCache();
    expect(getNotificationFanoutTransport()).toBe("in-process"); // no Redis configured

    process.env.REDIS_URL = "redis://127.0.0.1:6379";
    resetEnvironmentCache();
    expect(getNotificationFanoutTransport()).toBe("redis"); // default ladder with Redis present
  });
});

// ─── Security posture ───────────────────────────────────────────────────────

describe("security posture", () => {
  beforeEach(() => {
    clearRealtimeEnv();
    resetEnvironmentCache();
  });
  afterEach(restoreEnv);

  test("an explicitly configured wildcard entry is discarded (safe entries kept)", () => {
    process.env.WS_ALLOWED_ORIGINS = "*,https://safe.example.com";
    resetEnvironmentCache();
    expect(getWebSocketAllowedOrigins()).toEqual(["https://safe.example.com"]);
  });

  test("an all-wildcard list degrades to the localhost dev allowlist — never allow-all", () => {
    process.env.WS_ALLOWED_ORIGINS = " * ,*";
    resetEnvironmentCache();
    const origins = getWebSocketAllowedOrigins();
    expect(origins).toEqual(DEFAULT_ORIGINS);
    expect(origins.includes("*")).toBe(false);
  });

  test("no resolution shape ever yields a wildcard origin", () => {
    const shapes = [undefined, "*", "*,*", "https://ok.example.com,*"];
    for (const shape of shapes) {
      if (shape === undefined) {
        delete process.env.WS_ALLOWED_ORIGINS;
      } else {
        process.env.WS_ALLOWED_ORIGINS = shape;
      }
      resetEnvironmentCache();
      expect(getWebSocketAllowedOrigins().includes("*")).toBe(false);
    }
  });

  test("resolved origin allowlists are frozen — callers cannot poison the cached snapshot", () => {
    const origins = getWebSocketAllowedOrigins();
    expect(Object.isFrozen(origins)).toBe(true);
    // Mutation attempts on a frozen array are rejected (Reflect.set → false,
    // indexed writes throw in strict-mode ES modules).
    expect(Reflect.set(origins, 0, "https://evil.example.com")).toBe(false);
    expect(origins[0]).toBe("http://localhost:3000");
    expect(getWebSocketAllowedOrigins()).toEqual(DEFAULT_ORIGINS);
  });

  test("credential-bearing REDIS_URL never crosses the non-URL config disclosure surface", () => {
    process.env.REDIS_URL = "redis://:hunter2-do-not-leak@redis.internal.test:6379";
    resetEnvironmentCache();

    // The URL is available to the transport seam by design…
    expect(getRedisUrl()).toBe("redis://:hunter2-do-not-leak@redis.internal.test:6379");

    // …but the WS-config values a boot banner would surface carry no trace of it.
    const bootDisclosable = JSON.stringify({
      port: getWebSocketPort(),
      host: getWebSocketHost(),
      allowedOrigins: getWebSocketAllowedOrigins(),
      transport: getNotificationFanoutTransport(),
      maxConnections: getWebSocketMaxConnections(),
      maxConnectionsPerUser: getWebSocketMaxConnectionsPerUser(),
    });
    expect(bootDisclosable.includes("hunter2-do-not-leak")).toBe(false);
    expect(bootDisclosable.includes("redis.internal.test")).toBe(false);
  });

  test("the env module performs zero logging — connection strings stay off every sink", () => {
    // Structural pin: the module has no logging vocabulary at all, so no env
    // value (Redis URL included) can ever be written to a log from here.
    const source = readFileSync(join(process.cwd(), "backend", "lib", "env.ts"), "utf8");
    expect(source.includes("console.")).toBe(false);
    expect(source.includes("logDomainError")).toBe(false);
    expect(source.includes("@/backend/lib/logger")).toBe(false);
  });
});

// ─── Teacher inactivity fixture (restored after every case) ─────────────

/** The auto-offline sweep's inactivity-window key. */
const TEACHER_INACTIVITY_ENV_KEYS = ["TEACHER_INACTIVITY_TIMEOUT_MINUTES"] as const;

const originalTeacherInactivityEnv: Record<string, string | undefined> = {};
for (const key of TEACHER_INACTIVITY_ENV_KEYS) {
  originalTeacherInactivityEnv[key] = process.env[key];
}

/** Removes the inactivity key — the deterministic base for default probes. */
function clearTeacherInactivityEnv(): void {
  for (const key of TEACHER_INACTIVITY_ENV_KEYS) {
    delete process.env[key];
  }
}

function restoreTeacherInactivityEnv(): void {
  for (const key of TEACHER_INACTIVITY_ENV_KEYS) {
    const value = originalTeacherInactivityEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetEnvironmentCache();
}

// ─── Teacher inactivity registry inclusion + invalidation + defaults ────────

describe("teacher inactivity timeout — the auto-offline sweep knob resolves through the env seam", () => {
  beforeEach(() => {
    clearTeacherInactivityEnv();
    resetEnvironmentCache();
  });
  afterEach(restoreTeacherInactivityEnv);

  test("TEACHER_INACTIVITY_TIMEOUT_MINUTES is observable through getTeacherInactivityTimeoutMinutes()", () => {
    process.env.TEACHER_INACTIVITY_TIMEOUT_MINUTES = "20";
    resetEnvironmentCache();
    expect(getTeacherInactivityTimeoutMinutes()).toBe(20);
  });

  test("stale until reset, re-read after reset, default after removal", () => {
    expect(getTeacherInactivityTimeoutMinutes()).toBe(15); // builds the cache from cleared env
    process.env.TEACHER_INACTIVITY_TIMEOUT_MINUTES = "20";
    expect(getTeacherInactivityTimeoutMinutes()).toBe(15); // STALE — reads go through the cache
    resetEnvironmentCache();
    expect(getTeacherInactivityTimeoutMinutes()).toBe(20); // reset re-reads the key
    delete process.env.TEACHER_INACTIVITY_TIMEOUT_MINUTES;
    resetEnvironmentCache();
    expect(getTeacherInactivityTimeoutMinutes()).toBe(15); // removal + reset → default returns
  });

  test("unset defaults to 15 — the resolved inactivity-timeout decision (B.15)", () => {
    expect(getTeacherInactivityTimeoutMinutes()).toBe(15);
    expect(getEnvironmentConfig().teacherInactivityTimeoutMinutes).toBe(15);
  });

  test("accepts the 1 lower bound", () => {
    process.env.TEACHER_INACTIVITY_TIMEOUT_MINUTES = "1";
    resetEnvironmentCache();
    expect(getTeacherInactivityTimeoutMinutes()).toBe(1);
  });

  test("garbage/zero/negative values fall back to 15 — resolution never throws", () => {
    const invalidValues = ["0", "-3", "1.5", "abc", "", "   ", "15min", "0x10", "+5"];
    for (const invalid of invalidValues) {
      process.env.TEACHER_INACTIVITY_TIMEOUT_MINUTES = invalid;
      resetEnvironmentCache();
      expect(getTeacherInactivityTimeoutMinutes()).toBe(15);
    }
  });

  test("the cached snapshot carries the teacherInactivityTimeoutMinutes number member", () => {
    process.env.TEACHER_INACTIVITY_TIMEOUT_MINUTES = "20";
    resetEnvironmentCache();
    expect(typeof getEnvironmentConfig().teacherInactivityTimeoutMinutes).toBe("number");
    expect(getEnvironmentConfig().teacherInactivityTimeoutMinutes).toBe(20);
  });
});

// ─── Paymob + ngrok fixture (restored after every case) ─────────────────────

/** The dev-only tunnel keys — deliberately absent in test CI (see test-ci-env.ts). */
const NGROK_ENV_KEYS = ["NGROK_AUTHTOKEN", "NGROK_DOMAIN", "NGROK_PORT"] as const;

/** Every paymob/ngrok key the gateway seam registers. */
const GATEWAY_ENV_KEYS = [...TEST_CI_UNSET_PAYMOB_ENV_KEYS, ...NGROK_ENV_KEYS];

const originalGatewayEnv: Record<string, string | undefined> = {};
for (const key of GATEWAY_ENV_KEYS) {
  originalGatewayEnv[key] = process.env[key];
}

/** Removes every paymob/ngrok key — the deterministic base for default probes. */
function clearGatewayEnv(): void {
  for (const key of GATEWAY_ENV_KEYS) {
    delete process.env[key];
  }
}

function restoreGatewayEnv(): void {
  for (const key of GATEWAY_ENV_KEYS) {
    const value = originalGatewayEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetEnvironmentCache();
}

/** The inert (all-keys-absent) provider configuration the seam must resolve. */
const INERT_PAYMOB_CONFIG = {
  secretKey: null,
  publicKey: null,
  hmacSecret: null,
  apiKey: null,
  integrationIdCard: null,
  integrationIdWallet: null,
  apiBaseUrl: "https://accept.paymob.com",
  checkoutBaseUrl: "https://eg.checkout.paymob.com",
  httpTimeoutMs: 10000,
  reconcilePendingMinutes: 30,
};

/** One invalidation probe: a distinctive env value + how to observe it through the seam. */
type GatewayKeyProbe = {
  key: string;
  value: string;
  /** Value observed through the typed seam once `value` is set (differs from `value` for numeric members). */
  observed?: unknown;
  inert: unknown;
  observe: () => unknown;
};

const GATEWAY_KEY_PROBES: readonly GatewayKeyProbe[] = [
  { key: "PAYMOB_SECRET_KEY", value: "sk-probe-secret-1", inert: null, observe: () => getPaymobConfig().secretKey },
  { key: "PAYMOB_PUBLIC_KEY", value: "pk-probe-public-1", inert: null, observe: () => getPaymobConfig().publicKey },
  { key: "PAYMOB_HMAC_SECRET", value: "hmac-probe-secret-1", inert: null, observe: () => getPaymobConfig().hmacSecret },
  { key: "PAYMOB_API_KEY", value: "api-probe-key-1", inert: null, observe: () => getPaymobConfig().apiKey },
  {
    key: "PAYMOB_INTEGRATION_ID_CARD",
    value: "4567",
    observed: 4567,
    inert: null,
    observe: () => getPaymobConfig().integrationIdCard,
  },
  {
    key: "PAYMOB_INTEGRATION_ID_WALLET",
    value: "7890",
    observed: 7890,
    inert: null,
    observe: () => getPaymobConfig().integrationIdWallet,
  },
  {
    key: "PAYMOB_API_BASE_URL",
    value: "https://api.probe.example.test",
    inert: "https://accept.paymob.com",
    observe: () => getPaymobConfig().apiBaseUrl,
  },
  {
    key: "PAYMOB_CHECKOUT_BASE_URL",
    value: "https://checkout.probe.example.test/hosted/",
    inert: "https://eg.checkout.paymob.com",
    observe: () => getPaymobConfig().checkoutBaseUrl,
  },
  {
    key: "PAYMOB_HTTP_TIMEOUT_MS",
    value: "25000",
    observed: 25000,
    inert: 10000,
    observe: () => getPaymobConfig().httpTimeoutMs,
  },
  {
    key: "PAYMOB_RECONCILE_PENDING_MINUTES",
    value: "45",
    observed: 45,
    inert: 30,
    observe: () => getPaymobConfig().reconcilePendingMinutes,
  },
  {
    key: "NGROK_AUTHTOKEN",
    value: "ngrok-probe-token-1",
    inert: null,
    observe: () => getEnvironmentConfig().ngrok.authtoken,
  },
  {
    key: "NGROK_DOMAIN",
    value: "probe.ngrok.dev",
    inert: null,
    observe: () => getEnvironmentConfig().ngrok.domain,
  },
  {
    key: "NGROK_PORT",
    value: "4321",
    observed: 4321,
    inert: 3000,
    observe: () => getEnvironmentConfig().ngrok.port,
  },
];

// ─── Paymob + ngrok registry inclusion ──────────────────────────────────────

describe("paymob/ngrok registry inclusion — every gateway key resolves through the env seam", () => {
  beforeEach(() => {
    clearGatewayEnv();
    resetEnvironmentCache();
  });
  afterEach(restoreGatewayEnv);

  test("every PAYMOB_*/NGROK_* key is observable through its typed config member", () => {
    for (const probe of GATEWAY_KEY_PROBES) {
      process.env[probe.key] = probe.value;
      resetEnvironmentCache();
      expect(probe.observe()).toBe(probe.observed ?? probe.value);
    }
  });

  test("the cached snapshot carries the full paymob configuration object", () => {
    const paymob = getEnvironmentConfig().paymob;
    expect(Object.keys(paymob).toSorted((a, b) => a.localeCompare(b))).toEqual(
      Object.keys(INERT_PAYMOB_CONFIG).toSorted((a, b) => a.localeCompare(b))
    );
    expect(typeof paymob.apiBaseUrl).toBe("string");
    expect(typeof paymob.checkoutBaseUrl).toBe("string");
    expect(typeof paymob.httpTimeoutMs).toBe("number");
    expect(typeof paymob.reconcilePendingMinutes).toBe("number");
  });

  test("the cached snapshot carries the full ngrok configuration object", () => {
    const ngrok = getEnvironmentConfig().ngrok;
    expect(Object.keys(ngrok).toSorted((a, b) => a.localeCompare(b))).toEqual(["authtoken", "domain", "port"]);
    expect(typeof ngrok.port).toBe("number");
  });

  test("TEST_CI_UNSET_PAYMOB_ENV_KEYS stays pinned to exactly the ten PAYMOB_* keys", () => {
    const unsetKeys: string[] = [...TEST_CI_UNSET_PAYMOB_ENV_KEYS];
    const paymobProbeKeys = GATEWAY_KEY_PROBES.map(probe => probe.key).filter(key => key.startsWith("PAYMOB_"));
    expect(unsetKeys.toSorted((a, b) => a.localeCompare(b))).toEqual(
      paymobProbeKeys.toSorted((a, b) => a.localeCompare(b))
    );
    expect(TEST_CI_UNSET_PAYMOB_ENV_KEYS.some(key => key.startsWith("NGROK_"))).toBe(false);
  });
});

// ─── Paymob + ngrok invalidation coverage (resetEnvironmentCache) ────────────

describe("paymob/ngrok invalidation coverage — resetEnvironmentCache re-reads every gateway key", () => {
  beforeEach(() => {
    clearGatewayEnv();
    resetEnvironmentCache();
  });
  afterEach(restoreGatewayEnv);

  for (const probe of GATEWAY_KEY_PROBES) {
    test(`\`${probe.key}\` is stale until reset, re-read after reset, inert after removal`, () => {
      expect(probe.observe()).toBe(probe.inert); // builds the cache from cleared env
      process.env[probe.key] = probe.value;
      expect(probe.observe()).toBe(probe.inert); // STALE — reads go through the cache
      resetEnvironmentCache();
      expect(probe.observe()).toBe(probe.observed ?? probe.value); // reset re-reads the key
      delete process.env[probe.key];
      resetEnvironmentCache();
      expect(probe.observe()).toBe(probe.inert); // removal + reset → inert default returns
    });
  }
});

// ─── Paymob + ngrok typed dev/test defaults ─────────────────────────────────

describe("paymob/ngrok typed defaults — every gateway key absent", () => {
  beforeEach(() => {
    clearGatewayEnv();
    resetEnvironmentCache();
  });
  afterEach(restoreGatewayEnv);

  test("the paymob config resolves to the fully inert snapshot", () => {
    expect(getPaymobConfig()).toEqual(INERT_PAYMOB_CONFIG);
  });

  test("every nullable paymob member is null — never an empty string or a guessed number", () => {
    const paymob = getPaymobConfig();
    expect(paymob.secretKey).toBeNull();
    expect(paymob.publicKey).toBeNull();
    expect(paymob.hmacSecret).toBeNull();
    expect(paymob.apiKey).toBeNull();
    expect(paymob.integrationIdCard).toBeNull();
    expect(paymob.integrationIdWallet).toBeNull();
  });

  test("the ngrok config resolves to the unconfigured tunnel posture", () => {
    expect(getEnvironmentConfig().ngrok).toEqual({ authtoken: null, domain: null, port: 3000 });
  });

  test("the checkout base URL default is the current hosted-checkout host (full host prefix)", () => {
    const checkoutBaseUrl = getPaymobConfig().checkoutBaseUrl;
    expect(checkoutBaseUrl).toBe("https://eg.checkout.paymob.com");
    expect(checkoutBaseUrl.startsWith("https://")).toBe(true);
  });
});

// ─── Paymob + ngrok parsing boundaries ──────────────────────────────────────

describe("paymob/ngrok parsing boundaries", () => {
  beforeEach(() => {
    clearGatewayEnv();
    resetEnvironmentCache();
  });
  afterEach(restoreGatewayEnv);

  test("integration IDs coerce canonical integer strings and reject everything else → null", () => {
    process.env.PAYMOB_INTEGRATION_ID_CARD = "4567";
    process.env.PAYMOB_INTEGRATION_ID_WALLET = "007";
    resetEnvironmentCache();
    expect(getPaymobConfig().integrationIdCard).toBe(4567);
    expect(getPaymobConfig().integrationIdWallet).toBe(7);

    const invalidValues = ["3.5", "abc", "", "   ", "12abc", "-5", "+7", "0x10"];
    for (const invalid of invalidValues) {
      process.env.PAYMOB_INTEGRATION_ID_CARD = invalid;
      process.env.PAYMOB_INTEGRATION_ID_WALLET = invalid;
      resetEnvironmentCache();
      expect(getPaymobConfig().integrationIdCard).toBeNull();
      expect(getPaymobConfig().integrationIdWallet).toBeNull();
    }
  });

  test("empty-string credential values are rejected — secrets are never observable as empty strings", () => {
    const credentialProbes: ReadonlyArray<{ key: string; observe: () => unknown }> = [
      { key: "PAYMOB_SECRET_KEY", observe: () => getPaymobConfig().secretKey },
      { key: "PAYMOB_PUBLIC_KEY", observe: () => getPaymobConfig().publicKey },
      { key: "PAYMOB_HMAC_SECRET", observe: () => getPaymobConfig().hmacSecret },
      { key: "PAYMOB_API_KEY", observe: () => getPaymobConfig().apiKey },
    ];

    for (const probe of credentialProbes) {
      process.env[probe.key] = "";
      resetEnvironmentCache();
      expect(probe.observe()).toBeNull();
    }

    for (const probe of credentialProbes) {
      process.env[probe.key] = "   ";
      resetEnvironmentCache();
      expect(probe.observe()).toBeNull();
    }
  });

  test("credential values are returned trimmed", () => {
    process.env.PAYMOB_SECRET_KEY = "  sk-trimmed-probe  ";
    resetEnvironmentCache();
    expect(getPaymobConfig().secretKey).toBe("sk-trimmed-probe");
  });

  test("HTTP timeout accepts positive integers, falls back to 10000 otherwise", () => {
    process.env.PAYMOB_HTTP_TIMEOUT_MS = "1";
    resetEnvironmentCache();
    expect(getPaymobConfig().httpTimeoutMs).toBe(1);

    const invalidValues = ["0", "-1", "2.5", "abc", "", "   ", "10ms"];
    for (const invalid of invalidValues) {
      process.env.PAYMOB_HTTP_TIMEOUT_MS = invalid;
      resetEnvironmentCache();
      expect(getPaymobConfig().httpTimeoutMs).toBe(10000);
    }
  });

  test("reconcile window accepts positive integers, falls back to 30 otherwise", () => {
    process.env.PAYMOB_RECONCILE_PENDING_MINUTES = "1";
    resetEnvironmentCache();
    expect(getPaymobConfig().reconcilePendingMinutes).toBe(1);

    const invalidValues = ["0", "-2", "1.5", "abc", ""];
    for (const invalid of invalidValues) {
      process.env.PAYMOB_RECONCILE_PENDING_MINUTES = invalid;
      resetEnvironmentCache();
      expect(getPaymobConfig().reconcilePendingMinutes).toBe(30);
    }
  });

  test("checkout base URL accepts a custom prefix verbatim (incl. the legacy unifiedcheckout fallback)", () => {
    process.env.PAYMOB_CHECKOUT_BASE_URL = "https://accept.paymob.com/unifiedcheckout/";
    resetEnvironmentCache();
    expect(getPaymobConfig().checkoutBaseUrl).toBe("https://accept.paymob.com/unifiedcheckout/");

    process.env.PAYMOB_CHECKOUT_BASE_URL = "  https://checkout.custom.example.test/hosted/  ";
    resetEnvironmentCache();
    expect(getPaymobConfig().checkoutBaseUrl).toBe("https://checkout.custom.example.test/hosted/");
  });

  test("checkout base URL whitespace-only counts as unset → default", () => {
    process.env.PAYMOB_CHECKOUT_BASE_URL = "   ";
    resetEnvironmentCache();
    expect(getPaymobConfig().checkoutBaseUrl).toBe("https://eg.checkout.paymob.com");
  });

  test("API base URL accepts a custom host verbatim; whitespace-only falls back to the default", () => {
    process.env.PAYMOB_API_BASE_URL = "  https://api.custom.example.test  ";
    resetEnvironmentCache();
    expect(getPaymobConfig().apiBaseUrl).toBe("https://api.custom.example.test");

    process.env.PAYMOB_API_BASE_URL = "   ";
    resetEnvironmentCache();
    expect(getPaymobConfig().apiBaseUrl).toBe("https://accept.paymob.com");
  });

  test("ngrok port accepts 0 (probe-style) and the 65535 upper bound", () => {
    process.env.NGROK_PORT = "0";
    resetEnvironmentCache();
    expect(getEnvironmentConfig().ngrok.port).toBe(0);

    process.env.NGROK_PORT = "65535";
    resetEnvironmentCache();
    expect(getEnvironmentConfig().ngrok.port).toBe(65535);
  });

  test("ngrok port rejects malformed/out-of-range values → default 3000", () => {
    const invalidValues = ["-1", "65536", "abc", "3.5", "", "   ", "3001abc", "0x10"];
    for (const invalid of invalidValues) {
      process.env.NGROK_PORT = invalid;
      resetEnvironmentCache();
      expect(getEnvironmentConfig().ngrok.port).toBe(3000);
    }
  });

  test("tunnel eligibility needs BOTH members — a domain without an authtoken stays ineligible", () => {
    process.env.NGROK_DOMAIN = "only-domain.ngrok.dev";
    resetEnvironmentCache();
    expect(getEnvironmentConfig().ngrok.domain).toBe("only-domain.ngrok.dev");
    expect(getEnvironmentConfig().ngrok.authtoken).toBeNull();
  });
});

// ─── Paymob + ngrok security posture ────────────────────────────────────────

describe("paymob/ngrok security posture", () => {
  beforeEach(() => {
    clearGatewayEnv();
    resetEnvironmentCache();
  });
  afterEach(restoreGatewayEnv);

  test("secret material is exposed ONLY through the paymob members — never the sibling surfaces", () => {
    const marker = "sk-do-not-leak-marker";
    process.env.PAYMOB_SECRET_KEY = marker;
    resetEnvironmentCache();

    // The provider seam carries it by design…
    expect(getPaymobConfig().secretKey).toBe(marker);

    // …but the realtime and tunnel surfaces carry no trace of it.
    const siblingSurface = JSON.stringify({
      port: getWebSocketPort(),
      host: getWebSocketHost(),
      allowedOrigins: getWebSocketAllowedOrigins(),
      transport: getNotificationFanoutTransport(),
      maxConnections: getWebSocketMaxConnections(),
      maxConnectionsPerUser: getWebSocketMaxConnectionsPerUser(),
      redisUrl: getRedisUrl(),
      ngrok: getEnvironmentConfig().ngrok,
    });
    expect(siblingSurface.includes(marker)).toBe(false);
  });

  test("the test-CI unset-key list is frozen — callers cannot add tunnel keys to it", () => {
    expect(Object.isFrozen(TEST_CI_UNSET_PAYMOB_ENV_KEYS)).toBe(true);
    expect(Reflect.set(TEST_CI_UNSET_PAYMOB_ENV_KEYS, TEST_CI_UNSET_PAYMOB_ENV_KEYS.length, "NGROK_AUTHTOKEN")).toBe(
      false
    );
    const outsider: string = "NGROK_AUTHTOKEN";
    expect(TEST_CI_UNSET_PAYMOB_ENV_KEYS.some(key => key === outsider)).toBe(false);
  });
});
