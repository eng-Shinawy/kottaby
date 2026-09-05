/**
 * `backend/lib/env.ts` — realtime-notification config registration suite
 * (WebSocket sidecar + fan-out transport keys).
 *
 * Coverage map (the three mandated tiers + the guard/security tiers of the
 * repo's env-manipulating suites):
 *  - Registry inclusion: every registered key is wired through the env-config
 *    seam — a distinctive explicit value is observable through its typed
 *    getter, and the cached snapshot carries all seven new fields.
 *  - Invalidation coverage: every key is resolved from the CACHED snapshot
 *    (stale-env proof), is re-read after `resetEnvironmentCache()` (set
 *    value → reset → custom value), and falls back to its default once the
 *    env value is removed and the cache is reset again (remove → reset →
 *    default returns).
 *  - Typed defaults: with every realtime key absent, the getters return the
 *    documented dev/test defaults (port / host / origins / transport / caps),
 *    and the transport default flips to "redis" ONLY when a Redis URL is
 *    explicitly present.
 *  - Parsing boundaries: port bounds (0 = ephemeral … 65535), positive-int
 *    caps, host emptiness semantics, origin-list splitting/trimming/case
 *    normalization, transport vocabulary (case-insensitive).
 *  - Security: a wildcard origin is unreachable in ANY resolution shape
 *    (default, explicit mixed, all-wildcard); credential-bearing Redis URLs
 *    never cross the non-URL config disclosure surface; the module performs
 *    zero logging (source-pinned) — connection strings stay off every log.
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
  getRedisUrl,
  getWebSocketAllowedOrigins,
  getWebSocketHost,
  getWebSocketMaxConnections,
  getWebSocketMaxConnectionsPerUser,
  getWebSocketPort,
  resetEnvironmentCache,
} from "@/backend/lib/env";

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
