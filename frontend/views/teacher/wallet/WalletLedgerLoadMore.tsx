"use client";

/**
 * WalletLedgerLoadMore — the full-width quiet "load older rows" arm under
 * the ledger rows (the paginated ledger): 44px touch target, RTL-neutral
 * chevron, spinner while the older window is in flight. Extracted from
 * `WalletLedger` (the max-lines split).
 */

import ExpandMoreOutlined from "@mui/icons-material/ExpandMoreOutlined";
import { Button, CircularProgress } from "@mui/material";
import type { ReactNode } from "react";

export interface WalletLedgerLoadMoreProps {
  readonly loadingMore: boolean;
  readonly onLoadMore: () => void;
  readonly label: string;
}

/** The full-width "load older rows" arm — see the module docblock. */
export function WalletLedgerLoadMore({
  loadingMore,
  onLoadMore,
  label,
}: Readonly<WalletLedgerLoadMoreProps>): ReactNode {
  return (
    <Button
      data-testid="wallet-ledger-load-more"
      fullWidth
      variant="text"
      onClick={onLoadMore}
      disabled={loadingMore}
      startIcon={loadingMore ? <CircularProgress size={16} color="inherit" /> : <ExpandMoreOutlined />}
      sx={theme => ({
        minHeight: 44,
        borderRadius: 0,
        py: 1.25,
        color: theme.palette.onSurfaceVariant,
        borderTop: "1px solid",
        borderColor: theme.palette.divider,
      })}
    >
      {label}
    </Button>
  );
}
