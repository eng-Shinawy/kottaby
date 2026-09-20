"use client";

/**
 * SubscriptionRowsView — the body of the drawer's subscription-management
 * section: the query-failure alert, the loading skeleton, the empty state,
 * or the newest-first row cards. Split from `SubscriptionAdminSection` so
 * the section composes reads + writes + dialog state while this component
 * owns the list presentation (the directory label-value recipe plus the
 * per-status action buttons).
 *
 * The status filter-chip row (the `SubscriptionStatusFilterChips` lens)
 * mounts above the cards only while the student HAS rows — the empty
 * state owns the zero-rows case — and the rendered cards pass through the
 * selected lens; a lens that matches nothing while rows exist renders the
 * filter's own empty line instead of the section's zero-rows state. The
 * summary strip (the `SubscriptionSummaryStats` mini-cards) mounts
 * above the chip row and shares its lens selection. The strip, the chip
 * row, and each card ride a staggered fade-and-rise entrance (the
 * `subscriptionMotion` rhythm; skipped under reduced motion). Each card
 * opens with the plan-facts caption (the composed price display + the
 * counted session/cycle fragments) and closes with the audit deep link
 * carrying its trail-depth badge (the read's `auditEntriesCount`).
 *
 * Presentational: rows arrive pre-sorted; the status-label table resolves
 * here once per render from the namespace's per-enum slots (keyed by the
 * wire enum — never runtime string literals). Every visible string flows
 * from the `subscriptionAdmin` namespace; MUI v9 `sx`-only styling with
 * theme tokens only. The loading state is a skeleton mirroring the
 * settled anatomy (strip + chips + two cards) so the reveal doesn't
 * relayout.
 */
import { CardMembershipOutlined as CardMembershipIcon } from "@mui/icons-material";
import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { IconCircleEmptyState } from "@/frontend/components/ui/IconCircleEmptyState";
import type { SubscriptionStatus } from "@/frontend/graphql/generated/gql/graphql";
import { DirectoryErrorAlert } from "@/frontend/views/admin/directory-shared/DirectoryErrorAlert";
import type { OpenSubscriptionDialogKind } from "@/frontend/views/admin/students/subscriptions/hooks";
import { SubscriptionRowCard } from "@/frontend/views/admin/students/subscriptions/SubscriptionRowCard";
import { SubscriptionSectionSkeleton } from "@/frontend/views/admin/students/subscriptions/SubscriptionSectionSkeleton";
import { SubscriptionStatusFilterChips } from "@/frontend/views/admin/students/subscriptions/SubscriptionStatusFilterChips";
import { SubscriptionSummaryStats } from "@/frontend/views/admin/students/subscriptions/SubscriptionSummaryStats";
import {
  actionsForStatus,
  type SubscriptionRow,
  type SubscriptionStatusFilter,
} from "@/frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers";
import {
  entranceStyles,
  usePrefersReducedMotion,
} from "@/frontend/views/admin/students/subscriptions/subscriptionMotion";
import {
  rowCardLabelsOf,
  statusLabelsOf,
} from "@/frontend/views/admin/students/subscriptions/subscriptionView.helpers";
import type { AppLocale } from "@/shared/locale";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";
import type { SubscriptionAdminLabels } from "@/shared/locale/types/subscriptionAdmin";

interface SubscriptionRowsViewProps {
  /** All fetched rows, newest-first (the unfiltered lens). */
  readonly rows: readonly SubscriptionRow[];
  /** The rows passing the selected status lens (pre-filtered by the section). */
  readonly filteredRows: readonly SubscriptionRow[];
  /** The currently selected status lens. */
  readonly statusFilter: SubscriptionStatusFilter;
  /** Per-status tallies for the chip counts (the pure helper's table). */
  readonly counts: Record<SubscriptionStatus, number>;
  /** The soonest active-row bound (the summary banner), or `null`. */
  readonly nextBound: string | null;
  readonly loading: boolean;
  readonly hasQueryError: boolean;
  readonly errorCode: string | null;
  readonly labels: SubscriptionAdminLabels;
  readonly locale: AppLocale;
  /** The adminUsers activity block — single-sources the audit action labels. */
  readonly activityLabels: AdminUsersLabels["activity"];
  readonly onOpenDialog: (kind: OpenSubscriptionDialogKind, row: SubscriptionRow) => void;
  readonly onSelectFilter: (filter: SubscriptionStatusFilter) => void;
  readonly onRetry: () => void;
}

/**
 * The section's body: the query-failure alert, the loading skeleton, the
 * empty state, or the filter-chip row + the newest-first row cards (status
 * labels resolved once per render from the namespace's per-enum slots).
 */
export function SubscriptionRowsView({
  rows,
  filteredRows,
  statusFilter,
  counts,
  nextBound,
  loading,
  hasQueryError,
  errorCode,
  labels,
  locale,
  activityLabels,
  onOpenDialog,
  onSelectFilter,
  onRetry,
}: SubscriptionRowsViewProps): ReactNode {
  const reducedMotion = usePrefersReducedMotion();

  const statusLabels = statusLabelsOf(labels);

  let body: ReactNode;
  if (loading && rows.length === 0) {
    body = <SubscriptionSectionSkeleton />;
  } else if (hasQueryError && rows.length === 0) {
    // Settled first-load failure — the error alert above speaks for the
    // body (the disputes body's gating discipline): the empty state is
    // reserved for a clean settled list, never layered under the alert.
    body = null;
  } else if (rows.length === 0) {
    body = (
      <IconCircleEmptyState
        testId="subscription-admin-empty-state"
        icon={<CardMembershipIcon sx={theme => ({ fontSize: 36, color: theme.palette.text.secondary })} />}
        title={labels.emptyState.title}
        body={labels.emptyState.message}
      />
    );
  } else {
    body = (
      <Stack sx={{ gap: 1.5 }}>
        <Box sx={() => entranceStyles(0, reducedMotion)}>
          <SubscriptionSummaryStats
            counts={counts}
            nextBound={nextBound}
            selected={statusFilter}
            onSelect={onSelectFilter}
            labels={labels}
            locale={locale}
          />
        </Box>
        <Box sx={() => entranceStyles(1, reducedMotion)}>
          <SubscriptionStatusFilterChips
            labels={labels}
            counts={counts}
            total={rows.length}
            selected={statusFilter}
            onSelect={onSelectFilter}
          />
        </Box>
        {filteredRows.length === 0 ? (
          <Typography
            variant="body2"
            sx={theme => ({ py: 2, textAlign: "center", color: theme.palette.text.secondary })}
          >
            {labels.filter.empty}
          </Typography>
        ) : (
          filteredRows.map((row, index) => (
            <Box key={row.id} sx={() => entranceStyles(2 + index, reducedMotion)}>
              <SubscriptionRowCard
                row={row}
                actions={actionsForStatus(row.status)}
                statusLabels={statusLabels}
                labels={rowCardLabelsOf(labels, activityLabels)}
                locale={locale}
                onExtend={target => onOpenDialog("extend", target)}
                onRenew={target => onOpenDialog("renew", target)}
                onCancel={target => onOpenDialog("cancel", target)}
                onChangePlan={target => onOpenDialog("changePlan", target)}
              />
            </Box>
          ))
        )}
      </Stack>
    );
  }

  return (
    <>
      {hasQueryError && (
        <Box sx={{ mb: 2 }}>
          <DirectoryErrorAlert labels={labels.errorState} onRetry={onRetry} errorCode={errorCode} />
        </Box>
      )}
      {body}
    </>
  );
}
