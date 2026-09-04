"use client";

import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import type { CommonLabels } from "@/shared/locale/types/common";
import type { ParentLinkLabels } from "@/shared/locale/types/parentLink";

/** A11y wiring ids for the single cancel dialog instance. */
const DIALOG_TITLE_ID = "outgoing-cancel-dialog-title";
const DIALOG_BODY_ID = "outgoing-cancel-dialog-body";

interface OutgoingLinkRequestCancelDialogProps {
  /** The id of the request being cancelled (null = dialog closed). */
  readonly requestId: string | null;
  /** `parentLink` namespace labels (property access only). */
  readonly labels: ParentLinkLabels;
  /** `common` namespace labels (dialog dismiss affordance). */
  readonly commonLabels: CommonLabels;
  /** The cancel mutation is in flight (LoadingButton-style disable). */
  readonly pending: boolean;
  /** Form submit handler (React 19 `SubmitEvent` discipline). */
  readonly onSubmit: (event: React.SubmitEvent<HTMLFormElement>) => void;
  /** Dismisses the dialog without submitting. */
  readonly onClose: () => void;
}

/**
 * OutgoingLinkRequestCancelDialog — the translated withdrawal gate for the
 * parent's own pending request (DEV1-014 task 4.3). The body copy is the
 * static `cancelDialogBody` slot (no name interpolation — the masked-name
 * row is already on screen). The dialog is form-bearing: the submit button
 * is `type="submit"` inside a `<Box component="form">` so the React 19
 * `SubmitEvent` discipline holds, and it carries the LoadingButton-style
 * in-flight disable (`loading` + `disabled`) while the cancel mutation runs.
 */
export function OutgoingLinkRequestCancelDialog({
  requestId,
  labels,
  commonLabels,
  pending,
  onSubmit,
  onClose,
}: Readonly<OutgoingLinkRequestCancelDialogProps>): ReactNode {
  if (requestId === null) {
    return null;
  }

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      aria-labelledby={DIALOG_TITLE_ID}
      aria-describedby={DIALOG_BODY_ID}
      data-testid="outgoing-cancel-dialog"
    >
      <Box component="form" noValidate onSubmit={onSubmit}>
        <DialogTitle id={DIALOG_TITLE_ID} sx={{ fontWeight: 700 }}>
          {labels.cancelDialogTitle}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id={DIALOG_BODY_ID}>{labels.cancelDialogBody}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button type="button" disabled={pending} onClick={onClose} sx={{ ...focusVisibleRingSx, minHeight: 44 }}>
            {commonLabels.cancel}
          </Button>
          <Button
            type="submit"
            variant="contained"
            color="error"
            autoFocus
            loading={pending}
            disabled={pending}
            sx={{ ...focusVisibleRingSx, minHeight: 44 }}
          >
            {labels.cancelAction}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
