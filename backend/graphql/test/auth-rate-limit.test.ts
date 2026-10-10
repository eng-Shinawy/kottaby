/**
 * Auth-mutation rate-limit enforcement suite — the BUILT-schema in-process
 * tier for the resolver-level wiring of `enforceAuthMutationRateLimit`
 * (`login`, `registerUser`, `refreshToken`) plus the login resolver's
 * pre-service normalization.
 *
 * Resolvers are anonymous side-effect registrations and CANNOT be invoked
 * directly (`backend/graphql/mutation/AGENTS.md`), so every probe executes
 * the real production schema in-process via `graphql({ schema:
 * graphQLSchema, ... })` with a hand-built anonymous `Context` carrying a
 * per-probe `clientIp` (the in-process precedent of
 * `schema-surface.test.ts` / `plan-catalog.roles.test.ts`).
 *
 * Harness-bypass handling: the enforcement helper skips its buckets when
 * `TEST_CI=1` or `TEST_SERVER=1` (mirroring the transport tier), and the
 * test runner loads `.env.test` which sets BOTH — but the bypass reads
 * `process.env` at CALL time, so this suite deletes the two flags in
 * `beforeEach` (stashing the prior values) and restores them in
 * `afterEach`, making enforcement observable regardless of launch mode.
 * Limiter state is reset per test via `clearRateLimitStore()`.
 *
 * Account-tier isolation: `login` ALSO layers the account-keyed lockout
 * tier (`enforceLoginAccountRateLimit` — 5 attempts / 15 min per
 * normalized email, env-tunable) on top of the IP + identity tiers. Login
 * probes that drive a multi-call burst use a FRESH email per attempt, so
 * every call lands in its own account bucket (1 attempt — never
 * exhausted) and the account tier never fires: the pre-existing tier each
 * probe targets stays observable in isolation. The account tier's own
 * contract is pinned by its dedicated suites
 * (`backend/lib/ratelimit.login-account.test.ts`,
 * `frontend/graphql/test/gateway/login-rate-limit.test.ts`) — never here.
 *
 * Coverage map:
 *  - Tier 1 (login ordering, ZERO spies on the enforcement path): under the
 *    limit a nonexistent email answers UNAUTHORIZED (the service ran);
 *    with the IP bucket exhausted the SAME call answers RATE_LIMIT_EXCEEDED
 *    — the error-code distinction IS the ordering proof that enforcement
 *    runs before any credential work. Plus the register/refresh limiter
 *    wiring and the login normalization branches (empty email / empty
 *    password / oversize password all deny pre-service with the SAME
 *    generic invalid-credentials copy).
 *  - Tier 2 (boundaries): password lengths 72 / 1_024 both reach the
 *    service (pass normalization); 1_025 rejects pre-service. Unicode
 *    emails: the untrimmed-email probe uses a unicode address, and the
 *    identity-bucket probe drives casing/whitespace variants of a unicode
 *    address through the registerUser resolver's `hashAuthIdentity` (trim
 *    + lowercase collapse onto ONE bucket) — the 20/60 s identity tier is
 *    only reachable end-to-end on the register path, because login layers
 *    the account-keyed tier on the SAME normalized-email digest (which
 *    trips first past call 5); on login the identity tier remains pinned
 *    at the unit level in `backend/lib/ratelimit.test.ts`.
 *  - Tier 3 (concurrency): 11 parallel login executions from ONE IP —
 *    each with a FRESH email (account tier never fires) — exactly 10 pass
 *    the limiter (failing credentials, UNAUTHORIZED) and exactly 1 is
 *    rate-limited: the event-loop atomicity of the check-then-throw
 *    sequence.
 *  - Tier 4 (bypass probes): field aliasing (`l1: login(...)`) does NOT
 *    bypass field-level enforcement — 11 aliased login fields in ONE
 *    document from one IP (a fresh email per call) still drain the bucket
 *    (top-level mutation fields execute serially, so `l11` is
 *    deterministically the rejected alias). Empty / whitespace-only email digests to the `""` no-identity
 *    sentinel → IP-only bucketing (25 distinct-IP calls never trip the
 *    identity cap; from ONE IP the 11th call rate-limits).
 *  - Cross-resolver keying: registerUser shares the client-IP namespace
 *    with login; refreshToken is IP-only (never consumes an identity
 *    bucket — 25 distinct-IP refresh calls with the SAME token all pass).
 *
 * DB posture: login probes use NONEXISTENT emails — a FRESH address per
 * burst attempt (the identity read is a fast miss → generic UNAUTHORIZED,
 * no bcrypt cost, and the account tier sees 1 attempt per account); register probes use a
 * 7-char password so the service's `validateInput` rejects with VALIDATION
 * BEFORE any hash or DB write; refresh probes use a garbage JWT so
 * `verifyRefreshToken` rejects before any lookup. The suite therefore
 * performs ZERO writes and a bounded number of cheap reads.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type ExecutionResult, graphql } from "graphql";
import type { Context } from "@/backend/graphql/gqlContextFactory";
import { graphQLSchema } from "@/backend/graphql/gqlSchema";
import { logger } from "@/backend/lib/logger";
import { clearRateLimitStore } from "@/backend/lib/ratelimit";
import { AuthService } from "@/backend/services/auth";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import type { Translations } from "@/shared/locale/types/message";

/** English localized copy — exact-message assertions resolve through the live source. */
const EN_ERRORS = getServerTranslations("en").errorsTranslations;

