"use client";

/**
 * WalletTransactionsTable — the picked teacher's paginated transaction
 * ledger (desktop table + mobile cards), extracted from the original
 * monolithic table as a focused composition component: the desktop table
 * card ({@link WalletLedgerTableCard}) over the mobile (<`md`)
 * per-transaction card stack. Loading renders stable-key skeleton
 * rows/cards; a zero page renders the inspector's empty state; rows render
 * from the wire only.
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, theme-palette colors.
 */

import { Box, Card, Stack, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { AdminTeacherWalletQuery_adminTeacherWallet_transactions } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate, formatLedgerStamp } from "@/frontend/lib/i18n/format-date";
import { formatMoneyAmount } from "@/frontend/views/admin/analytics/platform-analytics-display";
import { directoryPanelCardSx, directorySkeletonCardSx } from "@/frontend/views/admin/directory-shared/directory-skins";
import { WalletLedgerSkeletonKeys } from "@/frontend/views/admin/finances/adminFinanceSkeletonKeys";
import { WalletLedgerTableCard } from "@/frontend/views/admin/finances/WalletLedgerTableCard";
import {
  ledgerStatusLabel,
  ledgerStatusTone,
  ledgerTypeLabel,
  ledgerTypeTone,
} from "@/frontend/views/admin/finances/walletLedgerDisplay";
import { TonalChip } from "@/frontend/views/admin/users/ui";
import type { AdminFinanceLabels } from "@/shared/locale/types/adminFinance";

interface WalletTransactionsTableProps {
  readonly transactions: readonly AdminTeacherWalletQuery_adminTeacherWallet_transactions[];
  readonly loading: boolean;
  readonly locale: string;
  readonly labels: AdminFinanceLabels;
  /** The current 0-based page index (the hook's own `page` state). */
  readonly page: number;
  /** The page-window size (the hook's own `pageSize`). */
  readonly pageSize: number;
  /** The total ledger row count from the query data. */
  readonly totalCount: number;
  /** The 0-based page setter (the hook's own `setPage`). */
  readonly onPageChange: (page: number) => void;
}

/** Mobile transaction-card skin — the panel card with inner padding so the chip row insets. */
const mobileCardSx = (theme: Theme) => ({ ...directoryPanelCardSx()(theme), p: 2 });

/** The picked teacher's transaction ledger (desktop table + mobile cards). */
export function WalletTransactionsTable({
  transactions,
  loading,
  locale,
  labels,
  page,
  pageSize,
  totalCount,
  onPageChange,
}: Readonly<WalletTransactionsTableProps>): ReactNode {
  const empty = (
    <Stack spacing={1} sx={{ alignItems: "center", py: 6 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
        {labels.inspectorEmpty}
      </Typography>
    </Stack>
  );

  return (
    <>
      {/* Desktop (≥md): the hand-rolled ledger table card. */}
      <Box sx={{ display: { xs: "none", md: "block" } }}>
        <WalletLedgerTableCard
          transactions={transactions}
          loading={loading}
          locale={locale}
          labels={labels}
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          onPageChange={onPageChange}
        />
      </Box>
      {/* Mobile (<md): per-transaction cards. */}
      <Box sx={{ display: { xs: "block", md: "none" } }}>
        <Stack spacing={2}>
          {loading && transactions.length === 0
            ? WalletLedgerSkeletonKeys.slice(0, 4).map(rowKey => <Card key={rowKey} sx={directorySkeletonCardSx()} />)
            : null}
          {!loading && transactions.length === 0 ? <Card sx={directoryPanelCardSx()}>{empty}</Card> : null}
          {transactions.map(tx => (
            <Card key={tx.id} sx={mobileCardSx}>
              <Stack spacing={1}>
                <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                  <TonalChip outlined tone={ledgerTypeTone(tx.type)} label={ledgerTypeLabel(tx.type, labels)} />
                  <TonalChip tone={ledgerStatusTone(tx.status)} label={ledgerStatusLabel(tx.status, labels)} />
                </Stack>
                <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                  <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
                    {labels.amountHeader}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {formatMoneyAmount(tx.amount)}
                  </Typography>
                </Stack>
                {/* Description: full-width line under its label — long values
                    right-aligned wrap ragged-left and lose scanability. */}
                <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
                  {labels.descriptionHeader}
                </Typography>
                <Typography variant="body2">{tx.description}</Typography>
                <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                  <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
                    {labels.dateHeader}
                  </Typography>
                  <Typography
                    variant="body2"
                    dir="ltr"
                    title={formatApplicantDate(tx.createdAt, locale)}
                    sx={{
                      // Isolated LTR box + pure-ASCII stamp — same bidi pin as
                      // the desktop ledger table (the locale-aware full stamp
                      // rides the native tooltip).
                      unicodeBidi: "isolate",
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                      cursor: "default",
                    }}
                  >
                    {formatLedgerStamp(tx.createdAt)}
                  </Typography>
                </Stack>
              </Stack>
            </Card>
          ))}
        </Stack>
      </Box>
    </>
  );
}
