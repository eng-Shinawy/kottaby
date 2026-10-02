/**
 * Live Paymob smoke — hosted-checkout intention creation over the REAL
 * vendor API (`POST v1/intention/` with the real secret key).
 *
 * One real round-trip: `PaymobPaymentGateway.createCheckout` builds the
 * intention from a synthetic purchase input (the documented `"NA"`
 * placeholder policy included — the sandbox tolerance for a phone-less
 * billing block is exactly what this smoke observes) and the mapper's echo
 * validation runs against the vendor's actual response. A passing smoke
 * proves the adapter + mapper + HTTP client are wired correctly against the
 * live contract, not a recording.
 *
 * Gated on the explicit live opt-in (`PAYMOB_LIVE_TESTS=1`) plus a
 * resolvable credential set — absent either, the suite skips. Tunnel keys
 * are kept absent by the suite harness so the callback-channel factory
 * resolves its offline default and composes no callback URLs (the vendor
 * falls back to the operator's dashboard configuration, as in production).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { PaymobPaymentGateway } from "@/backend/services/billing/payment-gateway/paymob/paymob.adapter";
import { isPaymobLiveRunRequested, resolvePaymobLiveCredentials } from "@/test/helpers/paymob-live-env";
import { resolveLivePaymobConfig, setupPaymobLiveSuite } from "@/test/integration/paymob/helpers/paymob-live-suite";

const creds = resolvePaymobLiveCredentials();
const live = creds !== null && isPaymobLiveRunRequested();
let restoreSuite: (() => void) | undefined;

/** Correlation key unique per run — the vendor echoes it verbatim. */
const specialReference = `pym_live_${randomUUID().replace(/-/gu, "").slice(0, 20)}`;

/**
 * Runtime-checked extraction for `string | null` values the vendor contract
 * guarantees — narrows via a thrown type guard instead of an unsafe `as` cast.
 */
function expectString(value: string | null): string {
  expect(value).not.toBeNull();
  if (typeof value !== "string") {
    throw new Error("expected a non-null string");
  }
  return value;
}

describe.skipIf(!live)("Paymob intention creation @live-paymob", () => {
  beforeAll(() => {
    if (creds) {
      restoreSuite = setupPaymobLiveSuite(creds).restore;
    }
  });

  afterAll(() => {
    restoreSuite?.();
  });

  test("creates one hosted-checkout intention the vendor echoes verbatim", async () => {
    if (!creds) {
      throw new Error("unreachable: live gate guarantees credentials");
    }
    const gateway = new PaymobPaymentGateway();
    const config = resolveLivePaymobConfig();

    const session = await gateway.createCheckout({
      studentId: 1,
      planId: 1,
      amount: "150.00",
      currency: "EGP",
      specialReference,
      billing: {
        firstName: "Paymob",
        lastName: "Live Smoke",
        email: `pym-live-smoke-${specialReference.slice(-8)}@test.local`,
        phone: null,
      },
    });

    expect(session.provider).toBe(PaymentGateway.Paymob);
    expect(session.providerReference).toBe(specialReference);
    expect(session.checkoutUrl).not.toBeNull();
    const checkoutUrl = new URL(expectString(session.checkoutUrl));
    expect(checkoutUrl.origin).toBe(new URL(config.checkoutBaseUrl).origin);
    expect(checkoutUrl.searchParams.get("publicKey")).toBe(creds.publicKey);
    const clientSecret = checkoutUrl.searchParams.get("clientSecret");
    expect(clientSecret).not.toBeNull();
    expect(expectString(clientSecret).length).toBeGreaterThan(10);
  });
});
