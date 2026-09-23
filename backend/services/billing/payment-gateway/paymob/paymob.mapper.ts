/**
 * Paymob intention/callback mappers — pure functions over explicitly passed
 * arguments: no environment reads, no I/O, no logging, no module state. The
 * adapter resolves the configuration and callback URLs itself and passes
 * them in, so these functions stay deterministic and directly testable.
 * The amount guard's rejection copy is the one deliberate import: the
 * compile-time translation bundle is a pure in-memory lookup (no env, no
 * I/O), so determinism holds — user-facing money rejections localize like
 * every other purchase denial.
 *
 * Money crosses this boundary as integer minor units: the provider's
 * intention API carries amounts in cents (`amount`, `items[].amount`, and
 * the sum of item amounts must equal the total), so the decimal string the
 * domain uses is converted here under a strict shape guard — a non-negative
 * decimal with at most two fraction digits whose cent value stays within
 * the safe integer range. The checkout line item is built from the same
 * conversion, so the sum rule holds by construction.
 *
 * The provider requires the billing block's first/last name and email and
 * rejects deliveries without a phone number, while the domain carries only
 * the server-derived purchaser identity (phone nullable). Unknown or empty
 * members are therefore filled with the integration's `"NA"` placeholder
 * convention, and the address members the domain does not carry at all are
 * placeholder-filled outright — no contact or address data is fabricated.
 *
 * The hosted-checkout URL is assembled from the configured checkout prefix
 * plus exactly the two documented query parameters (`publicKey`,
 * `clientSecret`) — the prefix is a full host(+path) value owned by the
 * configuration, so no path is appended here.
 */

