"use client";

/**
 * TeacherWalletContainer — the teacher's self-service wallet surface
 * (DEV3-013, R-306): the balance header, the withdrawal-request dialog,
 * and the newest-first transaction ledger.
 *
 * Data flow (mirrors the sessions containers):
 *  - `myWallet` useQuery — the always-on read; the wallet row is ensured
 *    server-side so a brand-new teacher renders an honest zeroed wallet.
 *  - `requestWithdrawal` useMutation — the payout write (owned by
 *    `useTeacherWalletWithdraw`); the returned `Wallet!` payload carries
 *    `id` FIRST, so Apollo normalizes the post-debit balance + refreshed
 *    ledger onto `Wallet:<id>` WITHOUT a refetch.
 *  - Error arms map the typed `extensions.code` vocabulary: the
 *    `WALLET_INSUFFICIENT_FUNDS` conflict and the `WALLET_INVALID_AMOUNT`
 *    validation keep the dialog OPEN for a retry (with the in-dialog
 *    alert), while permission/identity classes fall through to the shared
 *    `mapGraphQLErrorByCode` fallbacks.
 *
 * Money discipline: amounts are decimal STRINGS rendered verbatim — no
 * numeric parse, no arithmetic. The signed ledger amount is a string
 * PREFIX (`+` / `-`) concatenated for display only. The client-side
 * amount validation is a UX-only MIRROR of the server's R-303 matrix
 * (same grammar, same positivity rule) — the server remains the sole
 * authority; the mirror only spares an obvious round-trip.
 *
 * i18n: `useAppTranslation(Wallet | Errors | Common)` property access ONLY.
 * Feedback surfaces use plain MUI `Snackbar`/`Alert` (no notistack).
 * All interactive elements are ≥44px touch targets and RTL-safe (no
 * directional margins — Stack gaps only).
 *
 * File layout (the max-lines split): constants + amount rules in
 * `teacherWalletShared.ts`; the ledger visual maps in
 * `walletLedgerVisuals.ts`; the balance card in `WalletBalanceCard.tsx`;
 * the swapping body in `WalletBody.tsx` (ledger list in `WalletLedger.tsx`);
 * the dialog in `WithdrawDialog.tsx`; the write path in
 * `useTeacherWalletWithdraw.ts`. This file is the composition root.
 */

import { useQuery } from "@apollo/client/react";
import AccountBalanceWalletOutlinedIcon from "@mui/icons-material/AccountBalanceWalletOutlined";
import SavingsOutlinedIcon from "@mui/icons-material/SavingsOutlined";
import { Alert, Button, Snackbar, Stack } from "@mui/material";
import { type ReactNode, useCallback, useState } from "react";
import { myWalletQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { type ContainerNotice, SNACKBAR_AUTOHIDE_MS } from "@/frontend/views/teacher/wallet/teacherWalletShared";
import { useTeacherWalletWithdraw } from "@/frontend/views/teacher/wallet/useTeacherWalletWithdraw";
import { WalletBalanceCard } from "@/frontend/views/teacher/wallet/WalletBalanceCard";
import { WalletBody } from "@/frontend/views/teacher/wallet/WalletBody";
import { WithdrawDialog } from "@/frontend/views/teacher/wallet/WithdrawDialog";
import { Common, useAppLocale, useAppTranslation, Wallet } from "@/shared/locale";

/**
 * The wallet view: ALWAYS-ON chrome (title + balance cards) over a
 * swapping body — skeleton / permission fallback / error notice / ledger
 * — plus the withdrawal dialog and the snackbar chrome.
 */
export function TeacherWalletContainer(): ReactNode {
  const t = useAppTranslation(Wallet);
  const tc = useAppTranslation(Common);
  const locale = useAppLocale();

  const [notice, setNotice] = useState<ContainerNotice | null>(null);

  const dismissNotice = useCallback((): void => {
    setNotice(null);
  }, []);

  const { data, loading, error } = useQuery(myWalletQueryDocument);

  const withdraw = useTeacherWalletWithdraw({ setNotice });

  const walletRow = data?.myWallet;

  return (
    <Stack data-testid="wallet-page" spacing={3} sx={{ p: { xs: 2, sm: 3 }, width: "100%" }}>
      {/* ── Balance header ─────────────────────────────────────────────── */}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: "stretch" }}>
        <WalletBalanceCard
          testId="wallet-balance-card"
          label={t.balanceLabel}
          value={walletRow?.balance}
          currency={walletRow?.currency}
          loading={loading && walletRow === undefined}
          icon={<AccountBalanceWalletOutlinedIcon fontSize="small" />}
        />
        <WalletBalanceCard
          testId="wallet-earning-card"
          label={t.totalEarningLabel}
          value={walletRow?.totalEarning}
          currency={walletRow?.currency}
          loading={loading && walletRow === undefined}
          icon={<SavingsOutlinedIcon fontSize="small" />}
        />
      </Stack>

      {/* ── Primary CTA ────────────────────────────────────────────────── */}
      <Button
        data-testid="wallet-request-withdrawal"
        variant="contained"
        size="large"
        onClick={withdraw.openDialog}
        disabled={loading || error !== undefined || walletRow === undefined}
        startIcon={<AccountBalanceWalletOutlinedIcon />}
        sx={{ alignSelf: "flex-start", minHeight: 44, px: 3 }}
      >
        {t.requestWithdrawal}
      </Button>

      {/* ── Swapping body ──────────────────────────────────────────────── */}
      <WalletBody error={error} loading={loading} data={data} locale={locale} t={t} />

      {/* ── Withdrawal dialog (single slot) ────────────────────────────── */}
      {withdraw.withdrawDialogOpen && walletRow !== undefined ? (
        <WithdrawDialog
          open={withdraw.withdrawDialogOpen}
          balance={walletRow.balance}
          inFlight={withdraw.inFlight}
          onClose={withdraw.closeDialog}
          onSubmit={withdraw.handleWithdraw}
          t={t}
          tc={tc}
        />
      ) : null}

      {/* ── Snackbar chrome ────────────────────────────────────────────── */}
      <Snackbar
        open={notice !== null}
        autoHideDuration={SNACKBAR_AUTOHIDE_MS}
        onClose={dismissNotice}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {notice === null ? undefined : (
          <Alert onClose={dismissNotice} severity={notice.severity} variant="filled">
            {notice.message}
          </Alert>
        )}
      </Snackbar>
    </Stack>
  );
}
