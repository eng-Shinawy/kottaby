"use client";

import { useQuery } from "@apollo/client/react";
import { Box, Button, Divider, Popover, Stack, Typography } from "@mui/material";
import Link from "next/link";
import { type ReactNode, useMemo } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { NotificationDrawerBody } from "@/frontend/components/ui/NotificationDrawerBody";
import { useNotificationDrawerActions } from "@/frontend/components/ui/useNotificationDrawerActions";
import type { MyNotificationsFilterInput } from "@/frontend/graphql/generated/gql/graphql";
import {
  myNotificationsQueryDocument,
  myUnreadNotificationCountQueryDocument,
} from "@/frontend/graphql/sharedDocuments";
import { Notifications, useAppTranslation } from "@/shared/locale";

/**
 * Drawer window size — the latest few notifications (prototype contract: a
 * glanceable preview, the `/notifications` page owns the full inbox).
 */
const DRAWER_PAGE_SIZE = 5;

interface NotificationDrawerProps {
  /** Bell button element the popover anchors to (null while closed). */
  readonly anchorEl: HTMLElement | null;
  /** Whether the drawer is open. */
  readonly open: boolean;
  /** Close callback (Escape, click-away, row navigation, footer link). */
  readonly onClose: () => void;
}

/**
 * NotificationDrawer — the floating bell popover (drawer-plan DR-1..DR-8):
 * the latest notifications preview anchored beneath the app-bar bell, with a
 * pinned header (title + mark-all) and a pinned footer linking to the full
 * `/notifications` page (which also stays reachable from the sidebar).
 *
 * Row anatomy follows the prototype: unread dot + bold title + end-aligned
 * locale-formatted timestamp + 2-line-clamped body. Row click marks the row
 * read (when unread) and navigates to the full page. No per-row actions, no
 * avatars, no type chips — the feed page owns that richer anatomy.
 *
 * Data posture: the Apollo cache is the single truth (plan D11). The list
 * query is skipped while closed, serves the cache instantly on open, and
 * refreshes over the network (`cache-and-network`). The shell socket
 * (DashboardLayout) merges realtime arrivals into the SAME cache windows —
 * this component NEVER opens a WebSocket (REQ-067).
 *
 * Mutation posture: mark-one / mark-all run through the shared
 * `useNotificationMarkActions` hook (drawer-plan §3.1) so the count
 * decrement and the stale-window sweep behave IDENTICALLY to the feed page.
 *
 * Accessibility: the bell button owns `aria-haspopup` / `aria-expanded` /
 * `aria-controls` pointing here; Escape and click-away close through
 * Popover's defaults. The unread dot is `aria-hidden` — the bold title
 * carries the read-state distinction visually and the full per-row
 * read-state announcement stays on the feed page's rows.
 *
 * MUI v9 discipline: `sx`-only styling, palette via theme callbacks, content
 * as TEXT nodes through `Typography` only (the REQ-028 contract — honored
 * here even though the static scan roots at `frontend/views/notifications/**`).
 * RTL: the app sets document `dir` without `theme.direction`, so the popover
 * anchors PHYSICAL edges — the bell's right edge in both directions (the
 * toolbar's control cluster never moves across the start/end axis), with MUI
 * clamping the panel flush to the viewport margin under RTL.
 */
export function NotificationDrawer({ anchorEl, open, onClose }: Readonly<NotificationDrawerProps>): ReactNode {
  const t = useAppTranslation(Notifications);

  // Memoized so `useQuery` sees a stable variables identity across re-renders.
  const filter = useMemo<MyNotificationsFilterInput>(
    () => ({ isRead: null, type: null, limit: DRAWER_PAGE_SIZE, offset: 0 }),
    []
  );

  // Horizontal anchor side, re-read when the drawer opens: the app sets
  // document `dir` WITHOUT `theme.direction`, so the mirror is derived from
  // the live document. In RTL the bell cluster sits on the toolbar's END
  // (physical left) edge — anchoring the panel's LEFT edges keeps its near
  // edge flush with the bell; anchoring right-to-right there overflowed the
  // viewport and the clamp left the panel overshooting the bell by 58px at
  // desktop widths (visual QA). Narrow viewports clamp flush either way.
  const anchorToEnd = useMemo(() => {
    if (!open || typeof document === "undefined") {
      return true;
    }
    return document.documentElement.getAttribute("dir") !== "rtl";
  }, [open]);
  const horizontal: "left" | "right" = anchorToEnd ? "right" : "left";

  const listQuery = useQuery(myNotificationsQueryDocument, {
    variables: { filter },
    skip: !open,
    fetchPolicy: "cache-and-network",
  });
  // The badge's observer keeps this field warm; the drawer only reads it for
  // the mark-all affordance state (cache-first, no extra poll).
  const countQuery = useQuery(myUnreadNotificationCountQueryDocument, { skip: !open });

  const { markAllPending, markReadPendingIds, retryPending, handleOpenNotification, handleMarkAll, handleRetry } =
    useNotificationDrawerActions({ filter, refetch: () => listQuery.refetch(), onClose });

  const items = listQuery.data?.myNotifications.items ?? [];
  const unreadCount = countQuery.data?.myUnreadNotificationCount;
  const initialLoading = listQuery.loading && listQuery.data === undefined;
  const loadFailed = !initialLoading && listQuery.error !== undefined;

  return (
    <Popover
      id="notification-drawer"
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      // Anchor at the bell's cluster-side edge: the panel grows inward from
      // the bell — END-side (physical right) in LTR, START-side (physical
      // left) in RTL per `anchorToEnd`. MUI clamps the panel flush to the
      // viewport margin on narrow screens, directly beneath the bell/avatar
      // cluster. (The previous fixed right-to-right anchor in RTL let the
      // clamped 400px panel overshoot the bell's outer edge by 58px at
      // desktop widths.)
      anchorOrigin={{ vertical: "bottom", horizontal }}
      transformOrigin={{ vertical: "top", horizontal }}
      slotProps={{
        paper: {
          sx: theme => ({
            width: "min(400px, calc(100vw - 16px))",
            // Clear the taller `sm`+ toolbar (64px + border): the bell sits
            // 10px above it there, vs 8px below the 56px mobile bar.
            mt: { xs: 1, sm: 1.375 },
            borderRadius: 2,
            bgcolor: theme.palette.background.paper,
            display: "flex",
            flexDirection: "column",
          }),
        },
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between", px: 2, py: 0.5 }}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
          {t.title}
        </Typography>
        <Button
          size="small"
          variant="text"
          disabled={markAllPending || unreadCount === 0 || markReadPendingIds.length > 0}
          onClick={handleMarkAll}
          // 44px tap floor (visual QA flagged the small-size default at 36px).
          sx={{ ...focusVisibleRingSx, minHeight: 44 }}
        >
          {t.markAllRead}
        </Button>
      </Stack>
      <Divider />
      <Box sx={{ maxHeight: 360, overflowY: "auto" }}>
        <NotificationDrawerBody
          initialLoading={initialLoading}
          loadFailed={loadFailed}
          retryPending={retryPending}
          onRetry={handleRetry}
          items={items}
          onOpenNotification={handleOpenNotification}
        />
      </Box>
      <Divider />
      <Box sx={{ px: 1, py: 0.5 }}>
        <Button
          component={Link}
          href="/notifications"
          onClick={onClose}
          fullWidth
          variant="text"
          sx={{ ...focusVisibleRingSx, justifyContent: "center", minHeight: 44 }}
        >
          {t.viewAllNotifications}
        </Button>
      </Box>
    </Popover>
  );
}
