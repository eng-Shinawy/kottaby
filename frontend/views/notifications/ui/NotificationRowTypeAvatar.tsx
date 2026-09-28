"use client";

import type { SvgIconComponent } from "@mui/icons-material";
import { Box } from "@mui/material";
import type { ReactNode } from "react";
import { toneContainerColor, toneOnContainerColor } from "@/frontend/views/notifications/ui/notification-tone-colors";
import type { NotificationTypeTone } from "@/frontend/views/notifications/utils";

interface NotificationRowTypeAvatarProps {
  /** Leading type icon (already schema-drift guarded by the caller). */
  readonly icon: SvgIconComponent;
  /**
   * The row type's semantic tone (the fixed-polarity category color from
   * `NOTIFICATION_TYPE_TONES`). `"primary"` keeps the historical brand-tint
   * disc; every other tone tints the disc + glyph through its container
   * pair so the feed's leading column scans by category at a glance.
   */
  readonly tone?: NotificationTypeTone;
}

/**
 * NotificationRowTypeAvatar — the row's leading circular type icon: a
 * tone-tinted disc carrying the (already drift-guarded) type icon. Purely
 * decorative (`aria-hidden`); the type is also announced as text by the
 * content stack's chip. The container-pair resolvers live in
 * `notification-tone-colors.ts` — the row's type chip shares them so the
 * disc and the chip echo the same category pair.
 */
export function NotificationRowTypeAvatar({
  icon: TypeIcon,
  tone = "primary",
}: Readonly<NotificationRowTypeAvatarProps>): ReactNode {
  return (
    <Box
      aria-hidden
      sx={theme => ({
        flexShrink: 0,
        width: 40,
        height: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        bgcolor: toneContainerColor(theme, tone),
        color: toneOnContainerColor(theme, tone),
      })}
    >
      <TypeIcon fontSize="small" />
    </Box>
  );
}
