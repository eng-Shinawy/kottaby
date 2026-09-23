"use client";

import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { SessionStickyBar } from "@/frontend/components/ui/sessionList";
import { AdminSessionFilterBar } from "@/frontend/views/admin/session-governance/AdminSessionFilterBar";
import type {
  DirectoryFilterDraft,
  StatusSummaryCounts,
} from "@/frontend/views/admin/session-governance/AdminSessionGovernanceContainer";
import { AdminSessionSummaryStrip } from "@/frontend/views/admin/session-governance/AdminSessionSummaryStrip";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminSessionGovernanceChrome — the ALWAYS-ON chrome of the admin session
 * governance directory (`/admin/session-governance`): the page
 * title over the sticky honest-count bar, the per-status summary strip
 * ({@link AdminSessionSummaryStrip}), and the directory filter bar
 * ({@link AdminSessionFilterBar}). It renders in EVERY branch of the body
 * state matrix (skeleton / denial / error / empty / rows) — only the body
 * BELOW it swaps.
 *
 * Summary strip — per-status counts derive from the LOADED directory page
 * (real data only; the container passes the honest server `totalCount` for
 * the sticky bar and nothing is extrapolated across pages). The
 * needs-attention card uses the warning tone (the same badge family as the
 * row chip).
 *
 * Filter bar — teacher/student user-id inputs (whole numbers only; the wire
 * members are `Int`), the session-type and session-status selects (token
 * space: an explicit "all" token clears the filter — no enum comparisons),
 * and the half-open creation window (`date` inputs committed as inclusive
 * from-midnight / EXCLUSIVE to-midnight UTC instants). APPLY validates the
 * draft and commits; RESET restores the unfiltered directory. Draft/apply
 * orchestration lives in the container — this bar is a pure affordance.
 *
 * Status vocabulary reuses the shared sessions-namespace status labels via
 * the `STATUS_LABEL_KEY` table; tones/icons come from the shared
 * presentation tables. MUI v9 discipline: `sx`-only styling, colors
 * exclusively through `theme.palette.*` callbacks, `*Outlined` icons only,
 * RTL-safe logical composition (grid + logical alignment, no physical
 * margins).
 */

interface AdminSessionGovernanceChromeProps {
  /** Localized page title. */
  readonly title: string;
  /** Localized honest-total line (server `totalCount`). */
  readonly countLine: string;
  /** Per-status counts over the loaded page (real data only). */
  readonly statusCounts: StatusSummaryCounts;
  /** Needs-attention card label (summary strip). */
  readonly needsAttentionLabel: string;
  /** Scope hint — the counts describe the LOADED page. */
  readonly summaryScopeHint: string;
  /** Shared sessions-namespace labels (status chip vocabulary). */
  readonly statusLabels: SessionsLabels;
  readonly filterDraft: DirectoryFilterDraft;
  /** True when the last APPLY carried a non-whole-number TEACHER id token. */
  readonly filterInvalidTeacherId: boolean;
  /** True when the last APPLY carried a non-whole-number STUDENT id token. */
  readonly filterInvalidStudentId: boolean;
  /** Localized invalid-id message for the offending id field. */
  readonly filterInvalidMessage: string;
  /** Draft edit intent (the container owns validation + commit). */
  readonly onFilterDraftChange: (patch: Partial<DirectoryFilterDraft>) => void;
  readonly onApplyFilters: () => void;
  readonly onResetFilters: () => void;
}

/** Title + sticky honest-count bar + status summary + filter bar. */
export function AdminSessionGovernanceChrome({
  title,
  countLine,
  statusCounts,
  needsAttentionLabel,
  summaryScopeHint,
  statusLabels,
  filterDraft,
  filterInvalidTeacherId,
  filterInvalidStudentId,
  filterInvalidMessage,
  onFilterDraftChange,
  onApplyFilters,
  onResetFilters,
}: Readonly<AdminSessionGovernanceChromeProps>): ReactNode {
  return (
    <Stack sx={{ gap: 2 }}>
      <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      <SessionStickyBar>
        <Typography
          variant="body2"
          data-testid="admin-session-governance-count"
          sx={theme => ({ color: theme.palette.text.secondary })}
        >
          {countLine}
        </Typography>
      </SessionStickyBar>

      <AdminSessionSummaryStrip
        statusCounts={statusCounts}
        needsAttentionLabel={needsAttentionLabel}
        summaryScopeHint={summaryScopeHint}
        statusLabels={statusLabels}
      />

      <AdminSessionFilterBar
        filterDraft={filterDraft}
        filterInvalidTeacherId={filterInvalidTeacherId}
        filterInvalidStudentId={filterInvalidStudentId}
        filterInvalidMessage={filterInvalidMessage}
        onFilterDraftChange={onFilterDraftChange}
        onApplyFilters={onApplyFilters}
        onResetFilters={onResetFilters}
        statusLabels={statusLabels}
      />
    </Stack>
  );
}
