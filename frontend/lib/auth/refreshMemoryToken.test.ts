/**
 * `refreshMemoryToken` unit tests (paired with
 * `frontend/lib/auth/refreshMemoryToken.ts`).
 *
 * Verifies in-memory refresh token getter/setter state management,
 * token persistence, token clearing, and boundary conditions.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getRefreshMemoryToken, setRefreshMemoryToken } from "@/frontend/lib/auth/refreshMemoryToken";

describe("refreshMemoryToken — React memory refresh-token slot", () => {
  beforeEach(() => {
    setRefreshMemoryToken(null);
  });

  afterEach(() => {
    setRefreshMemoryToken(null);
  });

  test("returns null by default when no token has been set", () => {
    expect(getRefreshMemoryToken()).toBeNull();
  });

  test("stores and retrieves a valid refresh token", () => {
    const sampleVal = "sample-token-value-12345";
    setRefreshMemoryToken(sampleVal);
    expect(getRefreshMemoryToken()).toBe(sampleVal);
  });

  test("overwrites an existing token when updated with a new token", () => {
    setRefreshMemoryToken("initial-value-123");
    expect(getRefreshMemoryToken()).toBe("initial-value-123");

    setRefreshMemoryToken("updated-value-456");
    expect(getRefreshMemoryToken()).toBe("updated-value-456");
  });

  test("clears the token when setRefreshMemoryToken is called with null", () => {
    setRefreshMemoryToken("value-to-be-cleared");
    expect(getRefreshMemoryToken()).toBe("value-to-be-cleared");

    setRefreshMemoryToken(null);
    expect(getRefreshMemoryToken()).toBeNull();
  });

  describe("boundary cases and payload variations", () => {
    test("handles empty string token correctly", () => {
      setRefreshMemoryToken("");
      expect(getRefreshMemoryToken()).toBe("");
    });

    test("handles whitespace token strings correctly", () => {
      const whitespaceVal = "   ";
      setRefreshMemoryToken(whitespaceVal);
      expect(getRefreshMemoryToken()).toBe(whitespaceVal);
    });

    test("handles tokens with special characters and symbols", () => {
      const complexVal = "symbols_value_!@#$%^&*()_+=-[]{};':\",./<>?";
      setRefreshMemoryToken(complexVal);
      expect(getRefreshMemoryToken()).toBe(complexVal);
    });

    test("handles very long token strings", () => {
      const longVal = "a".repeat(4096);
      setRefreshMemoryToken(longVal);
      expect(getRefreshMemoryToken()).toBe(longVal);
    });
  });
});
