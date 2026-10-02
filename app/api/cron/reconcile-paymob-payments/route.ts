/**
 * Pending-payment reconciliation cron entry
 * (`GET /api/cron/reconcile-paymob-payments`).
 *
 * The externally-triggered sweep that heals payments whose settlement
 * callback never arrived: while the active gateway provider is paymob,
 * stuck `pending` payment rows are re-resolved by direct provider
 * inquiry — the same settlement decision the callback path would have
 * made — so a lost delivery cannot strand a purchase forever. The
 * callback receiver stays the primary settlement path (including the
 * provider's own callback retrial); this sweep only heals what retrial
 * could not.
 *
 * The endpoint is a thin shell over
 * `reconcilePendingPaymobPayments` and follows the externally-triggered
 * cron job rules the sessions sweeper established:
 *
 *  - **GET-only** — external schedulers inject
 *    `Authorization: Bearer ${CRON_SECRET}` on GET; Next.js answers every
 *    other verb with its own 405 for routes exporting only GET.
 *  - **Timing-safe bearer compare** against `CRON_SECRET`
 *    (`node:crypto.timingSafeEqual` over fixed-length SHA-256 digests —
 *    never a plain string compare, no length leak, no early exit); a
 *    missing/mismatched secret is a fail-closed 401 through the shared
 *    `UNAUTHORIZED` envelope. The secret is never accepted via query
 *    string.
 *  - **Mode gates fail closed** — the surface answers a BARE 404 unless
 *    BOTH `CRON_EXECUTION_MODE=external` AND
 *    `CRON_EXTERNAL_ENABLED=true`, exactly like the sessions sweeper: a
 *    deployment with externally-triggered jobs disabled exposes no cron
 *    endpoint at all.
 *  - **Provider configuration gate fails closed** — the reconciliation
 *    surface exists only while paymob is the ACTIVE provider AND the
 *    server-to-server API key (the reconciliation inquiry credential)
 *    is configured; anything else answers the SAME bare 404. Like the
 *    404 above, the response is deliberately NOT the shared error
 *    envelope: every envelope carries a `code`, and any code would tell
 *    the caller THIS path exists and is special — the oracle an
 *    unconfigured surface must never leak (a truly unknown path answers
 *    no envelope either). The gate re-reads the typed environment per
 *    request, so a mid-flight provider or key flip is honored on the
 *    very next run. The sweep itself gates identically — the route hides
 *    the endpoint, the service stays honest when invoked from anywhere
 *    else; both sides must agree before any work happens.
 *  - **Envelope** — success
 *    `{ data: { checked, confirmed, failed, skipped }, requestId }`
 *    through `apiSuccessResponse`: the honest per-run tally only, never
 *    row identities. The sweep never throws for provider or outcome
 *    content (unconfigured gates answer zero counts at the service
 *    level; per-row outcomes are counted), so the catch arm is reserved
 *    for true infrastructure breaches — masked through
 *    `apiErrorResponse` (500 `INTERNAL_SERVER_ERROR`) — and the handler
 *    never lets an error escape raw.
 *
 * The route owns no reconciliation logic of its own: the batch bound,
 * the inquiry walk, and the settlement handoff belong to the service.
 */

import type { NextRequest } from "next/server";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import {
  apiErrorResponse,
  apiSuccessResponse,
  cronBearerFromRequest,
  cronUnauthorizedError,
  resolveRequestId,
} from "@/backend/lib/api";
import { getEnv, getPaymentGatewayProvider, getPaymobConfig } from "@/backend/lib/env";
import { reconcilePendingPaymobPayments } from "@/backend/services/billing/payment-gateway/paymob/paymob.reconcile";

/**
 * The ONE status the error-code taxonomy cannot express: the
 * endpoint-shaped 404 of a disabled or unconfigured sweep surface. See
 * the module docblock — deliberately a BARE response (no envelope, no
 * code, no requestId) so the surface is indistinguishable from any
 * other unknown path.
 */
const ENDPOINT_GONE_STATUS = 404;

/** The paymob provider's wire value, held as the plain env string it is compared against. */
const PAYMOB_PROVIDER_VALUE: string = PaymentGateway.Paymob;

/**
 * Whether the reconciliation surface exists for THIS deployment: paymob
 * must be the active provider and the server-to-server API key must be
 * configured. Anything else is an endpoint that does not exist — the
 * bare endpoint-gone 404, with no envelope proving otherwise.
 */
function isReconciliationConfigured(): boolean {
  return getPaymentGatewayProvider() === PAYMOB_PROVIDER_VALUE && getPaymobConfig().apiKey !== null;
}

export async function GET(request: NextRequest): Promise<Response> {
  // The route surface is locale-free: error classification receives the
  // deployment default ("en") — cron callers never render localized copy.
  const requestId = resolveRequestId(request.headers);
  const envelopeLocale = "en";

  // Mode gates FIRST — a disabled cron surface is a BARE 404,
  // indistinguishable from any other unknown path (no envelope, no code —
  // see the docblock), regardless of what credentials accompany the
  // request.
  const executionMode = getEnv("CRON_EXECUTION_MODE");
  const externalEnabled = getEnv("CRON_EXTERNAL_ENABLED");
  if (executionMode !== "external" || externalEnabled !== "true") {
    return new Response(null, { status: ENDPOINT_GONE_STATUS });
  }

  // Provider configuration gate — same bare 404, before the bearer gate:
  // while the reconciliation surface does not exist for this deployment,
  // no credential may prove otherwise.
  if (!isReconciliationConfigured()) {
    return new Response(null, { status: ENDPOINT_GONE_STATUS });
  }

  // Bearer gate — timing-safe compare against CRON_SECRET.
  if (!cronBearerFromRequest(name => request.headers.get(name), getEnv("CRON_SECRET")).ok) {
    return apiErrorResponse(cronUnauthorizedError(), { requestId, locale: envelopeLocale });
  }

  // The sweep owns its batch and its per-row outcomes; a thrown failure
  // is an infrastructure breach (the service never throws for provider
  // or outcome content) — masked through the shared envelope, never a
  // raw escape past the handler.
  try {
    const result = await reconcilePendingPaymobPayments({ now: new Date() });
    return apiSuccessResponse(
      { checked: result.checked, confirmed: result.confirmed, failed: result.failed, skipped: result.skipped },
      { requestId }
    );
  } catch (error: unknown) {
    return apiErrorResponse(error, { requestId, locale: envelopeLocale });
  }
}
