/**
 * Paymob payment gateway adapter — the `paymob` provider behind the
 * `PaymentGatewayPort`. One class over the port's two operations, built
 * from the sibling modules: the intention/callback mappers translate the
 * domain contracts to and from the vendor wire shapes, the HMAC module
 * verifies every delivery, and the HTTP client carries the outbound calls.
 *
 * Statefulness posture: the adapter holds NOTHING between calls. The
 * provider configuration is re-resolved (and fail-closed narrowed) on
 * every operation through the typed env getter, so a configuration change
 * or a per-request mode flip is observable without a process restart, and
 * no secret or derived value is ever retained. The only constructor
 * dependency is an optional fetch-like transport — the seam tests inject a
 * recording stand-in through; production rides the platform fetch.
 *
 * Checkout semantics: the intention is built from the server-derived
 * input (amount, currency, correlation key, billing identity), POSTed
 * with the secret key, and returned as the checkout descriptor whose
 * reference is the correlation key the provider echoes back on every
 * callback — never the intention id.
 *
 * Webhook semantics: `parseWebhookEvent` is the trust boundary for every
 * callback delivery. The delivery is JSON-parsed and the presented `hmac`
 * query parameter is verified (HMAC-SHA512, timing-safe compare) BEFORE
 * any payload member is trusted; a verification failure is a typed
 * unauthorized rejection the route masks into a 401. Dispatch is by
 * PAYLOAD SHAPE — the vendor does not document its `type` discriminator
 * as guaranteed — with the shape members presence-validated at the
 * boundary:
 *  - a transaction-shaped object (`obj` with boolean `success`) is
 *    verified with the transaction key list; refund/void/parent-transaction
 *    transactions are verified then ignored (no saved-card, refund, or
 *    void scope), everything else maps to the domain event;
 *  - a card-token-shaped object (or a `TOKEN`-typed delivery) is verified
 *    with the token key list and ignored — token enrollment settles
 *    nothing;
 *  - a delivery without a nested object is treated as the flat
 *    response-callback redirect shape: it is verified over the flat query
 *    parameters and ALWAYS ignored — the customer-facing redirect is
 *    display-only by ruling, settlement never trusts it.
 * A delivery that parses but fits no known shape, or that lacks the
 * members its shape must carry, is rejected as malformed (the same masked
 * 400-family rejection the mock adapter's parser raises) rather than
 * guessed at. A verified event that moves money state is returned; every
 * verified-but-ignored variant returns `null` for the caller to ack as a
 * no-op.
 */

