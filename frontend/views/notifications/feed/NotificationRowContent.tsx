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
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { MyNotificationsQuery_myNotifications_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate, formatLedgerStamp } from "@/frontend/lib/i18n/format-date";
import { formatRelativeAuditStamp } from "@/frontend/lib/i18n/relative-time";
import { toneContainerColor, toneOnContainerColor } from "@/frontend/views/notifications/ui/notification-tone-colors";
import {
  NOTIFICATION_TYPE_ICONS,
  NOTIFICATION_TYPE_LABEL_ACCESSORS,
  NOTIFICATION_TYPE_TONES,
  type NotificationTypeTone,
} from "@/frontend/views/notifications/utils";
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

/**
 * The unread dot's attention pulse — a soft halo radiating from the dot and
 * fading to transparent, slow enough (2.4s cycle) to read as ambient
 * "here" rather than an alarm. Disabled outright under
 * `prefers-reduced-motion: reduce` — the static dot carries the state.
 * The keyframe name is module-scoped (rendered once per stylesheet by MUI's
 * sx engine); the halo alpha is baked from the runtime theme's primary.
 */
const UNREAD_PULSE_SX = (primaryMain: string) =>
  ({
    "@keyframes unread-halo-pulse": {
      "0%": { boxShadow: `0 0 0 0 ${alpha(primaryMain, 0.45)}` },
      "70%": { boxShadow: `0 0 0 7px ${alpha(primaryMain, 0)}` },
      "100%": { boxShadow: `0 0 0 0 ${alpha(primaryMain, 0)}` },
    },
    animation: "unread-halo-pulse 2.4s ease-out infinite",
    "@media (prefers-reduced-motion: reduce)": {
      animation: "none",
    },
  }) as const;

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
  // icon, the fallback label accessor, and the brand-neutral tone instead of
  // rendering an undefined component type / keying an unknown kind.
  const TypeIcon = NOTIFICATION_TYPE_ICONS[notification.type] ?? NotificationsOutlined;
  const typeLabelAccessor = NOTIFICATION_TYPE_LABEL_ACCESSORS[notification.type] ?? (() => notification.title);
  const typeTone: NotificationTypeTone = NOTIFICATION_TYPE_TONES[notification.type] ?? "primary";

  // Scanning-friendly caption: the relative time inside the shared 7-day
  // window ("3 hours ago" / "قبل 3 ساعات" — Intl-native, zero localized
  // copy), the byte-stable ASCII ledger stamp beyond it. The locale-aware
  // full absolute stamp rides the native `title` tooltip either way.
  // Direction: the relative caption is directional text (dir="auto" lets
  // each caption pick its own flow inside the isolate); the ASCII stamp
  // keeps the forced-LTR box the round-4 bidi QA established.
  const relativeStamp = formatRelativeAuditStamp(notification.createdAt, locale);
  const stampDirection = relativeStamp !== null ? "auto" : "ltr";

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
              ...UNREAD_PULSE_SX(theme.palette.primary.main),
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
            // Span the row's content width so a cross-script row (RTL copy
            // inside the LTR shell, or the mirror) aligns its title to the
            // SAME inline edge the dir="auto" body already picks — a
            // shrink-wrapped title box would pin the title to the row's
            // opposite edge and split the two lines apart.
            flex: 1,
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
          sx={theme => ({
            minHeight: 28,
            // Category echo: a SOFT fill of the row's tone-container pair —
            // the same pair the leading disc carries — with a hairline
            // on-container border, so chip and disc read as one category
            // system while the label stays in the readable secondary text
            // color (never the on-container ink, which is tuned for the
            // container, not the page).
            bgcolor: alpha(toneContainerColor(theme, typeTone), 0.55),
            border: `1px solid ${alpha(toneOnContainerColor(theme, typeTone), 0.16)}`,
            color: theme.palette.text.secondary,
            "& .MuiChip-icon": { color: toneOnContainerColor(theme, typeTone) },
          })}
        />
        <Typography
          variant="caption"
          dir={stampDirection}
          title={formatApplicantDate(notification.createdAt, locale)}
          sx={theme => ({
            color: theme.palette.text.secondary,
            // Isolated stamp box — the ASCII ledger stamp renders byte-stable
            // in both document directions (round-4 feed QA finding), and the
            // relative caption picks its own direction via dir="auto" inside
            // the same isolate. The locale-aware full absolute stamp rides
            // the native `title` tooltip.
            unicodeBidi: "isolate",
            fontVariantNumeric: "tabular-nums",
          })}
        >
          <time dateTime={notification.createdAt}>{relativeStamp ?? formatLedgerStamp(notification.createdAt)}</time>
        </Typography>
      </Stack>
    </Stack>
  );
}

/*
 * Unread posture (plan §5.5 visual matrix): the row tints through the
 * `theme.palette.action.selected` token (read rows keep the default
 * transparent element background — no explicit fallback branch), a dot chip
 * whose visually-hidden text content (`filterUnread`) flags the unread
 * state to assistive tech (ambiently pulsing, reduced-motion aware), the
 * title carries the bold weight, and the mark-read action is offered; read
 * rows render un-tinted with no dot and no action.
 */
