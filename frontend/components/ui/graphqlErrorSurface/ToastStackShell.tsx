"use client";

import { Box } from "@mui/material";
import type { ReactNode } from "react";

interface ToastStackShellProps {
  readonly children: ReactNode;
}

/**
 * Bottom-center anchor for the GraphQLErrorSurfaceHost toast stack.
 *
 * audit-R4: toasts previously anchored independently (identical
 * `position:fixed; bottom:N; center`) so N concurrent toasts rendered as
 * ONE readable surface hiding the others behind it — including at 375px.
 * A flex column wrapper owns the anchor; each Snackbar stays in normal
 * flow inside it, so every active toast is visibly separated.
 */
export function ToastStackShell({ children }: ToastStackShellProps) {
  return (
    <Box
      sx={{
        position: "fixed",
        insetInlineStart: 0,
        insetInlineEnd: 0,
        bottom: { xs: 16, sm: 24 },
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1,
        px: 2,
        // Screen readers get the per-toast role="alert" announcement;
        // the layout shell itself must not swallow clicks meant for
        // the page underneath.
        pointerEvents: "none",
      }}
    >
      {children}
    </Box>
  );
}
