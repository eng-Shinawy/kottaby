/**
 * Callback channel factory resolution contract.
 *
 * Unit tier (no network, no database): env stubbing goes through
 * `process.env` + `resetCallbackChannel()` — the factory reads the typed env
 * snapshot, and the reset drops the resolved channel together with the
 * snapshot, exactly like the payment gateway factory's reset. The suite pins
 * the resolution matrix:
 *
 *  - `real` for a production runtime AND for any deployment whose active
 *    provider is not paymob (fail-closed test delivery, null public base);
 *  - `ngrok` in development with paymob active when BOTH tunnel keys are
 *    set AND the channel's readiness sequence succeeds (spawn stand-in +
 *    a passing public probe), with the ngrok channel's public base and the
 *    dev-port spawn command;
 *  - `simulation` for every other development case — tunnel keys absent
 *    (wholly or partially) or the tunnel's readiness sequence failing —
 *    with exactly ONE structured info log naming the fallback reason (and
 *    the probe detail on a failed readiness sequence);
 *  - the lazy singleton (same instance until reset; env changes observed
 *    after reset), the simulation config wiring (dev-server port from
 *    configuration), and the fail-closed production guard on test-delivery
 *    configuration;
 *  - a static source pin: NO production source outside the typed env module
 *    reads `process.env.NGROK_*` — the factory is the only consumer of the
 *    tunnel configuration, so per-file tunnel heuristics cannot appear.
 *
 * Runs via `bun run test/scripts/run-test.ts
 * backend/services/billing/payment-gateway/callback-channel/__tests__/
 * callback-channel.factory.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { DomainError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import {
  configureCallbackChannelTestDelivery,
  getCallbackChannel,
  resetCallbackChannel,
} from "@/backend/services/billing/payment-gateway/callback-channel/callback-channel.factory";
import type { SimulatedCallbackDelivery } from "@/backend/types";

const ENV_KEYS = [
  "NODE_ENV",
  "PAYMENT_GATEWAY_PROVIDER",
  "NGROK_AUTHTOKEN",
  "NGROK_DOMAIN",
  "NGROK_PORT",
  "PAYMOB_HMAC_SECRET",
] as const;

const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
}

const TEST_DELIVERY: SimulatedCallbackDelivery = {
  reference: "claim_factory_probe",
  outcome: "confirmed",
  amount: "1.00",
  currency: "EGP",
};

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function memberString(parent: Record<string, unknown>, key: string): string {
  const candidate: unknown = parent[key];
  if (typeof candidate !== "string") {
    throw new Error(`log bag member "${key}" was not a string`);
  }
  return candidate;
}

/** Drops the resolved channel AND the env snapshot it was resolved from. */
function resetFactory(): void {
  resetCallbackChannel();
}

/** The agent command the tunnel channel's spawn seam last captured. */
let capturedSpawnCommand: string[] = [];

// Index-signature alias sidesteps Next.js' read-only NODE_ENV augmentation
// while still mutating the SAME live env object the runtime reads.
const envBag: Record<string, string | undefined> = process.env;

/** Clears every key the matrix varies, so each test starts from a blank dev slate. */
function clearConfiguredEnv(): void {
  for (const key of ENV_KEYS) {
    delete envBag[key];
  }
}

/** Development runtime with the paymob provider active and no tunnel configured. */
function enableDevPaymob(): void {
  clearConfiguredEnv();
  process.env.PAYMENT_GATEWAY_PROVIDER = PaymentGateway.Paymob;
}

/** Development runtime with the mock provider active (default resolution). */
function enableDevMock(): void {
  clearConfiguredEnv();
  process.env.PAYMENT_GATEWAY_PROVIDER = PaymentGateway.Mock;
}

/** Development + paymob with both tunnel keys configured. */
function enableDevPaymobWithTunnelEnv(): void {
  enableDevPaymob();
  process.env.NGROK_AUTHTOKEN = "factory-test-tunnel-token";
  process.env.NGROK_DOMAIN = "factory-test-domain.ngrok.app";
}

