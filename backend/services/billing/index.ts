/**
 * Billing-domain services barrel — re-exports the wallet service (DEV3-013)
 * and the plan-catalog service (DEV1-005 / PR #28).
 *
 * Per `backend/services/AGENTS.md`: domain-driven architecture, one
 * namespace per service; the barrel is the only import path for consumers.
 */
export * from "./plan-catalog.service";
export * from "./wallet.service";
