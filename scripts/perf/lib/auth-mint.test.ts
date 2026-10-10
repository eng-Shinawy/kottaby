/**
 * Unit suite for the performance-harness session minter.
 *
 * Drives the minter against a local stub of the GraphQL auth endpoint: the
 * login request contract (real mutation document, byte-for-byte credential
 * round-trip), Set-Cookie parsing (multiple headers, Expires forms, embedded
 * `=` values), every failure path (HTTP error, network failure, credential
 * rejection, malformed bodies), and the secret-hygiene contract — the minted
 * cookie, the password, and server response bodies never appear in any
 * console output or error message.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  AuthMintError,
  collectCookiePairs,
  LOGIN_MUTATION_DOCUMENT,
  mintSessionCookie,
  parseSetCookiePair,
} from "@/scripts/perf/lib/auth-mint";

/** The email used by most fixtures. */
const STUB_EMAIL = "perf.student@example.test";
/** Password fixture with SQL-ish payload characters (must round-trip byte-for-byte). */
const SQL_ISH_PASSWORD = "p@ss'w0rd\"; DROP TABLE users; --لم";

/** One request the stub server received. */
interface CapturedRequest {
  url: string;
  method: string;
  contentType: string | null;
  bodyText: string;
}

/** Active stub response builder; swapped per scenario. */
type StubScenario = (body: unknown, request: Request, bodyText: string) => Response;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stubEmailFromBody(body: unknown): string {
  if (isRecord(body)) {
    const variables = body.variables;
    if (isRecord(variables) && typeof variables.email === "string") {
      return variables.email;
    }
  }
  return STUB_EMAIL;
}

function graphqlResponse(payload: unknown, cookies?: readonly string[]): Response {
  const headers: [string, string][] = [["Content-Type", "application/json"]];
  for (const cookie of cookies ?? []) {
    headers.push(["Set-Cookie", cookie]);
  }
  return new Response(JSON.stringify(payload), { status: 200, headers });
}

/** Happy-path login: three auth cookies whose values embed the submitted email. */
function happyScenario(): StubScenario {
  return (body, _request, _bodyText) => {
    const email = stubEmailFromBody(body);
    return graphqlResponse({ data: { login: { user: { id: 42 } } } }, [
      `access_token=stub-access-token-for-${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=900`,
      "refresh_token=stub-refresh-token-value; Path=/; HttpOnly; Max-Age=604800",
      "session_id=stub-session-id-value; Path=/; HttpOnly",
    ]);
  };
}

let stubServer: ReturnType<typeof Bun.serve>;
let activeScenario: StubScenario = happyScenario();
const capturedRequests: CapturedRequest[] = [];

function setScenario(scenario: StubScenario): void {
  activeScenario = scenario;
}

/** Parses a stub request body; non-JSON bodies resolve to null. */
function parseJsonBody(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText);
  } catch {
    return null;
  }
}

beforeAll(() => {
  stubServer = Bun.serve({
    port: 0,
    fetch: async request => {
      const bodyText = await request.text();
      const body = parseJsonBody(bodyText);
      capturedRequests.push({
        url: request.url,
        method: request.method,
        contentType: request.headers.get("content-type"),
        bodyText,
      });
      return activeScenario(body, request, bodyText);
    },
  });
});

afterAll(async () => {
  await stubServer.stop(true);
});

/** Base URL of the stub server (port is dynamic). */
function stubBaseUrl(): string {
  return `http://127.0.0.1:${stubServer.port}`;
}

/** Runs an async step over each item strictly sequentially (loop-rule-safe helper). */
async function runSequentially<T>(items: readonly T[], step: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) {
    return;
  }
  await step(items[0]);
  await runSequentially(items.slice(1), step);
}

/** Swaps every console method to capture output; restore() puts the originals back. */
function installConsoleCapture(): { output: () => string; restore: () => void } {
  const chunks: string[] = [];
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };
  const sink = (...args: unknown[]) => {
    chunks.push(args.map(arg => JSON.stringify(arg) ?? String(arg)).join(" "));
  };
  console.log = sink;
  console.warn = sink;
  console.error = sink;
  console.info = sink;
  console.debug = sink;
  return {
    output: () => chunks.join("\n"),
    restore: () => {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
      console.info = original.info;
      console.debug = original.debug;
    },
  };
}

