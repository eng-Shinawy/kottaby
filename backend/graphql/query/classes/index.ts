/**
 * `classes` query-domain barrel — side-effect imports every query file in
 * this sub-directory.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - Each entry is a side-effect import — the imported file registers root
 *    query fields on `gqlSchemaBuilder` at import time. They have no named
 *    exports.
 *  - The top-level `backend/graphql/query/index.ts` imports THIS barrel;
 *    `gqlSchema.ts` imports the top-level barrel exactly once.
 */
import "./session-lifecycle.query";
