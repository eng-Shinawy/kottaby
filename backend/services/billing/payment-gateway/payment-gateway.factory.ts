/**
 * Payment gateway factory — the provider-agnostic seam that resolves the
 * active `PaymentGatewayPort` adapter from configuration.
 *
 * Consumers (purchase service, webhook route) call `getPaymentGateway()`
 * and never construct adapters directly, so swapping the built-in mock for
 * a real gateway is a configuration change with zero domain-code impact.
 *
 * Resolution semantics:
 *  - The adapter is a lazy singleton keyed on the registered
 *    `PAYMENT_GATEWAY_PROVIDER` env key (read through the typed env getter —
 *    never raw `process.env`); missing/empty values resolve to the built-in
 *    `mock` provider.
 *  - A configured provider without an adapter implementation fails CLOSED
 *    with a localized typed error — the purchase flow never silently falls
 *    back to a different provider than the deployment asked for. Lookups are
 *    own-property guarded, so inherited `Object.prototype` members
 *    (`constructor`, `toString`, …) fail closed too instead of resolving to
 *    a stray inherited value.
 *  - `resetPaymentGateway()` drops the resolved adapter AND invalidates the
 *    shared env snapshot, so provider/secret/enabled changes are observable
 *    on the next resolution without a process restart.
 *  - The built-in `mock` provider is refused in a real production runtime
 *    (`NODE_ENV=production` without the test runners' `TEST_SERVER=1`) —
 *    fail-closed via {@link assertMockDevelopmentRuntime}, so a deployment
 *    that forgets `PAYMENT_GATEWAY_PROVIDER` can never silently simulate
 *    settlements (the mock adapter asserts the same guard internally).
 */

import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { getPaymentGatewayProvider, resetEnvironmentCache } from "@/backend/lib/env";
import { ValidationError } from "@/backend/lib/errors";
import {
  assertMockDevelopmentRuntime,
  MockPaymentGatewayAdapter,
} from "@/backend/services/billing/payment-gateway/mock-payment-gateway.adapter";
import { PaymobPaymentGateway } from "@/backend/services/billing/payment-gateway/paymob/paymob.adapter";
import type { PaymentGatewayPort } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** The resolved adapter singleton (bounded to exactly one instance; reset-able). */
let gateway: PaymentGatewayPort | null = null;

/**
 * Adapter registry keyed by the canonical gateway provider value. Adding a
 * real gateway later is one registry row plus its adapter module — the
 * purchase flow and webhook route stay untouched.
 *
 * Lookups MUST stay own-property guarded (`Object.hasOwn` in
 * {@link getPaymentGateway}): as a plain object, inherited `Object.prototype`
 * members (`constructor`, `toString`, …) otherwise resolve truthy and would
 * be cached as the gateway instead of failing closed.
 */
const GATEWAY_ADAPTERS: Readonly<Record<string, () => PaymentGatewayPort>> = {
  [PaymentGateway.Mock]: () => new MockPaymentGatewayAdapter(),
  [PaymentGateway.Paymob]: () => new PaymobPaymentGateway(),
};

/**
 * Returns the active payment gateway adapter, constructing it on first use
 * and reusing the resolved instance afterwards.
 *
 * @param locale Optional request locale for the fail-closed configuration
 *   error message; defaults to the deployment default.
 * @throws ValidationError (`PAYMENT_GATEWAY_UNSUPPORTED`) when the configured
 *   provider has no adapter implementation — fail-closed, never a fallback.
 */
export function getPaymentGateway(locale?: string): PaymentGatewayPort {
  if (gateway) {
    return gateway;
  }

  const provider = getPaymentGatewayProvider();
  // Own-property guard — inherited `Object.prototype` names (`constructor`,
  // `toString`, …) must fail CLOSED exactly like any other unknown provider
  // (same discipline as the error-code taxonomy's normalization table).
  const createAdapter = Object.hasOwn(GATEWAY_ADAPTERS, provider) ? GATEWAY_ADAPTERS[provider] : undefined;
  if (!createAdapter) {
    const tErrors = getServerTranslations(locale ?? "en").errorsTranslations;
    throw new ValidationError("PAYMENT_GATEWAY_UNSUPPORTED", tErrors.validation);
  }

  // Fail-closed runtime guard: the built-in mock simulates settlements, so a
  // real production deployment without an explicit provider silently running
  // it must be impossible — the shared guard (also asserted inside the mock
  // adapter) refuses it in production, exempting only the test runners'
  // TEST_SERVER=1 production-build E2E server. The provider resolves as its
  // canonical string, so the enum member is compared in its string form.
  if (provider === (PaymentGateway.Mock as string)) {
    assertMockDevelopmentRuntime();
  }

  gateway = createAdapter();
  return gateway;
}

/**
 * Invalidates the resolved gateway and every env key the gateway subsystem
 * resolved through the shared snapshot (provider, webhook secret, webhook
 * enabled flag). The next `getPaymentGateway()` re-reads configuration from
 * scratch, so env swaps and test fixtures take effect immediately.
 */
export function resetPaymentGateway(): void {
  gateway = null;
  resetEnvironmentCache();
}
