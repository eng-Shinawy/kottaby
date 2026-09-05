"use client";

import { Alert, Snackbar } from "@mui/material";
import type { ReactNode } from "react";
import type { ContainerNotice } from "@/frontend/views/admin/disputes/useAdminDisputesNotice";

/**
 * AdminDisputesNoticeSnackbar — the container-level snackbar slot fed by
 * {@link useAdminDisputesNotice}: ONE transient notice (success / info /
 * error) auto-hiding at the sessions-parity duration, anchored bottom-center
 * (MUI Snackbar anchoring is direction-agnostic — RTL-safe by construction).
 * Extracted verbatim from `AdminDisputesContainer`; behavior is unchanged.
 */

/** Snackbar autohide — parity with the sessions containers' snackbar slot. */
const SNACKBAR_AUTOHIDE_MS = 6000;

interface AdminDisputesNoticeSnackbarProps {
  readonly notice: ContainerNotice | null;
  readonly onDismiss: () => void;
}

/** The single transient arbitration-outcome snackbar. */
export function AdminDisputesNoticeSnackbar({
  notice,
  onDismiss,
}: Readonly<AdminDisputesNoticeSnackbarProps>): ReactNode {
  return (
    <Snackbar
      open={notice !== null}
      autoHideDuration={SNACKBAR_AUTOHIDE_MS}
      onClose={onDismiss}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
    >
      {notice === null ? undefined : (
        <Alert onClose={onDismiss} severity={notice.severity} variant="filled">
          {notice.message}
        </Alert>
      )}
    </Snackbar>
  );
}
