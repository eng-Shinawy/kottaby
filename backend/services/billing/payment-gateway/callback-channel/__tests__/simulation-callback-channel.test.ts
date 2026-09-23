/**
 * Simulation callback channel contract.
 *
 * Unit tier (no network): the outbound transport is injected, so every test
 * drives the channel against a recorder. The suite pins:
 *
 *  - SYNTHESIS — the documented Paymob processed-callback shape: nested
 *    `obj`, every one of the twenty documented signed members present,
 *    `order.merchant_order_id` echoing the delivery reference, the outcome
 *    flags mapping `confirmed`/`failed` onto `success`/`pending`, and the
 *    reference-derived transaction id (stable per reference, distinct
 *    across references);
 *  - SIGNER REUSE — the produced digest equals an INDEPENDENT oracle's
 *    HMAC-SHA512 over the vendor's documented key order (transcribed here,
 *    never the production key list): a parallel or drifted signer cannot
 *    produce a matching digest;
 *  - DETERMINISM — identical arguments produce byte-identical bodies and
 *    signatures (replay semantics); amounts round-trip the decimal-string
 *    budget exactly and malformed amounts fail with a typed validation
 *    error;
 *  - DELIVERY — the wire shape: POST to the local webhook surface with the
 *    signature in the `hmac` query parameter and a JSON body; non-2xx
 *    answers surface as a typed delivery error, an unreachable local server
 *    as a typed unreachable error, and `ensureReady` probes the health
 *    surface;
 *  - FAIL-CLOSED guards — a production runtime makes both public methods
 *    throw before ANY transport call, and no configured HMAC secret makes
 *    delivery fail closed instead of signing under an empty key.
 *
 * Runs via `bun run test/scripts/run-test.ts
 * backend/services/billing/payment-gateway/callback-channel/__tests__/
 * simulation-callback-channel.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { DomainError, ValidationError } from "@/backend/lib/errors";
import {
  buildSimulatedProcessedCallback,
  SimulationCallbackChannel,
  type SimulationCallbackChannelConfig,
  type SimulationSurfaceFetch,
} from "@/backend/services/billing/payment-gateway/callback-channel/simulation-callback-channel.channel";
import type { SimulatedCallbackDelivery } from "@/backend/types";

const HMAC_SECRET = "simulation-channel-test-hmac-secret";
const LOCAL_BASE_URL = "http://localhost:3111";

// ─── Independent signing oracle (documented key order, transcribed) ────────

/**
 * The vendor's documented processed-callback signed slots, transcribed
 * locally in the documented order (POST nested shape) — an independent
 * oracle copy, never the production key list.
 */
const PAYMOB_TXN_HMAC_KEYS_POST: readonly string[] = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order.id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
];

/** Reads a (possibly dotted) signed-value path off a plain object. */
function readHmacPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (!isPlainJsonObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

/** Serializes one signed value: booleans lowercase, absent → empty string. */
function stringifyHmacValue(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number" || typeof value === "string") {
    return String(value);
  }
  return "";
}

