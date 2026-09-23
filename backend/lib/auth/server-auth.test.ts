/**
 * `getServerUserContext` unit test suite.
 *
 * Tests:
 *  - Anonymous access when access_token cookie is missing or empty.
 *  - Anonymous access when access token is invalid or expired.
 *  - Anonymous access when user row is not found in DB.
 *  - Fail-closed behavior for governed accounts (deleted, blocked, suspended) with domain error logging.
 *  - Anonymous access when token payload role is unknown or tampered.
 *  - Happy path for valid authenticated user: returns verified userId, role, and user object with passwordHash omitted.
 *  - Defensive error handling when cookie reading or DB queries fail unexpectedly.
 */

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { UserRepository } from "@/backend/db/repo";
import { UserRole } from "@/backend/enum/users/user-role.enum";
import { AUTH_COOKIE_NAMES } from "@/backend/lib/auth/cookies";
import { resetJwtSecretCache, signAccessToken } from "@/backend/lib/auth/jwt";
import { resetEnvironmentCache } from "@/backend/lib/env";
import { logger } from "@/backend/lib/logger";
import type { UserSelectType } from "@/backend/types";

// ----------------------------------------------------------------------------
// Controlled cookie store state
// ----------------------------------------------------------------------------

let mockCookieValue: string | undefined;
let cookiesShouldThrow = false;

void mock.module("next/headers", () => ({
  cookies: async () => {
    if (cookiesShouldThrow) {
      throw new Error("Cookie read failed");
    }
    return {
      get: (name: string) =>
        name === AUTH_COOKIE_NAMES.accessToken && mockCookieValue !== undefined
          ? { value: mockCookieValue }
          : undefined,
    };
  },
}));

// Bypass react.cache memoization in unit tests so each call executes freshly.
void mock.module("react", () => ({
  cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn,
}));

// Dynamically import getServerUserContext after registering module mocks
const { getServerUserContext } = await import("@/backend/lib/auth/server-auth");

// ----------------------------------------------------------------------------
// Helpers & Fixtures
// ----------------------------------------------------------------------------

const ENV_KEYS = ["DATABASE_ENCRYPTION_KEY", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "NODE_ENV"] as const;
const savedEnv: Record<string, string | undefined> = {};

type SpyInstance = ReturnType<typeof spyOn>;
const trackedSpies: SpyInstance[] = [];

function trackSpy<T extends SpyInstance>(spy: T): T {
  trackedSpies.push(spy);
  return spy;
}