/** Runs `body` with `NODE_ENV` forced, restoring the prior value afterwards. */
async function withNodeEnv(mode: string, body: () => Promise<unknown>): Promise<void> {
  const previous = process.env.NODE_ENV;
  const hadPrevious = typeof previous === "string";
  envBag.NODE_ENV = mode;
  try {
    await body();
  } finally {
    if (hadPrevious) {
      envBag.NODE_ENV = previous;
    } else {
      delete envBag.NODE_ENV;
    }
  }
}

/**
 * Reads the fallback reason out of the ONE structured info log a simulation
 * resolution must emit — assertion-free payload narrowing on the spy's
 * captured calls, same discipline as the webhook route suite.
 */
function readFallbackReason(): string {
  expect(infoSpy).toHaveBeenCalledTimes(1);
  const firstCall: unknown = infoSpy.mock.calls[0];
  if (!Array.isArray(firstCall)) {
    throw new Error("logger.info call was not captured");
  }
  expect(String(firstCall[0])).toContain("simulation");
  const logBag: unknown = firstCall[1];
  if (!isPlainJsonObject(logBag)) {
    throw new Error("logger.info context bag was not a JSON object");
  }
  return memberString(logBag, "reason");
}

let infoSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  clearConfiguredEnv();
  resetFactory();
  capturedSpawnCommand = [];
  infoSpy = spyOn(logger, "info");
});

afterEach(() => {
  infoSpy.mockRestore();
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete envBag[key];
    } else {
      envBag[key] = value;
    }
  }
  resetFactory();
});

// ─── Resolution matrix ─────────────────────────────────────────────────────

