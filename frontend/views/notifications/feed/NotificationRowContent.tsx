/**
 * NotificationRowContent — the inbox row's text content column: the unread
 * dot (whose visually-hidden text exposes the unread state to assistive
 * tech), the title, the optional body, the type chip + the locale-aware
 * timestamp. Carved out of `NotificationRow` so the deep-link row wrapper
 * and the content column each stay under the TSX function-size tier.
 *
 * Content renders as TEXT nodes through MUI `Typography` ONLY (REQ-028 —
 * emitter copy is untrusted; raw-HTML rendering is prohibited across
 * `frontend/views/notifications/**` and statically scanned).
 */

import { NotificationsOutlined } from "@mui/icons-material";
import { Box, Chip, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { MyNotificationsQuery_myNotifications_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate, formatLedgerStamp } from "@/frontend/lib/i18n/format-date";
import { NOTIFICATION_TYPE_ICONS, NOTIFICATION_TYPE_LABEL_ACCESSORS } from "@/frontend/views/notifications/utils";
import type { NotificationsLabels } from "@/shared/locale/types/notifications";

/**
 * Visually-hidden text styles — the standard clip-into-1px recipe (no
 * dedicated a11y utility is a direct dependency), so the unread dot can
 * expose its state as REAL text content for screen readers instead of an
 * ARIA name on a name-prohibited generic element (the oxlint
 * `prefer-tag-over-role` rule rejects `role="img"` shims here).
 *
 * The length values are px STRING literals (not bare numbers): MUI's sx
 * transforms reinterpret numeric literals as spacing/theme tokens — `width: 1`
 * becomes `100%`, `margin: -1` becomes `-8px` — which would blow the clipped
 * box up to viewport size and leak blank scrollable space below the feed.
 * The px strings match the canonical `@mui/utils/visuallyHidden` recipe.
 */
const VISUALLY_HIDDEN_TEXT_SX = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

/** The row's text content column: unread dot, title, body, type chip + locale timestamp. */
export function NotificationRowContent({
  notification,
  labels,
  locale,
}: Readonly<{
  notification: MyNotificationsQuery_myNotifications_items;
  labels: NotificationsLabels;
  locale: string;
}>): ReactNode {
  const unread = !notification.isRead;
  // Schema-drift guard: a newer server enum member can reach an older client
  // (the generated enum misses the runtime value) — fall back to a neutral
  // icon instead of rendering an undefined component type.
  const TypeIcon = NOTIFICATION_TYPE_ICONS[notification.type] ?? NotificationsOutlined;
  const typeLabelAccessor = NOTIFICATION_TYPE_LABEL_ACCESSORS[notification.type] ?? (() => notification.title);

  return (
    <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        {unread ? (
          <Box
            sx={theme => ({
              flexShrink: 0,
              width: 8,
              height: 8,
              borderRadius: "50%",
              bgcolor: theme.palette.primary.main,
            })}
          >
            <Box component="span" sx={VISUALLY_HIDDEN_TEXT_SX}>
              {labels.filterUnread}
            </Box>
          </Box>
        ) : null}
        <Typography
          variant="subtitle1"
          component="h2"
          noWrap
          dir="auto"
          sx={theme => ({
            fontWeight: unread ? 700 : 500,
            color: theme.palette.text.primary,
            minWidth: 0,
          })}
        >
          {notification.title}
        </Typography>
      </Stack>
      {notification.body !== null ? (
        <Typography variant="body2" dir="auto" sx={theme => ({ color: theme.palette.text.secondary, lineHeight: 1.5 })}>
          {notification.body}
        </Typography>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", marginTop: 0.5 }}>
        <Chip
          icon={<TypeIcon fontSize="small" />}
          label={typeLabelAccessor(labels)}
          size="small"
          variant="outlined"
          sx={theme => ({ minHeight: 28, color: theme.palette.text.secondary })}
        />
        <Typography
          variant="caption"
          dir="ltr"
          title={formatApplicantDate(notification.createdAt, locale)}
          sx={theme => ({
            color: theme.palette.text.secondary,
            // ASCII stamp in an isolated LTR box — the ICU `ar` stamp embeds
            // RLM controls that visually reorder the stamp against the row's
            // RTL base direction (round-4 feed QA finding, same class as the
            // round-1 wallet stamps). The locale-aware full stamp rides the
            // native `title` tooltip.
            unicodeBidi: "isolate",
            fontVariantNumeric: "tabular-nums",
          })}
        >
          <time dateTime={notification.createdAt}>{formatLedgerStamp(notification.createdAt)}</time>
        </Typography>
      </Stack>
    </Stack>
  );
}

/**` and statically scanned).
 *
 * Unread posture (plan §5.5 visual matrix): the row tints through the
 * `theme.palette.action.selected` token (read rows keep the default
 * transparent element background — no explicit fallback branch), a dot chip
 * whose visually-hidden text content (`filterUnread`) flags the unread
 * state to assistive tech, the title carries the bold weight, and the
 * mark-read action is offered; read rows render un-tinted with no dot and
 * no action.
 */
