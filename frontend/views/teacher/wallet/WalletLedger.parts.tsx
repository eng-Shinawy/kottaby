"use client";

/**
 * WalletLedger parts — the ledger's type-filter chip bar, carved out of
 * `WalletLedger` so the filter affordance stays under the TSX function-size
 * tier. The arbitration_reversal chip filters like any other ledger type.
 * (The row list lives in `WalletLedgerRows` / `WalletLedgerRow`.)
 */

import { Box, Chip } from "@mui/material";
import type { ReactNode } from "react";
import type { TransactionType as WireTransactionType } from "@/frontend/graphql/generated/gql/graphql";

/** One filter chip's view model (the bar renders them verbatim). */
export interface WalletLedgerFilterChip {
  readonly key: WireTransactionType | "all";
  readonly label: string;
  readonly count: number;
}

/**
 * The type-filter chip bar. A native `fieldset` grouping (the a11y tier's
 * `prefer-tag-over-role` — the chips' toggle-group semantics ride the
 * element, not an ARIA role), reset to a plain flex row. On the narrowest
 * breakpoint the row scrolls horizontally so every chip stays on ONE line
 * (a lone wrapped chip read as a broken control); `sm+` keeps wrapping.
 */
export function WalletLedgerFilterBar({
  chips,
  activeKey,
  onChange,
  label,
}: Readonly<{
  chips: readonly WalletLedgerFilterChip[];
  activeKey: WireTransactionType | "all";
  onChange: (next: WireTransactionType | "all") => void;
  label: string;
}>): ReactNode {
  return (
    <Box
      component="fieldset"
      aria-label={label}
      data-testid="wallet-ledger-filter"
      sx={theme => ({
        border: 0,
        m: 0,
        minWidth: 0,
        px: 2.5,
        py: 1.25,
        display: "flex",
        flexWrap: { xs: "nowrap", sm: "wrap" },
        overflowX: { xs: "auto", sm: "visible" },
        gap: 0.75,
        rowGap: 1,
        bgcolor: theme.palette.surfaceContainerLow,
      })}
    >
      {chips.map(chip => (
        <Chip
          key={chip.key}
          data-testid={`wallet-ledger-filter-${chip.key}`}
          label={`${chip.label} (${chip.count})`}
          aria-pressed={activeKey === chip.key}
          onClick={() => onChange(chip.key)}
          color={activeKey === chip.key ? "primary" : "default"}
          variant={activeKey === chip.key ? "filled" : "outlined"}
          size="small"
          sx={{
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
            ...(activeKey === chip.key ? {} : { bgcolor: "transparent" }),
          }}
        />
      ))}
    </Box>
  );
}
