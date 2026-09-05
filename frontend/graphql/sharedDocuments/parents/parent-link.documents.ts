import { gql, type TypedDocumentNode } from "@apollo/client";
import type {
  CancelParentLinkRequestMutation,
  CancelParentLinkRequestMutationVariables,
  MyIncomingParentLinkRequestsQuery,
  MyOutgoingParentLinkRequestsQuery,
  RequestParentChildLinkMutation,
  RequestParentChildLinkMutationVariables,
  RespondToParentLinkRequestMutation,
  RespondToParentLinkRequestMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";

/**
 * Parent-child link request documents — the shared
 * `TypedDocumentNode` operations consumed by the student link-requests
 * page (4.2) and the parent handshake outgoing-requests section (4.3).
 *
 * Self-scoped surface: both lists are ZERO-argument and every mutation
 * carries only its sanctioned variable set (`code` / `requestId` +
 * `accept` / `requestId`) — identity is ALWAYS derived server-side from
 * the authenticated caller (BOLA: no `parentId`/`studentId`/`userId`
 * exists anywhere in the documents).
 *
 * `id` is selected FIRST on every object selection (both
 * `OutgoingParentLinkRequest` and `IncomingParentLinkRequest` rows) so
 * Apollo Client normalizes the rows into cache entries — both objects
 * carry real `id`s, so the frozen `apolloCache.ts` policy inventory
 * stays untouched (no `keyFields: false` needed). `respondedAt` is the
 * sole nullable field on both rows (unset until a Confirm/Reject).
 *
 * NO useLazyQuery anywhere in the documents layer — consumers use
 * stateful `useQuery` from "@apollo/client/react" and refetch after
 * mutations (the simplest honest mutation→list refresh; no cache
 * surgery).
 */

/**
 * `myOutgoingParentLinkRequests` query — the caller's (parent's) own
 * outgoing link requests, newest-first per the service contract.
 *
 * Zero-argument: the parent id is derived server-side from the verified
 * context. Each row carries `studentMaskedName` (the masked-name
 * contract) — the student's real name NEVER crosses the wire.
 * The outgoing rows render the computed status chip (expired is
 * computed from `expiresAt`, never a stale write) and the Cancel CTA on
 * live-pending rows.
 */
export const myOutgoingParentLinkRequestsQueryDocument: TypedDocumentNode<MyOutgoingParentLinkRequestsQuery> = gql`
  query MyOutgoingParentLinkRequests {
    myOutgoingParentLinkRequests {
      id
      status
      studentMaskedName
      createdAt
      expiresAt
      respondedAt
    }
  }
`;

/**
 * `myIncomingParentLinkRequests` query — the caller's (student's) own
 * incoming link requests, newest-first per the service contract.
 *
 * Zero-argument: the student id is derived server-side from the
 * verified context. Each row carries `parentFullName` (dir="auto" in
 * the view). The incoming rows drive the Confirm/Reject CTAs and the
 * expiry line.
 */
export const myIncomingParentLinkRequestsQueryDocument: TypedDocumentNode<MyIncomingParentLinkRequestsQuery> = gql`
  query MyIncomingParentLinkRequests {
    myIncomingParentLinkRequests {
      id
      status
      parentFullName
      createdAt
      expiresAt
      respondedAt
    }
  }
`;

/**
 * `requestParentChildLink` mutation — a parent sends a link request
 * targeting the student behind a handshake CODE.
 *
 * The code is the ONLY variable: the student id is re-resolved
 * server-side from the code (capability-by-code, never across the
 * wire). The payload is the ONLY nullable parent-link mutation — the
 * null collapse: a governed/unknown/non-linkable code and a truly
 * nonexistent one are indistinguishable (`null`), so the caller renders
 * the same "unavailable" notice for both. Conflict codes
 * (`PARENT_LINK_ALREADY_PENDING`, `PARENT_LINK_TARGET_ALREADY_LINKED`)
 * surface as GraphQL errors with `extensions.code`.
 */
export const requestParentChildLinkMutationDocument: TypedDocumentNode<
  RequestParentChildLinkMutation,
  RequestParentChildLinkMutationVariables
> = gql`
  mutation RequestParentChildLink($code: String!) {
    requestParentChildLink(code: $code) {
      id
      status
      studentMaskedName
      createdAt
      expiresAt
      respondedAt
    }
  }
`;

/**
 * `respondToParentLinkRequest` mutation — the student confirms or
 * rejects ONE of their own incoming requests.
 *
 * `$accept` selects the transition (true → Confirmed / false →
 * Rejected); on Confirm the winning parent's link is written in the
 * same transaction and every sibling pending request expires. The
 * returned `IncomingParentLinkRequest` row (id FIRST) writes back into
 * the same normalized cache entry the incoming list produced, so the
 * row restyles to its resolved state — the view still refetches to
 * refresh the rest of the list (siblings folded to expired).
 */
export const respondToParentLinkRequestMutationDocument: TypedDocumentNode<
  RespondToParentLinkRequestMutation,
  RespondToParentLinkRequestMutationVariables
> = gql`
  mutation RespondToParentLinkRequest($requestId: ID!, $accept: Boolean!) {
    respondToParentLinkRequest(requestId: $requestId, accept: $accept) {
      id
      status
      parentFullName
      createdAt
      expiresAt
      respondedAt
    }
  }
`;

/**
 * `cancelParentLinkRequest` mutation — the parent withdraws exactly one
 * of their own pending outgoing requests.
 *
 * Silent fold: the row flips to `Rejected` with ZERO notifications
 * (cancellation emits none). The returned `OutgoingParentLinkRequest`
 * row (id FIRST) restyles the normalized cache entry; the view refetches
 * so the row leaves the live list and shows the rejected chip (the
 * withdrawal fold).
 */
export const cancelParentLinkRequestMutationDocument: TypedDocumentNode<
  CancelParentLinkRequestMutation,
  CancelParentLinkRequestMutationVariables
> = gql`
  mutation CancelParentLinkRequest($requestId: ID!) {
    cancelParentLinkRequest(requestId: $requestId) {
      id
      status
      studentMaskedName
      createdAt
      expiresAt
      respondedAt
    }
  }
`;
