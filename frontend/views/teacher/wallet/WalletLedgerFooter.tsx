"use client";

/**
 * WalletLedgerFooter — the stretch footer line under the ledger rows: on
 * tall viewports the card grows and this line absorbs the remainder
 * deliberately instead of leaving an unstructured void. With pagination
 * the copy distinguishes a full read ("showing all") from a page window
 * ("showing X of Y" / "showing the latest X"). Extracted from
 * `WalletLedger` (the max-lines split).
 */

import { Typography } from "@mui/material";
import type { ReactNode } from "react";

export interface WalletLedgerFooterProps {
  readonly text: string;
}

/** The stretch ledger footer line — see the module docblock. */
export function WalletLedgerFooter({ text }: Readonly<WalletLedgerFooterProps>): ReactNode {
  return (
    <Typography
      variant="caption"
      sx={theme => ({
        mt: "auto",
        px: 2.5,
        py: 1.25,
        borderTop: "1px solid",
        borderColor: theme.palette.divider,
        bgcolor: theme.palette.surfaceContainerLow,
        color: theme.palette.onSurfaceVariant,
        textAlign: "center",
        fontVariantNumeric: "tabular-nums",
      })}
    >
      {text}
    </Typography>
  );
}
