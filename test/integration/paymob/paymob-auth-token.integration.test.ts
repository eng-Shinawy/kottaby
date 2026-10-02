/**
 * Live Paymob smoke — auth-token minting (`POST api/auth/tokens`).
 *
 * One real round-trip against the configured Paymob host with the operator's
 * real API key, proving the server-to-server credential the reconciliation
 * sweep authenticates with is accepted by the vendor. Gated on the explicit
 * live opt-in (`PAYMOB_LIVE_TESTS=1`) plus a resolvable credential set —
 * absent either, the suite skips (never fails).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PaymobHttpClient } from "@/backend/services/billing/payment-gateway/paymob/paymob.http";
import { isPaymobLiveRunRequested, resolvePaymobLiveCredentials } from "@/test/helpers/paymob-live-env";
import { resolveLivePaymobConfig, setupPaymobLiveSuite } from "@/test/integration/paymob/helpers/paymob-live-suite";

const creds = resolvePaymobLiveCredentials();
const live = creds !== null && isPaymobLiveRunRequested();
let restoreSuite: (() => void) | undefined;

describe.skipIf(!live)("Paymob auth token minting @live-paymob", () => {
  beforeAll(() => {
    if (creds) {
      restoreSuite = setupPaymobLiveSuite(creds).restore;
    }
  });

  afterAll(() => {
    restoreSuite?.();
  });

  test("mints one API token from the live credentials", async () => {
    if (!creds) {
      throw new Error("unreachable: live gate guarantees credentials");
    }
    const client = new PaymobHttpClient({ config: resolveLivePaymobConfig() });

    const { token } = await client.mintAuthToken();

    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);
  });
});
