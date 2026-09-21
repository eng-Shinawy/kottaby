"use client";

import type { ReactNode } from "react";
import { DirectoryPagerRow } from "@/frontend/views/admin/directory-shared/DirectoryPagerRow";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminDisputesPager — the admin arbitration queue's prev/next pager. It
 * renders ONLY when the honest total spans more than one page (the caller
 * guards that); the page label reads `page / totalPages` and both buttons
 * clamp at the edges (`disabled` at page 1 and the last page). Delegates
 * to `DirectoryPagerRow`.
 */

interface AdminDisputesPagerProps {
  /** Current 1-based page. */
  readonly page: number;
  /** Honest page count (never below 1). */
  readonly totalPages: number;
  /** Page-change intent — the container clamps before committing. */
  readonly onPageChange: (nextPage: number) => void;
  /** Localized sessions-namespace labels (pager aria vocabulary). */
  readonly t: SessionsLabels;
}

/** Prev / `page / totalPages` / next pager row (edge-clamped buttons). */
export function AdminDisputesPager({
  page,
  totalPages,
  onPageChange,
  t,
}: Readonly<AdminDisputesPagerProps>): ReactNode {
  return (
    <DirectoryPagerRow
      testId="admin-disputes-pager"
      page={page}
      totalPages={totalPages}
      busy={false}
      prevLabel={t.pagerPreviousLabel}
      nextLabel={t.pagerNextLabel}
      onPageChange={onPageChange}
    />
  );
}
