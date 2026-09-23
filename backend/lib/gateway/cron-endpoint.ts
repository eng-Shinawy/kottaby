/**
 * Shared cron sweep-endpoint factory — the gateway envelope every
 * externally-triggered sweep job rides (`app/api/cron/*`).
 *
 * Extracted from the twin route files (`sweep-sessions`, the older
 * sessions sweep, and `expire-subscriptions`, its subscription-expiry
 * sibling) whose envelope bodies were intentionally written line-for-line
 * identical (REQ-020 mirroring doctrine) — the shared factory now guarantees
 * that identity structurally, so the two surfaces cannot drift apart.
 *
 * The contract each route inherits:
 *
 *  - **GET-only** — Vercel Cron / external schedulers inject
 *    `Authorization: Bearer ${CRON_SECRET}` on GET; Next.js answers every
 *    other verb with its own 405 for routes exporting only GET.
 *  - **Rate-limited before the credential compare** — the dedicated
 *    `cron-sweep` limiter namespace (keyed on client IP via the shared
 *    `getClientIdentifier` helper, limits mirroring the graphql limiter's
 *    established defaults) runs AFTER the mode gates and BEFORE the bearer
 *    compare: repeated failed-auth guessing is throttled to a 429
 *    `RATE_LIMIT_EXCEEDED` through the shared envelope (a correct bearer
 *    cannot bypass a spent quota), while a disabled surface's junk traffic
 *    never consumes limiter state.
 *  - **Timing-safe bearer compare** against `CRON_SECRET`
 *    (`node:crypto.timingSafeEqual` over fixed-length SHA-256 digests —
 *    never a plain string compare, no length leak, no early exit); a
 *    missing/mismatched secret is a fail-closed 401 through the shared
 *    `UNAUTHORIZED` envelope. The configured secret is trimmed ONCE at read
 *    time (`getEnv` returns the RAW value), so a whitespace-only config is
 *    treated exactly like an unset one — fail-closed by design, not by
 *    accident. The secret is never accepted via query string.
 *  - **Mode gates fail closed** — the surface answers a BARE 404 unless
 *    BOTH `CRON_EXECUTION_MODE=external` AND `CRON_EXTERNAL_ENABLED=true`.
 *    The 404 is deliberately NOT the shared error envelope: every envelope
 *    carries a `code`, and any code (even a masked one) would tell the
 *    caller THIS path exists and is special — the oracle the disabled
 *    surface must never leak (a truly unknown path answers no envelope
 *    either). The bare response carries no body, no code, no
 *    `requestId`. The status literal is the ONE number the error-code
 *    taxonomy cannot express (its nine canonical codes have no 404 row by
 *    design — REST envelopes never 404) — documented here as the single
 *    sanctioned exemption.
 *  - **Envelope** — success `{ data: <payload>, requestId }` through
 *    `apiSuccessResponse`; a THROWN sweep failure (e.g. an invariant
 *    breach rolling the cohort back) is caught and masked through
 *    `apiErrorResponse` (500 `INTERNAL_SERVER_ERROR` + one correlated log
 *    line) — the handler never lets an error escape raw.
 *  - **Locale-free** — error classification receives the deployment
 *    default ("en"); cron callers never render localized copy.
 *
 * The env gates are read INSIDE the returned handler (never at factory
 * time) so tests can stub `process.env` per invocation.
 */

