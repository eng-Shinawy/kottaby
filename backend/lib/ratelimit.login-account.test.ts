/**
 * Account-keyed login lockout tier — unit suite for `loginAccountLimiter`
 * (lazy env-resolved factory), `enforceLoginAccountRateLimit`, and the
 * single-sourced `isRateLimitTestBypass` harness predicate.
 *
 * Harness-bypass handling mirrors `ratelimit.test.ts`: the enforcement
 * helper skips its bucket when `TEST_CI=1`/`TEST_SERVER=1` (`.env.test`
 * sets both), so this suite stashes + deletes the flags in `beforeEach` and
 * restores them in `afterEach`; limiter state resets per test via
 * `clearRateLimitStore()`. Env-mutating legs additionally stash + delete
 * `LOGIN_RATE_LIMIT_MAX`/`LOGIN_RATE_LIMIT_WINDOW_MS` and call
 * `resetEnvironmentCache()` (backend/lib/env.ts) around every read, so the
 * lazily-resolved defaults are observable regardless of launch mode.
 *
 * Coverage map (4-tier):
 *  - Tier 1 (limiter logic): factory defaults (5 / 15 min, name `login`);
 *    enforcement pass-under-limit / throw-over-limit; localized message.
 *  - Tier 2 (boundaries): 5th in-window attempt passes, 6th throws;
 *    window expiry frees the bucket at the 15-minute boundary;
 *    env-override observability through `resetEnvironmentCache()`.
 *  - Tier 3 (bursts / interleaving): 6-way concurrent burst admits exactly
 *    5; interleaved distinct accounts never cross-contaminate.
 *  - Tier 4 (abuse): casing/whitespace variants of one email share ONE
 *    bucket; absent identities never mint a bucket; account keys are
 *    digests — plaintext email never reaches limiter keys; the harness
 *    bypass is honored without consuming state and refuses to run in
 *    production without `IS_DEMO=1`; fail-open posture inherited from
 *    `checkRateLimit` on transient limiter-state failures.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "bun:test";
import { resetEnvironmentCache } from "@/backend/lib/env";
import { RateLimitExceededError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import {
  clearRateLimitStore,
  enforceLoginAccountRateLimit,
  hashAuthIdentity,
  isRateLimitTestBypass,
  loginAccountLimiter,
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

/** The env keys this suite mutates (stashed/restored around every test). */
const MUTATED_ENV_KEYS = ["TEST_CI", "TEST_SERVER", "LOGIN_RATE_LIMIT_MAX", "LOGIN_RATE_LIMIT_WINDOW_MS"] as const;

