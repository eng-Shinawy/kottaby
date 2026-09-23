"use client";

/**
 * WithdrawalQueueTableCard — the desktop (≥`md`) withdrawal-queue table
 * card of the admin financial auditing console (`/admin/finances`,
 * withdrawals tab), extracted from the original monolithic panel as a
 * focused sibling component: the hand-rolled MUI table over the shared
 * header cell + footer atoms.
 *
 * Queue columns: teacher, amount (the requester's reserved wallet balance
 * at read time), requested-at timestamp, the row's status chip, and the
 * settle actions. Loading renders stable-key skeleton rows; a zero queue
 * renders the empty state (`withdrawalsEmpty`).
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, theme-palette colors, `*Outlined` icons.
 */

import { PendingActionsOutlined as EmptyIcon } from "@mui/icons-material";
import { Card, Skeleton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items } from "@/frontend/graphql/generated/gql/graphql";
import { DirectoryHeaderCell } from "@/frontend/views/admin/directory-shared/DirectoryHeaderCell";
import { directoryTableCardSx } from "@/frontend/views/admin/directory-shared/directory-skins";
import { WITHDRAWALS_SKELETON_KEYS } from "@/frontend/views/admin/finances/adminFinanceSkeletonKeys";
import { FinanceTableFooter } from "@/frontend/views/admin/finances/FinanceTableFooter";
import { WithdrawalRow } from "@/frontend/views/admin/finances/WithdrawalQueueRows";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";

/** Desktop (≥md) withdrawal-queue table card — the hand-rolled MUI table. */
export function WithdrawalTableCard({
  items,
  loading,
  locale,
  totalCount,
  page,
  pageSize,
  onPageChange,
  onApprove,
  onReject,
}: Readonly<{
  items: readonly AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items[];
  loading: boolean;
  locale: string;
  totalCount: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onApprove: (item: AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items) => void;
  onReject: (item: AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items) => void;
}>): ReactNode {
  const t = useAppTranslation(AdminFinance);
  return (
    <Card sx={directoryTableCardSx()}>
      <Table sx={{ tableLayout: "fixed" }} aria-label={t.withdrawalsTab}>
        <TableHead>
          <TableRow sx={theme => ({ bgcolor: theme.palette.surfaceContainerHigh })}>
            <DirectoryHeaderCell width="22%">{t.teacherHeader}</DirectoryHeaderCell>
            <DirectoryHeaderCell width="15%" align="end">
              {t.amountHeader}
            </DirectoryHeaderCell>
            <DirectoryHeaderCell width="15%" align="end">
              {t.walletBalanceHeader}
            </DirectoryHeaderCell>
            <DirectoryHeaderCell width="15%">{t.requestedAtHeader}</DirectoryHeaderCell>
            <DirectoryHeaderCell width="13%">{t.statusHeader}</DirectoryHeaderCell>
            <DirectoryHeaderCell width="20%">{t.actionsHeader}</DirectoryHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody aria-label={loading && items.length === 0 ? t.loadingLabel : undefined}>
          {loading && items.length === 0
            ? WITHDRAWALS_SKELETON_KEYS.map(rowKey => (
                <TableRow key={rowKey}>
                  <TableCell colSpan={6} sx={theme => ({ borderBottom: `1px solid ${theme.palette.border.light}` })}>
                    <Skeleton variant="text" />
                  </TableCell>
                </TableRow>
              ))
            : null}
          {!loading && items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} sx={{ borderBottom: 0 }}>
                <Stack spacing={1} sx={{ alignItems: "center", py: 6 }}>
                  <EmptyIcon sx={theme => ({ fontSize: 48, color: theme.palette.text.secondary })} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    {t.withdrawalsEmpty}
                  </Typography>
                </Stack>
              </TableCell>
            </TableRow>
          ) : null}
          {items.map((item, index) => (
            <WithdrawalRow
              key={item.transaction.id}
              item={item}
              locale={locale}
              striped={index % 2 === 1}
              onApprove={onApprove}
              onReject={onReject}
            />
          ))}
        </TableBody>
      </Table>
      <FinanceTableFooter
        countLine={t.pendingWithdrawalsCount(totalCount)}
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={onPageChange}
      />
    </Card>
  );
}
