"use client";

import type { ReactNode } from "react";
import { DirectoryPagerRow } from "@/frontend/views/admin/directory-shared/DirectoryPagerRow";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminSessionsPager — the governance directory's prev/next pager row. It
 * renders ONLY when the honest total spans more than one page (the caller
 * guards that). The scaffolding (edge-clamped chevrons, `page / totalPages`
 * label, RTL flip, busy double-click guard) lives in the shared
 * `DirectoryPagerRow`; behavior is unchanged from the original inline
 * implementation.
 */

interface AdminSessionsPagerProps {
  /** Current 1-based page. */
  readonly page: number;
  /** Honest page count (never below 1). */
  readonly totalPages: number;
  /** Round-trip in flight over the settled payload — both chevrons disable. */
  readonly busy: boolean;
  /** Page-change intent — the container clamps before committing. */
  readonly onPageChange: (nextPage: number) => void;
  /** Shared sessions-namespace labels (pager aria vocabulary). */
  readonly tSessions: SessionsLabels;
}

/** Prev / `page / totalPages` / next pager row (edge-clamped buttons). */
export function AdminSessionsPager({
  page,
  totalPages,
  busy,
  onPageChange,
  tSessions,
}: Readonly<AdminSessionsPagerProps>): ReactNode {
  return (
    <DirectoryPagerRow
      testId="admin-session-governance-pager"
      page={page}
      totalPages={totalPages}
      busy={busy}
      prevLabel={tSessions.pagerPreviousLabel}
      nextLabel={tSessions.pagerNextLabel}
      onPageChange={onPageChange}
    />
  );
}
