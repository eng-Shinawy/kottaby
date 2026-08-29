/**
 * Billing-domain query barrel — side-effect-imports every query file in
 * this sub-directory.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - Sub-directory barrels use SIDE-EFFECT imports only (`import "./x.query";`)
 *    — the imported file registers root query fields on `gqlSchemaBuilder`
 *    at import time and has no named exports.
 *  - The top-level `backend/graphql/query/index.ts` imports THIS barrel;
 *    `gqlSchema.ts` imports that top-level barrel exactly once.
 *  - `plan-catalog.query.ts` registers `planCatalog` and `adminPlans`
 *    (and transitively registers the canonical `Plan` object type through
 *    its `PlanPothosObject` import).
 *  - `subscription.query.ts` registers `mySubscriptions` and
 *    `adminPendingSubscriptionRequests` (DEV1-006).
 *  - `admin-subscription.query.ts` registers `adminSubscriptions`
 *    (DEV1-009 — the admin lifecycle list; transitively registers the
 *    `AdminSubscription` / `AdminSubscriptionConnection` object types).
 */
import "./admin-subscription.query";
import "./plan-catalog.query";
import "./subscription.query";
