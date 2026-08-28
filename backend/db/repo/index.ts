/**
 * Top-level repository barrel — re-exports every domain sub-directory.
 *
 * Consumers should import from here (`import { UserRepository } from "@/backend/db/repo"`)
 * so move/refactor churn stays contained to this barrel. Deep imports
 * (`@/backend/db/repo/users/user.repository`) are also valid for cases that
 * want to avoid pulling in transitive side-effects.
 *
 * Per `backend/db/repo/AGENTS.md`:
 *   - Each sub-directory has its own `index.ts` barrel re-exporting its
 *     `*.repository.ts` files.
 *   - This top-level barrel re-exports every sub-directory barrel.
 *   - One `namespace` per repository file; the namespace name is the canonical
 *     export `{Entity}Repository`.
 */

export * from "./admin";
export * from "./billing";
export * from "./parents";
export * from "./students";
export * from "./teachers";
export * from "./users";
