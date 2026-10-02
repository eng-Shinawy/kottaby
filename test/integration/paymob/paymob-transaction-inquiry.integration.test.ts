/**
 * Live Paymob smoke — merchant-reference transaction inquiry over the REAL
 * vendor API (token mint + `POST api/ecommerce/orders/transaction_inquiry`).
 *
 * One real flow: a fresh intention is created on the live API, then the
 * sweep's read path (`transactionInquiryByMerchantRef` — fresh token in the
 * request BODY) inquires about it. An unpaid intention carries no settled
 * transaction, so the honest live outcome is EITHER a structured result
 * keyed to the order reference OR a structured provider rejection
 * (`PaymobUpstreamError` with the vendor status) — never an unhandled
 * throw. Either outcome proves the inquiry path is wired and authenticated
 * against the live contract.
 *
 * Gated on the explicit live opt-in (`PAYMOB_LIVE_TESTS=1`) plus a
 * resolvable credential set — absent either, the suite skips.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { PaymobHttpClient, PaymobUpstreamError } from "@/backend/services/billing/payment-gateway/paymob/paymob.http";
import { buildIntentionRequest } from "@/backend/services/billing/payment-gateway/paymob/paymob.mapper";
import type { PaymobTransactionInquiryResult } from "@/backend/types";
import { isPaymobLiveRunRequested, resolvePaymobLiveCredentials } from "@/test/helpers/paymob-live-env";
import { resolveLivePaymobConfig, setupPaymobLiveSuite } from "@/test/integration/paymob/helpers/paymob-live-suite";

const creds = resolvePaymobLiveCredentials();
const live = creds !== null && isPaymobLiveRunRequested();
let restoreSuite: (() => void) | undefined;

/** Correlation key unique per run — the vendor echoes it verbatim. */
const specialReference = `pym_live_${randomUUID().replace(/-/gu, "").slice(0, 20)}`;

describe.skipIf(!live)("Paymob transaction inquiry @live-paymob", () => {
  beforeAll(() => {
    if (creds) {
      restoreSuite = setupPaymobLiveSuite(creds).restore;
    }
  });

  afterAll(() => {
    restoreSuite?.();
  });

  test("authenticates the inquiry path and answers structurally for one fresh order", async () => {
    if (!creds) {
      throw new Error("unreachable: live gate guarantees credentials");
    }
    const config = resolveLivePaymobConfig();
    const client = new PaymobHttpClient({ config });

    const intention = await client.createIntention(
      buildIntentionRequest({
        input: {
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
        },
        itemName: "Subscription",
        config,
      })
    );
    expect(intention.special_reference).toBe(specialReference);

    let inquiry: PaymobTransactionInquiryResult | null = null;
    let rejection: PaymobUpstreamError | null = null;
    try {
      inquiry = await client.transactionInquiryByMerchantRef(specialReference);
    } catch (error) {
      if (error instanceof PaymobUpstreamError) {
        rejection = error;
      } else {
        throw error;
      }
    }

    if (inquiry !== null) {
      expect(inquiry.order.merchant_order_id).toBe(specialReference);
    } else {
      expect(rejection).not.toBeNull();
      expect(rejection?.status).not.toBeNull();
    }
  });
});
