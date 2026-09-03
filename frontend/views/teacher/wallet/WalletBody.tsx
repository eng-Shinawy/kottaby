"use client";

/**
 * WalletBody — the swapping body BELOW the chrome — skeleton / permission
 * fallback / error notice / ledger list. Pure presentational resolver,
 * extracted verbatim from `TeacherWalletContainer` (the max-lines split;
 * the ledger list itself lives in `WalletLedger.tsx`).
 */

import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import { Alert, Skeleton, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { PermissionDeniedFallback } from "@/frontend/components/ui/PermissionDeniedFallback";
import type { MyWalletQuery } from "@/frontend/graphql/generated/gql/graphql";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { mapGraphQLErrorByCode, normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import { SessionsEmptyState } from "@/frontend/views/student/sessions/SessionsEmptyState";
import { WalletLedger } from "@/frontend/views/teacher/wallet/WalletLedger";
import type { WalletLabels } from "@/shared/locale/types/wallet";

export interface WalletBodyProps {
  readonly loading: boolean;
  readonly error: unknown;
  readonly data: MyWalletQuery | undefined;
  readonly locale: string;
  readonly t: WalletLabels;
}

/** The swapping body BELOW the chrome — see the module docblock. */
export function WalletBody({ loading, error, data, locale, t }: Readonly<WalletBodyProps>): ReactNode {
  if (loading && data === undefined) {
    return (
      <Stack spacing={1.5} data-testid="wallet-loading-skeleton">
        {[0, 1, 2].map(index => (
          <Skeleton key={index} variant="rounded" height={64} />
        ))}
      </Stack>
    );
  }
  if (error !== undefined) {
    const rawCode = extractErrorCode(error);
    const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);
    const action = mapGraphQLErrorByCode(code, { contextKind: "query", hasForm: false });
    if (action?.kind === "permission-fallback" || action?.kind === "auth-recovery") {
      return <PermissionDeniedFallback />;
    }
    return (
      <Alert data-testid="wallet-error-notice" severity="error" variant="outlined" sx={{ borderRadius: 2 }}>
        {t.genericError}
      </Alert>
    );
  }
  if (data === undefined) {
    return null;
  }
  const transactions = data.myWallet.transactions;
  if (transactions.length === 0) {
    return (
      <SessionsEmptyState
        testId="wallet-ledger-empty"
        icon={AccountBalanceWalletOutlinedIcon}
        title={t.ledgerEmptyTitle}
        body={t.ledgerEmptyBody}
      />
    );
  }
  return <WalletLedger transactions={transactions} locale={locale} t={t} />;
}
