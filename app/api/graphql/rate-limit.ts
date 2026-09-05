/**
 * Rate-limit middleware wrapper for the `/api/graphql` gateway — extracted
 * from `app/api/graphql/route.ts` (oversized-file split). The 429 rejection
 * envelope, fail-open posture, header vocabulary, and the embedded preview
 * CORS echo are behavior-identical to the pre-extraction route; the CORS
 * header application is delegated to `./space-z-cors`.
 */

import { type NextRequest, NextResponse } from "next/server";
import { applySpaceZCorsHeaders } from "@/app/api/graphql/space-z-cors";
import { logger } from "@/backend/lib/logger";
import { checkRateLimit, getClientIdentifier, graphqlRateLimiter } from "@/backend/lib/ratelimit";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Rate-limit middleware wrapper. Fail-open: transient limiter errors never
 * block a legitimate request (mirrors the login cold-start resilience
 * pattern). The stub limiter (`@/backend/lib/ratelimit`) always returns
 * `success: true`; a real Redis-backed limiter lands in a future change.
 *
 * Ordering (preserved from the live pipeline): the limiter runs AFTER the
 * transport guards (junk traffic never consumes limiter state) and BEFORE
 * the engine invocation.
 */
export async function withRateLimit(
  request: NextRequest,
  eventHandler: (req: NextRequest) => Promise<Response>
): Promise<Response> {
  const identifier = getClientIdentifier(request);

  // Deferred security note: a batched-GraphQL-array amplification guard will
  // land with the real limiter. Today only single-op POSTs are enforced
  // (transport-tier guards above reject malformed shapes earlier).

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