import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { getPaymobConfig } from "@/backend/lib/env";
import { DomainError, UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { getCallbackChannel } from "@/backend/services/billing/payment-gateway/callback-channel/callback-channel.factory";
import {
  buildTokenHmacMessage,
  buildTransactionHmacMessage,
  buildTransactionHmacMessageFromQuery,
  verifyPaymobHmac,
} from "@/backend/services/billing/payment-gateway/paymob/paymob.hmac";
import { type PaymobFetch, PaymobHttpClient } from "@/backend/services/billing/payment-gateway/paymob/paymob.http";
import {
  buildIntentionRequest,
  mapCallbackToEvent,
  toCheckoutDescriptor,
} from "@/backend/services/billing/payment-gateway/paymob/paymob.mapper";
import type {
  PaymentCheckoutInput,
  PaymentCheckoutSession,
  PaymentGatewayPort,
  PaymentWebhookEvent,
  PaymobResolvedConfig,
  PaymobTokenCallbackObj,
  PaymobTransactionCallbackObj,
  PaymobTransactionOrder,
  PaymobTransactionSourceData,
  WebhookParseInput,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Locale-free gateway surface: parser rejections use the deployment default. */
const GATEWAY_LOCALE = "en";

/**
 * The checkout line-item label sent with every intention. The port input
 * carries the plan's identity and price but deliberately no display name,
 * and the adapter does not fabricate catalog data it was not handed: the
 * line item exists to satisfy the vendor's sum-of-items rule (its amount
 * equals the total by construction), so it carries the honest category
 * label instead of an invented plan name.
 */
const CHECKOUT_ITEM_NAME = "Subscription";

/** Path of the settlement webhook on the deployment's public origin. */
const WEBHOOK_PATH = "/api/payments/webhook";

/** Path of the post-checkout result page the customer is returned to. */
const CHECKOUT_RESULT_PATH = "/student/checkout/result";

/** Reads the shared localized validation message for parser rejections. */
function localizedValidationMessage(): string {
  return getServerTranslations(GATEWAY_LOCALE).errorsTranslations.validation;
}

/** The malformed-delivery rejection every untrustable parse raises. */
function webhookMalformedError(): ValidationError {
  return new ValidationError("PAYMENT_WEBHOOK_MALFORMED", localizedValidationMessage());
}

/** The failed-verification rejection — same masked deny shape for every tamper variant. */
function webhookUnauthorizedError(): UnauthorizedError {
  return new UnauthorizedError("Invalid payment webhook signature.");
}

/** Narrows an unknown parsed member to a plain object (arrays excluded). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Type guard for the order object embedded in transaction payloads. */
function isTransactionOrder(value: unknown): value is PaymobTransactionOrder {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    (typeof value.merchant_order_id === "string" || value.merchant_order_id === null) &&
    typeof value.amount_cents === "number" &&
    typeof value.currency === "string"
  );
}

/** Type guard for the payment-instrument descriptor of transaction payloads. */
function isTransactionSourceData(value: unknown): value is PaymobTransactionSourceData {
  return (
    isRecord(value) &&
    typeof value.pan === "string" &&
    typeof value.sub_type === "string" &&
    typeof value.type === "string"
  );
}

/**
 * Type guard for a transaction callback object: every member the HMAC
 * message builder walks and the mapper routes on must be present with its
 * documented type. The boolean `success` is the shape discriminator the
 * vendor does not guarantee a `type` member for.
 */
function isTransactionCallbackObj(value: unknown): value is PaymobTransactionCallbackObj {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    typeof value.pending === "boolean" &&
    typeof value.success === "boolean" &&
    typeof value.amount_cents === "number" &&
    typeof value.created_at === "string" &&
    typeof value.currency === "string" &&
    typeof value.error_occured === "boolean" &&
    typeof value.has_parent_transaction === "boolean" &&
    typeof value.integration_id === "number" &&
    typeof value.is_3d_secure === "boolean" &&
    typeof value.is_auth === "boolean" &&
    typeof value.is_capture === "boolean" &&
    typeof value.is_refund === "boolean" &&
    typeof value.is_refunded === "boolean" &&
    typeof value.is_standalone_payment === "boolean" &&
    typeof value.is_void === "boolean" &&
    typeof value.is_voided === "boolean" &&
    typeof value.owner === "number" &&
    typeof value.refunded_amount_cents === "number" &&
    typeof value.captured_amount === "number" &&
    isTransactionOrder(value.order) &&
    isTransactionSourceData(value.source_data)
  );
}

/** Type guard for a card-token callback object: the eight documented signed members. */
function isTokenCallbackObj(value: unknown): value is PaymobTokenCallbackObj {
  return (
    isRecord(value) &&
    typeof value.card_subtype === "string" &&
    typeof value.created_at === "string" &&
    typeof value.email === "string" &&
    typeof value.id === "number" &&
    typeof value.masked_pan === "string" &&
    typeof value.merchant_id === "number" &&
    typeof value.order_id === "string" &&
    typeof value.token === "string"
  );
}