/** Parses the captured request body of the most recent stub hit. */
function lastCapturedBody(): { query: unknown; variables: Record<string, unknown> } {
  const last = capturedRequests.at(-1);
  expect(last).toBeDefined();
  const parsed: unknown = JSON.parse(last?.bodyText ?? "null");
  expect(isRecord(parsed)).toBe(true);
  const variables = isRecord(parsed) && isRecord(parsed.variables) ? parsed.variables : {};
  return { query: isRecord(parsed) ? parsed.query : null, variables };
}

describe("auth-mint: minting contract", () => {
  test("mints a session from the real login mutation response and cookies", async () => {
    setScenario(happyScenario());
    const session = await mintSessionCookie(stubBaseUrl(), STUB_EMAIL, "plain-password");
    expect(session.userId).toBe(42);
    expect(session.email).toBe(STUB_EMAIL);
    expect(session.cookieHeader).toBe(
      "access_token=stub-access-token-for-perf.student%40example.test; refresh_token=stub-refresh-token-value; session_id=stub-session-id-value"
    );
    const last = capturedRequests.at(-1);
    expect(last?.method).toBe("POST");
    expect(last?.contentType).toBe("application/json");
    const { query, variables } = lastCapturedBody();
    expect(query).toBe(LOGIN_MUTATION_DOCUMENT);
    expect(query).toContain("login(email: $email, password: $password)");
    expect(variables.email).toBe(STUB_EMAIL);
    expect(variables.password).toBe("plain-password");
    expect(last?.url).toBe(`${stubBaseUrl()}/api/graphql`);
  });

  test("an explicit /api/graphql baseUrl is used as-is", async () => {
    setScenario(happyScenario());
    const session = await mintSessionCookie(`${stubBaseUrl()}/api/graphql`, STUB_EMAIL, "pw");
    expect(session.userId).toBe(42);
    expect(capturedRequests.at(-1)?.url).toBe(`${stubBaseUrl()}/api/graphql`);
  });

  test("a trailing-slash server root still lands on /api/graphql", async () => {
    setScenario(happyScenario());
    const session = await mintSessionCookie(`${stubBaseUrl()}/`, STUB_EMAIL, "pw");
    expect(session.userId).toBe(42);
    expect(capturedRequests.at(-1)?.url).toBe(`${stubBaseUrl()}/api/graphql`);
  });

  test("a cookie value with base64 padding keeps its embedded equals signs", async () => {
    setScenario(() =>
      graphqlResponse({ data: { login: { user: { id: 7 } } } }, ["access_token=abc123==; Path=/; HttpOnly"])
    );
    const session = await mintSessionCookie(stubBaseUrl(), STUB_EMAIL, "pw");
    expect(session.cookieHeader).toBe("access_token=abc123==");
  });

  test("duplicate access_token Set-Cookie headers keep the last value", async () => {
    setScenario(() =>
      graphqlResponse({ data: { login: { user: { id: 7 } } } }, [
        "access_token=first-token; Path=/",
        "access_token=second-token; Path=/",
      ])
    );
    const session = await mintSessionCookie(stubBaseUrl(), STUB_EMAIL, "pw");
    expect(session.cookieHeader).toBe("access_token=second-token");
  });
});

describe("auth-mint: argument validation (no request issued)", () => {
  const BAD_BASE_URLS = ["", "not a url", "://", "wss://host", "file:///etc"];

  test.each(BAD_BASE_URLS)("rejects an invalid base URL (%j) before any network work", async bad => {
    setScenario(happyScenario());
    const requestsBefore = capturedRequests.length;
    let error: unknown = null;
    try {
      await mintSessionCookie(bad, STUB_EMAIL, "pw");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AuthMintError);
    expect(capturedRequests).toHaveLength(requestsBefore);
  });

  test.each(["", "   "])("rejects an unusable email (%j) without issuing a request", async badEmail => {
    setScenario(happyScenario());
    const requestsBefore = capturedRequests.length;
    let error: unknown = null;
    try {
      await mintSessionCookie(stubBaseUrl(), badEmail, "pw");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AuthMintError);
    expect(capturedRequests).toHaveLength(requestsBefore);
  });

  test("rejects an empty password without issuing a request", async () => {
    setScenario(happyScenario());
    const requestsBefore = capturedRequests.length;
    let error: unknown = null;
    try {
      await mintSessionCookie(stubBaseUrl(), STUB_EMAIL, "");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AuthMintError);
    expect(capturedRequests).toHaveLength(requestsBefore);
  });
});

