"use client";

/**
 * DirectoryMobileDetailRow — the strict two-column body row of the mobile
 * directory cards: label pinned to the inline-start edge in
 * `text.secondary`, value cell flexing to fill and pinning its content to
 * the inline-end edge (500 weight). `dimmed` drops the value cell to the
 * disabled ink (soft-deleted items).
 */

import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";

interface DirectoryMobileDetailRowProps {
  readonly label: string;
  readonly dimmed?: boolean;
  readonly children: ReactNode;
}

export function DirectoryMobileDetailRow({
  label,
  dimmed = false,
  children,
}: DirectoryMobileDetailRowProps): ReactNode {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
      <Typography
        variant="body2"
        sx={theme => ({ color: theme.palette.text.secondary, flexShrink: 0, textAlign: "start" })}
      >
        {label}
      </Typography>
      <Box
        sx={theme => ({
          flex: 1,
          minWidth: 0,
          display: "flex",
          justifyContent: "flex-end",
          textAlign: "end",
          fontWeight: 500,
          ...(dimmed && { color: theme.palette.text.disabled }),
        })}
      >
        {children}
      </Box>
    </Box>
  );
}
