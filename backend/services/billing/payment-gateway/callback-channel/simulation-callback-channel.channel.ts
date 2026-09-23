import { createHmac } from "node:crypto";

import { DomainError, ValidationError } from "@/backend/lib/errors";
import { buildTransactionHmacMessage } from "@/backend/services/billing/payment-gateway/paymob/paymob.hmac";
import type {
  CallbackChannelKind,
  CallbackChannelPort,
  PaymobProcessedCallbackBody,
  SimulatedCallbackDelivery,
} from "@/backend/types";

/**
 * Simulation callback channel — the fully implemented development default.
 *
 * When no tunnel serves the local dev server, this channel keeps the ENTIRE
 * callback pipeline live offline: it synthesizes a Paymob-shaped processed
 * callback (the nested `obj` carrying every documented signed member), signs
 * it with the PRODUCTION HMAC message builder under the configured
 * `PAYMOB_HMAC_SECRET`, and POSTs it as `?hmac=<digest>` to the local
 * webhook receiver — the exact wire shape a real provider delivery takes, so
 * the delivery passes the same signature gate, normalization, amount
 * quarantine, and once-only guarded transition as production traffic. There
 * is deliberately NO parallel signer: the production builder is the only
 * message implementation involved.
 *
 * Determinism is a feature: synthesis derives every value from the delivery
 * arguments alone (no clock, no randomness), so delivering the same
 * arguments twice reproduces byte-identical bodies and signatures — the
 * provider's duplicate-delivery semantics — while distinct references yield
 * distinct transaction ids. Cross-user scenarios are driven the same way:
 * purchase as different test users, then deliver each payment's reference.
 *
 * The channel is reachable only outside production runtimes. The factory
 * never selects it there, and a fail-closed runtime guard inside both public
 * methods throws if it is ever invoked anyway.
 */

/** Query parameter the paymob provider signs every delivery into. */
const HMAC_QUERY_PARAM = "hmac";

/** Local route segments the channel posts and probes against. */
const WEBHOOK_PATH = "/api/payments/webhook";
const HEALTH_PATH = "/api/health";

/**
 * Outbound transport for the local dev-server surfaces — injectable for the
 * same reason the provider HTTP client's transport is: tests and tooling
 * drive the channel without touching the network.
 */
export type SimulationSurfaceFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Default transport: the runtime's global fetch. */
const defaultSurfaceFetch: SimulationSurfaceFetch = (url, init) => globalThis.fetch(url, init);

/**
 * Fixed timestamp of every synthesized transaction: determinism outranks
 * realism — the receiver never routes on `created_at`, and a constant keeps
 * replays byte-identical.
 */
const SIMULATED_CREATED_AT = "2026-09-13T10:11:12.123456";

/** Synthetic-but-plausible constants for members the receiver ignores. */
const SIMULATED_INTEGRATION_ID = 46511;
const SIMULATED_OWNER_ID = 21750;
const SIMULATED_ORDER_ID = 378804;
const SIMULATED_CARD_PAN = "2346";
const SIMULATED_CARD_SUB_TYPE = "MasterCard";
const SIMULATED_CARD_TYPE = "card";

/**
 * Configuration resolved once by the factory — the channel itself never
 * reads the environment. `hmacSecret` is the configured Paymob HMAC secret
 * (null when unset: deliveries then fail closed with a typed error instead
 * of signing with an empty key); `localBaseUrl` is the dev-server base the
 * receiver answers on; `probeTimeoutMs` bounds every outbound request;
 * `fetch` optionally overrides the outbound transport.
 */
export interface SimulationCallbackChannelConfig {
  readonly hmacSecret: string | null;
  readonly localBaseUrl: string;
  readonly probeTimeoutMs: number;
  readonly fetch?: SimulationSurfaceFetch;
}

/** One signed synthetic processed-callback delivery, ready to POST. */
export interface SimulatedCallbackPayload {
  readonly body: PaymobProcessedCallbackBody;
  /** Lowercase-hex HMAC-SHA512 over the body's documented signed key order. */
  readonly hmac: string;
}

