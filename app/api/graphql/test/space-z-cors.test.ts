/**
 * Unit tests for `app/api/graphql/space-z-cors.ts`.
 *
 * Verifies strict origin validation for `*.space-z.ai` and `space-z.ai`
 * origins, preventing suffix bypasses (e.g., `https://space-z.ai.attacker.com`
 * or `https://evil-space-z.ai`).
 */

import { describe, expect, test } from "bun:test";
import {
  applySpaceZCorsHeaders,
  isAllowedSpaceZOrigin,
  spaceZCorsPreflightResponse,
} from "@/app/api/graphql/space-z-cors";

describe("isAllowedSpaceZOrigin", () => {
  test("allows exact apex domain https://space-z.ai", () => {
    expect(isAllowedSpaceZOrigin("https://space-z.ai")).toBe(true);
  });

  test("allows subdomains like https://preview.space-z.ai and https://sub.dev.space-z.ai", () => {
    expect(isAllowedSpaceZOrigin("https://preview.space-z.ai")).toBe(true);
    expect(isAllowedSpaceZOrigin("https://sub.dev.space-z.ai")).toBe(true);
    expect(isAllowedSpaceZOrigin("https://preview.space-z.ai:8080")).toBe(true);
  });

  test("rejects domain suffix bypasses like https://space-z.ai.attacker.com", () => {
    expect(isAllowedSpaceZOrigin("https://space-z.ai.attacker.com")).toBe(false);
  });

  test("rejects prefix bypasses like https://evil-space-z.ai", () => {
    expect(isAllowedSpaceZOrigin("https://evil-space-z.ai")).toBe(false);
  });

  test("rejects null, empty, or malformed origin strings", () => {
    expect(isAllowedSpaceZOrigin(null)).toBe(false);
    expect(isAllowedSpaceZOrigin("")).toBe(false);
    expect(isAllowedSpaceZOrigin("not-a-valid-url")).toBe(false);
  });
});

describe("applySpaceZCorsHeaders", () => {
  test("applies CORS headers for allowed origins", () => {
    const headers = new Headers();
    const origin = "https://preview.space-z.ai";
    applySpaceZCorsHeaders(headers, origin);

    expect(headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
    expect(headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type, Authorization, Apollo-Require-Preflight, X-Apollo-Operation-Name"
    );
  });

  test("does not set CORS headers for unauthorized origins", () => {
    const headers = new Headers();
    applySpaceZCorsHeaders(headers, "https://space-z.ai.attacker.com");
    expect(headers.get("Access-Control-Allow-Origin")).toBeNull();

    applySpaceZCorsHeaders(headers, "https://evil.com");
    expect(headers.get("Access-Control-Allow-Origin")).toBeNull();

    applySpaceZCorsHeaders(headers, null);
    expect(headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("spaceZCorsPreflightResponse", () => {
  test("returns 204 with full CORS header set for allowed origins", () => {
    const origin = "https://preview.space-z.ai";
    const res = spaceZCorsPreflightResponse(origin);

    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Access-Control-Max-Age")).toBe("86400");
  });

  test("returns 403 with no CORS headers for unauthorized origins", () => {
    const res = spaceZCorsPreflightResponse("https://space-z.ai.attacker.com");
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const nullRes = spaceZCorsPreflightResponse(null);
    expect(nullRes.status).toBe(403);
    expect(nullRes.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
