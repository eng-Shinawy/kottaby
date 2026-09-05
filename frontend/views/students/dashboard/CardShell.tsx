"use client";

import { Card, CardContent } from "@mui/material";
import type { ReactNode } from "react";

interface CardShellProps {
  readonly children: ReactNode;
  /** Stable test hook — settled card vs skeleton branch. */
  readonly testId: string;
  /** Marks the shell as busy for assistive tech (skeleton branch). */
  readonly busy?: boolean;
}

/** Outer card shell shared by every settled branch (uniform dashboard slot). */
export function CardShell({ children, testId, busy }: Readonly<CardShellProps>): ReactNode {
  return (
    <Card
      elevation={0}
      aria-busy={busy ? "true" : undefined}
      data-testid={testId}
      sx={theme => ({
        borderRadius: 3,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        boxShadow: theme.palette.shadow.card,
      })}
    >
      <CardContent sx={{ p: { xs: 3, sm: 4 }, display: "grid", gap: 2 }}>{children}</CardContent>
    </Card>
  );
}
