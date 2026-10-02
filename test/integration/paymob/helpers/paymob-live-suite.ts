/**
 * Shared live-suite harness for the Paymob provider smokes: one place that
 * installs the canonical env fixture from the resolved live credentials,
 * keeps the callback-channel factory away from the real tunnel (the smokes
 * validate the provider HTTP boundary, not tunnel transport), and resets
 * every configuration cache so the adapter + factory re-read the fixture.
 *
 * Each smoke file calls `setupPaymobLiveSuite(creds)` in `beforeAll` and the
 * returned restore in `afterAll` — the fixture env keys are always restored,
 * so the rest of the suite pool is unaffected by a live run.
 */

import { getPaymobConfig, resetEnvironmentCache } from "@/backend/lib/env";
import { resetCallbackChannel } from "@/backend/services/billing/payment-gateway/callback-channel/callback-channel.factory";
import { resetPaymentGateway } from "@/backend/services/billing/payment-gateway/payment-gateway.factory";
import type { PaymobResolvedConfig } from "@/backend/types";
import { installPaymobLiveEnvFixture, type PaymobLiveCredentials } from "@/test/helpers/paymob-live-env";

/** Tunnel keys the smokes must keep absent (a tunnel resolution would spawn a real agent). */
const TUNNEL_KEYS = ["NGROK_AUTHTOKEN", "NGROK_DOMAIN"] as const;

export interface PaymobLiveSuiteHandle {
  /** Restores every mutated env key and resets the configuration caches. */
  restore(): void;
}

/**
 * Installs the live fixture: paymob provider active, tunnel keys absent,
 * canonical `PAYMOB_*` keys set from the resolved live credentials, and all
 * configuration caches invalidated so the next read sees the fixture.
 */
export function setupPaymobLiveSuite(creds: PaymobLiveCredentials): PaymobLiveSuiteHandle {
  const savedProvider = process.env.PAYMENT_GATEWAY_PROVIDER;
  const savedTunnel = new Map(TUNNEL_KEYS.map(key => [key, process.env[key]]));
  const restoreLiveFixture = installPaymobLiveEnvFixture(creds);

  process.env.PAYMENT_GATEWAY_PROVIDER = "paymob";
  for (const key of TUNNEL_KEYS) {
    delete process.env[key];
  }
  resetEnvironmentCache();
  resetPaymentGateway();
  resetCallbackChannel();

  return {
    restore(): void {
      restoreLiveFixture();
      if (savedProvider === undefined) {
        delete process.env.PAYMENT_GATEWAY_PROVIDER;
      } else {
        process.env.PAYMENT_GATEWAY_PROVIDER = savedProvider;
      }
      for (const [key, value] of savedTunnel.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      resetEnvironmentCache();
      resetPaymentGateway();
      resetCallbackChannel();
    },
  };
}

/**
 * Narrows the fixture-resolved env snapshot into the concrete client
 * configuration — the same fail-closed narrowing the adapter performs per
 * operation, applied here once per smoke file so the raw HTTP client calls
 * carry the exact credentials the env fixture installed.
 */
export function resolveLivePaymobConfig(): PaymobResolvedConfig {
  const config = getPaymobConfig();
  if (
    config.secretKey === null ||
    config.publicKey === null ||
    config.hmacSecret === null ||
    config.apiKey === null ||
    config.integrationIdCard === null
  ) {
    throw new Error("live paymob suite: env fixture did not resolve a complete credential set");
  }
  return {
    secretKey: config.secretKey,
    publicKey: config.publicKey,
    hmacSecret: config.hmacSecret,
    apiKey: config.apiKey,
    integrationIdCard: config.integrationIdCard,
    integrationIdWallet: config.integrationIdWallet,
    apiBaseUrl: config.apiBaseUrl,
    checkoutBaseUrl: config.checkoutBaseUrl,
    httpTimeoutMs: config.httpTimeoutMs,
  };
}
