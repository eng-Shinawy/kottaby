/**
 * Admin-domain mutation barrel — side-effect-imports every mutation file in
 * this sub-directory.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - Sub-directory barrels use SIDE-EFFECT imports only (`import "./x.mutation";`)
 *    — the imported file registers root mutation fields on `gqlSchemaBuilder`
 *    at import time.
 *  - Wired through the top-level mutation barrel: `mutation/index.ts` → `gqlSchema.ts`.
 */
import "./admin-governance.mutation";
import "./admin-teachers.mutation";
import "./admin-users.mutation";
