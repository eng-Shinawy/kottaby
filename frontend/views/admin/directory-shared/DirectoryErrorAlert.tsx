"use client";

/**
 * DirectoryErrorAlert — the shared load-failure alert of the admin
 * directory surfaces: an error `Alert` with the localized
 * `errorState.title`/`errorState.message` copy, the code suffix when the
 * failure mapped to a canonical GraphQL/transport code, and the retry
 * button wired to the consumer's refetch.
 */

import { Alert, Button } from "@mui/material";
import type { ReactNode } from "react";

interface DirectoryErrorAlertProps {
  /** The domain's `errorState` label block (title / message / retry). */
  readonly labels: { readonly title: string; readonly message: string; readonly retry: string };
  /** Re-fetches the current page (the promise is handed to Apollo). */
  readonly onRetry: () => void;
  /** The canonical error code rendered as a suffix — omitted when unknown. */
  readonly errorCode: string | null;
}

export function DirectoryErrorAlert({ labels, onRetry, errorCode }: DirectoryErrorAlertProps): ReactNode {
  return (
    <Alert
      severity="error"
      action={
        <Button color="inherit" size="small" onClick={onRetry}>
          {labels.retry}
        </Button>
      }
    >
      {labels.title}: {labels.message}
      {errorCode === null ? "" : ` (${errorCode})`}
    </Alert>
  );
}
