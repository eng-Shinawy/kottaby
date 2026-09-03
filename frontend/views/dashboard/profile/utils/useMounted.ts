"use client";

import { useSyncExternalStore } from "react";

/**
 * Mounted guard — returns `false` during SSR / first client render, `true`
 * after hydration. Implemented with `useSyncExternalStore` (no
 * `setState`-in-effect) so the React Compiler + oxlint
 * `react/set-state-in-effect` rule stays green.
 *
 * Used to defer rendering of auth-aware UI until the client has had a chance
 * to read its cookies / Apollo cache. Server and first-client render both
 * produce the loading state; the second client render reveals the resolved
 * auth state — no hydration mismatch.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}
