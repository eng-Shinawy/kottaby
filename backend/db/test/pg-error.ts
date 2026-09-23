/**
 * PostgreSQL error-chain inspection helpers shared by the DB and service
 * test suites. Extracted from 16 per-file copies so the cause-chain walk
 * cannot drift apart across suites (backend/db/test/AGENTS.md: aggressively
 * avoid code duplication).
 *
 * TEST-ONLY module: must never be imported from production code.
 */

/**
 * Walks the Drizzle `DrizzleQueryError.cause` chain to find whether the
 * original PostgreSQL error carries the given SQLSTATE code — Drizzle wraps
 * driver errors behind its own generic "failed query" message, so the code
 * only surfaces on the underlying `pg` error instance.
 */
export function hasPostgresErrorCode(error: unknown, pgCode: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === pgCode) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
