"use client";

/**
 * BroadcastComposeSuccessSnackbar — the pluralized success toast carrying the
 * server-returned recipient count (`successToast(count)` resolves AFTER the
 * write; the count is the toast's only interpolated value). Renders nothing
 * while no count is parked; the dismiss affordance is a labelled
 * `CloseOutlined` icon button with a keyboard focus ring.
 */

import { CloseOutlined } from "@mui/icons-material";
import { Alert, IconButton, Snackbar } from "@mui/material";
import type { ReactNode } from "react";
import { SNACKBAR_DISMISS_SX } from "@/frontend/views/admin/broadcasts/broadcast-compose-skin";
import type { AdminBroadcastsLabels } from "@/shared/locale/types/adminBroadcasts";

interface BroadcastComposeSuccessSnackbarProps {
  readonly count: number | null;
  readonly labels: AdminBroadcastsLabels;
  readonly closeLabel: string;
  readonly onClose: () => void;
}

export function BroadcastComposeSuccessSnackbar(props: BroadcastComposeSuccessSnackbarProps): ReactNode {
  if (props.count === null) {
    return null;
  }
  return (
    <Snackbar
      open
      autoHideDuration={6000}
      onClose={props.onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      action={
        <IconButton aria-label={props.closeLabel} onClick={props.onClose} size="small" sx={SNACKBAR_DISMISS_SX}>
          <CloseOutlined />
        </IconButton>
      }
    >
      <Alert severity="success" variant="filled" sx={{ width: "100%" }}>
        {props.labels.successToast(props.count)}
      </Alert>
    </Snackbar>
  );
}
