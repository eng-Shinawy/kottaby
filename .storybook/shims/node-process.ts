/**
 * Vite shim for `node:process` in the Storybook browser bundle.
 *
 * The frontend logger (`frontend/lib/logger.ts`) imports `{ env }` from
 * `node:process` — Next.js polyfills that import in client bundles, but
 * Storybook's Vite pipeline externalizes node builtins and breaks the story
 * render. Stories get an empty env record (logger falls back to defaults).
 */
export const env: Record<string, string | undefined> = {};
