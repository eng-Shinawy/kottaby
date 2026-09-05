"use client";

import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { NotificationsFeedBody } from "@/frontend/views/notifications/feed";
import { useNotificationsFeedState } from "@/frontend/views/notifications/hooks";
import {
  MarkAllButton,
  NotificationFilterChips,
  NotificationsMarkAllSnackbar,
} from "@/frontend/views/notifications/ui";
import { Common, Notifications, useAppLocale, useAppTranslation } from "@/shared/locale";

/**
 * NotificationsFeedContainer — the `/notifications` inbox surface
 * (REQ-063b): filter chips (read-state toggle + one chip per
 * `NotificationType`), the paginated row list with per-row mark-read, the
 * mark-all sweep with a translated affected-count snackbar, and the
 * loading/empty/error branches. Components and state are composed from the
 * extracted siblings (`NotificationsFeedBody`, `NotificationsMarkAllSnackbar`,
 * `useNotificationsFeedState`).
 *
 * Feed truth is the Apollo cache (plan D11): the shell-mounted
 * `useNotificationRealtime` socket (DashboardLayout) merges arrivals into
 * the same `myNotifications` variants this container queries — this file
 * NEVER mounts its own socket (REQ-067). Filter and pagination state live in
 * the extracted feed-state hook (local React state; no Zustand store).
 *
 * Polling posture: only the unread count polls (120s); the list converges
 * through pagination, sweeps, and the realtime merge.
 *
 * MUI v9 discipline: `sx`-only styling, `theme.palette.*` via theme
 * callbacks, `*Outlined` icons, logical RTL properties, content as TEXT
 * nodes through `Typography` only (REQ-028).
 */
export function NotificationsFeedContainer(): ReactNode {
  const t = useAppTranslation(Notifications);
  const commonT = useAppTranslation(Common);
  const locale = useAppLocale();
  const feed = useNotificationsFeedState();

  return (
    <Stack spacing={{ xs: 2, sm: 3 }} sx={{ width: "100%" }}>
      <Stack
        spacing={2}
        sx={{
          flexDirection: { xs: "column", sm: "row" },
          alignItems: { xs: "stretch", sm: "center" },
          justifyContent: "space-between",
        }}
      >
        <Stack spacing={0.5}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
            {t.title}
          </Typography>
          {typeof feed.unreadCount === "number" ? (
            <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
              {t.unreadCount(feed.unreadCount)}
            </Typography>
          ) : null}
        </Stack>
        <MarkAllButton
          labels={t}
          commonLabels={commonT}
          disabled={feed.markAllDisabled}
          pending={feed.markAllPending}
          onConfirm={feed.handleMarkAll}
        />
      </Stack>

      <NotificationFilterChips
        labels={t}
        commonLabels={commonT}
        readFilter={feed.readFilter}
        onReadFilterChange={feed.handleReadFilterChange}
        typeFilter={feed.typeFilter}
        onTypeFilterChange={feed.handleTypeFilterChange}
        disabled={feed.loading && feed.items.length === 0}
      />

      <NotificationsFeedBody
        labels={t}
        commonLabels={commonT}
        locale={locale}
        items={feed.items}
        initialLoading={feed.initialLoading}
        loading={feed.loading}
        errorCode={feed.errorCode}
        onRetry={feed.handleRetry}
        retryPending={feed.retryPending}
        onMarkRead={feed.handleMarkRead}
        markReadPendingIds={feed.markReadPendingIds}
        busy={feed.markAllPending}
        page={feed.page}
        totalPages={feed.totalPages}
        hasMore={feed.hasMore}
        pagerVisible={feed.pagerVisible}
        setPage={feed.setPage}
      />

      {feed.markAllAffectedCount !== null ? (
        <NotificationsMarkAllSnackbar
          affectedCount={feed.markAllAffectedCount}
          labels={t}
          closeLabel={commonT.close}
          onClose={() => feed.setMarkAllAffectedCount(null)}
        />
      ) : null}
    </Stack>
  );
}
