"use client";

import { PaymentsOutlined as ConsumedIcon, AccountBalanceWalletOutlined as HeldIcon } from "@mui/icons-material";
import { Chip } from "@mui/material";
import type { ReactNode } from "react";
import { TONE_COLORS } from "@/frontend/views/student/sessions/sessionRowPresentation";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * AdminDisputeEscrowChip — the escrow-class chip of an admin arbitration
 * row (`/disputes`): `feeHeld=true` marks a held dispute (the fee hold
 * still sits in its original balance lane), `feeHeld=false` a consumed
 * dispute (the fee moved at dual confirmation — the post-confirmation
 * family). The chip is the at-a-glance classification fact that decides
 * WHICH outcome vocabulary the resolve dialog offers.
 *
 * Painted from the shared session-row tone tables (`TONE_COLORS` — the
 * same Material 3 container/on-container pairs the lifecycle status chip
 * uses; info = parked hold, primary = consumed hold) with a quiet 1px
 * outline for the dark-mode container pairing. MUI v9 discipline:
 * `sx`-only styling, colors exclusively through `theme.palette.*`.
 */

interface AdminDisputeEscrowChipProps {
  /** The disputed row's escrow class — drives label, icon and tone pair. */
  readonly feeHeld: boolean;
  /** Localized sessions-namespace labels (the escrow vocabulary). */
  readonly t: SessionsLabels;
}

/** The escrow-class chip of one arbitration-queue row. */
export function AdminDisputeEscrowChip({ feeHeld, t }: Readonly<AdminDisputeEscrowChipProps>): ReactNode {
  const toneColors = (feeHeld ? TONE_COLORS.info : TONE_COLORS.primary) ?? TONE_COLORS.info;
  const Icon = feeHeld ? HeldIcon : ConsumedIcon;

  return (
    <Chip
      icon={<Icon fontSize="small" />}
      label={feeHeld ? t.escrowHeldChip : t.escrowConsumedChip}
      size="small"
      data-testid={feeHeld ? "admin-dispute-escrow-chip-held" : "admin-dispute-escrow-chip-consumed"}
      sx={theme => ({
        fontWeight: 600,
        bgcolor: toneColors.bg(theme.palette),
        color: toneColors.fg(theme.palette),
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        "& .MuiChip-icon": {
          color: toneColors.fg(theme.palette),
        },
      })}
    />
  );
}
