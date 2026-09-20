"use client";

/**
 * The ledger's desktop column-header row plus the newest-first row list.
 * The header shares the row grid's column template (including the fixed
 * date/status/amount tracks) so header labels and row cells always line
 * up; it is hidden below `md` where rows reflow to stacked cards.
 */

import { Box, List, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { MyWalletQuery_myWallet_transactions } from "@/frontend/graphql/generated/gql/graphql";
import { WalletLedgerRow } from "@/frontend/views/teacher/wallet/WalletLedgerRow";
import type { WalletLabels } from "@/shared/locale/types/wallet";

/**
 * The desktop column-header row. Hidden below `md` where rows reflow to
 * stacked cards.
 */
function WalletLedgerColumnsHeader({ t }: Readonly<{ t: WalletLabels }>): ReactNode {
  return (
    <Box
      data-testid="wallet-ledger-columns-header"
      sx={theme => ({
        display: { xs: "none", md: "grid" },
        alignItems: "center",
        columnGap: 2,
        px: 2,
        py: 1.25,
        borderBottom: "1px solid",
        borderColor: theme.palette.divider,
        gridTemplateColumns: "40px minmax(0, 1fr) 152px 88px 96px",
        gridTemplateAreas: '"avatar text date status amount"',
      })}
    >
      <Box component="span" sx={{ gridArea: "avatar" }} />
      {(
        [
          ["text", t.ledgerColumnTransaction, "start"],
          ["date", t.createdAt, "start"],
          ["status", t.ledgerColumnStatus, "end"],
          ["amount", t.ledgerColumnAmount, "end"],
        ] as const
      ).map(([area, label, align]) => (
        <Typography
          key={area}
          variant="caption"
          sx={theme => ({
            gridArea: area,
            justifySelf: align,
            fontWeight: 700,
            color: theme.palette.onSurfaceVariant,
          })}
        >
          {label}
        </Typography>
      ))}
    </Box>
  );
}

/** The newest-first ledger rows — header row, then one grid row per transaction. */
export function WalletLedgerRows({
  rows,
  locale,
  t,
}: Readonly<{
  rows: readonly MyWalletQuery_myWallet_transactions[];
  locale: string;
  t: WalletLabels;
}>): ReactNode {
  return (
    <>
      <WalletLedgerColumnsHeader t={t} />
      <List data-testid="wallet-ledger" disablePadding>
        {rows.map((row, index) => (
          <WalletLedgerRow key={row.id} row={row} isLast={index === rows.length - 1} locale={locale} t={t} />
        ))}
      </List>
    </>
  );
}