function mockUserRow(overrides: Partial<UserSelectType> = {}): UserSelectType {
  return {
    id: 100,
    email: "[EMAIL_REDACTED]",
    fullName: "John Doe",
    passwordHash: "hash",
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
    dateOfBirth: "1995-05-15",
    deletedAt: null,
    blockedAt: null,
    lastActiveAt: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

/**
 * Shared fail-closed scenario: a valid token for user 100 whose DB row carries
 * the given governance overrides must yield the anonymous context plus the
 * exact `SSR_GOVERNED_ACCOUNT` domain-error log payload.
 */
async function expectGovernedAccountDenied(
  overrides: Partial<UserSelectType>,
  tokenRole: string = UserRole.Student
): Promise<void> {
  mockCookieValue = await signAccessToken({ userId: 100, role: tokenRole });
  trackSpy(spyOn(UserRepository, "findById").mockResolvedValue(mockUserRow(overrides)));
  const logSpy = trackSpy(spyOn(logger, "logDomainError").mockImplementation(() => {}));

  const context = await getServerUserContext();

  expect(context).toEqual({ userId: null, user: null, role: null });
  expect(logSpy).toHaveBeenCalledWith("SSR auth: governed account denied", {
    code: "SSR_GOVERNED_ACCOUNT",
    entity: "users",
    entityId: 100,
  });
}

// ----------------------------------------------------------------------------
// Test Suite
// ----------------------------------------------------------------------------

describe("getServerUserContext — SSR Auth", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
    process.env.DATABASE_ENCRYPTION_KEY = "cafef00dcafe1234cafef00dcafe1234cafef00dcafe1234cafef00dcafe1234";
    resetJwtSecretCache();
    resetEnvironmentCache();

    mockCookieValue = undefined;
    cookiesShouldThrow = false;
  });

  afterEach(() => {
    while (trackedSpies.length > 0) {
      trackedSpies.pop()?.mockRestore();
    }
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        (process.env as Record<string, string | undefined>)[key] = savedEnv[key];
      }
    }
    resetJwtSecretCache();
    resetEnvironmentCache();
    mockCookieValue = undefined;
    cookiesShouldThrow = false;
  });

  test("returns anonymous context when access_token cookie is missing", async () => {
    mockCookieValue = undefined;

    const context = await getServerUserContext();

    expect(context).toEqual({ userId: null, user: null, role: null });
  });

  test("returns anonymous context when access_token cookie is empty string", async () => {
    mockCookieValue = "";

    const context = await getServerUserContext();

    expect(context).toEqual({ userId: null, user: null, role: null });
  });

  test("returns anonymous context when token signature or payload is invalid", async () => {
    mockCookieValue = "invalid.jwt.token";

    const context = await getServerUserContext();

    expect(context).toEqual({ userId: null, user: null, role: null });
  });

  test("returns anonymous context when user is not found in database", async () => {
    mockCookieValue = await signAccessToken({ userId: 999, role: UserRole.Student });
    const findSpy = trackSpy(spyOn(UserRepository, "findById").mockResolvedValue(null));

    const context = await getServerUserContext();

    expect(findSpy).toHaveBeenCalledWith(999);
    expect(context).toEqual({ userId: null, user: null, role: null });
  });

  test("returns anonymous context and logs domain error for deleted user (fail-closed)", async () => {
    await expectGovernedAccountDenied({ isDeleted: true });
  });

  test("returns anonymous context and logs domain error for blocked user (fail-closed)", async () => {
    await expectGovernedAccountDenied({ role: UserRole.Teacher, isBlocked: true }, UserRole.Teacher);
  });

  test("returns anonymous context and logs domain error for actively suspended user", async () => {
    const now = new Date();
    await expectGovernedAccountDenied({
      suspended: true,
      suspendedAt: new Date(now.getTime() - 60 * 60 * 1000), // 1 hour ago
      suspendedPeriodDays: 7, // 7-day suspension
    });
  });

  test("returns anonymous context when token role claim is invalid or untrusted", async () => {
    mockCookieValue = await signAccessToken({ userId: 100, role: "superadmin_hacker" });
    trackSpy(spyOn(UserRepository, "findById").mockResolvedValue(mockUserRow()));

    const context = await getServerUserContext();

    expect(context).toEqual({ userId: null, user: null, role: null });
  });

  test("returns authenticated context with stripped password for active valid caller", async () => {
    mockCookieValue = await signAccessToken({ userId: 100, role: UserRole.Parent });
    trackSpy(spyOn(UserRepository, "findById").mockResolvedValue(mockUserRow({ role: UserRole.Parent })));

    const context = await getServerUserContext();

    expect(context.userId).toBe(100);
    expect(context.role).toBe(UserRole.Parent);
    expect(context.user).not.toBeNull();
    if (context.user) {
      expect("passwordHash" in context.user).toBe(false);
      expect(context.user.preferredRecitation).toBeNull();
      expect(context.user.email).toBe("[EMAIL_REDACTED]");
      expect(context.user.fullName).toBe("John Doe");
    }
  });

  test("defensive catch: handles unexpected errors gracefully without throwing 500", async () => {
    cookiesShouldThrow = true;
    const logSpy = trackSpy(spyOn(logger, "logDomainError").mockImplementation(() => {}));

    const context = await getServerUserContext();

    expect(context).toEqual({ userId: null, user: null, role: null });
    expect(logSpy).toHaveBeenCalledWith("SSR auth: unexpected error", {
      code: "SSR_AUTH_ERROR",
      errorName: "Error",
    });
  });
});
