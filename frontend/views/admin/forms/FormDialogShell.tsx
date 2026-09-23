/**
 * FormDialogShell — shared dialog body scaffold for admin create/edit forms.
 *
 * Renders the form element, dialog title, content area (with the symmetric
 * inline gutter and the global error alert) and the cancel/save action row
 * shared by every admin entity form content (plans, lessons). Callers supply
 * their own field component as `children` and localized action labels.
 */

"use client";

import { Alert, Button, CircularProgress, DialogActions, DialogContent, DialogTitle, Stack } from "@mui/material";

interface FormDialogShellLabels {
  readonly cancel: string;
  readonly save: string;
  readonly saving: string;
}

export interface FormDialogShellProps {
  readonly titleId: string;
  readonly dialogTitle: string;
  readonly labels: FormDialogShellLabels;
  readonly loading: boolean;
  readonly globalError?: string | null;
  readonly onClose: () => void;
  readonly onSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => void;
  readonly children: React.ReactNode;
}

export function FormDialogShell({
  titleId,
  dialogTitle,
  labels,
  loading,
  globalError,
  onClose,
  onSubmit,
  children,
}: FormDialogShellProps): React.ReactElement {
  return (
    <form onSubmit={onSubmit} noValidate>
      <DialogTitle id={titleId} sx={{ fontWeight: 600 }}>
        {dialogTitle}
      </DialogTitle>
      <DialogContent
        sx={theme => ({
          // Symmetric inline gutter pinned to the theme spacing scale (logical
          // property — identical inset on both edges in LTR and RTL).
          paddingInline: theme.spacing(3),
        })}
      >
        <Stack sx={{ gap: 2.5, mt: 1 }}>
          {globalError && (
            <Alert severity="error" sx={{ width: "100%" }}>
              {globalError}
            </Alert>
          )}
          {children}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button variant="outlined" onClick={onClose} color="inherit" disabled={loading}>
          {labels.cancel}
        </Button>
        <Button
          type="submit"
          color="primary"
          disabled={loading}
          variant="contained"
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {loading ? labels.saving : labels.save}
        </Button>
      </DialogActions>
    </form>
  );
}
