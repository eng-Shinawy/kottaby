"use client";

import { Box, Button, List, ListItemButton, Skeleton, Stack, Typography } from "@mui/material";
import Link from "next/link";
import type { ReactNode } from "react";
// audit-R4: shared keyboard-focus ring (v9 ButtonBase ships none).
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import type { MyNotificationsQuery_myNotifications_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { Common, Notifications, useAppLocale, useAppTranslation } from "@/shared/locale";

/**
 * Stable identities for the skeleton rows — decorative placeholders that
 * never reorder; module-level keys keep React keys OFF the bare array index
 * (biome `noArrayIndexKey`), the `NotificationSkeletonList` precedent.
 */
const SKELETON_ROW_KEYS: readonly string[] = ["drawer-skeleton-1", "drawer-skeleton-2", "drawer-skeleton-3"];

/** Initial-loading placeholder rows (mirrors the row skeleton anatomy). */
function NotificationDrawerSkeleton(): ReactNode {
  return (
    <Box component="output" aria-busy="true" data-testid="notification-drawer-skeleton" sx={{ px: 2, py: 2 }}>
      <Stack spacing={2}>
        {SKELETON_ROW_KEYS.map(key => (
          <Stack key={key} direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Skeleton variant="circular" sx={{ width: 8, height: 8, flexShrink: 0 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Skeleton variant="text" sx={{ fontSize: "0.875rem", maxWidth: 220 }} />
              <Skeleton variant="text" sx={{ fontSize: "0.8125rem" }} />
            </Box>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

interface NotificationDrawerErrorProps {
  /** Whether a retry refetch is in flight. */
  readonly retryPending: boolean;
  /** Retry callback (refetches the drawer list query). */
  readonly onRetry: () => void;
}

/** Load-failure notice with a retry affordance. */
function NotificationDrawerError({ retryPending, onRetry }: Readonly<NotificationDrawerErrorProps>): ReactNode {
  const t = useAppTranslation(Notifications);
  const commonT = useAppTranslation(Common);
  return (
    <Stack spacing={1.5} data-testid="notification-drawer-error" sx={{ px: 2, py: 3, alignItems: "flex-start" }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
        {t.loadErrorTitle}
      </Typography>
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
        {t.loadErrorBody}
      </Typography>
      <Button
        variant="outlined"
        size="small"
        disabled={retryPending}
        onClick={onRetry}
        sx={{ ...focusVisibleRingSx, minHeight: 44 }}
      >
        {commonT.retry}
      </Button>
    </Stack>
  );
}

/** Empty-inbox notice (no notifications in the drawer window). */
function NotificationDrawerEmpty(): ReactNode {
  const t = useAppTranslation(Notifications);
  return (
    <Stack spacing={0.5} data-testid="notification-drawer-empty" sx={{ px: 2, py: 3, textAlign: "center" }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
        {t.emptyTitle}
      </Typography>
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
        {t.emptyBody}
      </Typography>
    </Stack>
  );
}

interface NotificationDrawerListProps {
  /** Drawer window rows (latest few notifications). */
  readonly items: readonly MyNotificationsQuery_myNotifications_items[];
  /** Row activation: mark read when unread, then close the drawer. */
  readonly onOpenNotification: (item: MyNotificationsQuery_myNotifications_items) => void;
}

/**
 * The settled rows list. Row anatomy follows the prototype: unread dot +
 * bold title + end-aligned locale-formatted timestamp + 2-line-clamped body.
 * Each row IS a real anchor to `/notifications` (Link), so navigation is
 * native — no router call.
 */
function NotificationDrawerList({ items, onOpenNotification }: Readonly<NotificationDrawerListProps>): ReactNode {
  const t = useAppTranslation(Notifications);
  const locale = useAppLocale();
  return (
    <List disablePadding data-testid="notification-drawer-list" aria-label={t.title}>
      {items.map((item, index) => (
        <ListItemButton
          key={item.id}
          component={Link}
          href="/notifications"
          divider={index < items.length - 1}
          onClick={() => onOpenNotification(item)}
          sx={{ ...focusVisibleRingSx, alignItems: "flex-start", gap: 1.5, px: 2, py: 1.5 }}
        >
          <Box aria-hidden sx={{ width: 8, flexShrink: 0, paddingTop: "7px" }}>
            {item.isRead ? null : (
              <Box
                data-testid="notification-drawer-unread-dot"
                sx={theme => ({ width: 8, height: 8, borderRadius: "50%", bgcolor: theme.palette.primary.main })}
              />
            )}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
              <Typography
                variant="body2"
                // Emitter copy can be either script regardless of UI locale —
                // `dir="auto"` isolates it from the surrounding direction so
                // trailing punctuation never wraps to the wrong edge.
                dir="auto"
                sx={theme => ({
                  fontWeight: item.isRead ? 400 : 700,
                  color: theme.palette.text.primary,
                  minWidth: 0,
                })}
              >
                {item.title}
              </Typography>
              <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary, flexShrink: 0 })}>
                <time dateTime={item.createdAt}>{formatApplicantDate(item.createdAt, locale)}</time>
              </Typography>
            </Stack>
            {item.body === null ? null : (
              <Typography
                variant="body2"
                // Same bidi isolation as the title (see above).
                dir="auto"
                sx={theme => ({
                  color: theme.palette.text.secondary,
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: 2,
                  overflow: "hidden",
                })}
              >
                {item.body}
              </Typography>
            )}
          </Box>
        </ListItemButton>
      ))}
    </List>
  );
}

interface NotificationDrawerBodyProps {
  /** True only while the FIRST fetch is in flight (no cache snapshot yet). */
  readonly initialLoading: boolean;
  /** Whether the list query settled into an error state. */
  readonly loadFailed: boolean;
  /** Whether a retry refetch is in flight. */
  readonly retryPending: boolean;
  /** Retry callback for the error branch. */
  readonly onRetry: () => void;
  /** Drawer window rows (latest few notifications). */
  readonly items: readonly MyNotificationsQuery_myNotifications_items[];
  /** Row activation callback (mark read when unread, then close). */
  readonly onOpenNotification: (item: MyNotificationsQuery_myNotifications_items) => void;
}

/**
 * Settled list region — early-return branches (skeleton → error → empty →
 * rows) instead of a nested ternary chain (`sonarjs/no-nested-conditional`).
 */
export function NotificationDrawerBody({
  initialLoading,
  loadFailed,
  retryPending,
  onRetry,
  items,
  onOpenNotification,
}: Readonly<NotificationDrawerBodyProps>): ReactNode {
  if (initialLoading) {
    return <NotificationDrawerSkeleton />;
  }
  if (loadFailed) {
    return <NotificationDrawerError retryPending={retryPending} onRetry={onRetry} />;
  }
  if (items.length === 0) {
    return <NotificationDrawerEmpty />;
  }
  return <NotificationDrawerList items={items} onOpenNotification={onOpenNotification} />;
}
