/**
 * ctx.idempotencyKey + factory isolation tests — sibling of
 * request-id.test.ts; same anonymous, DB-free harness.
 *
 * Coverage map:
 *  - Tier 1 — the context carries `idempotencyKey` when the header is
 *    present AND materializes as `null` when absent (never `undefined` on the
 *    runtime object); `requestId` keeps its contract in the same
 *    constructions;
 *  - Tier 2 — ABSENT header yields exactly `null`, never `""`; present values
 *    propagate RAW/verbatim (no trim, no validation policy — propagation-only;
 *    classification belongs to the owning mutation transaction);
 *  - Tier 3 — concurrent constructions (distinct pinned keys) produce fully
 *    isolated contexts: unique correlation ids, pairwise-distinct
 *    `authCookieOut` accumulators and cookies objects, keys mapping 1:1 to
 *    their own request;
 *  - Tier 4 — identity IMMUNITY: across hostile/varied key values (empty,
 *    oversized, comma-collapsed, control-char) and even under a garbage
 *    Bearer credential, the identity tuple (`user`,`safeUser`,`role`,
 *    `isSuperAdmin`) stays byte-equal to the headerless baseline — keys can
 *    NEVER influence identity (the non-authorization idempotency contract).
 *
 * Single-capture-site pins: the capture site exists EXACTLY ONCE in
 * gqlContextFactory.ts and ZERO times in the route module.
 *
 * Runs via `bun run test/scripts/run-test.ts backend/graphql/test/context-keys.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type Context, createGraphQLContext, extractLocale } from "@/backend/graphql/gqlContextFactory";

/** Full structural RFC-4122 v4 pin — mirrors request-id.test.ts. */
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("https://draft.local/api/graphql", { method: "POST", headers });
}

function buildAnonymousContext(headers: Record<string, string> = {}): Promise<Context> {
  return createGraphQLContext(requestWithHeaders(headers));
}

/** Module-scope identity projector — the ONLY fields a key must never move. */
interface IdentitySnapshot {
  readonly user: Context["user"];
  readonly safeUser: Context["safeUser"];
  readonly role: Context["role"];
  readonly isSuperAdmin: boolean;
  readonly permissions: unknown[];
}

function identitySnapshot(context: Context): IdentitySnapshot {
  return {
    user: context.user,
    safeUser: context.safeUser,
    role: context.role,
    isSuperAdmin: context.isSuperAdmin,
    permissions: context.permissions,
  };
}

/** Header-pinned key scenarios shared by the propagation/isolation tiers.
 *  NOTE: the fetch-spec Headers layer itself strips leading/trailing
 *  OWS BEFORE the factory runs — probes document the transport-level shape,
 *  not an extra factory policy (interior spaces survive untouched). */
const KEY_PROBES = ["idem-key-alpha", "idem-key-beta", "interior space key", "idem-collide"] as const;

// ─── Tier 1 — presence/absence ───────────────────────────────────────────────

describe("extractLocale fast-path cookie extraction", () => {
  test("extracts locale correctly via parsedCookies and request headers fallback", () => {
    const reqWithCookie = requestWithHeaders({ cookie: "NEXT_LOCALE=ar; session=123" });
    expect(extractLocale(reqWithCookie)).toBe("ar");

    const reqWithParsedCookies = requestWithHeaders({ cookie: "NEXT_LOCALE=ar" });
    expect(extractLocale(reqWithParsedCookies, { NEXT_LOCALE: "ar" })).toBe("ar");

    const reqWithLegacyCookie = requestWithHeaders({ cookie: "next-locale=en" });
    expect(extractLocale(reqWithLegacyCookie, { "next-locale": "en" })).toBe("en");

    // No signal at all ⇒ the API tier's historical default ("en") — this
    // fallback only serves headerless non-browser API clients now, since
    // every BROWSER request carries the explicit x-app-locale header stamped
    // with the SSR shell's rendered locale (mixed-language drift fix).
    const reqDefault = requestWithHeaders({});
    expect(extractLocale(reqDefault, {})).toBe("en");
  });
});