describe("auth-mint: boundary round-trips", () => {
  test("a SQL-ish payload password round-trips byte-for-byte and never enters the URL", async () => {
    setScenario(happyScenario());
    const session = await mintSessionCookie(stubBaseUrl(), STUB_EMAIL, SQL_ISH_PASSWORD);
    expect(session.userId).toBe(42);
    const last = capturedRequests.at(-1);
    expect(last?.url).not.toContain(SQL_ISH_PASSWORD);
    expect(last?.url).not.toContain(encodeURIComponent(SQL_ISH_PASSWORD));
    const { variables } = lastCapturedBody();
    expect(variables.password).toBe(SQL_ISH_PASSWORD);
  });

  test("a whitespace-only password is sent as-is (passwords are never trimmed)", async () => {
    setScenario(happyScenario());
    await mintSessionCookie(stubBaseUrl(), STUB_EMAIL, " ");
    const { variables } = lastCapturedBody();
    expect(variables.password).toBe(" ");
  });

  test("a unicode email round-trips unchanged in the request and session", async () => {
    setScenario(happyScenario());
    const unicodeEmail = "طالب@مثال.اختبار";
    const session = await mintSessionCookie(stubBaseUrl(), unicodeEmail, "pw");
    expect(session.email).toBe(unicodeEmail);
    expect(session.cookieHeader).toContain(`access_token=stub-access-token-for-${encodeURIComponent(unicodeEmail)}`);
    const { variables } = lastCapturedBody();
    expect(variables.email).toBe(unicodeEmail);
  });
});

/** Mints and returns the typed error (fails the test if no typed error was raised). */
async function captureMintError(baseUrl: string, email: string, password: string): Promise<AuthMintError> {
  let error: unknown = null;
  try {
    await mintSessionCookie(baseUrl, email, password);
  } catch (caught) {
    error = caught;
  }
  if (!(error instanceof AuthMintError)) {
    throw new Error("expected mintSessionCookie to reject with AuthMintError");
  }
  return error;
}

