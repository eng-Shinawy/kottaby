"use client";

import { SendOutlined as SendIcon } from "@mui/icons-material";
import { Alert, Box, Snackbar, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { resolveParentLinkDenialCopy } from "@/frontend/lib/parent-link-denials";
import type { ErrorsLabels } from "@/shared/locale/types/errors";
import type { ParentLinkLabels } from "@/shared/locale/types/parentLink";

/**
 * Presentational states of the parent outgoing link-requests section
 * (DEV1-014 task 4.3) — extracted from the stateful orchestrator so the
 * hooks-bearing component stays inside the view size budgets. Every label
 * arrives as an already-resolved namespace handle (property access only).
 *
 * The unsettled branch chain (retryable → generic failure → skeleton) lives
 * in the sibling `OutgoingSectionStates.parts.tsx`; this module keeps the
 * settled/result surfaces (empty, denial, list, toast).
 */

/** Success-toast auto-hide cadence for the cancel confirmation. */
export const CANCEL_TOAST_AUTOHIDE_MS = 6000;

/**
 * Zero-rows branch — the icon-in-tinted-circle composition, brought to FULL
 * parity with the student side's `IncomingEmptyState` (same 72/36 circle
 * rhythm, `secondaryContainer` tint, centered spacing): the parent page
 * should not read as the poorer sibling just because its list is empty.
 * The send affordance on the discovery card is still the action surface, so
 * this state intentionally renders no buttons.
 */
export function OutgoingEmptyState({ labels }: Readonly<{ readonly labels: ParentLinkLabels }>): ReactNode {
  return (
    <Stack
      spacing={2}
      data-testid="parent-outgoing-empty"
      sx={{ alignItems: "center", justifyContent: "center", py: { xs: 6, sm: 10 }, px: 2, textAlign: "center" }}
    >
      <Box
        aria-hidden
        sx={theme => ({
          width: 72,
          height: 72,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          bgcolor: theme.palette.secondaryContainer,
          color: theme.palette.onSecondaryContainer,
        })}
      >
        <SendIcon sx={{ fontSize: 36 }} />
      </Box>
      <Typography variant="h6" component="p" sx={{ fontWeight: 700 }}>
        {labels.outgoingEmptyTitle}
      </Typography>
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, maxWidth: 420 })}>
        {labels.outgoingEmptyBody}
      </Typography>
    </Stack>
  );
}

/**
 * Mutation-denial surface — the shared parent-link denial copy keyed by the
 * raw `extensions.code` (constant-shape discipline: the same wire code maps
 * to the SAME localized copy on every DEV1-014 surface).
 */
export function OutgoingDenialAlert({
  denialCode,
  errorLabels,
}: Readonly<{ readonly denialCode: string; readonly errorLabels: ErrorsLabels }>): ReactNode {
  return (
    <Alert severity="error" variant="outlined" data-testid="parent-outgoing-denial-alert" sx={{ borderRadius: 2 }}>
      {resolveParentLinkDenialCopy(denialCode, errorLabels)}
    </Alert>
  );
}

/** The settled list region — keyed row nodes composed by the section. */
export function OutgoingSettledList({
  rowNodes,
  listLabel,
  busy,
}: Readonly<{ readonly rowNodes: ReactNode[]; readonly listLabel: string; readonly busy: boolean }>): ReactNode {
  return (
    <Box
      component="output"
      data-testid="parent-outgoing-list"
      aria-label={listLabel}
      aria-busy={busy}
      sx={{ display: "grid", gap: 2 }}
    >
      {rowNodes}
    </Box>
  );
}

/** Transient localized success snackbar after the cancel resolves. */
export function OutgoingSuccessToast({
  copy,
  onClose,
}: Readonly<{ readonly copy: string | null; readonly onClose: () => void }>): ReactNode {
  return (
    <Snackbar
      open={copy !== null}
      autoHideDuration={CANCEL_TOAST_AUTOHIDE_MS}
      onClose={(_, reason) => {
        if (reason !== "clickaway") {
          onClose();
        }
      }}
    >
      <Alert severity="success" variant="filled" data-testid="parent-outgoing-success-toast" sx={{ borderRadius: 2 }}>
        {copy}
      </Alert>
    </Snackbar>
  );
}
