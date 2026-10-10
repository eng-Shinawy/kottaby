"use client";

import { NotificationsOutlined } from "@mui/icons-material";
import { Box } from "@mui/material";
import Link from "next/link";
import { memo, type ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import type { MyNotificationsQuery_myNotifications_items } from "@/frontend/graphql/generated/gql/graphql";
import { NotificationRowContent } from "@/frontend/views/notifications/feed/NotificationRowContent";
import { NotificationRowMarkReadAction, NotificationRowTypeAvatar } from "@/frontend/views/notifications/ui";
import { NOTIFICATION_TYPE_ICONS, NOTIFICATION_TYPE_TONES } from "@/frontend/views/notifications/utils";
import type { NotificationsLabels } from "@/shared/locale/types/notifications";

interface NotificationRowProps {
  /** One normalized `Notification` row (all eight public fields). */
  readonly notification: MyNotificationsQuery_myNotifications_items;
  /** `notifications` namespace labels (property access only). */
  readonly labels: NotificationsLabels;
  /** Active app locale (drives the locale-aware timestamp stamp). */
  readonly locale: string;
  /**
   * The row's deep-link target (`resolveNotificationRoute` through the
   * viewer's role), or `null` when the row carries no routing contract —
   * `null` renders the content un-linked (plain stack, no anchor).
   */
  readonly deepLinkHref: string | null;
  /** Mark-one handler — receives the notification id (STRING wire form). */
  readonly onMarkRead: (id: string) => void;
  /** Whether THIS row's mark-read mutation is in flight. */
  readonly markReadPending?: boolean;
}

/**
 * NotificationRow — one inbox row: leading type icon → content (title /
 * body / type chip + timestamp) → mark-read action. The DOM order
 * icon→content→action mirrors visually under RTL (plain flex rows reverse
 * with `dir="rtl"` — no physical margins anywhere).
 *
 * Content renders as TEXT nodes through MUI `Typography` ONLY — emitter
 * copy is untrusted, so raw-HTML rendering is prohibited; the
 * no-HTML-sink rule is machine-enforced repo-wide by
 * `test/config/xss-static-locks.test.ts`.
 *
 * Performance: the row is memo-wrapped — an unchanged row skips re-render
 * when a sibling updates or the container's state moves.
 */
export const NotificationRow = memo(function NotificationRow({
  notification,
  labels,
  locale,
  deepLinkHref,
  onMarkRead,
  markReadPending = false,
}: Readonly<NotificationRowProps>): ReactNode {
  // Schema-drift guard: a newer server enum member can reach an older
  // client (the generated enum misses the runtime value) — fall back to a
  // neutral icon + brand-neutral disc instead of rendering an undefined
  // component type.
  const TypeIcon = NOTIFICATION_TYPE_ICONS[notification.type] ?? NotificationsOutlined;
  const typeTone = NOTIFICATION_TYPE_TONES[notification.type] ?? "primary";
  const unread = !notification.isRead;
  const markReadLabel = labels.markReadAriaLabel(notification.title);

  const handleMarkRead = (): void => {
    onMarkRead(notification.id);
  };

  // Row activation mirrors the drawer's contract: navigating from an unread
  // row marks it read (fire-and-forget — the cache restyles the row even as
  // the route change takes over). Native navigation — no router call.
  const handleActivate = (): void => {
    if (unread) {
      onMarkRead(notification.id);
    }
  };

  const content = <NotificationRowContent notification={notification} labels={labels} locale={locale} />;
  return (
    <Box
      component="li"
      sx={theme => ({
        display: "flex",
        flexDirection: "row",
        alignItems: "flex-start",
        gap: { xs: 1.5, sm: 2 },
        p: { xs: 1.5, sm: 2 },
        borderRadius: 2,
        bgcolor: unread ? theme.palette.action.selected : undefined,
        // Read rows stay un-tinted; a hairline keeps them card-shaped in dark
        // mode where an un-tinted row otherwise floats on the page background.
        border: unread ? undefined : `1px solid ${theme.palette.divider}`,
      })}
    >
      <NotificationRowTypeAvatar icon={TypeIcon} tone={typeTone} />
      {deepLinkHref !== null ? (
        <Box
          component={Link}
          href={deepLinkHref}
          onClick={handleActivate}
          sx={theme => ({
            display: "block",
            flex: 1,
            minWidth: 0,
            textDecoration: "none",
            color: "inherit",
            borderRadius: 1.5,
            ...focusVisibleRingSx,
            transition: theme.transitions.create("background-color", { duration: theme.transitions.duration.short }),
            "&:hover": { bgcolor: theme.palette.action.hover },
          })}
        >
          {content}
        </Box>
      ) : (
        content
      )}
      {unread ? (
        <NotificationRowMarkReadAction
          markReadLabel={markReadLabel}
          buttonLabel={labels.markRead}
          markReadPending={markReadPending}
          onMarkRead={handleMarkRead}
        />
      ) : null}
    </Box>
  );
});
