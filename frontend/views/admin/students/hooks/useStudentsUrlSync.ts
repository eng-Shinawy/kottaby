"use client";

/**
 * useStudentsUrlSync — the SHAREABLE-URL mirror of the APPLIED state.
 *
 * The APPLIED (post-debounce) state — never the raw draft — serializes
 * into the query string through `router.replace` (no history entry per
 * keystroke; back/forward navigate BETWEEN surfaces, not between filter
 * states). Defaults are OMITTED (a clean surface shares as the bare
 * path), the write is skipped when the URL already matches (no replace
 * churn on unrelated re-renders), and `{ scroll: false }` keeps the
 * viewport anchored while typing or paging.
 *
 * Extracted from `useAdminStudentsDirectory`, which composes it with the
 * filter draft state, the query, and the export/feedback flows.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { serializeStudentsUrlState } from "@/frontend/views/admin/directory-url-state";
import type { StudentHasParentFilter } from "@/frontend/views/admin/students/adminStudentsDirectory.helpers";

/** The applied (post-debounce) directory state the URL mirrors. */
interface StudentsUrlSyncState {
  readonly q: string;
  readonly parent: StudentHasParentFilter | "";
  readonly lang: string;
  readonly page: number;
  readonly pageSize: number;
}

export function useStudentsUrlSync(state: StudentsUrlSyncState): void {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const appliedQuery = serializeStudentsUrlState({
    q: state.q,
    parent: state.parent,
    lang: state.lang,
    page: state.page,
    pageSize: state.pageSize,
  });
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
