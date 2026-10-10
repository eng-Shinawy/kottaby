import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import { createHash } from "node:crypto";
import { RateLimitExceededError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import {
  authIpLimiter,
  checkRateLimit,
  clearRateLimitStore,
  enforceAuthMutationRateLimit,
  getClientIdentifier,
  graphqlRateLimiter,
  hashAuthIdentity,
  portalReadLimiter,
  type RateLimiterConfig,
  type RateLimitResult,
  resolveClientIp,
} from "@/backend/lib/ratelimit";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Catches the expected rejection from `body` (try/catch convention — the
 * suite-wide helper style; `expect(...).rejects` is avoided repo-wide).
 */
async function expectEnforcementRejection(body: () => Promise<unknown>): Promise<Error> {
  let errorCaught: unknown = null;
  try {
    await body();
  } catch (error) {
    errorCaught = error;
  }
  if (errorCaught instanceof Error) {
    return errorCaught;
  }
  throw new Error(
    errorCaught === null
      ? "expectEnforcementRejection: expected the call to throw, but it resolved successfully"
      : `expectEnforcementRejection: non-Error throw (${typeof errorCaught})`
  );
}

/**
 * Drains `count` strictly-sequential awaited rounds of `body` through a
 * promise chain — the suite convention for ordered drains (a bare awaited
 * loop is linted against). Returns each round's result in call order.
 */
async function drainSequentially<T>(count: number, body: (index: number) => Promise<T>): Promise<readonly T[]> {
  const thunks = Array.from({ length: count }, (_, index) => () => body(index));
  return thunks.reduce(
    (chain, thunk) => chain.then(results => thunk().then(result => [...results, result])),
    Promise.resolve([] as T[])
  );
}

describe("Rate Limiter Namespace Isolation & Functionality", () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  it("resolves the client IP spoof-resistently (x-real-ip → rightmost XFF → local)", () => {
    // Tier 1 — resolution branches, exercised through BOTH the shared
    // resolver and its delegation alias (the limiter keying entry point).

    // RIGHTMOST XFF entry — the hop appended by the trusted proxy.
    const reqWithXff = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.195, 198.51.100.200" },
    });
    expect(resolveClientIp(reqWithXff)).toBe("198.51.100.200");
    expect(getClientIdentifier(reqWithXff)).toBe("198.51.100.200");

    // x-real-ip outranks XFF (the proxy's direct statement).
    const reqWithRealIpAndXff = new Request("http://localhost", {
      headers: { "x-real-ip": "198.51.100.1", "x-forwarded-for": "203.0.113.195, 198.51.100.200" },
    });
    expect(resolveClientIp(reqWithRealIpAndXff)).toBe("198.51.100.1");
    expect(getClientIdentifier(reqWithRealIpAndXff)).toBe("198.51.100.1");

    const reqWithRealIp = new Request("http://localhost", {
      headers: { "x-real-ip": "198.51.100.1" },
    });
    expect(getClientIdentifier(reqWithRealIp)).toBe("198.51.100.1");

    // No IP headers at all → the "local" fallback.
    const reqFallback = new Request("http://localhost");
    expect(getClientIdentifier(reqFallback)).toBe("local");
  });

  it("falls to local on empty/whitespace-only headers instead of an empty-string key", () => {
    // Tier 2 — empty and whitespace-only headers must never collapse
    // distinct requests onto an empty-string limiter key ("").
    const reqEmptyXff = new Request("http://localhost", {
      headers: { "x-forwarded-for": "   " },
    });
    expect(getClientIdentifier(reqEmptyXff)).toBe("local");

    const reqEmptyRealIp = new Request("http://localhost", {
      headers: { "x-real-ip": "   " },
    });
    expect(getClientIdentifier(reqEmptyRealIp)).toBe("local");

    // A whitespace-only XFF must not win over a usable x-real-ip: the
    // fallback chain keeps descending instead of collapsing onto "".
    const reqWhitespaceXffWithRealIp = new Request("http://localhost", {
      headers: { "x-forwarded-for": "   ,   ", "x-real-ip": "203.0.113.7" },
    });
    expect(getClientIdentifier(reqWhitespaceXffWithRealIp)).toBe("203.0.113.7");

    // Symmetric: a whitespace-only x-real-ip must not win over a usable XFF.
    const reqWhitespaceRealIpWithXff = new Request("http://localhost", {
      headers: { "x-real-ip": "   ", "x-forwarded-for": "203.0.113.8, 198.51.100.9" },
    });
    expect(getClientIdentifier(reqWhitespaceRealIpWithXff)).toBe("198.51.100.9");

    // Whitespace-only everywhere → "local".
    const reqAllWhitespace = new Request("http://localhost", {
      headers: { "x-real-ip": "  ", "x-forwarded-for": "  ,  " },
    });
    expect(getClientIdentifier(reqAllWhitespace)).toBe("local");
  });

  it("splits XFF on commas only — IPv6 colons stay intact", () => {
    // Tier 2 — IPv6 entries contain colons; the comma-split must never
    // treat them as separators.
    const reqIpv6Chain = new Request("http://localhost", {
      headers: { "x-forwarded-for": "2001:db8::1, 2001:db8::2" },
    });
    expect(getClientIdentifier(reqIpv6Chain)).toBe("2001:db8::2");

    const reqIpv6Single = new Request("http://localhost", {
      headers: { "x-forwarded-for": "2001:db8::1" },
    });
    expect(getClientIdentifier(reqIpv6Single)).toBe("2001:db8::1");

    const reqIpv6RealIp = new Request("http://localhost", {
      headers: { "x-real-ip": "2001:db8::dead:beef" },
    });
    expect(getClientIdentifier(reqIpv6RealIp)).toBe("2001:db8::dead:beef");
  });

  it("ignores a forged leftmost XFF entry (spoof probe)", () => {
    // Tier 4 — the client controls the LEFTMOST XFF entries; a rotating
    // forged prefix must not mint fresh limiter buckets. The key is the
    // RIGHTMOST entry the trusted proxy appended.
    const reqForgedLeftmost = new Request("http://localhost", {
      headers: { "x-forwarded-for": "192.0.2.99, 198.51.100.4" },
    });
    expect(getClientIdentifier(reqForgedLeftmost)).toBe("198.51.100.4");
    expect(getClientIdentifier(reqForgedLeftmost)).not.toBe("192.0.2.99");

    // Distinct forged prefixes from the same true client still share ONE
    // bucket — the limiter key does not move with the forgery.
    const reqSameTrueClientForgedA = new Request("http://localhost", {
      headers: { "x-forwarded-for": "192.0.2.99, 198.51.100.4" },
    });
    const reqSameTrueClientForgedB = new Request("http://localhost", {
      headers: { "x-forwarded-for": "192.0.2.11, 192.0.2.12, 198.51.100.4" },
    });
    expect(getClientIdentifier(reqSameTrueClientForgedA)).toBe(getClientIdentifier(reqSameTrueClientForgedB));
  });

  it("stays pure under concurrent resolution", async () => {
    // Tier 3 — a parallel burst of resolutions returns the same answers
    // as sequential ones (no shared mutable state on the resolution path).
    const inputs = Array.from({ length: 50 }, (_, i) => {
      const forged = `192.0.2.${i + 100}`;
      return {
        request: new Request("http://localhost", {
          headers: { "x-forwarded-for": `${forged}, 198.51.100.${i + 200}` },
        }),
        expected: `198.51.100.${i + 200}`,
      };
    });
    const results = await Promise.all(inputs.map(input => Promise.resolve(getClientIdentifier(input.request))));
    for (const [index, result] of results.entries()) {
      expect(result).toBe(inputs[index]?.expected);
    }
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

describe("Auth Mutation Rate Limit Enforcement", () => {
  const stashedHarnessFlags: Record<string, string | undefined> = {};

  beforeEach(() => {
    stashedHarnessFlags.TEST_CI = process.env.TEST_CI;
    stashedHarnessFlags.TEST_SERVER = process.env.TEST_SERVER;
    // Enforcement must actually run in these tests regardless of how the
    // suite was launched — the harness-flag bypass is covered EXPLICITLY
    // (and its production guard) in dedicated tests below.
    delete process.env.TEST_CI;
    delete process.env.TEST_SERVER;
    clearRateLimitStore();
  });

  afterEach(() => {
    const envBag: Record<string, string | undefined> = process.env;
    for (const key of ["TEST_CI", "TEST_SERVER"]) {
      const stashed = stashedHarnessFlags[key];
      if (stashed === undefined) {
        delete envBag[key];
      } else {
        envBag[key] = stashed;
      }
    }
  });

  it("hashes auth identities as deterministic sha-256 over trimmed+lowercased email; empty stays empty", () => {
    // Determinism — same input, same digest, every call.
    expect(hashAuthIdentity("user@example.com")).toBe(hashAuthIdentity("user@example.com"));

    // Normalization collision: casing/whitespace variants share ONE bucket.
    expect(hashAuthIdentity("  User@Example.COM  ")).toBe(hashAuthIdentity("user@example.com"));

    // Empty (and whitespace-only) identities NEVER hash — "" is the
    // "no identity bucket" sentinel.
    expect(hashAuthIdentity("")).toBe("");
    expect(hashAuthIdentity("   ")).toBe("");

    // Unicode emails normalize deterministically and match node:crypto.
    const hashed = hashAuthIdentity("Ünïcode.Usér@Example.com");
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).toBe(hashAuthIdentity("ünïcode.usér@example.com"));
    expect(hashed).toBe(createHash("sha256").update("ünïcode.usér@example.com").digest("hex"));

    // Distinct identities digest to distinct buckets (no cross-collision).
    expect(hashAuthIdentity("user@example.com")).not.toBe(hashAuthIdentity("user@example.org"));
  });

  it("auth-ip bucket: 10th in-window call passes, 11th throws", async () => {
    const ip = "198.51.100.7";
    const passes = await drainSequentially(10, () =>
      enforceAuthMutationRateLimit({ clientIp: ip, identity: "" }, "en")
    );
    expect(passes).toHaveLength(10);
    const rejection = await expectEnforcementRejection(() =>
      enforceAuthMutationRateLimit({ clientIp: ip, identity: "" }, "en")
    );
    expect(rejection).toBeInstanceOf(RateLimitExceededError);
  });

  it("auth-identity bucket: 20th in-window call passes, 21st throws", async () => {
    const identity = hashAuthIdentity("identity-boundary@example.com");
    // Fresh IP per call so ONLY the identity bucket accumulates.
    const passes = await drainSequentially(20, index =>
      enforceAuthMutationRateLimit({ clientIp: `198.51.100.${index + 1}`, identity }, "en")
    );
    expect(passes).toHaveLength(20);
    const rejection = await expectEnforcementRejection(() =>
      enforceAuthMutationRateLimit({ clientIp: "198.51.100.250", identity }, "en")
    );
    expect(rejection).toBeInstanceOf(RateLimitExceededError);
  });

  it("different identity hashes get independent buckets", async () => {
    const identityA = hashAuthIdentity("alpha@example.com");
    const identityB = hashAuthIdentity("beta@example.com");
    await drainSequentially(20, index =>
      enforceAuthMutationRateLimit({ clientIp: `203.0.113.${index + 1}`, identity: identityA }, "en")
    );
    const rejection = await expectEnforcementRejection(() =>
      enforceAuthMutationRateLimit({ clientIp: "203.0.113.250", identity: identityA }, "en")
    );
    expect(rejection).toBeInstanceOf(RateLimitExceededError);

    // identityB is a separate bucket — its first call from a fresh IP passes.
    await enforceAuthMutationRateLimit({ clientIp: "203.0.113.251", identity: identityB }, "en");
  });

  it("the IP bucket is shared across identities", async () => {
    const sharedIp = "192.0.2.9";
    const identityA = hashAuthIdentity("gamma@example.com");
    const identityB = hashAuthIdentity("delta@example.com");
    // 10 calls from one IP (alternating identities) drain the SHARED IP bucket.
    const passes = await drainSequentially(5, async () => {
      await enforceAuthMutationRateLimit({ clientIp: sharedIp, identity: identityA }, "en");
      await enforceAuthMutationRateLimit({ clientIp: sharedIp, identity: identityB }, "en");
    });
    expect(passes).toHaveLength(5);
    // The 11th call from the same IP trips the IP bucket even with a FRESH identity.
    const rejection = await expectEnforcementRejection(() =>
      enforceAuthMutationRateLimit({ clientIp: sharedIp, identity: hashAuthIdentity("epsilon@example.com") }, "en")
    );
    expect(rejection).toBeInstanceOf(RateLimitExceededError);
  });

  it("never consumes the identity bucket when the IP bucket rejects (order proof)", async () => {
    const ip = "198.51.100.77";
    const identity = hashAuthIdentity("order-probe@example.com");
    // Pass-through spy (records, still calls the original) — every
    // checkRateLimit invocation reads its namespace key via Map.get.
    const mapGetSpy = jest.spyOn(Map.prototype, "get");
    try {
      await drainSequentially(10, () => enforceAuthMutationRateLimit({ clientIp: ip, identity }, "en"));
      // IP bucket at its cap — the next 11 calls reject on the IP check alone.
      const rejections = await drainSequentially(11, () =>
        expectEnforcementRejection(() => enforceAuthMutationRateLimit({ clientIp: ip, identity }, "en"))
      );
      for (const rejection of rejections) {
        expect(rejection).toBeInstanceOf(RateLimitExceededError);
      }
      // Invocation-count proof: the identity namespace was consulted exactly
      // 10 times — once per PASSING call. The IP rejections never reached it.
      const identityChecks = mapGetSpy.mock.calls
        .map(call => String(call[0]))
        .filter(key => key.startsWith("auth-identity:")).length;
      expect(identityChecks).toBe(10);

      // Behavioral proof: a fresh IP with the SAME identity passes — this is
      // identity call #11 (< 20). Had the 11 rejections consumed the bucket,
      // this would be call #22 and reject.
      await enforceAuthMutationRateLimit({ clientIp: "198.51.100.78", identity }, "en");
    } finally {
      mapGetSpy.mockRestore();
    }
  });

  it("covers every enforcement branch (ip-pass, identity-pass, ip-reject, identity-reject, empty-identity skip)", async () => {
    const sharedIp = "192.0.2.80";
    const identity = hashAuthIdentity("branch@example.com");

    // ip-pass + empty-identity skip: a no-identity call passes and never
    // touches the identity namespace.
    await enforceAuthMutationRateLimit({ clientIp: sharedIp, identity: "" }, "en");

    // ip-pass + identity-pass: a hashed-identity call consumes BOTH buckets.
    await enforceAuthMutationRateLimit({ clientIp: sharedIp, identity }, "en");

    // Drain the SHARED IP bucket to its cap (8 more calls, same IP).
    await drainSequentially(8, () => enforceAuthMutationRateLimit({ clientIp: sharedIp, identity }, "en"));

    // ip-reject: the IP check rejects even with a FRESH identity.
    const ipRejection = await expectEnforcementRejection(() =>
      enforceAuthMutationRateLimit(
        { clientIp: sharedIp, identity: hashAuthIdentity("fresh-identity@example.com") },
        "en"
      )
    );
    expect(ipRejection).toBeInstanceOf(RateLimitExceededError);

    // identity-reject: fresh IPs, one shared identity drained to its cap.
    const exhaustedIdentity = hashAuthIdentity("identity-reject@example.com");
    await drainSequentially(20, index =>
      enforceAuthMutationRateLimit({ clientIp: `203.0.113.${index + 1}`, identity: exhaustedIdentity }, "en")
    );
    const identityRejection = await expectEnforcementRejection(() =>
      enforceAuthMutationRateLimit({ clientIp: "203.0.113.250", identity: exhaustedIdentity }, "en")
    );
    expect(identityRejection).toBeInstanceOf(RateLimitExceededError);

    // empty-identity skip: 30 distinct-IP no-identity calls all pass — no
    // identity bucket exists for them to trip.
    const noIdentityPasses = await drainSequentially(30, index =>
      enforceAuthMutationRateLimit({ clientIp: `198.51.100.${index + 1}`, identity: "" }, "en")
    );
    expect(noIdentityPasses).toHaveLength(30);
  });

  it("throws the localized rate-limit message (en + ar)", async () => {
    const ip = "198.51.100.90";
    await drainSequentially(10, () => enforceAuthMutationRateLimit({ clientIp: ip, identity: "" }, "en"));
    const enRejection = await expectEnforcementRejection(() =>
      enforceAuthMutationRateLimit({ clientIp: ip, identity: "" }, "en")
    );
    expect(enRejection).toBeInstanceOf(RateLimitExceededError);
    expect(enRejection.message).toBe("Too many requests. Please try again later.");
    expect(enRejection.message).toBe(getServerTranslations("en").errorsTranslations.rateLimitExceeded);

    clearRateLimitStore();
    await drainSequentially(10, () => enforceAuthMutationRateLimit({ clientIp: ip, identity: "" }, "ar"));
    const arRejection = await expectEnforcementRejection(() =>
      enforceAuthMutationRateLimit({ clientIp: ip, identity: "" }, "ar")
    );
    expect(arRejection).toBeInstanceOf(RateLimitExceededError);
    expect(arRejection.message).toBe("طلبات كثيرة جداً. يرجى المحاولة لاحقاً.");
    expect(arRejection.message).toBe(getServerTranslations("ar").errorsTranslations.rateLimitExceeded);
  });

  it("concurrent burst of 11 same-IP calls: exactly 10 pass, 1 rejects (IP bucket)", async () => {
    const calls = Array.from({ length: 11 }, () =>
      enforceAuthMutationRateLimit({ clientIp: "192.0.2.44", identity: "" }, "en")
    );
    const results = await Promise.allSettled(calls);
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<void> => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled).toHaveLength(10);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(RateLimitExceededError);
  });

  it("concurrent burst of 21 same-identity calls: exactly 20 pass, 1 rejects (identity bucket)", async () => {
    const identity = hashAuthIdentity("concurrent@example.com");
    const calls = Array.from({ length: 21 }, (_, index) =>
      enforceAuthMutationRateLimit({ clientIp: `203.0.113.${index + 1}`, identity }, "en")
    );
    const results = await Promise.allSettled(calls);
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<void> => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled).toHaveLength(20);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(RateLimitExceededError);
  });

  it("window edge: every stored timestamp expiring frees the bucket at the window boundary", async () => {
    const ip = "203.0.113.99";
    let clock = 1_700_000_000_000;
    const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      await drainSequentially(10, () => enforceAuthMutationRateLimit({ clientIp: ip, identity: "" }, "en"));
      const windowRejection = await expectEnforcementRejection(() =>
        enforceAuthMutationRateLimit({ clientIp: ip, identity: "" }, "en")
      );
      expect(windowRejection).toBeInstanceOf(RateLimitExceededError);

      // Advance PAST the window — every stored timestamp is now expired.
      clock += authIpLimiter.windowMs + 1;
      // Fresh window — the call passes again.
      await enforceAuthMutationRateLimit({ clientIp: ip, identity: "" }, "en");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("stores identity buckets as auth-identity:<64-hex> keys — never plaintext", async () => {
    const plaintext = "key-format-probe@example.com";
    const identity = hashAuthIdentity(plaintext);
    const mapSetSpy = jest.spyOn(Map.prototype, "set");
    try {
      await enforceAuthMutationRateLimit({ clientIp: "192.0.2.60", identity }, "en");
      const authKeys = mapSetSpy.mock.calls.map(call => String(call[0])).filter(key => key.startsWith("auth-"));
      expect(authKeys).toContain(`auth-identity:${identity}`);
      expect(authKeys).toContain("auth-ip:192.0.2.60");
      expect(`auth-identity:${identity}`).toMatch(/^auth-identity:[0-9a-f]{64}$/);
      // No key anywhere in the auth namespaces carries email-shaped material.
      expect(authKeys.join()).not.toContain(plaintext);
      expect(authKeys.join()).not.toContain("@");
    } finally {
      mapSetSpy.mockRestore();
    }
  });

  it("never logs the plaintext identity (or its digest) on rejection", async () => {
    const plaintext = "secret-plaintext-probe@example.com";
    const identity = hashAuthIdentity(plaintext);
    // Pass-through spies — record stream writes, still forward them.
    const stdoutSpy = jest.spyOn(process.stdout, "write");
    const stderrSpy = jest.spyOn(process.stderr, "write");
    try {
      const ip = "192.0.2.55";
      await drainSequentially(10, () => enforceAuthMutationRateLimit({ clientIp: ip, identity }, "en"));
      const logProbeRejection = await expectEnforcementRejection(() =>
        enforceAuthMutationRateLimit({ clientIp: ip, identity }, "en")
      );
      expect(logProbeRejection).toBeInstanceOf(RateLimitExceededError);
      const writes = [...stdoutSpy.mock.calls, ...stderrSpy.mock.calls].map(call => String(call[0]));
      // The rejection WAS logged (limiter name + IP only)…
      expect(writes.join()).toContain("auth-ip");
      expect(writes.join()).toContain(ip);
      // …but never with the plaintext identity, its digest, or any email-shaped material.
      expect(writes.join()).not.toContain(plaintext);
      expect(writes.join()).not.toContain("secret-plaintext-probe");
      expect(writes.join()).not.toContain(identity);
      expect(writes.join()).not.toContain("@");
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }
  });

  it("preserves the fail-open posture when limiter-state operations fail", async () => {
    // Installed BEFORE the throwing Map.set spy — spying itself must not
    // trip the synthetic failure.
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const mapSetSpy = jest.spyOn(Map.prototype, "set").mockImplementation(() => {
      const failure = new Error("synthetic limiter-state failure");
      failure.name = "SyntheticLimiterStateFailure";
      throw failure;
    });
    let ipResult: RateLimitResult | undefined;
    let enforcementThrew = false;
    // Captured BEFORE mockRestore — restoring the spy clears its calls.
    let warns = "";
    try {
      // checkRateLimit swallows the state failure and fail-opens…
      ipResult = await checkRateLimit("198.51.100.130", authIpLimiter);
      // …and the enforcement helper inherits the posture via delegation —
      // a legitimate auth attempt must NOT be blocked by a transient failure.
      await enforceAuthMutationRateLimit(
        { clientIp: "198.51.100.130", identity: hashAuthIdentity("user@example.com") },
        "en"
      );
      warns = warnSpy.mock.calls.map(call => call.join(" ")).join();
    } catch {
      enforcementThrew = true;
    } finally {
      mapSetSpy.mockRestore();
      warnSpy.mockRestore();
    }
    expect(ipResult?.success).toBe(true);
    expect(enforcementThrew).toBe(false);
    // The fail-open was WARNED, not silent — one warn per fail-open site,
    // each carrying the limiter name + error NAME only (never the message
    // content or stack, which could leak internal state into logs).
    expect(warns).toContain("auth-ip");
    expect(warns).toContain("auth-identity");
    expect(warns).toContain("SyntheticLimiterStateFailure");
    expect(warns).not.toContain("synthetic limiter-state failure");
  });

  it("skips enforcement entirely under the test-harness flags without consuming limiter state", async () => {
    const ip = "198.51.100.140";
    process.env.TEST_CI = "1";
    try {
      // Far beyond both caps — the bypass skips enforcement entirely.
      await drainSequentially(50, () =>
        enforceAuthMutationRateLimit({ clientIp: ip, identity: hashAuthIdentity("bypass@example.com") }, "en")
      );
    } finally {
      delete process.env.TEST_CI;
    }
    process.env.TEST_SERVER = "1";
    try {
      await drainSequentially(50, () =>
        enforceAuthMutationRateLimit({ clientIp: ip, identity: hashAuthIdentity("bypass@example.com") }, "en")
      );
    } finally {
      delete process.env.TEST_SERVER;
    }
    // The bypass consumed NO limiter state — the same IP still has a full bucket.
    await drainSequentially(10, () => enforceAuthMutationRateLimit({ clientIp: ip, identity: "" }, "en"));
    const postBypassRejection = await expectEnforcementRejection(() =>
      enforceAuthMutationRateLimit({ clientIp: ip, identity: "" }, "en")
    );
    expect(postBypassRejection).toBeInstanceOf(RateLimitExceededError);
  });

  it("refuses the bypass when the harness flags leak into production (guard throw)", async () => {
    const envBag: Record<string, string | undefined> = process.env;
    const previousNodeEnv = process.env.NODE_ENV;
    const previousIsDemo = process.env.IS_DEMO;
    envBag.TEST_CI = "1";
    delete envBag.IS_DEMO;
    try {
      envBag.NODE_ENV = "production";
      // The bypass is UNREACHABLE in production — a leaked flag fails fast.
      const guardRejection = await expectEnforcementRejection(() =>
        enforceAuthMutationRateLimit({ clientIp: "198.51.100.141", identity: "" }, "en")
      );
      expect(guardRejection.message).toContain(
        "TEST_CI/TEST_SERVER rate-limit bypass is forbidden outside the test harness"
      );

      // The sanctioned demo server (IS_DEMO) is the one production-NODE_ENV
      // consumer allowed to bypass.
      envBag.IS_DEMO = "1";
      await enforceAuthMutationRateLimit({ clientIp: "198.51.100.141", identity: "" }, "en");
    } finally {
      envBag.NODE_ENV = previousNodeEnv;
      if (previousIsDemo === undefined) {
        delete envBag.IS_DEMO;
      } else {
        envBag.IS_DEMO = previousIsDemo;
      }
      delete envBag.TEST_CI;
    }
  });
});
