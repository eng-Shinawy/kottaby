"use client";

/**
 * PaymentsTableRows — the desktop body row + mobile card of the payments
 * audit table (`/admin/finances`, payments tab), extracted from the
 * original monolithic panel as focused sibling components.
 *
 * One desktop row: student (name + id), amount (exact decimal string,
 * grouped for display only), currency, gateway, status (tonal chip), date.
 * The mobile card mirrors the row's cell semantics.
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, theme-palette colors.
 */

import { ReceiptLongOutlined as EmptyIcon } from "@mui/icons-material";
import { Card, Stack, TableCell, TableRow, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminStudentPaymentsQuery_adminStudentPayments_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { formatMoneyAmount } from "@/frontend/views/admin/analytics/platform-analytics-display";
import {
  paymentGatewayLabel,
  paymentStatusLabel,
  paymentStatusTone,
} from "@/frontend/views/admin/finances/paymentStatusDisplay";
import { TonalChip } from "@/frontend/views/admin/users/ui";
import type { AdminFinanceLabels } from "@/shared/locale/types/adminFinance";

/** The honest empty state of the payments panel (shared by both layouts). */
export function PaymentsEmptyState({ emptyCopy }: Readonly<{ emptyCopy: string }>): ReactNode {
  return (
    <Stack spacing={1} sx={{ alignItems: "center", py: 6 }}>
      <EmptyIcon sx={theme => ({ fontSize: 48, color: theme.palette.text.secondary })} />
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
        {emptyCopy}
      </Typography>
    </Stack>
  );
}

/** One payment status chip — tone-mapped with the localized label. */
function PaymentStatusChip({ status, labels }: Readonly<{ status: string; labels: AdminFinanceLabels }>): ReactNode {
  return <TonalChip tone={paymentStatusTone(status)} label={paymentStatusLabel(status, labels)} />;
}

/** One body row of the desktop payments table. */
export function PaymentRow({
  payment,
  locale,
  labels,
  striped,
}: Readonly<{
  payment: AdminStudentPaymentsQuery_adminStudentPayments_items;
  locale: string;
  labels: AdminFinanceLabels;
  striped: boolean;
}>): ReactNode {
  return (
    <TableRow
      sx={theme => ({
        ...(striped && { backgroundColor: theme.palette.action.hover }),
        "&:hover": { backgroundColor: theme.palette.action.selected },
      })}
    >
      <TableCell sx={theme => ({ borderBottom: `1px solid ${theme.palette.border.light}` })}>
        <Stack spacing={0.25}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {payment.studentName}
          </Typography>
          <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary })}>
            {payment.studentId}
          </Typography>
        </Stack>
      </TableCell>
      <TableCell
        sx={theme => ({
          borderBottom: `1px solid ${theme.palette.border.light}`,
          fontVariantNumeric: "tabular-nums",
          textAlign: "end",
        })}
      >
        <Typography variant="body2">{formatMoneyAmount(payment.amount)}</Typography>
      </TableCell>
      <TableCell sx={theme => ({ borderBottom: `1px solid ${theme.palette.border.light}` })}>
        <Typography variant="body2">{payment.currency}</Typography>
      </TableCell>
      <TableCell sx={theme => ({ borderBottom: `1px solid ${theme.palette.border.light}` })}>
        <Typography variant="body2">{paymentGatewayLabel(payment.paymentGateway, labels)}</Typography>
      </TableCell>
      <TableCell sx={theme => ({ borderBottom: `1px solid ${theme.palette.border.light}` })}>
        <PaymentStatusChip status={payment.status} labels={labels} />
      </TableCell>
      <TableCell sx={theme => ({ borderBottom: `1px solid ${theme.palette.border.light}` })}>
        <Typography variant="body2">{formatApplicantDate(payment.createdAt, locale)}</Typography>
      </TableCell>
    </TableRow>
  );
}

/** One mobile payment card — mirrors the desktop row's cell semantics. */
interface PaymentCellLabels {
  readonly amountHeader: string;
  readonly gatewayHeader: string;
  readonly dateHeader: string;
}

export function PaymentMobileCard({
  payment,
  locale,
  labels,
  namespace,
}: Readonly<{
  payment: AdminStudentPaymentsQuery_adminStudentPayments_items;
  locale: string;
  labels: PaymentCellLabels;
  namespace: AdminFinanceLabels;
}>): ReactNode {
  return (
    <Card
      sx={theme => ({
        borderRadius: "12px",
        border: `1px solid ${theme.palette.border.light}`,
        boxShadow: theme.palette.shadow.card,
        p: 2,
      })}
    >
      <Stack spacing={1}>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {payment.studentName}
          </Typography>
          <PaymentStatusChip status={payment.status} labels={namespace} />
        </Stack>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2 }}>
          <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
            {labels.amountHeader}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {`${formatMoneyAmount(payment.amount)} ${payment.currency}`}
          </Typography>
        </Stack>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2 }}>
          <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
            {labels.gatewayHeader}
          </Typography>
          <Typography variant="body2">{paymentGatewayLabel(payment.paymentGateway, namespace)}</Typography>
        </Stack>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2 }}>
          <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
            {labels.dateHeader}
          </Typography>
          <Typography variant="body2">{formatApplicantDate(payment.createdAt, locale)}</Typography>
        </Stack>
      </Stack>
    </Card>
  );
}
