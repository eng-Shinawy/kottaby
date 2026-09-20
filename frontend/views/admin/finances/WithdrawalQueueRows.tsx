"use client";

/**
 * WithdrawalQueueRows — the desktop queue row of the withdrawal payout
 * queue (`/admin/finances`, withdrawals tab): teacher, amount (the
 * requester's reserved wallet balance at read time), requested-at
 * timestamp, the row's status chip, and the approve/reject settle-button
 * pair (extracted to `WithdrawalQueueSettleButtons`, shared with the
 * mobile cards).
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, theme-palette colors.
 */

import { TableCell, TableRow, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate, formatLedgerStamp } from "@/frontend/lib/i18n/format-date";
import { formatMoneyAmount } from "@/frontend/views/admin/analytics/platform-analytics-display";
import { QueueSettleButtons } from "@/frontend/views/admin/finances/WithdrawalQueueSettleButtons";
import { withdrawalStatusLabel, withdrawalStatusTone } from "@/frontend/views/admin/finances/withdrawalStatusDisplay";
import { TonalChip } from "@/frontend/views/admin/users/ui";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";

/** One queue row of the desktop table. */
export function WithdrawalRow({
  item,
  locale,
  striped,
  onApprove,
  onReject,
}: Readonly<{
  item: AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items;
  locale: string;
  striped: boolean;
  onApprove: (item: AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items) => void;
  onReject: (item: AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items) => void;
}>): ReactNode {
  const t = useAppTranslation(AdminFinance);
  return (
    <TableRow
      sx={theme => ({
        ...(striped && { backgroundColor: theme.palette.action.hover }),
        "&:hover": { backgroundColor: theme.palette.action.selected },
      })}
    >
      <TableCell sx={theme => ({ borderBottom: `1px solid ${theme.palette.border.light}` })}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {item.teacherName}
        </Typography>
      </TableCell>
      <TableCell
        sx={theme => ({
          borderBottom: `1px solid ${theme.palette.border.light}`,
          fontVariantNumeric: "tabular-nums",
          textAlign: "end",
        })}
      >
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {formatMoneyAmount(item.transaction.amount)}
        </Typography>
      </TableCell>
      <TableCell
        sx={theme => ({
          borderBottom: `1px solid ${theme.palette.border.light}`,
          fontVariantNumeric: "tabular-nums",
          textAlign: "end",
        })}
      >
        <Typography variant="body2">{formatMoneyAmount(item.walletBalance)}</Typography>
      </TableCell>
      <TableCell sx={theme => ({ borderBottom: `1px solid ${theme.palette.border.light}` })}>
        <Typography
          variant="body2"
          dir="ltr"
          title={formatApplicantDate(item.transaction.createdAt, locale)}
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
          {formatLedgerStamp(item.transaction.createdAt)}
        </Typography>
      </TableCell>
      <TableCell sx={theme => ({ borderBottom: `1px solid ${theme.palette.border.light}` })}>
        <TonalChip
          tone={withdrawalStatusTone(item.transaction.status)}
          label={withdrawalStatusLabel(item.transaction.status, t)}
        />
      </TableCell>
      <TableCell sx={theme => ({ borderBottom: `1px solid ${theme.palette.border.light}` })}>
        <QueueSettleButtons
          transactionId={item.transaction.id}
          onApprove={() => {
            onApprove(item);
          }}
          onReject={() => {
            onReject(item);
          }}
          approveLabel={t.approveAction}
          rejectLabel={t.rejectAction}
        />
      </TableCell>
    </TableRow>
  );
}