import type { NextRequest } from "next/server";
import { apiErrorResponse, apiSuccessResponse, resolveRequestId } from "@/backend/lib/api";
import { bearerSecretMatches, cronUnauthorizedError } from "@/backend/lib/api/cron-auth";
import { getEnv } from "@/backend/lib/env";
import { RateLimitExceededError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { checkRateLimit, getClientIdentifier, type RateLimiterConfig } from "@/backend/lib/ratelimit";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * The ONE status the error-code taxonomy cannot express: the endpoint-shaped
 * 404 of a disabled sweep surface. See the module docblock — deliberately a
 * BARE response (no envelope, no code, no requestId) so a disabled
 * deployment is indistinguishable from any other unknown path.
 */
const ENDPOINT_GONE_STATUS = 404;

/**
 * Dedicated rate-limiter namespace for the `app/api/cron/*` sweep surfaces,
 * keyed on client IP. Limits mirror the established graphql limiter defaults
 * (`graphqlRateLimiter` — 100 requests per 60s window); the cron tick cadence
 * (Vercel Cron: at most once per minute) sits far below the quota, so only
 * abusive repeated credential guessing ever trips it.
 */
const cronSweepRateLimiter: RateLimiterConfig = {
  name: "cron-sweep",
  limit: 100,
  windowMs: 60_000,
};

interface CronSweepEndpointConfig<TResult> {
  /**
   * The transactional sweep to run EXACTLY ONCE per authenticated call —
   * the route owns no sweep logic of its own.
   */
  readonly run: () => Promise<TResult>;
  /**
   * The honest-counts payload extracted from the sweep result — zero row
   * identities cross the wire, only the counts.
   */
  readonly payload: (result: TResult) => Record<string, unknown>;
}

/**
 * Builds the GET handler for a cron sweep surface with the full shared
 * envelope (bare-404 kill switch, timing-safe bearer gate, masked
 * success/failure envelopes).
 */
export function createCronSweepEndpoint<TResult>(
  config: CronSweepEndpointConfig<TResult>
): (request: NextRequest) => Promise<Response> {
  return async function GET(request: NextRequest): Promise<Response> {
    const requestId = resolveRequestId(request.headers);
    const envelopeLocale = "en";

    // Mode gates FIRST — a disabled surface is a BARE 404, indistinguishable
    // from any other unknown path (no envelope, no code — see the docblock).
    const executionMode = getEnv("CRON_EXECUTION_MODE");
    const externalEnabled = getEnv("CRON_EXTERNAL_ENABLED");
    if (executionMode !== "external" || externalEnabled !== "true") {
      return new Response(null, { status: ENDPOINT_GONE_STATUS });
    }

    // Rate limiter — the dedicated `cron-sweep` namespace keyed on client IP,
    // BEFORE the secret compare so repeated failed-auth guessing is throttled
    // (a 401 probe consumes limiter state exactly like any other attempt, and
    // a correct bearer cannot bypass a spent quota). Ordering mirrors the
    // graphql limiter doctrine: AFTER the transport-tier mode gates (a
    // disabled surface's junk traffic never consumes limiter state) and
    // BEFORE the credential compare. Fail-open (the established posture): a
    // transient limiter error never blocks a legitimate cron tick.
    const identifier = getClientIdentifier(request);
    const { success } = await checkRateLimit(identifier, cronSweepRateLimiter);
    if (!success) {
      logger.warn(`Rate limit exceeded for ${identifier}`);
      return apiErrorResponse(
        new RateLimitExceededError(getServerTranslations(envelopeLocale).errorsTranslations.rateLimitExceeded),
        { requestId, locale: envelopeLocale }
      );
    }

    // Bearer gate — timing-safe compare against CRON_SECRET. The configured
    // secret is trimmed ONCE into a local: `getEnv` returns the RAW value, so
    // a whitespace-only config would otherwise count as configured yet could
    // never match (the Bearer stripper consumes leading whitespace) —
    // trimmed, a whitespace-only secret is treated exactly like an unset one
    // (fail-closed by design, not by accident). The compare itself stays
    // timing-safe (hash both sides, timingSafeEqual).
    const rawSecret = getEnv("CRON_SECRET");
    const configuredSecret = (rawSecret ?? "").trim();
    const presented = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    if (configuredSecret.length === 0 || !bearerSecretMatches(presented, configuredSecret)) {
      return apiErrorResponse(cronUnauthorizedError(), { requestId, locale: envelopeLocale });
    }

    // The sweep owns its transaction; a thrown failure is masked through
    // the shared envelope — never a raw escape past the handler.
    try {
      const result = await config.run();
      return apiSuccessResponse(config.payload(result), { requestId });
    } catch (error: unknown) {
      return apiErrorResponse(error, { requestId, locale: envelopeLocale });
    }
  };
}
