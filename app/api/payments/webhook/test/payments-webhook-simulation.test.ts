/**
 * Simulation callback channel against the REAL webhook route — the offline
 * development delivery loop, end to end.
 *
 * The channel's outbound transport is injected with a dispatcher that hands
 * the channel's actual wire request (URL with the `hmac` query parameter,
 * JSON body) straight to the REAL `POST /api/payments/webhook` handler — no
 * server boot, no network, no signature oracle: the route's own HMAC gate
 * IS the oracle, so a drifted or parallel signer in the channel cannot pass
 * this suite. The activation service is mocked at the module boundary
 * (same discipline as `payments-webhook-route.test.ts`, whose suite owns the
 * route's gate/envelope matrix; here only the channel→route loop is under
 * test).
 *
 * Coverage map:
 *  - a confirmed simulated delivery passes the route's HMAC gate and hands
 *    the activation seam the mapped event (reference, outcome, decimal
 *    amount, currency, provider transaction id) exactly once;
 *  - a failed simulated delivery maps to the failed outcome;
 *  - replaying the SAME delivery arguments re-delivers the byte-identical
 *    callback — the route acks every delivery and dispatches each one (the
 *    once-only guarded transition is the activation service's own contract);
 *  - cross-user scenarios deliver each payment's own reference (distinct
 *    references, distinct provider transaction ids, in order);
 *  - fail-closed delivery: a channel signing under the WRONG secret is
 *    rejected by the route's gate (the channel surfaces the 401 as a typed
 *    delivery error), and a TAMPERED body carrying a valid signature is
 *    denied with the masked 401 — the activation seam is never invoked for
 *    either.
 *
 * Runs via `bun run test/scripts/run-test.ts
 * app/api/payments/webhook/test/payments-webhook-simulation.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
// Value import (NOT type-only): NextRequest is CONSTRUCTED below — the
// type-only form detonates at runtime (`ReferenceError`), exactly as the
// route test documents.
import { NextRequest } from "next/server";
import { DomainError } from "@/backend/lib/errors";

// Module-boundary mock: the route must exercise ONLY its own gate/envelope
// logic here; the activation service's DB semantics belong to its service
// suite. The channel's synthesized deliveries reach the service seam exactly
// as real provider deliveries do.
const processCalls: Array<{ event: unknown; locale: string }> = [];

void mock.module("@/backend/services/billing/subscription-activation.service", () => ({
  SubscriptionActivationService: {
    processWebhookEvent: async (event: unknown, locale: string): Promise<{ processed: boolean }> => {
      processCalls.push({ event, locale });
      return { processed: true };
    },
  },
}));

// The route import MUST trail its mock.module registration (bun evaluates
// the module registry in import order).
import { POST } from "@/app/api/payments/webhook/route";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { resetPaymentGateway } from "@/backend/services/billing/payment-gateway";
import {
  buildSimulatedProcessedCallback,
  SimulationCallbackChannel,
  type SimulationCallbackChannelConfig,
} from "@/backend/services/billing/payment-gateway/callback-channel/simulation-callback-channel.channel";
import type { SimulatedCallbackDelivery } from "@/backend/types";

const BASE_URL = "http://localhost:3000";
const PAYMOB_HMAC_SECRET = "paymob-simulation-e2e-hmac-secret";
const PAYMOB_SECRET_KEY_FIXTURE = "sk_test_simulation_e2e";
const PAYMOB_PUBLIC_KEY_FIXTURE = "pk_test_simulation_e2e";
const PAYMOB_API_KEY_FIXTURE = "simulation-e2e-paymob-api-key";
/** Query parameter the paymob provider signs every delivery into. */
const PAYMOB_HMAC_QUERY_PARAM = "hmac";

const ENV_KEYS = [
  "PAYMENT_WEBHOOK_ENABLED",
  "PAYMENT_GATEWAY_PROVIDER",
  "PAYMOB_SECRET_KEY",
  "PAYMOB_PUBLIC_KEY",
  "PAYMOB_HMAC_SECRET",
  "PAYMOB_API_KEY",
  "PAYMOB_INTEGRATION_ID_CARD",
] as const;

const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
}

