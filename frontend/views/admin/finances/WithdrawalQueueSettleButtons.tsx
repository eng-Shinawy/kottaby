"use client";

/**
 * WithdrawalQueueSettleButtons — the shared approve/reject settle-button
 * pair of the withdrawal payout queue (`/admin/finances`, withdrawals tab).
 *
 * The pair is shared by the desktop rows and the mobile cards (the mobile
 * stack right-aligns it) — the buttons key their testids on the transaction
 * id. The skins are deliberately asymmetric: Approve is the contained
 * primary (the payout-forwarding action), Reject is the outlined error lane
 * (the destructive one) so intent scans before tap.
 *
 * MUI v9 `sx`-only discipline, theme-palette colors.
 */

import { Box, Stack } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";

/**
 * The shared settle action button skins — theme-palette colors only.
 */
function settleButtonSx(lane: "approve" | "reject"): SxProps<Theme> {
  return theme =>
    lane === "approve"
      ? {
          minHeight: 44,
          px: 1.5,
          borderRadius: 2,
          whiteSpace: "nowrap",
          border: "1px solid transparent",
          bgcolor: theme.palette.primary.main,
          color: theme.palette.onPrimary,
          cursor: "pointer",
          "&:hover": { bgcolor: theme.palette.primary.light },
        }
      : {
          minHeight: 44,
          px: 1.5,
          borderRadius: 2,
          whiteSpace: "nowrap",
          border: "1px solid",
          borderColor: theme.palette.error.main,
          bgcolor: "transparent",
          color: theme.palette.error.main,
          cursor: "pointer",
          "&:hover": { bgcolor: theme.palette.errorContainer, borderColor: theme.palette.error.light },
        };
}

interface QueueSettleButtonsProps {
  /** The transaction id (both testids key on it). */
  readonly transactionId: string;
  /** Approve intent — opens the approve confirm dialog. */
  readonly onApprove: () => void;
  /** Reject intent — opens the reject dialog (mandatory reason). */
  readonly onReject: () => void;
  /** Localized approve CTA copy. */
  readonly approveLabel: string;
  /** Localized reject CTA copy. */
  readonly rejectLabel: string;
  /** Extra row alignment (the mobile cards right-align the pair). */
  readonly justifyContent?: "flex-end";
}

/** The approve/reject settle-button pair (shared by the desktop rows and the mobile cards). */
export function QueueSettleButtons({
  transactionId,
  onApprove,
  onReject,
  approveLabel,
  rejectLabel,
  justifyContent,
}: Readonly<QueueSettleButtonsProps>): ReactNode {
  return (
    <Stack direction="row" spacing={1.5} sx={{ justifyContent }}>
      <Box
        component="button"
        type="button"
        onClick={onApprove}
        data-testid={`admin-finances-approve-${transactionId}`}
        sx={settleButtonSx("approve")}
      >
        {approveLabel}
      </Box>
      <Box
        component="button"
        type="button"
        onClick={onReject}
        data-testid={`admin-finances-reject-${transactionId}`}
        sx={settleButtonSx("reject")}
      >
        {rejectLabel}
      </Box>
    </Stack>
  );
}
