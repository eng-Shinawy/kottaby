/**
 * Wallet ledger visual vocabulary — the pure type→presentation maps for
 * the transaction ledger (icons, chips, tones, labels). Extracted verbatim
 * from `TeacherWalletContainer` (the max-lines split). Every switch is
 * exhaustive over the wire enum with a `never` guard.
 */

import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import ArrowOutwardOutlinedIcon from "@mui/icons-material/ArrowOutwardOutlined";
import CardGiftcardOutlinedIcon from "@mui/icons-material/CardGiftcardOutlined";
import type { Palette } from "@mui/material/styles";
import {
  type MyWalletQuery_myWallet_transactions,
  TransactionStatus as WireTransactionStatus,
  TransactionType as WireTransactionType,
} from "@/frontend/graphql/generated/gql/graphql";
import type { WalletLabels } from "@/shared/locale/types/wallet";

/** Ledger row visual vocabulary — type → (icon, tinted avatar colors). */
export function ledgerRowVisual(type: MyWalletQuery_myWallet_transactions["type"]): {
  readonly Icon: typeof AddCircleOutlineOutlinedIcon;
  readonly color: "success" | "error" | "info";
} {
  switch (type) {
    case WireTransactionType.Earning:
      return { Icon: AddCircleOutlineOutlinedIcon, color: "success" };
    case WireTransactionType.Withdrawal:
      return { Icon: ArrowOutwardOutlinedIcon, color: "error" };
    case WireTransactionType.Bonus:
      return { Icon: CardGiftcardOutlinedIcon, color: "info" };
  }
  const exhaustive: never = type;
  throw new Error(`Unexpected transaction type: ${String(exhaustive)}`);
}

/** Ledger status chip color vocabulary. */
export function ledgerStatusColor(
  status: MyWalletQuery_myWallet_transactions["status"]
): "warning" | "success" | "error" {
  switch (status) {
    case WireTransactionStatus.Pending:
      return "warning";
    case WireTransactionStatus.Completed:
      return "success";
    case WireTransactionStatus.Failed:
      return "error";
  }
  const exhaustive: never = status;
  throw new Error(`Unexpected transaction status: ${String(exhaustive)}`);
}

/** Signed ledger amount — a string PREFIX for display only (never math). */
export function signedAmount(row: MyWalletQuery_myWallet_transactions): string {
  return row.type === WireTransactionType.Withdrawal ? `-${row.amount}` : `+${row.amount}`;
}

/**
 * Amount color tone — the MUI palette token per ledger type (ProfileView
 * palette-callback pattern). Exhaustive switch, no nested ternaries.
 */
export function amountTone(type: MyWalletQuery_myWallet_transactions["type"], palette: Palette): string {
  switch (type) {
    case WireTransactionType.Earning:
      return palette.success.main;
    case WireTransactionType.Withdrawal:
      return palette.error.main;
    case WireTransactionType.Bonus:
      return palette.info.main;
  }
  const exhaustive: never = type;
  throw new Error(`Unexpected transaction type: ${String(exhaustive)}`);
}

/**
 * Ledger avatar tone — the Material 3 container/on-container pair per
 * ledger type (ProfileView pattern). Exhaustive switch.
 */
export function avatarTone(
  type: MyWalletQuery_myWallet_transactions["type"],
  palette: Palette
): { readonly bgcolor: string; readonly color: string } {
  switch (type) {
    case WireTransactionType.Earning:
      return { bgcolor: palette.secondaryContainer, color: palette.onSecondaryContainer };
    case WireTransactionType.Withdrawal:
      return { bgcolor: palette.errorContainer, color: palette.onErrorContainer };
    case WireTransactionType.Bonus:
      return { bgcolor: palette.surfaceContainerHighest, color: palette.onSurfaceVariant };
  }
  const exhaustive: never = type;
  throw new Error(`Unexpected transaction type: ${String(exhaustive)}`);
}

/** Ledger type label — exhaustive over the wire enum via the labels map. */
export function ledgerTypeLabel(type: MyWalletQuery_myWallet_transactions["type"], t: WalletLabels): string {
  switch (type) {
    case WireTransactionType.Earning:
      return t.typeEarning;
    case WireTransactionType.Withdrawal:
      return t.typeWithdrawal;
    case WireTransactionType.Bonus:
      return t.typeBonus;
  }
  const exhaustive: never = type;
  throw new Error(`Unexpected transaction type: ${String(exhaustive)}`);
}

/** Ledger status label — exhaustive over the wire enum via the labels map. */
export function ledgerStatusLabel(status: MyWalletQuery_myWallet_transactions["status"], t: WalletLabels): string {
  switch (status) {
    case WireTransactionStatus.Pending:
      return t.statusPending;
    case WireTransactionStatus.Completed:
      return t.statusCompleted;
    case WireTransactionStatus.Failed:
      return t.statusFailed;
  }
  const exhaustive: never = status;
  throw new Error(`Unexpected transaction status: ${String(exhaustive)}`);
}
