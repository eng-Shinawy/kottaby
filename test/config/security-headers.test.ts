import { describe, expect, it } from "bun:test";
import nextConfig from "@/next.config";

const NON_PRODUCTION_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' *.space-z.ai *.space-zai; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self';";

const PRODUCTION_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' *.space-z.ai *.space-zai; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self';";

const EXPECTED_HEADER_KEYS = [
  "X-Frame-Options",
  "X-Content-Type-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "X-XSS-Protection",
  "Cross-Origin-Opener-Policy",
  "Cross-Origin-Resource-Policy",
  "Content-Security-Policy",
  "Strict-Transport-Security",
];

async function headersForNodeEnv(nodeEnv: string) {
  if (!nextConfig.headers) {
    throw new Error("next.config.ts must define headers()");
  }
  const previous = process.env.NODE_ENV;
  const hadPrevious = typeof previous === "string";
  // Index-signature alias sidesteps the read-only NODE_ENV augmentation
  // while mutating the SAME live env object the runtime reads.
  const envBag: Record<string, string | undefined> = process.env;
  try {
    envBag.NODE_ENV = nodeEnv;
    return await nextConfig.headers();
  } finally {
    if (hadPrevious) {
      envBag.NODE_ENV = previous;
    } else {
      delete envBag.NODE_ENV;
    }
  }
}

describe("Security Headers Configuration", () => {
  it("defines expected security headers for all routes", async () => {
    expect(nextConfig.headers).toBeDefined();
    if (nextConfig.headers) {
      const headersConfig = await headersForNodeEnv("development");
      expect(headersConfig).toHaveLength(1);

      const routeHeaders = headersConfig[0];
      expect(routeHeaders.source).toBe("/:path*");

      const headersMap = new Map(routeHeaders.headers.map(h => [h.key, h.value]));
      expect(headersMap.get("X-Frame-Options")).toBe("DENY");
      expect(headersMap.get("X-Content-Type-Options")).toBe("nosniff");
      expect(headersMap.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(headersMap.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
      expect(headersMap.get("X-XSS-Protection")).toBe("0");
      expect(headersMap.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
      expect(headersMap.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
      expect(headersMap.get("Content-Security-Policy")).toBe(NON_PRODUCTION_CSP);
      expect(headersMap.get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains; preload");
    }
  });

  it("suppresses the x-powered-by header", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("pins the header key order byte-exactly in both branches", async () => {
    const devHeaders = await headersForNodeEnv("development");
    const prodHeaders = await headersForNodeEnv("production");
    expect(devHeaders[0].headers.map(h => h.key)).toEqual(EXPECTED_HEADER_KEYS);
    expect(prodHeaders[0].headers.map(h => h.key)).toEqual(EXPECTED_HEADER_KEYS);
  });

  it("drops 'unsafe-eval' from script-src in the production branch", async () => {
    const headersConfig = await headersForNodeEnv("production");
    const headersMap = new Map(headersConfig[0].headers.map(h => [h.key, h.value]));
    const csp = headersMap.get("Content-Security-Policy");
    expect(csp).toBe(PRODUCTION_CSP);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("worker-src 'self'");
  });

  it("keeps 'unsafe-eval' in script-src outside production", async () => {
    const devHeaders = await headersForNodeEnv("development");
    const testHeaders = await headersForNodeEnv("test");
    const devCsp = new Map(devHeaders[0].headers.map(h => [h.key, h.value])).get("Content-Security-Policy");
    const testCsp = new Map(testHeaders[0].headers.map(h => [h.key, h.value])).get("Content-Security-Policy");
    expect(devCsp).toBe(NON_PRODUCTION_CSP);
    expect(testCsp).toBe(NON_PRODUCTION_CSP);
    expect(devCsp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(devCsp).toContain("object-src 'none'");
  });

  it("never interpolates request data into header values", async () => {
    const devHeaders = await headersForNodeEnv("development");
    const prodHeaders = await headersForNodeEnv("production");
    const allHeaders = [...devHeaders[0].headers, ...prodHeaders[0].headers];
    for (const header of allHeaders) {
      expect(header.value).not.toContain(":path");
      expect(header.value).not.toContain("${");
      expect(header.value).not.toMatch(/[\r\n]/);
    }
  });

  it("restores NODE_ENV after composing headers", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    await headersForNodeEnv("production");
    await headersForNodeEnv("development");
    expect(process.env.NODE_ENV).toBe(originalNodeEnv);
  });
});
