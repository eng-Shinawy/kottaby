/**
 * Colocated unit tests for `walletLedgerCsv.ts` — the pure serialization
 * tier (`buildLedgerCsv`), exported for testability; the download side of
 * `exportLedgerCsv` (Blob/anchor/DOM) is browser-tier and stays out of
 * scope (UI verification is E2E-only in this tree).
 *
 * Focus: the formula-injection payload row — a hostile ledger `description`
 * must export as inert text (CWE-1236 defused), never as a live formula.
 */
import { describe, expect, test } from "bun:test";
import {
  type MyWalletQuery_myWallet_transactions,
  TransactionStatus,
  TransactionType,
} from "@/frontend/graphql/generated/gql/graphql";
import { buildLedgerCsv } from "@/frontend/views/teacher/wallet/walletLedgerCsv";

const LABELS = {
  type: (type: MyWalletQuery_myWallet_transactions["type"]) => `type-${type}`,
  status: (status: MyWalletQuery_myWallet_transactions["status"]) => `status-${status}`,
} as const;

function row(overrides: Partial<MyWalletQuery_myWallet_transactions> = {}): MyWalletQuery_myWallet_transactions {
  return {
    id: "tx-1",
    walletId: "wallet-1",
    sessionId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    type: TransactionType.Earning,
    status: TransactionStatus.Completed,
    amount: "12.50",
    description: "ledger-description-a",
    ...overrides,
  };
}

describe("buildLedgerCsv — formula-payload row", () => {
  test("a hostile description exports as inert text (CWE-1236 defused)", () => {
    const csv = buildLedgerCsv(
      [
        row({ description: "=cmd|'/C calc'!A0" }),
        row({ description: "+1=1" }),
        row({ description: "@SUM(A1:A2)" }),
        row({ description: "-2+3" }),
      ],
      LABELS
    );
    const lines = csv.split("\n");
    expect(lines[1]).toBe('"2026-01-01T00:00:00Z","type-Earning","status-Completed","12.50","\'=cmd|\'/C calc\'!A0"');
    expect(lines[2]).toBe('"2026-01-01T00:00:00Z","type-Earning","status-Completed","12.50","\'+1=1"');
    expect(lines[3]).toBe('"2026-01-01T00:00:00Z","type-Earning","status-Completed","12.50","\'@SUM(A1:A2)"');
    expect(lines[4]).toBe('"2026-01-01T00:00:00Z","type-Earning","status-Completed","12.50","\'-2+3"');
    // No exported cell ever starts with a live-formula trigger.
    for (const line of lines.slice(1, 5)) {
      for (const cell of line.split('","')) {
        expect(
          cell.startsWith('"=') || cell.startsWith('"+') || cell.startsWith('"@') || cell.startsWith('"-')
        ).toBeFalse();
      }
    }
  });

  test("a benign ledger row is byte-identical to the pre-guard contract", () => {
    const csv = buildLedgerCsv([row({ createdAt: "2026-02-03T04:05:06Z", description: "حصة تلاوة, مع أحم" })], LABELS);
    expect(csv).toBe(
      '\uFEFF"created_at","type","status","amount","description"\n' +
        '"2026-02-03T04:05:06Z","type-Earning","status-Completed","12.50","حصة تلاوة, مع أحم"\n'
    );
  });
});
