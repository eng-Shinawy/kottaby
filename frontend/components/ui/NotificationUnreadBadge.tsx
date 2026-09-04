"use client";

import { useQuery } from "@apollo/client/react";
import { NotificationsOutlined } from "@mui/icons-material";
import { Badge, IconButton, Tooltip } from "@mui/material";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useState } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { NotificationDrawer } from "@/frontend/components/ui/NotificationDrawer";
import { myUnreadNotificationCountQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { Notifications, useAppTranslation } from "@/shared/locale";

/**
 * Unread-count polling cadence — the conventional notification-count posture
 * (`NOTIFICATION_COUNT_POLL_INTERVAL_MS`, `frontend/AGENTS.md`: 120s). The
 * shell socket merges realtime arrivals into the cached count without
 * refetches; this poll is the silent-degradation floor (REQ-064).
 */
const NOTIFICATION_COUNT_POLL_INTERVAL_MS = 120_000;

/**
 * Visible badge overflow cap — anything above renders as `99+` while the
 * accessible label keeps announcing the true pluralized count.
 */
const BADGE_OVERFLOW_MAX = 99;

/**
 * NotificationUnreadBadge — the app-bar bell + unread badge (REQ-063c).
 *
 * Mounted by `DashboardAppBar` inside the authenticated shell branch, so it
 * renders on EVERY dashboard route for EVERY role (REQ-065). Clicking the
 * bell toggles the floating `NotificationDrawer` popover (drawer-plan DR-1);
 * the full `/notifications` page remains reachable from the drawer's footer
 * link and the sidebar entry.
 *
 * Count source (plan D11 — Apollo cache is the single frontend truth):
 * `useQuery(myUnreadNotificationCountQueryDocument)` observes the SAME
 * `ROOT_QUERY.myUnreadNotificationCount` field the shell-mounted realtime
 * socket (arrival +1 / reconnect catch-up), the feed's mark-one (−1) and
 * mark-all (refetch) co-maintain — cache writes from any of those re-render
 * this badge WITHOUT a refetch. The 120s poll is only the degradation floor;
 * simultaneous observers (badge + feed) coalesce in-flight queries through
 * Apollo's query deduplication.
 *
 * This component NEVER opens a WebSocket (REQ-067): the tab's single socket
 * belongs to `NotificationRealtimeToastHost` in `DashboardLayout`. Loading
 * and error states degrade silently — no badge content, no alarming UI
 * (REQ-064); the errorLink surface owns GraphQL error UX.
 *
 * Accessibility: the button's accessible name (and tooltip) composes the
 * bell action label with the pluralized unread-count announcement —
 * `badgeAriaLabel — unreadCount(n)` (the ApiStatusIndicator tooltip
 * composition precedent) — so screen readers announce both the action and
 * the state. RTL mirrors the badge anchor to the bell's top-END corner via
 * the `[dir=rtl]` sx override below (MUI v9's badge anchor is physical).
 *
 * MUI v9 discipline: `sx`-only styling, `theme.palette.*` via theme
 * callbacks, `*Outlined` icon, MUI severity color slot for the badge.
 */
export function NotificationUnreadBadge(): ReactNode {
  const t = useAppTranslation(Notifications);
  const countQuery = useQuery(myUnreadNotificationCountQueryDocument, {
    pollInterval: NOTIFICATION_COUNT_POLL_INTERVAL_MS,
  });

  // Drawer toggle state — the bell is the popover's anchor (drawer-plan DR-1).
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const drawerOpen = anchorEl !== null;

  const unread = countQuery.data?.myUnreadNotificationCount;
  // Action + pluralized state compose the accessible name (em-dash join —
  // the ApiStatusIndicator tooltip-title precedent). While the count is
  // unresolved (loading/error) the action label alone remains accurate.
  const accessibleLabel =
    typeof unread === "number" ? `${t.badgeAriaLabel} — ${t.unreadCount(unread)}` : t.badgeAriaLabel;

  const handleToggle = (event: ReactMouseEvent<HTMLElement>): void => {
    // Capture the anchor NOW — `currentTarget` is nulled once the event
    // finishes dispatching, BEFORE a lazy state-updater would read it.
    const anchor = event.currentTarget;
    setAnchorEl(current => (current === null ? anchor : null));
  };

  const handleDrawerClose = (): void => {
    setAnchorEl(null);
  };

  return (
    <>
      <Tooltip title={accessibleLabel}>
        <IconButton
          size="large"
          aria-label={accessibleLabel}
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          aria-controls={drawerOpen ? "notification-drawer" : undefined}
          onClick={handleToggle}
          sx={theme => ({
            ...focusVisibleRingSx,
            color: theme.palette.text.primary,
          })}
        >
          <Badge
            badgeContent={unread}
            color="error"
            max={BADGE_OVERFLOW_MAX}
            sx={{
              // Comfortable chip so 1–2 digits fit with breathing room (the
              // audit saw the count crowd its chip at the 20px default).
              "& .MuiBadge-badge": { minWidth: 22, height: 22 },
              // MUI v9's badge anchor is PHYSICAL (`inset` + translate CSS
              // vars set inline on the badge slot) — it does NOT mirror under
              // RTL. Pin the badge to the bell's top-END corner (top-LEFT
              // under `[dir=rtl]` — the app sets document dir per locale and
              // never sets `theme.direction`) and keep it fully INSIDE the
              // button: the previous half-offset translate left a ~10px
              // overhang outside the bell that registered as clipped
              // content. `!important` overrides the inline slot style.
              "[dir=rtl] & .MuiBadge-badge": {
                // inset shorthand is top/right/bottom/left — leaving bottom
                // and `right` at `auto` keeps the badge content-sized.
                "--Badge-inset": "2px auto auto 2px !important",
                "--Badge-origin": "0% 0% !important",
                "--Badge-translate": "0, 0 !important",
              },
            }}
          >
            <NotificationsOutlined />
          </Badge>
        </IconButton>
      </Tooltip>
      <NotificationDrawer anchorEl={anchorEl} open={drawerOpen} onClose={handleDrawerClose} />
    </>
  );
}
