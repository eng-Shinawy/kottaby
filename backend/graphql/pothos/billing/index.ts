/**
 * Billing-domain Pothos barrel — re-exports the subscription purchase
 * object types plus the admin subscription-management inputs and the
 * `ChangeSubscriptionPlanPayload` object, which land ahead of their
 * resolver modules.
 *
 * The top-level `backend/graphql/pothos/index.ts` re-exports this module,
 * and `gqlSchema.ts` side-effect-imports that top-level barrel so these
 * object types are registered on `gqlSchemaBuilder` BEFORE `toSchema()`
 * finalizes the SDL. Resolvers import the objects directly from the leaf
 * modules (e.g. `@/backend/graphql/pothos/billing/subscription.pothos`),
 * matching the existing domain conventions; the plan-catalog and wallet
 * objects keep their resolver-transitive registration and are therefore
 * not carried here.
 */
export * from "./purchase-checkout.pothos";
export * from "./student-payment.pothos";
export * from "./subscription.pothos";
export * from "./subscription-admin.pothos";
