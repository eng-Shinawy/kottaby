/**
 * Billing-domain mutation barrel — side-effect imports every mutation file
 * in this sub-directory.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - Sub-directory barrels use SIDE-EFFECT imports only — the imported
 *    file registers root mutation fields on `gqlSchemaBuilder` at import
 *    time and has no named exports.
 *  - Wired via side-effect barrels: this barrel → `mutation/index.ts` →
 *    `gqlSchema.ts`.
 *  - `wallet.mutation.ts` registers `requestWithdrawal`;
 *    `subscription-admin.mutation.ts` registers the admin-gated
 *    subscription lifecycle mutations (`adminExtendSubscription`,
 *    `adminRenewSubscription`, `adminCancelSubscription`,
 *    `adminChangeSubscriptionPlan`).
 */
import "./subscription-admin.mutation";
import "./wallet.mutation";