describe("auth-mint: login failure paths", () => {
  test("an HTTP 401 surfaces the status and never the body", async () => {
    setScenario(
      () =>
        new Response(JSON.stringify({ errors: [{ message: "invalid credentials TOPSECRET-BODY" }] }), { status: 401 })
    );
    const error = await captureMintError(stubBaseUrl(), STUB_EMAIL, "plain-password");
    expect(error.message).toContain("401");
    expect(error.message).not.toContain("TOPSECRET-BODY");
  });

  test("an HTTP 500 text body never leaks into the message", async () => {
    setScenario(() => new Response("TOPSECRET-BODY internal error", { status: 500 }));
    const error = await captureMintError(stubBaseUrl(), STUB_EMAIL, "plain-password");
    expect(error.message).toContain("500");
    expect(error.message).not.toContain("TOPSECRET-BODY");
  });

  test("GraphQL credential rejections scrub the submitted credentials from the message", async () => {
    setScenario(() =>
      graphqlResponse({
        errors: [
          { message: `invalid credentials for ${STUB_EMAIL} with password ${SQL_ISH_PASSWORD} (server reflection)` },
        ],
      })
    );
    const error = await captureMintError(stubBaseUrl(), STUB_EMAIL, SQL_ISH_PASSWORD);
    expect(error.message).toContain("[REDACTED]");
    expect(error.message).not.toContain(SQL_ISH_PASSWORD);
    expect(error.message).not.toContain(STUB_EMAIL);
  });

  test("a network failure raises the typed error with the cause preserved", async () => {
    const error = await captureMintError("http://127.0.0.1:1", STUB_EMAIL, "plain-password");
    expect(error.message).toContain("network");
    expect(error.cause).toBeInstanceOf(Error);
  });

  test("a non-JSON body raises a typed error without echoing the body", async () => {
    setScenario(() => new Response("not-json{{{TOPSECRET-BODY", { status: 200 }));
    const error = await captureMintError(stubBaseUrl(), STUB_EMAIL, "plain-password");
    expect(error.message).toContain("not valid JSON");
    expect(error.message).not.toContain("TOPSECRET-BODY");
  });

  const UNEXPECTED_SHAPE_BODIES = ["[]", "null", "42", '"text"', "[1,2,3]"];

  test.each(UNEXPECTED_SHAPE_BODIES)("refuses an unexpected response shape (%j)", async bodyText => {
    setScenario(() => new Response(bodyText, { status: 200 }));
    const error = await captureMintError(stubBaseUrl(), STUB_EMAIL, "plain-password");
    expect(error.message).toContain("unexpected shape");
  });

  const MISSING_USER_BODIES = [
    JSON.stringify({ data: null }),
    JSON.stringify({ data: { login: null } }),
    JSON.stringify({ data: { login: { user: null } } }),
    JSON.stringify({ data: { login: { user: { id: "42" } } } }),
  ];

  test.each(MISSING_USER_BODIES)("refuses a login response without a usable user id (%j)", async bodyText => {
    setScenario(() => new Response(bodyText, { status: 200 }));
    const error = await captureMintError(stubBaseUrl(), STUB_EMAIL, "plain-password");
    expect(error.message).toContain("did not include the authenticated user id");
  });

  const MALFORMED_ERRORS_PAYLOADS: Record<string, unknown>[] = [
    { errors: "nope" },
    { errors: [{}] },
    { errors: [null] },
  ];

  test.each(MALFORMED_ERRORS_PAYLOADS)("treats a malformed errors array (%j) as a shape violation", async payload => {
    setScenario(() => graphqlResponse(payload));
    const error = await captureMintError(stubBaseUrl(), STUB_EMAIL, "plain-password");
    expect(error.message).toContain("unexpected shape");
  });

  test("a login without cookies has no session to mint", async () => {
    setScenario(() => graphqlResponse({ data: { login: { user: { id: 42 } } } }));
    const error = await captureMintError(stubBaseUrl(), STUB_EMAIL, "plain-password");
    expect(error.message).toContain("access_token");
  });

  test("an empty-valued access_token cookie has no session to mint", async () => {
    setScenario(() => graphqlResponse({ data: { login: { user: { id: 42 } } } }, ["access_token=; Path=/"]));
    const error = await captureMintError(stubBaseUrl(), STUB_EMAIL, "plain-password");
    expect(error.message).toContain("access_token");
  });

  test("a login whose cookies omit access_token (refresh/session only) is refused", async () => {
    setScenario(() =>
      graphqlResponse({ data: { login: { user: { id: 42 } } } }, [
        "refresh_token=stub-refresh-token-value; Path=/",
        "session_id=stub-session-id-value; Path=/",
      ])
    );
    const error = await captureMintError(stubBaseUrl(), STUB_EMAIL, "plain-password");
    expect(error.message).toContain(ACCESS_TOKEN_COOKIE_NAME);
  });
});

