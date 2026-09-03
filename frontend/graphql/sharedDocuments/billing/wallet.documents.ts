import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  MyWalletQuery,
  MyWalletQueryVariables,
  RequestWithdrawalMutation,
  RequestWithdrawalMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Shared GraphQL documents for the teacher wallet domain (DEV3-013).
 *
 * Two operations over the DEV3-013 SDL surface: the self-wallet read
 * (`myWallet`) and the payout write (`requestWithdrawal`). Both payloads
 * select `id` FIRST on the `Wallet` object so Apollo Client normalizes the
 * returned rows into the cache — the withdrawal response converges
 * `Wallet:<id>` (balance + refreshed ledger page) WITHOUT a refetch (per
 * `sharedDocuments/AGENTS.md` "id Field Requirement").
 *
 * The `Wallet` selection is byte-identical across BOTH documents so the
 * cache-normalized shape never forks between the read and the write.
 *
 * All types come from the codegen output
 * (`@/frontend/graphql/generated/gql/graphql`) — never inline literals
 * as TYPES, never mapping layers. Hooks (`useQuery`, `useMutation`) are
 * consumed from `@apollo/client/react` in views; `useLazyQuery` is banned.
 */

/**
 * `myWallet` — the caller's own teacher wallet (teacher-only, zero
 * arguments): the balance surface (decimal strings, EGP) plus the
 * newest-first ledger page (the 50 most recent transactions). Non-null —
 * the wallet row is ensured lazily, so a new teacher sees an honest
 * zeroed wallet.
 */
export const myWalletQueryDocument: TypedDocumentNode<MyWalletQuery, MyWalletQueryVariables> = gql`
  query MyWallet {
    myWallet {
      id
      balance
      totalEarning
      currency
      createdAt
      updatedAt
      transactions {
        id
        walletId
        sessionId
        amount
        description
        type
        status
        createdAt
        updatedAt
      }
    }
  }
`;

/**
 * `requestWithdrawal(input: RequestWithdrawalInput!)` — the payout
 * request (teacher-only): ONE pending withdrawal ledger row plus a
 * guarded balance debit, atomically. Returns the UPDATED `Wallet!`
 * (post-debit balance + refreshed ledger) so the client converges its
 * cache without a refetch.
 */
export const requestWithdrawalMutationDocument: TypedDocumentNode<
  RequestWithdrawalMutation,
  RequestWithdrawalMutationVariables
> = gql`
  mutation RequestWithdrawal($input: RequestWithdrawalInput!) {
    requestWithdrawal(input: $input) {
      id
      balance
      totalEarning
      currency
      createdAt
      updatedAt
      transactions {
        id
        walletId
        sessionId
        amount
        description
        type
        status
        createdAt
        updatedAt
      }
    }
  }
`;