/** English auth copy — the invalid-credentials denial under test. */
const EN_AUTH = getServerTranslations("en").authTranslations;

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

const REFRESH_DOCUMENT = `
  mutation Refresh($refreshToken: String) {
    refreshToken(refreshToken: $refreshToken) { accessToken }
  }
`;

/** A garbage JWT — `verifyRefreshToken` rejects it before any DB lookup. */
const GARBAGE_REFRESH_TOKEN = "not-a-jwt";

/** 7-char password — below the registration minimum, so the service rejects at validation (zero DB writes). */
const SHORT_REGISTRATION_PASSWORD = "Short1!";

/** Anonymous per-probe context — public mutations need no verified user. */
function anonymousContext(clientIp: string): Context {
  return {
    locale: "en",
    t: async <K extends keyof Translations>(ns: K) => getServerTranslations("en")[ns],
    requestId: "req-auth-rate-limit-test",
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
    fullName: "Rate Limit Probe",
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

async function runRefresh(clientIp: string, refreshToken: string = GARBAGE_REFRESH_TOKEN): Promise<ExecutionResult> {
  return graphql({
    schema: graphQLSchema,
    source: REFRESH_DOCUMENT,
    variableValues: { refreshToken },
    contextValue: anonymousContext(clientIp),
  });
}

/** Error codes of an execution result, in wire order (empty when the call succeeded). */
function errorCodesOf(result: ExecutionResult): readonly string[] {
  return (result.errors ?? []).map(error => {
    const code: unknown = error.extensions?.code;
    return typeof code === "string" ? code : "";
  });
}

/** First error code — the single-error probes assert on it directly. */
function firstErrorCodeOf(result: ExecutionResult): string {
  const [first] = errorCodesOf(result);
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

/** Distinct test IPs from the RFC-5737 documentation range (1-based index). */
function distinctDocIp(index: number): string {
  return `198.51.100.${index}`;
}

describe("Auth mutation rate limiting (built schema, in-process)", () => {
  const stashedHarnessFlags: Record<string, string | undefined> = {};
  let domainLogSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // The enforcement helper reads these flags at CALL time — clearing them
    // here makes the buckets observable regardless of how the suite was
    // launched (`.env.test` sets both for the shared harness).
    stashedHarnessFlags.TEST_CI = process.env.TEST_CI;
    stashedHarnessFlags.TEST_SERVER = process.env.TEST_SERVER;
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

  beforeAll(() => {
    // Every failing login logs a domain error — silence them so the
    // captured suite output stays compact (the rejection paths themselves
    // are the assertions, not the logs).
    domainLogSpy = spyOn(logger, "logDomainError").mockImplementation(() => {});
  });

  afterAll(() => {
    domainLogSpy?.mockRestore();
  });

  describe("login — enforcement ordering (zero-spy ordering proof)", () => {
    test("under the limit, a nonexistent email answers UNAUTHORIZED — the service ran", async () => {
      const result = await runLogin(nonexistentEmail(), "AnyPassword1!", "192.0.2.1");

      expect(firstErrorCodeOf(result)).toBe("UNAUTHORIZED");
      expect(result.errors?.[0]?.message).toBe(EN_AUTH.invalidCredentials);
    });

    test("with the IP bucket exhausted the SAME call answers RATE_LIMIT_EXCEEDED — enforcement ran FIRST", async () => {
      // 10 in-window calls from one IP drain the brute-force bucket. Each
      // call carries a FRESH email so the account-keyed login tier sees 1
      // attempt per account and never fires — the IP-tier drain under test
      // stays observable in isolation.
      const drained = await drainSequentially(10, () => runLogin(nonexistentEmail(), "AnyPassword1!", "192.0.2.2"));
      for (const result of drained) {
        expect(firstErrorCodeOf(result)).toBe("UNAUTHORIZED");
      }
      // Call #11 with a FRESH NONEXISTENT email from the SAME IP: had the
      // service run first it would answer UNAUTHORIZED —
      // RATE_LIMIT_EXCEEDED is only reachable if the limiter gate runs
      // before any credential work. The code distinction IS the ordering
      // proof (zero spies on the path).
      const rejected = await runLogin(nonexistentEmail(), "AnyPassword1!", "192.0.2.2");
      expect(firstErrorCodeOf(rejected)).toBe("RATE_LIMIT_EXCEEDED");
      expect(rejected.errors?.[0]?.message).toBe(EN_ERRORS.rateLimitExceeded);
    });
  });

  describe("login — normalization (pre-service denials)", () => {
    test("an untrimmed (unicode) email reaches the service TRIMMED", async () => {
      const loginSpy = spyOn(AuthService, "login");
      try {
        const unicodeEmail = "Ünïcode.Usér@Example.INVALID";
        const result = await runLogin(`  ${unicodeEmail}  `, "AnyPassword1!", "192.0.2.3");

        // The service ran (nonexistent identity → UNAUTHORIZED)…
        expect(firstErrorCodeOf(result)).toBe("UNAUTHORIZED");
        // …and received the TRIMMED email verbatim (trim only — no case
        // folding at the resolver; the limiter's hash does the folding).
        const call = loginSpy.mock.calls.at(-1);
        if (!call) throw new Error("expected AuthService.login to have been called");
        const [reachedEmail, reachedPassword] = call;
        expect(reachedEmail).toBe(unicodeEmail);
        expect(reachedPassword).toBe("AnyPassword1!");
      } finally {
        loginSpy.mockRestore();
      }
    });

    test("empty and whitespace-only email reject invalid-credentials BEFORE the service", async () => {
      const loginSpy = spyOn(AuthService, "login");
      try {
        const results = await Promise.all(["", "   "].map(email => runLogin(email, "AnyPassword1!", "192.0.2.4")));
        for (const result of results) {
          expect(firstErrorCodeOf(result)).toBe("UNAUTHORIZED");
          expect(result.errors?.[0]?.message).toBe(EN_AUTH.invalidCredentials);
        }
        expect(loginSpy).not.toHaveBeenCalled();
      } finally {
        loginSpy.mockRestore();
      }
    });

    test("empty password rejects invalid-credentials BEFORE the service", async () => {
      const loginSpy = spyOn(AuthService, "login");
      try {
        const result = await runLogin(nonexistentEmail(), "", "192.0.2.5");
        expect(firstErrorCodeOf(result)).toBe("UNAUTHORIZED");
        expect(result.errors?.[0]?.message).toBe(EN_AUTH.invalidCredentials);
        expect(loginSpy).not.toHaveBeenCalled();
      } finally {
        loginSpy.mockRestore();
      }
    });

    test("password boundary: 72 and 1_024 chars reach the service; 1_025 rejects pre-service", async () => {
      const loginSpy = spyOn(AuthService, "login");
      try {
        // 72 — bcrypt's effective input boundary: a normal-length password
        // that must flow through to the credential check.
        const at72 = await runLogin(nonexistentEmail(), "A".repeat(72), "192.0.2.6");
        expect(firstErrorCodeOf(at72)).toBe("UNAUTHORIZED");
        // 1_024 — the transport-hygiene ceiling: still passes normalization.
        const at1024 = await runLogin(nonexistentEmail(), "B".repeat(1_024), "192.0.2.6");
        expect(firstErrorCodeOf(at1024)).toBe("UNAUTHORIZED");
        // The service was consulted exactly twice (the two passing calls).
        expect(loginSpy).toHaveBeenCalledTimes(2);
        // 1_025 — one over the ceiling: denied pre-service with the SAME
        // generic invalid-credentials copy (no oracle, no service call).
        const at1025 = await runLogin(nonexistentEmail(), "C".repeat(1_025), "192.0.2.6");
        expect(firstErrorCodeOf(at1025)).toBe("UNAUTHORIZED");
        expect(at1025.errors?.[0]?.message).toBe(EN_AUTH.invalidCredentials);
        expect(loginSpy).toHaveBeenCalledTimes(2);
      } finally {
        loginSpy.mockRestore();
      }
    });
  });

  describe("login — bucket keying (IP tier shared across identities)", () => {
    test("the IP bucket is shared across identities: 10 mixed-identity logins from one IP, 11th with a FRESH identity rejects", async () => {
      const ip = "203.0.113.10";
      const drained = await drainSequentially(10, () => runLogin(nonexistentEmail(), "AnyPassword1!", ip));
      for (const result of drained) {
        expect(firstErrorCodeOf(result)).toBe("UNAUTHORIZED");
      }
      // A brand-new email (fresh identity bucket) still trips — the IP
      // bucket is the one that exhausted.
      const rejected = await runLogin(nonexistentEmail(), "AnyPassword1!", ip);
      expect(firstErrorCodeOf(rejected)).toBe("RATE_LIMIT_EXCEEDED");
    });
  });

  describe("registerUser — limiter wiring", () => {
    test("enforces the identity bucket: same email, 20 distinct IPs pass, the 21st rejects", async () => {
      const email = `register-probe-${randomUUID()}@test.invalid`;
      // 20 calls from DISTINCT IPs: only the identity bucket accumulates.
      // Each call rejects at the service with VALIDATION (short password —
      // zero DB writes), proving the limiter passed it through.
      const drained = await drainSequentially(20, index => runRegister(email, distinctDocIp(index + 1)));
      for (const result of drained) {
        expect(firstErrorCodeOf(result)).toBe("VALIDATION");
      }
      // Call #21 from a FRESH IP with the SAME email: only the identity
      // bucket can reject it — the resolver wires `hashAuthIdentity(input.email)`.
      const rejected = await runRegister(email, "198.51.100.250");
      expect(firstErrorCodeOf(rejected)).toBe("RATE_LIMIT_EXCEEDED");
    });

    test("enforces the identity bucket: casing/whitespace variants of one unicode email share ONE identity bucket (20 pass, 21st rejects)", async () => {
      // The 20/60 s identity tier is only reachable end-to-end on the
      // register path: login layers the account-keyed tier (5 / 15 min) on
      // the SAME normalized-email digest, which trips first past call 5.
      // All four variants trim+lowercase onto the same sha-256 identity.
      const variants = [
        "Unicode.Bücket@Example.INVALID",
        "  unicode.bücket@example.invalid  ",
        "UNICODE.BÜCKET@EXAMPLE.INVALID",
        "\tunicode.bücket@example.invalid\t",
      ];
      // 20 in-window calls, each from a DISTINCT IP so only the identity
      // bucket accumulates. Each call rejects at the service with VALIDATION
      // (short password — zero DB writes), proving the limiter passed it
      // through.
      const drained = await drainSequentially(20, index =>
        runRegister(variants[index % variants.length] ?? "", distinctDocIp(index + 1))
      );
      for (const result of drained) {
        expect(firstErrorCodeOf(result)).toBe("VALIDATION");
      }
      // Call #21 with a fresh variant + fresh IP: only the shared identity
      // bucket can reject it — the resolver hashes the trimmed+lowercased
      // form through the wire.
      const rejected = await runRegister(" unicode.BÜCKET@example.invalid ", "198.51.100.250");
      expect(firstErrorCodeOf(rejected)).toBe("RATE_LIMIT_EXCEEDED");
    });

    test("shares the client-IP namespace with login (cross-resolver keying)", async () => {
      const ip = "192.0.2.30";
      // 10 register calls from ONE IP drain the shared brute-force bucket.
      const drained = await drainSequentially(10, () => runRegister(nonexistentEmail(), ip));
      for (const result of drained) {
        expect(firstErrorCodeOf(result)).toBe("VALIDATION");
      }
      // A LOGIN from the same IP now trips — register and login key the
      // SAME per-IP bucket.
      const rejected = await runLogin(nonexistentEmail(), "AnyPassword1!", ip);
      expect(firstErrorCodeOf(rejected)).toBe("RATE_LIMIT_EXCEEDED");
    });
  });

  describe("refreshToken — IP-only enforcement", () => {
    test("from one IP: 10 refresh calls pass the limiter, the 11th rejects", async () => {
      const ip = "192.0.2.40";
      const drained = await drainSequentially(10, () => runRefresh(ip));
      for (const result of drained) {
        // Passed the limiter, rejected by the service (garbage token →
        // UNAUTHORIZED, no DB touch).
        expect(firstErrorCodeOf(result)).toBe("UNAUTHORIZED");
      }
      const rejected = await runRefresh(ip);
      expect(firstErrorCodeOf(rejected)).toBe("RATE_LIMIT_EXCEEDED");
    });

    test("never consumes an identity bucket: 25 distinct-IP refresh calls with the SAME token all pass", async () => {
      // A refresh carries no email — the resolver passes the "" no-identity
      // sentinel. Had it keyed ANY non-empty identity (e.g. the token),
      // calls #21–#25 would trip the shared bucket at its 20-cap.
      const drained = await drainSequentially(25, index => runRefresh(distinctDocIp(index + 1)));
      for (const result of drained) {
        expect(firstErrorCodeOf(result)).toBe("UNAUTHORIZED");
      }
    });
  });

  describe("concurrent burst (event-loop atomicity)", () => {
    test("11 parallel login executions from ONE IP: 10 pass the limiter, exactly 1 is rate-limited", async () => {
      // Each parallel call carries a FRESH email — the account-keyed login
      // tier sees 1 attempt per account and never fires; the ONE shared IP
      // bucket is what the 11 parallel calls contend for.
      const calls = Array.from({ length: 11 }, () => runLogin(nonexistentEmail(), "AnyPassword1!", "192.0.2.44"));
      const results = await Promise.all(calls);
      const codes = results.flatMap(result => errorCodesOf(result));
      // All 11 errored (nonexistent credentials), but only ONE is the
      // limiter's rejection — the other 10 reached the service.
      expect(codes).toHaveLength(11);
      expect(codes.filter(code => code === "RATE_LIMIT_EXCEEDED")).toHaveLength(1);
      expect(codes.filter(code => code === "UNAUTHORIZED")).toHaveLength(10);
    });
  });

  describe("bypass probes (aliasing + empty-identity sentinel)", () => {
    test("field aliasing does NOT bypass field-level enforcement (an aliased login still runs the same resolver + limiter)", async () => {
      // Under the limit, an ALIASED login field reaches the service exactly
      // like the canonical name (resolver ran → UNAUTHORIZED, not silent).
      // Every call in this probe carries a FRESH email: the account-keyed
      // login tier sees 1 attempt per account and never fires — the probe
      // stays about aliasing vs the per-IP bucket, nothing else.
      const aliasedPass = await graphql({
        schema: graphQLSchema,
        source: `
          mutation AliasedUnderLimit($email: String!, $password: String!) {
            loginAlias: login(email: $email, password: $password) { accessToken }
          }
        `,
        variableValues: { email: nonexistentEmail(), password: "AnyPassword1!" },
        contextValue: anonymousContext("192.0.2.46"),
      });
      expect(firstErrorCodeOf(aliasedPass)).toBe("UNAUTHORIZED");

      // A parallel burst of 11 DISTINCTLY-ALIASED login fields (one per
      // execution, all from ONE IP): the client-side alias names do not
      // mint fresh limiter buckets — exactly 10 pass the gate and 1 is
      // rate-limited, aliasing or not.
      const bursts = Array.from({ length: 11 }, (_, index) =>
        graphql({
          schema: graphQLSchema,
          source: `
            mutation AliasedBurst${index}($email: String!, $password: String!) {
              burstAlias${index}: login(email: $email, password: $password) { accessToken }
            }
          `,
          variableValues: { email: nonexistentEmail(), password: "AnyPassword1!" },
          contextValue: anonymousContext("192.0.2.45"),
        })
      );
      const results = await Promise.all(bursts);
      const codes = results.flatMap(result => errorCodesOf(result));
      expect(codes).toHaveLength(11);
      expect(codes.filter(code => code === "UNAUTHORIZED")).toHaveLength(10);
      expect(codes.filter(code => code === "RATE_LIMIT_EXCEEDED")).toHaveLength(1);

      // And on an ALREADY-EXHAUSTED bucket the aliased field answers with
      // the limiter's rejection first (enforcement runs before the alias's
      // credential work could matter).
      const exhaustedIp = "192.0.2.47";
      await drainSequentially(10, () => runLogin(nonexistentEmail(), "AnyPassword1!", exhaustedIp));
      const aliasedRejected = await graphql({
        schema: graphQLSchema,
        source: `
          mutation AliasedExhausted($email: String!, $password: String!) {
            loginAlias: login(email: $email, password: $password) { accessToken }
          }
        `,
        variableValues: { email: nonexistentEmail(), password: "AnyPassword1!" },
        contextValue: anonymousContext(exhaustedIp),
      });
      expect(firstErrorCodeOf(aliasedRejected)).toBe("RATE_LIMIT_EXCEEDED");
    });

    test("whitespace-only email digests to the no-identity sentinel: IP-only bucketing", async () => {
      // 25 DISTINCT-IP calls with a whitespace-only email: all pass the
      // limiter — a non-empty shared identity would have tripped at its
      // 20-cap on call #21. (Each call denies pre-service with the generic
      // invalid-credentials copy.)
      const distinct = await drainSequentially(25, index => runLogin("   ", "AnyPassword1!", distinctDocIp(index + 1)));
      for (const result of distinct) {
        expect(firstErrorCodeOf(result)).toBe("UNAUTHORIZED");
      }

      // From ONE IP the same probes still drain the IP-only bucket.
      const ip = "203.0.113.50";
      const drained = await drainSequentially(10, () => runLogin("   ", "AnyPassword1!", ip));
      for (const result of drained) {
        expect(firstErrorCodeOf(result)).toBe("UNAUTHORIZED");
      }
      const rejected = await runLogin("   ", "AnyPassword1!", ip);
      expect(firstErrorCodeOf(rejected)).toBe("RATE_LIMIT_EXCEEDED");
    });
  });
});
