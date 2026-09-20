/**
 * Admin financial-auditing GraphQL documents — the payments audit read-back,
 * the teacher-wallet inspector and the withdrawal settlement / wallet
 * adjustment mutations.
 *
 * Per `frontend/graphql/sharedDocuments/AGENTS.md`:
 *  - Documents use `gql` + `TypedDocumentNode` (codegen types only).
 *  - `id` is selected FIRST in every row selection so Apollo normalizes the
 *    cache entries (`AdminStudentPayment` rows, `TeacherTransaction` rows);
 *    the id-less wrapper types (`AdminStudentPaymentPage`,
 *    `AdminTeacherWallet`, `AdminWithdrawalQueueRow`,
 *    `AdminWithdrawalQueuePage`) are embedded value types
 *    (`keyFields: false` in `frontend/providers/apollo/apolloCache.ts`) and
 *    never need an `id`.
 *  - Consumed in views via `useQuery`/`useMutation` from
 *    `@apollo/client/react` — NO `useLazyQuery`.
 *  - Variables are typed, never string-interpolated.
 *  - Money amounts arrive as exact decimal strings — never numeric.
 */
import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  AdjustTeacherWalletMutation,
  AdjustTeacherWalletMutationVariables,
  AdminPendingWithdrawalsQuery,
  AdminPendingWithdrawalsQueryVariables,
  AdminStudentPaymentsQuery,
  AdminStudentPaymentsQueryVariables,
  AdminTeacherWalletQuery,
  AdminTeacherWalletQueryVariables,
  ApproveWithdrawalMutation,
  ApproveWithdrawalMutationVariables,
  RejectWithdrawalMutation,
  RejectWithdrawalMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Paginated, filterable student-payments audit read-back for admins.
 * `id` selected FIRST per the Apollo cache-normalization rule; the wrapper
 * echoes the resolved `page`/`pageSize`/`totalCount` (honest envelope).
 */
export const adminStudentPaymentsQueryDocument: TypedDocumentNode<
  AdminStudentPaymentsQuery,
  AdminStudentPaymentsQueryVariables
> = gql`
  query AdminStudentPayments($filters: AdminStudentPaymentsFilterInput, $page: Int, $pageSize: Int) {
    adminStudentPayments(filters: $filters, page: $page, pageSize: $pageSize) {
      items {
        id
        studentId
        studentName
        subscriptionId
        amount
        currency
        paymentGateway
        status
        createdAt
      }
      totalCount
      page
      pageSize
    }
  }
`;

/**
 * Teacher-wallet inspector read for admins — flat nullable `balance` /
 * `totalEarning` (the null pair means no wallet row exists yet, so the UI
 * renders the honest empty state instead of fake zeros), the constant
 * `currency` render label, and the wallet's paginated transaction ledger.
 * The `TeacherTransaction` rows carry `id` and are normalized; the
 * `AdminTeacherWallet` envelope itself is an embedded value type.
 */
export const adminTeacherWalletQueryDocument: TypedDocumentNode<
  AdminTeacherWalletQuery,
  AdminTeacherWalletQueryVariables
> = gql`
  query AdminTeacherWallet(
    $teacherId: ID!
    $filters: AdminWalletTransactionFilterInput
    $page: Int
    $pageSize: Int
  ) {
    adminTeacherWallet(teacherId: $teacherId, filters: $filters, page: $page, pageSize: $pageSize) {
      balance
      totalEarning
      currency
      teacherId
      teacherName
      transactions {
        id
        type
        status
        amount
        description
        sessionId
        createdAt
      }
      totalCount
      page
      pageSize
    }
  }
`;

/**
 * Pending-withdrawal queue for admins — oldest-first (longest-waiting
 * request first). Each row embeds the pending `TeacherTransaction`
 * (normalized via its `id`) plus the resolved teacher name and the
 * requester's current wallet balance at read time. `totalAmount` is the
 * WHOLE queue's pending payout sum aggregated server-side (page-size
 * independent — honest totals for multi-page queues).
 */
export const adminPendingWithdrawalsQueryDocument: TypedDocumentNode<
  AdminPendingWithdrawalsQuery,
  AdminPendingWithdrawalsQueryVariables
> = gql`
  query AdminPendingWithdrawals($page: Int, $pageSize: Int) {
    adminPendingWithdrawals(page: $page, pageSize: $pageSize) {
      items {
        transaction {
          id
          type
          status
          amount
          description
          createdAt
        }
        teacherName
        walletBalance
      }
      totalCount
      totalAmount
      page
      pageSize
    }
  }
`;

/**
 * Approve (settle → completed) a pending withdrawal. Returns the settled
 * `TeacherTransaction` row — `id` FIRST per the cache-normalization rule.
 * A non-pending row (including a lost double-settle race) resolves to a
 * conflict error the UI surfaces before refetching the queue.
 */
export const approveWithdrawalMutationDocument: TypedDocumentNode<
  ApproveWithdrawalMutation,
  ApproveWithdrawalMutationVariables
> = gql`
  mutation ApproveWithdrawal($transactionId: ID!) {
    approveWithdrawal(transactionId: $transactionId) {
      id
      type
      status
      amount
      description
      walletId
      sessionId
      createdAt
    }
  }
`;

/**
 * Reject (settle → failed) a pending withdrawal and restore the debited
 * balance to the teacher's wallet. Returns the failed
 * `TeacherTransaction` row; carries the mandatory reason.
 */
export const rejectWithdrawalMutationDocument: TypedDocumentNode<
  RejectWithdrawalMutation,
  RejectWithdrawalMutationVariables
> = gql`
  mutation RejectWithdrawal($transactionId: ID!, $reason: String!) {
    rejectWithdrawal(transactionId: $transactionId, reason: $reason) {
      id
      type
      status
      amount
      description
      walletId
      sessionId
      createdAt
    }
  }
`;

/**
 * Manual wallet adjustment (credit or debit) for a teacher's wallet —
 * always reason-bearing and audit-stamped server-side. Returns the new
 * `TeacherTransaction` ledger row; an over-balance debit resolves to a
 * conflict error the UI surfaces before refetching.
 */
export const adjustTeacherWalletMutationDocument: TypedDocumentNode<
  AdjustTeacherWalletMutation,
  AdjustTeacherWalletMutationVariables
> = gql`
  mutation AdjustTeacherWallet($input: AdjustTeacherWalletInput!) {
    adjustTeacherWallet(input: $input) {
      id
      type
      status
      amount
      description
      walletId
      sessionId
      createdAt
    }
  }
`;
