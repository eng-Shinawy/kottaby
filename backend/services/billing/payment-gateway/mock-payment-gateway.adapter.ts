/**
 * Mock payment gateway adapter — the built-in `mock` provider behind the
 * `PaymentGatewayPort`.
 *
 * Dev/test provider semantics:
 *  - The adapter NEVER runs in a real production runtime: both public methods
 *    assert the development runtime guard ({@link assertMockDevelopmentRuntime},
 *    shared with the factory's resolution guard) so simulated settlements stay
 *    unreachable in production even if a future caller bypasses the factory.
 *  - `createCheckout` never contacts a network and never throws in a
 *    development runtime: checkout is
 *    simulated deterministically with a fresh `mock_<uuid>` reference and no
 *    hosted-checkout URL (the mock has none — callers present the reference
 *    instead). Amount, currency, student and plan identities ride in the
 *    input only as provider metadata; the mock neither validates nor
 *    re-derives prices (the purchase service owns that discipline).
 *  - `parseWebhookEvent` parses the mock gateway's callback envelope — a
 *    JSON object `{ reference, outcome, amount, currency }` — into the
 *    provider-agnostic `PaymentWebhookEvent`. The body is taken from the
 *    parse input verbatim; query parameters exist in the contract for
 *    query-signed providers and are deliberately unused here (the mock
 *    signs nothing in a URL). Malformed JSON and payloads outside the
 *    envelope shape raise a typed validation error that the webhook route
 *    catches and converts into a masked error response; raw payload
 *    content never enters the message. The mock defines no
 *    verified-but-ignored callback variant, so parsing never returns
 *    null — every accepted delivery is a real settlement event.
 *
 * The webhook surface is server-to-server (the caller is the gateway, not a
 * localized user), so parser rejections resolve their message from the
 * deployment-default locale instead of a per-request locale.
 */

import { randomUUID } from "node:crypto";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { DomainError, ValidationError } from "@/backend/lib/errors";
import type {
  PaymentCheckoutInput,
  PaymentCheckoutSession,
  PaymentGatewayPort,
  PaymentWebhookEvent,
  WebhookParseInput,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Locale-free gateway surface: parser rejections use the deployment default. */
const GATEWAY_LOCALE = "en";

/** Discriminated outcome values the mock gateway can report for a payment. */
const WEBHOOK_OUTCOMES = ["confirmed", "failed"] as const;

/** Reads the shared localized validation message for parser rejections. */
function localizedValidationMessage(): string {
  return getServerTranslations(GATEWAY_LOCALE).errorsTranslations.validation;
}

/** Type guard narrowing one parsed JSON member to a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Type guard narrowing a parsed outcome to the verified-event outcome union. */
function isWebhookOutcome(value: string): value is PaymentWebhookEvent["outcome"] {
  return (WEBHOOK_OUTCOMES as readonly string[]).includes(value);
}

/**
 * Fail-closed runtime guard: the built-in mock simulates settlements, so it
 * must never run in a real production deployment — not even if a future
 * caller bypasses the factory's resolution rules. The test runners'
 * `TEST_SERVER=1` production-build E2E server is the deliberate exemption
 * (the same test-runtime signal the logger treats as test mode).
 */
export function assertMockDevelopmentRuntime(): void {
  if (process.env.NODE_ENV === "production" && process.env.TEST_SERVER !== "1") {
    throw new DomainError(
      "PAYMENT_GATEWAY_MOCK_DISABLED",
      "The built-in mock payment gateway is reachable only outside production runtimes."
    );
  }
}

export class MockPaymentGatewayAdapter implements PaymentGatewayPort {
  /**
   * Simulates opening a checkout session: a fresh `mock_<uuid>` reference
   * per call and no hosted-checkout URL. Never throws in mock mode — a
   * simulated gateway has no outage path (the development-runtime guard
   * above is the sole rejection, and it fires only in production).
   */
  async createCheckout(_input: PaymentCheckoutInput): Promise<PaymentCheckoutSession> {
    assertMockDevelopmentRuntime();
    return {
      provider: PaymentGateway.Mock,
      providerReference: `mock_${randomUUID()}`,
      checkoutUrl: null,
    };
  }

  /**
   * Parses a mock gateway callback body into the verified-event contract.
   * Accepts only the exact envelope shape — any other structure (malformed
   * JSON, non-object roots, missing/ill-typed members, unknown outcomes) is
   * rejected with a typed validation error for the route to mask. Only the
   * raw body is read: the mock has no query-signed delivery variant. Never
   * returns null — see the module docblock.
   */
  parseWebhookEvent(input: WebhookParseInput): PaymentWebhookEvent {
    assertMockDevelopmentRuntime();
    const validationMessage = localizedValidationMessage();

    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody);
    } catch {
      throw new ValidationError("PAYMENT_WEBHOOK_MALFORMED", validationMessage);
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new ValidationError("PAYMENT_WEBHOOK_MALFORMED", validationMessage);
    }

    // Member presence is asserted by `in`-narrowing (the house unknown-JSON
    // idiom, cf. `parseStoredEmitReceipt`): the guards narrow the `object`
    // root to a member-carrying record with NO type assertion. A missing
    // member is the same malformed-payload rejection as an ill-typed one.
    if (!("reference" in parsed) || !("outcome" in parsed) || !("amount" in parsed) || !("currency" in parsed)) {
      throw new ValidationError("PAYMENT_WEBHOOK_MALFORMED", validationMessage);
    }

    const { reference, outcome, amount, currency } = parsed;

    if (!isNonEmptyString(reference) || !isNonEmptyString(amount) || !isNonEmptyString(currency)) {
      throw new ValidationError("PAYMENT_WEBHOOK_MALFORMED", validationMessage);
    }

    if (typeof outcome !== "string" || !isWebhookOutcome(outcome)) {
      throw new ValidationError("PAYMENT_WEBHOOK_MALFORMED", validationMessage);
    }

    return {
      reference,
      outcome,
      amount,
      currency,
    };
  }
}
