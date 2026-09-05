"use client";

import { Close as CloseIcon, DoneAllOutlined } from "@mui/icons-material";
import { Alert, Box, IconButton, Snackbar, Typography } from "@mui/material";
import type { ReactNode } from "react";
// audit-R4: shared keyboard-focus ring (v9 ButtonBase ships none).
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import type { NotificationsLabels } from "@/shared/locale/types/notifications";

/** Mark-all success snackbar auto-hide cadence (host toast posture). */
const MARK_ALL_SNACKBAR_AUTOHIDE_MS = 6000;

interface NotificationsMarkAllSnackbarProps {
  /** Rows the sweep marked read (drives `markAllResult`). */
  readonly affectedCount: number;
  /** `notifications` namespace labels (property access only). */
  readonly labels: NotificationsLabels;
  /** `common.close` label for the dismiss affordance. */
  readonly closeLabel: string;
  /** Clears the snackbar surface state. */
  readonly onClose: () => void;
}

/**
 * NotificationsMarkAllSnackbar — the mark-all sweep's translated
 * affected-count success snackbar (fixed-position host above the existing
 * error/realtime toast stacks).
 */
export function NotificationsMarkAllSnackbar({
  affectedCount,
  labels,
  closeLabel,
  onClose,
}: Readonly<NotificationsMarkAllSnackbarProps>): ReactNode {
  return (
    <Box
      sx={theme => ({
        position: "fixed",
        insetInlineStart: 0,
        insetInlineEnd: 0,
        // Raised clear of BOTH existing bottom-center snackbar stacks:
        // the error host anchors at 16/24 and the realtime toast stack at
        // 96/104 — one further toast height keeps this single success
        // snackbar from occluding (or being occluded by) either.
        bottom: { xs: 188, sm: 196 },
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        px: 2,
        zIndex: theme.zIndex.snackbar,
        pointerEvents: "none",
      })}
    >
      <Snackbar
        open
        autoHideDuration={MARK_ALL_SNACKBAR_AUTOHIDE_MS}
        onClose={(_, reason) => {
          if (reason !== "clickaway") {
            onClose();
          }
        }}
        sx={{
          position: "static",
          maxWidth: { xs: "100%", sm: 480 },
          pointerEvents: "auto",
        }}
      >
        <Alert
          severity="success"
          variant="filled"
          icon={<DoneAllOutlined fontSize="small" />}
          action={
            <IconButton
              aria-label={closeLabel}
              size="small"
              onClick={onClose}
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
          })}
        >
          <Typography sx={{ fontSize: 14, lineHeight: 1.45 }}>{labels.markAllResult(affectedCount)}</Typography>
        </Alert>
      </Snackbar>
    </Box>
  );
}
