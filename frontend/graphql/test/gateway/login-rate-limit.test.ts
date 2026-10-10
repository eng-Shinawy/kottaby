/**
 * Account-keyed login lockout tier — the BUILT-schema in-process wire pin
 * for `enforceLoginAccountRateLimit` (REQ-006 failed-login lockout).
 *
 * The `gateway/` layer deliberately imports the production schema
 * in-process (`graphQLSchema` from `@/backend/graphql/gqlSchema`) and does
 * NOT spin up a live server (the `frontend/graphql/test/AGENTS.md`
 * gateway/ convention). Resolvers are anonymous side-effect registrations
 * and cannot be invoked directly, so every probe executes the real schema
 * via `graphql({ schema: graphQLSchema, ... })` with a hand-built anonymous
 * `Context` — the in-process precedent of the auth-mutation rate-limit
 * suite (`backend/graphql/test/auth-rate-limit.test.ts`) and
 * `schema-surface.test.ts`.
 *
 * Harness-bypass handling: the enforcement helper skips its bucket when
 * `TEST_CI=1`/`TEST_SERVER=1` (`.env.test` sets both), and both flags plus
 * the `LOGIN_RATE_LIMIT_*` overrides are stashed + deleted in `beforeEach`
 * (restored in `afterEach`, with `resetEnvironmentCache()` around every
 * config read) so the account tier is observable regardless of launch
 * mode. Limiter state resets per test via `clearRateLimitStore()`.
 *
 * Tier isolation on every probe: each call runs from a DISTINCT
 * documentation-range IP, so the resolver's per-IP and per-identity tiers
 * stay far below their caps (10/60 s and 20/60 s) — a `RATE_LIMIT_EXCEEDED`
 * on these probes can ONLY come from the account tier (5 / 15 min default,
 * env-tunable via `LOGIN_RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_WINDOW_MS`).
 *
 * Coverage map:
 *  - Default threshold on the wire: 5 in-window attempts reach the service
 *    (UNAUTHORIZED — nonexistent credentials), the 6th answers
 *    `RATE_LIMIT_EXCEEDED` with the localized message. The code distinction
 *    IS the ordering proof that enforcement runs BEFORE any credential
 *    work (zero spies on the enforcement path).
 *  - Env-configurability: a mutated `LOGIN_RATE_LIMIT_MAX` (+
 *    `resetEnvironmentCache()`) re-tightens the cap on the very next burst.
 *  - Window reset: advancing past the 15-minute window frees the bucket.
 *  - Key normalization: casing/whitespace variants of one email share ONE
 *    account bucket; distinct accounts are isolated (no cross-account
 *    lockout amplification).
 *  - Scoping: `registerUser` never consumes a login account bucket; the
 *    harness bypass is honored (flags set ⇒ the tier never enforces — the
 *    same pin the dev-server auth battery holds by staying green under
 *    `TEST_SERVER=1`).
 *
 * DB posture: every login probe uses a NONEXISTENT email (the identity
 * read is a fast miss → generic UNAUTHORIZED, no bcrypt cost); register
 * probes use a 7-char password so the service rejects at validation BEFORE
 * any hash or DB write. The suite performs ZERO writes.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type ExecutionResult, graphql } from "graphql";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { resetEnvironmentCache } from "@/backend/lib/env";
import { logger } from "@/backend/lib/logger";
import { clearRateLimitStore, loginAccountLimiter } from "@/backend/lib/ratelimit";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { Translations } from "@/shared/locale/types/message";

/** English localized copy — exact-message assertions resolve through the live source. */
const EN_ERRORS = getServerTranslations("en").errorsTranslations;

const LOGIN_DOCUMENT = `
  mutation Login($email: String!, $password: String!) {
    login(email: $email, password: $password) { accessToken }
  }
`;

const REGISTER_DOCUMENT = `
  mutation Register($input: RegisterUserInput!) {
    registerUser(input: $input) { id }
  }
`;

/** 7-char password — below the registration minimum, so the service rejects at validation (zero DB writes). */
const SHORT_REGISTRATION_PASSWORD = "Short1!";

/** Anonymous per-probe context — public mutations need no verified user. */
function anonymousContext(clientIp: string): Context {
  return {
    locale: "en",
    t: async <K extends keyof Translations>(ns: K) => getServerTranslations("en")[ns],
    requestId: "req-login-rate-limit-test",
    user: null,
    safeUser: null,
    permissions: [],
    isSuperAdmin: false,
    role: null,
    cookies: {},
    authCookieOut: [],
    clientIp,
  };
}

/** A nonexistent email — the login identity read is a fast miss (no bcrypt cost). */
function nonexistentEmail(): string {
  return `no-such-user-${randomUUID()}@test.invalid`;
}

/** Distinct test IPs from the RFC-5737 documentation range (1-based index). */
function distinctDocIp(index: number): string {
  return `198.51.100.${index}`;
}

