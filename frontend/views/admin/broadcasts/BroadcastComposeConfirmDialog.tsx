"use client";

/**
 * BroadcastComposeConfirmDialog — the send gate. The confirmation copy is
 * deliberately static (no audience-size preview — recipients are resolved at
 * send time and no recipient list is ever shown); the confirm affordance
 * disables while the mutation is in flight so a double-click inside the send
 * window cannot fire a second mutation (one compose-session idempotency key
 * per session).
 */

import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { CONFIRM_DIALOG_TITLE_ID } from "@/frontend/views/admin/broadcasts/broadcast-compose.helpers";
import { ACTION_BUTTON_SX } from "@/frontend/views/admin/broadcasts/broadcast-compose-skin";
import type { AdminBroadcastsLabels } from "@/shared/locale/types/adminBroadcasts";

interface BroadcastComposeConfirmDialogProps {
  readonly open: boolean;
  readonly sending: boolean;
  readonly sendIcon: ReactNode;
  readonly labels: AdminBroadcastsLabels;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

export function BroadcastComposeConfirmDialog(props: BroadcastComposeConfirmDialogProps): ReactNode {
  return (
    <Dialog aria-labelledby={CONFIRM_DIALOG_TITLE_ID} open={props.open} onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogTitle id={CONFIRM_DIALOG_TITLE_ID}>{props.labels.confirmTitle}</DialogTitle>
      <DialogContent>
        <Typography variant="body1" sx={theme => ({ color: theme.palette.text.secondary })}>
          {props.labels.confirmBody}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose} sx={ACTION_BUTTON_SX}>
          {props.labels.cancelAction}
        </Button>
        <Button
          onClick={props.onConfirm}
          variant="contained"
          disabled={props.sending}
          startIcon={props.sendIcon}
          sx={ACTION_BUTTON_SX}
        >
          {props.labels.confirmAction}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
