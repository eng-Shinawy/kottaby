import type { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import type { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import type { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import type { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import type { WalletAdjustmentDirection } from "@/backend/enum/billing/wallet-adjustment-direction.enum";
import type { StudentPaymentSelectType } from "@/backend/types/billing/student-payment.types";
import type { TeacherTransactionSelectType } from "@/backend/types/billing/teacher-transaction.types";
import type { WalletSelectType } from "@/backend/types/billing/wallet.types";

/**
 * Admin auditing filter shapes for the student payments ledger. All fields
 * are optional-by-null: `null` means "no filter applied". `studentNameSearch`
 * carries the raw search text — the repository escapes SQL wildcards and
 * wraps the value in `%..%` before the `ilike` comparison.
 */
export interface NormalizedAdminPaymentFilters {
  studentId: number | null;
  studentNameSearch: string | null;
  status: PaymentStatus | null;
  paymentGateway: PaymentGateway | null;
  from: Date | null;
  to: Date | null;
}

/**
 * A student payment row joined with its student's display name for the
 * admin payments ledger view (the GraphQL surface exposes the name only —
 * email is never wired). The lifecycle columns are re-typed to their
 * canonical TypeScript enums (the raw `$inferSelect` projection carries the
 * pgEnum string-literal unions, which the GraphQL enum refs cannot match).
 *
 * `studentId` stays non-null: the ledger column itself is nullable (a
 * payment's owner may be the owning subscription's generic user instead of
 * a student), but this view resolves every row through an INNER join on
 * `students`, so owner-less rows are structurally excluded from the
 * listing — the repository mapper enforces that invariant at the boundary.
 */
export interface AdminStudentPaymentRow
  extends Omit<StudentPaymentSelectType, "status" | "paymentGateway" | "studentId"> {
  /** Resolved student owner — non-null by the view's inner-join contract. */
  studentId: number;
  studentName: string;
  status: PaymentStatus;
  paymentGateway: PaymentGateway;
}

export interface AdminStudentPaymentPageReturnType {
  items: readonly AdminStudentPaymentRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}

/**
 * Admin auditing filter shapes for a teacher's wallet transaction ledger.
 * All fields are optional-by-null: `null` means "no filter applied".
 */
export interface AdminWalletTransactionFilters {
  type: TransactionType | null;
  status: TransactionStatus | null;
  from: Date | null;
  to: Date | null;
}

/**
 * A teacher's wallet overview for the admin auditing view: the wallet
 * amounts plus one newest-first ledger page. `balance` and `totalEarning`
 * are a null pair — both null means the teacher has no wallet row yet
 * (an honest empty state); `amount`/balance fields are decimal strings,
 * never numbers.
 */
export interface AdminTeacherWalletReturnType {
  balance: string | null;
  totalEarning: string | null;
  /** Render label only — the platform currency constant (the wallet table has no currency column). */
  currency: string;
  teacherId: number;
  teacherName: string;
  transactions: readonly TeacherTransactionSelectType[];
  totalCount: number;
  page: number;
  pageSize: number;
}

/**
 * A pending withdrawal joined with its teacher's name and the teacher's
 * current wallet balance (decimal string) for the admin settlement queue.
 */
export interface AdminWithdrawalQueueRow {
  transaction: TeacherTransactionSelectType;
  teacherName: string;
  walletBalance: string;
}

export interface AdminWithdrawalQueuePageReturnType {
  items: readonly AdminWithdrawalQueueRow[];
  totalCount: number;
  /**
   * The WHOLE queue's pending payout sum (decimal string, server-side
   * `SUM` over the same predicate as `items`/`totalCount`) — page-size
   * independent, so the UI can render the total for multi-page queues
   * without the partial-figure masquerade the client-side page sum risked.
   */
  totalAmount: string;
  page: number;
  pageSize: number;
}

/**
 * Narrow projection of a `teacher_transaction` row for settlement flow
 * probes (tests and trigger verification): identity, wallet link, amount,
 * and the type/status pair the settlement guard inspects.
 */
export interface WithdrawalSettlementProbe {
  id: number;
  walletId: number;
  amount: string;
  type: TransactionType;
  status: TransactionStatus;
}

/**
 * A teacher's wallet row joined with the teacher's display identity for
 * admin auditing probes.
 */
export interface AdminTeacherWalletProbe {
  wallet: WalletSelectType;
  teacherName: string;
}

/**
 * Input for a manual wallet adjustment issued through the admin auditing
 * service. `amount` is a decimal string; `direction` is service-layer
 * vocabulary (Credit adds to the balance, Debit subtracts) and is never
 * persisted as a column.
 */
export interface AdminWalletAdjustmentSubmitInput {
  teacherId: number;
  amount: string;
  direction: WalletAdjustmentDirection;
  reason: string;
}
