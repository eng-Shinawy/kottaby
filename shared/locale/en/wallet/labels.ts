import type { WalletLabels } from "@/shared/locale/types/wallet";

export const walletEn: WalletLabels = {
  pageTitle: "My Wallet",
  balanceLabel: "Available balance",
  totalEarningLabel: "Lifetime earnings",
  requestWithdrawal: "Request withdrawal",
  withdrawDialogTitle: "Request a withdrawal",
  withdrawDialogBody:
    "The amount is debited from your balance immediately and recorded as a pending payout until it is settled.",
  amountLabel: "Amount (EGP)",
  amountPlaceholder: "e.g. 250.00",
  availableBalanceHint: (balance: string) => `Available balance: ${balance} EGP`,
  withdrawSubmit: "Submit request",
  withdrawSuccessNotice: "Withdrawal request submitted. Your balance has been updated.",
  invalidAmount: "Enter a valid amount (a positive value with up to 2 decimal places).",
  genericError: "Something went wrong. Please try again.",
  ledgerTitle: "Transaction history",
  typeEarning: "Earning",
  typeWithdrawal: "Withdrawal",
  typeBonus: "Bonus",
  statusPending: "Pending",
  statusCompleted: "Completed",
  statusFailed: "Failed",
  createdAt: "Date",
  ledgerEmptyTitle: "No transactions yet",
  ledgerEmptyBody: "Your session earnings and payout requests will appear here.",
};
