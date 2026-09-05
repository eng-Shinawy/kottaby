/**
 * Parents-domain query barrel — side-effect-imports every query file in
 * this sub-directory.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - Sub-directory barrels use SIDE-EFFECT imports only
 *    (`import "./x.query";`) — the imported file registers root query
 *    fields on `gqlSchemaBuilder` at import time and has no named exports.
 *  - The top-level `backend/graphql/query/index.ts` imports THIS barrel;
 *    `gqlSchema.ts` imports that top-level barrel exactly once.
 *  - `parent-link.query.ts` registers `myOutgoingParentLinkRequests` and
 *    `myIncomingParentLinkRequests`.
 */
import "./parent-link.query";
