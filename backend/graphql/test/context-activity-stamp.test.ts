/**
 * ctx activity stamp — fire-and-forget throttled write on the context
 * factory. DB-free sibling of context-keys.test.ts: same harness (plain
 * `new Request(...)` constructions, direct `createGraphQLContext`
 * invocation) and the repo's `spyOn(namespace, method)` convention for the
 * repository (no DB, no module mocks).
 *
 * Coverage map:
 *  - Tier 1 — an authenticated construction issues EXACTLY ONE throttled
 *    activity stamp for the resolved verified user's id, anchored to a
 *    single captured instant: `(now, staleBefore = now −
 *    USER_ACTIVITY_COALESCE_WINDOW_MS)`; the unconditional stamp primitive
 *    is never reachable from the factory;
 *  - Tier 2 — anonymous requests issue NOTHING (headerless AND
 *    garbage-Bearer constructions stay at zero stamps — a wire credential
 *    can never produce a stamp, only a VERIFIED + resolved user can);
 *  - Tier 3 — containment: a rejected stamp NEVER rejects
 *    `createGraphQLContext` (the rejection is absorbed by the
 *    fire-and-forget `.catch` and surfaces only as a logged swallow), and
 *    parallel constructions stamp independently — exactly one each;
 *  - Tier 4 — identity sourcing: the stamped id is the RESOLVED user's id
 *    (what the factory actually fetched), never a client-owned token claim;
 *  - Semantic pins — the stamp issue site and the `now` capture site each
 *    exist EXACTLY ONCE in the factory source, and the route module stays
 *    stamp-free.
 *
 * Runs via `bun run test/scripts/run-test.ts backend/graphql/test/context-activity-stamp.test.ts`.
 */

import { afterEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { USER_ACTIVITY_COALESCE_WINDOW_MS, UserRepository } from "@/backend/db/repo";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { type Context, createGraphQLContext } from "@/backend/graphql/gqlContextFactory";
import { signAccessToken } from "@/backend/lib/auth/jwt";
import { logger } from "@/backend/lib/logger";
import type { UserSelectType } from "@/backend/types";

/** Frozen anchor instant — window arithmetic must be deterministic. */
const FROZEN_NOW_MS = 1_700_000_000_000;

/** Resolved identity under stamp (spy-backed; no rows, no DB). */
const AUTH_USER_ID = 4_242_424;

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("https://draft.local/api/graphql", { method: "POST", headers });
}

