"use client";

import type { ReactNode } from "react";
import { DirectoryPagerRow } from "@/frontend/views/admin/directory-shared/DirectoryPagerRow";
import type { AdminBroadcastsLabels } from "@/shared/locale/types/adminBroadcasts";

/**
 * BroadcastHistoryPager — the history directory's prev/next pager row. It
 * renders ONLY when the honest total spans more than one page (the caller
 * guards that). The scaffolding (edge-clamped chevrons, `page / totalPages`
 * label, RTL flip, busy double-click guard) lives in the shared
 * `DirectoryPagerRow`.
 */

interface BroadcastHistoryPagerProps {
  /** Current 1-based page. */
  readonly page: number;
  /** Honest page count (never below 1). */
  readonly totalPages: number;
  /** Round-trip in flight over the settled payload — both chevrons disable. */
  readonly busy: boolean;
  /** Page-change intent — the data hook clamps before committing. */
  readonly onPageChange: (nextPage: number) => void;
  /** Shared AdminBroadcasts labels (pager aria vocabulary). */
  readonly t: AdminBroadcastsLabels;
}

/** Prev / `page / totalPages` / next pager row (edge-clamped buttons). */
export function BroadcastHistoryPager({
  page,
  totalPages,
  busy,
  onPageChange,
  t,
}: Readonly<BroadcastHistoryPagerProps>): ReactNode {
  return (
    <DirectoryPagerRow
      testId="admin-broadcasts-history-pager"
      page={page}
      totalPages={totalPages}
      busy={busy}
      prevLabel={t.pagerPrev}
      nextLabel={t.pagerNext}
      onPageChange={onPageChange}
    />
  );
}
