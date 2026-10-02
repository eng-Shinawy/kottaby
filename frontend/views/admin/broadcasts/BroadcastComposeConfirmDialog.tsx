"use client";

/**
 * BroadcastComposeConfirmDialog — the send gate. The confirmation copy is
 * static about DELIVERY MECHANICS (no audience-size preview — recipients are
 * resolved at send time and no recipient list is ever shown), but it ECHOES
 * the send's identity in a summary block: the composed title and the live
 * audience selection in the same display grammar the history table renders
 * (`composeAudienceSummary`) — a wrong-audience send is caught by READING
 * the gate, not by trusting the form behind it. The confirm affordance
 * disables while the mutation is in flight so a double-click inside the send
 * window cannot fire a second mutation (one compose-session idempotency key
 * per session).
 */

import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { CONFIRM_DIALOG_TITLE_ID } from "@/frontend/views/admin/broadcasts/broadcast-compose.helpers";
import { ACTION_BUTTON_SX } from "@/frontend/views/admin/broadcasts/broadcast-compose-skin";
import type { AdminBroadcastsLabels } from "@/shared/locale/types/adminBroadcasts";

interface BroadcastComposeConfirmDialogProps {
  readonly open: boolean;
  readonly sending: boolean;
  readonly sendIcon: ReactNode;
  readonly labels: AdminBroadcastsLabels;
  /** The composed broadcast's title — the summary block's first line. */
  readonly composeTitle: string;
  /** The live audience selection in the history table's display grammar. */
  readonly audienceSummary: string;
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
        <Box
          sx={theme => ({
            marginTop: 1.5,
            padding: 1.5,
            border: 1,
            borderColor: theme.palette.divider,
            borderRadius: 1.5,
            bgcolor: theme.palette.action.hover,
          })}
        >
          {/* Single logical strings only — the block is RTL-safe by
              construction (no directional markup, no split spans). */}
          <Typography
            variant="subtitle2"
            component="p"
            sx={theme => ({ color: theme.palette.text.primary, fontWeight: 600, overflowWrap: "anywhere" })}
          >
            {props.composeTitle}
          </Typography>
          <Typography
            variant="body2"
            component="p"
            sx={theme => ({ color: theme.palette.text.secondary, marginTop: 0.5, overflowWrap: "anywhere" })}
          >
            {props.labels.confirmSummaryAudience}: {props.audienceSummary}
          </Typography>
        </Box>
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
