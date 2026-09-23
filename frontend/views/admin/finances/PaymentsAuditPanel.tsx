"use client";

/**
 * PaymentsAuditPanel — the payments-audit tab of the admin financial
 * auditing console (`/admin/finances`): the filter bar over the paginated
 * payments table.
 *
 * The panel composes its extracted focused siblings — the desktop table
 * card ({@link PaymentsTableCard}), the row / mobile-card pieces
 * ({@link PaymentsTableRows}), and the label mappings
 * ({@link paymentStatusDisplay}) — and owns the body switching: the
 * desktop (≥`md`) hand-rolled MUI `Table` card and the mobile (<`md`)
 * per-payment card stack on the shared `DirectoryMobileCardList`.
 *
 * Loading renders stable-key skeleton rows/cards; a zero page renders the
 * empty state (the `paymentsEmpty` copy — filters explain a bare page);
 * a failed query renders the shared retry alert (the stale page stays
 * visible beside it when one exists); a FORBIDDEN denial renders the
 * shared denied-notice fallback.
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, theme-palette colors, `*Outlined` icons.
 */

import { Alert, AlertTitle, Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { ErrorRetryAlert } from "@/frontend/components/ui/ErrorRetryAlert";
import type { AdminStudentPaymentsQuery_adminStudentPayments_items } from "@/frontend/graphql/generated/gql/graphql";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode } from "@/frontend/providers/apollo/error-link.map";
import { DirectoryMobileCardList } from "@/frontend/views/admin/directory-shared/DirectoryMobileCardList";
import { PAYMENTS_SKELETON_KEYS } from "@/frontend/views/admin/finances/adminFinanceSkeletonKeys";
import { PaymentsFilterBar } from "@/frontend/views/admin/finances/PaymentsFilterBar";
import { PaymentsTableCard } from "@/frontend/views/admin/finances/PaymentsTableCard";
import { PaymentMobileCard, PaymentsEmptyState } from "@/frontend/views/admin/finances/PaymentsTableRows";
import {
  type AppliedPaymentFilters,
  useAdminStudentPayments,
} from "@/frontend/views/admin/finances/useAdminFinanceQueries";
import { Common, useAppLocale, useAppTranslation } from "@/shared/locale";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";

/**
 * The payments audit panel: filter bar over the swapping body — loading
 * skeleton / denial / retryable error / empty / rows + pagination.
 */
export function PaymentsAuditPanel(): ReactNode {
  const t = useAppTranslation(AdminFinance);
  const tc = useAppTranslation(Common);
  const locale = useAppLocale();
  const payments = useAdminStudentPayments();

  const handleApply = (applied: AppliedPaymentFilters): void => {
    payments.applyFilters(applied);
  };

  const handleReset = (): void => {
    payments.resetFilters();
  };

  // Query-context denial classification — FORBIDDEN maps to the shared
  // denied notice; every other code falls to the generic retry alert.
  const errorCode = payments.error ? extractErrorCode(payments.error) : null;
  const denied =
    errorCode !== null &&
    mapGraphQLErrorByCode(errorCode, { contextKind: "query", hasForm: false })?.kind === "permission-fallback";

  const handlePageChange = (nextPage: number): void => {
    payments.setPage(nextPage);
  };

  const mobileList = (
    <DirectoryMobileCardList
      loading={payments.loading}
      loadingLabel={t.loadingLabel}
      skeletonKeys={PAYMENTS_SKELETON_KEYS}
      empty={<PaymentsEmptyState emptyCopy={t.paymentsEmpty} />}
      cards={payments.items.map((payment: AdminStudentPaymentsQuery_adminStudentPayments_items) => (
        <PaymentMobileCard
          key={payment.id}
          payment={payment}
          locale={locale}
          labels={{ amountHeader: t.amountHeader, gatewayHeader: t.gatewayHeader, dateHeader: t.dateHeader }}
          namespace={t}
        />
      ))}
    />
  );

  // Statements, not a nested ternary — denial / error / settled results.
  let body: ReactNode;
  if (denied) {
    body = (
      <Alert
        severity="error"
        variant="outlined"
        sx={{ borderRadius: "12px" }}
        data-testid="admin-finances-payments-denied"
      >
        <AlertTitle sx={{ fontWeight: 700 }}>{t.forbiddenTitle}</AlertTitle>
        <Typography variant="body2" component="p">
          {t.forbiddenBody}
        </Typography>
      </Alert>
    );
  } else if (payments.hasError) {
    body = (
      <ErrorRetryAlert
        title={t.errorTitle}
        retryLabel={tc.retry}
        retryPending={payments.loading}
        onRetry={() => {
          void payments.refetch();
        }}
      >
        <Typography variant="body2" component="p">
          {errorCode === null ? "" : `(${errorCode})`}
        </Typography>
      </ErrorRetryAlert>
    );
  } else {
    body = (
      <>
        {/* Desktop (≥md): the hand-rolled table card. */}
        <Box sx={{ display: { xs: "none", md: "block" } }}>
          <PaymentsTableCard
            items={payments.items}
            loading={payments.loading}
            locale={locale}
            labels={t}
            namespace={t}
            page={payments.page}
            pageSize={payments.pageSize}
            totalCount={payments.totalCount}
            onPageChange={handlePageChange}
          />
        </Box>
        {/* Mobile (<md): the per-payment card stack. */}
        <Box sx={{ display: { xs: "block", md: "none" } }}>{mobileList}</Box>
      </>
    );
  }

  return (
    <Stack spacing={3} data-testid="admin-finances-payments-panel">
      <PaymentsFilterBar onApply={handleApply} onReset={handleReset} />
      {body}
    </Stack>
  );
}
