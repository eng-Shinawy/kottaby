"use client";

import { Button, Stack, Typography } from "@mui/material";
import type { Dispatch, ReactNode, SetStateAction } from "react";
// audit-R4: shared keyboard-focus ring (v9 ButtonBase ships none).
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import type { MyNotificationsQuery_myNotifications_items } from "@/frontend/graphql/generated/gql/graphql";
import {
  NotificationEmptyState,
  NotificationFeedError,
  NotificationList,
  NotificationSkeletonList,
} from "@/frontend/views/notifications/feed";
import { darkOutlinedContrastSx } from "@/frontend/views/notifications/utils";
import type { CommonLabels } from "@/shared/locale/types/common";
import type { NotificationsLabels } from "@/shared/locale/types/notifications";

interface NotificationsFeedBodyProps {
  /** `notifications` namespace labels (property access only). */
  readonly labels: NotificationsLabels;
  /** `common` namespace labels (retry + pager affordances). */
  readonly commonLabels: CommonLabels;
  /** Active app locale (drives the locale-aware timestamp stamps). */
  readonly locale: string;
  /** Current page's rows (one offset window of the filtered feed). */
  readonly items: readonly MyNotificationsQuery_myNotifications_items[];
  /** Cold first render (no cached data yet — drives the skeleton branch). */
  readonly initialLoading: boolean;
  /** List query loading flag (disables the pager affordances). */
  readonly loading: boolean;
  /** `extensions.code` extracted through `extractErrorCode` (REQ-068). */
  readonly errorCode: string | null;
  /** Error-branch retry handler (refetches the feed query). */
  readonly onRetry: () => void;
  /** Retry-after-error refetch in flight. */
  readonly retryPending: boolean;
  /** Mark-one handler — receives the notification id (STRING wire form). */
  readonly onMarkRead: (id: string) => void;
  /** Ids whose mark-read mutation is in flight (row-level pending state). */
  readonly markReadPendingIds: readonly string[];
  /** Mark-all sweep in flight (marks the list region busy). */
  readonly busy: boolean;
  /** Zero-based page index. */
  readonly page: number;
  /** Total pages for the pager indicator (at least 1). */
  readonly totalPages: number;
  /** Whether a further page exists (drives the next-button disabled state). */
  readonly hasMore: boolean;
  /** Whether the pager row renders (past page 0 or another page exists). */
  readonly pagerVisible: boolean;
  /** Raw page setter (pager window movement). */
  readonly setPage: Dispatch<SetStateAction<number>>;
}

/**
 * NotificationsFeedBody — the settled feed body: early-return branches
 * (skeleton → error → empty → list + pager) instead of a nested ternary
 * chain (`sonarjs/no-nested-conditional`).
 */
export function NotificationsFeedBody({
  labels,
  commonLabels,
  locale,
  items,
  initialLoading,
  loading,
  errorCode,
  onRetry,
  retryPending,
  onMarkRead,
  markReadPendingIds,
  busy,
  page,
  totalPages,
  hasMore,
  pagerVisible,
  setPage,
}: Readonly<NotificationsFeedBodyProps>): ReactNode {
  if (initialLoading) {
    return <NotificationSkeletonList />;
  }
  if (errorCode !== null) {
    return (
      <NotificationFeedError
        labels={labels}
        commonLabels={commonLabels}
        errorCode={errorCode}
        onRetry={onRetry}
        retryPending={retryPending}
      />
    );
  }
  if (items.length === 0) {
    return <NotificationEmptyState labels={labels} />;
  }
  return (
    <Stack spacing={2}>
      <NotificationList
        items={items}
        labels={labels}
        locale={locale}
        onMarkRead={onMarkRead}
        markReadPendingIds={markReadPendingIds}
        busy={busy}
      />
      {pagerVisible ? (
        <NotificationsFeedPager
          page={page}
          totalPages={totalPages}
          hasMore={hasMore}
          loading={loading}
          previousLabel={commonLabels.previousPage}
          nextLabel={commonLabels.nextPage}
          setPage={setPage}
        />
      ) : null}
    </Stack>
  );
}

interface NotificationsFeedPagerProps {
  /** Zero-based page index. */
  readonly page: number;
  /** Total pages for the pager indicator (at least 1). */
  readonly totalPages: number;
  /** Whether a further page exists (drives the next-button disabled state). */
  readonly hasMore: boolean;
  /** List query loading flag (disables the pager affordances). */
  readonly loading: boolean;
  /** `common.previousPage` label. */
  readonly previousLabel: string;
  /** `common.nextPage` label. */
  readonly nextLabel: string;
  /** Raw page setter (pager window movement). */
  readonly setPage: Dispatch<SetStateAction<number>>;
}

/**
 * NotificationsFeedPager — the previous/next window affordance (module-local
 * to the feed body). Buttons are outlined secondaries with the shared
 * keyboard-focus ring and the dark-mode outlined contrast lift.
 */
function NotificationsFeedPager({
  page,
  totalPages,
  hasMore,
  loading,
  previousLabel,
  nextLabel,
  setPage,
}: Readonly<NotificationsFeedPagerProps>): ReactNode {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
      <Button
        variant="outlined"
        size="small"
        disabled={page === 0 || loading}
        onClick={() => setPage(current => Math.max(0, current - 1))}
        // QA round 2 (axe serious): dark-mode outlined text/border lift.
        sx={theme => ({
          ...focusVisibleRingSx,
          ...darkOutlinedContrastSx(theme),
          minHeight: 44,
        })}
      >
        {previousLabel}
      </Button>
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
        {page + 1} / {totalPages}
      </Typography>
      <Button
        variant="outlined"
        size="small"
        disabled={!hasMore || loading}
        onClick={() => setPage(current => current + 1)}
        // QA round 2 (axe serious): dark-mode outlined text/border lift.
        sx={theme => ({
          ...focusVisibleRingSx,
          ...darkOutlinedContrastSx(theme),
          minHeight: 44,
        })}
      >
        {nextLabel}
      </Button>
    </Stack>
  );
}
