"use client";

/**
 * WalletLedgerTableCard — the desktop (≥`md`) transaction ledger table
 * card of the admin wallet inspector (`/admin/finances`, wallet tab):
 * type, status, amount, description, date over the shared header cell +
 * footer atoms. The row unit lives in `WalletLedgerTableRow` (extracted
 * to keep both modules under the file-size tier). Loading renders
 * stable-key skeleton rows; a zero page renders the inspector's empty
 * state.
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, theme-palette colors.
 */

import { Card, Skeleton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminTeacherWalletQuery_adminTeacherWallet_transactions } from "@/frontend/graphql/generated/gql/graphql";
import { DirectoryHeaderCell } from "@/frontend/views/admin/directory-shared/DirectoryHeaderCell";
import { directoryTableCardSx } from "@/frontend/views/admin/directory-shared/directory-skins";
import { AdminFinancePaginationBar } from "@/frontend/views/admin/finances/AdminFinancePaginationBar";
import { WalletLedgerSkeletonKeys } from "@/frontend/views/admin/finances/adminFinanceSkeletonKeys";
import { WalletLedgerTableRow } from "@/frontend/views/admin/finances/WalletLedgerTableRow";
import type { AdminFinanceLabels } from "@/shared/locale/types/adminFinance";

interface WalletLedgerTableCardProps {
  readonly transactions: readonly AdminTeacherWalletQuery_adminTeacherWallet_transactions[];
  readonly loading: boolean;
  readonly locale: string;
  readonly labels: AdminFinanceLabels;
  readonly page: number;
  readonly pageSize: number;
  readonly totalCount: number;
  readonly onPageChange: (page: number) => void;
}

/** Desktop (≥md) transaction ledger table card — the hand-rolled MUI table. */
export function WalletLedgerTableCard({
  transactions,
  loading,
  locale,
  labels,
  page,
  pageSize,
  totalCount,
  onPageChange,
}: Readonly<WalletLedgerTableCardProps>): ReactNode {
  return (
    <Card sx={directoryTableCardSx()}>
      <Table sx={{ tableLayout: "fixed" }} size="small" aria-label={labels.typeHeader}>
        <TableHead>
          <TableRow sx={theme => ({ bgcolor: theme.palette.surfaceContainerHigh })}>
            <DirectoryHeaderCell width="13%">{labels.typeHeader}</DirectoryHeaderCell>
            <DirectoryHeaderCell width="14%">{labels.statusHeader}</DirectoryHeaderCell>
            <DirectoryHeaderCell width="15%" align="end">
              {labels.amountHeader}
            </DirectoryHeaderCell>
            <DirectoryHeaderCell width="40%">{labels.descriptionHeader}</DirectoryHeaderCell>
            <DirectoryHeaderCell width="18%" align="end">
              {labels.dateHeader}
            </DirectoryHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody aria-label={loading && transactions.length === 0 ? labels.loadingLabel : undefined}>
          {loading && transactions.length === 0
            ? WalletLedgerSkeletonKeys.map(rowKey => (
                <TableRow key={rowKey}>
                  <TableCell colSpan={5} sx={theme => ({ borderBottom: `1px solid ${theme.palette.border.light}` })}>
                    <Skeleton variant="text" />
                  </TableCell>
                </TableRow>
              ))
            : null}
          {!loading && transactions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} sx={{ borderBottom: 0 }}>
                <Stack spacing={1} sx={{ alignItems: "center", py: 6 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    {labels.inspectorEmpty}
                  </Typography>
                </Stack>
              </TableCell>
            </TableRow>
          ) : null}
          {transactions.map((tx, index) => (
            <WalletLedgerTableRow key={tx.id} tx={tx} index={index} locale={locale} labels={labels} />
          ))}
        </TableBody>
      </Table>
      <Stack
        direction="row"
        sx={theme => ({
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 2,
          flexWrap: "wrap",
          py: 2,
          px: 2.5,
          borderTop: `1px solid ${theme.palette.border.light}`,
        })}
      >
        <AdminFinancePaginationBar
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          onPageChange={onPageChange}
        />
      </Stack>
    </Card>
  );
}
