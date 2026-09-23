import type { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";

/**
 * Provider-agnostic request to open a gateway checkout session.
 *
 * Everything an adapter needs to start a payment: the purchaser (for
 * provider-side customer metadata), the purchasable plan identity, and
 * the amount/currency copied verbatim from the freshly-read plan row.
 * Money is carried as decimal strings — never numbers — so no adapter
 * can re-derive or round a price.
 *
 * `specialReference` is the purchase-claim correlation key the purchase
 * flow owns: the adapter sends it to the provider as the merchant-side
 * order reference and the provider echoes it back on every callback, so
 * fulfillment can resolve the pending pair by reference alone. `billing`
 * is the purchaser identity a hosted-checkout provider requires — derived
 * server-side from the user record, never client-supplied; the phone is
 * carried as null when none is on record (placeholder policy belongs to
 * the provider boundary).
 */
export interface PaymentCheckoutInput {
  readonly studentId: number;
  readonly planId: number;
  readonly amount: string;
  readonly currency: string;
  readonly specialReference: string;
  readonly billing: {
    readonly firstName: string;
    readonly lastName: string;
    readonly email: string;
    readonly phone: string | null;
  };
}

/**
 * Checkout descriptor returned by a gateway adapter and surfaced to the
 * purchaser once the pending subscription/payment pair is committed.
 * `checkoutUrl` is nullable: hosted-checkout providers return a redirect
 * URL, while server-side providers (the built-in mock among them)
 * legitimately have none.
 */
export interface PaymentCheckoutSession {
  readonly provider: PaymentGateway;
  readonly providerReference: string;
  readonly checkoutUrl: string | null;
}

/**
 * Normalized gateway webhook outcome, produced by an adapter's webhook
 * parser after transport-level verification (signature, size cap) and
 * handed to the activation service as an already-verified event.
 * `reference` correlates the event with the subscription's stored gateway
 * reference; `amount`/`currency` are the settlement values as decimal
 * strings, compared against the stored payment row — a mismatch
 * quarantines the event and mutates nothing. `providerTransactionId` is
 * the provider's own transaction identifier when the verified callback
 * carries one — recorded on the payment row as the auditable gateway
 * correlation, absent for providers that surface no such id.
 */
export interface PaymentWebhookEvent {
  readonly reference: string;
  readonly outcome: "confirmed" | "failed";
  readonly amount: string;
  readonly currency: string;
  readonly providerTransactionId?: string;
}

/**
 * Everything an adapter's webhook parser needs to verify and normalize one
 * delivery: the raw request body (the exact bytes the transport received —
 * signatures are computed over them) and the request's query parameters as
 * a plain record (providers such as redirect- and query-signed gateways
 * carry the signature and correlation fields in the URL, not the body).
 */
export interface WebhookParseInput {
  readonly rawBody: string;
  readonly query: Record<string, string | undefined>;
}

/**
 * Payment gateway port — the provider-agnostic seam between the billing
 * domain and any gateway implementation. Domain services depend only on
 * this interface, never on a concrete adapter, so swapping the mock for a
 * real provider is a factory configuration change with zero domain-code
 * impact.
 *
 * `parseWebhookEvent` returns the verified event for a delivery that
 * moves money state, and null for a verified-but-ignored delivery (a
 * callback variant this integration deliberately does not settle — token
 * enrollments, refunds, voids, unknown types): the caller acks those like
 * replays so the provider's retry schedule stops, with zero state change.
 */
export interface PaymentGatewayPort {
  createCheckout(input: PaymentCheckoutInput): Promise<PaymentCheckoutSession>;
  parseWebhookEvent(input: WebhookParseInput): PaymentWebhookEvent | null;
}
