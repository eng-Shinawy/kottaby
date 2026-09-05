"use client";

import { WarningOutlined as WarningIcon } from "@mui/icons-material";
import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

/**
 * Shared warning callout band for the confirm-and-reason session dialogs
 * (`CancelSessionConfirmDialog` / `SessionDisputeConfirmDialog` — structural
 * twins): a tinted `warningContainer` strip with the `*Outlined` warning
 * icon and the dialog's explanatory body copy. The copy is resolved by the
 * caller through compile-time i18n handles; the band stays copy-agnostic.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors, RTL-safe
 * logical composition.
 */
export function SessionDialogWarningCallout({ message }: Readonly<{ readonly message: string }>): ReactNode {
  return (
    <Stack
      sx={theme => ({
        gap: 1,
        flexDirection: "row",
        alignItems: "flex-start",
        p: 2,
        borderRadius: 2,
        bgcolor: theme.palette.warningContainer,
        color: theme.palette.onWarningContainer,
      })}
    >
      <WarningIcon fontSize="small" />
      <Typography variant="body2">{message}</Typography>
    </Stack>
  );
}