describe("auth-mint: chaos", () => {
  test("20 concurrent mints each receive their own distinct session", async () => {
    setScenario(happyScenario());
    const emails = Array.from({ length: 20 }, (_, index) => `vu-${index}@example.test`);
    const sessions = await Promise.all(emails.map(email => mintSessionCookie(stubBaseUrl(), email, "shared-password")));
    const headers = new Set(sessions.map(session => session.cookieHeader));
    expect(headers.size).toBe(20);
    for (const session of sessions) {
      expect(session.cookieHeader).toContain(`access_token=stub-access-token-for-${encodeURIComponent(session.email)}`);
    }
  });

  const GARBAGE_POOL = '\u0000\u007f\u00e9\u4e2d\ud83d\ude00{}[]:,"\\';
  const garbageBodies = Array.from({ length: 12 }, (_, index) => {
    let state = 7 + index * 101;
    let garbage = "";
    for (let j = 0; j < 40 + index; j++) {
      state = (state * 1103515245 + 12345) % 2147483648;
      garbage += GARBAGE_POOL[state % GARBAGE_POOL.length];
    }
    return garbage;
  });

  test.each(garbageBodies)(
    "garbage response bytes raise the typed error, never crash the minter (%#)",
    async garbage => {
      setScenario(() => new Response(garbage, { status: 200 }));
      let error: unknown = null;
      try {
        await mintSessionCookie(stubBaseUrl(), STUB_EMAIL, "plain-password");
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AuthMintError);
    }
  );
});

describe("auth-mint: secret hygiene (nothing is ever logged)", () => {
  test("successful mint and every failure path write nothing to the console", async () => {
    const capture = installConsoleCapture();
    try {
      setScenario(happyScenario());
      const session = await mintSessionCookie(stubBaseUrl(), STUB_EMAIL, "plain-password");
      expect(session.userId).toBe(42);

      const failureScenarios: StubScenario[] = [
        () => new Response("server error", { status: 500 }),
        () => new Response("not-json", { status: 200 }),
        () => graphqlResponse({ errors: [{ message: "invalid credentials" }] }),
        () => graphqlResponse({ data: { login: { user: { id: 42 } } } }),
      ];
      await runSequentially(failureScenarios, async scenario => {
        setScenario(scenario);
        let error: unknown = null;
        try {
          await mintSessionCookie(stubBaseUrl(), STUB_EMAIL, "plain-password");
        } catch (caught) {
          error = caught;
        }
        expect(error).toBeInstanceOf(AuthMintError);
      });

      let networkError: unknown = null;
      try {
        await mintSessionCookie("http://127.0.0.1:1", STUB_EMAIL, "plain-password");
      } catch (caught) {
        networkError = caught;
      }
      expect(networkError).toBeInstanceOf(AuthMintError);

      const output = capture.output();
      expect(output).toBe("");
    } finally {
      capture.restore();
    }
  });
});

describe("auth-mint: Set-Cookie pair parsing", () => {
  test("extracts the pair from attribute-laden headers including Expires forms", () => {
    expect(parseSetCookiePair("access_token=tok; Expires=Wed, 09 Jun 2026 10:18:14 GMT; Path=/; HttpOnly")).toEqual({
      name: "access_token",
      value: "tok",
    });
    expect(parseSetCookiePair("access_token=tok; expires=Wed, 09-Jun-2026 10:18:14 GMT")).toEqual({
      name: "access_token",
      value: "tok",
    });
    expect(parseSetCookiePair("access_token=tok")).toEqual({ name: "access_token", value: "tok" });
    expect(parseSetCookiePair("access_token=abc==")).toEqual({ name: "access_token", value: "abc==" });
    expect(parseSetCookiePair(" access_token = tok ")).toEqual({ name: "access_token", value: "tok" });
  });

  test("refuses unusable pair shapes", () => {
    expect(parseSetCookiePair("HttpOnly")).toBeNull();
    expect(parseSetCookiePair("")).toBeNull();
    expect(parseSetCookiePair("=value")).toBeNull();
    expect(parseSetCookiePair("access_token=")).toBeNull();
    expect(parseSetCookiePair("=; Path=/")).toBeNull();
  });

  test("collects multiple Set-Cookie headers into a jar (last duplicate wins)", () => {
    const jar = collectCookiePairs([
      "access_token=first; Path=/",
      "refresh_token=r; Path=/",
      "access_token=second; Path=/",
      "HttpOnly",
      "",
    ]);
    expect(jar.get("access_token")).toBe("second");
    expect(jar.get("refresh_token")).toBe("r");
    expect(jar.size).toBe(2);
  });

  test("an empty header list yields an empty jar", () => {
    expect(collectCookiePairs([]).size).toBe(0);
  });
});
