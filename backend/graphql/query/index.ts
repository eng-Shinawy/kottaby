/**
 * Top-level query barrel — side-effect imports every query file.
 *
 * Per `backend/graphql/query/AGENTS.md`:
 *  - `gqlSchema.ts` imports this module exactly once: `import "@/backend/graphql/query";`.
 *  - Each entry is a side-effect import — the imported file registers root
 *    query fields on `gqlSchemaBuilder` at import time. They have no named
 *    exports.
 *  - To add a new query: create `<entity>.query.ts` in the matching
 *    sub-directory and add a side-effect import to that sub-directory's
 *    `index.ts`.
 *
 * `auth.query.ts` wires the `me` query; the other entries register the
 * health, recitation, billing, and teacher-domain queries.
 */
import "./auth.query";
import "./billing";
import "./health.query";
import "./recitation.query";
import "./teachers";
