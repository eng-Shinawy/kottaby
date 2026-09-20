"use client";

import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import type { ReactNode } from "react";

/**
 * AdminFormDialog + AdminDialogActionsPair — the cross-surface form-dialog
 * atoms of the admin surfaces. The repeated shell — the gated `Dialog` +
 * `DialogTitle` + grid `DialogContent`, and the dismiss/submit
 * `DialogActions` pair — lives HERE exactly once; the session-governance
 * dialogs (`sm`) and the student drawer's subscription dialogs (`xs`)
 * compose it through thin locale-shaped wrappers that bind their dialog
 * width and label vocabulary.
 *
 * The dismissal gate enforces the `onClose` prop contract at the dialog
 * itself: backdrop click and Escape are IGNORED while the mutation is
 * pending (the dismiss Button is separately disabled while loading).
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors, ≥44px touch
 * targets, keyboard-focusable dialog (`aria-labelledby` + focusable fields).
 */

interface AdminFormDialogProps {
  /** Whether the dialog is mounted-open. */
  readonly open: boolean;
  /** Dismiss intent (cancel/dismiss Button / backdrop click / Escape). */
  readonly onClose: () => void;
  /** True while the owning surface's mutation is in flight — dismissal gated. */
  readonly loading: boolean;
  /** The validated submit intent — the paper hosts the form element. */
  readonly onSubmit: (event: React.SubmitEvent<HTMLFormElement>) => void;
  /** The dialog title's DOM id (the `aria-labelledby` target). */
  readonly titleId: string;
  /** The localized dialog title. */
  readonly title: string;
  /** The dialog body (fields / copy / server-error alert) in the grid content. */
  readonly children: ReactNode;
  /** The action row (typically {@link AdminDialogActionsPair}). */
  readonly actions: ReactNode;
  /** The MUI paper width the owning surface binds (`sm` governance, `xs` drawer). */
  readonly maxWidth: "xs" | "sm";
}

/** The gated form-dialog shell: Dialog + title + grid content (actions passed through). */
export function AdminFormDialog({
  open,
  onClose,
  loading,
  onSubmit,
  titleId,
  title,
  children,
  actions,
  maxWidth,
}: Readonly<AdminFormDialogProps>): ReactNode {
  const handleDialogClose = (): void => {
    if (!loading) {
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleDialogClose}
      fullWidth
      maxWidth={maxWidth}
      slotProps={{ paper: { component: "form", onSubmit } }}
      aria-labelledby={titleId}
    >
      <DialogTitle id={titleId} sx={theme => ({ color: theme.palette.onSurface })}>
        {title}
      </DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 2 }}>{children}</DialogContent>
      {actions}
    </Dialog>
  );
}

interface AdminDialogActionsPairProps {
  /** Dismiss intent — the cancel affordance (disabled while loading). */
  readonly onClose: () => void;
  /** True while the owning surface's mutation is in flight. */
  readonly loading: boolean;
  /** Localized Common-namespace dismiss/cancel label. */
  readonly dismissLabel: string;
  /** Localized confirm/submit label. */
  readonly submitLabel: string;
  /** The submit affordance's testid (the suites + e2e drive it). */
  readonly submitTestId: string;
  /**
   * Extra disable condition beyond `loading` (e.g. an empty required
   * token) — the submit stays available for gated-then-corrected submits.
   */
  readonly submitDisabled?: boolean;
  /** Submit palette — the destructive cancel arm uses `error`. */
  readonly submitColor?: "primary" | "error";
}

/** The shared dismiss/submit action pair of the admin form dialogs. */
export function AdminDialogActionsPair({
  onClose,
  loading,
  dismissLabel,
  submitLabel,
  submitTestId,
  submitDisabled,
  submitColor = "primary",
}: Readonly<AdminDialogActionsPairProps>): ReactNode {
  return (
    <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
      {/* Outlined dismiss — a bare text button beside a contained primary
          reads as non-interactive; the outlined variant gives the dismiss
          affordance equal control quality (still ONE contained primary). */}
      <Button
        onClick={onClose}
        disabled={loading}
        variant="outlined"
        color="inherit"
        sx={{ minHeight: { xs: 44, sm: 40 }, px: 3, whiteSpace: "nowrap" }}
      >
        {dismissLabel}
      </Button>
      <Button
        type="submit"
        variant="contained"
        color={submitColor}
        disabled={loading || (submitDisabled ?? false)}
        data-testid={submitTestId}
        sx={theme => ({
          minHeight: { xs: 44, sm: 40 },
          px: 3,
          whiteSpace: "nowrap",
          // A disabled destructive submit keeps its error identity (dimmed
          // error-container pair instead of the neutral disabled wash) —
          // the destructive intent must read before the form is valid.
          ...(submitColor === "error" && {
            "&.Mui-disabled": {
              bgcolor: theme.palette.errorContainer,
              color: theme.palette.onErrorContainer,
              opacity: 0.6,
            },
          }),
        })}
      >
        {submitLabel}
      </Button>
    </DialogActions>
  );
}
