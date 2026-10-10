import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  AUTH_COOKIE_NAMES,
  clearAuthCookies,
  createAuthCookieOut,
  extractCookieValue,
  parseCookies,
  setAuthCookies,
} from "@/backend/lib/auth/cookies";
import { resetEnvironmentCache } from "@/backend/lib/env";

function setNodeEnv(nodeEnv: string): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
  resetEnvironmentCache();
}

describe("extractCookieValue", () => {
  it("returns null for missing, null, or undefined headers", () => {
    expect(extractCookieValue(null, "access_token")).toBeNull();
    expect(extractCookieValue(undefined, "access_token")).toBeNull();
    expect(extractCookieValue("", "access_token")).toBeNull();
    expect(extractCookieValue("   ", "access_token")).toBeNull();
  });

  it("extracts target cookie from single and multiple cookie headers", () => {
    expect(extractCookieValue("access_token=token123", "access_token")).toBe("token123");
    expect(extractCookieValue("a=b; access_token=token123; c=d", "access_token")).toBe("token123");
    expect(extractCookieValue("a=b; c=d", "access_token")).toBeNull();
  });

  it("handles whitespace around keys and values", () => {
    expect(extractCookieValue("  foo = bar ;  access_token = token123  ", "access_token")).toBe("token123");
  });

  it("handles equals signs within target cookie value", () => {
    expect(extractCookieValue("a=1; target=val=123; b=2", "target")).toBe("val=123");
  });

  it("decodes URI-encoded cookie values and falls back on invalid encodings", () => {
    expect(extractCookieValue("greeting=hello%20world", "greeting")).toBe("hello world");
    expect(extractCookieValue("bad=hello%2world", "bad")).toBe("hello%2world");
  });

  it("skips prefix/suffix match false positives", () => {
    expect(extractCookieValue("my_access_token=123; access_token_extra=456", "access_token")).toBeNull();
  });

  it("handles complex cookie headers with multiple tokens", () => {
    const header =
      "access_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9; refresh_token=dGVzdF9yZWZyZXNoX3Rva2VuX3ZhbHVl; NEXT_LOCALE=en; session_id=sess_123456789";
    expect(extractCookieValue(header, "access_token")).toBe("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(extractCookieValue(header, "NEXT_LOCALE")).toBe("en");
    expect(extractCookieValue(header, "missing_cookie")).toBeNull();
  });
});

describe("parseCookies", () => {
  it("returns empty object for missing, null, or undefined headers", () => {
    expect(parseCookies(null)).toEqual({});
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")).toEqual({});
    expect(parseCookies("   ")).toEqual({});
  });

  it("parses single and multiple cookies correctly", () => {
    expect(parseCookies("a=b")).toEqual({ a: "b" });
    expect(parseCookies("a=b; c=d")).toEqual({ a: "b", c: "d" });
  });

  it("handles whitespace around keys and values", () => {
    expect(parseCookies("  foo = bar ;  baz = qux  ")).toEqual({
      foo: "bar",
      baz: "qux",
    });
  });

  it("handles equals signs within cookie values", () => {
    expect(parseCookies("a=b=c; d=e")).toEqual({ a: "b=c", d: "e" });
  });

  it("skips malformed key-value pairs lacking equals sign or key", () => {
    expect(parseCookies("invalid; a=1")).toEqual({ a: "1" });
    expect(parseCookies("=b; c=d")).toEqual({ c: "d" });
  });

  it("stays correct with many malformed segments before a valid cookie", () => {
    const header = `${"no-equals-here; ".repeat(2000)}real=value`;
    expect(parseCookies(header)).toEqual({ real: "value" });
  });

  it("decodes URI-encoded cookie values", () => {
    expect(parseCookies("greeting=hello%20world; user=alice")).toEqual({
      greeting: "hello world",
      user: "alice",
    });
  });

  it("falls back to literal raw value when URI decoding fails", () => {
    expect(parseCookies("bad=hello%2world; good=bar")).toEqual({
      bad: "hello%2world",
      good: "bar",
    });
  });

  it("handles complex auth cookie headers without allocation overhead", () => {
    const header =
      "access_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9; refresh_token=dGVzdF9yZWZyZXNoX3Rva2VuX3ZhbHVl; NEXT_LOCALE=en; session_id=sess_123456789";
    expect(parseCookies(header)).toEqual({
      access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      refresh_token: "dGVzdF9yZWZyZXNoX3Rva2VuX3ZhbHVl",
      NEXT_LOCALE: "en",
      session_id: "sess_123456789",
    });
  });
});

describe("auth cookie serialization contract", () => {
  const COOKIE_ENV_KEYS = ["NODE_ENV", "AUTH_COOKIE_SECURE"] as const;
  const savedCookieEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of COOKIE_ENV_KEYS) {
      savedCookieEnv[key] = process.env[key];
    }
    delete process.env.AUTH_COOKIE_SECURE;
    resetEnvironmentCache();
  });

  afterEach(() => {
    for (const key of COOKIE_ENV_KEYS) {
      if (savedCookieEnv[key] === undefined) {
        delete process.env[key];
      } else {
        (process.env as Record<string, string | undefined>)[key] = savedCookieEnv[key];
      }
    }
    resetEnvironmentCache();
  });

  it("pins the auth cookie names", () => {
    expect(AUTH_COOKIE_NAMES).toEqual({
      accessToken: "access_token",
      refreshToken: "refresh_token",
      sessionId: "session_id",
    });
  });

  it("serializes HttpOnly SameSite=Strict cookies with the token TTLs (no Secure outside production)", () => {
    setNodeEnv("development");

    const out = createAuthCookieOut();
    setAuthCookies(out, "at-value", "rt-value", "sess-value");

    expect(out).toEqual([
      "access_token=at-value; HttpOnly; SameSite=Strict; Path=/; Max-Age=900",
      "refresh_token=rt-value; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800",
      "session_id=sess-value; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800",
    ]);
  });

  it("adds the Secure flag in production", () => {
    setNodeEnv("production");

    const out = createAuthCookieOut();
    setAuthCookies(out, "at-value", "rt-value", "sess-value");

    expect(out).toEqual([
      "access_token=at-value; HttpOnly; SameSite=Strict; Path=/; Secure; Max-Age=900",
      "refresh_token=rt-value; HttpOnly; SameSite=Strict; Path=/; Secure; Max-Age=604800",
      "session_id=sess-value; HttpOnly; SameSite=Strict; Path=/; Secure; Max-Age=604800",
    ]);
  });

  it("AUTH_COOKIE_SECURE=false disables Secure in production (opt-out only)", () => {
    setNodeEnv("production");
    process.env.AUTH_COOKIE_SECURE = "false";

    const out = createAuthCookieOut();
    setAuthCookies(out, "at-value", "rt-value", "sess-value");

    expect(out).toEqual([
      "access_token=at-value; HttpOnly; SameSite=Strict; Path=/; Max-Age=900",
      "refresh_token=rt-value; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800",
      "session_id=sess-value; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800",
    ]);
  });

  it("AUTH_COOKIE_SECURE cannot force Secure on outside production", () => {
    setNodeEnv("development");
    process.env.AUTH_COOKIE_SECURE = "true";

    const out = createAuthCookieOut();
    setAuthCookies(out, "at-value", "rt-value", "sess-value");

    expect(out).toEqual([
      "access_token=at-value; HttpOnly; SameSite=Strict; Path=/; Max-Age=900",
      "refresh_token=rt-value; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800",
      "session_id=sess-value; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800",
    ]);
  });

  it("URL-encodes cookie values so attribute-smuggling payloads cannot alter the flags", () => {
    setNodeEnv("development");

    const smuggled = "v; Secure; SameSite=None; Max-Age=999999";
    const out = createAuthCookieOut();
    setAuthCookies(out, smuggled, "rt-value", "sess-value");

    const serialized = out[0];
    expect(serialized).toBe(
      `access_token=${encodeURIComponent(smuggled)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=900`
    );
    expect(serialized).not.toContain("SameSite=None");
    expect(serialized).not.toContain("Max-Age=999999");
    // name=value plus exactly the four serializer-owned attributes — the
    // payload adds no attribute segments of its own.
    expect(serialized.split(";")).toHaveLength(5);
  });

  it("clearAuthCookies expires all three cookies immediately (empty value, Max-Age=0)", () => {
    setNodeEnv("development");

    const out = createAuthCookieOut();
    clearAuthCookies(out);

    expect(out).toEqual([
      "access_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      "refresh_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      "session_id=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    ]);
  });
});