// Index-signature alias sidesteps Next.js' read-only NODE_ENV augmentation
// while still mutating the SAME live env object the runtime reads.
const envBag: Record<string, string | undefined> = process.env;

/** Enabled webhook surface with the paymob provider active (full config set). */
function enablePaymobProvider(): void {
  process.env.PAYMENT_WEBHOOK_ENABLED = "true";
  process.env.PAYMENT_GATEWAY_PROVIDER = PaymentGateway.Paymob;
  process.env.PAYMOB_SECRET_KEY = PAYMOB_SECRET_KEY_FIXTURE;
  process.env.PAYMOB_PUBLIC_KEY = PAYMOB_PUBLIC_KEY_FIXTURE;
  process.env.PAYMOB_HMAC_SECRET = PAYMOB_HMAC_SECRET;
  process.env.PAYMOB_API_KEY = PAYMOB_API_KEY_FIXTURE;
  process.env.PAYMOB_INTEGRATION_ID_CARD = "46511";
  resetPaymentGateway();
}

/** One wire request the channel produced, as dispatched into the real route. */
interface DispatchedDelivery {
  readonly url: string;
  readonly body: string;
  readonly response: Response;
}

const dispatched: DispatchedDelivery[] = [];

/**
 * The channel's transport: every outbound request becomes a real invocation
 * of the route handler carrying the channel's own URL and body bytes.
 */
async function dispatchIntoRoute(url: string, init: RequestInit): Promise<Response> {
  const body = typeof init.body === "string" ? init.body : "";
  const response = await POST(new NextRequest(url, { method: "POST", body }));
  dispatched.push({ url, body, response });
  return response;
}

function channelConfig(overrides: Partial<SimulationCallbackChannelConfig> = {}): SimulationCallbackChannelConfig {
  return { hmacSecret: PAYMOB_HMAC_SECRET, localBaseUrl: BASE_URL, probeTimeoutMs: 5_000, ...overrides };
}

function delivery(overrides: Partial<SimulatedCallbackDelivery> = {}): SimulatedCallbackDelivery {
  return { reference: "claim_sim_e2e_user_a", outcome: "confirmed", amount: "120.00", currency: "EGP", ...overrides };
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json();
  if (!isPlainJsonObject(parsed)) {
    throw new Error(`response body was not a JSON object: status ${response.status}`);
  }
  return parsed;
}

function memberRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const candidate: unknown = parent[key];
  if (!isPlainJsonObject(candidate)) {
    throw new Error(`response member "${key}" was not a JSON object`);
  }
  return candidate;
}

function memberString(parent: Record<string, unknown>, key: string): string {
  const candidate: unknown = parent[key];
  if (typeof candidate !== "string") {
    throw new Error(`response member "${key}" was not a string`);
  }
  return candidate;
}

/** The mapped event the route must have handed the activation seam. */
function expectedEvent(forDelivery: SimulatedCallbackDelivery): Record<string, unknown> {
  const { body } = buildSimulatedProcessedCallback(forDelivery, PAYMOB_HMAC_SECRET);
  return {
    reference: forDelivery.reference,
    outcome: forDelivery.outcome,
    amount: forDelivery.amount,
    currency: forDelivery.currency,
    providerTransactionId: String(body.obj.id),
  };
}

beforeEach(() => {
  processCalls.length = 0;
  dispatched.length = 0;
  enablePaymobProvider();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete envBag[key];
    } else {
      envBag[key] = value;
    }
  }
  processCalls.length = 0;
  dispatched.length = 0;
  resetPaymentGateway();
});

