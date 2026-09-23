/**
 * Payment-gateway port barrel — the provider-agnostic gateway runtime.
 *
 * Per `backend/services/AGENTS.md`: consumers import the gateway only
 * through this barrel — the factory seam (never a concrete adapter) and
 * the pure webhook signature verifier.
 */
export * from "./mock-payment-gateway.adapter";
export * from "./payment-gateway.factory";
export * from "./webhook-signature.helpers";
