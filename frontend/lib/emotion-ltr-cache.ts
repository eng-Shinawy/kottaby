/**
 * Dedicated LTR-only Emotion cache for `LtrScope`.
 *
 * The main app cache (`emotion-cache.tsx`) may have the RTL stylis plugin
 * applied when the locale is Arabic. `LtrScope` wraps child content that must
 * stay LTR (e.g. code blocks, phone numbers) inside a SEPARATE cache that
 * never applies the RTL plugin — so physical margins/padding aren't flipped.
 *
 * Created once (singleton) and reused across all `LtrScope` instances.
 */

import createCache, { type EmotionCache } from "@emotion/cache";

let ltrCache: EmotionCache | null = null;

/**
 * Server singleton caches must defer insertions to the `useServerInsertedHTML`
 * flush in `emotion-cache.tsx` — inline `<style>` serialization during SSR
 * hydration-mismatches the client tree (same audit-CR3 root cause as the
 * main caches). Idempotent — safe to call on every cache access.
 */
function toServerCompat(cache: EmotionCache): EmotionCache {
  if (typeof window === "undefined") {
    cache.compat = true;
  }
  return cache;
}

/**
 * Returns the singleton LTR Emotion cache (created on first call).
 *
 * `prepend: true` injects styles at the top of `<head>` so they win the
 * cascade over the main RTL cache's styles for the same selectors.
 */
export function getLtrEmotionCache(): EmotionCache {
  ltrCache ??= toServerCompat(createCache({ key: "ltr", prepend: true }));
  return ltrCache;
}

/**
 * Alias consumed by the SSR style flush in `emotion-cache.tsx` — an Arabic
 * page renders with the main `mui-rtl` cache AND this nested `ltr` cache,
 * so the flush must drain both.
 */
export const getLtrScopeCache = getLtrEmotionCache;