/**
 * Decimal-amount validation for delivery arguments: non-negative, at most
 * two fraction digits — the same budget the plan price enforces, so the
 * cents round-trip through the receiver's normalization is exact. The
 * pattern alone allows arbitrarily large values, so the conversion below
 * additionally fails closed on amounts whose cents exceed the safe-integer
 * range instead of silently losing precision.
 */
const DECIMAL_AMOUNT_PATTERN = /^\d+(?:\.\d{1,2})?$/;

/**
 * Parses a validated decimal amount into integer cents from its whole and
 * fractional parts directly — never via float multiplication, which loses
 * integer precision for large values and can produce Infinity.
 *
 * @throws ValidationError when the amount's cents exceed the safe-integer
 *   range — the generated callback would otherwise carry a wrong amount or
 *   serialize `amount_cents` as null.
 */
function parseAmountToCents(amount: string): number {
  if (!DECIMAL_AMOUNT_PATTERN.test(amount)) {
    throw new ValidationError(
      "Simulated callback amount must be a non-negative decimal amount with at most two fraction digits."
    );
  }
  const [whole, fraction = "0"] = amount.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) {
    throw new ValidationError(
      "Simulated callback amount exceeds the safe-integer cents range and cannot be represented exactly."
    );
  }
  return cents;
}

/**
 * Derives a stable positive transaction id from the delivery reference
 * (FNV-1a, folded into the vendor's 9-digit id range): repeated deliveries
 * of the same arguments reproduce the same id — true replay semantics.
 * Folding a 32-bit hash into the 9-digit space CAN collide across distinct
 * references — this is a dev-only synthetic id for local replay scenarios,
 * not a production uniqueness guarantee.
 */
function deriveTransactionId(reference: string): number {
  let hash = 2166136261;
  for (let index = 0; index < reference.length; index += 1) {
    hash ^= reference.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 900000000) + 100000000;
}

/**
 * Synthesizes one Paymob processed-callback delivery for the given
 * settlement arguments and signs it with the production HMAC builder under
 * the given secret. Pure function: no I/O, no clock, no randomness — the
 * same arguments always produce the byte-identical body and signature.
 *
 * @throws DomainError (`SERVICE_UNAVAILABLE`) when no HMAC secret is
 *   configured — an unconfigured deployment cannot produce a verifiable
 *   signature, so delivery fails closed instead of signing under an empty
 *   key.
 */
export function buildSimulatedProcessedCallback(
  delivery: SimulatedCallbackDelivery,
  hmacSecret: string | null
): SimulatedCallbackPayload {
  if (hmacSecret === null || hmacSecret.length === 0) {
    throw new DomainError(
      "SERVICE_UNAVAILABLE",
      "Simulated callback delivery requires a configured Paymob HMAC secret."
    );
  }
  const amountCents = parseAmountToCents(delivery.amount);
  const obj: PaymobProcessedCallbackBody["obj"] = {
    id: deriveTransactionId(delivery.reference),
    pending: false,
    success: delivery.outcome === "confirmed",
    amount_cents: amountCents,
    created_at: SIMULATED_CREATED_AT,
    currency: delivery.currency,
    error_occured: false,
    has_parent_transaction: false,
    integration_id: SIMULATED_INTEGRATION_ID,
    is_3d_secure: true,
    is_auth: false,
    is_capture: false,
    is_refund: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_void: false,
    is_voided: false,
    owner: SIMULATED_OWNER_ID,
    refunded_amount_cents: 0,
    captured_amount: 0,
    order: {
      id: SIMULATED_ORDER_ID,
      merchant_order_id: delivery.reference,
      amount_cents: amountCents,
      currency: delivery.currency,
    },
    source_data: {
      pan: SIMULATED_CARD_PAN,
      sub_type: SIMULATED_CARD_SUB_TYPE,
      type: SIMULATED_CARD_TYPE,
    },
  };
  const hmac = createHmac("sha512", hmacSecret).update(buildTransactionHmacMessage(obj)).digest("hex");
  return { body: { type: "TRANSACTION", obj }, hmac };
}

