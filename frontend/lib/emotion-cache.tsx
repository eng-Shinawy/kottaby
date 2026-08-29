"use client";

/**
 * Locale-aware Emotion cache provider for the MUI theme tree.
 *
 * Creates TWO caches:
 *  - `mui-ltr` — standard cache (no RTL plugin) for English / LTR layouts.
 *  - `mui-rtl` — cache with `stylis-plugin-rtl` for Arabic / RTL layouts.
 *
 * The RTL plugin flips physical CSS properties (margin-left → margin-right,
 * padding-left → padding-right, etc.) so MUI components render correctly in
 * RTL mode. Without it, `direction: "rtl"` on the theme only flips text
 * direction but NOT physical spacing — causing TextField icons, padding, and
 * adornments to appear on the wrong side.
 *
 * The cache is selected based on the current locale (read from
 * `LocaleContext`). When the locale changes, the cache swaps, causing a
 * one-time style re-injection (acceptable for a locale switch).
 *
 * SSR style flush (App Router):
 *
 * Without a `useServerInsertedHTML` flush, @emotion/react serializes global
 * styles as INLINE `<style data-emotion="…-global">` nodes inside the tree
 * during the server render. On the client those nodes live in `<head>` (and
 * global insertions skip differently), so React's first hydration pass saw a
 * style node where the client rendered an element — "Hydration failed
 * because the server rendered HTML didn't match the client … this tree will
 * be regenerated on the client" on EVERY dashboard route (audit-CR3).
 *
 * The canonical Next.js + MUI pattern fixes this in two halves:
 *  1. Server caches run with `compat = true` — `Insertion` components defer
 *     serialization to the cache instead of rendering inline style nodes.
 *  2. `useServerInsertedHTML` emits the pending insertions ONCE into
 *     `<head>` with the `data-emotion="<key> <names…>"` header, which lets
 *     the client cache re-adopt those tags during hydration instead of
 *     re-inserting (and re-match the server HTML).
 *
 * NOTE on `nonce`: reserved for future CSP support (see module note in the
 * original static cache). Not currently applied.
 */
import createCache, { type EmotionCache } from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { useServerInsertedHTML } from "next/navigation";
import { type ReactNode, useMemo } from "react";
import { prefixer } from "stylis";
import rtlPlugin from "stylis-plugin-rtl";
import { useAppLocale } from "@/frontend/hooks/useAppLocale";
import { getLtrScopeCache } from "@/frontend/lib/emotion-ltr-cache";

let ltrCache: EmotionCache | null = null;
let rtlCache: EmotionCache | null = null;

/**
 * Server singleton caches must defer insertions to the RSC style flush.
 * Inline `<style>` nodes serialized by @emotion/react's `Insertion` during
 * SSR sit at a tree position the client never reproduces (global styles are
 * hoisted to `<head>` there), so hydration mismatches on every route.
 * Idempotent — safe to call on every cache access.
 */
function toServerCompat(cache: EmotionCache): EmotionCache {
  if (typeof window === "undefined") {
    cache.compat = true;
  }
  return cache;
}

function getLtrCache(): EmotionCache {
  ltrCache ??= toServerCompat(createCache({ key: "mui-ltr", prepend: true }));
  return ltrCache;
}

function getRtlCache(): EmotionCache {
  rtlCache ??= toServerCompat(
    createCache({
      key: "mui-rtl",
      prepend: true,
      stylisPlugins: [prefixer, rtlPlugin],
    })
  );
  return rtlCache;
}

/**
 * Serialize a cache's pending insertions into one hydration-resolvable
 * `<style>` tag (header lists the inserted names so the client cache adopts
 * the tag instead of re-inserting). Resets the server singleton's inserted
 * map afterwards so the next stream chunk / request only emits NEW styles —
 * prevents unbounded growth and duplicate emission across requests.
 *
 * Server-only side effect (`useServerInsertedHTML` never runs on the client).
 */
function flushedStyleTag(cache: EmotionCache): ReactNode {
  const names = Object.keys(cache.inserted);
  if (names.length === 0) {
    return null;
  }
  let css = "";
  for (const name of names) {
    const value = cache.inserted[name];
    if (typeof value === "string") {
      css += value;
    }
  }
  const tag = (
    <style
      key={`${cache.key}-ssr-flush`}
      data-emotion={`${cache.key} ${names.join(" ")}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Emotion SSR flush — CSS serialized by Emotion from our own style definitions (never user input); <style> cannot receive children during RSC streaming.
      dangerouslySetInnerHTML={{ __html: css }}
    />
  );
  cache.inserted = {};
  return tag;
}

interface EmotionCacheProviderProps {
  readonly children: ReactNode;
  /** CSP nonce — reserved for future CSP support. */
  readonly nonce?: string;
}

export default function EmotionCacheProvider({ children }: Readonly<EmotionCacheProviderProps>) {
  const locale = useAppLocale();
  const cache = useMemo(() => (locale === "ar" ? getRtlCache() : getLtrCache()), [locale]);

  // Flush the active main cache (mui-rtl / mui-ltr) AND the nested LtrScope
  // cache — an Arabic page uses both, and scope styles would otherwise fall
  // back to inline SSR serialization (same hydration mismatch).
  useServerInsertedHTML(() => {
    const main = flushedStyleTag(cache);
    const scoped = flushedStyleTag(getLtrScopeCache());
    if (main === null && scoped === null) {
      return null;
    }
    return (
      <>
        {main}
        {scoped}
      </>
    );
  });

  return <CacheProvider value={cache}>{children}</CacheProvider>;
}
