/**
 * Open-redirect prevention helpers contract tests (paired with
 * `frontend/lib/safeRedirect.ts`).
 *
 * Pins the backslash fold vector ("/\\host" ≡ "//host" under WHATWG URL
 * parsing) alongside the absolute/scheme/protocol-relative rejections, so
 * future edits cannot silently reopen the same-origin guarantee.
 */

import { describe, expect, test } from "bun:test";
import { buildLoginHref, isSafeRedirect } from "@/frontend/lib/safeRedirect";

/** Replicates browser-side destination resolution so verdicts reflect real navigation. */
function resolveLikeBrowser(url: string, base: string): string {
  return new URL(url, base).href;
}

describe("isSafeRedirect — same-origin type guard", () => {
  test("honored shapes: single-slash paths stay safe", () => {
    expect(isSafeRedirect("/dashboard")).toBe(true);
    expect(isSafeRedirect("/en/dashboard?tab=active")).toBe(true);
    expect(isSafeRedirect(null)).toBe(false);
    expect(isSafeRedirect("")).toBe(false);
  });

  test("rejected shapes: foreign-origin escapes", () => {
    for (const hostile of [
      "https://evil.example/x",
      "//evil.example/x",
      "javascript:alert(1)",
      "/\\evil.example/x",
      "/\\/evil.example/x",
      "\\evil.example",
      "/\tevil.example",
      "/\nevil.example",
      "/\revil.example",
      "/\0evil.example",
    ]) {
      expect(isSafeRedirect(hostile)).toBe(false);
    }
  });

  test("backslash fold vector actually escapes before the fix (semantic anchor)", () => {
    // Documents WHY the `includes("\\")` rejection exists: without it, this
    // parsed href pointed at a foreign origin.
    const folded = resolveLikeBrowser("/\\evil.example/x", "https://app.example.com");
    expect(folded.startsWith("https://evil.example/")).toBe(true);
  });
});

describe("buildLoginHref — login redirect param construction", () => {
  test("safe path is encoded into /login?redirect=", () => {
    expect(buildLoginHref("/dashboard")).toBe(`/login?redirect=${encodeURIComponent("/dashboard")}`);
  });

  test("hostile inputs (incl. backslash folds) collapse to bare /login", () => {
    expect(buildLoginHref("//evil.example/x")).toBe("/login");
    expect(buildLoginHref("https://evil.example")).toBe("/login");
    expect(buildLoginHref("/\\evil.example")).toBe("/login");
    expect(buildLoginHref()).toBe("/login");
  });
});
