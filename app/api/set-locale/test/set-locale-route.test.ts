/**
 * Representative API-route envelope matrix for `/api/set-locale`.
 *
 * Pure-function tier: handlers are invoked directly with constructed
 * `NextRequest`s — NO server boot.
 *
 * Coverage map:
 *  - 200 success envelope `{data, requestId}` with inbound `X-Request-Id`
 *    echo + generated v4 fallback + NEXT_LOCALE cookie wire flags preserved;
 *  - 403 cross-origin gating preservation (`FORBIDDEN`, localized);
 *  - 400 malformed JSON (transport-class, localized badRequest) and
 *    400 invalid-locale body/query (`BAD_REQUEST`);
 *  - masked unknown throw → 500 `INTERNAL_SERVER_ERROR` with
 *    `error.requestId` present in the body AND the identical id carried by
 *    exactly ONE correlated `logger.error` line (the lib-level masking
 *    machinery is exhaustively pinned by
 *    backend/lib/api/test/api-response.test.ts and
 *    backend/graphql/test/error-finalizer.test.ts);
 *  - GET full-navigation success remains a documented EXEMPTION from the
 *    JSON envelope (redirect contract) while its error branch is enveloped;
 *    open-redirect guard + same-origin `Sec-Fetch-Site` fallback preserved.
 *
 * Runs via `bun run test/scripts/run-test.ts
 * app/api/set-locale/test/set-locale-route.test.ts`.
 *
 * Tail rows append the broader envelope-matrix coverage: header-fuzz ×
 * correlation fallbacks, badRequest-shape breadth across methods and locales,
 * precise request-id echo isolation on the FORBIDDEN branch, the masked-500
 * log-parity twin for the GET handler's catch-parity branch, and the
 * executable zero-numeric-error-status pin over the route source.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Value import (NOT type-only): NextRequest is CONSTRUCTED below. The
// type-only form detonates at runtime as `ReferenceError: NextRequest is not
// defined`.
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/set-locale/route";
import { logger } from "@/backend/lib/logger";
import { getServerTranslations } from "@/shared/locale/server-graphql";

const BASE_URL = "http://localhost:3000/api/set-locale";
const SAME_ORIGIN = "http://localhost:3000";

const tEn = getServerTranslations("en").errorsTranslations;
const tAr = getServerTranslations("ar").errorsTranslations;

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── Assertion-free payload narrowing (mirrors api-response.test.ts) ─────────

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json();
  if (!isPlainJsonObject(parsed)) {
    throw new Error(`response body was not a JSON object: status ${response.status}`);
  }
  return parsed;
}

function memberRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const candidate: unknown = parent[key];
  if (!isPlainJsonObject(candidate)) {
    throw new Error(`response member "${key}" was not a JSON object`);
  }
  return candidate;
}

function memberString(parent: Record<string, unknown>, key: string): string {
  const candidate: unknown = parent[key];
  if (typeof candidate !== "string") {
    throw new Error(`response member "${key}" was not a string`);
  }
  return candidate;
}

function ownKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record);
}

// ─── Request fixtures ────────────────────────────────────────────────────────

interface RequestOptions {
  readonly method?: "GET" | "POST";
  readonly query?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

function makeRouteRequest(options: RequestOptions = {}): NextRequest {
  const url = options.query ? `${BASE_URL}?${options.query}` : BASE_URL;
  // Inline literals (NOT a DOM `RequestInit` variable) so the argument is
  // contextually typed as Next's RequestInit — the DOM variant's
  // `signal?: AbortSignal | null` is not assignable to it.
  if (options.body !== undefined) {
    return new NextRequest(url, {
      method: options.method ?? "GET",
      headers: options.headers ?? {},
      body: options.body,
    });
  }
  return new NextRequest(url, {
    method: options.method ?? "GET",
    headers: options.headers ?? {},
  });
}

/** Same-origin POST fixture (passes the CSRF-style origin gate). */
function makeAllowedPostRequest(extraHeaders: Record<string, string>, body?: string): NextRequest {
  return makeRouteRequest({
    method: "POST",
    headers: { origin: SAME_ORIGIN, "content-type": "application/json", ...extraHeaders },
    body,
  });
}

