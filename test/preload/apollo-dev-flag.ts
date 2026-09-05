/**
 * Apollo Client dev-mode flag — preload for suites that assert on Apollo's
 * development-mode warnings (e.g. the "Cache data may be lost" cache-data-loss
 * heuristic, invariant 118).
 *
 * Apollo's default (non-bundler) build resolves its internal `__DEV__` flag
 * from `globalThis.__DEV__ === true` at module-load time (see
 * `@apollo/client/utilities/environment`). Bun does not set this global, so
 * under `bun test` Apollo otherwise behaves like a production build and its
 * dev-only warnings are structurally inert — any "no warnings emitted"
 * assertion would be vacuously green.
 *
 * Registration: this module is wired as the LAST global `[test]` preload in
 * `bunfig.toml` (after `graphql-interop.ts`, before any test file can import
 * `@apollo/client`), so every `bun test` process — regardless of which file
 * loads Apollo first — runs Apollo in its dev posture, exactly like the
 * browser dev build. Suites that assert on the warnings additionally import
 * `apolloDevModePreloaded` FIRST in-file (a value import — bare side-effect
 * imports are lint-forbidden), which keeps the dependency explicit and
 * self-contained. The flag is captured when Apollo's environment module
 * evaluates and cannot be toggled afterwards — this preload is process-wide
 * by design.
 *
 * Side-effect safety for unrelated suites: dev mode only unlocks Apollo's
 * diagnostics; `console.*` stays no-op'd by the `logger-mock.ts` preload, so
 * no other suite's output or behavior changes (only console spies can
 * observe the warnings).
 *
 * The write goes through `Reflect.set` + bracket-style key: `__DEV__` is
 * Apollo's own external contract (dangling underscores are intentional), and
 * this avoids both a type assertion (`no-unsafe-type-assertion`) and a
 * dangling-underscore identifier — mirroring the test-only-preload intent of
 * `backend/db/test/ensure-env.ts` without its relaxed-path lint context.
 */

/** Marker for value imports (the module body performs the actual registration). */
export const apolloDevModePreloaded = true;

Reflect.set(globalThis, "__DEV__", true);
