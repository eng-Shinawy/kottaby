"use client";

/**
 * PaymentsTableCard — the desktop (≥`md`) payments table card of the
 * payments audit panel (`/admin/finances`, payments tab), extracted from
 * the original monolithic panel as a focused sibling component: the
 * hand-rolled MUI table over the shared header cell + footer atoms.
 *
 * Columns: student (name + id), amount (exact decimal string, grouped for
 * display only), currency, gateway, status (tonal chip), date. Loading
 * renders stable-key skeleton rows; a zero page renders the empty state
 * (the `paymentsEmpty` copy — filters explain a bare page).
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, theme-palette colors, `*Outlined` icons.
 */

import { Card, Skeleton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminStudentPaymentsQuery_adminStudentPayments_items } from "@/frontend/graphql/generated/gql/graphql";
import { DirectoryHeaderCell } from "@/frontend/views/admin/directory-shared/DirectoryHeaderCell";
import type { DirectoryTableHeader } from "@/frontend/views/admin/directory-shared/DirectoryTableScaffold";
import { directoryTableCardSx } from "@/frontend/views/admin/directory-shared/directory-skins";
import { PAYMENTS_SKELETON_KEYS } from "@/frontend/views/admin/finances/adminFinanceSkeletonKeys";
import { FinanceTableFooter } from "@/frontend/views/admin/finances/FinanceTableFooter";
import { PaymentRow, PaymentsEmptyState } from "@/frontend/views/admin/finances/PaymentsTableRows";
import type { AdminFinanceLabels } from "@/shared/locale/types/adminFinance";

/** Desktop (≥md) payments table card — the hand-rolled MUI table. */
export function PaymentsTableCard({
  items,
  loading,
  locale,
  labels,
  namespace,
  page,
  pageSize,
  totalCount,
  onPageChange,
}: Readonly<{
  items: readonly AdminStudentPaymentsQuery_adminStudentPayments_items[];
  loading: boolean;
  locale: string;
  labels: AdminFinanceLabels;
  namespace: AdminFinanceLabels;
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}>): ReactNode {
  const headers: readonly DirectoryTableHeader[] = [
    { id: "student", width: "30%", label: labels.studentHeader },
    { id: "amount", width: "15%", label: labels.amountHeader, align: "end" },
    { id: "currency", width: "11%", label: labels.currencyHeader },
    { id: "gateway", width: "16%", label: labels.gatewayHeader },
    { id: "status", width: "13%", label: labels.statusHeader },
    { id: "date", width: "15%", label: labels.dateHeader },
  ];
  return (
    <Card sx={directoryTableCardSx()}>
      <TableContainer>
        <Table sx={{ tableLayout: "fixed" }} aria-label={labels.paymentsTab}>
          <TableHead>
            <TableRow sx={theme => ({ bgcolor: theme.palette.surfaceContainerHigh })}>
              {headers.map(header => (
                <DirectoryHeaderCell key={header.id} width={header.width} align={header.align}>
                  {header.label}
                </DirectoryHeaderCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody aria-label={loading && items.length === 0 ? labels.loadingLabel : undefined}>
            {loading && items.length === 0
              ? PAYMENTS_SKELETON_KEYS.map(rowKey => (
                  <TableRow key={rowKey}>
                    <TableCell
                      colSpan={headers.length}
                      sx={theme => ({ borderBottom: `1px solid ${theme.palette.border.light}` })}
                    >
                      <Skeleton variant="text" />
                    </TableCell>
                  </TableRow>
                ))
              : null}
            {!loading && items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={headers.length} sx={{ borderBottom: 0 }}>
                  <PaymentsEmptyState emptyCopy={labels.paymentsEmpty} />
                </TableCell>
              </TableRow>
            ) : null}
            {items.map((payment, index) => (
              <PaymentRow
                key={payment.id}
                payment={payment}
                locale={locale}
                labels={namespace}
                striped={index % 2 === 1}
              />
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <FinanceTableFooter
        countLine={labels.paymentsResultCount(totalCount)}
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={onPageChange}
      />
    </Card>
  );
}
