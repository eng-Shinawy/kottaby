/**
 * ConfirmDialogBody — shared body scaffold for confirmation dialogs.
 *
 * Renders the common confirm-dialog content stack used across admin dialogs:
 *  - Optional inline error alert (server-localized message)
 *  - Secondary-tone message text
 *  - Emphasized target-entity label
 */

"use client";

import { Alert, DialogContentText, Stack } from "@mui/material";

export interface ConfirmDialogBodyProps {
  readonly error?: string | null;
  readonly message: React.ReactNode;
  readonly entityLabel: React.ReactNode;
}

export function ConfirmDialogBody({ error, message, entityLabel }: ConfirmDialogBodyProps): React.ReactElement {
  return (
    <Stack sx={{ gap: 2, mt: 1 }}>
      {error && (
        <Alert severity="error" sx={{ width: "100%" }}>
          {error}
        </Alert>
      )}
      <DialogContentText sx={theme => ({ color: theme.palette.text.secondary })}>{message}</DialogContentText>
      <DialogContentText sx={{ fontWeight: 600 }}>{entityLabel}</DialogContentText>
    </Stack>
  );
}
