"use client";

import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import type { PendingDecision } from "@/frontend/views/students/link-requests/LinkRequestCard";
import type { CommonLabels } from "@/shared/locale/types/common";
import type { ParentLinkLabels } from "@/shared/locale/types/parentLink";

/** A11y wiring ids for the single confirm/reject dialog instance. */
const DIALOG_TITLE_ID = "student-link-request-dialog-title";
const DIALOG_BODY_ID = "student-link-request-dialog-body";

interface LinkRequestDecisionDialogProps {
  /** The open decision (null = dialog closed). */
  readonly decision: PendingDecision | null;
  /** `parentLink` namespace labels (property access only). */
  readonly labels: ParentLinkLabels;
  /** `common` namespace labels (dialog cancel affordance). */
  readonly commonLabels: CommonLabels;
  /** The respond mutation is in flight (LoadingButton-style disable). */
  readonly pending: boolean;
  /** Form submit handler (React 19 `SubmitEvent` discipline). */
  readonly onSubmit: (event: React.SubmitEvent<HTMLFormElement>) => void;
  /** Dismisses the dialog without submitting. */
  readonly onClose: () => void;
}

/**
 * LinkRequestDecisionDialog — the translated confirmation gate for BOTH
 * transitions (DEV1-014 task 4.2). The body interpolates the snapshotted
 * parent display name through `confirmDialogBody(parentName)` /
 * `rejectDialogBody(parentName)` (the namespace function slots — never
 * hand-rolled string interpolation). The dialog is form-bearing: the submit
 * button is `type="submit"` inside a `<Box component="form">` so the React
 * 19 `SubmitEvent` discipline holds, and it carries the LoadingButton-style
 * in-flight disable (`loading` + `disabled`) while the respond mutation
 * runs. `dir="auto"` on the body keeps the interpolated name bidi-safe.
 */
export function LinkRequestDecisionDialog({
  decision,
  labels,
  commonLabels,
  pending,
  onSubmit,
  onClose,
}: Readonly<LinkRequestDecisionDialogProps>): ReactNode {
  if (decision === null) {
    return null;
  }
  const accept = decision.accept;
  const title = accept ? labels.confirmDialogTitle : labels.rejectDialogTitle;
  const body = accept ? labels.confirmDialogBody(decision.parentName) : labels.rejectDialogBody(decision.parentName);
  const submitLabel = accept ? labels.confirmAction : labels.rejectAction;

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      aria-labelledby={DIALOG_TITLE_ID}
      aria-describedby={DIALOG_BODY_ID}
      data-testid="student-link-requests-dialog"
    >
      <Box component="form" noValidate onSubmit={onSubmit}>
        <DialogTitle id={DIALOG_TITLE_ID} sx={{ fontWeight: 700 }}>
          {title}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id={DIALOG_BODY_ID} dir="auto">
            {body}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button type="button" disabled={pending} onClick={onClose} sx={{ ...focusVisibleRingSx, minHeight: 44 }}>
            {commonLabels.cancel}
          </Button>
          <Button
            type="submit"
            variant="contained"
            autoFocus
            loading={pending}
            disabled={pending}
            sx={{ ...focusVisibleRingSx, minHeight: 44 }}
          >
            {submitLabel}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