describe("extractLocale — explicit x-app-locale header (shell-locale statement)", () => {
  test("a supported x-app-locale header outranks BOTH the cookie and Accept-Language", () => {
    const req = requestWithHeaders({
      "x-app-locale": "ar",
      cookie: "NEXT_LOCALE=en",
      "accept-language": "en-US,en;q=0.9",
    });
    expect(extractLocale(req)).toBe("ar");
    expect(extractLocale(req, { NEXT_LOCALE: "en" })).toBe("ar");
  });

  test("an UNSUPPORTED x-app-locale value falls through to the cookie negotiation", () => {
    const req = requestWithHeaders({
      "x-app-locale": "fr",
      cookie: "NEXT_LOCALE=en",
      "accept-language": "ar",
    });
    expect(extractLocale(req)).toBe("en");
  });

  test("header lookup is case-insensitive at the transport level (fetch Headers)", () => {
    const req = requestWithHeaders({
      "X-App-Locale": "en",
      cookie: "NEXT_LOCALE=ar",
    });
    expect(extractLocale(req)).toBe("en");
  });
});

describe("ctx.idempotencyKey — Tier 1 presence semantics", () => {
  test("present header crosses onto the context VERBATIM alongside its sibling id", async () => {
    const context = await buildAnonymousContext({ "X-Idempotency-Key": "tier1-present", "X-Request-Id": "tier1-corr" });
    expect(context.idempotencyKey).toBe("tier1-present");
    expect(context.requestId).toBe("tier1-corr");
  });

  test("header lookup stays case-insensitive at the transport level", async () => {
    const context = await buildAnonymousContext({ "x-iDeMpOtEnCy-kEy": "mixed-case-idem" });
    expect(context.idempotencyKey).toBe("mixed-case-idem");
  });

  test("ABSENT header still MATERIALIZES the field (runtime null, not undefined)", async () => {
    const context = await buildAnonymousContext();
    expect("idempotencyKey" in context).toBe(true);
    expect(context.idempotencyKey).toBeNull();
    expect(context.idempotencyKey === undefined).toBeFalse();
  });

  test("requestId contract is untouched by the extension (UUID v4 when absent)", async () => {
    const context = await buildAnonymousContext({ "X-Idempotency-Key": "request-id-sanity" });
    expect(UUID_V4_PATTERN.test(context.requestId)).toBe(true);
  });
});

// ─── Tier 2 — null-not-empty + raw propagation purity ───────────────────────

describe("ctx.idempotencyKey — Tier 2 null contract & propagation purity", () => {
  test("absent header is exactly null — never empty-string-coalesced", async () => {
    const context = await buildAnonymousContext({});
    expect(context.idempotencyKey).toBeNull();
    expect(context.idempotencyKey).not.toBe("");
    expect(context.idempotencyKey?.length ?? 0).toBe(0);
  });

  test.each([
    ["INTERIOR whitespace survives byte-exact (no in-factory rewriting)", "keep  my  value", undefined],
    ["empty-string VALUE propagates verbatim (policy-free)", "", undefined],
    ["edge padding reaches the factory already OWS-stripped by the fetch layer", "  pad-me  ", "pad-me"],
  ] as const)("%s", async (_label, wireValue, expectedValue) => {
    const context = await buildAnonymousContext({ "x-idempotency-key": wireValue });
    // The expectation equals the value AS DELIVERED to createGraphQLContext:
    // edge-padding loss is fetch-spec header normalization ABOVE this layer,
    // not a factory-side policy decision.
    expect(context.idempotencyKey).toBe(expectedValue ?? wireValue);
  });
});

// ─── Tier 3 — concurrent construction isolation ──────────────────────────────

describe("ctx.idempotencyKey — Tier 3 concurrent factory isolation", () => {
  test("parallel distinct-user-ish constructions keep ids, keys and accumulators fully isolated", async () => {
    const contexts = await Promise.all(KEY_PROBES.map(key => buildAnonymousContext({ "X-Idempotency-Key": key })));

    // 1:1 key attribution — no cross-wiring between parallel requests.
    const resolvedKeys = contexts.map(entry => entry.idempotencyKey);
    expect(resolvedKeys).toEqual([...KEY_PROBES]);

    // Correlation ids stay unique and structurally valid (no shared counter).
    const ids = contexts.map(entry => entry.requestId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => UUID_V4_PATTERN.test(id))).toBe(true);

    // Per-request accumulator/object identity — independence proof.
    for (let i = 0; i < contexts.length; i++) {
      for (let j = i + 1; j < contexts.length; j++) {
        const left = contexts[i];
        const right = contexts[j];
        if (!left || !right) throw new Error("context row missing");
        expect(left.authCookieOut).not.toBe(right.authCookieOut);
        expect(left.cookies).not.toBe(right.cookies);
      }
    }
  });
});

