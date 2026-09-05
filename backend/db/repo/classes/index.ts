/**
 * Classes-domain repository barrel — re-exports every `*.repository.ts`
 * file in this sub-directory.
 *
 * Per `backend/db/repo/AGENTS.md`:
 *   - Each sub-directory has its own `index.ts` barrel re-exporting its
 *     `*.repository.ts` files.
 *   - The top-level `backend/db/repo/index.ts` re-exports this barrel, so
 *     consumers import from there (`import { SessionRepository } from
 *     "@/backend/db/repo"`).
 */

export * from "./session.repository";
export * from "./session-request-idempotency.repository";
