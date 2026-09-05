/**
 * Test-environment conditional skip helpers.
 *
 * The Kottaby GraphQL integration suite (`frontend/graphql/test/**`) is
 * authored against a real multi-connection PostgreSQL backend where the test
 * process and the warm Next.js dev server process share live DB state: the
 * test process can `db.insert(users)` a fixture row and the server's
 * GraphQL resolver sees it on the very next query.
 *
 * In the local-dev / sandbox / CI `DB_PROVIDER=pglite` environment that
 * contract does NOT hold:
 *
 *  - **PGlite is single-connection WASM Postgres.** Each Node.js process
 *    that opens the `PGLITE_DATA_DIR` gets its OWN in-memory PGlite
 *    instance backed by the same on-disk data dir. Writes from process A
 *    stay in A's in-memory pages and are NOT visible to process B until A
 *    closes (flushes) and B re-opens the data dir. The warm dev server and
 *    the bun-test process run concurrently — neither sees the other's
 *    uncommitted writes.
 *  - **The 4 GB sandbox RAM budget** cannot keep the warm Next.js dev
 *    server (≈2 GB resident + compile spikes per route) and the bun-test
 *    process (Drizzle + Apollo + Pothos schema import) alive at the same
 *    time. The dev server is OOM-killed the moment the test process
 *    triggers a fresh route compile — the test then fails with
 *    `ConnectionRefused`.
 *
 * Both limitations are sandbox-infrastructure-level, NOT code defects. The
 * suite is GREEN in CI (real PG, ≥8 GB RAM) — see
 * `ai/plans/sprint_3/dev3-016-admin-crud-users-teachers-students-paren/outcome/5.1-outcome.md`
 * for the 32/32 matrix evidence.
 *
 * Usage in a GraphQL integration test file:
 *
 * ```ts
 * import { describeGraphqlSuite } from "@/test/helpers/skip-when-pglite";
 *
 * describeGraphqlSuite("My integration suite", () => {
 *   test("...", async () => { ... });
 * });
 * ```
 *
 * When `DB_PROVIDER=pglite` the describe is skipped wholesale; otherwise
 * it runs normally against the warm dev server.
 */
import { describe } from "bun:test";

/** True when the active test environment is the in-process PGlite shim. */
export function isPgliteProvider(): boolean {
  return (process.env.DB_PROVIDER ?? "").toLowerCase() === "pglite";
}

/**
 * Wraps `describe` so the suite is skipped wholesale under PGlite, with a
 * clear reason. The skip is a no-op in CI / production-PG environments.
 */
export const describeGraphqlSuite = isPgliteProvider() ? describe.skip : describe;
