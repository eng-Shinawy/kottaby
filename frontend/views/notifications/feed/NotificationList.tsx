"use client";

import { NotificationsOutlined } from "@mui/icons-material";
import { Box, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { MyNotificationsQuery_myNotifications_items } from "@/frontend/graphql/generated/gql/graphql";
import { NotificationRow } from "@/frontend/views/notifications/feed";
import type { NotificationsLabels } from "@/shared/locale/types/notifications";

interface NotificationListProps {
  /** Current page's rows (one offset window of the filtered feed). */
  readonly items: readonly MyNotificationsQuery_myNotifications_items[];
  /** `notifications` namespace labels (property access only). */
  readonly labels: NotificationsLabels;
  /** Active app locale (drives the locale-aware timestamp stamps). */
  readonly locale: string;
  /** Mark-one handler — receives the notification id (STRING wire form). */
  readonly onMarkRead: (id: string) => void;
  /** Ids whose mark-read mutation is in flight (row-level pending state). */
  readonly markReadPendingIds?: readonly string[];
  /** Marks the list region busy for assistive tech (sweeps / refetches). */
  readonly busy?: boolean;
}

/**
 * Stable identity for the "no rows pending" default — a module-level
 * constant keeps the default prop referentially stable across renders
 * (oxlint `no-object-type-as-default-prop`).
 */
const NO_PENDING_IDS: readonly string[] = [];

/**
 * NotificationList — the feed's list region (REQ-063b): a semantic `ul` whose
 * rows are `NotificationRow` entries. The region carries `aria-label` (the
 * feed title) and `aria-busy` while a sweep/refetch runs so assistive tech
 * can follow the transition.
 */
export function NotificationList({
  items,
  labels,
  locale,
  onMarkRead,
  markReadPendingIds = NO_PENDING_IDS,
  busy = false,
}: Readonly<NotificationListProps>): ReactNode {
  return (
    <Box
      component="ul"
      data-testid="notifications-list"
      aria-label={labels.title}
      aria-busy={busy}
      sx={{
        margin: 0,
        padding: 0,
        listStyle: "none",
        display: "flex",
        flexDirection: "column",
        gap: 1,
        borderRadius: 2,
      }}
    >
      {items.map(notification => (
        <NotificationRow
          key={notification.id}
          notification={notification}
          labels={labels}
          locale={locale}
          onMarkRead={onMarkRead}
          markReadPending={markReadPendingIds.includes(notification.id)}
        />
      ))}
    </Box>
  );
}

interface NotificationSkeletonListProps {
  /** Skeleton row count (defaults to one page worth of visual rows). */
  readonly rows?: number;
}

/**
 * Stable identities for the skeleton rows — decorative placeholders that
 * never reorder; the module-level key list keeps React keys OFF the bare
 * array index (biome `noArrayIndexKey`) while remaining deterministic
 * across re-renders.
 */
const SKELETON_ROW_KEYS: readonly string[] = [
  "skeleton-row-1",
  "skeleton-row-2",
  "skeleton-row-3",
  "skeleton-row-4",
  "skeleton-row-5",
];

/**
 * NotificationSkeletonList — the loading branch: skeleton rows matching the
 * final row geometry (leading icon circle + two text lines + chip + action
 * placeholder). The region announces itself politely through
 * `Box component="output"` + `aria-busy` (the MUI v9 aria-live pattern from
 * `frontend/AGENTS.md`).
 */
export function NotificationSkeletonList({
  rows = SKELETON_ROW_KEYS.length,
}: Readonly<NotificationSkeletonListProps>): ReactNode {
  const visibleKeys = SKELETON_ROW_KEYS.slice(0, Math.min(rows, SKELETON_ROW_KEYS.length));
  return (
    <Box
      component="output"
      data-testid="notifications-skeleton"
      aria-busy="true"
      sx={{
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      {visibleKeys.map(key => (
        // Skeleton rows are decorative placeholders with fixed identities.
        <Stack key={key} direction="row" spacing={2} sx={{ alignItems: "flex-start", p: { xs: 1.5, sm: 2 } }}>
          <Skeleton variant="circular" sx={{ width: 40, height: 40, flexShrink: 0 }} />
          <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
            <Skeleton variant="text" sx={{ fontSize: "1rem", maxWidth: 320 }} />
            <Skeleton variant="text" sx={{ fontSize: "0.875rem", maxWidth: 480 }} />
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <Skeleton variant="rounded" sx={{ height: 28, width: 140, borderRadius: 999 }} />
              <Skeleton variant="text" sx={{ fontSize: "0.75rem", width: 120 }} />
            </Stack>
          </Stack>
          <Skeleton
            variant="rounded"
            sx={{ height: 32, width: 120, borderRadius: 2, flexShrink: 0, display: { xs: "none", sm: "block" } }}
          />
        </Stack>
      ))}
    </Box>
  );
}

interface NotificationEmptyStateProps {
  /** `notifications` namespace labels (property access only). */
  readonly labels: NotificationsLabels;
}

/**
 * NotificationEmptyState — the empty branch: a centered, generously-spaced
 * composition (bell icon in a tinted circle + translated empty title/body).
 * Filters stay interactive above so a narrowed view can always be widened
 * again; no action buttons render here.
 */
export function NotificationEmptyState({ labels }: Readonly<NotificationEmptyStateProps>): ReactNode {
  return (
    <Stack
      spacing={2}
      data-testid="notifications-empty"
      sx={{
        alignItems: "center",
        justifyContent: "center",
        py: { xs: 6, sm: 10 },
        px: 2,
        textAlign: "center",
      }}
    >
      <Box
        aria-hidden
        sx={theme => ({
          width: 72,
          height: 72,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          bgcolor: theme.palette.secondaryContainer,
          color: theme.palette.onSecondaryContainer,
        })}
      >
        <NotificationsOutlined sx={{ fontSize: 36 }} />
      </Box>
      <Typography variant="h6" component="p" sx={{ fontWeight: 700 }}>
        {labels.emptyTitle}
      </Typography>
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, maxWidth: 420 })}>
        {labels.emptyBody}
      </Typography>
    </Stack>
  );
}
