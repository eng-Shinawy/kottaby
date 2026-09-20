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
import type { WalletLedgerPagingState } from "@/frontend/views/teacher/wallet/useWalletLedgerPaging";
import { WalletLedger } from "@/frontend/views/teacher/wallet/WalletLedger";
import { Errors, useAppTranslation } from "@/shared/locale";
import type { WalletLabels } from "@/shared/locale/types/wallet";

export interface WalletBodyProps {
  readonly loading: boolean;
  readonly error: unknown;
  readonly data: MyWalletQuery | undefined;
  readonly locale: string;
  readonly t: WalletLabels;
  /** The ledger pagination state (merged rows + "load more" controls). */
  readonly paging: WalletLedgerPagingState;
}

/** Typed code the wallet service throws for a pre-approval teacher (no profile row → no wallet). */
const WALLET_TEACHER_PROFILE_MISSING = "WALLET_TEACHER_PROFILE_MISSING";

/** The swapping body BELOW the chrome — see the module docblock. */
export function WalletBody({ loading, error, data, locale, t, paging }: Readonly<WalletBodyProps>): ReactNode {
  // Pending-teacher body copy comes from the `errors` namespace (REQ-055):
  // the GraphQL `WALLET_TEACHER_PROFILE_MISSING` transport message and the UI
  // empty-state body are the SAME string, so they can never drift.
  const te = useAppTranslation(Errors);
  if ((loading && data === undefined) || paging.loading) {
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
    // Pending-teacher honest state FIRST — the typed deny is not a permission
    // failure to punish, it is a lifecycle stage: the wallet page renders a
    // calm "activates once approved" empty state instead of the red
    // permission fallback (QA finding: the generic denial read as a bug).
    if (code === WALLET_TEACHER_PROFILE_MISSING) {
      return (
        <SessionsEmptyState
          testId="wallet-pending-teacher"
          icon={AccountBalanceWalletOutlinedIcon}
          title={t.pendingTeacherTitle}
          body={te.walletTeacherProfileMissing}
        />
      );
    }
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
  // The ledger is its own paginated read — if its first page failed with
  // nothing to show, render the honest error notice instead of fabricating
  // an empty history.
  if (paging.errored) {
    return (
      <Alert data-testid="wallet-error-notice" severity="error" variant="outlined" sx={{ borderRadius: 2 }}>
        {t.genericError}
      </Alert>
    );
  }
  const transactions = paging.rows;
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
  return <WalletLedger transactions={transactions} locale={locale} t={t} paging={paging} />;
}
