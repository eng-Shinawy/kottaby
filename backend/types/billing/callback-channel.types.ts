import type { PaymentWebhookEvent } from "@/backend/types/billing/payment-gateway.types";

/**
 * Callback delivery channel contract — the single source of truth for how a
 * provider callback reaches this deployment's webhook receiver.
 *
 * Production deliveries arrive at the operator-configured public URL, but
 * local development cannot receive them there: the receiver runs on
 * localhost, unreachable from the provider. The channel abstraction names
 * that gap explicitly so every consumer (intention URL composition, dev
 * tooling, workflow tests) consults ONE resolver instead of scattering
 * per-file tunnel heuristics:
 *
 *  - `real` — production (and any non-paymob deployment): the provider posts
 *    to the public URL configured in the merchant dashboard; this deployment
 *    owns no delivery infrastructure, so `publicBaseUrl` is null.
 *  - `ngrok` — development with an operator-configured reserved ngrok domain
 *    and a reachable tunnel: callbacks travel through the public tunnel URL
 *    down to the local dev server.
 *  - `simulation` — every other development case: signed synthetic Paymob
 *    callbacks are delivered straight to the local webhook receiver, keeping
 *    the full verification and fulfillment pipeline exercisable offline.
 */
export type CallbackChannelKind = "real" | "ngrok" | "simulation";

/**
 * One synthetic settlement delivery request for the development-only test
 * surface of a channel. `reference` is the merchant-side correlation key the
 * purchase flow minted (`order.merchant_order_id` on a Paymob callback);
 * `amount` and `currency` are the settlement values as decimal strings — the
 * same shape a verified callback normalizes into — so a synthetic delivery
 * passes the same amount/quarantine checks as a real one. `outcome` reuses
 * the webhook event's settlement outcome vocabulary by design.
 */
export interface SimulatedCallbackDelivery {
  readonly reference: string;
  readonly outcome: PaymentWebhookEvent["outcome"];
  readonly amount: string;
  readonly currency: string;
}

/**
 * A callback delivery channel. `publicBaseUrl` is the base URL under which
 * this deployment's webhook receiver is reachable from the OUTSIDE when the
 * channel itself provides one (a tunnel's public domain, the local dev
 * server for offline simulation); the real production channel carries null
 * because the dashboard URL is operator-configured provider-side.
 *
 * `ensureReady()` makes the channel's delivery path usable — starting a
 * tunnel, probing the local receiver — and is idempotent. It is the explicit
 * readiness step for channels whose infrastructure needs one; consumers that
 * only read `publicBaseUrl` may skip it.
 *
 * `deliverTestCallback` is a development-only surface (present on the
 * simulation and tunnel channels) for driving the confirm/fail/replay and
 * cross-user scenarios through the REAL verification and fulfillment
 * pipeline. The real channel answers it with a fail-closed domain error, so
 * a production caller can never misuse it into synthesizing settlements.
 */
export interface CallbackChannelPort {
  readonly kind: CallbackChannelKind;
  readonly publicBaseUrl: string | null;
  ensureReady(): Promise<void>;
  deliverTestCallback?(delivery: SimulatedCallbackDelivery): Promise<void>;
}
