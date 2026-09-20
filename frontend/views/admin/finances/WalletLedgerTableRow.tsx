"use client";

/**
 * WalletLedgerTableRow — one desktop ledger row of the admin wallet
 * inspector's transaction table (`/admin/finances`, wallet tab): the
 * type/status chips, the right-aligned money + date cells, and the
 * description.
 *
 * The date cell renders the pure-ASCII `formatLedgerStamp` inside an
 * isolated LTR box (the ICU `ar` stamp embeds RLM controls that mash the
 * visible order inside an RTL cell — QA finding); the locale-aware full
 * stamp rides the native tooltip.
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, theme-palette colors.
 */

import { TableCell, TableRow, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminTeacherWalletQuery_adminTeacherWallet_transactions } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate, formatLedgerStamp } from "@/frontend/lib/i18n/format-date";
import { formatMoneyAmount } from "@/frontend/views/admin/analytics/platform-analytics-display";
import {
  ledgerStatusLabel,
  ledgerStatusTone,
  ledgerTypeLabel,
  ledgerTypeTone,
} from "@/frontend/views/admin/finances/walletLedgerDisplay";
import { TonalChip } from "@/frontend/views/admin/users/ui";
import type { AdminFinanceLabels } from "@/shared/locale/types/adminFinance";

/** One ledger row: type/status chips, right-aligned money + date, description. */
export function WalletLedgerTableRow({
  tx,
  index,
  locale,
  labels,
}: Readonly<{
  tx: AdminTeacherWalletQuery_adminTeacherWallet_transactions;
  index: number;
  locale: string;
  labels: AdminFinanceLabels;
}>): ReactNode {
  return (
    <TableRow
      sx={theme => ({
        ...(index % 2 === 1 && { backgroundColor: theme.palette.action.hover }),
        "&:hover": { backgroundColor: theme.palette.action.selected },
      })}
    >
      <TableCell sx={theme => ({ borderBottom: `1px solid ${theme.palette.border.light}` })}>
        <TonalChip outlined tone={ledgerTypeTone(tx.type)} label={ledgerTypeLabel(tx.type, labels)} />
      </TableCell>
      <TableCell sx={theme => ({ borderBottom: `1px solid ${theme.palette.border.light}` })}>
        <TonalChip tone={ledgerStatusTone(tx.status)} label={ledgerStatusLabel(tx.status, labels)} />
      </TableCell>
      <TableCell
        sx={theme => ({
          borderBottom: `1px solid ${theme.palette.border.light}`,
          fontVariantNumeric: "tabular-nums",
          textAlign: "end",
        })}
      >
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {formatMoneyAmount(tx.amount)}
        </Typography>
      </TableCell>
      <TableCell sx={theme => ({ borderBottom: `1px solid ${theme.palette.border.light}` })}>
        <Typography variant="body2">{tx.description}</Typography>
      </TableCell>
      <TableCell sx={theme => ({ borderBottom: `1px solid ${theme.palette.border.light}`, textAlign: "end" })}>
        <Typography
          variant="body2"
          dir="ltr"
          title={formatApplicantDate(tx.createdAt, locale)}
          sx={{
            // Isolated LTR box + pure-ASCII stamp: the ICU `ar` stamp embeds
            // RLM controls that mash the visible order inside the RTL table
            // cell (QA finding) — the numeric stamp pins the glyph order, and
            // the locale-aware full stamp rides the native tooltip.
            unicodeBidi: "isolate",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            cursor: "default",
          }}
        >
          {formatLedgerStamp(tx.createdAt)}
        </Typography>
      </TableCell>
    </TableRow>
  );
}