describe("Login Account Rate Limiter (account-keyed tier)", () => {
  const stashedEnv: Record<string, string | undefined> = {};
  let domainLogSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    for (const key of MUTATED_ENV_KEYS) {
      stashedEnv[key] = process.env[key];
      delete process.env[key];
    }
    // The lazily-resolved defaults must hold for every leg unless a test
    // mutates the env explicitly — invalidate any snapshot built earlier.
    resetEnvironmentCache();
    clearRateLimitStore();
  });

  afterEach(() => {
    const envBag: Record<string, string | undefined> = process.env;
    for (const key of MUTATED_ENV_KEYS) {
      const stashed = stashedEnv[key];
      if (stashed === undefined) {
        delete envBag[key];
      } else {
        envBag[key] = stashed;
      }
    }
    resetEnvironmentCache();
  });

  beforeAll(() => {
    // Exhaustion logs a domain error — silence it so the captured suite
    // output stays compact (the rejection itself is the assertion).
    domainLogSpy = jest.spyOn(logger, "logDomainError").mockImplementation(() => {});
  });

  afterAll(() => {
    domainLogSpy.mockRestore();
  });

  it("loginAccountLimiter: default 5 attempts / 15-minute window, name `login`", () => {
    // Tier 1 — the factory's no-env resolution (REQ-006 lockout pin).
    expect(loginAccountLimiter()).toEqual({ name: "login", limit: 5, windowMs: 900_000 });
  });

  it("env-override leg: the lazy factory picks up a mutated limit only after resetEnvironmentCache()", () => {
    // Tier 2 — lazy per-check resolution is OBSERVABLE: the env-cached
    // snapshot predates the mutation, so the factory keeps serving the
    // cached default until the cache is invalidated.
    expect(loginAccountLimiter().limit).toBe(5);
    process.env.LOGIN_RATE_LIMIT_MAX = "2";
    expect(loginAccountLimiter().limit).toBe(5);
    resetEnvironmentCache();
    expect(loginAccountLimiter().limit).toBe(2);
    expect(loginAccountLimiter().windowMs).toBe(900_000);

    process.env.LOGIN_RATE_LIMIT_WINDOW_MS = "60000";
    resetEnvironmentCache();
    expect(loginAccountLimiter()).toEqual({ name: "login", limit: 2, windowMs: 60_000 });

    // Non-numeric / zero / negative values fall back to the defaults
    // (parsePositiveIntegerEnv discipline — a bad operator value can
    // neither disable the tier nor hyper-tighten it).
    process.env.LOGIN_RATE_LIMIT_MAX = "0";
    resetEnvironmentCache();
    expect(loginAccountLimiter().limit).toBe(5);
  });

  it("5th in-window attempt passes, 6th throws (default threshold)", async () => {
    // Tier 2 — off-by-one boundary at the documented default.
    const email = "account-tier@example.com";
    const passes = await drainSequentially(5, () => enforceLoginAccountRateLimit(email, "en"));
    expect(passes).toHaveLength(5);
    const rejection = await expectEnforcementRejection(() => enforceLoginAccountRateLimit(email, "en"));
    expect(rejection).toBeInstanceOf(RateLimitExceededError);
  });

  it("window expiry: every stored timestamp expiring frees the bucket at the 15-minute boundary", async () => {
    // Tier 2 — the lockout is a sliding window, not a permanent lock.
    const email = "window-edge@example.com";
    let clock = 1_700_000_000_000;
    const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      await drainSequentially(5, () => enforceLoginAccountRateLimit(email, "en"));
      const rejection = await expectEnforcementRejection(() => enforceLoginAccountRateLimit(email, "en"));
      expect(rejection).toBeInstanceOf(RateLimitExceededError);

      // Advance PAST the window — every stored timestamp is now expired.
      clock += loginAccountLimiter().windowMs + 1;
      await enforceLoginAccountRateLimit(email, "en");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("casing/whitespace variants of one email share ONE account bucket", async () => {
    // Tier 4 — key normalization: `Foo@X.com` and `foo@x.com` collapse onto
    // the same account, so casing tricks cannot mint fresh lockout buckets.
    const variants = ["Foo@X.com", "foo@x.com", "  FOO@x.COM  ", "\tfoo@X.com\t", "Foo@x.com"];
    const passes = await drainSequentially(5, index => enforceLoginAccountRateLimit(variants[index] ?? "", "en"));
    expect(passes).toHaveLength(5);
    const rejection = await expectEnforcementRejection(() => enforceLoginAccountRateLimit(" foo@x.com ", "en"));
    expect(rejection).toBeInstanceOf(RateLimitExceededError);
  });

  it("distinct accounts get independent buckets — no cross-account lockout amplification", async () => {
    // Tier 4 / SEC: exhausting one account must never lock a bystander.
    const victim = "victim@example.com";
    await drainSequentially(5, () => enforceLoginAccountRateLimit(victim, "en"));
    const rejection = await expectEnforcementRejection(() => enforceLoginAccountRateLimit(victim, "en"));
    expect(rejection).toBeInstanceOf(RateLimitExceededError);
    await enforceLoginAccountRateLimit("bystander@example.com", "en");
    await enforceLoginAccountRateLimit("another-bystander@example.com", "en");
  });

  it("interleaved accounts never cross-contaminate", async () => {
    // Tier 3 — alternating drains of two accounts stay in their own buckets.
    const alpha = "interleaved-alpha@example.com";
    const beta = "interleaved-beta@example.com";
    await drainSequentially(5, () => enforceLoginAccountRateLimit(alpha, "en"));
    await enforceLoginAccountRateLimit(beta, "en");
    const rejection = await expectEnforcementRejection(() => enforceLoginAccountRateLimit(alpha, "en"));
    expect(rejection).toBeInstanceOf(RateLimitExceededError);
    // beta has consumed exactly ONE attempt — four more pass.
    const betaPasses = await drainSequentially(4, () => enforceLoginAccountRateLimit(beta, "en"));
    expect(betaPasses).toHaveLength(4);
  });

  it("concurrent burst of 6 same-account calls: exactly 5 pass, 1 rejects", async () => {
    // Tier 3 — event-loop atomicity of the check-then-throw sequence.
    const email = "burst@example.com";
    const calls = Array.from({ length: 6 }, () => enforceLoginAccountRateLimit(email, "en"));
    const results = await Promise.allSettled(calls);
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<void> => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled).toHaveLength(5);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(RateLimitExceededError);
  });

  it("absent identities (empty / whitespace-only email) never mint an account bucket", async () => {
    // Tier 4 — the "" no-identity sentinel: the pre-service empty-email
    // denial owns those calls; the account tier must not key them.
    const passes = await drainSequentially(50, index =>
      enforceLoginAccountRateLimit(index % 2 === 0 ? "" : "   ", "en")
    );
    expect(passes).toHaveLength(50);
  });

  it("stores account buckets as login:<64-hex> keys — never plaintext", async () => {
    // Tier 4 — the digest is the only identity form stored (the module
    // contract `hashAuthIdentity` documents); plaintext email or any
    // email-shaped material never reaches limiter keys.
    const plaintext = "key-format-probe@example.com";
    const digest = hashAuthIdentity(plaintext);
    const mapSetSpy = jest.spyOn(Map.prototype, "set");
    try {
      await enforceLoginAccountRateLimit(plaintext, "en");
      const loginKeys = mapSetSpy.mock.calls.map(call => String(call[0])).filter(key => key.startsWith("login:"));
      expect(loginKeys).toContain(`login:${digest}`);
      expect(`login:${digest}`).toMatch(/^login:[0-9a-f]{64}$/);
      expect(loginKeys.join()).not.toContain(plaintext);
      expect(loginKeys.join()).not.toContain("@");
    } finally {
      mapSetSpy.mockRestore();
    }
  });

  it("throws the localized rate-limit message (en + ar)", async () => {
    const email = "localized@example.com";
    await drainSequentially(5, () => enforceLoginAccountRateLimit(email, "en"));
    const enRejection = await expectEnforcementRejection(() => enforceLoginAccountRateLimit(email, "en"));
    expect(enRejection).toBeInstanceOf(RateLimitExceededError);
    expect(enRejection.message).toBe(getServerTranslations("en").errorsTranslations.rateLimitExceeded);

    clearRateLimitStore();
    await drainSequentially(5, () => enforceLoginAccountRateLimit(email, "ar"));
    const arRejection = await expectEnforcementRejection(() => enforceLoginAccountRateLimit(email, "ar"));
    expect(arRejection).toBeInstanceOf(RateLimitExceededError);
    expect(arRejection.message).toBe(getServerTranslations("ar").errorsTranslations.rateLimitExceeded);
  });

  it("isRateLimitTestBypass: false unset, true under each harness flag, refused in production without IS_DEMO", async () => {
    // Tier 4 — the single-sourced bypass predicate's full truth table.
    expect(isRateLimitTestBypass()).toBe(false);

    process.env.TEST_CI = "1";
    expect(isRateLimitTestBypass()).toBe(true);
    delete process.env.TEST_CI;

    process.env.TEST_SERVER = "1";
    expect(isRateLimitTestBypass()).toBe(true);
    delete process.env.TEST_SERVER;

    const previousNodeEnv = process.env.NODE_ENV;
    const previousIsDemo = process.env.IS_DEMO;
    const envBag: Record<string, string | undefined> = process.env;
    envBag.TEST_CI = "1";
    delete envBag.IS_DEMO;
    try {
      envBag.NODE_ENV = "production";
      // The bypass is UNREACHABLE in production — a leaked flag fails fast.
      const guardRejection = await expectEnforcementRejection(() => Promise.resolve(isRateLimitTestBypass()));
      expect(guardRejection.message).toContain(
        "TEST_CI/TEST_SERVER rate-limit bypass is forbidden outside the test harness"
      );

      // The sanctioned demo server (IS_DEMO) is the one production-NODE_ENV
      // consumer allowed to bypass.
      envBag.IS_DEMO = "1";
      expect(isRateLimitTestBypass()).toBe(true);
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

  it("honors the harness bypass without consuming limiter state", async () => {
    // Tier 4 — under the harness flags the tier skips enforcement
    // entirely; the account bucket stays untouched.
    const email = "bypass@example.com";
    process.env.TEST_CI = "1";
    try {
      await drainSequentially(50, () => enforceLoginAccountRateLimit(email, "en"));
    } finally {
      delete process.env.TEST_CI;
    }
    // The bypass consumed NO limiter state — the account still has a full bucket.
    const passes = await drainSequentially(5, () => enforceLoginAccountRateLimit(email, "en"));
    expect(passes).toHaveLength(5);
    const rejection = await expectEnforcementRejection(() => enforceLoginAccountRateLimit(email, "en"));
    expect(rejection).toBeInstanceOf(RateLimitExceededError);
  });

  it("preserves the fail-open posture when limiter-state operations fail", async () => {
    // Tier 4 — a transient limiter failure must not block a legitimate
    // login; the fail-open stays observable (warn, limiter name + error
    // NAME only — never message content or stack).
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
    const mapSetSpy = jest.spyOn(Map.prototype, "set").mockImplementation(() => {
      const failure = new Error("synthetic account-tier failure");
      failure.name = "SyntheticAccountTierFailure";
      throw failure;
    });
    let enforcementThrew = false;
    // Captured BEFORE mockRestore — restoring the spy clears its calls.
    let warns = "";
    try {
      await enforceLoginAccountRateLimit("fail-open@example.com", "en");
      warns = warnSpy.mock.calls.map(call => call.join(" ")).join();
    } catch {
      enforcementThrew = true;
    } finally {
      mapSetSpy.mockRestore();
      warnSpy.mockRestore();
    }
    expect(enforcementThrew).toBe(false);
    expect(warns).toContain("login");
    expect(warns).toContain("SyntheticAccountTierFailure");
    expect(warns).not.toContain("synthetic account-tier failure");
  });
});