/**
 * Resolves the callback URLs from the deployment's resolved callback
 * channel. ONLY the tunnel channel composes the members: it serves the
 * deployment's webhook receiver at its public tunnel URL (development with
 * an operator-configured reserved domain), and Paymob must call THAT URL
 * for the delivery to land on the local server.
 *
 * The real production channel and the offline simulation channel compose
 * nothing. The real channel's deliveries belong at the callback URL
 * configured on the merchant dashboard — an operator setup step, never a
 * fabricated URL. The simulation channel's public base is the local dev
 * origin (the channel delivers to it itself); attaching it to an intention
 * would hand the real vendor a `http://localhost:<port>` callback URL and
 * override the operator's dashboard configuration, so the members are
 * omitted there too and the vendor falls back to the dashboard URL.
 *
 * The channel is resolved through the callback-channel factory: the
 * notification URL composition is a consumer of the ONE channel resolver
 * (never a per-file tunnel check), and the readiness probe has already
 * been answered by the factory's acquisition.
 */
async function resolveCallbackUrls(): Promise<{ notificationUrl?: string; redirectionUrl?: string }> {
  const channel = await getCallbackChannel();
  if (channel.kind !== "ngrok" || channel.publicBaseUrl === null) {
    return {};
  }
  return {
    notificationUrl: `${channel.publicBaseUrl}${WEBHOOK_PATH}`,
    redirectionUrl: `${channel.publicBaseUrl}${CHECKOUT_RESULT_PATH}`,
  };
}

/**
 * Parses one delivery body into a plain object. Anything unparsable or
 * non-object is the masked malformed rejection — never a guessed shape.
 */
function parseDeliveryBody(rawBody: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw webhookMalformedError();
  }
  if (!isRecord(parsed)) {
    throw webhookMalformedError();
  }
  return parsed;
}

/**
 * Reads the signed `hmac` query member. The provider signs every delivery
 * into the query string (processed POST and response redirect alike), so a
 * delivery without it cannot be verified at all.
 */
function presentedHmacOf(query: Record<string, string | undefined>): string {
  const presentedHmac = query.hmac;
  if (typeof presentedHmac !== "string" || presentedHmac.length === 0) {
    throw webhookMalformedError();
  }
  return presentedHmac;
}

/**
 * Verifies a transaction-shaped object with the transaction key list, then
 * routes it. Refunds, voids, and child transactions of either are verified
 * then ignored: this integration settles first-party card/wallet charges
 * only, and no ignored variant may skip verification. Suppression reads the
 * HMAC-SIGNED state flags (`is_refunded` / `is_voided`) — the vendor signs
 * those, not their unsigned counterparts (`is_refund` / `is_void`), so a
 * suppressed delivery is always attested by the signature itself. A
 * delivery whose order carries no usable `merchant_order_id` cannot be
 * resolved to a purchase at all — rejected as malformed instead of
 * emitting an unrouteable event.
 */
function settleTransactionDelivery(
  obj: PaymobTransactionCallbackObj,
  presentedHmac: string,
  hmacSecret: string
): PaymentWebhookEvent | null {
  if (!verifyPaymobHmac(buildTransactionHmacMessage(obj), presentedHmac, hmacSecret)) {
    throw webhookUnauthorizedError();
  }
  if (obj.is_refunded || obj.is_voided || obj.has_parent_transaction) {
    return null;
  }
  if (obj.order.merchant_order_id === null || obj.order.merchant_order_id.length === 0) {
    throw webhookMalformedError();
  }
  return mapCallbackToEvent(obj);
}

/**
 * Verifies a card-token object with the token key list, then ignores it —
 * saved-card enrollment settles nothing in this integration.
 */
function settleTokenDelivery(obj: PaymobTokenCallbackObj, presentedHmac: string, hmacSecret: string): null {
  if (!verifyPaymobHmac(buildTokenHmacMessage(obj), presentedHmac, hmacSecret)) {
    throw webhookUnauthorizedError();
  }
  return null;
}

/**
 * Verifies the flat response-callback redirect over the flat query
 * parameters, then ALWAYS ignores it — the redirect is display-only, and
 * its `success` parameter never moves money state.
 */
