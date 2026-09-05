"use client";

import { Close as CloseIcon, NotificationsOutlined } from "@mui/icons-material";
import { Alert, Box, IconButton, Snackbar, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { useNotificationRealtime } from "@/frontend/hooks/notifications";
import { Common, useAppTranslation } from "@/shared/locale";

/** Auto-hide cadence — matches the GraphQLErrorSurfaceHost toast posture. */
const TOAST_AUTOHIDE_MS = 6000;

/**
 * NotificationRealtimeToastHost — the realtime-arrival toast surface.
 *
 * Mounted exactly ONCE by the authenticated shell (`DashboardLayout`), so
 * the `useNotificationRealtime` socket it hosts is the tab's only realtime
 * connection (REQ-067). The hook owns the WebSocket lifecycle and the Apollo
 * cache merge; this host renders ONLY the transient localized toast queue —
 * connection state never renders anything (silent degradation, REQ-064).
 *
 * Toast geometry follows the `GraphQLErrorSurfaceHost` snackbar conventions:
 * a fixed bottom-center flex column owns the anchor (each `Snackbar` stays
 * in normal flow, so concurrent toasts never stack on top of each other —
 * including at 375px), logical inset properties mirror under RTL, and every
 * color resolves through MUI severity slots on the theme palette. The stack's
 * bottom anchor is RAISED one toast height above the error host's so a
 * realtime arrival and a concurrent GraphQL error toast both stay visible.
 */
export function NotificationRealtimeToastHost(): ReactNode {
  const { toasts, dismissToast } = useNotificationRealtime();
  const commonT = useAppTranslation(Common);

  if (toasts.length === 0) {
    // Nothing active — render nothing (zero-cost idle host).
    return null;
  }

  return (
    <Box
      sx={theme => ({
        position: "fixed",
        insetInlineStart: 0,
        insetInlineEnd: 0,
        // Raised above the GraphQLErrorSurfaceHost anchor (16/24): both
        // stacks are bottom-center fixed columns at `zIndex.snackbar`, so an
        // un-offset anchor would render a realtime arrival exactly ON TOP of
        // a concurrent error toast, fully occluding it (verified live in the
        // 4.2.BS loop — overlap-probe screenshot). One toast height + gap
        // (≈72px + 8px) keeps both visible; deeper multi-error stacks remain
        // the documented 4.4 carry-forward.
        bottom: { xs: 96, sm: 104 },
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1,
        px: 2,
        zIndex: theme.zIndex.snackbar,
        // Screen readers get the per-toast Alert announcements; the anchor
        // shell itself must not swallow clicks meant for the page underneath.
        pointerEvents: "none",
      })}
    >
      {toasts.map(toast => (
        <Snackbar
          key={toast.id}
          open
          autoHideDuration={TOAST_AUTOHIDE_MS}
          onClose={() => dismissToast(toast.id)}
          sx={{
            // Layout/anchoring belongs to the stack shell above — the
            // per-snackbar MUI default fixed-anchor would re-break
            // multi-toast separation.
            position: "static",
            maxWidth: { xs: "100%", sm: 480 },
            pointerEvents: "auto",
          }}
        >
          <Alert
            variant="filled"
            severity="info"
            icon={<NotificationsOutlined fontSize="small" />}
            action={
              <IconButton
                aria-label={commonT.close}
                size="small"
                onClick={() => dismissToast(toast.id)}
                // audit-R4: shared keyboard-focus ring (v9 ButtonBase ships none).
                sx={{ ...focusVisibleRingSx, color: "inherit" }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            }
            sx={theme => ({
              alignItems: "center",
              borderRadius: 2,
              boxShadow: theme.shadows[6],
              maxWidth: { xs: "calc(100vw - 32px)", sm: 480 },
              border: "1px solid",
              borderColor: `color-mix(in srgb, ${theme.palette.common.white} 16%, transparent)`,
              "@media (prefers-reduced-motion: no-preference)": {
                animation: `nrToastIn ${theme.transitions.duration.enteringScreen}ms ${theme.transitions.easing.easeOut}`,
              },
              "@keyframes nrToastIn": {
                from: { opacity: 0, transform: "translateY(8px)", scale: "0.98" },
                to: { opacity: 1, transform: "translateY(0)", scale: "1" },
              },
            })}
          >
            <Typography sx={{ fontSize: 14, lineHeight: 1.45 }}>{toast.message}</Typography>
          </Alert>
        </Snackbar>
      ))}
    </Box>
  );
}
