"use client";

import { CampaignOutlined as EmptyIcon } from "@mui/icons-material";
import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { ErrorRetryAlert } from "@/frontend/components/ui/ErrorRetryAlert";
import { IconCircleEmptyState } from "@/frontend/components/ui/IconCircleEmptyState";
import { NoticeSnackbar } from "@/frontend/components/ui/NoticeSnackbar";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import { SessionListLoadingSkeleton } from "@/frontend/components/ui/sessionList";
import type { AdminBroadcastsQuery } from "@/frontend/graphql/generated/gql/graphql";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode, normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import { BroadcastHistoryFilterBar } from "@/frontend/views/admin/broadcasts/BroadcastHistoryFilterBar";
import { BroadcastHistoryPager } from "@/frontend/views/admin/broadcasts/BroadcastHistoryPager";
import { BroadcastHistoryTable } from "@/frontend/views/admin/broadcasts/BroadcastHistoryTable";
import type {
  BroadcastHistoryFilterDraft,
  BroadcastHistoryNotice,
  BroadcastHistoryRow,
} from "@/frontend/views/admin/broadcasts/broadcast-history.helpers";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminBroadcasts } from "@/shared/locale/namespaces/adminBroadcasts";
import { Common } from "@/shared/locale/namespaces/common";

/**
 * BroadcastHistorySection — the History tab's full panel: the heading band,
 * the filter bar, and the swapping body below them. The visual state
 * matrix resolves in {@link HistoryBody} (module scope keeps the section
 * an orchestrator; the heading + filters render in EVERY branch, only the
 * body swaps):
 *
 * | # | Condition | Body |
 * |---|-----------|------|
 * | 1 | query in flight (no settled payload yet) | the shared sessions loading skeleton (`aria-busy`), pinned to the `admin-broadcasts-history-loading` testId |
 * | 2 | query error, mapping-table denial family (`permission-fallback` / `auth-recovery`) | shared `PermissionDeniedFallback` (non-admin callers fail the admin role leg into FORBIDDEN) |
 * | 3 | any other query error (masked 500 …) | `ErrorRetryAlert` with the shared common-namespace error copy + retry |
 * | 4 | zero items on the loaded page | shared icon-circle empty state (`emptyTitle` / `emptyBody`) |
 * | 5 | rows present | history table + inline pager (only when the honest total spans more than one page); while a round-trip is in flight over the settled payload (`busy`) the pager chevrons disable — a double-click can never fire a duplicate page re-key |
 *
 * Query-context errors classify through the SINGLE `mapGraphQLErrorByCode`
 * table (`frontend/providers/apollo/error-link.map.ts`) — never the server
 * `message`. The stop flow's outcome notice renders in the shared snackbar
 * slot (the container passes the notice + dismissal through).
 */

interface BroadcastHistorySectionProps {
  /** Settled directory payload, `undefined` until the first fetch resolves. */
  readonly data: AdminBroadcastsQuery | undefined;
  readonly loading: boolean;
  /** True while a directory round-trip is in flight over the SETTLED payload. */
  readonly listBusy: boolean;
  readonly error: unknown;
  /** Current 1-based page + its honest page count. */
  readonly page: number;
  readonly totalPages: number;
  readonly filterDraft: BroadcastHistoryFilterDraft;
  /** The stop flow's transient outcome notice (`null` closes the snackbar). */
  readonly notice: BroadcastHistoryNotice | null;
  readonly onDismissNotice: () => void;
  /** Directory-refetch intent (the error state's retry affordance). */
  readonly onRetry: () => void;
  readonly onPageChange: (nextPage: number) => void;
  readonly onFilterDraftChange: (patch: Partial<BroadcastHistoryFilterDraft>) => void;
  readonly onApplyFilters: (patch?: Partial<BroadcastHistoryFilterDraft>) => void;
  /** Open the read-only detail drawer for one broadcast. */
  readonly onViewDetails: (entry: BroadcastHistoryRow) => void;
  /** Open the stop-confirmation dialog for one broadcast. */
  readonly onStopIntent: (entry: BroadcastHistoryRow) => void;
}

