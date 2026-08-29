/**
 * Top-level mutation barrel — side-effect imports every mutation file.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - `gqlSchema.ts` imports this module exactly once: `import "@/backend/graphql/mutation";`.
 *  - Each entry is a side-effect import — the imported file registers root
 *    mutation fields on `gqlSchemaBuilder` at import time. They have no
 *    named exports.
 *  - To add a new mutation: create `<entity>.mutation.ts` and add a
 *    side-effect import here.
 *
 * `auth.mutation.ts` wires the auth mutations (`registerUser`, `login`,
 * `refreshToken`, `logout`).
 * `plan-catalog.mutation.ts` wires the admin plan catalog mutations
 * (`createPlan`, `updatePlan`, `setPlanActiveStatus`).
 */
import "./auth.mutation";
import "./plan-catalog.mutation";