describe("simulation callback channel through the real webhook route", () => {
  test("a confirmed simulated delivery passes the HMAC gate and settles through the activation seam", async () => {
    const channel = new SimulationCallbackChannel(channelConfig({ fetch: dispatchIntoRoute }));
    const args = delivery();

    await channel.deliverTestCallback(args);

    // The channel produced the provider's exact wire shape.
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].url).toMatch(
      new RegExp(`^${BASE_URL}/api/payments/webhook\\?${PAYMOB_HMAC_QUERY_PARAM}=[0-9a-f]{128}$`)
    );

    // The REAL route gate accepted it and acked the settlement envelope.
    expect(dispatched[0].response.status).toBe(200);
    const body = await readJson(dispatched[0].response);
    const data = memberRecord(body, "data");
    expect(data.processed).toBe(true);
    expect(typeof memberString(body, "requestId")).toBe("string");

    // The activation seam received the mapped event exactly once.
    expect(processCalls).toHaveLength(1);
    expect(processCalls[0].locale).toBe("en");
    expect(processCalls[0].event).toEqual(expectedEvent(args));
  });

  test("a failed simulated delivery maps to the failed settlement outcome", async () => {
    const channel = new SimulationCallbackChannel(channelConfig({ fetch: dispatchIntoRoute }));
    const args = delivery({ reference: "claim_sim_e2e_declined", outcome: "failed" });

    await channel.deliverTestCallback(args);

    expect(dispatched[0].response.status).toBe(200);
    expect(processCalls).toHaveLength(1);
    expect(processCalls[0].event).toEqual(expectedEvent(args));
  });

  test("replaying the same delivery arguments re-delivers the byte-identical callback and the route acks each one", async () => {
    const channel = new SimulationCallbackChannel(channelConfig({ fetch: dispatchIntoRoute }));
    const args = delivery({ reference: "claim_sim_e2e_replay" });

    await channel.deliverTestCallback(args);
    await channel.deliverTestCallback(args);

    // Byte-identical deliveries — true provider replay semantics.
    expect(dispatched).toHaveLength(2);
    expect(dispatched[1].url).toBe(dispatched[0].url);
    expect(dispatched[1].body).toBe(dispatched[0].body);

    // Every delivery acks 200 and dispatches (the once-only guarded
    // transition is the activation service's own contract).
    expect(dispatched.map(entry => entry.response.status)).toEqual([200, 200]);
    expect(processCalls).toHaveLength(2);
    expect(processCalls[1].event).toEqual(processCalls[0].event);
  });

  test("cross-user scenarios deliver each payment's own reference to the activation seam", async () => {
    const channel = new SimulationCallbackChannel(channelConfig({ fetch: dispatchIntoRoute }));
    const userA = delivery({ reference: "claim_sim_e2e_user_a", amount: "120.00" });
    const userB = delivery({ reference: "claim_sim_e2e_user_b", amount: "199.99" });

    await channel.deliverTestCallback(userA);
    await channel.deliverTestCallback(userB);

    expect(processCalls).toHaveLength(2);
    expect(processCalls[0].event).toEqual(expectedEvent(userA));
    expect(processCalls[1].event).toEqual(expectedEvent(userB));
    expect(processCalls[0].event).not.toEqual(processCalls[1].event);
  });

  test("a delivery signed under the wrong secret is denied by the route's gate and surfaces as a typed channel error", async () => {
    const channel = new SimulationCallbackChannel(
      channelConfig({ hmacSecret: "wrong-secret-never-configured", fetch: dispatchIntoRoute })
    );
    const callsBefore = processCalls.length;

    let caught: unknown = null;
    try {
      await channel.deliverTestCallback(delivery());
    } catch (error) {
      caught = error;
    }

    expect(caught).not.toBeNull();
    if (!(caught instanceof DomainError)) {
      throw new Error("expected a DomainError");
    }
    expect(caught.code).toBe("PAYMENT_CALLBACK_SIMULATION_DELIVERY_FAILED");
    expect(dispatched[0].response.status).toBe(401);
    expect(processCalls).toHaveLength(callsBefore);
  });

  test("a tampered body carrying a valid signature is denied with the masked 401", async () => {
    const args = delivery({ reference: "claim_sim_e2e_tamper" });
    const { body, hmac } = buildSimulatedProcessedCallback(args, PAYMOB_HMAC_SECRET);
    const tampered = { ...body, obj: { ...body.obj, amount_cents: body.obj.amount_cents + 1 } };
    const callsBefore = processCalls.length;

    const response = await POST(
      new NextRequest(`${BASE_URL}/api/payments/webhook?${PAYMOB_HMAC_QUERY_PARAM}=${hmac}`, {
        method: "POST",
        body: JSON.stringify(tampered),
      })
    );

    expect(response.status).toBe(401);
    const errorBody = await readJson(response);
    expect(memberRecord(errorBody, "error").code).toBe("UNAUTHORIZED");
    expect(processCalls).toHaveLength(callsBefore);
  });
});
