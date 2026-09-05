"use client";

import type { SvgIconComponent } from "@mui/icons-material";
import { Box } from "@mui/material";
import type { ReactNode } from "react";

interface NotificationRowTypeAvatarProps {
  /** Leading type icon (already schema-drift guarded by the caller). */
  readonly icon: SvgIconComponent;
}

/**
 * NotificationRowTypeAvatar — the row's leading circular type icon: a
 * `primaryContainer` tint disc carrying the (already drift-guarded) type
 * icon. Purely decorative (`aria-hidden`); the type is also announced as
 * text by the content stack's chip.
 */
export function NotificationRowTypeAvatar({ icon: TypeIcon }: Readonly<NotificationRowTypeAvatarProps>): ReactNode {
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
        bgcolor: theme.palette.primaryContainer,
        color: theme.palette.onPrimaryContainer,
      })}
    >
      <TypeIcon fontSize="small" />
    </Box>
  );
}