/**
 * The swapping body — skeleton / denial fallback / error / empty /
 * table + pager. Receives the section's full prop bundle (spread at the
 * call site); the heading + filter bar chrome stays mounted above it in
 * every branch.
 */
function HistoryBody({
  loading,
  listBusy,
  error,
  data,
  page,
  totalPages,
  onRetry,
  onPageChange,
  onViewDetails,
  onStopIntent,
}: Readonly<BroadcastHistorySectionProps>): ReactNode {
  const t = useAppTranslation(AdminBroadcasts);
  const tCommon = useAppTranslation(Common);
  if (loading && data === undefined) {
    // Branch 1 — first fetch for the active filter/page. A cache-hit page
    // change keeps the settled table mounted (no skeleton flash on pager
    // round-trips).
    return <SessionListLoadingSkeleton testId="admin-broadcasts-history-loading" />;
  }
  if (error !== undefined && error !== null) {
    // Branches 2–3 — settled failures: denial family vs retryable copy.
    const rawCode = extractErrorCode(error);
    const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);
    const action = mapGraphQLErrorByCode(code, { contextKind: "query", hasForm: false });
    if (action?.kind === "permission-fallback" || action?.kind === "auth-recovery") {
      return <PermissionDeniedFallback />;
    }
    return (
      <Stack data-testid="admin-broadcasts-history-error" sx={{ py: { xs: 4, sm: 6 } }}>
        <ErrorRetryAlert title={tCommon.error} retryLabel={tCommon.retry} retryPending={false} onRetry={onRetry}>
          {null}
        </ErrorRetryAlert>
      </Stack>
    );
  }
  // Apollo settles queries with data-or-error; this narrow guard keeps the
  // compiler informed without unsafe assertions.
  if (!data) {
    return <SessionListLoadingSkeleton testId="admin-broadcasts-history-loading" />;
  }
  if (data.adminBroadcasts.items.length === 0) {
    // Branch 4 — zero rows on the loaded page (unfiltered or narrowed —
    // the frozen copy covers both arms).
    return (
      <IconCircleEmptyState
        testId="admin-broadcasts-history-empty"
        icon={<EmptyIcon />}
        title={t.emptyTitle}
        body={t.emptyBody}
      />
    );
  }
  // Branch 5 — rows present: table + inline pager (only when the honest
  // total spans more than one page).
  return (
    <Stack sx={{ gap: 2 }}>
      <BroadcastHistoryTable
        rows={data.adminBroadcasts.items}
        onViewDetails={onViewDetails}
        onStopIntent={onStopIntent}
      />
      {totalPages > 1 ? (
        <BroadcastHistoryPager page={page} totalPages={totalPages} busy={listBusy} onPageChange={onPageChange} t={t} />
      ) : null}
    </Stack>
  );
}

/** The History tab panel: heading + filter bar + state-matrix body + notice slot. */
export function BroadcastHistorySection(props: Readonly<BroadcastHistorySectionProps>): ReactNode {
  const t = useAppTranslation(AdminBroadcasts);

  return (
    <Stack sx={{ gap: { xs: 2, sm: 3 } }}>
      <Stack sx={{ gap: 0.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {t.historyTitle}
        </Typography>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.historySubtitle}
        </Typography>
      </Stack>
      <BroadcastHistoryFilterBar
        filterDraft={props.filterDraft}
        onFilterDraftChange={props.onFilterDraftChange}
        onApplyFilters={props.onApplyFilters}
      />
      <HistoryBody {...props} />
      <NoticeSnackbar notice={props.notice} autoHideDuration={6000} onClose={props.onDismissNotice} />
    </Stack>
  );
}