describe("getCallbackChannel resolution", () => {
  test("resolves the real channel in a production runtime", async () => {
    process.env.PAYMENT_GATEWAY_PROVIDER = PaymentGateway.Paymob;
    await withNodeEnv("production", async () => {
      const channel = await getCallbackChannel();
      expect(channel.kind).toBe("real");
      expect(channel.publicBaseUrl).toBeNull();
      await channel.ensureReady();
    });
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test("resolves the real channel when the active provider is not paymob", async () => {
    enableDevMock();
    const channel = await getCallbackChannel();
    expect(channel.kind).toBe("real");
    expect(channel.publicBaseUrl).toBeNull();
    await channel.ensureReady();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test("fails closed on test delivery through the real channel", async () => {
    enableDevMock();
    const channel = await getCallbackChannel();

    expect(typeof channel.deliverTestCallback).toBe("function");
    let caught: unknown = null;
    try {
      await channel.deliverTestCallback?.(TEST_DELIVERY);
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeNull();
    expect(caught).toBeInstanceOf(DomainError);
    if (caught instanceof DomainError) {
      expect(caught.code).toBe("PAYMENT_CALLBACK_TEST_DELIVERY_UNSUPPORTED");
    }
  });

  test("resolves simulation in development with the paymob provider", async () => {
    enableDevPaymob();
    const channel = await getCallbackChannel();
    expect(channel.kind).toBe("simulation");
    expect(channel.publicBaseUrl).toBe("http://localhost:3000");
    expect(typeof channel.deliverTestCallback).toBe("function");
  });

  test("logs exactly one fallback naming the reason when the tunnel is not configured", async () => {
    enableDevPaymob();
    await getCallbackChannel();
    expect(readFallbackReason()).toBe("ngrok-not-configured");
  });

  test("falls back to simulation when only one tunnel key is configured", async () => {
    enableDevPaymob();
    process.env.NGROK_AUTHTOKEN = "factory-test-tunnel-token";
    const channel = await getCallbackChannel();
    expect(channel.kind).toBe("simulation");
    expect(readFallbackReason()).toBe("ngrok-not-configured");
  });

  test("resolves the ngrok channel when the tunnel is configured and its probe passes", async () => {
    enableDevPaymobWithTunnelEnv();
    process.env.NGROK_PORT = "4100";
    const probedUrls: string[] = [];
    configureCallbackChannelTestDelivery({
      spawnAgent: ({ command }) => {
        capturedSpawnCommand = [...command];
        return { kill: () => {} };
      },
      fetch: async url => {
        probedUrls.push(url);
        return new Response(null, { status: 200 });
      },
    });

    const channel = await getCallbackChannel();

    expect(channel.kind).toBe("ngrok");
    expect(channel.publicBaseUrl).toBe("https://factory-test-domain.ngrok.app");
    expect(typeof channel.deliverTestCallback).toBe("function");
    expect(capturedSpawnCommand).toEqual([]);
    expect(probedUrls).toEqual(["https://factory-test-domain.ngrok.app/api/health"]);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test("composes the dev-port spawn command when the first probe misses", async () => {
    enableDevPaymobWithTunnelEnv();
    process.env.NGROK_PORT = "4100";
    configureCallbackChannelTestDelivery({
      spawnAgent: ({ command }) => {
        capturedSpawnCommand = [...command];
        return { kill: () => {} };
      },
      fetch: async () => new Response(null, { status: 503 }),
    });

    await getCallbackChannel();

    expect(readFallbackReason()).toBe("ngrok-unreachable");
    expect(capturedSpawnCommand).toEqual(["ngrok", "http", "--url=https://factory-test-domain.ngrok.app", "4100"]);
  });

  test("falls back to simulation with a named reason when the tunnel probe never answers", async () => {
    enableDevPaymobWithTunnelEnv();
    configureCallbackChannelTestDelivery({
      spawnAgent: () => ({ kill: () => {} }),
      fetch: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });

    const channel = await getCallbackChannel();

    expect(channel.kind).toBe("simulation");
    expect(channel.publicBaseUrl).toBe("http://localhost:3000");
    expect(readFallbackReason()).toBe("ngrok-unreachable");
    const firstCall: unknown = infoSpy.mock.calls[0];
    if (!Array.isArray(firstCall)) {
      throw new Error("logger.info call was not captured");
    }
    const logBag: unknown = firstCall[1];
    if (!isPlainJsonObject(logBag)) {
      throw new Error("logger.info context bag was not a JSON object");
    }
    expect(memberString(logBag, "detail")).toContain("readiness budget");
  });

  test("the fallback log carries no tunnel secret material on a failed probe", async () => {
    enableDevPaymobWithTunnelEnv();
    configureCallbackChannelTestDelivery({
      spawnAgent: () => ({ kill: () => {} }),
      fetch: async () => new Response(null, { status: 503 }),
    });

    await getCallbackChannel();

    const firstCall: unknown = infoSpy.mock.calls[0];
    if (!Array.isArray(firstCall)) {
      throw new Error("logger.info call was not captured");
    }
    expect(String(firstCall[0])).not.toContain("factory-test-tunnel-token");
    const logBag: unknown = firstCall[1];
    if (!isPlainJsonObject(logBag)) {
      throw new Error("logger.info context bag was not a JSON object");
    }
    expect(JSON.stringify(logBag)).not.toContain("factory-test-tunnel-token");
  });

  test("resolves simulation even when the HMAC secret is unconfigured (resolution never throws)", async () => {
    enableDevPaymob();
    const channel = await getCallbackChannel();
    expect(channel.kind).toBe("simulation");
  });

  test("rejects test-delivery configuration in a production runtime", async () => {
    process.env.PAYMENT_GATEWAY_PROVIDER = PaymentGateway.Paymob;
    await withNodeEnv("production", async () => {
      let caught: unknown = null;
      try {
        configureCallbackChannelTestDelivery({ fetch: async () => new Response(null, { status: 200 }) });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(DomainError);
      if (caught instanceof DomainError) {
        expect(caught.code).toBe("PAYMENT_CALLBACK_TEST_DELIVERY_UNSUPPORTED");
      }
    });
  });

  test("the ngrok channel's readiness is idempotent — one spawn, no re-probe after success", async () => {
    enableDevPaymobWithTunnelEnv();
    let spawnCount = 0;
    let probeCount = 0;
    configureCallbackChannelTestDelivery({
      spawnAgent: () => {
        spawnCount += 1;
        return { kill: () => {} };
      },
      fetch: async () => {
        probeCount += 1;
        return new Response(null, { status: probeCount === 1 ? 503 : 200 });
      },
    });

    const channel = await getCallbackChannel();
    await channel.ensureReady();
    await channel.ensureReady();

    expect(spawnCount).toBe(1);
    expect(probeCount).toBe(2);
  });

  test("adopts an already-running tunnel — the first passing probe spawns no agent", async () => {
    enableDevPaymobWithTunnelEnv();
    let spawnCount = 0;
    const probedUrls: string[] = [];
    configureCallbackChannelTestDelivery({
      spawnAgent: () => {
        spawnCount += 1;
        return { kill: () => {} };
      },
      fetch: async url => {
        probedUrls.push(url);
        return new Response(null, { status: 200 });
      },
    });

    const channel = await getCallbackChannel();
    await channel.ensureReady();

    expect(channel.kind).toBe("ngrok");
    expect(channel.publicBaseUrl).toBe("https://factory-test-domain.ngrok.app");
    expect(spawnCount).toBe(0);
    expect(probedUrls).toEqual(["https://factory-test-domain.ngrok.app/api/health"]);
  });

  test("spawns the agent only after the first probe misses", async () => {
    enableDevPaymobWithTunnelEnv();
    let spawnCount = 0;
    let probeCount = 0;
    configureCallbackChannelTestDelivery({
      spawnAgent: () => {
        spawnCount += 1;
        return { kill: () => {} };
      },
      fetch: async () => {
        probeCount += 1;
        return new Response(null, { status: probeCount === 1 ? 503 : 200 });
      },
    });

    const channel = await getCallbackChannel();
    await channel.ensureReady();

    expect(channel.kind).toBe("ngrok");
    expect(probeCount).toBe(2);
    expect(spawnCount).toBe(1);
  });

  test("strips a trailing slash from the configured domain before composing the spawn command", async () => {
    enableDevPaymobWithTunnelEnv();
    process.env.NGROK_DOMAIN = "factory-test-domain.ngrok.app/";
    const probedUrls: string[] = [];
    configureCallbackChannelTestDelivery({
      spawnAgent: ({ command }) => {
        capturedSpawnCommand = [...command];
        return { kill: () => {} };
      },
      fetch: async url => {
        probedUrls.push(url);
        // First probe misses (drives the spawn), second answers.
        return new Response(null, { status: probedUrls.length === 1 ? 503 : 200 });
      },
    });

    const channel = await getCallbackChannel();
    await channel.ensureReady();

    expect(channel.kind).toBe("ngrok");
    expect(channel.publicBaseUrl).toBe("https://factory-test-domain.ngrok.app");
    expect(capturedSpawnCommand).toEqual(["ngrok", "http", "--url=https://factory-test-domain.ngrok.app", "3000"]);
    expect(probedUrls[0]).toBe("https://factory-test-domain.ngrok.app/api/health");
  });

  test("falls back with ngrok-not-configured for a domain carrying a scheme prefix", async () => {
    enableDevPaymobWithTunnelEnv();
    process.env.NGROK_DOMAIN = "https://factory-test-domain.ngrok.app";
    let spawnCount = 0;
    configureCallbackChannelTestDelivery({
      spawnAgent: () => {
        spawnCount += 1;
        return { kill: () => {} };
      },
      fetch: async () => new Response(null, { status: 200 }),
    });

    const channel = await getCallbackChannel();

    expect(channel.kind).toBe("simulation");
    expect(readFallbackReason()).toBe("ngrok-not-configured");
    expect(spawnCount).toBe(0);
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  test("falls back with ngrok-not-configured for a domain that is only a slash", async () => {
    enableDevPaymobWithTunnelEnv();
    process.env.NGROK_DOMAIN = "/";
    let spawnCount = 0;
    configureCallbackChannelTestDelivery({
      spawnAgent: () => {
        spawnCount += 1;
        return { kill: () => {} };
      },
      fetch: async () => new Response(null, { status: 200 }),
    });

    const channel = await getCallbackChannel();

    expect(channel.kind).toBe("simulation");
    expect(readFallbackReason()).toBe("ngrok-not-configured");
    expect(spawnCount).toBe(0);
  });

  test("disposes the spawned agent when the tunnel probe fails", async () => {
    enableDevPaymobWithTunnelEnv();
    let killCount = 0;
    configureCallbackChannelTestDelivery({
      spawnAgent: () => ({
        kill: () => {
          killCount += 1;
        },
      }),
      fetch: async () => new Response(null, { status: 503 }),
    });

    const channel = await getCallbackChannel();

    expect(channel.kind).toBe("simulation");
    expect(readFallbackReason()).toBe("ngrok-unreachable");
    expect(killCount).toBe(1);
  });

  test("concurrent first callers share one resolution — one spawn, one fallback log", async () => {
    enableDevPaymobWithTunnelEnv();
    // Short readiness budget so the failing probe falls back quickly.
    process.env.PAYMOB_HTTP_TIMEOUT_MS = "600";
    let spawnCount = 0;
    configureCallbackChannelTestDelivery({
      spawnAgent: () => {
        spawnCount += 1;
        return { kill: () => {} };
      },
      fetch: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });

    const [first, second, third] = await Promise.all([
      getCallbackChannel(),
      getCallbackChannel(),
      getCallbackChannel(),
    ]);

    delete envBag.PAYMOB_HTTP_TIMEOUT_MS;

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(first.kind).toBe("simulation");
    expect(readFallbackReason()).toBe("ngrok-unreachable");
    expect(spawnCount).toBe(1);
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  test("honors the configured dev-server port as the simulation public base", async () => {
    enableDevPaymob();
    process.env.NGROK_PORT = "4123";
    const channel = await getCallbackChannel();
    expect(channel.publicBaseUrl).toBe("http://localhost:4123");
  });

  test("reuses the resolved instance until reset", async () => {
    enableDevPaymob();
    const first = await getCallbackChannel();
    const second = await getCallbackChannel();
    expect(second).toBe(first);

    resetFactory();
    enableDevMock();
    const third = await getCallbackChannel();
    expect(third).not.toBe(first);
    expect(third.kind).toBe("real");
  });
});

// ─── Static source pin: the factory is the only tunnel-config consumer ─────

describe("tunnel configuration exclusivity", () => {
  /** Generated/data directories never hold tunable production sources. */
  const SKIPPED_DIRECTORIES = new Set(["drizzle", "pglite", "node_modules", ".next", "generated"]);

  /** Adds one directory's production `.ts` sources, recursing into subdirectories. */
  function collectDirectorySources(directory: string, files: string[]): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          collectDirectorySources(entryPath, files);
        }
      } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        files.push(entryPath);
      }
    }
  }

  /** Collects every production `.ts` file under the given roots. */
  function collectSourceFiles(roots: readonly string[]): string[] {
    const files: string[] = [];
    for (const root of roots) {
      collectDirectorySources(root, files);
    }
    return files;
  }

  test("no production source outside the typed env module reads NGROK_* keys", () => {
    const repoRoot = join(import.meta.dir, "..", "..", "..", "..", "..", "..");
    const scanned = collectSourceFiles([join(repoRoot, "backend"), join(repoRoot, "app")]);
    expect(scanned.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const file of scanned) {
      const relative = file.slice(repoRoot.length + 1);
      if (relative === "backend/lib/env.ts") {
        continue;
      }
      if (readFileSync(file, "utf8").includes("process.env.NGROK")) {
        offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);
  });
});
