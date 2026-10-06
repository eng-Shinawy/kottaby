/**
 * Route-inventory registry tests.
 *
 * Coverage:
 *  - Tier 1: registry shape (exact entry keys, closed classification set).
 *  - Tier 2: ground-truth rows present (`/api/graphql` gateway,
 *    `/api/set-locale` envelope, `/api/health` envelope from its first commit,
 *    `/api/cron/sweep-sessions` envelope, `/api/cron/reconcile-paymob-payments`
 *    envelope, `/api/cron/expire-subscriptions`
 *    envelope, `/api/cron/sweep-inactive-teachers`
 *    envelope, `/api/payments/webhook` provider-ack-exempt) and frozen
 *    ordering.
 *  - Tier 3: LIVE-TREE completeness — every physical route file under
 *    `app/api/` on disk maps to a registry path and vice-versa, both sides
 *    sorted for CI/local determinism. This independently re-implements the
 *    same guarantee the static-assertion suite enforces.
 *  - Tier 4: no unclassified/deferred drift — phantom pre-seed routes
 *    (webhooks/logs/cron) MUST NOT be registered while absent from disk.
 *
 * Pure unit tier — read-only fs traversal, NO server boot. Mandated runner.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROUTE_INVENTORY, type RouteClassification } from "@/backend/lib/gateway";

/** Walks `app/api/` collecting URL-style paths of every physical route file (depth-unbounded, deterministic sort at read time). */
function discoverApiRoutePaths(rootDir: string): string[] {
  if (!existsSync(rootDir)) {
    return [];
  }
  const discovered: string[] = [];

  const walk = (absoluteDir: string, relativeSegments: string[]): void => {
    const entries = readdirSync(absoluteDir, { withFileTypes: true }).toSorted((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const childAbsolute = join(absoluteDir, entry.name);
      const childSegments = [...relativeSegments, entry.name];

      if (existsSync(join(childAbsolute, "route.ts"))) {
        // Route segment directories are leaves — never recursed into.
        discovered.push(`/api/${childSegments.join("/")}`);
        continue;
      }
      walk(childAbsolute, childSegments);
    }
  };

  walk(rootDir, []);
  return discovered;
}

describe("ROUTE_INVENTORY — registry shape (Tier 1)", () => {
  test("every entry carries EXACTLY the two sanctioned keys", () => {
    for (const entry of ROUTE_INVENTORY) {
      expect(Object.keys(entry).toSorted((a, b) => a.localeCompare(b))).toEqual(["classification", "path"]);
    }
  });

  test("classifications stay inside the closed four-value vocabulary", () => {
    const allowedClasses: ReadonlySet<RouteClassification> = new Set<RouteClassification>([
      "gateway",
      "envelope",
      "provider-ack-exempt",
      "deferred",
    ]);
    for (const entry of ROUTE_INVENTORY) {
      expect(allowedClasses.has(entry.classification)).toBe(true);
    }
  });

  test("paths are unique, absolute-style `/api/…`, with no trailing slashes", () => {
    const paths = ROUTE_INVENTORY.map(entry => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      expect(path.startsWith("/api/")).toBe(true);
      expect(path.endsWith("/")).toBe(false);
    }
  });
});

describe("ROUTE_INVENTORY — ground-truth rows (Tier 2)", () => {
  test("/api/graphql classified as gateway", () => {
    const graphqlEntry = ROUTE_INVENTORY.find(entry => entry.path === "/api/graphql");
    expect(graphqlEntry?.classification).toBe("gateway");
  });

  test("/api/set-locale classified as envelope (adopted after its initial debut)", () => {
    const localeEntry = ROUTE_INVENTORY.find(entry => entry.path === "/api/set-locale");
    expect(localeEntry?.classification).toBe("envelope");
  });

  test("/api/health classified as envelope (created enveloped from its first commit)", () => {
    const healthEntry = ROUTE_INVENTORY.find(entry => entry.path === "/api/health");
    expect(healthEntry?.classification).toBe("envelope");
  });

  test("/api/cron/sweep-sessions classified as envelope (bearer-gated REST envelope contract)", () => {
    const cronEntry = ROUTE_INVENTORY.find(entry => entry.path === "/api/cron/sweep-sessions");
    expect(cronEntry?.classification).toBe("envelope");
  });

  test("/api/cron/reconcile-paymob-payments classified as envelope (bearer-gated REST envelope contract)", () => {
    const reconcileEntry = ROUTE_INVENTORY.find(entry => entry.path === "/api/cron/reconcile-paymob-payments");
    expect(reconcileEntry?.classification).toBe("envelope");
  });

  test("/api/cron/expire-subscriptions classified as envelope (bearer-gated REST envelope contract)", () => {
    const expiryEntry = ROUTE_INVENTORY.find(entry => entry.path === "/api/cron/expire-subscriptions");
    expect(expiryEntry?.classification).toBe("envelope");
  });

  test("/api/cron/sweep-inactive-teachers classified as envelope (bearer-gated REST envelope contract)", () => {
    const inactivityEntry = ROUTE_INVENTORY.find(entry => entry.path === "/api/cron/sweep-inactive-teachers");
    expect(inactivityEntry?.classification).toBe("envelope");
  });

  test("/api/payments/webhook classified as provider-ack-exempt (gateway callback surface)", () => {
    const webhookEntry = ROUTE_INVENTORY.find(entry => entry.path === "/api/payments/webhook");
    expect(webhookEntry?.classification).toBe("provider-ack-exempt");
  });

  test("registry ordering is a locked snapshot (single source for the doc table)", () => {
    expect(ROUTE_INVENTORY.map(entry => entry.path)).toEqual([
      "/api/graphql",
      "/api/set-locale",
      "/api/health",
      "/api/cron/sweep-sessions",
      "/api/cron/reconcile-paymob-payments",
      "/api/cron/expire-subscriptions",
      "/api/cron/sweep-inactive-teachers",
      "/api/payments/webhook",
    ]);
  });
});

describe("ROUTE_INVENTORY ↔ live tree completeness (Tier 3)", () => {
  test("every physical route file is registered; no registry row points at disk ghosts", () => {
    const appApiRoot = join(process.cwd(), "app", "api");
    const livePaths = discoverApiRoutePaths(appApiRoot).toSorted((a, b) => a.localeCompare(b));
    const registeredPaths = ROUTE_INVENTORY.map(entry => entry.path).toSorted((a, b) => a.localeCompare(b));

    // Sanity floor: the live tree must still contain the known routes.
    expect(livePaths.length).toBeGreaterThanOrEqual(3);

    expect(registeredPaths).toEqual(livePaths);
  });
});

describe("phantom-route hygiene (Tier 4)", () => {
  test.each(["/api/logs", "/api/cron/ticker", "/api/cron/execute", "/api/webhooks/whatsapp"])(
    "%s stays UNREGISTERED unless its route file physically exists",
    phantomPath => {
      const phantomFile = join(process.cwd(), "app", "api", phantomPath.replace(/^\/api\//, ""), "route.ts");
      if (!existsSync(phantomFile)) {
        expect(ROUTE_INVENTORY.some(entry => entry.path === phantomPath)).toBe(false);
      }
    }
  );
});
