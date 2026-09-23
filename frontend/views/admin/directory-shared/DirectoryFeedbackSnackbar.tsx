"use client";

/**
 * DirectoryFeedbackSnackbar — the shared feedback-snackbar recipe of the
 * admin directory surfaces: a bottom-centered `Snackbar` (4s auto-hide)
 * holding a filled `Alert` on the slot's severity lane (success by
 * default; the export flows also report warning / error). The consumer
 * owns the `DirectorySnackbar | null` slot and the clear handler.
 */

import { Alert, Snackbar } from "@mui/material";
import type { ReactNode } from "react";
import type { DirectorySnackbar } from "@/frontend/views/admin/users/directory/directory-snackbar";

interface DirectoryFeedbackSnackbarProps {
  /** The open feedback slot — `null` keeps the snackbar closed. */
  readonly snackbar: DirectorySnackbar | null;
  /** Clears the slot (Snackbar close + the Alert's own close action). */
  readonly onClose: () => void;
}

export function DirectoryFeedbackSnackbar({ snackbar, onClose }: DirectoryFeedbackSnackbarProps): ReactNode {
  return (
    <Snackbar
      open={snackbar !== null}
      autoHideDuration={4000}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
    >
      <Alert severity={snackbar?.severity ?? "success"} variant="filled" onClose={onClose}>
        {snackbar?.message ?? ""}
      </Alert>
    </Snackbar>
  );
}
