/**
 * Application version resolver library tests.
 *
 * Resolution chain contract (`resolveAppVersion`):
 *  1. `process.env.APP_VERSION` (explicit platform deployment override)
 *  2. `process.env.npm_package_version` (Bun/npm runner injection)
 *  3. `"dev"` (terminal machine fallback)
 *
 * Coverage:
 *  - Tier 1: Resolution hierarchy (APP_VERSION > npm_package_version > "dev").
 *  - Tier 2 (boundary): Nullish coalescing behavior with empty string ("") vs undefined;
 *    environment snapshot isolation.
 *  - Tier 3 (chaos): Re-evaluates dynamically on each call (uncached purity);
 *    repeated-call determinism.
 *  - Tier 4 (security/invariants): Fallback contract guarantees string return type,
 *    never returning undefined or mutating process.env.
 *
 * Pure unit tier — NO server boot. Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/lib/gateway/version.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveAppVersion } from "@/backend/lib/gateway";

describe("resolveAppVersion — resolution chain hierarchy", () => {
  let originalAppVersion: string | undefined;
  let originalNpmPackageVersion: string | undefined;

  beforeEach(() => {
    originalAppVersion = process.env.APP_VERSION;
    originalNpmPackageVersion = process.env.npm_package_version;
  });

  afterEach(() => {
    if (originalAppVersion !== undefined) {
      process.env.APP_VERSION = originalAppVersion;
    } else {
      delete process.env.APP_VERSION;
    }

    if (originalNpmPackageVersion !== undefined) {
      process.env.npm_package_version = originalNpmPackageVersion;
    } else {
      delete process.env.npm_package_version;
    }
  });

  // ─── Tier 1: Resolution chain ──────────────────────────────────────────────

  test("Tier 1: returns process.env.APP_VERSION when explicitly set", () => {
    process.env.APP_VERSION = "1.2.3-production";
    delete process.env.npm_package_version;

    expect(resolveAppVersion()).toBe("1.2.3-production");
  });

  test("Tier 1: APP_VERSION takes precedence over npm_package_version", () => {
    process.env.APP_VERSION = "2.0.0-override";
    process.env.npm_package_version = "1.0.0";

    expect(resolveAppVersion()).toBe("2.0.0-override");
  });

  test("Tier 1: returns npm_package_version when APP_VERSION is undefined", () => {
    delete process.env.APP_VERSION;
    process.env.npm_package_version = "0.9.5-beta";

    expect(resolveAppVersion()).toBe("0.9.5-beta");
  });

  test("Tier 1: returns terminal fallback 'dev' when both env variables are undefined", () => {
    delete process.env.APP_VERSION;
    delete process.env.npm_package_version;

    expect(resolveAppVersion()).toBe("dev");
  });

  // ─── Tier 2: Boundaries & nullish coalescing semantics ─────────────────────

  test("Tier 2: empty string APP_VERSION is defined, so ?? returns empty string", () => {
    process.env.APP_VERSION = "";
    process.env.npm_package_version = "1.0.0";

    expect(resolveAppVersion()).toBe("");
  });

  test("Tier 2: empty string npm_package_version returns empty string when APP_VERSION is undefined", () => {
    delete process.env.APP_VERSION;
    process.env.npm_package_version = "";

    expect(resolveAppVersion()).toBe("");
  });

  // ─── Tier 3: Uncached purity & dynamic environment re-evaluation ──────────

  test("Tier 3: re-evaluates environment dynamically across calls (not cached in module state)", () => {
    delete process.env.APP_VERSION;
    delete process.env.npm_package_version;
    expect(resolveAppVersion()).toBe("dev");

    process.env.npm_package_version = "1.0.1";
    expect(resolveAppVersion()).toBe("1.0.1");

    process.env.APP_VERSION = "2.0.0";
    expect(resolveAppVersion()).toBe("2.0.0");

    delete process.env.APP_VERSION;
    expect(resolveAppVersion()).toBe("1.0.1");
  });

  test("Tier 3: 100 repeated calls are deterministic and non-mutating to process.env", () => {
    process.env.APP_VERSION = "3.1.4";
    delete process.env.npm_package_version;

    for (let i = 0; i < 100; i++) {
      expect(resolveAppVersion()).toBe("3.1.4");
    }

    expect(process.env.APP_VERSION).toBe("3.1.4");
  });

  // ─── Tier 4: Output type safety & invariant guarantee ──────────────────────

  test("Tier 4: always returns a non-null string invariant", () => {
    const environments = [
      { APP_VERSION: "v1.0.0", npm_package_version: "v0.1.0" },
      { APP_VERSION: undefined, npm_package_version: "v0.1.0" },
      { APP_VERSION: undefined, npm_package_version: undefined },
    ];

    for (const env of environments) {
      if (env.APP_VERSION !== undefined) {
        process.env.APP_VERSION = env.APP_VERSION;
      } else {
        delete process.env.APP_VERSION;
      }

      if (env.npm_package_version !== undefined) {
        process.env.npm_package_version = env.npm_package_version;
      } else {
        delete process.env.npm_package_version;
      }

      const version = resolveAppVersion();
      expect(typeof version).toBe("string");
      expect(version).not.toBeUndefined();
    }
  });
});
