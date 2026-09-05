/**
 * Parents-domain mutation barrel — side-effect-imports every mutation file
 * in this sub-directory.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - Sub-directory barrels use SIDE-EFFECT imports only
 *    (`import "./x.mutation";`) — the imported file registers root
 *    mutation fields on `gqlSchemaBuilder` at import time and has no named
 *    exports.
 *  - The top-level `backend/graphql/mutation/index.ts` imports THIS
 *    barrel; `gqlSchema.ts` imports that top-level barrel exactly once.
 *  - `parent-link.mutation.ts` registers `requestParentChildLink`,
 *    `respondToParentLinkRequest`, and `cancelParentLinkRequest`.
 */
import "./parent-link.mutation";
