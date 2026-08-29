/**
 * Test environment loader — preload that ensures env is loaded BEFORE any
 * test imports `@/backend/db`.
 *
 * Marks this process as a test server (`TEST_SERVER=1`) BEFORE
 * `backend/lib/env.ts` evaluates, and ensures the env loader has run.
 *
 * WHY the flag must land before `env.ts` module-eval (ordering contract):
 * - `applyDbEnvOverride()` force-loads `.env` DB keys at module-eval time to
 *   beat stale OS-env placeholders in local dev.
 * - That override is GATED on `TEST_SERVER !== "1"` — a test process launched
 *   with an explicit `--env-file=.env.test` must keep the test DB config.
 * - ES imports are hoisted: a static `import { ensureEnvironmentValidated }`
 *   would evaluate `env.ts` BEFORE the flag assignment below, re-clobbering
 *   `DATABASE_URL` back to the dev database. The dynamic `await import()`
 *   keeps the flag-first ordering.
 * - If `.env.test` is missing (flag absent pre-eval is impossible here, but a
 *   stale runner could drop it), validation below fails LOUDLY at preload
 *   time instead of silently running against the dev database.
 *
 * Loaded by `bunfig.toml` AFTER `logger-mock.ts` (so silenced logs apply
 * before any subsequent module-import noise). Top-level await is supported:
 * this file is only ever evaluated as a Bun test preload.
 */

// Mark this process as a test server — `logger.logDomainError` routes to
// `debug` (compact test logs) and `env.ts` skips the `.env` DB-key override.
process.env.TEST_SERVER = "1";

// `NODE_ENV` is typed as read-only in Bun's process types. Use a cast to
// override — this is a test-only preload, and the cast is intentional.
(process.env as { NODE_ENV?: string }).NODE_ENV = "test";

// NOW import env.ts — the flag above is already in place at its module-eval.
const { ensureEnvironmentValidated } = await import("@/backend/lib/env");

// Ensure DATABASE_URL / DB_PROVIDER / encryption key are present. Throws
// loudly at preload time if the active env file is missing required DB keys
// (rather than producing a confusing connection error deep inside a test).
try {
  ensureEnvironmentValidated();
} catch (error) {
  console.error("[ensure-env] Failed to validate test environment:", error);
  throw error;
}