async function runLogin(email: string, password: string, clientIp: string): Promise<ExecutionResult> {
  return graphql({
    schema: graphQLSchema,
    source: LOGIN_DOCUMENT,
    variableValues: { email, password },
    contextValue: anonymousContext(clientIp),
  });
}

/** Register input shape: valid everywhere EXCEPT the too-short password (service rejects at validation). */
function shortPasswordRegistrationInput(email: string) {
  return {
    fullName: "Login Rate Probe",
    email,
    phone: "+10000000000",
    password: SHORT_REGISTRATION_PASSWORD,
    country: "EG",
    // Pothos enum wire values are the TS member names (`Student`), not the
    // pgEnum string values.
    role: "Student",
  };
}

async function runRegister(email: string, clientIp: string): Promise<ExecutionResult> {
  return graphql({
    schema: graphQLSchema,
    source: REGISTER_DOCUMENT,
    variableValues: { input: shortPasswordRegistrationInput(email) },
    contextValue: anonymousContext(clientIp),
  });
}

/** First error code — the single-error probes assert on it directly. */
function firstErrorCodeOf(result: ExecutionResult): string {
  const [first] = (result.errors ?? []).map(error => {
    const code: unknown = error.extensions?.code;
    return typeof code === "string" ? code : "";
  });
  if (!first) {
    throw new Error(`expected exactly one error, got ${result.errors?.length ?? 0} (or none carried a code)`);
  }
  return first;
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

describe("Login account rate limiting (built schema, in-process)", () => {
  const stashedEnv: Record<string, string | undefined> = {};
  let domainLogSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // The enforcement helper reads these flags at CALL time — clearing them
    // here makes the account tier observable regardless of how the suite
    // was launched (`.env.test` sets both flags for the shared harness).
    // The LOGIN_RATE_LIMIT_* keys are cleared defensively so the DEFAULT
    // thresholds hold unless a leg mutates them explicitly.
    for (const key of ["TEST_CI", "TEST_SERVER", "LOGIN_RATE_LIMIT_MAX", "LOGIN_RATE_LIMIT_WINDOW_MS"]) {
      stashedEnv[key] = process.env[key];
      delete process.env[key];
    }
    resetEnvironmentCache();
    clearRateLimitStore();
  });

  afterEach(() => {
    const envBag: Record<string, string | undefined> = process.env;
    for (const key of ["TEST_CI", "TEST_SERVER", "LOGIN_RATE_LIMIT_MAX", "LOGIN_RATE_LIMIT_WINDOW_MS"]) {
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
    // Every exhausted account logs a domain error — silence them so the
    // captured suite output stays compact (the rejection paths themselves
    // are the assertions, not the logs).
    domainLogSpy = spyOn(logger, "logDomainError").mockImplementation(() => {});
  });

  afterAll(() => {
    domainLogSpy?.mockRestore();
  });

  test("default threshold on the wire: 5 in-window attempts reach the service, the 6th answers RATE_LIMIT_EXCEEDED", async () => {
    const email = nonexistentEmail();
    // 5 attempts, each from a DISTINCT IP: the per-IP and per-identity
    // tiers stay at 1 and 5 of their caps — only the account tier sees 5.
    const drained = await drainSequentially(5, index => runLogin(email, "AnyPassword1!", distinctDocIp(index + 1)));
    for (const result of drained) {
      // The service ran (nonexistent identity → generic UNAUTHORIZED).
      expect(firstErrorCodeOf(result)).toBe("UNAUTHORIZED");
    }
    // Attempt #6 with a FRESH IP: had the service run first it would answer
    // UNAUTHORIZED — RATE_LIMIT_EXCEEDED is only reachable if the account
    // tier rejects before any credential work. The code distinction IS the
    // ordering proof (zero spies on the enforcement path).
    const rejected = await runLogin(email, "AnyPassword1!", "198.51.100.250");
    expect(firstErrorCodeOf(rejected)).toBe("RATE_LIMIT_EXCEEDED");
    expect(rejected.errors?.[0]?.message).toBe(EN_ERRORS.rateLimitExceeded);
  });

  test("env-configurability: a mutated LOGIN_RATE_LIMIT_MAX (+ resetEnvironmentCache) re-tightens the cap on the next burst", async () => {
    process.env.LOGIN_RATE_LIMIT_MAX = "2";
    resetEnvironmentCache();
    try {
      const email = nonexistentEmail();
      const drained = await drainSequentially(2, index => runLogin(email, "AnyPassword1!", distinctDocIp(index + 1)));
      for (const result of drained) {
        expect(firstErrorCodeOf(result)).toBe("UNAUTHORIZED");
      }
      const rejected = await runLogin(email, "AnyPassword1!", "198.51.100.250");
      expect(firstErrorCodeOf(rejected)).toBe("RATE_LIMIT_EXCEEDED");
    } finally {
      delete process.env.LOGIN_RATE_LIMIT_MAX;
      resetEnvironmentCache();
    }
  });

  test("window reset: advancing past the 15-minute window frees the account bucket", async () => {
    const email = nonexistentEmail();
    let clock = 1_700_000_000_000;
    const nowSpy = spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const drained = await drainSequentially(5, index => runLogin(email, "AnyPassword1!", distinctDocIp(index + 1)));
      for (const result of drained) {
        expect(firstErrorCodeOf(result)).toBe("UNAUTHORIZED");
      }
      const rejected = await runLogin(email, "AnyPassword1!", "198.51.100.250");
      expect(firstErrorCodeOf(rejected)).toBe("RATE_LIMIT_EXCEEDED");

      // Advance PAST the window — every stored timestamp is now expired and
      // the account bucket starts fresh.
      clock += loginAccountLimiter().windowMs + 1;
      const fresh = await runLogin(email, "AnyPassword1!", "198.51.100.251");
      expect(firstErrorCodeOf(fresh)).toBe("UNAUTHORIZED");
    } finally {
      nowSpy.mockRestore();
    }
  });

  test("casing/whitespace variants of one email share ONE account bucket", async () => {
    // All four variants trim+lowercase onto the same account identity.
    const variants = [
      "Account.Bücket@Example.INVALID",
      "  account.bücket@example.invalid  ",
      "ACCOUNT.BÜCKET@EXAMPLE.INVALID",
      "\taccount.bücket@example.invalid\t",
      "Account.Bücket@Example.INVALID",
    ];
    const drained = await drainSequentially(5, index =>
      runLogin(variants[index] ?? "", "AnyPassword1!", distinctDocIp(index + 1))
    );
    for (const result of drained) {
      expect(firstErrorCodeOf(result)).toBe("UNAUTHORIZED");
    }
    // Attempt #6 with a fresh variant + fresh IP: only the SHARED account
    // bucket can reject it.
    const rejected = await runLogin(" account.BÜCKET@example.invalid ", "AnyPassword1!", "198.51.100.250");
    expect(firstErrorCodeOf(rejected)).toBe("RATE_LIMIT_EXCEEDED");
  });

  test("distinct accounts are isolated — exhausting one never locks another", async () => {
    const victim = nonexistentEmail();
    const drained = await drainSequentially(5, index => runLogin(victim, "AnyPassword1!", distinctDocIp(index + 1)));
    for (const result of drained) {
      expect(firstErrorCodeOf(result)).toBe("UNAUTHORIZED");
    }
    const rejected = await runLogin(victim, "AnyPassword1!", "198.51.100.250");
    expect(firstErrorCodeOf(rejected)).toBe("RATE_LIMIT_EXCEEDED");

    // A DIFFERENT account is unaffected — no cross-account lockout
    // amplification.
    const bystander = await runLogin(nonexistentEmail(), "AnyPassword1!", "198.51.100.251");
    expect(firstErrorCodeOf(bystander)).toBe("UNAUTHORIZED");
  });

  test("registerUser never consumes a login account bucket (login-only scoping)", async () => {
    const email = nonexistentEmail();
    // 5 register probes pass the limiter and reject at the service (short
    // password → VALIDATION, zero DB writes).
    const drained = await drainSequentially(5, index => runRegister(email, distinctDocIp(index + 1)));
    for (const result of drained) {
      expect(firstErrorCodeOf(result)).toBe("VALIDATION");
    }
    // The login account tier still has a FULL bucket for this email.
    const login = await runLogin(email, "AnyPassword1!", "198.51.100.250");
    expect(firstErrorCodeOf(login)).toBe("UNAUTHORIZED");

    // Exhaust the LOGIN account bucket for this email…
    await drainSequentially(4, index => runLogin(email, "AnyPassword1!", distinctDocIp(index + 40)));
    const loginRejected = await runLogin(email, "AnyPassword1!", "198.51.100.251");
    expect(firstErrorCodeOf(loginRejected)).toBe("RATE_LIMIT_EXCEEDED");

    // …and a register probe from a fresh IP still sails through the
    // limiter (its per-identity bucket is at 5 of 20) — the account tier
    // is scoped to login only.
    const registerAfter = await runRegister(email, "198.51.100.252");
    expect(firstErrorCodeOf(registerAfter)).toBe("VALIDATION");
  });

  test("the harness bypass is honored: with the flags set the account tier never enforces", async () => {
    const email = nonexistentEmail();
    process.env.TEST_CI = "1";
    try {
      // Far beyond the account cap — the bypass skips enforcement entirely
      // and every attempt reaches the service.
      const drained = await drainSequentially(10, index => runLogin(email, "AnyPassword1!", distinctDocIp(index + 1)));
      for (const result of drained) {
        expect(firstErrorCodeOf(result)).toBe("UNAUTHORIZED");
      }
    } finally {
      delete process.env.TEST_CI;
    }
  });
});
