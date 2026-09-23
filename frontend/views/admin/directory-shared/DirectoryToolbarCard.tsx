"use client";

/**
 * DirectoryToolbarCard — the white filter card of the admin directory
 * toolbars: radius 12, `border.light` outline, `shadow.card`, 24px padding,
 * with the contents laid out as a flex row that wraps at ALL breakpoints so
 * narrow content widths stack instead of overflowing the card.
 *
 * Consumers slot their specific filter fields and action handlers as
 * `children`; the card owns only the chrome. All colors resolve through
 * theme-callback sx.
 */

import { Box, Card } from "@mui/material";
import type { ReactNode } from "react";

interface DirectoryToolbarCardProps {
  readonly children: ReactNode;
}

export function DirectoryToolbarCard({ children }: DirectoryToolbarCardProps): ReactNode {
  return (
    <Card
      sx={theme => ({
        borderRadius: "12px",
        border: `1px solid ${theme.palette.border.light}`,
        boxShadow: theme.palette.shadow.card,
        p: 3,
        display: "flex",
      })}
    >
      <Box sx={{ display: "flex", width: "100%", flexWrap: "wrap", gap: 2, alignItems: "center" }}>{children}</Box>
    </Card>
  );
}
