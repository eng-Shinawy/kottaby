/**
 * FormDialogShell — shared dialog body scaffold for admin create/edit forms.
 *
 * Renders the form element, dialog title, content area (with the symmetric
 * inline gutter and the global error alert) and the cancel/save action row
 * shared by every admin entity form content (plans, lessons). Callers supply
 * their own field component as `children` and localized action labels.
 */

"use client";

import {
  Alert,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useRef } from "react";

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
  /**
   * Extra availability gate for the save action — `true` keeps the submit
   * button disabled even while idle (the form cannot assemble a valid
   * submission yet, e.g. an empty option catalog). Additive optional:
   * callers that omit it keep the loading-only behavior.
   */
  readonly submitDisabled?: boolean;
  /**
   * A muted keyboard hint rendered at the inline start of the action row
   * (the shell also wires Ctrl/Cmd+Enter to the form's submit — the same
   * availability gates as the save button apply). Additive optional.
   */
  readonly submitHint?: string;
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
  submitDisabled = false,
  submitHint,
  globalError,
  onClose,
  onSubmit,
  children,
}: FormDialogShellProps): React.ReactElement {
  // Ctrl/Cmd+Enter anywhere in the form submits it — the shell owns the
  // form element, so every caller gains the affordance; the same
  // availability gates as the save button apply. The listener rides the
  // native element (not a JSX prop) so the non-interactive form keeps a
  // clean accessibility tree.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const node = formRef.current;
    if (!node) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        if (!loading && !submitDisabled) node.requestSubmit();
      }
    };
    node.addEventListener("keydown", handleKeyDown);
    return () => node.removeEventListener("keydown", handleKeyDown);
  }, [loading, submitDisabled]);
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate>
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
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        {submitHint ? (
          <Typography
            variant="caption"
            sx={theme => ({ marginInlineEnd: "auto", color: theme.palette.text.disabled, alignSelf: "center" })}
          >
            {submitHint}
          </Typography>
        ) : null}
        <Button variant="outlined" onClick={onClose} color="inherit" disabled={loading}>
          {labels.cancel}
        </Button>
        <Button
          type="submit"
          color="primary"
          disabled={loading || submitDisabled}
          variant="contained"
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {loading ? labels.saving : labels.save}
        </Button>
      </DialogActions>
    </form>
  );
}
