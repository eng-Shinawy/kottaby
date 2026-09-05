"use client";

import { Alert, Snackbar } from "@mui/material";
import type { ReactNode } from "react";
import type { ContainerNotice } from "@/frontend/views/student/sessions/useStudentSessionNotices";

/** Snackbar autohide — parity with the app-scope `GraphQLErrorSurfaceHost` toasts. */
const SNACKBAR_AUTOHIDE_MS = 6000;

interface StudentSessionsNoticeSnackbarProps {
  /** The active transient notice, or `null` while the slot is empty. */
  readonly notice: ContainerNotice | null;
  /** Dismiss intent (autohide, click-away, close icon). */
  readonly onDismiss: () => void;
}

/**
 * The container's single transient notice surface — a plain MUI Snackbar
 * slot (the same machinery as the app-scope `GraphQLErrorSurfaceHost`).
 */
export function StudentSessionsNoticeSnackbar({
  notice,
  onDismiss,
}: Readonly<StudentSessionsNoticeSnackbarProps>): ReactNode {
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
