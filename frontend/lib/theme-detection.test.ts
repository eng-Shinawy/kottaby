/**
 * Unit test suite for client-side theme preference persistence (`frontend/lib/theme-detection.ts`).
 *
 * Validates 4 tiers of requirements:
 * Tier 1: Statement and branch coverage for light/dark palette mode persistence.
 * Tier 2: SSR safety (undefined window) and localStorage failure resilience (QuotaExceededError/private mode).
 * Tier 3: Chaos and storage failure variations (non-Error throwables, sequential mode switching).
 * Tier 4: Cookie string construction resilience and exact attribute contract.
 */

import { afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from "bun:test";
import { setThemePreference } from "@/frontend/lib/theme-detection";

describe("setThemePreference — theme preference persistence", () => {
  // Runtime reality: `window`/`document` are DELETED in SSR-safety cases below,
  // so capture them as possibly-undefined even though lib.dom types them as
  // always-present (keeps the afterEach guards type-honest).
  const originalWindow: typeof globalThis.window | undefined = globalThis.window;
  const originalDocument: typeof globalThis.document | undefined = globalThis.document;

  let mockLocalStorageStore: Record<string, string>;
  let setItemSpy: Mock<(key: string, value: string) => void>;
  let lastAssignedCookie: string;

  beforeEach(() => {
    mockLocalStorageStore = {};
    lastAssignedCookie = "";

    const mockLocalStorage = {
      getItem: (key: string) => mockLocalStorageStore[key] ?? null,
      setItem: (key: string, value: string) => {
        mockLocalStorageStore[key] = value;
      },
    };

    setItemSpy = spyOn(mockLocalStorage, "setItem");

    const mockDocument = {
      get cookie() {
        return lastAssignedCookie;
      },
      set cookie(val: string) {
        lastAssignedCookie = val;
      },
    };

    const mockWindow = {
      localStorage: mockLocalStorage,
    };

    Object.defineProperty(globalThis, "window", {
      value: mockWindow,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis, "document", {
      value: mockDocument,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
        writable: true,
      });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }

    if (originalDocument) {
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
        writable: true,
      });
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
  });

  // TIER 1: Statement & Branch Coverage
  describe("Tier 1: Happy Paths — palette mode persistence", () => {
    test("persists 'dark' mode to localStorage and document.cookie", () => {
      setThemePreference("dark");

      expect(setItemSpy).toHaveBeenCalledWith("theme", "dark");
      expect(mockLocalStorageStore.theme).toBe("dark");
      expect(lastAssignedCookie).toBe("theme-mode=dark;path=/;max-age=31536000;SameSite=Lax");
    });

    test("persists 'light' mode to localStorage and document.cookie", () => {
      setThemePreference("light");

      expect(setItemSpy).toHaveBeenCalledWith("theme", "light");
      expect(mockLocalStorageStore.theme).toBe("light");
      expect(lastAssignedCookie).toBe("theme-mode=light;path=/;max-age=31536000;SameSite=Lax");
    });
  });

  // TIER 2: Boundary Conditions & Environment Isolation
  describe("Tier 2: Environment Boundaries & Error Fallbacks", () => {
    test("SSR safety: no-ops when window is undefined without throwing", () => {
      Reflect.deleteProperty(globalThis, "window");

      expect(() => {
        setThemePreference("dark");
      }).not.toThrow();
      expect(setItemSpy).not.toHaveBeenCalled();
      expect(lastAssignedCookie).toBe("");
    });

    test("localStorage QuotaExceededError fallback: still sets cookie when localStorage.setItem throws", () => {
      setItemSpy.mockImplementation(() => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      });

      expect(() => {
        setThemePreference("dark");
      }).not.toThrow();
      expect(setItemSpy).toHaveBeenCalledWith("theme", "dark");
      expect(lastAssignedCookie).toBe("theme-mode=dark;path=/;max-age=31536000;SameSite=Lax");
    });
  });

  // TIER 3: Chaos & Storage Failure Variations
  describe("Tier 3: Chaos & Fault Tolerance", () => {
    test("handles non-Error throwables from localStorage gracefully", () => {
      setItemSpy.mockImplementation(() => {
        // Primitive throwable (e.g. from custom storage polyfills or security sandboxes)
        throw "Access denied";
      });

      expect(() => {
        setThemePreference("light");
      }).not.toThrow();
      expect(lastAssignedCookie).toBe("theme-mode=light;path=/;max-age=31536000;SameSite=Lax");
    });

    test("sequential mode toggling updates localStorage and cookie on each call", () => {
      setThemePreference("dark");
      expect(mockLocalStorageStore.theme).toBe("dark");
      expect(lastAssignedCookie).toContain("theme-mode=dark");

      setThemePreference("light");
      expect(mockLocalStorageStore.theme).toBe("light");
      expect(lastAssignedCookie).toContain("theme-mode=light");

      setThemePreference("dark");
      expect(mockLocalStorageStore.theme).toBe("dark");
      expect(lastAssignedCookie).toContain("theme-mode=dark");
    });
  });

  // TIER 4: Security & Attribute Contract
  describe("Tier 4: Cookie Contract & Security Properties", () => {
    test("cookie attributes strictly conform to required security settings (SameSite=Lax, max-age=1 year, path=/)", () => {
      setThemePreference("dark");

      const cookieParts = lastAssignedCookie.split(";");
      expect(cookieParts[0]).toBe("theme-mode=dark");
      expect(cookieParts).toContain("path=/");
      expect(cookieParts).toContain("max-age=31536000");
      expect(cookieParts).toContain("SameSite=Lax");
    });
  });
});
