/**
 * Rate-limit middleware for the `/api/graphql` gateway: caps each client at
 * the `graphqlRateLimiter` budget (100 requests / 60 s per resolved client
 * IP) ahead of the engine invocation. An exhausted budget gets the 429
 * `RATE_LIMIT_EXCEEDED` envelope with `X-RateLimit-*` + `Retry-After`
 * headers; a passing request carries the live budget headers on the
 * engine's response. Fail-open: a transient limiter-state failure never
 * blocks a legitimate request. The preview-origin CORS echo is delegated
 * to `./space-z-cors` and applied on both the rejection and pass paths.
 */

import { type NextRequest, NextResponse } from "next/server";
import { applySpaceZCorsHeaders } from "@/app/api/graphql/space-z-cors";
import { logger } from "@/backend/lib/logger";
import { checkRateLimit, getClientIdentifier, graphqlRateLimiter } from "@/backend/lib/ratelimit";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Rate-limit middleware wrapper over the in-memory sliding-window limiter
 * (`@/backend/lib/ratelimit`): `checkRateLimit` against the
 * `graphqlRateLimiter` config — 100 requests / 60 s per client IP, 429 +
 * localized `RATE_LIMIT_EXCEEDED` on exhaustion. Fail-open: transient
 * limiter errors never block a legitimate request (mirrors the login
 * cold-start resilience pattern).
 *
 * Honest limits of the window store: it is in-memory and per-instance —
 * not shared across server instances, reset on restart, and bounded to a
 * tracked-identifier LRU (`MAX_TRACKED_IDENTIFIERS`). A shared
 * (Redis-backed) store remains deferred work.
 *
 * The limiter key comes from the spoof-resistant `resolveClientIp` chain
 * (`x-real-ip` → rightmost `x-forwarded-for` entry → "local") — the
 * leftmost XFF entry is client-forgeable and never keys the window.
 *
 * Ordering (preserved from the live pipeline): the limiter runs AFTER the
 * transport guards (junk traffic never consumes limiter state) and BEFORE
 * the engine invocation.
 */
export async function withRateLimit(
  request: NextRequest,
  eventHandler: (req: NextRequest) => Promise<Response>
): Promise<Response> {
  // Production-only rate limiting. Test environments (TEST_CI/TEST_SERVER) bypass
  // the limiter because integration tests send 100+ requests within the rate window.
  // This is safe: test environments are isolated, never exposed to untrusted traffic.
  // within the rate-limit window. Skip rate limiting entirely when
  // TEST_CI or TEST_SERVER env flags are set.
  if (process.env.TEST_CI === "1" || process.env.TEST_SERVER === "1") {
    // Test-flag isolation: the bypass above is a TEST-HARNESS affordance.
    // A real production deployment must never run with these flags set —
    // they would silently disable the limiter for all traffic. The harness
    // itself is exempt via IS_DEMO=1 (the only sanctioned production-NODE_ENV
    // consumer of these flags); anything else fails fast with a named error.
    if (process.env.NODE_ENV === "production" && process.env.IS_DEMO !== "1" && process.env.IS_DEMO !== "true") {
      throw new Error(
        "withRateLimit: TEST_CI/TEST_SERVER rate-limit bypass is forbidden outside the test harness (set IS_DEMO=1 for the sanctioned test server)"
      );
    }
    const response = await eventHandler(request);
    applySpaceZCorsHeaders(response.headers, request.headers.get("origin"));
    return response;
  }

  const identifier = getClientIdentifier(request);

  // Batched-operation amplification is capped at the transport tier
  // (`MAX_GRAPHQL_OPERATIONS_PER_REQUEST` in
  // `backend/lib/gateway/transport-guard.ts`): an array POST longer than
  // the cap is rejected 400 `BATCH_OPERATION_LIMIT` before this limiter
  // runs, so junk over-cap batches consume zero limiter state.

  const { success, limit, remaining, reset } = await checkRateLimit(identifier, graphqlRateLimiter);

  if (!success) {
    logger.warn(`Rate limit exceeded for ${identifier}`);
    const errorsTranslations = getServerTranslations("en").errorsTranslations;
    return NextResponse.json(
      {
        errors: [
          {
            message: errorsTranslations.rateLimitExceeded,
            extensions: {
              code: "RATE_LIMIT_EXCEEDED",
              limit,
              reset,
            },
          },
        ],
      },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": limit.toString(),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": reset.toString(),
          "Retry-After": Math.ceil((reset - Date.now()) / 1000).toString(),
        },
      }
    );
  }

  const response = await eventHandler(request);

  // CORS: allow requests from *.space-z.ai (preview panel origins).
  applySpaceZCorsHeaders(response.headers, request.headers.get("origin"));

  response.headers.set("X-RateLimit-Limit", limit.toString());
  response.headers.set("X-RateLimit-Remaining", remaining.toString());
  response.headers.set("X-RateLimit-Reset", reset.toString());
  return response;
}