/** Independent oracle digest: lowercase-hex HMAC-SHA512 over the message. */
function oracleHmac(obj: unknown, secret: string = HMAC_SECRET): string {
  const message = PAYMOB_TXN_HMAC_KEYS_POST.map(key => stringifyHmacValue(readHmacPath(obj, key))).join("");
  return createHmac("sha512", secret).update(message).digest("hex");
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

function delivery(overrides: Partial<SimulatedCallbackDelivery> = {}): SimulatedCallbackDelivery {
  return { reference: "claim_sim_channel_1", outcome: "confirmed", amount: "120.00", currency: "EGP", ...overrides };
}

function channelConfig(overrides: Partial<SimulationCallbackChannelConfig> = {}): SimulationCallbackChannelConfig {
  return { hmacSecret: HMAC_SECRET, localBaseUrl: LOCAL_BASE_URL, probeTimeoutMs: 5_000, ...overrides };
}

/** One recorded outbound call. */
interface RecordedCall {
  readonly url: string;
  readonly method: string;
  readonly body: string | null;
  readonly contentType: string | undefined;
}

/** Builds a recording transport serving a scripted response per call. */
function makeTransport(respond: (call: RecordedCall) => Response | Promise<Response>): {
  transport: SimulationSurfaceFetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const transport: SimulationSurfaceFetch = async (url, init) => {
    const headers = new Headers(init.headers);
    const call: RecordedCall = {
      url,
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? init.body : null,
      contentType: headers.get("content-type") ?? undefined,
    };
    calls.push(call);
    return respond(call);
  };
  return { transport, calls };
}

/** Runs `body` and returns the thrown value (typed-error assertions). */
async function expectError(body: () => Promise<unknown>): Promise<unknown> {
  let caught: unknown = null;
  try {
    await body();
  } catch (error) {
    caught = error;
  }
  expect(caught).not.toBeNull();
  return caught;
}

/** Runs `body` with `NODE_ENV` forced, restoring the prior value afterwards. */
async function withNodeEnv(mode: string | undefined, body: () => Promise<unknown>): Promise<void> {
  const previous = process.env.NODE_ENV;
  const hadPrevious = typeof previous === "string";
  // Index-signature alias sidesteps Next.js' read-only NODE_ENV augmentation
  // while still mutating the SAME live env object the runtime reads.
  const envBag: Record<string, string | undefined> = process.env;
  if (mode === undefined) {
    delete envBag.NODE_ENV;
  } else {
    envBag.NODE_ENV = mode;
  }
  try {
    await body();
  } finally {
    if (hadPrevious) {
      envBag.NODE_ENV = previous;
    } else {
      delete envBag.NODE_ENV;
    }
  }
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrows a caught value to a `DomainError` (instanceof guard, no casts). */
function asDomainError(caught: unknown): DomainError {
  if (caught instanceof DomainError) {
    return caught;
  }
  throw new Error("expected a DomainError");
}

/** Narrows a caught value to a `ValidationError` (instanceof guard, no casts). */
function asValidationError(caught: unknown): ValidationError {
  if (caught instanceof ValidationError) {
    return caught;
  }
  throw new Error("expected a ValidationError");
}

/** Parses a recorded request body back into the callback envelope. */
function parseEnvelope(body: string | null): { type: unknown; obj: Record<string, unknown> } {
  expect(body).not.toBeNull();
  const parsed: unknown = JSON.parse(body ?? "null");
  const envelope = isPlainJsonObject(parsed) ? parsed : null;
  expect(envelope).not.toBeNull();
  if (envelope === null) {
    throw new Error("recorded body was not a JSON object");
  }
  const obj = isPlainJsonObject(envelope.obj) ? envelope.obj : null;
  expect(obj).not.toBeNull();
  if (obj === null) {
    throw new Error("recorded callback envelope had no transaction object");
  }
  return { type: envelope.type, obj };
}

// ─── Synthesis ─────────────────────────────────────────────────────────────

describe("buildSimulatedProcessedCallback", () => {
  test("synthesizes the documented processed-callback shape for a confirmed delivery", () => {
    const { body, hmac } = buildSimulatedProcessedCallback(delivery(), HMAC_SECRET);

    expect(body.type).toBe("TRANSACTION");
    expect(body.obj.order.merchant_order_id).toBe("claim_sim_channel_1");
    expect(body.obj.amount_cents).toBe(12_000);
    expect(body.obj.currency).toBe("EGP");
    expect(body.obj.success).toBe(true);
    expect(body.obj.pending).toBe(false);
    expect(body.obj.error_occured).toBe(false);
    expect(body.obj.has_parent_transaction).toBe(false);
    expect(body.obj.order.amount_cents).toBe(12_000);
    expect(body.obj.order.currency).toBe("EGP");
    expect(Number.isInteger(body.obj.id)).toBe(true);
    expect(String(body.obj.id)).toHaveLength(9);
    expect(hmac).toMatch(/^[0-9a-f]{128}$/);
  });

  test("carries every documented signed member", () => {
    const { body } = buildSimulatedProcessedCallback(delivery(), HMAC_SECRET);
    for (const key of PAYMOB_TXN_HMAC_KEYS_POST) {
      expect(readHmacPath(body.obj, key)).not.toBeUndefined();
    }
  });

  test("maps a failed outcome onto the transaction flags", () => {
    const { body } = buildSimulatedProcessedCallback(delivery({ outcome: "failed" }), HMAC_SECRET);
    expect(body.obj.success).toBe(false);
    expect(body.obj.pending).toBe(false);
  });

  test("signs with the production message shape — independent oracle agreement", () => {
    const { body, hmac } = buildSimulatedProcessedCallback(delivery(), HMAC_SECRET);
    expect(hmac).toBe(oracleHmac(body.obj));
  });

  test("fails closed without a configured secret", async () => {
    await Promise.all(
      [null, ""].map(async secret => {
        const caught = await expectError(() => Promise.resolve(buildSimulatedProcessedCallback(delivery(), secret)));
        expect(caught).toBeInstanceOf(DomainError);
        expect(asDomainError(caught).code).toBe("SERVICE_UNAVAILABLE");
      })
    );
  });

  test("reproduces byte-identical bodies and signatures for identical arguments", () => {
    const first = buildSimulatedProcessedCallback(delivery(), HMAC_SECRET);
    const second = buildSimulatedProcessedCallback(delivery(), HMAC_SECRET);
    expect(JSON.stringify(second.body)).toBe(JSON.stringify(first.body));
    expect(second.hmac).toBe(first.hmac);
  });

  test("derives a stable transaction id per reference and distinct ids across references", () => {
    const first = buildSimulatedProcessedCallback(delivery({ reference: "claim_sim_alpha" }), HMAC_SECRET);
    const firstReplay = buildSimulatedProcessedCallback(delivery({ reference: "claim_sim_alpha" }), HMAC_SECRET);
    const second = buildSimulatedProcessedCallback(delivery({ reference: "claim_sim_beta" }), HMAC_SECRET);

    expect(firstReplay.body.obj.id).toBe(first.body.obj.id);
    expect(second.body.obj.id).not.toBe(first.body.obj.id);
    expect(second.hmac).not.toBe(first.hmac);
  });

  test("round-trips decimal amounts within the two-fraction-digit budget", () => {
    expect(buildSimulatedProcessedCallback(delivery({ amount: "199.99" }), HMAC_SECRET).body.obj.amount_cents).toBe(
      19_999
    );
    expect(buildSimulatedProcessedCallback(delivery({ amount: "0" }), HMAC_SECRET).body.obj.amount_cents).toBe(0);
    expect(buildSimulatedProcessedCallback(delivery({ amount: "12.3" }), HMAC_SECRET).body.obj.amount_cents).toBe(
      1_230
    );
  });

  test("rejects malformed amounts with a typed validation error", async () => {
    await Promise.all(
      ["199.999", "-1", "abc", "", "1.2.3"].map(async amount => {
        const caught = await expectError(() =>
          Promise.resolve(buildSimulatedProcessedCallback(delivery({ amount }), HMAC_SECRET))
        );
        expect(caught).toBeInstanceOf(ValidationError);
        expect(asValidationError(caught).message).toContain(
          "Simulated callback amount must be a non-negative decimal amount with at most two fraction digits."
        );
      })
    );
  });
});

// ─── Channel surface ───────────────────────────────────────────────────────

describe("SimulationCallbackChannel", () => {
  test("exposes the simulation kind and the local base URL", () => {
    const channel = new SimulationCallbackChannel(channelConfig());
    expect(channel.kind).toBe("simulation");
    expect(channel.publicBaseUrl).toBe(LOCAL_BASE_URL);
  });

  test("ensureReady probes the local health surface with GET", async () => {
    const { transport, calls } = makeTransport(() => new Response(null, { status: 200 }));
    const channel = new SimulationCallbackChannel(channelConfig({ fetch: transport }));

    await channel.ensureReady();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${LOCAL_BASE_URL}/api/health`);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].body).toBeNull();
  });

  test("ensureReady fails with a typed unreachable error when the health surface errors", async () => {
    const { transport } = makeTransport(() => new Response(null, { status: 503 }));
    const channel = new SimulationCallbackChannel(channelConfig({ fetch: transport }));

    const caught = await expectError(() => channel.ensureReady());
    expect(caught).toBeInstanceOf(DomainError);
    expect(asDomainError(caught).code).toBe("PAYMENT_CALLBACK_SIMULATION_UNREACHABLE");
    expect(asDomainError(caught).message).toContain("503");
  });

  test("ensureReady fails with a typed unreachable error when the local server does not answer", async () => {
    const { transport } = makeTransport(() => {
      throw new Error("connect ECONNREFUSED");
    });
    const channel = new SimulationCallbackChannel(channelConfig({ fetch: transport }));

    const caught = await expectError(() => channel.ensureReady());
    expect(caught).toBeInstanceOf(DomainError);
    expect(asDomainError(caught).code).toBe("PAYMENT_CALLBACK_SIMULATION_UNREACHABLE");
  });

  test("delivers a signed processed callback to the local webhook surface", async () => {
    const { transport, calls } = makeTransport(() => new Response(null, { status: 200 }));
    const channel = new SimulationCallbackChannel(channelConfig({ fetch: transport }));

    await channel.deliverTestCallback(delivery());

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(new RegExp(`^${LOCAL_BASE_URL}/api/payments/webhook\\?hmac=[0-9a-f]{128}$`));
    expect(calls[0].method).toBe("POST");
    expect(calls[0].contentType).toBe("application/json");

    const envelope = parseEnvelope(calls[0].body);
    expect(envelope.type).toBe("TRANSACTION");
    expect(envelope.obj.order).toMatchObject({
      merchant_order_id: "claim_sim_channel_1",
      amount_cents: 12_000,
      currency: "EGP",
    });
  });

  test("surfaces a rejected delivery as a typed error carrying the status", async () => {
    const { transport } = makeTransport(() => new Response(null, { status: 401 }));
    const channel = new SimulationCallbackChannel(channelConfig({ fetch: transport }));

    const caught = await expectError(() => channel.deliverTestCallback(delivery()));
    expect(caught).toBeInstanceOf(DomainError);
    expect(asDomainError(caught).code).toBe("PAYMENT_CALLBACK_SIMULATION_DELIVERY_FAILED");
    expect(asDomainError(caught).message).toContain("401");
  });

  test("surfaces an unreachable webhook surface as a typed error", async () => {
    const { transport } = makeTransport(() => {
      throw new Error("connect ECONNREFUSED");
    });
    const channel = new SimulationCallbackChannel(channelConfig({ fetch: transport }));

    const caught = await expectError(() => channel.deliverTestCallback(delivery()));
    expect(caught).toBeInstanceOf(DomainError);
    expect(asDomainError(caught).code).toBe("PAYMENT_CALLBACK_SIMULATION_UNREACHABLE");
  });

  test("fails closed on delivery without a configured secret", async () => {
    const { transport, calls } = makeTransport(() => new Response(null, { status: 200 }));
    const channel = new SimulationCallbackChannel(channelConfig({ hmacSecret: null, fetch: transport }));

    const caught = await expectError(() => channel.deliverTestCallback(delivery()));
    expect(caught).toBeInstanceOf(DomainError);
    expect(asDomainError(caught).code).toBe("SERVICE_UNAVAILABLE");
    expect(calls).toHaveLength(0);
  });

  test("re-delivers the byte-identical callback for identical arguments (replay)", async () => {
    const { transport, calls } = makeTransport(() => new Response(null, { status: 200 }));
    const channel = new SimulationCallbackChannel(channelConfig({ fetch: transport }));

    await channel.deliverTestCallback(delivery());
    await channel.deliverTestCallback(delivery());

    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe(calls[0].url);
    expect(calls[1].body).toBe(calls[0].body);
  });

  test("fails closed in a production runtime before any transport call", async () => {
    const { transport, calls } = makeTransport(() => new Response(null, { status: 200 }));
    const channel = new SimulationCallbackChannel(channelConfig({ fetch: transport }));

    await withNodeEnv("production", async () => {
      const readiness = await expectError(() => channel.ensureReady());
      expect(readiness).toBeInstanceOf(DomainError);
      expect(asDomainError(readiness).code).toBe("PAYMENT_CALLBACK_SIMULATION_DISABLED");

      const deliveryError = await expectError(() => channel.deliverTestCallback(delivery()));
      expect(deliveryError).toBeInstanceOf(DomainError);
      expect(asDomainError(deliveryError).code).toBe("PAYMENT_CALLBACK_SIMULATION_DISABLED");
    });

    expect(calls).toHaveLength(0);
  });
});
