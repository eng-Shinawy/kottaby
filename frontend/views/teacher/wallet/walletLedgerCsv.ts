"use client";

/**
 * Ledger CSV export — turns the teacher's fetched ledger page into a
 * spreadsheet file, entirely client-side (no wire surface, no new
 * permissions: it can only ever export the rows the teacher already
 * sees on their own wallet). The file carries a UTF-8 BOM so Excel
 * opens the Arabic descriptions without mojibake, and quotes every
 * field CSV-style (doubled quotes) so commas/newlines in free-form
 * descriptions can never break the column grid.
 */

import type { MyWalletQuery_myWallet_transactions } from "@/frontend/graphql/generated/gql/graphql";

/** One CSV cell — quoted with embedded quotes doubled. */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** Builds the spreadsheet body from the ledger rows, in display order. */
function buildLedgerCsv(
  rows: readonly MyWalletQuery_myWallet_transactions[],
  labels: {
    readonly type: (type: MyWalletQuery_myWallet_transactions["type"]) => string;
    readonly status: (status: MyWalletQuery_myWallet_transactions["status"]) => string;
  }
): string {
  const header = ["created_at", "type", "status", "amount", "description"].map(csvCell).join(",");
  const lines = rows.map(row =>
    [row.createdAt, labels.type(row.type), labels.status(row.status), row.amount, row.description ?? ""]
      .map(csvCell)
      .join(",")
  );
  return `\uFEFF${header}\n${lines.join("\n")}\n`;
}

/** Triggers a client-side download of the CSV text with a dated filename. */
function downloadLedgerCsv(csv: string): void {
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `wallet-ledger-${stamp}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Builds the CSV from the fetched rows and triggers the download in one call. */
export function exportLedgerCsv(
  rows: readonly MyWalletQuery_myWallet_transactions[],
  labels: {
    readonly type: (type: MyWalletQuery_myWallet_transactions["type"]) => string;
    readonly status: (status: MyWalletQuery_myWallet_transactions["status"]) => string;
  }
): void {
  downloadLedgerCsv(buildLedgerCsv(rows, labels));
}