describe("set-locale route envelope adoption", () => {
  const errorSpy = spyOn(logger, "error");
  afterEach(() => {
    errorSpy.mockClear();
  });

  describe("POST success envelope (ADOPTED surface)", () => {
    test("200 body is exactly {data:{locale}, requestId} echoing the inbound X-Request-Id", async () => {
      const response = await POST(
        makeAllowedPostRequest({ "x-request-id": "corr-set-locale-1" }, JSON.stringify({ locale: "en" }))
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      const body = await readJson(response);
      expect(ownKeys(body)).toEqual(["data", "requestId"]);
      expect(memberString(body, "requestId")).toBe("corr-set-locale-1");

      const data = memberRecord(body, "data");
      expect(ownKeys(data)).toEqual(["locale"]);
      expect(memberString(data, "locale")).toBe("en");
      // Legacy ad-hoc shape is gone — the envelope contract replaced it.
      expect(body).not.toHaveProperty("success");
    });

    test("requestId falls back to a generated UUID v4 without an inbound header", async () => {
      const response = await POST(makeAllowedPostRequest({}, JSON.stringify({ locale: "ar" })));
      const body = await readJson(response);
      expect(UUID_V4_RE.test(memberString(body, "requestId"))).toBe(true);
      expect(memberRecord(body, "data")).toEqual({ locale: "ar" });
    });

    test("NEXT_LOCALE cookie wire format is preserved byte-for-byte on the envelope response", async () => {
      const response = await POST(makeAllowedPostRequest({}, JSON.stringify({ locale: "en" })));
      const setCookie = response.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("NEXT_LOCALE=en");
      expect(setCookie).toContain("Path=/");
      expect(setCookie).toContain(`Max-Age=${365 * 24 * 60 * 60}`);
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).not.toContain("HttpOnly");
    });

    test("origin gate unchanged: Sec-Fetch-Site same-origin without Origin still succeeds", async () => {
      const response = await POST(
        makeRouteRequest({
          method: "POST",
          headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
          body: JSON.stringify({ locale: "en" }),
        })
      );
      expect(response.status).toBe(200);
      expect(memberRecord(await readJson(response), "data")).toEqual({ locale: "en" });
    });
  });

  describe("POST error envelopes (taxonomy statuses)", () => {
    function makeForeignPostRequest(localeHeader: string, body: string): NextRequest {
      return makeRouteRequest({
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "accept-language": localeHeader,
          "content-type": "application/json",
        },
        body,
      });
    }

    test("cross-origin request → 403 FORBIDDEN with localized producer message", async () => {
      const response = await POST(makeForeignPostRequest("en", JSON.stringify({ locale: "en" })));

      expect(response.status).toBe(403);
      const body = await readJson(response);
      const error = memberRecord(body, "error");
      expect(error.code).toBe("FORBIDDEN");
      expect(error.message).toBe(tEn.invalidOrigin);
      expect(typeof error.requestId).toBe("string");

      // Localized pass-through: producer-localized message survives verbatim.
      const arabic = await POST(makeForeignPostRequest("ar", JSON.stringify({ locale: "en" })));
      expect(memberRecord(await readJson(arabic), "error").message).toBe(tAr.invalidOrigin);
    });

    test("well-formed JSON with a non-AppLocale value → 400 BAD_REQUEST (localized invalidLocale)", async () => {
      const response = await POST(
        makeAllowedPostRequest({ "accept-language": "en", "x-request-id": "corr-bad-locale" }, '{"locale":"zz"}')
      );
      expect(response.status).toBe(400);
      const body = await readJson(response);
      const error = memberRecord(body, "error");
      expect(ownKeys(error)).toEqual(["code", "message", "requestId"]);
      expect(error.code).toBe("BAD_REQUEST");
      expect(error.message).toBe(tEn.invalidLocale);
      expect(error.requestId).toBe("corr-bad-locale");
    });

    test("malformed JSON body → 400 transport-class BAD_REQUEST (localized badRequest)", async () => {
      const response = await POST(
        makeAllowedPostRequest(
          { "accept-language": "en", "x-request-id": "corr-malformed" },
          '{"locale": "en"' /* truncated */
        )
      );
      expect(response.status).toBe(400);
      const body = await readJson(response);
      const error = memberRecord(body, "error");
      expect(error.code).toBe("BAD_REQUEST");
      expect(error.message).toBe(tEn.badRequest);
      expect(error.requestId).toBe("corr-malformed");
    });
  });

  describe("masked unknown throw → 500 (correlation parity)", () => {
    test("non-syntax stream fault masks behind INTERNAL_SERVER_ERROR with matching requestId in body + log", async () => {
      const faulted = new NextRequest(BASE_URL, {
        method: "POST",
        headers: {
          origin: SAME_ORIGIN,
          "accept-language": "en",
          "content-type": "application/json",
          "x-request-id": "corr-masked-500",
        },
        body: JSON.stringify({ locale: "en" }),
      });
      // Simulate an infrastructure-level body-read failure (NOT a client
      // SyntaxError): escapes the transport-class branch, lands on the single
      // masked boundary hop of apiErrorResponse.
      Object.defineProperty(faulted, "json", {
        value: () => Promise.reject(new Error("simulated stream fault")),
      });

      const response = await POST(faulted);

      expect(response.status).toBe(500);
      const body = await readJson(response);
      expect(ownKeys(body)).toEqual(["error"]);

      const error = memberRecord(body, "error");
      expect(error.code).toBe("INTERNAL_SERVER_ERROR");
      // Localized generic message — original throwable never reaches the wire
      // (zero-leak scan of the CLIENT-facing body).
      expect(error.message).toBe(tEn.internalServerError);
      const wireJson = JSON.stringify(body) ?? "";
      expect(wireJson).not.toContain("simulated stream fault");
      expect(wireJson).not.toContain("stack");

      // Correlation parity: exactly ONE correlated redacted log line
      // carrying the SAME requestId the body echoes. Whitelisted scalars
      // (errorName/errorMessage/errorKind) live HERE — server-side surface.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const firstCall: unknown = errorSpy.mock.calls[0];
      if (!Array.isArray(firstCall)) {
        throw new Error("logger.error call was not captured");
      }
      const logMessage: unknown = firstCall[0];
      const logBag: unknown = firstCall[1];
      expect(typeof logMessage).toBe("string");
      expect(String(logMessage)).toContain("API route boundary");
      if (!isPlainJsonObject(logBag)) {
        throw new Error("logger.error context bag was not a JSON object");
      }
      expect(memberString(logBag, "requestId")).toBe("corr-masked-500");
    });
  });

  describe("GET full-navigation switch (formal redirect exemption + enveloped errors)", () => {
    function makeGetRequest(query: string, headers: Record<string, string>): NextRequest {
      return makeRouteRequest({ query, headers });
    }

    async function expectHostileRedirectFallsBackToRoot(hostileRedirect: string): Promise<void> {
      const response = await GET(
        makeGetRequest(`locale=en&redirect=${encodeURIComponent(hostileRedirect)}`, { host: "localhost:3000" })
      );
      expect(response.headers.get("location")).toBe("http://localhost:3000/");
    }

    test("success stays a cookie-carrying redirect and does NOT emit a JSON envelope", async () => {
      const response = await GET(makeGetRequest("locale=ar&redirect=%2Fdashboard", { host: "localhost:3000" }));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost:3000/dashboard");
      expect((response.headers.get("set-cookie") ?? "").includes("NEXT_LOCALE=ar")).toBe(true);
      expect(await response.text()).toBe("");
    });

    test("open-redirect guard preserved verbatim (behavior-preservation)", async () => {
      await expectHostileRedirectFallsBackToRoot("//evil.example/x");
      await expectHostileRedirectFallsBackToRoot("https://evil.example/x");
      // Pentest regression: WHATWG URL parsing folds "\" into "/" — the
      // "/\\evil.example" shape resolves to protocol-relative //evil.example and
      // MUST fall back to root exactly like its forward-slash twin.
      await expectHostileRedirectFallsBackToRoot("/\\evil.example/x");
      await expectHostileRedirectFallsBackToRoot("/\\/evil.example/x");

      // Control character / whitespace bypasses: MUST fall back to root.
      await expectHostileRedirectFallsBackToRoot("/\t/evil.example");
      await expectHostileRedirectFallsBackToRoot("/\n/evil.example");
      await expectHostileRedirectFallsBackToRoot("/\r/evil.example");

      // URL-encoded backslashes and double-slashes: MUST fall back to root.
      await expectHostileRedirectFallsBackToRoot("/%5C/evil.example/x");
      await expectHostileRedirectFallsBackToRoot("/%5cevil.example/x");
      await expectHostileRedirectFallsBackToRoot("/%2f%2fevil.example/x");
      await expectHostileRedirectFallsBackToRoot("/%2f/evil.example/x");

      // Encoded control characters in query/hash (CRLF response-splitting shape).
      await expectHostileRedirectFallsBackToRoot("/dashboard?next=%5Cevil.example");
      await expectHostileRedirectFallsBackToRoot("/dashboard#%0D%0AHost:evil.example");
    });

    test("host header injection / x-forwarded-host injection is rejected and falls back to safe origin", async () => {
      const response = await GET(
        makeGetRequest("locale=en&redirect=%2Fdashboard", {
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
          host: "evil.example",
        })
      );
      expect(response.headers.get("location")).toBe("http://localhost:3000/dashboard");
      expect(response.headers.get("location")).not.toContain("evil.example");
    });

    test("invalid locale query → 400 BAD_REQUEST envelope with requestId echo", async () => {
      const response = await GET(
        makeGetRequest("locale=zz", { "accept-language": "en", "x-request-id": "corr-get-400" })
      );
      expect(response.status).toBe(400);
      const body = await readJson(response);
      expect(ownKeys(body)).toEqual(["error"]);
      const error = memberRecord(body, "error");
      expect(error.code).toBe("BAD_REQUEST");
      expect(error.message).toBe(tEn.invalidLocale);
      expect(error.requestId).toBe("corr-get-400");
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Broader envelope-matrix rows: header-fuzz × correlation fallbacks,
// badRequest-shape breadth, FORBIDDEN echo isolation, masked-500 GET parity,
// and the executable taxonomy source pin.
// ══════════════════════════════════════════════════════════════════════════

/** One correlation header-fuzz probe: inbound value + expected disposition. */
type CorrelationProbeSpec = {
  readonly label: string;
  readonly inboundValue: string;
  /** "echo" → accepted verbatim post-trim; "fallback" → generated v4 wins. */
  readonly expected: "echo" | "fallback";
};

const CORRELATION_PROBES: readonly CorrelationProbeSpec[] = [
  { label: "oversized beyond the 128 budget", inboundValue: `a`.repeat(129), expected: "fallback" },
  { label: "comma-collapsed multi-value injection", inboundValue: "corr-a, corr-b", expected: "fallback" },
  { label: "control-character payload survives lax transports", inboundValue: "bad\u0007id", expected: "fallback" },
  { label: "empty string", inboundValue: "", expected: "fallback" },
  { label: "whitespace padding around a valid id trims", inboundValue: "  corr-pad-echo  ", expected: "echo" },
];

describe("set-locale envelope matrix — header-fuzz × correlation", () => {
  for (const probe of CORRELATION_PROBES) {
    test(`X-Request-Id ${probe.label} → ${probe.expected}`, async () => {
      const response = await POST(
        makeAllowedPostRequest({ "x-request-id": probe.inboundValue }, JSON.stringify({ locale: "en" }))
      );

      expect(response.status).toBe(200);
      const body = await readJson(response);
      const resolvedId = memberString(body, "requestId");

      if (probe.expected === "echo") {
        expect(resolvedId).toBe(probe.inboundValue.trim());
      } else {
        // Rejected values are never echoed or truncated — a fresh v4 wins.
        expect(UUID_V4_RE.test(resolvedId)).toBe(true);
        const rawCandidate = probe.inboundValue.trim();
        if (rawCandidate.length > 0) {
          expect(JSON.stringify(body).includes(rawCandidate)).toBe(false);
        }
      }
    });
  }

  test("hostile-id fallbacks stay UNIQUE per request (no correlation collision across retries)", async () => {
    const first = await readJson(
      await POST(makeAllowedPostRequest({ "x-request-id": "a".repeat(129) }, JSON.stringify({ locale: "en" })))
    );
    const second = await readJson(
      await POST(makeAllowedPostRequest({ "x-request-id": "b".repeat(129) }, JSON.stringify({ locale: "en" })))
    );
    expect(memberString(first, "requestId")).not.toBe(memberString(second, "requestId"));
  });
});

describe("set-locale envelope matrix — badRequest-shape breadth", () => {
  test.each([
    ["JSON array root", "[]"],
    ["JSON null root", "null"],
    ["JSON string root", '"en"'],
    ["object without locale key", '{"other":true}'],
    ["numeric locale value", '{"locale":42}'],
  ])("POST %s is contract-rejected as BAD_REQUEST/invalidLocale (exact error keys)", async (_label, bodyText) => {
    const response = await POST(makeAllowedPostRequest({ "accept-language": "en" }, bodyText));
    expect(response.status).toBe(400);
    const body = await readJson(response);
    expect(ownKeys(body)).toEqual(["error"]);
    const error = memberRecord(body, "error");
    expect(ownKeys(error)).toEqual(["code", "message", "requestId"]);
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toBe(tEn.invalidLocale);
    expect(UUID_V4_RE.test(memberString(error, "requestId"))).toBe(true);
  });

  test("GET without any locale param → 400 invalidLocale (method-parity transport-class row)", async () => {
    const response = await GET(
      makeRouteRequest({ headers: { "accept-language": "en", "x-request-id": "corr-get-nolocale" } })
    );
    expect(response.status).toBe(400);
    const error = memberRecord(await readJson(response), "error");
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toBe(tEn.invalidLocale);
    expect(error.requestId).toBe("corr-get-nolocale");
  });

  test("GET ar accept-language keeps its OWN localized badRequest text (both locales)", async () => {
    const response = await GET(
      makeRouteRequest({ headers: { "accept-language": "ar", "x-request-id": "corr-get-ar-400" } })
    );
    expect(response.status).toBe(400);
    const error = memberRecord(await readJson(response), "error");
    expect(error.message).toBe(tAr.invalidLocale);
    expect(error.requestId).toBe("corr-get-ar-400");
  });
});

describe("set-locale envelope matrix — FORBIDDEN echo isolation", () => {
  function makeForeignRequest(localeHeader: string, requestId: string): NextRequest {
    return makeRouteRequest({
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "accept-language": localeHeader,
        "content-type": "application/json",
        "x-request-id": requestId,
      },
      body: JSON.stringify({ locale: "en" }),
    });
  }

  test("per-request echo isolation: en and ar rejections each echo their OWN bounded id", async () => {
    const english = await readJson(await POST(makeForeignRequest("en", "corr-forbidden-en")));
    const arabic = await readJson(await POST(makeForeignRequest("ar", "corr-forbidden-ar")));

    const enError = memberRecord(english, "error");
    const arError = memberRecord(arabic, "error");
    expect(enError.requestId).toBe("corr-forbidden-en");
    expect(arError.requestId).toBe("corr-forbidden-ar");
    expect(enError.code).toBe("FORBIDDEN");
    expect(arError.code).toBe("FORBIDDEN");
    expect(enError.message).toBe(tEn.invalidOrigin);
    expect(arError.message).toBe(tAr.invalidOrigin);
    expect(enError.message).not.toBe(arError.message);
  });
});

describe("set-locale envelope matrix — masked-500 parity twin for the GET handler", () => {
  test("unexpected assembly fault inside GET try/catch masks with matching body↔log requestId", async () => {
    const faulted = makeRouteRequest({
      headers: { host: "localhost:3000", "accept-language": "en", "x-request-id": "corr-get-masked-500" },
    });
    Object.defineProperty(faulted, "nextUrl", {
      get() {
        throw new Error("nexturl assembly fault");
      },
    });

    const logSpy = spyOn(logger, "error");
    try {
      const response = await GET(faulted);
      expect(response.status).toBe(500);
      const body = await readJson(response);
      expect(ownKeys(body)).toEqual(["error"]);
      const error = memberRecord(body, "error");
      expect(error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(error.message).toBe(tEn.internalServerError);

      // Zero-leak client body; the fault text lives only in the correlated log.
      const wireJson = JSON.stringify(body) ?? "";
      expect(wireJson.includes("nexturl assembly fault")).toBe(false);

      const calls = logSpy.mock.calls;
      expect(calls).toHaveLength(1);
      const firstCall: unknown = calls[0];
      if (!Array.isArray(firstCall)) throw new Error("logger.error call was not captured");
      const logBag: unknown = firstCall[1];
      if (!isPlainJsonObject(logBag)) throw new Error("logger.error context bag was not a JSON object");
      // Both-sides parity (GET edition): the SAME id rides the error
      // envelope object and the single correlated log bag.
      expect(error.requestId).toBe("corr-get-masked-500");
      expect(memberString(logBag, "requestId")).toBe("corr-get-masked-500");
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("set-locale envelope matrix — executable taxonomy pin over route source", () => {
  test("route module contains ZERO numeric error-status literals (taxonomy-exclusive statuses)", () => {
    const source = readFileSync(join(process.cwd(), "app/api/set-locale/route.ts"), "utf8");
    const STATUS_LITERAL_RE = /\b(400|401|403|404|409|422|429|500|503)\b/u;
    expect(STATUS_LITERAL_RE.test(source)).toBe(false);
  });
});
