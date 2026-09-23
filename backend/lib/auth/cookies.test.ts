import { describe, expect, it } from "bun:test";
import { parseCookies } from "@/backend/lib/auth/cookies";

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