// ─── Tier 4 — identity immunity (keys can NEVER influence identity) ──────────

describe("ctx.idempotencyKey — Tier 4 identity-immunity matrix", () => {
  const HOSTILE_KEYS = [
    { label: "plain key", headers: { "x-idempotency-key": "identity-try-1" } },
    { label: "oversized 10× budget key", headers: { "x-idempotency-key": "k".repeat(1280) } },
    { label: "comma-collapsed multi-value key", headers: { "x-idempotency-key": "a,b,c" } },
    { label: "control-character smuggled key", headers: { "x-idempotency-key": "bad\u0007key" } },
  ] as const;

  const BASELINE_HEADERS: Record<string, string> = {};

  test("identity stays identical to the headerless baseline across ALL key variants", async () => {
    const baselineSnapshot = identitySnapshot(await buildAnonymousContext(BASELINE_HEADERS));

    // Parallel constructions (no await-in-loop): every variant lands, THEN
    // each snapshot is compared against the headerless baseline.
    const contexts = await Promise.all(HOSTILE_KEYS.map(probe => buildAnonymousContext({ ...probe.headers })));

    for (const [index, context] of contexts.entries()) {
      expect(identitySnapshot(context)).toEqual(baselineSnapshot); // key variance moved NOTHING
      expect(context.user).toBeNull();
      expect(context.role).toBeNull();
      expect(context.isSuperAdmin).toBe(false);
      expect(HOSTILE_KEYS[index]?.label).toBeString(); // probe bookkeeping sanity
    }
  });

  test("even WITH a (garbage) bearer credential, key variance cannot flip identity", async () => {
    const buildWithBearer = (keyHeader: string | undefined): Promise<IdentitySnapshot> => {
      const headers: Record<string, string> = { authorization: "Bearer garbage.token.value" };
      if (keyHeader !== undefined) {
        headers["x-idempotency-key"] = keyHeader;
      }
      return buildAnonymousContext(headers).then(identitySnapshot);
    };

    const [withoutKey, withNeutralKey, withElevatedLookingKey] = await Promise.all([
      buildWithBearer(undefined),
      buildWithBearer("neutral"),
      buildWithBearer("role=admin&grant=superuser"),
    ]);
    if (!withoutKey || !withNeutralKey || !withElevatedLookingKey) throw new Error("snapshot row missing");

    expect(withNeutralKey).toEqual(withoutKey);
    expect(withElevatedLookingKey).toEqual(withoutKey);
    // Verify-token failure falls through to anonymous — never to a usable ctx.
    expect(withoutKey.user).toBeNull();
    expect(withoutKey.role).toBeNull();
    expect(withoutKey.isSuperAdmin).toBe(false);
  });
});

// ─── Semantic pins — single capture site ─────────────────────────────────────

/** Comment-stripped view so literal-count pins measure CODE sites only. */
function codeView(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split("\n")
    .filter(line => !line.trim().startsWith("//"))
    .join("\n");
}

describe("factory semantic pins — no duplicated idempotency capture", () => {
  const factorySource = codeView(readFileSync(new URL("../gqlContextFactory.ts", import.meta.url), "utf8"));
  const routeSource = codeView(readFileSync(new URL("../../../app/api/graphql/route.ts", import.meta.url), "utf8"));

  test("the X-Idempotency-Key capture site lives EXACTLY ONCE — inside the factory", () => {
    expect(factorySource.split('headers.get("x-idempotency-key")').length - 1).toBe(1);
    // Route-side has ZERO second capture points (no parallel helper).
    expect(routeSource.includes("x-idempotency-key")).toBe(false);
  });

  test("requestId discipline survived the edit untouched (single-resolution pins re-asserted)", () => {
    expect(factorySource.split("resolveRequestId(").length - 1).toBe(1);
    expect(factorySource.includes("randomUUID")).toBe(false);
    expect(factorySource.includes('from "@/backend/lib/api"')).toBe(true);
  });

  test("authCookieOut/governance/refresh substrate imports unchanged (no fork surface)", () => {
    expect(factorySource.includes('from "@/backend/lib/auth/cookies"')).toBe(true);
    expect(factorySource.includes("verifyAccessToken(")).toBe(true);
    expect(factorySource.includes("UserRepository.findById")).toBe(true);
  });
});