function mockUserRow(overrides: Partial<UserSelectType> = {}): UserSelectType {
  return {
    id: AUTH_USER_ID,
    email: "[EMAIL_REDACTED]",
    fullName: "Activity Stamp Probe",
    passwordHash: "hash",
    mustChangePassword: false,
    role: UserRole.Student,
    isDeleted: false,
    isBlocked: false,
    suspended: false,
    suspendedAt: null,
    suspendedPeriodDays: null,
    locale: "en",
    phone: "+123456789",
    gender: "male",
    country: "EG",
    countryCode: null,
    dateOfBirth: "1995-05-15",
    deletedAt: null,
    blockedAt: null,
    lastActiveAt: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

async function bearerHeaderFor(userId: number): Promise<Record<string, string>> {
  const token = await signAccessToken({ userId, role: UserRole.Student });
  return { authorization: `Bearer ${token}` };
}

async function buildAuthenticatedContext(userId: number = AUTH_USER_ID): Promise<Context> {
  return createGraphQLContext(requestWithHeaders(await bearerHeaderFor(userId)));
}

/** Spy registry — every spy is restored so no namespace mutation leaks. */
type RepoSpy = ReturnType<typeof spyOn>;
const trackedSpies: RepoSpy[] = [];

function trackSpy<T extends RepoSpy>(spy: T): T {
  trackedSpies.push(spy);
  return spy;
}

afterEach(() => {
  while (trackedSpies.length > 0) {
    trackedSpies.pop()?.mockRestore();
  }
  setSystemTime();
});

// ─── Tier 1 — exactly one throttled stamp on authenticated construction ──────

describe("ctx activity stamp — Tier 1 authenticated construction", () => {
  test("issues EXACTLY ONE throttled stamp with (now, now − coalesce window) and the resolved id", async () => {
    setSystemTime(FROZEN_NOW_MS);
    trackSpy(spyOn(UserRepository, "findById").mockResolvedValue(mockUserRow()));
    const stampSpy = trackSpy(spyOn(UserRepository, "updateLastActiveAtIfStale").mockResolvedValue(true));

    const context = await buildAuthenticatedContext();

    expect(stampSpy).toHaveBeenCalledTimes(1);
    expect(stampSpy).toHaveBeenCalledWith(
      AUTH_USER_ID,
      new Date(FROZEN_NOW_MS - USER_ACTIVITY_COALESCE_WINDOW_MS),
      new Date(FROZEN_NOW_MS)
    );
    // The context contract itself is unchanged by the stamp.
    expect(context.user?.id).toBe(AUTH_USER_ID);
    expect(context.role).toBe(UserRole.Student);
  });

  test("the UNCONDITIONAL primitive is never reachable from the factory", async () => {
    setSystemTime(FROZEN_NOW_MS);
    trackSpy(spyOn(UserRepository, "findById").mockResolvedValue(mockUserRow()));
    trackSpy(spyOn(UserRepository, "updateLastActiveAtIfStale").mockResolvedValue(true));
    const unconditionalSpy = trackSpy(spyOn(UserRepository, "updateLastActiveAt").mockResolvedValue(true));

    await buildAuthenticatedContext();

    expect(unconditionalSpy).not.toHaveBeenCalled();
  });
});

// ─── Tier 2 — anonymous requests issue NOTHING ───────────────────────────────

describe("ctx activity stamp — Tier 2 anonymous construction", () => {
  test("a headerless request issues zero stamps and zero user lookups", async () => {
    const stampSpy = trackSpy(spyOn(UserRepository, "updateLastActiveAtIfStale").mockResolvedValue(true));
    const findByIdSpy = trackSpy(spyOn(UserRepository, "findById").mockResolvedValue(null));

    const context = await createGraphQLContext(requestWithHeaders({}));

    expect(stampSpy).not.toHaveBeenCalled();
    expect(findByIdSpy).not.toHaveBeenCalled();
    expect(context.user).toBeNull();
    expect(context.role).toBeNull();
  });

  test("a garbage Bearer credential issues zero stamps (verified-user gate, not wire presence)", async () => {
    const stampSpy = trackSpy(spyOn(UserRepository, "updateLastActiveAtIfStale").mockResolvedValue(true));
    const findByIdSpy = trackSpy(spyOn(UserRepository, "findById").mockResolvedValue(null));

    const context = await createGraphQLContext(requestWithHeaders({ authorization: "Bearer garbage.token.value" }));

    expect(stampSpy).not.toHaveBeenCalled();
    expect(findByIdSpy).not.toHaveBeenCalled();
    expect(context.user).toBeNull();
  });

  test("an unverifiable user row (lookup miss) issues zero stamps", async () => {
    const stampSpy = trackSpy(spyOn(UserRepository, "updateLastActiveAtIfStale").mockResolvedValue(true));
    trackSpy(spyOn(UserRepository, "findById").mockResolvedValue(null));

    await createGraphQLContext(requestWithHeaders(await bearerHeaderFor(999_999)));

    expect(stampSpy).not.toHaveBeenCalled();
  });
});

// ─── Tier 3 — fire-and-forget containment + per-construction isolation ───────

describe("ctx activity stamp — Tier 3 rejection containment & isolation", () => {
  test("a rejected stamp NEVER rejects createGraphQLContext — the .catch contains it", async () => {
    setSystemTime(FROZEN_NOW_MS);
    trackSpy(spyOn(UserRepository, "findById").mockResolvedValue(mockUserRow()));
    const stampSpy = trackSpy(
      spyOn(UserRepository, "updateLastActiveAtIfStale").mockRejectedValue(new Error("connection refused"))
    );
    const warnSpy = trackSpy(spyOn(logger, "warn").mockImplementation(() => {}));

    // The construction resolves with the verified user — no rejection escapes.
    const context = await buildAuthenticatedContext();

    expect(stampSpy).toHaveBeenCalledTimes(1);
    expect(context.user?.id).toBe(AUTH_USER_ID);
    expect(context.role).toBe(UserRole.Student);

    // The swallow is logged with the error NAME only (no DB internals), never rethrown.
    expect(warnSpy.mock.calls).toHaveLength(1);
    const firstCall = warnSpy.mock.calls[0];
    if (!firstCall) throw new Error("swallow log missing");
    const [message, payload] = firstCall;
    expect(message).toContain("activity stamp");
    expect(payload).toEqual({ userId: AUTH_USER_ID, errorName: "Error" });
  });

  test("parallel authenticated constructions stamp exactly once each (no cross-wiring)", async () => {
    setSystemTime(FROZEN_NOW_MS);
    const ids = [111_111, 222_222, 333_333];
    trackSpy(
      spyOn(UserRepository, "findById").mockImplementation(async (userId: number) => mockUserRow({ id: userId }))
    );
    const stampSpy = trackSpy(spyOn(UserRepository, "updateLastActiveAtIfStale").mockResolvedValue(false));

    const contexts = await Promise.all(ids.map(id => buildAuthenticatedContext(id)));

    expect(stampSpy).toHaveBeenCalledTimes(ids.length);
    // Order-insensitive: the three constructions race on parallel microtask
    // interleavings, so the GLOBAL cross-request stamp order is
    // nondeterministic — compare as sorted multisets (per-context own-id
    // identity is still fully pinned by the per-element values).
    expect(stampSpy.mock.calls.map(call => call[0]).toSorted((a, b) => a - b)).toEqual(ids.toSorted((a, b) => a - b));
    // Per-request accumulator identity — full construction independence.
    expect(new Set(contexts.map(entry => entry.authCookieOut)).size).toBe(ids.length);
  });
});

// ─── Tier 4 — identity sourcing (no client-owned values) ─────────────────────

describe("ctx activity stamp — Tier 4 identity sourcing", () => {
  test("the stamped id is the RESOLVED user's id — never a client-owned token claim", async () => {
    setSystemTime(FROZEN_NOW_MS);
    const tokenClaimUserId = 7_777_777; // what the wire credential carries
    const resolvedUserId = 4_242_424; // what the factory actually resolved
    trackSpy(spyOn(UserRepository, "findById").mockResolvedValue(mockUserRow({ id: resolvedUserId })));
    const stampSpy = trackSpy(spyOn(UserRepository, "updateLastActiveAtIfStale").mockResolvedValue(true));

    await createGraphQLContext(requestWithHeaders(await bearerHeaderFor(tokenClaimUserId)));

    expect(stampSpy).toHaveBeenCalledTimes(1);
    const firstCall = stampSpy.mock.calls[0];
    if (!firstCall) throw new Error("stamp call missing");
    expect(firstCall[0]).toBe(resolvedUserId);
  });
});

// ─── Semantic pins — single issue site, single now capture ───────────────────

/** Comment-stripped view so literal-count pins measure CODE sites only. */
function codeView(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split("\n")
    .filter(line => !line.trim().startsWith("//"))
    .join("\n");
}

describe("factory semantic pins — no duplicated stamp wiring", () => {
  const factorySource = codeView(readFileSync(new URL("../gqlContextFactory.ts", import.meta.url), "utf8"));
  const routeSource = codeView(readFileSync(new URL("../../../app/api/graphql/route.ts", import.meta.url), "utf8"));

  test("the throttled stamp issue site lives EXACTLY ONCE — inside the factory, route stays stamp-free", () => {
    expect(factorySource.split("updateLastActiveAtIfStale").length - 1).toBe(1);
    expect(routeSource.includes("updateLastActiveAtIfStale")).toBe(false);
    // The unconditional primitive must never be reachable from the factory.
    expect(factorySource.includes("updateLastActiveAt(")).toBe(false);
  });

  test("the `now` capture site exists EXACTLY ONCE and rides the exported coalesce window", () => {
    expect(factorySource.split("new Date()").length - 1).toBe(1);
    expect(factorySource.includes("USER_ACTIVITY_COALESCE_WINDOW_MS")).toBe(true);
  });

  test("the stamp is void-issued with a contained catch and the backend logger", () => {
    expect(/void UserRepository\.updateLastActiveAtIfStale\(/u.test(factorySource)).toBe(true);
    expect(/\.catch\(/u.test(factorySource)).toBe(true);
    expect(factorySource.includes('from "@/backend/lib/logger"')).toBe(true);
  });
});
