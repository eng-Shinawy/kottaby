/**
 * Billing-domain query barrel — side-effect imports every query file in
 * this sub-directory.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - Sub-directory barrels use SIDE-EFFECT imports only — the imported
 *    file registers root query fields on `gqlSchemaBuilder` at import
 *    time and has no named exports.
 *  - Wired via side-effect barrels: this barrel → `query/index.ts` →
 *    `gqlSchema.ts`.
 *  - `wallet.query.ts` registers `myWallet` (DEV3-013).
 */
import "./wallet.query";
