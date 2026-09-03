/**
 * Admin-domain query barrel — side-effect-imports every query file in this
 * sub-directory.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - Sub-directory barrels use SIDE-EFFECT imports only (`import "./x.query";`)
 *    — the imported file registers root query fields on `gqlSchemaBuilder`
 *    at import time.
 *  - Wired through the top-level query barrel: `query/index.ts` → `gqlSchema.ts`.
 */
import "./admin-users.query";
import "./audit-trail.query";
