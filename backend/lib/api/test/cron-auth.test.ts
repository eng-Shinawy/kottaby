/**
 * Unit tests for cron authentication helpers (`backend/lib/api/cron-auth.ts`).
 *
 * Runs via `bun run test/scripts/run-test.ts backend/lib/api/test/cron-auth.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
  bearerSecretMatches,
  cronBearerFromRequest,
  cronUnauthorizedError,
  extractBearerToken,
} from "@/backend/lib/api/cron-auth";

function makeHeaderGetter(authHeaderValue: string | null): (name: string) => string | null {
  return (name: string) => (name === "authorization" ? authHeaderValue : null);
}

describe("cron-auth utilities", () => {
  describe("extractBearerToken", () => {
    test("extracts token from standard Bearer header", () => {
      expect(extractBearerToken("Bearer my-secret-token")).toBe("my-secret-token");
    });

    test("handles case-insensitive scheme and surrounding whitespace", () => {
      expect(extractBearerToken("   bearer   my-secret-token   ")).toBe("my-secret-token");
      expect(extractBearerToken("BEARER my-secret-token")).toBe("my-secret-token");
    });

    test("returns null for non-Bearer schemes", () => {
      expect(extractBearerToken("Basic my-secret-token")).toBeNull();
      expect(extractBearerToken('Digest username="admin"')).toBeNull();
      expect(extractBearerToken("Token my-secret-token")).toBeNull();
    });

    test("returns null for empty or whitespace-only token after Bearer scheme", () => {
      expect(extractBearerToken("Bearer")).toBeNull();
      expect(extractBearerToken("Bearer ")).toBeNull();
      expect(extractBearerToken("Bearer    ")).toBeNull();
    });

    test("returns null for absent, null, undefined, or empty string header", () => {
      expect(extractBearerToken(null)).toBeNull();
      expect(extractBearerToken(undefined)).toBeNull();
      expect(extractBearerToken("")).toBeNull();
      expect(extractBearerToken("   ")).toBeNull();
    });
  });

  describe("bearerSecretMatches", () => {
    test("returns true for exact secret match", () => {
      expect(bearerSecretMatches("secret123", "secret123")).toBe(true);
    });

    test("returns false for non-matching secrets", () => {
      expect(bearerSecretMatches("wrong-secret", "secret123")).toBe(false);
    });

    test("returns false for null or empty presented secret", () => {
      expect(bearerSecretMatches(null, "secret123")).toBe(false);
      expect(bearerSecretMatches("", "secret123")).toBe(false);
    });

    test("returns false for an empty expected secret", () => {
      expect(bearerSecretMatches("secret123", "")).toBe(false);
    });
  });

  describe("cronBearerFromRequest", () => {
    test("authenticates successfully with valid Bearer header and matching secret", () => {
      const result = cronBearerFromRequest(makeHeaderGetter("Bearer valid-cron-secret"), "valid-cron-secret");
      expect(result.ok).toBe(true);
      expect(result.presented).toBe("valid-cron-secret");
    });

    test("trims a whitespace-padded configured secret before comparing", () => {
      const result = cronBearerFromRequest(makeHeaderGetter("Bearer valid-cron-secret"), "   valid-cron-secret   ");
      expect(result.ok).toBe(true);
      expect(result.presented).toBe("valid-cron-secret");
    });

    test("fails authentication with non-matching secret", () => {
      const result = cronBearerFromRequest(makeHeaderGetter("Bearer wrong-secret"), "valid-cron-secret");
      expect(result.ok).toBe(false);
      expect(result.presented).toBe("wrong-secret");
    });

    test("fails authentication when header uses a non-Bearer scheme even if credential string matches expected", () => {
      const result = cronBearerFromRequest(makeHeaderGetter("Basic valid-cron-secret"), "valid-cron-secret");
      expect(result.ok).toBe(false);
      expect(result.presented).toBeNull();
    });

    test("fails authentication when expected secret is missing, empty, or whitespace-only", () => {
      const headerGet = makeHeaderGetter("Bearer valid-cron-secret");

      expect(cronBearerFromRequest(headerGet, undefined).ok).toBe(false);
      expect(cronBearerFromRequest(headerGet, "").ok).toBe(false);
      expect(cronBearerFromRequest(headerGet, "   ").ok).toBe(false);
    });

    test("cronUnauthorizedError returns UNAUTHORIZED DomainError", () => {
      const err = cronUnauthorizedError();
      expect(err.code).toBe("UNAUTHORIZED");
      expect(err.message).toBe("Invalid cron credentials.");
    });
  });
});
