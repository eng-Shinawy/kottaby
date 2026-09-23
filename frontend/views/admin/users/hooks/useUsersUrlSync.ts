"use client";

/**
 * useUsersUrlSync — the admin users directory's shareable-URL write-back
 * (the URL mirrors the APPLIED state).
 *
 * The APPLIED (post-debounce) state — never the raw draft — serializes into
 * the query string through `router.replace` (no history entry per
 * keystroke). Defaults are OMITTED (a clean surface shares as the bare
 * path), the write is skipped when the URL already matches (no replace
 * churn on unrelated re-renders), and `{ scroll: false }` keeps the
 * viewport anchored while typing or paging.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * Replaces the URL with `appliedQuery` whenever the live query string
 * drifts from it.
 */
export function useUsersUrlSync(appliedQuery: string): void {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const currentQuery = searchParams.toString();
  useEffect(() => {
    if (currentQuery !== appliedQuery) {
      router.replace(appliedQuery === "" ? pathname : `${pathname}?${appliedQuery}`, { scroll: false });
    }
    // `currentQuery` re-runs the guard whenever the URL changes; after the
    // replace it already mirrors the applied state, so the effect skips —
    // one extra pass, zero replace churn.
  }, [appliedQuery, router, pathname, currentQuery]);
}
