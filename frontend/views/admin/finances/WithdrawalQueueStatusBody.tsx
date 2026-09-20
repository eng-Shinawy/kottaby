"use client";

/**
 * WithdrawalQueueStatusBody — the queue's status body of the withdrawal
 * payout queue panel (`/admin/finances`, withdrawals tab), extracted from
 * the original monolithic panel as a focused sibling component: the
 * FORBIDDEN denied-notice alert, the shared retry alert on a failed query,
 * or the desktop table + mobile cards with pagination. The denied alert +
 * pending-total strip live in `WithdrawalQueueBanners` (the function-size
 * split).
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, theme-palette colors.
 */

import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { ErrorRetryAlert } from "@/frontend/components/ui/ErrorRetryAlert";
import type { AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items } from "@/frontend/graphql/generated/gql/graphql";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode } from "@/frontend/providers/apollo/error-link.map";
import { formatMoneyAmount } from "@/frontend/views/admin/analytics/platform-analytics-display";
import { AdminFinancePaginationBar } from "@/frontend/views/admin/finances/AdminFinancePaginationBar";
import type { useAdminPendingWithdrawals } from "@/frontend/views/admin/finances/useAdminFinanceQueries";
import {
  WithdrawalDeniedAlert,
  WithdrawalPendingTotalStrip,
} from "@/frontend/views/admin/finances/WithdrawalQueueBanners";
import { WithdrawalMobileCards } from "@/frontend/views/admin/finances/WithdrawalQueueCards";
import { WithdrawalTableCard } from "@/frontend/views/admin/finances/WithdrawalQueueTableCard";
import { Common, useAppTranslation } from "@/shared/locale";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";

/**
 * The queue's status body: the FORBIDDEN denied-notice alert, the shared
 * retry alert on a failed query, or the desktop table + mobile cards with
 * pagination.
 */
export function WithdrawalQueueStatusBody({
  queue,
  locale,
  onApprove,
  onReject,
}: Readonly<{
  queue: ReturnType<typeof useAdminPendingWithdrawals>;
  locale: string;
  onApprove: (item: AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items) => void;
  onReject: (item: AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items) => void;
}>): ReactNode {
  const t = useAppTranslation(AdminFinance);
  const tc = useAppTranslation(Common);
  const handlePageChange = (nextPage: number): void => {
    queue.setPage(nextPage);
  };
  const errorCode = queue.error ? extractErrorCode(queue.error) : null;
  const denied =
    errorCode !== null &&
    mapGraphQLErrorByCode(errorCode, { contextKind: "query", hasForm: false })?.kind === "permission-fallback";

  // The queue's pending payout total — aggregated SERVER-SIDE over the same
  // predicate as the rows (page-size independent since the round-4 feature:
  // the client previously summed only the current page, which the
  // financial-copy honesty rule then had to hide for multi-page queues).
  // Rendered while the queue holds at least one pending payout.
  const pendingTotal = queue.totalCount > 0 ? formatMoneyAmount(queue.totalAmount) : null;

  if (denied) {
    return <WithdrawalDeniedAlert title={t.forbiddenTitle} body={t.forbiddenBody} />;
  }
  if (queue.hasError) {
    return (
      <ErrorRetryAlert
        title={t.errorTitle}
        retryLabel={tc.retry}
        retryPending={queue.loading}
        onRetry={() => {
          void queue.refetch();
        }}
      >
        <Typography variant="body2" component="p">
          {errorCode === null ? "" : `(${errorCode})`}
        </Typography>
      </ErrorRetryAlert>
    );
  }
  return (
    <>
      {pendingTotal !== null ? <WithdrawalPendingTotalStrip total={pendingTotal} /> : null}
      {/* Desktop (≥md): the hand-rolled queue table card. */}
      <Box sx={{ display: { xs: "none", md: "block" } }}>
        <WithdrawalTableCard
          items={queue.items}
          loading={queue.loading}
          locale={locale}
          totalCount={queue.totalCount}
          page={queue.page}
          pageSize={queue.pageSize}
          onPageChange={handlePageChange}
          onApprove={onApprove}
          onReject={onReject}
        />
      </Box>
      {/* Mobile (<md): per-request cards + pagination. */}
      <Box sx={{ display: { xs: "block", md: "none" } }}>
        <WithdrawalMobileCards
          items={queue.items}
          loading={queue.loading}
          locale={locale}
          onApprove={onApprove}
          onReject={onReject}
        />
        {/*
          The pagination stack mounts only with rows — an empty queue would
          otherwise draw the hairline + a dead bar under the empty state (the
          bar itself renders null at totalCount 0; this drops the chrome too).
        */}
        {queue.totalCount > 0 ? (
          <Stack
            direction="row"
            sx={theme => ({
              justifyContent: "flex-end",
              mt: 2,
              pt: 2,
              borderTop: `1px solid ${theme.palette.border.light}`,
            })}
          >
            <AdminFinancePaginationBar
              page={queue.page}
              pageSize={queue.pageSize}
              totalCount={queue.totalCount}
              onPageChange={handlePageChange}
            />
          </Stack>
        ) : null}
      </Box>
    </>
  );
}