import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { DomainError, ValidationError } from "@/backend/lib/errors";
import type {
  PaymentCheckoutInput,
  PaymentCheckoutSession,
  PaymentWebhookEvent,
  PaymobBillingData,
  PaymobIntentionRequest,
  PaymobIntentionResponse,
  PaymobProcessedCallbackBody,
  PaymobResolvedConfig,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Placeholder the integration fills unknown billing members with. */
const BILLING_PLACEHOLDER = "NA";

/**
 * Fixed, generic descriptor-validation messages — the upstream response
 * body never enters an error message (the adapter logs the sanitized
 * upstream status instead).
 */
const INCOMPLETE_CHECKOUT_MESSAGE = "Payment provider returned an incomplete checkout session.";
const CHECKOUT_MISMATCH_MESSAGE = "Payment provider returned a checkout session that does not match the request.";

/** Matches a non-negative decimal string with at most two fraction digits. */
const DECIMAL_AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Locale-free gateway surface: the amount-guard rejections use the
 * deployment default, mirroring the adapter's parser-rejection idiom — the
 * purchase mutation carries the request locale to the checkout call, but
 * the guard copy is not request-parameterized (same `GATEWAY_LOCALE`
 * discipline the sibling adapter's `localizedValidationMessage` follows).
 */
const GATEWAY_LOCALE = "en";

/** Reads the shared localized purchase-rejection copy for the guard. */
function localizedPurchaseRejections(): {
  planPriceShapeInvalid: string;
  planPriceOutOfRange: string;
} {
  const subscriptionPurchase = getServerTranslations(GATEWAY_LOCALE).errorsTranslations.subscriptionPurchase;
  return {
    planPriceShapeInvalid: subscriptionPurchase.planPriceShapeInvalid,
    planPriceOutOfRange: subscriptionPurchase.planPriceOutOfRange,
  };
}

/**
 * Converts a decimal money string into integer cents. Fraction digits
 * beyond two, non-numeric shapes, signs, and values whose cent amount
 * exceeds the safe integer range are rejected before any network call with
 * the localized purchase-rejection copy (the same compile-time `errors`
 * bundle the purchase mutation's other denials use).
 */
function convertAmountToCents(amount: string): number {
  if (!DECIMAL_AMOUNT_PATTERN.test(amount)) {
    throw new ValidationError(localizedPurchaseRejections().planPriceShapeInvalid);
  }
  const [wholePart, fractionPart = ""] = amount.split(".");
  const cents = Number(wholePart) * 100 + Number(fractionPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) {
    throw new ValidationError(localizedPurchaseRejections().planPriceOutOfRange);
  }
  return cents;
}

/**
 * Trims one server-derived billing member and falls back to the `"NA"`
 * placeholder when nothing usable is on record (absent, empty, or
 * whitespace-only).
 */
function billingValueOrPlaceholder(value: string | null): string {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return BILLING_PLACEHOLDER;
  }
  return trimmed;
}

/**
 * Builds the provider's billing block from the server-derived purchaser
 * identity. Name/email/phone come from the record; every address member is
 * the placeholder because the domain carries no address data.
 */
function buildBillingData(billing: PaymentCheckoutInput["billing"]): PaymobBillingData {
  return {
    first_name: billingValueOrPlaceholder(billing.firstName),
    last_name: billingValueOrPlaceholder(billing.lastName),
    email: billingValueOrPlaceholder(billing.email),
    phone_number: billingValueOrPlaceholder(billing.phone),
    apartment: BILLING_PLACEHOLDER,
    street: BILLING_PLACEHOLDER,
    building: BILLING_PLACEHOLDER,
    city: BILLING_PLACEHOLDER,
    country: BILLING_PLACEHOLDER,
    floor: BILLING_PLACEHOLDER,
    state: BILLING_PLACEHOLDER,
  };
}

/**
 * Builds the payment-method list: the card integration is always offered;
 * the wallet integration joins it only when configured (a wallet
 * deployment is an operator choice, not a requirement).
 */
function buildPaymentMethods(config: PaymobResolvedConfig): number[] {
  const methods = [config.integrationIdCard];
  if (config.integrationIdWallet !== null) {
    methods.push(config.integrationIdWallet);
  }
  return methods;
}

/**
 * Builds the `POST v1/intention/` request body for one plan purchase: the
 * total and its single line item share one cents conversion, the
 * configured integration IDs ride as integers, the correlation key is sent
 * verbatim as `special_reference`, and the callback URLs ride only when
 * the caller resolved them — omitted otherwise, in which case the vendor
 * falls back to the callback URL configured on the merchant dashboard.
 */
export function buildIntentionRequest(args: {
  input: PaymentCheckoutInput;
  itemName: string;
  config: PaymobResolvedConfig;
  notificationUrl?: string;
  redirectionUrl?: string;
}): PaymobIntentionRequest {
  const amountCents = convertAmountToCents(args.input.amount);
  return {
    amount: amountCents,
    currency: args.input.currency,
    payment_methods: buildPaymentMethods(args.config),
    items: [{ name: args.itemName, amount: amountCents, quantity: 1 }],
    billing_data: buildBillingData(args.input.billing),
    special_reference: args.input.specialReference,
    ...(args.notificationUrl !== undefined && { notification_url: args.notificationUrl }),
    ...(args.redirectionUrl !== undefined && { redirection_url: args.redirectionUrl }),
  };
}

/**
 * Validates the intention response against the original request and builds
 * the checkout descriptor. The response crosses the network boundary, so
 * its identity members are trusted only when present AND only when they
 * echo the request: the intention id, the hosted-checkout secret, and the
 * echoed `special_reference` must all be usable, and the echoed
 * correlation key plus the `intention_detail` amount/currency must match
 * the request verbatim — a response lacking or mismatching them pairs
 * another intention's checkout secret with this purchase's correlation
 * key, so it is a provider failure surfaced as a domain error (the
 * existing incomplete-session rejection for missing members; the
 * mismatched-echo rejection for divergent ones — the adapter logs the
 * sanitized upstream status; the upstream body is never rethrown). The
 * descriptor's reference is the correlation key the adapter sent as
 * `special_reference` — NOT the intention id — because fulfillment
 * resolves purchases by that echoed reference alone.
 */
export function toCheckoutDescriptor(
  response: PaymobIntentionResponse,
  config: PaymobResolvedConfig,
  request: PaymentCheckoutInput
): PaymentCheckoutSession {
  if (
    typeof response.id !== "string" ||
    response.id.length === 0 ||
    typeof response.client_secret !== "string" ||
    response.client_secret.length === 0
  ) {
    throw new DomainError("SERVICE_UNAVAILABLE", INCOMPLETE_CHECKOUT_MESSAGE);
  }
  const cents = convertAmountToCents(request.amount);
  if (
    response.special_reference !== request.specialReference ||
    response.intention_detail.amount !== cents ||
    response.intention_detail.currency !== request.currency
  ) {
    throw new DomainError("SERVICE_UNAVAILABLE", CHECKOUT_MISMATCH_MESSAGE);
  }
  return {
    provider: PaymentGateway.Paymob,
    providerReference: request.specialReference,
    // Query members are percent-encoded: both values are trusted sources
    // today, but an opaque `client_secret` carrying `&`/`#`/`?` must never
    // split or grow attacker-shaped parameters on the hosted-checkout URL.
    checkoutUrl: `${config.checkoutBaseUrl}?publicKey=${encodeURIComponent(config.publicKey)}&clientSecret=${encodeURIComponent(response.client_secret)}`,
  };
}

/**
 * Normalizes a verified processed-callback transaction object into the
 * domain webhook event, or `null` when the delivery must not terminate the
 * local payment: a transaction still flagged `pending` has not moved money,
 * so returning `null` keeps the payment open for the later confirmed
 * callback instead of marking it failed. The correlation reference is the
 * echo of the intention's `special_reference`
 * (`order.merchant_order_id`). Only a terminal successful transaction
 * confirms — a declined one fails. The provider's cents amount becomes a
 * two-fraction-digit decimal string, and the transaction id is carried as
 * its string form.
 */
export function mapCallbackToEvent(obj: PaymobProcessedCallbackBody["obj"]): PaymentWebhookEvent | null {
  if (obj.pending) {
    return null;
  }
  return {
    reference: obj.order.merchant_order_id ?? "",
    outcome: obj.success ? "confirmed" : "failed",
    amount: (obj.amount_cents / 100).toFixed(2),
    currency: obj.currency,
    providerTransactionId: String(obj.id),
  };
}
