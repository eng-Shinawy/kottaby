import { beforeEach, describe, expect, it } from "bun:test";
import {
  checkRateLimit,
  clearRateLimitStore,
  getClientIdentifier,
  graphqlRateLimiter,
  portalReadLimiter,
  type RateLimiterConfig,
} from "@/backend/lib/ratelimit";

describe("Rate Limiter Namespace Isolation & Functionality", () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  it("extracts client identifier from headers correctly", () => {
    const reqWithXff = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.195, 70.41.3.18" },
    });
    expect(getClientIdentifier(reqWithXff)).toBe("203.0.113.195");

    const reqWithRealIp = new Request("http://localhost", {
      headers: { "x-real-ip": "198.51.100.1" },
    });
    expect(getClientIdentifier(reqWithRealIp)).toBe("198.51.100.1");

    const reqFallback = new Request("http://localhost");
    expect(getClientIdentifier(reqFallback)).toBe("local");
  });

  it("enforces rate limits within a single namespace", async () => {
    const testLimiter: RateLimiterConfig = {
      name: "test-limiter",
      limit: 3,
      windowMs: 60_000,
    };

    const res1 = await checkRateLimit("user-1", testLimiter);
    expect(res1.success).toBe(true);
    expect(res1.remaining).toBe(2);

    const res2 = await checkRateLimit("user-1", testLimiter);
    expect(res2.success).toBe(true);
    expect(res2.remaining).toBe(1);

    const res3 = await checkRateLimit("user-1", testLimiter);
    expect(res3.success).toBe(true);
    expect(res3.remaining).toBe(0);

    const res4 = await checkRateLimit("user-1", testLimiter);
    expect(res4.success).toBe(false);
    expect(res4.remaining).toBe(0);
  });

  it("isolates different rate limiter namespaces for the same IP/identifier", async () => {
    const tightLimiter: RateLimiterConfig = {
      name: "tight-limiter",
      limit: 2,
      windowMs: 60_000,
    };

    // Exhaust tightLimiter quota
    await checkRateLimit("192.0.2.1", tightLimiter);
    await checkRateLimit("192.0.2.1", tightLimiter);
    const tightBlocked = await checkRateLimit("192.0.2.1", tightLimiter);
    expect(tightBlocked.success).toBe(false);

    // Requests to portalReadLimiter or graphqlRateLimiter for the SAME IP must still succeed
    const portalRes = await checkRateLimit("192.0.2.1", portalReadLimiter);
    expect(portalRes.success).toBe(true);

    const graphqlRes = await checkRateLimit("192.0.2.1", graphqlRateLimiter);
    expect(graphqlRes.success).toBe(true);
  });

  it("clears rate limit store on clearRateLimitStore call", async () => {
    const testLimiter: RateLimiterConfig = {
      name: "test-clear",
      limit: 1,
      windowMs: 60_000,
    };

    await checkRateLimit("ip-1", testLimiter);
    const blocked = await checkRateLimit("ip-1", testLimiter);
    expect(blocked.success).toBe(false);

    clearRateLimitStore();

    const fresh = await checkRateLimit("ip-1", testLimiter);
    expect(fresh.success).toBe(true);
  });
});
