/**
 * Billing Pothos barrel — side-effect registration chain for the billing
 * domain's canonical GraphQL types.
 *
 * Importing this module evaluates every listed Pothos file exactly once
 * (ESM guarantees single evaluation), registering its scalar/object
 * definitions on the shared `gqlSchemaBuilder` before `gqlSchema.ts`
 * assembles the schema — the same side-effect barrel convention used by
 * `backend/graphql/mutation/` and `backend/graphql/query/`.
 *
 * Registration-only: no value exports. Consumers import the canonical refs
 * (e.g. `PlanPothosObject`) directly from their owning modules.
 */
import "./admin-subscription-request.pothos";
import "./plan.pothos";
import "./subscription.pothos";
