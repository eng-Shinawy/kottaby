"use client";

import { Dialog, DialogContent, DialogTitle } from "@mui/material";
import { type ReactNode, useState } from "react";
import { SessionDialogActionButtons } from "@/frontend/views/student/sessions/SessionDialogActionButtons";
import { SessionDialogReasonField } from "@/frontend/views/student/sessions/SessionDialogReasonField";
import { SessionDialogWarningCallout } from "@/frontend/views/student/sessions/SessionDialogWarningCallout";

export interface SessionConfirmDialogLayoutProps {
  /** Prefix for accessibility IDs (e.g., 'cancel-session' or 'dispute-session'). */
  readonly idPrefix: string;
  readonly open: boolean;
  /**
   * Dismiss intent (cancel Button / backdrop click / Escape) — ignored
   * while the mutation is pending.
   */
  readonly onClose: () => void;
  /** Localized dialog title. */
  readonly title: string;
  /** Localized warning callout message. */
  readonly warningMessage: string;
  /** Localized reason field label. */
  readonly reasonLabel: string;
  /** Localized reason field placeholder. */
  readonly reasonPlaceholder: string;
  /** Whether the reason field is required. Blocks empty submits. */
  readonly reasonRequired?: boolean;
  /** Localized message shown when a required reason is omitted or invalid. */
  readonly reasonRequiredMessage?: string;
  /** UI-seam cap for the reason. */
  readonly maxLength: number;
  /** Both buttons disable while loading is true. Dismissal is also gated. */
  readonly loading: boolean;
  /** Fired with the trimmed reason when the form passes validation. */
  readonly onSubmit: (reason: string) => void;
  /** Localized submit button label. */
  readonly submitLabel: string;
  /** Submit button color. */
  readonly submitColor: "error" | "warning";
}

/**
 * Shared layout component encapsulating the form state, dismissal gate, and
 * dialog content for the confirm-and-reason session dialogs.
 */
export function SessionConfirmDialogLayout({
  idPrefix,
  open,
  onClose,
  title,
  warningMessage,
  reasonLabel,
  reasonPlaceholder,
  reasonRequired = false,
  reasonRequiredMessage,
  maxLength,
  loading,
  onSubmit,
  submitLabel,
  submitColor,
}: Readonly<SessionConfirmDialogLayoutProps>): ReactNode {
  const [reason, setReason] = useState("");
  const [reasonInvalid, setReasonInvalid] = useState(false);
  // Fresh-dialog discipline: the container mounts this dialog UNMOUNTED-KEYED
  // per session (`key={sessionId}` in the role containers), so every open
  // starts from the initial draft state — no reset effect needed.

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (loading) return;
    const trimmed = reason.trim();
    if (reasonRequired && (trimmed.length < 1 || trimmed.length > maxLength)) {
      setReasonInvalid(true);
      return;
    }
    if (!reasonRequired && trimmed.length > maxLength) {
      setReasonInvalid(true);
      return;
    }
    setReasonInvalid(false);
    onSubmit(trimmed);
  };

  // Dismissal gate — enforces the `onClose` prop contract at the dialog
  // itself: backdrop click and Escape are IGNORED while the mutation is
  // pending (the cancel Button is separately disabled while loading).
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
      maxWidth="sm"
      // `noValidate` — the required reason field's native constraint would
      // otherwise silently cancel the submit for an empty draft before the
      // programmatic validation can raise the localized error flag.
      aria-labelledby={`${idPrefix}-dialog-title`}
    >
      <DialogTitle id={`${idPrefix}-dialog-title`} sx={theme => ({ color: theme.palette.onSurface })}>
        {title}
      </DialogTitle>
      <form onSubmit={handleSubmit} noValidate style={{ display: "contents" }}>
        <DialogContent sx={{ display: "grid", gap: 2 }}>
          <SessionDialogWarningCallout message={warningMessage} />
          <SessionDialogReasonField
            value={reason}
            onValueChange={value => {
              setReason(value);
              // Live validation relief — an edit clears a raised flag.
              setReasonInvalid(false);
            }}
            label={reasonLabel}
            placeholder={reasonPlaceholder}
            required={reasonRequired}
            error={reasonInvalid}
            helperText={
              reasonInvalid && reasonRequiredMessage ? reasonRequiredMessage : `${reason.length}/${maxLength}`
            }
            maxLength={maxLength}
          />
        </DialogContent>
        <SessionDialogActionButtons
          loading={loading}
          onClose={onClose}
          submitLabel={submitLabel}
          submitColor={submitColor}
          submitDisabled={loading}
        />
      </form>
    </Dialog>
  );
}
