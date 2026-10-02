import { describe, expect, it } from "bun:test";
import nextConfig from "@/next.config";

describe("Security Headers Configuration", () => {
  it("defines expected security headers for all routes", async () => {
    expect(nextConfig.headers).toBeDefined();
    if (nextConfig.headers) {
      const headersConfig = await nextConfig.headers();
      expect(headersConfig).toHaveLength(1);

      const routeHeaders = headersConfig[0];
      expect(routeHeaders.source).toBe("/:path*");

      const headersMap = new Map(routeHeaders.headers.map(h => [h.key, h.value]));
      expect(headersMap.get("X-Frame-Options")).toBe("DENY");
      expect(headersMap.get("X-Content-Type-Options")).toBe("nosniff");
      expect(headersMap.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(headersMap.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
      expect(headersMap.get("X-XSS-Protection")).toBe("0");
      expect(headersMap.get("Content-Security-Policy")).toBe(
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' *.space-z.ai *.space-zai; frame-ancestors 'none';"
      );
      expect(headersMap.get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains; preload");
    }
  });
});