function settleFlatRedirectDelivery(
  query: Record<string, string | undefined>,
  presentedHmac: string,
  hmacSecret: string
): null {
  if (!verifyPaymobHmac(buildTransactionHmacMessageFromQuery(query), presentedHmac, hmacSecret)) {
    throw webhookUnauthorizedError();
  }
  return null;
}

export class PaymobPaymentGateway implements PaymentGatewayPort {
  /** The canonical provider value this adapter resolves for the factory. */
  public readonly provider = PaymentGateway.Paymob;

  /** Optional injected transport (test seam); production uses the platform fetch. */
  private readonly fetchTransport: PaymobFetch | undefined;

  constructor(args: { fetch?: PaymobFetch } = {}) {
    this.fetchTransport = args.fetch;
  }

  /**
   * Opens a hosted-checkout session: builds the intention from the
   * server-derived input, POSTs it through the HTTP client, and returns
   * the checkout descriptor. The provider configuration is resolved
   * fail-closed per request — an incomplete deployment never reaches the
   * network.
   */
  async createCheckout(input: PaymentCheckoutInput): Promise<PaymentCheckoutSession> {
    const config = this.requirePaymobConfig();
    const client = new PaymobHttpClient({ config, fetch: this.fetchTransport });
    const urls = await resolveCallbackUrls();
    const body = buildIntentionRequest({
      input,
      itemName: CHECKOUT_ITEM_NAME,
      config,
      notificationUrl: urls.notificationUrl,
      redirectionUrl: urls.redirectionUrl,
    });
    const response = await client.createIntention(body);
    return toCheckoutDescriptor(response, config, input);
  }

  /**
   * Verifies and normalizes one callback delivery (see the module
   * docblock for the dispatch contract). Throws the typed malformed and
   * unauthorized rejections for untrustable deliveries; returns `null`
   * for verified deliveries this integration deliberately does not settle.
   */
  parseWebhookEvent(input: WebhookParseInput): PaymentWebhookEvent | null {
    const config = this.requirePaymobConfig();

    const parsed = parseDeliveryBody(input.rawBody);
    const presentedHmac = presentedHmacOf(input.query);

    const obj = parsed.obj;
    if (obj !== undefined) {
      if (isTransactionCallbackObj(obj)) {
        return settleTransactionDelivery(obj, presentedHmac, config.hmacSecret);
      }
      if (parsed.type === "TOKEN" || isTokenCallbackObj(obj)) {
        if (!isTokenCallbackObj(obj)) {
          throw webhookMalformedError();
        }
        return settleTokenDelivery(obj, presentedHmac, config.hmacSecret);
      }
      // A nested object that fits neither documented shape cannot be
      // verified against any key list — rejected rather than guessed at.
      throw webhookMalformedError();
    }

    return settleFlatRedirectDelivery(input.query, presentedHmac, config.hmacSecret);
  }

  /**
   * Narrows the typed environment snapshot into the resolved provider
   * configuration, failing closed when any required member is absent —
   * called per operation, never cached, so configuration changes are
   * observable on the next request.
   */
  private requirePaymobConfig(): PaymobResolvedConfig {
    const config = getPaymobConfig();
    if (
      config.secretKey === null ||
      config.publicKey === null ||
      config.hmacSecret === null ||
      config.apiKey === null ||
      config.integrationIdCard === null
    ) {
      throw new DomainError("SERVICE_UNAVAILABLE", "Payment gateway is not configured.");
    }
    return {
      secretKey: config.secretKey,
      publicKey: config.publicKey,
      hmacSecret: config.hmacSecret,
      apiKey: config.apiKey,
      integrationIdCard: config.integrationIdCard,
      integrationIdWallet: config.integrationIdWallet,
      apiBaseUrl: config.apiBaseUrl,
      checkoutBaseUrl: config.checkoutBaseUrl,
      httpTimeoutMs: config.httpTimeoutMs,
    };
  }
}