/** Development-only callback delivery against the local webhook receiver. */
export class SimulationCallbackChannel implements CallbackChannelPort {
  readonly kind: CallbackChannelKind = "simulation";
  readonly publicBaseUrl: string;

  constructor(private readonly config: SimulationCallbackChannelConfig) {
    this.publicBaseUrl = config.localBaseUrl;
  }

  /**
   * Verifies the local dev server answers on its health surface, so a
   * misconfigured port fails here with a precise message instead of per
   * delivery.
   *
   * @throws DomainError (`PAYMENT_CALLBACK_SIMULATION_UNREACHABLE`) when the
   *   local server cannot be reached or its health surface answers an error
   *   status, and when invoked in a production runtime.
   */
  async ensureReady(): Promise<void> {
    this.assertDevelopmentRuntime();
    const probeUrl = `${this.config.localBaseUrl}${HEALTH_PATH}`;
    const response = await this.requestLocalSurface(probeUrl, "health", { method: "GET" });
    if (!response.ok) {
      throw new DomainError(
        "PAYMENT_CALLBACK_SIMULATION_UNREACHABLE",
        `The local callback health surface answered status ${response.status} at ${probeUrl}.`
      );
    }
  }

  /**
   * Delivers one synthetic settlement callback through the REAL webhook
   * pipeline: the synthesized body is signed with the production HMAC
   * builder and POSTed with the signature in the `hmac` query parameter —
   * exactly how the provider delivers — to the local webhook surface.
   * Replaying the same arguments re-delivers the byte-identical callback.
   *
   * @throws DomainError (`SERVICE_UNAVAILABLE`) when no HMAC secret is
   *   configured; `PAYMENT_CALLBACK_SIMULATION_UNREACHABLE` when the local
   *   webhook surface cannot be reached; `PAYMENT_CALLBACK_SIMULATION_DELIVERY_FAILED`
   *   when it rejects the delivery; and the same production fail-closed
   *   guard as on `ensureReady`.
   */
  async deliverTestCallback(delivery: SimulatedCallbackDelivery): Promise<void> {
    this.assertDevelopmentRuntime();
    const { body, hmac } = buildSimulatedProcessedCallback(delivery, this.config.hmacSecret);
    const targetUrl = `${this.config.localBaseUrl}${WEBHOOK_PATH}?${HMAC_QUERY_PARAM}=${hmac}`;
    const response = await this.requestLocalSurface(targetUrl, "webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new DomainError(
        "PAYMENT_CALLBACK_SIMULATION_DELIVERY_FAILED",
        `The local webhook surface rejected the simulated callback with status ${response.status}.`
      );
    }
  }

  /**
   * Requests one local dev-server surface under the probe timeout and
   * returns the response. The health probe and the webhook delivery share
   * this seam so both fail with the same unreachable diagnosis when the
   * local server is not answering. `init` carries the per-surface request
   * shape (the health surface is GET-only, the webhook delivery is a signed
   * POST).
   */
  private async requestLocalSurface(url: string, surface: string, init: RequestInit): Promise<Response> {
    const transport = this.config.fetch ?? defaultSurfaceFetch;
    try {
      return await transport(url, {
        ...init,
        signal: AbortSignal.timeout(this.config.probeTimeoutMs),
      });
    } catch {
      throw new DomainError(
        "PAYMENT_CALLBACK_SIMULATION_UNREACHABLE",
        `The local callback ${surface} surface did not answer at ${url}.`
      );
    }
  }

  /**
   * Fail-closed runtime guard: simulated settlement delivery is a
   * development surface by contract, and it must never run in production —
   * not even if a future caller bypasses the factory's resolution rules.
   */
  private assertDevelopmentRuntime(): void {
    if (process.env.NODE_ENV === "production") {
      throw new DomainError(
        "PAYMENT_CALLBACK_SIMULATION_DISABLED",
        "The simulated callback channel is reachable only outside production runtimes."
      );
    }
  }
}
